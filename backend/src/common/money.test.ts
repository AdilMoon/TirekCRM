import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cents, money, totalForItems } from './money';
test('adds decimal amounts without floating point error', () => {
  assert.equal(money(cents('0.1') + cents('0.2')), '0.30');
  assert.equal(totalForItems([{ quantity: 3, unitPrice: '19.99' }, { quantity: 2, unitPrice: '0.01' }]), '59.99');
});
test('handles large values and negative cash flow exactly', () => {
  assert.equal(money(cents('999999999999.99')), '999999999999.99');
  assert.equal(money(cents('10') - cents('10.01')), '-0.01');
});
test('rejects ambiguous or overprecise amounts', () => {
  for (const input of ['1e3', '0.001', '-1', 'NaN', '01', '1,23']) assert.throws(() => cents(input));
});
