import { moneySchema } from '@tirek/contracts';

export function parseReceiptCaption(caption: string) {
  const [first, ...rest] = caption.trim().split(/\r?\n/);
  const match = first.trim().match(/^((?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,2})?)(?:\s*(?:₸|KZT|тг))?$/iu);
  if (!match) return null;
  const amount = moneySchema.safeParse(match[1].replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
  const description = rest.join(' ').trim();
  if (!amount.success || description.length > 200 || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(description)) return null;
  return { amount: amount.data, description };
}
