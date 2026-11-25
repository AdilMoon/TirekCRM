'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BusinessTask, TaskComment } from '@tirek/contracts';
import { ModalShell } from '../components/ui';
import { Pagination } from '../components/pagination';
import { useI18n } from '../i18n/provider';
import { usePage } from '../lib/use-page';
import { api } from '../lib/api';
import {ServiceObjectPanel} from './service-object';

export function TaskDiscussion({task,close,onSessionExpired}:{task:BusinessTask;close:()=>void;onSessionExpired?:()=>void}) {
 const {t,formatDate}=useI18n();
 const [objectOpen,setObjectOpen]=useState(false);
 const [page,setPage]=useState(1),[body,setBody]=useState(''),[sending,setSending]=useState(false);
 const [uncertain,setUncertain]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[accessLost,setAccessLost]=useState(false);
 const pending=useRef<{body:string;key:string}|null>(null),inFlight=useRef(false);
 const path='/tasks/'+task.id+'/comments';
 const list=usePage<TaskComment>(path,new URLSearchParams({page:String(page),pageSize:'20'}).toString());
 useEffect(()=>{
  if(list.errorStatus===401)onSessionExpired?.();
  if(list.errorStatus===403||list.errorStatus===404)setAccessLost(true);
 },[list.errorStatus,onSessionExpired]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const text=body.trim();
  if(!text||inFlight.current||accessLost)return;
  inFlight.current=true;setSending(true);setError('');setNotice('');
  // Retain the operation key after an uncertain network result.
  if(!pending.current)pending.current={body:text,key:crypto.randomUUID()};
  try{
   await api<TaskComment>(path,{method:'POST',body:JSON.stringify({body:pending.current.body,idempotencyKey:pending.current.key})});
   setBody('');pending.current=null;setUncertain(false);setNotice('Комментарий добавлен');setPage(1);list.retry();
  }catch(e){
   const failure=e as Error&{status?:number};
   setError(failure.status?failure.message:'Не удалось связаться с сервером');
   if(!failure.status||failure.status>=500)setUncertain(true);
   else if(!uncertain)pending.current=null;
   if(failure.status===401)onSessionExpired?.();
   if(failure.status===403||failure.status===404)setAccessLost(true);
  }finally{inFlight.current=false;setSending(false);}
 }
 if(objectOpen&&task.order)return <ServiceObjectPanel id={task.order.id} close={()=>setObjectOpen(false)}/>;
 return <ModalShell title={t('Обсуждение задачи')} onClose={close} busy={sending}>
 <section className="task-discussion">
 <h3>{task.title}</h3>
 {task.order&&<button className="button secondary" disabled={sending} onClick={()=>setObjectOpen(true)}>{t('Объект и история обслуживания')}</button>}
 <p className="form-note">{t('История доступна владельцу и текущему исполнителю, включая сообщения до переназначения.')}</p>
 <p className="form-note">{t('Комментарии сохраняются без редактирования. Новые сообщения — сверху.')}</p>
 {(error||list.error)&&<div className="alert" role="alert">{t(error||list.error)}</div>}
 {notice&&<p className="task-notice" role="status">{t(notice)}</p>}
 {accessLost?<p role="status">{t('Доступ к обсуждению изменился. Закройте окно и обновите задачи.')}</p>:<>
 {uncertain&&<p className="alert" role="status">{t('Результат отправки неизвестен. Повторите исходное сообщение, не закрывая окно. Текст временно заблокирован для защиты от дубликата.')}</p>}
 <form className="editor-form" onSubmit={submit}>
 <label>{t('Комментарий')}<textarea rows={3} maxLength={2000} required value={body} disabled={sending||uncertain}
 onChange={event=>{setBody(event.target.value);setNotice('');}}/></label>
 <div className="form-actions"><button type="submit" className="button primary" disabled={sending||!body.trim()||list.busy||!!list.error}>{t(sending?'Отправка…':uncertain?'Повторить отправку':'Отправить комментарий')}</button></div>
 </form>
 <div className="discussion-heading"><h4>{t('Комментарии')}</h4><button className="button secondary" disabled={sending||list.busy} onClick={()=>{setError('');list.retry();}}>{t('Обновить')}</button></div>
 {list.busy&&<p role="status">{t('Загрузка…')}</p>}
 <div className="comment-list" aria-busy={list.busy}>{list.result?.items.map(comment=><article className="task-comment" key={comment.id}>
 <header><strong>{comment.authorName}</strong><time dateTime={comment.createdAt}>{formatDate(comment.createdAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time></header>
 <p>{comment.body}</p></article>)}</div>
 {!list.busy&&!list.error&&!list.result?.items.length&&<p className="form-note">{t('Комментариев пока нет. Сохраните первую договорённость.')}</p>}
 <Pagination result={list.result} busy={list.busy||sending} page={page} setPage={setPage}/>
 </>}
 </section></ModalShell>;
}
