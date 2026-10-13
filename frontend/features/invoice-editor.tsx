'use client';
import {useRef,useState,type FormEvent} from 'react';
import type {Order} from '@tirek/contracts';
import {api} from '../lib/api';
import {useI18n} from '../i18n/provider';
import {Field,ModalShell} from '../components/ui';
import {OrderPicker} from './order-picker';

export function InvoiceEditor({initial,close,saved}:{initial?:Order;close:()=>void;saved:(message:string)=>Promise<void>}){
 const {t,formatMoney}=useI18n();
 const [order,setOrder]=useState<Order|null>(initial??null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<{orderId:string;body:{orderVersion:number;dueDate:string|null;note:string;idempotencyKey:string}}|null>(null);
 const [uncertain,setUncertain]=useState(false);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||!order)return;
  const form=new FormData(e.currentTarget);
  // Preserve the exact request after a lost response, even if surrounding data changes.
  const request=pending.current??{orderId:order.id,body:{orderVersion:order.version,dueDate:String(form.get('dueDate')??'')||null,note:String(form.get('note')??'').trim(),idempotencyKey:crypto.randomUUID()}};
  pending.current=request;setBusy(true);setError('');
  try{
   await api('/orders/'+request.orderId+'/invoices',{method:'POST',body:JSON.stringify(request.body)});
   await saved(t('Счёт на оплату создан'));
  }catch(e){
   const status=(e as Error&{status?:number}).status;
   if(!uncertain&&status&&status>=400&&status<500){pending.current=null;setUncertain(false);}else setUncertain(true);
   setError((e as Error).message);
  }finally{setBusy(false);}
 }
 return <ModalShell title={t('Создать счёт на оплату')} onClose={close} busy={busy}>
 <form className="editor-form" onSubmit={submit}><fieldset disabled={busy||uncertain} className="invoice-fields">
 {initial?<p className="form-note">№ {initial.number} · {initial.title}</p>:<OrderPicker purpose="invoice" onSelected={setOrder}/>}
 {order&&<div className="invoice-preview"><span>{t('К оплате на момент создания')}</span><strong>{formatMoney(order.debt)}</strong><small>{order.client.company||order.client.name}</small></div>}
 <Field label={t('Оплатить до')} name="dueDate" type="date"/>
 <label>{t('Примечание к счёту')}<textarea name="note" maxLength={500} rows={3}/></label>
 </fieldset>
 <p className="form-note">{t('Сохраним реквизиты и остаток по заказу. Создание счёта не записывает оплату. НДС и правовой статус шаблона требуют отдельной проверки.')}</p>
 {error&&<div className="form-error" role="alert">{t(error)}</div>}
 {uncertain&&<p className="form-note">{t('Ответ не получен. Повторите тот же запрос: уже созданный счёт не продублируется. Перед созданием нового проверьте раздел «Документы».')}</p>}
 <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>{t('Отмена')}</button><button className="button primary" disabled={busy||!order}>{t(uncertain?'Повторить запрос':'Создать счёт')}</button></div>
 </form></ModalShell>;
}
