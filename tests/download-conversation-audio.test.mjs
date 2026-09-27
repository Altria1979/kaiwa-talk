import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadConversationAudio } from '../src/lib/download-conversation-audio.ts';

test('audio download uses the recorded blob and a safe dated filename, then releases its URL', t => {
  const recording = { status: 'ready', sessionId: 'session/unsafe:name', createdAt: '2026-09-27T08:15:03.000Z', extension: 'webm', blob: new Blob(['last audio chunk'], { type: 'audio/webm' }) };
  let appended = false;
  let clicked = false;
  let removed = false;
  let release;
  const revoked = [];
  const link = { click() { assert.equal(appended, true); clicked = true; }, remove() { removed = true; } };
  t.mock.method(URL, 'createObjectURL', blob => { assert.equal(blob, recording.blob); return 'blob:recording'; });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { assert.ok(delay > 0); release = callback; });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag) { assert.equal(tag, 'a'); return link; },
    body: { appendChild(element) { assert.equal(element, link); appended = true; } },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  downloadConversationAudio(recording);
  assert.equal(clicked, true);
  assert.equal(removed, true);
  assert.equal(link.href, 'blob:recording');
  assert.match(link.download, /^kaiwa-talk-2026-09-27T08-15-03-000Z-sessionunsaf\.webm$/);
  assert.deepEqual(revoked, [], 'the download must retain its URL until the browser starts saving');
  release();
  assert.deepEqual(revoked, ['blob:recording']);
});
