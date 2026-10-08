'use client';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Client, Order } from '@tirek/contracts';
import { stages, stageLabels } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';
import { usePage } from '../lib/use-page';
import { SearchBox, Empty } from '../components/ui';
import { Pagination } from '../components/pagination';
import { OrdersTable } from './orders-table';
export function ClientDirectory({revision,onSelect}:{revision:unknown;onSelect:(client:Client)=>void}) {
 const {t,dateLabel}=useI18n();
 const [q,setQ]=useState(''),[page,setPage]=useState(1);
 const {result,error,busy,retry}=usePage<Client>('/clients/search',new URLSearchParams({q,page:String(page)}).toString(),revision);
 return <section className="panel" aria-busy={busy}><div className="table-toolbar"><h2>{t('Клиентская база')}</h2>
  <SearchBox value={q} setValue={value=>{setQ(value);setPage(1);}} placeholder={t('Имя, компания или телефон')} /></div>
  {error&&<div className="alert" role="alert">{t(error)}<button onClick={retry}>{t('Обновить')}</button></div>}
  <div className="table-wrap"><table><thead><tr><th>{t('Клиент')}</th><th>{t('Контакты')}</th><th>{t('Адрес')}</th><th>{t('Заказы')}</th><th>{t('Добавлен')}</th></tr></thead>
  <tbody>{result?.items.map(c=><tr key={c.id}><td><div className="client-cell"><span className="client-avatar">{c.name.slice(0,1)}</span><div>
   <button className="text-button" onClick={()=>onSelect(c)}><strong>{c.name}</strong><Pencil size={13}/></button><small>{c.company||t('Частный клиент')}</small>
  </div></div></td><td>{c.phone||t('Телефон не указан')}<small className="cell-sub">{c.email}</small></td><td>{c.address||'—'}</td><td>{c.ordersCount}</td><td>{dateLabel(c.createdAt)}</td></tr>)}</tbody></table></div>
  {!busy&&!error&&!result?.items.length&&<Empty>{t('Ничего не найдено')}</Empty>}
  <Pagination result={result} page={page} setPage={setPage} busy={busy}/>
 </section>;
}
export function OrderDirectory({revision,onSelect}:{revision:unknown;onSelect:(order:Order)=>void}) {
 const {t}=useI18n();
 const [q,setQ]=useState(''),[page,setPage]=useState(1),[status,setStatus]=useState('');
 const {result,error,busy,retry}=usePage<Order>('/orders/search',new URLSearchParams({q,page:String(page),...(status?{status}:{})}).toString(),revision);
 return <section className="panel" aria-busy={busy}><div className="table-toolbar">
  <label className="filter-label">{t('Статус')}<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{t('Все заказы')}</option>{stages.map(s=><option key={s} value={s}>{t(stageLabels[s])}</option>)}</select></label>
  <SearchBox value={q} setValue={value=>{setQ(value);setPage(1);}} placeholder={t('Название, номер или клиент')}/></div>
  {error&&<div className="alert" role="alert">{t(error)}<button onClick={retry}>{t('Обновить')}</button></div>}
  {busy?<div className="empty">{t('Загрузка…')}</div>:<OrdersTable orders={result?.items??[]} onSelect={onSelect}/>}
  <Pagination result={result} page={page} setPage={setPage} busy={busy}/>
 </section>;
}
