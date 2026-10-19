import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSite, validateDiff, validateChanges } from '../lib/policy.mjs';
import { newSession, session } from '../lib/auth.mjs';
import { seal, unseal, verifyCandidate, mergeReady, requireProtection } from '../lib/builds.mjs';
const key = 'a'.repeat(64);
const site = { title: '', description: '', theme: 'light', accent: 'blue', sections: [] };
test('page schema rejects executable extensions, arbitrary styling and oversized data', () => {
  assert.equal(validateSite(site), site);
  for (const bad of [{ ...site, script: 'steal()' }, { ...site, theme: 'url(evil)' }, { ...site, sections: [{ heading: 'X', body: 'Y', layout: 'card', html: '<script>' }] }, { ...site, title: 'x'.repeat(121) }, { ...site, sections: Array(21).fill({ heading: '', body: '', layout: 'plain' }) }]) assert.throws(() => validateSite(bad));
});
test('only two modified data files can be merged', () => {
  const safe = [{ filename: 'content/site.json', status: 'modified' }, { filename: 'content/changes.json', status: 'modified' }];
  validateDiff(safe);
  for (const bad of [[...safe, { filename: '.github/workflows/ci.yml', status: 'modified' }], [safe[0]], [safe[0], { ...safe[1], status: 'renamed' }], [safe[0], safe[0]]]) assert.throws(() => validateDiff(bad));
  assert.throws(() => validateChanges([{ summary: 'invalid' }]));
});
test('sessions expire and cannot be modified or signed with another secret', () => {
  const token = newSession(key, 1000);
  assert.ok(session(`owner=${token}`, key, 2000));
  assert.equal(session(`owner=${token}`, key, 3601000), null);
  assert.equal(session(`owner=${token}x`, key, 2000), null);
  assert.equal(session(`owner=${token}`, 'another key', 2000), null);
});
const base = 'a'.repeat(40), head = 'b'.repeat(40), branch = 'mysite/12345678-1234-1234-1234-123456789abc';
const record = { base, head, branch };
const pr = { number: 1, body: seal(record, key), state: 'open', draft: false, changed_files: 2, base: { ref: 'main', repo: { full_name: 'DBEALE/MySite' } }, head: { sha: head, ref: branch, repo: { full_name: 'DBEALE/MySite' } } };
function fake({ failed = false, changedBase = false, unsafeMode = false, changedFiles = false, protection = true, noRuns = false } = {}) {
  const calls = [];
  return { repo: 'DBEALE/MySite', calls,
    file: async path => path.endsWith('site.json') ? site : [],
    request: async (path, method) => {
      calls.push({ path, method });
      if (path === '/branches/main/protection') return protection ? { required_status_checks: { strict: true, contexts: ['test'] }, enforce_admins: { enabled: true }, required_pull_request_reviews: {} } : {};
      if (path === '/git/ref/heads/main') return { object: { sha: changedBase ? 'c'.repeat(40) : base } };
      if (path === `/git/commits/${head}`) return { parents: [{ sha: base }], tree: { sha: 'tree' } };
      if (path.includes('/files?')) return [{ filename: changedFiles ? 'server.mjs' : 'content/site.json', status: 'modified' }, { filename: 'content/changes.json', status: 'modified' }];
      if (path.startsWith('/git/trees/')) return { tree: ['content/site.json', 'content/changes.json'].map(path => ({ path, type: 'blob', mode: unsafeMode ? '120000' : '100644' })) };
      if (path.startsWith('/actions/')) return { workflow_runs: noRuns ? [] : [{ id: 1, head_sha: head, head_repository: { full_name: 'DBEALE/MySite' }, path: '.github/workflows/ci.yml', status: 'completed', conclusion: failed ? 'failure' : 'success' }] };
      if (path === '/pulls/1') return pr;
      if (path.endsWith('/merge')) return { merged: true };
      if (method === 'DELETE') return null;
      throw Error(`Unexpected ${path}`);
    }
  };
}
test('build signatures reject tampering', () => {
  assert.deepEqual(unseal(pr.body, key), record);
  assert.equal(unseal(pr.body + 'x', key), null);
  assert.equal(unseal(pr.body, 'wrong'), null);
});
test('unsafe or stale PRs and missing protection fail closed', async () => {
  for (const config of [{ changedBase: true }, { unsafeMode: true }, { changedFiles: true }]) await assert.rejects(verifyCandidate(fake(config), pr, key));
  await assert.rejects(verifyCandidate(fake(), { ...pr, head: { ...pr.head, sha: 'c'.repeat(40) } }, key));
  await assert.rejects(verifyCandidate(fake(), { ...pr, changed_files: 3 }, key));
  await assert.rejects(requireProtection(fake({ protection: false })));
});
test('merge requires successful exact-head CI and uses a SHA precondition', async () => {
  for (const config of [{ failed: true }, { noRuns: true }]) {
    const gh = fake(config); await mergeReady(gh, pr, key);
    assert.ok(!gh.calls.some(call => call.path.endsWith('/merge')));
  }
  const gh = fake(); const request = gh.request;
  gh.request = async (path, method, body) => { if (path.endsWith('/merge')) assert.equal(body.sha, head); return request(path, method, body); };
  assert.equal(await mergeReady(gh, pr, key), 'Merged; deployment pending');
  assert.ok(gh.calls.some(call => call.path.endsWith('/merge')));
});
