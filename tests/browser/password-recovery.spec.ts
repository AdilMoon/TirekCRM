import {test, expect} from '@playwright/test';

test('login links to recovery and requests keep account existence private', async ({page}) => {
  const requests: unknown[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/request')) requests.push(route.request().postDataJSON());
    await route.fulfill({status:path.endsWith('/me') ? 401 : path.endsWith('/request') ? 202 : 200,
      json:path.endsWith('/status') ? {enabled:true,registrationEnabled:false} : {ok:true}});
  });
  await page.goto('/');
  await page.getByRole('link',{name:'Забыли пароль?'}).click();
  await page.getByLabel('Email',{exact:true}).fill('unknown@example.invalid');
  await page.getByRole('button',{name:'Отправить ссылку',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Если активный аккаунт');
  expect(requests).toEqual([{email:'unknown@example.invalid'}]);
});

test('fragment token stays off the network and confirmation handles mismatch and expired links', async ({page}) => {
  const token='a'.repeat(64), seen:string[]=[], bodies:unknown[]=[];
  let expired = true;
  page.on('request',request=>seen.push(request.url()));
  await page.route('**/api/auth/password-reset/**', async route => {
    if (route.request().url().endsWith('/confirm')) {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({status:expired ? 400 : 200,
        json:expired ? {message:'Токен восстановления недействителен или истёк'} : {ok:true}});
    } else await route.fulfill({json:{enabled:true}});
  });
  await page.goto('/reset-password#token='+token);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel('Новый пароль',{exact:true}).fill('DifferentPassword2026!');
  await page.getByLabel('Повторите пароль',{exact:true}).fill('MismatchPassword2026!');
  await page.getByRole('button',{name:'Сохранить новый пароль'}).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Пароли не совпадают');
  expect(bodies).toHaveLength(0);
  await page.getByLabel('Повторите пароль',{exact:true}).fill('DifferentPassword2026!');
  await page.getByRole('button',{name:'Сохранить новый пароль'}).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('недействителен или истёк');
  expired = false;
  await page.getByRole('button',{name:'Сохранить новый пароль'}).click();
  await expect(page.getByRole('heading',{name:'Пароль обновлён'})).toBeVisible();
  expect(bodies).toEqual(Array(2).fill({token,newPassword:'DifferentPassword2026!'}));
  expect(seen.every(url=>!url.includes(token))).toBe(true);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('unavailable delivery and invalid links offer a return path', async ({page}) => {
  await page.route('**/api/auth/password-reset/status', route=>route.fulfill({json:{enabled:false}}));
  await page.goto('/reset-password#token=bad');
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.getByRole('status')).toContainText('недоступно');
  await expect(page.getByRole('button',{name:'Отправить ссылку'})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Перейти ко входу',exact:true}).last()).toBeVisible();
});
