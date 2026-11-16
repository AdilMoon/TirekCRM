'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Download } from 'lucide-react';
import type { OrderEffortDetail, OrderEffortRow } from '@tirek/contracts';
import { Field, ModalShell, Status } from '../components/ui';
import { Pagination } from '../components/pagination';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { downloadCsv } from '../lib/download-csv';
import { usePage } from '../lib/use-page';

const duration = (t: ReturnType<typeof useI18n>['t'], minutes: number) =>
  t('{0} ч {1} мин', Math.floor(minutes / 60), minutes % 60);

function Difference({ minutes, order }: { minutes: number | null; order: OrderEffortRow }) {
  const { t } = useI18n();
  if (order.plannedMinutes === null) return t('План не задан');
  if (minutes === null) return t('Нет подтверждённых часов');
  if (minutes === 0) return t('По плану');
  return <span className={minutes > 0 ? 'effort-overrun' : undefined}>{minutes > 0 ? '+' : '−'}{duration(t, Math.abs(minutes))}</span>;
}

export function OrderEffort({ id, close }: { id: string; close: () => void }) {
  const { t } = useI18n();
  const path = '/orders/' + id + '/effort';
  const [record, setRecord] = useState<OrderEffortDetail | null>(null);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [load, setLoad] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const planned = Number(hours) * 60 + Number(minutes);

  useEffect(() => {
    const controller = new AbortController();
    api<OrderEffortDetail>(path, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setRecord(result);
      setHours(result.plannedMinutes === null ? '' : String(Math.floor(result.plannedMinutes / 60)));
      setMinutes(result.plannedMinutes === null ? '' : String(result.plannedMinutes % 60));
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, load]);

  function refresh() {
    setError('');
    setLoading(true);
    setLoad(value => value + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!record) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api(path, { method: 'PATCH', body: JSON.stringify({ minutes: planned, orderVersion: record.orderVersion }) });
      setSaved(true);
      refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <ModalShell title={t('План и факт по заказу')} onClose={close} busy={busy}>
    {error && <p className="alert" role="alert">{t(error)} <button onClick={refresh}>{t('Обновить')}</button></p>}
    {saved && <p className="schedule-success" role="status">{t('План времени сохранён')}</p>}
    {loading && <p role="status">{t('Загрузка…')}</p>}
    {record && <div className="effort-body">
      <h3>{t('Заказ № {0}', record.number)} · {record.title}</h3>
      <p className="muted">{t('Время суммируется по сотрудникам. Часы на проверке показаны отдельно.')}</p>
      <dl className="effort-metrics">
        <div><dt>{t('План')}</dt><dd>{record.plannedMinutes === null ? '—' : duration(t, record.plannedMinutes)}</dd></div>
        <div><dt>{t('Подтверждённый факт')}</dt><dd>{duration(t, record.actualMinutes)}</dd></div>
        <div><dt>{t('Отклонение от плана')}</dt><dd><Difference minutes={record.deltaMinutes} order={record}/></dd></div>
        <div><dt>{t('Часы на проверке')}</dt><dd>{duration(t, record.pendingMinutes)}</dd></div>
      </dl>
      <form className="editor-form" onSubmit={submit}>
        <div className="form-row">
          <Field label={t('План · часы')} type="number" min="0" max="1000" step="1" value={hours} disabled={busy || loading}
            onChange={event => { setHours(event.target.value); setSaved(false); }}/>
          <Field label={t('План · минуты')} type="number" min="0" max="59" step="1" value={minutes} disabled={busy || loading}
            onChange={event => { setMinutes(event.target.value); setSaved(false); }}/>
        </div>
        <div><button className="button primary" disabled={busy || loading || !Number.isInteger(planned) || planned < 1 || planned > 60000 || planned === record.plannedMinutes}>{t('Сохранить план времени')}</button></div>
      </form>
      <h3>{t('Время по сотрудникам')}</h3>
      {record.contributors.length === 0 ? <p className="muted">{t('В табеле пока нет рабочих часов по этому заказу.')}</p> :
        <div className="effort-scroll"><table className="effort-table">
          <thead><tr><th>{t('Сотрудник')}</th><th>{t('Факт')}</th><th>{t('На проверке')}</th><th>{t('Сверхурочные')}</th></tr></thead>
          <tbody>{record.contributors.map(person => <tr key={person.employeeId}>
            <th scope="row">{person.name}</th><td>{duration(t, person.actualMinutes)}</td>
            <td>{duration(t, person.pendingMinutes)}</td><td>{duration(t, person.overtimeMinutes)}</td>
          </tr>)}</tbody>
        </table></div>}
    </div>}
  </ModalShell>;
}

export function OrderEffortReport({ close }: { close: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [overrun, setOverrun] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [revision, setRevision] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const params = new URLSearchParams({ q, ...(overrun ? { overrun: '1' } : {}) });
  const report = usePage<OrderEffortRow>('/order-effort', new URLSearchParams({ ...Object.fromEntries(params), page: String(page) }).toString(), revision);

  async function exportReport() {
    setExporting(true);
    setExportError('');
    try {
      await downloadCsv('/order-effort/export?' + params, 'tirek-order-effort.csv');
    } catch (error) {
      setExportError((error as Error).message);
    } finally {
      setExporting(false);
    }
  }

  if (selectedId) return <OrderEffort id={selectedId} close={() => {
    setSelectedId(''); setPage(1); setRevision(value => value + 1);
  }}/>;

  return <ModalShell title={t('Отчёт по времени заказов')} onClose={close}>
    <div className="effort-body">
      <label>{t('Название или номер заказа')}<input type="search" value={q} maxLength={150} onChange={event => {
        setQ(event.target.value); setPage(1); setExportError('');
      }}/></label>
      <div className="effort-filters">
        <label className="check-label"><input type="checkbox" checked={overrun} onChange={event => {
          setOverrun(event.target.checked); setPage(1); setExportError('');
        }}/>{t('Только перерасход времени')}</label>
        <button type="button" className="button secondary" disabled={exporting || report.busy || !report.result?.items.length} onClick={exportReport}>
          <Download size={16} aria-hidden="true"/>{t(exporting ? 'Подготовка CSV…' : 'Выгрузить отчёт CSV')}
        </button>
      </div>
      {report.error && <p className="alert" role="alert">{t(report.error)} <button onClick={report.retry}>{t('Обновить')}</button></p>}
      {exportError && <p className="form-error" role="alert">{t(exportError)}</p>}
      {report.busy ? <p role="status">{t('Загрузка…')}</p> : report.result && (report.result.items.length ? <>
        <div className="effort-scroll"><table className="effort-table">
          <thead><tr><th>{t('Заказ')}</th><th>{t('План')}</th><th>{t('Факт')}</th><th>{t('Отклонение от плана')}</th></tr></thead>
          <tbody>{report.result.items.map(order => <tr key={order.id}>
            <th scope="row"><button type="button" className="text-button" onClick={() => setSelectedId(order.id)}>#{order.number} · {order.title}</button><Status status={order.status}/></th>
            <td>{order.plannedMinutes === null ? '—' : duration(t, order.plannedMinutes)}</td><td>{duration(t, order.actualMinutes)}</td>
            <td><Difference minutes={order.deltaMinutes} order={order}/></td>
          </tr>)}</tbody>
        </table></div>
      </> : <p className="muted">{t('Ничего не найдено')}</p>)}
      {report.result && (report.result.pages > 1 || page > 1) && <Pagination result={report.result} busy={report.busy} page={page} setPage={setPage}/>}
    </div>
  </ModalShell>;
}
