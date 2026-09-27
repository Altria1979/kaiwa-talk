import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { mock, test } from 'node:test';

class Socket extends EventEmitter {
  static OPEN = 1;
  static instances = [];
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor() { super(); Socket.instances.push(this); queueMicrotask(() => this.emit('open')); }
  send(raw, options, callback) {
    this.sent.push(Buffer.isBuffer(raw) ? raw : JSON.parse(raw));
    (typeof options === 'function' ? options : callback)?.();
  }
  receive(event) { this.emit('message', Buffer.from(JSON.stringify(event)), false); }
  terminate() { this.readyState = 3; this.emit('close'); }
}
mock.module('ws', { exports: { default: Socket } });
const { AsrClient } = await import('../server/providers/asr.ts');
const runtime = { asrUrl: 'wss://example.invalid/asr', asrModel: 'fun-asr-realtime', apiKey: 'test-only' };
async function connect(t) {
  const events = [];
  const asr = new AsrClient({
    onSpeechStarted: segment => events.push({ type: 'onset', ...segment }),
    onTranscript: (text, final, segment) => events.push({ type: 'transcript', text, final, ...segment }),
    onError: error => events.push({ type: 'error', error }),
  }, runtime);
  t.after(() => asr.close());
  const connected = asr.connect(1600);
  await setImmediate();
  const socket = Socket.instances.at(-1);
  const taskId = socket.sent[0].header.task_id;
  socket.receive({ header: { event: 'task-started', task_id: taskId } });
  await connected;
  const result = sentence => socket.receive({ header: { event: 'result-generated', task_id: taskId }, payload: { output: { sentence } } });
  return { asr, socket, taskId, events, result };
}

test('ASR sends conservative noise tuning without extending pause and tracks actual PCM timeline', async t => {
  const { asr, socket, taskId } = await connect(t);
  assert.equal(asr.streamId, taskId);
  assert.equal(socket.sent[0].payload.parameters.speech_noise_threshold, 0.2);
  assert.equal(socket.sent[0].payload.parameters.max_sentence_silence, 1600);
  assert.equal(asr.time, 0);
  asr.append(Buffer.alloc(8192).toString('base64'));
  assert.equal(asr.time, 256);
  asr.append('AA==');
  assert.equal(asr.time, 256);
  asr.close();
  asr.append(Buffer.alloc(8192).toString('base64'));
  assert.equal(asr.time, 256);
});

test('ASR forwards connection, sentence identity and provider times and deduplicates final', async t => {
  const { asr, events, result } = await connect(t);
  asr.append(Buffer.alloc(64000).toString('base64'));
  result({ sentence_id: 1, begin_time: 10, end_time: null, sentence_begin: true, text: '' });
  result({ sentence_id: 1, begin_time: 10, end_time: null, text: 'はい' });
  result({ sentence_id: 1, begin_time: 10, end_time: 350, sentence_end: true, text: 'はい。' });
  result({ sentence_id: 1, begin_time: 10, end_time: 350, sentence_end: true, text: 'はい。' });
  assert.deepEqual(events, [
    { type: 'onset', streamId: asr.streamId, segmentId: 1, beginMs: 10, endMs: null },
    { type: 'transcript', text: 'はい', final: false, streamId: asr.streamId, segmentId: 1, beginMs: 10, endMs: null },
    { type: 'transcript', text: 'はい。', final: true, streamId: asr.streamId, segmentId: 1, beginMs: 10, endMs: 350 },
  ]);
});

test('malformed or absent segment timing, heartbeat and out-of-stream times fail closed', async t => {
  const { asr, events, result } = await connect(t);
  asr.append(Buffer.alloc(64000).toString('base64'));
  const sentence = { sentence_id: 1, begin_time: 0, end_time: 350, sentence_end: true, text: '雑音' };
  for (const patch of [
    { begin_time: undefined }, { end_time: undefined }, { end_time: null }, { begin_time: -1 },
    { begin_time: 400 }, { end_time: 2001 }, { begin_time: '0' }, { sentence_id: 0 }, { heartbeat: true },
  ]) result({ ...sentence, ...patch });
  assert.deepEqual(events, []);
  result(sentence);
  assert.equal(events.length, 1, 'invalid results do not consume the valid segment ID');
});

test('finish-task continues final timing callbacks but ignores new onsets and partial results', async t => {
  const { asr, socket, taskId, events, result } = await connect(t);
  asr.append(Buffer.alloc(64000).toString('base64'));
  const finished = asr.finish();
  result({ sentence_id: 1, begin_time: 0, end_time: null, sentence_begin: true, text: 'また' });
  result({ sentence_id: 1, begin_time: 0, end_time: 350, sentence_end: true, text: 'またね' });
  socket.receive({ header: { event: 'task-finished', task_id: taskId } });
  await finished;
  assert.equal(events.length, 1);
  assert.equal(events[0].final, true);
  assert.equal(events[0].text, 'またね');
});

test('ASR forwards refined begin times and tolerates sub-millisecond PCM endpoint rounding', async t => {
  const { asr, events, result } = await connect(t);
  asr.append(Buffer.alloc(8200).toString('base64'));
  assert.equal(asr.time, 256.25);
  result({ sentence_id: 1, begin_time: 0, end_time: null, sentence_begin: true, text: 'はい' });
  result({ sentence_id: 1, begin_time: 17, end_time: 258, sentence_end: true, text: 'はい。' });
  assert.equal(events.filter(event => event.final).length, 0, 'more than rounding beyond uploaded PCM is invalid');
  result({ sentence_id: 1, begin_time: 17, end_time: 257, sentence_end: true, text: 'はい。' });
  assert.equal(events.at(-1).beginMs, 17);
  assert.equal(events.at(-1).endMs, 257);
  assert.equal(events.at(-1).final, true);
});
