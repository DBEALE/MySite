const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env (simple KEY=VALUE parser)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const PUBLIC = path.join(__dirname, 'public');
const INDEX = path.join(PUBLIC, 'index.html');
const API_URL = process.env.COPILOT_API_URL || 'https://models.github.ai/inference/chat/completions';
const MODEL = process.env.COPILOT_MODEL || 'openai/gpt-4.1';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > limit) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function build(prompt) {
  const key = process.env.COPILOT_API_KEY;
  if (!key) throw new Error('COPILOT_API_KEY is not configured on the server');
  const current = fs.readFileSync(INDEX, 'utf8');
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You edit a single-file website. Apply the user request to the provided HTML and return ONLY the complete updated HTML document, no explanations or markdown fences. Keep the "Build" menu link (id="build-link") and its prompt panel/script working.' },
        { role: 'user', content: `Current index.html:\n${current}\n\nRequest: ${prompt}` }
      ]
    })
  });
  if (!resp.ok) throw new Error(`Copilot API error ${resp.status}`);
  const json = await resp.json();
  let html = (json.choices?.[0]?.message?.content || '').trim();
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
  if (!/<html[\s>]/i.test(html) || !html.includes('id="build-link"')) {
    throw new Error('Model returned an invalid page; site left unchanged');
  }
  fs.writeFileSync(INDEX + '.bak', current);
  fs.writeFileSync(INDEX, html);
}

http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/api/build') {
      const { prompt } = JSON.parse((await readBody(req)) || '{}');
      if (typeof prompt !== 'string' || !prompt.trim()) return send(res, 400, { error: 'Prompt required' });
      await build(prompt.trim());
      return send(res, 200, { ok: true });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const rel = url === '/' ? '/index.html' : decodeURIComponent(url);
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file)]) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)]);
  } catch (e) {
    send(res, e.code === 'ENOENT' ? 404 : 500, { error: e.code === 'ENOENT' ? 'Not found' : e.message });
  }
}).listen(process.env.PORT || 3000, () => console.log('Listening'));
