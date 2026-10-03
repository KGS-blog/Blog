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

## Kabar Kopi members, community submissions, and MEVO reports

The Kabar Kopi public editorial feed remains static and crawlable in `Update-Coffee-Data/data/editorial-current.json` and its generated article pages. It is separate from **Report by MEVO**, which is stored in D1 and only served to signed-in members. The MEVO report upload endpoint accepts report payloads only; it is not a news collection or clustering endpoint. Reports uploaded by the MEVO process enter as drafts and must be published by an admin. Beta access is free; no payment flow is included.

Reader submissions are stored in the existing `field_submissions` table and admin queue for backward compatibility. Product-facing labels call this **Suara Komunitas**. Published submissions alone appear in the public feed. Existing stored submissions are retained.

One `kabar-kopi-member` membership record is created with `access_source=free_beta`.

The D1 schema is in `migrations/0001_kabar_kopi_membership.sql` and the new report table is added by `migrations/0002_mevo_member_reports.sql`. If the first migration is already applied, apply only migration 0002 in Cloudflare D1 or run `npx wrangler d1 execute kabar-kopi-members --remote --file=migrations/0002_mevo_member_reports.sql` from this directory. If D1 is not yet provisioned, create the `kabar-kopi-members` database, add a D1 binding named `DB` to production `qco-blog-sync`, then apply both migrations in order and deploy the Worker.

Email-link login needs the encrypted Worker secret `RESEND_API_KEY` and the variable `MEMBER_EMAIL_FROM` (a sender address on a verified domain). Google Sign-In needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` set to `https://blog-api.qcoid.com/api/member/auth/google/callback`; register that exact callback URL in the Google OAuth client. Keep OAuth client secrets out of GitHub and chat. Report upload needs `MEVO_SYNC_SECRET` as a Worker secret and in the trusted report-producing process. It is not used by the coffee news feed workflow. Send JSON shaped like `{"batch_id":"...","reports":[{"slug":"sample-report-id","language":"id","title":"...","teaser":"...","report":{"summary":"...","sections":[],"conclusion":"...","recommendations":[],"sources":[]}}]}` to the report sync endpoint; each item is saved as a draft for admin review.

Endpoints:

- `POST /api/member/auth/email`: send a short-lived verification/sign-in link.
- `GET /api/member/auth/verify-page` and `POST /api/member/auth/verify`: confirm the link and set an HttpOnly member session.
- `GET /api/member/auth/google` and `/api/member/auth/google/callback`: Google OpenID Connect sign-in.
- `GET /api/member/session` and `POST /api/member/logout`: inspect/end the member session.
- `POST /api/field-submissions`: accept authenticated reader submissions into the moderation queue. `publication_choice` is `as_submitted` or `editor_review`; the latter requires explicit editing consent. Every item keeps its original text.
- `GET /api/admin/field-submissions` and `POST /api/admin/field-submissions/:id`: admin review and publish decisions use the existing admin session.
- `GET /api/field-posts`: list only published field notes.
- `GET /api/member/mevo-reports` and `GET /api/member/mevo-reports/:slug`: require a signed-in member and return only published member reports.
- `GET /api/admin/mevo-reports`: list reports for the authenticated Blog admin.
- `POST /api/admin/mevo-reports` and `/api/admin/mevo-reports/:id`: create or update a report and its draft/published status using the authenticated Blog admin session.
- `POST /api/admin/mevo-reports/sync`: private MEVO report upload endpoint protected by `MEVO_SYNC_SECRET`; uploaded reports enter as drafts.
- `GET /api/premium/articles` and `/api/premium/articles/:slug`, plus `POST /api/admin/premium/sync`: retained for compatibility with the earlier public editorial sync. Kabar Kopi's public page now reads its crawlable editorial JSON directly from the Update-Coffee-Data repository; this is not the member Report by MEVO system.

No checkout, payment table, or payment provider is included. The member report API always requires a signed-in account, including during free beta. The public editorial body intentionally remains crawlable and public.
