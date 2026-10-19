import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
export function equal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export function sign(value, key) { return createHmac('sha256', key).update(value).digest('hex'); }
export function newSession(key, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + 3600000, csrf: randomBytes(24).toString('hex') })).toString('base64url');
  return `${payload}.${sign(`session:${payload}`, key)}`;
}
export function session(cookie, key, now = Date.now()) {
  try {
    const token = cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('owner='))?.slice(6);
    const [payload, signature] = token.split('.');
    if (!equal(signature, sign(`session:${payload}`, key))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url'));
    return data.exp > now && typeof data.csrf === 'string' ? data : null;
  } catch { return null; }
}
export function sameOrigin(req, origin) { return req.headers.origin === origin; }
