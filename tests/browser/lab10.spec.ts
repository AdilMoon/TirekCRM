import { test, expect, openManagement } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';
import 'dotenv/config';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Explicit local-mail precondition: never point this suite at a Gmail server.
if (process.env.LAB10_LOCAL_MAIL !== 'true') throw Error('Start the API with MAIL_DELIVERY=local and set LAB10_LOCAL_MAIL=true');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const ids: string[] = [];
const registrationEmails: string[] = [];
const organizationId = randomUUID(), foreignId = randomUUID();
const email = `${organizationId}@lab10.invalid`, password = 'Lab10Fixture2026!';
const company = `Lab10 ${organizationId}`;
const target = 'Айдана Лаборатория', unrelated = 'Бекзат Сервис';

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + '.png');
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти в пространство', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Всё под контролем.', exact: true })).toBeVisible();
}
async function registration(page: Page, address: string) {
  await page.goto('/register');
  await page.getByLabel('Название компании *', { exact: true }).fill(company + ' registration');
  await page.getByLabel('Ваше имя *', { exact: true }).fill('Студент лабораторной');
  await page.getByLabel('Email', { exact: true }).fill(address);
  await page.getByLabel('Новый пароль', { exact: true }).fill(password);
  await page.getByLabel('Повторите пароль', { exact: true }).fill(password);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(90000);
  // The local tests share one loopback IP and the real 10/min login limit.
  // Start in a fresh window; never disable or bypass the limiter.
  await delay(61000);
  const salt = randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  ids.push(organizationId, foreignId);
  await db.organization.create({ data: { id: organizationId, name: company,
    users: { create: { email, name: 'Lab10 owner', role: 'OWNER', passwordHash } },
    clients: { create: [{ name: target, company: 'Учебная компания', phone: '+77001112233' }, { name: unrelated }] } } });
  await db.organization.create({ data: { id: foreignId, name: 'Lab10 foreign', clients: { create: { name: 'Чужая Лаборатория' } } } });
});
test.afterAll(async () => {
  // Also recover a committed registration if navigation/response observation failed.
  const registered = await db.user.findMany({ where: { email: { in: registrationEmails } }, select: { organizationId: true } });
  ids.push(...registered.map(user => user.organizationId));
  // Exact UUIDs allocated by this worker only; no shared demo/customer cleanup.
  await db.auditEvent.deleteMany({ where: { organizationId: { in: ids } } });
  await db.client.deleteMany({ where: { organizationId: { in: ids } } });
  await db.user.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

test('TC01 login required fields and invalid email are rejected by the browser', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Войти в пространство', exact: true }).click();
  expect(await page.getByLabel('Email', { exact: true }).evaluate((e: HTMLInputElement) => e.validity.valueMissing)).toBe(true);
  await page.getByLabel('Email', { exact: true }).fill('not-an-email');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  expect(await page.getByLabel('Email', { exact: true }).evaluate((e: HTMLInputElement) => e.validity.typeMismatch)).toBe(true);
  await screenshot(page, info, 'login-validation');
});
test('TC02 wrong password shows an error and creates no authenticated session', async ({ page, context }, info) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill('IncorrectPassword!');
  await page.getByRole('button', { name: 'Войти в пространство', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText('Неверный email или пароль');
  expect((await context.cookies()).find(c => c.name === 'tirek_session')).toBeUndefined();
  await screenshot(page, info, 'invalid-credentials');
});
test('TC03 valid login persists after reload with a secure HttpOnly session', async ({ page, context }, info) => {
  await login(page);
  const cookie = (await context.cookies()).find(c => c.name === 'tirek_session');
  expect(cookie?.httpOnly).toBe(true); expect(cookie?.secure).toBe(true);
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Всё под контролем.', exact: true })).toBeVisible();
  await screenshot(page, info, 'workspace');
});
test('TC04 registration rejects a short password and mismatched confirmation', async ({ page }, info) => {
  await registration(page, randomUUID() + '@lab10.invalid');
  const pwd = page.getByLabel('Новый пароль', { exact: true });
  await pwd.fill('short');
  expect(await pwd.evaluate((e: HTMLInputElement) => e.checkValidity())).toBe(false);
  await pwd.fill(password);
  await page.getByLabel('Повторите пароль', { exact: true }).fill(password + 'different');
  await page.getByRole('button', { name: 'Создать компанию', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText('Пароли не совпадают');
  await screenshot(page, info, 'registration-mismatch');
  await page.getByRole('combobox', { name: 'Язык интерфейса' }).selectOption('kk');
  await expect(page.getByRole('heading', { name: 'Компания кеңістігін құру', exact: true })).toBeVisible();
  await screenshot(page, info, 'registration-kk');
});
test('TC05 registration creates one isolated owner workspace and local welcome mail', async ({ page }, info) => {
  const address = randomUUID() + '@lab10.invalid';
  registrationEmails.push(address);
  await registration(page, address);
  // Remember the exact allocated organization before submitting, even if a later assertion fails.
  // Register uses its own server-generated UUID, so capture it as soon as the transaction commits.
  const created = page.waitForResponse(r => r.url().endsWith('/api/onboarding/register') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Создать компанию', exact: true }).click();
  const response = await created;
  const user = await db.user.findUnique({ where: { email: address } });
  if (user) ids.push(user.organizationId);
  expect(response.status()).toBe(201); expect(user?.role).toBe('OWNER');
  expect(user?.organizationId).not.toBe(organizationId);
  await expect(page.getByRole('heading', { name: 'Всё под контролем.', exact: true })).toBeVisible();
  expect(await db.client.count({ where: { organizationId: user!.organizationId } })).toBe(0);
  expect((await db.mailMessage.findFirstOrThrow({ where: { userId: user!.id, kind: 'WELCOME' } })).deliveryMode).toBe('local');
  await screenshot(page, info, 'registered-workspace');
});
test('TC06 server search finds matching clients hides other tenants and clears correctly', async ({ page }, info) => {
  await login(page);
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Поиск', exact: true });
  const result = page.waitForResponse(r => r.url().includes('/api/clients/search?') && decodeURIComponent(r.url()).includes('q=Лаборатория'));
  await input.fill('Лаборатория'); expect((await result).status()).toBe(200);
  await expect(page.getByRole('button', { name: target, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: unrelated, exact: true })).toHaveCount(0);
  await expect(page.getByText('Чужая Лаборатория', { exact: true })).toHaveCount(0);
  await screenshot(page, info, 'search-found');
  await input.fill('definitely-no-match');
  await expect(page.getByText('Ничего не найдено', { exact: true })).toBeVisible();
  await input.fill('');
  await expect(page.getByRole('button', { name: unrelated, exact: true })).toBeVisible();
});
test('TC07 navigation switches all main workspace sections', async ({ page }, info) => {
  await login(page);
  for (const name of ['Клиенты', 'Заказы', 'Финансы', 'Документы', 'Задачи', 'Табель', 'Команда', 'Настройки']) {
    if (name === 'Команда' || name === 'Настройки') await openManagement(page);
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('main').getByRole('heading', { name, exact: true }).first()).toBeVisible();
  }
  await screenshot(page, info, 'navigation-settings');
});
test('TC08 logout removes the session and protected API returns 401', async ({ page, context }, info) => {
  await login(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
  expect((await context.cookies()).find(c => c.name === 'tirek_session')).toBeUndefined();
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
  await screenshot(page, info, 'logout');
});
test('TC09 invalid client form cannot create a record', async ({ page }, info) => {
  await login(page);
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  await page.getByRole('button', { name: 'Новый клиент', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Имя клиента *', { exact: true }).fill('Invalid fixture');
  await dialog.getByLabel('Email', { exact: true }).fill('invalid-address');
  expect(await dialog.getByLabel('Email', { exact: true }).evaluate((e: HTMLInputElement) => e.checkValidity())).toBe(false);
  await dialog.getByLabel('Email', { exact: true }).fill('');
  await dialog.getByLabel('Имя клиента *', { exact: true }).fill('   ');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Проверьте введённые данные');
  expect(await db.client.count({ where: { organizationId } })).toBe(2);
  await screenshot(page, info, 'client-invalid-input');
});
test('TC10 responsive login registration and client dialog fit 320 and 390 pixel widths', async ({ page }, info) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/'); await fits(page);
    await page.goto('/register');
    await expect(page.getByLabel('Название компании *', { exact: true })).toBeVisible(); await fits(page);
  }
  await login(page);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  await expect(page.getByRole('button', { name: target, exact: true })).toBeVisible(); await fits(page);
  await screenshot(page, info, 'mobile-clients');
  await page.getByRole('button', { name: 'Новый клиент', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await fits(page);
  await screenshot(page, info, 'mobile-dialog');
});
test('TC11 search input respects the server boundary of 200 characters', async ({ page }, info) => {
  await login(page);
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Поиск', exact: true });
  const response = page.waitForResponse(r => r.url().includes('/api/clients/search?') && new URL(r.url()).searchParams.get('q')?.startsWith('x'.repeat(200)) === true);
  await input.fill('x'.repeat(201));
  const status = (await response).status();
  await screenshot(page, info, 'search-boundary');
  await info.attach('search-boundary-status', { body: String(status), contentType: 'text/plain' });
  expect(await input.inputValue()).toHaveLength(200);
  expect(status).toBe(200);
  await expect(page.getByText('Ничего не найдено', { exact: true })).toBeVisible();
  // UI clipping is convenience, not an authorization or validation boundary.
  expect((await page.request.get('/api/clients/search?q=' + 'x'.repeat(201))).status()).toBe(400);
  await input.fill(target);
  await expect(page.getByRole('button', { name: target, exact: true })).toBeVisible();
});
test('TC12 an injected search outage preserves retry and recovers real results', async ({ page }, info) => {
  await login(page);
  await page.route('**/api/clients/search?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Не удалось связаться с сервером' }) }));
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось связаться с сервером' })).toBeVisible();
  await screenshot(page, info, 'search-outage');
  await page.unroute('**/api/clients/search?*');
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('button', { name: target, exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось связаться с сервером' })).toHaveCount(0);
});
