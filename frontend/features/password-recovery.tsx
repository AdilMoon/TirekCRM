'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Brand, Field } from '../components/ui';
import { LanguageSwitcher, useI18n } from '../i18n/provider';
import { api } from '../lib/api';

type Availability = 'loading' | 'ready' | 'disabled' | 'error';
export function PasswordRecovery() {
  const {t} = useI18n();
  const token = useRef('');
  const [availability, setAvailability] = useState<Availability>('loading');
  const [confirming, setConfirming] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // A fragment stays out of HTTP requests. Remove it from browser history immediately.
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (value !== null) {
      window.history.replaceState(null, '', window.location.pathname);
      if (/^[a-f0-9]{64}$/i.test(value)) { token.current = value; setConfirming(true); }
      else setError('Токен восстановления недействителен или истёк');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setAvailability('loading');
    api<{enabled:boolean}>('/auth/password-reset/status', {signal:controller.signal})
      .then(result => {if (!controller.signal.aborted) setAvailability(result.enabled ? 'ready' : 'disabled');})
      .catch(e => {if (!controller.signal.aborted) {setAvailability('error'); setError(e.message);}});
    return () => controller.abort();
  }, [attempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || availability !== 'ready') return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setError('');
    if (confirming && values.get('password') !== values.get('confirm')) {
      setError('Пароли не совпадают'); return;
    }
    setBusy(true);
    try {
      if (confirming) {
        await api('/auth/password-reset/confirm', {method:'POST', body:JSON.stringify({
          token:token.current, newPassword:values.get('password'),
        })});
        token.current = '';
        form.reset();
        setDone(true);
      } else {
        await api('/auth/password-reset/request', {method:'POST', body:JSON.stringify({email:values.get('email')})});
        form.reset();
        setSent(true);
      }
    } catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }

  return <div className="register-shell">
    <header><a href="/" aria-label={t('Перейти ко входу')}><Brand/></a><LanguageSwitcher/></header>
    <main className="panel register-card">
      <h1>{t(done ? 'Пароль обновлён' : confirming ? 'Новый пароль' : 'Восстановить доступ')}</h1>
      {availability === 'loading' && <p role="status">{t('Загрузка…')}</p>}
      {availability === 'disabled' && <p role="status">{t('Восстановление пароля сейчас недоступно')}</p>}
      {done && <p role="status">{t('Войдите с новым паролем. Предыдущие сеансы завершены.')}</p>}
      {sent && <p role="status">{t('Если активный аккаунт с такой почтой существует, мы отправим ссылку. Проверьте входящие и спам. Ссылка действует 15 минут.')}</p>}
      {availability === 'ready' && !done && !sent && <form className="editor-form" onSubmit={submit}>
        {confirming ? <>
          <p>{t('Используйте от 12 до 128 символов.')}</p>
          <Field label={t('Новый пароль')} name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/>
          <Field label={t('Повторите пароль')} name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/>
        </> : <Field label="Email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy}/>}
        <button type="submit" className="button primary" disabled={busy}>{t(busy ? 'Подождите…' : confirming ? 'Сохранить новый пароль' : 'Отправить ссылку')}</button>
      </form>}
      {error && <p className="form-error" role="alert">{t(error)}</p>}
      {availability === 'error' && <button className="button secondary" onClick={()=>{setError('');setAttempt(v=>v+1);}}>{t('Повторить запрос')}</button>}
      {confirming && !done && <a href="/reset-password">{t('Запросить новую ссылку')}</a>}
      <p><a href="/">{t('Перейти ко входу')}</a></p>
    </main>
  </div>;
}
