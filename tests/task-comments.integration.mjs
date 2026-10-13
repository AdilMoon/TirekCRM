import 'dotenv/config';
import 'reflect-metadata';
import {TaskCommentsService} from '../backend/dist/modules/tasks/task-comments.service.js';
import {AuditService} from '../backend/dist/modules/audit/audit.service.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:3})});
const base=process.env.TEST_API_URL??'http://127.0.0.1:4000/api',origin=process.env.WEB_ORIGIN??'http://localhost:3000',ids=[];
async function req(path,{cookie,method='GET',body,source=origin}={}){
 const r=await fetch(base+path,{method,headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};
}
async function session(userId){
 const token=randomBytes(32).toString('hex');
 await db.session.create({data:{userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 return 'tirek_session='+token;
}
async function tenant(){
 const id=randomUUID();ids.push(id);
 const org=await db.organization.create({data:{id,name:'Discussion QA',users:{create:[
  {email:randomUUID()+'@comments.invalid',name:'Owner',role:'OWNER',passwordHash:'unused'},
  {email:randomUUID()+'@comments.invalid',name:'Worker',role:'EMPLOYEE',passwordHash:'unused'}
 ]}},include:{users:true}});
 const owner=org.users.find(u=>u.role==='OWNER'),worker=org.users.find(u=>u.role==='EMPLOYEE');
 return {id,owner,worker,cookie:await session(owner.id),workerCookie:await session(worker.id)};
}
const input=(body='Agreed delivery')=>({body,idempotencyKey:randomUUID()});
test('Task discussions preserve agreements and enforce current assignment',async t=>{
 try{
  const a=await tenant(),b=await tenant();
  const task=await db.businessTask.create({data:{organizationId:a.id,assigneeId:a.worker.id,createdById:a.owner.id,title:'Assigned'}});
  const other=await db.businessTask.create({data:{organizationId:a.id,assigneeId:a.owner.id,createdById:a.owner.id,title:'Owner only'}});
  const path='/tasks/'+task.id+'/comments';let saved,operation;
  await t.test('owner and assignee comment with server-owned identity and atomic audit',async()=>{
   operation=input('  Agreed delivery\nЕртең · tomorrow  ');
   const r=await req(path,{...a,method:'POST',body:operation});assert.equal(r.status,201);saved=r.body;
   assert.equal(saved.body,operation.body.trim());assert.equal(saved.authorId,a.owner.id);assert.equal(saved.authorName,'Owner');
   assert.deepEqual(Object.keys(saved).sort(),['authorId','authorName','body','createdAt','id']);
   assert.equal(r.cache,'no-store');
   const worker=await req(path,{cookie:a.workerCookie,method:'POST',body:input('<img src=x onerror=alert(1)>')});
   assert.equal(worker.status,201);assert.equal(worker.body.authorId,a.worker.id);
   assert.equal((await db.businessTask.findUnique({where:{id:task.id}})).version,task.version);
   const events=await db.auditEvent.findMany({where:{organizationId:a.id,entityId:task.id,action:'TASK_COMMENT_ADDED'}});
   assert.equal(events.length,2);assert.deepEqual(events.find(e=>e.actorId===a.owner.id).metadata,{commentId:saved.id});
   assert.equal(JSON.stringify(events).includes('Agreed delivery'),false);
  });
  await t.test('identical retries and parallel submissions create one comment and one audit event',async()=>{
   const retry=await req(path,{...a,method:'POST',body:operation});assert.equal(retry.body.id,saved.id);
   const concurrent=input('Concurrent delivery');
   const results=await Promise.all([1,2,3].map(()=>req(path,{...a,method:'POST',body:concurrent})));
   assert.deepEqual(results.map(r=>r.status),[201,201,201]);assert.equal(new Set(results.map(r=>r.body.id)).size,1);
   assert.equal(await db.taskComment.count({where:{organizationId:a.id,idempotencyKey:concurrent.idempotencyKey}}),1);
   assert.equal(await db.auditEvent.count({where:{organizationId:a.id,action:'TASK_COMMENT_ADDED',metadata:{path:['commentId'],equals:results[0].body.id}}}),1);
   assert.equal((await req(path,{...a,method:'POST',body:{...operation,body:'Changed intent'}})).status,409);
   assert.equal((await req('/tasks/'+other.id+'/comments',{...a,method:'POST',body:operation})).status,409);
   const independent=await req(path,{cookie:a.workerCookie,method:'POST',body:operation});
   assert.equal(independent.status,201);assert.notEqual(independent.body.id,saved.id);
  });
  await t.test('unauthorized users cannot read, append, replay or forge scope and authors',async()=>{
   assert.equal((await req(path)).status,401);
   for(const p of [path,'/tasks/'+other.id+'/comments']){
    assert.equal((await req(p,b)).status,404);
    assert.equal((await req(p,{...b,method:'POST',body:input()})).status,404);
   }
   assert.equal((await req('/tasks/'+other.id+'/comments',{cookie:a.workerCookie})).status,404);
   assert.equal((await req('/tasks/'+other.id+'/comments',{cookie:a.workerCookie,method:'POST',body:input()})).status,404);
   assert.equal((await req(path,{...a,method:'POST',body:input(),source:'https://invalid.example'})).status,403);
   for(const field of [{organizationId:b.id},{authorId:b.owner.id},{authorName:'Forged'}]){
    assert.equal((await req(path,{...a,method:'POST',body:{...input(),...field}})).status,400);
   }
   for(const q of ['page=0','pageSize=101','q=ignored','organizationId='+b.id,'page=1&page=2']){
    assert.equal((await req(path+'?'+q,a)).status,400);
   }
   assert.equal((await req('/tasks/not-a-uuid/comments',a)).status,400);
  });
  await t.test('rejects empty, excessive and control input; text and dates round trip',async()=>{
   for(const body of ['', ' \n\t ', 'a'.repeat(2001), 'nul\u0000byte', 'escape\u001btext']){
    assert.equal((await req(path,{...a,method:'POST',body:input(body)})).status,400);
   }
   const max=await req(path,{...a,method:'POST',body:input('қ'.repeat(2000))});assert.equal(max.status,201);
   assert.equal(max.body.body.length,2000);assert.equal(new Date(max.body.createdAt).toISOString(),max.body.createdAt);
  });
  await t.test('stable pages retain author snapshot and never include another task or tenant',async()=>{
   const createdAt=new Date('2020-01-01T00:00:00Z');
   await db.taskComment.createMany({data:Array.from({length:105},(_,i)=>({organizationId:a.id,taskId:task.id,authorId:a.owner.id,authorName:'Historic owner',body:'Old message '+i,idempotencyKey:randomUUID(),createdAt}))});
   await db.user.update({where:{id:a.owner.id},data:{name:'Renamed owner'}});
   const total=await db.taskComment.count({where:{organizationId:a.id,taskId:task.id}});
   const items=[];
   for(let page=1;page<=Math.ceil(total/20);page++){
    const r=await req(path+'?pageSize=20&page='+page,a);assert.equal(r.status,200);assert.equal(r.body.total,total);assert.equal(r.cache,'no-store');items.push(...r.body.items);
   }
   assert.equal(items.length,total);assert.equal(new Set(items.map(i=>i.id)).size,total);
   assert.equal(items.find(i=>i.id===saved.id).authorName,'Owner');
   assert.equal((await req(path+'?page=999',a)).body.items.length,0);
   assert.equal((await req('/tasks/'+other.id+'/comments',a)).body.total,0);
   assert.deepEqual((await req(path+'?pageSize=20',a)).body.items.map(i=>i.id),items.slice(0,20).map(i=>i.id));
  });
  await t.test('transaction rechecks stale permissions and rolls back a failed audit',async()=>{
   const service=new TaskCommentsService({client:db},new AuditService({client:db}));
   const rollback=input('Must roll back');
   const failing=new TaskCommentsService({client:db},{record:async()=>{throw new Error('Simulated audit failure');}});
   await assert.rejects(failing.create(a.owner,task.id,rollback),/Simulated audit failure/);
   assert.equal(await db.taskComment.count({where:{organizationId:a.id,idempotencyKey:rollback.idempotencyKey}}),0);
   const staleOwner={...a.owner};
   await db.user.update({where:{id:a.owner.id},data:{role:'EMPLOYEE'}});
   // The task is assigned to the worker; an already-resolved owner role must not grant access.
   await assert.rejects(service.list(staleOwner,task.id,{page:1,pageSize:20}),e=>e.getStatus?.()===404);
   await assert.rejects(service.create(staleOwner,task.id,input()),e=>e.getStatus?.()===404);
   await db.user.update({where:{id:a.owner.id},data:{role:'OWNER',isActive:false}});
   await assert.rejects(service.create(staleOwner,task.id,input()),e=>e.getStatus?.()===403);
   await db.user.update({where:{id:a.owner.id},data:{isActive:true}});
  });
  await t.test('reassignment revokes old access including idempotent retries; new assignee sees history',async()=>{
   const transferred=await req('/tasks/'+task.id,{...a,method:'PATCH',body:{title:task.title,assigneeId:a.owner.id,version:task.version}});
   assert.equal(transferred.status,200);
   assert.equal((await req(path,{cookie:a.workerCookie})).status,404);
   assert.equal((await req(path,{cookie:a.workerCookie,method:'POST',body:operation})).status,404);
   assert.ok((await req(path,a)).body.total>100);
   await db.user.update({where:{id:a.owner.id},data:{isActive:false}});
   assert.equal((await req(path,a)).status,401);
   await db.user.update({where:{id:a.owner.id},data:{isActive:true}});
  });
  await t.test('database rejects links across organizations',async()=>{
   await assert.rejects(db.taskComment.create({data:{organizationId:b.id,taskId:task.id,authorId:b.owner.id,authorName:'Foreign',...input()}}));
   await assert.rejects(db.taskComment.create({data:{organizationId:a.id,taskId:task.id,authorId:b.owner.id,authorName:'Foreign',...input()}}));
  });
 }finally{
  for(const organizationId of ids){
   await db.businessTask.deleteMany({where:{organizationId}});
   await db.user.deleteMany({where:{organizationId}});
   await db.organization.deleteMany({where:{id:organizationId}});
  }
  await db.$disconnect();
 }
});
