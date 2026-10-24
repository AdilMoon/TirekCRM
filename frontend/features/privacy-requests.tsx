'use client';
import {useState} from 'react';
import {privacyKindLabels,privacyStatusLabels,type PrivacyRequestSummary} from '@tirek/contracts';
import {useI18n} from '../i18n/provider';
import {usePage} from '../lib/use-page';
import {Empty,SearchBox} from '../components/ui';
import {Pagination} from '../components/pagination';
import {PrivacyRequestForm,PrivacyRequestDialog} from './privacy-request-forms';

export function PrivacyRequests(){
 const {t,formatDate}=useI18n();
 const [q,setQ]=useState(''),[status,setStatus]=useState(''),[overdue,setOverdue]=useState(false),[page,setPage]=useState(1);
 const [create,setCreate]=useState(false),[selected,setSelected]=useState<string|null>(null),[revision,setRevision]=useState(0);
 const query=new URLSearchParams({q,page:String(page),pageSize:'5',overdue:String(overdue),...(status?{status}:{})}).toString();
 const list=usePage<PrivacyRequestSummary>('/privacy-requests',query,revision);
 const refresh=()=>setRevision(n=>n+1);
 return <section className="panel privacy-requests" aria-label={t('Обращения по персональным данным')}>
  <div className="panel-heading"><div><h2>{t('Обращения по персональным данным')}</h2><p>{t('Учёт запросов, сроков и результатов обработки')}</p></div><button className="button primary" onClick={()=>setCreate(true)}>{t('Зарегистрировать обращение')}</button></div>
  <p className="privacy-note">{t('Реестр не удаляет и не раскрывает данные. Перед исполнением проверьте личность заявителя, его полномочия и основание запроса.')}</p>
  <div className="privacy-filters"><SearchBox value={q} setValue={v=>{setQ(v);setPage(1);}} placeholder={t('Поиск по имени заявителя')}/>
   <label>{t('Статус обращения')}<select aria-label={t('Статус обращения')} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">{t('Все статусы')}</option>{Object.entries(privacyStatusLabels).map(([key,label])=><option value={key} key={key}>{t(label)}</option>)}</select></label>
   <label className="check-label"><input type="checkbox" checked={overdue} onChange={e=>{setOverdue(e.target.checked);setPage(1);}}/>{t('Только просроченные обращения')}</label><button className="button secondary" onClick={refresh}>{t('Обновить')}</button>
  </div>
  {list.error&&<p className="alert" role="alert">{t(list.error)}</p>}
  <div className="privacy-cards" aria-busy={list.busy}>{list.result?.items.map(row=><article key={row.id} className="privacy-card">
   <div><strong>{row.subjectName}</strong><span>{t(privacyKindLabels[row.kind])}</span></div>
   <p>{t(privacyStatusLabels[row.status])}{row.overdue&&<strong className="privacy-overdue"> · {t('Срок обращения истёк')}</strong>}</p>
   <p>{t('Получено')}: {formatDate(row.receivedOn,{day:'numeric',month:'short',year:'numeric'})} · {t('Срок ответа')}: {row.dueOn?formatDate(row.dueOn,{day:'numeric',month:'short',year:'numeric'}):t('Срок не указан')}</p>
   <button className="button secondary" onClick={()=>setSelected(row.id)}>{t('Открыть обращение')}</button>
  </article>)}</div>
  {list.busy&&<Empty>{t('Загрузка…')}</Empty>}{!list.busy&&!list.error&&!list.result?.items.length&&<Empty>{t('Обращения с выбранными фильтрами не найдены')}</Empty>}
  <Pagination result={list.result} page={page} setPage={setPage} busy={list.busy}/>
  {create&&<PrivacyRequestForm onClose={()=>{setCreate(false);refresh();}} onSaved={id=>{setCreate(false);setPage(1);refresh();setSelected(id);}}/>}
  {selected&&<PrivacyRequestDialog id={selected} onClose={()=>{setSelected(null);refresh();}} onSaved={refresh}/>}
 </section>;
}
