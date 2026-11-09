import type {AssignmentCandidate,AssignmentSlot,WorkProfile} from '@tirek/contracts';
export function almatyTime(date:Date){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(v=>[v.type,v.value]));
 const day=`${p.year}-${p.month}-${p.day}`;
 return {day,minute:Number(p.hour)*60+Number(p.minute),weekday:new Date(day+'T00:00:00Z').getUTCDay()||7};
}
export function fitsProfile(profile:WorkProfile,startsAt:Date,duration:number,skills:string[]){
 const time=almatyTime(startsAt);
 return skills.every(s=>profile.skills.includes(s))&&profile.weekdays.includes(time.weekday)&&time.minute>=profile.startMinute&&time.minute+duration<=profile.endMinute;
}
export function rankCandidates(candidates:AssignmentCandidate[]){
 return candidates.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||a.workloadMinutes-b.workloadMinutes||a.activeTasks-b.activeTasks||a.name.localeCompare(b.name,'ru')||a.id.localeCompare(b.id));
}
export function slotDates(slot:AssignmentSlot){const start=new Date(slot.startsAt);return {start,end:new Date(start.getTime()+slot.durationMinutes*60000)};}
