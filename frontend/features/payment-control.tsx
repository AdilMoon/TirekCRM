'use client';
import {useState} from 'react';
import {Wallet} from 'lucide-react';
import type {PaymentControlPage,PaymentControlRow} from '@tirek/contracts';
import {useI18n} from '../i18n/provider';
import {usePage} from '../lib/use-page';
import {Empty,SearchBox,Stat} from '../components/ui';
import {Pagination} from '../components/pagination';
import {FinanceReport} from './reports';

const states={OVERDUE:'Срок прошёл',SCHEDULED:'Срок не прошёл',NO_DUE:'Без срока оплаты'};
export function FinanceWorkspace(props:Parameters<typeof FinanceReport>[0]){
 const {t}=useI18n(),[view,setView]=useState('operations');
 return <div className="report-space"><div className="tabs" aria-label={t('Раздел финансов')}>
  <button aria-pressed={view==='operations'} className={view==='operations'?'selected':''} onClick={()=>setView('operations')}>{t('Операции')}</button>
  <button aria-pressed={view==='payments'} className={view==='payments'?'selected':''} onClick={()=>setView('payments')}>{t('Контроль оплат')}</button>
 </div>{view==='operations'?<FinanceReport {...props}/>:<PaymentControl revision={props.revision} onOrder={props.onOrder}/>}</div>;
}
function PaymentControl({revision,onOrder}:{revision:unknown;onOrder:(id:string)=>void}){
 const {t,formatMoney,formatDate}=useI18n(),[q,setQ]=useState(''),[state,setState]=useState(''),[page,setPage]=useState(1);
 const {result,error,busy,retry}=usePage<PaymentControlRow,PaymentControlPage>('/payments/control',new URLSearchParams({q,page:String(page),...(state?{state}:{})}).toString(),revision);
 return <section className="report-space" aria-label={t('Контроль оплат')}>
  <div className="panel report-controls payment-control-info"><div className="panel-heading"><div><h2>{t('Неоплаченные заказы')}</h2>
   <p>{t('Остаток по заказу с учётом частичных оплат и возвратов. Отменённые и полностью оплаченные заказы исключены.')}</p></div>
   <button className="button secondary" onClick={retry} disabled={busy}>{t('Обновить')}</button></div>
   <div className="table-toolbar"><label className="filter-label">{t('Срок оплаты')}<select aria-label={t('Срок оплаты')} value={state} onChange={e=>{setState(e.target.value);setPage(1);}}>
    <option value="">{t('Все сроки')}</option>{Object.entries(states).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
    <SearchBox value={q} setValue={value=>{setQ(value);setPage(1);}} placeholder={t('Описание, заказ или клиент')}/></div>
   <p className="report-scope">{t('Срок берётся из последнего черновика счёта. Если он аннулирован или без срока, старый срок не используется. Срок заказа означает дату выполнения работ.')}</p>
   {result&&<p className="report-scope">{t('На дату · Алматы')}: {formatDate(result.today,{day:'numeric',month:'long',year:'numeric'})}</p>}
  </div>
  <div className="stats-grid" aria-busy={busy}>{([['balance','Остаток к оплате'],['overdue','Срок прошёл'],['scheduled','Срок не прошёл'],['noDue','Без срока оплаты']] as const).map(([key,label])=>
   <Stat key={key} label={t(label)} value={result?formatMoney(result.summary[key]):'—'} detail={t('По всем заказам с выбранными фильтрами')} icon={<Wallet size={18}/>}/>)}</div>
  <div className="panel" aria-busy={busy}>{error&&<div className="alert" role="alert">{t(error)}<button onClick={retry}>{t('Обновить')}</button></div>}
   <div className="table-wrap"><table className="report-table"><thead><tr><th>{t('Заказ')}</th><th>{t('Клиент')}</th><th>{t('Срок оплаты')}</th><th>{t('Оплачено')}</th><th>{t('Остаток к оплате')}</th><th/></tr></thead>
    <tbody>{result?.items.map(row=><tr key={row.id}>
     <td data-label={t('Заказ')}><strong>№ {row.number} · {row.title}</strong></td><td data-label={t('Клиент')}>{row.clientName}</td>
     <td data-label={t('Срок оплаты')}><strong>{t(states[row.state])}</strong>{row.dueDate&&<small className="cell-sub">{formatDate(row.dueDate,{day:'numeric',month:'short',year:'numeric'})}</small>}
      {row.invoiceId&&<a className="text-button" href={'/documents/'+row.invoiceId} target="_blank" rel="noreferrer">{t('Счёт №')} {row.invoiceNumber}</a>}</td>
     <td data-label={t('Оплачено')}>{formatMoney(row.paid)}</td><td data-label={t('Остаток к оплате')}><strong>{formatMoney(row.balance)}</strong></td>
     <td><button className="text-button" onClick={()=>onOrder(row.id)}>{t('Открыть заказ')}</button></td>
    </tr>)}</tbody></table></div>
   {busy&&<Empty>{t('Загрузка…')}</Empty>}{!busy&&!error&&!result?.items.length&&<Empty>{t('Неоплаченных заказов с этими фильтрами нет.')}</Empty>}
   <Pagination result={result} page={page} setPage={setPage} busy={busy}/>
   <p className="table-footer">{t('Итоги по заказам, а не сумма счетов. Дата черновика используется для внутреннего контроля оплат.')}</p>
  </div>
 </section>;
}
