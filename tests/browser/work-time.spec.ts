import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  await db.workTimeMonth.deleteMany({ where: { organizationId } });
  await db.workTimeEntry.deleteMany({ where: { organizationId } });
  await db.auditEvent.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { organizationId } });
  await db.organization.delete({ where: { id: organizationId } });
  await db.$disconnect();
});

test('employee files overtime, owner closes the month and downloads CSV in Edge', async ({ page, context, baseURL }, testInfo) => {
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
  await dialog.getByLabel('Вид времени').selectOption('OVERTIME');
  await dialog.getByLabel('Фактическое начало (Алматы)').fill('2025-11-08T21:35');
  await dialog.getByLabel('Фактическое окончание (Алматы)').fill('2025-11-08T23:00');
  await dialog.getByRole('button', { name: 'Отправить на проверку' }).click();
  await expect(page.locator('.work-time-entry')).toContainText('1 ч 25 мин');
  await expect(page.getByRole('button', { name: 'Подтвердить часы' })).toHaveCount(0);
  const entry = await db.workTimeEntry.findFirstOrThrow({ where: { employeeId } });
  expect(entry.startsAt.toISOString()).toBe('2025-11-08T16:35:00.000Z');

  await signIn(ownerToken);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  const management = page.getByRole('button', { name: 'Управление', exact: true });
  await expect(page.getByRole('button', { name: 'Команда', exact: true })).toHaveCount(0);
  await management.click();
  await expect(management).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Команда', exact: true })).toBeVisible();
  await management.click();
  await page.getByRole('button', { name: 'Табель', exact: true }).click();
  await page.getByLabel('Месяц табеля').fill('2025-11');
  const record = page.locator('.work-time-entry').filter({ hasText: 'Employee QA' });
  await record.getByRole('button', { name: 'Подтвердить часы' }).click();
  await dialog.getByRole('button', { name: 'Подтвердить часы' }).click();
  await expect(record).toContainText('Часы подтверждены');
  await expect(page.locator('.work-time-summary').getByText('1 ч 25 мин', { exact: true })).toHaveCount(2);
  await expect(page.locator('.work-time-summary').getByText('1 ч 0 мин', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('timesheet-mobile-ru.png') });
  await page.getByRole('combobox', { name: 'Язык интерфейса' }).selectOption('kk');
  await expect(record).toContainText('Сағаттар расталды');
  await page.getByRole('combobox', { name: 'Интерфейс тілі' }).selectOption('en');
  await expect(record).toContainText('Hours approved');
  await expect(page.getByRole('heading', { name: 'Timesheet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close month', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm closure', exact: true }).click();
  await expect(page.getByText('Month closed', { exact: false })).toBeVisible();
  await expect(record.getByRole('button', { name: 'Void entry' })).toHaveCount(0);
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV for accounting' }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe('tirek-timesheet-2025-11.csv');
  expect(await readFile((await csv.path())!, 'utf8')).toContain('"Employee QA",85,85,60,0');
});
