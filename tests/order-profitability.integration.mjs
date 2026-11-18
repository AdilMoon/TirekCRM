import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:4000/api';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

async function login(organizationId, role, name) {
  const user = await db.user.create({ data: {
    organizationId, role, name, email: randomUUID() + '@profitability.invalid', passwordHash: 'unused',
  } });
  const token = randomBytes(32).toString('hex');
  await db.session.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000),
  } });
  return { id: user.id, cookie: 'tirek_session=' + token };
}

async function request(user, path, status = 200, method = 'GET', body, source = origin) {
  const response = await fetch(base + path, {
    method, headers: { Origin: source, ...(user && { Cookie: user.cookie }), ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, status, method + ' ' + path + ' ' + JSON.stringify(result));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return result;
}

test('profitability isolates rates and uses exact net costs and approved labor', async t => {
  const org = randomUUID();
  const externalOrg = randomUUID();
  const scope = { organizationId: { in: [org, externalOrg] } };
  try {
    await db.organization.createMany({ data: [{ id: org, name: 'Profitability QA' }, { id: externalOrg, name: 'Outside QA' }] });
    const owner = await login(org, 'OWNER', 'Owner');
    const a = await login(org, 'EMPLOYEE', 'Worker A');
    const b = await login(org, 'EMPLOYEE', 'Worker B');
    const pendingOnly = await login(org, 'EMPLOYEE', 'Pending worker');
    const foreign = await login(externalOrg, 'OWNER', 'Outside owner');
    const outsideStaff = await login(externalOrg, 'EMPLOYEE', 'Outside employee');
    async function order(organizationId, number) {
      const client = await db.client.create({ data: { organizationId, name: 'Profitability client' } });
      return db.order.create({ data: { organizationId, clientId: client.id, number, title: 'Profitability order ' + number, plannedMinutes: 120, total: '1000.00' } });
    }
    const main = await order(org, 1);
    const destination = await order(org, 2);
    const outside = await order(externalOrg, 1);
    const path = '/orders/' + main.id + '/profitability';
    const destPath = '/orders/' + destination.id + '/profitability';
    const basis = {
      costVersion: main.costVersion, plannedHourlyRate: '120.15', plannedDirectExpenses: '100.20', actualHourlyRate: '200.01',
      rates: [{ employeeId: b.id, hourlyRate: '400.01' }],
    };
    const budget = (input, status = 200) => request(owner, path, status, 'PATCH', input);

    async function hours(employeeId, start, end, status, kind = 'WORK') {
      const entry = await request(owner, '/work-time', 201, 'POST', {
        employeeId, startsAt: '2025-12-03T' + start + ':00Z', endsAt: '2025-12-03T' + end + ':00Z',
        orderId: kind === 'ABSENCE' ? undefined : main.id, kind, idempotencyKey: randomUUID(),
      });
      const decide = (next, version) => request(owner, '/work-time/' + entry.id + '/decision', 200, 'PATCH', {
        status: next, version, ...(next === 'APPROVED' ? {} : { note: 'Fixture' }),
      });
      if (status === 'VOIDED') await decide('APPROVED', entry.version);
      if (status !== 'SUBMITTED') await decide(status, status === 'VOIDED' ? entry.version + 1 : entry.version);
    }
    await hours(a.id, '09:00', '10:30', 'APPROVED');
    await hours(b.id, '09:00', '09:30', 'APPROVED', 'OVERTIME');
    await hours(a.id, '10:30', '11:00', 'VOIDED');
    await hours(a.id, '11:00', '11:30', 'REJECTED');
    await hours(a.id, '11:30', '12:00', 'APPROVED', 'ABSENCE');
    await hours(pendingOnly.id, '09:00', '10:00', 'SUBMITTED');
    async function expense(organizationId, orderId, amount) {
      return db.expense.create({ data: { organizationId, orderId, amount, description: 'Fixture', category: 'MATERIALS', idempotencyKey: randomUUID() } });
    }
    await expense(org, main.id, '150.25');
    const reversed = await expense(org, main.id, '41.17');
    const replaced = await expense(org, main.id, '20.02');
    await expense(org, null, '9000.99');
    await expense(externalOrg, outside.id, '5000.99');

    await t.test('unpriced work stays incomplete and rates remain owner-only', async () => {
      await request(null, path, 401);
      await request(a, path, 403);
      await request(a, path, 403, 'PATCH', basis);
      await request(foreign, path, 404);
      await request(foreign, path, 404, 'PATCH', basis);
      await request(owner, path, 403, 'PATCH', basis, 'https://another.invalid');
      for (const override of [{ plannedHourlyRate: '-1' }, { plannedDirectExpenses: '1.002' }, { actualHourlyRate: 42 }, { organizationId: externalOrg },
        { rates: [basis.rates[0], { employeeId: b.id.toUpperCase(), hourlyRate: '500' }] }]) {
        await budget({ ...basis, ...override }, 400);
      }
      for (const employeeId of [outsideStaff.id, pendingOnly.id]) await budget({ ...basis, rates: [{ employeeId, hourlyRate: '20' }] }, 404);
      const initial = await request(owner, path);
      assert.equal(initial.actualMinutes, 120);
      assert.equal(initial.pendingMinutes, 60);
      assert.equal(initial.costVersion, main.costVersion);
      assert.deepEqual(initial.actual, { labor: null, expenses: '211.44', cost: null, profit: null, marginPercent: null });
      assert.equal(initial.planned.cost, null);
      assert.equal(initial.forecast.atCompletion.profit, null);
      assert.equal(initial.forecast.remainingExpenses, null);
      const publicFields = await request(owner, '/orders/' + main.id);
      assert.equal(Object.hasOwn(publicFields, 'actualHourlyRate'), false);
    });

    await t.test('duplicate saves and reversals keep exact plan and permit moving expenses between orders', async () => {
      const saved = await Promise.all([budget(basis), budget(basis)]);
      assert.deepEqual(saved[0], saved[1]);
      await budget({ ...basis, plannedDirectExpenses: '99.00' }, 409);
      assert.equal(await db.auditEvent.count({ where: { organizationId: org, action: 'ORDER_COST_INPUTS_CHANGED' } }), 1);
      await request(owner, '/finance/expenses/' + reversed.id + '/reversal', 201, 'POST', {
        reason: 'Reverse fixture expense', idempotencyKey: randomUUID(),
      });
      await request(owner, '/finance/expenses/' + replaced.id + '/replacement', 201, 'POST', {
        reason: 'Move fixture expense', idempotencyKey: randomUUID(), amount: '12.01',
        description: 'Replacement QA', category: 'MATERIALS', orderId: destination.id,
      });
      const detail = await request(owner, path);
      assert.equal(detail.revenue, '1000.00');
      assert.equal(detail.actualRevenue, detail.revenue);
      assert.equal((await request(owner, '/orders/' + main.id)).version, main.version);
      assert.deepEqual(detail.planned, { labor: '240.30', expenses: '100.20', cost: '340.50', profit: '659.50', marginPercent: '65.95' });
      assert.deepEqual(detail.actual, { labor: '500.02', expenses: '150.25', cost: '650.27', profit: '349.73', marginPercent: '34.97' });
      assert.deepEqual(detail.forecast.atCompletion, { labor: '700.03', expenses: '150.25', cost: '850.28', profit: '149.72', marginPercent: '14.97' });
      assert.equal(detail.forecast.remainingMinutes, 0);
      assert.equal(detail.forecast.remainingExpenses, '0.00');
      assert.deepEqual(detail.contributors.map(row => [row.employeeId, row.approvedMinutes, row.hourlyRate]), [[a.id, 90, null], [b.id, 30, '400.01']]);
      assert.equal((await request(owner, destPath)).actual.expenses, '12.01');
      assert.equal((await request(foreign, '/orders/' + outside.id + '/profitability')).actual.expenses, '5000.99');
    });

    await t.test('forecast prices only the remaining budget and stays stable as pending time is approved', async () => {
      await db.order.update({ where: { id: main.id }, data: { plannedMinutes: 240 } });
      const current = await request(owner, path);
      const version = await budget({ ...basis, costVersion: current.costVersion, plannedDirectExpenses: '300' });
      const before = await request(owner, path);
      assert.equal(before.forecast.remainingMinutes, 60);
      assert.equal(before.forecast.remainingExpenses, '149.75');
      assert.deepEqual(before.forecast.atCompletion, { labor: '900.04', expenses: '300.00', cost: '1200.04', profit: '-200.04', marginPercent: '-20.00' });
      await db.order.update({ where: { id: main.id }, data: { status: 'COMPLETED' } });
      const finished = await request(owner, path);
      assert.equal(finished.forecast.remainingMinutes, 0);
      assert.equal(finished.forecast.remainingExpenses, '0.00');
      assert.equal(finished.forecast.atCompletion.labor, '700.03');
      assert.equal(finished.actual.labor, '500.02');
      await db.order.update({ where: { id: main.id }, data: { status: main.status } });
      const entry = await db.workTimeEntry.findFirstOrThrow({ where: { organizationId: org, employeeId: pendingOnly.id, status: 'SUBMITTED' } });
      await request(owner, '/work-time/' + entry.id + '/decision', 200, 'PATCH', { status: 'APPROVED', version: entry.version });
      const after = await request(owner, path);
      assert.deepEqual(after.forecast, before.forecast);
      assert.equal(after.actual.labor, '700.03');
      await request(owner, '/work-time/' + entry.id + '/decision', 200, 'PATCH', { status: 'VOIDED', version: entry.version + 1, note: 'Fixture' });
      await db.order.update({ where: { id: main.id }, data: { plannedMinutes: 120 } });
      await budget({ ...basis, costVersion: version.costVersion });
    });

    await t.test('completed work has no future budget and open orders distinguish missing inputs from zero', async () => {
      const save = input => request(owner, destPath, 200, 'PATCH', input);
      const dest = await request(owner, destPath);
      const priced = await save({ ...basis, costVersion: dest.costVersion, plannedHourlyRate: '90', actualHourlyRate: null, rates: [] });
      assert.equal((await request(owner, destPath)).forecast.atCompletion.labor, '180.00');
      await db.order.update({ where: { id: destination.id }, data: { plannedMinutes: null } });
      assert.equal((await request(owner, destPath)).forecast.atCompletion.labor, null);
      await save({ ...basis, costVersion: priced.costVersion, actualHourlyRate: '0', rates: [] });
      assert.equal((await request(owner, destPath)).forecast.atCompletion.labor, '0.00');
      await db.order.update({ where: { id: destination.id }, data: { status: 'COMPLETED' } });
      const closed = await request(owner, destPath);
      assert.equal(closed.forecast.closed, true);
      assert.deepEqual(closed.forecast.atCompletion, closed.actual);
    });

    await t.test('clearing an override falls back to the shared rate; zero and a loss remain distinct', async () => {
      const detail = await request(owner, path);
      const updated = await budget({ ...basis, costVersion: detail.costVersion, actualHourlyRate: '500.01', rates: [{ employeeId: b.id, hourlyRate: null }] });
      const loss = await request(owner, path);
      assert.deepEqual(loss.actual, { labor: '1000.02', expenses: '150.25', cost: '1150.27', profit: '-150.27', marginPercent: '-15.03' });
      assert.equal(await db.orderLaborRate.count({ where: { orderId: main.id } }), 0);
      await budget({ ...basis, costVersion: updated.costVersion, actualHourlyRate: '0', rates: [] });
      assert.equal((await request(owner, path)).actual.labor, '0.00');
      assert.equal((await request(owner, destPath)).actual.labor, '0.00');
    });

    await t.test('cancellation preserves incurred costs and removes contractual revenue from actual profit', async () => {
      await request(owner, '/orders/' + main.id + '/status', 200, 'PATCH', { status: 'CANCELLED' });
      const cancelled = await request(owner, path);
      assert.equal(cancelled.revenue, '1000.00');
      assert.equal(cancelled.planned.profit, '659.50');
      assert.equal(cancelled.actualRevenue, '0.00');
      assert.deepEqual(cancelled.actual, { labor: '0.00', expenses: '150.25', cost: '150.25', profit: '-150.25', marginPercent: null });
      assert.deepEqual(cancelled.forecast.atCompletion, cancelled.actual);
    });
  } finally {
    await db.expenseReversal.deleteMany({ where: scope });
    await db.expense.deleteMany({ where: scope });
    await db.workTimeEntry.deleteMany({ where: scope });
    await db.order.deleteMany({ where: scope });
    await db.client.deleteMany({ where: scope });
    await db.auditEvent.deleteMany({ where: scope });
    await db.user.deleteMany({ where: scope });
    await db.organization.deleteMany({ where: { id: { in: [org, externalOrg] } } });
    await db.$disconnect();
  }
});
