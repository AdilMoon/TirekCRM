import { spawn } from 'node:child_process';
const children = [];
for (const [workspace, command] of [['@tirek/contracts','dev'], ['@tirek/api','dev:compile'], ['@tirek/api','dev'], ['@tirek/web','dev']]) {
  const child = spawn(process.execPath, [process.env.npm_execpath, 'run', command, '-w', workspace], { stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', error => { console.error(error); stop(); });
  child.on('exit', code => { if (code) stop(code); });
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
