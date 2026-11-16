import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, test } from './fixtures';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const organizationId = randomUUID();
let ownerToken: string;

test.beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, name: 'Tirek Cleaning' } });
  const owner = await db.user.create({ data: {
    organizationId, name: 'Quote manager', role: 'OWNER', email: randomUUID() + '@quotes-browser.invalid', passwordHash: 'unused',
  } });
  ownerToken = randomBytes(32).toString('hex');
  await db.session.create({ data: { userId: owner.id, tokenHash: createHash('sha256').update(ownerToken).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
  const client = await db.client.create({ data: { organizationId, name: 'Hidden customer', phone: '+77005550987' } });
  await db.order.create({ data: {
    organizationId, clientId: client.id, number: 1, title: 'Уборка после ремонта', total: '25000.00',
    items: { create: [{ description: 'Генеральная уборка', quantity: 1, unitPrice: '25000.00', total: '25000.00' }] },
  } });
});

test.afterAll(async () => {
  await db.order.deleteMany({ where: { organizationId } });
  await db.client.deleteMany({ where: { organizationId } });
  await db.auditEvent.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

test('owner shares estimate and extra work; customer approves from mobile in Edge', async ({ page, context, browser, baseURL }, info) => {
  const url = baseURL ?? 'http://localhost:3000';
  await context.addCookies([{ name: 'tirek_session', value: ownerToken, url, httpOnly: true, secure: url.startsWith('https:'), sameSite: 'Lax' }]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть заказ 1', exact: true }).click();
  await page.getByRole('button', { name: 'Смета и допработы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать ссылку на смету', exact: true }).click();
  const link = page.getByLabel('Ссылка для клиента', { exact: true });
  await expect(link).toHaveValue(/\/quote#token=[a-f0-9]{64}$/);
  const baseLink = await link.inputValue();
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  try {
    const client = await publicContext.newPage();
    await client.goto(baseLink);
    await expect(client.getByRole('heading', { name: 'Основная смета' })).toBeVisible();
    await expect(client.getByText('Hidden customer')).toHaveCount(0);
    await expect(client.getByRole('button', { name: 'Согласовать предложение' })).toBeDisabled();
    await client.getByRole('checkbox').check();
    await client.getByRole('button', { name: 'Согласовать предложение' }).click();
    await expect(client.locator('.quote-confirmed')).toContainText('Предложение согласовано');
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await page.getByLabel('Услуга 1', { exact: true }).fill('Мойка окон');
    await page.getByLabel('Количество 1', { exact: true }).fill('2');
    await page.getByLabel('Цена 1', { exact: true }).fill('3000.01');
    await page.getByRole('button', { name: 'Создать ссылку на допработы', exact: true }).click();
    await expect(link).not.toHaveValue(baseLink);
    await expect(link).toHaveValue(/\/quote#token=[a-f0-9]{64}$/);
    await client.goto(await link.inputValue());
    await expect(client.getByRole('heading', { name: 'Допработы' })).toBeVisible();
    await expect(client.locator('.quote-totals dd').last()).toContainText(/31[\s\u00a0\u202f]000,02/);
    expect(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await client.screenshot({ path: info.outputPath('quote-phone.png') });
    await client.getByRole('combobox', { name: 'Язык интерфейса' }).selectOption('kk');
    await expect(client.getByRole('heading', { name: 'Қосымша жұмыстар', exact: true })).toBeVisible();
    await client.getByRole('combobox', { name: 'Интерфейс тілі' }).selectOption('en');
    await client.getByRole('checkbox').check();
    await client.getByRole('button', { name: 'Approve proposal' }).click();
    await expect(client.locator('.quote-confirmed')).toContainText('Proposal approved');
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.locator('.quote-toolbar').first()).toContainText(/31[\s\u00a0\u202f]000,02/);
    await page.locator('.quote-history details').first().locator('summary').click();
    await page.locator('.quote-history details').first().getByRole('button', { name: 'Отозвать ссылку' }).click();
    await client.reload();
    await expect(client.locator('main').getByRole('alert')).toContainText('unavailable or expired');
    const order = await db.order.findFirstOrThrow({ where: { organizationId } });
    expect(order.total.toFixed(2)).toBe('31000.02');
  } finally {
    await publicContext.close();
  }
});
