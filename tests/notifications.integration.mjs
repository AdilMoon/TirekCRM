import 'dotenv/config';
import 'reflect-metadata';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {NotificationsService} from '../backend/dist/modules/notifications/notifications.service.js';
import {TaskCommentsService} from '../backend/dist/modules/tasks/task-comments.service.js';
import {AuditService} from '../backend/dist/modules/audit/audit.service.js';
import {publishTaskNotification} from '../backend/dist/modules/notifications/notification-writer.js';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:6})});
let base;
const origin=process.env.WEB_ORIGIN??'http://localhost:3000',orgs=[];
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
async function req(path,{cookie,method='GET',body,source=origin}={}){
 const r=await fetch(base+path,{method,headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control'),retryAfter:r.headers.get('retry-after')};
}
async function session(userId){
 const token=randomBytes(32).toString('hex');
 await db.session.create({data:{userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 return 'tirek_session='+token;
}
async function tenant(){
 const id=randomUUID();orgs.push(id);
 const org=await db.organization.create({data:{id,name:'Notification QA',users:{create:[
  {name:'Owner',role:'OWNER',email:randomUUID()+'@notifications.invalid',passwordHash:'unused'},
  {name:'Worker',role:'EMPLOYEE',email:randomUUID()+'@notifications.invalid',passwordHash:'unused'},
  {name:'Other worker',role:'EMPLOYEE',email:randomUUID()+'@notifications.invalid',passwordHash:'unused'},
 ]}},include:{users:true}});
 const owner=org.users.find(u=>u.role==='OWNER'),worker=org.users.find(u=>u.name==='Worker'),other=org.users.find(u=>u.name==='Other worker');
 return {id,owner,worker,other,cookie:await session(owner.id),workerCookie:await session(worker.id),otherCookie:await session(other.id)};
}
async function comment(task,cookie,body='Agreement',idempotencyKey=randomUUID()){
 return req('/tasks/'+task.id+'/comments',{cookie,method:'POST',body:{body,idempotencyKey}});
}
test('Personal notifications follow task events, access and concurrent reads',async t=>{
 const server=await isolatedApi();base=server.endpoint;
 try{
  const a=await tenant(),b=await tenant();let task,assignment,workerComment;
  await t.test('assignment is atomic, personal and excludes the author',async()=>{
   const created=await req('/tasks',{...a,method:'POST',body:{title:'Deliver safely',assigneeId:a.worker.id}});
   assert.equal(created.status,201);task=created.body;
   const mine=await req('/notifications',{cookie:a.workerCookie});assert.equal(mine.status,200);assert.equal(mine.cache,'no-store');
   assert.equal(mine.body.total,1);assert.equal(mine.body.unreadCount,1);assignment=mine.body.items[0];
   assert.equal(assignment.kind,'TASK_ASSIGNED');assert.equal(assignment.task.id,task.id);
   assert.deepEqual(Object.keys(assignment).sort(),['actorName','createdAt','id','kind','readAt','task','taskStatus']);
   assert.equal((await req('/notifications',a)).body.total,0);
   assert.equal((await req('/notifications',{cookie:a.otherCookie})).body.total,0);
   const own=await req('/tasks',{...a,method:'POST',body:{title:'Self assigned',assigneeId:a.owner.id}});
   assert.equal(own.status,201);assert.equal((await req('/notifications',a)).body.total,0);
   assert.equal((await req('/notifications/unread-count',{cookie:a.workerCookie})).body.unreadCount,1);
  });
  await t.test('repeated and concurrent comments notify only other active participants once',async()=>{
   const key=randomUUID();
   const results=await Promise.all([1,2,3].map(()=>comment(task,a.cookie,'Do not copy private comment into notification',key)));
   assert.deepEqual(results.map(r=>r.status),[201,201,201]);
   assert.equal(new Set(results.map(r=>r.body.id)).size,1);
   let list=await req('/notifications',{cookie:a.workerCookie});
   assert.equal(list.body.total,2);assert.equal(list.body.items[0].kind,'TASK_COMMENT_ADDED');
   assert.equal(JSON.stringify(list.body).includes('Do not copy'),false);
   assert.equal(await db.notification.count({where:{organizationId:a.id,eventKey:'comment:'+results[0].body.id}}),1);
   const r=await comment(task,a.workerCookie,'Worker response');assert.equal(r.status,201);workerComment=r.body;
   list=await req('/notifications',a);assert.equal(list.body.total,1);assert.equal(list.body.items[0].actorName,'Worker');
   assert.equal((await req('/notifications',{cookie:a.otherCookie})).body.total,0);
   await db.user.update({where:{id:a.worker.id},data:{isActive:false}});
   const silent=await comment(task,a.cookie,'For disabled employee');assert.equal(silent.status,201);
   assert.equal(await db.notification.count({where:{organizationId:a.id,eventKey:'comment:'+silent.body.id}}),0);
   assert.equal((await req('/notifications',{cookie:a.workerCookie})).status,401);
   await db.user.update({where:{id:a.worker.id},data:{isActive:true}});
  });
  await t.test('status changes notify the owner and stale retries do not create another event',async()=>{
   const changed=await req('/tasks/'+task.id+'/status',{cookie:a.workerCookie,method:'PATCH',body:{status:'IN_PROGRESS',version:task.version}});
   assert.equal(changed.status,200);task=changed.body;
   const list=await req('/notifications',a);assert.equal(list.body.total,2);
   assert.equal(list.body.items[0].kind,'TASK_STATUS_CHANGED');assert.equal(list.body.items[0].taskStatus,'IN_PROGRESS');
   const same=await req('/tasks/'+task.id+'/status',{...a,method:'PATCH',body:{status:'IN_PROGRESS',version:task.version}});
   assert.equal(same.status,200);
   assert.equal((await req('/notifications',{cookie:a.workerCookie})).body.total,2);
  });
  await t.test('all read surfaces and writes enforce account and tenant boundaries',async()=>{
   for(const path of ['/notifications','/notifications/unread-count'])assert.equal((await req(path)).status,401);
   for(const actor of [a,b,{cookie:a.otherCookie}])
    assert.equal((await req('/notifications/read',{...actor,method:'POST',body:{ids:[assignment.id]}})).status,404);
   assert.equal((await req('/notifications/read',{cookie:a.workerCookie,method:'POST',source:'https://outside.invalid',body:{ids:[assignment.id]}})).status,403);
   for(const body of [{ids:[]},{ids:['bad']},{ids:[assignment.id,assignment.id.toUpperCase()]},{ids:Array.from({length:101},()=>randomUUID())},{ids:[assignment.id],recipientId:a.owner.id}]){
    assert.equal((await req('/notifications/read',{cookie:a.workerCookie,method:'POST',body})).status,400);
   }
   for(const query of ['recipientId='+a.worker.id,'organizationId='+b.id,'unread=1','unread=','pageSize=101','page=0','page=1&page=2']){
    assert.equal((await req('/notifications?'+query,a)).status,400,query);
   }
   assert.equal((await req('/notifications',b)).body.total,0);
   assert.equal((await req('/notifications/read',{cookie:a.workerCookie,method:'POST',body:{ids:[assignment.id,randomUUID()]}})).status,404);
   assert.equal((await db.notification.findUnique({where:{id:assignment.id}})).readAt,null);
  });
  await t.test('concurrent reads preserve readAt and do not consume newly arrived events',async()=>{
   const known=(await req('/notifications',{cookie:a.workerCookie})).body.items.map(n=>n.id);
   const incoming=await comment(task,a.cookie,'Arrives after list loaded');assert.equal(incoming.status,201);
   const results=await Promise.all([1,2].map(()=>req('/notifications/read',{cookie:a.workerCookie,method:'POST',body:{ids:known}})));
   assert.deepEqual(results.map(r=>r.status),[201,201]);
   const firstRead=(await db.notification.findUnique({where:{id:assignment.id}})).readAt;
   assert.ok(firstRead);assert.ok(firstRead>=new Date(assignment.createdAt));
   assert.equal((await req('/notifications/read',{cookie:a.workerCookie,method:'POST',body:{ids:known}})).status,201);
   assert.equal((await db.notification.findUnique({where:{id:assignment.id}})).readAt.toISOString(),firstRead.toISOString());
   const unread=await req('/notifications?unread=true',{cookie:a.workerCookie});
   assert.equal(unread.body.total,1);assert.equal(unread.body.unreadCount,1);
   assert.equal((await req('/notifications/unread-count',{cookie:a.workerCookie})).body.unreadCount,1);
  });
  await t.test('stable pages and full unread counts handle more than a hundred events',async()=>{
   const createdAt=new Date('2020-01-01T00:00:00Z');
   await db.notification.createMany({data:Array.from({length:105},(_,i)=>({organizationId:a.id,recipientId:a.worker.id,taskId:task.id,kind:'TASK_COMMENT_ADDED',eventKey:'fixture:'+i,actorName:'Historical owner',createdAt}))});
   const items=[];let total;
   for(let page=1;page<=6;page++){
    const r=await req('/notifications?page='+page,{cookie:a.workerCookie});assert.equal(r.status,200);
    total=r.body.total;assert.equal(r.body.unreadCount,106);items.push(...r.body.items);
   }
   assert.equal(items.length,total);assert.equal(new Set(items.map(i=>i.id)).size,total);
   assert.deepEqual((await req('/notifications',{cookie:a.workerCookie})).body.items.map(i=>i.id),items.slice(0,20).map(i=>i.id));
   assert.equal((await req('/notifications?page=99',{cookie:a.workerCookie})).body.items.length,0);
  });
  await t.test('reassignment removes old employee events; list, badge and read recheck live access',async()=>{
   const service=new NotificationsService({client:db});
   const savedIds=(await req('/notifications',{cookie:a.workerCookie})).body.items.map(n=>n.id);
   const changed=await req('/tasks/'+task.id,{...a,method:'PATCH',body:{title:task.title,assigneeId:a.other.id,version:task.version}});
   assert.equal(changed.status,200);task=changed.body;
   assert.equal((await req('/notifications',{cookie:a.workerCookie})).body.total,0);
   assert.equal((await req('/notifications/unread-count',{cookie:a.workerCookie})).body.unreadCount,0);
   assert.equal((await req('/notifications/read',{cookie:a.workerCookie,method:'POST',body:{ids:[savedIds[0]]}})).status,404);
   assert.equal(await db.notification.count({where:{organizationId:a.id,recipientId:a.worker.id,taskId:task.id}}),0);
   assert.equal((await req('/notifications',{cookie:a.otherCookie})).body.items[0].kind,'TASK_ASSIGNED');
   // Direct fixture simulates an event predating access loss, bypassing cleanup intentionally.
   const inaccessible=await db.notification.create({data:{organizationId:a.id,recipientId:a.worker.id,taskId:task.id,kind:'TASK_ASSIGNED',eventKey:'old-event',actorName:'Owner'}});
   assert.equal((await service.list({...a.worker,role:'OWNER'},{page:1,pageSize:20,unread:'false'})).total,0);
   assert.equal((await service.unread(a.worker)).unreadCount,0);
   await assert.rejects(service.read(a.worker,[inaccessible.id]),e=>e.getStatus?.()===404);
   await db.user.update({where:{id:a.worker.id},data:{isActive:false}});
   await assert.rejects(service.list(a.worker,{page:1,pageSize:20,unread:'false'}),e=>e.getStatus?.()===403);
   await db.user.update({where:{id:a.worker.id},data:{isActive:true}});
  });
  await t.test('source event rolls back when notification storage fails; event keys deduplicate',async()=>{
   // Wrap only this test's transaction client. Production constraints stay enabled.
   const wrapped={client:{$transaction:(operation,options)=>db.$transaction(tx=>operation(new Proxy(tx,{get(target,key){
    if(key==='notification')return new Proxy(target.notification,{get(model,method){if(method==='createMany')return async()=>{throw new Error('Notification store unavailable');};return model[method];}});
    return target[key];
   }})),options)}};
   const comments=new TaskCommentsService(wrapped,new AuditService({client:db}));
   const key=randomUUID(),before=await db.auditEvent.count({where:{organizationId:a.id}});
   await assert.rejects(comments.create(a.owner,task.id,{body:'Must roll back source',idempotencyKey:key}),/Notification store unavailable/);
   assert.equal(await db.taskComment.count({where:{organizationId:a.id,idempotencyKey:key}}),0);
   assert.equal(await db.auditEvent.count({where:{organizationId:a.id}}),before);
   const event={organizationId:a.id,taskId:task.id,actorId:a.owner.id,actorName:a.owner.name,kind:'TASK_COMMENT_ADDED',eventKey:'dedup-proof'};
   await db.$transaction(async tx=>{await publishTaskNotification(tx,event);await publishTaskNotification(tx,event);});
   assert.equal(await db.notification.count({where:{organizationId:a.id,eventKey:event.eventKey}}),1);
   const row={organizationId:a.id,recipientId:b.owner.id,taskId:task.id,kind:'TASK_ASSIGNED',eventKey:'foreign',actorName:'invalid'};
   await assert.rejects(db.notification.create({data:row}));
   await assert.rejects(db.notification.create({data:{...row,organizationId:b.id}}));
  });
  await t.test('read rate limit stays enabled and returns Retry-After',async()=>{
   const id=(await req('/notifications',a)).body.items[0].id;let limited;
   for(let i=0;i<61;i++){
    const r=await req('/notifications/read',{...a,method:'POST',body:{ids:[id]}});
    if(r.status===429){limited=r;break;}assert.equal(r.status,201);
   }
   assert.equal(limited?.status,429);assert.ok(Number(limited.retryAfter)>0);
  });
 }finally{
  await server.stop();
  for(const organizationId of orgs){
   await db.businessTask.deleteMany({where:{organizationId}});
   await db.user.deleteMany({where:{organizationId}});
   await db.organization.deleteMany({where:{id:organizationId}});
  }await db.$disconnect();
 }
});
