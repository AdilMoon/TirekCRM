'use client';
import { useRef, useState } from 'react';
import type { MaterialLotItem } from '@tirek/contracts';
import { Pagination } from '../components/pagination';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { usePage } from '../lib/use-page';

export function MaterialLots({orderId, revision, onChange}: {orderId?:string; revision:unknown; onChange?:()=>void}) {
  const {t, formatMoney, formatDate} = useI18n();
  const [page,setPage] = useState(1);
  const [search,setSearch] = useState('');
  const [amounts,setAmounts] = useState<Record<string,string>>({});
  const [working,setWorking] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const pending = useRef<{lotId:string; body:string}|null>(null);
  const params = new URLSearchParams({page:String(page),search,...(orderId?{orderId}:{})});
  const {result,error:loadError,busy,retry} = usePage<MaterialLotItem>('/finance/materials',params.toString(),revision);

  async function submit() {
    const op = pending.current;
    if (!op || working) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await api('/finance/materials/'+op.lotId+'/movements',{method:'POST',body:op.body});
      pending.current=null;
      setNotice('Движение материала сохранено');
      setAmounts({});
      retry(); onChange?.();
    } catch (e) {
      const failure=e as Error & {status?:number};
      if (failure.status && failure.status<500) {pending.current=null; retry();}
      setError(failure.message);
    } finally {setWorking(false);}
  }

  function move(lotId:string, kind:'ISSUE'|'RETURN', quantity:number) {
    if (!orderId || pending.current) return;
    pending.current={lotId,body:JSON.stringify({orderId,kind,quantity,idempotencyKey:crypto.randomUUID()})};
    void submit();
  }
  return <section className="panel receipt-panel" aria-label={t('Материалы со склада')}>
    <div className="receipt-heading"><h3>{t('Материалы со склада')}</h3><button type="button" className="text-button" onClick={retry} disabled={working || busy}>{t('Обновить')}</button></div>
    <label>{t('Найти материал')} <input type="search" maxLength={160} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label>
    {(error || loadError) && <p role="alert">{t(error || loadError)} {pending.current && <button type="button" disabled={working} onClick={submit}>{t('Повторить запрос')}</button>}</p>}
    {notice && <p role="status">{t(notice)}</p>}
    {busy && <p role="status">{t('Загрузка…')}</p>}
    {result?.total===0 && <p className="muted">{t('Партий не найдено')}</p>}
    {result?.items.map(row=>{
      const raw=amounts[row.id] ?? '1', quantity=Number(raw);
      const disabled=working || !!pending.current || !Number.isInteger(quantity) || quantity<1;
      return <article key={row.id} className="receipt-item"><div className="receipt-heading"><strong>{row.name}</strong>
        <a href={'/api/finance/receipts/'+row.receiptId+'/photo'} target="_blank" rel="noreferrer">{t('Фото чека')}</a></div>
        <p>{t('Партия от {0} · {1} шт. на {2}',formatDate(row.createdAt),row.quantity,formatMoney(row.amount))}</p>
        <p>{t('Остаток на складе · {0} шт. на {1}',row.available,formatMoney(row.availableValue))}</p>
        {orderId && <><p>{t('В этом заказе · {0} шт. на {1}',row.allocated,formatMoney(row.allocatedValue))}</p>
          <div className="receipt-actions"><label>{t('Количество')} <input type="number" min="1" max="1000000" value={raw} disabled={working}
            onChange={e=>setAmounts({...amounts,[row.id]:e.target.value})}/></label>
            <button className="button secondary" type="button" disabled={disabled || quantity>row.available} onClick={()=>move(row.id,'ISSUE',quantity)}>{t('Выдать в заказ')}</button>
            <button className="button secondary" type="button" disabled={disabled || quantity>row.allocated} onClick={()=>move(row.id,'RETURN',quantity)}>{t('Вернуть на склад')}</button></div></>}
      </article>;
    })}
    {(page>1 || (result?.pages??0)>1) && <Pagination result={result} page={page} setPage={setPage} busy={busy || working}/>}
  </section>;
}
