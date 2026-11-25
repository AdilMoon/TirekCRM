import {z} from 'zod';
import type {PageResult,Stage} from './index';
export const attentionReasons=['LOSS','INCOMPLETE','RECEIPTS','APPROVAL','OVERRUN','TIME_REVIEW','DEADLINE','SERVICE_REQUEST'] as const;
export type AttentionReason=typeof attentionReasons[number];
export type AttentionTarget='profitability'|'effort'|'quotes'|'details'|'service-object';
export const attentionQuerySchema=z.strictObject({
  q:z.string().trim().max(160).default(''),
  reason:z.enum(attentionReasons).optional(),
  page:z.coerce.number().int().min(1).max(1000000).default(1),
});
export interface AttentionIssue {
  reason:AttentionReason;orderId:string;number:number;target:AttentionTarget;count:number;
}
export interface AttentionOrder {
  id:string;number:number;title:string;clientName:string;status:Stage;
  actualProfit:string|null;forecastProfit:string|null;issues:AttentionIssue[];
}
export interface OrderAttention extends PageResult<AttentionOrder> {
  asOf:string;
  summary:{orders:number;forecastLoss:string;reasons:Record<AttentionReason,number>};
}
