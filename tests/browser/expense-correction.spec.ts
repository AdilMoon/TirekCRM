import 'dotenv/config';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {test,expect,navigateWorkspace,type BrowserContext} from './fixtures';
import type {Page} from '@playwright/test';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
let org:string,token:string,expenseId:string,orderId:string,targetId:string;
test.beforeEach(async()=>{
 org=randomUUID();await db.organization.create({data:{id:org,name:'Expense correction Edge QA'}});
 const owner=await db.user.create({data:{organizationId:org,name:'Owner QA',role:'OWNER',email:randomUUID()+'@expense-correction.invalid',passwordHash:'unused'}});
 token=randomBytes(32).toString('hex');await db.session.create({data:{userId:owner.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 const client=await db.client.create({data:{organizationId:org,name:'Correction client'}});
 const order=await db.order.create({data:{organizationId:org,clientId:client.id,number:1,title:'Исходный заказ QA',total:'100',actualHourlyRate:'0',createdAt:new Date('2020-01-01')}});orderId=order.id;
 await db.order.createMany({data:Array.from({length:25},(_,i)=>({organizationId:org,clientId:client.id,number:i+2,title:'Target order '+i,total:'100',actualHourlyRate:'0'}))});
 targetId=(await db.order.findFirstOrThrow({where:{organizationId:org,number:26}})).id;
 await db.order.update({where:{id:targetId},data:{createdAt:new Date('2019-01-01')}});
 expenseId=(await db.expense.create({data:{organizationId:org,orderId,amount:'10.11',category:'RENT',description:'Original correction QA',idempotencyKey:randomUUID(),createdAt:new Date('2020-01-01')}})).id;
});
test.afterEach(async()=>{
 const where={organizationId:org};await db.materialLot.deleteMany({where});await db.expenseReversal.deleteMany({where});await db.expense.deleteMany({where});
 await db.order.deleteMany({where});await db.client.deleteMany({where});await db.auditEvent.deleteMany({where});await db.user.deleteMany({where});await db.organization.deleteMany({where:{id:org}});
});
test.afterAll(async()=>{await db.$disconnect();});
async function signIn(context:BrowserContext){await context.addCookies([{name:'tirek_session',value:token,url:'http://localhost:3000',httpOnly:true}]);}
async function costs(page:Page,id:string){const response=await page.request.get('/api/orders/'+id+'/profitability');expect(response.status()).toBe(200);return (await response.json()).actual.expenses;}

test('lost response and throttled retry preserve the order and create one exact correction',async({page,context})=>{
 await signIn(context);await page.goto('/');await navigateWorkspace(page,'Финансы');
 await page.getByRole('row').filter({hasText:'Original correction QA'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();
 const dialog=page.getByRole('dialog');const loaded=page.waitForResponse(r=>r.url().includes('/api/orders/search?')&&r.status()===200);
 await dialog.getByRole('button',{name:'Исправить расход',exact:true}).click();
 await expect(dialog.getByRole('combobox',{name:'Связать с заказом',exact:true})).toHaveValue(orderId);
 await loaded;
 await expect(dialog.getByRole('combobox',{name:'Связать с заказом',exact:true})).toHaveValue(orderId);
 await dialog.getByLabel('Новая сумма, ₸ *',{exact:true}).fill('10.11');
 await dialog.getByLabel('Причина финансовой операции *',{exact:true}).fill('Попытка без изменения');
 await dialog.getByRole('button',{name:'Сохранить исправление',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Новый расход должен отличаться от исходного');
 await expect(dialog.getByLabel('Новая сумма, ₸ *',{exact:true})).toBeEditable();expect(await db.expenseReversal.count({where:{organizationId:org}})).toBe(0);
 await dialog.getByLabel('Новая сумма, ₸ *',{exact:true}).fill('12,34');
 await dialog.getByLabel('Описание расхода *',{exact:true}).fill('Corrected <img src=x onerror=alert(1)>');
 await dialog.getByRole('combobox',{name:'Категория *',exact:true}).selectOption('TRANSPORT');
 await dialog.getByLabel('Причина финансовой операции *',{exact:true}).fill('Уточнены сумма и назначение');
 const bodies:string[]=[];let calls=0;
 await page.route('**/api/finance/expenses/*/replacement',async route=>{
  bodies.push(route.request().postData()!);calls++;
  if(calls===1){expect((await route.fetch()).status()).toBe(201);await route.abort('failed');}
  else if(calls===2)await route.fulfill({status:429,contentType:'application/json',body:'{}'});
  else await route.continue();
 });
 await dialog.getByRole('button',{name:'Сохранить исправление',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Не удалось связаться с сервером');
 await expect(dialog.getByLabel('Новая сумма, ₸ *',{exact:true})).toBeDisabled();
 await expect(dialog.getByRole('combobox',{name:'Связать с заказом',exact:true})).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'Только сторно',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Повторить запрос',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Слишком много запросов');
 await dialog.getByRole('button',{name:'Повторить запрос',exact:true}).click();
 await expect(dialog.getByRole('status')).toHaveText('Расход исправлен');await expect(dialog.locator('.financial-correction')).toHaveCount(1);
 expect(new Set(bodies).size).toBe(1);expect(JSON.parse(bodies[0]).orderId).toBe(orderId);
 const original=await db.expense.findUniqueOrThrow({where:{id:expenseId}});expect(original.amount.toFixed(2)).toBe('10.11');
 expect(await db.expense.count({where:{organizationId:org}})).toBe(2);expect(await db.expenseReversal.count({where:{organizationId:org}})).toBe(1);
 expect(await costs(page,orderId)).toBe('12.34');
 await dialog.getByRole('button',{name:'Открыть исправленный расход',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Corrected <img src=x onerror=alert(1)>',exact:true})).toBeVisible();expect(await dialog.locator('img,script').count()).toBe(0);
 await dialog.getByRole('button',{name:'Открыть исходный расход',exact:true}).click();await expect(dialog).toContainText('Расход уже сторнирован');
 await dialog.getByRole('button',{name:'Открыть исправленный расход',exact:true}).click();
 await dialog.getByRole('button',{name:'№ 1 · Исходный заказ QA',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Заказ № 1',exact:true})).toBeVisible();
});

test('move a correction to another order and explicitly unlink the next correction',async({page,context})=>{
 await signIn(context);await page.goto('/');await navigateWorkspace(page,'Финансы');
 await page.getByRole('row').filter({hasText:'Original correction QA'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Исправить расход',exact:true}).click();
 await dialog.getByLabel('Поиск заказа по всей базе',{exact:true}).fill('Target order 24');
 await dialog.getByRole('combobox',{name:'Связать с заказом',exact:true}).selectOption(targetId);
 await dialog.getByRole('button',{name:'Только сторно',exact:true}).click();
 const loaded=page.waitForResponse(r=>r.url().includes('/api/orders/search?')&&r.status()===200);
 await dialog.getByRole('button',{name:'Исправить расход',exact:true}).click();await loaded;
 await expect(dialog.getByRole('combobox',{name:'Связать с заказом',exact:true})).toHaveValue(targetId);
 await dialog.getByLabel('Новая сумма, ₸ *',{exact:true}).fill('7.07');await dialog.getByLabel('Причина финансовой операции *',{exact:true}).fill('Перенос на правильный заказ');
 await dialog.getByRole('button',{name:'Сохранить исправление',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Расход исправлен');
 expect(await costs(page,orderId)).toBe('0.00');expect(await costs(page,targetId)).toBe('7.07');
 await dialog.getByRole('button',{name:'Открыть исправленный расход',exact:true}).click();await dialog.getByRole('button',{name:'Исправить расход',exact:true}).click();
 await expect(dialog.getByRole('combobox',{name:'Связать с заказом',exact:true})).toHaveValue(targetId);
 await dialog.getByRole('combobox',{name:'Связать с заказом',exact:true}).selectOption('');
 await dialog.getByLabel('Причина финансовой операции *',{exact:true}).fill('Общий расход предприятия');
 await dialog.getByRole('button',{name:'Сохранить исправление',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Расход исправлен');
 expect(await costs(page,targetId)).toBe('0.00');
 const active=await db.expense.findMany({where:{organizationId:org,reversal:null}});expect(active).toHaveLength(1);expect(active[0].orderId).toBe(null);expect(active[0].amount.toFixed(2)).toBe('7.07');
});

test('mobile correction supports three languages, mode changes and an order-search outage',async({page,context},testInfo)=>{
 await signIn(context);await page.setViewportSize({width:390,height:844});await page.goto('/');await navigateWorkspace(page,'Финансы');
 await page.getByRole('row').filter({hasText:'Original correction QA'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Исправить расход',exact:true}).click();
 await dialog.getByLabel('Новая сумма, ₸ *',{exact:true}).fill('5.05');await dialog.getByLabel('Описание расхода *',{exact:true}).fill('Ж'.repeat(180));
 await dialog.getByLabel('Причина финансовой операции *',{exact:true}).fill('Проверка мобильной формы');
 await dialog.getByRole('button',{name:'Только сторно',exact:true}).click();await dialog.getByRole('button',{name:'Исправить расход',exact:true}).click();
 await expect(dialog.getByLabel('Новая сумма, ₸ *',{exact:true})).toHaveValue('5.05');
 let closeLabel='Закрыть';
 for(const [locale,heading,open,replace,close] of [['kk','Шығынды түзету','Операцияны ашу','Шығынды түзету','Жабу'],['en','Expense correction','Open transaction','Correct expense','Close'],['ru','Исправление расхода','Открыть операцию','Исправить расход','Закрыть']]){
  await dialog.getByRole('button',{name:closeLabel,exact:true}).click();await page.locator('.language-switcher select').selectOption(locale);
  await page.getByRole('row').filter({hasText:'Original correction QA'}).getByRole('button',{name:open,exact:true}).click();
  await dialog.getByRole('button',{name:replace,exact:true}).click();closeLabel=close;
  await expect(dialog.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await dialog.getByLabel('Новая сумма, ₸ *',{exact:true}).fill('5.05');await dialog.getByLabel('Описание расхода *',{exact:true}).fill('Ж'.repeat(180));await dialog.getByLabel('Причина финансовой операции *',{exact:true}).fill('Проверка мобильной формы');
 await page.route('**/api/orders/search?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Поиск временно недоступен'})}));
 await dialog.getByLabel('Поиск заказа по всей базе',{exact:true}).fill('Unavailable');
 await expect(dialog.getByRole('alert')).toContainText('Поиск временно недоступен');
 await expect(dialog.getByRole('combobox',{name:'Связать с заказом',exact:true})).toHaveValue(orderId);
 await page.screenshot({path:testInfo.outputPath('expense-correction-mobile.png'),fullPage:true});
 await page.unroute('**/api/orders/search?*');await dialog.getByRole('alert').getByRole('button',{name:'Обновить',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Сохранить исправление',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Расход исправлен');
});

test('stock purchase offers only reversal and a concurrently reversed expense cannot be replaced',async({page,context})=>{
 await db.materialLot.create({data:{expenseId,organizationId:org,name:'Stock QA',quantity:1,available:1,availableCents:1011n}});
 await signIn(context);await page.goto('/');await navigateWorkspace(page,'Финансы');
 await page.getByRole('row').filter({hasText:'Original correction QA'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Исправить расход',exact:true})).toHaveCount(0);await expect(dialog).toContainText('Для закупки склада доступно только сторно.');
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await db.materialLot.delete({where:{expenseId}});
 await page.getByRole('row').filter({hasText:'Original correction QA'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();await dialog.getByRole('button',{name:'Исправить расход',exact:true}).click();
 await dialog.getByLabel('Новая сумма, ₸ *',{exact:true}).fill('5.05');await dialog.getByLabel('Причина финансовой операции *',{exact:true}).fill('Конкурентное исправление');
 expect((await page.request.post('/api/finance/expenses/'+expenseId+'/reversal',{headers:{Origin:'http://localhost:3000'},data:{reason:'Внешнее сторно QA',idempotencyKey:randomUUID()}})).status()).toBe(201);
 await dialog.getByRole('button',{name:'Сохранить исправление',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Расход уже сторнирован');
 expect(await db.expense.count({where:{organizationId:org}})).toBe(1);expect(await db.expenseReversal.count({where:{organizationId:org}})).toBe(1);
});
