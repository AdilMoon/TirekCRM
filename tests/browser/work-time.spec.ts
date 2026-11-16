import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, test } from './fixtures';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const organizationId = randomUUID();
let ownerToken: string, employeeToken: string, employeeId: string;

test.beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, name: 'Tirek Timesheet' } });
  async function account(name: string, role: 'OWNER' | 'EMPLOYEE') {
    const user = await db.user.create({
      data: { organizationId, name, role, email: randomUUID() + '@time-browser.invalid', passwordHash: 'unused' },
    });
    const token = randomBytes(32).toString('hex');
    await db.session.create({ data: {
      userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000),
    } });
    return { user, token };
  }
  ownerToken = (await account('Owner QA', 'OWNER')).token;
  const employee = await account('Employee QA', 'EMPLOYEE');
  employeeToken = employee.token;
  employeeId = employee.user.id;
});

test.afterAll(async () => {
  await db.workTimeEntry.deleteMany({ where: { organizationId } });
  await db.auditEvent.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { organizationId } });
  await db.organization.delete({ where: { id: organizationId } });
  await db.$disconnect();
});

test('employee files actual time and owner approves it on mobile in Edge', async ({ page, context, baseURL }, testInfo) => {
  const url = baseURL ?? 'http://localhost:3000';
  const signIn = async (token: string) => {
    await context.clearCookies();
    await context.addCookies([{ name: 'tirek_session', value: token, url, httpOnly: true, secure: url.startsWith('https:'), sameSite: 'Lax' }]);
    await page.goto('/');
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(employeeToken);
  await page.getByRole('button', { name: 'Табель', exact: true }).click();
  await page.getByRole('button', { name: 'Записать фактическое время' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Фактическое начало (Алматы)').fill('2025-11-08T09:00');
  await dialog.getByLabel('Фактическое окончание (Алматы)').fill('2025-11-08T10:25');
  await dialog.getByRole('button', { name: 'Отправить на проверку' }).click();
  await expect(page.locator('.work-time-entry')).toContainText('1 ч 25 мин');
  await expect(page.getByRole('button', { name: 'Подтвердить часы' })).toHaveCount(0);
  const entry = await db.workTimeEntry.findFirstOrThrow({ where: { employeeId } });
  expect(entry.startsAt.toISOString()).toBe('2025-11-08T04:00:00.000Z');

  await signIn(ownerToken);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('button', { name: 'Табель', exact: true }).click();
  await page.getByLabel('Месяц табеля').fill('2025-11');
  const record = page.locator('.work-time-entry').filter({ hasText: 'Employee QA' });
  await record.getByRole('button', { name: 'Подтвердить часы' }).click();
  await dialog.getByRole('button', { name: 'Подтвердить часы' }).click();
  await expect(record).toContainText('Часы подтверждены');
  await expect(page.locator('.work-time-summary').getByText('1 ч 25 мин')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('timesheet-mobile-ru.png') });
  await page.getByRole('combobox', { name: 'Язык интерфейса' }).selectOption('kk');
  await expect(record).toContainText('Сағаттар расталды');
  await page.getByRole('combobox', { name: 'Интерфейс тілі' }).selectOption('en');
  await expect(record).toContainText('Hours approved');
  await expect(page.getByRole('heading', { name: 'Timesheet', exact: true })).toBeVisible();
  await record.getByRole('button', { name: 'Void entry' }).click();
  await dialog.getByLabel('Reason for decision').fill('Correct the original record');
  await dialog.getByRole('button', { name: 'Void entry' }).click();
  await expect(record).toContainText('Entry voided');
  await expect(page.locator('.work-time-summary').getByText('0 h 0 min')).toHaveCount(2);
});
