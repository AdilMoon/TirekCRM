import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {clientOverviewQuerySchema} from '@tirek/contracts';
import {ClientOverviewService} from '../backend/dist/modules/crm/client-overview.service.js';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL}),log:[{emit:'event',level:'query'}]});
let queries=0;db.$on('query',()=>queries++);
test('client overview reconciles full-client totals, scopes, refunds, overpayment, paging and a concurrent write',async()=>{
 const org=randomUUID(),outside=randomUUID(),where={organizationId:{in:[org,outside]}};
 try{
  await db.organization.createMany({data:[{id:org,name:'Client overview QA'},{id:outside,name:'Outside client overview QA'}]});
  const client=await db.client.create({data:{organizationId:org,name:'Client <script>'}});
  const unrelated=await db.client.create({data:{organizationId:org,name:'Other buyer'}});
  const foreign=await db.client.create({data:{organizationId:outside,name:client.name}});
  const ids=Array.from({length:108},()=>randomUUID());
  await db.order.createMany({data:ids.map((id,i)=>({id,organizationId:org,clientId:client.id,number:i+1,title:'Client order '+i,status:'IN_PROGRESS',total:i<105?'100.01':'9999999999999999.99'}))});
  await db.order.createMany({data:[{organizationId:org,clientId:unrelated.id,number:200,title:'Unrelated',total:'111111'},{organizationId:outside,clientId:foreign.id,number:1,title:'Foreign',total:'222222'}]});
  await db.order.update({where:{id:ids[0]},data:{status:'CANCELLED'}});
  await db.order.update({where:{id:ids[3]},data:{total:'0',repeatOfId:ids[1],repeatKey:randomUUID()}});
  await db.order.update({where:{id:ids[4]},data:{status:'COMPLETED'}});
  await db.payment.create({data:{organizationId:org,orderId:ids[1],amount:'100.01',idempotencyKey:randomUUID()}});
  const payment=await db.payment.create({data:{organizationId:org,orderId:ids[2],amount:'40.01',idempotencyKey:randomUUID()}});
  await db.payment.create({data:{organizationId:org,orderId:ids[2],amount:'10.01',idempotencyKey:randomUUID()}});
  await db.paymentRefund.createMany({data:['10.02','0.01'].map(amount=>({organizationId:org,paymentId:payment.id,amount,reason:'Overview refund QA',actorId:randomUUID(),actorName:'QA',idempotencyKey:randomUUID()}))});
  await db.payment.create({data:{organizationId:org,orderId:ids[5],amount:'100.02',idempotencyKey:randomUUID()}});
  const service=new ClientOverviewService({client:db});
  const read=(input={})=>service.overview(org,client.id,clientOverviewQuerySchema.parse(input));
  queries=0;const all=await read();assert.ok(queries<=6,'Bounded batch reads, regardless of order count');
  assert.equal(all.total,108);assert.equal(all.items.length,20);assert.equal(all.client.ordersCount,108);
  assert.deepEqual(all.summary,{orders:108,active:106,completed:1,total:'30000000000010301.00',paid:'240.02',outstanding:'30000000000010060.99'});
  const onlyDue=await read({unpaid:'true',pageSize:100});assert.equal(onlyDue.total,104);assert.deepEqual(onlyDue.summary,all.summary);
  assert.equal((await read({page:6})).items.length,8);assert.equal((await read({page:99})).items.length,0);
  const complete=await read({status:'COMPLETED'});assert.equal(complete.total,1);assert.equal(complete.items[0].id,ids[4]);assert.deepEqual(complete.summary,all.summary);
  const partial=(await read({q:'3',pageSize:100})).items.find(row=>row.id===ids[2]);assert.equal(partial.paid,'39.99');assert.equal(partial.balance,'60.02');
  for(const q of ["x\' OR 1=1 --",'%','No match']){const empty=await read({q});assert.equal(empty.total,0);assert.deepEqual(empty.summary,all.summary);}
  await assert.rejects(()=>service.overview(org,foreign.id,clientOverviewQuerySchema.parse({})),e=>e.getStatus()===404);
  await assert.rejects(()=>service.overview(outside,client.id,clientOverviewQuerySchema.parse({})),e=>e.getStatus()===404);
  const emptyClient=await db.client.create({data:{organizationId:org,name:'Empty client'}});
  const empty=await service.overview(org,emptyClient.id,clientOverviewQuerySchema.parse({}));assert.equal(empty.total,0);assert.equal(empty.summary.outstanding,'0.00');assert.equal(empty.client.ordersCount,0);
  for(const input of [{unpaid:'false'},{status:'OWNER'},{organizationId:outside},{page:-1},{q:'bad\0query'}])assert.equal(clientOverviewQuerySchema.safeParse(input).success,false);
  // Write after the first read, before the aggregate. Both response sections must
  // retain the same snapshot, rather than combining the old contact with new totals.
  const concurrent=new ClientOverviewService({client:{$transaction:(operation,options)=>db.$transaction(async tx=>operation({
   client:{findFirst:async args=>{const value=await tx.client.findFirst(args);
    await db.client.update({where:{id:client.id},data:{name:'Changed concurrently'}});
    await db.order.create({data:{organizationId:org,clientId:client.id,number:109,title:'Concurrent new order',total:'1'}});return value;}},
   $queryRaw:(...args)=>tx.$queryRaw(...args),
  }),options)}});
  const snapshot=await concurrent.overview(org,client.id,clientOverviewQuerySchema.parse({}));
  assert.equal(snapshot.client.name,client.name);assert.deepEqual(snapshot.summary,all.summary);
  const current=await read();assert.equal(current.client.name,'Changed concurrently');assert.equal(current.summary.orders,109);
 }finally{
  await db.paymentRefund.deleteMany({where});await db.payment.deleteMany({where});await db.order.deleteMany({where:{...where,repeatOfId:{not:null}}});
  await db.order.deleteMany({where});await db.client.deleteMany({where});await db.organization.deleteMany({where:{id:{in:[org,outside]}}});await db.$disconnect();
 }
});
