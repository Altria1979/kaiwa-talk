import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QwenClient } from '../server/providers/qwen.ts';

const runtime = {
  apiKey: 'test-only', chatBaseUrl: 'https://example.invalid/compatible-mode/v1',
  asrUrl: 'wss://example.invalid/asr', realtimeUrl: 'wss://example.invalid/tts',
  chatModel: 'qwen-test', asrModel: 'asr-test', ttsModel: 'tts-test',
  region: 'cn-beijing', credentialSource: 'browser',
};
const messages = [{ role: 'user', content: 'こんにちは' }];
const frame = payload => `data: ${JSON.stringify(payload)}\n\n`;
const reply = (text = 'こんにちは！') => new Response(frame({ choices: [{ delta: { content: text } }] }) + 'data: [DONE]\n\n');

test('Qwen recovers once from a transient connection failure before output', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++attempts === 1) throw new TypeError('fetch failed with private upstream details');
    return reply();
  });
  assert.equal(await new QwenClient(runtime).complete(messages), 'こんにちは！');
  assert.equal(attempts, 2);
});

test('Qwen retries a temporary HTTP outage and cancels the rejected body', async t => {
  let cancelled = false;
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => ++attempts === 1
    ? new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 })
    : reply());
  assert.equal(await new QwenClient(runtime).complete(messages), 'こんにちは！');
  assert.equal(attempts, 2);
  assert.equal(cancelled, true);
});

test('Qwen retry is bounded and preserves the safe final error', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    throw new TypeError('Authorization: Bearer private-upstream-token');
  });
  await assert.rejects(new QwenClient(runtime).complete(messages), error => {
    assert.equal(error.errorCode, 'chatUnavailable');
    assert.doesNotMatch(error.message, /private-upstream-token/);
    return true;
  });
  assert.equal(attempts, 2);
});

test('Qwen never replays a stream that already emitted reply text', async t => {
  let attempts = 0;
  let pulls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    return new Response(new ReadableStream({
      pull(controller) {
        if (++pulls === 1) controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: '途中' } }] })));
        else controller.error(new TypeError('stream terminated'));
      },
    }));
  });
  const output = [];
  await assert.rejects(async () => {
    for await (const delta of new QwenClient(runtime).stream(messages, new AbortController().signal)) output.push(delta);
  }, { errorCode: 'chatUnavailable' });
  assert.deepEqual(output, ['途中']);
  assert.equal(attempts, 1);
});

test('Qwen recovers from a stream transport failure before the first reply token', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => ++attempts === 1
    ? new Response(new ReadableStream({ pull(controller) { controller.error(new TypeError('stream terminated')); } }))
    : reply());
  assert.equal(await new QwenClient(runtime).complete(messages), 'こんにちは！');
  assert.equal(attempts, 2);
});

test('Qwen retries only known transient streaming provider errors', async t => {
  for (const [code, errorCode, retries] of [['ServiceUnavailable', undefined, true], ['invalid_api_key', 'authenticationFailed', false], ['Throttling', 'quotaExceeded', false], ['CLIENT_ERROR', 'providerUnavailable', false]]) {
    await t.test(code, async t => {
      let attempts = 0;
      t.mock.method(globalThis, 'fetch', async () => ++attempts === 1 ? new Response(frame({ error: { code } })) : reply());
      if (retries) assert.equal(await new QwenClient(runtime).complete(messages), 'こんにちは！');
      else await assert.rejects(new QwenClient(runtime).complete(messages), { errorCode });
      assert.equal(attempts, retries ? 2 : 1);
    });
  }
});

test('Qwen does not retry rejected credentials, permissions, quota, or invalid input', async t => {
  for (const [status, errorCode] of [[401, 'authenticationFailed'], [403, 'modelAccessDenied'], [429, 'quotaExceeded'], [400, 'providerRequestInvalid']]) {
    await t.test(String(status), async t => {
      let attempts = 0;
      t.mock.method(globalThis, 'fetch', async () => { attempts++; return new Response('', { status }); });
      await assert.rejects(new QwenClient(runtime).complete(messages), { errorCode });
      assert.equal(attempts, 1);
    });
  }
});

test('Qwen retains authentication rejection when discarding the rejected body fails', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    return new Response(new ReadableStream({ cancel() { throw new TypeError('private upstream stream failure'); } }), { status: 401 });
  });
  await assert.rejects(new QwenClient(runtime).complete(messages), { errorCode: 'authenticationFailed' });
  assert.equal(attempts, 1);
});

test('Qwen cancellation prevents the retry after a connection failure', async t => {
  const controller = new AbortController();
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    queueMicrotask(() => controller.abort());
    throw new TypeError('fetch failed');
  });
  await assert.rejects(new QwenClient(runtime).complete(messages, controller.signal), { name: 'AbortError' });
  assert.equal(attempts, 1);
});

test('Qwen cancellation interrupts retry backoff', async t => {
  const controller = new AbortController();
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    setTimeout(() => controller.abort(), 10);
    return new Response('', { status: 503 });
  });
  await assert.rejects(new QwenClient(runtime).complete(messages, controller.signal), { name: 'AbortError' });
  assert.equal(attempts, 1);
});

test('Qwen retry shares the original reply deadline', async t => {
  const deadline = new AbortController();
  let deadlines = 0;
  let attempts = 0;
  t.mock.method(AbortSignal, 'timeout', () => { deadlines++; return deadline.signal; });
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    setTimeout(() => deadline.abort(), 10);
    return new Response('', { status: 503 });
  });
  await assert.rejects(new QwenClient(runtime).complete(messages), { errorCode: 'replyTimeout' });
  assert.equal(attempts, 1);
  assert.equal(deadlines, 1);
});

test('Qwen does not retry malformed streaming data', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; return new Response('data: malformed\n\n'); });
  await assert.rejects(new QwenClient(runtime).complete(messages), { errorCode: 'replyInvalid' });
  assert.equal(attempts, 1);
});

test('Qwen does not mistake unexpected SSE structure for a network failure', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; return new Response(frame(null)); });
  await assert.rejects(new QwenClient(runtime).complete(messages), { errorCode: 'chatUnavailable' });
  assert.equal(attempts, 1);
});
