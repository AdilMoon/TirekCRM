'use client';
import { useState } from 'react';
import { expenseLabels, type ReceiptItem } from '@tirek/contracts';
import { Pagination } from '../components/pagination';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { usePage } from '../lib/use-page';

const filters = { PENDING: 'На проверке', APPROVED: 'Подтверждённые чеки', REJECTED: 'Отклонённые чеки' };

export function ExpenseReceipts({ orderId, onChange }: { orderId?: string; onChange: () => void }) {
  const { t, formatMoney, formatDate } = useI18n();
  const [status, setStatus] = useState<keyof typeof filters>('PENDING');
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState('');
  const [category, setCategory] = useState('MATERIALS');
  const [stock, setStock] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [photoReady, setPhotoReady] = useState(false);
  const params = new URLSearchParams({ status, page: String(page), ...(orderId ? { orderId } : {}) });
  const { result, error, busy, retry } = usePage<ReceiptItem>('/finance/receipts', params.toString());

  function open(id: string, description = '') {
    setStock(false); setName(description.slice(0,160)); setQuantity('1');
    setOpened(id); setPhotoReady(false); setCategory('MATERIALS'); setProblem(''); setNotice('');
  }
  async function decide(id: string, approve: boolean) {
    if (working) return;
    setWorking(true); setProblem(''); setNotice('');
    try {
      await api('/finance/receipts/' + id, { method: 'PATCH', body: JSON.stringify(approve
        ? { status: 'APPROVED', category: stock ? 'MATERIALS' : category, ...(stock ? {stock:{name:name.trim(),quantity:Number(quantity)}} : {}) } : { status: 'REJECTED' }) });
      open('');
      setNotice(approve ? (stock ? 'Партия принята на склад' : 'Расход по чеку учтён в заказе') : 'Чек отклонён');
      if (result?.items.length === 1 && page > 1) setPage(page - 1);
      retry();
      if (approve) onChange();
    } catch (e) { setProblem((e as Error).message); }
    finally { setWorking(false); }
  }

  return <section className="panel receipt-panel" aria-label={t('Чеки сотрудников')}>
    <div className="receipt-heading"><h3>{t('Чеки сотрудников')}</h3>
      <button type="button" className="text-button" disabled={working || busy} onClick={() => { open(''); retry(); }}>{t('Обновить')}</button></div>
    <label>{t('Статус чека')} <select value={status} disabled={working} onChange={e => {
      open(''); setPage(1); setStatus(e.target.value as keyof typeof filters);
    }}>{Object.entries(filters).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
    {busy && <p role="status">{t('Загрузка…')}</p>}
    {(problem || error) && <p role="alert" className="alert">{t(problem || error)}</p>}
    {notice && <p role="status" className="schedule-success">{t(notice)}</p>}
    {result?.total === 0 && <p className="muted">{t('Чеков с таким статусом пока нет')}</p>}
    {result?.items.map(row => <article key={row.id} className="receipt-item">
      <div className="receipt-heading"><strong>{formatMoney(row.amount)}</strong>
        <button type="button" className="text-button" aria-expanded={opened === row.id} disabled={working}
          onClick={() => open(opened === row.id ? '' : row.id, row.description)}>{t(opened === row.id ? 'Скрыть чек' : 'Посмотреть чек')}</button></div>
      <p>{row.description}</p>
      {row.stock && <p>{t('Закупка на склад')} · {row.stock.name} × {row.stock.quantity}</p>}
      <p className="muted">{t('Заказ № {0}', row.order.number)} · {row.order.title} · {row.employee.name} · {formatDate(row.createdAt)}</p>
      {row.reviewedAt && <p className="muted">{row.reviewerName} · {formatDate(row.reviewedAt)}</p>}
      {opened === row.id && <>
        <a href={'/api/finance/receipts/' + row.id + '/photo'} target="_blank" rel="noreferrer">
          <img src={'/api/finance/receipts/' + row.id + '/photo'} alt={t('Фото чека')} onLoad={() => setPhotoReady(true)}
            onError={() => { setPhotoReady(false); setProblem('Не удалось загрузить фото чека'); }}/></a>
        {status === 'PENDING' && <div className="receipt-actions">
          <label>{t('Назначение чека')} <select value={stock?'stock':'direct'} disabled={working} onChange={e=>setStock(e.target.value==='stock')}>
            <option value="direct">{t('Расход этого заказа')}</option><option value="stock">{t('Закупка на склад')}</option></select></label>
          {stock ? <>
            <label>{t('Материал')} <input maxLength={160} value={name} disabled={working} onChange={e=>setName(e.target.value)}/></label>
            <label>{t('Количество в партии')} <input type="number" min="1" max="1000000" step="1" value={quantity} disabled={working} onChange={e=>setQuantity(e.target.value)}/></label>
            <p className="muted">{t('Вся сумма чека относится к одной партии. Затраты попадут в заказ при выдаче материала.')}</p>
          </> : <label>{t('Категория')} <select value={category} disabled={working}
          onChange={e => setCategory(e.target.value)}>{Object.entries(expenseLabels).map(([key, label]) =>
            <option key={key} value={key}>{t(label)}</option>)}</select></label>}
          <button className="button primary" type="button" disabled={working || !photoReady || (stock && (!name.trim() || !Number.isInteger(Number(quantity)) || Number(quantity)<1 || Number(quantity)>1000000))} onClick={() => decide(row.id, true)}>{t(stock?'Принять на склад':'Подтвердить расход')}</button>
          <button className="button secondary" type="button" disabled={working} onClick={() => decide(row.id, false)}>{t('Отклонить чек')}</button>
        </div>}
      </>}
    </article>)}
    {(page > 1 || (result?.pages ?? 0) > 1) && <Pagination result={result} page={page} busy={busy || working} setPage={p => { open(''); setPage(p); }}/>}
  </section>;
}
