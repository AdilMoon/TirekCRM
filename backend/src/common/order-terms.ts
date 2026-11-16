import { createHash } from 'node:crypto';
import { cents, money } from './money';

type Terms = {
  clientId: string;
  title: string;
  total: string;
  items: { description: string; quantity: number; unitPrice: string }[];
};

export function orderTermsHash(order: Terms) {
  // Preserve duplicate lines while ignoring their database order and decimal formatting.
  const items = order.items.map(line =>
    JSON.stringify([line.description, line.quantity, money(cents(line.unitPrice))]),
  ).sort();
  return createHash('sha256').update(JSON.stringify([order.clientId, order.title, money(cents(order.total)), items])).digest('hex');
}
