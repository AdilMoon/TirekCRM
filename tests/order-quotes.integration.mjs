import 'dotenv/config';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AuditService } from '../backend/dist/modules/audit/audit.service.js';
import { OrderQuotesService } from '../backend/dist/modules/order-quotes/order-quotes.service.js';
import { TelegramProcessor } from '../backend/dist/modules/telegram/telegram-processor.js';
import { TelegramService } from '../backend/dist/modules/telegram/telegram.service.js';
import { TelegramTransportError } from '../backend/dist/modules/telegram/telegram-transport.js';
import { TelegramWorker } from '../backend/dist/modules/telegram/telegram-worker.js';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 6 }) });
const audit = new AuditService({ client: db });
const quotes = new OrderQuotesService({ client: db }, audit);
const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:4000/api';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const tokenFromLink = body => new URLSearchParams(new URL(body.url).hash.slice(1)).get('token');
const botId = String(BigInt('0x' + randomBytes(6).toString('hex')));

const transport = {
  config: { enabled: true, botId },
  messages: [],
  failNext: false,
  async me() { return { id: Number(botId), username: 'quote_fixture_bot' }; },
  async call(method) {
    if (method === 'getWebhookInfo') return { url: '' };
    if (method === 'getUpdates') return [];
    throw new Error('Unexpected bot call in quote test');
  },
  async send(chatId, text, buttons) {
    if (this.failNext) {
      this.failNext = false;
      throw new TelegramTransportError(429, 1);
    }
    this.messages.push({ chatId, text, buttons });
    return { message_id: this.messages.length };
  },
};
const telegram = new TelegramService({ client: db }, transport, audit);
const processor = new TelegramProcessor({ client: db }, telegram, transport, null, null);
const worker = new TelegramWorker({ client: db }, transport, processor, telegram);

async function user(organizationId, role) {
  const actor = await db.user.create({ data: {
    organizationId, role, name: 'Quote fixture ' + role, email: randomUUID() + '@quote.invalid', passwordHash: 'unused',
  } });
  const token = randomBytes(32).toString('hex');
  await db.session.create({ data: {
    userId: actor.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000),
  } });
  return { ...actor, cookie: 'tirek_session=' + token };
}

