import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (process.env.NODE_ENV === 'production') throw new Error('dev:https is for local development only');
if (!existsSync('.env')) throw new Error('Run npm run setup first');
const redirectPort = Number(process.env.TIREK_HTTP_REDIRECT_PORT ?? '8080');
const servicePorts = [3000, 4000, 8443];
if (!Number.isInteger(redirectPort) || redirectPort < 1024 || redirectPort > 65535 || servicePorts.includes(redirectPort)) {
  throw new Error('TIREK_HTTP_REDIRECT_PORT must be an available integer port from 1024 to 65535');
}
const caddyEnv = { ...process.env, TIREK_HTTP_REDIRECT_PORT: String(redirectPort) };
const binary = process.platform === 'win32' ? '.local/tools/caddy/caddy.exe' : 'caddy';
const validation = spawnSync(binary, ['validate', '--config', 'scripts/Caddyfile.local', '--adapter', 'caddyfile'], { stdio: 'inherit', windowsHide: true, env: caddyEnv });
if (validation.error || validation.status !== 0) {
  console.error('Caddy is missing or its configuration is invalid. See docs/https.md (Windows: npm run https:setup).');
  process.exit(1);
}
if (!process.env.npm_execpath) throw new Error('Use npm run dev:https');
// Refuse to proxy a different local app or let Next silently select port 3001.
for (const port of [...servicePorts, redirectPort]) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    const hint = port === redirectPort ? 'Set TIREK_HTTP_REDIRECT_PORT to a free port.' : 'Stop the existing local server before dev:https.';
    probe.once('error', () => reject(new Error(`Port ${port} is busy. ${hint}`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

// Shell variables take precedence over .env in both Node and Next.js.
const env = { ...caddyEnv, WEB_ORIGIN: 'https://localhost:8443', API_HOST: '127.0.0.1', API_PORT: '4000', API_INTERNAL_URL: 'http://127.0.0.1:4000', PORT: '3000' };
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  // npm/watchers have descendants on Windows; killing only npm leaves ports occupied.
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  }
}
function start(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, env, detached: process.platform !== 'win32' });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
start(binary, ['run', '--config', 'scripts/Caddyfile.local', '--adapter', 'caddyfile']);
start(process.execPath, [process.env.npm_execpath, 'run', 'dev']);
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(`TirekCRM: https://localhost:8443 (HTTP redirect: http://localhost:${redirectPort}). Start the database separately.`);
