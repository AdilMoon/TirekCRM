export type Locale = 'ru' | 'kk' | 'en';
export const localeTags = { ru:'ru-KZ', kk:'kk-KZ', en:'en-GB' } as const;
const months = ['қаңтар','ақпан','наурыз','сәуір','мамыр','маусым','шілде','тамыз','қыркүйек','қазан','қараша','желтоқсан'];
const shortMonths = ['қаң.','ақп.','нау.','сәу.','мам.','мау.','шіл.','там.','қыр.','қаз.','қар.','жел.'];
const weekdays:Record<string,string> = { Monday:'дүйсенбі',Tuesday:'сейсенбі',Wednesday:'сәрсенбі',Thursday:'бейсенбі',Friday:'жұма',Saturday:'сенбі',Sunday:'жексенбі' };
// Some browser ICU builds resolve kk but return root-locale month names such as M10.
// Explicit Kazakh labels keep date rendering consistent across browsers.
export function formatDate(language:Locale, value:Date|string, options:Intl.DateTimeFormatOptions = {day:'numeric',month:'short'}) {
 const date = value instanceof Date ? value : new Date(value);
 if(language!=='kk')return new Intl.DateTimeFormat(localeTags[language],{timeZone:'Asia/Almaty',...options}).format(date);
 const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'numeric',weekday:'long'}).formatToParts(date);
 const get=(type:string)=>parts.find(p=>p.type===type)!.value;
 const long=options.dateStyle==='long'||options.dateStyle==='full';
 const month=Number(get('month'))-1;
 let result = '';
 if(options.year||long)result+=get('year')+' ж. ';
 if(options.day||long||options.dateStyle==='short')result+=(options.day==='2-digit'?get('day'):Number(get('day')))+' ';
 if(options.month||long)result+=(options.month==='long'||long?months[month]:shortMonths[month]);
 if(options.weekday||options.dateStyle==='full')result+=(result.trim()?', ':'')+weekdays[get('weekday')];
 if(options.hour)result+=' · '+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
 return result.trim();
}
export function formatMoney(language:Locale,value:string|number) {
 const locale=language==='kk'?'ru-KZ':localeTags[language];
 // Chart tick values are approximate numbers; API amounts remain exact decimal strings.
 if(typeof value==='number')return new Intl.NumberFormat(locale,{style:'currency',currency:'KZT',currencyDisplay:'narrowSymbol',maximumFractionDigits:value%1?2:0}).format(value);
 const match=/^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
 if(!match)return '—';
 const whole=BigInt(match[2]),fraction=(match[3]??'').padEnd(2,'0');
 const negative=match[1]==='-'&&(whole!==0n||fraction!=='00');
 const digits=fraction==='00'?0:2;
 const formatter=new Intl.NumberFormat(locale,{style:'currency',currency:'KZT',currencyDisplay:'narrowSymbol',minimumFractionDigits:digits,maximumFractionDigits:digits});
 const integer=negative?(whole===0n?-0:-whole):whole;
 return formatter.formatToParts(integer).map(part=>part.type==='fraction'?fraction:part.value).join('');
}
