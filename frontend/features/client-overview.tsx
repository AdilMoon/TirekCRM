'use client';
import {useState} from 'react';
import {Users,Wallet,CreditCard,ReceiptText} from 'lucide-react';
import type {Client,ClientOrderRow,ClientOverviewPage} from '@tirek/contracts';
import {stages,stageLabels} from '@tirek/contracts';
import {useI18n} from '../i18n/provider';
import {usePage} from '../lib/use-page';
import {Empty,ModalShell,SearchBox,Stat,Status} from '../components/ui';
import {Pagination} from '../components/pagination';

export function ClientOverview({id,revision,onClose,onOrder,onEdit}:{id:string;revision:unknown;onClose:()=>void;onOrder:(id:string)=>void;onEdit:(client:Client)=>void}){
 const {t,formatMoney,formatDate}=useI18n();
 const [q,setQ]=useState(''),[page,setPage]=useState(1),[status,setStatus]=useState(''),[unpaid,setUnpaid]=useState(false);
 const query=new URLSearchParams({q,page:String(page),...(status?{status}:{}),...(unpaid?{unpaid:'true'}:{})}).toString();
 const {result,error,busy,retry}=usePage<ClientOrderRow,ClientOverviewPage>('/clients/'+id+'/overview',query,revision);
 const client=result?.client,summary=result?.summary;
 return <ModalShell title={t('Карточка клиента')} onClose={onClose} className="client-overview-modal">
  <div className="report-space client-overview">
   {client&&<div className="client-overview-contact"><div><h3>{client.name}</h3><p>{client.company||t('Частный клиент')}</p>
    <p>{client.phone||t('Телефон не указан')}{client.email?' · '+client.email:''}</p>{client.address&&<p>{client.address}</p>}</div>
    <button className="button secondary" onClick={()=>onEdit(client)}>{t('Редактировать клиента')}</button></div>}
   <div className="stats-grid" aria-busy={busy}>
    <Stat label={t('Заказы клиента')} value={summary?String(summary.orders):'—'} detail={summary?t('В работе: {0} · Выполнено: {1}',summary.active,summary.completed):t('Загрузка…')} icon={<Users size={18}/>}/>
    <Stat label={t('Стоимость заказов')} value={summary?formatMoney(summary.total):'—'} detail={t('Без отменённых заказов')} icon={<ReceiptText size={18}/>}/>
    <Stat label={t('Оплачено')} value={summary?formatMoney(summary.paid):'—'} detail={t('С учётом возвратов')} icon={<CreditCard size={18}/>}/>
    <Stat label={t('Остаток к оплате')} value={summary?formatMoney(summary.outstanding):'—'} detail={t('По неоплаченным заказам')} icon={<Wallet size={18}/>}/>
   </div>
   <p className="report-scope">{t('Сводка по всем заказам клиента. Поиск и фильтры меняют только список ниже. Отменённые заказы исключены из денежных итогов.')}</p>
   <section className="panel" aria-label={t('История заказов клиента')} aria-busy={busy}>
    <div className="table-toolbar"><SearchBox value={q} setValue={value=>{setQ(value);setPage(1);}} placeholder={t('Название или номер заказа')}/>
     <label className="filter-label">{t('Статус')}<select aria-label={t('Статус')} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{t('Все заказы')}</option>{stages.map(value=><option key={value} value={value}>{t(stageLabels[value])}</option>)}</select></label>
     <label className="client-unpaid-filter"><input type="checkbox" checked={unpaid} onChange={e=>{setUnpaid(e.target.checked);setPage(1);}}/>{t('Только с остатком к оплате')}</label>
     <button className="button secondary" onClick={retry} disabled={busy}>{t('Обновить')}</button>
    </div>
    {error&&<p role="alert" className="alert">{t(error)}<button onClick={retry}>{t('Обновить')}</button></p>}
    <div className="table-wrap"><table className="report-table client-orders-table"><thead><tr><th>{t('Заказ')}</th><th>{t('Статус')}</th><th>{t('Дата')}</th><th>{t('Стоимость')}</th><th>{t('Оплачено')}</th><th>{t('Остаток к оплате')}</th></tr></thead><tbody>
     {result?.items.map(order=><tr key={order.id}><td data-label={t('Заказ')}><button className="text-button" onClick={()=>onOrder(order.id)}>№ {order.number} · {order.title}</button></td>
      <td data-label={t('Статус')}><Status status={order.status}/></td><td data-label={t('Дата')}>{formatDate(order.createdAt,{day:'numeric',month:'short',year:'numeric'})}</td>
      <td data-label={t('Стоимость')}>{formatMoney(order.total)}</td><td data-label={t('Оплачено')}>{formatMoney(order.paid)}</td><td data-label={t('Остаток к оплате')}><strong>{formatMoney(order.balance)}</strong></td></tr>)}
    </tbody></table></div>
    {busy&&<Empty>{t('Загрузка…')}</Empty>}{!busy&&!error&&!result?.items.length&&<Empty>{t('Заказов с этими фильтрами нет.')}</Empty>}
    <Pagination result={result} page={page} setPage={setPage} busy={busy}/>
   </section>
  </div>
 </ModalShell>;
}
