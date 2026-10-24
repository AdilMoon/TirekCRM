'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {refundSchema,expenseReversalSchema,type FinancialOperation} from '@tirek/contracts';
import {ModalShell,Field} from '../components/ui';
import {api} from '../lib/api';
import {useI18n} from '../i18n/provider';
export function FinancialOperationDialog({id,kind,onClose,onSaved}:{id:string;kind:'INCOME'|'EXPENSE';onClose:()=>void;onSaved:()=>void}){
 const {t,formatMoney,formatDate}=useI18n(),reasonId=useId();
 const path='/finance/'+(kind==='INCOME'?'payments/':'expenses/')+id;
 const [row,setRow]=useState<FinancialOperation|null>(null),[reload,setReload]=useState(0),[amount,setAmount]=useState(''),[reason,setReason]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false);
 const pending=useRef<string|null>(null),sending=useRef(false);
 useEffect(()=>{let active=true;setRow(null);setError('');api<FinancialOperation>(path).then(value=>{if(active){setRow(value);setAmount(value.remaining);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[path,reload]);
 async function submit(e:FormEvent){
  e.preventDefault();if(!row||sending.current)return;
  if(!pending.current){
   const parsed=(kind==='INCOME'?refundSchema:expenseReversalSchema).safeParse({reason,idempotencyKey:crypto.randomUUID(),...(kind==='INCOME'?{amount}:{})});
   if(!parsed.success){setError('Проверьте сумму и причину финансовой операции');return;}
   pending.current=JSON.stringify(parsed.data);
  }
  sending.current=true;setBusy(true);setLocked(true);setError('');setNotice('');
  try{
   await api(path+(kind==='INCOME'?'/refunds':'/reversal'),{method:'POST',body:pending.current});
   pending.current=null;setLocked(false);setReason('');setNotice(kind==='INCOME'?'Возврат записан':'Расход сторнирован');setReload(n=>n+1);onSaved();
  }catch(e){const failure=e as Error&{status?:number};setError(failure.message);if([401,403,404].includes(failure.status??0))setRow(null);}
  finally{sending.current=false;setBusy(false);}
 }
 return <ModalShell title={t('Финансовая операция')} onClose={onClose} busy={busy}><div className="financial-operation">
  {notice&&<p role="status">{t(notice)}</p>}{error&&<p className="alert" role="alert">{t(error)}</p>}
  {!row&&!error&&<p>{t('Загрузка…')}</p>}
  {!row&&error&&<button className="button secondary" onClick={()=>setReload(n=>n+1)}>{t('Обновить')}</button>}
  {row&&<><h3>{row.description}</h3><p>{t('Исходная сумма')}: {formatMoney(row.amount)} · {formatDate(row.createdAt,{year:'numeric',month:'short',day:'numeric'})}</p><small>{t('Идентификатор операции')}: {row.id}</small>
   {row.remaining!=='0.00'?<form className="editor-form" onSubmit={submit}>
    <h3>{t(kind==='INCOME'?'Записать возврат':'Сторнировать расход')}</h3>
    <p>{t(kind==='INCOME'?'Доступно к возврату':'Сумма сторнирования')}: {formatMoney(row.remaining)}</p>
    <p className="form-note">{t(kind==='INCOME'?'Записывайте фактически выполненный возврат. CRM не переводит деньги через банк.':'Сторнирование полностью компенсирует ошибочную запись. Затем внесите правильный расход отдельно. Исходная запись сохранится.')}</p>
    {kind==='INCOME'&&<p className="form-note">{t('Возврат уменьшает оплаченную сумму и восстанавливает остаток заказа. Стоимость заказа и документы не меняются.')}</p>}
    <fieldset className="invoice-fields" disabled={locked}>
     {kind==='INCOME'&&<Field label={t('Сумма возврата *')} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value.replace(',','.'))} required/>}
     <label htmlFor={reasonId}>{t('Причина финансовой операции *')}</label><textarea id={reasonId} value={reason} onChange={e=>setReason(e.target.value)} required minLength={3} maxLength={1000} rows={3}/>
    </fieldset>
    {locked&&!busy&&<p className="form-note">{t('Повтор отправит те же данные. Перед новой операцией после закрытия окна проверьте историю.')}</p>}
    <button className="button primary" disabled={busy}>{t(busy?'Сохранение…':locked?'Повторить запрос':kind==='INCOME'?'Записать возврат':'Сторнировать расход')}</button>
   </form>:<p>{t(kind==='INCOME'?'Оплата полностью возвращена':'Расход уже сторнирован')}</p>}
   <h3>{t('История возвратов и исправлений')}</h3>
   {row.corrections.length?row.corrections.map(c=><article className="financial-correction" key={c.id}><strong>{formatMoney(c.amount)}</strong><p>{c.reason}</p><small>{c.actorName} · {formatDate(c.createdAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></article>):<p>{t('Возвратов и исправлений пока нет')}</p>}
  </>}
 </div></ModalShell>;
}
