'use client';
import {useI18n,LanguageSwitcher} from '../../../i18n/provider';
import {use,useEffect,useState} from 'react';
import type {DocumentSnapshot,DocumentRecord} from '@tirek/contracts';
import {api} from '../../../lib/api';
import {Printer,ArrowLeft,FileText} from 'lucide-react';
type PrintableDocument={number:number;createdAt:string;kind:DocumentRecord['kind'];snapshot:DocumentSnapshot};
export default function DocumentPage({params}:{params:Promise<{id:string}>}){
 const {t,formatDate,formatMoney}=useI18n(),{id}=use(params);
 const [doc,setDoc]=useState<PrintableDocument|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setDoc(null);setError('');api<PrintableDocument>('/documents/'+id).then(value=>{if(active)setDoc(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
 if(error)return <div className="boot"><p role="alert">{t(error)}</p><a href="/">{t('Вернуться в CRM')}</a></div>;
 if(!doc)return <div className="boot">{t('Загружаем документ…')}</div>;
 const s=doc.snapshot,invoice=doc.kind==='INVOICE_DRAFT'?s.invoice:undefined;
 function bank(details:DocumentSnapshot['organization']){
  return <>{details.bankName&&<p>{t('Банк')}: {details.bankName}</p>}{details.iban&&<p>{t('ИИК / IBAN')}: {details.iban}</p>}{details.bic&&<p>{t('БИК')}: {details.bic}</p>}</>;
 }
 return <div className="document-page"><div className="document-toolbar"><LanguageSwitcher/><a href="/" className="text-button"><ArrowLeft size={17}/>{t('В пространство')}</a><button className="button primary" onClick={()=>window.print()}><Printer size={17}/>{t('Печать / PDF')}</button></div>
 <article className="document-sheet"><div className="document-brand"><FileText size={25}/>Tirek <span>{t('Черновик · без подписи')}</span></div>
 <h1>{t(invoice?'Счёт на оплату':'Акт выполненных работ')}</h1><p>№ {String(doc.number).padStart(4,'0')} {t('от')} {formatDate(doc.createdAt,{dateStyle:'long',timeZone:'Asia/Almaty'})}</p>
 {invoice?.dueDate&&<p>{t('Оплатить до')}: {formatDate(invoice.dueDate,{dateStyle:'long'})}</p>}
 <div className="document-parties"><div><small>{t('ИСПОЛНИТЕЛЬ')}</small><h3>{s.organization.name}</h3><p>{s.organization.address||t('Адрес не указан')}</p><p>{t('ИИН/БИН:')} {s.organization.businessId||t('не указан')}</p>{bank(s.organization)}</div>
 <div><small>{t('ЗАКАЗЧИК')}</small><h3>{s.client.company||s.client.name}</h3><p>{s.client.name}</p><p>{s.client.address||t('Адрес не указан')}</p>{s.client.businessId&&<p>{t('ИИН/БИН:')} {s.client.businessId}</p>}{bank({...s.client,businessId:s.client.businessId??''})}</div></div>
 <p>{t(invoice?'Оплата по заказу №':'Работы по заказу №')} {s.orderNumber}: {s.title}.</p>
 <table><thead><tr><th>№</th><th>{t('Наименование работ / услуг')}</th><th>{t('Кол-во')}</th><th className="right">{t('Цена, ₸')}</th><th className="right">{t('Сумма, ₸')}</th></tr></thead><tbody>{s.items.map((item,i)=><tr key={i}><td>{i+1}</td><td>{item.description}</td><td>{item.quantity}</td><td className="right">{formatMoney(item.unitPrice)}</td><td className="right">{formatMoney(item.total)}</td></tr>)}</tbody></table>
 <div className="document-total">{t('Итого:')} <strong>{formatMoney(s.total)}</strong></div>
 {invoice?<><div className="invoice-totals"><p>{t('Получено на момент создания')} <strong>{formatMoney(invoice.paid)}</strong></p><p>{t('К оплате на момент создания')} <strong>{formatMoney(invoice.amountDue)}</strong></p></div>{invoice.note&&<p className="invoice-note">{invoice.note}</p>}<p>{t('Реквизиты и суммы сохранены на дату создания. Последующие оплаты отражаются в заказе; этот документ не обновляется.')}</p></>:<div className="document-signatures"><div>{t('Исполнитель')}<span>____________________ / _______________</span></div><div>{t('Заказчик')}<span>____________________ / _______________</span></div></div>}
 <p className="document-disclaimer">{t('Черновик для проверки. Налоговый режим, НДС, реквизиты и соответствие формы требованиям законодательства необходимо уточнить до подписания. Документ не подписан электронной подписью.')}</p>
 </article></div>;
}
