import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpeechAdmission } from '../src/lib/speech-admission.ts';

const idle = { epoch: 1, interrupting: false, turnId: null, replayRequest: 0 };
const speaking = { ...idle, interrupting: true, turnId: 'old' };
const transcript = (extra = {}) => ({ streamId: 'stream', segmentId: 1, beginMs: 0, endMs: 1100, text: 'はい', final: true, ...extra });
function setup() { const gate = new SpeechAdmission(); gate.reset('stream'); return gate; }
function frames(gate, end, context = idle, probability = 0.95, start = 0) {
  for (let at = start; at < end; at += 32) gate.frame({ streamId: 'stream', startMs: at, endMs: at + 32, probability, context });
}

test('cloud noise final and punctuation never admit without local speech', () => {
  const gate = setup();
  frames(gate, 1500, idle, 0.2);
  gate.transcript(transcript({ text: '是。' }), 0, 1500);
  assert.deepEqual(gate.evaluate(1000), []);
  frames(gate, 2000, idle, 0.99, 1504);
  assert.deepEqual(gate.evaluate(2000), [], 'later real speech cannot authorize earlier noise');
});

test('a short Japanese answer needs 250ms speech and can arrive before or after evidence', () => {
  for (const cloudFirst of [true, false]) {
    const gate = setup();
    if (cloudFirst) gate.transcript(transcript({ endMs: 256 }), 0, 300);
    frames(gate, 224);
    if (!cloudFirst) gate.transcript(transcript({ endMs: 256 }), 0, 300);
    assert.deepEqual(gate.evaluate(0), []);
    frames(gate, 256, idle, 0.95, 224);
    assert.equal(gate.evaluate(0)[0]?.accept, true);
    assert.deepEqual(gate.evaluate(1000), [], 'only one acceptance');
  }
});

test('brief acknowledgment during playback remains ignored after playback ends', () => {
  const gate = setup();
  frames(gate, 320, speaking);
  frames(gate, 1408, idle, 0, 320);
  gate.transcript(transcript({ endMs: 320 }), 0, 1408);
  assert.deepEqual(gate.evaluate(2000), []);
});

test('interruption requires a sustained second of speech and stable words', () => {
  const gate = setup();
  frames(gate, 1024, speaking);
  gate.transcript(transcript({ final: false, endMs: null }), 10, 1024);
  assert.deepEqual(gate.evaluate(309), []);
  gate.transcript(transcript({ text: '待ってください', final: false, endMs: null }), 200, 1024);
  assert.deepEqual(gate.evaluate(499), []);
  const decision = gate.evaluate(500)[0];
  assert.equal(decision.accept, true);
  assert.equal(decision.context.turnId, 'old');
  gate.transcript(transcript({ text: '待ってください。' }), 510, 1200);
  assert.equal(gate.evaluate(510)[0].accept, false, 'final updates caption without accepting twice');
});

test('sparse bursts cannot accumulate across silence into an interruption', () => {
  const gate = setup();
  for (let start = 0; start < 3000; start += 640) {
    frames(gate, start + 256, speaking, 0.99, start);
    frames(gate, start + 640, speaking, 0, start + 256);
  }
  gate.transcript(transcript({ endMs: 3200 }), 0, 3200);
  assert.deepEqual(gate.evaluate(1000), []);
});

test('continued local speech can confirm stable interim words without waiting for another cloud packet', () => {
  const gate = setup();
  frames(gate, 320, speaking);
  gate.transcript(transcript({ text: '待って', final: false, endMs: null }), 320, 320);
  frames(gate, 1024, speaking, 0.99, 320);
  assert.equal(gate.evaluate(1024)[0]?.accept, true);
});

test('speech reset, old stream, duplicate frames and unrelated segments cannot reuse evidence', () => {
  const gate = setup();
  frames(gate, 128);
  frames(gate, 128);
  gate.transcript(transcript(), 0, 128);
  assert.deepEqual(gate.evaluate(1000), []);
  gate.reset('new', 1000);
  frames(gate, 2048);
  gate.transcript(transcript(), 0, 2048);
  assert.deepEqual(gate.evaluate(1000), []);
});

test('a run only admits one segment and empty final clears an accepted caption', () => {
  const gate = setup();
  frames(gate, 320);
  gate.transcript(transcript({ final: false, endMs: null }), 0, 320);
  assert.equal(gate.evaluate(0).length, 1);
  gate.transcript(transcript({ segmentId: 2 }), 0, 320);
  assert.deepEqual(gate.evaluate(500), []);
  gate.transcript(transcript({ text: '。', endMs: 320 }), 0, 320);
  assert.equal(gate.evaluate(500)[0]?.transcript.text, '');
});
