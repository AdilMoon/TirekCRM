import {navigateWorkspace} from './fixtures';
import 'dotenv/config';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import sharp from 'sharp';
import {TeamService} from '../../backend/dist/modules/team/team.service.js';
import {AuditService} from '../../backend/dist/modules/audit/audit.service.js';
import {expect,test,openManagement} from './fixtures';
test.use({actionTimeout:15000});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID(),where={organizationId:org};
const team=new TeamService({client:db},new AuditService({client:db}));
const password='EmployeeFirstDay2026!';
let owner:any,ownerToken:string;
test.beforeAll(async()=>{
 await db.organization.create({data:{id:org,name:'First day Edge QA',orderSeq:1}});
 owner=await db.user.create({data:{organizationId:org,role:'OWNER',name:'Owner QA',email:randomUUID()+'@first-edge.invalid',passwordHash:'unused'}});
 ownerToken=randomBytes(32).toString('hex');await db.session.create({data:{userId:owner.id,tokenHash:createHash('sha256').update(ownerToken).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
});
test.afterAll(async()=>{
 await db.workTimeEntry.deleteMany({where});await db.businessTask.deleteMany({where});await db.order.deleteMany({where});await db.client.deleteMany({where});
 await db.invitation.deleteMany({where});await db.auditEvent.deleteMany({where});await db.user.deleteMany({where});await db.organization.deleteMany({where:{id:org}});await db.$disconnect();
});
test('owner invites and assigns, employee enters directly and completes photos, actual time and acceptance',async({page,context,browser,baseURL},testInfo)=>{
 test.setTimeout(120000);const origin=baseURL??'http://localhost:3000',email=randomUUID()+'@first-edge.invalid';
 const client=await db.client.create({data:{organizationId:org,name:'PRIVATE CLIENT QA',phone:'PRIVATE CONTACT'}});
 const order=await db.order.create({data:{organizationId:org,clientId:client.id,number:1,title:'Заказ первого дня QA',total:'10000',status:'IN_PROGRESS',notes:'PRIVATE FINANCIAL NOTES'}});
 await db.orderAcceptance.create({data:{organizationId:org,orderId:order.id,items:[{id:randomUUID(),label:'Результат проверен QA',required:true,checked:false,checkedBy:null}]}});
 await context.addCookies([{name:'tirek_session',value:ownerToken,url:origin,httpOnly:true}]);await page.goto('/');await openManagement(page);await page.getByRole('button',{name:'Команда',exact:true}).click();
 await page.getByRole('button',{name:'Пригласить сотрудника',exact:true}).click();let dialog=page.getByRole('dialog');
 await dialog.getByLabel('Имя сотрудника',{exact:true}).fill('Новый мастер QA');await dialog.getByLabel('Email',{exact:true}).fill(email);await dialog.getByRole('button',{name:'Создать приглашение',exact:true}).click();
 const link=await dialog.getByLabel('Одноразовая ссылка',{exact:true}).inputValue(),inviteToken=new URL(link).hash.slice(7);await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 const sameAccount=await context.newPage();await sameAccount.goto(link);await expect(sameAccount.getByText('Сейчас выполнен вход: '+owner.email,{exact:true})).toBeVisible();
 await expect(sameAccount.getByRole('button',{name:'Принять приглашение и открыть задачи',exact:true})).toBeDisabled();
 const blocked=await context.request.post(origin+'/api/team/invitations/accept',{headers:{Origin:origin},data:{token:inviteToken,password}});expect(blocked.status()).toBe(409);expect(await db.user.count({where:{email}})).toBe(0);await sameAccount.close();
 const employeeContext=await browser.newContext({viewport:{width:390,height:844}}),employeePage=await employeeContext.newPage();
 try{
  await employeePage.goto(link);await employeePage.getByLabel('Новый пароль',{exact:true}).fill(password);await employeePage.getByLabel('Повторите пароль',{exact:true}).fill(password);
  await employeePage.getByRole('button',{name:'Принять приглашение и открыть задачи',exact:true}).click();await expect(employeePage.getByRole('heading',{name:'Мои задачи',level:1})).toBeVisible();
  expect(new URL(employeePage.url()).hash).toBe('');const cookie=(await employeeContext.cookies()).find(cookie=>cookie.name==='tirek_session');expect(cookie?.httpOnly).toBe(true);expect(cookie?.sameSite).toBe('Lax');
  const worker=await db.user.findUniqueOrThrow({where:{email}});expect(worker.role).toBe('EMPLOYEE');expect(await db.session.count({where:{userId:worker.id}})).toBe(1);
  const card=employeePage.getByRole('region',{name:'Первый рабочий день',exact:true});await expect(card).toContainText('Первая задача появится здесь');
  const teamSpace=page.locator('.team-space');await teamSpace.getByRole('button',{name:'Обновить',exact:true}).click();
  await page.getByRole('row').filter({hasText:email}).getByRole('button',{name:'Назначить задачу',exact:true}).click();
  await dialog.getByLabel('Название задачи',{exact:true}).fill('Первое обслуживание QA');await dialog.getByLabel('Описание задачи',{exact:true}).fill('Проверьте результат и сохраните фото. Укажите фактический интервал работы.');
  expect(await dialog.locator('select[name="assigneeId"]').inputValue()).toBe(worker.id);
  await dialog.getByLabel('Поиск заказа',{exact:true}).fill('Заказ первого дня');await expect(dialog.locator('select[name="orderId"] option')).toHaveCount(2);await dialog.locator('select[name="orderId"]').selectOption(order.id);
  await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('status')).toContainText('Задача назначена');
  await card.getByRole('button',{name:'Обновить маршрут',exact:true}).click();await expect(card).toContainText('Первое обслуживание QA');await card.getByRole('button',{name:'Открыть пошаговый маршрут',exact:true}).click();
  const flow=employeePage.getByRole('dialog');await expect(flow.getByRole('button',{name:'Добавить фото результата',exact:true})).toBeDisabled();await expect(flow.getByRole('button',{name:'Завершить задачу',exact:true})).toBeDisabled();
  await flow.getByRole('button',{name:'Начать задачу',exact:true}).click();await expect(flow.locator('.employee-flow-steps>li.done')).toHaveCount(1);
  await flow.getByRole('button',{name:'Добавить фото результата',exact:true}).click();await expect(flow).toHaveAttribute('aria-label','Фото результата');await expect(flow.getByLabel('Этап фото',{exact:true})).toHaveCount(0);
  const image=await sharp({create:{width:80,height:60,channels:3,background:'#26705c'}}).png().toBuffer();await flow.getByLabel('Фотография',{exact:true}).setInputFiles({name:'result-qa.png',mimeType:'image/png',buffer:image});await flow.getByRole('button',{name:'Загрузить фото',exact:true}).click();
  await expect(flow).toHaveAttribute('aria-label','Пошаговый маршрут задачи');await expect(flow).toContainText('Фото результата сохранено: 1');
  const photo=await db.orderPhoto.findFirstOrThrow({where:{organizationId:org,orderId:order.id,createdById:worker.id}});expect(photo.phase).toBe('AFTER');expect(photo.shared).toBe(false);
  await flow.getByRole('button',{name:'Записать фактическое время',exact:true}).click();await expect(flow.getByLabel('Поиск заказа для табеля',{exact:true})).toHaveCount(0);await expect(flow).toContainText('Заказ первого дня QA');
  const local=(date:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date).replace(' ','T');
  const end=new Date(Math.floor((Date.now()-3600000)/60000)*60000),start=new Date(+end-3600000);
  await flow.getByLabel('Фактическое начало (Алматы)',{exact:true}).fill(local(start));await flow.getByLabel('Фактическое окончание (Алматы)',{exact:true}).fill(local(end));
  let lost=true;await employeePage.route('**/api/work-time',async route=>{if(route.request().method()==='POST'&&lost){lost=false;const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed');}else await route.continue();});
  await flow.getByRole('button',{name:'Отправить на проверку',exact:true}).click();await expect(flow.getByRole('alert')).toContainText('Не удалось связаться с сервером');
  await flow.getByRole('button',{name:'Отправить на проверку',exact:true}).click();await expect(flow).toContainText('На проверке: 60 мин');expect(await db.workTimeEntry.count({where:{organizationId:org,employeeId:worker.id}})).toBe(1);
  await expect(flow.getByRole('button',{name:'Завершить задачу',exact:true})).toBeDisabled();await flow.getByRole('button',{name:'Открыть чек-лист',exact:true}).click();const check=flow.getByRole('checkbox',{name:'Результат проверен QA *',exact:true});await check.click();await expect(check).toBeChecked();await flow.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(flow.getByRole('button',{name:'Завершить задачу',exact:true})).toBeEnabled();expect(await flow.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await employeePage.screenshot({path:testInfo.outputPath('first-day-workflow-mobile.png')});
  await flow.getByRole('button',{name:'Завершить задачу',exact:true}).click();await expect(flow.getByRole('status')).toContainText('Маршрут пройден');await flow.getByRole('button',{name:'Закрыть',exact:true}).click();await employeePage.reload();await expect(card).toContainText('Выполнено шагов: 5 из 5');
  await expect(employeePage.locator('.task-card').filter({hasText:'Первое обслуживание QA'})).toBeVisible();expect(await employeePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await employeePage.screenshot({path:testInfo.outputPath('first-day-complete-mobile.png'),fullPage:true});
  await navigateWorkspace(page,'Табель');await page.getByRole('button',{name:'Подтвердить часы',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Подтвердить часы',exact:true}).click();
  await card.getByRole('button',{name:'Открыть пошаговый маршрут',exact:true}).click();await expect(flow).toContainText('Подтверждено: 60 мин');
  const task=await db.businessTask.findFirstOrThrow({where:{organizationId:org,assigneeId:worker.id}});expect(task.status).toBe('DONE');await db.businessTask.update({where:{id:task.id},data:{assigneeId:owner.id}});
  await flow.getByRole('button',{name:'Обновить маршрут',exact:true}).click();await expect(flow.getByRole('alert')).toContainText('Задача не найдена');await expect(flow.locator('.employee-flow-steps')).toHaveCount(0);
 }finally{await employeeContext.close();}
});
test('invitation recovers a lost response without a second account or password entry',async({browser,baseURL})=>{
 const origin=baseURL??'http://localhost:3000',email=randomUUID()+'@first-edge.invalid';
 const invite=await team.invite(owner,{name:'Lost response QA',email});const isolated=await browser.newContext();
 try{
  const page=await isolated.newPage();await page.goto(origin+'/join#token='+invite.token);
  await page.getByLabel('Новый пароль',{exact:true}).fill(password);await page.getByLabel('Повторите пароль',{exact:true}).fill(password);
  await page.route('**/api/team/invitations/accept',async route=>{const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed');});
  await page.getByRole('button',{name:'Принять приглашение и открыть задачи',exact:true}).click();await expect(page.getByRole('heading',{name:'Мои задачи',level:1})).toBeVisible();
  const user=await db.user.findUniqueOrThrow({where:{email}});expect(await db.session.count({where:{userId:user.id}})).toBe(1);expect(await db.user.count({where:{email}})).toBe(1);
 }finally{await isolated.close();}
});
test('missing, malformed and expired invitations show an error without creating an account',async({browser,baseURL})=>{
 const origin=baseURL??'http://localhost:3000',isolated=await browser.newContext();
 try{
  const page=await isolated.newPage();await page.goto(origin+'/join');await expect(page.locator('.join-card').getByRole('alert')).toContainText('Приглашение недействительно или истекло');
  await page.goto(origin+'/join#token=bad-token');await expect(page.locator('.join-card').getByRole('alert')).toContainText('Приглашение недействительно или истекло');
  const email=randomUUID()+'@first-edge.invalid',invite=await team.invite(owner,{name:'Expired QA',email});await db.invitation.update({where:{id:invite.id},data:{expiresAt:new Date(Date.now()-1000)}});
  const preview=page.waitForResponse(response=>response.url().endsWith('/api/team/invitations/preview')&&response.request().postDataJSON().token===invite.token);
  await page.goto(origin+'/join#token='+invite.token);expect((await preview).status()).toBe(404);await expect(page.locator('.join-card').getByRole('alert')).toContainText('Приглашение недействительно или истекло');expect(await db.user.count({where:{email}})).toBe(0);
  await expect(page.getByRole('button',{name:'Принять приглашение и открыть задачи',exact:true})).toHaveCount(0);
 }finally{await isolated.close();}
});
