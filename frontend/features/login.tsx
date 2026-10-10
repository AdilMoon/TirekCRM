'use client';
import { useI18n, LanguageSwitcher } from '../i18n/provider';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Check, LoaderCircle, Building2 } from 'lucide-react';

import type { RegistrationStatus } from '@tirek/contracts';
import { api } from '../lib/api';
import { Brand } from '../components/ui';
export function Login({ onLogin, initialError }: { onLogin: () => Promise<void>; initialError: string }) {
  const { t } = useI18n();

  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [registration,setRegistration]=useState(false);
  useEffect(()=>{let active=true;api<RegistrationStatus>('/onboarding/status').then(status=>{if(active)setRegistration(status.registrationEnabled);}).catch(()=>{});return()=>{active=false;};},[]);
  const [error, setError] = useState(initialError); const [busy, setBusy] = useState(false);
  useEffect(()=>{const value=new URLSearchParams(window.location.search).get('email');if(value)setEmail(value);},[]);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api('/auth/login', { method:'POST', body: JSON.stringify({ email, password }) }); await onLogin(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="login-page"><section className="login-story"><Brand /><div className="login-copy"><span className="eyebrow">{t("ДЛЯ ТЕХ, КТО СТРОИТ СВОЁ")}</span><h1>{t("Больше ясности.")}<br />{t("Больше возможностей.")}</h1><p>{t("Клиенты, заказы, документы и финансы —")}<br />{t("в одном рабочем пространстве.")}</p><div className="login-preview"><div><span className="live-dot" />{t("Рабочий день")}</div><strong>{t("Каждая деталь")}<br />{t("на своём месте.")}</strong><span className="preview-check"><Check size={18} />{t("Заказ выполнен")}</span><span className="preview-check"><Check size={18} />{t("Оплата получена")}</span></div></div><span className="login-foot">{t("Tirek · опора вашего бизнеса")}</span></section><section className="login-form-side"><div className="login-language"><LanguageSwitcher /></div><form onSubmit={submit} className="login-form"><span className="login-symbol"><Building2 size={28} /></span><h2>{t("С возвращением")}</h2><p>{t("Войдите в своё рабочее пространство.")}</p><label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>{t("Пароль")}<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder={t("Введите пароль")} /></label>{error && <div className="form-error" role="alert">{t(error)}</div>}<button className="button primary login-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <>{t("Войти в пространство")} <ArrowRight size={18} /></>}</button>{registration&&<div className="login-signup"><span>{t("Впервые в Tirek?")}</span><a href="/register">{t("Создать пространство компании")}</a></div>}</form></section></div>;
}
