'use client';
import {useRef,useState,type FormEvent} from 'react';
import type {ServiceRequestInput} from '@tirek/contracts';
import {useI18n} from '../i18n/provider';
import {api} from '../lib/api';
export function PassportServiceRequest({token}:{token:string}){
 const {t}=useI18n();const [description,setDescription]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(''),[uncertain,setUncertain]=useState(false);
 const pending=useRef<ServiceRequestInput|null>(null);
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');
  if(!pending.current)pending.current={token,description:description.trim(),submissionKey:crypto.randomUUID()};
  try{const receipt=await api<{id:string}>('/passport/service-requests',{method:'POST',body:JSON.stringify(pending.current)});setResult(receipt.id);pending.current=null;setUncertain(false);}
  catch(e){const failure=e as Error&{status?:number};setError(failure.message);if(!failure.status||failure.status>=500)setUncertain(true);else if(!uncertain)pending.current=null;}
  finally{setBusy(false);}
 }
 return <section className="panel passport-service-request"><h2>{t('Нужно обслуживание снова?')}</h2>
  <p>{t('Опишите, что требуется по тому же объекту. Компания получит обращение и свяжется по контактам исходного заказа для уточнения условий.')}</p>
  {result?<p className="passport-accepted" role="status">{t('Обращение отправлено')} · {result.slice(0,8)}</p>:<form className="editor-form" onSubmit={submit}>
   {error&&<p className="form-error" role="alert">{t(error)}</p>}
   {uncertain&&<p className="form-note">{t('Результат отправки неизвестен. Повторите операцию с теми же данными.')}</p>}
   <label>{t('Что нужно сделать')}<textarea required minLength={5} maxLength={1000} rows={4} value={description} disabled={busy||uncertain} onChange={e=>setDescription(e.target.value)}/></label>
   <button className="button primary" disabled={busy||description.trim().length<5}>{t(busy?'Отправка…':uncertain?'Повторить отправку':'Отправить обращение')}</button>
   <p className="form-note">{t('Отправка обращения не подтверждает стоимость и время визита. Их согласуют отдельно.')}</p>
  </form>}
 </section>;
}
