import { z } from 'zod';

const quoteItem = z.strictObject({
  description: z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)),
  quantity: z.number().int().min(1).max(10000),
  unitPrice: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).refine(value => /[1-9]/.test(value)),
});
const version = z.number().int().positive().max(2147483647);
const token = z.string().regex(/^[a-f0-9]{64}$/);
export const publishQuoteSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('BASE'), orderVersion: version }),
  z.strictObject({ kind: z.literal('EXTRA'), orderVersion: version, items: z.array(quoteItem).min(1).max(10) }),
]);
export const quoteAccessSchema = z.strictObject({ token });
export const quoteAcceptSchema = quoteAccessSchema.extend({ revision: version, agreed: z.literal(true) });

export type PublishQuoteInput = z.infer<typeof publishQuoteSchema>;
export type QuoteItemInput = z.infer<typeof quoteItem>;
export interface QuoteSnapshot {
  companyName: string;
  orderNumber: number;
  title: string;
  items: (QuoteItemInput & { total: string })[];
  beforeTotal: string;
  afterTotal: string;
}
export interface OrderQuote {
  kind: 'BASE' | 'EXTRA';
  revision: number;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' | 'STALE';
  snapshot: QuoteSnapshot;
}
export interface ManagedOrderQuote extends OrderQuote {
  id: string;
  revokedAt: string | null;
}
export interface OrderQuotes {
  entries: ManagedOrderQuote[];
  orderVersion: number;
  orderTotal: string;
  canPublish: boolean;
  hasAcceptedBase: boolean;
}
