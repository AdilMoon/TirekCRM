import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:6})});
const orgs=[],origin=process.env.WEB_ORIGIN??'http://localhost:3000';let base;
async function isolatedApi(){
 const probe=createServer();
 await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 // Independent process, same protections and test database. Do not exhaust other suites' IP budget.
 const child=spawn(process.execPath,['backend/dist/main.js'],{env:{...process.env,API_PORT:String(port),API_HOST:'127.0.0.1'},stdio:'ignore',windowsHide:true});
 let spawnError;child.on('error',e=>{spawnError=e;});
 const exited=new Promise(resolve=>child.once('close',resolve));
 const stop=async()=>{if(child.exitCode===null&&!spawnError)child.kill();await exited;};
 const endpoint='http://127.0.0.1:'+port+'/api';
 try{
  for(let i=0;i<80;i++){
   if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error('Test API stopped before readiness');
   try{if((await fetch(endpoint+'/health',{signal:AbortSignal.timeout(500)})).ok)return {endpoint,stop};}catch{}
   await delay(150);
  }throw Error('Test API readiness timeout');
 }catch(e){await stop();throw e;}
}


async function tenant(){
 const id=randomUUID();orgs.push(id);
 const org=await db.organization.create({data:{id,name:'Privacy QA',users:{create:[{name:'Owner',role:'OWNER',email:randomUUID()+'@privacy.invalid',passwordHash:'unused'},{name:'Worker',role:'EMPLOYEE',email:randomUUID()+'@privacy.invalid',passwordHash:'unused'}]}},include:{users:true}});
 async function cookie(user){const token=randomBytes(32).toString('hex');await db.session.create({data:{userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});return 'tirek_session='+token;}
 const owner=org.users.find(u=>u.role==='OWNER');
 return {id,owner,cookie:await cookie(owner),worker:await cookie(org.users.find(u=>u.role==='EMPLOYEE'))};
}
async function req(path,{cookie,method='GET',body,source=origin}={}){
 const r=await fetch(base+path,{method,headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const input=(extra={})=>({kind:'ACCESS',subjectName:'Privacy <img src=x onerror=alert(1)>',contact:'contact@privacy.invalid',description:'Need access to my records',receivedOn:'2020-01-01',dueOn:'2020-01-02',idempotencyKey:randomUUID(),...extra});
const create=(a,body=input())=>req('/privacy-requests',{...a,method:'POST',body});
const change=(a,row,extra={})=>req('/privacy-requests/'+row.id,{...a,method:'PATCH',body:{version:row.version,status:'IN_PROGRESS',idempotencyKey:randomUUID(),...extra}});

test('privacy request register: tenant boundaries, lifecycle, retries and minimal audit',async t=>{
 const server=await isolatedApi();base=server.endpoint;
 try{
  const a=await tenant(),b=await tenant();let row,creation;
  await t.test('requires owner and Origin, rejects forged fields and malformed text/dates',async()=>{
   for(const [identity,expected]of [[{},401],[{cookie:a.worker},403]]){
    assert.equal((await create(identity)).status,expected);assert.equal((await req('/privacy-requests',identity)).status,expected);
   }
   assert.equal((await req('/privacy-requests',{...a,method:'POST',source:'https://untrusted.invalid',body:input()})).status,403);
   for(const extra of [{organizationId:b.id},{createdById:b.owner.id},{status:'RESOLVED'},{subjectName:''},{description:'ab'},{description:'bad\u0000text'},{description:'bad\ud800'},{description:'x'.repeat(1001)},{contact:'x'.repeat(201)},{receivedOn:'2026-02-30'},{receivedOn:'0001-01-01'},{dueOn:'2019-01-01'},{kind:'UNKNOWN'}])
    assert.equal((await create(a,input(extra))).status,400,JSON.stringify(extra));
   assert.equal((await create(a,input({receivedOn:'2099-01-01',dueOn:null}))).status,409);
   assert.equal((await req('/privacy-requests?status=UNKNOWN',a)).status,400);
   assert.equal((await req('/privacy-requests?organizationId='+b.id,a)).status,400);
   assert.equal((await req('/privacy-requests?q='+encodeURIComponent('a\u0000b'),a)).status,400);
  });
  await t.test('parallel create deduplicates, normalizes UUID and exposes no operation keys',async()=>{
   creation=input();const results=await Promise.all([1,2,3].map(()=>create(a,creation)));
   assert.deepEqual(results.map(r=>r.status),[201,201,201]);assert.equal(new Set(results.map(r=>r.body.id)).size,1);row=results[0].body;
   assert.equal(row.status,'OPEN');assert.equal(row.version,1);assert.equal(row.overdue,true);
   assert.equal('organizationId' in row,false);assert.equal('creationKey' in row,false);
   assert.equal((await create(a,{...creation,idempotencyKey:creation.idempotencyKey.toUpperCase()})).body.id,row.id);
   assert.equal((await create(a,{...creation,description:'Different request'})).status,409);
   assert.equal(await db.auditEvent.count({where:{organizationId:a.id,action:'PRIVACY_REQUEST_CREATED'}}),1);
   assert.equal((await req('/privacy-requests/'+row.id,b)).status,404);
   assert.equal((await req('/privacy-requests/'+row.id,{cookie:a.worker})).status,403);
   assert.equal((await change(b,row)).status,404);assert.equal((await change({cookie:a.worker},row)).status,403);
   assert.equal((await req('/privacy-requests',b)).body.total,0);
  });
  await t.test('lists omit contents and contacts, paginate stably and use Almaty due dates',async()=>{
   const todayOn=today();
   for(const dueOn of [todayOn,null,'2020-01-03'])assert.equal((await create(a,input({subjectName:'Filter requester',dueOn}))).status,201);
   const all=(await req('/privacy-requests?pageSize=2',a)).body;
   assert.equal(all.total,4);assert.equal(all.pages,2);assert.equal(all.items[0].id,row.id);
   assert.ok(all.items.every(r=>!('contact' in r)&&!('description' in r)&&!('resolution' in r)));
   const second=(await req('/privacy-requests?pageSize=2&page=2',a)).body;
   assert.equal(new Set([...all.items,...second.items].map(r=>r.id)).size,4);
   assert.equal(second.items.find(r=>r.dueOn===todayOn).overdue,false);assert.equal(second.items.find(r=>r.dueOn===null).overdue,false);
   assert.equal((await req('/privacy-requests?overdue=true',a)).body.total,2);
   assert.equal((await req('/privacy-requests?q=filter',a)).body.total,3);
  });
  await t.test('status changes are versioned, idempotent after later changes and cannot reopen closure',async()=>{
   for(const extra of [{version:0},{status:'OPEN'},{status:'RESOLVED',resolution:''},{status:'REJECTED',resolution:'ab'},{status:'IN_PROGRESS',resolution:'Extra'},{resolution:'bad\ud800'}])assert.equal((await change(a,row,extra)).status,400);
   const key=randomUUID(),body={idempotencyKey:key};
   const progressed=await Promise.all([1,2,3].map(()=>change(a,row,body)));
   assert.deepEqual(progressed.map(r=>r.status),[200,200,200]);const active=progressed[0].body;
   assert.equal(active.status,'IN_PROGRESS');assert.equal(active.version,2);
   assert.equal((await change(a,row)).status,409);
   const outcomes=await Promise.all(['RESOLVED','REJECTED'].map(status=>change(a,active,{status,resolution:'Verified and answered <script>literal</script>'})));
   assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);const closed=outcomes.find(r=>r.status===200).body;
   assert.equal(closed.version,3);assert.equal(closed.overdue,false);assert.ok(Number.isFinite(Date.parse(closed.closedAt)));
   const repeated=await change(a,{...row,id:row.id.toUpperCase()},{idempotencyKey:key.toUpperCase()});assert.equal(repeated.status,200);assert.deepEqual(repeated.body,closed);
   assert.equal((await create(a,creation)).body.status,closed.status);
   assert.equal((await change(a,closed)).status,409);
   assert.equal((await change(a,row,{...body,status:'REJECTED',resolution:'Other'})).status,409);
   const other=(await create(a,input())).body;assert.equal((await change(a,other,body)).status,409);
   assert.equal(await db.privacyRequestChangeReceipt.count({where:{requestId:row.id}}),2);
   const events=(await req('/audit?entityType=PRIVACY_REQUEST&entityId='+row.id,a)).body.items;
   assert.equal(events.length,3);assert.ok(events.every(e=>!JSON.stringify(e.metadata).includes('literal')&&!JSON.stringify(e.metadata).includes('Privacy')));
   assert.equal((await req('/privacy-requests?status='+closed.status+'&overdue=true',a)).body.total,0);
  });
  await t.test('audit failures roll back requests and receipts; stale disabled owners cannot write',async()=>{
   const {PrivacyRequestsService}=await import('../backend/dist/modules/privacy-requests/privacy-requests.service.js');
   const service=new PrivacyRequestsService({client:db},{record:()=>{throw Error('simulated audit outage');}});
   const before=await db.privacyRequest.count({where:{organizationId:a.id}});
   await assert.rejects(service.create(a.owner,input()),/simulated audit outage/);
   assert.equal(await db.privacyRequest.count({where:{organizationId:a.id}}),before);
   const target=await db.privacyRequest.findFirstOrThrow({where:{organizationId:a.id,status:'OPEN'}}),key=randomUUID();
   await assert.rejects(service.change(a.owner,target.id,{version:1,status:'IN_PROGRESS',resolution:'',idempotencyKey:key}),/simulated audit outage/);
   assert.deepEqual(await db.privacyRequest.findUniqueOrThrow({where:{id:target.id}}),target);
   assert.equal(await db.privacyRequestChangeReceipt.count({where:{organizationId:a.id,idempotencyKey:key}}),0);
   await db.user.update({where:{id:a.owner.id},data:{isActive:false}});
   try{await assert.rejects(service.create(a.owner,input()),e=>e.getStatus()===403);}
   finally{await db.user.update({where:{id:a.owner.id},data:{isActive:true}});}
   await assert.rejects(db.privacyRequestChangeReceipt.create({data:{organizationId:b.id,requestId:target.id,idempotencyKey:randomUUID(),actorId:b.owner.id,inputHash:'0'.repeat(64)}}));
  });
  await t.test('request closure does not modify customer data or financial records',async()=>{
   const client=await db.client.create({data:{organizationId:b.id,name:'Retained test customer'}});
   const request=(await create(b,input({kind:'DELETION'}))).body;
   assert.equal((await change(b,request,{status:'RESOLVED',resolution:'Recorded manual result'})).status,200);
   assert.deepEqual(await db.client.findUniqueOrThrow({where:{id:client.id}}),client);
   assert.equal(await db.payment.count({where:{organizationId:b.id}}),0);
   assert.equal(await db.order.count({where:{organizationId:b.id}}),0);
   await db.client.delete({where:{id:client.id}});
  });
 }finally{
  await server.stop();
  for(const organizationId of orgs){await db.client.deleteMany({where:{organizationId}});await db.user.deleteMany({where:{organizationId}});await db.organization.deleteMany({where:{id:organizationId}});}
  await db.$disconnect();
 }
});
