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

async function fixture(extra={}){
 const a=await tenant();
 const client=await db.client.create({data:{organizationId:a.id,name:'Financial QA client'}});
 const order=await db.order.create({data:{organizationId:a.id,clientId:client.id,number:1,title:'Adjustment QA order',total:'100.25',...extra}});
 const payment=await db.payment.create({data:{organizationId:a.id,orderId:order.id,amount:'100.25',note:'Original payment',idempotencyKey:randomUUID()}});
 const expense=await db.expense.create({data:{organizationId:a.id,orderId:order.id,amount:'10.11',category:'RENT',description:'Original expense',idempotencyKey:randomUUID()}});
 return {...a,order,payment,expense,client};
}
const refund=(a,payment,amount='10.10',extra={})=>req('/finance/payments/'+payment.id+'/refunds',{...a,method:'POST',body:{amount,reason:'Customer return <script>literal</script>',idempotencyKey:randomUUID(),...extra}});
const reverse=(a,expense,extra={})=>req('/finance/expenses/'+expense.id+'/reversal',{...a,method:'POST',body:{reason:'Incorrect expense entry',idempotencyKey:randomUUID(),...extra}});
const stage=(a,status)=>req('/orders/'+a.order.id+'/status',{...a,method:'PATCH',body:{status}});
const pay=(a,amount)=>req('/orders/'+a.order.id+'/payments',{...a,method:'POST',body:{amount,idempotencyKey:randomUUID(),note:'Replacement payment'}});
async function order(a){return (await req('/orders/'+a.order.id,a)).body;}

