import 'dotenv/config';
import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,randomInt,createHash} from 'node:crypto';
import sharp from 'sharp';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {TelegramService} from '../backend/dist/modules/telegram/telegram.service.js';
import {TelegramProcessor} from '../backend/dist/modules/telegram/telegram-processor.js';
import {TelegramWorker} from '../backend/dist/modules/telegram/telegram-worker.js';
import {TelegramTransportError} from '../backend/dist/modules/telegram/telegram-transport.js';
import {TasksService} from '../backend/dist/modules/tasks/tasks.service.js';
import {PassportService} from '../backend/dist/modules/smart-orders/passport.service.js';
import {AuditService} from '../backend/dist/modules/audit/audit.service.js';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:6})});
const org=randomUUID(),otherOrg=randomUUID(),botId='700000'+randomInt(100000,999999),senderId='800000'+randomInt(100000,999999);
const audit=new AuditService({client:db}),tasks=new TasksService({client:db},audit),passports=new PassportService({client:db},audit);
class FakeTelegram {
 config={enabled:true,token:'fixture-not-a-real-token',botId};messages=[];updates=[];forced=null;image=null;downloadHook=null;fail=0;delay=0;polls=0;
 async me(){return {id:Number(botId),username:'fixture_tirek_bot'};}
 async call(method,body){if(method==='getWebhookInfo')return {url:''};if(method==='answerCallbackQuery')return true;if(method==='getUpdates'){this.polls++;if(this.delay)await new Promise(r=>setTimeout(r,this.delay));if(this.forced){const r=this.forced;this.forced=null;return r;}return this.updates.filter(u=>u.update_id>=Number(body.offset??0));}throw Error('Unexpected fake Telegram method');}
 async send(chatId,text,buttons){if(this.fail){const code=this.fail;this.fail=0;throw new TelegramTransportError(code,1);}this.messages.push({chatId,text,buttons});return {message_id:this.messages.length};}
 async photo(){if(this.downloadHook){const hook=this.downloadHook;this.downloadHook=null;await hook();}return this.image;}
}
const fake=new FakeTelegram(),service=new TelegramService({client:db},fake,audit),processor=new TelegramProcessor({client:db},service,fake,passports),worker=new TelegramWorker({client:db},fake,processor,service);
let updateId=0;
const update=(text,extra={})=>({update_id:++updateId,message:{message_id:updateId,date:Math.floor(Date.now()/1000),from:{id:Number(senderId),first_name:'Test Employee',username:'staff_fixture',language_code:'kk'},chat:{id:Number(senderId),type:'private'},...(text?{text}:{}),...extra}});
const callback=data=>({update_id:++updateId,callback_query:{id:'fixture'+updateId,from:{id:Number(senderId),first_name:'Test Employee'},message:{message_id:999,from:{id:Number(botId),is_bot:true},chat:{id:Number(senderId),type:'private'}},data}});
async function user(organizationId,role){const u=await db.user.create({data:{organizationId,name:'TG '+role,email:randomUUID()+'@telegram.invalid',role,passwordHash:'unused'}}),token=randomBytes(32).toString('hex');await db.session.create({data:{userId:u.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});return {...u,cookie:'tirek_session='+token};}
const status=n=>e=>e.getStatus?.()===n;
async function req(path,body,cookie,method='POST',origin=process.env.WEB_ORIGIN??'http://localhost:3000'){const r=await fetch((process.env.TEST_API_URL??'http://127.0.0.1:4000/api')+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
test('Telegram employee binding notifications and result photos preserve identity tenant permissions and retries',async t=>{
 try{
  await db.organization.createMany({data:[{id:org,name:'TG fixture'},{id:otherOrg,name:'Other TG fixture'}]});
  const owner=await user(org,'OWNER'),employee=await user(org,'EMPLOYEE'),colleague=await user(org,'EMPLOYEE'),foreign=await user(otherOrg,'EMPLOYEE');
  const client=await db.client.create({data:{organizationId:org,name:'Private client',phone:'+77009998877'}}),order=await db.order.create({data:{organizationId:org,clientId:client.id,number:1,title:'Order title',total:'12345.67',notes:'secret client notes'}});
  const ownTask=await tasks.create(owner,{title:'Assigned cleaning',description:'Clean the office',assigneeId:employee.id,orderId:order.id,dueDate:null});
  const otherTask=await tasks.create(owner,{title:'Private colleague task',description:'not for employee',assigneeId:colleague.id,orderId:order.id,dueDate:null});
  let pair,link;
  await t.test('HTTP auth Origin strict identities and two-step employee-only linking',async()=>{
   assert.equal((await req('/telegram',undefined,undefined,'GET')).status,401);assert.equal((await req('/telegram/pair',{locale:'ru',userId:colleague.id},employee.cookie)).status,400);assert.equal((await req('/telegram',undefined,employee.cookie,'DELETE','')).status,403);
   await assert.rejects(()=>service.pair(owner,'ru'),status(403));
   pair=await service.pair(employee,'kk');const token=new URL(pair.url).searchParams.get('start');
   const row=await db.telegramPairing.findUniqueOrThrow({where:{userId:employee.id}});assert.notEqual(row.tokenHash,token);assert.equal(JSON.stringify(await db.auditEvent.findMany({where:{organizationId:org}})).includes(token),false);
   const start=update('/start '+token);await processor.handle(start);assert.equal(await db.telegramLink.count({where:{organizationId:org}}),0);
   assert.equal((await service.status(employee)).pending.claimed,true);assert.equal((await service.status(colleague)).pending,null);
   assert.equal(await service.claim(botId,token,{id:'123456',name:'Other claimant',username:''}),false);
   await assert.rejects(()=>service.confirm(colleague,pair.id,'ru'),status(409));link=await service.confirm(employee,pair.id,'kk');assert.equal(link.locale,'kk');assert.equal(await db.telegramPairing.count({where:{userId:employee.id}}),0);
   await assert.rejects(()=>service.confirm(employee,pair.id,'kk'),status(409));assert.equal(await db.telegramLink.count({where:{organizationId:org}}),1);
  });
  await t.test('groups mismatched sender callbacks and other assignees reveal no task data',async()=>{
   const before=fake.messages.length;await processor.handle(update('/tasks',{chat:{id:-12345,type:'group'}}));await processor.handle(update('/tasks',{chat:{id:123456,type:'private'}}));assert.equal(fake.messages.length,before);
   await processor.handle(update('/tasks'));const text=JSON.stringify(fake.messages.at(-1));assert.ok(text.includes('Assigned cleaning'));assert.equal(text.includes('Private colleague'),false);
   await processor.handle(callback('task:'+otherTask.id));assert.equal(fake.messages.at(-1).text.includes('not for employee'),false);
   await assert.rejects(()=>service.task(link.id,otherTask.id),status(404));await assert.rejects(()=>service.selectPhoto(link.id,otherTask.id),status(404));
   await processor.handle(callback('task:'+ownTask.id));const own=JSON.stringify(fake.messages.at(-1));for(const secret of ['+77009998877','secret client notes','12345.67'])assert.equal(own.includes(secret),false);
  });
  await t.test('assignment outbox commits with task, delivers once and retries provider failures',async()=>{
   const task=await tasks.create(owner,{title:'New Telegram task',description:'Work details',assigneeId:employee.id,orderId:order.id,dueDate:null});
   const delivery=await db.telegramDelivery.findFirstOrThrow({where:{linkId:link.id,notification:{taskId:task.id}}});assert.equal(delivery.status,'PENDING');
   fake.fail=429;await worker.runOnce();assert.equal((await db.telegramDelivery.findUniqueOrThrow({where:{id:delivery.id}})).status,'PENDING');
   await db.telegramDelivery.update({where:{id:delivery.id},data:{nextAttemptAt:new Date(Date.now()-1000)}});const before=fake.messages.length;await worker.runOnce();assert.equal((await db.telegramDelivery.findUniqueOrThrow({where:{id:delivery.id}})).status,'SENT');assert.equal(fake.messages.length,before+1);await worker.runOnce();assert.equal(fake.messages.length,before+1);
   assert.equal(fake.messages.at(-1).chatId,senderId);assert.ok(fake.messages.at(-1).text.includes('New Telegram task'));
  });
  await t.test('photo duplicates keep one sanitised private AFTER image and do not publish it',async()=>{
   fake.image=await sharp({create:{width:500,height:300,channels:3,background:'#23765e'}}).withMetadata({exif:{IFD0:{Copyright:'private fixture EXIF'}}}).png().toBuffer();
   await processor.handle(callback('photo:'+ownTask.id));const photo=update(null,{photo:[{file_id:'fake-photo',file_size:fake.image.length,width:500,height:300}]});fake.updates.push(photo);
   await worker.runOnce();assert.equal(await db.orderPhoto.count({where:{orderId:order.id}}),1);fake.forced=[photo];const before=fake.messages.length;await worker.runOnce();assert.equal(fake.messages.length,before);
   await processor.handle(photo);assert.equal(await db.orderPhoto.count({where:{orderId:order.id}}),1);
   const saved=await db.orderPhoto.findFirstOrThrow({where:{orderId:order.id}}),meta=await sharp(saved.image).metadata();assert.equal(saved.shared,false);assert.equal(saved.phase,'AFTER');assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);assert.equal(saved.createdById,employee.id);
   const published=await passports.publish(owner,order.id),token=new URL(published.url).hash.slice(7);assert.equal((await passports.read(token)).photos.length,0);
   assert.equal((await req('/orders/'+order.id+'/passport/photos',{image:fake.image.toString('base64'),phase:'AFTER',shared:false,idempotencyKey:randomUUID(),telegram:{linkId:link.id,taskId:ownTask.id}},employee.cookie)).status,400);
  });
  await t.test('photo permissions are rechecked after download for reassignment expiry deactivation and disconnect',async()=>{
   const photo=()=>update(null,{photo:[{file_id:'fake-photo',file_size:fake.image.length,width:500,height:300}]});
   const old=photo();old.message.date-=100;await processor.handle(old);assert.equal(await db.orderPhoto.count({where:{orderId:order.id}}),1);
   fake.downloadHook=()=>db.businessTask.update({where:{id:ownTask.id},data:{assigneeId:colleague.id}});await processor.handle(photo());assert.equal(await db.orderPhoto.count({where:{orderId:order.id}}),1);
   await db.businessTask.update({where:{id:ownTask.id},data:{assigneeId:employee.id}});await db.telegramLink.update({where:{id:link.id},data:{selectedAt:new Date(Date.now()-1000000)}});await processor.handle(photo());assert.equal(await db.orderPhoto.count({where:{orderId:order.id}}),1);
   await service.selectPhoto(link.id,ownTask.id);fake.downloadHook=()=>db.user.update({where:{id:employee.id},data:{isActive:false}});await processor.handle(photo());assert.equal(await db.orderPhoto.count({where:{orderId:order.id}}),1);await db.user.update({where:{id:employee.id},data:{isActive:true}});
   fake.downloadHook=()=>service.disconnect(employee);await processor.handle(photo());assert.equal(await db.orderPhoto.count({where:{orderId:order.id}}),1);assert.equal(await db.telegramLink.count({where:{userId:employee.id}}),0);
  });
  await t.test('rotated expired and cross-account pairing never overwrite an existing connection',async()=>{
   const first=await service.pair(employee,'ru'),second=await service.pair(employee,'ru');assert.equal(await service.claim(botId,new URL(first.url).searchParams.get('start'),{id:senderId,name:'Staff',username:''}),false);
   await db.telegramPairing.update({where:{id:second.id},data:{expiresAt:new Date(Date.now()-1)}});assert.equal(await service.claim(botId,new URL(second.url).searchParams.get('start'),{id:senderId,name:'Staff',username:''}),false);
   pair=await service.pair(employee,'ru');await service.claim(botId,new URL(pair.url).searchParams.get('start'),{id:senderId,name:'Staff',username:''});link=await service.confirm(employee,pair.id,'ru');
   const other=await service.pair(foreign,'ru');assert.equal(await service.claim(botId,new URL(other.url).searchParams.get('start'),{id:senderId,name:'Staff',username:''}),false);assert.equal((await service.status(foreign)).linked,null);
  });
  await t.test('durable offset receipts and per-bot lease prevent simultaneous pollers and replay',async()=>{
   const second=new TelegramWorker({client:db},fake,processor,service);fake.delay=100;const before=fake.polls;await Promise.all([worker.runOnce(),second.runOnce()]);assert.equal(fake.polls,before+1);fake.delay=0;
   const state=await db.telegramBotState.findUniqueOrThrow({where:{botId}});assert.ok(state.nextUpdateId>0n);assert.ok(state.lastPollAt);assert.equal(state.leaseToken,null);assert.ok(await db.telegramUpdateReceipt.count({where:{botId}}));
   const rejected=update('/help');fake.updates.push(rejected);fake.fail=400;await worker.runOnce();assert.ok(await db.telegramUpdateReceipt.findUnique({where:{botId_updateId:{botId,updateId:BigInt(rejected.update_id)}}}));
  });
  await t.test('blocked bot and stop unlink cleanly even if the CRM employee has been deactivated',async()=>{
   const task=await tasks.create(owner,{title:'Blocked bot fixture',description:'',assigneeId:employee.id,orderId:null,dueDate:null});fake.fail=403;await worker.runOnce();assert.equal(await db.telegramLink.count({where:{userId:employee.id}}),0);
   pair=await service.pair(employee,'ru');await service.claim(botId,new URL(pair.url).searchParams.get('start'),{id:senderId,name:'Staff',username:''});await service.confirm(employee,pair.id,'ru');await db.user.update({where:{id:employee.id},data:{isActive:false}});await processor.handle(update('/stop'));assert.equal(await db.telegramLink.count({where:{userId:employee.id}}),0);
   assert.ok(task.id);
  });
 }finally{
  await db.telegramUpdateReceipt.deleteMany({where:{botId}});await db.telegramBotState.deleteMany({where:{botId}});
  for(const id of [org,otherOrg]){await db.businessTask.deleteMany({where:{organizationId:id}});await db.order.deleteMany({where:{organizationId:id}});await db.client.deleteMany({where:{organizationId:id}});await db.auditEvent.deleteMany({where:{organizationId:id}});await db.user.deleteMany({where:{organizationId:id}});await db.organization.deleteMany({where:{id}});}await db.$disconnect();
 }
});
