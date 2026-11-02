import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvText, movementCsv, MAX_MOVEMENT_EXPORT_BYTES } from './movement-export';
import { movementExportQuerySchema } from '@tirek/contracts';

test('CSV quotes delimiters and neutralizes formula/control prefixes without changing normal text', () => {
  assert.equal(csvText('Алматы, "Қызмет"\r\nnext'), '"Алматы, ""Қызмет""\r\nnext"');
  for (const text of ['=1+1', '+SUM(1,1)', '-cmd', '@SUM(1)', '  =1', '\t=1', '\r=1', '\n=1', '\0=1', '\ufeff=1', '＝1', '＋1', '－1', '＠1']) {
    assert.ok(csvText(text).startsWith('"\''), JSON.stringify(text));
  }
  for (const text of ['Клиент', 'hello@example.kz', 'one-two', '']) assert.equal(csvText(text), '"' + text + '"');
});

test('CSV preserves exact KZT, correction signs, UTC and historical Almaty dates', () => {
  const base = { id: 'test', sourceId: null, category: 'OTHER', description: '=literal', orderId: null, orderNumber: null, createdAt: new Date('2019-12-31T18:00:00Z') };
  const amount = (value: string) => ({ toFixed: () => value });
  const report = movementCsv([
    { ...base, kind: 'INCOME', amount: amount('90071992547409.91') },
    { ...base, kind: 'REFUND', amount: amount('0.11') },
    { ...base, kind: 'EXPENSE', amount: amount('20.25') },
    { ...base, kind: 'EXPENSE_REVERSAL', amount: amount('20.25') },
  ]);
  assert.deepEqual(report.summary, { received: '90071992547409.80', expenses: '0.00', cashFlow: '90071992547409.80' });
  assert.equal(report.total, 4);
  assert.ok(report.csv.startsWith('\ufeff"id"'));
  assert.match(report.csv, /"2019-12-31T18:00:00.000Z","2020-01-01","KZT"/);
  assert.match(report.csv, /"0.11","-0.11"/);
  assert.match(report.csv, /"20.25","-20.25"/);
  assert.match(report.csv, /"20.25","20.25"/);
  assert.equal(report.csv.split('"\'=literal"').length - 1, 4);
  assert.ok(report.csv.endsWith('\r\n'));
  assert.deepEqual(movementCsv([]).summary, { received: '0.00', expenses: '0.00', cashFlow: '0.00' });
  assert.throws(() => movementCsv([{ ...base, kind: 'INCOME', amount: amount('1.00'), description: 'Ж'.repeat(MAX_MOVEMENT_EXPORT_BYTES / 2) }]), error => (error as { getStatus(): number }).getStatus() === 413);
});

test('export filter schema rejects paging, tenant overrides, invalid/repeated dates and unknown fields', () => {
  assert.deepEqual(movementExportQuerySchema.parse({}), { q: '' });
  assert.equal(movementExportQuerySchema.parse({ kind: 'REFUND', from: '0001-01-01', to: '9999-12-31' }).kind, 'REFUND');
  for (const input of [
    { page: '1' }, { pageSize: '100' }, { organizationId: 'other' }, { format: 'xlsx' },
    { from: '2026-02-30' }, { from: '0000-01-01' }, { from: '2026-11-02', to: '2026-11-01' },
    { from: ['2026-11-01', '2026-11-02'] }, { orderId: 'nope' }, { kind: 'OWNER' }, { q: '\0' }, { q: 'a'.repeat(201) },
  ]) assert.equal(movementExportQuerySchema.safeParse(input).success, false);
});
