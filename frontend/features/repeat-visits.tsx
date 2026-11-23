'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {OrderProfitability} from '@tirek/contracts';
import {useI18n} from '../i18n/provider';
import {api} from '../lib/api';
import type {TeamData} from './team';

export function RepeatVisits({record,open,refresh}:{record:OrderProfitability;open:(id:string)=>void;refresh:()=>void}) {
  const {t,formatMoney}=useI18n();
  const [team,setTeam]=useState<TeamData|null>(null),[editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const key=useRef('');
  useEffect(()=>{
    if(!editing) return;
    const controller=new AbortController();
    api<TeamData>('/team',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setTeam(data);})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[editing]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;
    const values=new FormData(event.currentTarget);
    if(!key.current)key.current=crypto.randomUUID();
    setBusy(true);setError('');
    try{
      await api('/orders/'+record.id+'/repeat-visits',{method:'POST',body:JSON.stringify({
        reason:values.get('reason'),assigneeId:values.get('assigneeId'),idempotencyKey:key.current,
      })});
      key.current='';setEditing(false);refresh();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  if(record.repeatOfId) return <div className="panel">
    <p>{t('Стоимость этого бесплатного выезда включена в исходный заказ.')}</p>
    <button className="button secondary" onClick={()=>open(record.repeatOfId!)}>{t('Исходный заказ')}</button>
  </div>;
  return <section className="panel receipt-panel" aria-label={t('Повторные выезды')}>
    <h3>{t('Повторные выезды')}</h3>
    {record.repeatVisits.map(visit=><article key={visit.id} className="receipt-item">
      <strong>{visit.title}</strong><p>{visit.reason}</p>
      <p>{t('Факт: {0} · прогноз: {1}',visit.actualCost===null?t('Недостаточно данных'):formatMoney(visit.actualCost),
        visit.forecastCost===null?t('Недостаточно данных'):formatMoney(visit.forecastCost))}</p>
      <button className="button secondary" onClick={()=>open(visit.id)}>{t('Открыть выезд')}</button>
    </article>)}
    {record.status==='COMPLETED'&&!editing&&<button className="button secondary" onClick={()=>setEditing(true)}>{t('Назначить повторный выезд')}</button>}
    {record.status!=='COMPLETED'&&!record.repeatVisits.length&&<p className="muted">{t('Повторный выезд назначается после завершения исходного заказа.')}</p>}
    {error&&<p role="alert" className="form-error">{t(error)}</p>}
    {editing&&<form className="editor-form" onSubmit={submit}>
      <label>{t('Причина повторного выезда')}<textarea name="reason" minLength={3} maxLength={1000} required disabled={busy}/></label>
      <label>{t('Исполнитель')}<select aria-label={t('Исполнитель')} name="assigneeId" required disabled={busy||!team}>
        <option value="">{t('Выберите исполнителя')}</option>
        {team?.members.filter(member=>member.isActive).map(member=><option key={member.id} value={member.id}>{member.name}</option>)}
      </select></label>
      <p>{t('Часы, чеки и материалы записывайте на новый выезд. Его затраты автоматически попадут в исходный заказ.')}</p>
      <button className="button primary" disabled={busy||!team}>{t('Создать выезд и задачу')}</button>
    </form>}
  </section>;
}
