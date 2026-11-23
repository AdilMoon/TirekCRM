'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { orderProfitabilitySchema, type OrderCostColumn, type OrderProfitability } from '@tirek/contracts';
import { Field, ModalShell } from '../components/ui';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { ExpenseReceipts } from './expense-receipts';
import {RepeatVisits} from './repeat-visits';
import { MaterialLots } from './material-lots';

const measures = [
  ['labor', 'Стоимость труда'],
  ['expenses', 'Прямые расходы'],
  ['rework', 'Стоимость повторных выездов'],
  ['cost', 'Себестоимость'],
  ['profit', 'Прибыль'],
  ['marginPercent', 'Маржа'],
] as const;

export function OrderProfitabilityPanel({ id, close }: { id: string; close: () => void }) {
  const { t, formatMoney, language } = useI18n();
  const path = '/orders/' + id + '/profitability';
  const [record, setRecord] = useState<OrderProfitability | null>(null);
  const [visit,setVisit]=useState('');
  const [load, setLoad] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<OrderProfitability>(path, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setRecord(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, load]);

  function refresh() {
    setError('');
    setLoading(true);
    setLoad(value => value + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record) return;
    const form = new FormData(event.currentTarget);
    const amount = (key: string) => String(form.get(key) ?? '').trim().replace(',', '.') || null;
    const rates = record.contributors.flatMap(person => {
      const hourlyRate = amount(person.employeeId);
      return hourlyRate === person.hourlyRate ? [] : [{ employeeId: person.employeeId, hourlyRate }];
    });
    const value = orderProfitabilitySchema.safeParse({
      costVersion: record.costVersion, plannedHourlyRate: amount('plannedHourlyRate'),
      plannedDirectExpenses: amount('plannedDirectExpenses'), actualHourlyRate: amount('actualHourlyRate'), rates,
    });
    setSaved(false);
    if (!value.success) {
      setError('Проверьте суммы и часовые ставки');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(path, { method: 'PATCH', body: JSON.stringify(value.data) });
      setSaved(true);
      refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function formatted(column: OrderCostColumn, key: keyof OrderCostColumn) {
    const value = column[key];
    if (value === null) return '—';
    if (key === 'marginPercent') return (language === 'en' ? value : value.replace('.', ',')) + '%';
    return formatMoney(value);
  }

  const duration = (minutes: number) => t('{0} ч {1} мин', Math.floor(minutes / 60), minutes % 60);
  const amountInput = { inputMode: 'decimal' as const, maxLength: 15, disabled: saving || loading };
  const missingRates = record?.actualHourlyRate === null
    ? record.contributors.filter(person => person.hourlyRate === null).length : 0;

  if(visit) return <OrderProfitabilityPanel key={visit} id={visit} close={()=>{setVisit('');refresh();}}/>;
  return <ModalShell title={t('Прибыльность заказа')} onClose={close} busy={saving}>
    {error && <p className="alert" role="alert">{t(error)} <button onClick={refresh}>{t('Обновить')}</button></p>}
    {saved && <p className="schedule-success" role="status">{t('Параметры прибыльности сохранены')}</p>}
    {loading && <p role="status">{t('Загрузка…')}</p>}
    {record && <div className="effort-body profitability">
      <div>
        <h3>{t('Заказ № {0}', record.number)} · {record.title}</h3>
        <p className="profitability-revenue">{t('Сумма заказа')} <strong>{formatMoney(record.revenue)}</strong></p>
        <p className="muted">{t('Прибыль и маржа рассчитаны от суммы заказа и его прямой себестоимости.')}</p>
        {record.actualRevenue !== record.revenue && <p className="muted">{t('Выручка по отменённому заказу: {0}', formatMoney(record.actualRevenue))}</p>}
      </div>
      <div className="effort-scroll"><table className="effort-table profitability-table">
        <thead><tr><th>{t('Показатель')}</th><th>{t('План')}</th><th>{t('Факт')}</th><th>{t('Прогноз')}</th></tr></thead>
        <tbody>{measures.map(([key, label]) => <tr key={key}>
          <th scope="row">{t(label)}</th>
          <td className={record.planned[key]?.startsWith('-') ? 'effort-overrun' : undefined}>{formatted(record.planned, key)}</td>
          <td className={record.actual[key]?.startsWith('-') ? 'effort-overrun' : undefined}>{formatted(record.actual, key)}</td>
          <td className={record.forecast.atCompletion[key]?.startsWith('-') ? 'effort-overrun' : undefined}>{formatted(record.forecast.atCompletion, key)}</td>
        </tr>)}</tbody>
      </table></div>
      <section className="profitability-forecast">
        <h3>{record.forecast.atCompletion.profit?.startsWith('-')
          ? t('Ожидаемый убыток по заказу — {0}', formatMoney(record.forecast.atCompletion.profit.slice(1)))
          : t('Прогноз к завершению заказа')}</h3>
        {record.forecast.closed ? <p>{t('Заказ закрыт. Прогноз учитывает понесённые расходы и часы, включая часы на проверке.')}</p> : <>
          <p>{record.forecast.remainingMinutes === null ? t('Для оценки оставшихся часов укажите длительность в разделе «План и факт по заказу».') :
            t('Осталось по плану {0} после вычета подтверждённых часов и часов на проверке.', duration(record.forecast.remainingMinutes))}</p>
          {record.forecast.remainingMinutes !== 0 && record.forecast.remainingHourlyRate !== null &&
            <p>{t('Ставка для оставшихся часов — {0} в час.', formatMoney(record.forecast.remainingHourlyRate))}</p>}
          <p>{record.forecast.remainingExpenses === null ? t('Введите бюджет прямых расходов. Если расходов не ожидается, укажите 0.') :
            t('Остаток бюджета прямых расходов — {0}. Прогноз предполагает, что он будет израсходован.', formatMoney(record.forecast.remainingExpenses))}</p>
        </>}
        {record.forecast.atCompletion.labor === null && (record.pendingMinutes > 0 || record.forecast.remainingMinutes !== 0) && record.forecast.remainingHourlyRate === null &&
          <p>{t('Для оценки часов на проверке и оставшейся работы укажите общую фактическую или плановую ставку.')}</p>}
        {record.pendingMinutes > 0 && <p>{t('Часы на проверке включены только в прогноз. Для них применяется индивидуальная, общая фактическая или плановая ставка в этом порядке.')}</p>}
      </section>
      <div className="profitability-notes">
        {record.actualMinutes === 0 ? <p className="muted">{t('Нет подтверждённых часов')}</p> :
          <p className="muted">{t('Учтено подтверждённых часов: {0}', duration(record.actualMinutes))}</p>}
        {record.pendingMinutes > 0 && <p className="muted">{t('Часы на проверке')}: {duration(record.pendingMinutes)}</p>}
        {record.plannedMinutes === null && record.planned.labor === null && <p className="form-note">{t('Задайте длительность в разделе «План и факт по заказу» или введите нулевую плановую ставку для заказа без затрат на труд.')}</p>}
        {missingRates > 0 && <p className="form-note">{t('Укажите фактическую ставку. Сотрудников с подтверждёнными часами без ставки: {0}', missingRates)}</p>}
      </div>

      <ExpenseReceipts orderId={id} onChange={refresh}/>
      <RepeatVisits record={record} open={setVisit} refresh={refresh}/>
      <MaterialLots orderId={id} revision={load} onChange={refresh}/>
      <form className="editor-form" onSubmit={submit} key={record.costVersion}>
        <h3>{t('Бюджет и ставки этого заказа')}</h3>
        <div className="form-row">
          <Field label={t('Плановая ставка за час, ₸')} name="plannedHourlyRate" defaultValue={record.plannedHourlyRate ?? ''} {...amountInput}/>
          <Field label={t('Плановые расходы, ₸')} name="plannedDirectExpenses" defaultValue={record.plannedDirectExpenses ?? ''} {...amountInput}/>
        </div>
        <Field label={t('Общая фактическая ставка за час, ₸')} name="actualHourlyRate" defaultValue={record.actualHourlyRate ?? ''} {...amountInput}/>
        <p className="muted">{t('Укажите 0 для нулевой стоимости. Индивидуальная ставка сотрудника имеет приоритет над общей.')}</p>
        {record.contributors.length > 0 && <details className="profitability-rates">
          <summary>{t('Индивидуальные ставки сотрудников')}</summary>
          {record.contributors.map(person => <label key={person.employeeId}>
            <span>{person.name} · {duration(person.approvedMinutes)}</span>
            <input name={person.employeeId} defaultValue={person.hourlyRate ?? ''}
              placeholder={record.actualHourlyRate ?? t('Ставка за час, ₸')} {...amountInput}/>
          </label>)}
        </details>}
        <div><button className="button primary" disabled={saving || loading}>{t('Сохранить бюджет и ставки')}</button></div>
      </form>
    </div>}
  </ModalShell>;
}
