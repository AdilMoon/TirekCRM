'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import type { OrderQuote } from '@tirek/contracts';
import { Brand } from '../components/ui';
import { LanguageSwitcher, useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { QuoteBreakdown, quoteKindLabels, quoteStatusLabels } from './quote-breakdown';

const unavailable = 'Ссылка на смету недоступна или истекла';

function QuoteReview({ token }: { token: string }) {
  const { t, formatDate } = useI18n();
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError(unavailable);
      return;
    }
    const controller = new AbortController();
    setQuote(null); setError(''); setAgreed(false);
    api<OrderQuote>('/quote/read', { method: 'POST', body: JSON.stringify({ token }), signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setQuote(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [token, refresh]);

  async function accept() {
    if (!quote || !agreed || busy || quote.status !== 'PENDING') return;
    setBusy(true); setError('');
    try {
      const result = await api<{ acceptedAt: string }>('/quote/accept', {
        method: 'POST', body: JSON.stringify({ token, revision: quote.revision, agreed: true }),
      });
      setQuote({ ...quote, acceptedAt: result.acceptedAt, status: 'ACCEPTED' });
    } catch (error) {
      const response = error as Error & { status?: number };
      setError(response.message);
      if (response.status === 409) setQuote({ ...quote, status: 'STALE' });
      if (response.status === 404) setQuote(null);
    } finally {
      setBusy(false);
    }
  }

  return <>
    {error && <div className="alert" role="alert">{t(error)}
      <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={busy}>{t('Обновить')}</button>
    </div>}
    {!quote && !error && <p role="status">{t('Загрузка…')}</p>}
    {quote && <article className="panel quote-paper" aria-busy={busy}>
      <header className="quote-paper-heading">
        <div>
          <p>{quote.snapshot.companyName} · {t('Заказ № {0}', quote.snapshot.orderNumber)}</p>
          <h1>{t(quoteKindLabels[quote.kind])}</h1>
          <h2>{quote.snapshot.title}</h2>
        </div>
        <ClipboardList aria-hidden="true" size={29}/>
      </header>
      <div className="quote-toolbar">
        <span>{t('Версия {0}', quote.revision)}</span>
        <span className="subtle-pill" data-status={quote.status}>{t(quoteStatusLabels[quote.status])}</span>
      </div>
      <QuoteBreakdown quote={quote}/>
      {quote.status === 'PENDING' && <div className="quote-decision">
        <label className="check-label"><input type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)}/>
          {t('Согласен с перечнем работ и указанной суммой')}
        </label>
        <button type="button" className="button primary" disabled={!agreed || busy} onClick={accept}>{t('Согласовать предложение')}</button>
        <p className="form-note">{t('Согласование будет записано в истории заказа.')}</p>
      </div>}
      {quote.status === 'ACCEPTED' && <p className="schedule-success quote-confirmed" role="status">
        <CheckCircle2 size={19} aria-hidden="true"/>{t('Предложение согласовано')} · {formatDate(quote.acceptedAt!, { dateStyle: 'short', timeStyle: 'short' })}
      </p>}
      {quote.status === 'STALE' && !error && <p className="form-note">{t('Условия заказа изменились. Попросите отправить новую смету')}</p>}
    </article>}
  </>;
}

export function PublicQuote() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setToken(new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return <div className="public-passport quote-page">
    <header><Brand/><LanguageSwitcher/></header>
    <main>{token !== null && <QuoteReview key={token} token={token}/>}</main>
  </div>;
}
