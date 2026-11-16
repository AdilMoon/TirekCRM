import {openManagement,test,expect} from './fixtures';
import 'dotenv/config';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID(),email=org+'@scheduling-browser.invalid',password='SchedulingBrowser2026!';
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+2*86400000));
let ownerId:string,a:string,b:string,mainId:string,otherId:string;
test.beforeAll(async()=>{
 const salt=randomBytes(16).toString('hex'),passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex');
 const fixture=await db.organization.create({data:{id:org,name:'Tirek Scheduling',users:{create:[{email,name:'Schedule owner',role:'OWNER',passwordHash},{email:randomUUID()+'@scheduling-browser.invalid',name:'Айдана',role:'EMPLOYEE',passwordHash},{email:randomUUID()+'@scheduling-browser.invalid',name:'Бекзат',role:'EMPLOYEE',passwordHash},{email:randomUUID()+'@scheduling-browser.invalid',name:'Дана',role:'EMPLOYEE',passwordHash}]}},include:{users:true}});
 ownerId=fixture.users.find(u=>u.role==='OWNER')!.id;a=fixture.users.find(u=>u.name==='Айдана')!.id;b=fixture.users.find(u=>u.name==='Бекзат')!.id;
 const client=await db.client.create({data:{organizationId:org,name:'Schedule client'}});
 for(const [number,title] of [[1,'Уборка офиса'],[2,'Другая уборка']] as const){const order=await db.order.create({data:{organizationId:org,clientId:client.id,number,title,total:'100.00',dueDate:new Date(day+'T00:00:00Z')}});if(number===1)mainId=order.id;else otherId=order.id;}
});
test.afterAll(async()=>{
 await db.businessTask.deleteMany({where:{organizationId:org}});await db.order.deleteMany({where:{organizationId:org}});await db.client.deleteMany({where:{organizationId:org}});await db.auditEvent.deleteMany({where:{organizationId:org}});await db.user.deleteMany({where:{organizationId:org}});await db.organization.deleteMany({where:{id:org}});await db.$disconnect();
});
test('owner configures working hours sees explained recommendation retries lost response and reschedules on mobile',async({page})=>{
 test.setTimeout(90000);
 await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти в пространство',exact:true}).click();
 await openManagement(page);await page.getByRole('button',{name:'Команда',exact:true}).click();await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'Навыки и график',exact:true})).toBeInViewport();await page.setViewportSize({width:1280,height:900});await page.getByRole('button',{name:'Навыки и график',exact:true}).click();
 for(const name of ['Айдана','Бекзат']){
  await page.locator('.schedule-members article').filter({hasText:name}).getByRole('button',{name:'Настроить',exact:true}).click();
  await page.getByLabel('Навыки через запятую',{exact:true}).fill('Уборка, окна');await page.getByLabel('Суббота',{exact:true}).check();await page.getByLabel('Воскресенье',{exact:true}).check();
  await page.getByLabel('Начало смены (Алматы)',{exact:true}).fill('09:00');await page.getByLabel('Конец смены (Алматы)',{exact:true}).fill('18:00');
  await page.getByRole('button',{name:'Сохранить профиль',exact:true}).click();await expect(page.getByText('Профиль сохранён',{exact:true})).toBeVisible();
 }
 await page.screenshot({path:'test-results/scheduling-profiles.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 // A valid existing afternoon reservation gives Bekzat a greater measured daily load.
 const task=await db.businessTask.create({data:{organizationId:org,createdById:ownerId,assigneeId:b,orderId:otherId,title:'Другая уборка'}});
 await db.workBooking.create({data:{organizationId:org,orderId:otherId,employeeId:b,taskId:task.id,startsAt:new Date(day+'T13:00:00+05:00'),endsAt:new Date(day+'T14:00:00+05:00'),requiredSkills:['уборка'],createdById:ownerId,idempotencyKey:randomUUID(),inputHash:'a'.repeat(64)}});
 await page.getByRole('button',{name:/^Заказы/}).click();await page.getByRole('button',{name:/^Уборка офиса/}).click();await page.getByRole('button',{name:'Умное распределение',exact:true}).click();
 await page.getByLabel('Начало работы (Алматы)',{exact:true}).fill(day+'T09:00');await page.getByLabel('Длительность, минут',{exact:true}).fill('60');await page.getByLabel('Нужные навыки через запятую',{exact:true}).fill('Уборка, окна');
 await page.getByRole('button',{name:'Подобрать исполнителей',exact:true}).click();
 const ay=page.locator('.schedule-candidate').filter({hasText:'Айдана'}),bek=page.locator('.schedule-candidate').filter({hasText:'Бекзат'});
 await expect(ay.getByText('Рекомендуем',{exact:true})).toBeVisible();await expect(ay).toContainText('Занято за день: 0 мин.');await expect(bek).toContainText('Занято за день: 60 мин.');
 await expect(page.getByRole('radio',{name:'Выбрать Дана',exact:true})).toBeDisabled();
 expect(await db.workBooking.count({where:{organizationId:org,orderId:mainId}})).toBe(0);
 await page.screenshot({path:'test-results/scheduling-recommendation.png',fullPage:true,animations:'disabled'});
 await page.route('**/api/orders/'+mainId+'/assignment',async route=>{const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed');});
 await page.getByRole('button',{name:'Подтвердить назначение',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Не удалось связаться с сервером');
 expect(await db.workBooking.count({where:{organizationId:org,orderId:mainId}})).toBe(1);
 await page.unroute('**/api/orders/'+mainId+'/assignment');await page.getByRole('button',{name:'Повторить назначение',exact:true}).click();await expect(page.getByRole('dialog').getByText(/Текущий исполнитель: Айдана/)).toBeVisible();
 expect(await db.businessTask.count({where:{organizationId:org,orderId:mainId}})).toBe(1);expect(await db.notification.count({where:{organizationId:org,recipientId:a,kind:'TASK_ASSIGNED'}})).toBe(1);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Подобрать исполнителей',exact:true}).click();
 await page.getByRole('radio',{name:'Выбрать Бекзат',exact:true}).check();await page.getByRole('button',{name:'Подтвердить переназначение',exact:true}).click();await expect(page.getByText(/Текущий исполнитель: Бекзат/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/scheduling-mobile.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.setViewportSize({width:1280,height:900});await page.getByRole('button',{name:/^Другая уборка/}).click();await page.getByRole('button',{name:'Умное распределение',exact:true}).click();
 await page.getByLabel('Начало работы (Алматы)',{exact:true}).fill(day+'T09:30');await page.getByLabel('Нужные навыки через запятую',{exact:true}).fill('уборка');await page.getByRole('button',{name:'Подобрать исполнителей',exact:true}).click();
 await expect(page.locator('.schedule-candidate').filter({hasText:'Бекзат'})).toContainText('Пересечение с другим заказом');await expect(page.getByRole('radio',{name:'Выбрать Бекзат',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('combobox',{name:'Язык интерфейса'}).selectOption('kk');await page.getByRole('button',{name:/^Уборка офиса/}).click();await page.getByRole('button',{name:'Ақылды бөлу',exact:true}).click();await expect(page.getByRole('heading',{name:'Ақылды бөлу',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Жабу',exact:true}).click();await page.getByRole('button',{name:'Жабу',exact:true}).click();
 await page.getByRole('combobox',{name:'Интерфейс тілі'}).selectOption('en');await page.getByRole('button',{name:/^Уборка офиса/}).click();await page.getByRole('button',{name:'Smart assignment',exact:true}).click();await expect(page.getByRole('heading',{name:'Smart assignment',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel assignment',exact:true}).click();await expect(page.getByRole('status')).toContainText('Assignment cancelled.');
 expect(await db.workBooking.count({where:{organizationId:org,orderId:mainId,releasedAt:null}})).toBe(0);
});
