export function telegramConfig(env:NodeJS.ProcessEnv=process.env){
 const mode=env.TELEGRAM_DELIVERY??'disabled';
 if(!['disabled','telegram'].includes(mode))throw Error('TELEGRAM_DELIVERY must be disabled or telegram');
 if(mode==='disabled')return {enabled:false,token:'',botId:''};
 const token=env.TELEGRAM_BOT_TOKEN??'',match=token.match(/^([1-9]\d{0,19}):[A-Za-z0-9_-]{20,100}$/);
 if(!match)throw Error('Configure TELEGRAM_BOT_TOKEN locally before enabling Telegram');
 return {enabled:true,token,botId:match[1]};
}
