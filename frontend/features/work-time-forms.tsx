'use client';

import { useRef, useState, type FormEvent } from 'react';
import { workTimeEntrySchema, workTimeKinds, workTimeKindLabels, type WorkTimeKind, type WorkTimeDecision, type WorkTimeEntry, type WorkTimeEntryInput, type WorkTimePerson } from '@tirek/contracts';
import { Field, ModalShell } from '../components/ui';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { almatyDateTime, almatyInstant } from '../lib/work-time-date';

export function WorkTimeCreate({ people, employee, close, saved }: {
  people?: WorkTimePerson[];
  employee: string;
  close: () => void;
  saved: (month: string) => void;
}) {
  const { t } = useI18n();
  const [employeeId, setEmployeeId] = useState(employee);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [kind, setKind] = useState<WorkTimeKind>('WORK');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<WorkTimeEntryInput | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!pending.current) {
        const value = workTimeEntrySchema.safeParse({
          startsAt: almatyInstant(start), endsAt: almatyInstant(end), kind,
          ...(people ? { employeeId } : {}), idempotencyKey: crypto.randomUUID(),
        });
        if (!value.success) throw new Error('Интервал должен длиться от 1 минуты до 24 часов');
        pending.current = value.data;
      }
      await api<WorkTimeEntry>('/work-time', { method: 'POST', body: JSON.stringify(pending.current) });
      saved(start.slice(0, 7));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <ModalShell title={t('Записать фактическое время')} onClose={close} busy={busy}>
    <form className="editor-form" onSubmit={submit}>
      {people && <label>{t('Сотрудник')}
        <select required value={employeeId} disabled={busy} onChange={event => { setEmployeeId(event.target.value); pending.current = null; }}>
          <option value="">{t('Выберите сотрудника')}</option>
          {people.filter(person => person.isActive).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </label>}
      <label>{t('Вид времени')}
        <select value={kind} disabled={busy} onChange={event => { setKind(event.target.value as WorkTimeKind); pending.current = null; }}>
          {workTimeKinds.map(value => <option key={value} value={value}>{t(workTimeKindLabels[value])}</option>)}
        </select>
      </label>
      <Field label={t('Фактическое начало (Алматы)')} type="datetime-local" required step={60} max={almatyDateTime(new Date())}
        value={start} disabled={busy} onChange={event => { setStart(event.target.value); pending.current = null; }}/>
      <Field label={t('Фактическое окончание (Алматы)')} type="datetime-local" required step={60} max={almatyDateTime(new Date())}
        value={end} disabled={busy} onChange={event => { setEnd(event.target.value); pending.current = null; }}/>
      <p className="form-note">{t('Сверхурочную часть смены внесите отдельной записью. Ночное время с 22:00 до 06:00 рассчитывается автоматически.')}</p>
      {error && <p className="form-error" role="alert">{t(error)}</p>}
      <div className="form-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={close}>{t('Отмена')}</button>
        <button className="button primary" disabled={busy}>{t('Отправить на проверку')}</button>
      </div>
    </form>
  </ModalShell>;
}

export const decisionLabels = {
  APPROVED: 'Подтвердить часы',
  REJECTED: 'Отклонить часы',
  VOIDED: 'Аннулировать запись',
} as const;

export function ReviewWorkTime({ entry, status, close, saved }: {
  entry: WorkTimeEntry;
  status: WorkTimeDecision['status'];
  close: () => void;
  saved: () => void;
}) {
  const { t, formatDate } = useI18n();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input: WorkTimeDecision = status === 'APPROVED'
        ? { status, version: entry.version }
        : { status, version: entry.version, note: note.trim() };
      await api('/work-time/' + entry.id + '/decision', { method: 'PATCH', body: JSON.stringify(input) });
      saved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const date = (value: string) => formatDate(value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return <ModalShell title={t(decisionLabels[status])} onClose={close} busy={busy}>
    <form className="editor-form" onSubmit={submit}>
      <p><strong>{entry.employee.name}</strong><br/>{t(workTimeKindLabels[entry.kind])} · {date(entry.startsAt)} — {date(entry.endsAt)}</p>
      {status !== 'APPROVED' && <label>{t('Причина решения')}
        <textarea rows={3} required maxLength={300} value={note} disabled={busy} onChange={event => setNote(event.target.value)}/>
      </label>}
      {error && <p className="form-error" role="alert">{t(error)}</p>}
      <div className="form-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={close}>{t('Отмена')}</button>
        <button className="button primary" disabled={busy || (status !== 'APPROVED' && !note.trim())}>{t(decisionLabels[status])}</button>
      </div>
    </form>
  </ModalShell>;
}

export function CloseWorkTimeMonth({ month, close, saved }: { month: string; close: () => void; saved: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/work-time/close', { method: 'POST', body: JSON.stringify({ month }) });
      saved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <ModalShell title={t('Закрыть месяц')} onClose={close} busy={busy}>
    <form className="editor-form" onSubmit={submit}>
      <strong>{month}</strong>
      <p className="form-note">{t('Закрытие фиксирует табель всей компании за выбранный месяц. Записи, затрагивающие этот месяц, будут заблокированы, а CSV можно скачать повторно.')}</p>
      {error && <p className="form-error" role="alert">{t(error)}</p>}
      <div className="form-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={close}>{t('Отмена')}</button>
        <button className="button primary" disabled={busy}>{t('Подтвердить закрытие')}</button>
      </div>
    </form>
  </ModalShell>;
}
