import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ReportsService } from '../backend/dist/modules/reports/reports.service.js';
import { MAX_MOVEMENT_EXPORT_ROWS } from '../backend/dist/modules/reports/movement-export.js';
import { movementExportQuerySchema } from '@tirek/contracts';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 5 }) });
const reports = new ReportsService({ client: db }), orgs = [];
async function tenant() {
  const id = randomUUID(); orgs.push(id);
  const org = await db.organization.create({ data: { id, name: 'Export QA', users: { create: [
    { name: 'Owner', role: 'OWNER', email: randomUUID() + '@export.invalid', passwordHash: 'unused' },
    { name: 'Worker', role: 'EMPLOYEE', email: randomUUID() + '@export.invalid', passwordHash: 'unused' },
  ] } }, include: { users: true } });
  const session = async (user, expiresAt = new Date(Date.now() + 3600000)) => {
    const token = randomBytes(32).toString('hex');
    await db.session.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt } });
    return 'tirek_session=' + token;
  };
  const owner = org.users.find(u => u.role === 'OWNER');
  return { id, owner, cookie: await session(owner), worker: await session(org.users.find(u => u.role === 'EMPLOYEE')), expired: await session(owner, new Date(0)) };
}
async function isolatedApi() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['backend/dist/main.js'], { env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  let spawnError; child.on('error', error => { spawnError = error; });
  const exited = new Promise(resolve => child.once('close', resolve));
  const stop = async () => { if (child.exitCode === null && !spawnError) child.kill(); await exited; };
  const url = `http://127.0.0.1:${port}/api`;
  try {
    for (let i = 0; i < 80; i++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw Error('Export test API exited');
      try { if ((await fetch(url + '/health', { signal: AbortSignal.timeout(500) })).ok) return { url, stop }; } catch {}
      await delay(150);
    }
    throw Error('Export test API readiness timeout');
  } catch (error) { await stop(); throw error; }
}
// Independent CSV reader: verify the exported table, not substrings that could be in another cell.
function readCsv(text) {
  const records = []; let record = [], value = '', quoted = false;
  const input = text.replace(/^\ufeff/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\r')) {
      record.push(value); value = '';
      if (c === '\r') { assert.equal(input[++i], '\n'); records.push(record); record = []; }
    } else value += c;
  }
  assert.equal(quoted, false); assert.equal(value, ''); assert.deepEqual(record, []);
  const [headers, ...rows] = records;
  return rows.map(row => { assert.equal(row.length, headers.length); return Object.fromEntries(headers.map((key, i) => [key, row[i]])); });
}
const filters = values => movementExportQuerySchema.parse(values);

