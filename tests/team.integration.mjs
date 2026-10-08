import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,scryptSync,createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:3})});
const base=process.env.TEST_API_URL??'http://127.0.0.1:4000/api',origin=process.env.WEB_ORIGIN??'http://localhost:3000';
const password='TeamIntegration2026!',salt=randomBytes(16).toString('hex'),passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex'),ids=[];
async function req(path,{cookie,method='GET',body,origin:source=origin}={}){
 const response=await fetch(base+path,{method,headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function tenant(){
 const id=randomUUID();ids.push(id);const email=id+'@team.invalid';
 const org=await db.organization.create({data:{id,name:'Team test',users:{create:{name:'Owner',email,passwordHash,role:'OWNER'}}},include:{users:true}});
 const login=await req('/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,201);
 return {id,user:org.users[0],cookie:login.cookie};
}
test('Team permissions, invitations and assigned tasks',async t=>{
 try{
 const a=await tenant(),b=await tenant();let invite,employee,cookie,task,otherTask;
 await t.test('owner issues a single-use invitation and never exposes token hashes',async()=>{
  const email=randomUUID()+'@team.invalid';
  const result=await req('/team/invitations',{...a,method:'POST',body:{name:'Employee',email}});assert.equal(result.status,201);invite=result.body;assert.match(invite.token,/^[a-f0-9]{64}$/);
  const stored=await db.invitation.findUnique({where:{id:invite.id}});assert.equal(stored.tokenHash,createHash('sha256').update(invite.token).digest('hex'));assert.equal('tokenHash' in invite,false);
  const listed=await req('/team',a);assert.equal(JSON.stringify(listed.body).includes(invite.token),false);assert.equal('passwordHash' in listed.body.members[0],false);
  assert.equal((await req('/team',b)).body.invitations.length,0);
  assert.equal((await req('/team/invitations/'+invite.id+'/revoke',{...b,method:'POST'})).status,404);
  assert.equal((await req('/team/invitations',{...a,method:'POST',body:{name:'Again',email}})).status,409);
  const preview=await req('/team/invitations/preview',{method:'POST',body:{token:invite.token}});assert.equal(preview.body.organization,'Team test');
  assert.equal((await req('/team/invitations/accept',{method:'POST',body:{token:invite.token,password:'short'}})).status,400);
  assert.equal((await req('/team/invitations/accept',{method:'POST',body:{token:invite.token,password},origin:'https://untrusted.invalid'})).status,403);
  const accepted=await Promise.all([1,2].map(()=>req('/team/invitations/accept',{method:'POST',body:{token:invite.token,password}})));
  assert.deepEqual(accepted.map(r=>r.status).sort(),[201,404]);assert.equal((await req('/team/invitations/preview',{method:'POST',body:{token:invite.token}})).status,404);
  employee=await db.user.findUnique({where:{email}});assert.equal(employee.role,'EMPLOYEE');
  const login=await req('/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,201);cookie=login.cookie;
  const me=await req('/auth/me',{cookie});assert.equal(me.body.role,'EMPLOYEE');assert.equal(me.body.id,employee.id);
 });
 await t.test('revoked and expired invitations cannot create accounts',async()=>{
  for(const mode of ['revoked','expired']){
   const result=await req('/team/invitations',{...a,method:'POST',body:{name:mode,email:randomUUID()+'@team.invalid'}});assert.equal(result.status,201);
   if(mode==='revoked')assert.equal((await req('/team/invitations/'+result.body.id+'/revoke',{...a,method:'POST'})).status,201);
   else await db.invitation.update({where:{id:result.body.id},data:{expiresAt:new Date(Date.now()-1000)}});
   assert.equal((await req('/team/invitations/accept',{method:'POST',body:{token:result.body.token,password}})).status,404);
  }
 });
 await t.test('employee is denied every owner route, including writes',async()=>{
  const id=randomUUID();
  for(const path of ['/dashboard','/organization','/clients','/clients/search','/orders','/orders/search','/orders/'+id,'/movements','/documents','/documents/'+id,'/audit','/team'])
   assert.equal((await req(path,{cookie})).status,403,path);
  for(const [method,path]of [['POST','/clients'],['PATCH','/clients/'+id],['POST','/orders'],['PATCH','/orders/'+id],['PATCH','/orders/'+id+'/status'],['POST','/orders/'+id+'/payments'],['POST','/orders/'+id+'/documents'],['POST','/expenses'],['PATCH','/organization'],['POST','/team/invitations'],['POST','/team/invitations/'+id+'/revoke'],['PATCH','/team/members/'+id],['POST','/tasks'],['PATCH','/tasks/'+id]])
   assert.equal((await req(path,{cookie,method,body:{}})).status,403,method+' '+path);
 });
 await t.test('tasks enforce same-company links and return only safe operational fields',async()=>{
  const client=await db.client.create({data:{organizationId:a.id,name:'Private customer'}});
  const order=await db.order.create({data:{organizationId:a.id,clientId:client.id,number:1,title:'Order brief',notes:'Private financial notes',total:'100.00'}});
  const input={title:'Assigned work',description:'Operational brief',assigneeId:employee.id,orderId:order.id,dueDate:'2026-12-01'};
  assert.equal((await req('/tasks',{...a,method:'POST',body:{...input,assigneeId:b.user.id}})).status,404);
  assert.equal((await req('/tasks',{...b,method:'POST',body:{...input,assigneeId:b.user.id}})).status,404);
  const created=await req('/tasks',{...a,method:'POST',body:input});assert.equal(created.status,201);task=created.body;
  otherTask=(await req('/tasks',{...a,method:'POST',body:{title:'Owner work',assigneeId:a.user.id}})).body;
  const listed=await req('/tasks?assigneeId='+a.user.id,{cookie});assert.equal(listed.body.total,1);assert.equal(listed.body.items[0].id,task.id);
  assert.deepEqual(Object.keys(task.order).sort(),['id','number','title']);assert.equal(JSON.stringify(task).includes('Private'),false);
  assert.equal((await req('/tasks/'+otherTask.id,{cookie})).status,404);assert.equal((await req('/tasks/'+task.id,b)).status,404);
  assert.equal((await req('/tasks',b)).body.total,0);
  assert.equal((await req('/tasks?pageSize=101',a)).status,400);
 });
 await t.test('task changes check version and allowed transitions atomically',async()=>{
  const change=(id,status,version=1,auth={cookie})=>req('/tasks/'+id+'/status',{...auth,method:'PATCH',body:{status,version}});
  assert.equal((await change(otherTask.id,'IN_PROGRESS')).status,404);
  assert.equal((await change(task.id,'CANCELLED')).status,403);assert.equal((await change(task.id,'DONE')).status,403);
  const results=await Promise.all([1,2].map(()=>change(task.id,'IN_PROGRESS')));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await change(task.id,'DONE',1)).status,409);
  assert.equal((await change(task.id,'DONE',2)).status,200);
  assert.equal((await change(task.id,'TODO',3)).status,403);
  assert.equal((await change(task.id,'TODO',3,a)).status,200);
  assert.equal((await req('/tasks/'+task.id,{...a,method:'PATCH',body:{title:'Reassigned',assigneeId:a.user.id,version:1}})).status,409);
  const updated=await req('/tasks/'+task.id,{...a,method:'PATCH',body:{title:'Reassigned',assigneeId:a.user.id,version:4}});
  assert.equal(updated.status,200);assert.equal((await req('/tasks/'+task.id,{cookie})).status,404);
  const logs=(await req('/audit?entityType=TASK&entityId='+task.id,a)).body.items;assert.equal(logs.length,5);
  assert.equal(logs.filter(l=>l.action==='TASK_STATUS_CHANGED'&&l.actorName==='Employee').length,2);
 });
 await t.test('deactivation invalidates existing sessions and prevents login; owner protected',async()=>{
  assert.equal((await req('/team/members/'+a.user.id,{...a,method:'PATCH',body:{isActive:false,version:1}})).status,403);
  assert.equal((await req('/team/members/'+employee.id,{...b,method:'PATCH',body:{isActive:false,version:1}})).status,404);
  assert.equal((await req('/team/members/'+employee.id,{...a,method:'PATCH',body:{isActive:false,version:1}})).status,200);
  assert.equal((await req('/auth/me',{cookie})).status,401);assert.equal((await req('/tasks',{cookie})).status,401);
  assert.equal(await db.session.count({where:{userId:employee.id}}),0);
  assert.equal((await req('/auth/login',{method:'POST',body:{email:employee.email,password}})).status,401);
  assert.equal((await req('/tasks',{...a,method:'POST',body:{title:'Inactive',assigneeId:employee.id}})).status,404);
  assert.equal((await req('/team/members/'+employee.id,{...a,method:'PATCH',body:{isActive:true,version:1}})).status,409);
  assert.equal((await req('/team/members/'+employee.id,{...a,method:'PATCH',body:{isActive:true,version:2}})).status,200);
  const login=await req('/auth/login',{method:'POST',body:{email:employee.email,password}});assert.equal(login.status,201);
  assert.equal((await req('/tasks',{cookie})).status,401);
  assert.equal((await req('/auth/logout',{cookie:login.cookie,method:'POST'})).status,201);
 });
 }finally{
  for(const organizationId of ids){
   await db.businessTask.deleteMany({where:{organizationId}});await db.order.deleteMany({where:{organizationId}});await db.client.deleteMany({where:{organizationId}});await db.user.deleteMany({where:{organizationId}});await db.organization.deleteMany({where:{id:organizationId}});
  }await db.$disconnect();
 }
});
