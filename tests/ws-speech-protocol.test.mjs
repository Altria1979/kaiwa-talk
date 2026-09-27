import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, mock, test } from 'node:test';

const handled = [];
let wss;
mock.module('node:http', {
  exports: { createServer() { const server = new EventEmitter(); server.listen = () => server; return server; } },
});
mock.module('ws', {
  exports: {
    default: class { static OPEN = 1; },
    WebSocket: class { static OPEN = 1; },
    WebSocketServer: class extends EventEmitter {
      constructor() {
        super(); this.clients = new Set();
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Capture the server without listening on a port.
        wss = this;
      }
    },
  },
});
mock.module('../server/storage.ts', { exports: { store: {} } });
mock.module('../server/session.ts', {
  exports: { RealtimeSession: class { async handle(event) { handled.push(event); } async dispose() {} }, getActiveSessionId: () => null },
});
const previousSignals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
await import('../server/index.ts');
after(() => {
  for (const [signal, listeners] of previousSignals) for (const listener of process.listeners(signal)) if (!listeners.has(listener)) process.off(signal, listener);
});

function socket(t) {
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.sent = [];
  socket.send = value => socket.sent.push(JSON.parse(value));
  socket.ping = () => {};
  socket.terminate = () => socket.emit('close');
  socket.close = () => socket.emit('close');
  wss.emit('connection', socket);
  t.after(() => socket.emit('close'));
  return socket;
}
const streamId = 'a28c915c-b134-4d83-aa3b-b9d0475fcb3d';
function send(socket, event) { socket.emit('message', Buffer.from(JSON.stringify(event)), false); }

test('speech protocol preserves only connection and segment identifiers plus bounded PCM/reset time', t => {
  const ws = socket(t);
  handled.length = 0;
  for (const event of [
    { type: 'speech.accept', streamId, segmentId: 1 },
    { type: 'speech.reset', streamId, beforeMs: 512.5 },
    { type: 'audio', streamId, audio: 'AAA=' },
  ]) send(ws, event);
  assert.deepEqual(handled, [
    { type: 'speech.accept', streamId, segmentId: 1 },
    { type: 'speech.reset', streamId, beforeMs: 512.5 },
    { type: 'audio', streamId, audio: 'AAA=' },
  ]);
  assert.deepEqual(ws.sent, []);
});

test('malformed, stale-shape and text-bearing speech confirmation packets never reach the session', t => {
  const ws = socket(t);
  handled.length = 0;
  const invalid = [
    { type: 'audio', audio: 'AAA=' },
    { type: 'audio', streamId, audio: 'AA==' },
    { type: 'audio', streamId, audio: '@@@=' },
    { type: 'audio', streamId, audio: 'A'.repeat(24004) },
    ...[undefined, '', 'bad/id', 'a'.repeat(129), 1].map(streamId => ({ type: 'speech.accept', streamId, segmentId: 1 })),
    ...[undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1].map(segmentId => ({ type: 'speech.accept', streamId, segmentId })),
    { type: 'speech.accept', streamId, segmentId: 1, text: 'injected' },
    ...[undefined, null, -1, '100', Infinity].map(beforeMs => ({ type: 'speech.reset', streamId, beforeMs })),
    { type: 'speech.reset', streamId, beforeMs: 10, text: 'injected' },
  ];
  for (const event of invalid) send(ws, event);
  assert.deepEqual(handled, []);
  assert.equal(ws.sent.length, invalid.length);
  assert.ok(ws.sent.every(event => event.type === 'error' && event.source === 'session'
    && event.errorCode === 'eventInvalid' && event.recoverable === true && typeof event.message === 'string'));
});
