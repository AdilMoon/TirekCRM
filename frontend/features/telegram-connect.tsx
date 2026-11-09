'use client';
import {useEffect,useState} from 'react';
import type {TelegramConnection} from '@tirek/contracts';
import {api} from '../lib/api';
import {useI18n} from '../i18n/provider';
import {ModalShell} from '../components/ui';
export function TelegramConnect(){
 const {t,language,formatDate}=useI18n();const [open,setOpen]=useState(false),[data,setData]=useState<TelegramConnection|null>(null),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[agreed,setAgreed]=useState(false);
 async function load(){setData(await api<TelegramConnection>('/telegram'));}
 useEffect(()=>{if(!open)return;void load().catch(e=>setError(e.message));},[open]);
 useEffect(()=>{if(!open||!data?.pending)return;const timer=setInterval(()=>{void load().catch(e=>setError(e.message));},5000);return()=>clearInterval(timer);},[open,data?.pending?.id]);
 async function action(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);await load().catch(()=>{});}finally{setBusy(false);}}
 return <><section className="panel telegram-panel"><div><h2>Telegram</h2><p>{t('Задачи и фото результата в личном чате с ботом')}</p></div><button className="button secondary" onClick={()=>{setOpen(true);setError('');setAgreed(false);}}>{t('Настроить Telegram')}</button></section>
 {open&&<ModalShell title={t('Подключение Telegram')} busy={busy} onClose={()=>{setOpen(false);setUrl('');setAgreed(false);}}>
  {error&&<p role="alert" className="form-error">{t(error)} <button className="text-button" disabled={busy} onClick={()=>load().then(()=>setError('')).catch(e=>setError(e.message))}>{t('Обновить')}</button></p>}
  {!data&&!error&&<p role="status">{t('Загрузка…')}</p>}
  {data&&<div className="editor-form">
   {!data.enabled&&<p className="form-note">{t('Telegram-бот пока не настроен')}</p>}
   {data.botUsername&&<p>{t('Бот')}: <a href={'https://t.me/'+data.botUsername} target="_blank" rel="noreferrer">@{data.botUsername}</a></p>}
   {!data.eligible?<p className="form-note">{t('Подключение Telegram доступно в аккаунте сотрудника')}</p>:<>
    <p className="form-note">{t('После подключения бот получает названия, описания и время назначенных вам задач. Фото сохраняются в CRM приватно. Подключайте только свой Telegram.')}</p>
    {data.linked?<><p role="status" className="telegram-success">{t('Telegram подключён')}: {data.linked.displayName}{data.linked.username&&' · @'+data.linked.username}</p><p>{t('В боте отправьте /tasks, откройте задачу и нажмите «Фото результата».')}</p><button className="button secondary" disabled={busy} onClick={()=>action(async()=>{await api('/telegram',{method:'DELETE'});setUrl('');setAgreed(false);})}>{t('Отключить Telegram')}</button></>:<>
     <button className="button primary" disabled={busy||!data.enabled} onClick={()=>action(async()=>{setUrl('');setAgreed(false);const pair=await api<{url:string}>('/telegram/pair',{method:'POST',body:JSON.stringify({locale:language})});setUrl(pair.url);})}>{t(data.pending?'Создать новую ссылку подключения':'Создать ссылку подключения')}</button>
     {url&&<a className="button secondary" href={url} target="_blank" rel="noreferrer">{t('Открыть бота и нажать Start')}</a>}
     {data.pending&&<><p className="form-note">{t('Ссылка действует до {0}. Новая ссылка отключает предыдущую.',formatDate(data.pending.expiresAt,{hour:'2-digit',minute:'2-digit'}))}</p>
      {data.pending.claimed?<><p><strong>{t('Проверьте Telegram-профиль')}</strong><br/>{data.pending.displayName}{data.pending.username&&' · @'+data.pending.username}</p><label className="telegram-consent"><input type="checkbox" checked={agreed} disabled={busy} onChange={e=>setAgreed(e.target.checked)}/>{t('Это мой Telegram. Разрешаю присылать мне рабочие задачи.')}</label><button className="button primary" disabled={busy||!agreed} onClick={()=>action(async()=>{await api('/telegram/confirm',{method:'POST',body:JSON.stringify({pairingId:data.pending!.id,locale:language})});setUrl('');setAgreed(false);})}>{t('Подтвердить подключение')}</button></>:<p>{t('Откройте личную ссылку, нажмите Start в Telegram и обновите состояние здесь.')}</p>}
      <button className="text-button" disabled={busy} onClick={()=>action(async()=>{await load();})}>{t('Обновить состояние')}</button>
     </>}
    </>}
   </>}
  </div>}
 </ModalShell>}
 </>;
}
