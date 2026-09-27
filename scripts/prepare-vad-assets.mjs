import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const vadDist = dirname(require.resolve('@ricky0123/vad-web'));
const ortDist = dirname(require.resolve('onnxruntime-web'));
const destination = resolve('public/vad');
await mkdir(join(destination, 'ort'), { recursive: true });
await mkdir(join(destination, 'licenses'), { recursive: true });

// Always copy from the installed, locked versions; never fetch runtime assets from a CDN.
for (const name of ['silero_vad_v6.onnx', 'vad.worklet.bundle.min.js']) {
  await copyFile(join(vadDist, name), join(destination, name));
}
const ortAssets = (await readdir(ortDist)).filter(name => /^ort-wasm.*\.(wasm|mjs)$/.test(name));
if (!ortAssets.some(name => name.endsWith('.wasm'))) throw new Error('ONNX Runtime WASM assets are missing.');
await Promise.all(ortAssets.map(name => copyFile(join(ortDist, name), join(destination, 'ort', name))));
for (const name of ['vad-web.txt', 'silero-vad.txt', 'onnxruntime.txt']) {
  await copyFile(resolve('docs/licenses', name), join(destination, 'licenses', name));
}
console.log('Local VAD model, worklet and ONNX Runtime assets prepared.');
