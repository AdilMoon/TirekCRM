import 'dotenv/config';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {test,expect,navigateWorkspace,type BrowserContext} from './fixtures';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
let org:string,outside:string,token:string,workerToken:string,foreignToken:string,clientId:string,emptyId:string,foreignId:string,ownerId:string;
test.beforeEach(async()=>{
 org=randomUUID();outside=randomUUID();await db.organization.createMany({data:[{id:org,name:'Client overview Edge QA'},{id:outside,name:'Outside Edge QA'}]});
 async function session(organizationId:string,role:'OWNER'|'EMPLOYEE'){
  const user=await db.user.create({data:{organizationId,role,name:'QA',email:randomUUID()+'@client-overview.invalid',passwordHash:'unused'}});
  if(organizationId===org&&role==='OWNER')ownerId=user.id;
  const value=randomBytes(32).toString('hex');await db.session.create({data:{userId:user.id,tokenHash:createHash('sha256').update(value).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});return value;
 }
 token=await session(org,'OWNER');workerToken=await session(org,'EMPLOYEE');foreignToken=await session(outside,'OWNER');
 const client=await db.client.create({data:{organizationId:org,name:'Клиент обзор QA <script>',company:'Ж'.repeat(160),phone:'+7 QA',email:'qa@client-overview.invalid',address:'Ж'.repeat(300)}});clientId=client.id;
 emptyId=(await db.client.create({data:{organizationId:org,name:'Без заказов QA'}})).id;
 foreignId=(await db.client.create({data:{organizationId:outside,name:client.name}})).id;
 const ids=Array.from({length:22},()=>randomUUID());
 await db.order.createMany({data:ids.map((id,i)=>({id,organizationId:org,clientId,number:i+1,title:'History QA '+i,total:'100.01',status:i===2?'CANCELLED':i===3?'COMPLETED':'NEW',createdAt:new Date(Date.UTC(2025,0,i+1))}))});
 const payment=await db.payment.create({data:{organizationId:org,orderId:ids[0],amount:'40.01',idempotencyKey:randomUUID()}});
 await db.paymentRefund.create({data:{organizationId:org,paymentId:payment.id,amount:'10.01',reason:'Overview refund',actorId:ownerId,actorName:'QA',idempotencyKey:randomUUID()}});
 await db.payment.create({data:{organizationId:org,orderId:ids[1],amount:'100.01',idempotencyKey:randomUUID()}});
 await db.order.create({data:{organizationId:outside,clientId:foreignId,number:1,title:'Foreign secret QA',total:'9999'}});
});
test.afterEach(async()=>{
 const where={organizationId:{in:[org,outside]}};await db.paymentRefund.deleteMany({where});await db.payment.deleteMany({where});
 await db.order.deleteMany({where});await db.client.deleteMany({where});await db.auditEvent.deleteMany({where});await db.user.deleteMany({where});await db.organization.deleteMany({where:{id:{in:[org,outside]}}});
});
test.afterAll(async()=>{await db.$disconnect();});
async function login(context:BrowserContext){await context.addCookies([{name:'tirek_session',value:token,url:'http://localhost:3000',httpOnly:true}]);}

test('owner filters and pages client history, opens an order, records payment and edits the client',async({page,context},testInfo)=>{
 await login(context);await page.goto('/');await navigateWorkspace(page,'Клиенты');
 const clientRow=page.getByRole('row').filter({hasText:'Клиент обзор QA'});
 await clientRow.getByRole('button',{name:'История и оплаты',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Карточка клиента',exact:true}),history=dialog.getByRole('region',{name:'История заказов клиента'});
 await expect(history.getByRole('row')).toHaveCount(21);
 await expect(dialog.locator('.stat').filter({hasText:'Остаток к оплате'})).toContainText(/1\s?970,20/);
 await history.getByRole('button',{name:'Далее',exact:true}).click();await expect(history.getByRole('row')).toHaveCount(3);
 await history.getByLabel('Только с остатком к оплате',{exact:true}).check();await expect(history.getByRole('row')).toHaveCount(21);
 await history.getByRole('combobox',{name:'Статус',exact:true}).selectOption('COMPLETED');await expect(history.getByRole('row')).toHaveCount(2);
 await expect(dialog.locator('.stat').filter({hasText:'Остаток к оплате'})).toContainText(/1\s?970,20/);
 await history.getByRole('combobox',{name:'Статус',exact:true}).selectOption('');await history.getByRole('textbox',{name:'Поиск',exact:true}).fill('History QA 0');
 await expect(history.getByRole('row')).toHaveCount(2);
 await page.screenshot({path:testInfo.outputPath('client-overview-desktop.png')});
 await history.getByRole('button',{name:'№ 1 · History QA 0',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Заказ № 1',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Записать оплату',exact:true}).click();await page.getByLabel('Сумма оплаты, ₸ *',{exact:true}).fill('70.01');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('status')).toContainText('Оплата записана');
 await clientRow.getByRole('button',{name:'История и оплаты',exact:true}).click();
 await expect(dialog.locator('.stat').filter({hasText:'Остаток к оплате'})).toContainText(/1\s?900,19/);
 await dialog.getByRole('button',{name:'Редактировать клиента',exact:true}).click();
 await page.getByLabel('Телефон',{exact:true}).fill('+7 Updated QA');await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(clientRow).toContainText('+7 Updated QA');expect((await db.client.findUniqueOrThrow({where:{id:clientId}})).version).toBe(2);
});

test('mobile card supports RU KK EN, long contacts, keyboard focus and an empty client',async({page,context},testInfo)=>{
 await login(context);await page.setViewportSize({width:390,height:844});await page.goto('/');await navigateWorkspace(page,'Клиенты');
 for(const [locale,open,title,close] of [['ru','История и оплаты','Карточка клиента','Закрыть'],['kk','Тарих және төлемдер','Клиент карточкасы','Жабу'],['en','History and payments','Client profile','Close']]){
  await page.locator('.language-switcher select').selectOption(locale);
  await page.getByRole('row').filter({hasText:'Клиент обзор QA'}).getByRole('button',{name:open,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:title,exact:true});await expect(dialog.getByRole('heading',{name:'Клиент обзор QA <script>',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await dialog.locator('script,img').count()).toBe(0);
  if(locale==='ru')await page.screenshot({path:testInfo.outputPath('client-overview-mobile.png')});
  await dialog.getByRole('button',{name:close,exact:true}).focus();await page.keyboard.press('Shift+Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button',{name:close,exact:true}).click();
 }
 await page.locator('.language-switcher select').selectOption('ru');
 await page.getByRole('row').filter({hasText:'Без заказов QA'}).getByRole('button',{name:'История и оплаты',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('Заказов с этими фильтрами нет.',{exact:true})).toBeVisible();
 await expect(page.getByRole('dialog').locator('.stat-value')).toHaveText(['0','0 ₸','0 ₸','0 ₸']);
});

test('owner-only scope, strict query, error recovery and revoked access clear the card',async({page,context,baseURL})=>{
 const origin=baseURL??'http://localhost:3000',path='/api/clients/'+clientId+'/overview';
 const get=(value:string,url=path)=>fetch(origin+url,{headers:{Cookie:'tirek_session='+value}});
 expect((await get('')).status).toBe(401);expect((await get(workerToken)).status).toBe(403);expect((await get(foreignToken)).status).toBe(404);
 expect((await get(token,'/api/clients/'+foreignId+'/overview')).status).toBe(404);
 expect((await get(token,path+'?organizationId='+outside)).status).toBe(400);expect((await get(token,path+'?unpaid=false')).status).toBe(400);
 const response=await get(token);expect(response.headers.get('cache-control')).toContain('no-store');expect((await response.json()).summary.outstanding).toBe('1970.20');
 await login(context);await page.goto('/');await navigateWorkspace(page,'Клиенты');await page.getByRole('row').filter({hasText:'Клиент обзор QA'}).getByRole('button',{name:'История и оплаты',exact:true}).click();
 const dialog=page.getByRole('dialog'),history=dialog.getByRole('region',{name:'История заказов клиента'});
 await expect(dialog.getByRole('heading',{name:'Клиент обзор QA <script>',exact:true})).toBeVisible();
 await page.route('**/api/clients/*/overview?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Временная ошибка карточки'})}));
 await history.getByRole('button',{name:'Обновить',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Временная ошибка карточки');
 await expect(dialog.getByRole('heading',{name:'Клиент обзор QA <script>',exact:true})).toHaveCount(0);
 await page.unroute('**/api/clients/*/overview?*');await dialog.getByRole('alert').getByRole('button',{name:'Обновить',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveCount(0);
 await history.getByRole('textbox',{name:'Поиск',exact:true}).fill("x' OR 1=1 --");await expect(dialog.getByText('Заказов с этими фильтрами нет.',{exact:true})).toBeVisible();
 await db.user.update({where:{id:ownerId},data:{role:'EMPLOYEE'}});await history.getByRole('button',{name:'Обновить',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Недостаточно прав');
 await expect(dialog.getByRole('heading',{name:'Клиент обзор QA <script>',exact:true})).toHaveCount(0);
});
