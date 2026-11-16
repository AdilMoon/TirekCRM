import {test,expect,type BrowserContext} from './fixtures';
import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
let organizationId:string,userId:string,token:string,paymentId:string,expenseId:string,orderId:string;
async function login(context:BrowserContext){await context.addCookies([{name:'tirek_session',value:token,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);}
test.beforeEach(async()=>{
 organizationId=randomUUID();const org=await db.organization.create({data:{id:organizationId,name:'Finance corrections browser QA',users:{create:{name:'Owner QA',role:'OWNER',email:randomUUID()+'@finance-browser.invalid',passwordHash:'unused'}}},include:{users:true}});
 userId=org.users[0].id;token=randomBytes(32).toString('hex');await db.session.create({data:{userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 const client=await db.client.create({data:{organizationId,name:'Finance browser client'}});
 const order=await db.order.create({data:{organizationId,clientId:client.id,title:'Finance browser order',number:1,total:'100.25'}});orderId=order.id;
 const createdAt=new Date('2020-01-01T12:00:00Z');
 paymentId=(await db.payment.create({data:{organizationId,orderId,amount:'100.25',note:'Refund QA original payment',createdAt,idempotencyKey:randomUUID()}})).id;
 expenseId=(await db.expense.create({data:{organizationId,orderId,amount:'10.11',description:'Reversal QA original expense',category:'RENT',createdAt,idempotencyKey:randomUUID()}})).id;
});
test.afterEach(async()=>{
 await db.payment.deleteMany({where:{organizationId}});await db.expense.deleteMany({where:{organizationId}});await db.order.deleteMany({where:{organizationId}});await db.client.deleteMany({where:{organizationId}});await db.user.deleteMany({where:{organizationId}});await db.organization.deleteMany({where:{id:organizationId}});
});
test.afterAll(async()=>{await db.$disconnect();});

test('filtered finance CSV downloads in Edge with exact values and handles an export refusal',async({page,context})=>{
 await login(context);
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await page.getByRole('button',{name:'Меню',exact:true}).click();
 await page.getByRole('button',{name:'Финансы',exact:true}).click();
 await page.getByRole('button',{name:'Поступления',exact:true}).click();
 await page.getByLabel('Дата с',{exact:true}).fill('2020-01-01');
 await page.getByLabel('Дата по',{exact:true}).fill('2020-01-01');
 await page.getByRole('row').filter({hasText:'Refund QA original payment'}).waitFor();
 const button=page.getByRole('button',{name:'Скачать CSV',exact:true});
 const [download,request]=await Promise.all([
  page.waitForEvent('download'),
  page.waitForRequest(r=>new URL(r.url()).pathname==='/api/movements/export'),
  button.click(),
 ]);
 expect(Object.fromEntries(new URL(request.url()).searchParams)).toEqual({q:'',from:'2020-01-01',to:'2020-01-01',kind:'INCOME'});
 expect(download.suggestedFilename()).toBe('tirek-movements.csv');
 const csv=await readFile((await download.path())!,'utf8');
 expect(csv).toContain('100.25');
 expect(csv).toContain('Refund QA original payment');
 expect(csv).not.toContain('Reversal QA original expense');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.route('**/api/movements/export?*',route=>route.fulfill({status:429,contentType:'application/json',body:'{}'}));
 await button.click();
 await expect(page.getByRole('alert').filter({hasText:'Слишком много запросов'})).toBeVisible();
 await page.getByLabel('Дата с',{exact:true}).fill('2020-01-02');
 await expect(button).toBeDisabled();
});

test('mobile refunds and expense reversals keep retry identity, history and RU KK EN layout',async({page,context},testInfo)=>{
 await login(context);await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Меню',exact:true}).click();await page.getByRole('button',{name:'Финансы',exact:true}).click();
 await page.getByRole('row').filter({hasText:'Refund QA original payment'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();
 const dialog=page.getByRole('dialog');await page.getByLabel('Сумма возврата *',{exact:true}).fill('10,10');await page.getByLabel('Причина финансовой операции *',{exact:true}).fill('Returned <img src=x onerror=alert(1)>');
 let calls=0;const bodies:string[]=[];
 await page.route('**/api/finance/payments/*/refunds',async route=>{
  calls++;bodies.push(route.request().postData()!);
  if(calls===1){expect((await route.fetch()).status()).toBe(201);await route.abort('failed');}
  else if(calls===2)await route.fulfill({status:429,contentType:'application/json',body:'{}'});
  else await route.continue();
 });
 await dialog.getByRole('button',{name:'Записать возврат',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Не удалось связаться с сервером');
 await expect(page.getByLabel('Сумма возврата *',{exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Повторить запрос',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Слишком много запросов');
 await dialog.getByRole('button',{name:'Повторить запрос',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Возврат записан');
 await expect(dialog.locator('.financial-correction')).toHaveCount(1);expect(new Set(bodies).size).toBe(1);expect(await dialog.locator('img,script').count()).toBe(0);
 expect(await db.paymentRefund.count({where:{organizationId}})).toBe(1);expect((await db.payment.findUniqueOrThrow({where:{id:paymentId}})).amount.toFixed(2)).toBe('100.25');
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 for(const [locale,tab,open,close,title]of [['kk','Қайтарымдар','Операцияны ашу','Жабу','Қаржылық операция'],['en','Refunds','Open transaction','Close','Financial transaction'],['ru','Возвраты','Открыть операцию','Закрыть','Финансовая операция']]){
  await page.locator('.language-switcher select').selectOption(locale);await page.getByRole('button',{name:tab,exact:true}).click();
  await page.getByRole('row').filter({hasText:'Returned <img'}).getByRole('button',{name:open,exact:true}).click();
  await expect(page.getByRole('dialog',{name:title,exact:true}).locator('.financial-correction')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(locale==='kk')await page.screenshot({path:testInfo.outputPath('refund-kk-mobile.png')});
  await dialog.getByRole('button',{name:close,exact:true}).click();
 }
 await page.getByRole('button',{name:'Все операции',exact:true}).click();await page.getByRole('row').filter({hasText:'Reversal QA original expense'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();
 await page.getByLabel('Причина финансовой операции *',{exact:true}).fill('Incorrect original expense');let reversals=0;const reversalBodies:string[]=[];
 await page.route('**/api/finance/expenses/*/reversal',async route=>{reversals++;reversalBodies.push(route.request().postData()!);if(reversals===1){expect((await route.fetch()).status()).toBe(201);await route.abort('failed');}else await route.continue();});
 await dialog.getByRole('button',{name:'Сторнировать расход',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await dialog.getByRole('button',{name:'Повторить запрос',exact:true}).click();
 await expect(dialog).toContainText('Расход уже сторнирован');await expect(dialog.locator('.financial-correction')).toHaveCount(1);expect(new Set(reversalBodies).size).toBe(1);
 expect(await db.expenseReversal.count({where:{organizationId}})).toBe(1);expect((await db.expense.findUniqueOrThrow({where:{id:expenseId}})).amount.toFixed(2)).toBe('10.11');
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Сторнирования',exact:true}).click();await expect(page.getByRole('row').filter({hasText:'Incorrect original expense'})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('reversals-mobile.png')});
});

test('stale refund cannot overdraw and revoked access clears an open expense dialog',async({page,context})=>{
 await login(context);await page.goto('/');await page.getByRole('button',{name:'Финансы',exact:true}).click();await page.getByRole('row').filter({hasText:'Refund QA original payment'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();
 const dialog=page.getByRole('dialog');await page.getByLabel('Причина финансовой операции *',{exact:true}).fill('Stale refund attempt');
 const external=await page.request.post('/api/finance/payments/'+paymentId+'/refunds',{headers:{Origin:'http://localhost:3000'},data:{amount:'100.25',reason:'Already returned externally',idempotencyKey:randomUUID()}});expect(external.status()).toBe(201);
 await dialog.getByRole('button',{name:'Записать возврат',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Возврат превышает доступный остаток оплаты');expect(await db.paymentRefund.count({where:{organizationId}})).toBe(1);
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('row').filter({hasText:'Refund QA original payment'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();await expect(dialog).toContainText('Оплата полностью возвращена');await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('row').filter({hasText:'Reversal QA original expense'}).getByRole('button',{name:'Открыть операцию',exact:true}).click();await page.getByLabel('Причина финансовой операции *',{exact:true}).fill('Revoked attempt');
 await db.user.update({where:{id:userId},data:{role:'EMPLOYEE'}});await dialog.getByRole('button',{name:'Сторнировать расход',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Недостаточно прав');await expect(dialog).not.toContainText('Reversal QA original expense');expect(await db.expenseReversal.count({where:{organizationId}})).toBe(0);
});

test('negative monthly totals remain visible after corrections of historical records',async({page,context})=>{
 await login(context);
 expect((await page.request.post('/api/finance/payments/'+paymentId+'/refunds',{headers:{Origin:'http://localhost:3000'},data:{amount:'0.01',reason:'Historical refund',idempotencyKey:randomUUID()}})).status()).toBe(201);
 expect((await page.request.post('/api/finance/expenses/'+expenseId+'/reversal',{headers:{Origin:'http://localhost:3000'},data:{reason:'Historical correction',idempotencyKey:randomUUID()}})).status()).toBe(201);
 await page.setViewportSize({width:320,height:780});await page.goto('/');
 const table=page.getByRole('table',{name:'Поступления и расходы за последние шесть месяцев',exact:true});await expect(table).toBeVisible();await expect(table).toContainText('-0,01');await expect(table).toContainText('-10,11');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
