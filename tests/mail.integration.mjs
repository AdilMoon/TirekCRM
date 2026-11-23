import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { MailQueue, encryptReset } from '../backend/dist/modules/mail/mail-queue.js';
import { MailWorker } from '../backend/dist/modules/mail/mail-worker.js';
import { OnboardingService } from '../backend/dist/modules/onboarding/onboarding.service.js';
import { AuthService } from '../backend/dist/auth/auth.service.js';
import { AuditService } from '../backend/dist/modules/audit/audit.service.js';
import { PasswordResetService } from '../backend/dist/auth/password-reset.service.js';
import { digest,hashPassword } from '../backend/dist/auth/session.guard.js';

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:6})}),audit=new AuditService({client:db}),queue=new MailQueue();
const prefix='Account mail QA '+randomUUID(),orgs=[],password='MailFixtureOriginal2026!',newPassword='MailFixtureChanged2026!';
async function user(){
 const id=randomUUID();orgs.push(id);
 const org=await db.organization.create({data:{id,name:prefix,users:{create:{name:'Mail owner',role:'OWNER',email:randomUUID()+'@mail.invalid',passwordHash:await hashPassword(password)}}},include:{users:true}});
 return org.users[0];
}
async function session(actor){const token=randomBytes(32).toString('hex');await db.session.create({data:{userId:actor.id,tokenHash:digest(token),expiresAt:new Date(Date.now()+3600000)}});return token;}
// Scope the test worker's database adapter to its own organization. It cannot
// claim pending user mail from the running application, and never connects to SMTP.
function worker(actor,send,mode='local',key=Buffer.alloc(0)){
 const client={mailMessage:{
  findFirst:args=>db.mailMessage.findFirst({...args,where:{...args.where,organizationId:actor.organizationId}}),
  updateMany:args=>db.mailMessage.updateMany({...args,where:{...args.where,organizationId:actor.organizationId}}),
 },passwordReset:db.passwordReset};
 return new MailWorker({client},{mode,config:{key},send});
}

