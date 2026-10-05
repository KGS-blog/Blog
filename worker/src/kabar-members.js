const MEMBER_COOKIE = "qco_kabar_member";
const STATE_COOKIE = "qco_kabar_google_state";
const SESSION_DAYS = 30;
const MAX_SUBMISSION_CHARS = 20000;
const KABAR_ORIGIN = "https://kabarkopi.qcoid.com";
const MEMBER_API_ORIGINS = new Set([KABAR_ORIGIN, "https://blog.qcoid.com", "https://kgs-blog.github.io"]);

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
});
const now = () => new Date().toISOString();
const randomToken = (size = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
};
const sha256 = async value => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
};
const escapeHtml = value => String(value || "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const normalizeEmail = value => String(value || "").trim().toLowerCase();
const id = () => crypto.randomUUID();

function cookieValue(request, key) {
  const part = (request.headers.get("Cookie") || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${key}=`));
  try { return part ? decodeURIComponent(part.slice(key.length + 1)) : ""; } catch (_) { return ""; }
}
function memberCookie(token, maxAge = SESSION_DAYS * 86400) {
  return `${MEMBER_COOKIE}=${encodeURIComponent(token)}; Domain=qcoid.com; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}
function stateCookie(token, maxAge = 600) {
  return `${STATE_COOKIE}=${encodeURIComponent(token)}; Domain=qcoid.com; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}
function cors(request) {
  const origin = request.headers.get("Origin");
  if (!MEMBER_API_ORIGINS.has(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" };
}
function response(request, data, status = 200, headers = {}) {
  const corsHeaders = cors(request);
  if (request.headers.has("Origin") && !corsHeaders["Access-Control-Allow-Origin"]) {
    return json({ error: "Origin tidak diizinkan." }, 403);
  }
  return json(data, status, { ...corsHeaders, ...headers });
}
async function bodyJson(request) {
  try { return await request.json(); } catch (_) { return null; }
}
async function memberForRequest(request, env) {
  if (!env.DB) return null;
  const token = cookieValue(request, MEMBER_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(`SELECT m.id, m.email, m.display_name, m.status, m.member_role, m.role_other,
      m.newsletter_opt_in, m.profile_completed_at,
      CASE WHEN m.profile_completed_at IS NOT NULL THEN 1 ELSE 0 END AS profile_complete
    FROM member_sessions s JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND m.status = 'active'`)
    .bind(tokenHash, now()).first();
}
async function memberHasAccess(member, env) {
  if (!member || !member.profile_complete) return false;
  const row = await env.DB.prepare(`SELECT 1 AS allowed FROM memberships
    WHERE member_id = ? AND status = 'active' AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`)
    .bind(member.id, now(), now()).first();
  return Boolean(row);
}
async function createMemberSession(env, memberId) {
  const token = randomToken();
  const created = now();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare(`INSERT INTO member_sessions (token_hash, member_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)`)
    .bind(await sha256(token), memberId, expires, created).run();
  return token;
}
async function ensureMember(env, email, displayName, provider, subject) {
  const normalized = normalizeEmail(email);
  const timestamp = now();
  const proposedId = id();
  await env.DB.prepare(`INSERT INTO members (id, email, email_normalized, display_name, email_verified_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(email_normalized) DO UPDATE SET
      email = excluded.email,
      display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE members.display_name END,
      email_verified_at = COALESCE(members.email_verified_at, excluded.email_verified_at),
      updated_at = excluded.updated_at`)
    .bind(proposedId, normalized, normalized, String(displayName || "").trim().slice(0, 80), timestamp, timestamp, timestamp).run();
  const member = await env.DB.prepare("SELECT id FROM members WHERE email_normalized = ? AND status = 'active'")
    .bind(normalized).first();
  if (!member) throw new Error("Member could not be created");
  await env.DB.prepare(`INSERT OR IGNORE INTO member_identities (id, member_id, provider, provider_subject, created_at)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(id(), member.id, provider, subject, timestamp).run();
  return member;
}
async function completeMemberProfile(request, env) {
  if (!env.DB) return response(request, { error: "Penyimpanan akun belum dikonfigurasi." }, 503);
  const member = await memberForRequest(request, env);
  if (!member) return response(request, { error: "Masuk dengan email atau Google terlebih dahulu." }, 401);
  const body = await bodyJson(request);
  const displayName = String(body?.display_name || "").trim().replace(/\s+/g, " ");
  const role = String(body?.member_role || "");
  const roleOther = String(body?.role_other || "").trim().replace(/\s+/g, " ");
  const newsletter = body?.newsletter_opt_in;
  if (displayName.length < 2 || displayName.length > 80) return response(request, { error: "Nama harus 2–80 karakter." }, 400);
  if (!["petani", "prosesor", "marketing", "student", "lainnya"].includes(role)) return response(request, { error: "Pilih peran Anda." }, 400);
  if (role === "lainnya" && (roleOther.length < 2 || roleOther.length > 80)) return response(request, { error: "Sebutkan peran lainnya (2–80 karakter)." }, 400);
  if (typeof newsletter !== "boolean") return response(request, { error: "Pilih apakah Anda ingin menerima newsletter." }, 400);
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE members SET display_name = ?, member_role = ?, role_other = ?, newsletter_opt_in = ?,
      profile_completed_at = COALESCE(profile_completed_at, ?), updated_at = ? WHERE id = ?`)
      .bind(displayName, role, role === "lainnya" ? roleOther : null, newsletter ? 1 : 0, timestamp, timestamp, member.id),
    env.DB.prepare(`INSERT INTO memberships (id, member_id, package_id, status, access_source, starts_at, updated_at)
      VALUES (?, ?, 'kabar-kopi-member', 'active', 'free_beta', ?, ?)
      ON CONFLICT(member_id) DO UPDATE SET status='active', access_source='free_beta', updated_at=excluded.updated_at`)
      .bind(id(), member.id, timestamp, timestamp)
  ]);
  return response(request, { completed: true, message: "Profil anggota tersimpan." });
}
function validateEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function verifyLinkPage(token) {
  const safeToken = escapeHtml(token);
  const html = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verifikasi Kabar Kopi</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#fbfaf7;color:#25231f;max-width:520px;margin:12vh auto;padding:24px}main{background:#fff;border:1px solid #e7e1d8;padding:28px}button{background:#4c3425;color:#fff;border:0;padding:12px 18px;font:inherit;cursor:pointer}p{color:#726b63}</style><main><h1>Masuk ke Kabar Kopi</h1><p>Tekan tombol untuk menyelesaikan verifikasi dan membuka akun Anda.</p><form method="post" action="/api/member/auth/verify"><input type="hidden" name="token" value="${safeToken}"><button type="submit">Verifikasi dan lanjutkan</button></form></main></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function redirect(url, headers = {}) {
  const output = new Headers({ Location: url, "Cache-Control": "no-store" });
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "set-cookie" && Array.isArray(value)) value.forEach(cookie => output.append("Set-Cookie", cookie));
    else output.set(key, value);
  }
  return new Response(null, { status: 303, headers: output });
}
async function startEmailLogin(request, env) {
  if (!env.DB || !env.RESEND_API_KEY || !env.MEMBER_EMAIL_FROM) return response(request, { error: "Login email belum dikonfigurasi." }, 503);
  const body = await bodyJson(request);
  const email = normalizeEmail(body?.email);
  const displayName = String(body?.display_name || "").trim().slice(0, 80);
  if (!validateEmail(email)) return response(request, { error: "Alamat email tidak valid." }, 400);

  const timestamp = now();
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM member_auth_tokens
    WHERE (email_normalized = ? OR request_key = ?) AND created_at > ?`)
    .bind(email, await sha256(request.headers.get("CF-Connecting-IP") || "unknown"), new Date(Date.now() - 3600000).toISOString()).first();
  if (Number(count?.total || 0) >= 5) return response(request, { error: "Terlalu banyak permintaan. Coba lagi nanti." }, 429);

  const token = randomToken();
  const expiry = new Date(Date.now() + 15 * 60000).toISOString();
  await env.DB.prepare(`INSERT INTO member_auth_tokens
    (token_hash, email_normalized, display_name, purpose, request_key, expires_at, created_at)
    VALUES (?, ?, ?, 'email_login', ?, ?, ?)`)
    .bind(await sha256(token), email, displayName, await sha256(request.headers.get("CF-Connecting-IP") || "unknown"), expiry, timestamp).run();

  const verifyUrl = `https://blog-api.qcoid.com/api/member/auth/verify-page?token=${encodeURIComponent(token)}`;
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.MEMBER_EMAIL_FROM,
      to: [email],
      subject: "Tautan masuk Kabar Kopi",
      html: `<p>Gunakan tombol berikut untuk masuk ke Kabar Kopi. Tautan berlaku 15 menit.</p><p><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;background:#4c3425;color:#fff;text-decoration:none">Verifikasi dan masuk</a></p><p>Jika Anda tidak meminta tautan ini, abaikan email ini.</p>`
    })
  });
  if (!emailResponse.ok) return response(request, { error: "Email verifikasi belum dapat dikirim." }, 502);
  return response(request, { sent: true, message: "Jika alamat dapat digunakan, tautan masuk akan dikirim." }, 202);
}
async function verifyEmailLogin(request, env) {
  if (!env.DB) return response(request, { error: "Penyimpanan akun belum dikonfigurasi." }, 503);
  let token = "";
  if (request.headers.get("Content-Type")?.includes("application/json")) token = String((await bodyJson(request))?.token || "");
  else {
    const form = await request.formData().catch(() => null);
    token = String(form?.get("token") || "");
  }
  if (!/^[a-f0-9]{64}$/.test(token)) return response(request, { error: "Tautan tidak valid atau sudah kedaluwarsa." }, 400);
  const tokenHash = await sha256(token);
  const challenge = await env.DB.prepare(`SELECT * FROM member_auth_tokens
    WHERE token_hash = ? AND purpose = 'email_login' AND consumed_at IS NULL AND expires_at > ?`)
    .bind(tokenHash, now()).first();
  if (!challenge) return response(request, { error: "Tautan tidak valid atau sudah kedaluwarsa." }, 400);
  const consumed = await env.DB.prepare(`UPDATE member_auth_tokens SET consumed_at = ?
    WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`)
    .bind(now(), tokenHash, now()).run();
  if (!consumed.meta?.changes) return response(request, { error: "Tautan sudah digunakan." }, 409);
  const member = await ensureMember(env, challenge.email_normalized, challenge.display_name, "email", challenge.email_normalized);
  const session = await createMemberSession(env, member.id);
  const setCookie = memberCookie(session);
  if (request.method === "POST" && !request.headers.get("Content-Type")?.includes("application/json")) {
    return redirect(`${KABAR_ORIGIN}/?account=ready#akun`, { "Set-Cookie": setCookie });
  }
  return response(request, { authenticated: true, email: challenge.email_normalized, display_name: member.display_name }, 200, { "Set-Cookie": setCookie });
}
function googleAuthorize(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) return new Response("Google Sign-In belum dikonfigurasi.", { status: 503 });
  const state = randomToken(24);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  });
  return redirect(url.href, { "Set-Cookie": stateCookie(state) });
}
async function googleCallback(request, env, url) {
  const state = cookieValue(request, STATE_COOKIE);
  const returnedState = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!state || !returnedState || state !== returnedState || !code) return redirect(`${KABAR_ORIGIN}/?account=google-error#akun`, { "Set-Cookie": stateCookie("", 0) });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID || "", client_secret: env.GOOGLE_CLIENT_SECRET || "", redirect_uri: env.GOOGLE_REDIRECT_URI || "", grant_type: "authorization_code" })
  });
  const tokens = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokens.access_token) return redirect(`${KABAR_ORIGIN}/?account=google-error#akun`, { "Set-Cookie": stateCookie("", 0) });
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const profile = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !profile.email || profile.email_verified !== true || !profile.sub) return redirect(`${KABAR_ORIGIN}/?account=google-error#akun`, { "Set-Cookie": stateCookie("", 0) });
  const member = await ensureMember(env, profile.email, profile.name, "google", profile.sub);
  const session = await createMemberSession(env, member.id);
  return redirect(`${KABAR_ORIGIN}/?account=ready#akun`, { "Set-Cookie": [memberCookie(session), stateCookie("", 0)] });
}
async function adminSession(request, env) {
  const value = cookieValue(request, "qco_blog_admin");
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !env.SESSION_SECRET) return false;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const b64 = signature.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((signature.length + 3) % 4);
    const sig = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    if (!await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payload))) return false;
    const decoded = payload.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payload.length + 3) % 4);
    return JSON.parse(atob(decoded)).exp > Math.floor(Date.now() / 1000);
  } catch (_) { return false; }
}
async function fieldSubmission(request, env) {
  if (!env.DB) return response(request, { error: "Penyimpanan kiriman Suara Komunitas belum dikonfigurasi." }, 503);
  const member = await memberForRequest(request, env);
  if (!member) return response(request, { error: "Masuk dengan email atau Google untuk mengirim ke Suara Komunitas." }, 401);
  if (!member.profile_complete) return response(request, { error: "Lengkapi profil anggota sebelum mengirim tulisan." }, 403);
  if (env.CONTRIBUTOR_GATE_ENABLED === "true" && !await memberHasAccess(member, env)) return response(request, { error: "Hak mengirim ke Suara Komunitas belum aktif." }, 403);
  const body = await bodyJson(request);
  const title = String(body?.title || "").trim();
  const text = String(body?.text || "").trim();
  const choice = String(body?.publication_choice || "");
  const consent = body?.editing_consent === true;
  const rightsConfirmed = body?.rights_confirmed === true;
  if (title.length < 5 || title.length > 180 || text.length < 50 || text.length > MAX_SUBMISSION_CHARS) return response(request, { error: "Judul harus 5–180 karakter dan isi 50–20.000 karakter." }, 400);
  if (!["as_submitted", "editor_review"].includes(choice)) return response(request, { error: "Pilih cara penyuntingan naskah." }, 400);
  if (choice === "editor_review" && !consent) return response(request, { error: "Persetujuan penyuntingan diperlukan untuk pilihan dirapikan editor." }, 400);
  if (!rightsConfirmed) return response(request, { error: "Konfirmasi hak publikasi naskah diperlukan." }, 400);
  const submissionId = id();
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO field_submissions
      (id, member_id, title, author_display_name, original_text, publication_choice, editing_consent, consent_version, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-03-v1', 'pending_review', ?, ?)`)
      .bind(submissionId, member.id, title, member.display_name || body.author_display_name || "Pembaca Kabar Kopi", text, choice, consent ? 1 : 0, timestamp, timestamp),
    env.DB.prepare(`INSERT INTO field_submission_events (id, submission_id, actor_member_id, event_type, created_at)
      VALUES (?, ?, ?, 'submitted', ?)`)
      .bind(id(), submissionId, member.id, timestamp)
  ]);
  return response(request, { submitted: true, id: submissionId, status: "pending_review", message: "Kiriman masuk ke antrean editor." }, 201);
}
async function reviewSubmission(request, env, url) {
  if (!env.DB) return response(request, { error: "Penyimpanan moderasi belum dikonfigurasi." }, 503);
  if (!await adminSession(request, env)) return response(request, { error: "Sesi editor diperlukan." }, 401);
  const status = url.searchParams.get("status") || "pending_review";
  const rows = await env.DB.prepare(`SELECT s.id, s.title, s.author_display_name, s.original_text, s.publication_choice,
      s.editing_consent, s.status, s.editor_text, s.editor_note, s.created_at, m.email
    FROM field_submissions s JOIN members m ON m.id = s.member_id
    WHERE s.status = ? ORDER BY s.created_at ASC LIMIT 100`).bind(status).all();
  return response(request, { submissions: rows.results || [] });
}
async function updateSubmissionReview(request, env, idValue) {
  if (!env.DB) return response(request, { error: "Penyimpanan moderasi belum dikonfigurasi." }, 503);
  if (!await adminSession(request, env)) return response(request, { error: "Sesi editor diperlukan." }, 401);
  const body = await bodyJson(request);
  const action = String(body?.action || "");
  const allowed = ["revision_requested", "approved", "rejected", "published"];
  if (!allowed.includes(action)) return response(request, { error: "Keputusan editor tidak valid." }, 400);
  const record = await env.DB.prepare("SELECT * FROM field_submissions WHERE id = ?").bind(idValue).first();
  if (!record) return response(request, { error: "Kiriman tidak ditemukan." }, 404);
  const editorText = body?.editor_text == null ? record.editor_text : String(body.editor_text).trim();
  const note = body?.note == null ? record.editor_note : String(body.note).trim().slice(0, 2000);
  if (action === "published" && record.publication_choice === "editor_review" && !editorText) return response(request, { error: "Naskah hasil penyuntingan belum diisi." }, 400);
  const nextStatus = action === "revision_requested" ? "needs_revision" : action;
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE field_submissions SET status = ?, editor_text = ?, editor_note = ?, updated_at = ?,
      reviewed_at = ?, published_at = ? WHERE id = ?`)
      .bind(nextStatus, editorText, note, timestamp, timestamp, action === "published" ? timestamp : null, idValue),
    env.DB.prepare(`INSERT INTO field_submission_events (id, submission_id, event_type, note, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(id(), idValue, action, note || null, timestamp)
  ]);
  return response(request, { id: idValue, status: nextStatus, updated: true });
}
async function publicFieldPosts(request, env) {
  if (!env.DB) return response(request, { posts: [] });
  const rows = await env.DB.prepare(`SELECT id, title, author_display_name,
      CASE WHEN publication_choice = 'editor_review' THEN editor_text ELSE original_text END AS text,
      published_at
    FROM field_submissions WHERE status = 'published' ORDER BY published_at DESC LIMIT 50`).all();
  return response(request, { posts: rows.results || [] });
}
async function premiumArticle(request, env, slug) {
  if (!env.DB) return response(request, { error: "Artikel analisis belum tersedia." }, 503);
  const row = await env.DB.prepare(`SELECT id, slug, language, title, teaser, article_json, status, published_at
    FROM premium_articles WHERE slug = ? AND status = 'published'`).bind(slug).first();
  if (!row) return response(request, { error: "Artikel analisis tidak ditemukan." }, 404);
  const gated = env.PREMIUM_GATE_ENABLED === "true";
  const member = gated ? await memberForRequest(request, env) : null;
  const fullAccess = !gated || await memberHasAccess(member, env);
  const result = { id: row.id, slug: row.slug, language: row.language, title: row.title, teaser: row.teaser, published_at: row.published_at };
  if (fullAccess) result.article = JSON.parse(row.article_json);
  else result.access_required = true;
  return response(request, result);
}
async function premiumList(request, env) {
  if (!env.DB) return response(request, { articles: [] });
  const rows = await env.DB.prepare(`SELECT id, slug, language, title, teaser, published_at
    FROM premium_articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 100`).all();
  const gated = env.PREMIUM_GATE_ENABLED === "true";
  const member = gated ? await memberForRequest(request, env) : null;
  const fullAccess = !gated || await memberHasAccess(member, env);
  if (!fullAccess) return response(request, { articles: rows.results || [], access_required: true });
  const articles = await Promise.all((rows.results || []).map(async row => {
    const full = await env.DB.prepare("SELECT article_json FROM premium_articles WHERE id = ?").bind(row.id).first();
    return { ...row, article: JSON.parse(full.article_json) };
  }));
  return response(request, { articles });
}
async function syncPremium(request, env) {
  if (!env.DB || !env.MEVO_SYNC_SECRET) return response(request, { error: "Sinkronisasi artikel belum dikonfigurasi." }, 503);
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.MEVO_SYNC_SECRET}`) return response(request, { error: "Tidak diizinkan." }, 401);
  const doc = await bodyJson(request);
  if (!doc || !Array.isArray(doc.articles) || doc.articles.length > 100) return response(request, { error: "Format artikel tidak valid." }, 400);
  const timestamp = now();
  const statements = [];
  for (const item of doc.articles) {
    if (!item || !item.cluster_id || !item.article?.title || !item.article?.summary) continue;
    for (const language of ["id", "en"]) {
      const article = language === "en" ? item.article_en : item.article;
      if (!article?.title) continue;
      const storedArticle = {
        ...article,
        cluster_id: String(item.cluster_id),
        cluster_name: String(item.cluster_name || item.cluster_id),
        period_days: Number(item.period_days) || 14,
        generated_at: String(item.generated_at || doc.generated_at || timestamp),
        feed_fetched: String(doc.feed_fetched || ""),
        input_sources: Array.isArray(item.input_sources) ? item.input_sources : []
      };
      const slugBase = String(item.cluster_id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
      const slug = `${slugBase}-${language}`;
      const articleId = `${item.cluster_id}:${language}`;
      const teaser = String(article.summary || article.lead || "").slice(0, 700);
      statements.push(env.DB.prepare(`INSERT INTO premium_articles
        (id, slug, language, title, teaser, article_json, status, source_batch_id, generated_by, created_at, updated_at, published_at)
        VALUES (?, ?, ?, ?, ?, ?, 'published', ?, 'mevo-coffee-engine', ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET title=excluded.title, teaser=excluded.teaser,
        article_json=excluded.article_json, status='published', source_batch_id=excluded.source_batch_id,
        updated_at=excluded.updated_at, published_at=excluded.published_at`)
        .bind(articleId, slug, language, String(article.title).slice(0, 240), teaser, JSON.stringify(storedArticle), String(doc.generated_at || "").slice(0, 80), timestamp, timestamp, timestamp));
    }
  }
  if (!statements.length) return response(request, { synced: 0 });
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  return response(request, { synced: statements.length });
}

// Member-only MEVO reports are kept apart from the public editorial feed in
// mevo_member_reports. The MEVO pipeline uploads report payloads only; it does
// not collect or import news through this endpoint.
async function memberMevoReports(request, env, slug = "") {
  if (!env.DB) return response(request, { error: "Penyimpanan Report by MEVO belum dikonfigurasi." }, 503);
  const member = await memberForRequest(request, env);
  if (!member) return response(request, { error: "Masuk untuk membaca Report by MEVO." }, 401);
  if (!member.profile_complete) return response(request, { error: "Lengkapi profil anggota untuk membaca Report by MEVO." }, 403);
  if (slug) {
    const row = await env.DB.prepare(`SELECT slug, language, title, teaser, report_json, published_at
      FROM mevo_member_reports WHERE slug = ? AND status = 'published'`).bind(slug).first();
    if (!row) return response(request, { error: "Report by MEVO tidak ditemukan." }, 404);
    return response(request, { ...row, report: JSON.parse(row.report_json) });
  }
  const rows = await env.DB.prepare(`SELECT slug, language, title, teaser, report_json, published_at
    FROM mevo_member_reports WHERE status = 'published' ORDER BY published_at DESC LIMIT 100`).all();
  return response(request, { reports: (rows.results || []).map(row => ({
    ...row,
    report: JSON.parse(row.report_json)
  })) });
}

async function adminMevoReports(request, env) {
  if (!env.DB) return response(request, { error: "Penyimpanan Report by MEVO belum dikonfigurasi." }, 503);
  if (!await adminSession(request, env)) return response(request, { error: "Sesi admin diperlukan." }, 401);
  const rows = await env.DB.prepare(`SELECT id, slug, language, title, teaser, report_json, status,
    source_batch_id, generated_by, created_at, updated_at, published_at
    FROM mevo_member_reports ORDER BY updated_at DESC LIMIT 200`).all();
  return response(request, { reports: (rows.results || []).map(row => ({ ...row, report: JSON.parse(row.report_json) })) });
}

const MEVO_TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
const MAX_MEVO_TRANSLATION_CHARS = 100000;
const MEVO_LANGUAGE_WORDS = {
  id: new Set("yang dan di ke dari dengan untuk ini itu pada dalam adalah sebagai akan sudah belum oleh para tidak bisa dapat juga bahwa hanya hingga karena tetapi menjadi mereka kita kami anda kopi petani laporan setelah sebelum menunjukkan menilai sumber penelitian pengolahan nilai harga".split(" ")),
  en: new Set("the and of to in for from with this that is are was were by as has have will can but into their they we you coffee farmers report after before shows assess sources research processing value price".split(" "))
};

function mevoLanguageText(value, key = "") {
  if (typeof value === "string") return ["sources", "citations", "url", "href"].includes(key) ? "" : value;
  if (Array.isArray(value)) return value.map(item => mevoLanguageText(item)).join(" ");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value).map(([childKey, child]) => mevoLanguageText(child, childKey)).join(" ");
}

function detectMevoLanguage(text) {
  const tokens = String(text || "").toLowerCase().match(/[a-z]+/g) || [];
  if (tokens.length < 40) return null;
  let idScore = 0, enScore = 0;
  for (const token of tokens) {
    if (MEVO_LANGUAGE_WORDS.id.has(token)) idScore++;
    if (MEVO_LANGUAGE_WORDS.en.has(token)) enScore++;
  }
  if (idScore >= 6 && idScore >= enScore * 1.7) return "id";
  if (enScore >= 6 && enScore >= idScore * 1.7) return "en";
  return null;
}

async function translateMevoText(env, value, sourceLanguage, targetLanguage) {
  if (typeof value !== "string" || !value.trim()) return value;
  const protectedUrls = [];
  const protectedText = value.replace(/https?:\/\/[^\s<>)\]]+/gi, url => {
    const token = `MEVOURLTOKEN${protectedUrls.length}X`;
    protectedUrls.push(url);
    return token;
  });
  const sections = protectedText.split(/(\n\s*\n)/);
  const translatedSections = [];
  for (const section of sections) {
    if (!section.trim() || /^\n\s*\n$/.test(section)) {
      translatedSections.push(section);
      continue;
    }
    const chunks = [];
    let remaining = section;
    while (remaining.length > 1400) {
      let splitAt = remaining.lastIndexOf(" ", 1400);
      if (splitAt < 600) splitAt = 1400;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining) chunks.push(remaining);
    const translatedChunks = [];
    for (const chunk of chunks) {
      const result = await env.AI.run(MEVO_TRANSLATION_MODEL, {
        text: chunk,
        source_lang: sourceLanguage,
        target_lang: targetLanguage
      });
      const translated = String(result?.translated_text || "").trim();
      if (!translated) throw new Error("Model penerjemah tidak mengembalikan hasil.");
      translatedChunks.push(translated);
    }
    translatedSections.push(translatedChunks.join(" "));
  }
  let translatedText = translatedSections.join("");
  protectedUrls.forEach((url, index) => {
    translatedText = translatedText.replaceAll(`MEVOURLTOKEN${index}X`, url);
  });
  return translatedText;
}

async function translateMevoValue(env, value, sourceLanguage, targetLanguage) {
  if (typeof value === "string") return translateMevoText(env, value, sourceLanguage, targetLanguage);
  if (Array.isArray(value)) return Promise.all(value.map(item => translateMevoValue(env, item, sourceLanguage, targetLanguage)));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (["sources", "citations", "url", "href", "id", "slug", "source_batch_id", "generated_by", "created_at", "updated_at", "published_at", "period_start", "period_end", "machine_translated_from", "machine_translation_model"].includes(key)) {
      result[key] = item;
    } else {
      result[key] = await translateMevoValue(env, item, sourceLanguage, targetLanguage);
    }
  }
  return result;
}

async function translateMevoReport(env, item, targetLanguage) {
  if (!env.AI) throw new Error("Penerjemah otomatis belum tersedia pada Worker.");
  const sourceLanguage = item.language;
  const serializedLength = item.title.length + item.teaser.length + JSON.stringify(item.report).length;
  if (serializedLength > MAX_MEVO_TRANSLATION_CHARS) throw new Error("Report terlalu panjang untuk diterjemahkan otomatis. Pecah menjadi beberapa report atau terbitkan versi bahasa secara terpisah.");
  const translatedReport = await translateMevoValue(env, item.report, sourceLanguage, targetLanguage);
  translatedReport.machine_translated_from = sourceLanguage;
  translatedReport.machine_translation_model = MEVO_TRANSLATION_MODEL;
  const translatedTitle = await translateMevoText(env, item.title, sourceLanguage, targetLanguage);
  const translatedTeaser = await translateMevoText(env, item.teaser, sourceLanguage, targetLanguage);
  const stem = item.slug.replace(/-(id|en)$/i, "");
  return {
    slug: `${(stem || "report").slice(0, 113)}-${targetLanguage}`,
    language: targetLanguage,
    title: translatedTitle,
    teaser: translatedTeaser,
    report: translatedReport
  };
}

async function saveAdminMevoReport(request, env, idValue = "") {
  if (!env.DB) return response(request, { error: "Penyimpanan Report by MEVO belum dikonfigurasi." }, 503);
  if (!await adminSession(request, env)) return response(request, { error: "Sesi admin diperlukan." }, 401);
  const body = await bodyJson(request);
  const slug = String(body?.slug || "").trim().toLowerCase();
  const language = String(body?.language || "id");
  const title = String(body?.title || "").trim();
  const teaser = String(body?.teaser || "").trim();
  const status = String(body?.status || "draft");
  const report = body?.report;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return response(request, { error: "Slug report tidak valid." }, 400);
  if (!["id", "en"].includes(language) || !["draft", "published", "archived"].includes(status)) return response(request, { error: "Bahasa atau status report tidak valid." }, 400);
  if (!title || title.length > 240 || teaser.length > 1200 || !report || typeof report !== "object" || Array.isArray(report)) return response(request, { error: "Judul, cuplikan, dan isi report JSON wajib diisi dengan format yang benar." }, 400);
  const reportBody = typeof report.body === "string" ? report.body.trim() : "";
  const hasStructuredBody = Boolean(report.summary || report.lead || report.conclusion || (Array.isArray(report.sections) && report.sections.length) || (Array.isArray(report.recommendations) && report.recommendations.length));
  if (status === "published" && !reportBody && !hasStructuredBody) return response(request, { error: "Report belum dapat diterbitkan karena isi report masih kosong." }, 400);
  if (status === "published" && (!Array.isArray(report.sources) || !report.sources.length)) return response(request, { error: "Tambahkan minimal satu tautan sumber pada kolom sumber atau di dalam naskah sebelum menerbitkan." }, 400);
  const detectedLanguage = detectMevoLanguage(`${title} ${teaser} ${mevoLanguageText(report)}`);
  if (detectedLanguage && detectedLanguage !== language) return response(request, { error: `Isi naskah terdeteksi berbahasa ${detectedLanguage.toUpperCase()}, tetapi pilihan bahasa sumber adalah ${language.toUpperCase()}. Perbaiki pilihan bahasa agar pasangan terjemahan tidak tertukar.` }, 400);
  const timestamp = now();
  const current = idValue ? await env.DB.prepare("SELECT id, published_at, source_batch_id FROM mevo_member_reports WHERE id = ?").bind(idValue).first() : null;
  if (idValue && !current) return response(request, { error: "Report tidak ditemukan." }, 404);
  const reportId = current?.id || id();
  const item = { slug, language, title, teaser, report };
  let translated = null;
  let translatedCurrent = null;
  if (status === "published") {
    try {
      translated = await translateMevoReport(env, item, language === "id" ? "en" : "id");
    } catch (error) {
      console.error("MEVO report translation failed", error);
      return response(request, { error: `Report belum diterbitkan karena terjemahan otomatis gagal: ${error.message}` }, 502);
    }
    translatedCurrent = await env.DB.prepare("SELECT id, slug, language, title, teaser, report_json, published_at, status, generated_by FROM mevo_member_reports WHERE slug = ?").bind(translated.slug).first();
    // Repair a counterpart that was previously saved under the wrong language,
    // while preserving a valid editor-authored version in the target language.
    if (translatedCurrent && translatedCurrent.generated_by !== "admin-auto-translated") {
      let existingLanguage = null;
      try { existingLanguage = detectMevoLanguage(`${translatedCurrent.title} ${translatedCurrent.teaser} ${mevoLanguageText(JSON.parse(translatedCurrent.report_json))}`); } catch (_) { /* malformed content is regenerated instead of shown as a valid counterpart */ }
      if (existingLanguage === translated.language) {
        if (translatedCurrent.status === "published") translated = null;
        else return response(request, { error: `Versi ${translated.language.toUpperCase()} sudah ada sebagai draft. Periksa dan terbitkan draft tersebut terlebih dahulu.` }, 409);
      } else if (!existingLanguage) {
        if (translatedCurrent.status === "published") translated = null;
        else return response(request, { error: `Versi ${translated.language.toUpperCase()} sudah ada sebagai draft dan bahasanya belum dapat dipastikan. Periksa draft tersebut terlebih dahulu.` }, 409);
      }
    }
  }
  const statements = [env.DB.prepare(`INSERT INTO mevo_member_reports
    (id, slug, language, title, teaser, report_json, status, source_batch_id, generated_by, created_at, updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, language=excluded.language, title=excluded.title,
      teaser=excluded.teaser, report_json=excluded.report_json, status=excluded.status,
      updated_at=excluded.updated_at, published_at=excluded.published_at`)
    .bind(reportId, slug, language, title, teaser, JSON.stringify(report), status,
      String(body?.source_batch_id || current?.source_batch_id || "").slice(0, 120) || null, "admin", timestamp, timestamp,
      status === "published" ? (current?.published_at || timestamp) : null)];
  if (translated) {
    statements.push(env.DB.prepare(`INSERT INTO mevo_member_reports
      (id, slug, language, title, teaser, report_json, status, source_batch_id, generated_by, created_at, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, 'published', ?, 'admin-auto-translated', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, language=excluded.language, title=excluded.title,
        teaser=excluded.teaser, report_json=excluded.report_json, status='published',
        generated_by='admin-auto-translated', updated_at=excluded.updated_at, published_at=excluded.published_at`)
      .bind(translatedCurrent?.id || id(), translated.slug, translated.language, translated.title, translated.teaser,
        JSON.stringify(translated.report), String(body?.source_batch_id || current?.source_batch_id || "").slice(0, 120) || null,
        timestamp, timestamp, translatedCurrent?.published_at || timestamp));
  }
  await env.DB.batch(statements);
  return response(request, { id: reportId, slug, status, saved: true, translated_language: translated?.language || translatedCurrent?.language || null, translated_slug: translated?.slug || translatedCurrent?.slug || null, translation_preserved: Boolean(translatedCurrent && !translated) }, 200);
}

async function syncMevoReports(request, env) {
  if (!env.DB || !env.MEVO_SYNC_SECRET) return response(request, { error: "Sinkronisasi Report by MEVO belum dikonfigurasi." }, 503);
  if ((request.headers.get("Authorization") || "") !== `Bearer ${env.MEVO_SYNC_SECRET}`) return response(request, { error: "Tidak diizinkan." }, 401);
  const doc = await bodyJson(request);
  if (!doc || !Array.isArray(doc.reports) || doc.reports.length > 100) return response(request, { error: "Format report tidak valid." }, 400);
  const timestamp = now();
  const statements = [];
  for (const item of doc.reports) {
    const slug = String(item?.slug || item?.id || "").trim().toLowerCase();
    const language = String(item?.language || "id");
    const title = String(item?.title || "").trim();
    const report = item?.report;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !["id", "en"].includes(language) || !title || title.length > 240 || !report || typeof report !== "object" || Array.isArray(report)) continue;
    const idValue = `${slug}:${language}`;
    statements.push(env.DB.prepare(`INSERT INTO mevo_member_reports
      (id, slug, language, title, teaser, report_json, status, source_batch_id, generated_by, created_at, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, 'mevo-report-upload', ?, ?, NULL)
      ON CONFLICT(slug) DO UPDATE SET title=excluded.title, teaser=excluded.teaser, report_json=excluded.report_json,
        status='draft', published_at=NULL, source_batch_id=excluded.source_batch_id,
        generated_by=excluded.generated_by, updated_at=excluded.updated_at`)
      .bind(idValue, slug, language, title, String(item.teaser || "").slice(0, 1200), JSON.stringify(report),
        String(item.source_batch_id || doc.batch_id || "").slice(0, 120) || null, timestamp, timestamp));
  }
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  return response(request, { received: statements.length, status: "draft", message: "Report masuk sebagai draft. Admin perlu meninjau dan menerbitkannya." });
}

export async function handleKabarMemberRequest(request, env, url) {
  const path = url.pathname;
  if (path === "/api/member/auth/email" && request.method === "POST") return startEmailLogin(request, env);
  if (path === "/api/member/auth/verify" && request.method === "POST") return verifyEmailLogin(request, env);
  if (path === "/api/member/auth/verify-page" && request.method === "GET") {
    const token = url.searchParams.get("token") || "";
    return verifyLinkPage(token);
  }
  if (path === "/api/member/auth/google" && request.method === "GET") return googleAuthorize(request, env);
  if (path === "/api/member/auth/google/callback" && request.method === "GET") return googleCallback(request, env, url);
  if (path === "/api/member/session" && request.method === "GET") {
    const member = await memberForRequest(request, env);
    if (!member) return response(request, { authenticated: false });
    const membership = await env.DB.prepare("SELECT package_id, status, access_source, ends_at FROM memberships WHERE member_id = ?").bind(member.id).first();
    return response(request, { authenticated: true, profile_complete: Boolean(member.profile_complete), member, membership });
  }
  if (path === "/api/member/profile" && request.method === "POST") return completeMemberProfile(request, env);
  if (path === "/api/member/mevo-report-previews" && request.method === "GET") {
    if (!env.DB) return response(request, { reports: [] });
    const language = url.searchParams.get("language") === "en" ? "en" : "id";
    const rows = await env.DB.prepare(`SELECT slug, language, title, teaser, published_at
      FROM mevo_member_reports WHERE status = 'published' AND language = ?
      ORDER BY published_at DESC LIMIT 3`).bind(language).all();
    return response(request, { reports: rows.results || [] });
  }
  if (path === "/api/member/logout" && request.method === "POST") {
    const raw = cookieValue(request, MEMBER_COOKIE);
    if (raw && env.DB) await env.DB.prepare("UPDATE member_sessions SET revoked_at = ? WHERE token_hash = ?").bind(now(), await sha256(raw)).run();
    return response(request, { authenticated: false }, 200, { "Set-Cookie": memberCookie("", 0) });
  }
  if (path === "/api/field-submissions" && request.method === "POST") return fieldSubmission(request, env);
  if (path === "/api/field-posts" && request.method === "GET") return publicFieldPosts(request, env);
  if (path === "/api/admin/field-submissions" && request.method === "GET") return reviewSubmission(request, env, url);
  const reviewMatch = path.match(/^\/api\/admin\/field-submissions\/([a-f0-9-]+)$/);
  if (reviewMatch && request.method === "POST") return updateSubmissionReview(request, env, reviewMatch[1]);
  if (path === "/api/premium/articles" && request.method === "GET") return premiumList(request, env);
  const premiumMatch = path.match(/^\/api\/premium\/articles\/([a-z0-9-]+)$/);
  if (premiumMatch && request.method === "GET") return premiumArticle(request, env, premiumMatch[1]);
  if (path === "/api/admin/premium/sync" && request.method === "POST") return syncPremium(request, env);
  if (path === "/api/member/mevo-reports" && request.method === "GET") return memberMevoReports(request, env);
  const memberMevoMatch = path.match(/^\/api\/member\/mevo-reports\/([a-z0-9-]+)$/);
  if (memberMevoMatch && request.method === "GET") return memberMevoReports(request, env, memberMevoMatch[1]);
  if (path === "/api/admin/mevo-reports" && request.method === "GET") return adminMevoReports(request, env);
  if (path === "/api/admin/mevo-reports" && request.method === "POST") return saveAdminMevoReport(request, env);
  const adminMevoMatch = path.match(/^\/api\/admin\/mevo-reports\/([a-f0-9-]+)$/);
  if (adminMevoMatch && request.method === "POST") return saveAdminMevoReport(request, env, adminMevoMatch[1]);
  if (path === "/api/admin/mevo-reports/sync" && request.method === "POST") return syncMevoReports(request, env);
  return null;
}
