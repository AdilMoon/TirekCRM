'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Copy, Users } from 'lucide-react';
import { roleLabels, type TeamMember, type TeamInvitation, type SessionUser } from '@tirek/contracts';
import { api } from '../lib/api';
import { useI18n } from '../i18n/provider';
import { ModalShell, Field, Empty } from '../components/ui';
import {WorkProfiles} from './work-profiles';
import {TaskEditor} from './tasks';
export type TeamData={members:TeamMember[];invitations:TeamInvitation[]};
export function Team({user}:{user:SessionUser}) {
 const [assignment,setAssignment]=useState<TeamMember|null>(null),[notice,setNotice]=useState('');
 const [profiles,setProfiles]=useState(false);
 const {t,formatDate}=useI18n();
 const [data,setData]=useState<TeamData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[invite,setInvite]=useState(false),[link,setLink]=useState(''),[copied,setCopied]=useState(false),[target,setTarget]=useState<TeamMember|null>(null);
 async function load(){try{setData(await api<TeamData>('/team'));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);setError('');
  try{const result=await api<{token:string}>('/team/invitations',{method:'POST',body:JSON.stringify({name:form.get('name'),email:form.get('email')})});setLink(window.location.origin+'/join#token='+result.token);setCopied(false);await load();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function changeAccess(){if(!target)return;setBusy(true);setError('');try{await api('/team/members/'+target.id,{method:'PATCH',body:JSON.stringify({isActive:!target.isActive,version:target.version})});setTarget(null);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function revoke(id:string){setBusy(true);try{await api('/team/invitations/'+id+'/revoke',{method:'POST'});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="team-space">
  {profiles&&<WorkProfiles close={()=>setProfiles(false)}/>}
  {assignment&&<TaskEditor task={null} user={user} initialAssigneeId={assignment.id} close={()=>setAssignment(null)} saved={()=>{setAssignment(null);setNotice('Задача назначена. Сотрудник увидит её в своём рабочем пространстве.');}}/>}
  {notice&&<p className="task-notice" role="status">{t(notice)}</p>}
  <div className="info-banner"><Users size={23}/><div><strong>{t('Каждому — своя зона ответственности')}</strong><p>{t('Владелец управляет бизнесом. Сотрудники видят свои задачи и отмечают выполнение.')}</p></div></div>
  {error&&!invite&&!target&&<div className="alert" role="alert">{t(error)}<button onClick={load}>{t('Обновить')}</button></div>}
  <section className="panel"><div className="panel-heading"><h2>{t('Сотрудники')}</h2><div className="team-schedule-actions"><button className="button secondary" disabled={busy} onClick={load}>{t("Обновить")}</button><button className="button secondary" onClick={()=>setProfiles(true)}>{t('Навыки и график')}</button><button className="button primary" onClick={()=>{setError('');setLink('');setInvite(true);}}><Plus size={17}/>{t('Пригласить сотрудника')}</button></div></div>
  <div className="table-wrap"><table><thead><tr><th>{t('Имя')}</th><th>Email</th><th>{t('Роль')}</th><th>{t('Доступ')}</th><th/></tr></thead><tbody>{data?.members.map(member=><tr key={member.id}><td><strong>{member.name}</strong></td><td>{member.email}</td><td>{t(roleLabels[member.role])}</td><td><span className={'status '+(member.isActive?'completed':'cancelled')}>{t(member.isActive?'Активен':'Отключён')}</span></td><td>{member.role==="EMPLOYEE"&&member.isActive&&<button className="text-button" disabled={busy} onClick={()=>setAssignment(member)}>{t("Назначить задачу")}</button>}{member.role==='EMPLOYEE'&&<button className="text-button" disabled={busy} onClick={()=>{setTarget(member);setError('');}}>{t(member.isActive?'Отключить доступ':'Вернуть доступ')}</button>}</td></tr>)}</tbody></table></div>
  {!data&&!error&&<Empty>{t('Загрузка…')}</Empty>}</section>
  <section className="panel"><div className="panel-heading"><div><h2>{t('Ожидают приглашения')}</h2><p>{t('Ссылка действует 48 часов и используется один раз.')}</p></div></div>
  {data?.invitations.length?<div className="table-wrap"><table><thead><tr><th>{t('Имя')}</th><th>Email</th><th>{t('Действует до')}</th><th/></tr></thead><tbody>{data.invitations.map(item=><tr key={item.id}><td>{item.name}</td><td>{item.email}</td><td>{formatDate(item.expiresAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</td><td><button className="text-button" disabled={busy} onClick={()=>revoke(item.id)}>{t('Отозвать')}</button></td></tr>)}</tbody></table></div>:<Empty>{t('Активных приглашений нет')}</Empty>}</section>
  {invite&&<ModalShell title={t('Пригласить сотрудника')} busy={busy} onClose={()=>{setInvite(false);setLink('');setError('');}}>
   {link?<div className="editor-form"><p>{t('Приглашение создано. Передайте ссылку сотруднику лично.')}</p><p className="form-note">{t("После принятия приглашения обновите список сотрудников и нажмите «Назначить задачу».")}</p><label>{t('Одноразовая ссылка')}<input readOnly value={link} onFocus={e=>e.target.select()}/></label><p className="form-note">{t('Скопируйте ссылку сейчас: после закрытия она больше не отображается. Письмо автоматически не отправляется.')}</p><button className="button primary" onClick={async()=>{try{await navigator.clipboard.writeText(link);setCopied(true);}catch{setError('Выделите и скопируйте ссылку вручную');}}}><Copy size={16}/>{t(copied?'Скопировано':'Скопировать ссылку')}</button></div>:
   <form className="editor-form" onSubmit={submit}><Field label={t('Имя сотрудника')} name="name" required maxLength={160}/><Field label="Email" name="email" required type="email" maxLength={254}/><p className="form-note">{t('Сотрудник самостоятельно задаст пароль при принятии приглашения.')}</p><button className="button primary" disabled={busy}>{t('Создать приглашение')}</button></form>}
   {error&&<p className="form-error" role="alert">{t(error)}</p>}
  </ModalShell>}
  {target&&<ModalShell title={t(target.isActive?'Отключить доступ':'Вернуть доступ')} busy={busy} onClose={()=>{setTarget(null);setError('');}}><div className="editor-form"><strong>{target.name}</strong><p>{t(target.isActive?'Текущие сеансы будут завершены. Задачи сохранятся: при необходимости переназначьте их.':'Сотрудник сможет снова войти со своим паролем.')}</p>{error&&<p className="form-error" role="alert">{t(error)}</p>}<button className="button primary" disabled={busy} onClick={changeAccess}>{t('Подтвердить')}</button></div></ModalShell>}
 </div>;
}