async function req(path, body, user, method = 'POST', source = origin) {
  const result = await fetch(base + path, {
    method, headers: { Origin: source, ...(user ? { Cookie: user.cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: result.status, body: await result.json(), cache: result.headers.get('cache-control') };
}

test('quotes preserve approved terms, exact totals, scoped access and Telegram delivery', async t => {
  const organizationId = randomUUID(), otherOrg = randomUUID();
  try {
    await db.organization.createMany({ data: [{ id: organizationId, name: 'Quote fixture' }, { id: otherOrg, name: 'Foreign quote fixture' }] });
    const owner = await user(organizationId, 'OWNER');
    const employee = await user(organizationId, 'EMPLOYEE');
    const colleague = await user(organizationId, 'EMPLOYEE');
    const foreign = await user(otherOrg, 'OWNER');
    const client = await db.client.create({ data: {
      organizationId, name: 'Private client fixture', phone: '+77005550123', email: 'private-client@quote.invalid',
    } });
    const orderInput = {
      title: 'Cleaning fixture', clientId: client.id, notes: 'Private order note',
      items: [{ description: 'Standard cleaning', quantity: 1, unitPrice: '25000.00' }],
    };
    const created = await req('/orders', orderInput, owner);
    assert.equal(created.status, 201);
    const orderId = created.body.id, path = '/orders/' + orderId, quotePath = path + '/quotes';
    const activeTask = { organizationId, createdById: owner.id, orderId, title: 'Cleaning task' };
    await db.businessTask.createMany({ data: [
      { ...activeTask, assigneeId: employee.id }, { ...activeTask, assigneeId: employee.id },
      { ...activeTask, assigneeId: colleague.id }, { ...activeTask, assigneeId: colleague.id, status: 'DONE' },
    ] });
    const link = await db.telegramLink.create({ data: {
      organizationId, userId: employee.id, telegramUserId: '876540001', botId, displayName: 'Fixture', username: 'fixture',
    } });
    const current = async () => (await req(path, undefined, owner, 'GET')).body;
    const extra = async () => ({
      kind: 'EXTRA', orderVersion: (await current()).version,
      items: [{ description: 'Window cleaning', quantity: 2, unitPrice: '3000.01' }],
    });
    const publish = async kind => req(quotePath, kind === 'BASE' ? { kind, orderVersion: (await current()).version } : await extra(), owner);
    const accept = (token, revision) => req('/quote/accept', { token, revision, agreed: true });
    let baseToken, extraToken, extraId;

    await t.test('owner issues one private link, and changed terms or wrong revision cannot be approved', async () => {
      assert.equal((await req(quotePath, undefined, undefined, 'GET')).status, 401);
      assert.equal((await req(quotePath, undefined, employee, 'GET')).status, 403);
      assert.equal((await req(quotePath, undefined, foreign, 'GET')).status, 404);
      assert.equal((await req(quotePath, await extra(), owner)).status, 409);
      assert.equal((await req(quotePath, { kind: 'BASE', orderVersion: 1, organizationId }, owner)).status, 400);
      const competing = await Promise.all([publish('BASE'), publish('BASE')]);
      assert.deepEqual(competing.map(value => value.status).sort(), [201,409]);
      const issue = competing.find(value => value.status === 201).body;
      const token = tokenFromLink(issue);
      assert.equal(new URL(issue.url).pathname, '/quote');
      const row = await db.orderQuote.findUniqueOrThrow({ where: { id: issue.id } });
      assert.notEqual(row.tokenHash, token);
      assert.equal((await req(path + '/status', { status: 'CONFIRMED' }, owner, 'PATCH')).status, 409);
      assert.equal((await accept(token, 2)).status, 409);
      const publicView = await req('/quote/read', { token });
      assert.equal(publicView.status, 200);
      assert.equal(publicView.cache, 'no-store');
      const json = JSON.stringify(publicView.body);
      for (const value of [client.name, client.phone, client.email, orderInput.notes, client.id, row.tokenHash, token]) {
        assert.equal(json.includes(value), false);
      }
      assert.equal((await req('/quote/accept', { token, revision: 1, agreed: false })).status, 400);
      assert.equal((await req('/quote/accept', { token, revision: 1, agreed: true }, undefined, 'POST', 'https://other.invalid')).status, 403);
      assert.equal((await req(path, { ...orderInput, title: 'Changed title', version: 1 }, owner, 'PATCH')).status, 200);
      assert.equal((await req('/quote/read', { token })).body.status, 'STALE');
      assert.equal((await accept(token, 1)).status, 409);
      assert.equal((await req(quotePath + '/' + issue.id + '/link', undefined, foreign, 'DELETE')).status, 404);
      assert.equal((await req(quotePath + '/' + issue.id + '/link', undefined, owner, 'DELETE')).status, 200);
      assert.equal((await req('/quote/read', { token })).status, 404);
    });

    await t.test('base approval is atomic and repeated extra approval applies exact prices once', async () => {
      const issued = await publish('BASE');
      baseToken = tokenFromLink(issued.body);
      const broken = new OrderQuotesService({ client: db }, { record: async () => { throw Error('audit fixture'); } });
      await assert.rejects(() => broken.accept(baseToken, 2), /audit fixture/);
      assert.equal((await current()).status, 'NEW');
      assert.equal(await db.notification.count({ where: { organizationId, kind: 'ORDER_QUOTE_ACCEPTED' } }), 0);
      const baseApproved = await accept(baseToken, 2);
      assert.equal(baseApproved.status, 200);
      assert.equal((await current()).status, 'CONFIRMED');
      assert.equal((await req(path, { ...orderInput, version: (await current()).version }, owner, 'PATCH')).status, 409);
      transport.failNext = true;
      await worker.runOnce();
      const notice = await db.telegramDelivery.findFirstOrThrow({ where: { linkId: link.id, notification: { orderQuoteId: issued.body.id } } });
      assert.equal(notice.status, 'PENDING');
      await db.telegramDelivery.update({ where: { id: notice.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await worker.runOnce();
      assert.equal((await db.telegramDelivery.findUniqueOrThrow({ where: { id: notice.id } })).status, 'SENT');
      assert.match(transport.messages[0].text, /согласовал смету/);

      const added = await publish('EXTRA');
      assert.equal(added.status, 201);
      extraId = added.body.id;
      extraToken = tokenFromLink(added.body);
      assert.equal((await current()).total, '25000.00');
      assert.equal((await req(path + '/payments', { amount: '100.00', idempotencyKey: randomUUID() }, owner)).status, 201);
      const result = await Promise.all([accept(extraToken, 3), accept(extraToken, 3)]);
      assert.ok(result.every(value => value.status === 200));
      assert.deepEqual(result[0].body, result[1].body);
      const verified = await current();
      assert.equal(verified.total, '31000.02');
      assert.equal(verified.debt, '30900.02');
      assert.equal(verified.items.length, 2);
      assert.equal((await req('/quote/read', { token: baseToken })).body.snapshot.afterTotal, '25000.00');
      const notifications = await db.notification.findMany({ where: { organizationId, orderQuoteId: extraId } });
      assert.deepEqual(new Set(notifications.map(item => item.recipientId)), new Set([employee.id, colleague.id]));
      assert.equal(notifications.length, 2);
      assert.equal(await db.telegramDelivery.count({ where: { notification: { orderQuoteId: extraId } } }), 1);
      await worker.runOnce();
      await worker.runOnce();
      const message = transport.messages[1];
      assert.match(message.text, /согласовал допработы/);
      assert.match(message.text, /2 × Window cleaning/);
      assert.match(message.buttons[0][0].callback_data, /^task:/);
      assert.equal(message.text.includes('3000.01') || message.text.includes(extraToken), false);
      assert.equal(transport.messages.length, 2);
      const auditRows = await db.auditEvent.findMany({ where: { organizationId, action: 'ORDER_QUOTE_ACCEPTED' } });
      assert.equal(auditRows.length, 2);
      assert.equal(JSON.stringify(auditRows).includes(extraToken), false);
    });

    await t.test('expiry and reassignment invalidate stale deliveries; revoking an accepted link leaves the order intact', async () => {
      const pending = await publish('EXTRA');
      const expiredToken = tokenFromLink(pending.body);
      await db.orderQuote.update({ where: { id: pending.body.id }, data: {
        createdAt: new Date(Date.now() - 864000000), expiresAt: new Date(Date.now() - 1000),
      } });
      assert.equal((await accept(expiredToken, 4)).status, 404);
      const next = await publish('EXTRA');
      assert.equal(next.status, 201);
      assert.equal((await accept(tokenFromLink(next.body), 5)).status, 200);
      await db.businessTask.updateMany({ where: { organizationId, orderId, assigneeId: employee.id }, data: { assigneeId: colleague.id } });
      await worker.runOnce();
      assert.equal(transport.messages.length, 2);
      assert.equal((await db.telegramDelivery.findFirstOrThrow({ where: { notification: { orderQuoteId: next.body.id } } })).status, 'SKIPPED');
      assert.equal((await req(quotePath + '/' + extraId + '/link', undefined, owner, 'DELETE')).status, 200);
      assert.equal((await req('/quote/read', { token: extraToken })).status, 404);
      assert.equal((await current()).total, '37000.04');
      const list = await req(quotePath, undefined, owner, 'GET');
      assert.ok(list.body.entries.find(entry => entry.id === extraId).acceptedAt);
      assert.equal(JSON.stringify(list.body).includes(extraToken), false);
    });
  } finally {
    const where = { organizationId: { in: [organizationId, otherOrg] } };
    await db.telegramBotState.deleteMany({ where: { botId } });
    await db.businessTask.deleteMany({ where });
    await db.payment.deleteMany({ where });
    await db.order.deleteMany({ where });
    await db.client.deleteMany({ where });
    await db.auditEvent.deleteMany({ where });
    await db.user.deleteMany({ where });
    await db.organization.deleteMany({ where: { id: { in: [organizationId, otherOrg] } } });
    await db.$disconnect();
  }
});
