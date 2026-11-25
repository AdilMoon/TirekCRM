'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {ObjectBindInput,ServiceDecisionInput,ServiceObjectContext,ServiceObjectItem,ServiceRequestItem} from '@tirek/contracts';
import {ModalShell,Status,SearchBox} from '../components/ui';
import {Pagination} from '../components/pagination';
import {useI18n} from '../i18n/provider';
import {usePage} from '../lib/use-page';
import {api} from '../lib/api';

export function ServiceObjectPanel({id,close,onSelect}:{id:string;close:()=>void;onSelect?:(id:string)=>void|Promise<void>}){
 const {t,formatDate}=useI18n();
 const [data,setData]=useState<ServiceObjectContext|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0),[historyPage,setHistoryPage]=useState(1),[requestPage,setRequestPage]=useState(1);
 const [name,setName]=useState(''),[address,setAddress]=useState(''),[mode,setMode]=useState('CREATE'),[uncertain,setUncertain]=useState(false);
 const pending=useRef<ObjectBindInput|null>(null);
 const path='/orders/'+id+'/service-object';
 useEffect(()=>{let current=true;setData(null);setError('');api<ServiceObjectContext>(path+'?'+new URLSearchParams({historyPage:String(historyPage),requestPage:String(requestPage)}))
  .then(value=>{if(current)setData(value);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[path,attempt,historyPage,requestPage]);
 async function action(fn:()=>Promise<unknown>,message:string){
  setBusy(true);setError('');setNotice('');
  try{await fn();setNotice(message);setAttempt(n=>n+1);return true;}
  catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}
 }
 const openOrder=onSelect?(orderId:string)=>{void action(async()=>{await onSelect(orderId);},'');}:undefined;
 async function bind(input:ObjectBindInput){
  if(!pending.current)pending.current=input;
  await action(async()=>{
   try{await api(path,{method:'PUT',body:JSON.stringify(pending.current)});pending.current=null;setUncertain(false);}
   catch(e){const status=(e as Error&{status?:number}).status;if(!status||status>=500)setUncertain(true);else if(!uncertain)pending.current=null;throw e;}
  },'Объект связан с заказом');
 }
 function create(e:FormEvent){e.preventDefault();if(data)void bind({kind:'CREATE',name:name.trim(),address:address.trim(),creationKey:crypto.randomUUID(),orderVersion:data.orderVersion});}
 return <ModalShell title={t('Объект и история обслуживания')} onClose={close} busy={busy} className="service-object-modal">
  {error&&<p className="form-error" role="alert">{t(error)}</p>}
  {notice&&<p role="status" className="task-notice">{t(notice)}</p>}
  <button className="button secondary" disabled={busy} onClick={()=>setAttempt(n=>n+1)}>{t('Обновить')}</button>
  {!data?(!error&&<p role="status">{t('Загрузка…')}</p>):!data.object?<>
   <p className="form-note">{t('Объект пока не указан. Он объединит заказы и повторные выезды одного клиента.')}</p>
   {data.canManage&&<>
    <p className="form-note">{t('После привязки выпустите новую ссылку QR-паспорта. Прежние ссылки заказа и его повторных выездов будут отозваны.')}</p>
    <p className="form-note">{t('Проверьте выбор: смена объекта и клиента связанного заказа пока недоступна.')}</p>
    <label>{t('Способ привязки')}<select aria-label={t('Способ привязки')} disabled={busy||uncertain} value={mode} onChange={e=>setMode(e.target.value)}><option value="CREATE">{t('Создать объект')}</option><option value="LINK">{t('Выбрать объект клиента')}</option></select></label>
    {uncertain&&<p className="alert">{t('Результат отправки неизвестен. Повторите операцию с теми же данными.')}</p>}
    {mode==='CREATE'?<form className="editor-form service-object-form" onSubmit={create}>
     <label>{t('Название объекта')}<input required maxLength={160} value={name} disabled={busy||uncertain} onChange={e=>setName(e.target.value)}/></label>
     <label>{t('Адрес объекта')}<input maxLength={300} value={address} disabled={busy||uncertain} onChange={e=>setAddress(e.target.value)}/></label>
     <button className="button primary" disabled={busy||!name.trim()}>{t(uncertain?'Повторить операцию':'Создать и связать объект')}</button>
    </form>:<ObjectChoices id={id} busy={busy||uncertain} choose={object=>bind({kind:'LINK',objectId:object.id,orderVersion:data.orderVersion})}/>}
   </>}
  </>:<>
   <div className="service-object-heading"><span className="eyebrow">{t('Объект обслуживания')}</span><h3>{data.object.name}</h3>{data.object.address&&<p>{data.object.address}</p>}</div>
   {data.requests&&<section className="service-object-section" aria-label={t('Обращения по объекту')}><h3>{t('Обращения по объекту')}</h3>
    {!data.requests.total&&<p className="form-note">{t('Новых обращений пока нет. Клиент сможет отправить запрос из QR-паспорта завершённого заказа.')}</p>}
    {data.requests.items.map(request=><RequestDecision key={request.id+':'+request.version} request={request} busy={busy} decide={input=>action(()=>api('/orders/'+id+'/service-requests/'+request.id+'/decision',{method:'POST',body:JSON.stringify(input)}),'Обращение рассмотрено')} onSelect={openOrder}/>)}
    <Pagination result={data.requests} page={requestPage} setPage={setRequestPage} busy={busy}/>
   </section>}
   <section className="service-object-section" aria-label={t('История обслуживания')}><h3>{t('История обслуживания')}</h3>
    {!data.canManage&&<p className="form-note">{t('Исполнителю показаны завершённые работы по назначенному объекту.')}</p>}
    <div className="service-history">{data.history.items.map(order=><article key={order.id}>
     <div><strong>{t('Заказ № {0}',order.number)} · {order.title}</strong><small>{formatDate(order.createdAt)}{order.repeatOfId&&' · '+t('Повторный выезд')}</small></div>
     <Status status={order.status}/>{data.canManage&&openOrder&&<button className="button secondary" disabled={busy} onClick={()=>openOrder(order.id)}>{t('Открыть заказ')}</button>}
    </article>)}</div>
    {!data.history.total&&<p className="form-note">{t('История пока пуста')}</p>}
    <Pagination result={data.history} page={historyPage} setPage={setHistoryPage} busy={busy}/>
   </section>
  </>}
 </ModalShell>;
}
function ObjectChoices({id,busy,choose}:{id:string;busy:boolean;choose:(object:ServiceObjectItem)=>Promise<void>}){
 const {t}=useI18n();const [q,setQ]=useState(''),[page,setPage]=useState(1);
 const list=usePage<ServiceObjectItem>('/orders/'+id+'/service-objects',new URLSearchParams({q,page:String(page)}).toString());
 return <div className="service-object-form"><SearchBox value={q} setValue={value=>{setQ(value);setPage(1);}} placeholder={t('Название или адрес объекта')}/>
  {list.error&&<p role="alert" className="form-error">{t(list.error)} <button disabled={busy} onClick={list.retry}>{t('Обновить')}</button></p>}
  {list.busy&&<p role="status">{t('Загрузка…')}</p>}
  {list.result?.items.map(object=><article className="service-choice" key={object.id}><div><strong>{object.name}</strong><small>{object.address}</small></div><button className="button secondary" disabled={busy||list.busy} onClick={()=>choose(object)}>{t('Связать с заказом')}</button></article>)}
  {list.result?.total===0&&<p>{t('Объектов этого клиента не найдено')}</p>}
  <Pagination result={list.result} page={page} setPage={setPage} busy={busy||list.busy}/>
 </div>;
}
function RequestDecision({request,busy,decide,onSelect}:{request:ServiceRequestItem;busy:boolean;decide:(input:ServiceDecisionInput)=>Promise<boolean>;onSelect?: (id:string)=>void}){
 const {t,formatDate}=useI18n();const [title,setTitle]=useState(''),[price,setPrice]=useState(''),[note,setNote]=useState('');
 const [uncertain,setUncertain]=useState(false);const pending=useRef<ServiceDecisionInput|null>(null);
 async function send(input:ServiceDecisionInput){if(!pending.current)pending.current=input;setUncertain(true);if(await decide(pending.current)){pending.current=null;setUncertain(false);}}
 return <article className="service-request"><header><strong>{t(request.status==='NEW'?'Новое обращение':request.status==='CONVERTED'?'Создан заказ':'Обращение отклонено')}</strong><small>{formatDate(request.createdAt)} · {t('Заказ № {0}',request.sourceNumber)}</small></header>
  <p className="service-request-description">{request.description}</p>
  {request.status==='NEW'?<form className="editor-form" onSubmit={e=>{e.preventDefault();void send({status:'CONVERTED',version:request.version,title:title.trim(),price});}}>
   {uncertain&&<p className="form-note">{t('Для повтора используется первоначальное решение. После ошибки можно обновить список.')}</p>}
   <label>{t('Название нового заказа')}<input required maxLength={200} value={title} disabled={busy||uncertain} onChange={e=>setTitle(e.target.value)}/></label>
   <label>{t('Стоимость работ, ₸')}<input required type="number" min="0.01" max="999999999999.99" step="0.01" value={price} disabled={busy||uncertain} onChange={e=>setPrice(e.target.value)}/></label>
   <p className="form-note">{t('Создаётся новый платный заказ с одной услугой. Условия можно уточнить и согласовать с клиентом через смету.')}</p>
   <div className="form-actions"><button type={uncertain?'button':'submit'} className="button primary" disabled={busy||(!uncertain&&(!title.trim()||!price))} onClick={()=>{if(uncertain&&pending.current)void send(pending.current);}}>{t(uncertain?'Повторить операцию':'Создать заказ из обращения')}</button></div>
   <label>{t('Внутренняя причина отказа')}<input maxLength={300} value={note} disabled={busy||uncertain} onChange={e=>setNote(e.target.value)}/></label>
   {!uncertain&&<button type="button" className="button secondary" disabled={busy} onClick={()=>send({status:'DECLINED',version:request.version,note:note.trim()})}>{t('Отклонить обращение')}</button>}
  </form>:<>{request.decisionNote&&<p>{request.decisionNote}</p>}{request.convertedOrderId&&onSelect&&<button className="button secondary" disabled={busy} onClick={()=>onSelect(request.convertedOrderId!)}>{t('Открыть заказ')} · № {request.convertedNumber}</button>}</>}
 </article>;
}
