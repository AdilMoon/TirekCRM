import 'dotenv/config';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import sharp from 'sharp';
import {expect,test,navigateWorkspace} from './fixtures';
test.use({actionTimeout:15000});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID(),where={organizationId:org};let ownerToken:string,workerToken:string;
test.beforeAll(async()=>{
 await db.organization.create({data:{id:org,name:'Workspace refinement QA',orderSeq:7}});
 async function user(role:'OWNER'|'EMPLOYEE'){
  const user=await db.user.create({data:{organizationId:org,role,name:role,email:randomUUID()+'@refinement.invalid',passwordHash:'unused'}});
  const token=randomBytes(32).toString('hex');await db.session.create({data:{userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});return {user,token};
 }
 const owner=await user('OWNER'),worker=await user('EMPLOYEE');ownerToken=owner.token;workerToken=worker.token;
 const client=await db.client.create({data:{organizationId:org,name:'Client QA'}});
 const orders=[];
 for(let index=1;index<=7;index++)orders.push(await db.order.create({data:{organizationId:org,clientId:client.id,number:index,title:'Order QA '+index,total:'100',createdAt:new Date(Date.UTC(2025,1,index))}}));
 await db.businessTask.create({data:{organizationId:org,orderId:orders[0].id,createdById:owner.user.id,assigneeId:worker.user.id,title:'Completed QA task',status:'DONE'}});
 const image=await sharp({create:{width:32,height:32,channels:3,background:'#26705c'}}).jpeg().toBuffer();
 await db.orderPhoto.create({data:{organizationId:org,orderId:orders[0].id,createdById:worker.user.id,phase:'AFTER',shared:false,image:new Uint8Array(image),inputHash:randomBytes(32).toString('hex'),idempotencyKey:randomUUID()}});
 const entry=await db.workTimeEntry.create({data:{organizationId:org,employeeId:worker.user.id,createdById:worker.user.id,kind:'WORK',status:'APPROVED',startsAt:new Date('2025-02-01T04:00Z'),endsAt:new Date('2025-02-01T05:00Z'),idempotencyKey:randomUUID()}});
 await db.workTimeAllocation.create({data:{organizationId:org,entryId:entry.id,orderId:orders[0].id}});
});
test.afterAll(async()=>{
 await db.workTimeEntry.deleteMany({where});await db.businessTask.deleteMany({where});await db.order.deleteMany({where});await db.client.deleteMany({where});
 await db.auditEvent.deleteMany({where});await db.user.deleteMany({where});await db.organization.deleteMany({where:{id:org}});await db.$disconnect();
});
test('owner overview loads five orders and keeps compact creation, documents and payroll reachable',async({page,context,baseURL},testInfo)=>{
 const urls:URL[]=[];page.on('request',request=>{if(request.url().includes('/api/'))urls.push(new URL(request.url()));});
 await context.addCookies([{name:'tirek_session',value:ownerToken,url:baseURL??'http://localhost:3000',httpOnly:true}]);await page.goto('/');
 await expect(page.locator('main tbody tr')).toHaveCount(5);await expect(page.locator('main tbody tr').first()).toContainText('Order QA 7');
 expect(urls.some(url=>url.pathname==='/api/clients'||url.pathname==='/api/orders')).toBe(false);
 expect(urls.filter(url=>url.pathname==='/api/orders/search').map(url=>url.searchParams.get('pageSize'))).toEqual(['5']);
 const nav=page.locator('.owner-navigation');await expect(nav.getByRole('button')).toHaveCount(6);await expect(page.getByRole('button',{name:'О проекте',exact:true})).toHaveCount(0);
 await expect(page.locator('.message-launch')).toHaveCount(0);await page.locator('.page-heading').getByRole('button',{name:'Из сообщения в заказ',exact:true}).click();
 await expect(page.getByLabel('Сообщение клиента',{exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
 await navigateWorkspace(page,'Заказы');await expect(page.locator('.orders-table tbody tr')).toHaveCount(7);
 await navigateWorkspace(page,'Финансы');await page.getByRole('button',{name:'Счета и акты',exact:true}).click();await expect(page.getByRole('heading',{name:'Документы',exact:true})).toBeVisible();
 await expect(nav.getByRole('button',{name:'Документы',exact:true})).toHaveAttribute('aria-current','page');await page.getByRole('button',{name:'К финансам',exact:true}).click();await expect(page.getByRole('heading',{name:'Финансы',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await navigateWorkspace(page,'Табель');await expect(page.getByRole('heading',{name:'Табель',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('grouped-navigation-payroll-mobile.png')});
});
test('settings load on demand, preserve drafts and support keyboard and language changes',async({page,context,baseURL},testInfo)=>{
 const paths:string[]=[];let changes=0;page.on('request',request=>{paths.push(new URL(request.url()).pathname);if(request.method()==='PATCH'&&request.url().includes('/api/organization'))changes++;});
 await context.addCookies([{name:'tirek_session',value:ownerToken,url:baseURL??'http://localhost:3000',httpOnly:true}]);await page.goto('/');await navigateWorkspace(page,'Настройки');
 const name=page.getByLabel('Название компании *',{exact:true});await name.fill('Черновик компании QA');expect(paths.includes('/api/privacy-requests')).toBe(false);expect(paths.includes('/api/auth/sessions')).toBe(false);expect(paths.includes('/api/telegram')).toBe(false);
 const company=page.getByRole('tab',{name:'Компания',exact:true});await company.focus();await company.press('ArrowRight');await expect(page.getByRole('tab',{name:'Доступ',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('region',{name:'Безопасность аккаунта',exact:true})).toBeVisible();await expect(name).not.toBeVisible();
 await page.getByRole('tab',{name:'Доступ',exact:true}).press('End');await expect(page.getByRole('heading',{name:'Обращения по персональным данным',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Безопасность аккаунта',exact:true})).not.toBeVisible();
 await page.getByRole('tab',{name:'Обращения по данным',exact:true}).press('Home');await expect(name).toBeVisible();await expect(name).toHaveValue('Черновик компании QA');expect(changes).toBe(0);
 await page.getByRole('combobox',{name:'Язык интерфейса'}).selectOption('en');await expect(page.getByRole('tab',{name:'Company',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.settings-panel input[name="name"]')).toHaveValue('Черновик компании QA');
 await page.setViewportSize({width:320,height:720});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('settings-tabs-mobile-en.png'),fullPage:true});
 await page.locator('.language-switcher select').selectOption('ru');await page.getByRole('button',{name:'Сохранить реквизиты',exact:true}).click();await expect(page.getByRole('status')).toContainText('Реквизиты сохранены');expect((await db.organization.findUniqueOrThrow({where:{id:org}})).name).toBe('Черновик компании QA');expect(changes).toBe(1);
});
test('employee completed guide is compact and Telegram lives in account settings',async({page,context,baseURL},testInfo)=>{
 const paths:string[]=[];page.on('request',request=>{paths.push(new URL(request.url()).pathname);});await page.setViewportSize({width:390,height:844});
 await context.addCookies([{name:'tirek_session',value:workerToken,url:baseURL??'http://localhost:3000',httpOnly:true}]);await page.goto('/');
 const card=page.getByRole('region',{name:'Первый рабочий день',exact:true});await expect(card).toContainText('Первый маршрут пройден');await expect(card).toContainText('Выполнено шагов: 4 из 4');expect((await card.boundingBox())!.height).toBeLessThan(240);
 await expect(page.getByRole('button',{name:'Настроить Telegram',exact:true})).toHaveCount(0);await card.getByRole('button',{name:'Открыть пошаговый маршрут',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Completed QA task');await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Настройки аккаунта',exact:true}).click();await expect(page.getByRole('heading',{name:'Настройки аккаунта',level:1})).toBeVisible();await expect(page.getByRole('region',{name:'Безопасность аккаунта',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Настроить Telegram',exact:true}).click();await expect(page.getByRole('dialog',{name:'Подключение Telegram',exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Мои задачи',exact:true}).click();await expect(card).toContainText('Первый маршрут пройден');await expect(page.getByRole('button',{name:'Настроить Telegram',exact:true})).toHaveCount(0);
 await expect(page.locator('.task-card')).toHaveCount(1);await expect(page.locator('.task-card').getByRole('button',{name:'Приёмка работ',exact:true})).toHaveCount(0);
 expect(paths.some(path=>['/api/dashboard','/api/clients','/api/orders','/api/orders/search','/api/organization','/api/privacy-requests'].includes(path))).toBe(false);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('compact-employee-workspace-mobile.png'),fullPage:true});
});
