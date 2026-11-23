import 'dotenv/config';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {AuditService} from '../../backend/dist/modules/audit/audit.service.js';
import {TasksService} from '../../backend/dist/modules/tasks/tasks.service.js';
import {TelegramService} from '../../backend/dist/modules/telegram/telegram.service.js';
import {TelegramProcessor} from '../../backend/dist/modules/telegram/telegram-processor.js';
import {OrderQualityService} from '../../backend/dist/modules/crm/order-quality.service.js';
import {expect,test} from './fixtures';

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID(),outside=randomUUID(),scope={organizationId:{in:[org,outside]}};
test.afterAll(async()=>{
  await db.materialMovement.deleteMany({where:scope});
  await db.materialLot.deleteMany({where:scope});
  await db.expenseReceipt.deleteMany({where:scope});
  await db.expenseReversal.deleteMany({where:scope});
  await db.expense.deleteMany({where:scope});
  await db.workTimeEntry.deleteMany({where:scope});
  await db.businessTask.deleteMany({where:scope});
  await db.order.deleteMany({where:{...scope,repeatOfId:{not:null}}});
  await db.order.deleteMany({where:scope});
  await db.client.deleteMany({where:scope});
  await db.auditEvent.deleteMany({where:scope});
  await db.user.deleteMany({where:scope});
  await db.organization.deleteMany({where:{id:{in:[org,outside]}}});
  await db.$disconnect();
});