test('financial CSV export preserves the report snapshot and access boundaries', async t => {
  let server;
  try {
    const a = await tenant(), b = await tenant();
    const client = await db.client.create({ data: { organizationId: a.id, name: 'Customer for export' } });
    const order = await db.order.create({ data: { organizationId: a.id, clientId: client.id, title: 'Export order', number: 731, total: '90071992547409.91' } });
    const at = new Date('2026-10-07T19:00:00Z'), sharedId = randomUUID();
    const payment = await db.payment.create({ data: { id: sharedId, organizationId: a.id, orderId: order.id, amount: '90071992547409.91', note: '=1+1, "Оплата"\r\nЖол', createdAt: at, idempotencyKey: randomUUID() } });
    const expense = await db.expense.create({ data: { id: sharedId, organizationId: a.id, orderId: order.id, amount: '20.25', description: '\t+SUM(1,1)', category: 'RENT', createdAt: at, idempotencyKey: randomUUID() } });
    await db.paymentRefund.create({ data: { organizationId: a.id, paymentId: payment.id, amount: '0.11', reason: 'Return', actorId: a.owner.id, actorName: 'Owner', createdAt: at, idempotencyKey: randomUUID() } });
    await db.expenseReversal.create({ data: { organizationId: a.id, expenseId: expense.id, amount: '20.25', reason: 'Correction', actorId: a.owner.id, actorName: 'Owner', createdAt: at, idempotencyKey: randomUUID() } });
    await db.expense.create({ data: { organizationId: b.id, amount: '999.99', description: 'FOREIGN SECRET', category: 'OTHER', idempotencyKey: randomUUID() } });

    await t.test('CSV contains all correction kinds, exact decimals, safe text and stable ordering', async () => {
      const first = await reports.exportMovements(a.id, filters({})), repeated = await reports.exportMovements(a.id, filters({}));
      assert.equal(first.csv, repeated.csv); assert.equal(first.total, 4);
      assert.deepEqual(first.summary, { received: '90071992547409.80', expenses: '0.00', cashFlow: '90071992547409.80' });
      const rows = readCsv(first.csv);
      assert.equal(new Set(rows.map(r => r.kind + ':' + r.id)).size, 4);
      assert.equal(rows.filter(r => r.id === sharedId).length, 2);
      assert.equal(rows.find(r => r.kind === 'INCOME').description, '\'=1+1, "Оплата"\r\nЖол');
      assert.equal(rows.find(r => r.kind === 'EXPENSE').description, '\'\t+SUM(1,1)');
      assert.equal(rows.find(r => r.kind === 'REFUND').source_id, payment.id);
      assert.equal(rows.find(r => r.kind === 'EXPENSE_REVERSAL').cash_flow_amount, '20.25');
      assert.ok(rows.every(r => r.date_almaty === '2026-10-08' && r.currency === 'KZT'));
      const page = await reports.movements(a.id, { ...filters({}), page: 1, pageSize: 100 });
      assert.deepEqual(rows.map(r => r.kind + ':' + r.id), page.items.map(r => r.kind + ':' + r.id));
      assert.deepEqual(first.summary, page.summary);
      assert.ok(!first.csv.includes('FOREIGN SECRET'));
    });
    await t.test('the same filters apply to CSV and JSON, including timezone edges and literal SQL-like input', async () => {
      for (const query of [
        { kind: 'REFUND' }, { kind: 'EXPENSE_REVERSAL' }, { category: 'RENT' }, { orderId: order.id },
        { q: '731' }, { q: 'Customer for export' }, { q: 'Export order' }, { q: "' OR 1=1 --" }, { q: '%' },
        { kind: 'INCOME', category: 'RENT' }, { from: '2026-10-08', to: '2026-10-08' }, { to: '2026-10-07' },
      ]) {
        const queryFilters = filters(query), csv = await reports.exportMovements(a.id, queryFilters);
        const json = await reports.movements(a.id, { ...queryFilters, page: 1, pageSize: 100 });
        assert.equal(csv.total, json.total); assert.deepEqual(csv.summary, json.summary);
        assert.deepEqual(readCsv(csv.csv).map(r => r.kind + ':' + r.id), json.items.map(r => r.kind + ':' + r.id));
      }
      assert.equal((await reports.exportMovements(b.id, filters({ orderId: order.id }))).total, 0);
      // A statement-level snapshot must stay self-consistent during a concurrent insert.
      const [concurrent] = await Promise.all([
        reports.exportMovements(a.id, filters({ q: 'Snapshot race' })),
        db.expense.create({ data: { organizationId: a.id, amount: '0.01', description: 'Snapshot race', category: 'OTHER', idempotencyKey: randomUUID() } }),
      ]);
      assert.ok([0, 1].includes(concurrent.total));
      assert.equal(readCsv(concurrent.csv).length, concurrent.total);
      assert.equal(concurrent.summary.expenses, concurrent.total ? '0.01' : '0.00');
    });
    await t.test('10000 rows export completely and 10001 fail without silently truncating', async () => {
      for (let offset = 0; offset < MAX_MOVEMENT_EXPORT_ROWS; offset += 500) {
        await db.expense.createMany({ data: Array.from({ length: Math.min(500, MAX_MOVEMENT_EXPORT_ROWS - offset) }, () => ({ organizationId: a.id, amount: '0.01', description: 'Export limit fixture', category: 'OTHER', idempotencyKey: randomUUID(), createdAt: at })) });
      }
      const complete = await reports.exportMovements(a.id, filters({ q: 'Export limit fixture' }));
      assert.equal(complete.total, MAX_MOVEMENT_EXPORT_ROWS); assert.equal(readCsv(complete.csv).length, MAX_MOVEMENT_EXPORT_ROWS);
      assert.equal(complete.summary.expenses, '100.00');
      await db.expense.create({ data: { organizationId: a.id, amount: '0.01', description: 'Export limit fixture', category: 'OTHER', idempotencyKey: randomUUID() } });
      await assert.rejects(() => reports.exportMovements(a.id, filters({ q: 'Export limit fixture' })), error => error.getStatus?.() === 400);
    });
    await t.test('HTTP enforces owner/session/tenant boundaries, CSV headers, strict input and its real rate limit', async () => {
      server = await isolatedApi();
      async function request(query = '', cookie) {
        const response = await fetch(server.url + '/movements/export' + query, { headers: cookie ? { Cookie: cookie } : {} });
        return { status: response.status, headers: response.headers, text: await response.text() };
      }
      for (const [cookie, status] of [[undefined, 401], [a.worker, 403], [a.expired, 401]]) {
        const response = await request('', cookie); assert.equal(response.status, status);
        assert.equal(response.headers.get('content-disposition'), null);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      const owned = await request('?orderId=' + order.id, a.cookie);
      assert.equal(owned.status, 200); assert.equal(readCsv(owned.text).length, 4);
      assert.equal(owned.headers.get('content-type'), 'text/csv; charset=utf-8');
      assert.equal(owned.headers.get('content-disposition'), 'attachment; filename="tirek-movements.csv"');
      assert.equal(owned.headers.get('x-report-total'), '4');
      assert.equal(owned.headers.get('x-report-received'), '90071992547409.80');
      assert.equal(owned.headers.get('x-report-expenses'), '0.00');
      assert.equal(owned.headers.get('x-report-cash-flow'), '90071992547409.80');
      const foreign = await request('?orderId=' + order.id, b.cookie); assert.equal(foreign.status, 200); assert.equal(readCsv(foreign.text).length, 0);
      for (const query of ['?organizationId=' + b.id, '?page=1', '?from=2026-10-08&from=2026-10-09', '?q=Export%20limit%20fixture']) {
        const response = await request(query, a.cookie); assert.equal(response.status, 400, query);
        assert.match(response.headers.get('content-type'), /application\/json/); assert.equal(response.headers.get('content-disposition'), null);
      }
      assert.equal((await request('?orderId=' + order.id, a.cookie)).status, 200);
      const limited = await request('?orderId=' + order.id, a.cookie);
      assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal(limited.headers.get('cache-control'), 'no-store'); assert.equal(limited.headers.get('content-disposition'), null);
    });
  } finally {
    if (server) await server.stop();
    for (const organizationId of orgs) {
      await db.paymentRefund.deleteMany({ where: { organizationId } }); await db.expenseReversal.deleteMany({ where: { organizationId } });
      await db.payment.deleteMany({ where: { organizationId } }); await db.expense.deleteMany({ where: { organizationId } });
      await db.order.deleteMany({ where: { organizationId } }); await db.client.deleteMany({ where: { organizationId } });
      await db.user.deleteMany({ where: { organizationId } }); await db.organization.deleteMany({ where: { id: organizationId } });
    }
    await db.$disconnect();
  }
});
