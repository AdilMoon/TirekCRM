import 'dotenv/config';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import sharp from 'sharp';
import {OrderQuotesService} from '../../backend/dist/modules/order-quotes/order-quotes.service.js';
import {AuditService} from '../../backend/dist/modules/audit/audit.service.js';
import {expect,test} from './fixtures';

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID();
test.afterAll(async()=>{
  const where={organizationId:org};
  await db.expenseReceipt.deleteMany({where});await db.expense.deleteMany({where});
  await db.workTimeEntry.deleteMany({where});await db.orderQuote.deleteMany({where});
  await db.order.deleteMany({where});await db.client.deleteMany({where});await db.auditEvent.deleteMany({where});
  await db.user.deleteMany({where});await db.organization.deleteMany({where:{id:org}});await db.$disconnect();
});
test('owner resolves receipts, missing rates, expired approval and deadline from the attention view',async({page,context,baseURL},testInfo)=>{
  test.setTimeout(90000);
  await db.organization.create({data:{id:org,name:'Attention browser QA'}});
  async function user(role:'OWNER'|'EMPLOYEE'){
    const row=await db.user.create({data:{organizationId:org,role,name:role,email:randomUUID()+'@attention.invalid',passwordHash:'unused'}});
    const token=randomBytes(32).toString('hex');
    await db.session.create({data:{userId:row.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
    return {...row,token};
  }
  const owner=await user('OWNER'),worker=await user('EMPLOYEE');
  const client=await db.client.create({data:{organizationId:org,name:'Клиент QA'}});
  async function order(number:number,title:string) {
    return db.order.create({data:{organizationId:org,clientId:client.id,number,title,total:'1000',status:'IN_PROGRESS',
      plannedMinutes:60,plannedHourlyRate:'0',plannedDirectExpenses:'0',actualHourlyRate:'0',
      items:{create:{description:'Работа QA',quantity:1,unitPrice:'1000',total:'1000'}}}});
  }
  const loss=await order(1,'Проверка расходов QA'),missing=await order(2,'Ставка QA'),expired=await order(3,'Согласование QA');
  const late=await order(4,'Срок QA');
  await db.order.update({where:{id:late.id},data:{dueDate:new Date('2025-01-01')}});
  await db.expense.create({data:{organizationId:org,orderId:loss.id,amount:'1200',description:'Расход QA',category:'OTHER',idempotencyKey:randomUUID()}});
  const image=await sharp({create:{width:48,height:48,channels:3,background:'#eee'}}).jpeg().toBuffer();
  await db.expenseReceipt.create({data:{organizationId:org,orderId:loss.id,employeeId:worker.id,amount:'25',description:'Чек QA',
    sourceKey:randomUUID(),imageHash:createHash('sha256').update(image).digest('hex'),image:new Uint8Array(image)}});
  await db.order.update({where:{id:missing.id},data:{actualHourlyRate:null}});
  const entry=await db.workTimeEntry.create({data:{organizationId:org,employeeId:worker.id,createdById:worker.id,
    status:'APPROVED',startsAt:new Date('2025-11-01T04:00Z'),endsAt:new Date('2025-11-01T05:00Z'),idempotencyKey:randomUUID()}});
  await db.workTimeAllocation.create({data:{organizationId:org,entryId:entry.id,orderId:missing.id}});
  const quote=await new OrderQuotesService({client:db},new AuditService({client:db})).publish(owner,expired.id,{kind:'BASE',orderVersion:1});
  await db.orderQuote.update({where:{id:quote.id},data:{createdAt:new Date(Date.now()-86400000),expiresAt:new Date(Date.now()-60000)}});
  const origin=baseURL??'http://localhost:3000';
  const denied=await fetch(origin+'/api/orders/attention',{headers:{Cookie:'tirek_session='+worker.token}});
  expect(denied.status).toBe(403);
  const invalid=await fetch(origin+'/api/orders/attention?page=-1',{headers:{Cookie:'tirek_session='+owner.token}});
  expect(invalid.status).toBe(400);
  await context.addCookies([{name:'tirek_session',value:owner.token,url:origin,httpOnly:true}]);
  await page.goto('/');
  await page.getByRole('button',{name:'Все причины по заказам',exact:true}).click();
  await expect(page.getByRole('button',{name:'Требуют внимания',exact:true})).toHaveAttribute('aria-pressed','true');
  const board=page.getByRole('region',{name:'Заказы, требующие внимания'});
  await expect(board.locator('.attention-order')).toHaveCount(4);
  await expect(board.locator('.attention-order').first()).toContainText('Проверка расходов QA');
  await board.getByLabel('Причина',{exact:true}).selectOption('RECEIPTS');
  await expect(board.locator('.attention-order')).toHaveCount(1);
  await board.getByRole('button',{name:/Чеки на проверке/}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Посмотреть чек'}).click();
  await dialog.getByRole('button',{name:'Подтвердить расход'}).click();
  await expect(dialog).toContainText('Расход по чеку учтён в заказе');
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(board).toContainText('Заказов с такими причинами не найдено');
  await board.getByLabel('Причина',{exact:true}).selectOption('INCOMPLETE');
  await board.getByRole('button',{name:'Не хватает данных для расчёта',exact:true}).click();
  await dialog.getByLabel('Общая фактическая ставка за час, ₸').fill('1000');
  await dialog.getByRole('button',{name:'Сохранить бюджет и ставки'}).click();
  await expect(dialog).toContainText('Параметры прибыльности сохранены');
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(board).toContainText('Заказов с такими причинами не найдено');
  await board.getByLabel('Причина',{exact:true}).selectOption('APPROVAL');
  await board.getByRole('button',{name:'Срок согласования истёк',exact:true}).click();
  await dialog.getByRole('button',{name:'Создать ссылку на смету'}).click();
  await expect(dialog.getByLabel('Ссылка для клиента')).toBeVisible();
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(board).toContainText('Заказов с такими причинами не найдено');
  await board.getByLabel('Причина',{exact:true}).selectOption('DEADLINE');
  await board.getByRole('button',{name:'Срок заказа прошёл',exact:true}).click();
  await dialog.getByRole('button',{name:'Редактировать заказ',exact:true}).click();
  await dialog.getByLabel('Срок выполнения',{exact:true}).fill('2099-12-31');
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(board).toContainText('Заказов с такими причинами не найдено');
  await board.getByLabel('Причина',{exact:true}).selectOption('');
  await expect(board.locator('.attention-order')).toHaveCount(1);
  await expect(board.locator('.attention-loss')).toContainText(/225/);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('order-attention-mobile.png')});
  await page.getByRole('button',{name:'Все заказы',exact:true}).click();
  await expect(page.getByRole('button',{name:/^Ставка QA/})).toBeVisible();
});
