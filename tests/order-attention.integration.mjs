import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {OrderAttentionService} from '../backend/dist/modules/work-time/order-attention.service.js';
import {OrderProfitabilityService} from '../backend/dist/modules/work-time/order-profitability.service.js';
import {AuditService} from '../backend/dist/modules/audit/audit.service.js';

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL}),log:[{emit:'event',level:'query'}]});
let queries=0;db.$on('query',()=>queries++);
test('attention batches a full workload and reconciles exact costs, scope, filters and visit targets',async()=>{
  const org=randomUUID(),outside=randomUUID(),scope={organizationId:{in:[org,outside]}};
  try{
    await db.organization.createMany({data:[{id:org,name:'Attention QA'},{id:outside,name:'Outside QA'}]});
    const owner=await db.user.create({data:{organizationId:org,role:'OWNER',name:'Owner QA',email:randomUUID()+'@attention.invalid',passwordHash:'unused'}});
    const employee=await db.user.create({data:{organizationId:org,role:'EMPLOYEE',name:'Worker QA',email:randomUUID()+'@attention.invalid',passwordHash:'unused'}});
    const other=await db.user.create({data:{organizationId:outside,role:'OWNER',name:'Outside',email:randomUUID()+'@attention.invalid',passwordHash:'unused'}});
    const client=await db.client.create({data:{organizationId:org,name:'Attention client',company:'Company QA'}});
    const ids=Array.from({length:105},()=>randomUUID());
    await db.order.createMany({data:ids.map((id,index)=>({id,organizationId:org,clientId:client.id,number:index+1,
      title:'Attention '+(index+1),status:'IN_PROGRESS',total:'1000',plannedMinutes:60,plannedHourlyRate:'0',
      plannedDirectExpenses:'0',actualHourlyRate:'0'}))});
    await db.expenseReceipt.createMany({data:[...ids.slice(0,25),ids[0]].map(orderId=>({
      organizationId:org,orderId,employeeId:employee.id,sourceKey:randomUUID(),amount:'5',description:'Receipt QA',
      image:new Uint8Array([0]),imageHash:randomUUID().replaceAll('-','').repeat(2),
    }))});
    await db.expense.createMany({data:[
      {organizationId:org,orderId:ids[0],amount:'2000',category:'OTHER',description:'Cost QA',idempotencyKey:randomUUID()},
      ...Array.from({length:10},()=>({organizationId:org,orderId:ids[31],amount:'9999999999999999.99',category:'OTHER',description:'Large historical cost',idempotencyKey:randomUUID()})),
    ]});
    await db.order.updateMany({where:{id:{in:[ids[2],ids[25],ids[26]]}},data:{status:'COMPLETED'}});
    await db.order.update({where:{id:ids[27]},data:{status:'CANCELLED'}});
    await db.order.updateMany({where:{id:{in:[ids[1],ids[25]]}},data:{actualHourlyRate:null}});
    const yesterday=new Date(Date.now()-86400000);
    await db.order.update({where:{id:ids[4]},data:{dueDate:yesterday}});
    for(const [index,status,minutes] of [[1,'APPROVED',60],[4,'APPROVED',150],[25,'APPROVED',60],[28,'SUBMITTED',30]]) {
      const start=new Date('2025-11-01T04:00:00Z');start.setUTCDate(index+1);
      const entry=await db.workTimeEntry.create({data:{organizationId:org,employeeId:employee.id,createdById:employee.id,status,
        startsAt:start,endsAt:new Date(start.getTime()+minutes*60000),idempotencyKey:randomUUID()}});
      await db.workTimeAllocation.create({data:{organizationId:org,entryId:entry.id,orderId:ids[index]}});
    }
    const visit=await db.order.create({data:{organizationId:org,clientId:client.id,number:106,title:'Visit QA',
      repeatOfId:ids[2],repeatKey:randomUUID(),total:'0',actualHourlyRate:'0'}});
    for(const [index,extra] of [[3,{}],[29,{revokedAt:new Date()}],[30,{acceptedAt:new Date(Date.now()-120000)}]]) {
      await db.orderQuote.create({data:{organizationId:org,orderId:ids[index],revision:1,kind:'BASE',
        tokenHash:randomUUID().replaceAll('-','').repeat(2),basisHash:'0'.repeat(64),snapshot:{},createdAt:new Date(Date.now()-3600000),
        expiresAt:new Date(Date.now()-60000),...extra}});
    }
    const service=new OrderAttentionService({client:db});
    queries=0;
    const all=await service.list(owner,{q:'',page:1});
    assert.ok(queries<35,'Workload should use batch reads');
    assert.equal(all.summary.orders,28);
    assert.equal(all.summary.forecastLoss,'99999999999999999.90');
    assert.deepEqual(all.summary.reasons,{LOSS:2,INCOMPLETE:3,RECEIPTS:25,APPROVAL:1,OVERRUN:1,TIME_REVIEW:1,DEADLINE:1});
    assert.equal(all.total,28);assert.equal(all.items.length,20);
    assert.equal(all.items[0].id,ids[31]);assert.equal(all.items[1].id,ids[0]);
    const receipts=await service.list(owner,{q:'',page:2,reason:'RECEIPTS'});
    assert.equal(receipts.total,25);assert.equal(receipts.items.length,5);
    assert.deepEqual(receipts.summary,all.summary);
    const repeat=await service.list(owner,{q:'106',page:1});
    assert.equal(repeat.total,1);assert.equal(repeat.items[0].id,ids[2]);
    assert.ok(repeat.items[0].issues.some(issue=>issue.reason==='INCOMPLETE'&&issue.orderId===visit.id));
    const detailService=new OrderProfitabilityService({client:db},new AuditService({client:db}));
    for(const item of all.items) {
      const detail=await detailService.detail(owner,item.id);
      assert.equal(item.forecastProfit,detail.forecast.atCompletion.profit);
      assert.equal(item.actualProfit,detail.actual.profit);
    }
    assert.equal((await service.list(owner,{q:'Company QA',page:1})).summary.orders,28);
    assert.equal((await service.list(owner,{q:'not-found',page:1})).total,0);
    assert.equal((await service.list(owner,{q:"x' OR 1=1 --",page:1})).total,0);
    assert.equal((await service.list(owner,{q:'27',page:1})).total,0);
    assert.equal((await service.list(other,{q:'',page:1})).total,0);
    await assert.rejects(()=>service.list(employee,{q:'',page:1}),error=>error.getStatus()===403);
    await db.user.update({where:{id:owner.id},data:{isActive:false}});
    await assert.rejects(()=>service.list(owner,{q:'',page:1}),error=>error.getStatus()===403);
    assert.equal(await db.expenseReceipt.count({where:{organizationId:org,status:'PENDING'}}),26);
  }finally{
    await db.expenseReceipt.deleteMany({where:scope});await db.expense.deleteMany({where:scope});
    await db.workTimeEntry.deleteMany({where:scope});await db.orderQuote.deleteMany({where:scope});
    await db.order.deleteMany({where:{...scope,repeatOfId:{not:null}}});await db.order.deleteMany({where:scope});
    await db.client.deleteMany({where:scope});await db.auditEvent.deleteMany({where:scope});
    await db.user.deleteMany({where:scope});await db.organization.deleteMany({where:{id:{in:[org,outside]}}});
    await db.$disconnect();
  }
});
