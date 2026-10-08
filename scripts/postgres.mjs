// Portable PostgreSQL for LOCAL development only. No Windows service or system user is installed.
import { mkdir, access, writeFile, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { config } from 'dotenv';
config({ path: '.env', quiet: true });
if (process.env.NODE_ENV === 'production') throw new Error('Portable database is for local development only');
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://tirek:tirek_local_only@127.0.0.1:54329/tirek');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/tirek') throw new Error('db:local requires a loopback DATABASE_URL ending in /tirek');
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const binaries = await import(`@embedded-postgres/${platform}-${process.arch}`);
await mkdir('.local', { recursive: true });
const local = await realpath('.local');
const databaseDir = path.join(local, 'postgres');
async function run(executable, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio:'inherit', windowsHide:true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} exited with ${code}`)));
  });
}
try { await access(path.join(databaseDir, 'PG_VERSION')); }
catch {
  const passwordFile = path.join(local, 'postgres-init-password');
  await writeFile(passwordFile, decodeURIComponent(url.password), { mode:0o600 });
  try { await run(binaries.initdb, ['-D', databaseDir, '-U', decodeURIComponent(url.username), '--pwfile', passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']); }
  finally { await unlink(passwordFile); }
}
// pg_ctl drops administrative privileges on Windows before starting postgres.
// Starting postgres.exe directly from an elevated terminal is intentionally refused by PostgreSQL.
if (process.argv.includes('--stop')) {
  await run(binaries.pg_ctl, ['-D', databaseDir, 'stop', '-m', 'fast', '-w']);
  process.exit(0);
}
await run(binaries.pg_ctl, ['-D', databaseDir, 'start', '-l', path.join(local, 'postgres.log'), '-w', '-o', `-p ${url.port || '54329'} -h 127.0.0.1 -c shared_buffers=64MB -c max_connections=50`]);
let exited = false, stopping = false;
const keepAlive = setInterval(() => {}, 60000);
async function stop() {
  if (stopping || exited) return; stopping = true;
  await run(binaries.pg_ctl, ['-D', databaseDir, 'stop', '-m', 'fast', '-w']);
  exited = true; clearInterval(keepAlive);
}
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
let ready = false;
for (let attempt = 0; attempt < 60 && !exited; attempt++) {
  const client = new pg.Client({ connectionString:adminUrl.href, connectionTimeoutMillis:1000 });
  try {
    await client.connect();
    if (!(await client.query("SELECT 1 FROM pg_database WHERE datname = 'tirek'")).rowCount) await client.query('CREATE DATABASE tirek');
    ready = true;
  } catch { await sleep(500); }
  finally { await client.end().catch(() => {}); }
  if (ready) break;
}
if (!ready) { await stop(); throw new Error('PostgreSQL did not start'); }
console.log(`Local PostgreSQL ready at 127.0.0.1:${url.port}. Data: ${databaseDir}. Keep this terminal running.`);
