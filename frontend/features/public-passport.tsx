'use client';
import {useEffect,useState} from 'react';
import {CheckCircle2,RefreshCw,Clock3,ShieldCheck} from 'lucide-react';
import {stageLabels,type OrderPassport} from '@tirek/contracts';
import {Brand} from '../components/ui';
import {useI18n,LanguageSwitcher} from '../i18n/provider';
import {api} from '../lib/api';
export function PublicPassport(){
 const {t,dateLabel,formatDate}=useI18n();
 const [token,setToken]=useState<string|null>(null),[data,setData]=useState<OrderPassport|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[agreed,setAgreed]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{function read(){setData(null);setAgreed(false);setToken(new URLSearchParams(location.hash.slice(1)).get('token')??'');}read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);},[]);
 useEffect(()=>{let current=true;setData(null);setError('');setAgreed(false);if(token===null)return;
  if(!/^[a-f0-9]{64}$/.test(token)){setBusy(false);setError('Ссылка недоступна или срок истёк');return;}
  setBusy(true);api<OrderPassport>('/passport/read',{method:'POST',body:JSON.stringify({token})}).then(v=>{if(current)setData(v);}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setBusy(false);});return()=>{current=false;};
 },[token,attempt]);
 async function confirm(){if(!data||!agreed||!token)return;setBusy(true);setError('');try{
  await api('/passport/confirm',{method:'POST',body:JSON.stringify({token,orderVersion:data.orderVersion,revision:data.revision})});
  setData(await api<OrderPassport>('/passport/read',{method:'POST',body:JSON.stringify({token})}));setAgreed(false);
 }catch(e){setData(null);setError((e as Error).message);}finally{setBusy(false);}}
 const steps=['NEW','CONFIRMED','IN_PROGRESS','COMPLETED'] as const;
 return <div className="public-passport"><header><Brand/><LanguageSwitcher/></header><main>
  <p className="eyebrow">{t('ПАСПОРТ ВАШЕГО ЗАКАЗА')}</p>
  {error&&<div className="alert" role="alert">{t(error)}<button onClick={()=>setAttempt(v=>v+1)} disabled={busy}>{t('Обновить')}</button></div>}
  {busy&&!data&&<p role="status">{t('Загрузка…')}</p>}
  {data&&<>
   <div className="passport-public-heading"><div><span className="subtle-pill">{data.companyName} · {t('Заказ №')} {data.number}</span><h1>{data.title}</h1><p><Clock3 size={17}/>{t('Срок выполнения')}: {dateLabel(data.dueDate)}</p></div><button className="button secondary" disabled={busy} onClick={()=>setAttempt(v=>v+1)}><RefreshCw size={16}/>{t('Обновить')}</button></div>
   <section className="panel passport-progress" aria-label={t('Ход выполнения заказа')}>
    {data.status==='CANCELLED'?<p>{t('Заказ отменён')}</p>:<ol>{steps.map((s,i)=><li key={s} className={i<=steps.indexOf(data.status as typeof steps[number])?'reached':''} aria-current={s===data.status?'step':undefined}><span>{i+1}</span><strong>{t(stageLabels[s])}</strong></li>)}</ol>}
   </section>
   <section className="panel passport-results"><h2>{t('Фото до и после')}</h2>{data.photos.length?<div className="passport-photos">{data.photos.map(photo=><figure key={photo.id}><img src={photo.image} alt={t(photo.phase==='BEFORE'?'До выполнения':'После выполнения')}/><figcaption>{t(photo.phase==='BEFORE'?'До выполнения':'После выполнения')}</figcaption></figure>)}</div>:<p>{t('Компания пока не опубликовала фотографии.')}</p>}</section>
   <section className="panel passport-confirm"><ShieldCheck size={28}/><h2>{t('Подтверждение результата')}</h2>
    {data.confirmedAt?<p className="passport-accepted" role="status"><CheckCircle2 size={20}/>{t('Вы подтвердили выполнение')} · {formatDate(data.confirmedAt,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}</p>:data.status==='COMPLETED'?<><label className="passport-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} disabled={busy}/>{t('Я ознакомился с результатом и подтверждаю выполнение работы')}</label><button className="button primary" disabled={!agreed||busy} onClick={confirm}>{t('Подтвердить выполнение')}</button></>:<p>{t('Подтверждение станет доступно после завершения работы компанией.')}</p>}
    <p className="form-note">{t('Это отметка по ссылке, а не электронная подпись или подтверждение оплаты.')}</p>
   </section>
  </>}
 </main><footer>{t('Tirek · опора вашего бизнеса')}</footer></div>;
}