test('account mail is transactional, encrypted where needed and retried without crossing tenant or mode boundaries',async t=>{
 try{
  await t.test('registration commits exactly one welcome message and workers do not send it twice',async()=>{
   const email=randomUUID()+'@mail.invalid',service=new OnboardingService({client:db},audit,queue);
   await service.register({companyName:prefix+' registered',ownerName:'Owner',email,password},'Mail QA');
   const actor=await db.user.findUniqueOrThrow({where:{email}});orgs.push(actor.organizationId);
   const messages=await db.mailMessage.findMany({where:{userId:actor.id}});assert.equal(messages.length,1);assert.equal(messages[0].kind,'WELCOME');assert.equal(messages[0].recipient,email);assert.equal(messages[0].payload,null);
   const sent=[],first=worker(actor,async message=>{sent.push(message);await delay(30);}),second=worker(actor,async message=>sent.push(message));
   await Promise.all([first.runOnce(),second.runOnce()]);assert.equal(sent.length,1);assert.match(sent[0].subject,/регистрация/);assert.ok(!sent[0].text.includes(password));
   assert.equal(await first.runOnce(),0);assert.equal((await db.mailMessage.findUniqueOrThrow({where:{id:messages[0].id}})).status,'SENT');
  });
  await t.test('ordinary password changes and recovery create notifications without passwords or reset tokens',async()=>{
   const actor=await user(),auth=new AuthService({client:db},audit,queue),token=await session(actor);
   await auth.changePassword(actor,digest(token),password,newPassword,'Mail QA');
   const delivered=[],reset=new PasswordResetService({client:db},audit,{enabled:true,send:async message=>delivered.push(message)},queue);
   await reset.request(actor.email);await reset.confirm(delivered[0].token,newPassword+'Again');
   const sent=[];assert.equal(await worker(actor,async message=>sent.push(message)).runOnce(),2);
   for(const message of sent){assert.match(message.subject,/пароль изменён/);for(const secret of [password,newPassword,delivered[0].token])assert.ok(!message.text.includes(secret));}
  });
  await t.test('queue failure rolls back registration, password change and reset consumption',async()=>{
   const broken={enqueue:async()=>{throw Error('queue unavailable');}},service=new OnboardingService({client:db},audit,broken);
   await assert.rejects(()=>service.register({companyName:prefix+' rollback',ownerName:'Owner',email:randomUUID()+'@mail.invalid',password},''),/queue unavailable/);
   assert.equal(await db.organization.count({where:{name:prefix+' rollback'}}),0);
   const actor=await user(),token=await session(actor),auth=new AuthService({client:db},audit,broken);
   await assert.rejects(()=>auth.changePassword(actor,digest(token),password,newPassword,''),/queue unavailable/);
   assert.equal((await db.user.findUniqueOrThrow({where:{id:actor.id}})).passwordHash,actor.passwordHash);assert.equal(await db.session.count({where:{userId:actor.id}}),1);
   const captured=[],reset=new PasswordResetService({client:db},audit,{enabled:true,send:async message=>captured.push(message)},broken);
   await reset.request(actor.email);await assert.rejects(()=>reset.confirm(captured[0].token,newPassword),/queue unavailable/);
   assert.equal(await db.passwordReset.count({where:{userId:actor.id}}),1);assert.equal(await db.auditEvent.count({where:{entityId:actor.id}}),0);
  });
  await t.test('leases, backoff and terminal failures prevent tight retries and do not store provider error details',async()=>{
   const actor=await user();await queue.enqueue(db,actor,'PASSWORD_CHANGED');
   const row=await db.mailMessage.findFirstOrThrow({where:{userId:actor.id}}),logs=[];
   await db.mailMessage.update({where:{id:row.id},data:{leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+60000)}});
   const failed=worker(actor,async()=>{throw Error(actor.email+' private provider detail');});failed.logger={warn:text=>logs.push(text),error:text=>logs.push(text)};
   assert.equal(await failed.runOnce(),0);
   await db.mailMessage.update({where:{id:row.id},data:{leaseUntil:new Date(0)}});await failed.runOnce();
   let stored=await db.mailMessage.findUniqueOrThrow({where:{id:row.id}});assert.equal(stored.status,'PENDING');assert.equal(stored.attempts,1);assert.equal(stored.lastErrorCode,'DELIVERY_FAILED');assert.ok(stored.nextAttemptAt>new Date());
   assert.equal(await failed.runOnce(),0);
   await db.mailMessage.update({where:{id:row.id},data:{attempts:5,nextAttemptAt:new Date(0)}});await failed.runOnce();
   stored=await db.mailMessage.findUniqueOrThrow({where:{id:row.id}});assert.equal(stored.status,'FAILED');assert.equal(stored.attempts,6);assert.deepEqual(logs,['MAIL_DELIVERY_FAILED','MAIL_DELIVERY_FAILED']);
   assert.ok(!JSON.stringify(logs).includes(actor.email));
  });
  await t.test('local notifications are never later replayed into Gmail',async()=>{
   const actor=await user();await queue.enqueue(db,actor,'WELCOME');let count=0;
   assert.equal(await worker(actor,async()=>{count++;},'gmail').runOnce(),0);assert.equal(count,0);
   assert.equal((await db.mailMessage.findFirstOrThrow({where:{userId:actor.id}})).deliveryMode,'local');
  });
  await t.test('Gmail reset payload is encrypted in the transaction and removed after delivery or expiry',async()=>{
   const actor=await user(),token=randomBytes(32).toString('hex'),key=Buffer.alloc(32,9),expiresAt=new Date(Date.now()+60000);
   await db.passwordReset.create({data:{userId:actor.id,tokenHash:digest(token),credentialHash:digest(actor.passwordHash),expiresAt}});
   const names=['MAIL_DELIVERY','GMAIL_USER','GMAIL_APP_PASSWORD','MAIL_ENCRYPTION_KEY'],old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
   let id;
   try{
    Object.assign(process.env,{MAIL_DELIVERY:'gmail',GMAIL_USER:'fixture@example.invalid',GMAIL_APP_PASSWORD:'a'.repeat(16),MAIL_ENCRYPTION_KEY:key.toString('hex')});
    await db.$transaction(async tx=>{
     await queue.reset(tx,actor,token,expiresAt);const row=await tx.mailMessage.findFirstOrThrow({where:{userId:actor.id}});id=row.id;
     assert.equal(row.deliveryMode,'gmail');assert.ok(!JSON.stringify(row).includes(token));
     // Commit only local test work; the running Gmail worker cannot claim it.
     await tx.mailMessage.update({where:{id},data:{deliveryMode:'local'}});
    });
   }finally{for(const name of names)if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}
   const sent=[];assert.equal(await worker(actor,async message=>sent.push(message),'local',key).runOnce(),1);
   assert.ok(sent[0].text.includes((process.env.WEB_ORIGIN ?? 'http://localhost:3000')+'/reset-password#token='+token));
   assert.equal((await db.mailMessage.findUniqueOrThrow({where:{id}})).payload,null);
   const staleId=randomUUID();await db.mailMessage.create({data:{id:staleId,userId:actor.id,organizationId:actor.organizationId,recipient:actor.email,kind:'PASSWORD_RESET',eventKey:randomUUID(),deliveryMode:'local',payload:encryptReset(token,staleId,actor.id,key),expiresAt:new Date(0)}});
   assert.equal(await worker(actor,async()=>{throw Error('Expired token must not be sent');},'local',key).runOnce(),0);
   const skipped=await db.mailMessage.findUniqueOrThrow({where:{id:staleId}});assert.equal(skipped.status,'SKIPPED');assert.equal(skipped.payload,null);
  });
 }finally{
  for(const organizationId of orgs){await db.user.deleteMany({where:{organizationId}});await db.organization.deleteMany({where:{id:organizationId}});}
  await db.$disconnect();
 }
});
