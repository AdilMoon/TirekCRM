import { z } from 'zod';
export function mailConfig(env:NodeJS.ProcessEnv=process.env){
  const mode=env.MAIL_DELIVERY??(env.NODE_ENV==='production'?'disabled':'local');
  if(!['disabled','local','gmail'].includes(mode))throw new Error('MAIL_DELIVERY must be disabled, local or gmail');
  if(mode==='local'&&env.NODE_ENV==='production')throw new Error('Local mail delivery must not run in production');
  if(mode!=='gmail')return {mode:mode as 'local'|'disabled',user:'',password:'',key:Buffer.alloc(0)};
  const user=env.GMAIL_USER?.trim().toLowerCase()??'',password=(env.GMAIL_APP_PASSWORD??'').replace(/\s/g,'');
  if(!z.email().safeParse(user).success||!/^[a-zA-Z0-9]{16}$/.test(password))throw new Error('Set GMAIL_USER and a 16-character GMAIL_APP_PASSWORD');
  if(!/^[a-f0-9]{64}$/i.test(env.MAIL_ENCRYPTION_KEY??''))throw new Error('Set MAIL_ENCRYPTION_KEY to 32 random bytes in hex');
  if(env.NODE_ENV==='production'){
    let secure=false;try{const url=new URL(env.WEB_ORIGIN??'');secure=url.protocol==='https:'&&url.origin===env.WEB_ORIGIN;}catch{}
    if(!secure)throw new Error('Gmail in production requires an explicit HTTPS WEB_ORIGIN');
  }
  return {mode:'gmail' as const,user,password,key:Buffer.from(env.MAIL_ENCRYPTION_KEY!,'hex')};
}
