import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FinanceService } from '../backend/dist/modules/finance/finance.service.js';
import { AuditService } from '../backend/dist/modules/audit/audit.service.js';
import { serializable } from '../backend/dist/common/transaction.js';

test('a PostgreSQL commit conflict retries the transaction and remains bounded', async () => {
  const conflict = Object.assign(new Error('TransactionWriteConflict'), {
    name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict' },
  });
  let attempts = 0;
  const db = { $transaction: async operation => {
    const result = await operation();
    if (++attempts === 1) throw conflict;
    return result;
  }};
  assert.equal(await serializable(db, async () => 'saved'), 'saved');
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(serializable({ $transaction: async () => { attempts++; throw conflict; } }, async () => {}),
    error => error.getStatus() === 409);
  assert.equal(attempts, 4);
});

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 6 }) });
const orgs = [], origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
let base;
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
      if (spawnError) throw spawnError; if (child.exitCode !== null) throw Error('Replacement test API exited');
      try { if ((await fetch(url + '/health', { signal: AbortSignal.timeout(500) })).ok) return { url, stop }; } catch {}
      await delay(150);
    }
    throw Error('Replacement test API readiness timeout');
  } catch (error) { await stop(); throw error; }
}
async function session(user) {
  const token = randomBytes(32).toString('hex');
  await db.session.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
  return 'tirek_session=' + token;
}
async function fixture(amount = '10.10') {
  const id = randomUUID(); orgs.push(id);
  const org = await db.organization.create({ data: { id, name: 'Expense replacement QA', users: { create: [
    { name: 'Owner', role: 'OWNER', email: randomUUID() + '@replacement.invalid', passwordHash: 'unused' },
    { name: 'Worker', role: 'EMPLOYEE', email: randomUUID() + '@replacement.invalid', passwordHash: 'unused' },
  ] } }, include: { users: true } });
  const owner = org.users.find(u => u.role === 'OWNER');
  const client = await db.client.create({ data: { organizationId: id, name: 'Replacement QA client' } });
  const order = await db.order.create({ data: { organizationId: id, clientId: client.id, number: 1, title: 'Replacement QA order', total: '100.00' } });
  const expense = await db.expense.create({ data: { organizationId: id, orderId: order.id, amount, description: 'Original expense', category: 'RENT', createdAt: new Date('2020-01-01T12:00:00Z'), idempotencyKey: randomUUID() } });
  return { id, owner, order, expense, cookie: await session(owner), worker: await session(org.users.find(u => u.role === 'EMPLOYEE')) };
}
async function req(path, { cookie, method = 'GET', body, source = origin } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(source ? { Origin: source } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
const input = (overrides = {}) => ({ amount: '12.34', description: 'Corrected expense', category: 'MATERIALS', orderId: null, reason: 'Replacement reason <private>', idempotencyKey: randomUUID(), ...overrides });
const replace = (actor, expense, body = input()) => req('/finance/expenses/' + expense.id + '/replacement', { ...actor, method: 'POST', body });
const reverse = (actor, expense, body = { reason: 'Standalone reversal', idempotencyKey: randomUUID() }) => req('/finance/expenses/' + expense.id + '/reversal', { ...actor, method: 'POST', body });
const summary = async actor => (await req('/movements/search', actor)).body.summary;
const counts = async id => ({ expenses: await db.expense.count({ where: { organizationId: id } }), reversals: await db.expenseReversal.count({ where: { organizationId: id } }), audit: await db.auditEvent.count({ where: { organizationId: id } }) });

test('atomic expense replacement preserves history, exact balances and retry boundaries', async t => {
  const server = await isolatedApi(); base = server.url;
  try {
    const a = await fixture(), b = await fixture(); let first, requestBody;
    await t.test('role, tenant, Origin, strict full input and no-op boundaries', async () => {
      for (const [actor, status] of [[{}, 401], [{ cookie: a.worker }, 403], [b, 404], [{ ...a, source: '' }, 403], [{ ...a, source: 'https://evil.invalid' }, 403]]) {
        assert.equal((await replace(actor, a.expense)).status, status);
      }
      for (const extra of [{ orderId: undefined }, { orderId: b.order.id }, { orderId: randomUUID() }]) {
        assert.equal((await replace(a, a.expense, input(extra))).status, extra.orderId === undefined ? 400 : 404);
      }
      for (const extra of [{ amount: '-1' }, { amount: '1.001' }, { description: 'bad\0text' }, { description: 'bad\ud800' }, { category: 'OWNER' }, { reason: 'no' }, { organizationId: b.id }, { actorId: b.owner.id }, { createdAt: '2020-01-01' }, { replacementExpenseId: b.expense.id }]) {
        assert.equal((await replace(a, a.expense, input(extra))).status, 400);
      }
      const noChange = input({ amount: '10.1', description: a.expense.description, category: a.expense.category, orderId: a.order.id });
      assert.equal((await replace(a, a.expense, noChange)).status, 409);
      assert.deepEqual(await counts(a.id), { expenses: 1, reversals: 0, audit: 0 });
    });
    await t.test('parallel duplicate requests create one replacement, one reversal and two audit events', async () => {
      requestBody = input();
      const results = await Promise.all([1, 2, 3].map(() => replace(a, a.expense, requestBody)));
      assert.deepEqual(results.map(r => r.status), [201, 201, 201]); first = results[0].body;
      for (const result of results) assert.deepEqual(result.body, first);
      assert.equal(first.originalExpenseId, a.expense.id); assert.notEqual(first.expense.id, a.expense.id);
      assert.equal(first.reversal.amount, '10.10'); assert.equal(first.expense.amount, '12.34');
      assert.equal(first.expense.createdAt, first.reversal.createdAt); assert.equal(first.expense.orderId, null);
      assert.deepEqual(await counts(a.id), { expenses: 2, reversals: 1, audit: 2 });
      assert.deepEqual(await db.expense.findUnique({ where: { id: a.expense.id } }), a.expense);
      const original = (await req('/finance/expenses/' + a.expense.id, a)).body;
      const replacement = (await req('/finance/expenses/' + first.expense.id, a)).body;
      assert.equal(original.remaining, '0.00'); assert.equal(original.replacementExpenseId, first.expense.id);
      assert.deepEqual(original.order,{id:a.order.id,number:a.order.number,title:a.order.title});
      assert.equal(original.replacementAllowed,false);
      assert.equal(replacement.order,null);assert.equal(replacement.replacementAllowed,true);
      assert.equal(replacement.replacesExpenseId, a.expense.id); assert.equal(replacement.remaining, '12.34');
      assert.deepEqual(await summary(a), { received: '0.00', expenses: '12.34', cashFlow: '-12.34' });
      assert.equal((await req('/dashboard', a)).body.expenses, '12.34');
      assert.equal((await req('/movements/search?from=2020-01-01&to=2020-01-01', a)).body.summary.expenses, '10.10');
      const events = (await req('/audit?entityType=EXPENSE', a)).body.items;
      assert.deepEqual(events.map(e => e.action).sort(), ['EXPENSE_RECORDED', 'EXPENSE_REVERSED']);
      assert.ok(!JSON.stringify(events).includes('<private>')); assert.ok(!JSON.stringify(events).includes('Corrected expense'));
      assert.equal(events.find(e => e.action === 'EXPENSE_REVERSED').metadata.replacementExpenseId, first.expense.id);
      const upper = await replace(a, { id: a.expense.id.toUpperCase() }, { ...requestBody, idempotencyKey: requestBody.idempotencyKey.toUpperCase() });
      assert.equal(upper.status, 201); assert.deepEqual(upper.body, first);
      assert.equal(JSON.stringify(first).includes(requestBody.idempotencyKey), false);
    });
    await t.test('changed input, author, source and cross-endpoint key reuse conflict without writes', async () => {
      const before = await counts(a.id);
      for (const extra of [{ amount: '12.35' }, { description: 'Changed description' }, { category: 'OTHER' }, { orderId: a.order.id }, { reason: 'Changed reason' }]) assert.equal((await replace(a, a.expense, { ...requestBody, ...extra })).status, 409);
      const owner2 = await db.user.create({ data: { organizationId: a.id, name: 'Second owner', role: 'OWNER', email: randomUUID() + '@replacement.invalid', passwordHash: 'unused' } });
      assert.equal((await replace({ cookie: await session(owner2) }, a.expense, requestBody)).status, 409);
      assert.equal((await replace(a, { id: first.expense.id }, requestBody)).status, 409);
      assert.equal((await reverse(a, a.expense, { reason: requestBody.reason, idempotencyKey: requestBody.idempotencyKey })).status, 409);
      assert.deepEqual(await counts(a.id), before);
      const standaloneKey = randomUUID(); assert.equal((await reverse(b, b.expense, { reason: 'Standalone only', idempotencyKey: standaloneKey })).status, 201);
      assert.equal((await replace(b, b.expense, input({ reason: 'Standalone only', idempotencyKey: standaloneKey }))).status, 409);
    });
    await t.test('replacement chains retain both links and historical retries return the original result', async () => {
      const next = await replace(a, first.expense, input({ amount: '4.56', category: 'TRANSPORT', orderId: a.order.id }));
      assert.equal(next.status, 201); assert.equal(next.body.expense.orderId, a.order.id);
      const middle = (await req('/finance/expenses/' + first.expense.id, a)).body;
      assert.equal(middle.replacesExpenseId, a.expense.id); assert.equal(middle.replacementExpenseId, next.body.expense.id);
      assert.deepEqual((await replace(a, a.expense, requestBody)).body, first);
      assert.equal((await replace(a, a.expense, input())).status, 409);
      assert.equal((await summary(a)).expenses, '4.56');
      assert.equal((await req('/movements/search?from=2020-01-01&to=2020-01-01', a)).body.summary.expenses, '10.10');
    });
    await t.test('different replacement keys racing each other leave exactly one complete winner', async () => {
      const c = await fixture();
      const results = await Promise.all(['20.01', '30.02'].map(amount => replace(c, c.expense, input({ amount }))));
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
      const winner = results.find(r => r.status === 201).body;
      assert.deepEqual(await counts(c.id), { expenses: 2, reversals: 1, audit: 2 });
      assert.equal((await summary(c)).expenses, winner.expense.amount);
    });
    await t.test('replacement racing a standalone reversal has one winner with shared or different keys', async () => {
      for (const sharedKey of [true, false]) {
        const c = await fixture(), body = input();
        const results = await Promise.all([replace(c, c.expense, body), reverse(c, c.expense, { reason: body.reason, idempotencyKey: sharedKey ? body.idempotencyKey : randomUUID() })]);
        assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
        assert.deepEqual(await counts(c.id), { expenses: results[0].status === 201 ? 2 : 1, reversals: 1, audit: results[0].status === 201 ? 2 : 1 });
        assert.equal((await summary(c)).expenses, results[0].status === 201 ? '12.34' : '0.00');
      }
    });
    await t.test('other readers see either the original expense or the complete replacement, never half of it', async () => {
      const c = await fixture(), audit = new AuditService({ client: db });
      let enter, release, calls = 0;
      const entered = new Promise(resolve => { enter = resolve; }), blocked = new Promise(resolve => { release = resolve; });
      const paused = new FinanceService({ client: db }, { record: async (...args) => { if (++calls === 1) { enter(); await blocked; } return audit.record(...args); } });
      const pending = paused.replace(c.owner, c.expense.id, input());
      try {
        await Promise.race([entered, pending.then(() => { throw Error('Transaction completed before the visibility barrier'); })]);
        const before = await req('/movements/search', c);
        assert.equal(before.body.total, 1); assert.equal(before.body.summary.expenses, '10.10');
        assert.equal(before.body.items[0].id, c.expense.id);
      } finally { release(); }
      await pending;
      const after = await req('/movements/search', c);
      assert.equal(after.body.total, 3); assert.equal(after.body.summary.expenses, '12.34');
    });
    await t.test('failure of the second audit write rolls back all money, links and the first audit record', async () => {
      const c = await fixture(), audit = new AuditService({ client: db }), body = input(); let calls = 0;
      const broken = new FinanceService({ client: db }, { record: (...args) => { if (++calls === 2) throw Error('second audit outage'); return audit.record(...args); } });
      await assert.rejects(() => broken.replace(c.owner, c.expense.id, body), /second audit outage/);
      assert.deepEqual(await counts(c.id), { expenses: 1, reversals: 0, audit: 0 });
      assert.equal((await replace(c, c.expense, body)).status, 201);
      const disabled = await fixture(); await db.user.update({ where: { id: disabled.owner.id }, data: { isActive: false } });
      await assert.rejects(() => broken.replace(disabled.owner, disabled.expense.id, input()), e => e.getStatus?.() === 403);
      assert.equal((await replace(disabled, disabled.expense)).status, 401);
      assert.deepEqual(await counts(disabled.id), { expenses: 1, reversals: 0, audit: 0 });
    });
    await t.test('DB constraints reject foreign/self links, reused targets and deleting a referenced replacement', async () => {
      const c = await fixture(), d = await fixture();
      const common = { organizationId: c.id, expenseId: c.expense.id, amount: '10.10', reason: 'Constraint QA', actorId: c.owner.id, actorName: 'Owner', idempotencyKey: randomUUID() };
      await assert.rejects(() => db.expenseReversal.create({ data: { ...common, replacementExpenseId: d.expense.id } }));
      await assert.rejects(() => db.expenseReversal.create({ data: { ...common, replacementExpenseId: c.expense.id } }));
      const result = await replace(c, c.expense); assert.equal(result.status, 201);
      const other = await db.expense.create({ data: { organizationId: c.id, amount: '1.00', description: 'Other source', category: 'OTHER', idempotencyKey: randomUUID() } });
      await assert.rejects(() => db.expenseReversal.create({ data: { ...common, expenseId: other.id, idempotencyKey: randomUUID(), replacementExpenseId: result.body.expense.id } }));
      await assert.rejects(() => db.expense.delete({ where: { id: result.body.expense.id } }));
      assert.equal(await db.expenseReversal.count({ where: { organizationId: c.id } }), 1);
    });
    await t.test('large historical originals are reversed exactly and exports reflect the replacement', async () => {
      const c = await fixture('90071992547409.99');
      const result = await replace(c, c.expense, input({ amount: '0.01' })); assert.equal(result.status, 201);
      assert.equal(result.body.reversal.amount, '90071992547409.99'); assert.equal(result.body.expense.amount, '0.01');
      assert.deepEqual(await summary(c), { received: '0.00', expenses: '0.01', cashFlow: '-0.01' });
      const csv = await fetch(base + '/movements/export', { headers: { Cookie: c.cookie } });
      assert.equal(csv.status, 200); assert.equal(csv.headers.get('x-report-expenses'), '0.01');
      const text = await csv.text(); assert.ok(text.includes('90071992547409.99')); assert.ok(text.includes(result.body.expense.id));
    });
  } finally {
    await server.stop();
    for (const organizationId of orgs) {
      await db.expenseReversal.deleteMany({ where: { organizationId } }); await db.expense.deleteMany({ where: { organizationId } });
      await db.order.deleteMany({ where: { organizationId } }); await db.client.deleteMany({ where: { organizationId } });
      await db.user.deleteMany({ where: { organizationId } }); await db.organization.deleteMany({ where: { id: organizationId } });
    }
    await db.$disconnect();
  }
});
