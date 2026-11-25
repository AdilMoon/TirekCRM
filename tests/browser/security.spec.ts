import {openManagement, test,expect,type BrowserContext } from './fixtures';
import 'dotenv/config';
import { randomUUID,randomBytes,createHash,scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const organizationId=randomUUID(),password='SecurityBrowser2026!',newPassword='ChangedBrowser2026!';
let ownerId:string,employeeId:string;
async function session(userId:string,userAgent='Chrome/130 Security fixture'){
 const value=randomBytes(32).toString('hex');
 const saved=await db.session.create({data:{userId,tokenHash:createHash('sha256').update(value).digest('hex'),expiresAt:new Date(Date.now()+86400000),userAgent}});
 return {id:saved.id,value};
}
async function signIn(context:BrowserContext,userId:string){
 const s=await session(userId);
 await context.addCookies([{name:'tirek_session',value:s.value,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
 return s;
}
test.beforeAll(async()=>{
 const salt=randomBytes(16).toString('hex'),passwordHash=salt+':'+scryptSync(password,salt,64).toString('hex');
 const org=await db.organization.create({data:{id:organizationId,name:'Account security QA',users:{create:[
  {name:'Security owner',email:randomUUID()+'@security-browser.invalid',passwordHash,role:'OWNER'},
  {name:'Security employee',email:randomUUID()+'@security-browser.invalid',passwordHash,role:'EMPLOYEE'}
 ]}},include:{users:true}});
 ownerId=org.users.find(u=>u.role==='OWNER')!.id;employeeId=org.users.find(u=>u.role==='EMPLOYEE')!.id;
});
test.afterAll(async()=>{
 await db.user.deleteMany({where:{organizationId}});
 await db.organization.deleteMany({where:{id:organizationId}});
 await db.$disconnect();
});

test('owner manages sessions and changes password with cookie rotation and translated mobile UI',async({page,context})=>{
 test.setTimeout(60000);
 const current=await signIn(context,ownerId);
 const other=await session(ownerId,'<img src=x onerror=alert(1)>');
 await page.goto('/');
 await openManagement(page);await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('tab',{name:'Доступ',exact:true}).click();
 const security=page.getByRole('region',{name:'Безопасность аккаунта',exact:true});
 await expect(security.locator('.session-card')).toHaveCount(2);
 const otherCard=security.locator('.session-card').filter({hasText:'Неизвестный браузер'});
 await otherCard.getByText('Сведения о браузере',{exact:true}).click();
 await expect(otherCard.getByText('<img src=x onerror=alert(1)>',{exact:true})).toBeVisible();
 await expect(otherCard.locator('img')).toHaveCount(0);
 await otherCard.getByRole('button',{name:'Завершить',exact:true}).click();
 // A failed mutation remains visible and retryable in the dialog.
 await page.route('**/api/auth/sessions/'+other.id,route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Данные изменяются одновременно. Обновите страницу и повторите действие'})}));
 await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
 await expect(page.getByRole('dialog').getByRole('button',{name:'Подтвердить'})).toBeEnabled();
 await page.unroute('**/api/auth/sessions/'+other.id);
 await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(security.locator('.session-card')).toHaveCount(1);
 const revoked=await context.request.get('/api/auth/me',{headers:{Cookie:'tirek_session='+other.value}});
 expect(revoked.status()).toBe(401);
 await session(ownerId);
 await security.getByRole('button',{name:'Обновить',exact:true}).click();
 await expect(security.locator('.session-card')).toHaveCount(2);
 let releaseSnapshot!:()=>void,ready!:()=>void,delivered!:()=>void,hold=true;
 const gate=new Promise<void>(resolve=>{releaseSnapshot=resolve;}),captured=new Promise<void>(resolve=>{ready=resolve;}),finished=new Promise<void>(resolve=>{delivered=resolve;});
 await page.route('**/api/auth/sessions',async route=>{
  if(!hold){await route.continue();return;}hold=false;
  const snapshot=await route.fetch();ready();await gate;await route.fulfill({response:snapshot});delivered();
 });
 await security.getByRole('button',{name:'Обновить',exact:true}).click();
 await captured;
 await security.getByLabel('Текущий пароль',{exact:true}).fill(password);
 await security.getByLabel('Новый пароль',{exact:true}).fill(newPassword);
 await security.getByLabel('Повторите новый пароль',{exact:true}).fill(newPassword+'mismatch');
 await security.getByRole('button',{name:'Сменить пароль',exact:true}).click();
 await expect(security.getByRole('alert')).toHaveText('Пароли не совпадают');
 await security.getByLabel('Повторите новый пароль',{exact:true}).fill(newPassword);
 await security.getByRole('button',{name:'Сменить пароль',exact:true}).click();
 await expect(security.getByRole('status')).toHaveText('Пароль изменён. Остальные сеансы завершены.');
 await expect(security.locator('.session-card')).toHaveCount(1);
 releaseSnapshot();await finished;
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(security.locator('.session-card')).toHaveCount(1);
 await page.unroute('**/api/auth/sessions');
 expect((await context.cookies()).find(c=>c.name==='tirek_session')?.value).not.toBe(current.value);
 await expect(security.getByLabel('Текущий пароль',{exact:true})).toHaveValue('');
 await expect(security.getByLabel('Новый пароль',{exact:true})).toHaveValue('');
 expect(await db.session.count({where:{userId:ownerId}})).toBe(1);
 await security.screenshot({path:'test-results/account-security-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('combobox',{name:'Язык интерфейса'}).selectOption('kk');
 await expect(page.getByRole('heading',{name:'Аккаунт қауіпсіздігі',exact:true})).toBeVisible();
 await expect(page.getByLabel('Ағымдағы құпиясөз',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Интерфейс тілі'}).selectOption('en');
 await expect(page.getByLabel('Current password',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Active sessions',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('region',{name:'Account security',exact:true}).screenshot({path:'test-results/account-security-mobile.png'});
 await page.reload();
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 await openManagement(page,'Management');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('tab',{name:'Access',exact:true}).click();
 await expect(page.getByText('This session',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sign out here',exact:true}).click();
 await page.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
 await expect(page.locator('form').getByRole('alert')).toHaveCount(0);
});

test('employee opens personal security on mobile and bulk revokes other sessions without owner requests',async({page,context})=>{
 const current=await signIn(context,employeeId),other=await session(employeeId),foreign=await session(ownerId);
 await page.setViewportSize({width:390,height:844});
 const requests:string[]=[];
 page.on('request',request=>{if(/\/api\/(dashboard|clients|orders|movements|documents|team$|audit)/.test(request.url()))requests.push(request.url());});
 await page.goto('/');
 await page.getByRole('button',{name:'Настройки аккаунта',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Настройки аккаунта',level:1})).toBeVisible();
 await expect(page.locator('.session-card')).toHaveCount(2);
 await page.getByRole('button',{name:'Завершить другие сеансы',exact:true}).click();
 await page.getByRole('button',{name:'Отмена',exact:true}).click();
 await expect(page.locator('.session-card')).toHaveCount(2);
 await page.getByRole('button',{name:'Завершить другие сеансы',exact:true}).click();
 await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
 await expect(page.locator('.session-card')).toHaveCount(1);
 expect(await db.session.count({where:{id:other.id}})).toBe(0);
 expect(await db.session.count({where:{id:foreign.id}})).toBe(1);
 expect((await context.cookies()).find(c=>c.name==='tirek_session')?.value).toBe(current.value);
 expect(requests).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/employee-security-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Мои задачи',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Мои задачи',level:1})).toBeVisible();
 await page.getByRole('button',{name:'Настройки аккаунта',exact:true}).click();
 await page.getByRole('button',{name:'Выйти здесь',exact:true}).click();
 await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
 await expect(page.getByRole('heading',{name:'С возвращением'})).toBeVisible();
 expect(await db.session.count({where:{id:current.id}})).toBe(0);
});
