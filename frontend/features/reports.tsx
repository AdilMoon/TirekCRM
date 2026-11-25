'use client';
import {FinancialOperationDialog} from './financial-operation';
import { ExpenseReceipts } from './expense-receipts';
import { MaterialLots } from './material-lots';
import { useState } from 'react';
import { ArrowDownLeft,ArrowUpRight,Download,FileText,Wallet } from 'lucide-react';
import { expenseLabels,type Movement,type MovementPage,type DocumentRecord } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';
import { usePage } from '../lib/use-page';
import { Pagination } from '../components/pagination';
import { Empty,SearchBox,Stat } from '../components/ui';
import { downloadCsv } from '../lib/download-csv';
function useFilters(){
 const [q,setQ]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(1);
 return {q,from,to,page,setPage,invalid:!!from&&!!to&&from>to,
  setQ:(v:string)=>{setQ(v);setPage(1);},setFrom:(v:string)=>{setFrom(v);setPage(1);},setTo:(v:string)=>{setTo(v);setPage(1);},
  reset:()=>{setQ('');setFrom('');setTo('');setPage(1);},
  params:{q,page:String(page),...(from?{from}:{}),...(to?{to}:{})}};
}
function Period({filters,reset}:{filters:ReturnType<typeof useFilters>;reset:()=>void}){
 const {t}=useI18n();
 return <div className="report-period"><label>{t('Дата с')}<input type="date" value={filters.from} onChange={e=>filters.setFrom(e.target.value)}/></label><label>{t('Дата по')}<input type="date" value={filters.to} onChange={e=>filters.setTo(e.target.value)}/></label><button className="button secondary" onClick={reset}>{t('Сбросить фильтры')}</button><span>{t('По дате записи · Алматы')}</span></div>;
}
export function FinanceReport({revision,onOrder,onChanged}:{revision:unknown;onOrder:(id:string)=>void;onChanged:()=>void}){
 const {t,formatMoney,formatDate}=useI18n(),filters=useFilters();
 const [kind,setKind]=useState(''),[category,setCategory]=useState('');
 const [selected,setSelected]=useState<{id:string;kind:'INCOME'|'EXPENSE'}|null>(null);
 const [exporting,setExporting]=useState(false);
 const [exportError,setExportError]=useState('');
 const query=new URLSearchParams({...filters.params,...(kind?{kind}:{}),...(category?{category}:{})}).toString();
 const {result,error,busy,retry}=usePage<Movement,MovementPage>('/movements/search',query,revision);
 const summary=result?.summary;
 const categories=kind==='INCOME'?{ORDER_PAYMENT:'Оплата заказа'}:kind==='REFUND'?{ORDER_REFUND:'Возврат оплаты'}:kind==='EXPENSE'||kind==='EXPENSE_REVERSAL'?expenseLabels:{ORDER_PAYMENT:'Оплата заказа',ORDER_REFUND:'Возврат оплаты',...expenseLabels};
 const reportError=filters.invalid?'Начало периода позже окончания':error;
 async function exportReport(){
  if(filters.invalid||exporting)return;
  setExporting(true);
  setExportError('');
  try{
   const params=new URLSearchParams(query);
   params.delete('page');
   await downloadCsv('/movements/export?'+params.toString(),'tirek-movements.csv');
  }catch(error){
   setExportError((error as Error).message);
  }finally{
   setExporting(false);
  }
 }
 return <div className="report-space"><section className="panel report-controls">
 <div className="table-toolbar"><div className="tabs">{[['','Все операции'],['INCOME','Поступления'],['EXPENSE','Расходы'],['REFUND','Возвраты'],['EXPENSE_REVERSAL','Сторнирования']].map(([value,label])=><button key={value} className={kind===value?'selected':''} onClick={()=>{setKind(value);setCategory('');filters.setPage(1);}}>{t(label)}</button>)}</div><SearchBox value={filters.q} setValue={filters.setQ} placeholder={t('Описание, заказ или клиент')}/></div>
 <div className="report-filter-row"><Period filters={filters} reset={()=>{filters.reset();setKind('');setCategory('');}}/><label className="filter-label">{t('Категория')}<select value={category} onChange={e=>{setCategory(e.target.value);filters.setPage(1);}}><option value="">{t('Все категории')}</option>{Object.entries(categories).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label></div>
 </section>
 <ExpenseReceipts onChange={()=>{retry();onChanged();}}/>
 <MaterialLots revision={revision}/>
 <div className="report-export-bar">
  <p className="report-scope">{t('Итоги по всем операциям с выбранными фильтрами')}</p>
  <button type="button" className="button secondary" disabled={filters.invalid||exporting} onClick={exportReport}>
   <Download size={16} aria-hidden="true"/>{t(exporting?'Подготовка CSV…':'Скачать CSV')}
  </button>
 </div>
 {exportError&&<p className="alert" role="alert">{t(exportError)}</p>}
 <div className="stats-grid report-stats" aria-busy={busy}>
 <Stat label={t('Поступления')} value={summary?formatMoney(summary.received):'—'} detail={t('С учётом возвратов в выборке')} icon={<ArrowDownLeft size={19}/>}/>
 <Stat label={t('Расходы')} value={summary?formatMoney(summary.expenses):'—'} detail={t('С учётом сторнирований в выборке')} icon={<ArrowUpRight size={19}/>}/>
 <Stat label={t('Чистый денежный поток')} value={summary?formatMoney(summary.cashFlow):'—'} detail={t('Не является бухгалтерской прибылью')} icon={<Wallet size={19}/>} featured/>
 </div>
 <section className="panel" aria-busy={busy}>{reportError&&<div className="alert" role="alert">{t(reportError)}<button onClick={retry}>{t('Обновить')}</button></div>}
 <div className="table-wrap"><table className="report-table"><thead><tr><th>{t('Операция')}</th><th>{t('Категория')}</th><th>{t('Заказ')}</th><th>{t('Дата')}</th><th className="right">{t('Сумма')}</th></tr></thead><tbody>{result?.items.map(m=><tr key={m.kind+':'+m.id}>
 <td data-label={t('Операция')}><div className="movement-cell"><span className={'movement-icon '+m.kind.toLowerCase()}>{(m.kind==='INCOME'||m.kind==='EXPENSE_REVERSAL')?<ArrowDownLeft size={17}/>:<ArrowUpRight size={17}/>}</span><strong>{m.description}</strong></div><small className="cell-sub">{t(m.kind==='REFUND'?'Возврат оплаты':m.kind==='EXPENSE_REVERSAL'?'Сторнирование расхода':m.kind==='INCOME'?'Поступления':'Расходы')}</small><button className="text-button" onClick={()=>setSelected({id:m.sourceId??m.id,kind:m.kind==='INCOME'||m.kind==='REFUND'?'INCOME':'EXPENSE'})}>{t('Открыть операцию')}</button></td>
 <td data-label={t('Категория')}>{t(m.category==='ORDER_PAYMENT'?'Оплата заказа':m.category==='ORDER_REFUND'?'Возврат оплаты':expenseLabels[m.category]??m.category)}</td>
 <td data-label={t('Заказ')}>{m.orderId?<button className="text-button" onClick={()=>onOrder(m.orderId!)}>№ {m.orderNumber}</button>:t('Общий расход')}</td><td data-label={t('Дата')}>{formatDate(m.createdAt,{day:'numeric',month:'short',year:'numeric'})}</td><td data-label={t('Сумма')} className={'right amount '+m.kind.toLowerCase()}>{(m.kind==='INCOME'||m.kind==='EXPENSE_REVERSAL')?'+':'−'}{formatMoney(m.amount)}</td>
 </tr>)}</tbody></table></div>
 {busy&&<Empty>{t('Загрузка…')}</Empty>}{!busy&&!reportError&&!result?.items.length&&<Empty>{t('За выбранный период и с этими фильтрами записей нет.')}</Empty>}
 <Pagination result={result} page={filters.page} setPage={filters.setPage} busy={busy}/>
 <div className="table-footer">{t('Учитываются внесённые записи. Синхронизация с банком не подключена.')}</div></section>
 {selected&&<FinancialOperationDialog key={selected.kind+selected.id} {...selected} onOrder={onOrder} onExpense={id=>setSelected({id,kind:'EXPENSE'})} onClose={()=>{setSelected(null);retry();}} onSaved={()=>{retry();onChanged();}}/>}
 </div>;
}
export function DocumentDirectory({revision}:{revision:unknown}){
 const {t,formatMoney,formatDate}=useI18n(),filters=useFilters();
 const [kind,setKind]=useState(''),[status,setStatus]=useState('');
 const {result,error,busy,retry}=usePage<DocumentRecord>('/documents/search',new URLSearchParams({...filters.params,...(kind?{kind}:{}),...(status?{status}:{})}).toString(),revision);
 const reportError=filters.invalid?'Начало периода позже окончания':error;
 return <div className="report-space"><div className="info-banner"><FileText size={21}/><div><strong>{t('Счета и акты по вашим заказам')}</strong><p>{t('Счёт — для оплаты заказа, акт — для выполненной работы. Сохранённые реквизиты и суммы не меняются; доступна печать и PDF.')}</p></div></div>
 <section className="panel" aria-busy={busy}><div className="panel-heading"><div><h2>{t('Счета и акты')}</h2><p>{t('Поиск по данным, сохранённым в документе')}</p></div><span className="subtle-pill">{t('Черновики')}</span></div>
 <div className="table-toolbar"><Period filters={filters} reset={()=>{filters.reset();setKind('');setStatus('');}}/><label className="filter-label">{t('Вид документа')}<select value={kind} onChange={e=>{setKind(e.target.value);filters.setPage(1);}}><option value="">{t('Все документы')}</option><option value="INVOICE_DRAFT">{t('Счета на оплату')}</option><option value="ACT_DRAFT">{t('Акты выполненных работ')}</option></select></label><label className="filter-label">{t('Статус документа')}<select value={status} onChange={e=>{setStatus(e.target.value);filters.setPage(1);}}><option value="">{t('Все статусы')}</option><option value="DRAFT">{t('Черновики')}</option><option value="ANNULLED">{t('Аннулированные')}</option></select></label><SearchBox value={filters.q} setValue={filters.setQ} placeholder={t('Номер документа, заказ или клиент')}/></div>
 {reportError&&<div className="alert" role="alert">{t(reportError)}<button onClick={retry}>{t('Обновить')}</button></div>}
 <div className="table-wrap"><table className="report-table"><thead><tr><th>{t('Документ')}</th><th>{t('Клиент')}</th><th>{t('Заказ')}</th><th>{t('Дата')}</th><th>{t('Сумма')}</th><th/></tr></thead><tbody>{result?.items.map(doc=><tr key={doc.id}>
 <td data-label={t('Документ')}><strong>{t(doc.kind==='INVOICE_DRAFT'?'Счёт №':'Акт №')} {String(doc.number).padStart(4,'0')}</strong><small className="cell-sub">{t(doc.status==='ANNULLED'?'Черновик аннулирован':'Черновик · без подписи')}</small></td>
 <td data-label={t('Клиент')}>{doc.clientName}</td><td data-label={t('Заказ')}>№ {doc.orderNumber}</td><td data-label={t('Дата')}>{formatDate(doc.createdAt,{day:'numeric',month:'short',year:'numeric'})}</td><td data-label={t('Сумма')}>{formatMoney(doc.total)}</td><td><a className="text-button" href={'/documents/'+doc.id} target="_blank" rel="noreferrer">{t('Открыть')}<ArrowUpRight size={15}/></a></td>
 </tr>)}</tbody></table></div>
 {busy&&<Empty>{t('Загрузка…')}</Empty>}{!busy&&!reportError&&!result?.items.length&&<Empty>{t('За выбранный период и с этими фильтрами записей нет.')}</Empty>}
 <Pagination result={result} page={filters.page} setPage={filters.setPage} busy={busy}/></section></div>;
}
