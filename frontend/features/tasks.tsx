'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Pencil, Clock3, MessageSquare } from 'lucide-react';
import { taskStatuses, taskStatusLabels, type BusinessTask, type TaskStatus, type SessionUser, type Order } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { usePage } from '../lib/use-page';
import { Pagination } from '../components/pagination';
import { Empty, Field, ModalShell, SearchBox } from '../components/ui';
import type { TeamData } from './team';
import { TaskDiscussion } from './task-discussion';
import { OrderPassportManager } from './order-passport';
import { WorkTimeCreate } from './work-time-forms';
function OrderPicker({initial}:{initial:BusinessTask['order']}) {
 const {t}=useI18n();const [q,setQ]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState(initial);
 const {result,busy,error,retry}=usePage<Order>('/orders/search',new URLSearchParams({q,page:String(page)}).toString());
 const list=result?.items??[];const options=selected&&!list.some(o=>o.id===selected.id)?[selected,...list]:list;
 return <div className="client-picker"><Field label={t('Поиск заказа')} value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/>
 <label>{t('Связать с заказом')}<select name="orderId" value={selected?.id??''} onChange={e=>setSelected(options.find(o=>o.id===e.target.value)??null)}><option value="">{t('Без заказа')}</option>{options.map(o=><option key={o.id} value={o.id}>№ {o.number} · {o.title}</option>)}</select></label>
 {error&&<p className="form-error">{t(error)}<button type="button" onClick={retry}>{t('Обновить')}</button></p>}
 {result&&result.pages>1&&<Pagination result={result} busy={busy} page={page} setPage={setPage}/>}</div>;
}
function TaskEditor({task,user,close,saved}:{task:BusinessTask|null;user:SessionUser;close:()=>void;saved:()=>void}) {
 const {t}=useI18n();const [team,setTeam]=useState<TeamData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){try{setTeam(await api<TeamData>('/team'));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');try{
  await api(task?'/tasks/'+task.id:'/tasks',{method:task?'PATCH':'POST',body:JSON.stringify({title:f.get('title'),description:f.get('description'),assigneeId:f.get('assigneeId'),orderId:f.get('orderId')||null,dueDate:f.get('dueDate')||null,...(task?{version:task.version}:{})})});saved();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <ModalShell title={t(task?'Редактировать задачу':'Новая задача')} onClose={close} busy={busy}><form className="editor-form" onSubmit={submit}>
 <Field label={t('Название задачи')} name="title" required maxLength={200} defaultValue={task?.title}/>
 <label>{t('Описание задачи')}<textarea name="description" rows={3} maxLength={2000} defaultValue={task?.description}/></label>
 <p className="form-note">{t('Название, описание и название заказа будут видны исполнителю.')}</p>
 <div className="form-row"><label>{t('Исполнитель')}<select key={team?'loaded':'loading'} name="assigneeId" required defaultValue={task?.assignee.isActive===false?'':task?.assignee.id??user.id}><option value="" disabled>{t('Выберите исполнителя')}</option>{team?.members.filter(m=>m.isActive).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><Field label={t('Срок выполнения')} name="dueDate" type="date" defaultValue={task?.dueDate?.slice(0,10)}/></div>
 <OrderPicker initial={task?.order??null}/>
 {error&&<p className="form-error" role="alert">{t(error)}{!team&&<button type="button" onClick={load}>{t('Обновить')}</button>}</p>}
 <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>{t('Отмена')}</button><button className="button primary" disabled={busy||!team}>{t('Сохранить')}</button></div></form></ModalShell>;
}
export function Tasks({user,onSessionExpired}:{user:SessionUser;onSessionExpired?:()=>void}) {
 const {t,dateLabel,formatDate}=useI18n();const owner=user.role==='OWNER';
 const [discussion,setDiscussion]=useState<BusinessTask|null>(null);
 const [passportId,setPassportId]=useState('');
 const [timeOrder,setTimeOrder]=useState<BusinessTask['order']>(null);
 const [q,setQ]=useState(''),[page,setPage]=useState(1),[status,setStatus]=useState(''),[mine,setMine]=useState(false),[editor,setEditor]=useState<BusinessTask|null|undefined>(undefined),[busyId,setBusyId]=useState(''),[actionError,setActionError]=useState(''),[notice,setNotice]=useState('');
 const {result,error,errorStatus,busy,retry}=usePage<BusinessTask>('/tasks',new URLSearchParams({q,page:String(page),...(status?{status}:{}),...(mine?{assigneeId:user.id}:{})}).toString());
 useEffect(()=>{if(errorStatus===401)onSessionExpired?.();},[errorStatus,onSessionExpired]);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 async function change(task:BusinessTask,next:TaskStatus){setBusyId(task.id);setActionError('');setNotice('');try{await api('/tasks/'+task.id+'/status',{method:'PATCH',body:JSON.stringify({status:next,version:task.version})});setNotice('Статус задачи обновлён');retry();}catch(e){setActionError((e as Error).message);if((e as Error&{status?:number}).status===401)onSessionExpired?.();retry();}finally{setBusyId('');}}
 return <section className="panel task-space" aria-busy={busy}><div className="panel-heading"><div><h2>{t(owner?'Задачи команды':'Мои задачи')}</h2><p>{t('Договорённости, исполнители и сроки в одном месте.')}</p></div><div className="heading-actions"><button className="button secondary" onClick={retry}>{t('Обновить')}</button>{owner&&<button className="button primary" onClick={()=>setEditor(null)}><Plus size={17}/>{t('Новая задача')}</button>}</div></div>
 <div className="table-toolbar"><div className="task-filters"><label className="filter-label">{t('Статус')}<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{t('Все задачи')}</option>{taskStatuses.map(s=><option key={s} value={s}>{t(taskStatusLabels[s])}</option>)}</select></label>{owner&&<label className="check-label"><input type="checkbox" checked={mine} onChange={e=>{setMine(e.target.checked);setPage(1);}}/>{t('Только мои')}</label>}</div><SearchBox value={q} setValue={value=>{setQ(value);setPage(1);}} placeholder={t('Название или описание задачи')}/></div>
 {(error||actionError)&&<div className="alert" role="alert">{t(actionError||error)}<button onClick={()=>{setActionError('');retry();}}>{t('Обновить')}</button></div>}
 {notice&&<p className="task-notice" role="status">{t(notice)}</p>}
 <div className="task-list">{result?.items.map(task=>{const late=task.dueDate&&task.dueDate.slice(0,10)<today&&!['DONE','CANCELLED'].includes(task.status);return <article className="task-card" key={task.id}>
 <div className="task-card-head"><span className={'status '+({TODO:'new',IN_PROGRESS:'in_progress',DONE:'completed',CANCELLED:'cancelled'}[task.status])}>{t(taskStatusLabels[task.status])}</span>{owner&&<button className="icon-button" aria-label={t('Редактировать задачу')} onClick={()=>setEditor(task)}><Pencil size={16}/></button>}</div>
 <h3>{task.title}</h3>{task.description&&<p className="task-description">{task.description}</p>}
 <div className="task-meta"><span>{task.assignee.name}{!task.assignee.isActive&&' · '+t('Доступ отключён')}</span>{task.order&&<span>{t('Заказ №')} {task.order.number} · {task.order.title}</span>}<span className={late?'task-overdue':''}><Clock3 size={14}/>{task.dueDate?dateLabel(task.dueDate):t('Без срока')}{late&&' · '+t('Просрочена')}</span></div>
 {task.booking&&!task.booking.releasedAt&&<p className="schedule-time">{t('Работа по графику: {0} — {1}',formatDate(task.booking.startsAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),formatDate(task.booking.endsAt,{hour:'2-digit',minute:'2-digit'}))}</p>}
 <div className="task-actions">{!owner&&task.order&&task.status!=='CANCELLED'&&<button className="button secondary" onClick={()=>setTimeOrder(task.order)}><Clock3 size={16} aria-hidden="true"/>{t('Записать время по заказу')}</button>}{task.order&&['TODO','IN_PROGRESS'].includes(task.status)&&<button className="button secondary" onClick={()=>setPassportId(task.order!.id)}>{t('QR-паспорт заказа')}</button>}<button className="button secondary" onClick={()=>setDiscussion(task)}><MessageSquare size={16}/>{t('Обсуждение')}</button>{owner?<label>{t('Изменить статус')}<select disabled={!!busyId} value={task.status} onChange={e=>change(task,e.target.value as TaskStatus)}>{taskStatuses.map(s=><option key={s} value={s}>{t(taskStatusLabels[s])}</option>)}</select></label>:<>
 {task.status==='TODO'&&<button className="button primary" disabled={!!busyId} onClick={()=>change(task,'IN_PROGRESS')}>{t('Начать задачу')}</button>}
 {task.status==='IN_PROGRESS'&&<><button className="button primary" disabled={!!busyId} onClick={()=>change(task,'DONE')}>{t('Завершить задачу')}</button><button className="button secondary" disabled={!!busyId} onClick={()=>change(task,'TODO')}>{t('Вернуть в план')}</button></>}</>}</div>
 </article>;})}</div>
 {busy&&<Empty>{t('Загрузка…')}</Empty>}{!busy&&!error&&!result?.items.length&&<Empty>{t('Задач пока нет. Здесь появятся назначенные поручения.')}</Empty>}
 <Pagination result={result} busy={busy} page={page} setPage={setPage}/>
 {discussion&&<TaskDiscussion key={discussion.id} task={discussion} close={()=>setDiscussion(null)} onSessionExpired={onSessionExpired}/>}
 {timeOrder&&<WorkTimeCreate employee="" initialOrder={timeOrder} close={()=>setTimeOrder(null)} saved={()=>{setTimeOrder(null);setNotice('Время отправлено на проверку');}}/>}
 {passportId&&<OrderPassportManager id={passportId} close={()=>{setPassportId('');retry();}}/>}
 {editor!==undefined&&<TaskEditor user={user} task={editor} close={()=>setEditor(undefined)} saved={()=>{setEditor(undefined);setNotice('Задача сохранена');retry();}}/>}
 </section>;
}
