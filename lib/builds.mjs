import { randomUUID } from 'node:crypto';
import { sign, equal } from './auth.mjs';
import { validateSite, validateChanges, validateDiff } from './policy.mjs';
import { generate } from './agent.mjs';

export async function requireProtection(gh) {
  const protection = await gh.request('/branches/main/protection');
  const checks = protection.required_status_checks;
  if (!checks?.strict || !checks.contexts?.includes('test') || !protection.enforce_admins?.enabled || !protection.required_pull_request_reviews) {
    throw Error('Configure main branch protection: require test, require up-to-date branches and pull requests, and enforce for administrators.');
  }
}

export function seal(record, key) {
  const data = Buffer.from(JSON.stringify(record)).toString('base64url');
  return `MySite verified build\n\n${data}.${sign(`build:${data}`, key)}`;
}
export function unseal(body, key) {
  try {
    const [data, signature] = body.split('\n\n')[1].split('.');
    if (!equal(signature, sign(`build:${data}`, key))) return null;
    const result = JSON.parse(Buffer.from(data, 'base64url'));
    if (!/^[a-f0-9]{40}$/.test(result.head) || !/^[a-f0-9]{40}$/.test(result.base) || !/^mysite\/[a-f0-9-]{36}$/.test(result.branch)) return null;
    return result;
  } catch { return null; }
}
export async function createBuild(gh, config, prompt) {
  await requireProtection(gh);
  const pending = await gh.request('/pulls?state=open&per_page=100');
  if (pending.some(pr => unseal(pr.body, config.key))) throw Error('A build is already pending. Merge or close it before starting another.');
  const base = (await gh.request('/git/ref/heads/main')).object.sha;
  const current = validateSite(await gh.file('content/site.json', base));
  const history = validateChanges(await gh.file('content/changes.json', base));
  const next = await generate(prompt, current, config.openaiKey, config.model);
  if (JSON.stringify(next) === JSON.stringify(current)) throw Error('The prompt produced no changes.');
  const id = randomUUID(), branch = `mysite/${id}`;
  const summary = `Updated page: ${next.sections.length} section(s), ${next.theme} theme, ${next.accent} accent${next.title ? `; title: ${next.title}` : ''}.`;
  const changes = [{ id, date: new Date().toISOString(), summary }, ...history].slice(0, 100);
  const baseCommit = await gh.request(`/git/commits/${base}`);
  const tree = await gh.request('/git/trees', 'POST', { base_tree: baseCommit.tree.sha, tree: [
    { path: 'content/site.json', mode: '100644', type: 'blob', content: JSON.stringify(next, null, 2) + '\n' },
    { path: 'content/changes.json', mode: '100644', type: 'blob', content: JSON.stringify(changes, null, 2) + '\n' }
  ] });
  const commit = await gh.request('/git/commits', 'POST', { message: `MySite build ${id}`, tree: tree.sha, parents: [base] });
  await gh.request('/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
  try {
    return await gh.request('/pulls', 'POST', { title: summary.slice(0, 200), head: branch, base: 'main', body: seal({ head: commit.sha, base, branch }, config.key) });
  } catch (error) {
    await gh.request(`/git/refs/heads/${branch}`, 'DELETE').catch(() => {});
    throw error;
  }
}
export async function verifyCandidate(gh, pr, key) {
  const record = unseal(pr.body, key);
  if (!record || pr.state !== 'open' || pr.draft || pr.base.ref !== 'main' || pr.head.repo?.full_name !== gh.repo || pr.base.repo?.full_name !== gh.repo || pr.head.ref !== record.branch || pr.head.sha !== record.head || pr.changed_files !== 2) throw Error('Build identity or scope changed; manual review required.');
  if ((await gh.request('/git/ref/heads/main')).object.sha !== record.base) throw Error('Main changed. Close this build and submit again.');
  const commit = await gh.request(`/git/commits/${record.head}`);
  if (commit.parents.length !== 1 || commit.parents[0].sha !== record.base) throw Error('Unexpected commit ancestry');
  validateDiff(await gh.request(`/pulls/${pr.number}/files?per_page=100`));
  const tree = await gh.request(`/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated || ['content/site.json', 'content/changes.json'].some(path => !tree.tree.some(e => e.path === path && e.type === 'blob' && e.mode === '100644'))) throw Error('Unsafe file mode');
  validateSite(await gh.file('content/site.json', record.head));
  validateChanges(await gh.file('content/changes.json', record.head));
  return record;
}
export async function mergeReady(gh, pr, key) {
  await requireProtection(gh);
  const record = await verifyCandidate(gh, pr, key);
  const result = await gh.request(`/actions/workflows/ci.yml/runs?head_sha=${record.head}&event=pull_request&per_page=100`);
  const runs = result.workflow_runs.filter(run => run.head_sha === record.head && run.head_repository?.full_name === gh.repo && run.path === '.github/workflows/ci.yml');
  runs.sort((a, b) => b.id - a.id);
  if (!runs.length || runs[0].status !== 'completed') return 'Waiting for CI';
  if (runs[0].conclusion !== 'success') return 'CI failed; close this build and try again';
  // GitHub's SHA precondition prevents merging a different head. Strict branch
  // protection additionally prevents a concurrent base update bypassing CI.
  await verifyCandidate(gh, await gh.request(`/pulls/${pr.number}`), key);
  const merged = await gh.request(`/pulls/${pr.number}/merge`, 'PUT', { sha: record.head, merge_method: 'squash', commit_title: pr.title });
  if (!merged.merged) throw Error('GitHub blocked the merge');
  await gh.request(`/git/refs/heads/${record.branch}`, 'DELETE').catch(() => {});
  return 'Merged; deployment pending';
}
