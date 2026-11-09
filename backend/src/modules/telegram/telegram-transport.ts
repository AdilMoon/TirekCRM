import {Injectable} from '@nestjs/common';
import {telegramConfig} from './telegram-config';
export class TelegramTransportError extends Error {constructor(public readonly code:number,public readonly retryAfter=0){super('TELEGRAM_REQUEST_FAILED');}}
@Injectable()
export class TelegramTransport {
 readonly config=telegramConfig();
 private identity:Promise<{id:number;username:string}>|null=null;
 async call<T>(method:string,body:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
  if(!this.config.enabled)throw new TelegramTransportError(0);
  try{
   const response=await fetch('https://api.telegram.org/bot'+this.config.token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(method==='getUpdates'?25000:10000)]):AbortSignal.timeout(10000)});
   const result=await response.json() as {ok:boolean;result:T;error_code?:number;parameters?:{retry_after?:number}};
   if(!response.ok||!result.ok)throw new TelegramTransportError(result.error_code??response.status,Math.min(3600,Math.max(0,result.parameters?.retry_after??0)));
   return result.result;
  }catch(error){if(error instanceof TelegramTransportError)throw error;throw new TelegramTransportError(0);}
 }
 async me(){
  if(!this.identity)this.identity=this.call<{id:number;username:string;is_bot:boolean}>('getMe',{}).then(v=>{if(!v.is_bot||String(v.id)!==this.config.botId||!/^[A-Za-z0-9_]{5,32}$/.test(v.username))throw new TelegramTransportError(0);return {id:v.id,username:v.username};}).catch(e=>{this.identity=null;throw e;});
  return this.identity;
 }
 send(chatId:string,text:string,buttons?:{text:string;callback_data:string}[][]){
  const clean=(value:string,max:number)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/gu,'').slice(0,max).replace(/[\ud800-\udbff]$/,'')||'…';
  return this.call<{message_id:number}>('sendMessage',{chat_id:chatId,text:clean(text,3900),protect_content:true,...(buttons?{reply_markup:{inline_keyboard:buttons.map(row=>row.map(b=>({...b,text:clean(b.text,60)})))}}:{})});
 }
 async photo(fileId:string){
  const file=await this.call<{file_path?:string;file_size?:number}>('getFile',{file_id:fileId});
  if(!file.file_path||!Number.isSafeInteger(file.file_size)||file.file_size!<=0||file.file_size!>5_000_000||!/^[A-Za-z0-9_./-]+$/.test(file.file_path)||file.file_path.startsWith('/')||file.file_path.split('/').includes('..'))throw new TelegramTransportError(413);
  try{
   const response=await fetch('https://api.telegram.org/file/bot'+this.config.token+'/'+file.file_path,{redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok||!response.body||Number(response.headers.get('content-length'))>5_000_000){await response.body?.cancel().catch(()=>{});throw Error();}
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>5_000_000)throw Error();chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
   return Buffer.concat(chunks);
  }catch{throw new TelegramTransportError(413);}
 }
}
