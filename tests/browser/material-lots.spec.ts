import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';
import { expect, test } from './fixtures';

const db = new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const org=randomUUID(), other=randomUUID();
const scope={organizationId:{in:[org,other]}};

async function user(organizationId:string,role:'OWNER'|'EMPLOYEE') {
  const person=await db.user.create({data:{organizationId,role,name:role,email:randomUUID()+'@materials.invalid',passwordHash:'unused'}});
  const token=randomBytes(32).toString('hex');
  await db.session.create({data:{userId:person.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
  return {id:person.id,token};
}

test.afterAll(async()=>{
  await db.materialMovement.deleteMany({where:scope});
  await db.materialLot.deleteMany({where:scope});
  await db.expenseReceipt.deleteMany({where:scope});
  await db.expenseReversal.deleteMany({where:scope});
  await db.expense.deleteMany({where:scope});
  await db.order.deleteMany({where:scope});
  await db.client.deleteMany({where:scope});
  await db.auditEvent.deleteMany({where:scope});
  await db.user.deleteMany({where:scope});
  await db.organization.deleteMany({where:{id:{in:[org,other]}}});
  await db.$disconnect();
});

test('stock purchases, issues, returns and concurrent requests reconcile with order profit',async({page,context,baseURL})=>{
  test.setTimeout(90000);
  const origin=baseURL ?? 'http://localhost:3000';
  await db.organization.createMany({data:[{id:org,name:'Materials QA'},{id:other,name:'Outside QA'}]});
  const owner=await user(org,'OWNER'), employee=await user(org,'EMPLOYEE'), outside=await user(other,'OWNER');
  const client=await db.client.create({data:{organizationId:org,name:'QA'}});
  const order=async(number:number)=>db.order.create({data:{organizationId:org,clientId:client.id,number,title:'Материалы QA '+number,total:'30000.00'}});
  const a=await order(1), b=await order(2);
  async function receipt(amount:string,description:string) {
    const image=await sharp({create:{width:48,height:48,channels:3,background:'#eee'}}).jpeg().toBuffer();
    return db.expenseReceipt.create({data:{organizationId:org,orderId:a.id,employeeId:employee.id,sourceKey:randomUUID(),
      image:new Uint8Array(image),imageHash:createHash('sha256').update(description).digest('hex'),amount,description}});
  }
  const invoice=await receipt('20000','Фильтры QA');
  await context.addCookies([{name:'tirek_session',value:owner.token,url:origin,httpOnly:true}]);
  await page.goto('/');
  await page.getByRole('button',{name:/^Финансы/}).click();
  const receipts=page.getByRole('region',{name:'Чеки сотрудников'});
  await receipts.getByRole('button',{name:'Посмотреть чек'}).click();
  await receipts.getByLabel('Назначение чека').selectOption('stock');
  await receipts.getByLabel('Количество в партии').fill('10');
  await receipts.getByRole('button',{name:'Принять на склад'}).click();
  const inventory=page.getByRole('region',{name:'Материалы со склада'});
  await expect(inventory).toContainText('Остаток на складе · 10 шт.');
  const lot=(await db.materialLot.findFirstOrThrow({where:{organizationId:org}})).expenseId;
  const call=(path:string,method='GET',data?:unknown,token=owner.token)=>fetch(origin+'/api'+path,{
    method,headers:{Cookie:'tirek_session='+token,Origin:origin,...(data?{'Content-Type':'application/json'}:{})},
    body:data?JSON.stringify(data):undefined,
  });
  const result=async(id:string)=>(await (await call('/orders/'+id+'/profitability')).json()).actual;
  expect((await result(a.id)).expenses).toBe('0.00');
  expect((await call('/finance/receipts/'+invoice.id,'PATCH',{status:'APPROVED',category:'MATERIALS'})).status).toBe(409);
  expect((await call('/finance/materials','GET',undefined,employee.token)).status).toBe(403);
  expect((await (await call('/finance/materials','GET',undefined,outside.token)).json()).total).toBe(0);
  const movementPath=(id:string)=>'/finance/materials/'+id+'/movements';
  const move=(id:string,orderId:string,kind:string,quantity:number,key=randomUUID())=>call(movementPath(id),'POST',{orderId,kind,quantity,idempotencyKey:key});
  expect((await call(movementPath(lot),'POST',{orderId:a.id,kind:'ISSUE',quantity:1,idempotencyKey:randomUUID()},outside.token)).status).toBe(404);
  await page.getByRole('button',{name:/^Заказы/}).click();
  await page.getByRole('button',{name:/^Материалы QA 1/}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Прибыльность',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await inventory.getByLabel('Количество',{exact:true}).fill('3');
  await inventory.getByRole('button',{name:'Выдать в заказ'}).click();
  await expect(inventory).toContainText('В этом заказе · 3 шт.');
  expect((await result(a.id)).expenses).toBe('6000.00');
  const key=randomUUID();
  const replay=await Promise.all([move(lot,b.id,'ISSUE',2,key),move(lot,b.id,'ISSUE',2,key)]);
  expect(replay.map(r=>r.status)).toEqual([201,201]);
  expect(await replay[0].json()).toEqual(await replay[1].json());
  expect((await move(lot,b.id.toUpperCase(),'ISSUE',2,key)).status).toBe(201);
  expect((await move(lot,b.id,'ISSUE',1,key)).status).toBe(409);
  expect((await result(b.id)).expenses).toBe('4000.00');
  await inventory.getByLabel('Количество',{exact:true}).fill('1');
  await inventory.getByRole('button',{name:'Вернуть на склад'}).click();
  await expect(inventory).toContainText('Остаток на складе · 6 шт.');
  expect((await result(a.id)).profit).toBe('26000.00');
  expect((await move(lot,b.id,'RETURN',3)).status).toBe(409);
  const reverse=()=>call('/finance/expenses/'+lot+'/reversal','POST',{reason:'Отмена тестовой закупки',idempotencyKey:randomUUID()});
  expect((await reverse()).status).toBe(409);
  expect(await db.expense.count({where:{organizationId:org}})).toBe(1);
  const purchase=await db.expense.findUniqueOrThrow({where:{id:lot}});
  expect(purchase.amount.toFixed(2)).toBe('20000.00'); expect(purchase.orderId).toBeNull();

  const fractional=await receipt('0.05','Дробная стоимость QA');
  const decision={status:'APPROVED',category:'MATERIALS',stock:{name:'Деталь',quantity:3}};
  for (const invalid of [{...decision,category:'LABOR'},{...decision,stock:{name:'Деталь',quantity:0}},
    {...decision,stock:{name:'Деталь',quantity:1.5}}]) {
    expect((await call('/finance/receipts/'+fractional.id,'PATCH',invalid)).status).toBe(400);
  }
  const approved=await call('/finance/receipts/'+fractional.id,'PATCH',decision);
  const second=(await approved.json()).expenseId;
  expect((await call('/finance/receipts/'+fractional.id,'PATCH',decision)).status).toBe(200);
  expect((await move(second,a.id,'ISSUE',2)).status).toBe(201);
  const last=await Promise.all([move(second,b.id,'ISSUE',1),move(second,b.id,'ISSUE',1)]);
  expect(last.map(r=>r.status).sort()).toEqual([201,409]);
  expect((await result(a.id)).expenses).toBe('4000.03');
  expect((await result(b.id)).expenses).toBe('4000.02');
  for(const orderId of [a.id,b.id,a.id]) expect((await move(second,orderId,'RETURN',1)).status).toBe(201);
  const rest=await db.materialLot.findUniqueOrThrow({where:{expenseId:second}});
  expect([rest.available,rest.availableCents]).toEqual([3,5n]);
  for(const orderId of [a.id,b.id]) expect((await move(lot,orderId,'RETURN',2)).status).toBe(201);
  expect((await reverse()).status).toBe(201);
  expect((await move(lot,a.id,'ISSUE',1)).status).toBe(404);
});
