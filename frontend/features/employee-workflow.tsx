'use client';
import {useEffect,useState} from 'react';
import {CheckCircle2,ArrowRight,Camera,Clock3,ListChecks,Play} from 'lucide-react';
import type {EmployeeFirstDay,EmployeeWorkflow} from '@tirek/contracts';
import {api} from '../lib/api';
import {useI18n} from '../i18n/provider';
import {ModalShell} from '../components/ui';
import {OrderPassportManager} from './order-passport';
import {WorkTimeCreate} from './work-time-forms';
import {OrderAcceptancePanel} from './order-acceptance';
import {ServiceObjectPanel} from './service-object';
function steps(data:EmployeeWorkflow){return [
 {id:'start',label:'Начать задачу',done:['IN_PROGRESS','DONE'].includes(data.task.status),available:true},
 {id:'photo',label:'Фото результата',done:data.resultPhotos>0,available:!!data.task.order},
 {id:'time',label:'Фактическое время',done:data.submittedMinutes+data.approvedMinutes>0,available:!!data.task.order},
 ...(data.requiredChecks?[{id:'acceptance',label:'Приёмка работ',done:data.completedChecks===data.requiredChecks,available:true}]:[]),
 {id:'finish',label:'Завершить задачу',done:data.task.status==='DONE',available:true},
];}
export function EmployeeFirstDayCard({revision,onChanged,onSessionExpired}:{revision:unknown;onChanged:()=>void;onSessionExpired?:()=>void}){
 const {t}=useI18n();const [data,setData]=useState<EmployeeFirstDay|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[open,setOpen]=useState('');
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');api<EmployeeFirstDay>('/tasks/first-day',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted){setError(e.message);if(e.status===401)onSessionExpired?.();}});return()=>controller.abort();},[revision,attempt,onSessionExpired]);
 const progress=data?.workflow?steps(data.workflow).filter(step=>step.available):[];
 const done=progress.length>0&&progress.every(step=>step.done);
 return <section className={'panel employee-first-day'+(done?' completed':'')} aria-label={t('Первый рабочий день')}>
  {done&&data?.workflow?<div className="first-day-complete-summary"><CheckCircle2 size={26}/><div><h2>{t('Первый маршрут пройден')}</h2><small>{t('Выполнено шагов: {0} из {1}',progress.length,progress.length)}</small></div><button className="text-button" onClick={()=>setOpen(data.workflow!.task.id)}>{t('Открыть пошаговый маршрут')}<ArrowRight size={16}/></button></div>:<>
  <div className="first-day-heading"><div><p className="eyebrow">{t('Первый рабочий день')}</p><h2>{t('От первой задачи до результата')}</h2></div><span className="first-day-symbol"><CheckCircle2 size={26}/></span></div>
  {error&&<p className="form-error" role="alert">{t(error)}</p>}{!data&&!error&&<p role="status">{t('Загрузка…')}</p>}
  {data?.workflow?<><p>{data.workflow.task.title}</p><div className="first-day-summary"><strong>{t('Выполнено шагов: {0} из {1}',progress.filter(step=>step.done).length,progress.length)}</strong><button className="button primary" onClick={()=>setOpen(data.workflow!.task.id)}>{t('Открыть пошаговый маршрут')}<ArrowRight size={16}/></button></div></>:
   data&&<p>{t('Доступ уже есть. Первая задача появится здесь, когда владелец назначит её вам.')}</p>}
  </>}
  <button className="text-button" onClick={()=>setAttempt(n=>n+1)}>{t('Обновить маршрут')}</button>
  {open&&<EmployeeTaskFlow key={open} id={open} close={()=>{setOpen('');setAttempt(n=>n+1);onChanged();}} onSessionExpired={onSessionExpired}/>}
 </section>;
}
export function EmployeeTaskFlow({id,close,onSessionExpired}:{id:string;close:()=>void;onSessionExpired?:()=>void}){
 const {t,dateLabel}=useI18n();const [data,setData]=useState<EmployeeWorkflow|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0),[mode,setMode]=useState('flow');
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');api<EmployeeWorkflow>('/tasks/'+id+'/workflow',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted){setError(e.message);if(e.status===401)onSessionExpired?.();}});return()=>controller.abort();},[id,attempt,onSessionExpired]);
 const back=()=>{setMode('flow');setAttempt(n=>n+1);};
 async function change(status:'IN_PROGRESS'|'DONE'){
  if(!data||busy)return;setBusy(true);setError('');
  try{await api('/tasks/'+id+'/status',{method:'PATCH',body:JSON.stringify({status,version:data.task.version})});setAttempt(n=>n+1);}
  catch(e){const failure=e as Error&{status?:number};setError(failure.message);if(failure.status===401)onSessionExpired?.();if(failure.status===403||failure.status===404)setData(null);}
  finally{setBusy(false);}
 }
 if(mode==='photo'&&data?.task.order)return <OrderPassportManager id={data.task.order.id} close={back} initialPhase="AFTER" resultOnly onPhotoSaved={back}/>;
 if(mode==='time'&&data?.task.order)return <WorkTimeCreate employee="" initialOrder={data.task.order} fixedOrder close={back} saved={back}/>;
 if(mode==='acceptance'&&data?.task.order)return <OrderAcceptancePanel orderId={data.task.order.id} close={back}/>;
 if(mode==='object'&&data?.task.order)return <ServiceObjectPanel id={data.task.order.id} close={back}/>;
 const progress=data?steps(data):[],active=progress.filter(step=>step.available),complete=active.length>0&&active.every(step=>step.done);
 const working=data?.task.status==='IN_PROGRESS',pending=data?.task.status==='TODO';
 const canFinish=working&&active.filter(step=>step.id!=='finish').every(step=>step.done);
 return <ModalShell title={t('Пошаговый маршрут задачи')} onClose={close} busy={busy} className="employee-flow-modal">
  {error&&<p className="form-error" role="alert">{t(error)}</p>}{!data&&!error&&<p role="status">{t('Загрузка…')}</p>}
  {data&&<>
   <div className="employee-flow-brief"><h3>{data.task.title}</h3>{data.task.description&&<p>{data.task.description}</p>}<small>{data.task.order&&t('Заказ № {0}',data.task.order.number)+' · '}{dateLabel(data.task.dueDate)}</small></div>
   {data.task.order&&<p className="form-note">{t('Фото и часы относятся к связанному заказу.')}</p>}
   {complete?<p className="task-notice" role="status">{t('Маршрут пройден. Доступные шаги сохранены, задача завершена.')}</p>:<p className="form-note">{t('Пройдите шаги до завершения задачи. Часы отправляются владельцу на проверку.')}</p>}
   {!data.task.order&&<p className="form-note">{t('Задача без заказа. Для фото и учёта времени попросите владельца связать её с заказом.')}</p>}
   {data.task.status==='DONE'&&!complete&&<p className="form-note">{t('Задача уже завершена. Если нужно добавить фото, обратитесь к владельцу.')}</p>}
   <ol className="employee-flow-steps">{progress.map((step,index)=><li key={step.id} className={step.done?'done':!step.available?'unavailable':''}>
    <span className="employee-step-number">{step.done?<CheckCircle2 size={19}/>:index+1}</span><div><strong>{t(step.label)}</strong>
     {!step.available?<p>{t('Нужна привязка к заказу')}</p>:<>
      {step.id==='start'&&<><p>{t('Прочитайте задание и отметьте начало работы.')}</p>{pending&&<button className="button primary" disabled={busy} onClick={()=>change('IN_PROGRESS')}><Play size={16}/>{t('Начать задачу')}</button>}</>}
      {step.id==='photo'&&<><p>{data.resultPhotos?t('Фото результата сохранено: {0}',data.resultPhotos):t('Снимите результат. Фото сохранится в CRM, публикацией управляет владелец.')}</p>{(pending||working)&&<button className="button secondary" disabled={busy||!working} onClick={()=>setMode('photo')}><Camera size={16}/>{t('Добавить фото результата')}</button>}</>}
      {step.id==='time'&&<><p>{t('На проверке: {0} мин · Подтверждено: {1} мин',data.submittedMinutes,data.approvedMinutes)}</p><button className="button secondary" disabled={busy||pending} onClick={()=>setMode('time')}><Clock3 size={16}/>{t('Записать фактическое время')}</button></>}
      {step.id==='acceptance'&&<><p>{t('Обязательных пунктов выполнено: {0} из {1}',data.completedChecks,data.requiredChecks)}</p>{(pending||working)&&<button className="button secondary" disabled={busy||!working} onClick={()=>setMode('acceptance')}><ListChecks size={16}/>{t('Открыть чек-лист')}</button>}</>}
      {step.id==='finish'&&!step.done&&<><p>{t('Перед завершением сохраните результат, время и обязательные отметки.')}</p><button className="button primary" disabled={busy||!canFinish} onClick={()=>change('DONE')}>{t('Завершить задачу')}</button></>}
     </>}
    </div>
   </li>)}</ol>
   {data.task.order&&(pending||working)&&<button className="text-button" disabled={busy} onClick={()=>setMode('object')}>{t('Объект и история обслуживания')}</button>}
  </>}
  <button className="button secondary" disabled={busy} onClick={()=>setAttempt(n=>n+1)}>{t('Обновить маршрут')}</button>
 </ModalShell>;
}
