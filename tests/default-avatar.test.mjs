import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, MAX_MODEL_BYTES } from '../shared/protocol.ts';

test('the default avatar is the unmodified user-provided Violet model', async () => {
  // Pin the original meshes, textures and embedded author/license metadata.
  assert.equal(DEFAULT_SETTINGS.avatarUrl, '/models/default.vrm');
  const bytes = await readFile(new URL(`../public${DEFAULT_SETTINGS.avatarUrl}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '1431a286699dc1bc56d3e4f78e46e9ca093604acc3c4acef96fe68648707287c',
    'The default must match the supplied Violet file byte-for-byte');
  assert.ok(bytes.length < MAX_MODEL_BYTES);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const vrm = gltf.extensions.VRM;
  assert.equal(vrm.specVersion, '0.0');
  assert.equal(vrm.meta.title, 'Violet Evergarden v1');
  assert.equal(vrm.meta.author, 'Little Cwoissant');
  assert.equal(new URL(vrm.meta.otherLicenseUrl).searchParams.get('redistribution'), 'disallow');
  for (const resource of [...gltf.buffers, ...gltf.images]) {
    assert.equal(resource.uri, undefined, 'The default must load without private uploads or external assets');
  }
  for (const expression of ['a', 'blink']) {
    assert.ok(vrm.blendShapeMaster.blendShapeGroups.find(group => group.presetName === expression)?.binds.length, `${expression} must remain available`);
  }
});
