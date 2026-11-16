'use client';

import { useEffect, useState } from 'react';
import { Clock3, Download, LockKeyhole, Plus } from 'lucide-react';
import { workTimeKindLabels, workTimeStatusLabels, workTimeStatuses, type WorkTimeDecision, type WorkTimeEntry, type WorkTimePage, type WorkTimePerson } from '@tirek/contracts';
import { Pagination } from '../components/pagination';
import { Empty } from '../components/ui';
import { useI18n } from '../i18n/provider';
import { api } from '../lib/api';
import { downloadCsv } from '../lib/download-csv';
import { usePage } from '../lib/use-page';
import { almatyDateTime } from '../lib/work-time-date';
import { AllocateWorkTime, CloseWorkTimeMonth, decisionLabels, ReviewWorkTime, WorkTimeCreate } from './work-time-forms';

export function WorkTime({ owner }: { owner: boolean }) {
  const { t, formatDate } = useI18n();
  const [month, setMonth] = useState(() => almatyDateTime(new Date()).slice(0, 7));
  const [status, setStatus] = useState('');
  const [employee, setEmployee] = useState('');
  const [page, setPage] = useState(1);
  const [people, setPeople] = useState<WorkTimePerson[] | undefined>();
  const [peopleError, setPeopleError] = useState('');
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [review, setReview] = useState<{ entry: WorkTimeEntry; status: WorkTimeDecision['status'] } | null>(null);
  const [allocation, setAllocation] = useState<WorkTimePage['items'][number] | null>(null);
  const [success, setSuccess] = useState('');
  const params = new URLSearchParams({ month, page: String(page) });
  if (status) params.set('status', status);
  if (employee) params.set('employeeId', employee);
  const list = usePage<WorkTimePage['items'][number], WorkTimePage>('/work-time', params.toString());
  const period = list.result?.period.month === month ? list.result.period : null;

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    api<WorkTimePerson[]>('/work-time/people', { signal: controller.signal }).then(setPeople).catch(error => {
      if (!controller.signal.aborted) setPeopleError(error.message);
    });
    return () => controller.abort();
  }, [owner]);

  const date = (value: string) => formatDate(value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const duration = (minutes: number) => t('{0} ч {1} мин', Math.floor(minutes / 60), minutes % 60);
  const activeEmployee = people?.some(person => person.id === employee && person.isActive) ? employee : '';
  const shownError = list.error || peopleError || exportError;

  async function exportMonth() {
    setExporting(true);
    setExportError('');
    try {
      await downloadCsv('/work-time/export?month=' + encodeURIComponent(month), 'tirek-timesheet-' + month + '.csv');
    } catch (error) {
      setExportError((error as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return <section className="panel work-time" aria-label={t('Учёт рабочего времени')}>
    <div className="panel-heading">
      <div><h2>{t('Фактически отработанное время')}</h2><p>{t('Начало и окончание интервалов указаны по Алматы.')}</p></div>
      <button type="button" className="button primary" disabled={!!period?.closedAt || (owner && !people?.some(person => person.isActive))} onClick={() => setAdding(true)}>
        <Plus size={17} aria-hidden="true"/>{t('Записать фактическое время')}
      </button>
    </div>
    <div className="work-time-body">
      {owner && people && !people.some(person => person.isActive) && <p className="form-note">{t('Сначала пригласите сотрудников в разделе «Команда».')}</p>}
      <div className="work-time-filters">
        <label>{t('Месяц табеля')}<input type="month" min="2000-01" max="2099-12" value={month} onChange={event => {
          if (event.target.value) { setMonth(event.target.value); setPage(1); setSuccess(''); setExportError(''); }
        }}/></label>
        {owner && people && <label>{t('Сотрудник')}
          <select value={employee} onChange={event => { setEmployee(event.target.value); setPage(1); }}>
            <option value="">{t('Все сотрудники')}</option>
            {people.map(person => <option key={person.id} value={person.id}>{person.name}{person.isActive ? '' : ' · ' + t('Доступ отключён')}</option>)}
          </select>
        </label>}
        <label>{t('Статус')}
          <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
            <option value="">{t('Все статусы')}</option>
            {workTimeStatuses.map(value => <option key={value} value={value}>{t(workTimeStatusLabels[value])}</option>)}
          </select>
        </label>
      </div>
      {period && <div className="work-time-period">
        {period.closedAt && <p className="work-time-period-status"><LockKeyhole size={16} aria-hidden="true"/>{t('Месяц закрыт')} · {formatDate(period.closedAt)}</p>}
        {owner && period.closedAt && <button type="button" className="button secondary" disabled={exporting} onClick={exportMonth}>
          <Download size={16} aria-hidden="true"/>{t(exporting ? 'Подготовка CSV…' : 'Скачать CSV для бухгалтера')}
        </button>}
        {owner && !period.closedAt && period.ended && <button type="button" className="button secondary" onClick={() => setClosing(month)}>
          <LockKeyhole size={16} aria-hidden="true"/>{t('Закрыть месяц')}
        </button>}
      </div>}
      {shownError && <p className="alert" role="alert">{t(shownError)} {list.error && <button onClick={list.retry}>{t('Обновить')}</button>}</p>}
      {success && <p className="schedule-success" role="status">{t(success)}</p>}
      {list.result && <div className="work-time-summary" aria-label={t('Итоги за месяц')}>
        <div><span><Clock3 size={16} aria-hidden="true"/>{t('Часы подтверждены')}</span><strong>{duration(list.result.summary.approvedMinutes)}</strong></div>
        <div><span><Clock3 size={16} aria-hidden="true"/>{t('Часы на проверке')}</span><strong>{duration(list.result.summary.submittedMinutes)}</strong></div>
        <div><span>{t('Подтверждённые сверхурочные')}</span><strong>{duration(list.result.summary.approvedOvertimeMinutes)}</strong></div>
        <div><span>{t('Подтверждённые ночные')}</span><strong>{duration(list.result.summary.approvedNightMinutes)}</strong></div>
        <div><span>{t('Подтверждённое неотработанное время')}</span><strong>{duration(list.result.summary.approvedAbsenceMinutes)}</strong></div>
      </div>}
      <div className="work-time-entries" aria-busy={list.busy}>
        {list.result?.items.map(entry => <article key={entry.id} className="work-time-entry">
          <div>
            {owner && <strong>{entry.employee.name}</strong>}
            <p><time dateTime={entry.startsAt}>{date(entry.startsAt)}</time> — <time dateTime={entry.endsAt}>{date(entry.endsAt)}</time></p>
            <p className="muted">{t(workTimeKindLabels[entry.kind])}{entry.nightMinutes > 0 && ' · ' + t('Ночные за месяц: {0}', duration(entry.nightMinutes))}</p>
            {entry.order && <p className="muted">{t('Заказ № {0}', entry.order.number)} · {entry.order.title}</p>}
            {entry.locked && !period?.closedAt && <p className="muted">{t('Интервал затрагивает закрытый месяц')}</p>}
            {entry.decisionNote && <p className="muted">{t('Причина решения')} · {entry.decisionNote}</p>}
          </div>
          <div className="work-time-entry-status">
            <span className="work-time-badge" data-status={entry.status}>{t(workTimeStatusLabels[entry.status])}</span>
            <strong>{duration(entry.monthMinutes)}</strong>
          </div>
          {owner && ['SUBMITTED', 'APPROVED'].includes(entry.status) && <div className="work-time-actions">
            {!entry.locked && entry.status === 'SUBMITTED' && <>
              <button type="button" className="button primary" onClick={() => setReview({ entry, status: 'APPROVED' })}>{t(decisionLabels.APPROVED)}</button>
              <button type="button" className="button secondary" onClick={() => setReview({ entry, status: 'REJECTED' })}>{t(decisionLabels.REJECTED)}</button>
            </>}
            {!entry.locked && entry.status === 'APPROVED' && <button type="button" className="button secondary" onClick={() => setReview({ entry, status: 'VOIDED' })}>{t(decisionLabels.VOIDED)}</button>}
            {entry.kind !== 'ABSENCE' && <button type="button" className="button secondary" onClick={() => setAllocation(entry)}>{t(entry.order ? 'Изменить привязку' : 'Привязать к заказу')}</button>}
          </div>}
        </article>)}
        {list.busy && <Empty>{t('Загрузка…')}</Empty>}
        {!list.busy && !list.error && !list.result?.items.length && <Empty>{t('Записей табеля с этими фильтрами нет.')}</Empty>}
      </div>
      {list.result && list.result.pages > 1 && <Pagination result={list.result} page={page} setPage={setPage} busy={list.busy}/>}
    </div>
    {adding && <WorkTimeCreate people={owner ? people : undefined} employee={activeEmployee} close={() => setAdding(false)} saved={savedMonth => {
      setAdding(false); setMonth(savedMonth); setStatus(''); setEmployee(''); setPage(1);
      setSuccess('Время отправлено на проверку'); list.retry();
    }}/>}
    {review && <ReviewWorkTime {...review} close={() => { setReview(null); list.retry(); }} saved={() => {
      setReview(null); setSuccess('Решение по записи сохранено'); setPage(1); list.retry();
    }}/>}
    {allocation && <AllocateWorkTime entry={allocation} close={() => { setAllocation(null); list.retry(); }} saved={() => {
      setAllocation(null); setSuccess('Привязка времени сохранена'); list.retry();
    }}/>}
    {closing && <CloseWorkTimeMonth month={closing} close={() => { setClosing(null); list.retry(); }} saved={() => {
      setClosing(null); setSuccess('Табель за месяц закрыт'); list.retry();
    }}/>}
  </section>;
}
