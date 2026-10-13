import {test,expect,type BrowserContext} from '@playwright/test';
import 'dotenv/config';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const organizationId=randomUUID();let ownerId:string,workerId:string,taskId:string;
async function signIn(context:BrowserContext,userId:string){
 const value=randomBytes(32).toString('hex');
 await db.session.create({data:{userId,tokenHash:createHash('sha256').update(value).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
 await context.addCookies([{name:'tirek_session',value,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
}
test.beforeAll(async()=>{
 const org=await db.organization.create({data:{id:organizationId,name:'Task discussion QA',users:{create:[
  {name:'Discussion owner',role:'OWNER',email:randomUUID()+'@discussion-browser.invalid',passwordHash:'unused'},
  {name:'Discussion worker',role:'EMPLOYEE',email:randomUUID()+'@discussion-browser.invalid',passwordHash:'unused'}
 ]}},include:{users:true}});
 ownerId=org.users.find(u=>u.role==='OWNER')!.id;workerId=org.users.find(u=>u.role==='EMPLOYEE')!.id;
 const task=await db.businessTask.create({data:{organizationId,assigneeId:workerId,createdById:ownerId,title:'Delivery agreement'}});
 taskId=task.id;
 await db.taskComment.createMany({data:Array.from({length:21},(_,i)=>({organizationId,taskId,authorId:ownerId,authorName:'Owner',body:'Earlier agreement '+i,idempotencyKey:randomUUID(),createdAt:new Date('2020-01-01T00:00:00Z')}))});
});
test.afterAll(async()=>{
 await db.businessTask.deleteMany({where:{organizationId}});
 await db.user.deleteMany({where:{organizationId}});
 await db.organization.deleteMany({where:{id:organizationId}});
 await db.$disconnect();
});
test('owner records discussion, retries lost response once, pages and switches RU/KK/EN on phone',async({page,context})=>{
 test.setTimeout(60000);
 await signIn(context,ownerId);await page.goto('/');
 await page.getByRole('button',{name:'Задачи',exact:true}).click();
 await page.getByRole('button',{name:'Обсуждение',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Обсуждение задачи'});
 await expect(dialog.locator('.task-comment')).toHaveCount(20);
 await dialog.getByRole('button',{name:'Далее',exact:true}).click();
 await expect(dialog.locator('.task-comment')).toHaveCount(1);
 const value='<img src=x onerror=alert(1)>\nКелісім · Agreement '+ 'Ж'.repeat(400);
 let lost=true;const keys:string[]=[];
 await page.route('**/api/tasks/'+taskId+'/comments',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return;}
  keys.push(route.request().postDataJSON().idempotencyKey);
  if(lost){lost=false;await route.fetch();await route.abort('failed');}
  else await route.continue();
 });
 await dialog.getByRole('textbox',{name:'Комментарий',exact:true}).fill(value);
 await dialog.getByRole('button',{name:'Отправить комментарий'}).click();
 await expect(dialog.getByRole('alert')).toContainText('Не удалось связаться с сервером');
 await expect(dialog.getByRole('textbox',{name:'Комментарий',exact:true})).toHaveValue(value);
 await dialog.getByRole('button',{name:'Отправить комментарий'}).click();
 await expect(dialog.getByRole('status').filter({hasText:'Комментарий добавлен'})).toHaveText('Комментарий добавлен');
 await expect(dialog.locator('.task-comment')).toHaveCount(20);
 await expect(dialog.locator('.task-comment').first()).toContainText(value);
 await expect(dialog.locator('.task-comment img')).toHaveCount(0);
 await expect(dialog.getByRole('textbox',{name:'Комментарий',exact:true})).toHaveValue('');
 expect(keys.length).toBe(2);expect(keys[0]).toBe(keys[1]);
 expect(await db.taskComment.count({where:{organizationId,taskId,body:value}})).toBe(1);
 await page.unroute('**/api/tasks/'+taskId+'/comments');
 await page.setViewportSize({width:390,height:844});
 for(const [locale,title,label]of [['kk','Тапсырманы талқылау','Түсініктеме'],['en','Task discussion','Comment'],['ru','Обсуждение задачи','Комментарий']]){
  await page.getByRole('dialog').getByRole('button',{name:/^(Закрыть|Close|Жабу)$/}).click();
  await page.locator('.language-switcher select').selectOption(locale);
  await page.locator('.task-card').getByRole('button',{name:/^(Обсуждение|Discussion|Талқылау)$/}).click();
  const translated=page.getByRole('dialog',{name:title});
  await expect(translated.getByRole('textbox',{name:label,exact:true})).toBeVisible();
  await expect(translated.locator('.task-comment').first()).toContainText(value);
  expect(await translated.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }
 await page.getByRole('dialog').screenshot({path:'test-results/task-discussion-mobile.png'});
});
test('employee sees history and loses discussion after reassignment without exposing stale messages',async({page,context})=>{
 await signIn(context,workerId);await page.goto('/');
 await page.getByRole('button',{name:'Обсуждение',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.locator('.task-comment').first()).toBeVisible();
 await dialog.getByRole('textbox',{name:'Комментарий',exact:true}).fill('Worker agreement');
 await dialog.getByRole('button',{name:'Отправить комментарий'}).click();
 await expect(dialog.getByRole('status').filter({hasText:'Комментарий добавлен'})).toHaveText('Комментарий добавлен');
 await expect(dialog.locator('.task-comment').first()).toContainText('Worker agreement');
 await db.businessTask.update({where:{id:taskId},data:{assigneeId:ownerId,version:{increment:1}}});
 await dialog.getByRole('button',{name:'Обновить',exact:true}).click();
 await expect(dialog.getByText('Доступ к обсуждению изменился. Закройте окно и обновите задачи.',{exact:true})).toBeVisible();
 await expect(dialog.locator('.task-comment')).toHaveCount(0);
 await expect(dialog.getByRole('textbox',{name:'Комментарий',exact:true})).toHaveCount(0);
});
