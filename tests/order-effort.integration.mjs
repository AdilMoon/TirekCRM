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
    organizationId, role, name, email: randomUUID() + '@order-effort.invalid', passwordHash: 'unused',
  } });
  const token = randomBytes(32).toString('hex');
  await db.session.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000),
  } });
  return { id: user.id, cookie: 'tirek_session=' + token };
}

async function request(user, path, expected = 200, method = 'GET', body) {
  const response = await fetch(base + path, {
    method, headers: { Origin: origin, Cookie: user.cookie, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const isCsv = response.headers.get('content-type')?.startsWith('text/csv');
  const payload = isCsv ? await response.text() : await response.json();
  assert.equal(response.status, expected, method + ' ' + path + ' ' + JSON.stringify(payload));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return payload;
}

function shift(day, start, end, orderId, kind) {
  return { startsAt: day + 'T' + start + ':00Z', endsAt: day + 'T' + end + ':00Z', orderId, kind, idempotencyKey: randomUUID() };
}

test('order effort aggregates only approved allocations and keeps closed payroll immutable', async t => {
  const org = randomUUID();
  const foreign = randomUUID();
  const scope = { organizationId: { in: [org, foreign] } };
  try {
    await db.organization.createMany({ data: [{ id: org, name: 'Effort QA' }, { id: foreign, name: 'Foreign effort QA' }] });
    const owner = await login(org, 'OWNER', 'Owner');
    const employee = await login(org, 'EMPLOYEE', 'Worker');
    const colleague = await login(org, 'EMPLOYEE', 'Colleague');
    const outsider = await login(foreign, 'OWNER', 'Outside owner');
    const createOrder = async (organizationId, number, title, status = 'NEW') => {
      const client = await db.client.create({ data: { organizationId, name: 'Effort client' } });
      return db.order.create({ data: { organizationId, number, title, status, total: '100.00', clientId: client.id } });
    };
    const order = await createOrder(org, 1, '=Effort main, "QA"');
    const other = await createOrder(org, 2, 'Other effort order');
    const cancelled = await createOrder(org, 3, 'Cancelled effort order', 'CANCELLED');
    const outsideOrder = await createOrder(foreign, 1, 'Outside effort order');
    for (const [orderId, status] of [[order.id, 'DONE'], [other.id, 'CANCELLED']]) {
      await db.businessTask.create({ data: { organizationId: org, title: 'Assigned work', orderId, status, assigneeId: employee.id, createdById: owner.id } });
    }

    const effortPath = '/orders/' + order.id + '/effort';
    const review = (item, status = 'APPROVED', version = item.version) =>
      request(owner, '/work-time/' + item.id + '/decision', 200, 'PATCH', { status, version, ...(status !== 'APPROVED' && { note: 'QA decision' }) });
    const allocate = (id, orderId, version, expected = 200) =>
      request(owner, '/work-time/' + id + '/order', expected, 'PATCH', { orderId, version });
    const mainShift = shift('2025-10-31', '18:30', '20:30', order.id);
    let mainEntry;
    let legacy;

    await t.test('tenant and role boundaries apply to picker, writes, detail, report and export', async () => {
      assert.deepEqual((await request(employee, '/work-time/orders?q=%231')).map(row => row.id), [order.id]);
      assert.deepEqual(await request(employee, '/work-time/orders?q=%25'), []);
      assert.deepEqual(await request(colleague, '/work-time/orders'), []);
      assert.deepEqual((await request(owner, '/work-time/orders')).map(row => row.id), [other.id, order.id]);
      assert.deepEqual((await request(outsider, '/work-time/orders')).map(row => row.id), [outsideOrder.id]);
      for (const id of [other.id, cancelled.id, outsideOrder.id]) {
        await request(employee, '/work-time', 404, 'POST', { ...mainShift, orderId: id });
      }
      await request(employee, '/work-time', 400, 'POST', { ...mainShift, kind: 'ABSENCE' });
      await request(employee, effortPath, 403);
      await request(employee, '/order-effort', 403);
      await request(employee, '/order-effort/export', 403);
      await request(outsider, effortPath, 404);
      await request(outsider, effortPath, 404, 'PATCH', { minutes: 90, orderVersion: 1 });
      await request(owner, '/order-effort?overrun=bogus', 400);
      assert.equal((await request(outsider, '/order-effort')).total, 1);
    });

    await t.test('manual plans are validated, audited and protected from concurrent edits', async () => {
      const initial = await request(owner, effortPath);
      assert.equal(initial.plannedMinutes, null);
      assert.equal(initial.deltaMinutes, null);
      for (const minutes of [0, 1.5, 60001]) {
        await request(owner, effortPath, 400, 'PATCH', { minutes, orderVersion: initial.orderVersion });
      }
      const save = { minutes: 120, orderVersion: initial.orderVersion };
      const outcomes = await Promise.all([request(owner, effortPath, 200, 'PATCH', save), request(owner, effortPath, 200, 'PATCH', save)]);
      assert.equal(outcomes[0].orderVersion, outcomes[1].orderVersion);
      await request(owner, effortPath, 409, 'PATCH', { ...save, minutes: 90 });
      assert.equal(await db.auditEvent.count({ where: { organizationId: org, action: 'ORDER_EFFORT_PLAN_CHANGED' } }), 1);
    });

    await t.test('actual uses whole approved intervals once and separates pending, denied and absence', async () => {
      mainEntry = await request(employee, '/work-time', 201, 'POST', mainShift);
      assert.equal((await request(employee, '/work-time', 201, 'POST', mainShift)).id, mainEntry.id);
      await request(employee, '/work-time', 409, 'POST', { ...mainShift, orderId: undefined });
      await request(employee, '/work-time/' + mainEntry.id + '/order', 403, 'PATCH', { version: 1, orderId: null });

      legacy = await request(colleague, '/work-time', 201, 'POST', shift('2025-11-05', '13:00', '13:30', undefined, 'OVERTIME'));
      const pending = await request(employee, '/work-time', 201, 'POST', shift('2025-12-05', '13:00', '13:35', order.id));
      const rejected = await request(employee, '/work-time', 201, 'POST', shift('2025-11-05', '13:00', '14:00', order.id));
      const voided = await request(employee, '/work-time', 201, 'POST', shift('2025-11-05', '14:00', '15:00', order.id));
      const absence = await request(employee, '/work-time', 201, 'POST', shift('2025-11-05', '15:00', '16:00', undefined, 'ABSENCE'));
      await review(legacy);
      await review(absence);
      await allocate(absence.id, order.id, 0, 409);
      await review(rejected, 'REJECTED');
      await allocate(rejected.id, null, 1, 409);
      await review(voided);
      await review(voided, 'VOIDED', 2);

      const before = await request(owner, effortPath);
      assert.equal(before.actualMinutes, 0);
      assert.equal(before.pendingMinutes, 155);
      assert.equal(before.deltaMinutes, null);
      await review(mainEntry);
      const onPlan = await request(owner, effortPath);
      assert.equal(onPlan.actualMinutes, 120);
      assert.equal(onPlan.pendingMinutes, 35);
      assert.equal(onPlan.deltaMinutes, 0);
      const listed = (await request(employee, '/work-time?month=2025-12')).items.find(row => row.id === pending.id);
      assert.deepEqual(listed.order, { id: order.id, number: 1, title: order.title });
    });

    await t.test('allocation of closed history preserves the payroll snapshot and rejects stale or foreign updates', async () => {
      await request(owner, '/work-time/close', 201, 'POST', { month: '2025-11' });
      const payroll = await request(owner, '/work-time/export?month=2025-11');
      const historical = await db.workTimeEntry.findUniqueOrThrow({ where: { id: legacy.id } });
      await request(outsider, '/work-time/' + legacy.id + '/order', 404, 'PATCH', { orderId: outsideOrder.id, version: 0 });
      await allocate(legacy.id, outsideOrder.id, 0, 404);
      assert.deepEqual(await allocate(legacy.id, order.id, 0), { version: 1 });
      assert.deepEqual(await allocate(legacy.id, order.id, 0), { version: 1 });
      await allocate(legacy.id, other.id, 0, 409);
      const ownLegacyRow = (await request(colleague, '/work-time?month=2025-11')).items.find(row => row.id === legacy.id);
      assert.equal(ownLegacyRow.order, null);
      const detail = await request(owner, effortPath);
      assert.equal(detail.actualMinutes, 150);
      assert.equal(detail.overtimeMinutes, 30);
      assert.equal(detail.deltaMinutes, 30);
      assert.deepEqual(detail.contributors.map(row => [row.name, row.actualMinutes, row.pendingMinutes, row.overtimeMinutes]), [
        ['Worker', 120, 35, 0], ['Colleague', 30, 0, 30],
      ]);
      const report = await request(owner, '/order-effort?overrun=1&q=%231');
      assert.deepEqual(report.items.map(row => [row.id, row.deltaMinutes]), [[order.id, 30]]);
      assert.equal((await request(owner, '/order-effort?overrun=1&page=2')).total, 1);
      assert.deepEqual((await request(owner, '/order-effort?q=missing')).items, []);
      const csv = await request(owner, '/order-effort/export?overrun=1');
      assert.ok(csv.includes('1,"\'=Effort main, ""QA""",NEW,120,150,35,30,30'));
      assert.equal(csv.includes(other.title), false);

      assert.deepEqual(await allocate(legacy.id, other.id, 1), { version: 2 });
      assert.equal((await request(owner, effortPath)).actualMinutes, 120);
      assert.equal((await request(owner, '/orders/' + other.id + '/effort')).actualMinutes, 30);
      assert.deepEqual(await allocate(legacy.id, null, 2), { version: 3 });
      await allocate(legacy.id, order.id, 1, 409);
      assert.equal((await request(owner, '/orders/' + other.id + '/effort')).actualMinutes, 0);
      assert.deepEqual(await db.workTimeEntry.findUniqueOrThrow({ where: { id: legacy.id } }), historical);
      assert.equal(await request(owner, '/work-time/export?month=2025-11'), payroll);
      assert.equal(await db.auditEvent.count({ where: { ...scope, action: 'WORK_TIME_ORDER_CHANGED' } }), 3);
    });
  } finally {
    await db.workTimeMonth.deleteMany({ where: scope });
    await db.workTimeEntry.deleteMany({ where: scope });
    await db.businessTask.deleteMany({ where: scope });
    await db.order.deleteMany({ where: scope });
    await db.client.deleteMany({ where: scope });
    await db.auditEvent.deleteMany({ where: scope });
    await db.user.deleteMany({ where: scope });
    await db.organization.deleteMany({ where: { id: { in: [org, foreign] } } });
    await db.$disconnect();
  }
});
