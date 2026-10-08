import { copyFile, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await mkdir('.local', { recursive: true });
try { await access('.env'); } catch { await copyFile('.env.example', '.env'); console.log('Created local .env'); }
const commands = [['run','build','-w','@tirek/contracts'], ['run','db:generate'], ['run','build','-w','@tirek/api']];
for (const command of commands) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, ...command], { stdio:'inherit', windowsHide:true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Command failed: ${command.join(' ')}`)));
  });
}
console.log('Ready. Start npm run db:local, then npm run db:migrate && npm run db:seed, then npm run dev.');
