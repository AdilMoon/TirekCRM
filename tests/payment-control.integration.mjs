import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {PaymentControlService} from '../backend/dist/modules/reports/payment-control.service.js';
import {paymentControlQuerySchema} from '@tirek/contracts';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL}),log:[{emit:'event',level:'query'}]});
let queries=0;db.$on('query',()=>queries++);
test('payment control reconciles orders, refunds, invoice precedence, money, paging and organization scope',async()=>{
 const org=randomUUID(),outside=randomUUID(),where={organizationId:{in:[org,outside]}};
 try{
  await db.organization.createMany({data:[{id:org,name:'Control QA'},{id:outside,name:'Outside QA'}]});
  const client=await db.client.create({data:{organizationId:org,name:'Buyer <script>',company:'Control company'}});
  const ids=Array.from({length:110},()=>randomUUID());
  await db.order.createMany({data:ids.map((id,i)=>({id,organizationId:org,clientId:client.id,number:i+1,title:'Control '+i,total:'9999999999999999.99',status:'IN_PROGRESS'}))});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let seq=0;
  async function invoice(index,dueDate,status='DRAFT',kind='INVOICE_DRAFT'){
   seq++;
   return db.document.create({data:{organizationId:org,orderId:ids[index],number:seq,kind,status,
    // Equal timestamps intentionally exercise the monotonic document-number tie-break.
    createdAt:new Date('2025-01-01T00:00:00Z'),snapshot:{invoice:{dueDate},total:'1'},
    ...(status==='ANNULLED'?{version:2,annulledAt:new Date(),annulledById:randomUUID(),annulledByName:'QA',annulmentReason:'QA annulment',annulmentKey:randomUUID()}:{} )}});
  }
  await invoice(0,'2020-01-01');await invoice(0,'2099-01-01');
  await invoice(1,'2020-01-01');await invoice(1,today);
  await invoice(2,'2020-01-01');await invoice(2,null);
  await invoice(3,'2020-01-01');await invoice(3,'2099-01-01','ANNULLED');
  await invoice(4,'2020-01-01');await invoice(4,null,'DRAFT','ACT_DRAFT');
  await db.order.update({where:{id:ids[5]},data:{status:'CANCELLED'}});
  await db.order.update({where:{id:ids[6]},data:{total:'0',repeatOfId:ids[0],repeatKey:randomUUID()}});
  await db.order.update({where:{id:ids[7]},data:{total:'100.01',dueDate:new Date('2020-01-01')}});
  await db.order.update({where:{id:ids[8]},data:{total:'100.01'}});
  const paid=await db.payment.create({data:{organizationId:org,orderId:ids[7],amount:'100.01',idempotencyKey:randomUUID()}});
  await db.paymentRefund.createMany({data:['10.01','0.02'].map(amount=>({organizationId:org,paymentId:paid.id,amount,reason:'QA refund',actorId:randomUUID(),actorName:'QA',idempotencyKey:randomUUID()}))});
  await db.payment.create({data:{organizationId:org,orderId:ids[7],amount:'0.01',idempotencyKey:randomUUID()}});
  await db.payment.create({data:{organizationId:org,orderId:ids[8],amount:'100.01',idempotencyKey:randomUUID()}});
  const service=new PaymentControlService({client:db});
  const list=(input={})=>service.list(org,paymentControlQuerySchema.parse(input));
  queries=0;
  const all=await list();assert.equal(queries,1);assert.equal(all.total,107);assert.equal(all.items.length,20);
  assert.equal(all.today,today);assert.equal(all.summary.balance,'1060000000000000008.96');
  assert.equal(all.summary.overdue,'9999999999999999.99');assert.equal(all.summary.scheduled,'19999999999999999.98');
  assert.equal(all.items[0].id,ids[4]);assert.equal(all.items[0].invoiceNumber,9);
  const single=async number=>(await list({q:String(number),pageSize:100})).items.find(row=>row.id===ids[number-1]);
  assert.equal((await single(2)).state,'SCHEDULED','Today is not past due');
  assert.equal((await single(3)).state,'NO_DUE');assert.equal((await single(4)).invoiceId,null);
  assert.equal((await single(8)).balance,'10.02');assert.equal((await single(8)).state,'NO_DUE','Work deadline is not a payment deadline');
  assert.equal((await list({state:'OVERDUE'})).total,1);
  assert.equal((await list({q:'Control company'})).total,107);
  assert.equal((await list({page:6})).items.length,7);
  const empty=await list({page:99});assert.equal(empty.items.length,0);assert.deepEqual(empty.summary,all.summary);
  assert.equal((await service.list(outside,paymentControlQuerySchema.parse({}))).total,0);
  assert.equal((await list({q:"x' OR 1=1 --"})).total,0);
  assert.equal((await list({q:'%'})).total,0);
  for(const input of [{state:'PAID'},{page:-1},{pageSize:1000},{organizationId:outside}])assert.equal(paymentControlQuerySchema.safeParse(input).success,false);
  await db.paymentRefund.deleteMany({where});assert.equal((await list({q:'8',pageSize:100})).items.some(row=>row.id===ids[7]),false,'Cleared refund closes reopened balance');
 }finally{
  await db.paymentRefund.deleteMany({where});await db.payment.deleteMany({where});await db.document.deleteMany({where});
  await db.order.deleteMany({where:{...where,repeatOfId:{not:null}}});await db.order.deleteMany({where});await db.client.deleteMany({where});await db.organization.deleteMany({where:{id:{in:[org,outside]}}});await db.$disconnect();
 }
});
