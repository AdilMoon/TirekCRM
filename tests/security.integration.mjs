import 'dotenv/config';
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AuthService,cleanUserAgent } from '../backend/dist/auth/auth.service.js';
import { AuditService } from '../backend/dist/modules/audit/audit.service.js';
import { digest,hashPassword,verifyPassword } from '../backend/dist/auth/session.guard.js';

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:6})});
const service=new AuthService({client:db},new AuditService({client:db}));
const base=process.env.TEST_API_URL??'http://127.0.0.1:4000/api',origin=process.env.WEB_ORIGIN??'http://localhost:3000';
const password='SecurityFixture2026!',nextPassword='ChangedSecurity2026!',orgs=[];
async function req(path,{cookie,method='GET',body,source=origin,agent='Security integration'}={}){
 const response=await fetch(base+path,{method,headers:{Origin:source,'User-Agent':agent,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {cacheControl:response.headers.get('cache-control'),retryAfter:response.headers.get('retry-after'),status:response.status,body:await response.json(),setCookie:response.headers.get('set-cookie'),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function tenant(){
 const id=randomUUID();orgs.push(id);
 return db.organization.create({data:{id,name:'Security fixture'}});
}
async function user(org,role='OWNER'){
 return db.user.create({data:{organizationId:org.id,name:'Security '+role,role,email:randomUUID()+'@security.invalid',passwordHash:await hashPassword(password)}});
}
async function session(user,data={}){
 const token=randomBytes(32).toString('hex'),tokenHash=digest(token);
 const row=await db.session.create({data:{tokenHash,userId:user.id,expiresAt:new Date(Date.now()+86400000),userAgent:'Fixture browser',...data}});
 return {...row,token,cookie:'tirek_session='+token};
}
const rejected401=error=>error.getStatus?.()===401;
test('Account security boundaries, revocation and credential races',async t=>{
 try{
 const org=await tenant(),otherOrg=await tenant(),owner=await user(org),employee=await user(org,'EMPLOYEE'),foreign=await user(otherOrg);
 let current=await session(owner),other=await session(owner),worker=await session(employee);
 const outsider=await session(foreign),expired=await session(owner,{expiresAt:new Date(Date.now()-1000)}),legacy=await session(owner,{createdAt:null,userAgent:''});
 await t.test('session list is scoped to the account and exposes only safe metadata',async()=>{
  const result=await req('/auth/sessions',current);assert.equal(result.status,200);assert.equal(result.cacheControl,'no-store');assert.equal(result.body.length,3);
  assert.deepEqual(result.body.map(s=>s.id).sort(),[current.id,other.id,legacy.id].sort());
  for(const item of result.body)assert.deepEqual(Object.keys(item).sort(),['createdAt','current','expiresAt','id','userAgent']);
  assert.equal(result.body.filter(s=>s.current).length,1);assert.equal(result.body.find(s=>s.current).id,current.id);
  assert.equal(result.body.find(s=>s.id===legacy.id).createdAt,null);
  const workerList=await req('/auth/sessions',worker);assert.equal(workerList.status,200);assert.equal(workerList.body.length,1);assert.equal(workerList.body[0].id,worker.id);
  assert.equal((await req('/auth/sessions')).status,401);
  assert.equal((await req('/auth/sessions',expired)).status,401);
 });
 await t.test('foreign, expired and invalid session ids cannot be revoked; Origin is required',async()=>{
  for(const target of [worker,outsider,expired])assert.equal((await req('/auth/sessions/'+target.id,{...current,method:'DELETE'})).status,404);
  assert.equal((await req('/auth/sessions/'+current.id,{...worker,method:'DELETE'})).status,404);
  assert.equal((await req('/auth/sessions/nope',{...current,method:'DELETE'})).status,400);
  assert.equal((await req('/auth/sessions/'+other.id,{...current,method:'DELETE',source:'https://untrusted.invalid'})).status,403);
  assert.equal((await req('/auth/sessions/revoke-others',{...current,method:'POST',source:''})).status,403);
  assert.equal(await db.session.count({where:{id:{in:[worker.id,outsider.id,other.id]}}}),3);
 });
 await t.test('single revocation is immediate and bulk revocation preserves current and foreign accounts',async()=>{
  assert.equal((await req('/auth/sessions/'+other.id,{...current,method:'DELETE'})).status,200);
  assert.equal((await req('/auth/me',other)).status,401);
  assert.equal((await req('/auth/sessions/'+other.id,{...current,method:'DELETE'})).status,404);
  const result=await req('/auth/sessions/revoke-others',{...current,method:'POST'});assert.equal(result.status,201);assert.equal(result.body.count,1);
  assert.equal((await req('/auth/me',legacy)).status,401);
  for(const s of [current,worker,outsider])assert.equal((await req('/auth/me',s)).status,200);
  assert.equal((await req('/auth/sessions/revoke-others',{...current,method:'POST'})).body.count,0);
  await assert.rejects(()=>service.revokeOthers(owner,other.tokenHash),rejected401);
 });
 await t.test('invalid password input and incorrect current credentials do not mutate state',async()=>{
  const before=await db.user.findUnique({where:{id:owner.id}});
  assert.equal((await req('/auth/password',{...current,method:'POST',body:{currentPassword:password,newPassword:'short',organizationId:otherOrg.id}})).status,400);
  assert.equal((await req('/auth/password',{...current,method:'POST',body:{currentPassword:password,newPassword:nextPassword,organizationId:otherOrg.id}})).status,400);
  assert.equal((await req('/auth/password',{...current,method:'POST',body:{currentPassword:'incorrect',newPassword:nextPassword}})).status,403);
  await assert.rejects(()=>service.changePassword(owner,current.tokenHash,password,password,''),error=>error.getStatus?.()===403);
  assert.equal((await db.user.findUnique({where:{id:owner.id}})).passwordHash,before.passwordHash);
  assert.equal((await req('/auth/me',current)).status,200);
 });
 await t.test('password rotation replaces current cookie, revokes all old tokens and audits no secrets',async()=>{
  other=await session(owner);const beforeHash=(await db.user.findUnique({where:{id:owner.id}})).passwordHash;
  const result=await req('/auth/password',{...current,method:'POST',body:{currentPassword:password,newPassword:nextPassword},agent:'New browser '+ 'x'.repeat(400)});
  assert.equal(result.status,201);assert.deepEqual(result.body,{ok:true});
  assert.match(result.setCookie,/HttpOnly/i);assert.match(result.setCookie,/SameSite=Lax/i);assert.notEqual(result.cookie,current.cookie);
  for(const old of [current,other,expired])assert.equal((await req('/auth/me',old)).status,401);
  const cookie=result.cookie,token=cookie.split('=')[1];current={cookie,token,tokenHash:digest(token)};
  assert.equal((await req('/auth/me',current)).status,200);
  const saved=await db.user.findUnique({where:{id:owner.id}});
  assert.notEqual(saved.passwordHash,beforeHash);assert.equal(await verifyPassword(nextPassword,saved.passwordHash),true);
  const stored=await db.session.findMany({where:{userId:owner.id}});assert.equal(stored.length,1);assert.equal(stored[0].userAgent.length,300);
  const audit=await db.auditEvent.findMany({where:{organizationId:org.id,action:'PASSWORD_CHANGED'}});
  assert.equal(audit.length,1);assert.deepEqual(audit[0].metadata,{});
  const serialized=JSON.stringify(audit);
  for(const secret of [password,nextPassword,current.token,current.tokenHash,beforeHash,saved.passwordHash])assert.equal(serialized.includes(secret),false);
  const history=await req('/audit?entityType=ACCOUNT',current);assert.equal(history.status,200);assert.equal(history.body.items.every(e=>e.entityType==='ACCOUNT'),true);
  assert.equal((await req('/auth/login',{method:'POST',body:{email:owner.email,password}})).status,401);
  const login=await req('/auth/login',{method:'POST',body:{email:owner.email,password:nextPassword}});
  assert.equal(login.status,201);
 });
 await t.test('employees can rotate their own credentials without gaining owner rights',async()=>{
  const result=await req('/auth/password',{...worker,method:'POST',body:{currentPassword:password,newPassword:nextPassword}});
  assert.equal(result.status,201);assert.equal((await req('/auth/me',worker)).status,401);worker={cookie:result.cookie};
  assert.equal((await req('/auth/me',worker)).body.role,'EMPLOYEE');
  for(const path of ['/audit','/team','/organization','/dashboard'])assert.equal((await req(path,worker)).status,403);
  assert.equal((await req('/auth/me',outsider)).status,200);
 });
 await t.test('revoking the current session clears cookie and rejects its subsequent requests',async()=>{
  const list=await req('/auth/sessions',worker),id=list.body.find(s=>s.current).id;
  const result=await req('/auth/sessions/'+id,{...worker,method:'DELETE'});
  assert.equal(result.status,200);assert.equal(result.body.current,true);assert.match(result.setCookie,/tirek_session=;/);
  assert.equal((await req('/auth/me',worker)).status,401);
 });
 await t.test('password attempts are rate limited without applying the sixth request',async()=>{
  const result=await req('/auth/password',{...current,method:'POST',body:{currentPassword:nextPassword,newPassword:nextPassword+'X'}});
  assert.equal(result.status,429);assert.ok(Number(result.retryAfter)>0);assert.equal(result.body.message,'Слишком много запросов. Попробуйте позже.');
  assert.equal(await verifyPassword(nextPassword,(await db.user.findUnique({where:{id:owner.id}})).passwordHash),true);
 });
 await t.test('parallel password rotations produce one winner and one active replacement',async()=>{
  const actor=await user(org),s=await session(actor),alternate=nextPassword+'B';
  const results=await Promise.allSettled([
   service.changePassword(actor,s.tokenHash,password,nextPassword,'Race A'),
   service.changePassword(actor,s.tokenHash,password,alternate,'Race B')
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const loser=results.find(r=>r.status==='rejected');assert.equal(loser.reason.getStatus(),401);
  const sessions=await db.session.findMany({where:{userId:actor.id}});assert.equal(sessions.length,1);assert.notEqual(sessions[0].tokenHash,s.tokenHash);
  assert.equal(await db.auditEvent.count({where:{entityId:actor.id,action:'PASSWORD_CHANGED'}}),1);
 });
 await t.test('an old-password login paused before its transaction cannot survive password rotation',async()=>{
  const actor=await user(org),s=await session(actor);
  let resume,notify;const gate=new Promise(resolve=>{resume=resolve;}),ready=new Promise(resolve=>{notify=resolve;});
  const delayed=new AuthService({client:{user:db.user,$transaction:async(...args)=>{notify();await gate;return db.$transaction(...args);}}},new AuditService({client:db}));
  const pending=delayed.login(actor.email,password,'Paused login');
  const checked=assert.rejects(pending,rejected401);
  try{
   await Promise.race([ready,new Promise((_,reject)=>{setTimeout(()=>reject(Error('Login failed to reach transaction barrier')),10000).unref();})]);
   await service.changePassword(actor,s.tokenHash,password,nextPassword,'Rotated browser');
  }finally{resume();}
  await checked;
  assert.equal(await db.session.count({where:{userId:actor.id}}),1);
 });
 await t.test('disabled accounts and revoked in-flight sessions cannot change credentials',async()=>{
  const actor=await user(org),s=await session(actor);
  await db.user.update({where:{id:actor.id},data:{isActive:false}});
  await assert.rejects(()=>service.changePassword(actor,s.tokenHash,password,nextPassword,''),rejected401);
  await assert.rejects(()=>service.login(actor.email,password,''),rejected401);
  await db.user.update({where:{id:actor.id},data:{isActive:true}});
  await db.session.delete({where:{id:s.id}});
  await assert.rejects(()=>service.changePassword(actor,s.tokenHash,password,nextPassword,''),rejected401);
  assert.equal(await db.auditEvent.count({where:{entityId:actor.id}}),0);
 });
 await t.test('parallel successful logins retain at most twenty sessions, pruning legacy and expired ones',async()=>{
  const actor=await user(org);
  const legacySession=await session(actor,{createdAt:null}),old=await session(actor,{expiresAt:new Date(Date.now()-1000)});
  for(let i=0;i<23;i++)await session(actor,{createdAt:new Date(Date.now()-10000+i*10)});
  const results=await Promise.all([service.login(actor.email,password,'Browser A'),service.login(actor.email,password,'Browser B')]);
  const sessions=await db.session.findMany({where:{userId:actor.id}});assert.equal(sessions.length,20);
  assert.equal(sessions.some(s=>s.id===legacySession.id||s.id===old.id),false);
  for(const result of results)assert.equal(sessions.some(s=>s.tokenHash===digest(result.token)),true);
  assert.equal(await db.session.count({where:{userId:foreign.id}}),1);
  assert.equal(cleanUserAgent('Hello\u0000\r\nWorld\u007f'),'HelloWorld');
  assert.equal(cleanUserAgent('x'.repeat(500)).length,300);assert.equal(cleanUserAgent(undefined),'');
 });
 }finally{
  await db.user.deleteMany({where:{organizationId:{in:orgs}}});
  await db.organization.deleteMany({where:{id:{in:orgs}}});
  await db.$disconnect();
 }
});
