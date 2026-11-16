'use client';

import type { OrderQuote } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';

export const quoteKindLabels = { BASE: 'Основная смета', EXTRA: 'Допработы' } as const;
export const quoteStatusLabels = {
  PENDING: 'Ожидает согласования',
  ACCEPTED: 'Предложение согласовано',
  REVOKED: 'Ссылка отозвана',
  EXPIRED: 'Срок ссылки истёк',
  STALE: 'Условия заказа изменились',
} as const;

export function QuoteBreakdown({ quote }: { quote: Pick<OrderQuote, 'kind' | 'snapshot'> }) {
  const { t, formatMoney } = useI18n();
  const { items, beforeTotal, afterTotal } = quote.snapshot;
  return <div className="quote-breakdown">
    <ul className="quote-lines">
      {items.map((item, index) => <li key={index}>
        <span><strong>{item.description}</strong><small>{item.quantity} × {formatMoney(item.unitPrice)}</small></span>
        <strong>{formatMoney(item.total)}</strong>
      </li>)}
    </ul>
    <dl className="quote-totals">
      {quote.kind === 'EXTRA' && <div><dt>{t('До допработ')}</dt><dd>{formatMoney(beforeTotal)}</dd></div>}
      <div><dt>{t(quote.kind === 'EXTRA' ? 'Итого с допработами' : 'Итого по смете')}</dt><dd>{formatMoney(afterTotal)}</dd></div>
    </dl>
  </div>;
}
