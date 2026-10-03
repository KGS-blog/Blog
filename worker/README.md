# Blog article sync Worker

This Worker keeps the public blog static while moving shared article writes to GitHub's Contents API. The API hostname is `blog-api.qcoid.com`; the public blog remains on `blog.qcoid.com`.

## Cloudflare setup

1. Connect the `KGS-blog/Blog` repository in Cloudflare Workers Builds, set the root directory to `worker/`, and deploy with `npx wrangler deploy`. The Wrangler config creates the custom domain `blog-api.qcoid.com`.
2. Add these encrypted Worker secrets in **Settings → Variables and Secrets**:
   - `GITHUB_TOKEN`: a fine-grained GitHub token limited to repository `KGS-blog/Blog`, with **Contents: Read and write** permission.
   - `ADMIN_PASSWORD`: a new, unique password for the blog dashboard. Do not reuse a password currently embedded in an older copy of the site.
   - `SESSION_SECRET`: a random secret with at least 32 bytes of entropy.
3. Deploy again after setting secrets. Keep secret values out of this repository and out of chat.

The Worker reads and writes `articles.json` and `kabar-kopi-cluster-decisions.json` on the `main` branch. The latter stores editorial approval or rejection decisions for Kabar Kopi cluster candidates; the portal pipeline reads that public JSON on its next scheduled run. Article writes check the GitHub file SHA before writing so a stale browser cannot overwrite a newer update.

If the GitHub build connection is removed after the initial deployment, the live Worker continues running, but later Worker code changes must be deployed manually.

## API

- `GET /api/articles`: reads the shared file and its GitHub SHA.
- `GET /api/auth/session`: checks the signed, HttpOnly admin session.
- `POST /api/auth/login` and `/api/auth/logout`: start/end the admin session.
- `PUT /api/articles`: writes the complete article document after authentication and SHA validation.
- `GET /api/cluster-decisions`: reads public editor decisions for cluster candidates.
- `PUT /api/cluster-decisions`: stores an authenticated accept/reject decision after checking that the candidate still exists in the Update-Coffee-Data repo.

Blog article writes are limited to `https://blog.qcoid.com`. Cluster review writes are limited to the Kabar Kopi origins `https://kgs-blog.github.io` and `https://kabarkopi.qcoid.com`; its login response returns a short-lived signed bearer session for cross-site requests. The existing `GITHUB_TOKEN` still needs access only to `KGS-blog/Blog`, with **Contents: Read and write** permission. Comments, subscribers, categories, and page copy remain browser-local and are outside this article-sync change.

## Kabar Kopi free member foundation

The `/api/member/*`, `/api/premium/*`, and `/api/field-*` endpoints are a separate free-beta member system. They do not process payments. One `kabar-kopi-member` membership record is created with `access_source=free_beta`; both feature gates default to `false` so premium reading and field submissions remain open during the traffic-measurement phase.

The D1 schema is in `migrations/0001_kabar_kopi_membership.sql`. These routes return unavailable responses until D1 is provisioned and attached. In Cloudflare, create a D1 database named `kabar-kopi-members`, add a D1 binding named `DB` to the production `qco-blog-sync` Worker, and apply the migration with Wrangler from this directory (`npx wrangler d1 execute kabar-kopi-members --remote --file=migrations/0001_kabar_kopi_membership.sql`) or the D1 console. Then redeploy the Worker.

Email-link login needs the encrypted Worker secret `RESEND_API_KEY` and the variable `MEMBER_EMAIL_FROM` (a sender address on a verified domain). Google Sign-In needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` set to `https://blog-api.qcoid.com/api/member/auth/google/callback`; register that exact callback URL in the Google OAuth client. Keep OAuth client secrets out of GitHub and chat. `MEVO_SYNC_SECRET` must also be set as a Worker secret and as a repository Actions secret of the same name; the Update-Coffee-Data workflow syncs generated articles only when this secret is present. This sync keeps the member API's copy current; the existing editorial pages remain public during the free beta.

Endpoints:

- `POST /api/member/auth/email`: send a short-lived verification/sign-in link.
- `GET /api/member/auth/verify-page` and `POST /api/member/auth/verify`: confirm the link and set an HttpOnly member session.
- `GET /api/member/auth/google` and `/api/member/auth/google/callback`: Google OpenID Connect sign-in.
- `GET /api/member/session` and `POST /api/member/logout`: inspect/end the member session.
- `POST /api/field-submissions`: accept authenticated reader submissions into the moderation queue. `publication_choice` is `as_submitted` or `editor_review`; the latter requires explicit editing consent. Every item keeps its original text.
- `GET /api/admin/field-submissions` and `POST /api/admin/field-submissions/:id`: admin review and publish decisions use the existing admin session.
- `GET /api/field-posts`: list only published field notes.
- `GET /api/premium/articles` and `/api/premium/articles/:slug`: serve teasers or full editorial JSON according to the free-beta gate and membership state.
- `POST /api/admin/premium/sync`: private pipeline endpoint, protected by `MEVO_SYNC_SECRET`, for importing MEVO editorial articles into D1.

No checkout, payment table, or payment provider is included. Enabling a gate later is not sufficient by itself until full editorial bodies are removed from public static files and delivered only through the authenticated API.
