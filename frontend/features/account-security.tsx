'use client';
import { useEffect,useState,useRef,type FormEvent } from 'react';
import { ShieldCheck,Monitor } from 'lucide-react';
import type { AccountSession } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { Field,ModalShell } from '../components/ui';

function browserName(agent:string){
 if(agent.includes('Edg/'))return 'Microsoft Edge';
 if(agent.includes('Firefox/'))return 'Firefox';
 if(agent.includes('Chrome/'))return 'Chrome';
 if(agent.includes('Safari/'))return 'Safari';
 return '';
}
export function AccountSecurity({onSessionEnded}:{onSessionEnded:(expired:boolean)=>void}){
 const {t,formatDate}=useI18n();
 const [sessions,setSessions]=useState<AccountSession[]|null>(null);
 const [loadError,setLoadError]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[target,setTarget]=useState<AccountSession|'others'|null>(null);
 const [revokeError,setRevokeError]=useState('');
 const loadVersion=useRef(0);
 function failure(e:unknown){
  const err=e as Error&{status?:number};
  if(err.status===401)onSessionEnded(true);
  return err.message;
 }
 async function load(){
  const version=++loadVersion.current;setLoadError('');
  try{const data=await api<AccountSession[]>('/auth/sessions');if(version===loadVersion.current)setSessions(data);}catch(e){if(version===loadVersion.current)setLoadError(failure(e));}
 }
 useEffect(()=>{
  const version=++loadVersion.current;
  api<AccountSession[]>('/auth/sessions').then(data=>{if(version===loadVersion.current)setSessions(data);}).catch(e=>{if(version===loadVersion.current){setLoadError(e.message);if(e.status===401)onSessionEnded(true);}});
  return()=>{loadVersion.current++;};
  // Load once on entering this screen; callbacks from the parent are intentionally not dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function changePassword(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  const form=e.currentTarget,data=new FormData(form),currentPassword=String(data.get('currentPassword')),newPassword=String(data.get('newPassword'));
  setError('');setNotice('');
  if(newPassword!==data.get('confirmPassword')){setError('Пароли не совпадают');return;}
  setBusy(true);loadVersion.current++;
  try{
   await api('/auth/password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});
   form.reset();setNotice('Пароль изменён. Остальные сеансы завершены.');await load();
  }catch(e){setError(failure(e));}finally{setBusy(false);}
 }
 async function revoke(){
  if(!target||busy)return;setBusy(true);loadVersion.current++;setRevokeError('');setNotice('');
  try{
   if(target==='others')await api('/auth/sessions/revoke-others',{method:'POST'});
   else{
    const result=await api<{current:boolean}>('/auth/sessions/'+target.id,{method:'DELETE'});
    if(result.current){onSessionEnded(false);return;}
   }
   setTarget(null);setNotice('Выбранные сеансы завершены');await load();
  }catch(e){setRevokeError(failure(e));}finally{setBusy(false);}
 }
 function selectTarget(value:AccountSession|'others'){setRevokeError('');setTarget(value);}
 const date=(value:string)=>formatDate(value,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
 return <section className="account-security" aria-label={t('Безопасность аккаунта')}>
  <div className="security-heading"><ShieldCheck size={24}/><div><h2>{t('Безопасность аккаунта')}</h2><p>{t('Пароль и входы в ваш аккаунт')}</p></div></div>
  {notice&&<p className="security-notice" role="status">{t(notice)}</p>}
  <div className="security-grid">
   <section className="panel security-panel"><div className="panel-heading"><h3>{t('Сменить пароль')}</h3></div>
    <form className="editor-form" onSubmit={changePassword}>
     <Field label={t('Текущий пароль')} name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} disabled={busy}/>
     <Field label={t('Новый пароль')} name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy}/>
     <Field label={t('Повторите новый пароль')} name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy}/>
     <p className="form-note">{t('Не менее 12 символов. После смены пароля другие входы будут завершены, а этот браузер останется в аккаунте.')}</p>
     {error&&<p className="form-error" role="alert">{t(error)}</p>}
     <button className="button primary" disabled={busy}>{t('Сменить пароль')}</button>
    </form>
   </section>
   <section className="panel security-panel" aria-label={t('Активные сеансы')} aria-busy={busy}>
    <div className="panel-heading"><div><h3>{t('Активные сеансы')}</h3><p>{t('Входы, срок действия которых ещё не истёк')}</p></div><button className="text-button" disabled={busy} onClick={load}>{t('Обновить')}</button></div>
    {loadError&&<p className="form-error" role="alert">{t(loadError)}</p>}
    {!sessions&&!loadError&&<p>{t('Загрузка…')}</p>}
    <div className="session-list">{sessions?.map(session=><article className="session-card" key={session.id}>
     <div className="session-summary"><Monitor size={20}/><div><strong>{browserName(session.userAgent)||t('Неизвестный браузер')}</strong>{session.current&&<span className="subtle-pill">{t('Этот сеанс')}</span>}</div></div>
     <dl><div><dt>{t('Начало сеанса')}</dt><dd>{session.createdAt?date(session.createdAt):t('Время начала неизвестно')}</dd></div><div><dt>{t('Истекает')}</dt><dd>{date(session.expiresAt)}</dd></div></dl>
     <details><summary>{t('Сведения о браузере')}</summary><p>{session.userAgent||t('Данные браузера не сохранены')}</p></details>
     <button className="text-button" disabled={busy} onClick={()=>selectTarget(session)}>{t(session.current?'Выйти здесь':'Завершить')}</button>
    </article>)}</div>
    <p className="form-note">{t('Сведения о браузере передаются устройством и не подтверждают его владельца. При новом входе сохраняются до 20 последних сеансов.')}</p>
    <button className="button secondary" disabled={busy||!sessions?.some(s=>!s.current)} onClick={()=>selectTarget('others')}>{t('Завершить другие сеансы')}</button>
   </section>
  </div>
  {target&&<ModalShell title={t('Завершение сеансов')} busy={busy} onClose={()=>setTarget(null)}>
   <p>{t(target==='others'?'Все остальные входы в ваш аккаунт будут завершены.':target.current?'Вы выйдете из аккаунта в этом браузере.':'Выбранный вход будет завершён. Для продолжения потребуется войти снова.')}</p>
   {revokeError&&<p className="form-error" role="alert">{t(revokeError)}</p>}
   <div className="form-actions"><button className="button secondary" disabled={busy} onClick={()=>setTarget(null)}>{t('Отмена')}</button><button className="button primary" disabled={busy} onClick={revoke}>{t('Подтвердить')}</button></div>
  </ModalShell>}
 </section>;
}
