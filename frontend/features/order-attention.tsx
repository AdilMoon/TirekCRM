'use client';
import {useState} from 'react';
import {attentionReasons,type AttentionIssue,type AttentionOrder,type OrderAttention} from '@tirek/contracts';
import {useI18n} from '../i18n/provider';
import {usePage} from '../lib/use-page';
import {Pagination} from '../components/pagination';
import {Empty,SearchBox,Status} from '../components/ui';
import {OrderProfitabilityPanel} from './order-profitability';
import {OrderEffort} from './order-effort';
import {OrderQuoteManager} from './order-quote-manager';

const labels={
  LOSS:'Прогноз убытка',INCOMPLETE:'Не хватает данных для расчёта',RECEIPTS:'Чеки на проверке',
  APPROVAL:'Срок согласования истёк',OVERRUN:'Перерасход времени',TIME_REVIEW:'Часы на проверке',DEADLINE:'Срок заказа прошёл',
} as const;
export function OrderAttentionBoard({revision,onSelect}:{revision:unknown;onSelect:(order:{id:string})=>void}) {
  const {t,formatMoney,formatDate}=useI18n();
  const [q,setQ]=useState(''),[reason,setReason]=useState(''),[page,setPage]=useState(1);
  const [action,setAction]=useState<AttentionIssue|null>(null);
  const params=new URLSearchParams({q,page:String(page),...(reason?{reason}:{})});
  const {result,error,busy,retry}=usePage<AttentionOrder,OrderAttention>('/orders/attention',params.toString(),revision);
  const close=()=>{setAction(null);setPage(1);retry();};
  function issueLabel(issue:AttentionIssue) {
    const count=issue.reason==='OVERRUN'||issue.reason==='TIME_REVIEW'?t('{0} мин',issue.count):
      issue.reason==='RECEIPTS'?String(issue.count):'';
    return t(labels[issue.reason])+(count?' · '+count:'');
  }
  return <section className="order-attention" aria-label={t('Заказы, требующие внимания')} aria-busy={busy}>
    <p className="muted">{t('Активные заказы и незакрытые вопросы по завершённым работам. Нажмите на причину, чтобы открыть нужный раздел.')}</p>
    <div className="table-toolbar">
      <SearchBox value={q} setValue={value=>{setQ(value);setPage(1);}} placeholder={t('Название, номер или клиент')}/>
      <label>{t('Причина')}<select aria-label={t('Причина')} value={reason} onChange={e=>{setReason(e.target.value);setPage(1);}}>
        <option value="">{t('Все причины')}</option>
        {attentionReasons.map(key=><option key={key} value={key}>{t(labels[key])}{result?' · '+result.summary.reasons[key]:''}</option>)}
      </select></label>
      <button type="button" className="button secondary" disabled={busy} onClick={retry}>{t('Обновить')}</button>
    </div>
    {error&&<p role="alert" className="alert">{t(error)}</p>}
    {busy&&<p role="status" className="empty">{t('Загрузка…')}</p>}
    {result&&<>
      <div className="attention-summary" aria-label={t('Сводка по всем причинам с учётом поиска')}>
        <div><span>{t('Заказов с вопросами')}</span><strong>{result.summary.orders}</strong></div>
        <div><span>{t('Прогноз убытка')}</span><strong>{formatMoney(result.summary.forecastLoss)}</strong></div>
        <div><span>{t('Неполный расчёт')}</span><strong>{result.summary.reasons.INCOMPLETE}</strong></div>
      </div>
      <p className="muted">{t('Сводка учитывает все причины в рамках поиска.')}</p>
      <div className="attention-orders">{result.items.map(row=><article className="attention-order" key={row.id}>
        <div className="attention-order-heading"><div><h3>{t('Заказ № {0}',row.number)} · {row.title}</h3><p>{row.clientName}</p><Status status={row.status}/></div>
          <div className={row.forecastProfit?.startsWith('-')?'attention-loss':''}><span>{t('Прогноз прибыли')}</span>
            <strong>{row.forecastProfit===null?t('Расчёт неполный'):formatMoney(row.forecastProfit)}</strong>
            <small>{t('Фактическая прибыль')} · {row.actualProfit===null?'—':formatMoney(row.actualProfit)}</small>
          </div>
        </div>
        <div className="attention-reasons">{row.issues.map(issue=><button key={issue.orderId+issue.reason}
          type="button" className="button secondary" onClick={()=>issue.target==='details'?onSelect({id:issue.orderId}):setAction(issue)}>
          {issueLabel(issue)}{issue.orderId!==row.id&&' · '+t('Выезд № {0}',issue.number)}
        </button>)}</div>
      </article>)}</div>
      {!result.items.length&&<Empty>{t('Заказов с такими причинами не найдено')}</Empty>}
      <Pagination result={result} page={page} setPage={setPage} busy={busy}/>
      <p className="muted">{t('Данные обновлены: {0}',formatDate(result.asOf))}</p>
    </>}
    {action?.target==='profitability'&&<OrderProfitabilityPanel key={action.orderId} id={action.orderId} close={close}/>}
    {action?.target==='effort'&&<OrderEffort key={action.orderId} id={action.orderId} close={close}/>}
    {action?.target==='quotes'&&<OrderQuoteManager key={action.orderId} id={action.orderId} close={close}/>}
  </section>;
}
