'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { publishQuoteSchema, type OrderQuotes, type PublishQuoteInput } from '@tirek/contracts';
import { Field, ModalShell } from '../components/ui';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { QuoteBreakdown, quoteKindLabels, quoteStatusLabels } from './quote-breakdown';

const emptyLine = () => ({ description: '', quantity: '1', unitPrice: '' });
type ShareLink = { id: string; url: string; expiresAt: string };

export function OrderQuoteManager({ id, close }: { id: string; close: () => void }) {
  const { t, formatDate, formatMoney } = useI18n();
  const path = '/orders/' + id + '/quotes';
  const [data, setData] = useState<OrderQuotes | null>(null);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<OrderQuotes>(path, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [path, refresh]);

  async function mutate(operation: () => Promise<void>) {
    if (busy) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      await operation();
      setData(await api<OrderQuotes>(path));
    } catch (error) {
      setError((error as Error).message);
      setRefresh(value => value + 1);
    } finally {
      setBusy(false);
    }
  }

  function publish(kind: PublishQuoteInput['kind'], event?: FormEvent) {
    event?.preventDefault();
    if (!data) return;
    const input = publishQuoteSchema.safeParse(kind === 'BASE' ? { kind, orderVersion: data.orderVersion } : {
      kind, orderVersion: data.orderVersion, items: lines.map(line => ({
        description: line.description, quantity: Number(line.quantity), unitPrice: line.unitPrice.replace(',', '.'),
      })),
    });
    if (!input.success) {
      setError('Проверьте введённые данные');
      return;
    }
    void mutate(async () => {
      setLink(await api<ShareLink>(path, { method: 'POST', body: JSON.stringify(input.data) }));
      setLines([emptyLine()]);
    });
  }

  function changeLine(index: number, field: keyof ReturnType<typeof emptyLine>, value: string) {
    setLines(current => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }

  async function copyLink(url: string) {
    setNotice('');
    try { await navigator.clipboard.writeText(url); setNotice('Ссылка скопирована'); }
    catch { setNotice('Скопируйте ссылку из поля'); }
  }

  const active = data?.entries.some(entry => entry.status === 'PENDING' || entry.status === 'STALE');
  const visibleLink = link && data?.entries.some(entry => entry.id === link.id && !entry.revokedAt &&
    (entry.status === 'PENDING' || entry.status === 'ACCEPTED')) ? link : null;

  return <ModalShell title={t('Смета и допработы')} onClose={close} busy={busy} className="quote-modal">
    <div className="quote-manager">
      <p className="form-note">{t('Клиент видит только отправленную версию и позиции. После согласования названия и количество допработ увидит исполнитель.')}</p>
      {error && <p className="alert" role="alert">{t(error)}</p>}
      {notice && <p className="schedule-success" role="status">{t(notice)}</p>}
      {!data && !error && <p role="status">{t('Загрузка…')}</p>}
      {data && <>
        <div className="quote-toolbar">
          <strong>{t('Текущая сумма заказа')} · {formatMoney(data.orderTotal)}</strong>
          <button type="button" className="button secondary" disabled={busy} onClick={() => void mutate(async () => {})}>{t('Обновить')}</button>
        </div>
        {data.canPublish && !active && !data.hasAcceptedBase && <section className="quote-compose">
          <h3>{t('Основная смета')}</h3>
          <p>{t('В смету войдут текущие позиции заказа.')}</p>
          <button type="button" className="button primary" disabled={busy} onClick={() => publish('BASE')}>{t('Создать ссылку на смету')}</button>
        </section>}
        {data.canPublish && !active && data.hasAcceptedBase && <form className="editor-form quote-compose" onSubmit={event => publish('EXTRA', event)}>
          <h3>{t('Предложить допработы')}</h3>
          {lines.map((line, index) => <div className="quote-form-line" key={index}>
            <Field label={t('Услуга {0}', index + 1)} value={line.description} maxLength={200} disabled={busy} required
              onChange={event => changeLine(index, 'description', event.target.value)}/>
            <Field label={t('Количество {0}', index + 1)} type="number" min={1} max={10000} value={line.quantity} disabled={busy} required
              onChange={event => changeLine(index, 'quantity', event.target.value)}/>
            <Field label={t('Цена {0}', index + 1)} type="number" min="0.01" step="0.01" value={line.unitPrice} disabled={busy} required
              onChange={event => changeLine(index, 'unitPrice', event.target.value)}/>
            {lines.length > 1 && <button type="button" className="icon-button" aria-label={t('Удалить услугу {0}', index + 1)} disabled={busy}
              onClick={() => setLines(current => current.filter((_, i) => i !== index))}><Trash2 size={17}/></button>}
          </div>)}
          <div className="quote-toolbar">
            <button type="button" className="button secondary" disabled={busy || lines.length >= 10}
              onClick={() => setLines(current => [...current, emptyLine()])}><Plus size={17}/>{t('Добавить услугу')}</button>
            <button className="button primary" disabled={busy}>{t('Создать ссылку на допработы')}</button>
          </div>
        </form>}
        {visibleLink && <section className="quote-compose">
          <Field label={t('Ссылка для клиента')} readOnly value={visibleLink.url} onFocus={event => event.target.select()}/>
          <div className="quote-toolbar">
            <button type="button" className="button secondary" onClick={() => copyLink(visibleLink.url)}><Copy size={17}/>{t('Скопировать ссылку')}</button>
            <a className="button secondary" href={visibleLink.url} target="_blank" rel="noreferrer">{t('Открыть для проверки')}</a>
          </div>
          {new URL(visibleLink.url).hostname === 'localhost' && <p>{t('Локальная ссылка открывается на этом компьютере. Для телефона нужен размещённый HTTPS-сайт.')}</p>}
        </section>}
        {active && !visibleLink && <p className="form-note">{t('Чтобы выпустить новую ссылку, отзовите действующую.')}</p>}
        <div className="quote-history">
          <h3>{t('Версии предложений')}</h3>
          {!data.entries.length && <p>{t('Предложений пока нет.')}</p>}
          {data.entries.map(entry => <details key={entry.id}>
            <summary>
              <strong>{t(quoteKindLabels[entry.kind])} · {t('Версия {0}', entry.revision)}</strong>
              <span className="subtle-pill" data-status={entry.status}>{t(quoteStatusLabels[entry.status])}</span>
            </summary>
            <QuoteBreakdown quote={entry}/>
            {entry.acceptedAt && <p>{t('Согласовано')} · {formatDate(entry.acceptedAt, { dateStyle: 'short', timeStyle: 'short' })}</p>}
            {entry.revokedAt && <p>{t('Ссылка отозвана')}</p>}
            {!entry.revokedAt && entry.status !== 'EXPIRED' && <button type="button" className="button secondary" disabled={busy}
              onClick={() => void mutate(async () => { await api(path + '/' + entry.id + '/link', { method: 'DELETE' }); })}>{t('Отозвать ссылку')}</button>}
          </details>)}
        </div>
        <p className="form-note">{t('Telegram-уведомление получают исполнители с активными задачами по заказу и подключённым ботом.')}</p>
      </>}
    </div>
  </ModalShell>;
}
