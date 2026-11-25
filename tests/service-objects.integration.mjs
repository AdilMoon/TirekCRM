import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {ServiceObjectsService} from '../backend/dist/modules/service-objects/service-objects.service.js';
import {PassportService} from '../backend/dist/modules/smart-orders/passport.service.js';
import {OrderAttentionService} from '../backend/dist/modules/work-time/order-attention.service.js';
import {OrderQualityService} from '../backend/dist/modules/crm/order-quality.service.js';
import {CrmService} from '../backend/dist/modules/crm/crm.service.js';
import {AuditService} from '../backend/dist/modules/audit/audit.service.js';
import {serviceRequestSchema,serviceDecisionSchema} from '@tirek/contracts';

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const organizationId=randomUUID(),outside=randomUUID(),scope={organizationId:{in:[organizationId,outside]}};
const audit=new AuditService({client:db}),objects=new ServiceObjectsService({client:db},audit),passports=new PassportService({client:db},audit);
const attention=new OrderAttentionService({client:db}),quality=new OrderQualityService({client:db},audit);
const query={historyPage:1,requestPage:1};
const status=code=>e=>e.getStatus?.()===code;
test('object history and QR service requests preserve client boundaries, retries and exact new-order revenue',async t=>{
 try{
  await db.organization.createMany({data:[{id:organizationId,name:'Objects QA',orderSeq:100},{id:outside,name:'Outside QA'}]});
  async function user(role,org=organizationId){return db.user.create({data:{organizationId:org,role,name:role,email:randomUUID()+'@objects.invalid',passwordHash:'unused'}});}
  const owner=await user('OWNER'),employee=await user('EMPLOYEE'),stranger=await user('OWNER',outside);
  const client=await db.client.create({data:{organizationId,name:'Client QA',phone:'PRIVATE-CONTACT'}});
  const otherClient=await db.client.create({data:{organizationId,name:'Other client'}});
  async function order(number,clientId=client.id,status='COMPLETED') {return db.order.create({data:{organizationId,clientId,number,status,title:'Work '+number,total:'10000',notes:'PRIVATE-NOTES',items:{create:{description:'Work',quantity:1,unitPrice:'10000',total:'10000'}}}});}
  const root=await order(1),current=await order(2,client.id,'IN_PROGRESS'),other=await order(3,otherClient.id);
  const earlyVisit=await db.order.create({data:{organizationId,clientId:client.id,number:4,title:'Early visit',total:'0',repeatOfId:root.id,repeatKey:randomUUID(),repeatRequestHash:'0'.repeat(64)}});
  const task=await db.businessTask.create({data:{organizationId,orderId:current.id,createdById:owner.id,assigneeId:employee.id,title:'Current task'}});
  const old=await passports.publish(owner,root.id),oldToken=new URL(old.url).hash.slice(7);
  let objectId;
  await t.test('binding is atomic, replays safely, inherits visits and revokes the old passport',async()=>{
   assert.equal((await objects.context(owner,root.id,query)).object,null);
   await assert.rejects(()=>objects.context(stranger,root.id,query),status(404));
   await assert.rejects(()=>objects.context(employee,root.id,query),status(404));
   const input={kind:'CREATE',name:'Pump QA',address:'PRIVATE-ADDRESS',creationKey:randomUUID(),orderVersion:1};
   await assert.rejects(()=>objects.bind(employee,current.id,input),status(403));
   const results=await Promise.all([objects.bind(owner,root.id,input),objects.bind(owner,root.id,input)]);
   objectId=results[0].id;assert.equal(results[1].id,objectId);
   assert.equal(await db.serviceObject.count({where:{organizationId}}),1);
   assert.equal((await db.order.findUnique({where:{id:earlyVisit.id}})).serviceObjectId,objectId);
   await assert.rejects(()=>passports.read(oldToken),status(404));
   await assert.rejects(()=>objects.bind(owner,root.id,{...input,name:'Changed'}),status(409));
   await assert.rejects(()=>objects.bind(owner,earlyVisit.id,{kind:'LINK',objectId,orderVersion:2}),status(409));
   await assert.rejects(()=>objects.bind(owner,current.id,{kind:'LINK',objectId,orderVersion:100}),status(409));
   await assert.rejects(()=>objects.bind(owner,other.id,{kind:'LINK',objectId,orderVersion:1}),status(404));
   await objects.bind(owner,current.id,{kind:'LINK',objectId,orderVersion:1});
   assert.deepEqual(await objects.bind(owner,current.id,{kind:'LINK',objectId,orderVersion:1}),{id:objectId});
  });
  await t.test('assigned workers get completed history without requests, contacts, money, notes or photos',async()=>{
   const context=await objects.context(employee,current.id,query);
   assert.equal(context.canManage,false);assert.equal(context.history.total,1);assert.equal(context.history.items[0].id,root.id);
   assert.equal('requests' in context,false);
   for(const item of context.history.items)assert.deepEqual(Object.keys(item).sort(),['id','number','title','status','dueDate','createdAt','repeatOfId'].sort());
   assert.ok(!JSON.stringify(context).includes('PRIVATE-CONTACT'));assert.ok(!JSON.stringify(context).includes('PRIVATE-NOTES'));
   await assert.rejects(()=>objects.choices(employee,current.id,{q:'',page:1}),status(403));
   await db.businessTask.update({where:{id:task.id},data:{assigneeId:owner.id}});
   await assert.rejects(()=>objects.context(employee,current.id,query),status(404));
   await db.businessTask.update({where:{id:task.id},data:{assigneeId:employee.id}});
   const visit=await quality.repeat(owner,root.id,{reason:'Repeat work QA',assigneeId:employee.id,idempotencyKey:randomUUID()});
   assert.equal((await db.order.findUnique({where:{id:visit.id}})).serviceObjectId,objectId);
  });
  await t.test('choices and history paginate and stay within the same client',async()=>{
   await db.serviceObject.createMany({data:Array.from({length:12},(_,index)=>({organizationId,clientId:client.id,name:'Choice '+index,creationKey:randomUUID(),inputHash:'0'.repeat(64)}))});
   await db.serviceObject.create({data:{organizationId,clientId:otherClient.id,name:'Hidden object',creationKey:randomUUID(),inputHash:'0'.repeat(64)}});
   const first=await objects.choices(owner,current.id,{q:'',page:1}),second=await objects.choices(owner,current.id,{q:'',page:2});
   assert.equal(first.total,13);assert.equal(first.items.length,10);assert.equal(second.items.length,3);
   assert.equal((await objects.choices(owner,current.id,{q:'Hidden',page:1})).total,0);
   await db.order.createMany({data:Array.from({length:12},(_,index)=>({organizationId,clientId:client.id,serviceObjectId:objectId,number:20+index,title:'History '+index,status:'COMPLETED',total:'100'}))});
   const history=await objects.context(owner,current.id,{...query,historyPage:2});assert.equal(history.history.total,16);assert.equal(history.history.items.length,6);
   await assert.rejects(()=>db.order.update({where:{id:current.id},data:{clientId:otherClient.id}}),e=>e.code==='P2003');
   const crm=new CrmService({client:db},audit);
   await assert.rejects(()=>crm.updateOrder(organizationId,current.id,{version:2,clientId:otherClient.id,title:'Bad change',notes:'',items:[{description:'Work',quantity:1,unitPrice:'10000'}]},owner),status(409));
  });
  let token,requestId,decision;
  await t.test('public requests are deduplicated across retries and concurrent requests',async()=>{
   const published=await passports.publish(owner,root.id);token=new URL(published.url).hash.slice(7);
   const view=await passports.read(token);assert.equal(view.canRequestService,true);
   for(const forbidden of ['serviceObjectId','clientId','object','history','requests','notes','total'])assert.equal(forbidden in view,false);
   const input={token,submissionKey:randomUUID(),description:'Service the same pump again'};
   const results=await Promise.all([objects.submit(input),objects.submit(input)]);requestId=results[0].id;assert.equal(results[1].id,requestId);
   await assert.rejects(()=>objects.submit({...input,description:'Changed request'}),status(409));
   await assert.rejects(()=>objects.submit({...input,submissionKey:randomUUID()}),status(409));
   const overview=await attention.list(owner,{q:'',reason:'SERVICE_REQUEST',page:1});assert.equal(overview.total,1);assert.equal(overview.items[0].id,root.id);
   assert.equal(overview.items[0].issues.find(issue=>issue.reason==='SERVICE_REQUEST').target,'service-object');
   assert.equal((await objects.context(owner,current.id,query)).requests.items[0].id,requestId);
   assert.equal(serviceRequestSchema.safeParse({...input,objectId:objectId}).success,false);
   assert.equal(serviceDecisionSchema.safeParse({status:'CONVERTED',version:1,title:'Work',price:'0'}).success,false);
  });
  await t.test('concurrent decisions create exactly one normal paid order with the same client and object',async()=>{
   decision={status:'CONVERTED',version:1,title:'Pump maintenance',price:'1999.99'};
   await assert.rejects(()=>objects.decide(employee,current.id,requestId,decision),status(403));
   await assert.rejects(()=>objects.decide(stranger,current.id,requestId,decision),status(404));
   await assert.rejects(()=>objects.decide(owner,other.id,requestId,decision),status(404));
   await assert.rejects(()=>objects.decide(owner,current.id,requestId,{...decision,version:2}),status(409));
   const results=await Promise.all([objects.decide(owner,current.id,requestId,decision),objects.decide(owner,current.id,requestId,decision)]);
   assert.equal(results[0].orderId,results[1].orderId);assert.ok(results[0].orderId);
   const created=await db.order.findUnique({where:{id:results[0].orderId},include:{items:true}});
   assert.equal(created.total.toFixed(2),'1999.99');assert.equal(created.items[0].total.toFixed(2),'1999.99');assert.equal(created.clientId,client.id);assert.equal(created.serviceObjectId,objectId);assert.equal(created.repeatOfId,null);
   assert.equal(await db.order.count({where:{organizationId,title:'Pump maintenance'}}),1);
   await assert.rejects(()=>objects.decide(owner,current.id,requestId,{...decision,price:'2000'}),status(409));
   assert.equal((await attention.list(owner,{q:'',reason:'SERVICE_REQUEST',page:1})).total,0);
  });
  await t.test('declines, expiry, rotation and revocation retain private history and block bearer writes',async()=>{
   const next=await objects.submit({token,submissionKey:randomUUID(),description:'Second request for the same pump'});
   const decline={status:'DECLINED',version:1,note:'PRIVATE-DECISION'};
   await objects.decide(owner,current.id,next.id,decline);await objects.decide(owner,current.id,next.id,decline);
   const ownerView=await objects.context(owner,current.id,query);assert.equal(ownerView.requests.total,2);assert.equal(ownerView.requests.items[0].decisionNote,'PRIVATE-DECISION');
   assert.ok(!JSON.stringify(await passports.read(token)).includes('PRIVATE-DECISION'));
   await db.orderPassport.update({where:{orderId:root.id},data:{expiresAt:new Date(Date.now()-1000)}});
   await assert.rejects(()=>objects.submit({token,submissionKey:randomUUID(),description:'Expired request'}),status(404));
   const rotated=await passports.publish(owner,root.id),newToken=new URL(rotated.url).hash.slice(7);
   await assert.rejects(()=>objects.submit({token,submissionKey:randomUUID(),description:'Rotated request'}),status(404));
   await passports.revoke(owner,root.id);
   await assert.rejects(()=>objects.submit({token:newToken,submissionKey:randomUUID(),description:'Revoked request'}),status(404));
   await db.user.update({where:{id:owner.id},data:{isActive:false}});
   await assert.rejects(()=>objects.context(owner,current.id,query),status(403));
   const audits=await db.auditEvent.findMany({where:{organizationId,action:'SERVICE_REQUEST_RECEIVED'}});assert.equal(audits.length,2);
   assert.ok(!JSON.stringify(audits).includes(token));assert.ok(!JSON.stringify(audits).includes('same pump'));
  });
 }finally{
  await db.serviceRequest.deleteMany({where:scope});await db.businessTask.deleteMany({where:scope});
  await db.order.deleteMany({where:{...scope,repeatOfId:{not:null}}});await db.order.deleteMany({where:scope});
  await db.serviceObject.deleteMany({where:scope});await db.client.deleteMany({where:scope});await db.auditEvent.deleteMany({where:scope});
  await db.user.deleteMany({where:scope});await db.organization.deleteMany({where:{id:{in:[organizationId,outside]}}});await db.$disconnect();
 }
});
