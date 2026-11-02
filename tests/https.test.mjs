import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

const ca = readFileSync('.local/caddy/pki/authorities/local/root.crt');
function request(path, { plain = false, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const client = plain ? http : https;
    const req = client.request(new URL(path, plain ? 'http://localhost:8080' : 'https://localhost:8443'), {
      ...(plain ? {} : { ca }), ...options,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body, protocol: response.socket?.getProtocol?.() }));
    });
    req.setTimeout(60000, () => req.destroy(new Error('HTTPS test timed out')));
    req.on('error', reject);
    req.end(options.method === 'POST' ? '{}' : undefined);
  });
}

test('local HTTPS validates the project CA, redirects safely and rejects unsafe origins', async () => {
  const redirect = await request('/register?lang=ru', { plain: true });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, 'https://localhost:8443/register?lang=ru');
  const foreignHost = await request('/', { plain: true, headers: { Host: 'evil.invalid' } });
  assert.notEqual(foreignHost.headers.location, 'https://evil.invalid:8443/');
  assert.equal(foreignHost.headers.location, undefined);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/);
  assert.equal(page.headers['strict-transport-security'], undefined);
  await assert.rejects(() => request('/api/health', { ca: [] }));
  for (const version of ['TLSv1.2', 'TLSv1.3']) {
    const health = await request('/api/health', { minVersion: version, maxVersion: version });
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).status, 'ok');
    assert.equal(health.headers['cache-control'], 'no-store');
  }
  await assert.rejects(() => request('/api/health', { minVersion: 'TLSv1.1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT:@SECLEVEL=0' }));
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://evil.invalid']) {
    const denied = await request('/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' } });
    assert.equal(denied.status, 403, origin);
    assert.equal(denied.headers['cache-control'], 'no-store');
  }
});
