import 'dotenv/config';
import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {SchedulingService} from '../backend/dist/modules/scheduling/scheduling.service.js';
import {TasksService} from '../backend/dist/modules/tasks/tasks.service.js';
import {CrmService} from '../backend/dist/modules/crm/crm.service.js';
import {AuditService} from '../backend/dist/modules/audit/audit.service.js';
import {almatyTime} from '../backend/dist/modules/scheduling/planner.js';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:6})});
const audit=new AuditService({client:db}),service=new SchedulingService({client:db},audit),tasks=new TasksService({client:db},audit),crm=new CrmService({client:db},audit);
const org=randomUUID(),foreignOrg=randomUUID(),origin=process.env.WEB_ORIGIN??'http://localhost:3000',api=process.env.TEST_API_URL??'http://127.0.0.1:4000/api';
const day=almatyTime(new Date(Date.now()+2*86400000)).day;
const slot=(time='09:00',skills=['уборка','окна'])=>({startsAt:day+'T'+time+':00+05:00',durationMinutes:60,requiredSkills:skills});
const profile={skills:['уборка','окна'],weekdays:[1,2,3,4,5,6,7],startMinute:540,endMinute:1080,version:0};
async function user(organizationId,name,role='EMPLOYEE',isActive=true){
 const u=await db.user.create({data:{organizationId,name,role,isActive,email:randomUUID()+'@schedule.invalid',passwordHash:'unused'}}),token=randomBytes(32).toString('hex');
 await db.session.create({data:{userId:u.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});return {...u,cookie:'tirek_session='+token};
}
async function request(path,body,cookie,method='POST',requestOrigin=origin){
 const r=await fetch(api+path,{method,headers:{Origin:requestOrigin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
}
async function input(owner,id,s=slot(),employeeId){const p=await service.recommend(owner,id,s);return {...s,employeeId:employeeId??p.recommendedId,profileVersion:p.candidates.find(c=>c.id===(employeeId??p.recommendedId))?.profileVersion??1,orderVersion:p.orderVersion,currentBookingId:p.currentBookingId,idempotencyKey:randomUUID()};}
const code=n=>e=>e.getStatus?.()===n;
test('employee matching and scheduling enforce explanations tenant boundaries retries and database exclusion',async t=>{
 try{
  await db.organization.createMany({data:[{id:org,name:'Schedule fixture'},{id:foreignOrg,name:'Foreign fixture'}]});
  const owner=await user(org,'Owner','OWNER'),a=await user(org,'Айдана'),b=await user(org,'Бекзат'),c=await user(org,'Дана'),d=await user(org,'Ерлан'),e=await user(org,'Жанна','EMPLOYEE',false),foreign=await user(foreignOrg,'Foreign','OWNER'),outsider=await user(foreignOrg,'Private staff');
  const client=await db.client.create({data:{organizationId:org,name:'Fixture client'}});
  let num=0;const order=()=>db.order.create({data:{organizationId:org,clientId:client.id,number:++num,title:'Уборка '+num,total:'12345.67',dueDate:new Date(day+'T00:00:00Z')}});
  const o1=await order(),o2=await order(),o3=await order(),o4=await order();
  let booking;
  await t.test('only owner may configure own staff; profiles are versioned and strict',async()=>{
   assert.equal((await request('/scheduling/members',undefined,undefined,'GET')).status,401);
   assert.equal((await request('/scheduling/members',undefined,a.cookie,'GET')).status,403);
   assert.equal((await request('/scheduling/members/'+outsider.id,profile,owner.cookie,'PATCH')).status,404);
   assert.equal((await request('/scheduling/members/'+owner.id,profile,owner.cookie,'PATCH')).status,404);
   assert.equal((await request('/scheduling/members/'+a.id,{...profile,organizationId:foreignOrg},owner.cookie,'PATCH')).status,400);
   assert.equal((await request('/scheduling/members/'+a.id,profile,owner.cookie,'PATCH','')).status,403);
   await service.profile(owner,a.id,profile);await service.profile(owner,b.id,{...profile,skills:['уборка']});await service.profile(owner,c.id,{...profile,startMinute:720});await service.profile(owner,e.id,profile);
   await assert.rejects(()=>service.profile(owner,a.id,profile),code(409));
   const members=await request('/scheduling/members',undefined,owner.cookie,'GET');assert.equal(members.status,200);assert.equal(members.body.length,5);assert.equal(JSON.stringify(members.body).includes('@schedule.invalid'),false);
   assert.deepEqual(Object.keys(members.body[0]).sort(),['id','name','isActive','profile'].sort());
  });
  await t.test('preview is read-only and explains skills schedule missing profiles and disabled users',async()=>{
   const p=await service.recommend(owner,o1.id,slot());assert.equal(p.recommendedId,a.id);
   assert.deepEqual(p.candidates.find(r=>r.id===b.id).blocks,['MISSING_SKILLS']);assert.deepEqual(p.candidates.find(r=>r.id===b.id).missingSkills,['окна']);
   assert.ok(p.candidates.find(r=>r.id===c.id).blocks.includes('OUTSIDE_HOURS'));assert.ok(p.candidates.find(r=>r.id===d.id).blocks.includes('PROFILE_REQUIRED'));assert.ok(p.candidates.find(r=>r.id===e.id).blocks.includes('INACTIVE'));
   assert.equal(await db.businessTask.count({where:{organizationId:org}}),0);assert.equal(await db.workBooking.count({where:{organizationId:org}}),0);
   assert.equal((await request('/orders/'+o1.id+'/assignment/recommendations',slot(),foreign.cookie)).status,404);
   assert.equal((await request('/orders/'+o1.id+'/assignment/recommendations',{...slot(),eligible:true},owner.cookie)).status,400);
   assert.equal((await request('/orders/'+o1.id+'/assignment/recommendations',{...slot(),startsAt:'2020-01-01T09:00:00+05:00'},owner.cookie)).status,400);
   await assert.rejects(async()=>service.assign(owner,o1.id,await input(owner,o1.id,slot(),b.id)),code(409));
   await assert.rejects(async()=>service.assign(owner,o1.id,await input(owner,o1.id,slot(),outsider.id)),code(404));
   await db.user.update({where:{id:owner.id},data:{isActive:false}});
   try{await assert.rejects(()=>service.recommend(owner,o1.id,slot()),code(403));}finally{await db.user.update({where:{id:owner.id},data:{isActive:true}});}
  });
  await t.test('parallel retries atomically create one booking task notification and audit',async()=>{
   const body=await input(owner,o1.id);
   const result=await Promise.all([service.assign(owner,o1.id,body),service.assign(owner,o1.id,body),service.assign(owner,o1.id,body)]);booking=result[0];assert.deepEqual(result,[booking,booking,booking]);
   assert.equal(await db.workBooking.count({where:{organizationId:org}}),1);assert.equal(await db.businessTask.count({where:{organizationId:org}}),1);
   assert.equal(await db.notification.count({where:{organizationId:org,recipientId:a.id,kind:'TASK_ASSIGNED'}}),1);assert.equal(await db.auditEvent.count({where:{organizationId:org,action:'ORDER_ASSIGNED'}}),1);
   const order=await db.order.findUniqueOrThrow({where:{id:o1.id}});assert.equal(order.total.toFixed(2),'12345.67');assert.equal(order.version,2);assert.equal(order.plannedMinutes,60);
   await assert.rejects(()=>service.assign(owner,o1.id,{...body,durationMinutes:90}),code(409));
   assert.equal((await request('/orders/'+o1.id+'/assignment',undefined,a.cookie,'GET')).status,403);
   const mine=await tasks.get(a,booking.taskId);assert.ok(mine.booking);assert.equal(mine.order.id,o1.id);
  });
  await t.test('database blocks overlap directly while adjacent half-open intervals remain available',async()=>{
   const p=await service.recommend(owner,o2.id,slot('09:30'));assert.ok(p.candidates.find(c=>c.id===a.id).blocks.includes('OVERLAP'));
   assert.equal((await service.recommend(owner,o2.id,slot('10:00'))).recommendedId,a.id);
   const raw=new pg.Client({connectionString:process.env.DATABASE_URL});await raw.connect();
   const task=await db.businessTask.create({data:{organizationId:org,createdById:owner.id,assigneeId:a.id,orderId:o2.id,title:'Direct constraint fixture'}});
   const sql='INSERT INTO "WorkBooking" (id,"organizationId","orderId","employeeId","taskId","startsAt","endsAt","requiredSkills","createdById","idempotencyKey","inputHash") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',values=[randomUUID(),org,o2.id,a.id,task.id,new Date(day+'T09:30:00+05:00').toISOString(),new Date(day+'T10:30:00+05:00').toISOString(),[],owner.id,randomUUID(),'a'.repeat(64)];
   try{
    await assert.rejects(()=>raw.query(sql,values),error=>error.code==='23P01');
    const invalid=[...values];invalid[6]=invalid[5];await assert.rejects(()=>raw.query(sql,invalid),error=>error.code==='23514');
    const crossTenant=[...values];crossTenant[3]=outsider.id;await assert.rejects(()=>raw.query(sql,crossTenant),error=>error.code==='23503');
   }finally{await raw.end();await db.businessTask.delete({where:{id:task.id}});}
   await service.assign(owner,o4.id,await input(owner,o4.id,slot('10:00')));
  });
  await t.test('concurrent different orders cannot book the same employee and losing transaction leaves no task',async()=>{
   const s=slot('11:00'),i2=await input(owner,o2.id,s),i3=await input(owner,o3.id,s),before=await db.businessTask.count({where:{organizationId:org}});
   const result=await Promise.allSettled([service.assign(owner,o2.id,i2),service.assign(owner,o3.id,i3)]);
   assert.equal(result.filter(r=>r.status==='fulfilled').length,1);const failure=result.find(r=>r.status==='rejected');assert.equal(failure.reason.getStatus?.(),409);
   assert.equal(await db.businessTask.count({where:{organizationId:org}}),before+1);
  });
  await t.test('profile changes deadlines reassignment and direct task edits preserve reservations',async()=>{
   await assert.rejects(()=>service.profile(owner,a.id,{...profile,version:1,endMinute:570}),code(409));
   const task=await db.businessTask.findUniqueOrThrow({where:{id:booking.taskId}}),body={title:task.title,description:task.description,dueDate:day,orderId:o1.id,assigneeId:b.id,version:task.version};
   await assert.rejects(()=>tasks.update(owner,task.id,body),code(409));await assert.rejects(()=>tasks.status(owner,task.id,'CANCELLED',task.version),code(409));
   const snapshot=await input(owner,o1.id,slot('13:00'),a.id);
   await service.profile(owner,a.id,{...profile,version:1,skills:[...profile.skills,'ремонт']});
   await assert.rejects(()=>service.assign(owner,o1.id,snapshot),code(409));
   const old=booking;booking=await service.assign(owner,o1.id,await input(owner,o1.id,{...slot('09:00',['уборка']),durationMinutes:45},b.id));
   assert.equal((await db.order.findUniqueOrThrow({where:{id:o1.id}})).plannedMinutes,60);
   assert.ok((await db.workBooking.findUniqueOrThrow({where:{id:old.id}})).releasedAt);assert.equal((await db.businessTask.findUniqueOrThrow({where:{id:old.taskId}})).status,'CANCELLED');
   assert.equal((await request('/orders/'+o1.id+'/passport',undefined,a.cookie,'GET')).status,403);assert.equal((await request('/orders/'+o1.id+'/passport',undefined,b.cookie,'GET')).status,200);
   await service.cancel(owner,o1.id,old.id);assert.equal((await service.state(owner,o1.id)).current.id,booking.id);
   await assert.rejects(async()=>tasks.status(owner,old.taskId,'TODO',(await db.businessTask.findUniqueOrThrow({where:{id:old.taskId}})).version),code(409));
   const order=await crm.order(org,o1.id);await assert.rejects(()=>crm.updateOrder(org,o1.id,{clientId:client.id,title:order.title,notes:'',items:[{description:'Work',quantity:1,unitPrice:'12345.67'}],version:order.version,dueDate:'2020-01-01'},owner),code(409));
  });
  await t.test('audit failure rolls back rescheduling and explicit cancellation is idempotent',async()=>{
   const before=await db.businessTask.count({where:{organizationId:org}}),bad=new SchedulingService({client:db},{record:async()=>{throw Error('audit fixture');}});
   await assert.rejects(async()=>bad.assign(owner,o1.id,await input(owner,o1.id,slot('14:00',['уборка']),b.id)));
   assert.equal((await service.state(owner,o1.id)).current.id,booking.id);assert.equal(await db.businessTask.count({where:{organizationId:org}}),before);
   const v=(await service.state(owner,o1.id)).orderVersion;
   await Promise.all([service.cancel(owner,o1.id,booking.id),service.cancel(owner,o1.id,booking.id)]);
   assert.equal((await service.state(owner,o1.id)).current,null);assert.equal((await service.state(owner,o1.id)).orderVersion,v+1);
  });
  await t.test('order completion frees booking and updates linked task in the same transaction',async()=>{
   await crm.changeStage(org,o4.id,'CONFIRMED',owner);await crm.changeStage(org,o4.id,'IN_PROGRESS',owner);const current=(await service.state(owner,o4.id)).current;
   await crm.changeStage(org,o4.id,'COMPLETED',owner);assert.equal((await service.state(owner,o4.id)).current,null);assert.equal((await db.businessTask.findUniqueOrThrow({where:{id:current.taskId}})).status,'DONE');
   const done=await db.businessTask.findUniqueOrThrow({where:{id:current.taskId}});await assert.rejects(()=>tasks.status(owner,done.id,'TODO',done.version),code(409));
   await assert.rejects(()=>service.recommend(owner,o4.id,slot()),code(409));
  });
 }finally{
  for(const id of [org,foreignOrg]){await db.businessTask.deleteMany({where:{organizationId:id}});await db.order.deleteMany({where:{organizationId:id}});await db.client.deleteMany({where:{organizationId:id}});await db.auditEvent.deleteMany({where:{organizationId:id}});await db.user.deleteMany({where:{organizationId:id}});await db.organization.deleteMany({where:{id}});}await db.$disconnect();
 }
});
