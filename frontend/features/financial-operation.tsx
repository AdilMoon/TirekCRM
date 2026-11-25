'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {refundSchema,expenseReversalSchema,expenseReplacementSchema,expenseLabels,type FinancialOperation} from '@tirek/contracts';
import {ModalShell,Field} from '../components/ui';
import {api} from '../lib/api';
import {useI18n} from '../i18n/provider';
import {ExpenseCorrectionOrder} from './expense-correction-order';
export function FinancialOperationDialog({id,kind,onClose,onSaved,onOrder,onExpense}:{id:string;kind:'INCOME'|'EXPENSE';onClose:()=>void;onSaved:()=>void;onOrder?:(id:string)=>void;onExpense?:(id:string)=>void}){
 const {t,formatMoney,formatDate}=useI18n(),reasonId=useId();
 const path='/finance/'+(kind==='INCOME'?'payments/':'expenses/')+id;
 const [row,setRow]=useState<FinancialOperation|null>(null),[reload,setReload]=useState(0),[amount,setAmount]=useState(''),[reason,setReason]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false);
 const [mode,setMode]=useState<'reverse'|'replace'>('reverse'),[description,setDescription]=useState(''),[category,setCategory]=useState('OTHER'),[selectedOrder,setSelectedOrder]=useState<NonNullable<FinancialOperation['order']>|null>(null);
 const pending=useRef<{path:string;body:string}|null>(null),sending=useRef(false);
 useEffect(()=>{let active=true;setRow(null);setError('');api<FinancialOperation>(path).then(value=>{if(active){setRow(value);setAmount(value.remaining);setDescription(value.description);setCategory(value.category??'OTHER');setSelectedOrder(value.order??null);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[path,reload]);
 async function submit(e:FormEvent){
  e.preventDefault();if(!row||sending.current)return;
  if(!pending.current){
   const replace=kind==='EXPENSE'&&mode==='replace';
   const input={reason,idempotencyKey:crypto.randomUUID()};
   const replacement=replace?expenseReplacementSchema.safeParse({...input,amount,description,category,orderId:selectedOrder?.id??null}):null;
   const parsed=kind==='INCOME'?refundSchema.safeParse({...input,amount}):replacement??expenseReversalSchema.safeParse(input);
   if(!parsed.success){setError('Проверьте сумму и причину финансовой операции');return;}
   if(replacement?.success){
    const next=replacement.data,[whole,fraction='']=next.amount.split('.');
    if(whole+'.'+fraction.padEnd(2,'0')===row.amount&&next.description===row.description&&next.category===row.category&&next.orderId===(row.orderId??null)){
     setError('Новый расход должен отличаться от исходного');return;
    }
   }
   pending.current={path:path+(kind==='INCOME'?'/refunds':replace?'/replacement':'/reversal'),body:JSON.stringify(parsed.data)};
  }
  sending.current=true;setBusy(true);setLocked(true);setError('');setNotice('');
  try{
   await api(pending.current!.path,{method:'POST',body:pending.current!.body});
   pending.current=null;setLocked(false);setReason('');setNotice(kind==='INCOME'?'Возврат записан':mode==='replace'?'Расход исправлен':'Расход сторнирован');setMode('reverse');setReload(n=>n+1);onSaved();
  }catch(e){const failure=e as Error&{status?:number};setError(failure.message);if([401,403,404].includes(failure.status??0))setRow(null);}
  finally{sending.current=false;setBusy(false);}
 }
 return <ModalShell title={t('Финансовая операция')} onClose={onClose} busy={busy}><div className="financial-operation">
  {notice&&<p role="status">{t(notice)}</p>}{error&&<p className="alert" role="alert">{t(error)}</p>}
  {!row&&!error&&<p>{t('Загрузка…')}</p>}
  {!row&&error&&<button className="button secondary" onClick={()=>setReload(n=>n+1)}>{t('Обновить')}</button>}
  {row&&<><h3>{row.description}</h3><p>{t('Исходная сумма')}: {formatMoney(row.amount)} · {formatDate(row.createdAt,{year:'numeric',month:'short',day:'numeric'})}</p><small>{t('Идентификатор операции')}: {row.id}</small>
   {row.order?<p>{t('Связанный заказ')}: {onOrder?<button type="button" className="text-button" disabled={busy||locked} onClick={()=>{onClose();onOrder(row.order!.id);}}>№ {row.order.number} · {row.order.title}</button>:<>№ {row.order.number} · {row.order.title}</>}</p>:kind==='EXPENSE'&&<p>{t('Общий расход компании')}</p>}
   {onExpense&&row.replacesExpenseId&&<p><button type="button" className="text-button" disabled={busy||locked} onClick={()=>onExpense(row.replacesExpenseId!)}>{t('Открыть исходный расход')}</button></p>}
   {onExpense&&row.replacementExpenseId&&<p><button type="button" className="text-button" disabled={busy||locked} onClick={()=>onExpense(row.replacementExpenseId!)}>{t('Открыть исправленный расход')}</button></p>}
   {row.remaining!=='0.00'?<form className="editor-form" onSubmit={submit}>
    {kind==='EXPENSE'&&row.replacementAllowed&&<div className="tabs" aria-label={t('Способ исправления расхода')}>
     <button type="button" disabled={locked} aria-pressed={mode==='reverse'} className={mode==='reverse'?'selected':''} onClick={()=>{setMode('reverse');setError('');}}>{t('Только сторно')}</button>
     <button type="button" disabled={locked} aria-pressed={mode==='replace'} className={mode==='replace'?'selected':''} onClick={()=>{setMode('replace');setError('');}}>{t('Исправить расход')}</button>
    </div>}
    <h3>{t(kind==='INCOME'?'Записать возврат':mode==='replace'?'Исправление расхода':'Сторнировать расход')}</h3>
    <p>{t(kind==='INCOME'?'Доступно к возврату':'Сумма сторнирования')}: {formatMoney(row.remaining)}</p>
    <p className="form-note">{t(kind==='INCOME'?'Записывайте фактически выполненный возврат. CRM не переводит деньги через банк.':mode==='replace'?'Исходная запись сохранится. Полное сторно и новый расход будут записаны вместе. Исправление обновит затраты связанных заказов.':'Сторнирование полностью компенсирует ошибочную запись. Затем внесите правильный расход отдельно. Исходная запись сохранится.')}</p>
    {kind==='EXPENSE'&&!row.replacementAllowed&&<p className="form-note">{t('Для закупки склада доступно только сторно. Сначала верните выданные материалы из заказов.')}</p>}
    {kind==='INCOME'&&<p className="form-note">{t('Возврат уменьшает оплаченную сумму и восстанавливает остаток заказа. Стоимость заказа и документы не меняются.')}</p>}
    <fieldset className="invoice-fields" disabled={locked}>
     {kind==='INCOME'&&<Field label={t('Сумма возврата *')} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value.replace(',','.'))} required/>}
     {kind==='EXPENSE'&&mode==='replace'&&<>
      <Field label={t('Описание расхода *')} value={description} onChange={e=>setDescription(e.target.value)} required maxLength={200}/>
      <Field label={t('Новая сумма, ₸ *')} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value.replace(',','.'))} required maxLength={15}/>
      <label>{t('Категория *')}<select aria-label={t('Категория *')} value={category} onChange={e=>setCategory(e.target.value)}>{Object.entries(expenseLabels).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label>
      <ExpenseCorrectionOrder value={selectedOrder} onChange={setSelectedOrder}/>
      <p className="form-note">{t('Новая сумма')}: {formatMoney(amount)} · {t('Исходная сумма')}: {formatMoney(row.amount)}</p>
     </>}
     <label htmlFor={reasonId}>{t('Причина финансовой операции *')}</label><textarea id={reasonId} value={reason} onChange={e=>setReason(e.target.value)} required minLength={3} maxLength={500} rows={3}/>
    </fieldset>
    {locked&&!busy&&<p className="form-note">{t('Повтор отправит те же данные. Перед новой операцией после закрытия окна проверьте историю.')}</p>}
    <button className="button primary" disabled={busy}>{t(busy?'Сохранение…':locked?'Повторить запрос':kind==='INCOME'?'Записать возврат':mode==='replace'?'Сохранить исправление':'Сторнировать расход')}</button>
   </form>:<p>{t(kind==='INCOME'?'Оплата полностью возвращена':'Расход уже сторнирован')}</p>}
   <h3>{t('История возвратов и исправлений')}</h3>
   {row.corrections.length?row.corrections.map(c=><article className="financial-correction" key={c.id}><strong>{formatMoney(c.amount)}</strong><p>{c.reason}</p><small>{c.actorName} · {formatDate(c.createdAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></article>):<p>{t('Возвратов и исправлений пока нет')}</p>}
  </>}
 </div></ModalShell>;
}