test('refunds and expense reversals preserve financial invariants',async t=>{
 const server=await isolatedApi();base=server.endpoint;
 try{
 const a=await fixture(),b=await fixture();let firstKey;
 await t.test('owner, tenant, Origin and strict input boundaries',async()=>{
  for(const [actor,status]of [[{},401],[{cookie:a.worker},403],[b,404]]){
   assert.equal((await refund(actor,a.payment)).status,status);assert.equal((await reverse(actor,a.expense)).status,status);
   assert.equal((await req('/finance/payments/'+a.payment.id,actor)).status,status);assert.equal((await req('/finance/expenses/'+a.expense.id,actor)).status,status);
  }
  assert.equal((await refund({...a,source:'https://evil.invalid'},a.payment)).status,403);
  for(const amount of ['0','-1','1.001','1e2','9999999999999'])assert.equal((await refund(a,a.payment,amount)).status,400);
  for(const extra of [{reason:'ab'},{reason:'bad\u0000text'},{reason:'bad\ud800'},{reason:'x'.repeat(501)},{organizationId:b.id},{actorId:b.owner.id},{createdAt:'2020-01-01'}])assert.equal((await refund(a,a.payment,'1',extra)).status,400);
  assert.equal((await reverse(a,a.expense,{amount:'1'})).status,400);
  assert.equal((await refund(a,a.payment,'100.26')).status,409);
  assert.equal((await stage(a,'CANCELLED')).status,409);
 });
 await t.test('parallel duplicate refund is one entry; stale key remains safe after later refunds',async()=>{
  firstKey=randomUUID();const results=await Promise.all([1,2,3].map(()=>refund(a,a.payment,'10.10',{idempotencyKey:firstKey})));
  assert.deepEqual(results.map(r=>r.status),[201,201,201]);assert.equal(new Set(results.map(r=>r.body.id)).size,1);
  assert.equal(await db.paymentRefund.count({where:{organizationId:a.id}}),1);assert.equal((await order(a)).version,2);
  assert.equal((await refund(a,a.payment,'10.11',{idempotencyKey:firstKey})).status,409);
  assert.equal('organizationId' in results[0].body,false);assert.equal('idempotencyKey' in results[0].body,false);
  const race=await Promise.all([1,2].map(()=>refund(a,a.payment,'60.00')));assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
  assert.equal((await req('/finance/payments/'+a.payment.id,a)).body.remaining,'30.15');
  const repeated=await refund(a,{id:a.payment.id.toUpperCase()},'10.1',{idempotencyKey:firstKey.toUpperCase()});assert.equal(repeated.status,201);assert.equal(repeated.body.id,results[0].body.id);
  assert.equal((await order(a)).paid,'30.15');assert.equal((await order(a)).debt,'70.10');assert.equal((await order(a)).version,3);
  assert.deepEqual(await db.payment.findUnique({where:{id:a.payment.id}}),a.payment);
  const dashboard=(await req('/dashboard',a)).body;assert.equal(dashboard.received,'30.15');assert.equal(dashboard.outstanding,'70.10');assert.equal(dashboard.cashFlow,'20.04');
  const list=(await req('/movements/search',a)).body;assert.deepEqual(list.summary,{received:'30.15',expenses:'10.11',cashFlow:'20.04'});assert.equal(list.items.filter(r=>r.kind==='REFUND').length,2);
  assert.ok(list.items.filter(r=>r.kind==='REFUND').every(r=>r.sourceId===a.payment.id));
  assert.equal((await req('/movements',a)).body.filter(r=>r.kind==='REFUND').length,2);
  const events=(await req('/audit?entityType=ORDER&entityId='+a.order.id,a)).body.items;assert.equal(events.filter(e=>e.action==='PAYMENT_REFUNDED').length,2);assert.ok(!JSON.stringify(events).includes('<script>'));
 });
 await t.test('refunds reopen payable balance; cancellation requires complete net refund',async()=>{
  assert.equal((await pay(a,'70.11')).status,409);
  const replacement=await pay(a,'70.10');assert.equal(replacement.status,201);assert.equal((await order(a)).paid,'100.25');
  assert.equal((await refund(a,a.payment,'30.15')).status,201);assert.equal((await stage(a,'CANCELLED')).status,409);
  assert.equal((await refund(a,replacement.body,'70.10')).status,201);
  assert.equal((await stage(a,'CANCELLED')).status,200);assert.equal((await order(a)).debt,'0.00');
  assert.equal((await req('/dashboard',a)).body.outstanding,'0.00');assert.equal((await pay(a,'1.00')).status,409);
  assert.equal((await refund(a,a.payment,'0.01')).status,409);
 });
 await t.test('expense reversal is full, once only, retryable and linked; replacement is a new entry',async()=>{
  const keys=[randomUUID(),randomUUID()];const results=await Promise.all(keys.map(idempotencyKey=>reverse(b,b.expense,{idempotencyKey})));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const index=results.findIndex(r=>r.status===201);
  assert.equal((await reverse(b,b.expense,{idempotencyKey:keys[index]})).body.id,results[index].body.id);
  assert.equal((await reverse(b,b.expense,{idempotencyKey:keys[index],reason:'Different reason'})).status,409);
  assert.equal((await req('/finance/expenses/'+b.expense.id,b)).body.remaining,'0.00');
  assert.deepEqual(await db.expense.findUnique({where:{id:b.expense.id}}),b.expense);
  assert.equal((await req('/movements/search?category=RENT',b)).body.summary.expenses,'0.00');
  assert.equal((await req('/movements/search?kind=EXPENSE_REVERSAL',b)).body.summary.cashFlow,'10.11');
  const added=await req('/expenses',{...b,method:'POST',body:{amount:'7.77',description:'Correct expense',category:'RENT',orderId:b.order.id,idempotencyKey:randomUUID()}});assert.equal(added.status,201);
  assert.equal((await req('/dashboard',b)).body.expenses,'7.77');assert.equal((await req('/movements/search',b)).body.summary.expenses,'7.77');
 });
 await t.test('invoice snapshot uses net paid, rejects stale order version and remains immutable',async()=>{
  const c=await fixture({total:'200.50'});
  await db.organization.update({where:{id:c.id},data:{businessId:'123456789012',address:'Almaty QA',bankName:'Test bank',iban:'KZ861250000000000001',bic:'TESTKZKX'}});
  const invoice=()=>req('/orders/'+c.order.id+'/invoices',{...c,method:'POST',body:{orderVersion:1,idempotencyKey:randomUUID()}});
  const before=await invoice();assert.equal(before.status,201);assert.equal(before.body.snapshot.invoice.amountDue,'100.25');
  assert.equal((await refund(c,c.payment,'0.01')).status,201);assert.equal((await invoice()).status,409);
  const after=await req('/orders/'+c.order.id+'/invoices',{...c,method:'POST',body:{orderVersion:2,idempotencyKey:randomUUID()}});assert.equal(after.status,201);assert.equal(after.body.snapshot.invoice.amountDue,'100.26');assert.equal(after.body.snapshot.invoice.paid,'100.24');
  assert.deepEqual((await req('/documents/'+before.body.id,c)).body.snapshot,before.body.snapshot);
 });
 await t.test('financial correction dates do not rewrite original periods and negative months are retained',async()=>{
  const c=await fixture();await db.payment.update({where:{id:c.payment.id},data:{createdAt:new Date('2020-01-01T12:00:00Z')}});await db.expense.update({where:{id:c.expense.id},data:{createdAt:new Date('2020-01-01T12:00:00Z')}});
  assert.equal((await refund(c,c.payment,'0.01')).status,201);assert.equal((await reverse(c,c.expense)).status,201);
  const old=(await req('/movements/search?from=2020-01-01&to=2020-01-01',c)).body;assert.deepEqual(old.summary,{received:'100.25',expenses:'10.11',cashFlow:'90.14'});
  const last=(await req('/dashboard',c)).body.monthly.at(-1);assert.equal(last.income,'-0.01');assert.equal(last.expense,'-10.11');
  assert.equal((await req('/movements/search?kind=REFUND&category=ORDER_REFUND',c)).body.summary.received,'-0.01');
  assert.equal((await req('/movements/search?q='+encodeURIComponent('<script>'),c)).body.total,1);
  assert.equal((await req('/movements/search?q=%25',c)).body.total,0);
 });
 await t.test('refund racing a new payment or cancellation preserves order balance',async()=>{
  const c=await fixture();
  const raced=await Promise.all([refund(c,c.payment,'40.25'),pay(c,'40.25')]);assert.equal(raced[0].status,201);assert.ok([201,409].includes(raced[1].status));
  const current=await order(c);assert.equal(current.paid,raced[1].status===201?'100.25':'60.00');
  const cancel=await Promise.all([refund(c,c.payment,'60.00'),stage(c,'CANCELLED')]);assert.equal(cancel[0].status,201);
  if(raced[1].status===201){assert.equal(cancel[1].status,409);assert.equal((await order(c)).paid,'40.25');}
  else {assert.ok([200,409].includes(cancel[1].status));assert.equal((await stage(c,'CANCELLED')).status,200);assert.equal((await order(c)).paid,'0.00');}
 });
 await t.test('large original amounts and single tiyn refunds remain exact',async()=>{
  const c=await fixture({total:'90071992547409.99'});
  await db.payment.update({where:{id:c.payment.id},data:{amount:'90071992547409.99'}});
  await db.expense.update({where:{id:c.expense.id},data:{amount:'90071992547409.99'}});
  assert.equal((await refund(c,c.payment,'0.01')).status,201);assert.equal((await reverse(c,c.expense)).status,201);
  const current=await order(c);assert.equal(current.paid,'90071992547409.98');assert.equal(current.debt,'0.01');
  assert.equal((await req('/finance/payments/'+c.payment.id,c)).body.remaining,'90071992547409.98');
  const summary=(await req('/movements/search',c)).body.summary;assert.deepEqual(summary,{received:'90071992547409.98',expenses:'0.00',cashFlow:'90071992547409.98'});
  assert.equal((await req('/dashboard',c)).body.cashFlow,summary.cashFlow);
 });
 await t.test('audit failure rolls back money, version and reversal; disabled owners and foreign links fail',async()=>{
  const c=await fixture();const {FinanceService}=await import('../backend/dist/modules/finance/finance.service.js');
  const service=new FinanceService({client:db},{record:()=>{throw Error('audit outage');}});
  await assert.rejects(service.refund(c.owner,c.payment.id,{amount:'1.00',reason:'Failure QA',idempotencyKey:randomUUID()}),/audit outage/);
  await assert.rejects(service.reverse(c.owner,c.expense.id,{reason:'Failure QA',idempotencyKey:randomUUID()}),/audit outage/);
  assert.equal(await db.paymentRefund.count({where:{organizationId:c.id}}),0);assert.equal(await db.expenseReversal.count({where:{organizationId:c.id}}),0);assert.equal((await order(c)).version,1);
  await db.user.update({where:{id:c.owner.id},data:{isActive:false}});
  await assert.rejects(service.refund(c.owner,c.payment.id,{amount:'1',reason:'Disabled QA',idempotencyKey:randomUUID()}),e=>e.getStatus()===403);
  const common={organizationId:b.id,amount:'1',reason:'Foreign QA',actorId:b.owner.id,actorName:'QA',idempotencyKey:randomUUID()};
  await assert.rejects(db.paymentRefund.create({data:{...common,paymentId:c.payment.id}}));await assert.rejects(db.expenseReversal.create({data:{...common,expenseId:c.expense.id}}));
 });
 }finally{
  await server.stop();
  for(const organizationId of orgs){
   await db.document.deleteMany({where:{organizationId}});await db.payment.deleteMany({where:{organizationId}});await db.expense.deleteMany({where:{organizationId}});
   await db.order.deleteMany({where:{organizationId}});await db.client.deleteMany({where:{organizationId}});await db.user.deleteMany({where:{organizationId}});await db.organization.deleteMany({where:{id:organizationId}});
  }await db.$disconnect();
 }
});
