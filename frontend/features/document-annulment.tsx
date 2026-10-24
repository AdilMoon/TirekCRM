'use client';
import {useRef,useState,useId,type FormEvent} from 'react';
import {annulDocumentSchema,type AnnulDocumentInput,type PrintableDocument} from '@tirek/contracts';
import {ModalShell} from '../components/ui';
import {useI18n} from '../i18n/provider';
import {api} from '../lib/api';

export function DocumentAnnulment({doc,onClose,onSaved}:{doc:PrintableDocument;onClose:()=>void;onSaved:(doc:PrintableDocument)=>void}){
 const {t}=useI18n(),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[locked,setLocked]=useState(false);
 const reasonId=useId();
 const pending=useRef<AnnulDocumentInput|null>(null),sending=useRef(false);
 async function submit(e:FormEvent){
  e.preventDefault();if(sending.current)return;
  const parsed=annulDocumentSchema.safeParse(pending.current??{version:doc.version,reason,idempotencyKey:crypto.randomUUID()});
  if(!parsed.success){setError('Укажите причину: от 3 до 500 символов');return;}
  pending.current=parsed.data;sending.current=true;setBusy(true);setLocked(true);setError('');
  try{onSaved(await api<PrintableDocument>('/documents/'+doc.id+'/annul',{method:'POST',body:JSON.stringify(pending.current)}));}
  catch(e){setError(e instanceof Error?e.message:'Не удалось связаться с сервером');}
  finally{sending.current=false;setBusy(false);}
 }
 return <ModalShell title={t('Аннулировать черновик')} onClose={onClose} busy={busy}><form onSubmit={submit}>
  <p>{t('Исходный документ сохранится. Оплаты, долг и статус заказа не изменятся. Отменить аннулирование нельзя.')}</p>
  <label htmlFor={reasonId}>{t('Причина аннулирования')}</label><textarea id={reasonId} value={reason} onChange={e=>setReason(e.target.value)} required minLength={3} maxLength={1000} disabled={locked} rows={4}/>
  <p className="form-hint">{t('Не указывайте пароли, ИИН или другие лишние персональные данные.')}</p>
  {error&&<p className="alert" role="alert">{t(error)}</p>}
  {locked&&!busy&&<p>{t('Повтор отправит ту же причину. Чтобы проверить статус документа, закройте окно.')}</p>}
  <div className="form-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>{t('Закрыть')}</button><button type="submit" className="button primary" disabled={busy}>{t(busy?'Сохранение…':'Подтвердить аннулирование')}</button></div>
 </form></ModalShell>;
}
