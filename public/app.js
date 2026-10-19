const $ = id => document.getElementById(id);
let auth = { authenticated: false };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(auth.csrf ? { 'X-CSRF-Token': auth.csrf } : {}), ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Request failed');
  return result;
}
function element(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
function report(error) { $('error').textContent = error.message; }
async function loadAuth() {
  auth = await api('/api/session');
  $('login-form').hidden = auth.authenticated;
  $('build-form').hidden = !auth.authenticated;
  $('submit-build').disabled = !auth.buildEnabled;
  if (auth.authenticated && !auth.buildEnabled) $('build-message').textContent = 'Builds are awaiting server configuration. See the repository setup guide.';
}
async function loadBuilds() {
  if (!auth.authenticated) return;
  const builds = await api('/api/builds'); $('build-list').replaceChildren();
  for (const build of builds) {
    const row = element('article', '', 'entry'); row.append(element('p', build.title), element('p', build.status, 'hint'));
    const link = element('a', `View pull request #${build.number}`);
    // Never navigate to arbitrary URLs returned by model output.
    link.href = `https://github.com/DBEALE/MySite/pull/${Number(build.number)}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); $('build-list').append(row);
  }
}
async function route() {
  const selected = ['build', 'changes'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  for (const id of ['home', 'build', 'changes']) $(id).hidden = id !== selected;
  document.querySelectorAll('nav a').forEach(a => { if (a.hash === `#${selected}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('error').textContent = '';
  try {
    if (selected === 'build') { await loadAuth(); await loadBuilds(); }
    if (selected === 'changes') {
      const data = await api('/api/changes'); $('change-list').replaceChildren();
      if (!data.changes.length) $('change-list').append(element('p', 'No changes deployed yet.', 'muted'));
      for (const change of data.changes) {
        const row = element('article', '', 'entry');
        row.append(element('time', new Date(change.date).toLocaleString()), element('p', change.summary)); $('change-list').append(row);
      }
      $('revision').textContent = data.revision ? `Version ${data.revision.slice(0, 12)}` : '';
    }
  } catch (error) { report(error); }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('error').textContent = '';
  try { await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) }); $('password').value = ''; await route(); } catch (error) { report(error); }
});
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); $('build-list').replaceChildren(); await route(); } catch (error) { report(error); }
});
$('build-form').addEventListener('submit', async event => {
  event.preventDefault(); $('submit-build').disabled = true; $('error').textContent = ''; $('build-message').textContent = 'Preparing your change…';
  try {
    const build = await api('/api/build', { method: 'POST', body: JSON.stringify({ prompt: $('prompt').value }) });
    $('build-message').textContent = `Pull request #${build.number} created. It will merge only after verification and CI pass. Deployment follows automatically.`;
    $('prompt').value = ''; await loadBuilds();
  } catch (error) { $('build-message').textContent = ''; report(error); }
  finally { $('submit-build').disabled = !auth.buildEnabled; }
});
window.addEventListener('hashchange', route);
setInterval(() => { if (location.hash === '#build') loadBuilds().catch(report); }, 15000);
api('/api/site').then(site => {
  document.body.classList.add(site.theme, site.accent);
  if (site.title) $('page').append(element('h1', site.title));
  if (site.description) $('page').append(element('p', site.description, 'muted'));
  for (const section of site.sections) { const row = element('section', '', section.layout); row.append(element('h2', section.heading), element('p', section.body)); $('page').append(row); }
}).catch(report);
route();
