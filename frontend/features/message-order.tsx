'use client';
import {useRef,useState,type FormEvent} from 'react';
import {MessageSquareText,ArrowRight,Check,LoaderCircle} from 'lucide-react';
import type {MessagePreview,MessageOrderInput} from '@tirek/contracts';
import {useI18n} from '../i18n/provider';
import {api} from '../lib/api';
import {ModalShell,Field} from '../components/ui';
const warnings:Record<string,string>={CLIENT_REQUIRED:'Укажите имя нового клиента или выберите найденного.',AMOUNT_REQUIRED:'Укажите стоимость услуги.',AMOUNT_AMBIGUOUS:'В сообщении несколько сумм. Выберите стоимость услуги.',DATE_AMBIGUOUS:'Уточните дату выполнения.',TITLE_REQUIRED:'Укажите название заказа.',UNSUPPORTED_CURRENCY:'Поддерживается KZT. Укажите стоимость в тенге.'};
export function MessageOrder({close,created}:{close:()=>void;created:(id:string)=>Promise<void>}){
 const {t}=useI18n();
 const [message,setMessage]=useState(''),[draft,setDraft]=useState<MessagePreview|null>(null),[selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[locked,setLocked]=useState(false);
 const request=useRef<MessageOrderInput|null>(null);
 async function analyze(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{
  const result=await api<MessagePreview>('/message-orders/preview',{method:'POST',body:JSON.stringify({message})});
  setDraft(result);setSelected('');request.current=null;setLocked(false);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function save(e:FormEvent){e.preventDefault();if(!draft)return;setBusy(true);setError('');
  if(!request.current)request.current={idempotencyKey:crypto.randomUUID(),...(selected?{clientId:selected}:{newClient:{name:draft.clientName,phone:draft.phone}}),
   order:{title:draft.title,notes:draft.notes,...(draft.dueDate?{dueDate:draft.dueDate}:{}),items:[{description:draft.title,quantity:1,unitPrice:draft.amount}]}};
  setLocked(true);
  try{const result=await api<{orderId:string}>('/message-orders',{method:'POST',body:JSON.stringify(request.current)});await created(result.orderId);}
  catch(e){setError((e as Error).message);if([400,404].includes((e as Error&{status:number}).status)){request.current=null;setLocked(false);}}
  finally{setBusy(false);}
 }
 function edit(key:keyof MessagePreview,value:string){setDraft(old=>old?{...old,[key]:value}:old);}
 return <ModalShell title={t('Из сообщения в заказ')} onClose={close} busy={busy} className="message-order-modal">
  <p className="form-note">{t('Вставьте обращение клиента. Предложенные данные можно исправить перед созданием заказа.')}</p>
  {!draft?<form className="editor-form" onSubmit={analyze}>
   <label>{t('Сообщение клиента')}<textarea required minLength={5} maxLength={2000} rows={7} value={message} onChange={e=>setMessage(e.target.value)} disabled={busy} placeholder={t('Например: Нужна уборка квартиры завтра, бюджет 25 000 ₸. Меня зовут Айдана, +7 700 111 22 33.')}/></label>
   <p className="form-note">{t('Разбор выполняется локально по явным данным на русском и казахском.')}</p>
   {error&&<p role="alert" className="form-error">{t(error)}</p>}
   <button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<MessageSquareText size={18}/>} {t('Разобрать сообщение')}</button>
  </form>:<form className="editor-form" onSubmit={save}>
   <div className="message-review"><span className="message-review-icon"><Check size={22}/></span><div><strong>{t('Проверьте будущий заказ')}</strong><p>{t('Пока ничего не сохранено. Дата определяется по времени Алматы.')}</p></div></div>
   {!!draft.warnings.length&&<ul className="message-warnings">{draft.warnings.map(w=><li key={w}>{t(warnings[w])}</li>)}</ul>}
   {!!draft.matches.length&&<label>{t('Клиент по совпавшему телефону')}<select value={selected} disabled={busy||locked} onChange={e=>setSelected(e.target.value)}><option value="">{t('Создать нового клиента')}</option>{draft.matches.map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></label>}
   {!selected&&<div className="form-row"><Field label={t('Имя нового клиента')} required maxLength={160} value={draft.clientName} disabled={busy||locked} onChange={e=>edit('clientName',e.target.value)}/><Field label={t('Телефон')} maxLength={32} value={draft.phone} disabled={busy||locked} onChange={e=>edit('phone',e.target.value)}/></div>}
   <Field label={t('Название заказа *')} required maxLength={200} value={draft.title} disabled={busy||locked} onChange={e=>edit('title',e.target.value)}/>
   <div className="form-row"><Field label={t('Стоимость услуги, ₸')} type="number" min="0.01" max="999999999999.99" step="0.01" required value={draft.amount} disabled={busy||locked} onChange={e=>edit('amount',e.target.value)}/><Field label={t('Срок выполнения')} type="date" value={draft.dueDate} disabled={busy||locked} onChange={e=>edit('dueDate',e.target.value)}/></div>
   <label>{t('Комментарий')}<textarea maxLength={2000} rows={3} value={draft.notes} disabled={busy||locked} onChange={e=>edit('notes',e.target.value)}/></label>
   {error&&<p role="alert" className="form-error">{t(error)}</p>}
   {locked&&!busy&&<p className="form-note">{t('Повторная отправка использует те же данные и не создаёт второй заказ.')}</p>}
   <div className="form-actions">{!locked&&<button type="button" className="button secondary" disabled={busy} onClick={()=>setDraft(null)}>{t('Назад к сообщению')}</button>}<button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<ArrowRight size={18}/>} {t(locked?'Повторить сохранение':'Подтвердить и создать')}</button></div>
  </form>}
 </ModalShell>;
}
