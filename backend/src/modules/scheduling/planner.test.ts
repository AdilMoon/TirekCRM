import {test} from 'node:test';
import assert from 'node:assert/strict';
import {almatyTime,fitsProfile,rankCandidates,slotDates} from './planner';
import {assignmentSlotSchema,workProfileSchema,assignOrderSchema,type AssignmentCandidate} from '@tirek/contracts';
test('Almaty work day and midnight are independent of host timezone',()=>{
 assert.deepEqual(almatyTime(new Date('2026-11-09T20:00:00Z')),{day:'2026-11-10',minute:60,weekday:2});
 assert.equal(almatyTime(new Date('2026-11-09T19:00:00Z')).minute,0);
 const dates=slotDates({startsAt:'2026-11-10T09:00:00+05:00',durationMinutes:90,requiredSkills:[]});assert.equal(dates.end.toISOString(),'2026-11-10T05:30:00.000Z');
});
test('all skills and the entire interval must fit one configured working day',()=>{
 const p={skills:['уборка','окна'],weekdays:[2],startMinute:540,endMinute:1080,version:1};
 assert.equal(fitsProfile(p,new Date('2026-11-10T09:00:00+05:00'),540,['уборка','окна']),true);
 assert.equal(fitsProfile(p,new Date('2026-11-10T17:45:00+05:00'),30,[]),false);
 assert.equal(fitsProfile(p,new Date('2026-11-11T09:00:00+05:00'),60,[]),false);
 assert.equal(fitsProfile(p,new Date('2026-11-10T09:00:00+05:00'),60,['электрика']),false);
});
test('ranking prioritizes eligibility then booked minutes then active tasks with stable ties',()=>{
 const c=(id:string,eligible:boolean,minutes:number,tasks:number):AssignmentCandidate=>({id,name:id,eligible,workloadMinutes:minutes,activeTasks:tasks,profileVersion:1,blocks:[],missingSkills:[]});
 assert.deepEqual(rankCandidates([c('z',false,0,0),c('b',true,60,0),c('d',true,0,2),c('a',true,0,1),c('c',true,0,1)]).map(c=>c.id),['a','c','d','b','z']);
});
test('strict scheduling contracts reject partial slots invalid shifts duplicate skills and forged reasons',()=>{
 const slot={startsAt:'2026-11-10T09:00:00+05:00',durationMinutes:60,requiredSkills:['Уборка']};
 assert.deepEqual(assignmentSlotSchema.parse(slot).requiredSkills,['уборка']);
 for(const change of [{durationMinutes:0},{durationMinutes:61},{startsAt:'2026-11-10T09:01:00+05:00'},{startsAt:'2026-11-10T09:00:01+05:00'},{requiredSkills:['Уборка','уборка']},{requiredSkills:['a\u0000']}])assert.equal(assignmentSlotSchema.safeParse({...slot,...change}).success,false);
 assert.equal(assignmentSlotSchema.safeParse({...slot,eligible:true}).success,false);
 assert.equal(workProfileSchema.safeParse({skills:[],weekdays:[1,1],startMinute:540,endMinute:1080,version:0}).success,false);
 assert.equal(workProfileSchema.safeParse({skills:[],weekdays:[1],startMinute:1080,endMinute:540,version:0}).success,false);
 assert.equal(assignOrderSchema.safeParse({...slot,employeeId:'12345678-1234-4123-8123-123456789012',profileVersion:1,orderVersion:1,currentBookingId:null,idempotencyKey:'12345678-1234-4123-8123-123456789012',recommended:true}).success,false);
});
