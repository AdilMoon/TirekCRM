'use client';
import {useState} from 'react';
import type {FinancialOperation,Order} from '@tirek/contracts';
import {usePage} from '../lib/use-page';
import {useI18n} from '../i18n/provider';
import {Pagination} from '../components/pagination';

// Keep the original relation even when its order is outside the search page.
// An empty selection is the only way to explicitly unlink it.
type LinkedOrder=NonNullable<FinancialOperation['order']>;
export function ExpenseCorrectionOrder({value,onChange}:{value:LinkedOrder|null;onChange:(order:LinkedOrder|null)=>void}){
 const {t}=useI18n(),[q,setQ]=useState(''),[page,setPage]=useState(1);
 const {result,error,busy,retry}=usePage<Order>('/orders/search',new URLSearchParams({q,page:String(page)}).toString());
 const rows=result?.items??[],options=value&&!rows.some(row=>row.id===value.id)?[value,...rows]:rows;
 return <div className="client-picker"><label>{t('Поиск заказа по всей базе')}<input value={q} maxLength={200} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder={t('Название, номер или клиент')}/></label>
  <label>{t('Связать с заказом')}<select aria-label={t('Связать с заказом')} value={value?.id??''} onChange={e=>{const order=options.find(row=>row.id===e.target.value)??null;onChange(order);}}>
   <option value="">{t('Общий расход компании')}</option>{options.map(order=><option key={order.id} value={order.id}>№ {order.number} · {order.title}</option>)}
  </select></label>
  {error&&<p className="form-error" role="alert">{t(error)}<button type="button" onClick={retry}>{t('Обновить')}</button></p>}
  {result&&result.pages>1&&<Pagination result={result} page={page} setPage={setPage} busy={busy}/>}
 </div>;
}
