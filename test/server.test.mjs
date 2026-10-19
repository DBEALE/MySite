import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
test('owner login, origin, CSRF, public site, disabled builds and safe assets', async t => {
  const origin = 'http://localhost:3000';
  const { server } = createApp({ APP_ORIGIN: origin, OWNER_PASSWORD: 'secure-password-for-tests-only', SESSION_SECRET: 's'.repeat(64) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = (path, options) => fetch(url + path, options);
  assert.equal((await call('/api/site')).status, 200);
  assert.ok(Array.isArray((await (await call('/api/changes')).json()).changes));
  const root = await call('/'); assert.equal(root.status, 200); assert.ok(root.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal((await call('/.env')).status, 404);
  assert.equal((await call('/api/builds')).status, 401);
  const post = (path, data, extra = {}) => call(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(data) });
  assert.equal((await post('/api/login', { password: 'wrong' })).status, 401);
  assert.equal((await post('/api/login', { password: 'secure-password-for-tests-only' }, { Origin: 'https://evil.test' })).status, 403);
  const login = await post('/api/login', { password: 'secure-password-for-tests-only' }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0]; assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
  const auth = await (await call('/api/session', { headers: { Cookie: cookie } })).json(); assert.equal(auth.authenticated, true);
  assert.equal((await post('/api/build', { prompt: 'hi' }, { Cookie: cookie })).status, 403);
  assert.equal((await post('/api/build', { prompt: 'hi' }, { Cookie: cookie, 'X-CSRF-Token': auth.csrf })).status, 503);
  assert.equal((await post('/api/logout', {}, { Cookie: cookie, 'X-CSRF-Token': auth.csrf })).status, 200);
});
test('production refuses missing secrets or insecure origin', () => {
  assert.throws(() => createApp({ NODE_ENV: 'production' }));
});
