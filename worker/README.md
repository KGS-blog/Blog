# Blog article sync Worker

This Worker keeps the public blog static while moving shared article writes to GitHub's Contents API. The API hostname is `blog-api.qcoid.com`; the public blog remains on `blog.qcoid.com`.

## Cloudflare setup

1. Deploy this directory as a Cloudflare Worker (`worker/` is the project root). The Wrangler config creates the custom domain `blog-api.qcoid.com`.
2. Add these encrypted Worker secrets in **Settings → Variables and Secrets**:
   - `GITHUB_TOKEN`: a fine-grained GitHub token limited to repository `KGS-blog/Blog`, with **Contents: Read and write** permission.
   - `ADMIN_PASSWORD`: a new, unique password for the blog dashboard. Do not reuse a password currently embedded in an older copy of the site.
   - `SESSION_SECRET`: a random secret with at least 32 bytes of entropy.
3. Deploy again after setting secrets. Keep secret values out of this repository and out of chat.

The Worker reads and writes only `articles.json` on the `main` branch. It checks the GitHub file SHA before writing so a stale browser cannot overwrite a newer update. If two editors save at once, the later editor must reload before retrying.

## API

- `GET /api/articles`: reads the shared file and its GitHub SHA.
- `GET /api/auth/session`: checks the signed, HttpOnly admin session.
- `POST /api/auth/login` and `/api/auth/logout`: start/end the admin session.
- `PUT /api/articles`: writes the complete article document after authentication and SHA validation.

Only requests from `https://blog.qcoid.com` can use the API. Comments, subscribers, categories, and page copy remain browser-local and are outside this article-sync change.
