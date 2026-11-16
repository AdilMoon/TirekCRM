import 'dotenv/config';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AuditService } from '../backend/dist/modules/audit/audit.service.js';
import { WorkTimeService } from '../backend/dist/modules/work-time/work-time.service.js';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 6 }) });
const audit = new AuditService({ client: db });
const workTime = new WorkTimeService({ client: db }, audit);
const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:4000/api';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const code = status => error => error.getStatus?.() === status;

async function actor(organizationId, role) {
  const user = await db.user.create({ data: {
    organizationId, role, name: 'Timesheet fixture ' + role,
    email: randomUUID() + '@timesheet.invalid', passwordHash: 'unused',
  } });
  const token = randomBytes(32).toString('hex');
  await db.session.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000),
  } });
  return { ...user, cookie: 'tirek_session=' + token };
}

async function request(path, user, method = 'GET', body, source = origin) {
  const response = await fetch(base + '/work-time' + path, {
    method, headers: { Origin: source, ...(user ? { Cookie: user.cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    body: contentType.startsWith('text/csv') ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer()) : await response.json(),
    cache: response.headers.get('cache-control'),
    attachment: response.headers.get('content-disposition'),
  };
}

const shift = (startsAt, endsAt) => ({ startsAt, endsAt, idempotencyKey: randomUUID() });
const overnight = shift('2025-10-31T18:30:00Z','2025-10-31T19:30:00Z');

test('actual work time preserves scope, month boundaries and review history', async t => {
  const org = randomUUID(), outside = randomUUID();
  try {
    await db.organization.createMany({ data: [{ id: org, name: 'Work time fixture' }, { id: outside, name: 'Outside work time fixture' }] });
    const owner = await actor(org, 'OWNER');
    const employee = await actor(org, 'EMPLOYEE');
    const colleague = await actor(org, 'EMPLOYEE');
    const external = await actor(outside, 'OWNER');
    let tracked;
    await t.test('only an authenticated employee can file their own time and owner can file for own employee', async () => {
      assert.equal((await request('?month=2025-10')).status, 401);
      assert.equal((await request('/people', employee)).status, 403);
      assert.equal((await request('', employee, 'POST', overnight, 'https://not-tirek.invalid')).status, 403);
      assert.equal((await request('', employee, 'POST', { ...overnight, employeeId: colleague.id })).status, 403);
      assert.equal((await request('', owner, 'POST', { ...overnight, employeeId: external.id })).status, 404);
      assert.equal((await request('', employee, 'POST', { ...overnight, minutes: 500 })).status, 400);
      assert.equal((await request('', employee, 'POST', shift('2025-02-31T12:00:00Z','2025-03-03T13:00:00Z'))).status, 400);
      assert.equal((await request('', employee, 'POST', shift('2099-01-01T12:00:00Z','2099-01-01T13:00:00Z'))).status, 400);
      assert.equal((await request('', employee, 'POST', shift('2025-10-31T18:30:01Z','2025-10-31T19:30:00Z'))).status, 400);
      const initial = await request('', employee, 'POST', overnight);
      assert.equal(initial.status, 201);
      tracked = initial.body;
      assert.equal(tracked.status, 'SUBMITTED');
      assert.equal(tracked.startsAt, '2025-10-31T18:30:00.000Z');
      assert.equal((await request('', owner, 'POST', { ...overnight, employeeId: colleague.id })).status, 201);
      const people = await request('/people', owner);
      assert.deepEqual(new Set(people.body.map(person => person.id)), new Set([employee.id, colleague.id]));
      assert.deepEqual(Object.keys(people.body[0]).sort(), ['id','isActive','name']);
    });
    await t.test('reads and totals use authorized records and split UTC time at each Almaty month', async () => {
      assert.equal((await request('?month=2025-10&employeeId=' + colleague.id, employee)).status, 403);
      assert.equal((await request('?month=2025-10&organizationId=' + outside, employee)).status, 400);
      assert.equal((await request('?month=2025-10&month=2025-11', owner)).status, 400);
      for (const month of ['2025-10','2025-11']) {
        const own = await request('?month=' + month, employee);
        assert.equal(own.cache, 'no-store');
        assert.deepEqual(own.body.items.map(entry => entry.id), [tracked.id]);
        assert.equal(own.body.items[0].startsAt, tracked.startsAt);
        assert.equal(own.body.summary.approvedMinutes, 0);
        assert.equal(own.body.summary.submittedMinutes, 30);
        assert.equal(own.body.items[0].monthMinutes, 30);
        const all = await request('?month=' + month + '&status=APPROVED', owner);
        assert.equal(all.body.total, 0);
        assert.equal(all.body.summary.submittedMinutes, 60);
        assert.equal((await request('?month=' + month, external)).body.total, 0);
      }
      const filtered = await request('?month=2025-10&employeeId=' + colleague.id, owner);
      assert.equal(filtered.body.total, 1);
      assert.equal(filtered.body.summary.submittedMinutes, 30);
    });
    await t.test('overlaps fail while adjacent intervals and exact concurrent retries work', async () => {
      const same = await Promise.all([workTime.create(employee, overnight), workTime.create(employee, overnight)]);
      assert.deepEqual(same.map(entry => entry.id), [tracked.id, tracked.id]);
      assert.equal((await request('', employee, 'POST', { ...overnight, endsAt: '2025-10-31T19:31:00Z' })).status, 409);
      assert.equal((await request('', employee, 'POST', shift('2025-10-31T18:29:00Z','2025-10-31T18:31:00Z'))).status, 409);
      const start = '2025-10-31T19:30:00Z', finish = '2025-10-31T20:00:00Z';
      const input = shift(start,finish);
      const sameNew = await Promise.all([workTime.create(employee, input), workTime.create(employee, input)]);
      assert.equal(sameNew[0].id, sameNew[1].id);
      const parallel = await Promise.allSettled([
        workTime.create(employee, shift('2025-10-31T20:00:00Z','2025-10-31T21:01:00Z')),
        workTime.create(employee, shift('2025-10-31T20:30:00Z','2025-10-31T22:00:00Z')),
      ]);
      assert.equal(parallel.filter(item => item.status === 'fulfilled').length, 1);
      assert.ok(code(409)(parallel.find(item => item.status === 'rejected').reason));
      await assert.rejects(() => db.workTimeEntry.create({ data: {
        organizationId: org, employeeId: employee.id, createdById: employee.id,
        startsAt: new Date(start), endsAt: new Date(finish), idempotencyKey: randomUUID(),
      } }));
    });
    await t.test('owner review is versioned, fallback after void allows corrected time, audit failure rolls back', async () => {
      const path = '/' + tracked.id + '/decision';
      const approval = { status: 'APPROVED', version: 1 };
      assert.equal((await request(path, employee, 'PATCH', approval)).status, 403);
      assert.equal((await request(path, external, 'PATCH', approval)).status, 404);
      assert.equal((await request(path, owner, 'PATCH', { status: 'REJECTED', version: 1, note: '\u0000' })).status, 400);
      const broken = new WorkTimeService({ client: db }, { record: async () => { throw Error('audit fixture'); } });
      await assert.rejects(() => broken.decide(owner, tracked.id, approval), /audit fixture/);
      assert.equal((await db.workTimeEntry.findUniqueOrThrow({ where: { id: tracked.id } })).version, 1);
      const [first, replay] = await Promise.all([request(path, owner, 'PATCH', approval), request(path, owner, 'PATCH', approval)]);
      assert.equal(first.status, 200);
      assert.deepEqual(first.body, replay.body);
      assert.equal(first.body.version, 2);
      assert.equal((await request('?month=2025-10', employee)).body.summary.approvedMinutes, 30);
      assert.equal((await request(path, owner, 'PATCH', { status: 'REJECTED', version: 1, note: 'Earlier decision' })).status, 409);
      const voided = await request(path, owner, 'PATCH', { status: 'VOIDED', version: 2, note: 'Correct recorded minutes' });
      assert.equal(voided.status, 200);
      assert.equal((await request('?month=2025-11', employee)).body.summary.approvedMinutes, 0);
      assert.equal((await request('', employee, 'POST', overnight)).body.status, 'VOIDED');
      const correction = await request('', employee, 'POST', shift('2025-10-31T18:45:00Z','2025-10-31T19:15:00Z'));
      assert.equal(correction.status, 201);
      const rejected = await request('/' + correction.body.id + '/decision', owner, 'PATCH', { status: 'REJECTED', version: 1, note: 'Please confirm timing' });
      assert.equal(rejected.status, 200);
      const events = await db.auditEvent.findMany({ where: { organizationId: org, entityId: tracked.id } });
      assert.equal(events.length, 3);
      assert.equal(JSON.stringify(events).includes('Correct recorded minutes'), false);
      await db.user.update({ where: { id: employee.id }, data: { isActive: false } });
      await assert.rejects(() => workTime.create(employee, overnight), code(403));
      assert.ok((await request('?month=2025-10&employeeId=' + employee.id, owner)).body.items.length > 0);
    });
    await t.test('night and overtime can coincide; absence is separate across an Almaty month boundary', async () => {
      await db.user.update({ where: { id: colleague.id }, data: { name: ' =1+2' } });
      const input = { ...shift('2025-12-31T16:30:00Z','2026-01-01T02:00:00Z'), kind: 'OVERTIME' };
      const worked = await workTime.create(colleague, input);
      await assert.rejects(() => workTime.create(colleague, { ...input, kind: 'WORK' }), code(409));
      await workTime.decide(owner, worked.id, { status: 'APPROVED', version: 1 });
      const absence = await workTime.create(colleague, { ...shift('2025-12-15T17:00:00Z','2025-12-15T18:00:00Z'), kind: 'ABSENCE' });
      await workTime.decide(owner, absence.id, { status: 'APPROVED', version: 1 });
      const dec = await request('?month=2025-12', colleague);
      const jan = await request('?month=2026-01', colleague);
      assert.deepEqual(dec.body.summary, {
        approvedMinutes: 150, submittedMinutes: 0, approvedOvertimeMinutes: 150, approvedNightMinutes: 120, approvedAbsenceMinutes: 60,
      });
      assert.equal(jan.body.summary.approvedMinutes, 420);
      assert.equal(jan.body.summary.approvedOvertimeMinutes, 420);
      assert.equal(jan.body.summary.approvedNightMinutes, 360);
      assert.equal(dec.body.items.find(entry => entry.id === absence.id).nightMinutes, 0);
      assert.equal(jan.body.items[0].monthMinutes, 420);
      // The 2024 clock rollback added one elapsed hour to the local 22:00–06:00 night.
      const clockChange = await workTime.create(colleague, shift('2024-02-29T16:00:00Z','2024-03-01T01:00:00Z'));
      await workTime.decide(owner, clockChange.id, { status: 'APPROVED', version: 1 });
      const feb = (await request('?month=2024-02', colleague)).body.summary;
      const mar = (await request('?month=2024-03', colleague)).body.summary;
      assert.equal(feb.approvedNightMinutes + mar.approvedNightMinutes, 540);
    });
    await t.test('closing is atomic and freezes a tenant-scoped, formula-safe CSV for the whole month', async () => {
      const month = '2025-12';
      const exportPath = '/export?month=' + month;
      assert.equal((await request(exportPath, colleague)).status, 403);
      assert.equal((await request(exportPath, external)).status, 409);
      const openExport = await request(exportPath, owner);
      assert.equal(openExport.status, 409);
      assert.equal(openExport.attachment, null);
      assert.equal((await request('/close', colleague, 'POST', { month })).status, 403);
      assert.equal((await request('/close', owner, 'POST', { month, organizationId: outside })).status, 400);
      assert.equal((await request('/close', owner, 'POST', { month: '2099-01' })).status, 409);
      const pending = await workTime.create(colleague, shift('2025-12-12T12:00:00Z','2025-12-12T13:00:00Z'));
      assert.equal((await request('/close', owner, 'POST', { month })).status, 409);
      await workTime.decide(owner, pending.id, { status: 'REJECTED', version: 1, note: 'Invalid interval' });
      const broken = new WorkTimeService({ client: db }, { record: async () => { throw Error('closing audit fixture'); } });
      await assert.rejects(() => broken.closeMonth(owner, month), /closing audit fixture/);
      assert.equal(await db.workTimeMonth.count({ where: { organizationId: org, month } }), 0);
      const race = await Promise.allSettled([
        workTime.closeMonth(owner, month),
        workTime.create(colleague, shift('2025-12-13T12:00:00Z','2025-12-13T13:00:00Z')),
      ]);
      assert.equal(race.filter(value => value.status === 'fulfilled').length, 1);
      if (race[1].status === 'fulfilled') {
        assert.ok(code(409)(race[0].reason));
        await workTime.decide(owner, race[1].value.id, { status: 'REJECTED', version: 1, note: 'Race fixture' });
      } else assert.ok(code(409)(race[1].reason));
      const closed = await request('/close', owner, 'POST', { month });
      assert.equal(closed.status, 201);
      assert.equal((await request('/close', owner, 'POST', { month })).body.closedAt, closed.body.closedAt);
      assert.equal((await request('?month=2025-12', colleague)).body.period.closedAt, closed.body.closedAt);
      const crossing = (await request('?month=2026-01', colleague)).body.items[0];
      assert.equal(crossing.locked, true);
      assert.equal((await request('/' + crossing.id + '/decision', owner, 'PATCH', { status: 'VOIDED', version: 2, note: 'Blocked by closure' })).status, 409);
      assert.equal((await request('', colleague, 'POST', shift('2025-12-12T12:00:00Z','2025-12-12T13:00:00Z'))).status, 409);
      const exported = await request(exportPath, owner);
      assert.equal(exported.status, 200);
      assert.equal(exported.cache, 'no-store');
      assert.equal(exported.attachment, 'attachment; filename="tirek-timesheet-2025-12.csv"');
      assert.equal(exported.body.codePointAt(0), 0xfeff);
      assert.ok(exported.body.includes(`"2025-12","${colleague.id}","' =1+2",150,150,120,60\r\n`));
      assert.equal(exported.body.includes('Invalid interval'), false);
      await db.user.update({ where: { id: colleague.id }, data: { name: 'New name' } });
      assert.equal((await request(exportPath, owner)).body, exported.body);
      assert.equal(await db.auditEvent.count({ where: { organizationId: org, action: 'WORK_TIME_MONTH_CLOSED' } }), 1);
    });
  } finally {
    const owned = { organizationId: { in: [org, outside] } };
    await db.workTimeMonth.deleteMany({ where: owned });
    await db.workTimeEntry.deleteMany({ where: owned });
    await db.auditEvent.deleteMany({ where: owned });
    await db.user.deleteMany({ where: owned });
    await db.organization.deleteMany({ where: { id: { in: [org, outside] } } });
    await db.$disconnect();
  }
});
