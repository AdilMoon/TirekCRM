import { PayloadTooLargeException } from '@nestjs/common';
import type { Movement } from '@tirek/contracts';
import { cents, money } from '../../common/money';
import { csvText } from '../../common/csv';
export { csvText };

export const MAX_MOVEMENT_EXPORT_ROWS = 10000;
export const MAX_MOVEMENT_EXPORT_BYTES = 8 * 1024 * 1024;
type ExportRow = Omit<Movement, 'amount' | 'createdAt'> & { amount: { toFixed(places: number): string }; createdAt: Date };
const almatyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' });
const columns = ['id', 'kind', 'created_at_utc', 'date_almaty', 'currency', 'amount', 'cash_flow_amount', 'description', 'category', 'order_id', 'order_number', 'source_id'];

export function movementCsv(rows: ExportRow[]) {
  const lines = ['\ufeff' + columns.map(csvText).join(',') + '\r\n'];
  let bytes = Buffer.byteLength(lines[0], 'utf8'), received = 0n, expenses = 0n;
  for (const row of rows) {
    const amount = row.amount.toFixed(2), value = cents(amount);
    const incoming = row.kind === 'INCOME' || row.kind === 'EXPENSE_REVERSAL';
    if (row.kind === 'INCOME') received += value;
    else if (row.kind === 'REFUND') received -= value;
    else if (row.kind === 'EXPENSE') expenses += value;
    else expenses -= value;
    const date = almatyDate.formatToParts(row.createdAt);
    const part = (type: Intl.DateTimeFormatPartTypes) => date.find(p => p.type === type)!.value;
    const day = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
    const fields = [row.id, row.kind, row.createdAt.toISOString(), day, 'KZT', amount,
      money(incoming ? value : -value), row.description, row.category, row.orderId ?? '', String(row.orderNumber ?? ''), row.sourceId ?? ''];
    // Monetary columns contain only validated server-generated decimals, not user text.
    const line = fields.map((field, index) => index === 5 || index === 6 ? '"' + field + '"' : csvText(field)).join(',') + '\r\n';
    bytes += Buffer.byteLength(line, 'utf8');
    if (bytes > MAX_MOVEMENT_EXPORT_BYTES) throw new PayloadTooLargeException('Файл экспорта превышает 8 МиБ. Сузьте период или фильтры');
    lines.push(line);
  }
  return { csv: lines.join(''), total: rows.length, summary: { received: money(received), expenses: money(expenses), cashFlow: money(received - expenses) } };
}
