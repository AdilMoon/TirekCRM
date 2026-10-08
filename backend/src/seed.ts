import { randomUUID } from 'node:crypto';
import { createDb } from './database/database.service';
import { hashPassword } from './auth/session.guard';
import { Prisma } from '@prisma/client';
const ORG = '11111111-1111-4111-8111-111111111111';
async function seed() {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_SEED !== 'true') throw new Error('Demo seed is only enabled in local development');
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set DEMO_PASSWORD (at least 12 characters)');
  const db = createDb();
  try {
    if (await db.organization.findUnique({ where: { id: ORG } })) { console.log('Demo already exists; existing data was preserved.'); return; }
    const passwordHash = await hashPassword(password);
    await db.$transaction(async tx => {
      await tx.organization.create({ data: { id: ORG, name: 'Aq Niet Service', address: 'Алматы · демонстрационная организация', orderSeq: 1008, documentSeq: 1,
        users: { create: { name: 'Владелец', role:'OWNER', email: 'owner@tirek.local', passwordHash } } } });
      const samples = [
        ['Айдана С.', 'Личная уборка', 'Алматы, Бостандыкский район'],
        ['Тимур А.', 'Студия Forma', 'Алматы, Медеуский район'],
        ['Алия К.', 'Кофейня Jun', 'Алматы, Алмалинский район'],
        ['Данияр М.', 'Офис Atlas', 'Алматы, Бостандыкский район'],
        ['Мария Н.', '', 'Алматы, Ауэзовский район'],
        ['Арман Б.', 'Мастерская Nord', 'Алматы, Медеуский район'],
      ];
      const clients = [];
      for (const [name, company, address] of samples) clients.push(await tx.client.create({ data: { organizationId: ORG, name, company, address } }));
      const specs = [
        ['Генеральная уборка квартиры', 85000, 'IN_PROGRESS', 0, 0, 40000],
        ['Регулярная уборка офиса', 180000, 'CONFIRMED', 3, 1, 60000],
        ['Химчистка мебели в кофейне', 65000, 'NEW', 2, 2, 0],
        ['Уборка после ремонта', 240000, 'IN_PROGRESS', -2, 3, 120000],
        ['Уборка квартиры · 70 м²', 55000, 'COMPLETED', -5, 4, 55000],
        ['Мойка окон в мастерской', 90000, 'COMPLETED', -8, 5, 90000],
        ['Поддерживающая уборка', 45000, 'COMPLETED', -12, 0, 45000],
        ['Уборка офиса · сентябрь', 150000, 'COMPLETED', -35, 1, 150000],
      ] as const;
      const orders = [];
      for (let i = 0; i < specs.length; i++) {
        const [title, total, status, offset, clientIndex, paid] = specs[i];
        const due = new Date(); due.setUTCDate(due.getUTCDate() + offset); due.setUTCHours(0,0,0,0);
        const createdAt = new Date(due.getTime() - 3 * 86400000);
        const order = await tx.order.create({ data: { organizationId: ORG, clientId: clients[clientIndex].id, number: 1001 + i,
          title, total, status, dueDate: due, createdAt, notes: 'Демонстрационный заказ. Все данные вымышлены.',
          items: { create: { description: title, quantity: 1, unitPrice: total, total } } } });
        orders.push(order);
        if (paid) await tx.payment.create({ data: { organizationId: ORG, orderId: order.id, amount: paid, note: paid === total ? 'Полная оплата' : 'Предоплата по заказу', idempotencyKey: randomUUID(), createdAt: new Date(Math.min(due.getTime(), Date.now())) } });
      }
      for (const [description, category, amount, index] of [['Оплата исполнителей', 'LABOR', 65000, 3], ['Профессиональные средства', 'MATERIALS', 18500, 0], ['Транспорт на объекты', 'TRANSPORT', 12000, 0], ['Аренда оборудования', 'RENT', 25000, 5]] as const) {
        await tx.expense.create({ data: { organizationId: ORG, orderId: orders[index].id, description, category, amount, idempotencyKey: randomUUID() } });
      }
      // Historic demo transactions belong to real demo orders and remain visible in the ledger.
      for (let i = 2; i <= 5; i++) {
        const date = new Date(); date.setUTCDate(10); date.setUTCMonth(date.getUTCMonth() - i);
        const total = 180000 + i * 22000;
        const order = await tx.order.create({ data: { organizationId: ORG, clientId: clients[i % clients.length].id, number: 1009 + i - 2,
          title: `Архивный заказ · ${date.toLocaleDateString('ru-RU', { month: 'long' })}`, status: 'COMPLETED', total, createdAt: date,
          items: { create: { description: 'Комплексное обслуживание', quantity: 1, unitPrice: total, total } } } });
        await tx.payment.create({ data: { organizationId: ORG, orderId: order.id, amount: total, note: 'Оплата архивного заказа', idempotencyKey: randomUUID(), createdAt: date } });
        await tx.expense.create({ data: { organizationId: ORG, orderId: order.id, amount: 70000 + i * 9000, description: 'Расходы на выполнение', category: 'LABOR', idempotencyKey: randomUUID(), createdAt: date } });
      }
      await tx.organization.update({ where: { id: ORG }, data: { orderSeq: 1012 } });
      const selected = orders[4];
      await tx.document.create({ data: { organizationId: ORG, orderId: selected.id, number: 1, snapshot: {
        organization: { name: 'Aq Niet Service', address: 'Алматы · демонстрационная организация', businessId: '' },
        client: { name: clients[4].name, company: clients[4].company, address: clients[4].address, email: '', phone: '' },
        orderNumber: selected.number, title: selected.title, total: '55000.00',
        items: [{ description: selected.title, quantity: 1, unitPrice: '55000.00', total: '55000.00' }],
      } satisfies Prisma.InputJsonObject } });
    }, { timeout: 30000 });
    console.log('Demo data created. Login: owner@tirek.local. Password: DEMO_PASSWORD in .env.');
  } finally { await db.$disconnect(); }
}
seed().catch(error => { console.error(error); process.exitCode = 1; });
