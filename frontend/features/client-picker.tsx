'use client';
import { useState } from 'react';
import type { Client, ClientInput } from '@tirek/contracts';
import { useI18n } from '../i18n/provider';
import { usePage } from '../lib/use-page';
import { Pagination } from '../components/pagination';
export function ClientPicker({initial,disabled=false}:{initial?:ClientInput&{id:string};disabled?:boolean}) {
 const {t}=useI18n();
 const [q,setQ]=useState(''),[page,setPage]=useState(1);
 const [selected,setSelected]=useState(initial);
 const {result,error,busy,retry}=usePage<Client>('/clients/search',new URLSearchParams({q,page:String(page)}).toString());
 const options=result?.items??[];
 const items=selected&&!options.some(c=>c.id===selected.id)?[selected,...options]:options;
 return <div className="client-picker">
  {!disabled&&<label>{t('Поиск клиента по всей базе')}<input value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder={t('Имя, компания или телефон')}/></label>}
  <label>{t('Клиент *')}<select name="clientId" required disabled={disabled} value={selected?.id??''} onChange={e=>setSelected(items.find(c=>c.id===e.target.value))}>
   <option value="" disabled>{t('Выберите клиента')}</option>{items.map(c=><option key={c.id} value={c.id}>{c.name}{c.company?' · '+c.company:''}</option>)}
  </select></label>
  {error&&<div className="form-error" role="alert">{t(error)}<button type="button" onClick={retry}>{t('Обновить')}</button></div>}
  {!disabled&&result&&result.pages>1&&<Pagination result={result} page={page} setPage={setPage} busy={busy}/>}
 </div>;
}
