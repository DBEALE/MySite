import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { equal, newSession, session, sameOrigin } from './lib/auth.mjs';
import { GitHub } from './lib/github.mjs';
import { createBuild, mergeReady, unseal } from './lib/builds.mjs';
import { validateSite, validateChanges } from './lib/policy.mjs';

export function createApp(env = process.env, dependencies = {}) {
  const root = new URL('./', import.meta.url);
  const origin = env.APP_ORIGIN || 'http://localhost:3000';
  const production = env.NODE_ENV === 'production';
  const key = env.SESSION_SECRET || '';
  const configured = key.length >= 32 && (env.OWNER_PASSWORD || '').length >= 20;
  const buildEnabled = env.BUILD_ENABLED === 'true' && configured && !!env.GITHUB_TOKEN && !!env.OPENAI_API_KEY && !!env.OPENAI_MODEL;
  if (production && (!configured || !origin.startsWith('https://'))) throw Error('Set strong owner/session secrets and an HTTPS APP_ORIGIN');
  const gh = dependencies.github || new GitHub(env.GITHUB_TOKEN);
  const statuses = new Map();
  let creating = false, merging = false, lastBuild = 0;
  let loginAttempts = [];
  const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  async function body(req) {
    let data = '';
    for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 10000) { const e = Error('Request too large'); e.status = 413; throw e; } }
    try { return JSON.parse(data); } catch { const e = Error('Invalid JSON'); e.status = 400; throw e; }
  }
  async function reconcile() {
    if (!buildEnabled || merging || creating) return;
    merging = true;
    try {
      const prs = await gh.request('/pulls?state=open&per_page=100');
      for (const item of prs.filter(pr => unseal(pr.body, key))) {
        try { statuses.set(item.number, await mergeReady(gh, await gh.request(`/pulls/${item.number}`), key)); }
        catch (error) { statuses.set(item.number, error.message); }
      }
      while (statuses.size > 100) statuses.delete(statuses.keys().next().value);
    } catch { /* Transient network failures are retried; never merge on error. */ }
    finally { merging = false; }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const path = new URL(req.url, origin).pathname;
      const owner = configured ? session(req.headers.cookie, key) : null;
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && path === '/api/session') return send(res, 200, { authenticated: !!owner, csrf: owner?.csrf, buildEnabled });
      if (req.method === 'GET' && path === '/api/site') return send(res, 200, validateSite(JSON.parse(await readFile(new URL('content/site.json', root)))));
      // These files belong to this running deployment, not merely merged main.
      if (req.method === 'GET' && path === '/api/changes') return send(res, 200, { revision: env.RENDER_GIT_COMMIT || null, changes: validateChanges(JSON.parse(await readFile(new URL('content/changes.json', root)))) });
      if (req.method === 'POST') {
        if (!sameOrigin(req, origin) || !req.headers['content-type']?.startsWith('application/json')) return send(res, 403, { error: 'Invalid request origin or content type' });
        if (path === '/api/login') {
          loginAttempts = loginAttempts.filter(time => time > Date.now() - 900000);
          if (loginAttempts.length >= 10) return send(res, 429, { error: 'Too many login attempts. Try again in 15 minutes.' });
          loginAttempts.push(Date.now());
          const input = await body(req);
          if (!configured || !equal(input.password, env.OWNER_PASSWORD)) return send(res, 401, { error: 'Invalid owner password' });
          loginAttempts = [];
          res.setHeader('Set-Cookie', `owner=${newSession(key)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${production ? '; Secure' : ''}`);
          return send(res, 200, { ok: true });
        }
        if (!owner || !equal(req.headers['x-csrf-token'], owner.csrf)) return send(res, 403, { error: 'Owner sign-in required' });
        if (path === '/api/logout') {
          res.setHeader('Set-Cookie', `owner=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production ? '; Secure' : ''}`);
          return send(res, 200, { ok: true });
        }
        if (path === '/api/build') {
          if (!buildEnabled) return send(res, 503, { error: 'Builds are disabled until server secrets and repository protection are configured.' });
          if (creating || merging || Date.now() - lastBuild < 60000) return send(res, 429, { error: 'A build is running or cooling down. Try again shortly.' });
          const input = await body(req);
          if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 4000) return send(res, 400, { error: 'Enter a prompt of 1–4000 characters.' });
          creating = true; lastBuild = Date.now();
          try {
            const pr = await (dependencies.createBuild || createBuild)(gh, { key, openaiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }, input.prompt);
            statuses.set(pr.number, 'Waiting for CI');
            return send(res, 202, { number: pr.number, url: pr.html_url });
          } finally { creating = false; }
        }
      }
      if (req.method === 'GET' && path === '/api/builds') {
        if (!owner) return send(res, 401, { error: 'Owner sign-in required' });
        if (!buildEnabled) return send(res, 200, []);
        const prs = await gh.request('/pulls?state=all&sort=created&direction=desc&per_page=30');
        return send(res, 200, prs.filter(pr => unseal(pr.body, key)).slice(0, 10).map(pr => ({ number: pr.number, url: pr.html_url, title: pr.title, status: pr.state === 'closed' ? (pr.merged_at ? 'Merged; check Changes for the live release' : 'Closed') : statuses.get(pr.number) || 'Waiting for verification' })));
      }
      const assets = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'] };
      if (req.method === 'GET' && assets[path]) {
        res.writeHead(200, { 'Content-Type': assets[path][1] }); return res.end(await readFile(new URL(assets[path][0], root)));
      }
      send(res, 404, { error: 'Not found' });
    } catch (error) { send(res, error.status || 502, { error: error.message || 'Request failed' }); }
  });
  server.requestTimeout = 120000;
  return { server, reconcile };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
  const timer = setInterval(() => void app.reconcile(), 30000); timer.unref();
  void app.reconcile();
  process.on('SIGTERM', () => { clearInterval(timer); app.server.close(); });
}
