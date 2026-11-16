'use client';

import { useEffect, useState } from 'react';
import type { WorkTimeOrder } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';

export function WorkTimeOrderPicker({ value, onChange, disabled }: {
  value: WorkTimeOrder | null;
  onChange: (order: WorkTimeOrder | null) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState<WorkTimeOrder[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<WorkTimeOrder[]>('/work-time/orders?' + new URLSearchParams({ q }), { signal: controller.signal })
        .then(rows => { if (!controller.signal.aborted) setOrders(rows); })
        .catch(error => { if (!controller.signal.aborted) setError(error.message); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [q]);
  const options = value && !orders.some(order => order.id === value.id) ? [value, ...orders] : orders;
  return <>
    <label>{t('Поиск заказа для табеля')}<input type="search" value={q} maxLength={150} disabled={disabled}
      placeholder={t('Название или номер заказа')} onChange={event => {
        setBusy(true); setError(''); setQ(event.target.value);
      }}/></label>
    <label>{t('Заказ')}
      <select value={value?.id ?? ''} disabled={disabled || busy} onChange={event =>
        onChange(options.find(order => order.id === event.target.value) ?? null)}>
        <option value="">{t('Без привязки к заказу')}</option>
        {options.map(order => <option key={order.id} value={order.id}>#{order.number} · {order.title}</option>)}
      </select>
    </label>
    {busy && <p className="muted" role="status">{t('Загрузка…')}</p>}
    {!busy && !error && orders.length === 0 && <p className="muted">{t('Доступные заказы не найдены')}</p>}
    {error && <p className="form-error" role="alert">{t(error)}</p>}
  </>;
}
