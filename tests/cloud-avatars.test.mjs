import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { MAX_MODEL_BYTES } from '../shared/protocol.ts';

const calls = [];
let data;
let claimedSize;
let finalized;
let objects;
class BlobNotFoundError extends Error {}
const id = 'e0a2da24-f50b-4f8a-8d08-dc1bdd6c5813';
mock.module('../server/config.ts', { exports: { config: { cloud: true } } });
mock.module('@vercel/blob/client', { exports: {
  generateClientTokenFromReadWriteToken: async options => { calls.push(['token', options]); return 'scoped-client-token'; },
} });
mock.module('@vercel/blob', { exports: {
  BlobNotFoundError,
  head: async path => { calls.push(['head', path]); if (!finalized) throw new BlobNotFoundError(); return {}; },
  list: async () => ({ blobs: objects }),
  get: async (path, options) => { calls.push(['get', path, options]); return { statusCode: 200, blob: { size: claimedSize ?? data.length, url: 'https://store.private.blob.vercel-storage.com/' + path }, stream: new ReadableStream({ start(controller) { controller.enqueue(data); controller.close(); } }) }; },
  copy: async (...args) => { calls.push(['copy', ...args]); finalized = true; },
  del: async (...args) => { calls.push(['del', ...args]); },
  issueSignedToken: async options => { calls.push(['signed', options]); return {}; },
  presignUrl: async (_, options) => { calls.push(['url', options]); return { presignedUrl: 'https://store.private.blob.vercel-storage.com/signed' }; },
} });
const { prepareAvatarUpload, completeAvatarUpload, readAvatar, validateVrm } = await import('../server/avatars.ts');
function vrm(external = false) {
  const json = Buffer.from(JSON.stringify({ extensions: { VRMC_vrm: { specVersion: '1.0' } }, buffers: external ? [{ uri: 'https://untrusted.invalid/model' }] : [] }));
  const result = Buffer.alloc(20 + json.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); json.copy(result, 20);
  return result;
}
beforeEach(() => { calls.length = 0; data = vrm(); claimedSize = undefined; finalized = false; objects = []; });

test('direct upload tokens are scoped to a new staging object with a 30MB limit and no overwrite', async () => {
  const grant = await prepareAvatarUpload();
  const options = calls[0][1];
  assert.match(grant.pathname, /^avatar-uploads\/[0-9a-f-]{36}\.vrm$/);
  assert.equal(options.pathname, grant.pathname);
  assert.equal(options.maximumSizeInBytes, MAX_MODEL_BYTES);
  assert.deepEqual(options.allowedContentTypes, ['application/octet-stream']);
  assert.equal(options.allowOverwrite, false);
  assert.equal(options.addRandomSuffix, false);
});

test('finalization validates the actual private object before copying into the serving namespace', async () => {
  assert.equal(await completeAvatarUpload(id), `/api/avatars/${id}.vrm`);
  assert.equal(calls.find(call => call[0] === 'get')[1], `avatar-uploads/${id}.vrm`);
  assert.equal(calls.find(call => call[0] === 'get')[2].useCache, false);
  assert.equal(calls.find(call => call[0] === 'copy')[2], `avatars/${id}.vrm`);
  assert.equal(calls.find(call => call[0] === 'copy')[3].access, 'private');
  assert.ok(calls.some(call => call[0] === 'del'));
});

test('retry after a lost completion response reuses the already validated final object', async () => {
  await completeAvatarUpload(id);
  calls.length = 0;
  assert.equal(await completeAvatarUpload(id), `/api/avatars/${id}.vrm`);
  assert.deepEqual(calls, [['head', `avatars/${id}.vrm`]]);
});

test('new upload grants collect abandoned day-old staging objects but preserve active uploads', async () => {
  objects = [
    { url: 'https://store.private.blob.vercel-storage.com/old', uploadedAt: new Date(Date.now() - 2 * 86400_000) },
    { url: 'https://store.private.blob.vercel-storage.com/recent', uploadedAt: new Date() },
  ];
  await prepareAvatarUpload();
  assert.deepEqual(calls.find(call => call[0] === 'del')[1], [objects[0].url]);
});

test('invalid models, oversized bodies and arbitrary URLs cannot become served avatars', async () => {
  await assert.rejects(completeAvatarUpload('https://attacker.invalid/x'), { errorCode: 'avatarSelectionInvalid' });
  assert.equal(calls.length, 0);
  data = vrm(true);
  await assert.rejects(completeAvatarUpload(id), { errorCode: 'vrmExternalResources' });
  assert.equal(calls.some(call => call[0] === 'copy'), false);
  assert.ok(calls.some(call => call[0] === 'del'));
  claimedSize = MAX_MODEL_BYTES + 1;
  await assert.rejects(completeAvatarUpload(id), { errorCode: 'modelTooLarge' });
  assert.throws(() => validateVrm(Buffer.alloc(24)), { errorCode: 'vrmBinaryInvalid' });
});

test('cloud reads issue short-lived GET-only URLs without exposing a store-wide credential', async () => {
  const url = await readAvatar(id);
  assert.match(url, /^https:\/\//);
  const scope = calls.find(call => call[0] === 'signed')[1];
  assert.deepEqual(scope.operations, ['get']);
  assert.equal(scope.pathname, `avatars/${id}.vrm`);
  assert.ok(scope.validUntil <= Date.now() + 300_000);
  assert.equal(calls.find(call => call[0] === 'url')[1].access, 'private');
});
