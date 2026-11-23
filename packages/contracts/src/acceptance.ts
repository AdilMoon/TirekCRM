import {z} from 'zod';
const uuid=z.uuid().transform(value=>value.toLowerCase());
const version=z.number().int().min(0).max(2147483646);
export const acceptanceConfigSchema=z.strictObject({
  version,
  items:z.array(z.strictObject({id:uuid,label:z.string().trim().min(1).max(200),required:z.boolean()})).max(30)
    .refine(items=>new Set(items.map(item=>item.id)).size===items.length),
});
export const acceptanceCheckSchema=z.strictObject({version,itemId:uuid,checked:z.boolean()});
export interface AcceptanceItem {id:string;label:string;required:boolean;checked:boolean;checkedBy:string|null}
export interface OrderAcceptance {version:number;items:AcceptanceItem[];canConfigure:boolean;canCheck:boolean}
export const repeatVisitSchema=z.strictObject({
  reason:z.string().trim().min(3).max(1000),
  assigneeId:uuid,
  idempotencyKey:uuid,
});
export interface RepeatVisit {id:string;number:number;title:string;status:string}
