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

const bank={businessId:'123456789012',address:'Almaty QA',bankName:'Test bank',iban:'KZ861250000000000001',bic:'TESTKZKX'};
async function session(userId){
 const token=randomBytes(32).toString('hex');
 await db.session.create({data:{userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 return 'tirek_session='+token;
}
async function tenant(){
 const id=randomUUID();orgs.push(id);
 const org=await db.organization.create({data:{id,name:'Invoice QA',...bank,users:{create:[
 {name:'Owner',role:'OWNER',email:randomUUID()+'@invoice.invalid',passwordHash:'unused'},
 {name:'Worker',role:'EMPLOYEE',email:randomUUID()+'@invoice.invalid',passwordHash:'unused'},
 ]}},include:{users:true}});
 return {id,cookie:await session(org.users.find(u=>u.role==='OWNER').id),worker:await session(org.users.find(u=>u.role==='EMPLOYEE').id)};
}
async function req(path,{cookie,method='GET',body,source=origin}={}){
 const r=await fetch(base+path,{method,headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json()};
}
async function createOrder(a,clientId,unitPrice='10.01',quantity=3){
 const r=await req('/orders',{...a,method:'POST',body:{title:'Invoice order',clientId,items:[{description:'Service',quantity,unitPrice}]}});
 assert.equal(r.status,201);return r.body;
}
const input=(order,extra={})=>({orderVersion:order.version,idempotencyKey:randomUUID(),...extra});
const invoice=(a,order,body=input(order))=>req('/orders/'+order.id+'/invoices',{...a,method:'POST',body});

test('client requisites and immutable payment invoices',async t=>{
 const server=await isolatedApi();base=server.endpoint;
 try{
  const a=await tenant(),b=await tenant();let client,order,document;
  await t.test('normalizes bank fields, validates checksum and rejects malformed input',async()=>{
   for(const details of [{iban:'KZ001250000000000001'},{bic:'TESTUSKX'},{businessId:'123'},{bankName:'bank\u0000name'}]){
    assert.equal((await req('/clients',{...a,method:'POST',body:{name:'Bad',...details}})).status,400);
   }
   const r=await req('/clients',{...a,method:'POST',body:{name:'Client <script>alert(1)</script>',company:'Test buyer',...bank,iban:'kz86 1250 0000 0000 0001',bic:'testkzkx'}});
   assert.equal(r.status,201,JSON.stringify(r.body));client=r.body;assert.equal(client.iban,bank.iban);
   const found=await req('/clients/search?q='+bank.businessId,a);assert.equal(found.body.total,1);assert.equal(found.body.items[0].iban,bank.iban);
   assert.equal((await req('/clients/search?q='+bank.businessId,b)).body.total,0);
   order=await createOrder(a,client.id);
  });
  await t.test('requires current versions and rejects simultaneous lost updates',async()=>{
   const payload={name:client.name,company:client.company,...bank,version:client.version};
   const results=await Promise.all(['First','Second'].map(bankName=>req('/clients/'+client.id,{...a,method:'PATCH',body:{...payload,bankName}})));
   assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
   assert.equal((await req('/clients/'+client.id,{...a,method:'PATCH',body:{name:'Missing version'}})).status,400);
   assert.equal((await req('/clients/'+client.id,{...b,method:'PATCH',body:payload})).status,404);
   const org=await req('/organization',a);
   const companyResults=await Promise.all(['Company A','Company B'].map(name=>req('/organization',{...a,method:'PATCH',body:{...org.body,name}})));
   assert.deepEqual(companyResults.map(r=>r.status).sort(),[200,409]);
  });
  await t.test('enforces session, roles, tenant and Origin on invoice creation and reads',async()=>{
   for(const [identity,expected] of [[{},401],[{cookie:a.worker},403],[b,404]]){
    assert.equal((await invoice(identity,order)).status,expected);
   }
   assert.equal((await req('/orders/'+order.id+'/invoices',{...a,method:'POST',source:'https://untrusted.invalid',body:input(order)})).status,403);
   for(const extra of [{orderVersion:0},{dueDate:'2026-02-30'},{dueDate:'0000-01-01'},{total:'1.00'},{note:'x'.repeat(501)},{note:'bad\u0000input'}])
    assert.equal((await invoice(a,order,input(order,extra))).status,400);
   assert.equal((await invoice(a,order,input(order,{dueDate:'2000-01-01'}))).status,409);
  });
  await t.test('snapshots exact partial payment and does not record income',async()=>{
   assert.equal((await req('/orders/'+order.id+'/payments',{...a,method:'POST',body:{amount:'10.02',idempotencyKey:randomUUID()}})).status,201);
   assert.equal((await invoice(a,order)).status,409);
   order=(await req('/orders/'+order.id,a)).body;
   const r=await invoice(a,order,input(order,{dueDate:'2099-01-01',note:'Pay for service\nUse invoice number'}));
   assert.equal(r.status,201,JSON.stringify(r.body));document=r.body;
   assert.equal(document.snapshot.invoice.note,'Pay for service\nUse invoice number');
   assert.equal(document.snapshot.total,'30.03');assert.equal(document.snapshot.invoice.paid,'10.02');assert.equal(document.snapshot.invoice.amountDue,'20.01');
   assert.equal(document.snapshot.organization.iban,bank.iban);assert.equal(document.snapshot.client.businessId,bank.businessId);
   assert.equal(await db.payment.count({where:{organizationId:a.id}}),1);
   assert.equal(await db.auditEvent.count({where:{organizationId:a.id,action:'INVOICE_CREATED'}}),1);
   assert.equal((await req('/documents/'+document.id,b)).status,404);assert.equal((await req('/documents/'+document.id,{cookie:a.worker})).status,403);
  });
  await t.test('deduplicates concurrent requests and rejects conflicting reuse',async()=>{
   const payload=input(order),before=await db.organization.findUnique({where:{id:a.id}});
   const results=await Promise.all([1,2,3].map(()=>invoice(a,order,payload)));
   assert.deepEqual(results.map(r=>r.status),[201,201,201]);assert.equal(new Set(results.map(r=>r.body.id)).size,1);
   assert.equal((await db.organization.findUnique({where:{id:a.id}})).documentSeq,before.documentSeq+1);
   assert.equal((await invoice(a,order,{...payload,note:'Changed'})).status,409);
   assert.equal((await invoice(a,{...order,id:order.id.toUpperCase()},{...payload,idempotencyKey:payload.idempotencyKey.toUpperCase()})).body.id,results[0].body.id);
   const another=await createOrder(a,client.id);assert.equal((await invoice(a,another,payload)).status,409);
   // A later payment must not invalidate an identical retry of a successfully created document.
   await req('/orders/'+order.id+'/payments',{...a,method:'POST',body:{amount:'0.01',idempotencyKey:randomUUID()}});
   assert.equal((await invoice(a,order,payload)).body.id,results[0].body.id);
  });
  await t.test('later requisites and payments cannot rewrite snapshots; search uses saved data',async()=>{
   const before=(await req('/documents/'+document.id,a)).body.snapshot;
   const current=await db.client.findUnique({where:{id:client.id}});
   await req('/clients/'+client.id,{...a,method:'PATCH',body:{name:'Renamed customer',version:current.version}});
   const org=(await req('/organization',a)).body;
   assert.equal((await req('/organization',{...a,method:'PATCH',body:{...org,name:'Renamed supplier'}})).status,200);
   assert.deepEqual((await req('/documents/'+document.id,a)).body.snapshot,before);
   const found=await req('/documents/search?kind=INVOICE_DRAFT&q=Test%20buyer',a);
   assert.equal(found.body.total,2);assert.ok(found.body.items.every(d=>d.kind==='INVOICE_DRAFT'&&d.total==='20.01'));
   assert.equal((await req('/documents/search?kind=ACT_DRAFT',a)).body.total,0);
   assert.equal((await req('/documents/search?kind=INVOICE_DRAFT',b)).body.total,0);
   assert.equal((await req('/documents/search?kind=bad',a)).status,400);
  });
  await t.test('rejects missing seller details, cancellation and fully paid orders without consuming numbers',async()=>{
   const target=await createOrder(b,(await req('/clients',{...b,method:'POST',body:{name:'Client'}})).body.id);
   const org=(await req('/organization',b)).body;
   await req('/organization',{...b,method:'PATCH',body:{...org,iban:''}});
   assert.equal((await invoice(b,target)).status,409);
   await req('/orders/'+target.id+'/status',{...b,method:'PATCH',body:{status:'CANCELLED'}});
   const cancelled=(await req('/orders/'+target.id,b)).body;
   assert.equal((await invoice(b,cancelled)).status,409);
   assert.equal((await db.organization.findUnique({where:{id:b.id}})).documentSeq,0);
   const paid=await createOrder(a,client.id);
   await req('/orders/'+paid.id+'/payments',{...a,method:'POST',body:{amount:paid.total,idempotencyKey:randomUUID()}});
   assert.equal((await invoice(a,(await req('/orders/'+paid.id,a)).body)).status,409);
  });
  await t.test('keeps tiyn beyond Number precision and assigns unique numbers concurrently',async()=>{
   const large=await createOrder(a,client.id,'999999999999.99',10000);
   const results=await Promise.all([1,2].map(()=>invoice(a,large)));
   assert.deepEqual(results.map(r=>r.status),[201,201]);assert.equal(new Set(results.map(r=>r.body.number)).size,2);
   assert.equal(results[0].body.snapshot.invoice.amountDue,'9999999999999900.00');
   assert.equal(results[0].body.snapshot.items[0].unitPrice,'999999999999.99');
  });
  await t.test('concurrent payment produces a coherent snapshot or a version conflict',async()=>{
   const concurrent=await createOrder(a,client.id);
   const [issued,paid]=await Promise.all([invoice(a,concurrent),req('/orders/'+concurrent.id+'/payments',{...a,method:'POST',body:{amount:'1.01',idempotencyKey:randomUUID()}})]);
   assert.equal(paid.status,201);assert.ok([201,409].includes(issued.status));
   if(issued.status===201){assert.equal(issued.body.snapshot.invoice.paid,'0.00');assert.equal(issued.body.snapshot.invoice.amountDue,'30.03');}
   assert.equal((await req('/orders/'+concurrent.id,a)).body.debt,'29.02');
  });

  const annul=(identity,id,body)=>req('/documents/'+id+'/annul',{...identity,method:'POST',body});
  const annulInput=(extra={})=>({version:1,reason:'Incorrect bank details',idempotencyKey:randomUUID(),...extra});
  await t.test('annulment enforces tenant, role, session, Origin and strict input',async()=>{
   for(const [identity,expected] of [[{},401],[{cookie:a.worker},403],[b,404]])
    assert.equal((await annul(identity,document.id,annulInput())).status,expected);
   assert.equal((await req('/documents/'+document.id+'/annul',{...a,method:'POST',source:'https://evil.invalid',body:annulInput()})).status,403);
   for(const extra of [{version:0},{version:2.5},{version:2147483648},{reason:'  '},{reason:'ab'},{reason:'x'.repeat(501)},{reason:'bad\u0000input'},{reason:'ab\ud800'},{reason:'😀a'},{status:'DRAFT'},{organizationId:b.id},{idempotencyKey:'invalid'}])
    assert.equal((await annul(a,document.id,annulInput(extra))).status,400,JSON.stringify(extra));
   assert.equal((await annul(a,document.id,annulInput({version:2}))).status,409);
   assert.equal((await req('/documents/search?status=INVALID',a)).status,400);
   assert.equal((await db.document.findUniqueOrThrow({where:{id:document.id}})).status,'DRAFT');
  });
  await t.test('concurrent identical annulments produce one event and preserve money and snapshot',async()=>{
   const before=(await req('/orders/'+order.id,a)).body;
   const payload=annulInput({reason:'Reason <script>alert(1)</script>\nSecond line'});
   const results=await Promise.all([1,2,3].map(()=>annul(a,document.id,payload)));
   assert.deepEqual(results.map(r=>r.status),[201,201,201]);
   assert.ok(results.every(r=>r.body.status==='ANNULLED'&&r.body.version===2));
   assert.equal(new Set(results.map(r=>r.body.annulledAt)).size,1);
   assert.ok(Number.isFinite(Date.parse(results[0].body.annulledAt)));
   assert.deepEqual(results[0].body.snapshot,document.snapshot);
   assert.equal(results[0].body.annulmentReason,payload.reason);
   assert.deepEqual((await req('/orders/'+order.id,a)).body,before);
   const events=await db.auditEvent.findMany({where:{organizationId:a.id,action:'DOCUMENT_ANNULLED'}});
   assert.equal(events.length,1);assert.equal(events[0].metadata.documentId,document.id);
   assert.equal('reason' in events[0].metadata,false);
   assert.equal((await annul(a,document.id.toUpperCase(),{...payload,idempotencyKey:payload.idempotencyKey.toUpperCase()})).status,201);
   assert.equal((await annul(a,document.id,{...payload,reason:'Another reason'})).status,409);
   assert.equal((await annul(a,document.id,annulInput())).status,409);
   assert.equal((await annul(a,document.id,{...payload,version:2})).status,409);
   const other=await db.document.findFirstOrThrow({where:{organizationId:a.id,status:'DRAFT'}});
   assert.equal((await annul(a,other.id,payload)).status,409);
   const found=(await req('/documents/search?status=ANNULLED',a)).body;
   assert.equal(found.total,1);assert.equal(found.items[0].id,document.id);assert.equal(found.items[0].version,2);
   assert.equal((await req('/documents/search?status=ANNULLED',b)).body.total,0);
   assert.ok((await req('/documents',a)).body.some(d=>d.id===document.id&&d.status==='ANNULLED'));
  });
  await t.test('different concurrent reasons cannot overwrite an annulment; invoice retry cannot revive it',async()=>{
   const current=(await req('/orders/'+order.id,a)).body,payload=input(current);
   const issued=(await invoice(a,current,payload)).body;
   const results=await Promise.all(['First reason','Second reason'].map(reason=>annul(a,issued.id,annulInput({reason}))));
   assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
   const retried=await invoice(a,current,payload);assert.equal(retried.status,201);assert.equal(retried.body.status,'ANNULLED');
   assert.equal(retried.body.annulmentReason,results.find(r=>r.status===201).body.annulmentReason);
   assert.equal(await db.auditEvent.count({where:{organizationId:a.id,action:'DOCUMENT_ANNULLED',metadata:{path:['documentId'],equals:issued.id}}}),1);
  });
  await t.test('acts use the same lifecycle without changing a completed order',async()=>{
   const completed=await createOrder(a,client.id);
   await db.order.update({where:{id:completed.id},data:{status:'COMPLETED'}});
   const act=await req('/orders/'+completed.id+'/documents',{...a,method:'POST',body:{}});
   assert.equal(act.status,201);assert.equal(act.body.kind,'ACT_DRAFT');
   const result=await annul(a,act.body.id,annulInput());
   assert.equal(result.status,201);assert.deepEqual(result.body.snapshot,act.body.snapshot);
   assert.equal((await req('/orders/'+completed.id,a)).body.status,'COMPLETED');
  });

  await t.test('audit failure rolls back annulment and service rejects a stale disabled owner',async()=>{
   const {AnnulmentService}=await import('../backend/dist/modules/documents/annulment.service.js');
   const owner=await db.user.findFirstOrThrow({where:{organizationId:a.id,role:'OWNER'}});
   const target=await db.document.findFirstOrThrow({where:{organizationId:a.id,status:'DRAFT'}});
   const service=new AnnulmentService({client:db},{record:()=>{throw new Error('simulated audit outage');}});
   await assert.rejects(service.annul(a.id,target.id,annulInput(),owner),/simulated audit outage/);
   assert.deepEqual(await db.document.findUniqueOrThrow({where:{id:target.id}}),target);
   await db.user.update({where:{id:owner.id},data:{isActive:false}});
   try{await assert.rejects(service.annul(a.id,target.id,annulInput(),owner),e=>e.getStatus()===403);}
   finally{await db.user.update({where:{id:owner.id},data:{isActive:true}});}
  });
 }finally{
  await server.stop();
  for(const organizationId of orgs){
   await db.document.deleteMany({where:{organizationId}});await db.payment.deleteMany({where:{organizationId}});
   await db.orderItem.deleteMany({where:{order:{organizationId}}});await db.order.deleteMany({where:{organizationId}});
   await db.client.deleteMany({where:{organizationId}});await db.user.deleteMany({where:{organizationId}});
   await db.organization.deleteMany({where:{id:organizationId}});
  }await db.$disconnect();
 }
});
