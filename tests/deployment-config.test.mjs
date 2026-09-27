import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));

function serviceFor(path) {
  const pathname = new URL(path, 'https://virtualmaid.example').pathname;
  return config.rewrites.find(rule => new RegExp(`^${rule.source}$`).test(pathname))?.destination;
}

test('Vercel sends API and websocket requests to the backend without removing their paths', () => {
  for (const path of ['/api', '/api/status', '/api/avatars/model.vrm', '/api/avatars/upload?type=token', '/ws', '/ws?resume=1']) {
    assert.deepEqual(serviceFor(path), { service: 'backend' }, path);
  }
});

test('Vercel leaves pages and static model, VAD and Next assets with the native frontend', () => {
  for (const path of ['/', '/not-found', '/models/default.vrm', '/vad/silero_vad_v5.onnx', '/_next/static/chunk.js', '/apiary', '/ws-example']) {
    assert.deepEqual(serviceFor(path), { service: 'frontend' }, path);
  }
  assert.equal(config.services.frontend.framework, 'nextjs');
  // Services rejects a versioned Node runtime; the Next.js framework detects it.
  assert.equal(config.services.frontend.runtime, undefined);
});

test('the container uses the repository as build context and its explicit Docker entry exists', async () => {
  const backend = config.services.backend;
  assert.equal(backend.root, '.');
  assert.equal(backend.runtime, 'container');
  // The cloud builder uses the Dockerfile directory as its COPY context.
  assert.equal(dirname(backend.entrypoint), '.');
  await access(new URL(backend.entrypoint, root));
  assert.equal(backend.functions['**'].maxDuration, 300);
  for (const rule of config.rewrites) assert.ok(config.services[rule.destination.service]);
  assert.equal(config.experimentalServices, undefined);
  assert.equal(config.buildCommand, undefined);
});
