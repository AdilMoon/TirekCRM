import {test,expect,type BrowserContext} from './fixtures';
import 'dotenv/config';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
let organizationId:string,ownerId:string,workerId:string,ownerToken:string,workerToken:string,taskId:string;
const origin='http://localhost:3000';
async function token(userId:string){
 const value=randomBytes(32).toString('hex');
 await db.session.create({data:{userId,tokenHash:createHash('sha256').update(value).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});return value;
}
async function signIn(context:BrowserContext,value:string){
 await context.addCookies([{name:'tirek_session',value,url:origin,httpOnly:true,sameSite:'Lax'}]);
}
async function api(path:string,body:unknown,value=ownerToken,method='POST'){
 const r=await fetch('http://127.0.0.1:4000/api'+path,{method,headers:{Origin:origin,Cookie:'tirek_session='+value,'Content-Type':'application/json'},body:JSON.stringify(body)});
 expect(r.ok).toBe(true);return r.json();
}
test.beforeEach(async()=>{
 organizationId=randomUUID();
 const org=await db.organization.create({data:{id:organizationId,name:'Notification browser QA',users:{create:[
  {name:'Notification owner',role:'OWNER',email:randomUUID()+'@notice-browser.invalid',passwordHash:'unused'},
  {name:'Notification worker',role:'EMPLOYEE',email:randomUUID()+'@notice-browser.invalid',passwordHash:'unused'}
 ]}},include:{users:true}});
 ownerId=org.users.find(u=>u.role==='OWNER')!.id;workerId=org.users.find(u=>u.role==='EMPLOYEE')!.id;
 ownerToken=await token(ownerId);workerToken=await token(workerId);
 const task=await api('/tasks',{title:'Delivery <img src=x onerror=alert(1)> '+ 'Ж'.repeat(120),assigneeId:workerId});
 taskId=task.id;
});
test.afterEach(async()=>{
 if(organizationId){
  await db.businessTask.deleteMany({where:{organizationId}});
  await db.user.deleteMany({where:{organizationId}});
  await db.organization.deleteMany({where:{id:organizationId}});
 }
});
test.afterAll(async()=>{await db.$disconnect();});
test('employee gets assignments and comments; stale badge response cannot undo read; RU KK EN fit mobile',async({page,context})=>{
 test.setTimeout(60000);
 await api('/tasks/'+taskId+'/comments',{body:'Prepare delivery',idempotencyKey:randomUUID()});
 await signIn(context,workerToken);await page.goto('/');
 await expect(page.getByRole('button',{name:'Уведомления: 2',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Уведомления: 2',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Уведомления',exact:true});
 await expect(dialog.locator('.notification-card')).toHaveCount(2);
 await expect(dialog.locator('.notification-card img')).toHaveCount(0);
 // Hold an older unread count, mark a card read, then deliver the old result.
 let release!:()=>void,ready!:()=>void,delivered!:()=>void,hold=true;
 const gate=new Promise<void>(r=>release=r),captured=new Promise<void>(r=>ready=r),finished=new Promise<void>(r=>delivered=r);
 await page.route('**/api/notifications/unread-count',async route=>{
  if(!hold){await route.continue();return;}hold=false;
  const response=await route.fetch();ready();await gate;
  await route.fulfill({response}).catch(()=>{});delivered();
 });
 await dialog.getByRole('button',{name:'Обновить',exact:true}).click();await captured;
 await expect(dialog.locator('.notification-card')).toHaveCount(2);
 await dialog.getByRole('button',{name:'Отметить прочитанным',exact:true}).first().click();
 await expect(page.getByRole('button',{name:'Уведомления: 1',exact:true})).toBeAttached();
 release();await finished;
 await expect(page.getByRole('button',{name:'Уведомления: 1',exact:true})).toBeAttached();
 await page.unroute('**/api/notifications/unread-count');
 await dialog.getByRole('checkbox',{name:'Только непрочитанные',exact:true}).check();
 await expect(dialog.locator('.notification-card')).toHaveCount(1);
 await dialog.getByRole('button',{name:'Отметить показанные прочитанными',exact:true}).click();
 await expect(dialog.getByText('Непрочитанных уведомлений нет',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Уведомления: 0',exact:true})).toBeAttached();
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 for(const [locale,label,close]of [['kk','Хабарландырулар','Жабу'],['en','Notifications','Close'],['ru','Уведомления','Закрыть']]){
  await page.locator('.language-switcher select').selectOption(locale);
  await page.getByRole('button',{name:new RegExp('^'+label+':')}).click();
  const translated=page.getByRole('dialog',{name:label,exact:true});
  await expect(translated.locator('.notification-card')).toHaveCount(2);
  expect(await translated.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await translated.getByRole('button',{name:close,exact:true}).click();
 }
 await page.getByRole('button',{name:'Уведомления: 0',exact:true}).click();
 await expect(page.getByRole('dialog').locator('.notification-card')).toHaveCount(2);
 await page.getByRole('dialog').screenshot({path:'test-results/notifications-mobile.png'});
});
test('owner opens comment from notification and a failed read remains retryable',async({page,context})=>{
 await api('/tasks/'+taskId+'/comments',{body:'Worker update',idempotencyKey:randomUUID()},workerToken);
 await signIn(context,ownerToken);await page.goto('/');
 await page.getByRole('button',{name:'Уведомления: 1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Уведомления',exact:true});
 await expect(dialog.getByText('Новый комментарий к задаче',{exact:true})).toBeVisible();
 await page.route('**/api/notifications/read',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Не удалось связаться с сервером'})}));
 await dialog.getByRole('button',{name:'Отметить прочитанным',exact:true}).click();
 await expect(dialog.getByRole('alert')).toHaveText('Не удалось связаться с сервером');
 expect(await db.notification.count({where:{organizationId,recipientId:ownerId,readAt:null}})).toBe(1);
 await page.unroute('**/api/notifications/read');
 await dialog.getByRole('button',{name:'Открыть обсуждение',exact:true}).click();
 const discussion=page.getByRole('dialog',{name:'Обсуждение задачи',exact:true});
 await expect(discussion.locator('.task-comment')).toContainText('Worker update');
 await expect(page.getByRole('button',{name:'Уведомления: 0',exact:true})).toBeAttached();
 expect(await db.notification.count({where:{organizationId,recipientId:ownerId,readAt:null}})).toBe(0);
});
test('notification refresh handles outages and inaccessible task cannot be opened',async({page,context})=>{
 await signIn(context,workerToken);await page.goto('/');
 await page.getByRole('button',{name:'Уведомления: 1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Уведомления',exact:true});
 await expect(dialog.locator('.notification-card')).toHaveCount(1);
 await page.route('**/api/notifications?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Не удалось связаться с сервером'})}));
 await dialog.getByRole('button',{name:'Обновить',exact:true}).click();
 await expect(dialog.getByRole('alert')).toHaveText('Не удалось связаться с сервером');
 await expect(dialog.locator('.notification-card')).toHaveCount(0);
 await page.unroute('**/api/notifications?*');
 await dialog.getByRole('button',{name:'Обновить',exact:true}).click();
 await expect(dialog.locator('.notification-card')).toHaveCount(1);
 await api('/tasks/'+taskId,{title:'Now private',assigneeId:ownerId,version:1},ownerToken,'PATCH');
 await dialog.getByRole('button',{name:'Открыть обсуждение',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Задача не найдена');
 await expect(dialog.locator('.notification-card')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Уведомления: 0',exact:true})).toBeAttached();
 await expect(page.getByRole('dialog',{name:'Обсуждение задачи',exact:true})).toHaveCount(0);
});

test('a late unauthorized badge response cannot log out a freshly rotated session',async({page,context})=>{
 await api('/tasks/'+taskId+'/comments',{body:'Owner notification',idempotencyKey:randomUUID()},workerToken);
 await signIn(context,ownerToken);await page.goto('/');
 await expect(page.getByRole('button',{name:'Уведомления: 1',exact:true})).toBeVisible();
 let release!:()=>void,ready!:()=>void,delivered!:()=>void,hold=true;
 const gate=new Promise<void>(r=>release=r),captured=new Promise<void>(r=>ready=r),finished=new Promise<void>(r=>delivered=r);
 await page.route('**/api/notifications/unread-count',async route=>{
  if(!hold){await route.continue();return;}hold=false;ready();await gate;
  await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'Сессия истекла. Войдите снова'})});delivered();
 });
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await captured;
 // The cookie rotation models a completed password change, limited to this fixture account.
 const rotated=await token(ownerId);
 await db.session.deleteMany({where:{userId:ownerId,tokenHash:createHash('sha256').update(ownerToken).digest('hex')}});
 await signIn(context,rotated);release();await finished;
 await expect(page.getByRole('button',{name:'Уведомления: 1',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Войти в пространство',exact:true})).toHaveCount(0);
 await page.unroute('**/api/notifications/unread-count');
});

test('revoked session still returns to sign in when notifications refresh',async({page,context})=>{
 await signIn(context,workerToken);await page.goto('/');
 await expect(page.getByRole('button',{name:'Уведомления: 1',exact:true})).toBeVisible();
 await db.session.deleteMany({where:{userId:workerId}});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'Войти в пространство',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Уведомления/})).toHaveCount(0);
});
