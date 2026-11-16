import {Injectable,NotFoundException,ConflictException,BadRequestException,ForbiddenException} from '@nestjs/common';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import QRCode from 'qrcode';
import type {Prisma} from '@prisma/client';
import type {PassportPhotoInput,PassportPhotoVisibilityInput} from '@tirek/contracts';
import {Database} from '../../database/database.service';
import {serializable} from '../../common/transaction';
import {digest} from '../../auth/session.guard';
import {webOrigin} from '../../common/web-origin';
import {AuditService,type Actor} from '../audit/audit.service';

const include={organization:{select:{name:true}},passport:true,photos:{orderBy:[{createdAt:'asc' as const},{id:'asc' as const}]}};
type PassportOrder=Prisma.OrderGetPayload<{include:typeof include}>;
const active=(link:{revokedAt:Date|null;expiresAt:Date}|null)=>!!link&&!link.revokedAt&&link.expiresAt>new Date();
const view=(order:PassportOrder,publicOnly:boolean,viewer?:{id:string;owner:boolean})=>({
 companyName:order.organization.name,number:order.number,title:order.title,status:order.status,dueDate:order.dueDate,
 orderVersion:order.version,revision:order.passport?.revision??0,expiresAt:order.passport?.expiresAt??null,active:active(order.passport),
 confirmedAt:active(order.passport)&&order.status==='COMPLETED'&&order.passport?.confirmedOrderVersion===order.version&&order.passport.confirmedRevision===order.passport.revision?order.passport.confirmedAt:null,
 ...(!publicOnly?{canPublish:viewer?.owner??false}:{}),
 photos:order.photos.filter(p=>!publicOnly||p.shared).map(p=>({id:p.id,phase:p.phase,shared:p.shared,image:'data:image/jpeg;base64,'+Buffer.from(p.image).toString('base64'),...(!publicOnly?{canDelete:!!viewer&&(viewer.owner||p.createdById===viewer.id)}:{})})),
});

