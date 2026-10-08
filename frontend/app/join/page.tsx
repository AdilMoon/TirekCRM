'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Brand } from '../../components/ui';
import { useI18n, LanguageSwitcher } from '../../i18n/provider';
import { api } from '../../lib/api';
type Preview={name:string;email:string;organization:string;expiresAt:string};
export default function Join() {
 const {t}=useI18n();const [token,setToken]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 useEffect(()=>{const value=new URLSearchParams(window.location.hash.slice(1)).get('token')??'';setToken(value);if(!/^[a-f0-9]{64}$/.test(value)){setError('Приглашение недействительно или истекло');return;}api<Preview>('/team/invitations/preview',{method:'POST',body:JSON.stringify({token:value})}).then(setPreview).catch(e=>setError(e.message));},[]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('password')!==f.get('confirm')){setError('Пароли не совпадают');return;}setBusy(true);setError('');try{await api('/team/invitations/accept',{method:'POST',body:JSON.stringify({token,password:f.get('password')})});history.replaceState(null,'','/join');setToken('');setDone(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="join-shell"><header><Brand/><LanguageSwitcher/></header><section className="panel join-card"><h1>{t(done?'Добро пожаловать в команду':'Присоединиться к команде')}</h1>
 {done?<><p>{t('Аккаунт создан. Войдите с вашим email и новым паролем.')}</p><strong>{preview?.email}</strong><a className="button primary" href={'/?email='+encodeURIComponent(preview?.email??'')}>{t('Перейти ко входу')}</a></>:preview?<form className="editor-form" onSubmit={submit}><p>{preview.organization} · {preview.name}</p><strong>{preview.email}</strong><label>{t('Новый пароль')}<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><label>{t('Повторите пароль')}<input type="password" name="confirm" required minLength={12} maxLength={128} autoComplete="new-password"/></label><p className="form-note">{t('Используйте не менее 12 символов. Доступ будет предоставлен к назначенным вам задачам.')}</p><button className="button primary" disabled={busy}>{t('Принять приглашение')}</button></form>:!error&&<p>{t('Загрузка…')}</p>}
 {error&&<p className="form-error" role="alert">{t(error)}</p>}</section></div>;
}
