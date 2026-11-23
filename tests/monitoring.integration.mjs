import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {MetricsService} from '../backend/dist/modules/monitoring/metrics.service.js';

test('collector reports queue state, fails visibly and recovers without retaining stale counts',async()=>{
  const names=['METRICS_TOKEN','METRICS_TOKEN_FILE','MAIL_DELIVERY','TELEGRAM_DELIVERY'];
  const old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  Object.assign(process.env,{METRICS_TOKEN:randomBytes(32).toString('hex'),MAIL_DELIVERY:'local',TELEGRAM_DELIVERY:'disabled'});
  delete process.env.METRICS_TOKEN_FILE;
  let fail=false,metrics;
  const client={$queryRaw:()=>null,mailMessage:{groupBy:()=>null,findFirst:()=>null},
    telegramDelivery:{groupBy:()=>null,findFirst:()=>null},telegramBotState:{findUnique:()=>null},
    $transaction:async()=>{
      if(fail)throw Error('private database failure must not escape');
      return [[],[{status:'PENDING',_count:{_all:2}},{status:'user-controlled-status',_count:{_all:1}}],[],
        {createdAt:new Date(Date.now()-600000)},null,null];
    }};
  try {
    metrics=new MetricsService({client});
    assert.equal(metrics.authorized('Bearer '+process.env.METRICS_TOKEN),true);
    assert.equal(metrics.authorized('Bearer invalid'),false);
    await Promise.all([metrics.refresh(),metrics.refresh()]);
    let text=await metrics.registry.metrics();
    assert.match(text,/tirek_database_up 1/);
    assert.match(text,/tirek_delivery_messages\{channel="mail",status="PENDING"\} 2/);
    assert.match(text,/status="OTHER"\} 1/);
    assert.ok(!text.includes('user-controlled-status'));
    fail=true;await metrics.refresh();text=await metrics.registry.metrics();
    assert.match(text,/tirek_database_up 0/);assert.match(text,/tirek_collection_error 1/);
    assert.ok(!text.includes('status="PENDING"} 2'));
    assert.ok(!text.includes('private database'));
    fail=false;await metrics.refresh();text=await metrics.registry.metrics();
    assert.match(text,/tirek_database_up 1/);assert.match(text,/tirek_collection_error 0/);
  }finally {
    await metrics?.onModuleDestroy();
    for(const name of names)if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];
  }
});

async function server(token) {
  const probe=createServer();
  await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['backend/dist/main.js'],{windowsHide:true,stdio:'ignore',env:{
    ...process.env,METRICS_TOKEN:token,METRICS_TOKEN_FILE:'',API_PORT:String(port),API_HOST:'127.0.0.1',
    MAIL_DELIVERY:'disabled',TELEGRAM_DELIVERY:'disabled',PASSWORD_RESET_DELIVERY:'disabled',
  }});
  const url='http://127.0.0.1:'+port+'/api';
  try {
    for(let i=0;i<80;i++) {
      if(child.exitCode!==null)throw Error('Monitoring test API exited');
      const ready=await fetch(url+'/health').then(r=>r.ok).catch(()=>false);
      if(ready)return {url,child};
      await delay(100);
    }
    throw Error('Monitoring test API did not become ready');
  }catch(error){child.kill();throw error;}
}

test('metrics require a separate credential and aggregate request templates without tenant data',async()=>{
  const token=randomBytes(32).toString('hex'),privateMarker='private-'+randomUUID();
  const active=await server(token),disabled=await server('');
  try {
    const path=active.url+'/ops/metrics';
    assert.equal((await fetch(path)).status,403);
    assert.equal((await fetch(path,{headers:{Authorization:'Bearer bad'}})).status,403);
    assert.equal((await fetch(path+'?token='+token)).status,403);
    assert.equal((await fetch(disabled.url+'/ops/metrics',{headers:{Authorization:'Bearer '+token}})).status,404);
    await fetch(active.url+'/orders/'+randomUUID()+'?q='+privateMarker);
    await fetch(active.url+'/'+privateMarker);
    const response=await fetch(path,{headers:{Authorization:'Bearer '+token}});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/plain/);
    const text=await response.text();
    assert.match(text,/tirek_database_up 1/);
    assert.match(text,/route="\/api\/orders\/:id"/);
    assert.match(text,/route="unmatched"/);
    assert.ok(!text.includes(privateMarker));assert.ok(!text.includes(token));
    assert.ok(!text.includes(process.env.DATABASE_URL));
  }finally {
    active.child.kill();disabled.child.kill();
  }
});
