import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (process.platform !== 'win32') throw new Error('Install Caddy from https://caddyserver.com/docs/install, then see docs/https.md');
const version = '2.11.7';
const targets = {
  x64: ['amd64', 'c308154504e53755958ffc62d8a2657ab17eefd6dd25c45dbb2c3d93d29519971f77ca652f7d0f2bcb7f980b9ba3822478865e29969d0272d7613550a43152b1'],
  arm64: ['arm64', '5e232f5fd68968c288034d98f8b4a6b16f246da6d5f1d3a8c7543b83327f1de0bf5d01d627768fbfd1dd254d7d53eb94589a40b126c29def10ac01365a3fe982'],
};
if (!targets[process.arch]) throw new Error('Unsupported Windows architecture: ' + process.arch);
const [arch, expected] = targets[process.arch];
const checksum = bytes => createHash('sha512').update(bytes).digest('hex');
await mkdir('.local/tools/caddy', { recursive: true });
let archive;
try { archive = await readFile('.local/tools/caddy.zip'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!archive || checksum(archive) !== expected) {
  const response = await fetch(`https://github.com/caddyserver/caddy/releases/download/v${version}/caddy_${version}_windows_${arch}.zip`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Caddy download failed: HTTP ' + response.status);
  archive = Buffer.from(await response.arrayBuffer());
  if (checksum(archive) !== expected) throw new Error('Caddy archive checksum mismatch');
  await writeFile('.local/tools/caddy.zip', archive);
}
// Extract only the executable from the verified official archive, using Windows tar.
for (const [command, args] of [
  ['tar.exe', ['-xf', '.local/tools/caddy.zip', '-C', '.local/tools/caddy', 'caddy.exe']],
  ['.local/tools/caddy/caddy.exe', ['validate', '--config', 'scripts/Caddyfile.local', '--adapter', 'caddyfile']],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw result.error ?? new Error(command + ' failed');
}
console.log('Caddy is ready. Trust the project CA once (see docs/https.md), then run npm run dev:https.');
console.log('CA certificate: .local/caddy/pki/authorities/local/root.crt');
