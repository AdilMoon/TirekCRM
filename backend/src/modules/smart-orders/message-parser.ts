import type {MessagePreview} from '@tirek/contracts';
import {moneySchema} from '@tirek/contracts';

// Conservative local extraction. No external model, guessed price or customer identity.
export function parseOrderMessage(message:string,now=new Date()):MessagePreview {
 const referenceDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const warnings:MessagePreview['warnings']=[];
 const field=(labels:string)=>message.match(new RegExp('(?:^|\\n)\\s*(?:'+labels+')\\s*[:：]\\s*([^\\n]+)','iu'))?.[1].trim()??'';
 let clientName=field('клиент|имя|аты|тапсырыс беруші').split(/[,;]/)[0].trim();
 if(!clientName)clientName=message.match(/(?:меня зовут|менің атым)\s+([^,;.\n]+)/iu)?.[1].trim()??'';
 if(clientName.length>160)clientName='';
 const phones=[...message.matchAll(/(?<!\d)(?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)/g)].map(m=>'+7'+m[0].replace(/\D/g,'').slice(1));
 const phone=new Set(phones).size===1?phones[0]:'';
 if(!clientName)warnings.push('CLIENT_REQUIRED');
 const unsupported=/(?:[$€₽]|\b(?:USD|EUR|RUB|доллар|евро|рубл))/iu.test(message);
 const amounts=new Set<string>();
 const patterns=[/(?:бюджет(?:ім)?|сумма|стоимость|бағасы|баға)\s*[:：]?\s*([0-9][0-9 \u00a0]*(?:[.,][0-9]{1,2})?)(?![0-9.,])/giu,/(?<![\d.,+\-])([0-9][0-9 \u00a0]*(?:[.,][0-9]{1,2})?)\s*(?:₸|теңге|тенге|KZT)(?!\p{L})/giu];
 for(const pattern of patterns)for(const match of message.matchAll(pattern)){
  if(message.slice(0,match.index).trimEnd().endsWith('-'))continue;
  const value=match[1].replace(/[ \u00a0]/g,'').replace(',','.');
  if(moneySchema.safeParse(value).success){const [whole,fraction='']=value.split('.');amounts.add(whole+'.'+fraction.padEnd(2,'0'));}
 }
 let amount='';
 if(unsupported)warnings.push('UNSUPPORTED_CURRENCY');
 else if(amounts.size===1)amount=[...amounts][0];
 else warnings.push(amounts.size>1?'AMOUNT_AMBIGUOUS':'AMOUNT_REQUIRED');
 const dates=new Set<string>();
 for(const match of message.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g))dates.add(match[1]);
 for(const match of message.matchAll(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g))dates.add(`${match[3]}-${match[2]}-${match[1]}`);
 if(/(?<!\p{L})(?:сегодня|бүгін|today)(?!\p{L})/iu.test(message))dates.add(referenceDate);
 if(/(?<!\p{L})(?:завтра|ертең|tomorrow)(?!\p{L})/iu.test(message)){const day=new Date(referenceDate+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1);dates.add(day.toISOString().slice(0,10));}
 const valid=[...dates].filter(d=>!Number.isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d);
 const dueDate=dates.size===1&&valid.length===1?valid[0]:'';
 if(dates.size>0&&!dueDate)warnings.push('DATE_AMBIGUOUS');
 let title=field('услуга|заказ|қызмет|тапсырыс').split(/\.\s|[;\n]/u)[0].trim();
 if(!title){
  title=message.split(/[\n.!?]/)[0].replace(/^(?:нужна?|нужно|қажет)\s+/iu,'')
   .split(/(?:сегодня|завтра|бүгін|ертең|бюджет|сумма|стоимость|бағасы|\b\d{1,2}:\d{2}\b|\+7|\b8\s*\()/iu)[0].replace(/[,;\s]+$/,'').trim();
  if(/^(?:клиент|имя|аты|телефон|меня зовут|менің атым)(?=[:\s]|$)/iu.test(title))title='';
 }
 if(title.length>200)title='';
 if(!title)warnings.push('TITLE_REQUIRED');
 return {title,clientName,phone,amount,dueDate,notes:message,referenceDate,warnings,matches:[]};
}
