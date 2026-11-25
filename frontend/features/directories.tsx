'use client';
import { useState } from 'react';
import { Clock3, Pencil } from 'lucide-react';
import type { Client, Order } from '@tirek/contracts';
import { stages, stageLabels } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';
import { usePage } from '../lib/use-page';
import { SearchBox, Empty } from '../components/ui';
import { Pagination } from '../components/pagination';
import { OrdersTable } from './orders-table';
import {OrderAttentionBoard} from './order-attention';
import { OrderEffortReport } from './order-effort';
export function ClientDirectory({revision,onSelect,onOverview}:{revision:unknown;onSelect:(client:Client)=>void;onOverview:(id:string)=>void}) {
 const {t,dateLabel}=useI18n();
 const [q,setQ]=useState(''),[page,setPage]=useState(1);
 const {result,error,busy,retry}=usePage<Client>('/clients/search',new URLSearchParams({q,page:String(page)}).toString(),revision);
 return <section className="panel" aria-busy={busy}><div className="table-toolbar"><h2>{t('Клиентская база')}</h2>
  <SearchBox value={q} setValue={value=>{setQ(value);setPage(1);}} placeholder={t('Имя, компания или телефон')} /></div>
  {error&&<div className="alert" role="alert">{t(error)}<button onClick={retry}>{t('Обновить')}</button></div>}
  <div className="table-wrap"><table className="clients-table"><thead><tr><th>{t('Клиент')}</th><th>{t('Контакты')}</th><th>{t('Адрес')}</th><th>{t('Заказы')}</th><th>{t('Добавлен')}</th></tr></thead>
  <tbody>{result?.items.map(c=><tr key={c.id}><td><div className="client-cell"><span className="client-avatar">{c.name.slice(0,1)}</span><div>
   <button className="text-button" onClick={()=>onSelect(c)}><strong>{c.name}</strong><Pencil size={13}/></button><small>{c.company||t('Частный клиент')}</small>
   <button className="text-button" onClick={()=>onOverview(c.id)}>{t('История и оплаты')}</button>
  </div></div></td><td data-label={t('Контакты')}>{c.phone||t('Телефон не указан')}<small className="cell-sub">{c.email}</small></td><td data-label={t('Адрес')}>{c.address||'—'}</td><td data-label={t('Заказы')}>{c.ordersCount}</td><td data-label={t('Добавлен')}>{dateLabel(c.createdAt)}</td></tr>)}</tbody></table></div>
  {!busy&&!error&&!result?.items.length&&<Empty>{t('Ничего не найдено')}</Empty>}
  <Pagination result={result} page={page} setPage={setPage} busy={busy}/>
 </section>;
}
export function OrderDirectory({revision,onSelect,initialAttention=false}:{revision:unknown;onSelect:(order:Pick<Order,'id'>)=>void;initialAttention?:boolean}) {
 const {t}=useI18n();
 const [attention,setAttention]=useState(initialAttention);
 const [showEffort,setShowEffort]=useState(false);
 const [q,setQ]=useState(''),[page,setPage]=useState(1),[status,setStatus]=useState('');
 const {result,error,busy,retry}=usePage<Order>('/orders/search',new URLSearchParams({q,page:String(page),...(status?{status}:{})}).toString(),revision);
 return <section className="panel" aria-busy={busy}>
  <div className="order-view-tabs" role="group" aria-label={t('Представление заказов')}>
    <button type="button" className={'button '+(attention?'secondary':'primary')} aria-pressed={!attention} onClick={()=>setAttention(false)}>{t('Все заказы')}</button>
    <button type="button" className={'button '+(attention?'primary':'secondary')} aria-pressed={attention} onClick={()=>setAttention(true)}>{t('Требуют внимания')}</button>
  </div>
  {attention?<OrderAttentionBoard revision={revision} onSelect={onSelect}/>:<><div className="table-toolbar">
  <label className="filter-label">{t('Статус')}<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{t('Все заказы')}</option>{stages.map(s=><option key={s} value={s}>{t(stageLabels[s])}</option>)}</select></label>
  <SearchBox value={q} setValue={value=>{setQ(value);setPage(1);}} placeholder={t('Название, номер или клиент')}/>
  <button type="button" className="button secondary" onClick={()=>setShowEffort(true)}><Clock3 size={16} aria-hidden="true"/>{t('Отчёт по времени заказов')}</button></div>
  {error&&<div className="alert" role="alert">{t(error)}<button onClick={retry}>{t('Обновить')}</button></div>}
  {busy?<div className="empty">{t('Загрузка…')}</div>:<OrdersTable orders={result?.items??[]} onSelect={onSelect}/>}
  <Pagination result={result} page={page} setPage={setPage} busy={busy}/>
  {showEffort && <OrderEffortReport close={()=>setShowEffort(false)}/>}</>}
 </section>;
}
