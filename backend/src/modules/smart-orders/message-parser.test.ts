import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOrderMessage} from './message-parser';
import {messagePreviewSchema,messageOrderSchema} from '@tirek/contracts';
const now=new Date('2026-11-09T20:30:00Z'); // Already 10 November in Almaty.
test('intake rejects database-incompatible text while preserving emoji and multiline notes',()=>{
 const draft={idempotencyKey:'12345678-1234-4123-8123-123456789012',newClient:{name:'Айдана'},order:{title:'Уборка 🧹',notes:'Строка 1\nСтрока 2',items:[{description:'Уборка',quantity:1,unitPrice:'123.45'}]}};
 assert.equal(messageOrderSchema.safeParse(draft).success,true);
 for(const bad of ['\u0000','\ud800']){
  assert.equal(messagePreviewSchema.safeParse({message:'Уборка '+bad}).success,false);
  assert.equal(messageOrderSchema.safeParse({...draft,order:{...draft.order,notes:'Комментарий'+bad}}).success,false);
 }
 assert.equal(messageOrderSchema.safeParse({...draft,newClient:{name:'Имя\nдругое поле'}}).success,false);
});
test('Russian free text extracts explicit fields and tomorrow uses Almaty',()=>{
 const r=parseOrderMessage('Нужна уборка квартиры завтра в 15:00, бюджет 25 000 ₸. Меня зовут Айдана, +7 700 111 22 33.',now);
 assert.equal(r.title,'уборка квартиры');assert.equal(r.amount,'25000.00');assert.equal(r.clientName,'Айдана');assert.equal(r.phone,'+77001112233');assert.equal(r.referenceDate,'2026-11-10');assert.equal(r.dueDate,'2026-11-11');assert.deepEqual(r.warnings,[]);
});
test('Kazakh labelled fields and decimal tiyn are preserved',()=>{
 const r=parseOrderMessage('Қызмет: Пәтер тазалау\nАты: Айдана\nТелефон: 8 (700) 111-22-33\nБағасы: 12 345,67 теңге\nСрок: 15.11.2026',now);
 assert.equal(r.title,'Пәтер тазалау');assert.equal(r.clientName,'Айдана');assert.equal(r.amount,'12345.67');assert.equal(r.phone,'+77001112233');assert.equal(r.dueDate,'2026-11-15');
});
test('ambiguous amounts dates and unsupported currencies remain unfilled',()=>{
 const r=parseOrderMessage('Услуга: ремонт. Сегодня или завтра. Бюджет 10000 ₸ или 12000 ₸',now);
 assert.equal(r.amount,'');assert.equal(r.dueDate,'');assert.ok(r.warnings.includes('AMOUNT_AMBIGUOUS'));assert.ok(r.warnings.includes('DATE_AMBIGUOUS'));
 assert.equal(parseOrderMessage('Уборка, бюджет 100 USD',now).amount,'');
 for(const price of ['-500 ₸','1.234 ₸','0 ₸'])assert.equal(parseOrderMessage('Уборка '+price,now).amount,'');
 assert.equal(parseOrderMessage('Клиент: Айдана\nСрок: 2026-02-30',now).title,'');
 assert.equal(parseOrderMessage('Нужна уборка послезавтра',now).dueDate,'');
});
