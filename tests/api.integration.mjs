import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const base = process.env.TEST_API_URL ?? 'http://127.0.0.1:4000/api';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 3 }) });
const ids = [];
const password = 'IntegrationTestOnly2026!';
const salt = randomBytes(16).toString('hex');
const hash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
async function request(path, { cookie, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function tenant() {
  const id = randomUUID(); ids.push(id);
  const email = `${id}@test.invalid`;
  await db.organization.create({ data: { id, name: 'Integration test', users: { create: { name: 'Tester', role:'OWNER', email, passwordHash: hash } } } });
  const login = await request('/auth/login', { method:'POST', body:{ email, password } });
  assert.equal(login.status, 201); assert.ok(login.cookie);
  return { id, cookie:login.cookie };
}

test('CRM vertical slice: isolation, exact money, concurrent payments, document snapshots', async t => {
  try {
    const a = await tenant(), b = await tenant();
    const client = await request('/clients', { ...a, method:'POST', body:{ name:'Test client A' } });
    const other = await request('/clients', { ...b, method:'POST', body:{ name:'Private client B' } });
    assert.equal(client.status, 201); assert.equal(other.status, 201);
    let order;
    await t.test('requires authentication and rejects foreign origins', async () => {
      assert.equal((await request('/clients')).status, 401);
      assert.equal((await request('/clients', { ...a, method:'POST', body:{ name:'CSRF' }, headers:{ Origin:'https://untrusted.invalid' } })).status, 403);
    });
    await t.test('validates quantities and prevents cross-tenant relationships', async () => {
      const payload = { title:'Exact amount', clientId:client.body.id, items:[{ description:'Service', quantity:3, unitPrice:'0.10' }] };
      assert.equal((await request('/orders', { ...a, method:'POST', body:{ ...payload, clientId:other.body.id } })).status, 404);
      assert.equal((await request('/orders', { ...a, method:'POST', body:{ ...payload, items:[{ description:'Service', quantity:1, unitPrice:'0.001' }] } })).status, 400);
      const created = await request('/orders', { ...a, method:'POST', body:payload });
      assert.equal(created.status, 201); assert.equal(created.body.total, '0.30'); order = created.body;
      assert.equal((await request('/orders', b)).body.length, 0);
    });
    await t.test('does not allow concurrent payments to exceed total', async () => {
      const key1 = randomUUID(), key2 = randomUUID();
      const results = await Promise.all([key1,key2].map(idempotencyKey => request(`/orders/${order.id}/payments`, { ...a, method:'POST', body:{ amount:'0.20', idempotencyKey } })));
      assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
      const key = results[0].status === 201 ? key1 : key2;
      const replay = await request(`/orders/${order.id}/payments`, { ...a, method:'POST', body:{ amount:'0.20', idempotencyKey:key } });
      assert.equal(replay.status, 201);
      assert.equal(await db.payment.count({ where:{ orderId:order.id } }), 1);
      assert.equal((await request(`/orders/${order.id}/payments`, { ...a, method:'POST', body:{ amount:'0.10', idempotencyKey:key } })).status, 409);
      assert.equal((await request(`/orders/${order.id}/payments`, { ...b, method:'POST', body:{ amount:'0.01', idempotencyKey:randomUUID() } })).status, 404);
      assert.equal((await request(`/orders/${order.id}/payments`, { ...a, method:'POST', body:{ amount:'-1', idempotencyKey:randomUUID() } })).status, 400);
    });
    await t.test('restricts stage transitions and paid cancellations', async () => {
      const change = status => request(`/orders/${order.id}/status`, { ...a, method:'PATCH', body:{ status } });
      assert.equal((await change('COMPLETED')).status, 409);
      assert.equal((await change('CANCELLED')).status, 409);
      for (const status of ['CONFIRMED','IN_PROGRESS','COMPLETED']) assert.equal((await change(status)).status, 200);
      assert.equal((await request(`/orders/${order.id}/status`, { ...b, method:'PATCH', body:{ status:'COMPLETED' } })).status, 404);
    });
    await t.test('keeps document snapshot and tenant access immutable', async () => {
      const created = await request(`/orders/${order.id}/documents`, { ...a, method:'POST', body:{} });
      assert.equal(created.status, 201);
      assert.equal((await request('/clients/'+client.body.id, { ...a, method:'PATCH', body:{ name:'Changed name' } })).status,200);
      assert.equal((await request('/clients/'+client.body.id, { ...b, method:'PATCH', body:{ name:'Stolen client' } })).status,404);
      assert.equal((await request('/organization', { ...a, method:'PATCH', body:{ name:'Updated company', address:'Almaty', businessId:'123456789012' } })).status,200);
      assert.equal((await request('/organization', b)).body.name,'Integration test');
      assert.equal((await request('/organization', { ...a, method:'PATCH', body:{ name:'Broken', address:'', businessId:'123' } })).status,400);
      assert.equal((await request('/organization')).status,401);
      const doc = await request(`/documents/${created.body.id}`, a);
      assert.equal(doc.body.snapshot.client.name, 'Test client A');
      assert.equal(doc.body.snapshot.total, '0.30');
      assert.equal(doc.body.snapshot.organization.name, 'Integration test');
      const newer=await request('/orders/'+order.id+'/documents', { ...a, method:'POST', body:{} });
      assert.equal(newer.body.snapshot.organization.name,'Updated company');
      assert.equal(newer.body.snapshot.client.name,'Changed name');
      assert.equal((await request(`/documents/${created.body.id}`, b)).status, 404);
    });
    await t.test('calculates cash flow and debt independently', async () => {
      const payload = { amount:'0.05', description:'Materials', category:'MATERIALS', orderId:order.id, idempotencyKey:randomUUID() };
      assert.equal((await request('/expenses', { ...a, method:'POST', body:payload })).status, 201);
      assert.equal((await request('/expenses', { ...a, method:'POST', body:payload })).status, 201);
      assert.equal((await request('/expenses', { ...b, method:'POST', body:{ ...payload, idempotencyKey:randomUUID() } })).status, 404);
      const result = await request('/dashboard', a);
      assert.equal(result.status, 200);
      assert.equal(result.body.received, '0.20'); assert.equal(result.body.expenses, '0.05');
      assert.equal(result.body.cashFlow, '0.15'); assert.equal(result.body.outstanding, '0.10');
      assert.equal(result.body.completedValue, '0.30');
    });

    await t.test('searches all tenant records with bounded stable pages',async()=>{
      await db.client.createMany({data:Array.from({length:205},(_,i)=>({id:randomUUID(),organizationId:a.id,name:'Paging client '+i,email:'page'+i+'@example.invalid',createdAt:new Date('2020-01-01T00:00:00Z')}))});
      const first=await request('/clients/search?q=Paging&pageSize=20&page=1',a);
      const second=await request('/clients/search?q=Paging&pageSize=20&page=2',a);
      assert.equal(first.status,200);assert.equal(first.body.total,205);assert.equal(first.body.pages,11);
      assert.equal(first.body.items.length,20);assert.equal(second.body.items.length,20);
      assert.equal(new Set([...first.body.items,...second.body.items].map(c=>c.id)).size,40);
      assert.deepEqual((await request('/clients/search?q=Paging&pageSize=20&page=1',a)).body.items.map(c=>c.id),first.body.items.map(c=>c.id));
      assert.equal((await request('/clients/search?q=page204%40example.invalid',a)).body.total,1);
      assert.equal((await request('/clients/search?q=Paging',b)).body.total,0);
      for(const query of ['page=0','page=no','pageSize=101','pageSize=-1'])assert.equal((await request('/clients/search?'+query,a)).status,400);
      const found=await request('/orders/search?q=Exact&status=COMPLETED',a);
      assert.equal(found.body.total,1);assert.equal(found.body.items[0].id,order.id);
      assert.equal((await request('/orders/search?q=Exact',b)).body.total,0);
      assert.equal((await request('/orders/search?status=INVALID',a)).status,400);
    });
    await t.test('edits open orders without losing versions, payments or audit events',async()=>{
      const payload={title:'Editable',clientId:client.body.id,items:[{description:'Service',quantity:1,unitPrice:'100.00'}],notes:'Keep me'};
      const created=await request('/orders',{...a,method:'POST',body:payload});
      assert.equal(created.status,201);
      const id=created.body.id;
      const auditCount=()=>db.auditEvent.count({where:{organizationId:a.id,entityId:id}});
      assert.equal(await auditCount(),1);
      const key=randomUUID();
      for(let i=0;i<2;i++)assert.equal((await request('/orders/'+id+'/payments',{...a,method:'POST',body:{amount:'40.00',idempotencyKey:key}})).status,201);
      assert.equal(await auditCount(),2);
      let current=(await request('/orders/'+id,a)).body;
      assert.equal(current.version,2);
      assert.equal((await request('/orders/'+id,b)).status,404);
      const edit=(body,tenant=a)=>request('/orders/'+id,{...tenant,method:'PATCH',body:{...payload,version:current.version,...body}});
      assert.equal((await edit({items:[{description:'Invalid below paid',quantity:1,unitPrice:'30.00'}]})).status,409);
      assert.equal((await edit({clientId:other.body.id})).status,409);
      assert.equal((await edit({},b)).status,404);
      assert.equal((await edit({version:1})).status,409);
      assert.equal(await auditCount(),2);
      const edits=await Promise.all(['110.00','120.00'].map(price=>edit({items:[{description:'Changed',quantity:1,unitPrice:price}]})));
      assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
      current=(await request('/orders/'+id,a)).body;
      assert.equal(current.version,3);assert.equal(await auditCount(),3);
      const race=await Promise.all([
        edit({items:[{description:'Reduced',quantity:1,unitPrice:'50.00'}]}),
        request('/orders/'+id+'/payments',{...a,method:'POST',body:{amount:'50.00',idempotencyKey:randomUUID()}}),
      ]);
      assert.equal(race.filter(r=>r.status===409).length,1);
      assert.equal(race.filter(r=>r.status===200||r.status===201).length,1);
      current=(await request('/orders/'+id,a)).body;
      assert.ok(Number(current.paid)<=Number(current.total));
      assert.equal(await auditCount(),4);
      const history=await request('/audit?entityType=ORDER&entityId='+id,a);
      assert.equal(history.status,200);assert.equal(history.body.total,4);
      assert.ok(history.body.items.every(e=>e.actorName==='Tester'));
      assert.equal((await request('/audit?entityId='+id,b)).body.total,0);
      assert.equal((await request('/audit')).status,401);
      assert.equal((await request('/audit?pageSize=101',a)).status,400);
      for(const status of ['CONFIRMED','IN_PROGRESS','COMPLETED'])assert.equal((await request('/orders/'+id+'/status',{...a,method:'PATCH',body:{status}})).status,200);
      current=(await request('/orders/'+id,a)).body;
      assert.equal((await edit({title:'Do not edit completed'})).status,409);
      assert.equal(await auditCount(),7);
      const events=await db.auditEvent.findMany({where:{organizationId:a.id,entityId:id}});
      const user=await db.user.findFirst({where:{organizationId:a.id}});
      assert.ok(events.every(event=>event.actorId===user.id));
    });
    await t.test('invalidates session on logout', async () => {
      assert.equal((await request('/auth/logout', { ...a, method:'POST' })).status, 201);
      assert.equal((await request('/auth/me', a)).status, 401);
    });
  } finally {
    for (const id of ids) {
      await db.businessTask.deleteMany({ where:{ organizationId:id } });
      await db.document.deleteMany({ where:{ organizationId:id } });
      await db.payment.deleteMany({ where:{ organizationId:id } });
      await db.expense.deleteMany({ where:{ organizationId:id } });
      await db.orderItem.deleteMany({ where:{ order:{ organizationId:id } } });
      await db.order.deleteMany({ where:{ organizationId:id } });
      await db.client.deleteMany({ where:{ organizationId:id } });
      await db.user.deleteMany({ where:{ organizationId:id } });
      await db.organization.deleteMany({ where:{ id } });
    }
    await db.$disconnect();
  }
});
