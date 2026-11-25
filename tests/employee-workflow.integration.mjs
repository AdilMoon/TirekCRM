import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import sharp from 'sharp';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {EmployeeWorkflowService} from '../backend/dist/modules/tasks/employee-workflow.service.js';
import {TasksService} from '../backend/dist/modules/tasks/tasks.service.js';
import {TeamService} from '../backend/dist/modules/team/team.service.js';
import {PassportService} from '../backend/dist/modules/smart-orders/passport.service.js';
import {WorkTimeService} from '../backend/dist/modules/work-time/work-time.service.js';
import {OrderQualityService} from '../backend/dist/modules/crm/order-quality.service.js';
import {AuditService} from '../backend/dist/modules/audit/audit.service.js';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID(),otherOrg=randomUUID(),scope={organizationId:{in:[org,otherOrg]}};
const audit=new AuditService({client:db}),team=new TeamService({client:db},audit),flow=new EmployeeWorkflowService({client:db});
const tasks=new TasksService({client:db},audit),photos=new PassportService({client:db},audit),time=new WorkTimeService({client:db},audit),quality=new OrderQualityService({client:db},audit);
const status=code=>error=>error.getStatus?.()===code;
test('invitation session and first-day evidence remain scoped, atomic and reversible',async t=>{
 try{
  await db.organization.createMany({data:[{id:org,name:'First day QA'},{id:otherOrg,name:'Other QA'}]});
  async function user(role,organizationId=org){return db.user.create({data:{organizationId,role,name:role,email:randomUUID()+'@first-day.invalid',passwordHash:'unused'}});}
  const owner=await user('OWNER'),stranger=await user('EMPLOYEE',otherOrg),other=await user('EMPLOYEE');
  const invite=await team.invite(owner,{name:'New employee',email:randomUUID()+'@first-day.invalid'});
  const token=randomBytes(32).toString('hex');await db.session.create({data:{userId:owner.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
  let worker;
  await t.test('acceptance cannot switch an active account and creates exactly one employee and session',async()=>{
   await assert.rejects(()=>team.accept(invite.token,'FirstDayEmployee2026!','QA',token),status(409));
   assert.equal((await db.invitation.findUnique({where:{id:invite.id}})).acceptedAt,null);
   const results=await Promise.allSettled([team.accept(invite.token,'FirstDayEmployee2026!','QA'),team.accept(invite.token,'FirstDayEmployee2026!','QA')]);
   assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
   assert.equal(results.find(result=>result.status==='rejected').reason.getStatus(),404);
   const accepted=results.find(result=>result.status==='fulfilled').value;
   worker=await db.user.findUniqueOrThrow({where:{email:invite.email}});assert.equal(worker.role,'EMPLOYEE');
   const sessions=await db.session.findMany({where:{userId:worker.id}});assert.equal(sessions.length,1);
   assert.equal(sessions[0].tokenHash,createHash('sha256').update(accepted.session.token).digest('hex'));assert.notEqual(sessions[0].tokenHash,accepted.session.token);
   assert.equal((await db.auditEvent.count({where:{organizationId:org,action:'MEMBER_JOINED'}})),1);
   assert.deepEqual(await flow.first(worker),{workflow:null});
  });
  const client=await db.client.create({data:{organizationId:org,name:'PRIVATE CLIENT',phone:'PRIVATE CONTACT'}});
  const order=await db.order.create({data:{organizationId:org,clientId:client.id,number:1,title:'Order brief',notes:'PRIVATE FINANCIAL NOTES',total:'9999.99'}});
  const task=await tasks.create(owner,{title:'First task',description:'Operational description',assigneeId:worker.id,orderId:order.id,dueDate:null});
  await db.businessTask.create({data:{organizationId:org,createdById:owner.id,assigneeId:worker.id,title:'Old cancelled task',status:'CANCELLED',createdAt:new Date('2025-01-01')}});
  await t.test('workflow chooses an assigned task and exposes no client, financial or attachment content',async()=>{
   const start=(await flow.first(worker)).workflow;assert.equal(start.task.id,task.id);assert.equal(start.resultPhotos,0);assert.equal(start.submittedMinutes,0);
   assert.deepEqual(Object.keys(start).sort(),['task','resultPhotos','submittedMinutes','approvedMinutes','requiredChecks','completedChecks'].sort());
   assert.equal(JSON.stringify(start).includes('PRIVATE'),false);assert.equal(JSON.stringify(start).includes('9999'),false);
   await assert.rejects(()=>flow.first(owner),status(403));await assert.rejects(()=>flow.detail(other,task.id),status(404));await assert.rejects(()=>flow.detail(stranger,task.id),status(404));
  });
  let working;
  await t.test('only own after-photos count and mandatory acceptance remains enforced',async()=>{
   const image=(await sharp({create:{width:32,height:32,channels:3,background:'#26705c'}}).jpeg().toBuffer()).toString('base64');
   await photos.photo(owner,order.id,{phase:'AFTER',image,shared:false,idempotencyKey:randomUUID()});
   await photos.photo(worker,order.id,{phase:'BEFORE',image,shared:false,idempotencyKey:randomUUID()});
   assert.equal((await flow.detail(worker,task.id)).resultPhotos,0);
   working=await tasks.status(worker,task.id,'IN_PROGRESS',task.version);
   await photos.photo(worker,order.id,{phase:'AFTER',image,shared:false,idempotencyKey:randomUUID()});
   const itemId=randomUUID();await quality.configure(owner,order.id,{version:0,items:[{id:itemId,label:'Check result QA',required:true}]});
   await assert.rejects(()=>tasks.status(worker,task.id,'DONE',working.version),status(400));
   const prior=await flow.detail(worker,task.id);assert.equal(prior.requiredChecks,1);assert.equal(prior.completedChecks,0);assert.equal(prior.resultPhotos,1);
   await quality.check(worker,order.id,{version:1,itemId,checked:true});assert.equal((await flow.detail(worker,task.id)).completedChecks,1);
  });
  await t.test('time progress counts own active working entries and follows reviews and corrections',async()=>{
   const input={startsAt:'2025-03-03T04:00:00Z',endsAt:'2025-03-03T05:00:00Z',kind:'WORK',orderId:order.id,idempotencyKey:randomUUID()};
   const entry=await time.create(worker,input);assert.equal((await flow.detail(worker,task.id)).submittedMinutes,60);
   await time.create(owner,{...input,employeeId:other.id,idempotencyKey:randomUUID()});
   await time.create(worker,{startsAt:'2025-03-03T05:00:00Z',endsAt:'2025-03-03T06:00:00Z',kind:'ABSENCE',idempotencyKey:randomUUID()});
   await time.decide(owner,entry.id,{status:'APPROVED',version:entry.version});
   let current=await flow.detail(worker,task.id);assert.equal(current.submittedMinutes,0);assert.equal(current.approvedMinutes,60);
   await time.decide(owner,entry.id,{status:'VOIDED',version:2,note:'Correction QA'});
   current=await flow.detail(worker,task.id);assert.equal(current.submittedMinutes,0);assert.equal(current.approvedMinutes,0);
   const replacement=await time.create(worker,{...input,idempotencyKey:randomUUID()});
   await time.decide(owner,replacement.id,{status:'REJECTED',version:1,note:'Review QA'});assert.equal((await flow.detail(worker,task.id)).submittedMinutes,0);
   await time.create(worker,{...input,idempotencyKey:randomUUID()});
   await tasks.status(worker,task.id,'DONE',working.version);
   assert.equal((await flow.first(worker)).workflow.task.status,'DONE');assert.equal((await flow.detail(worker,task.id)).submittedMinutes,60);
  });
  await t.test('reassignment, cancellation and deactivation remove the old workflow immediately',async()=>{
   await db.businessTask.update({where:{id:task.id},data:{assigneeId:other.id}});await assert.rejects(()=>flow.detail(worker,task.id),status(404));assert.deepEqual(await flow.first(worker),{workflow:null});
   const plain=await tasks.create(owner,{title:'Unlinked task',description:'',assigneeId:worker.id,orderId:null,dueDate:null});
   assert.equal((await flow.detail(worker,plain.id)).task.order,null);
   await db.businessTask.update({where:{id:plain.id},data:{status:'CANCELLED'}});assert.deepEqual(await flow.first(worker),{workflow:null});
   await db.user.update({where:{id:worker.id},data:{isActive:false}});await assert.rejects(()=>flow.first(worker),status(403));
  });
 }finally{
  await db.workTimeEntry.deleteMany({where:scope});await db.businessTask.deleteMany({where:scope});await db.order.deleteMany({where:scope});
  await db.client.deleteMany({where:scope});await db.auditEvent.deleteMany({where:scope});await db.invitation.deleteMany({where:scope});
  await db.user.deleteMany({where:scope});await db.organization.deleteMany({where:{id:{in:[org,otherOrg]}}});await db.$disconnect();
 }
});