test('acceptance gates website and Telegram completion while repeat costs reconcile exactly',async({page,context,baseURL},testInfo)=>{
  test.setTimeout(120000);
  const origin=baseURL??'http://localhost:3000';
  await db.organization.createMany({data:[{id:org,name:'Acceptance QA',orderSeq:1},{id:outside,name:'Outside QA'}]});
  async function person(organizationId:string,role:'OWNER'|'EMPLOYEE') {
    const row=await db.user.create({data:{organizationId,role,name:role==='OWNER'?'Owner QA':'Worker QA',
      email:randomUUID()+'@acceptance.invalid',passwordHash:'unused'}});
    const token=randomBytes(32).toString('hex');
    await db.session.create({data:{userId:row.id,tokenHash:createHash('sha256').update(token).digest('hex'),
      expiresAt:new Date(Date.now()+3600000)}});
    return {...row,token};
  }
  const owner=await person(org,'OWNER'),worker=await person(org,'EMPLOYEE'),stranger=await person(outside,'OWNER');
  const unassigned=await person(org,'EMPLOYEE');
  const client=await db.client.create({data:{organizationId:org,name:'Client QA'}});
  const original=await db.order.create({data:{organizationId:org,clientId:client.id,number:1,title:'Приёмка QA',
    status:'IN_PROGRESS',total:'10000',plannedMinutes:60,plannedHourlyRate:'0',plannedDirectExpenses:'0',actualHourlyRate:'1000'}});
  const task=await db.businessTask.create({data:{organizationId:org,orderId:original.id,assigneeId:worker.id,
    createdById:owner.id,title:'Приёмка QA задача',status:'IN_PROGRESS'}});
  const call=(path:string,method='GET',body?:unknown,token=owner.token)=>fetch(origin+'/api'+path,{
    method,headers:{Cookie:'tirek_session='+token,Origin:origin,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const quality='/orders/'+original.id+'/acceptance';
  const stage=(id:string,status:string)=>call('/orders/'+id+'/status','PATCH',{status});
  expect((await call(quality,'GET',undefined,stranger.token)).status).toBe(404);
  expect((await call(quality,'GET',undefined,unassigned.token)).status).toBe(404);
  expect((await call(quality,'PUT',{version:0,items:[]},worker.token)).status).toBe(403);
  await context.addCookies([{name:'tirek_session',value:owner.token,url:origin,httpOnly:true}]);
  await page.goto('/');
  await page.getByRole('button',{name:/^Заказы/}).click();
  await page.getByRole('button',{name:/^Приёмка QA/}).click();
  await page.getByRole('button',{name:'Приёмка работ',exact:true}).click();
  await page.getByLabel('Новый пункт приёмки').fill('Проверить работу под нагрузкой');
  await page.getByRole('button',{name:'Добавить пункт',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Проверить работу под нагрузкой');
  const configured=await (await call(quality)).json();
  expect(configured.items).toHaveLength(1);
  expect((await call(quality,'PUT',{version:0,items:[]})).status).toBe(409);
  expect((await call(quality,'PATCH',{version:0,itemId:configured.items[0].id,checked:true},worker.token)).status).toBe(409);
  expect((await stage(original.id,'COMPLETED')).status).toBe(400);
  expect((await call('/tasks/'+task.id+'/status','PATCH',{status:'DONE',version:1},worker.token)).status).toBe(400);
  expect((await db.businessTask.findUniqueOrThrow({where:{id:task.id}})).status).toBe('IN_PROGRESS');

  const botId=String(Date.now()),senderId=101;
  await db.telegramLink.create({data:{organizationId:org,userId:worker.id,botId,telegramUserId:String(senderId),
    displayName:'Worker QA',username:'',locale:'ru'}});
  const sent:{text:string;buttons:any}[]=[];
  const transport={config:{botId},call:async()=>true,send:async(_chat:string,text:string,buttons:any)=>{sent.push({text,buttons});return {message_id:1};}};
  const database={client:db},audit=new AuditService(database),tasks=new TasksService(database,audit);
  const broken=new OrderQualityService(database,{record:async()=>{throw new Error('QA audit unavailable');}});
  await expect(broken.configure(owner,original.id,{version:1,items:[]})).rejects.toThrow('QA audit unavailable');
  expect((await db.orderAcceptance.findUniqueOrThrow({where:{orderId:original.id}})).version).toBe(1);
  const telegram=new TelegramProcessor(database,new TelegramService(database,transport,audit),transport,null,tasks,null);
  let updateId=0;
  const update=(data:string)=>telegram.handle({update_id:++updateId,callback_query:{id:String(updateId),
    from:{id:senderId},message:{message_id:1,date:Math.floor(Date.now()/1000),chat:{id:senderId,type:'private'}},data}});
  await update('done:'+task.id+':1');
  expect(sent.at(-1)?.text).toContain('Приёмка');
  const check=sent.at(-1)!.buttons[0][0].callback_data;
  await update(check);
  await update(check);
  expect((await db.orderAcceptance.findUniqueOrThrow({where:{orderId:original.id}})).version).toBe(2);
  await update('done:'+task.id+':1');
  expect((await db.businessTask.findUniqueOrThrow({where:{id:task.id}})).status).toBe('DONE');
  expect((await stage(original.id,'COMPLETED')).status).toBe(200);
  await expect(broken.repeat(owner,original.id,{reason:'Проверка отката',assigneeId:worker.id,idempotencyKey:randomUUID()}))
    .rejects.toThrow('QA audit unavailable');
  expect(await db.order.count({where:{organizationId:org,repeatOfId:original.id}})).toBe(0);
  expect((await db.organization.findUniqueOrThrow({where:{id:org}})).orderSeq).toBe(1);
  await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:/^Приёмка QA/}).click();
  await page.getByRole('button',{name:'Прибыльность',exact:true}).click();
  await page.getByRole('button',{name:'Назначить повторный выезд'}).click();
  await page.getByLabel('Причина повторного выезда').fill('Повторная проверка соединения');
  await page.getByLabel('Исполнитель',{exact:true}).selectOption(worker.id);
  await page.getByRole('button',{name:'Создать выезд и задачу'}).click();
  await expect(page.getByRole('region',{name:'Повторные выезды'})).toContainText('Повторная проверка соединения');
  const visit=await db.order.findFirstOrThrow({where:{organizationId:org,repeatOfId:original.id}});
  expect(visit.total.toFixed(2)).toBe('0.00');
  expect((await (await call('/orders/'+original.id+'/profitability')).json()).forecast.atCompletion.profit).toBeNull();
  await db.order.update({where:{id:visit.id},data:{plannedMinutes:120,plannedHourlyRate:'0',plannedDirectExpenses:'0'}});
  const repeated={reason:visit.notes,assigneeId:worker.id,idempotencyKey:visit.repeatKey};
  const replays=await Promise.all([call('/orders/'+original.id+'/repeat-visits','POST',repeated),call('/orders/'+original.id+'/repeat-visits','POST',repeated)]);
  expect(replays.map(r=>r.status)).toEqual([201,201]);
  expect(await db.order.count({where:{organizationId:org,repeatOfId:original.id}})).toBe(1);
  expect((await call('/orders/'+original.id+'/repeat-visits','POST',{...repeated,reason:'Другая причина'})).status).toBe(409);
  expect((await call('/orders/'+visit.id+'/repeat-visits','POST',{...repeated,idempotencyKey:randomUUID()})).status).toBe(409);
  expect((await (await call('/orders/'+visit.id+'/acceptance')).json()).items[0].checked).toBe(false);
  expect(await db.telegramDelivery.count({where:{organizationId:org,notification:{task:{orderId:visit.id}}}})).toBe(1);

  await db.expense.createMany({data:[
    {organizationId:org,orderId:original.id,amount:'200',description:'Исходный расход',category:'OTHER',idempotencyKey:randomUUID()},
    {organizationId:org,orderId:visit.id,amount:'250',description:'Расход выезда',category:'MATERIALS',idempotencyKey:randomUUID()},
  ]});
  for(const status of ['APPROVED','SUBMITTED'] as const) {
    const entry=await db.workTimeEntry.create({data:{organizationId:org,employeeId:worker.id,createdById:worker.id,status,
      startsAt:new Date(status==='APPROVED'?'2026-11-20T04:00Z':'2026-11-20T06:00Z'),
      endsAt:new Date(status==='APPROVED'?'2026-11-20T05:30Z':'2026-11-20T06:30Z'),
      idempotencyKey:randomUUID()}});
    await db.workTimeAllocation.create({data:{entryId:entry.id,organizationId:org,orderId:visit.id}});
  }
  const receipt=await db.expenseReceipt.create({data:{organizationId:org,orderId:visit.id,employeeId:worker.id,
    amount:'125',description:'Материал выезда',
    sourceKey:randomUUID(),imageHash:randomBytes(32).toString('hex'),image:new Uint8Array([0])}});
  const approved=await call('/finance/receipts/'+receipt.id,'PATCH',{status:'APPROVED',category:'MATERIALS',
    stock:{name:'Деталь QA',quantity:1}});
  expect(approved.status).toBe(200);
  const purchase={id:(await approved.json()).expenseId};
  expect((await call('/finance/materials/'+purchase.id+'/movements','POST',{
    orderId:visit.id,kind:'ISSUE',quantity:1,idempotencyKey:randomUUID()})).status).toBe(201);
  const profit=async()=> (await (await call('/orders/'+original.id+'/profitability')).json());
  const calculated=await profit();
  expect(calculated.actual).toMatchObject({expenses:'200.00',rework:'1875.00',cost:'2075.00',profit:'7925.00',marginPercent:'79.25'});
  expect(calculated.forecast.atCompletion.profit).toBe('7425.00');
  expect(calculated.forecast.closed).toBe(false);
  const savedRate={costVersion:1,plannedHourlyRate:'0',plannedDirectExpenses:'0',actualHourlyRate:null,rates:[]};
  expect((await call('/orders/'+visit.id+'/profitability','PATCH',savedRate)).status).toBe(200);
  expect((await profit()).actual.profit).toBeNull();
  expect((await call('/orders/'+visit.id+'/profitability','PATCH',{...savedRate,costVersion:2,actualHourlyRate:'1000'})).status).toBe(200);
  await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Прибыльность',exact:true}).click();
  await expect(page.getByRole('row',{name:/Стоимость повторных выездов/})).toContainText(/1\s875/);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('repeat-profit-mobile.png')});
  const direct=await db.expense.findFirstOrThrow({where:{organizationId:org,orderId:visit.id,amount:'250'}});
  expect((await call('/finance/expenses/'+direct.id+'/reversal','POST',{
    reason:'Исправление расхода выезда',idempotencyKey:randomUUID()})).status).toBe(201);
  expect((await profit()).actual.profit).toBe('8175.00');
  expect((await call('/finance/materials/'+purchase.id+'/movements','POST',{
    orderId:visit.id,kind:'RETURN',quantity:1,idempotencyKey:randomUUID()})).status).toBe(201);
  expect((await profit()).actual.profit).toBe('8300.00');
  const visitTask=await db.businessTask.findFirstOrThrow({where:{organizationId:org,orderId:visit.id}});
  const visitChecks=await (await call('/orders/'+visit.id+'/acceptance')).json();
  const checkBody={version:visitChecks.version,itemId:visitChecks.items[0].id,checked:true};
  expect((await call('/orders/'+visit.id+'/acceptance','PATCH',checkBody,worker.token)).status).toBe(403);
  expect((await call('/tasks/'+visitTask.id+'/status','PATCH',{status:'IN_PROGRESS',version:1},worker.token)).status).toBe(200);
  await context.clearCookies();
  await context.addCookies([{name:'tirek_session',value:worker.token,url:origin,httpOnly:true}]);
  await page.goto('/');
  const visitCard=page.locator('article').filter({hasText:visit.title});
  await visitCard.getByRole('button',{name:'Приёмка работ',exact:true}).click();
  const acceptanceCheck=page.getByRole('checkbox',{name:/Проверить работу под нагрузкой/});
  await acceptanceCheck.click();
  await expect(acceptanceCheck).toBeChecked();
  await expect(page.getByRole('dialog')).toContainText('Worker QA');
  await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  await visitCard.getByRole('button',{name:'Завершить задачу',exact:true}).click();
  await expect.poll(async()=>(await db.businessTask.findUniqueOrThrow({where:{id:visitTask.id}})).status).toBe('DONE');
});
