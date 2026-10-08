'use client';
import { useI18n } from '../i18n/provider';

import { type Dashboard } from '@tirek/contracts';

export function MoneyChart({ data }: { data: Dashboard['monthly'] }) {
  const { t, formatDate, formatMoney } = useI18n();

  const max = Math.max(...data.flatMap(m => [Number(m.income), Number(m.expense)]), 100);
  const scale = Math.ceil(max / 100000) * 100000 || 100;
  return <div className="money-chart" role="img" aria-label={t("Поступления и расходы за последние шесть месяцев")}><div className="chart-axis">{[1,.75,.5,.25,0].map(v => <span key={v}>{Math.round(scale * v / 1000)}  {t("тыс.")}</span>)}</div><div className="chart-plot"><div className="chart-grid">{[0,1,2,3,4].map(i => <i key={i} />)}</div><div className="bar-groups">{data.map((m, i) => <div className="bar-group" key={i}><div className="bar-pair"><div className="bar income-bar" style={{ height: `${Math.max(1, Number(m.income) / scale * 100)}%` }} title={t("Поступления: {0}", formatMoney(m.income))} /><div className="bar expense-bar" style={{ height: `${Math.max(1, Number(m.expense) / scale * 100)}%` }} title={t("Расходы: {0}", formatMoney(m.expense))} /></div><span>{formatDate(m.label+'-15T12:00:00Z', { month:'short' }).replace('.','')}</span></div>)}</div></div></div>;
}
