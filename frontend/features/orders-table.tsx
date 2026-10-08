'use client';
import { useI18n } from '../i18n/provider';

import { ArrowUpRight } from 'lucide-react';
import { type Order } from '@tirek/contracts';

import { Status, Empty } from '../components/ui';
export function OrdersTable({ orders, onSelect }: { orders: Order[]; onSelect: (o: Order) => void }) {
  const { t, formatMoney, dateLabel } = useI18n();

  return <><div className="table-wrap"><table className="orders-table"><thead><tr><th>{t("Заказ / клиент")}</th><th>{t("Статус")}</th><th>{t("Срок")}</th><th className="right">{t("Сумма")}</th><th className="right">{t("Получено")}</th><th /></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td><button className="order-title" onClick={() => onSelect(o)}><strong>{o.title}</strong><span>№ {o.number} <i>·</i> {o.client.name}</span></button></td><td><Status status={o.status} /></td><td className="nowrap">{dateLabel(o.dueDate)}</td><td className="right amount" data-label={t("Стоимость")}>{formatMoney(o.total)}</td><td className="right" data-label={t("Получено")}><span className={Number(o.paid) >= Number(o.total) ? 'paid-full' : ''}>{formatMoney(o.paid)}</span></td><td><button className="icon-button" aria-label={t("Открыть заказ {0}", o.number)} onClick={() => onSelect(o)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>{!orders.length && <Empty>{t("Заказов пока нет. Создайте первый заказ.")}</Empty>}</>;
}
