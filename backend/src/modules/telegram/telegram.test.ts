import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {telegramConfig} from './telegram-config';
import {photoKey,compressTelegramPhoto} from './telegram-photo';
import {telegramPairSchema,telegramConfirmSchema} from '@tirek/contracts';
import {telegramUpdateSchema} from './telegram-processor';
import {TelegramTransport,TelegramTransportError} from './telegram-transport';
test('Telegram configuration fails closed without exposing credentials and defaults disabled',()=>{
 assert.equal(telegramConfig({}).enabled,false);
 assert.throws(()=>telegramConfig({TELEGRAM_DELIVERY:'unknown'}));
 const secret='not-a-token-secret';assert.throws(()=>telegramConfig({TELEGRAM_DELIVERY:'telegram',TELEGRAM_BOT_TOKEN:secret}),e=>e instanceof Error&&!e.message.includes(secret));
 assert.equal(telegramConfig({TELEGRAM_DELIVERY:'telegram',TELEGRAM_BOT_TOKEN:'123456:ABCDEFGHIJKLMNOPQRSTUVXYZ_0123456789'}).botId,'123456');
});
test('pairing cannot accept identity or tenant chosen by the browser',()=>{
 assert.equal(telegramPairSchema.safeParse({locale:'kk'}).success,true);
 assert.equal(telegramPairSchema.safeParse({locale:'ru',telegramUserId:'123'}).success,false);
 assert.equal(telegramConfirmSchema.safeParse({locale:'ru',pairingId:'12345678-1234-4123-8123-123456789012',organizationId:'12345678-1234-4123-8123-123456789012'}).success,false);
 assert.equal(telegramUpdateSchema.safeParse({update_id:Number.MAX_SAFE_INTEGER+1}).success,false);
});
test('photo replay keys are stable per bot private chat and message with valid UUID layout',()=>{
 const key=photoKey('1','2',3);assert.equal(key,photoKey('1','2',3));assert.notEqual(key,photoKey('1','2',4));assert.notEqual(key,photoKey('2','2',3));assert.notEqual(key,photoKey('1','3',3));assert.match(key,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
test('Telegram photos are bounded and lose source metadata before entering the passport',async()=>{
 const input=await sharp({create:{width:1500,height:800,channels:3,background:'#21846a'}}).withMetadata({exif:{IFD0:{Copyright:'private metadata'}}}).png().toBuffer();assert.ok((await sharp(input).metadata()).exif);
 const value=Buffer.from(await compressTelegramPhoto(input),'base64'),meta=await sharp(value).metadata();assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);assert.ok(meta.width!<=1200&&meta.height!<=1200&&value.length<=270000);
 await assert.rejects(()=>compressTelegramPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));await assert.rejects(()=>compressTelegramPhoto(Buffer.alloc(5000001)));
 const pixels=await sharp({create:{width:4000,height:4000,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(()=>compressTelegramPhoto(pixels));
});
test('transport uses fixed HTTPS endpoints rejects file traversal and hides provider secrets',async()=>{
 const delivery=process.env.TELEGRAM_DELIVERY,token=process.env.TELEGRAM_BOT_TOKEN,originalFetch=globalThis.fetch;
 process.env.TELEGRAM_DELIVERY='telegram';process.env.TELEGRAM_BOT_TOKEN='123456:ABCDEFGHIJKLMNOPQRSTUVXYZ_0123456789';
 let calls=0,payload:Record<string,unknown>={};
 try{
  const transport=new TelegramTransport();
  globalThis.fetch=(async(url,init)=>{calls++;assert.ok(String(url).startsWith('https://api.telegram.org/bot123456:'));assert.equal(init?.redirect,'error');payload=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,result:{message_id:1}}));}) as typeof fetch;
  await transport.send('123','<b>text</b>\u0001'+'😀'.repeat(3000),[[{text:'😀'.repeat(60),callback_data:'list:1'}]]);assert.equal(payload.parse_mode,undefined);assert.equal(payload.protect_content,true);assert.ok(String(payload.text).length<=3900);assert.equal(String(payload.text).includes('\u0001'),false);assert.equal(/[\ud800-\udfff]/u.test(String(payload.text)),false);
  globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({ok:true,result:{file_size:10,file_path:'../credentials'}}));}) as typeof fetch;
  const before=calls;await assert.rejects(()=>transport.photo('id'),e=>e instanceof TelegramTransportError&&e.code===413);assert.equal(calls,before+1);
  globalThis.fetch=(async()=>{throw Error('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN);}) as typeof fetch;
  await assert.rejects(()=>transport.call('getMe',{}),e=>e instanceof Error&&!e.message.includes('ABCDEFGHIJKLMNOP'));
 }finally{globalThis.fetch=originalFetch;if(delivery===undefined)delete process.env.TELEGRAM_DELIVERY;else process.env.TELEGRAM_DELIVERY=delivery;if(token===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=token;}
});
