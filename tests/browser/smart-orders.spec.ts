import {test,expect} from './fixtures';
import 'dotenv/config';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import sharp from 'sharp';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID(),email=org+'@smart-browser.invalid',employeeEmail=randomUUID()+'@smart-browser.invalid',password='SmartBrowser2026!';
let ownerId:string,employeeId:string;
test.beforeAll(async()=>{
 const salt=randomBytes(16).toString('hex'),passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex');
 const result=await db.organization.create({data:{id:org,name:'Tirek Studio',users:{create:[{name:'Smart owner',email,role:'OWNER',passwordHash},{name:'Smart employee',email:employeeEmail,role:'EMPLOYEE',passwordHash}]}},include:{users:true}});
 ownerId=result.users.find(u=>u.role==='OWNER')!.id;employeeId=result.users.find(u=>u.role==='EMPLOYEE')!.id;
});
test.afterAll(async()=>{
 await db.businessTask.deleteMany({where:{organizationId:org}});await db.order.deleteMany({where:{organizationId:org}});await db.client.deleteMany({where:{organizationId:org}});await db.auditEvent.deleteMany({where:{organizationId:org}});await db.user.deleteMany({where:{organizationId:org}});await db.organization.deleteMany({where:{id:org}});await db.$disconnect();
});
async function png(color:string){return sharp({create:{width:600,height:380,channels:3,background:color}}).png().toBuffer();}
test('message review survives lost response then publishes photos and accepts a versioned passport',async({page})=>{
 test.setTimeout(90000);
 await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти в пространство',exact:true}).click();
 await page.getByRole('button',{name:/Из сообщения в заказ/}).click();
 await page.getByLabel('Сообщение клиента',{exact:true}).fill('Нужна уборка квартиры завтра в 15:00, бюджет 25 000 ₸. Меня зовут Айдана, +7 700 111 22 33.');
 await page.getByRole('button',{name:'Разобрать сообщение',exact:true}).click();
 await expect(page.getByLabel('Имя нового клиента',{exact:true})).toHaveValue('Айдана');
 await expect(page.getByLabel('Стоимость услуги, ₸',{exact:true})).toHaveValue('25000.00');
 expect(await db.order.count({where:{organizationId:org}})).toBe(0);
 await page.screenshot({path:'test-results/message-order-review.png',fullPage:true,animations:'disabled'});
 await page.route('**/api/message-orders',async route=>{const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed');});
 await page.getByRole('button',{name:'Подтвердить и создать',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Не удалось связаться с сервером');
 expect(await db.order.count({where:{organizationId:org}})).toBe(1);
 await page.unroute('**/api/message-orders');await page.getByRole('button',{name:'Повторить сохранение',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('button',{name:'QR-паспорт заказа',exact:true})).toBeVisible();
 expect(await db.order.count({where:{organizationId:org}})).toBe(1);
 const order=await db.order.findFirstOrThrow({where:{organizationId:org}});
 await page.getByRole('button',{name:'QR-паспорт заказа',exact:true}).click();
 await expect(page.getByRole('heading',{name:'QR-паспорт заказа',exact:true})).toBeVisible();
 for(const [name,phase,shared,color] of [['before.png','BEFORE',true,'#e5af77'],['after.png','AFTER',true,'#398a76'],['private.png','AFTER',false,'#8b96b5']] as const){
  await page.getByLabel('Этап фото',{exact:true}).selectOption(phase);
  await page.getByLabel('Фотография',{exact:true}).setInputFiles({name,mimeType:'image/png',buffer:await png(color)});
  await page.getByLabel('Показать это фото клиенту по ссылке',{exact:true}).setChecked(shared);
  await page.getByRole('button',{name:'Загрузить фото',exact:true}).click();
  await expect(page.getByRole('button',{name:'Загрузить фото',exact:true})).toBeDisabled();
 }
 await expect(page.locator('.passport-photos figure')).toHaveCount(3);
 await page.getByRole('button',{name:'Создать QR-паспорт',exact:true}).click();
 await expect(page.getByRole('img',{name:'QR-код паспорта заказа'})).toBeVisible();
 const url=await page.getByLabel('Ссылка для клиента',{exact:true}).inputValue();expect(url).toContain('/passport#token=');
 await page.screenshot({path:'test-results/order-passport-qr.png',fullPage:true,animations:'disabled'});
 const [client]=await Promise.all([page.waitForEvent('popup'),page.getByRole('link',{name:'Открыть паспорт',exact:true}).click()]);
 try{
  await expect(client.getByRole('heading',{name:'уборка квартиры',exact:true})).toBeVisible();await expect(client.locator('.passport-photos figure')).toHaveCount(2);
  await expect(client.getByText('+77001112233',{exact:true})).toHaveCount(0);
  await expect(client.getByRole('button',{name:'Подтвердить выполнение',exact:true})).toHaveCount(0);
  await db.order.update({where:{id:order.id},data:{status:'COMPLETED',version:{increment:1}}});
  await client.getByRole('button',{name:'Обновить',exact:true}).click();
  await client.getByLabel('Я ознакомился с результатом и подтверждаю выполнение работы',{exact:true}).check();
  await client.getByRole('button',{name:'Подтвердить выполнение',exact:true}).click();
  await expect(client.getByRole('status')).toContainText('Вы подтвердили выполнение');
  await client.setViewportSize({width:390,height:844});expect(await client.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await client.screenshot({path:'test-results/customer-passport-mobile.png',fullPage:true,animations:'disabled'});
  await client.getByRole('combobox',{name:'Язык интерфейса'}).selectOption('kk');await expect(client.getByRole('heading',{name:'Нәтижені растау',exact:true})).toBeVisible();
  await client.getByRole('combobox',{name:'Интерфейс тілі'}).selectOption('en');await expect(client.getByRole('heading',{name:'Confirm the result',exact:true})).toBeVisible();
  await client.getByRole('combobox',{name:'Interface language'}).selectOption('ru');
  await page.getByRole('button',{name:'Отозвать ссылку',exact:true}).click();await expect(page.getByText('Публичная ссылка не активна',{exact:false})).toBeVisible();
  await client.getByRole('button',{name:'Обновить',exact:true}).click();await expect(client.locator('main').getByRole('alert')).toContainText('Ссылка недоступна или срок истёк');await expect(client.locator('.passport-photos')).toHaveCount(0);
 }catch(e){await client.screenshot({path:'test-results/passport-client-failure.png',fullPage:true});throw e;}finally{await client.close();}
});
test('assigned employee adds photo on mobile without permission to publish and loses access after reassignment',async({page})=>{
 const c=await db.client.create({data:{organizationId:org,name:'Employee photo client'}});
 const order=await db.order.create({data:{organizationId:org,clientId:c.id,number:500,title:'Фотофиксация работы',total:'10.00'}});
 const task=await db.businessTask.create({data:{organizationId:org,createdById:ownerId,assigneeId:employeeId,orderId:order.id,title:'Сделать фото результата'}});
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(employeeEmail);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти в пространство',exact:true}).click();
 await page.getByRole('button',{name:'QR-паспорт заказа',exact:true}).click();
 await expect(page.getByLabel('Фотография',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Создать QR-паспорт',exact:true})).toHaveCount(0);
 await page.getByLabel('Фотография',{exact:true}).setInputFiles({name:'employee.png',mimeType:'image/png',buffer:await png('#26705c')});
 await page.getByRole('button',{name:'Загрузить фото',exact:true}).click();await expect(page.locator('.passport-photos figure')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/employee-passport-photo.png',fullPage:true,animations:'disabled'});
 await db.businessTask.update({where:{id:task.id},data:{assigneeId:ownerId}});
 await page.getByLabel('Фотография',{exact:true}).setInputFiles({name:'blocked.png',mimeType:'image/png',buffer:await png('#26705c')});await page.getByRole('button',{name:'Загрузить фото',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Недостаточно прав');expect(await db.orderPhoto.count({where:{orderId:order.id}})).toBe(1);
});
