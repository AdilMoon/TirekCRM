import 'dotenv/config';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {expect,test} from './fixtures';
test.use({actionTimeout:15000});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID(),where={organizationId:org};
test.afterAll(async()=>{
 await db.serviceRequest.deleteMany({where});await db.businessTask.deleteMany({where});await db.order.deleteMany({where});
 await db.serviceObject.deleteMany({where});await db.client.deleteMany({where});await db.auditEvent.deleteMany({where});
 await db.user.deleteMany({where});await db.organization.deleteMany({where:{id:org}});await db.$disconnect();
});
test('client requests repeat service and owner creates an order while the assigned worker reads object history',async({page,context,browser,baseURL},testInfo)=>{
 test.setTimeout(120000);const origin=baseURL??'http://localhost:3000';
 await db.organization.create({data:{id:org,name:'Objects Edge QA',orderSeq:2}});
 async function user(role:'OWNER'|'EMPLOYEE'){
  const row=await db.user.create({data:{organizationId:org,role,name:role,email:randomUUID()+'@objects-edge.invalid',passwordHash:'unused'}});
  const token=randomBytes(32).toString('hex');await db.session.create({data:{userId:row.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});return {...row,token};
 }
 const owner=await user('OWNER'),worker=await user('EMPLOYEE');
 const client=await db.client.create({data:{organizationId:org,name:'Клиент QA',phone:'PRIVATE-CONTACT'}});
 async function order(number:number,title:string,status:'COMPLETED'|'IN_PROGRESS'){
  return db.order.create({data:{organizationId:org,clientId:client.id,number,title,status,total:'5000',notes:'PRIVATE-NOTES',
   items:{create:{description:'Обслуживание',quantity:1,unitPrice:'5000',total:'5000'}}}});
 }
 const root=await order(1,'Насос QA исходный','COMPLETED'),current=await order(2,'Насос QA текущий','IN_PROGRESS');
 const task=await db.businessTask.create({data:{organizationId:org,orderId:current.id,createdById:owner.id,assigneeId:worker.id,title:'Проверка насоса QA'}});
 const call=(path:string,method='GET',body?:unknown,token=owner.token)=>fetch(origin+'/api'+path,{method,headers:{Cookie:'tirek_session='+token,Origin:origin,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 expect((await call('/orders/'+root.id+'/service-object?historyPage=-1')).status).toBe(400);
 expect((await call('/orders/'+root.id+'/service-object','PUT',{kind:'CREATE',name:'Bad',address:'',creationKey:randomUUID(),orderVersion:1},worker.token)).status).toBe(403);
 await context.addCookies([{name:'tirek_session',value:owner.token,url:origin,httpOnly:true}]);await page.goto('/');
 await page.getByRole('button',{name:/^Насос QA исходный/}).click();
 let dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'Объект и история обслуживания',exact:true}).click();
 await dialog.getByLabel('Название объекта',{exact:true}).fill('Насосная станция QA');
 await dialog.getByLabel('Адрес объекта',{exact:true}).fill('PRIVATE-ADDRESS');
 await dialog.getByRole('button',{name:'Создать и связать объект',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Насосная станция QA',exact:true})).toBeVisible();
 await expect(dialog.getByRole('region',{name:'История обслуживания'})).toContainText('Насос QA исходный');
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 await dialog.getByRole('button',{name:'QR-паспорт заказа',exact:true}).click();
 await dialog.getByRole('button',{name:'Создать QR-паспорт',exact:true}).click();
 const url=await dialog.getByLabel('Ссылка для клиента',{exact:true}).inputValue();
 const clientContext=await browser.newContext({viewport:{width:390,height:844}}),publicPage=await clientContext.newPage();
 try{
  await publicPage.goto(url);await expect(publicPage.getByRole('heading',{name:'Нужно обслуживание снова?',exact:true})).toBeVisible();
  await expect(publicPage.locator('main')).not.toContainText('PRIVATE-ADDRESS');await expect(publicPage.locator('main')).not.toContainText('PRIVATE-CONTACT');
  await publicPage.getByLabel('Что нужно сделать',{exact:true}).fill('Нужно плановое обслуживание насоса QA');
  expect(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await publicPage.screenshot({path:testInfo.outputPath('public-service-request-mobile.png'),fullPage:true});
  await publicPage.getByRole('button',{name:'Отправить обращение',exact:true}).click();await expect(publicPage.getByRole('status')).toContainText('Обращение отправлено');
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Все причины по заказам',exact:true}).click();
  const board=page.getByRole('region',{name:'Заказы, требующие внимания'});await board.getByLabel('Причина',{exact:true}).selectOption('SERVICE_REQUEST');
  await expect(board.locator('.attention-order')).toHaveCount(1);await board.getByRole('button',{name:'Повторное обращение клиента',exact:true}).click();
  await expect(dialog.getByRole('region',{name:'Обращения по объекту'})).toContainText('Нужно плановое обслуживание насоса QA');
  await page.setViewportSize({width:390,height:844});
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('owner-service-request-mobile.png')});
  await dialog.getByLabel('Название нового заказа',{exact:true}).fill('Плановое обслуживание QA');
  await dialog.getByLabel('Стоимость работ, ₸',{exact:true}).fill('1999.99');
  await dialog.getByRole('button',{name:'Создать заказ из обращения',exact:true}).click();
  await expect(dialog).toContainText('Создан заказ');
  const created=await db.order.findFirstOrThrow({where:{...where,title:'Плановое обслуживание QA'}});expect(created.total.toFixed(2)).toBe('1999.99');expect(created.repeatOfId).toBeNull();
  await dialog.getByRole('button',{name:/Открыть заказ · №/}).click();await expect(dialog).toContainText('Плановое обслуживание QA');
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(board).toContainText('Заказов с такими причинами не найдено');
  await page.setViewportSize({width:1280,height:900});await page.getByRole('button',{name:'Все заказы',exact:true}).click();
  await page.getByRole('button',{name:/^Насос QA текущий/}).click();await dialog.getByRole('button',{name:'Объект и история обслуживания',exact:true}).click();
  await dialog.getByLabel('Способ привязки',{exact:true}).selectOption('LINK');
  await dialog.getByRole('textbox',{name:'Поиск',exact:true}).fill('Насосная');await expect(dialog.locator('.service-choice')).toHaveCount(1);
  await dialog.getByRole('button',{name:'Связать с заказом',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Насосная станция QA',exact:true})).toBeVisible();
  await expect(dialog.locator('.service-history article')).toHaveCount(3);
  const workerContext=await browser.newContext({viewport:{width:390,height:844}});
  try{
   await workerContext.addCookies([{name:'tirek_session',value:worker.token,url:origin,httpOnly:true}]);const workerPage=await workerContext.newPage();await workerPage.goto('/');
   await workerPage.getByRole('button',{name:'Обсуждение',exact:true}).click();await workerPage.getByRole('button',{name:'Объект и история обслуживания',exact:true}).click();
   const workerDialog=workerPage.getByRole('dialog');await expect(workerDialog.locator('.service-history article')).toHaveCount(1);await expect(workerDialog).toContainText('Насос QA исходный');
   await expect(workerDialog.getByRole('region',{name:'Обращения по объекту'})).toHaveCount(0);await expect(workerDialog).not.toContainText('1999');
   await workerPage.screenshot({path:testInfo.outputPath('employee-object-mobile.png')});
   await db.businessTask.update({where:{id:task.id},data:{assigneeId:owner.id}});await workerDialog.getByRole('button',{name:'Обновить',exact:true}).click();await expect(workerDialog.getByRole('alert')).toContainText('Заказ не найден');
  }finally{await workerContext.close();}
  expect((await call('/orders/'+root.id+'/passport/link','DELETE')).status).toBe(200);
  const token=new URL(url).hash.slice(7);expect((await call('/passport/service-requests','POST',{token,submissionKey:randomUUID(),description:'Revoked request QA'})).status).toBe(404);
  await publicPage.getByRole('button',{name:'Обновить',exact:true}).click();await expect(publicPage.locator('main').getByRole('alert')).toContainText('Ссылка недоступна или срок истёк');await expect(publicPage.getByLabel('Что нужно сделать')).toHaveCount(0);
 }finally{await clientContext.close();}
});
