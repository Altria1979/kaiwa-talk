import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, MAX_MODEL_BYTES } from '../shared/protocol.ts';

test('a fresh installation ships the same VRoid Avatar A used by the original companion', async () => {
  // Pin the reviewed model, not just its editable display name: another valid VRM
  // previously shipped here while the page still identified it as Avatar A.
  assert.equal(DEFAULT_SETTINGS.avatarUrl, '/models/default.vrm');
  const bytes = await readFile(new URL(`../public${DEFAULT_SETTINGS.avatarUrl}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'fce86a78b4d7aad258af5e46236de1efcb5f84b1ad1b38fa99f55b3307f6579e',
    'The bundled default must be the reviewed Avatar A, including its meshes and textures');
  assert.ok(bytes.length < MAX_MODEL_BYTES);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const vrm = gltf.extensions.VRMC_vrm;
  assert.equal(vrm.specVersion, '1.0');
  assert.equal(vrm.meta.name, 'Koharu · Avatar A v1');
  assert.deepEqual(vrm.meta.authors, ['pixiv VRoid Project']);
  assert.equal(vrm.meta.otherLicenseUrl, 'https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z');
  for (const resource of [...gltf.buffers, ...gltf.images]) {
    assert.equal(resource.uri, undefined, 'The default must load without private uploads or external assets');
  }
  for (const expression of ['aa', 'blink']) {
    assert.ok(vrm.expressions.preset[expression].morphTargetBinds.length, `${expression} must remain available`);
  }
});
