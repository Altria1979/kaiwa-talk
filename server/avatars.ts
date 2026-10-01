import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BlobNotFoundError, copy, del, get, head, issueSignedToken, list, presignUrl } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { AppError } from '../shared/app-errors.js';
import { MAX_MODEL_BYTES } from '../shared/protocol.js';
import { config } from './config.js';

export class AvatarError extends AppError {
  constructor(readonly status: number, message: string) { super(message); }
}
const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function avatarId(id: unknown): string {
  if (typeof id !== 'string' || !identifier.test(id)) throw new AvatarError(400, '読み込んだ VRM アバターを選択してください');
  return id;
}
const blobOptions = () => ({ token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(60_000) });

export function validateVrm(data: Buffer) {
  if (data.length > MAX_MODEL_BYTES) throw new AvatarError(413, 'モデルファイルは 30 MB 以下にしてください。');
  if (data.length < 24 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) throw new AvatarError(400, '完全な VRM 0.0 / 1.0 バイナリファイルを選択してください');
  const size = data.readUInt32LE(12);
  if (data.readUInt32LE(16) !== 0x4e4f534a || size > 4 * 1024 * 1024 || size + 20 > data.length) throw new AvatarError(400, 'VRM の記述データが正しくないか、サイズが大きすぎます');
  try {
    const gltf = JSON.parse(data.subarray(20, 20 + size).toString('utf8'));
    if (gltf.extensions?.VRMC_vrm?.specVersion !== '1.0' && gltf.extensions?.VRM?.specVersion !== '0.0') throw new Error();
    for (const asset of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (asset.uri && (typeof asset.uri !== 'string' || !asset.uri.startsWith('data:'))) throw new AvatarError(400, 'モデルに外部リソースが含まれています。テクスチャとリソースを埋め込んだ VRM を書き出してください');
    }
  } catch (error) {
    if (error instanceof AvatarError) throw error;
    throw new AvatarError(400, '有効なメタデータを含む VRM 0.0 / 1.0 モデルを使用してください');
  }
}

export async function saveLocalAvatar(browserId: string, data: Buffer): Promise<string> {
  avatarId(browserId);
  validateVrm(data);
  const id = randomUUID();
  await mkdir(join(config.dataDir, 'avatars', browserId), { recursive: true, mode: 0o700 });
  await writeFile(join(config.dataDir, 'avatars', browserId, `${id}.vrm`), data, { mode: 0o600, flag: 'wx' });
  return `/api/avatars/${id}.vrm`;
}

export async function prepareAvatarUpload(browserId: string) {
  // Bounded, opportunistic collection: closing the tab may abandon a staging object.
  await cleanupAbandonedUploads(avatarId(browserId)).catch(() => {});
  const id = randomUUID();
  const pathname = `avatar-uploads/${browserId}/${id}.vrm`;
  const token = await generateClientTokenFromReadWriteToken({
    ...blobOptions(), pathname, maximumSizeInBytes: MAX_MODEL_BYTES,
    allowedContentTypes: ['application/octet-stream'], validUntil: Date.now() + 10 * 60_000,
    addRandomSuffix: false, allowOverwrite: false,
  });
  return { id, pathname, token };
}

export async function cleanupAbandonedUploads(browserId: string) {
  const { blobs } = await list({ ...blobOptions(), prefix: `avatar-uploads/${avatarId(browserId)}/`, limit: 1000 });
  const cutoff = Date.now() - 24 * 60 * 60_000;
  const abandoned = blobs.filter(blob => blob.uploadedAt.getTime() < cutoff).map(blob => blob.url);
  if (abandoned.length) await del(abandoned, blobOptions());
}

async function finalizedAvatarExists(pathname: string): Promise<boolean> {
  try { await head(pathname, blobOptions()); return true; }
  catch (error) { if (error instanceof BlobNotFoundError) return false; throw error; }
}

export async function completeAvatarUpload(browserId: string, value: unknown): Promise<string> {
  avatarId(browserId);
  const id = avatarId(value);
  const staging = `avatar-uploads/${browserId}/${id}.vrm`;
  const destination = `avatars/${browserId}/${id}.vrm`;
  const avatarUrl = `/api/avatars/${id}.vrm`;
  // A previous completion may have succeeded before its HTTP response was lost.
  if (await finalizedAvatarExists(destination)) return avatarUrl;
  const blob = await get(staging, { ...blobOptions(), access: 'private', useCache: false });
  if (!blob || blob.statusCode !== 200) throw new AvatarError(404, 'アバターファイルが見つかりません。もう一度読み込んでください');
  const reader = blob.stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let discardStaging = false;
  try {
    if (blob.blob.size > MAX_MODEL_BYTES) throw new AvatarError(413, 'モデルファイルは 30 MB 以下にしてください。');
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > MAX_MODEL_BYTES) throw new AvatarError(413, 'モデルファイルは 30 MB 以下にしてください。');
      chunks.push(Buffer.from(chunk));
    }
    validateVrm(Buffer.concat(chunks));
    // Only validated, immutable objects enter the serving namespace.
    try {
      await copy(blob.blob.url, destination, { ...blobOptions(), access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/octet-stream' });
    } catch (error) {
      // Another completion for this immutable upload can win the copy race.
      if (!await finalizedAvatarExists(destination)) throw error;
    }
    discardStaging = true;
  } catch (error) {
    // Retain valid uploads across transient storage failures so completion can retry.
    discardStaging = error instanceof AvatarError;
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    if (discardStaging) await del(staging, blobOptions()).catch(() => {});
  }
  return avatarUrl;
}

export async function readAvatar(browserId: string, value: string): Promise<Buffer | string> {
  avatarId(browserId);
  const id = avatarId(value);
  if (config.cloud) {
    const pathname = `avatars/${browserId}/${id}.vrm`;
    await assertAvatarOwner(browserId, id);
    const validUntil = Date.now() + 5 * 60_000;
    const token = await issueSignedToken({ ...blobOptions(), pathname, operations: ['get'], validUntil });
    const { presignedUrl } = await presignUrl(token, { pathname, operation: 'get', access: 'private', validUntil });
    return presignedUrl;
  }
  try { return await readFile(join(config.dataDir, 'avatars', browserId, `${id}.vrm`)); }
  catch { throw new AvatarError(404, 'アバターファイルが見つかりません。もう一度読み込んでください'); }
}

/** Reject selecting an avatar that is absent from this browser's namespace. */
export async function assertAvatarOwner(browserId: string, value: string): Promise<void> {
  avatarId(browserId);
  const id = avatarId(value);
  if (config.cloud) {
    if (await finalizedAvatarExists(`avatars/${browserId}/${id}.vrm`)) return;
  } else {
    try { if ((await stat(join(config.dataDir, 'avatars', browserId, `${id}.vrm`))).isFile()) return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  throw new AvatarError(404, 'アバターファイルが見つかりません。もう一度読み込んでください');
}
