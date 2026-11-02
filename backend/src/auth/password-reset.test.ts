import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordResetRequestSchema, passwordResetConfirmSchema } from '@tirek/contracts';
import { passwordResetDeliveryMode } from './password-reset-delivery';

test('recovery is local only and fails closed for unsupported or unsafe production delivery', () => {
  assert.equal(passwordResetDeliveryMode({ NODE_ENV: 'development' }), 'local');
  assert.equal(passwordResetDeliveryMode({ NODE_ENV: 'production' }), 'disabled');
  assert.equal(passwordResetDeliveryMode({ PASSWORD_RESET_DELIVERY: 'disabled' }), 'disabled');
  assert.throws(() => passwordResetDeliveryMode({ NODE_ENV: 'production', PASSWORD_RESET_DELIVERY: 'local' }));
  assert.throws(() => passwordResetDeliveryMode({ PASSWORD_RESET_DELIVERY: 'smtp' }));
});
test('reset contracts normalize email/token and reject identity overrides and unbounded credentials', () => {
  assert.deepEqual(passwordResetRequestSchema.parse({ email: ' Owner@Example.COM ' }), { email: 'owner@example.com' });
  const input = { token: 'A'.repeat(64), newPassword: 'ResetFixture2026!' };
  assert.equal(passwordResetConfirmSchema.parse(input).token, 'a'.repeat(64));
  for (const payload of [{ email: 'not-email' }, { email: 'a@example.com', userId: 'other' }, { email: ['a@example.com'] }]) assert.equal(passwordResetRequestSchema.safeParse(payload).success, false);
  for (const override of [{ token: 'a'.repeat(63) }, { token: 'g'.repeat(64) }, { token: ' ' + 'a'.repeat(64) }, { token: ['a'.repeat(64)] }, { newPassword: 'short' }, { newPassword: 'x'.repeat(129) }, { userId: 'other' }, { email: 'other@example.com' }, { organizationId: 'other' }]) assert.equal(passwordResetConfirmSchema.safeParse({ ...input, ...override }).success, false);
});
