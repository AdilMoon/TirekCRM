import {test,expect,type BrowserContext} from './fixtures';
import 'dotenv/config';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const organizationId=randomUUID();let ownerId:string,workerId:string;
const clientName='Мобильный клиент '+ 'Ж'.repeat(120);
async function signIn(context:BrowserContext,userId:string){
 const value=randomBytes(32).toString('hex');
 await db.session.create({data:{userId,tokenHash:createHash('sha256').update(value).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 await context.addCookies([{name:'tirek_session',value,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
}
test.beforeAll(async()=>{
 const org=await db.organization.create({data:{id:organizationId,name:'Mobile QA '+ 'К'.repeat(100),users:{create:[
  {name:'Mobile owner',role:'OWNER',email:randomUUID()+'@mobile.invalid',passwordHash:'unused'},
  {name:'Mobile employee',role:'EMPLOYEE',email:randomUUID()+'@mobile.invalid',passwordHash:'unused'}
 ]}},include:{users:true}});
 ownerId=org.users.find(u=>u.role==='OWNER')!.id;workerId=org.users.find(u=>u.role==='EMPLOYEE')!.id;
 await db.client.create({data:{organizationId,name:clientName,phone:'+7 700 123 45 67',email:'long-address-'+ 'a'.repeat(70)+'@example.invalid',address:'Алматы '+ 'А'.repeat(200)}});
 await db.expense.create({data:{organizationId,description:'Mobile exact amount',amount:'90071992547409.91',category:'OTHER',idempotencyKey:randomUUID()}});
});
test.afterAll(async()=>{
 await db.auditEvent.deleteMany({where:{organizationId}});
 await db.expense.deleteMany({where:{organizationId}});
 await db.client.deleteMany({where:{organizationId}});
 await db.user.deleteMany({where:{organizationId}});
 await db.organization.deleteMany({where:{id:organizationId}});
 await db.$disconnect();
});
test('mobile navigation is modal, keyboard safe and survives breakpoint changes',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});await signIn(context,ownerId);await page.goto('/');
 const menu=page.getByRole('button',{name:'Меню',exact:true});
 await menu.click();
 const drawer=page.getByRole('dialog',{name:'Основная навигация',exact:true});
 await expect(drawer).toBeVisible();
 await expect(menu).toHaveAttribute('aria-expanded','true');
 await expect(drawer.getByRole('button',{name:'Закрыть',exact:true})).toBeFocused();
 await page.screenshot({path:'test-results/mobile-navigation.png'});
 await page.keyboard.press('Shift+Tab');
 expect(await drawer.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);await expect(menu).toBeFocused();
 await expect(menu).toHaveAttribute('aria-expanded','false');
 await menu.click();await page.mouse.click(385,400);await expect(drawer).toHaveCount(0);
 await menu.click();await drawer.getByRole('button',{name:'Клиенты',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Клиенты',level:1})).toBeVisible();
 await expect(drawer).toHaveCount(0);await expect(menu).toBeFocused();
 await menu.click();await page.setViewportSize({width:1280,height:800});
 await expect(drawer).toHaveCount(0);await expect(page.locator('.sidebar')).toBeVisible();
 expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 await page.setViewportSize({width:320,height:640});await expect(menu).toHaveAttribute('aria-expanded','false');
 await menu.click();await drawer.getByRole('button',{name:'Управление',exact:true}).click();await drawer.getByRole('button',{name:'Документы',exact:true}).click();
 await expect(drawer).toHaveCount(0);await page.getByRole('button',{name:'Создать счёт',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(1);
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});

test('client cards and long forms remain usable at 320px in RU, KK and EN',async({page,context})=>{
 test.setTimeout(60000);
 await page.setViewportSize({width:320,height:640});await signIn(context,ownerId);await page.goto('/');
 await expect(page.getByRole('heading',{name:'Всё под контролем.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await page.locator('.stats-grid').innerText()).replace(/\s/g,'')).toContain('90071992547409,91');
 await page.getByRole('button',{name:'Меню',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Клиенты',exact:true}).click();
 await expect(page.getByRole('button',{name:clientName,exact:true})).toBeVisible();
 for(const [locale,contacts,added] of [['ru','Контакты','Добавлен'],['kk','Байланыс деректері','Қосылған күні'],['en','Contact details','Added']]){
  await page.locator('.language-switcher select').selectOption(locale);
  await expect(page.locator('html')).toHaveAttribute('lang',locale);
  const row=page.locator('.clients-table tbody tr').first();
  await expect(row.locator('td').nth(1)).toHaveAttribute('data-label',contacts);
  await expect(row.locator('td').nth(4)).toHaveAttribute('data-label',added);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('.table-wrap').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/mobile-clients-'+locale+'.png',fullPage:true});
 }
 await page.locator('.language-switcher select').selectOption('ru');
 await page.getByRole('button',{name:clientName,exact:true}).click();
 const dialog=page.getByRole('dialog');
 const phone=dialog.getByLabel('Телефон',{exact:true});
 await expect(phone).toHaveAttribute('type','tel');
 expect(await phone.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 await phone.fill('+7 700 999 88 77');
 await page.setViewportSize({width:390,height:420});
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).scrollIntoViewIfNeeded();
 await expect(dialog.getByRole('button',{name:'Закрыть',exact:true})).toBeInViewport();
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 let rejected=false;
 await page.route('**/api/clients/*',async route=>{
  if(route.request().method()==='PATCH'&&!rejected){rejected=true;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'VALIDATION_ERROR'})});}
  else await route.continue();
 });
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Проверьте введённые данные');
 await expect(phone).toHaveValue('+7 700 999 88 77');
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).scrollIntoViewIfNeeded();
 await expect(dialog.getByRole('button',{name:'Сохранить',exact:true})).toBeInViewport();
 await expect(dialog.getByRole('button',{name:'Закрыть',exact:true})).toBeInViewport();
 await page.screenshot({path:'test-results/mobile-form-error.png'});
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(await db.client.count({where:{organizationId,name:clientName,phone:'+7 700 999 88 77',version:2}})).toBe(1);
 await page.setViewportSize({width:1280,height:800});
 await expect(page.locator('.clients-table thead')).toBeVisible();
 expect(await page.locator('.clients-table').evaluate(el=>getComputedStyle(el).display)).toBe('table');
 await expect(page.getByRole('button',{name:clientName,exact:true})).toBeVisible();
 expect(await page.locator('.table-wrap').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.screenshot({path:'test-results/mobile-clients-desktop.png',fullPage:true});
});

test('employee phone header keeps actions reachable without owner navigation',async({page,context})=>{
 await page.setViewportSize({width:320,height:640});await signIn(context,workerId);
 const forbiddenRequests:string[]=[];
 page.on('request',request=>{if(/\/api\/(dashboard|clients|orders|movements|documents|team$|audit)/.test(request.url()))forbiddenRequests.push(request.url());});
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Мои задачи',level:1})).toBeVisible();
 await expect(page.getByRole('button',{name:'Меню',exact:true})).toHaveCount(0);
 for(const locale of ['ru','kk','en']){
  await page.locator('.language-switcher select').selectOption(locale);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const button of await page.locator('.topbar button').all()){
   const box=await button.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
  }
 }
 await page.getByRole('button',{name:'Account settings',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Account settings',level:1})).toBeVisible();
 expect(forbiddenRequests).toEqual([]);
 await page.screenshot({path:'test-results/mobile-employee.png',fullPage:true});
});
