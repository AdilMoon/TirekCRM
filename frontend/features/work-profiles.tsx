'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {SchedulingMember} from '@tirek/contracts';
import {api} from '../lib/api';
import {useI18n} from '../i18n/provider';
import {ModalShell,Field} from '../components/ui';
export const dayNames=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const clock=(v:number)=>String(Math.floor(v%1440/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0');
function ProfileForm({member,saved,close,refresh,onBusy}:{member:SchedulingMember;saved:()=>Promise<void>;close:()=>void;refresh:()=>Promise<void>;onBusy:(value:boolean)=>void}){
 const {t}=useI18n(),p=member.profile;
 const [skills,setSkills]=useState(p?.skills.join(', ')??''),[days,setDays]=useState(p?.weekdays??[1,2,3,4,5]);
 const [start,setStart]=useState(clock(p?.startMinute??540)),[end,setEnd]=useState(clock(p?.endMinute??1080)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);onBusy(true);setError('');try{
  const minute=(s:string)=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
  await api('/scheduling/members/'+member.id,{method:'PATCH',body:JSON.stringify({version:p?.version??0,skills:[...new Set(skills.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean))],weekdays:days,startMinute:minute(start),endMinute:end==='00:00'?1440:minute(end)})});await saved();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}}
 return <form className="editor-form" onSubmit={submit}><strong>{member.name}</strong>
  <Field label={t('Навыки через запятую')} maxLength={820} value={skills} disabled={busy} onChange={e=>setSkills(e.target.value)} placeholder={t('Например: уборка, окна, химчистка')}/>
  <fieldset className="schedule-week"><legend>{t('Рабочие дни')}</legend>{dayNames.map((day,i)=><label key={day}><input type="checkbox" disabled={busy} checked={days.includes(i+1)} onChange={e=>setDays(old=>e.target.checked?[...old,i+1].sort((a,b)=>a-b):old.filter(d=>d!==i+1))}/>{t(day)}</label>)}</fieldset>
  <div className="form-row"><Field label={t('Начало смены (Алматы)')} type="time" step={900} required value={start} disabled={busy} onChange={e=>setStart(e.target.value)}/><Field label={t('Конец смены (Алматы)')} type="time" step={900} required value={end} disabled={busy} onChange={e=>setEnd(e.target.value)}/></div>
  <p className="form-note">{t('Одинаковая смена для выбранных дней. Без рабочих дней сотрудник недоступен. Изменения не должны нарушать будущие назначения.')}</p>
  {error&&<p className="form-error" role="alert">{t(error)} <button type="button" className="text-button" disabled={busy} onClick={refresh}>{t('Обновить')}</button></p>}
  <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>{t('Назад')}</button><button className="button primary" disabled={busy}>{t('Сохранить профиль')}</button></div>
 </form>;
}
export function WorkProfiles({close}:{close:()=>void}){
 const {t}=useI18n();const [members,setMembers]=useState<SchedulingMember[]|null>(null),[error,setError]=useState(''),[edit,setEdit]=useState<SchedulingMember|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 async function load(){try{setMembers(await api<SchedulingMember[]>('/scheduling/members'));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 return <ModalShell title={t('Навыки и график')} onClose={close} busy={busy} className="schedule-modal">
  {edit?<ProfileForm key={edit.id} member={edit} onBusy={setBusy} refresh={async()=>{setEdit(null);await load();}} close={()=>setEdit(null)} saved={async()=>{setEdit(null);setNotice('Профиль сохранён');await load();}}/>:<>
  <p className="form-note">{t('Настройте навыки и часы работы сотрудников перед подбором. Часовой пояс — Алматы.')}</p>
  <p className="form-note">{t('Этот график задаёт доступность для назначений. Фактически отработанное время учитывайте отдельно.')}</p>
  {notice&&<p className="schedule-success" role="status">{t(notice)}</p>}
  {error&&<p className="form-error" role="alert">{t(error)} <button className="text-button" onClick={load}>{t('Обновить')}</button></p>}
  {!members&&!error&&<p role="status">{t('Загрузка…')}</p>}
  {members?.length===0&&<p>{t('Сначала пригласите сотрудников в разделе «Команда».')}</p>}
  <div className="schedule-members">{members?.map(m=><article key={m.id}><div><strong>{m.name}</strong><p>{m.profile?m.profile.skills.join(', ')||t('Навыки не указаны'):t('Профиль не настроен')}</p><small>{!m.isActive?t('Доступ отключён'):m.profile?`${clock(m.profile.startMinute)}–${clock(m.profile.endMinute)} · ${m.profile.weekdays.map(d=>t(dayNames[d-1])).join(', ')}`:''}</small></div><button className="button secondary" onClick={()=>{setEdit(m);setNotice('');}}>{t('Настроить')}</button></article>)}</div>
  </>}
 </ModalShell>;
}
