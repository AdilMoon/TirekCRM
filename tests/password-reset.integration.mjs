import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PasswordResetService } from '../backend/dist/auth/password-reset.service.js';
import { localResetMailbox } from '../backend/dist/auth/password-reset-delivery.js';
import { AuthService } from '../backend/dist/auth/auth.service.js';
import { AuditService } from '../backend/dist/modules/audit/audit.service.js';
import { digest, hashPassword, verifyPassword } from '../backend/dist/auth/session.guard.js';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 6 }) });
const audit = new AuditService({ client: db }), auth = new AuthService({ client: db }, audit);
const orgs = [], users = [], servers = [], originalPassword = 'OriginalRecovery2026!', newPassword = 'ChangedRecovery2026!';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
function fixtureService() {
  const messages = [];
  const service = new PasswordResetService({ client: db }, audit, { enabled: true, send: async message => { messages.push(message); } });
  return { service, messages };
}
async function user(role = 'OWNER', isActive = true) {
  const id = randomUUID(); orgs.push(id);
  const org = await db.organization.create({ data: { id, name: 'Recovery QA', users: { create: { name: 'Recovery ' + role, role, isActive, email: randomUUID() + '@recovery.invalid', passwordHash: await hashPassword(originalPassword) } } }, include: { users: true } });
  users.push(org.users[0]); return org.users[0];
}
async function session(actor) {
  const token = randomBytes(32).toString('hex');
  await db.session.create({ data: { userId: actor.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 3600000) } });
  return token;
}
async function issue(actor, fixture = fixtureService()) {
  assert.deepEqual(await fixture.service.request(actor.email), { ok: true });
  assert.equal(fixture.messages.length, 1);
  return { ...fixture, token: fixture.messages[0].token };
}
async function isolatedApi(env = {}) {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['backend/dist/main.js'], { env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: String(port), ...env }, stdio: 'ignore', windowsHide: true });
  let spawnError; child.on('error', error => { spawnError = error; });
  const exited = new Promise(resolve => child.once('close', resolve));
  const stop = async () => { if (child.exitCode === null && !spawnError) child.kill(); await exited; };
  const url = `http://127.0.0.1:${port}/api`;
  try {
    for (let i = 0; i < 80; i++) {
      if (spawnError) throw spawnError; if (child.exitCode !== null) throw Error('Recovery test API exited');
      try { if ((await fetch(url + '/health', { signal: AbortSignal.timeout(500) })).ok) { const server = { url, stop }; servers.push(server); return server; } } catch {}
      await delay(150);
    }
    throw Error('Recovery test API readiness timeout');
  } catch (error) { await stop(); throw error; }
}
async function request(server, route, body, source = origin, extra = {}) {
  const r = await fetch(server.url + '/auth/password-reset/' + route, { method: body ? 'POST' : 'GET', headers: { ...(source ? { Origin: source } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
const rejected400 = error => error.getStatus?.() === 400;
async function mailbox(actor) {
  const result = [];
  for (const name of await readdir(localResetMailbox).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!name.endsWith('.json')) continue;
    const file = join(localResetMailbox, name), message = JSON.parse(await readFile(file, 'utf8'));
    if (message.to === actor.email) result.push({ file, message });
  }
  return result;
}

test('password recovery is single-use, account-scoped and does not disclose existence or tokens', async t => {
  try {
    await t.test('request is generic, throttled per account and stores only a token hash', async () => {
      const actor = await user(), inactive = await user('EMPLOYEE', false), fixture = fixtureService();
      for (const email of [actor.email, randomUUID() + '@unknown.invalid', inactive.email, actor.email.toUpperCase()]) assert.deepEqual(await fixture.service.request(email), { ok: true });
      assert.equal(fixture.messages.length, 1); assert.equal(await db.passwordReset.count({ where: { userId: inactive.id } }), 0);
      const token = fixture.messages[0].token, stored = await db.passwordReset.findUniqueOrThrow({ where: { userId: actor.id } });
      assert.match(token, /^[a-f0-9]{64}$/); assert.equal(stored.tokenHash, digest(token));
      assert.equal(stored.expiresAt.getTime() - stored.requestedAt.getTime(), 15 * 60 * 1000);
      assert.ok(!JSON.stringify(stored).includes(token)); assert.equal(stored.credentialHash, digest(actor.passwordHash));
      assert.equal(await db.session.count({ where: { userId: actor.id } }), 0);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).passwordHash, actor.passwordHash);
    });
    await t.test('parallel requests yield one token and rotation invalidates an older delivery', async () => {
      const actor = await user(), fixture = fixtureService();
      await Promise.all([1, 2, 3].map(() => fixture.service.request(actor.email))); assert.equal(fixture.messages.length, 1);
      const old = fixture.messages[0].token;
      await db.passwordReset.update({ where: { userId: actor.id }, data: { requestedAt: new Date(Date.now() - 61000) } });
      await fixture.service.request(actor.email); assert.equal(fixture.messages.length, 2);
      await assert.rejects(() => fixture.service.confirm(old, newPassword), rejected400);
      assert.deepEqual(await fixture.service.confirm(fixture.messages[1].token, newPassword), { ok: true });
    });
    await t.test('confirmation changes only the target credentials, revokes all its sessions and does not auto-login', async () => {
      const actor = await user('EMPLOYEE'), foreign = await user();
      const oldToken = await session(actor); await session(actor); await session(foreign);
      const issued = await issue(actor); assert.deepEqual(await issued.service.confirm(issued.token.toUpperCase(), newPassword), { ok: true });
      assert.equal(await db.session.count({ where: { userId: actor.id } }), 0); assert.equal(await db.session.count({ where: { userId: foreign.id } }), 1);
      const changed = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
      assert.equal(changed.role, 'EMPLOYEE'); assert.equal(changed.organizationId, actor.organizationId); assert.equal(await verifyPassword(newPassword, changed.passwordHash), true);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: foreign.id } })).passwordHash, foreign.passwordHash);
      await assert.rejects(() => auth.login(actor.email, originalPassword, 'Old password'), e => e.getStatus?.() === 401);
      assert.equal(await db.session.count({ where: { tokenHash: digest(oldToken) } }), 0);
      const events = await db.auditEvent.findMany({ where: { entityId: actor.id } }); assert.equal(events.length, 1);
      assert.equal(events[0].action, 'PASSWORD_CHANGED'); assert.deepEqual(events[0].metadata, { method: 'recovery' });
      const serialized = JSON.stringify(events); for (const secret of [issued.token, digest(issued.token), originalPassword, newPassword, changed.passwordHash]) assert.ok(!serialized.includes(secret));
      await assert.rejects(() => issued.service.confirm(issued.token, newPassword + 'again'), rejected400);
    });
    await t.test('expired, disabled and stale-credential tokens share one rejection and do not mutate sessions', async () => {
      const actor = await user(), issued = await issue(actor); const token = await session(actor);
      await db.passwordReset.update({ where: { userId: actor.id }, data: { requestedAt: new Date(Date.now() - 100000), expiresAt: new Date(Date.now() - 1) } });
      await assert.rejects(() => issued.service.confirm(issued.token, newPassword), rejected400);
      assert.equal(await db.session.count({ where: { tokenHash: digest(token) } }), 1);
      const inactive = await user(), disabled = await issue(inactive); await db.user.update({ where: { id: inactive.id }, data: { isActive: false } });
      await assert.rejects(() => disabled.service.confirm(disabled.token, newPassword), rejected400);
      const stale = await user(), staleToken = await issue(stale); await db.user.update({ where: { id: stale.id }, data: { passwordHash: await hashPassword('OtherChange2026!') } });
      await assert.rejects(() => staleToken.service.confirm(staleToken.token, newPassword), rejected400);
    });
    await t.test('two concurrent confirmations produce one success and one invalid token', async () => {
      const actor = await user(), issued = await issue(actor);
      const results = await Promise.allSettled([newPassword, newPassword + 'other'].map(password => issued.service.confirm(issued.token, password)));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected' && rejected400(r.reason)).length, 1);
      assert.equal(await db.auditEvent.count({ where: { entityId: actor.id } }), 1); assert.equal(await db.passwordReset.count({ where: { userId: actor.id } }), 0);
    });
    await t.test('normal password changes invalidate recovery; audit failure rolls back password, sessions and consumption', async () => {
      const actor = await user(), issued = await issue(actor), token = await session(actor);
      await auth.changePassword(actor, digest(token), originalPassword, newPassword, 'Changed browser');
      assert.equal(await db.passwordReset.count({ where: { userId: actor.id } }), 0);
      await assert.rejects(() => issued.service.confirm(issued.token, newPassword + 'other'), rejected400);
      const rollback = await user(), pending = await issue(rollback), oldToken = await session(rollback);
      const broken = new PasswordResetService({ client: db }, { record: () => { throw Error('audit outage'); } }, { enabled: true });
      await assert.rejects(() => broken.confirm(pending.token, newPassword), /audit outage/);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: rollback.id } })).passwordHash, rollback.passwordHash);
      assert.equal(await db.passwordReset.count({ where: { userId: rollback.id } }), 1); assert.equal(await db.session.count({ where: { tokenHash: digest(oldToken) } }), 1);
      assert.deepEqual(await pending.service.confirm(pending.token, newPassword), { ok: true });
    });
    await t.test('an old-password login paused before its transaction cannot survive a reset', async () => {
      const actor = await user(), issued = await issue(actor); let release, enter;
      const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { enter = resolve; });
      const delayed = new AuthService({ client: { user: db.user, $transaction: async (...args) => { enter(); await gate; return db.$transaction(...args); } } }, audit);
      const pending = delayed.login(actor.email, originalPassword, 'Paused old login'), checked = assert.rejects(pending, e => e.getStatus?.() === 401);
      try { await entered; await issued.service.confirm(issued.token, newPassword); } finally { release(); }
      await checked; assert.equal(await db.session.count({ where: { userId: actor.id } }), 0);
    });
    await t.test('ordinary password change racing recovery has one winner', async () => {
      const actor = await user(), issued = await issue(actor), token = await session(actor);
      const results = await Promise.allSettled([
        auth.changePassword(actor, digest(token), originalPassword, newPassword, 'Racing browser'),
        issued.service.confirm(issued.token, newPassword + 'Recovery'),
      ]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter(r => r.status === 'rejected' && [400, 401].includes(r.reason.getStatus?.())).length, 1);
      assert.equal(await db.auditEvent.count({ where: { entityId: actor.id } }), 1);
      assert.equal(await db.passwordReset.count({ where: { userId: actor.id } }), 0);
    });
    await t.test('delayed failure of an older delivery never removes a newer reset token', async () => {
      const actor = await user(), logs = []; let enter, release, calls = 0, second;
      const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
      const reset = new PasswordResetService({ client: db }, audit, { enabled: true, send: async message => {
        if (++calls === 1) { enter(); await gate; throw Error('Old delivery failed'); } second = message.token;
      } });
      reset.logger = { warn: text => logs.push(text), error: text => logs.push(text) };
      const pending = reset.request(actor.email);
      try {
        await entered;
        await db.passwordReset.update({ where: { userId: actor.id }, data: { requestedAt: new Date(Date.now() - 61000) } });
        await reset.request(actor.email);
      } finally { release(); }
      await pending;
      assert.equal((await db.passwordReset.findUniqueOrThrow({ where: { userId: actor.id } })).tokenHash, digest(second));
      assert.deepEqual(await reset.confirm(second, newPassword), { ok: true });
      assert.deepEqual(logs, ['PASSWORD_RESET_DELIVERY_FAILED']);
    });
    await t.test('delivery failure is generic, revokes the failed token and logs no secrets', async () => {
      const actor = await user(), logs = []; let secret;
      const failed = new PasswordResetService({ client: db }, audit, { enabled: true, send: async message => { secret = message.token; throw Error(message.to + message.token); } });
      failed.logger = { warn: text => logs.push(text), error: text => logs.push(text) };
      assert.deepEqual(await failed.request(actor.email), { ok: true }); assert.equal(await db.passwordReset.count({ where: { userId: actor.id } }), 0);
      assert.deepEqual(logs, ['PASSWORD_RESET_DELIVERY_FAILED']); assert.ok(!logs.join().includes(actor.email)); assert.ok(!logs.join().includes(secret));
    });
    await t.test('HTTP response, local outbox and actual request limit do not disclose account existence', async () => {
      const server = await isolatedApi({ PASSWORD_RESET_DELIVERY: 'local' }), actor = await user(), inactive = await user('EMPLOYEE', false), other = await user();
      assert.deepEqual((await request(server, 'status')).body, { enabled: true });
      for (const email of [actor.email, randomUUID() + '@unknown.invalid', inactive.email, actor.email, other.email]) {
        const response = await request(server, 'request', { email }); assert.equal(response.status, 202); assert.deepEqual(response.body, { ok: true });
        assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('set-cookie'), null);
      }
      const limited = await request(server, 'request', { email: actor.email }); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
      const mail = await mailbox(actor); assert.equal(mail.length, 1); assert.equal((await mailbox(inactive)).length, 0);
      assert.equal(mail[0].message.confirmationEndpoint, origin + '/api/auth/password-reset/confirm');
      const confirmed = await request(server, 'confirm', { token: mail[0].message.token, newPassword });
      assert.equal(confirmed.status, 200); assert.deepEqual(confirmed.body, { ok: true }); assert.equal(confirmed.headers.get('set-cookie'), null);
    });
    await t.test('Origin, strict input, replay and confirm rate limits are enforced; disabled delivery fails closed', async () => {
      const server = await isolatedApi({ PASSWORD_RESET_DELIVERY: 'local' }), actor = await user(), issued = await issue(actor);
      for (const source of ['', 'https://evil.invalid']) assert.equal((await request(server, 'confirm', { token: issued.token, newPassword }, source)).status, 403);
      for (const extra of [{ token: 'bad' }, { newPassword: 'short' }, { organizationId: actor.organizationId }, { email: actor.email }]) assert.equal((await request(server, 'confirm', { token: issued.token, newPassword, ...extra })).status, 400);
      assert.equal((await request(server, 'confirm', { token: issued.token, newPassword })).status, 200);
      for (let i = 0; i < 3; i++) assert.equal((await request(server, 'confirm', { token: issued.token, newPassword })).status, 400);
      const limited = await request(server, 'confirm', { token: issued.token, newPassword }); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
      const disabled = await isolatedApi({ PASSWORD_RESET_DELIVERY: 'disabled' });
      assert.deepEqual((await request(disabled, 'status')).body, { enabled: false });
      assert.equal((await request(disabled, 'request', { email: actor.email })).status, 503);
      assert.equal((await request(disabled, 'confirm', { token: issued.token, newPassword })).status, 503);
    });
  } finally {
    for (const server of servers) await server.stop();
    for (const actor of users) for (const mail of await mailbox(actor)) await unlink(mail.file);
    for (const organizationId of orgs) { await db.user.deleteMany({ where: { organizationId } }); await db.organization.deleteMany({ where: { id: organizationId } }); }
    await db.$disconnect();
  }
});