@Injectable()
export class PassportService {
 constructor(private readonly db:Database,private readonly audit:AuditService){}
 private async owner(tx:Prisma.TransactionClient,actor:Actor,orderId:string){
  if(!await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,role:'OWNER',isActive:true}}))throw new ForbiddenException('Недостаточно прав');
  const order=await tx.order.findFirst({where:{id:orderId,organizationId:actor.organizationId}});
  if(!order)throw new NotFoundException('Заказ не найден');return order;
 }
 private async photoAccess(tx:Prisma.TransactionClient,actor:Actor,id:string,telegram?:{linkId:string;taskId:string}){
  const user=await tx.user.findFirst({where:{id:actor.id,organizationId:actor.organizationId,isActive:true}});
  if(!user)throw new ForbiddenException('Недостаточно прав');
  if(telegram){
   if(user.role!=='EMPLOYEE'||!await tx.telegramLink.findFirst({where:{id:telegram.linkId,userId:actor.id,organizationId:actor.organizationId,selectedTaskId:telegram.taskId,selectedAt:{gt:new Date(Date.now()-900000)}}})||!await tx.businessTask.findFirst({where:{id:telegram.taskId,orderId:id,organizationId:actor.organizationId,assigneeId:actor.id,status:{in:['TODO','IN_PROGRESS']}}}))throw new ForbiddenException('Недостаточно прав');
  }
  const order=await tx.order.findFirst({where:{id,organizationId:actor.organizationId}});
  if(!order)throw new NotFoundException('Заказ не найден');
  if(user.role!=='OWNER'&&!await tx.businessTask.findFirst({where:{organizationId:actor.organizationId,orderId:id,assigneeId:actor.id,status:{in:['TODO','IN_PROGRESS']}}}))throw new ForbiddenException('Недостаточно прав');
  return {order,owner:user.role==='OWNER'};
 }
 async manage(actor:Actor,id:string){
  return serializable(this.db.client,async tx=>{
   const access=await this.photoAccess(tx,actor,id);
   const order=await tx.order.findFirst({where:{id,organizationId:actor.organizationId},include:{
    ...include,
    photos:{...include.photos,...(!access.owner?{where:{createdById:actor.id}}:{})},
    _count:{select:{photos:true}},
   }});
   if(!order)throw new NotFoundException('Заказ не найден');
   return {...view(order,false,{id:actor.id,owner:access.owner}),photoCount:order._count.photos};
  });
 }
 async publish(actor:Actor,id:string){
  const origin=webOrigin();
  if(process.env.NODE_ENV==='production'&&!origin.startsWith('https://'))throw new BadRequestException('Для паспорта нужен HTTPS');
  const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+30*86400000);
  const url=origin+'/passport#token='+token,qr=await QRCode.toDataURL(url,{width:480,margin:3,errorCorrectionLevel:'M'});
  await serializable(this.db.client,async tx=>{
   const order=await this.owner(tx,actor,id);
   await tx.orderPassport.upsert({where:{orderId:id},create:{orderId:id,organizationId:actor.organizationId,tokenHash:digest(token),expiresAt},
    update:{tokenHash:digest(token),expiresAt,revokedAt:null,revision:{increment:1},confirmedAt:null,confirmedOrderVersion:null,confirmedRevision:null}});
   await this.audit.record(tx,actor,'ORDER',id,'PASSPORT_PUBLISHED',{number:order.number,expiresAt:expiresAt.toISOString()});
  });
  return {url,qr,expiresAt};
 }
 revoke(actor:Actor,id:string){
  return serializable(this.db.client,async tx=>{
   const order=await this.owner(tx,actor,id);
   const changed=await tx.orderPassport.updateMany({where:{orderId:id,organizationId:actor.organizationId,revokedAt:null},data:{revokedAt:new Date(),revision:{increment:1},confirmedAt:null,confirmedOrderVersion:null,confirmedRevision:null}});
   if(changed.count)await this.audit.record(tx,actor,'ORDER',id,'PASSPORT_REVOKED',{number:order.number});
   return {ok:true};
  });
 }
 async photo(actor:Actor,id:string,input:PassportPhotoInput,telegram?:{linkId:string;taskId:string}){
  const checkAccess=async(tx:Prisma.TransactionClient)=>{
   const access=await this.photoAccess(tx,actor,id,telegram);
   if(input.shared&&!access.owner)throw new ForbiddenException('Недостаточно прав');
   return access.order;
  };
  const bytes=Buffer.from(input.image,'base64');
  if(bytes.length>300000||bytes.toString('base64')!==input.image)throw new BadRequestException('Не удалось обработать фото');
  const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!jpeg&&!png&&!webp)throw new BadRequestException('Не удалось обработать фото');
  // Check tenancy before doing CPU-intensive image decoding.
  await this.db.client.$transaction(checkAccess);
  let image:Buffer;
  try{
   const source=sharp(bytes,{limitInputPixels:12000000,failOn:'warning'}),meta=await source.metadata();
   if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw Error('Unsupported image');
   image=await source.rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).jpeg({quality:78}).toBuffer();
  }catch{throw new BadRequestException('Не удалось обработать фото');}
  if(image.length>200000)throw new BadRequestException('Фото слишком большое после обработки');
  const inputHash=digest(input.image+'|'+input.phase+'|'+input.shared);
  return serializable(this.db.client,async tx=>{
   const order=await checkAccess(tx);
   const old=await tx.orderPhoto.findUnique({where:{orderId_idempotencyKey:{orderId:id,idempotencyKey:input.idempotencyKey}}});
   if(old){if(old.inputHash!==inputHash||old.createdById!==actor.id)throw new ConflictException('Ключ операции уже использован');return {id:old.id};}
   if(await tx.orderPhoto.count({where:{orderId:id,organizationId:actor.organizationId}})>=6)throw new ConflictException('В паспорте можно сохранить до 6 фото');
   const photo=await tx.orderPhoto.create({data:{orderId:id,organizationId:actor.organizationId,createdById:actor.id,phase:input.phase,shared:input.shared,image:new Uint8Array(image),inputHash,idempotencyKey:input.idempotencyKey}});
   await tx.order.update({where:{id},data:{version:{increment:1}}});
   await this.audit.record(tx,actor,'ORDER',id,'ORDER_PHOTO_ADDED',{number:order.number,photoId:photo.id,phase:input.phase,shared:input.shared});
   return {id:photo.id};
  });
 }
 setPhotoVisibility(actor:Actor,id:string,photoId:string,input:PassportPhotoVisibilityInput){
  return serializable(this.db.client,async tx=>{
   const order=await this.owner(tx,actor,id);
   const photo=await tx.orderPhoto.findFirst({
    where:{id:photoId,orderId:id,organizationId:actor.organizationId},
    select:{shared:true},
   });
   if(!photo)throw new NotFoundException('Фото не найдено');
   if(photo.shared===input.shared)return {ok:true};
   if(order.version!==input.orderVersion)throw new ConflictException('Паспорт изменился. Обновите страницу');
   await tx.orderPhoto.update({where:{id:photoId},data:{shared:input.shared}});
   await tx.order.update({where:{id},data:{version:{increment:1}}});
   await this.audit.record(tx,actor,'ORDER',id,'ORDER_PHOTO_VISIBILITY_CHANGED',{number:order.number,photoId,shared:input.shared});
   return {ok:true};
  });
 }
 deletePhoto(actor:Actor,id:string,photoId:string){
  return serializable(this.db.client,async tx=>{
   const {order,owner}=await this.photoAccess(tx,actor,id);
   const deleted=await tx.orderPhoto.deleteMany({where:{id:photoId,orderId:id,organizationId:actor.organizationId,...(!owner?{createdById:actor.id}:{})}});
   if(!deleted.count)throw new NotFoundException('Фото не найдено');
   await tx.order.update({where:{id},data:{version:{increment:1}}});
   await this.audit.record(tx,actor,'ORDER',id,'ORDER_PHOTO_REMOVED',{number:order.number,photoId});return {ok:true};
  });
 }
 async read(token:string){
  const link=await this.db.client.orderPassport.findUnique({where:{tokenHash:digest(token)},include:{order:{include:{...include,photos:{where:{shared:true},orderBy:[{createdAt:'asc'},{id:'asc'}]}}}}});
  if(!active(link))throw new NotFoundException('Ссылка недоступна или срок истёк');
  return view(link!.order,true);
 }
 confirm(token:string,orderVersion:number,revision:number){
  return serializable(this.db.client,async tx=>{
   const link=await tx.orderPassport.findUnique({where:{tokenHash:digest(token)},include:{order:true}});
   if(!active(link))throw new NotFoundException('Ссылка недоступна или срок истёк');
   const {order}=link!;
   if(order.status!=='COMPLETED')throw new ConflictException('Подтверждение доступно после завершения заказа');
   if(order.version!==orderVersion||link!.revision!==revision)throw new ConflictException('Паспорт изменился. Обновите страницу');
   if(link!.confirmedAt&&link!.confirmedOrderVersion===orderVersion&&link!.confirmedRevision===revision)return {ok:true};
   await tx.orderPassport.update({where:{orderId:order.id},data:{confirmedAt:new Date(),confirmedOrderVersion:orderVersion,confirmedRevision:revision}});
   await this.audit.record(tx,{id:order.id,organizationId:order.organizationId,name:'Клиент по ссылке'},'ORDER',order.id,'ORDER_CLIENT_CONFIRMED',{number:order.number,method:'PASSPORT_LINK',orderVersion,revision});
   return {ok:true};
  });
 }
}
