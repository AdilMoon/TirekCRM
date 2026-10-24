'use client';
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {privacyRequestSchema,privacyRequestChangeSchema,privacyKindLabels,privacyStatusLabels,type PrivacyRequestInput,type PrivacyRequestChange,type PrivacyRequestDetail,type PrivacyRequestKind} from '@tirek/contracts';
import {ModalShell,Field} from '../components/ui';
import {useI18n} from '../i18n/provider';
import {api} from '../lib/api';
import {AuditTrail} from './audit-trail';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function PrivacyRequestForm({onClose,onSaved}:{onClose:()=>void;onSaved:(id:string)=>void}){
 const {t}=useI18n(),descriptionId=useId();
 const [kind,setKind]=useState<PrivacyRequestKind>('ACCESS'),[subjectName,setName]=useState(''),[contact,setContact]=useState(''),[description,setDescription]=useState(''),[receivedOn,setReceived]=useState(today),[dueOn,setDue]=useState('');
 const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState('');
 const pending=useRef<PrivacyRequestInput|null>(null),sending=useRef(false);
 async function submit(e:FormEvent){
  e.preventDefault();if(sending.current)return;
  const parsed=privacyRequestSchema.safeParse(pending.current??{kind,subjectName,contact,description,receivedOn,dueOn:dueOn||null,idempotencyKey:crypto.randomUUID()});
  if(!parsed.success){setError('Проверьте поля обращения и даты');return;}
  if(parsed.data.receivedOn>today()){setError('Дата получения не может быть в будущем');return;}
  pending.current=parsed.data;sending.current=true;setBusy(true);setLocked(true);setError('');
  try{const row=await api<PrivacyRequestDetail>('/privacy-requests',{method:'POST',body:JSON.stringify(pending.current)});onSaved(row.id);}
  catch(e){setError((e as Error).message);}finally{sending.current=false;setBusy(false);}
 }
 return <ModalShell title={t('Зарегистрировать обращение')} onClose={onClose} busy={busy}><form className="editor-form" onSubmit={submit}>
  <p className="form-note">{t('Записывайте только сведения, необходимые для работы с обращением. Не добавляйте копии удостоверений и пароли.')}</p>
  <fieldset className="invoice-fields" disabled={locked}>
   <Field label={t('Имя заявителя *')} value={subjectName} onChange={e=>setName(e.target.value)} required maxLength={320}/>
   <Field label={t('Контакт для ответа')} value={contact} onChange={e=>setContact(e.target.value)} maxLength={400}/>
   <label>{t('Вид обращения')}<select aria-label={t('Вид обращения')} value={kind} onChange={e=>setKind(e.target.value as PrivacyRequestKind)}>{Object.entries(privacyKindLabels).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label>
   <label htmlFor={descriptionId}>{t('Содержание обращения *')}</label><textarea id={descriptionId} value={description} onChange={e=>setDescription(e.target.value)} required minLength={3} maxLength={2000} rows={4}/>
   <Field label={t('Дата получения *')} type="date" value={receivedOn} min="1900-01-01" max={today()} onChange={e=>setReceived(e.target.value)} required/>
   <Field label={t('Срок ответа')} type="date" value={dueOn} min={receivedOn} onChange={e=>setDue(e.target.value)}/>
  </fieldset>
  <p className="form-note">{t('Срок задаётся вручную с учётом вида запроса и применимых требований. Просрочка определяется по календарной дате Алматы.')}</p>
  {error&&<p className="alert" role="alert">{t(error)}</p>}
  {locked&&!busy&&<p className="form-note">{t('Повтор отправит те же данные. Если закроете окно, сначала проверьте реестр перед повторной регистрацией.')}</p>}
  <div className="form-actions"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>{t('Закрыть')}</button><button className="button primary" disabled={busy}>{t(busy?'Сохранение…':locked?'Повторить запрос':'Сохранить обращение')}</button></div>
 </form></ModalShell>;
}

export function PrivacyRequestDialog({id,onClose,onSaved}:{id:string;onClose:()=>void;onSaved:()=>void}){
 const {t,formatDate}=useI18n(),resolutionId=useId();
 const [row,setRow]=useState<PrivacyRequestDetail|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false);
 const [status,setStatus]=useState<PrivacyRequestChange['status']>('IN_PROGRESS'),[resolution,setResolution]=useState('');
 const pending=useRef<PrivacyRequestChange|null>(null),sending=useRef(false);
 useEffect(()=>{let active=true;setRow(null);setError('');api<PrivacyRequestDetail>('/privacy-requests/'+id).then(value=>{if(active){setRow(value);setStatus(value.status==='OPEN'?'IN_PROGRESS':'RESOLVED');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id,reload]);
 const closed=row?.status==='RESOLVED'||row?.status==='REJECTED';
 async function submit(e:FormEvent){
  e.preventDefault();if(!row||sending.current)return;
  const parsed=privacyRequestChangeSchema.safeParse(pending.current??{version:row.version,status,resolution:status==='IN_PROGRESS'?'':resolution,idempotencyKey:crypto.randomUUID()});
  if(!parsed.success){setError('Укажите результат или основание отказа');return;}
  pending.current=parsed.data;sending.current=true;setBusy(true);setLocked(true);setError('');
  try{const updated=await api<PrivacyRequestDetail>('/privacy-requests/'+id,{method:'PATCH',body:JSON.stringify(pending.current)});setRow(updated);setStatus('RESOLVED');setResolution('');pending.current=null;setLocked(false);onSaved();}
  catch(e){const failure=e as Error&{status?:number};setError(failure.message);if([401,403,404].includes(failure.status??0))setRow(null);}
  finally{sending.current=false;setBusy(false);}
 }
 return <ModalShell title={t('Карточка обращения')} onClose={onClose} busy={busy}>
  <div className="privacy-detail">
   {error&&<p className="alert" role="alert">{t(error)}</p>}
   {!row&&!error&&<p>{t('Загрузка…')}</p>}
   {!row&&error&&<button className="button secondary" onClick={()=>setReload(n=>n+1)}>{t('Обновить')}</button>}
   {row&&<><h3>{row.subjectName}</h3><p>{t(privacyKindLabels[row.kind])} · <strong>{t(privacyStatusLabels[row.status])}</strong></p>
    {row.contact&&<p>{t('Контакт для ответа')}: {row.contact}</p>}<p className="privacy-text">{row.description}</p>
    <p>{t('Получено')}: {formatDate(row.receivedOn,{day:'numeric',month:'long',year:'numeric'})} · {t('Срок ответа')}: {row.dueOn?formatDate(row.dueOn,{day:'numeric',month:'long',year:'numeric'}):t('Срок не указан')}</p>
    {row.overdue&&<p className="privacy-overdue">{t('Срок обращения истёк')}</p>}
    <p>{t('Зарегистрировал')}: {row.createdByName}</p>
    {closed?<><h3>{t('Результат обработки')}</h3><p className="privacy-text">{row.resolution}</p>{row.closedAt&&<p>{formatDate(row.closedAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p>}</>:<form className="editor-form" onSubmit={submit}>
     <fieldset className="invoice-fields" disabled={locked}><label>{t('Новый статус обращения')}<select aria-label={t('Новый статус обращения')} value={status} onChange={e=>setStatus(e.target.value as PrivacyRequestChange['status'])}>{row.status==='OPEN'&&<option value="IN_PROGRESS">{t('В обработке')}</option>}<option value="RESOLVED">{t('Исполнено')}</option><option value="REJECTED">{t('Отказ с обоснованием')}</option></select></label>
      {status!=='IN_PROGRESS'&&<><label htmlFor={resolutionId}>{t('Результат или основание отказа *')}</label><textarea id={resolutionId} required minLength={3} maxLength={2000} rows={4} value={resolution} onChange={e=>setResolution(e.target.value)}/></>}
     </fieldset>
     <p className="form-note">{t('Закрывайте обращение после фактической обработки и ответа заявителю. Запись результата не отправляет ответ и не изменяет данные клиентов.')}</p>
     {locked&&!busy&&<p className="form-note">{t('Повтор отправит те же данные. Закройте и откройте карточку, чтобы проверить актуальный статус.')}</p>}
     <button className="button primary" disabled={busy}>{t(busy?'Сохранение…':locked?'Повторить запрос':'Сохранить статус обращения')}</button>
    </form>}
    <AuditTrail entityId={row.id} entityType="PRIVACY_REQUEST" revision={row.version}/>
   </>}
  </div>
 </ModalShell>;
}
