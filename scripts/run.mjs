import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

if (Number(process.versions.node.split('.')[0]) !== 24) {
  console.error('请使用 Node.js 24：nvm use，再执行 pnpm dev。');
  process.exit(1);
}
const require = createRequire(import.meta.url);
const production = process.argv[2] === 'start';
const webPort = Number(process.env.KOHARU_WEB_PORT || 3000);
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65534) {
  console.error('KOHARU_WEB_PORT 必须是 1024–65534 之间的整数，服务端使用紧接着的端口。');
  process.exit(1);
}
if (production && !existsSync('dist/server/index.js')) {
  console.error('请先执行 pnpm build。');
  process.exit(1);
}
const children = [
  spawn(process.execPath, [require.resolve('next/dist/bin/next'), production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], { stdio: 'inherit' }),
  spawn(process.execPath, production ? ['--env-file-if-exists=.env.local', 'dist/server/index.js'] : ['--env-file-if-exists=.env.local', '--import', 'tsx', '--watch', 'server/index.ts'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 5000);
  Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))).then(() => { clearTimeout(timer); process.exit(code); });
}
for (const child of children) {
  child.once('error', () => { console.error('服务启动失败，请确认依赖已安装、端口未占用。'); stop(1); });
  child.once('exit', code => stop(code ?? 1));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
