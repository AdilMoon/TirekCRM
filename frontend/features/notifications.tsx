'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, MessageSquare } from 'lucide-react';
import { taskStatusLabels,type AppNotification,type BusinessTask,type NotificationPage,type SessionUser } from '@tirek/contracts';
import { ModalShell } from '../components/ui';
import { Pagination } from '../components/pagination';
import { useI18n } from '../i18n/provider';
import { usePage } from '../lib/use-page';
import { api } from '../lib/api';
import { TaskDiscussion } from './task-discussion';

const labels:Record<AppNotification['kind'],string>={
 TASK_ASSIGNED:'Вам назначена задача',TASK_STATUS_CHANGED:'Изменён статус задачи',TASK_COMMENT_ADDED:'Новый комментарий к задаче',
};
function NotificationList({revision,refresh,close,openTask,onSessionExpired}:{revision:number;refresh:()=>void;close:()=>void;openTask:(task:BusinessTask)=>void;onSessionExpired:()=>void}) {
 const {t,formatDate}=useI18n();
 const [page,setPage]=useState(1),[unread,setUnread]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const locked=useRef(false);
 const list=usePage<AppNotification,NotificationPage>('/notifications',new URLSearchParams({page:String(page),pageSize:'20',unread:String(unread)}).toString(),revision);
 useEffect(()=>{if(list.errorStatus===401)onSessionExpired();},[list.errorStatus,onSessionExpired]);
 useEffect(()=>{if(list.result&&page>Math.max(1,list.result.pages))setPage(Math.max(1,list.result.pages));},[list.result,page]);
 async function act(ids:string[],taskId?:string) {
  if(locked.current)return;
  locked.current=true;setBusy(true);setError('');
  try {
   // Revalidate the task immediately before opening it; never trust a stale notification card.
   const task=taskId?await api<BusinessTask>('/tasks/'+taskId):null;
   await api('/notifications/read',{method:'POST',body:JSON.stringify({ids})});
   refresh();
   if(task)openTask(task);
  } catch(e) {
   const failure=e as Error&{status?:number};setError(failure.message);
   if(failure.status===401)onSessionExpired();
   if(failure.status===403||failure.status===404)refresh();
  } finally {locked.current=false;setBusy(false);}
 }
 const unreadIds=list.result?.items.filter(item=>!item.readAt).map(item=>item.id)??[];
 return <ModalShell title={t('Уведомления')} onClose={close} busy={busy}>
 <section className="notifications-panel">
 <p className="form-note">{t('Назначения, изменения статуса и комментарии к вашим задачам.')}</p>
 <div className="notification-toolbar">
 <label className="check-label"><input type="checkbox" checked={unread} disabled={busy} onChange={e=>{setUnread(e.target.checked);setPage(1);}}/>{t('Только непрочитанные')}</label>
 <button className="button secondary" disabled={busy||list.busy} onClick={()=>{setError('');refresh();}}>{t('Обновить')}</button>
 <button className="text-button" disabled={busy||list.busy||!unreadIds.length} onClick={()=>act(unreadIds)}>{t('Отметить показанные прочитанными')}</button>
 </div>
 {(list.error||error)&&<div className="alert" role="alert">{t(error||list.error)}</div>}
 {list.busy&&<p role="status">{t('Загрузка…')}</p>}
 <div className="notification-list" aria-busy={list.busy}>{list.result?.items.map(item=><article key={item.id} className={'notification-card'+(!item.readAt?' is-unread':'')}>
 <header><strong>{t(labels[item.kind])}</strong><span>{t(item.readAt?'Прочитано':'Не прочитано')}</span></header>
 <h3>{item.task.title}</h3>
 <p>{item.actorName} · <time dateTime={item.createdAt}>{formatDate(item.createdAt,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</time></p>
 {item.taskStatus&&<p>{t('Статус')}: {t(taskStatusLabels[item.taskStatus])}</p>}
 <div className="notification-actions">
 <button className="button secondary" disabled={busy} onClick={()=>act([item.id],item.task.id)}><MessageSquare size={15}/>{t('Открыть обсуждение')}</button>
 {!item.readAt&&<button className="text-button" disabled={busy} onClick={()=>act([item.id])}><Check size={15}/>{t('Отметить прочитанным')}</button>}
 </div></article>)}</div>
 {!list.busy&&!list.error&&!list.result?.items.length&&<p className="empty">{t(unread?'Непрочитанных уведомлений нет':'Уведомлений пока нет')}</p>}
 <Pagination result={list.result} busy={busy||list.busy} page={page} setPage={setPage}/>
 <p className="form-note">{t('Обновляется каждые 30 секунд, пока вкладка открыта.')}</p>
 </section></ModalShell>;
}
export function NotificationCenter({userId,onSessionExpired}:{userId:string;onSessionExpired:()=>void}) {
 const {t}=useI18n();const [open,setOpen]=useState(false),[task,setTask]=useState<BusinessTask|null>(null);
 const [revision,setRevision]=useState(0),[count,setCount]=useState<number|null>(null),[countError,setCountError]=useState(false);
 const expired=useRef(onSessionExpired);expired.current=onSessionExpired;
 const [authCheck,setAuthCheck]=useState(0);
 const recheckSession=useCallback(()=>setAuthCheck(n=>n+1),[]);
 useEffect(()=>{
  if(!authCheck)return;
  let active=true;const controller=new AbortController();
  // A background request can return 401 for the previous cookie after password rotation.
  api<SessionUser>('/auth/me',{signal:controller.signal})
   .then(user=>{if(active){if(user.id===userId)setRevision(n=>n+1);else expired.current();}})
   .catch(error=>{if(active){if(error.status===401)expired.current();else{setCount(null);setCountError(true);}}});
  return()=>{active=false;controller.abort();};
 },[authCheck,userId]);
 const refresh=()=>setRevision(n=>n+1);
 useEffect(()=>{
  const update=()=>{if(document.visibilityState==='visible')setRevision(n=>n+1);};
  const timer=setInterval(update,30000);
  window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[]);
 useEffect(()=>{
  let active=true;const controller=new AbortController();setCountError(false);
  api<{unreadCount:number}>('/notifications/unread-count',{signal:controller.signal})
   .then(result=>{if(active)setCount(result.unreadCount);})
   .catch(error=>{if(active){setCount(null);setCountError(true);if(error.status===401)recheckSession();}});
  return()=>{active=false;controller.abort();};
 },[revision,recheckSession]);
 return <>
 <button className="notification-bell icon-button" aria-label={t('Уведомления')+(count===null?'':': '+count)}
 title={t(countError?'Не удалось загрузить уведомления':'Уведомления')} onClick={()=>{setOpen(true);refresh();}}>
 <Bell size={19}/>{countError?<span className="notification-badge">!</span>:count!==null&&count>0?<span className="notification-badge">{count>99?'99+':count}</span>:null}
 </button>
 {open&&<NotificationList revision={revision} refresh={refresh} close={()=>setOpen(false)} onSessionExpired={recheckSession}
 openTask={selected=>{setOpen(false);setTask(selected);}}/>}
 {task&&<TaskDiscussion key={task.id} task={task} close={()=>{setTask(null);refresh();}} onSessionExpired={recheckSession}/>}
 </>;
}
