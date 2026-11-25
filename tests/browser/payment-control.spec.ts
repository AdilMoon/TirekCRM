import 'dotenv/config';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {test,expect,navigateWorkspace} from './fixtures';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID(),outside=randomUUID();
let token:string,workerToken:string,outsideToken:string,orderId:string;
test.beforeAll(async()=>{
 await db.organization.createMany({data:[{id:org,name:'Payment control Edge QA'},{id:outside,name:'Outside Edge QA'}]});
 async function session(organizationId:string,role:'OWNER'|'EMPLOYEE'){
  const user=await db.user.create({data:{organizationId,role,name:'QA',email:randomUUID()+'@control.invalid',passwordHash:'unused'}});
  const value=randomBytes(32).toString('hex');
  await db.session.create({data:{userId:user.id,tokenHash:createHash('sha256').update(value).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});return value;
 }
 token=await session(org,'OWNER');workerToken=await session(org,'EMPLOYEE');outsideToken=await session(outside,'OWNER');
 const client=await db.client.create({data:{organizationId:org,name:'Клиент оплаты QA'}});
 const order=await db.order.create({data:{organizationId:org,clientId:client.id,number:1,title:'Оплата контроль QA',total:'100.01',
  items:{create:{description:'Услуга',quantity:1,unitPrice:'100.01',total:'100.01'}},payments:{create:{amount:'40.01',idempotencyKey:randomUUID()}}}});orderId=order.id;
 await db.document.create({data:{organizationId:org,orderId,number:1,kind:'INVOICE_DRAFT',snapshot:{invoice:{dueDate:'2020-01-01'}}}});
});
test.afterAll(async()=>{
 const where={organizationId:{in:[org,outside]}};
 await db.payment.deleteMany({where});await db.document.deleteMany({where});await db.orderItem.deleteMany({where:{order:where}});
 await db.order.deleteMany({where});await db.client.deleteMany({where});await db.auditEvent.deleteMany({where});
 await db.user.deleteMany({where});await db.organization.deleteMany({where:{id:{in:[org,outside]}}});await db.$disconnect();
});
test('owner opens overdue order, records its balance and sees it disappear',async({page,context,baseURL},testInfo)=>{
 const origin=baseURL??'http://localhost:3000';
 async function get(value:string,query='') {return fetch(origin+'/api/payments/control'+query,{headers:{Cookie:'tirek_session='+value}});}
 expect((await get('')).status).toBe(401);expect((await get(workerToken)).status).toBe(403);
 expect((await (await get(outsideToken)).json()).total).toBe(0);
 expect((await get(token,'?state=PAID')).status).toBe(400);
 expect((await get(token,'?organizationId='+outside)).status).toBe(400);
 const response=await get(token);expect(response.headers.get('cache-control')).toContain('no-store');
 await context.addCookies([{name:'tirek_session',value:token,url:origin,httpOnly:true}]);
 await page.goto('/');await navigateWorkspace(page,'Финансы');
 await page.getByRole('button',{name:'Контроль оплат',exact:true}).click();
 const board=page.getByRole('region',{name:'Контроль оплат'});
 await expect(board.getByRole('row').filter({hasText:'Оплата контроль QA'})).toContainText('60');
 await board.getByLabel('Срок оплаты',{exact:true}).selectOption('OVERDUE');
 await expect(board.getByRole('row')).toHaveCount(2);
 await page.screenshot({path:testInfo.outputPath('payment-control-desktop.png'),fullPage:true});
 await board.getByRole('button',{name:'Открыть заказ',exact:true}).click();
 await page.getByRole('button',{name:'Записать оплату',exact:true}).click();
 await page.getByLabel('Сумма оплаты, ₸ *',{exact:true}).fill('60');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Оплата записана');
 await expect(board.getByText('Неоплаченных заказов с этими фильтрами нет.',{exact:true})).toBeVisible();
 expect((await db.payment.aggregate({where:{organizationId:org,orderId},_sum:{amount:true}}))._sum.amount?.toFixed(2)).toBe('100.01');
});
test('mobile translations, literal search and failure recovery',async({page,context,baseURL},testInfo)=>{
 const client=await db.client.findFirstOrThrow({where:{organizationId:org}});
 await db.order.create({data:{organizationId:org,clientId:client.id,number:2,title:'Мобильная проверка <script>alert(1)</script> '+ 'Ж'.repeat(80),total:'25.03'}});
 await context.addCookies([{name:'tirek_session',value:token,url:baseURL??'http://localhost:3000',httpOnly:true}]);
 await page.setViewportSize({width:390,height:844});await page.goto('/');await navigateWorkspace(page,'Финансы');
 await page.getByRole('button',{name:'Контроль оплат',exact:true}).click();
 const board=page.getByRole('region',{name:/Контроль оплат|Төлемдерді бақылау|Payment control/});
 for(const [locale,title] of [['kk','Төленбеген тапсырыстар'],['en','Unpaid orders'],['ru','Неоплаченные заказы']]){
  await page.getByRole('combobox',{name:/Язык интерфейса|Interface language|Интерфейс тілі/}).selectOption(locale);
  await expect(board.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(board.getByRole('row').filter({hasText:'Мобильная проверка'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }
 expect(await board.locator('script,img').count()).toBe(0);
 await page.screenshot({path:testInfo.outputPath('payment-control-mobile.png'),fullPage:true});
 await page.route('**/api/payments/control?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Временная ошибка QA'})}));
 await board.getByRole('button',{name:'Обновить',exact:true}).click();
 await expect(board.getByRole('alert')).toContainText('Временная ошибка QA');
 await page.unroute('**/api/payments/control?*');await board.getByRole('alert').getByRole('button',{name:'Обновить'}).click();
 await expect(board.getByRole('alert')).toHaveCount(0);
 await board.getByRole('textbox',{name:'Поиск',exact:true}).fill("x' OR 1=1 --");
 await expect(board.getByText('Неоплаченных заказов с этими фильтрами нет.',{exact:true})).toBeVisible();
});
