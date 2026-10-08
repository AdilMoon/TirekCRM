'use client';
import { useState } from 'react';
import { stageLabels, taskStatusLabels, type TaskStatus, type Stage } from '@tirek/contracts';
import type { AuditEvent } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';
import { usePage } from '../lib/use-page';
import { Pagination } from '../components/pagination';
const actions:Record<string,string>={TASK_CREATED:'Задача создана',TASK_UPDATED:'Задача изменена',TASK_STATUS_CHANGED:'Статус задачи обновлён',INVITATION_CREATED:'Приглашение создано',INVITATION_REVOKED:'Приглашение отозвано',MEMBER_JOINED:'Сотрудник присоединился',MEMBER_ENABLED:'Доступ сотрудника включён',MEMBER_DISABLED:'Доступ сотрудника отключён',CLIENT_CREATED:'Клиент добавлен',CLIENT_UPDATED:'Клиент обновлён',ORGANIZATION_UPDATED:'Реквизиты сохранены',ORDER_CREATED:'Заказ создан',ORDER_UPDATED:'Заказ изменён',ORDER_STATUS_CHANGED:'Статус заказа обновлён',PAYMENT_RECORDED:'Оплата записана',EXPENSE_RECORDED:'Расход записан',DOCUMENT_CREATED:'Черновик акта создан'};
const types:Record<string,string>={TASK:'Задачи',TEAM:'Команда',ORDER:'Заказы',CLIENT:'Клиенты',ORGANIZATION:'Компания',EXPENSE:'Расходы'};
export function AuditTrail({entityId,revision=0}:{entityId?:string;revision?:unknown}) {
 const {t,formatDate,formatMoney}=useI18n();
 const [page,setPage]=useState(1),[type,setType]=useState('');
 const query=new URLSearchParams({page:String(page),pageSize:'15',...(entityId?{entityType:'ORDER',entityId}:type?{entityType:type}:{})}).toString();
 const {result,busy,error,retry}=usePage<AuditEvent>('/audit',query,revision);
 return <section className="panel audit-panel" aria-busy={busy}><div className="panel-heading"><div><h2>{t('История действий')}</h2><p>{t('Кто и когда изменил данные')}</p></div>
 {!entityId&&<select aria-label={t('Раздел истории')} value={type} onChange={e=>{setType(e.target.value);setPage(1);}}><option value="">{t('Все действия')}</option>{Object.entries(types).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select>}</div>
 {error&&<div className="alert" role="alert">{t(error)}<button onClick={retry}>{t('Обновить')}</button></div>}
 <div className="audit-list">{result?.items.map(event=><article className="audit-event" key={event.id}>
 <div><strong>{t(actions[event.action]??'Изменение данных')}</strong><span>{typeof event.metadata.number==='number'?'№ '+event.metadata.number:typeof event.metadata.name==='string'?event.metadata.name:typeof event.metadata.title==='string'?event.metadata.title:t(types[event.entityType]??'Компания')}</span></div>
 <p>{event.actorName} · {formatDate(event.createdAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</p>
 {typeof event.metadata.beforeTotal==='string'&&typeof event.metadata.total==='string'&&event.metadata.beforeTotal!==event.metadata.total&&<small>{t('Стоимость: {0} → {1}',formatMoney(event.metadata.beforeTotal),formatMoney(event.metadata.total))}</small>}
 {typeof event.metadata.from==='string'&&typeof event.metadata.to==='string'&&<small>{t('Статус: {0} → {1}',t((event.entityType==='TASK'?taskStatusLabels[event.metadata.from as TaskStatus]:stageLabels[event.metadata.from as Stage])??event.metadata.from),t((event.entityType==='TASK'?taskStatusLabels[event.metadata.to as TaskStatus]:stageLabels[event.metadata.to as Stage])??event.metadata.to))}</small>}
 {typeof event.metadata.amount==='string'&&<small>{formatMoney(event.metadata.amount)}</small>}
 </article>)}</div>
 {!busy&&!error&&!result?.items.length&&<div className="empty">{t('Действий пока нет. История записывается с момента обновления системы.')}</div>}
 <Pagination result={result} page={page} setPage={setPage} busy={busy}/></section>;
}
