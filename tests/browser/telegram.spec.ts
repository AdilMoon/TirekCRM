import {test,expect} from './fixtures';
import 'dotenv/config';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})}),org=randomUUID(),email=org+'@telegram-browser.invalid',password='TelegramBrowser2026!';
test.beforeAll(async()=>{const salt=randomBytes(16).toString('hex'),passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex');await db.organization.create({data:{id:org,name:'Telegram QA',users:{create:{email,passwordHash,name:'TG Employee',role:'EMPLOYEE'}}}});});
test.afterAll(async()=>{await db.auditEvent.deleteMany({where:{organizationId:org}});await db.user.deleteMany({where:{organizationId:org}});await db.organization.deleteMany({where:{id:org}});await db.$disconnect();});
test('employee reviews Telegram identity explicitly confirms and disconnects on mobile in three languages',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти в пространство',exact:true}).click();
 // Telegram itself is replaced at the browser boundary; role/CSRF/transaction/photo tests use the real API separately.
 let pending=false,claimed=false,linked=false,confirmed=0;
 const pairingId=randomUUID();
 await page.route('**/api/telegram**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;let result:unknown={};
  if(path==='/api/telegram'&&request.method()==='GET')result={enabled:true,botUsername:'fixture_tirek_bot',eligible:true,linked:linked?{id:randomUUID(),displayName:'Employee <profile>',username:'employee_fixture',locale:'ru'}:null,pending:pending?{id:pairingId,expiresAt:new Date(Date.now()+600000).toISOString(),displayName:claimed?'Employee <profile>':'',username:claimed?'employee_fixture':'',claimed}:null};
  if(path==='/api/telegram/pair'){pending=true;result={id:pairingId,url:'https://t.me/fixture_tirek_bot?start=fixture',expiresAt:new Date(Date.now()+600000).toISOString()};}
  if(path==='/api/telegram/confirm'){expect(request.postDataJSON()).toEqual({pairingId,locale:'ru'});expect(claimed).toBe(true);confirmed++;linked=true;pending=false;}
  if(path==='/api/telegram'&&request.method()==='DELETE'){linked=false;pending=false;}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.getByRole('button',{name:'Настройки аккаунта',exact:true}).click();await page.getByRole('button',{name:'Настроить Telegram',exact:true}).click();await page.getByRole('button',{name:'Создать ссылку подключения',exact:true}).click();await expect(page.getByRole('link',{name:'Открыть бота и нажать Start',exact:true})).toHaveAttribute('href',/https:\/\/t.me\/fixture_tirek_bot/);
 expect(confirmed).toBe(0);claimed=true;await page.getByRole('button',{name:'Обновить состояние',exact:true}).click();await expect(page.getByText('Employee <profile>',{exact:false})).toBeVisible();
 const confirm=page.getByRole('button',{name:'Подтвердить подключение',exact:true});await expect(confirm).toBeDisabled();await page.getByRole('checkbox',{name:'Это мой Telegram. Разрешаю присылать мне рабочие задачи.',exact:true}).check();await confirm.click();await expect(page.getByRole('status')).toContainText('Telegram подключён');expect(confirmed).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/telegram-connected-mobile.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Отключить Telegram',exact:true}).click();await expect(page.getByRole('button',{name:'Создать ссылку подключения',exact:true})).toBeVisible();await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('combobox',{name:'Язык интерфейса'}).selectOption('kk');await page.getByRole('button',{name:'Telegram баптау',exact:true}).click();await expect(page.getByRole('heading',{name:'Telegram қосу',exact:true})).toBeVisible();await page.getByRole('button',{name:'Жабу',exact:true}).click();
 await page.getByRole('combobox',{name:'Интерфейс тілі'}).selectOption('en');await page.getByRole('button',{name:'Configure Telegram',exact:true}).click();await expect(page.getByRole('heading',{name:'Connect Telegram',exact:true})).toBeVisible();
});
