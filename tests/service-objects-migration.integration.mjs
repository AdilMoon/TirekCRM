import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';

test('service object migration preserves a previous-version order, payment and expense',async()=>{
 const name='tirek_objects_upgrade_'+randomUUID().replaceAll('-','');
 assert.match(name,/^tirek_objects_upgrade_[a-f0-9]{32}$/);
 const admin=new pg.Client({connectionString:process.env.DATABASE_URL});
 const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;
 const db=new pg.Client({connectionString:url.href});let created=false;
 try{
  await admin.connect();await admin.query('CREATE DATABASE "'+name+'"');created=true;await db.connect();
  const root=new URL('../backend/prisma/migrations/',import.meta.url);
  const directories=(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  const current='20261125120000_service_objects',index=directories.indexOf(current);assert.ok(index>0);
  for(const migration of directories.slice(0,index)){
   let sql=await readFile(new URL(migration+'/migration.sql',root),'utf8');
   // PostgreSQL requires enum additions to commit before a later statement uses them.
   // A multi-statement pg query otherwise wraps the entire migration implicitly.
   const additions=sql.match(/^ALTER TYPE [^\r\n]+ ADD VALUE [^\r\n]+;\r?$/gm)??[];
   for(const addition of additions){await db.query(addition);sql=sql.replace(addition,'');}
   await db.query(sql);
  }
  const org=randomUUID(),client=randomUUID(),order=randomUUID();
  await db.query('INSERT INTO "Organization" (id,name) VALUES ($1,$2)',[org,'Legacy organization']);
  await db.query('INSERT INTO "Client" (id,"organizationId",name) VALUES ($1,$2,$3)',[client,org,'Legacy client']);
  await db.query('INSERT INTO "Order" (id,"organizationId","clientId",number,title,total,notes) VALUES ($1,$2,$3,1,$4,1234.56,$5)',[order,org,client,'Legacy order','Keep historical notes']);
  await db.query('INSERT INTO "OrderItem" (id,"orderId",description,quantity,"unitPrice",total) VALUES ($1,$2,$3,1,1234.56,1234.56)',[randomUUID(),order,'Legacy service']);
  await db.query('INSERT INTO "Payment" (id,"organizationId","orderId",amount,note,"idempotencyKey") VALUES ($1,$2,$3,23.45,$4,$5)',[randomUUID(),org,order,'Legacy payment',randomUUID()]);
  await db.query('INSERT INTO "Expense" (id,"organizationId","orderId",amount,description,category,"idempotencyKey") VALUES ($1,$2,$3,67.89,$4,$5,$6)',[randomUUID(),org,order,'Legacy expense','OTHER',randomUUID()]);
  const before=(await db.query('SELECT * FROM "Order" WHERE id=$1',[order])).rows[0];
  await db.query('BEGIN');await db.query(await readFile(new URL(current+'/migration.sql',root),'utf8'));await db.query('COMMIT');
  const {serviceObjectId,...after}=(await db.query('SELECT * FROM "Order" WHERE id=$1',[order])).rows[0];
  assert.equal(serviceObjectId,null);assert.deepEqual(after,before);
  assert.equal((await db.query('SELECT amount::text FROM "Payment" WHERE "orderId"=$1',[order])).rows[0].amount,'23.45');
  assert.equal((await db.query('SELECT amount::text FROM "Expense" WHERE "orderId"=$1',[order])).rows[0].amount,'67.89');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM "ServiceObject"')).rows[0].count,0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM "ServiceRequest"')).rows[0].count,0);
 }finally{
  await db.end().catch(()=>{});
  if(created)await admin.query('DROP DATABASE "'+name+'"');
  await admin.end();
 }
});
