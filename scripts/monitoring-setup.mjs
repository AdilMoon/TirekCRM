import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const directory=new URL('../.local/monitoring/',import.meta.url);
await mkdir(directory,{recursive:true});
for(const name of ['metrics-token','grafana-password','grafana-secret-key']) {
  try {await writeFile(new URL(name,directory),randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}
  catch(error) {if(error.code!=='EEXIST')throw error;}
}
console.log('Monitoring secrets are ready in .local/monitoring.');
