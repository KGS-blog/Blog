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

Blog article writes are limited to `https://blog.qcoid.com`. Cluster review writes are limited to the Kabar Kopi GitHub Pages origin `https://kgs-blog.github.io`; its login response returns a short-lived signed bearer session for cross-site requests. The existing `GITHUB_TOKEN` still needs access only to `KGS-blog/Blog`, with **Contents: Read and write** permission. Comments, subscribers, categories, and page copy remain browser-local and are outside this article-sync change.
