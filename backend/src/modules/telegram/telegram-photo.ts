import sharp from 'sharp';
import {createHash} from 'node:crypto';
export function photoKey(botId:string,chatId:string,messageId:number){const bytes=createHash('sha256').update(`telegram:${botId}:${chatId}:${messageId}`).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export async function compressTelegramPhoto(bytes:Buffer){
 if(!bytes.length||bytes.length>5_000_000)throw Error('INVALID_PHOTO');
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!jpeg&&!png&&!webp)throw Error('INVALID_PHOTO');
 const meta=await sharp(bytes,{limitInputPixels:12000000,failOn:'warning'}).metadata();
 if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw Error('INVALID_PHOTO');
 for(const width of [1200,900,600]){const image=await sharp(bytes,{limitInputPixels:12000000,failOn:'warning'}).rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true}).jpeg({quality:78}).toBuffer();if(image.length<=270000)return image.toString('base64');}
 throw Error('INVALID_PHOTO');
}
