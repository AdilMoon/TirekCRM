import 'dotenv/config';
import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {MessageOrdersService} from '../backend/dist/modules/smart-orders/message-orders.service.js';
import {PassportService} from '../backend/dist/modules/smart-orders/passport.service.js';
import {AuditService} from '../backend/dist/modules/audit/audit.service.js';
import {messageOrderSchema} from '@tirek/contracts';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:5})});
const audit=new AuditService({client:db}),messages=new MessageOrdersService({client:db},audit),passports=new PassportService({client:db},audit);
const ids=[],base=process.env.TEST_API_URL??'http://127.0.0.1:4000/api',origin=process.env.WEB_ORIGIN??'http://localhost:3000';
async function user(org,role='OWNER'){
 const u=await db.user.create({data:{organizationId:org,name:'Smart fixture '+role,role,email:randomUUID()+'@smart.invalid',passwordHash:'unused'}});
 const token=randomBytes(32).toString('hex');await db.session.create({data:{userId:u.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 return {...u,cookie:'tirek_session='+token};
}
async function req(path,body,cookie,method='POST',source=origin){
 const r=await fetch(base+path,{method,headers:{Origin:source,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};
}
test('Message intake and QR passports preserve permissions consistency privacy and retries',async t=>{
 try{
  for(let i=0;i<2;i++){const id=randomUUID();ids.push(id);await db.organization.create({data:{id,name:'Smart fixture'}});}
  const [org,foreignOrg]=ids,owner=await user(org),worker=await user(org,'EMPLOYEE'),otherWorker=await user(org,'EMPLOYEE'),foreign=await user(foreignOrg);
  const existing=await db.client.create({data:{organizationId:org,name:'Existing Айдана',phone:'8 (700) 111-22-33'}});
  const outsider=await db.client.create({data:{organizationId:foreignOrg,name:'Private matching client',phone:'+77001112233'}});
  const input=messageOrderSchema.parse({idempotencyKey:randomUUID(),newClient:{name:'New Айдана',phone:'+77001112233'},order:{title:'Уборка квартиры',notes:'private notes',dueDate:'2026-11-15',items:[{description:'Уборка',quantity:1,unitPrice:'12345.67'}]}});
  let created,link,token;
  await t.test('preview is read only scoped to tenant and rejects anonymous employee and unknown fields',async()=>{
   const body={message:'Нужна уборка квартиры завтра, бюджет 25 000 ₸. Меня зовут Айдана, +7 700 111 22 33.'};
   const r=await req('/message-orders/preview',body,owner.cookie);assert.equal(r.status,200);assert.equal(r.body.amount,'25000.00');assert.deepEqual(r.body.matches.map(c=>c.id),[existing.id]);assert.equal(r.cache,'no-store');
   assert.equal(await db.order.count({where:{organizationId:org}}),0);
   assert.equal((await req('/message-orders/preview',body)).status,401);
   assert.equal((await req('/message-orders/preview',body,worker.cookie)).status,403);
   assert.equal((await req('/message-orders/preview',{...body,organizationId:foreignOrg},owner.cookie)).status,400);
   assert.equal((await req('/message-orders/preview',body,owner.cookie,'POST','')).status,403);
  });
  await t.test('parallel confirmation creates one client one order and a stable retry receipt',async()=>{
   const before=await db.client.count({where:{organizationId:org}});
   const results=await Promise.all([messages.create(owner,input),messages.create(owner,input),messages.create(owner,input)]);
   created=results[0];assert.deepEqual(results,[created,created,created]);
   assert.equal(await db.client.count({where:{organizationId:org}}),before+1);assert.equal(await db.order.count({where:{organizationId:org}}),1);
   const order=await db.order.findUniqueOrThrow({where:{id:created.orderId},include:{items:true}});assert.equal(order.total.toFixed(2),'12345.67');assert.equal(order.items.length,1);
   assert.equal(await db.auditEvent.count({where:{organizationId:org,entityId:order.id,action:'ORDER_CREATED'}}),1);
   await assert.rejects(()=>messages.create(owner,{...input,order:{...input.order,title:'changed'}}),e=>e.getStatus()===409);
  });
  await t.test('foreign client overflow and audit failure roll back all intake writes',async()=>{
   await assert.rejects(()=>messages.create(owner,{...input,idempotencyKey:randomUUID(),newClient:undefined,clientId:outsider.id}),e=>e.getStatus()===404);
   assert.throws(()=>messages.create(owner,{...input,idempotencyKey:randomUUID(),order:{...input.order,items:Array.from({length:100},()=>({description:'Huge',quantity:10000,unitPrice:'999999999999.99'}))}}),e=>e.getStatus()===400);
   const before=await db.client.count({where:{organizationId:org}}),broken=new MessageOrdersService({client:db},{record:async()=>{throw Error('fixture audit failure');}});
   await assert.rejects(()=>broken.create(owner,{...input,idempotencyKey:randomUUID()}));assert.equal(await db.client.count({where:{organizationId:org}}),before);
   assert.equal(await db.order.count({where:{organizationId:org}}),1);
  });
  await t.test('QR decodes to a fragment token; storage and audit never expose the raw token',async()=>{
   const r=await req('/orders/'+created.orderId+'/passport/link',undefined,owner.cookie);assert.equal(r.status,201);link=r.body;token=new URL(link.url).hash.slice(7);
   assert.equal(new URL(link.url).search,'');assert.match(token,/^[a-f0-9]{64}$/);
   const {data,info}=await sharp(Buffer.from(link.qr.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   assert.equal(jsQR(new Uint8ClampedArray(data),info.width,info.height).data,link.url);
   const stored=await db.orderPassport.findUniqueOrThrow({where:{orderId:created.orderId}});assert.notEqual(stored.tokenHash,token);assert.equal(JSON.stringify(await db.auditEvent.findMany({where:{organizationId:org}})).includes(token),false);
   const r2=await req('/orders/'+created.orderId+'/passport',undefined,foreign.cookie,'GET');assert.equal(r2.status,404);
   assert.equal((await req('/orders/'+created.orderId+'/passport/link',undefined,worker.cookie)).status,403);
   assert.equal((await req('/orders/'+created.orderId+'/passport',undefined,undefined,'GET')).status,401);
  });
  const png=await sharp({create:{width:120,height:80,channels:3,background:'#24816c'}}).withMetadata({exif:{IFD0:{Copyright:'private fixture metadata'}}}).png().toBuffer();
  assert.ok((await sharp(png).metadata()).exif);
  const photoInput={image:png.toString('base64'),phase:'BEFORE',shared:true,idempotencyKey:randomUUID()};
  let ownPhoto,employeePhoto,task;
  await t.test('uploads are sanitised bounded idempotent and private photos are omitted publicly',async()=>{
   const r=await req('/orders/'+created.orderId+'/passport/photos',photoInput,owner.cookie);assert.equal(r.status,201);ownPhoto=r.body;
   assert.deepEqual((await req('/orders/'+created.orderId+'/passport/photos',photoInput,owner.cookie)).body,ownPhoto);
   const image=await db.orderPhoto.findUniqueOrThrow({where:{id:ownPhoto.id}}),meta=await sharp(image.image).metadata();assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);
   assert.equal((await req('/orders/'+created.orderId+'/passport/photos',{...photoInput,idempotencyKey:randomUUID(),image:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')},owner.cookie)).status,400);
   await passports.photo(owner,created.orderId,{...photoInput,idempotencyKey:randomUUID(),shared:false});
   const publicView=await req('/passport/read',{token});assert.equal(publicView.status,200);assert.equal(publicView.cache,'no-store');assert.equal(publicView.body.photos.length,1);
   const keys=Object.keys(publicView.body).sort();assert.deepEqual(keys,['companyName','number','title','status','dueDate','orderVersion','revision','expiresAt','active','confirmedAt','photos'].sort());
   assert.equal(JSON.stringify(publicView.body).includes('private notes'),false);assert.equal(JSON.stringify(publicView.body).includes('+7700'),false);
   assert.equal((await req('/passport/read',{token,organizationId:org})).status,400);
  });
  await t.test('employees require a current active assignment and may delete only their own photos',async()=>{
   assert.equal((await req('/orders/'+created.orderId+'/passport',undefined,worker.cookie,'GET')).status,403);
   task=await db.businessTask.create({data:{organizationId:org,title:'Photo task',createdById:owner.id,assigneeId:worker.id,orderId:created.orderId}});
   const r=await req('/orders/'+created.orderId+'/passport',undefined,worker.cookie,'GET');assert.equal(r.status,200);assert.equal(r.body.canPublish,false);assert.equal(r.body.photos.length,0);assert.equal(r.body.photoCount,2);
   assert.equal((await req('/orders/'+created.orderId+'/passport/photos',{...photoInput,idempotencyKey:randomUUID()},worker.cookie)).status,403);
   await db.user.update({where:{id:worker.id},data:{isActive:false}});
   await assert.rejects(()=>passports.manage(worker,created.orderId),e=>e.getStatus()===403);
   await db.user.update({where:{id:worker.id},data:{isActive:true}});
   const upload=await req('/orders/'+created.orderId+'/passport/photos',{...photoInput,idempotencyKey:randomUUID(),phase:'AFTER',shared:false},worker.cookie);assert.equal(upload.status,201);employeePhoto=upload.body;
   const assigned=await passports.manage(worker,created.orderId);assert.deepEqual(assigned.photos.map(photo=>photo.id),[employeePhoto.id]);assert.equal(assigned.photoCount,3);
   assert.equal((await req('/orders/'+created.orderId+'/passport/photos/'+ownPhoto.id,undefined,worker.cookie,'DELETE')).status,404);
   await db.businessTask.update({where:{id:task.id},data:{assigneeId:otherWorker.id}});
   assert.equal((await req('/orders/'+created.orderId+'/passport',undefined,worker.cookie,'GET')).status,403);
   assert.equal((await req('/orders/'+created.orderId+'/passport/photos',{...photoInput,idempotencyKey:randomUUID()},worker.cookie)).status,403);
  });
  await t.test('only the owner can share or hide with current version and atomic audit',async()=>{
   const path='/orders/'+created.orderId+'/passport/photos/'+employeePhoto.id+'/visibility';
   const v=await passports.manage(owner,created.orderId);
   const show={shared:true,orderVersion:v.orderVersion};
   assert.equal((await req(path,show,foreign.cookie,'PATCH')).status,404);
   assert.equal((await req(path,show,otherWorker.cookie,'PATCH')).status,403);
   assert.equal((await req(path,show,owner.cookie,'PATCH','https://bad-origin.invalid')).status,403);
   assert.equal((await req(path,{...show,organizationId:org},owner.cookie,'PATCH')).status,400);
   const foreignPhotoPath=path.replace(employeePhoto.id,randomUUID());
   assert.equal((await req(foreignPhotoPath,show,owner.cookie,'PATCH')).status,404);
   const broken=new PassportService({client:db},{record:async()=>{throw Error('audit fixture');}});
   await assert.rejects(()=>broken.setPhotoVisibility(owner,created.orderId,employeePhoto.id,show),/audit fixture/);
   assert.equal((await passports.manage(owner,created.orderId)).orderVersion,v.orderVersion);
   assert.equal((await passports.read(token)).photos.some(photo=>photo.id===employeePhoto.id),false);
   const repeated=await Promise.all([
    passports.setPhotoVisibility(owner,created.orderId,employeePhoto.id,show),
    passports.setPhotoVisibility(owner,created.orderId,employeePhoto.id,show),
   ]);
   assert.deepEqual(repeated,[{ok:true},{ok:true}]);
   const published=await passports.read(token);
   assert.equal(published.orderVersion,v.orderVersion+1);
   assert.ok(published.photos.some(photo=>photo.id===employeePhoto.id));
   assert.equal((await req(path,{shared:false,orderVersion:v.orderVersion},owner.cookie,'PATCH')).status,409);
   assert.equal((await req(path,{shared:false,orderVersion:published.orderVersion},owner.cookie,'PATCH')).status,200);
   assert.equal((await req(path,show,owner.cookie,'PATCH')).status,409);
   assert.equal((await passports.read(token)).photos.some(photo=>photo.id===employeePhoto.id),false);
   assert.ok((await passports.manage(owner,created.orderId)).photos.some(photo=>photo.id===employeePhoto.id));
   assert.equal(await db.auditEvent.count({where:{organizationId:org,action:'ORDER_PHOTO_VISIBILITY_CHANGED'}}),2);
  });
  await t.test('confirmation is version-bound idempotent and invalidated by photo changes',async()=>{
   let v=(await req('/passport/read',{token})).body;
   assert.equal((await req('/passport/confirm',{token,orderVersion:v.orderVersion,revision:v.revision})).status,409);
   await db.order.update({where:{id:created.orderId},data:{status:'COMPLETED',version:{increment:1}}});
   assert.equal((await req('/passport/confirm',{token,orderVersion:v.orderVersion,revision:v.revision})).status,409);
   v=(await req('/passport/read',{token})).body;
   const confirmed=await Promise.all([passports.confirm(token,v.orderVersion,v.revision),passports.confirm(token,v.orderVersion,v.revision)]);assert.deepEqual(confirmed,[{ok:true},{ok:true}]);
   assert.equal(await db.auditEvent.count({where:{organizationId:org,action:'ORDER_CLIENT_CONFIRMED'}}),1);
   assert.ok((await req('/passport/read',{token})).body.confirmedAt);
   await passports.deletePhoto(owner,created.orderId,employeePhoto.id);
   assert.equal((await req('/passport/read',{token})).body.confirmedAt,null);
   assert.equal((await req('/passport/confirm',{token,orderVersion:v.orderVersion,revision:v.revision})).status,409);
  });
  await t.test('six-photo ceiling and concurrent retries do not overfill the order',async()=>{
   while(await db.orderPhoto.count({where:{orderId:created.orderId}})<5)await passports.photo(owner,created.orderId,{...photoInput,idempotencyKey:randomUUID()});
   const result=await Promise.allSettled([passports.photo(owner,created.orderId,{...photoInput,idempotencyKey:randomUUID()}),passports.photo(owner,created.orderId,{...photoInput,idempotencyKey:randomUUID()})]);
   assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.orderPhoto.count({where:{orderId:created.orderId}}),6);
  });
  await t.test('rotation expiry and revocation immediately reject the old capability',async()=>{
   const next=await passports.publish(owner,created.orderId),nextToken=new URL(next.url).hash.slice(7);
   assert.equal((await req('/passport/read',{token})).status,404);
   await db.orderPassport.update({where:{orderId:created.orderId},data:{expiresAt:new Date(Date.now()-1000)}});
   assert.equal((await req('/passport/read',{token:nextToken})).status,404);
   await db.orderPassport.update({where:{orderId:created.orderId},data:{expiresAt:new Date(Date.now()+3600000)}});
   await passports.revoke(owner,created.orderId);assert.equal((await req('/passport/read',{token:nextToken})).status,404);
  });
 }finally{
  for(const org of ids){await db.businessTask.deleteMany({where:{organizationId:org}});await db.order.deleteMany({where:{organizationId:org}});await db.client.deleteMany({where:{organizationId:org}});await db.auditEvent.deleteMany({where:{organizationId:org}});await db.user.deleteMany({where:{organizationId:org}});await db.organization.deleteMany({where:{id:org}});}await db.$disconnect();
 }
});
