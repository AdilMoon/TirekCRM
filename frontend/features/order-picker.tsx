'use client';
import { useState } from 'react';
import type { Order } from '@tirek/contracts';
import { usePage } from '../lib/use-page';
import { useI18n } from '../i18n/provider';
import { Pagination } from '../components/pagination';
export function OrderPicker({purpose}:{purpose:'payment'|'expense'|'document'}){
 const {t,formatMoney}=useI18n();const [q,setQ]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState<Order|null>(null);
 const {result,error,busy,retry}=usePage<Order>('/orders/search',new URLSearchParams({q,page:String(page),...(purpose==='document'?{status:'COMPLETED'}:{})}).toString());
 const rows=result?.items??[],options=selected&&!rows.some(o=>o.id===selected.id)?[selected,...rows]:rows;
 return <div className="client-picker"><label>{t('Поиск заказа по всей базе')}<input value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder={t('Название, номер или клиент')}/></label>
 <label>{t(purpose==='expense'?'Связать с заказом':purpose==='document'?'Выполненный заказ *':'Заказ *')}<select name="orderId" required={purpose!=='expense'} value={selected?.id??''} onChange={e=>setSelected(options.find(o=>o.id===e.target.value)??null)}>
 <option value="" disabled={purpose!=='expense'}>{t(purpose==='expense'?'Общий расход компании':'Выберите заказ')}</option>{options.map(o=><option key={o.id} value={o.id} disabled={purpose==='payment'&&(o.status==='CANCELLED'||Number(o.debt)<=0)}>№ {o.number} · {o.title}{purpose==='payment'?' '+t('· остаток')+' '+formatMoney(o.debt):''}</option>)}</select></label>
 {purpose==='payment'&&<p className="form-note">{t('Отменённые и полностью оплаченные заказы недоступны для оплаты.')}</p>}
 {error&&<p className="form-error" role="alert">{t(error)}<button type="button" onClick={retry}>{t('Обновить')}</button></p>}
 {!busy&&!error&&!rows.length&&<p className="form-note">{t('Ничего не найдено')}</p>}
 {result&&result.pages>1&&<Pagination result={result} page={page} setPage={setPage} busy={busy}/>}</div>;
}
