'use client';
import { useEffect,useState,type FormEvent } from 'react';
import { Building2,ArrowRight,LoaderCircle } from 'lucide-react';
import type { RegistrationStatus,SessionUser } from '@tirek/contracts';
import { Brand,Field } from '../components/ui';
import { useI18n,LanguageSwitcher } from '../i18n/provider';
import { api } from '../lib/api';

type State='loading'|'ready'|'disabled'|'signed-in'|'created'|'error';
export function RegisterCompany(){
 const {t}=useI18n();
 const [state,setState]=useState<State>('loading'),[attempt,setAttempt]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;setState('loading');setError('');
  Promise.all([
   api<RegistrationStatus>('/onboarding/status'),
   api<SessionUser>('/auth/me').catch(e=>{if(e.status===401)return null;throw e;}),
  ]).then(([status,user])=>{if(active)setState(user?'signed-in':status.registrationEnabled?'ready':'disabled');})
   .catch(e=>{if(active){setError(e.message);setState('error');}});
  return()=>{active=false;};
 },[attempt]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||state!=='ready')return;
  const form=e.currentTarget,values=new FormData(form);setError('');
  if(values.get('password')!==values.get('confirm')){setError('Пароли не совпадают');return;}
  setBusy(true);
  try{
   await api('/onboarding/register',{method:'POST',body:JSON.stringify({
    companyName:values.get('companyName'),ownerName:values.get('ownerName'),email:values.get('email'),password:values.get('password'),
   })});
   form.reset();setState('created');window.location.replace('/');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="register-shell">
  <header><a href="/" aria-label={t('Перейти ко входу')}><Brand/></a><LanguageSwitcher/></header>
  <main className="panel register-card">
   <span className="login-symbol"><Building2 size={28}/></span>
   <h1>{t('Создать пространство компании')}</h1>
   {state==='loading'&&<p role="status">{t('Загрузка…')}</p>}
   {state==='ready'&&<>
    <p className="register-intro">{t('Начните с вашей компании. Клиенты, заказы и финансы будут в отдельном пространстве.')}</p>
    <form className="editor-form" onSubmit={submit}>
     <Field label={t('Название компании *')} name="companyName" autoComplete="organization" required maxLength={160} disabled={busy}/>
     <Field label={t('Ваше имя *')} name="ownerName" autoComplete="name" required maxLength={160} disabled={busy}/>
     <Field label="Email" name="email" type="email" autoComplete="username" required maxLength={254} disabled={busy}/>
     <div className="register-passwords">
      <Field label={t('Новый пароль')} name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy}/>
      <Field label={t('Повторите пароль')} name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy}/>
     </div>
     <p className="form-note">{t('Пароль — от 12 символов. Один email используется для одного аккаунта. Реквизиты компании можно заполнить после создания.')}</p>
     {error&&<p className="form-error" role="alert">{t(error)}</p>}
     <button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<ArrowRight size={18}/>} {t('Создать компанию')}</button>
    </form>
    <p className="register-help">{t('Пригласили в команду? Откройте ссылку приглашения, чтобы присоединиться к существующей компании.')}</p>
   </>}
   {state==='disabled'&&<p role="status">{t('Создание компаний сейчас недоступно')}</p>}
   {state==='signed-in'&&<><p>{t('Вы уже вошли в аккаунт. Для другой компании сначала выйдите из него.')}</p><a className="button primary" href="/">{t('Открыть пространство')}</a></>}
   {state==='created'&&<><p role="status">{t('Компания создана. Открываем ваше пространство…')}</p><a className="button primary" href="/">{t('Открыть пространство')}</a></>}
   {state==='error'&&<><p className="form-error" role="alert">{t(error)}</p><button className="button secondary" onClick={()=>setAttempt(n=>n+1)}>{t('Повторить загрузку')}</button></>}
   {state!=='signed-in'&&state!=='created'&&<a className="register-back" href="/">{t('Уже есть аккаунт? Войти')}</a>}
  </main>
 </div>;
}
