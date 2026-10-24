import {test,expect,type BrowserContext} from './fixtures';
import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
let organizationId:string,orderId:string,clientId:string,ownerToken:string;
const bank={businessId:'123456789012',address:'Almaty QA',bankName:'Test bank',iban:'KZ861250000000000001',bic:'TESTKZKX'};
async function signIn(context:BrowserContext){
 await context.addCookies([{name:'tirek_session',value:ownerToken,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
}
test.beforeEach(async()=>{
 organizationId=randomUUID();
 const org=await db.organization.create({data:{id:organizationId,name:'Invoice browser QA',...bank,users:{create:{name:'Owner',role:'OWNER',email:randomUUID()+'@invoice-browser.invalid',passwordHash:'unused'}}},include:{users:true}});
 ownerToken=randomBytes(32).toString('hex');
 await db.session.create({data:{userId:org.users[0].id,tokenHash:createHash('sha256').update(ownerToken).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 const client=await db.client.create({data:{organizationId,name:'Invoice buyer',company:'Buyer LLC',...bank}});clientId=client.id;
 const order=await db.order.create({data:{organizationId,clientId,number:1,title:'Invoice browser order',total:'30.03',items:{create:{description:'Service <img src=x onerror=alert(1)> '+'Ж'.repeat(100),quantity:3,unitPrice:'10.01',total:'30.03'}},payments:{create:{amount:'10.02',idempotencyKey:randomUUID()}}}});orderId=order.id;
});
test.afterEach(async()=>{
 if(organizationId){
  await db.document.deleteMany({where:{organizationId}});await db.payment.deleteMany({where:{organizationId}});
  await db.orderItem.deleteMany({where:{order:{organizationId}}});await db.order.deleteMany({where:{organizationId}});
  await db.client.deleteMany({where:{organizationId}});await db.user.deleteMany({where:{organizationId}});await db.organization.deleteMany({where:{id:organizationId}});
 }
});
test.afterAll(async()=>{await db.$disconnect();});

test('requisites, invoice creation, snapshot print and RU KK EN mobile layout',async({page,context},testInfo)=>{
 await signIn(context);await page.goto('/');
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByLabel('Банк',{exact:true}).fill('Updated test bank');
 await page.getByRole('button',{name:'Сохранить реквизиты',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Реквизиты сохранены');
 // Successful save must advance the form version, allowing another save.
 await page.getByLabel('Банк',{exact:true}).fill('Saved bank');
 await page.getByRole('button',{name:'Сохранить реквизиты',exact:true}).click();
 await expect.poll(async()=> (await db.organization.findUniqueOrThrow({where:{id:organizationId}})).bankName).toBe('Saved bank');
 await page.getByRole('button',{name:'Клиенты',exact:true}).click();
 await page.getByRole('button',{name:'Invoice buyer',exact:true}).click();
 await page.getByLabel('ИИН/БИН',{exact:true}).fill('987654321098');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect.poll(async()=> (await db.client.findUniqueOrThrow({where:{id:clientId}})).businessId).toBe('987654321098');
 await page.getByRole('button',{name:'Документы',exact:true}).click();
 await page.getByRole('button',{name:'Создать счёт',exact:true}).click();
 await page.getByRole('combobox',{name:'Заказ *',exact:true}).selectOption(orderId);
 await expect(page.locator('.invoice-preview')).toContainText('20,01');
 await page.getByLabel('Оплатить до',{exact:true}).fill('2099-01-01');
 await page.getByLabel('Примечание к счёту',{exact:true}).fill('Payment <script>alert(1)</script>\nSecond line');
 await page.getByRole('button',{name:'Создать счёт',exact:true}).last().click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('combobox',{name:'Вид документа',exact:true}).selectOption('INVOICE_DRAFT');
 await expect(page.getByRole('cell',{name:'Счёт № 0001 Черновик · без подписи'})).toBeVisible();
 const [doc]=await Promise.all([page.waitForEvent('popup'),page.getByRole('link',{name:'Открыть',exact:true}).click()]);
 await expect(doc.getByRole('heading',{name:'Счёт на оплату',exact:true})).toBeVisible();
 await expect(doc.getByText('Банк: Saved bank',{exact:true})).toBeVisible();
 await expect(doc.getByText('ИИН/БИН: 987654321098',{exact:true})).toBeVisible();
 await expect(doc.locator('.invoice-totals')).toContainText('20,01');
 expect(await doc.locator('article script,article img').count()).toBe(0);
 await expect(doc.locator('.invoice-note')).toContainText('Second line');
 await doc.screenshot({path:testInfo.outputPath('invoice-desktop.png'),fullPage:true});
 await doc.setViewportSize({width:390,height:844});
 for(const [locale,title]of [['kk','Төлем шоты'],['en','Payment invoice'],['ru','Счёт на оплату']]){
  await doc.locator('.language-switcher select').selectOption(locale);
  await expect(doc.getByRole('heading',{name:title,exact:true})).toBeVisible();
  expect(await doc.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }
 await doc.screenshot({path:testInfo.outputPath('invoice-mobile.png'),fullPage:true});
 await doc.setViewportSize({width:794,height:1123});
 await doc.emulateMedia({media:'print'});
 await expect(doc.locator('.document-toolbar')).not.toBeVisible();
 await doc.screenshot({path:testInfo.outputPath('invoice-print.png'),fullPage:true});
 await doc.close();
});

test('ambiguous create response and throttled retry keep one immutable request',async({page,context})=>{
 await signIn(context);await page.goto('/');
 await page.getByRole('button',{name:'Документы',exact:true}).click();
 await page.getByRole('button',{name:'Создать счёт',exact:true}).click();
 await page.getByRole('combobox',{name:'Заказ *',exact:true}).selectOption(orderId);
 await page.getByLabel('Примечание к счёту',{exact:true}).fill('Original request');
 let calls=0;const bodies:string[]=[];
 await page.route('**/api/orders/*/invoices',async route=>{
  calls++;bodies.push(route.request().postData()!);
  if(calls===1){const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed');}
  else if(calls===2)await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({message:'Rate limit'})});
  else await route.continue();
 });
 await page.getByRole('button',{name:'Создать счёт',exact:true}).last().click();
 await expect(page.getByRole('button',{name:'Повторить запрос',exact:true})).toBeVisible();
 await expect(page.getByLabel('Примечание к счёту',{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Повторить запрос',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Слишком много запросов');
 await expect(page.getByLabel('Примечание к счёту',{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Повторить запрос',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(new Set(bodies).size).toBe(1);expect(await db.document.count({where:{organizationId}})).toBe(1);
});


test('annulment survives lost response, is visible in registry and in RU KK EN print on mobile',async({page,context},testInfo)=>{
 await signIn(context);
 const issued=await page.request.post('/api/orders/'+orderId+'/invoices',{headers:{Origin:'http://localhost:3000'},data:{orderVersion:1,idempotencyKey:randomUUID()}});
 expect(issued.status()).toBe(201);const document=await issued.json();
 await page.setViewportSize({width:390,height:844});await page.goto('/documents/'+document.id);
 await page.getByRole('button',{name:'Аннулировать черновик',exact:true}).click();
 const reason='Wrong details <img src=x onerror=alert(1)>\n'+'Ж'.repeat(200);
 await page.getByLabel('Причина аннулирования',{exact:true}).fill(reason);
 let calls=0;const bodies:string[]=[];
 await page.route('**/api/documents/*/annul',async route=>{
  calls++;bodies.push(route.request().postData()!);
  if(calls===1){const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed');}
  else await route.continue();
 });
 await page.getByRole('button',{name:'Подтвердить аннулирование',exact:true}).click();
 await expect(page.locator('.document-page').getByRole('alert')).toContainText('Не удалось связаться с сервером');
 await expect(page.getByLabel('Причина аннулирования',{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Подтвердить аннулирование',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.document-annulled')).toContainText(reason);
 expect(new Set(bodies).size).toBe(1);
 expect(await db.auditEvent.count({where:{organizationId,action:'DOCUMENT_ANNULLED'}})).toBe(1);
 expect(await page.locator('article img,article script').count()).toBe(0);
 for(const [locale,label]of [['kk','Жобаның күші жойылды'],['en','Draft annulled'],['ru','Черновик аннулирован']]){
  await page.locator('.language-switcher select').selectOption(locale);
  await expect(page.locator('.document-annulled strong')).toHaveText(label);
  const saved=await db.document.findUniqueOrThrow({where:{id:document.id}});
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit',hour12:false}).format(saved.annulledAt!);
  await expect(page.locator('.document-annulled')).toContainText(clock);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }
 await page.screenshot({path:testInfo.outputPath('annulled-mobile.png'),fullPage:true});
 await page.setViewportSize({width:794,height:1123});await page.emulateMedia({media:'print'});await expect(page.locator('.document-annulled')).toBeVisible();await expect(page.locator('.document-toolbar')).not.toBeVisible();
 await page.screenshot({path:testInfo.outputPath('annulled-print.png'),fullPage:true});
 await page.emulateMedia({media:'screen'});await page.setViewportSize({width:1280,height:900});await page.goto('/');
 await page.getByRole('button',{name:'Документы',exact:true}).click();
 await page.getByRole('combobox',{name:'Статус документа',exact:true}).selectOption('ANNULLED');
 await expect(page.getByRole('cell',{name:'Счёт № 0001 Черновик аннулирован'})).toBeVisible();
 await page.getByRole('combobox',{name:'Статус документа',exact:true}).selectOption('DRAFT');
 await expect(page.getByRole('link',{name:'Открыть',exact:true})).toHaveCount(0);
});

test('print revalidates external annulment and fails closed when status cannot be fetched',async({page,context})=>{
 await signIn(context);
 const issued=await page.request.post('/api/orders/'+orderId+'/invoices',{headers:{Origin:'http://localhost:3000'},data:{orderVersion:1,idempotencyKey:randomUUID()}});
 const document=await issued.json();await page.goto('/documents/'+document.id);
 await expect(page.getByRole('button',{name:'Аннулировать черновик',exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {printed:string[]}).printed=[];window.print=()=>{(window as unknown as {printed:string[]}).printed.push(document.querySelector('.document-annulled')?.textContent??'MISSING');};});
 const response=await page.request.post('/api/documents/'+document.id+'/annul',{headers:{Origin:'http://localhost:3000'},data:{version:1,reason:'External annulment',idempotencyKey:randomUUID()}});expect(response.status()).toBe(201);
 await page.getByRole('button',{name:'Печать / PDF',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {printed:string[]}).printed)).toEqual([expect.stringContaining('External annulment')]);
 await page.route('**/api/documents/'+document.id,route=>route.abort('failed'));
 await page.getByRole('button',{name:'Печать / PDF',exact:true}).click();
 await expect(page.locator('.document-page').getByRole('alert')).toContainText('Не удалось связаться с сервером');
 expect(await page.evaluate(()=>(window as unknown as {printed:string[]}).printed.length)).toBe(1);
});
