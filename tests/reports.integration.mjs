import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:3})});
const base=process.env.TEST_API_URL??'http://127.0.0.1:4000/api',ids=[];
async function request(path,cookie){
 const r=await fetch(base+path,{headers:cookie?{Cookie:cookie}:{}});
 return {status:r.status,body:await r.json()};
}
async function tenant(){
 const id=randomUUID();ids.push(id);
 const org=await db.organization.create({data:{id,name:'Reports test',users:{create:{name:'Owner',role:'OWNER',email:id+'@reports.invalid',passwordHash:'unused'}}},include:{users:true}});
 return {id,user:org.users[0],cookie:await session(org.users[0].id)};
}
async function session(userId){
 const token=randomBytes(32).toString('hex');
 await db.session.create({data:{userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 return 'tirek_session='+token;
}
test('Financial and document reports: full data, exact totals and access boundaries',async t=>{
 try {
 const a=await tenant(),b=await tenant();
 const employee=await db.user.create({data:{organizationId:a.id,name:'Worker',role:'EMPLOYEE',email:randomUUID()+'@reports.invalid',passwordHash:'unused'}});
 const employeeCookie=await session(employee.id);
 const client=await db.client.create({data:{organizationId:a.id,name:'Archived Customer',company:'Historical Company'}});
 const order=await db.order.create({data:{organizationId:a.id,clientId:client.id,number:731,title:'Archive order',total:'1000000.00'}});
 const createdAt=new Date('2020-01-01T12:00:00Z'),sharedId=randomUUID();
 await db.payment.createMany({data:Array.from({length:205},(_,i)=>({id:i===0?sharedId:randomUUID(),organizationId:a.id,orderId:order.id,amount:'0.10',note:'Archive receipt '+i,createdAt,idempotencyKey:randomUUID()}))});
 await db.expense.createMany({data:Array.from({length:206},(_,i)=>({id:i===0?sharedId:randomUUID(),organizationId:a.id,orderId:i===0?order.id:null,amount:'0.03',description:'Archive expense '+i,category:i===0?'RENT':'MATERIALS',createdAt,idempotencyKey:randomUUID()}))});
 await db.expense.create({data:{organizationId:b.id,amount:'9999.00',description:'Private B archive',category:'OTHER',idempotencyKey:randomUUID()}});
 await db.document.createMany({data:Array.from({length:205},(_,i)=>({organizationId:a.id,orderId:order.id,number:i+1,createdAt,snapshot:{organization:{name:'Reports test',address:'',businessId:''},client:{name:'Archived Customer',phone:'',email:'',company:'Historical Company',address:''},orderNumber:731,title:'Snapshot service',total:'100.00',items:[{description:'Service',quantity:1,unitPrice:'100.00',total:'100.00'}]}}))});
 await t.test('paginates the union without missing duplicates across source tables',async()=>{
  let items=[],summary;
  for(let page=1;page<=5;page++){
   const r=await request('/movements/search?q=Archive&pageSize=100&page='+page,a.cookie);
   assert.equal(r.status,200);assert.equal(r.body.total,411);assert.equal(r.body.pages,5);
   for(const item of r.body.items)assert.deepEqual(Object.keys(item).sort(),['id','kind','amount','description','category','sourceId','orderId','orderNumber','createdAt'].sort());
   assert.deepEqual(r.body.summary,{received:'20.50',expenses:'6.18',cashFlow:'14.32'});
   items.push(...r.body.items);summary=r.body.summary;
  }
  assert.equal(items.length,411);assert.equal(new Set(items.map(x=>x.kind+':'+x.id)).size,411);
  assert.equal(items.filter(x=>x.id===sharedId).length,2);
  const empty=await request('/movements/search?q=Archive&page=99',a.cookie);assert.equal(empty.body.items.length,0);assert.deepEqual(empty.body.summary,summary);
  const first=await request('/movements/search?q=Archive&pageSize=100',a.cookie);
  assert.deepEqual(first.body.items.map(x=>x.kind+':'+x.id),items.slice(0,100).map(x=>x.kind+':'+x.id));
 });
 await t.test('applies kind, category and order filters to both rows and totals',async()=>{
  const income=await request('/movements/search?kind=INCOME',a.cookie);assert.equal(income.body.total,205);assert.deepEqual(income.body.summary,{received:'20.50',expenses:'0.00',cashFlow:'20.50'});
  const rent=await request('/movements/search?category=RENT',a.cookie);assert.equal(rent.body.total,1);assert.equal(rent.body.summary.cashFlow,'-0.03');
  const linked=await request('/movements/search?orderId='+order.id,a.cookie);assert.equal(linked.body.total,206);
  assert.equal((await request('/movements/search?q=731',a.cookie)).body.total,206);
  assert.equal((await request('/movements/search?q=Archived%20Customer',a.cookie)).body.total,206);
  assert.equal((await request('/movements/search?kind=INCOME&category=RENT',a.cookie)).body.total,0);
  const none=await request('/movements/search?q=does-not-exist',a.cookie);assert.deepEqual(none.body.summary,{received:'0.00',expenses:'0.00',cashFlow:'0.00'});
 });
 await t.test('uses exact inclusive Almaty days and historical timezone offsets',async()=>{
  for(const [index,at] of ['2026-10-07T18:59:59.999Z','2026-10-07T19:00:00.000Z','2026-10-08T18:59:59.999Z','2026-10-08T19:00:00.000Z'].entries()){
   await db.payment.create({data:{organizationId:a.id,orderId:order.id,amount:'0.01',note:'Time edge '+index,createdAt:new Date(at),idempotencyKey:randomUUID()}});
  }
  const r=await request('/movements/search?from=2026-10-08&to=2026-10-08',a.cookie);
  assert.equal(r.body.total,2);assert.deepEqual(r.body.items.map(x=>x.description),['Time edge 2','Time edge 1']);assert.equal(r.body.summary.received,'0.02');
  await db.payment.createMany({data:['2019-12-31T17:59:59.999Z','2019-12-31T18:00:00.000Z'].map(at=>({organizationId:a.id,orderId:order.id,amount:'0.02',note:'Historical edge',createdAt:new Date(at),idempotencyKey:randomUUID()}))});
  const historic=await request('/movements/search?q=Historical%20edge&from=2020-01-01&to=2020-01-01',a.cookie);assert.equal(historic.body.total,1);
  assert.equal((await request('/documents/search?from=2020-01-01&to=2020-01-01',a.cookie)).body.total,205);
  assert.equal((await request('/documents/search?to=2019-12-31',a.cookie)).body.total,0);
 });
 await t.test('keeps document search tied to snapshots after client and order edits',async()=>{
  await db.client.update({where:{id:client.id},data:{name:'Renamed live client',company:'Renamed company'}});
  await db.order.update({where:{id:order.id},data:{title:'Renamed live order'}});
  for(const q of ['Archived Customer','historical company','Snapshot service','731']){
   const r=await request('/documents/search?q='+encodeURIComponent(q)+'&page=3&pageSize=100',a.cookie);assert.equal(r.status,200);assert.equal(r.body.total,205);assert.equal(r.body.items.length,5);
  }
  assert.equal((await request('/documents/search?q=Renamed',a.cookie)).body.total,0);
  const single=await request('/documents/search?q=205',a.cookie);assert.equal(single.body.total,1);assert.equal(single.body.items[0].number,205);
  const dashboard=await request('/dashboard',a.cookie);assert.equal(dashboard.body.documentsCount,205);
 });
 await t.test('rejects employee access, tenant tampering and malformed queries',async()=>{
  for(const path of ['/movements/search','/documents/search']){
   assert.equal((await request(path)).status,401);assert.equal((await request(path,employeeCookie)).status,403);
   const foreign=await request(path+'?orderId='+order.id,b.cookie);assert.equal(foreign.body.total,0);
   for(const query of ['page=0','pageSize=101','q=%00','from=0000-01-01','from=2026-02-30','to=not-a-date','from=2026-10-09&to=2026-10-08','orderId=nope','organizationId='+a.id,'page=1&page=2']){
    assert.equal((await request(path+'?'+query,a.cookie)).status,400,query);
   }
   for(const q of ["' OR 1=1 --",'%','_',String(10n**50n)]){
    const r=await request(path+'?q='+encodeURIComponent(q),a.cookie);assert.equal(r.status,200);assert.equal(r.body.total,0);
   }
   assert.equal((await request(path+'?q='+encodeURIComponent('a'.repeat(201)),a.cookie)).status,400);
  }
  assert.equal((await request('/movements/search?category=UNKNOWN',a.cookie)).status,400);
  assert.equal((await request('/movements/search?kind=OWNER',a.cookie)).status,400);
  const other=await request('/movements/search',b.cookie);assert.equal(other.body.total,1);assert.equal(other.body.summary.expenses,'9999.00');
  assert.equal((await request('/documents/search',b.cookie)).body.total,0);
 });
 await t.test('sums NUMERIC values without losing fractional tiyn at large totals',async()=>{
  await db.expense.createMany({data:[1,2].map(()=>({organizationId:a.id,amount:'90071992547409.91',description:'Large precision',category:'OTHER',idempotencyKey:randomUUID()}))});
  const r=await request('/movements/search?q=Large%20precision',a.cookie);assert.equal(r.body.summary.expenses,'180143985094819.82');assert.equal(r.body.summary.cashFlow,'-180143985094819.82');
 });
 }finally{
  for(const organizationId of ids){
   await db.document.deleteMany({where:{organizationId}});await db.payment.deleteMany({where:{organizationId}});await db.expense.deleteMany({where:{organizationId}});await db.order.deleteMany({where:{organizationId}});await db.client.deleteMany({where:{organizationId}});await db.user.deleteMany({where:{organizationId}});await db.organization.deleteMany({where:{id:organizationId}});
  }await db.$disconnect();
 }
});
