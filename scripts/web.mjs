import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const command = process.argv[2] ?? 'dev';
if (!['dev','build','start'].includes(command)) throw new Error('Unknown Next.js command');
const cli = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const flags = ['--preserve-symlinks', '--preserve-symlinks-main'];
const args = command === 'build' ? ['build','--webpack'] : [command,...(command === 'dev' ? ['--webpack'] : []),'--hostname','127.0.0.1','--port',process.env.PORT ?? '3000'];
const child = spawn(process.execPath, [...flags, cli, ...args], {
  stdio:'inherit', windowsHide:true,
  env:{ ...process.env, NEXT_TELEMETRY_DISABLED:'1', NODE_OPTIONS:`${process.env.NODE_OPTIONS ?? ''} ${flags.join(' ')}`.trim() },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
process.on('SIGINT', () => child.kill()); process.on('SIGTERM', () => child.kill());
