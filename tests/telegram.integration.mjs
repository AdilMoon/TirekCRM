import 'dotenv/config';
import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,randomInt,createHash} from 'node:crypto';
import sharp from 'sharp';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {ExpenseReceiptsService} from '../backend/dist/modules/finance/expense-receipts.service.js';
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
const receipts=new ExpenseReceiptsService({client:db},audit);
const fake=new FakeTelegram(),service=new TelegramService({client:db},fake,audit),processor=new TelegramProcessor({client:db},service,fake,passports,tasks,receipts),worker=new TelegramWorker({client:db},fake,processor,service);
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
  await t.test('receipt submission, private review, concurrent approval and profitability',async()=>{
   const p=new TelegramProcessor({client:db},service,fake,passports,tasks,receipts);
   const outside=await user(otherOrg,'OWNER');
   const path='/finance/receipts';
   const photo=caption=>update(null,{caption,photo:[{file_id:'fixture',width:120,height:80}]});
   const select=()=>p.handle(callback('receipt:'+ownTask.id));
   fake.image=await sharp({create:{width:120,height:80,channels:3,background:'#ddd'}}).jpeg().toBuffer();
   await p.card(link.id,ownTask.id);
   assert.ok(fake.messages.at(-1).buttons.flat().some(b=>b.callback_data==='receipt:'+ownTask.id));
   await select();
   for(const caption of ['', '0', '-50', '5.499', '1 25,50', '100 USD']) await p.handle(photo(caption));
   assert.equal(await db.expenseReceipt.count({where:{orderId:order.id}}),0);
   await db.telegramLink.update({where:{id:link.id},data:{selectedAt:new Date(Date.now()-16*60000)}});
   await p.handle(photo('10'));assert.equal(await db.expenseReceipt.count({where:{orderId:order.id}}),0);
   await select();
   fake.downloadHook=()=>db.businessTask.update({where:{id:ownTask.id},data:{assigneeId:colleague.id}});
   await p.handle(photo('10'));assert.equal(await db.expenseReceipt.count({where:{orderId:order.id}}),0);
   await db.businessTask.update({where:{id:ownTask.id},data:{assigneeId:employee.id}});
   await select();
   const first=photo('1 250,50 ₸\nМатериалы QA');
   await p.handle(first);await p.handle(first);
   await select();await p.handle(photo('1250.50'));
   const where={organizationId:org,orderId:order.id};
   assert.equal(await db.expenseReceipt.count({where}),1);
   assert.equal(await db.orderPhoto.count({where}),0);
   assert.equal(await db.expense.count({where}),0);
   const list=(await req(path,undefined,owner.cookie,'GET')).body;
   const item=list.items[0],url=path+'/'+item.id;
   assert.equal(item.amount,'1250.50');assert.equal(item.description,'Материалы QA');assert.equal(item.image,undefined);
   assert.equal((await req(path,undefined,employee.cookie,'GET')).status,403);
   assert.equal((await req(path,undefined,outside.cookie,'GET')).body.total,0);
   assert.equal((await req(url+'/photo',undefined,outside.cookie,'GET')).status,404);
   assert.equal((await req(url+'/photo',undefined,employee.cookie,'GET')).status,403);
   assert.equal((await req(url+'/photo',undefined,undefined,'GET')).status,401);
   const image=await fetch((process.env.TEST_API_URL??'http://127.0.0.1:4000/api')+url+'/photo',{headers:{Cookie:owner.cookie}});
   assert.equal(image.headers.get('cache-control'),'no-store');
   assert.equal(image.headers.get('content-type'),'image/jpeg');
   assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format,'jpeg');
   const decision={status:'APPROVED',category:'MATERIALS'};
   assert.equal((await req(url,decision,employee.cookie,'PATCH')).status,403);
   assert.equal((await req(url,decision,outside.cookie,'PATCH')).status,404);
   assert.equal((await req(url,{...decision,amount:'10000'},owner.cookie,'PATCH')).status,400);
   const review=await Promise.all([req(url,decision,owner.cookie,'PATCH'),req(url,decision,owner.cookie,'PATCH')]);
   assert.equal(review[0].status,200);assert.deepEqual(review[0],review[1]);
   assert.equal((await req(url,{status:'REJECTED'},owner.cookie,'PATCH')).status,409);
   assert.equal(await db.expense.count({where}),1);
   const profits=(await req('/orders/'+order.id+'/profitability',undefined,owner.cookie,'GET')).body;
   assert.equal(profits.actual.expenses,'1250.50');assert.equal(profits.actual.profit,'11095.17');
   fake.image=await sharp({create:{width:100,height:80,channels:3,background:'#abc'}}).jpeg().toBuffer();
   await select();await p.handle(photo('3200'));
   const next=(await req(path,undefined,owner.cookie,'GET')).body.items[0];
   assert.equal((await req(path+'/'+next.id,{status:'REJECTED'},owner.cookie,'PATCH')).status,200);
   assert.equal(await db.expense.count({where}),1);
   await select();await p.handle(photo('32'));
   assert.equal((await req(path,undefined,owner.cookie,'GET')).body.items[0].amount,'32.00');
  });
  await t.test('status buttons enforce transitions versions replay safety and closed-photo explanations',async()=>{
   const p=new TelegramProcessor({client:db},service,fake,passports,tasks,receipts),task=await db.businessTask.create({data:{organizationId:org,createdById:owner.id,assigneeId:employee.id,orderId:order.id,title:'Status button fixture'}});
   await p.card(link.id,task.id);assert.ok(fake.messages.at(-1).buttons.flat().some(b=>b.callback_data==='start:'+task.id+':1'));assert.equal(fake.messages.at(-1).buttons.flat().some(b=>b.callback_data.startsWith('done:')),false);
   const start=callback('start:'+task.id+':1');await p.handle(start);await p.handle(start);
   let current=await db.businessTask.findUniqueOrThrow({where:{id:task.id}});assert.equal(current.status,'IN_PROGRESS');assert.equal(current.version,2);assert.ok(fake.messages.at(-1).buttons.flat().some(b=>b.callback_data==='done:'+task.id+':2'));
   assert.equal(await db.auditEvent.count({where:{organizationId:org,entityId:task.id,action:'TASK_STATUS_CHANGED'}}),1);assert.equal(await db.notification.count({where:{taskId:task.id,kind:'TASK_STATUS_CHANGED',recipientId:owner.id}}),1);
   await tasks.update(owner,task.id,{title:'Edited task',description:'',orderId:order.id,assigneeId:employee.id,dueDate:null,version:2});await p.handle(callback('done:'+task.id+':2'));current=await db.businessTask.findUniqueOrThrow({where:{id:task.id}});assert.equal(current.status,'IN_PROGRESS');assert.equal(current.version,3);
   await service.selectPhoto(link.id,task.id);const done=callback('done:'+task.id+':3');await p.handle(done);await p.handle(done);
   current=await db.businessTask.findUniqueOrThrow({where:{id:task.id}});assert.equal(current.status,'DONE');assert.equal(current.version,4);assert.equal((await db.telegramLink.findUniqueOrThrow({where:{id:link.id}})).selectedTaskId,null);
   assert.equal(fake.messages.at(-1).buttons.flat().some(b=>/^(start|done|photo):/.test(b.callback_data)),false);assert.equal(await db.auditEvent.count({where:{organizationId:org,entityId:task.id,action:'TASK_STATUS_CHANGED'}}),2);assert.equal(await db.notification.count({where:{taskId:task.id,kind:'TASK_STATUS_CHANGED',recipientId:owner.id}}),2);
   await p.handle(start);assert.equal((await db.businessTask.findUniqueOrThrow({where:{id:task.id}})).status,'DONE');await p.handle(callback('photo:'+task.id));assert.ok(/аяқталған|completed|завершена/.test(fake.messages.at(-1).text));
   const next=await db.businessTask.create({data:{organizationId:org,createdById:owner.id,assigneeId:employee.id,title:'Cannot skip work'}});await p.handle(callback('done:'+next.id+':1'));assert.equal((await db.businessTask.findUniqueOrThrow({where:{id:next.id}})).status,'TODO');
   await db.businessTask.deleteMany({where:{id:{in:[task.id,next.id]},organizationId:org}});
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
  await t.test('status mutation rechecks binding current assignee active role and rolls back failed audit',async()=>{
   const task=await db.businessTask.create({data:{organizationId:org,createdById:owner.id,assigneeId:employee.id,title:'Permission fixture'}}),context={linkId:link.id,botId,telegramUserId:senderId};
   await assert.rejects(()=>tasks.status(employee,otherTask.id,'IN_PROGRESS',1,context),status(404));
   const foreignTask=await db.businessTask.create({data:{organizationId:otherOrg,createdById:foreign.id,assigneeId:foreign.id,title:'Foreign fixture'}});await assert.rejects(()=>tasks.status(employee,foreignTask.id,'IN_PROGRESS',1,context),status(404));
   await db.user.update({where:{id:employee.id},data:{isActive:false}});try{await assert.rejects(()=>tasks.status(employee,task.id,'IN_PROGRESS',1,context),status(403));}finally{await db.user.update({where:{id:employee.id},data:{isActive:true}});}
   await db.user.update({where:{id:employee.id},data:{role:'OWNER'}});try{await assert.rejects(()=>tasks.status(employee,task.id,'IN_PROGRESS',1,context),status(403));}finally{await db.user.update({where:{id:employee.id},data:{role:'EMPLOYEE'}});}
   const broken=new TasksService({client:db},{record:async()=>{throw Error('audit fixture');}});await assert.rejects(()=>broken.status(employee,task.id,'IN_PROGRESS',1,context));assert.equal((await db.businessTask.findUniqueOrThrow({where:{id:task.id}})).status,'TODO');
   const relay={status:async(...args)=>{await service.disconnect(employee);return tasks.status(...args);}},p=new TelegramProcessor({client:db},service,fake,passports,relay,receipts);await p.handle(callback('start:'+task.id+':1'));assert.equal((await db.businessTask.findUniqueOrThrow({where:{id:task.id}})).status,'TODO');
   pair=await service.pair(employee,'ru');await service.claim(botId,new URL(pair.url).searchParams.get('start'),{id:senderId,name:'Staff',username:''});link=await service.confirm(employee,pair.id,'ru');await assert.rejects(()=>tasks.status(employee,task.id,'IN_PROGRESS',1,context),status(403));
   assert.equal((await req('/tasks/'+task.id+'/status',{status:'IN_PROGRESS',version:1,telegram:context},employee.cookie,'PATCH')).status,400);
   const fresh={linkId:link.id,botId,telegramUserId:senderId};await Promise.all([tasks.status(employee,task.id,'IN_PROGRESS',1,fresh),tasks.status(employee,task.id,'IN_PROGRESS',1,fresh)]);assert.equal((await db.businessTask.findUniqueOrThrow({where:{id:task.id}})).version,2);assert.equal(await db.auditEvent.count({where:{organizationId:org,entityId:task.id,action:'TASK_STATUS_CHANGED'}}),1);
   await db.businessTask.deleteMany({where:{id:{in:[task.id,foreignTask.id]},organizationId:{in:[org,otherOrg]}}});
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
  for(const id of [org,otherOrg]){await db.expenseReceipt.deleteMany({where:{organizationId:id}});await db.expense.deleteMany({where:{organizationId:id}});await db.businessTask.deleteMany({where:{organizationId:id}});await db.order.deleteMany({where:{organizationId:id}});await db.client.deleteMany({where:{organizationId:id}});await db.auditEvent.deleteMany({where:{organizationId:id}});await db.user.deleteMany({where:{organizationId:id}});await db.organization.deleteMany({where:{id}});}await db.$disconnect();
 }
});
