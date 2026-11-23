'use client';
import {useEffect,useState,type FormEvent} from 'react';
import type {OrderAcceptance} from '@tirek/contracts';
import {ModalShell,Field} from '../components/ui';
import {useI18n} from '../i18n/provider';
import {api} from '../lib/api';

export function OrderAcceptancePanel({orderId,close}:{orderId:string;close:()=>void}) {
  const {t}=useI18n();
  const [record,setRecord]=useState<OrderAcceptance|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const path='/orders/'+orderId+'/acceptance';
  useEffect(()=>{
    const controller=new AbortController();
    api<OrderAcceptance>(path,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted) setRecord(data);
    }).catch(e=>{if(!controller.signal.aborted) setError(e.message);});
    return()=>controller.abort();
  },[path,attempt]);
  async function save(method:string,body:unknown) {
    if(busy) return false;
    setBusy(true);setError('');
    try {setRecord(await api<OrderAcceptance>(path,{method,body:JSON.stringify(body)}));return true;}
    catch(e){setError((e as Error).message);return false;}
    finally {setBusy(false);}
  }
  async function add(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!record) return;
    const form=event.currentTarget,values=new FormData(form);
    const saved=await save('PUT',{version:record.version,items:[...record.items.map(({id,label,required})=>({id,label,required})),
      {id:crypto.randomUUID(),label:values.get('label'),required:values.get('required')==='on'}]});
    if(saved) form.reset();
  }
  return <ModalShell title={t('Приёмка работ')} onClose={close} busy={busy}>
    <p>{t('Обязательные пункты должны быть выполнены перед завершением задачи и заказа.')}</p>
    {error&&<p role="alert" className="form-error">{t(error)} <button onClick={()=>{setError('');setAttempt(v=>v+1);}}>{t('Обновить')}</button></p>}
    {!record&&<p role="status">{t('Загрузка…')}</p>}
    {record&&<>
      {!record.items.length&&<p>{t('Пункты приёмки пока не заданы')}</p>}
      <div className="editor-form">{record.items.map(item=><div key={item.id} className="panel">
        <label><input type="checkbox" checked={item.checked} disabled={busy||!record.canCheck}
          onChange={e=>save('PATCH',{version:record.version,itemId:item.id,checked:e.target.checked})}/>
          {item.label}{item.required?' *':''}</label>
        {item.checkedBy&&<p className="muted">{t('Отметил: {0}',item.checkedBy)}</p>}
        {record.canConfigure&&<button className="text-button" disabled={busy} onClick={()=>save('PUT',{version:record.version,
          items:record.items.filter(row=>row.id!==item.id).map(({id,label,required})=>({id,label,required}))})}>{t('Удалить пункт')}</button>}
      </div>)}</div>
      {record.canConfigure&&record.items.length<30&&<form className="editor-form" onSubmit={add}>
        <Field label={t('Новый пункт приёмки')} name="label" required maxLength={200} disabled={busy}/>
        <label><input type="checkbox" name="required" defaultChecked disabled={busy}/>{t('Обязательный пункт')}</label>
        <button className="button secondary" disabled={busy}>{t('Добавить пункт')}</button>
      </form>}
    </>}
  </ModalShell>;
}
