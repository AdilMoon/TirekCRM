'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {AssignmentState,AssignmentRecommendations,AssignOrderInput,CandidateBlock} from '@tirek/contracts';
import {api} from '../lib/api';
import {useI18n} from '../i18n/provider';
import {ModalShell,Field} from '../components/ui';
const blockLabels:Record<CandidateBlock,string>={INACTIVE:'Доступ отключён',PROFILE_REQUIRED:'Профиль не настроен',MISSING_SKILLS:'Не хватает навыков: {0}',OUTSIDE_HOURS:'Вне рабочего графика',OVERLAP:'Пересечение с другим заказом'};
function localInput(value:Date){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
export function OrderAssignment({id,close}:{id:string;close:()=>void}){
 const {t,formatDate}=useI18n();
 const [state,setState]=useState<AssignmentState|null>(null),[plan,setPlan]=useState<AssignmentRecommendations|null>(null),[selected,setSelected]=useState('');
 const [start,setStart]=useState(()=>localInput(new Date(Date.now()+86400000)).slice(0,10)+'T09:00'),[duration,setDuration]=useState('60'),[skills,setSkills]=useState('');
 const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const pending=useRef<AssignOrderInput|null>(null);
 const date=(value:string)=>formatDate(value,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 async function load(initial=false){const value=await api<AssignmentState>('/orders/'+id+'/assignment');setState(value);if(initial&&value.current){setStart(localInput(new Date(value.current.startsAt)));setDuration(String((Date.parse(value.current.endsAt)-Date.parse(value.current.startsAt))/60000));setSkills(value.current.requiredSkills.join(', '));}}
 useEffect(()=>{void load(true).catch(e=>setError(e.message));},[id]);
 function changed(){setPlan(null);setSelected('');setNotice('');}
 async function recommend(e:FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');setPlan(null);try{
  const value=await api<AssignmentRecommendations>('/orders/'+id+'/assignment/recommendations',{method:'POST',body:JSON.stringify({startsAt:start+':00+05:00',durationMinutes:Number(duration),requiredSkills:[...new Set(skills.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean))]})});setPlan(value);setSelected(value.recommendedId??'');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function assign(){if(!plan||!selected)return;setBusy(true);setError('');setLocked(true);try{
  if(!pending.current)pending.current={startsAt:plan.startsAt,durationMinutes:(Date.parse(plan.endsAt)-Date.parse(plan.startsAt))/60000,requiredSkills:[...new Set(skills.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean))],employeeId:selected,profileVersion:plan.candidates.find(c=>c.id===selected)!.profileVersion!,orderVersion:plan.orderVersion,currentBookingId:plan.currentBookingId,idempotencyKey:crypto.randomUUID()};
  await api('/orders/'+id+'/assignment',{method:'POST',body:JSON.stringify(pending.current)});pending.current=null;setLocked(false);setPlan(null);setNotice('Назначение сохранено. Задача и уведомление исполнителю созданы.');await load();
 }catch(e){setError((e as Error).message);if([400,404,409].includes((e as Error&{status:number}).status)){pending.current=null;setLocked(false);setPlan(null);await load().catch(()=>{});}}finally{setBusy(false);}}
 async function cancel(){if(!state?.current)return;setBusy(true);setError('');try{await api('/orders/'+id+'/assignment/cancel',{method:'POST',body:JSON.stringify({bookingId:state.current.id})});changed();setNotice('Назначение отменено. Время освобождено.');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <ModalShell title={t('Умное распределение')} onClose={close} busy={busy} className="schedule-modal">
  <p className="form-note">{t('Подбор по навыкам, графику и занятости. Сначала меньше занятых минут за день, затем меньше активных задач. Назначение подтверждаете вы.')}</p>
  {error&&<p className="form-error" role="alert">{t(error)} <button className="text-button" disabled={busy} onClick={()=>load().then(()=>setError('')).catch(e=>setError(e.message))}>{t('Обновить')}</button></p>}
  {notice&&<p className="schedule-success" role="status">{t(notice)}</p>}
  {!state&&!error&&<p role="status">{t('Загрузка…')}</p>}
  {state?.current&&<section className="schedule-current"><strong>{t('Текущий исполнитель')}: {state.current.employee.name}</strong><p>{date(state.current.startsAt)} — {date(state.current.endsAt)}</p><p>{state.current.requiredSkills.join(', ')}</p><button className="button secondary" disabled={busy||locked} onClick={cancel}>{t('Отменить назначение')}</button></section>}
  {state&&(['COMPLETED','CANCELLED'].includes(state.status)?<p>{t('Завершённый или отменённый заказ нельзя назначить')}</p>:<>
  <form className="editor-form" onSubmit={recommend}><div className="form-row"><Field label={t('Начало работы (Алматы)')} type="datetime-local" required step={900} value={start} disabled={busy||locked} onChange={e=>{setStart(e.target.value);changed();}}/><Field label={t('Длительность, минут')} type="number" min={15} max={720} step={15} required value={duration} disabled={busy||locked} onChange={e=>{setDuration(e.target.value);changed();}}/></div>
   <Field label={t('Нужные навыки через запятую')} maxLength={820} value={skills} disabled={busy||locked} onChange={e=>{setSkills(e.target.value);changed();}}/>
   <p className="form-note">{t('Навыки должны совпадать с профилем. Пустой список означает работу без требований к навыкам. Графики настраиваются в разделе «Команда».')}</p>
   <button className="button secondary" disabled={busy||locked}>{t('Подобрать исполнителей')}</button>
  </form>
  {plan&&<section className="schedule-results"><h3>{t('Кандидаты на выбранное время')}</h3><p>{date(plan.startsAt)} — {date(plan.endsAt)}</p>{!plan.candidates.length&&<p>{t('Сначала пригласите сотрудников в разделе «Команда».')}</p>}
   {!plan.recommendedId&&!!plan.candidates.length&&<p className="form-note">{t('Подходящих исполнителей нет. Измените время, требования или график сотрудников.')}</p>}
   {plan.candidates.map(c=><label key={c.id} className={'schedule-candidate '+(c.eligible?'eligible':'blocked')}><input type="radio" name="schedule-employee" aria-label={t('Выбрать {0}',c.name)} checked={selected===c.id} disabled={busy||locked||!c.eligible} onChange={()=>setSelected(c.id)}/><div><strong>{c.name}</strong>{plan.recommendedId===c.id&&<span className="schedule-badge">{t('Рекомендуем')}</span>}
    {c.eligible?<p>{t('Навыки подходят · В рабочем графике · Интервал свободен')}</p>:<ul>{c.blocks.map(b=><li key={b}>{t(blockLabels[b],c.missingSkills.join(', '))}</li>)}</ul>}
    <small>{t('Занято за день: {0} мин. Активных задач: {1}',c.workloadMinutes,c.activeTasks)}</small></div></label>)}
   {selected&&<button className="button primary" disabled={busy} onClick={assign}>{t(locked?'Повторить назначение':state.current?'Подтвердить переназначение':'Подтвердить назначение')}</button>}
  </section>}
  {locked&&<p className="form-note">{t('Повтор отправит те же данные и не создаст вторую задачу.')}</p>}
  </>)}
  <p className="form-note">{t('Резервируется точное время заказа. Обычные задачи без времени не блокируют интервал. Дорога, перерывы и внешние календари пока не учитываются.')}</p>
 </ModalShell>;
}
