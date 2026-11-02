import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { allowedWebOrigins, secureSessionCookie, webOrigin } from './web-origin';
import { setSessionCookie } from '../auth/session';
import { SessionGuard } from '../auth/session.guard';
import type { Database } from '../database/database.service';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';

test('HTTPS cookie and CSRF policy is bound to configuration, never forwarded headers', async () => {
  const previous = { origin: process.env.WEB_ORIGIN, mode: process.env.NODE_ENV };
  const app = Fastify();
  try {
    process.env.NODE_ENV = 'development';
    process.env.WEB_ORIGIN = 'https://localhost:8443';
    await app.register(cookie);
    app.get('/', async (_req, reply) => {
      setSessionCookie(reply, { token: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60000) });
      return { ok: true };
    });
    const guard = new SessionGuard({} as Database, new Reflector());
    function context(origin?: string) {
      return {
        switchToHttp: () => ({ getRequest: () => ({ url: '/api/auth/login', method: 'POST', headers: { origin, 'x-forwarded-proto': 'https' } }) }),
        getHandler: () => context, getClass: () => SessionGuard,
      } as unknown as ExecutionContext;
    }
    assert.equal(await guard.canActivate(context('https://localhost:8443')), true);
    for (const origin of [undefined, '', 'null', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8443', 'https://localhost:8443.evil.invalid', 'https://localhost:8443/']) {
      await assert.rejects(() => guard.canActivate(context(origin)), error => (error as { getStatus(): number }).getStatus() === 403);
    }
    const response = await app.inject({ url: '/', headers: { 'x-forwarded-proto': 'http' } });
    const header = String(response.headers['set-cookie']);
    for (const flag of [/; Secure/i, /; HttpOnly/i, /; SameSite=Lax/i, /; Path=\//i]) assert.match(header, flag);
    assert.deepEqual([...allowedWebOrigins()], ['https://localhost:8443']);
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    assert.equal(secureSessionCookie(), false);
    assert.deepEqual([...allowedWebOrigins()], ['http://localhost:3000', 'http://127.0.0.1:3000']);
    assert.doesNotMatch(String((await app.inject({ url: '/', headers: { 'x-forwarded-proto': 'https' } })).headers['set-cookie']), /; Secure/i);
    process.env.NODE_ENV = 'production';
    assert.equal(secureSessionCookie(), true);
    assert.deepEqual([...allowedWebOrigins()], ['http://localhost:3000']);
    for (const value of ['https://localhost:8443/', 'https://user:password@localhost:8443', 'javascript:alert(1)', 'https://localhost:8443/path', 'https://localhost:8443?x=1']) {
      process.env.WEB_ORIGIN = value;
      assert.throws(webOrigin);
    }
  } finally {
    await app.close();
    if (previous.origin === undefined) delete process.env.WEB_ORIGIN; else process.env.WEB_ORIGIN = previous.origin;
    if (previous.mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.mode;
  }
});
