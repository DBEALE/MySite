export class GitHub {
  constructor(token, repo = 'DBEALE/MySite') { this.token = token; this.repo = repo; }
  async request(path, method = 'GET', body) {
    const response = await fetch(`https://api.github.com/repos/${this.repo}${path}`, {
      method, signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) { const error = Error(`GitHub request failed (${response.status})`); error.status = response.status; throw error; }
    return response.status === 204 ? null : response.json();
  }
  async file(path, ref) {
    const file = await this.request(`/contents/${path}?ref=${encodeURIComponent(ref)}`);
    if (file.type !== 'file' || file.size > 150000 || file.encoding !== 'base64') throw Error('Unexpected repository file');
    return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  }
}
