import {z} from 'zod';
export function parseTaskAction(data:string){
 const match=data.match(/^(start|done):([a-f0-9-]{36}):([1-9]\d{0,9})$/);
 if(!match||!z.uuid().safeParse(match[2]).success)return null;
 const version=Number(match[3]);if(version>2147483646)return null;
 return {taskId:match[2],version,status:match[1]==='start'?'IN_PROGRESS' as const:'DONE' as const};
}
