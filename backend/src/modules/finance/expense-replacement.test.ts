import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expenseReplacementSchema } from '@tirek/contracts';

test('expense replacement requires the full target and normalizes keys without permitting identity/date overrides', () => {
  const key = 'ABCDEFAB-1234-4123-8123-ABCDEFABCDEF';
  const input = { amount: '10.10', description: ' Corrected expense ', category: 'RENT', orderId: key, reason: ' Correction reason ', idempotencyKey: key };
  const parsed = expenseReplacementSchema.parse(input);
  assert.equal(parsed.orderId, key.toLowerCase()); assert.equal(parsed.idempotencyKey, key.toLowerCase());
  assert.equal(parsed.description, 'Corrected expense'); assert.equal(parsed.reason, 'Correction reason');
  assert.equal(expenseReplacementSchema.parse({ ...input, orderId: null }).orderId, null);
  for (const override of [
    { orderId: undefined }, { orderId: '' }, { orderId: 'not-uuid' }, { amount: '0' }, { amount: '-1' }, { amount: '0.001' },
    { amount: '1e2' }, { amount: '1000000000000' }, { description: '' }, { description: 'bad\0text' },
    { description: 'bad\ud800' }, { description: 'a'.repeat(201) }, { category: 'ORDER_PAYMENT' },
    { reason: 'ab' }, { reason: 'a'.repeat(501) }, { reason: 'bad\0reason' },
    { organizationId: key }, { actorId: key }, { createdAt: '2020-01-01' }, { replacementExpenseId: key },
  ]) assert.equal(expenseReplacementSchema.safeParse({ ...input, ...override }).success, false);
});
