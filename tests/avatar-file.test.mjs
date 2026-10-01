import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Object3D } from 'three';

let parsed = 0;
mock.module('three/examples/jsm/loaders/GLTFLoader.js', { exports: {
  GLTFLoader: class {
    register() {}
    async parseAsync() {
      parsed++;
      return { userData: { vrm: { scene: new Object3D() } } };
    }
  },
} });
const { validateAvatarFile } = await import('../src/components/avatar-stage.tsx');

function avatar(extensions, resources = {}) {
  const json = Buffer.from(JSON.stringify({ extensions, ...resources }));
  const bytes = Buffer.alloc(20 + json.length);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  return new File([bytes], 'avatar.vrm');
}

test('browser import accepts embedded VRM 0.0 and 1.0 before parsing the model', async () => {
  parsed = 0;
  await validateAvatarFile(avatar({ VRM: { specVersion: '0.0' } }));
  await validateAvatarFile(avatar({ VRMC_vrm: { specVersion: '1.0' } }));
  assert.equal(parsed, 2);
});

test('browser import still rejects unknown versions and external resources before parsing', async () => {
  parsed = 0;
  for (const extensions of [{}, { VRM: {} }, { VRM: { specVersion: '0.9' } }, { VRMC_vrm: { specVersion: '2.0' } }]) {
    await assert.rejects(validateAvatarFile(avatar(extensions)), { errorCode: 'controls.avatarErrorVersion' });
  }
  for (const extensions of [{ VRM: { specVersion: '0.0' } }, { VRMC_vrm: { specVersion: '1.0' } }]) {
    await assert.rejects(validateAvatarFile(avatar(extensions, { images: [{ uri: 'https://untrusted.invalid/texture.png' }] })), { errorCode: 'controls.avatarErrorEmbedded' });
  }
  assert.equal(parsed, 0);
});
