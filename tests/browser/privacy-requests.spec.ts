import {openManagement,test,expect,type BrowserContext} from './fixtures';
import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
let organizationId:string,userId:string,token:string;
async function login(context:BrowserContext){await context.addCookies([{name:'tirek_session',value:token,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);}
test.beforeEach(async()=>{
 organizationId=randomUUID();const org=await db.organization.create({data:{id:organizationId,name:'Privacy browser QA',users:{create:{name:'Owner',role:'OWNER',email:randomUUID()+'@privacy-browser.invalid',passwordHash:'unused'}}},include:{users:true}});
 userId=org.users[0].id;token=randomBytes(32).toString('hex');await db.session.create({data:{userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
});
test.afterEach(async()=>{await db.user.deleteMany({where:{organizationId}});await db.organization.deleteMany({where:{id:organizationId}});});
test.afterAll(async()=>{await db.$disconnect();});

test('owner handles requests on mobile in RU KK EN with safe retries and audit',async({page,context},testInfo)=>{
 await login(context);await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.getByRole('button',{name:'Меню',exact:true}).click();await openManagement(page);await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByRole('button',{name:'Зарегистрировать обращение',exact:true}).click();
 const requester='Requester '+'Ж'.repeat(90),description='Correct record <img src=x onerror=alert(1)>\nSecond line';
 await page.getByLabel('Имя заявителя *',{exact:true}).fill(requester);
 await page.getByLabel('Контакт для ответа',{exact:true}).fill('test@privacy.invalid');
 await page.getByRole('combobox',{name:'Вид обращения',exact:true}).selectOption('CORRECTION');
 await page.getByLabel('Содержание обращения *',{exact:true}).fill(description);
 await page.getByLabel('Дата получения *',{exact:true}).fill('2020-01-01');await page.getByLabel('Срок ответа',{exact:true}).fill('2020-01-02');
 await page.screenshot({path:testInfo.outputPath('privacy-form-mobile.png')});
 let creates=0;const createBodies:string[]=[];
 await page.route('**/api/privacy-requests',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return;}
  creates++;createBodies.push(route.request().postData()!);
  if(creates===1){expect((await route.fetch()).status()).toBe(201);await route.abort('failed');}else await route.continue();
 });
 await page.getByRole('button',{name:'Сохранить обращение',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Не удалось связаться с сервером');
 await expect(page.getByLabel('Содержание обращения *',{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Повторить запрос',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Карточка обращения',exact:true});
 await expect(dialog).toBeVisible();await expect(dialog).toContainText(description);
 expect(new Set(createBodies).size).toBe(1);expect(await db.privacyRequest.count({where:{organizationId}})).toBe(1);
 expect(await dialog.locator('img,script').count()).toBe(0);
 await dialog.getByRole('button',{name:'Сохранить статус обращения',exact:true}).click();
 await expect(dialog.locator('.privacy-detail>p').filter({hasText:'В обработке'})).toBeVisible();
 await dialog.getByRole('combobox',{name:'Новый статус обращения',exact:true}).selectOption('RESOLVED');
 await dialog.getByLabel('Результат или основание отказа *',{exact:true}).fill('Verified and replied <script>literal</script>');
 let changes=0;const changeBodies:string[]=[];
 await page.route('**/api/privacy-requests/*',async route=>{
  if(route.request().method()!=='PATCH'){await route.continue();return;}
  changes++;changeBodies.push(route.request().postData()!);
  if(changes===1){expect((await route.fetch()).status()).toBe(200);await route.abort('failed');}else await route.continue();
 });
 await dialog.getByRole('button',{name:'Сохранить статус обращения',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Не удалось связаться с сервером');
 await expect(dialog.getByLabel('Результат или основание отказа *',{exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Повторить запрос',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Результат обработки',exact:true})).toBeVisible();
 await expect(dialog.locator('.audit-event')).toHaveCount(3);expect(new Set(changeBodies).size).toBe(1);
 const row=await db.privacyRequest.findFirstOrThrow({where:{organizationId}});expect(row.status).toBe('RESOLVED');expect(row.version).toBe(3);
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 for(const [locale,title,open,close,heading]of [
  ['kk','Дербес деректер бойынша өтініштер','Өтінішті ашу','Жабу','Өңдеу нәтижесі'],
  ['en','Personal data requests','Open request','Close','Handling outcome'],
  ['ru','Обращения по персональным данным','Открыть обращение','Закрыть','Результат обработки'],
 ]){
  await page.getByRole('combobox').filter({has:page.locator('option[value="'+locale+'"]')}).first().selectOption(locale);
  const register=page.getByRole('region',{name:title,exact:true});await expect(register).toBeVisible();
  expect(await register.innerText()).not.toContain('test@privacy.invalid');
  await register.getByRole('button',{name:open,exact:true}).click();await expect(page.getByRole('dialog').getByRole('heading',{name:heading,exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(locale==='kk')await page.screenshot({path:testInfo.outputPath('privacy-detail-kk-mobile.png')});
  await page.getByRole('dialog').getByRole('button',{name:close,exact:true}).click();
 }
 await page.getByLabel('Только просроченные обращения',{exact:true}).check();await expect(page.locator('.privacy-card')).toHaveCount(0);
 await expect(page.locator('.privacy-cards')).toHaveAttribute('aria-busy','false');
 await expect(page.getByText('Обращения с выбранными фильтрами не найдены',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:testInfo.outputPath('privacy-register-mobile.png')});
});

test('stale changes fail without overwriting, lost access hides private request details',async({page,context})=>{
 await login(context);
 const created=await page.request.post('/api/privacy-requests',{headers:{Origin:'http://localhost:3000'},data:{kind:'ACCESS',subjectName:'Confidential requester',description:'Private request contents',receivedOn:'2020-01-01',idempotencyKey:randomUUID()}});expect(created.status()).toBe(201);const row=await created.json();
 await page.goto('/');await openManagement(page);await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Открыть обращение',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Private request contents');
 const external=await page.request.patch('/api/privacy-requests/'+row.id,{headers:{Origin:'http://localhost:3000'},data:{version:1,status:'REJECTED',resolution:'Externally reviewed and answered',idempotencyKey:randomUUID()}});expect(external.status()).toBe(200);
 await dialog.getByRole('button',{name:'Сохранить статус обращения',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Обращение уже изменено');
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Открыть обращение',exact:true}).click();
 await expect(dialog).toContainText('Externally reviewed and answered');
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 await expect(page.locator('.privacy-cards')).toHaveAttribute('aria-busy','false');
 await page.route('**/api/privacy-requests/'+row.id,async route=>{
  await db.user.update({where:{id:userId},data:{role:'EMPLOYEE'}});
  await route.continue();
 });
 await page.getByRole('button',{name:'Открыть обращение',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Недостаточно прав');await expect(dialog).not.toContainText('Private request contents');
 expect((await db.privacyRequest.findUniqueOrThrow({where:{id:row.id}})).status).toBe('REJECTED');
});

test('revoked owner cannot submit an already open request and private details are cleared',async({page,context})=>{
 await login(context);
 const created=await page.request.post('/api/privacy-requests',{headers:{Origin:'http://localhost:3000'},data:{kind:'ACCESS',subjectName:'Revocation QA',contact:'private@privacy.invalid',description:'Confidential loaded details',receivedOn:'2020-01-01',idempotencyKey:randomUUID()}});
 expect(created.status()).toBe(201);const row=await created.json();
 await page.goto('/');await openManagement(page);await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Открыть обращение',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Confidential loaded details');
 await expect(dialog.locator('.audit-panel')).toHaveAttribute('aria-busy','false');
 await db.user.update({where:{id:userId},data:{role:'EMPLOYEE'}});
 await dialog.getByRole('button',{name:'Сохранить статус обращения',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Недостаточно прав');
 await expect(dialog).not.toContainText('Confidential loaded details');await expect(dialog).not.toContainText('private@privacy.invalid');
 expect((await db.privacyRequest.findUniqueOrThrow({where:{id:row.id}})).version).toBe(1);
 expect(await db.privacyRequestChangeReceipt.count({where:{requestId:row.id}})).toBe(0);
});
