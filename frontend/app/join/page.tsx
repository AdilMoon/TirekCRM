'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {SessionUser} from '@tirek/contracts';
import {Brand} from '../../components/ui';
import {useI18n,LanguageSwitcher} from '../../i18n/provider';
import {api} from '../../lib/api';
type Preview={name:string;email:string;organization:string;expiresAt:string};
export default function Join(){
 const {t}=useI18n();
 const [token,setToken]=useState<string|null>(null),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[done,setDone]=useState(false),[current,setCurrent]=useState<SessionUser|null>(null);
 const [authReady,setAuthReady]=useState(false),[authError,setAuthError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{function read(){setPreview(null);setError('');setDone(false);setToken(new URLSearchParams(location.hash.slice(1)).get('token')??'');}read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);},[]);
 useEffect(()=>{let active=true;setAuthReady(false);setAuthError('');api<SessionUser>('/auth/me').then(user=>{if(active){setCurrent(user);setAuthReady(true);}}).catch(e=>{if(active){if(e.status===401){setCurrent(null);setAuthReady(true);}else setAuthError(e.message);}});return()=>{active=false;};},[attempt]);
 useEffect(()=>{let active=true;if(token===null)return;setError('');
  if(!/^[a-f0-9]{64}$/.test(token)){setError('Приглашение недействительно или истекло');return;}
  api<Preview>('/team/invitations/preview',{method:'POST',body:JSON.stringify({token})}).then(value=>{if(active)setPreview(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[token]);
 function enter(){history.replaceState(null,'','/join');setToken(null);setDone(true);location.replace('/');}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||!preview||!token||!authReady||current)return;
  const fields=new FormData(e.currentTarget);if(fields.get('password')!==fields.get('confirm')){setError('Пароли не совпадают');return;}
  setBusy(true);setError('');try{await api('/team/invitations/accept',{method:'POST',body:JSON.stringify({token,password:fields.get('password')})});enter();}
  catch(e){
   // Recover a lost response only when the expected employee session already exists.
   const session=await api<SessionUser>('/auth/me').catch(()=>null);
   if(session?.email===preview.email&&session.role==='EMPLOYEE')enter();else setError((e as Error).message);
  }finally{setBusy(false);}
 }
 async function logout(){setBusy(true);setAuthError('');try{await api('/auth/logout',{method:'POST'});setCurrent(null);setAttempt(n=>n+1);}catch(e){setAuthError((e as Error).message);}finally{setBusy(false);}}
 return <div className="join-shell"><header><Brand/><LanguageSwitcher/></header><section className="panel join-card"><h1>{t(done?'Добро пожаловать в команду':'Присоединиться к команде')}</h1>
  {done?<a className="button primary" href="/">{t('Открыть мои задачи')}</a>:<>
   {authError&&<p className="form-error" role="alert">{t(authError)} <button className="text-button" disabled={busy} onClick={()=>setAttempt(n=>n+1)}>{t('Проверить вход')}</button></p>}
   {current&&<div className="form-note"><p>{t('Сейчас выполнен вход: {0}',current.email)}</p><p>{t('Выйдите из этого аккаунта или откройте приглашение в отдельном профиле браузера.')}</p><button className="button secondary" disabled={busy} onClick={logout}>{t('Выйти и продолжить приглашение')}</button></div>}
   {preview?<form className="editor-form" onSubmit={submit}><p>{preview.organization} · {preview.name}</p><strong>{preview.email}</strong>
    <label>{t('Новый пароль')}<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy||!authReady||!!current}/></label>
    <label>{t('Повторите пароль')}<input type="password" name="confirm" required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy||!authReady||!!current}/></label>
    <p className="form-note">{t('Придумайте пароль от 12 символов. После принятия приглашения сразу откроются ваши задачи.')}</p>
    <button className="button primary" disabled={busy||!authReady||!!current}>{t('Принять приглашение и открыть задачи')}</button>
   </form>:!error&&<p role="status">{t('Загрузка…')}</p>}
  </>}
  {error&&<p className="form-error" role="alert">{t(error)}</p>}
  {error&&preview&&<a className="text-button" href={'/?email='+encodeURIComponent(preview.email)}>{t('Перейти ко входу')}</a>}
 </section></div>;
}
