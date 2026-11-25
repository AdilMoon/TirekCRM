import {z} from 'zod';
import {moneySchema} from './money';
import type {PageResult,Stage} from './index';
const version=z.number().int().positive();
const page=z.coerce.number().int().min(1).max(100000).default(1);
export const objectBindSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('CREATE'),name:z.string().trim().min(1).max(160),address:z.string().trim().max(300).default(''),creationKey:z.uuid(),orderVersion:version}),
 z.strictObject({kind:z.literal('LINK'),objectId:z.uuid(),orderVersion:version}),
]);
export const objectViewSchema=z.strictObject({historyPage:page,requestPage:page});
export const objectChoiceSchema=z.strictObject({q:z.string().trim().max(160).default(''),page});
export const serviceRequestSchema=z.strictObject({token:z.string().regex(/^[a-f0-9]{64}$/),submissionKey:z.uuid(),description:z.string().trim().min(5).max(1000)});
export const serviceDecisionSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('CONVERTED'),version,title:z.string().trim().min(1).max(200),price:moneySchema}),
 z.strictObject({status:z.literal('DECLINED'),version,note:z.string().trim().max(300).default('')}),
]);
export type ObjectBindInput=z.infer<typeof objectBindSchema>;
export type ServiceRequestInput=z.infer<typeof serviceRequestSchema>;
export type ServiceDecisionInput=z.infer<typeof serviceDecisionSchema>;
export interface ServiceObjectItem {id:string;name:string;address:string}
export interface ObjectHistoryItem {id:string;number:number;title:string;status:Stage;dueDate:string|null;createdAt:string;repeatOfId:string|null}
export interface ServiceRequestItem {
 id:string;description:string;status:'NEW'|'CONVERTED'|'DECLINED';version:number;createdAt:string;
 sourceOrderId:string;sourceNumber:number;convertedOrderId:string|null;convertedNumber:number|null;decisionNote:string;
}
export interface ServiceObjectContext {
 object:ServiceObjectItem|null;canManage:boolean;orderVersion:number;
 history:PageResult<ObjectHistoryItem>;requests?:PageResult<ServiceRequestItem>;
}
