import { copyFile, mkdir, access, readFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
await mkdir('.local', { recursive: true });
try { await access('.env'); } catch { await copyFile('.env.example', '.env'); console.log('Created local .env'); }
if(!process.env.MAIL_ENCRYPTION_KEY&&!parse(await readFile('.env','utf8')).MAIL_ENCRYPTION_KEY){
  await appendFile('.env','\nMAIL_ENCRYPTION_KEY='+randomBytes(32).toString('hex')+'\n');
  console.log('Created local mail encryption key');
}
const commands = [['run','build','-w','@tirek/contracts'], ['run','db:generate'], ['run','build','-w','@tirek/api']];
for (const command of commands) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, ...command], { stdio:'inherit', windowsHide:true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Command failed: ${command.join(' ')}`)));
  });
}
console.log('Ready. Start npm run db:local, then npm run db:migrate && npm run db:seed, then npm run dev.');
