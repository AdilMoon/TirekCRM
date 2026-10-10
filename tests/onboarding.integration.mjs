import 'dotenv/config';
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registrationSchema } from '@tirek/contracts';
import { OnboardingService } from '../backend/dist/modules/onboarding/onboarding.service.js';
import { registrationEnabled } from '../backend/dist/modules/onboarding/registration-config.js';
import { AuditService } from '../backend/dist/modules/audit/audit.service.js';
import { digest,verifyPassword } from '../backend/dist/auth/session.guard.js';

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:5})});
const service=new OnboardingService({client:db},new AuditService({client:db}));
const prefix='Onboarding-'+randomUUID(),password='OnboardingFixture2026!';
const base=process.env.TEST_API_URL??'http://127.0.0.1:4000/api',origin=process.env.WEB_ORIGIN??'http://localhost:3000';
const input=(name)=>({companyName:prefix+' '+name,ownerName:'Owner fixture',email:randomUUID()+'@onboarding.invalid',password});
async function req(path,{cookie,method='GET',body,source=origin}={}){
 const response=await fetch(base+path,{method,headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],setCookie:response.headers.get('set-cookie'),retryAfter:response.headers.get('retry-after'),cache:response.headers.get('cache-control')};
}
test('Company onboarding: public boundaries, atomic ownership and clean workspaces',async t=>{
 try{
 const httpInput=input('HTTP');let http;
 await t.test('public status does not cache the registration policy and production defaults closed',async()=>{
  const status=await req('/onboarding/status');assert.equal(status.status,200);assert.deepEqual(status.body,{registrationEnabled:true});assert.equal(status.cache,'no-store');
  assert.equal(registrationEnabled({NODE_ENV:'production'}),false);
  assert.equal(registrationEnabled({NODE_ENV:'development'}),true);
  for(const value of ['false','','TRUE','yes'])assert.equal(registrationEnabled({NODE_ENV:'development',REGISTRATION_ENABLED:value}),false);
  assert.equal(registrationEnabled({NODE_ENV:'production',REGISTRATION_ENABLED:'true'}),true);
 });
 await t.test('HTTP rejects foreign Origin, weak passwords and injected tenant or role fields',async()=>{
  assert.equal((await req('/onboarding/register',{method:'POST',source:'https://foreign.invalid',body:httpInput})).status,403);
  assert.equal((await req('/onboarding/register',{method:'POST',body:{...httpInput,password:'short'}})).status,400);
  assert.equal((await req('/onboarding/register',{method:'POST',body:{...httpInput,role:'OWNER',organizationId:randomUUID(),currency:'USD'}})).status,400);
  assert.equal(await db.organization.count({where:{name:httpInput.companyName}}),0);
 });
 await t.test('registration creates exactly one empty KZT company, owner, cookie and nonsecret audit',async()=>{
  http=await req('/onboarding/register',{method:'POST',body:{...httpInput,companyName:' '+httpInput.companyName+' ',ownerName:' Owner fixture ',email:' '+httpInput.email.toUpperCase()+' '}});
  assert.equal(http.status,201);assert.deepEqual(http.body,{ok:true});assert.match(http.setCookie,/HttpOnly/i);assert.match(http.setCookie,/SameSite=Lax/i);
  const user=await db.user.findUnique({where:{email:httpInput.email},include:{organization:true,sessions:true}});
  assert.ok(user);assert.equal(user.role,'OWNER');assert.equal(user.organization.currency,'KZT');assert.equal(user.organization.name,httpInput.companyName);assert.equal(user.name,'Owner fixture');
  assert.equal(user.organization.orderSeq,0);assert.equal(user.organization.documentSeq,0);
  assert.equal(user.sessions.length,1);assert.notEqual(user.passwordHash,password);assert.equal(await verifyPassword(password,user.passwordHash),true);
  assert.equal(user.sessions[0].tokenHash,digest(http.cookie.split('=')[1]));
  const me=await req('/auth/me',{cookie:http.cookie});assert.equal(me.status,200);assert.equal(me.body.role,'OWNER');
  assert.equal('passwordHash' in me.body,false);
  const dashboard=await req('/dashboard',{cookie:http.cookie});assert.equal(dashboard.status,200);
  for(const field of ['received','expenses','cashFlow','outstanding','completedValue'])assert.equal(dashboard.body[field],'0.00');
  for(const field of ['clientsCount','documentsCount','activeOrders'])assert.equal(dashboard.body[field],0);
  for(const path of ['/clients','/orders','/documents','/movements'])assert.equal((await req(path,{cookie:http.cookie})).body.length,0);
  const history=await req('/audit',{cookie:http.cookie});assert.equal(history.body.total,1);assert.equal(history.body.items[0].action,'ORGANIZATION_CREATED');assert.deepEqual(history.body.items[0].metadata,{});
  assert.equal(JSON.stringify(history.body).includes(password),false);assert.equal(JSON.stringify(history.body).includes(httpInput.email),false);
 });
 await t.test('duplicate submission keeps the original account and sixth attempt returns 429',async()=>{
  const original=await db.user.findUnique({where:{email:httpInput.email}});
  const duplicate=await req('/onboarding/register',{method:'POST',body:{...httpInput,companyName:prefix+' Duplicate',password:password+'different'}});
  assert.equal(duplicate.status,409);assert.equal(duplicate.cookie,undefined);
  assert.equal(await db.organization.count({where:{name:prefix+' Duplicate'}}),0);
  assert.equal((await db.user.findUnique({where:{id:original.id}})).passwordHash,original.passwordHash);
  const blocked=await req('/onboarding/register',{method:'POST',body:input('Rate limited')});
  assert.equal(blocked.status,429);assert.ok(Number(blocked.retryAfter)>0);
  assert.equal(await db.organization.count({where:{name:prefix+' Rate limited'}}),0);
 });
 await t.test('names, email and password bounds reject malformed input before storage',async()=>{
  const valid=input('Schema');
  for(const change of [
   {ownerName:' '},{companyName:'\u0000company'},{ownerName:'x\ny'},{companyName:'x'.repeat(161)},
   {email:'bad'},{password:'x'.repeat(129)},{password:'short'},{id:randomUUID()},{isActive:false},
  ])assert.equal(registrationSchema.safeParse({...valid,...change}).success,false,JSON.stringify(change));
  assert.equal(registrationSchema.parse({...valid,email:' '+valid.email.toUpperCase()+' '}).email,valid.email);
 });
 await t.test('two simultaneous requests for the same normalized email cannot create orphan companies',async()=>{
  const value=input('Race');
  const results=await Promise.allSettled([service.register(value,'A'),service.register(registrationSchema.parse({...value,email:value.email.toUpperCase()}),'B')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.getStatus(),409);
  const user=await db.user.findUnique({where:{email:value.email}});
  assert.equal(await db.organization.count({where:{name:value.companyName}}),1);
  assert.equal(await db.session.count({where:{userId:user.id}}),1);
  assert.equal(await db.auditEvent.count({where:{organizationId:user.organizationId}}),1);
 });
 await t.test('failure during audit rolls back company, user and session together',async()=>{
  const value=input('Rollback');
  const failing=new OnboardingService({client:db},{record:async()=>{throw Error('Injected audit failure');}});
  await assert.rejects(()=>failing.register(value,'Rollback browser'),/Injected audit failure/);
  assert.equal(await db.organization.count({where:{name:value.companyName}}),0);
  assert.equal(await db.user.count({where:{email:value.email}}),0);
 });
 await t.test('registration policy is enforced by the service before any database writes',async()=>{
  const previous=process.env.REGISTRATION_ENABLED,value=input('Closed');
  try{
   process.env.REGISTRATION_ENABLED='false';
   await assert.rejects(()=>service.register(value,''),error=>error.getStatus()===403);
   assert.equal(await db.organization.count({where:{name:value.companyName}}),0);
  }finally{if(previous===undefined)delete process.env.REGISTRATION_ENABLED;else process.env.REGISTRATION_ENABLED=previous;}
 });
 await t.test('signed-in owners and employees are not silently switched to a newly created company',async()=>{
  const original=await db.user.findUnique({where:{email:httpInput.email}});
  const hash=digest(http.cookie.split('=')[1]);
  for(const role of ['OWNER','EMPLOYEE']){
   await db.user.update({where:{id:original.id},data:{role}});
   const value=input('Already '+role);
   await assert.rejects(()=>service.register(value,'',hash),error=>error.getStatus()===409);
   assert.equal(await db.organization.count({where:{name:value.companyName}}),0);
  }
  await db.user.update({where:{id:original.id},data:{role:'OWNER'}});
  assert.equal((await req('/auth/me',{cookie:http.cookie})).body.id,original.id);
 });
 await t.test('expired cookies do not prevent a new workspace; tenants never share clients',async()=>{
  const value=input('Expired'),expired=await service.register(value,'Old browser');
  await db.session.update({where:{tokenHash:digest(expired.token)},data:{expiresAt:new Date(Date.now()-1000)}});
  const otherInput=input('Separate'),other=await service.register(otherInput,'New browser',digest(expired.token));
  const otherUser=await db.user.findUnique({where:{email:otherInput.email}});
  await db.client.create({data:{organizationId:otherUser.organizationId,name:'Private onboarding client'}});
  const own=await req('/clients',{cookie:'tirek_session='+other.token});assert.equal(own.body.length,1);
  assert.deepEqual((await req('/clients',{cookie:http.cookie})).body,[]);
  assert.equal((await req('/auth/me',{cookie:'tirek_session='+expired.token})).status,401);
 });

 await t.test('a real production API defaults to closed registration and issues Secure login cookies',async()=>{
  const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const env={...process.env,NODE_ENV:'production',DEMO_SEED:'false',API_PORT:String(port),API_HOST:'127.0.0.1'};
  delete env.REGISTRATION_ENABLED;
  const child=spawn(process.execPath,['backend/dist/main.js'],{env,windowsHide:true,stdio:'ignore'});
  let spawnError;child.on('error',error=>{spawnError=error;});
  const exit=new Promise(resolve=>child.once('close',resolve));
  try{
   const endpoint='http://127.0.0.1:'+port+'/api';
   let response;
   for(let i=0;i<80;i++){
    if(spawnError)throw spawnError;
    if(child.exitCode!==null)throw Error('Production API exited before readiness');
    try{response=await fetch(endpoint+'/onboarding/status',{signal:AbortSignal.timeout(500)});if(response.ok)break;}catch{}
    await delay(150);
   }
   assert.ok(response?.ok,'Production API ready');
   assert.deepEqual(await response.json(),{registrationEnabled:false});
   const value=input('Production closed');
   const denied=await fetch(endpoint+'/onboarding/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
   assert.equal(denied.status,403);assert.equal(await db.user.count({where:{email:value.email}}),0);
   assert.equal(await db.organization.count({where:{name:value.companyName}}),0);
   const login=await fetch(endpoint+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:httpInput.email,password})});
   assert.equal(login.status,201);assert.match(login.headers.get('set-cookie'),/; Secure/i);assert.match(login.headers.get('set-cookie'),/HttpOnly/i);
  }finally{
   if(child.exitCode===null&&!spawnError)child.kill();
   await exit;
  }
 });
 }finally{
  const organizations=await db.organization.findMany({where:{name:{startsWith:prefix}},select:{id:true}});
  const ids=organizations.map(o=>o.id);
  await db.client.deleteMany({where:{organizationId:{in:ids}}});
  await db.user.deleteMany({where:{organizationId:{in:ids}}});
  await db.organization.deleteMany({where:{id:{in:ids}}});
  await db.$disconnect();
 }
});
