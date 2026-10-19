# MySite

A deliberately blank website with **Build** and **Changes** menus. The owner can describe a page change, get a pull request, and have it merged and deployed after checks pass.

## Scope and security boundary

Automatic builds can change page titles, text, sections, plain/card layouts, light/dark themes and four accent colours. They cannot generate JavaScript, HTML, arbitrary CSS, URLs, server handlers, dependencies, authentication changes or workflows. More advanced features need a normal reviewed code change. This restriction is intentional: tests and prompt instructions alone cannot make arbitrary generated code safe to deploy with credentials.

The generator uses the supported OpenAI Responses API with strict structured output and a second independent local validator. No tools or shell execution are granted to the model. The renderer uses `textContent`, never `innerHTML`. A restrictive CSP also blocks inline scripts and external connections. Untrusted content remains inert even if it contains instructions or HTML.

GitHub **does** currently document a Copilot cloud-agent task API (`POST /agents/repos/{owner}/{repo}/tasks`), in public preview. It requires a user-to-server token; GitHub App installation tokens are unsupported there. This implementation chooses the supported OpenAI Responses API alternative for constrained page generation, rather than assuming a generic Copilot completion endpoint or granting a general coding agent automatic production access.

Sources verified 19 October 2026:
- [Copilot task API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Render Blueprint and CI-gated deployments](https://render.com/docs/blueprint-spec)

## How a build reaches production

1. The owner signs in with a long dedicated password. The backend issues a one-hour HttpOnly, SameSite=Strict cookie (Secure in production). Every mutation verifies the exact configured origin; authenticated mutations also require a session-bound CSRF token.
2. The backend checks main branch protection and whether another signed build is open. It reads the current main commit and sends only the page data and prompt to OpenAI. The GitHub and owner credentials are never sent to OpenAI or the browser.
3. After independent validation, it creates a single commit and PR changing exactly `content/site.json` and `content/changes.json`. The PR contains a server HMAC binding the head SHA, base SHA and branch. The original prompt is not published to GitHub.
4. GitHub Actions runs tests and page/history validation, with a read-only token, pinned actions, no credentials persisted and no secrets. There are no third-party runtime packages or generated code to install or execute.
5. Every 30 seconds, the backend recovers pending signed PRs from GitHub. It verifies the signature, current head, parent, base, file count, filenames, file types/modes and data schemas. It queries the specific CI workflow for the exact head and requires its latest run to have completed successfully. It rechecks the PR and merges with GitHub's head-SHA precondition. Strict branch protection protects against a concurrent base update. Any error leaves the PR unmerged.
6. The merge uses the server's fine-grained GitHub token, so the main push triggers CI. Render's `checksPass` deployment setting waits for checks, then also runs tests/validation during its own build and health-checks the service before making it live.
7. Changes is served from the running release's bundled history, not GitHub's current main. Failed deployments therefore cannot appear as live changes. The displayed date is the change creation time, not an asserted deployment timestamp. A rollback shows the restored release's history. The Render commit ID identifies the running version.

No self-approval review is fabricated. Passing automated checks and repository rules authorize the merge. If you require human reviews, those rules continue to block automatic merging.

## Activate on GitHub and Render

The bootstrap implementation is delivered as a normal pull request. Review and merge that first after CI passes. The owner must complete account settings and secret provisioning below; no keys are included in source.

### 1. Protect `main`

In GitHub Settings → Branches, create a **classic branch protection rule** for `main`:

- Require a pull request before merging. Do **not** require an approving review for the automatic data-only flow (or expect to approve every build).
- Require status checks to pass, selecting the `test` job from the `CI` workflow after its first run.
- Require branches to be up to date before merging.
- Enable “Do not allow bypassing the above settings” / enforcement for administrators.
- Leave force pushes and deletions disabled. Do not grant bypass actors. Enable squash merging.

The backend explicitly checks the classic protection endpoint, strict status checking, the `test` context, administrator enforcement and the PR requirement. Ruleset-only configurations are not supported by this first version: builds fail closed until a matching classic rule exists. CODEOWNERS identifies DBEALE for normal code reviews, but is not a substitute for protection.

### 2. Create a scoped GitHub credential

Create a **fine-grained personal access token** owned by DBEALE, selecting **only DBEALE/MySite**:

| Repository permission | Level | Purpose |
|---|---|---|
| Metadata | Read | Repository access |
| Contents | Read/write | Read page data, create branches and commits, merge |
| Pull requests | Read/write | Create and inspect PRs, merge |
| Actions | Read | Verify the exact CI run |
| Administration | Read | Read and enforce branch-protection configuration |

Do not grant Workflows, Secrets, Administration write, or organization permissions. Choose an expiry and rotate before it expires. GitHub's Contents permission cannot itself be restricted to two paths: the backend enforces the narrower policy. Compromise of this server or token remains a serious risk, so protect the hosting account and secrets. A separately maintained GitHub App with equivalent permissions is a future alternative; this implementation accepts a provisioned bearer token and does not mint installation tokens.

### 3. Create a Render web service using `render.yaml`

Connect DBEALE/MySite to a Render Blueprint. It runs Node 22 without package installation. Confirm branch `main`, one instance, health check `/health`, and **Auto-Deploy: After CI Checks Pass**. The initial deploy is a bootstrap operation; confirm the implementation PR's CI before creating the service. Hosting charges depend on the plan you choose.

Supply these environment variables in Render's private environment settings (never commit them):

| Setting | Value |
|---|---|
| `APP_ORIGIN` | Exact HTTPS origin of the service, e.g. `https://YOUR-SERVICE.onrender.com`, no trailing slash |
| `OWNER_PASSWORD` | Unique random owner password of at least 20 characters; recommended 32+ |
| `SESSION_SECRET` | Render-generated secret, at least 32 characters; also signs build records |
| `OPENAI_API_KEY` | API project key with a spending budget; separate from a ChatGPT subscription |
| `OPENAI_MODEL` | A model enabled on your API account that supports Responses structured outputs |
| `GITHUB_TOKEN` | The scoped fine-grained token above |
| `BUILD_ENABLED` | Keep `false` until protection, secrets and CI-gated deployment are configured; then set `true` |
| `NODE_ENV` | `production` (Blueprint supplies it) |

Use a service plan that keeps the process running if you need prompt merges: sleeping services resume the reconciler when they wake. Keep one instance: build locking and login throttling are process-local. The signed PR queue survives restarts, but request-in-progress generation and local throttle counters do not. Do not horizontally scale without a shared lock/rate-limit store. Global login throttling allows ten failures per fifteen minutes per process; it deliberately does not trust client-supplied forwarding headers.

No GitHub Actions secrets are needed. The runtime token is never available to PR CI. No deployment hook is needed; Render handles checks-gated deployment. Enable spending limits in your API project and restrict hosting administration to the owner.

### 4. Verify activation

Open Build, sign in, and request “Add the heading Hello and a welcome card”. Confirm a `mysite/…` PR, successful CI on that exact commit, its automatic merge, successful main CI and a successful Render deployment. Refresh Changes to confirm the summary and running commit. Until this live smoke test is run, API credentials, hosting and actual deployment are unverified.

## Local development

Requires Node.js 22 or later. No third-party packages are needed.

```sh
npm test
npm run check
npm start
```

Open `http://localhost:3000`. Public preview works without secrets; builds stay disabled. For owner login, copy `.env.example` to `.env`, set secrets locally, and run `node --env-file=.env server.mjs`. `.env` is ignored. Production refuses missing authentication secrets or a non-HTTPS origin.

## Recovery and limitations

- A CI failure, invalid signature, unsafe diff or stale base is not automatically overridden. Close the PR and submit a fresh prompt. Inspect GitHub and Render logs if CI or deployment fails.
- The backend polls every 30 seconds and the Build page every 15 seconds. A merge is not a deployment success. Changes is the authoritative view of what the current release contains.
- Rotate `SESSION_SECRET` to invalidate sessions. This also invalidates pending build signatures; close those PRs and resubmit. Logging out clears that browser's cookie; a stolen cookie remains valid until expiry or secret rotation.
- Revert through a reviewed PR or restore a known-good Render deployment. Keep builds disabled during incident recovery.
- The site and generated content are public. Avoid putting secrets or private data into page content or prompts. Prompts go to OpenAI with `store:false`; this is not a promise of zero provider retention.
- Tests cover authentication, CSRF/origin checks, sessions, schema limits, file restrictions, signatures, stale commits, symlinks, protection and CI merge gates. They do not establish that arbitrary generated application code is safe, which is why executable generation is excluded.
- New executable features, additional owners, OAuth, distributed locks and alternate hosting providers require reviewed implementation changes.
