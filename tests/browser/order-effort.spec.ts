import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, test } from './fixtures';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const organizationId = randomUUID();
let owner: string, worker: string, orderId: string;

test.beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, name: 'Tirek Order Time QA' } });
  async function account(name: string, role: 'OWNER' | 'EMPLOYEE') {
    const user = await db.user.create({ data: {
      organizationId, name, role, email: randomUUID() + '@effort-browser.invalid', passwordHash: 'unused',
    } });
    const token = randomBytes(32).toString('hex');
    await db.session.create({ data: {
      userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000),
    } });
    return { id: user.id, token };
  }
  const supervisor = await account('Owner QA', 'OWNER');
  const employee = await account('Айдана QA', 'EMPLOYEE');
  owner = supervisor.token;
  worker = employee.token;
  const client = await db.client.create({ data: { organizationId, name: 'QA client' } });
  const order = await db.order.create({ data: {
    organizationId, clientId: client.id, number: 1, title: 'Монтаж витрины QA', total: '1000.00',
  } });
  orderId = order.id;
  await db.expense.create({ data: {
    organizationId, orderId, amount: '100.25', description: 'Материалы QA', category: 'MATERIALS', idempotencyKey: randomUUID(),
  } });
  await db.businessTask.create({ data: {
    organizationId, title: 'Подготовить витрину QA', orderId, assigneeId: employee.id, createdById: supervisor.id, status: 'DONE',
  } });
});

test.afterAll(async () => {
  await db.workTimeEntry.deleteMany({ where: { organizationId } });
  await db.businessTask.deleteMany({ where: { organizationId } });
  await db.expense.deleteMany({ where: { organizationId } });
  await db.order.deleteMany({ where: { organizationId } });
  await db.client.deleteMany({ where: { organizationId } });
  await db.auditEvent.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

test('employee logs time and owner verifies the overrun report and order profitability', async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(60000);
  const url = baseURL ?? 'http://localhost:3000';
  async function signIn(value: string) {
    await context.clearCookies();
    await context.addCookies([{ name: 'tirek_session', value, url, secure: url.startsWith('https:'), httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/');
  }

  await signIn(worker);
  await page.getByRole('button', { name: 'Записать время по заказу', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'Заказ', exact: true })).toHaveValue(orderId);
  await dialog.getByLabel('Фактическое начало (Алматы)').fill('2025-11-08T10:00');
  await dialog.getByLabel('Фактическое окончание (Алматы)').fill('2025-11-08T12:30');
  await dialog.getByRole('button', { name: 'Отправить на проверку', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Время отправлено на проверку' })).toBeVisible();

  await signIn(owner);
  await page.getByRole('button', { name: /^Заказы/ }).click();
  await page.getByRole('button', { name: /^Монтаж витрины QA/ }).click();
  await dialog.getByRole('button', { name: 'План и факт по заказу', exact: true }).click();
  await expect(dialog.locator('.effort-metrics')).toContainText('2 ч 30 мин');
  await expect(dialog.locator('.effort-metrics')).toContainText('План не задан');
  await dialog.getByLabel('План · часы').fill('2');
  await dialog.getByRole('button', { name: 'Сохранить план времени' }).click();
  await expect(dialog.locator('.effort-metrics')).toContainText('Нет подтверждённых часов');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Табель', exact: true }).click();
  await page.getByLabel('Месяц табеля').fill('2025-11');
  const entry = page.locator('.work-time-entry').filter({ hasText: 'Айдана QA' });
  await expect(entry).toContainText('Монтаж витрины QA');
  await entry.getByRole('button', { name: 'Подтвердить часы' }).click();
  await dialog.getByRole('button', { name: 'Подтвердить часы' }).click();
  await expect(entry).toContainText('Часы подтверждены');

  await page.getByRole('button', { name: /^Заказы/ }).click();
  await page.getByRole('button', { name: 'Отчёт по времени заказов', exact: true }).click();
  await dialog.getByLabel('Только перерасход времени').check();
  await expect(dialog.getByRole('row', { name: /Монтаж витрины QA/ })).toContainText('+0 ч 30 мин');
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Выгрузить отчёт CSV' }).click(),
  ]);
  expect(await readFile((await csv.path())!, 'utf8')).toContain('120,150,0,0,30');
  await dialog.getByRole('button', { name: /Монтаж витрины QA/ }).click();
  await expect(dialog.getByRole('row', { name: /Айдана QA/ })).toContainText('2 ч 30 мин');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('heading', { name: 'План и факт по заказу' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.locator('.effort-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('order-effort-mobile.png') });

  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: /^Монтаж витрины QA/ }).click();
  await dialog.getByRole('button', { name: 'Прибыльность', exact: true }).click();
  await expect(dialog.getByText('Укажите фактическую ставку.', { exact: false })).toBeVisible();
  await dialog.getByLabel('Плановая ставка за час, ₸').fill('150,50');
  await dialog.getByLabel('Плановые расходы, ₸').fill('100');
  await dialog.getByLabel('Общая фактическая ставка за час, ₸').fill('200');
  await dialog.getByText('Индивидуальные ставки сотрудников', { exact: true }).click();
  await dialog.getByLabel(/Айдана QA/).fill('160,10');
  await dialog.getByRole('button', { name: 'Сохранить бюджет и ставки' }).click();
  const margin = dialog.getByRole('row', { name: /Маржа/ });
  await expect(margin.getByRole('cell')).toHaveText(['59,90%', '49,95%', '49,95%']);
  await expect(dialog.getByRole('columnheader', { name: 'Прогноз', exact: true })).toBeVisible();
  await expect(dialog.locator('.profitability-forecast')).toContainText('Осталось по плану 0 ч 0 мин');
  await expect(dialog.getByRole('row', { name: /Себестоимость/ })).toContainText('500,50');
  expect(await dialog.locator('.effort-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('order-profitability-mobile.png') });
});
