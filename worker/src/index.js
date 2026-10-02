const SESSION_COOKIE = "qco_blog_admin";
const SESSION_SECONDS = 4 * 60 * 60;
const MAX_ARTICLES_BYTES = 900_000;
const API_BASE = "https://api.github.com/repos";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (origin !== "https://blog.qcoid.com") return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}
function json(data, status = 200, extraHeaders = {}, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(request ? corsHeaders(request) : {}), ...extraHeaders }
  });
}
function base64UrlEncode(bytes) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(base64);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function createSession(secret) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload)));
  return payload + "." + base64UrlEncode(signature);
}
async function validSession(request, secret) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.split(";").map(x => x.trim()).find(x => x.startsWith(SESSION_COOKIE + "="));
  if (!match) return false;
  const token = match.slice(SESSION_COOKIE.length + 1);
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  try {
    const verified = await crypto.subtle.verify("HMAC", await hmacKey(secret), base64UrlDecode(signature), new TextEncoder().encode(payload));
    if (!verified) return false;
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))).exp > Math.floor(Date.now() / 1000);
  } catch (_) { return false; }
}
function cookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;
}
function githubHeaders(env) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "qco-blog-article-sync"
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}
function githubFileUrl(env) {
  return `${API_BASE}/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_FILE}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;
}
async function readArticles(env) {
  const response = await fetch(githubFileUrl(env), { headers: githubHeaders(env), cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub read failed (${response.status})`);
  const file = await response.json();
  const compact = String(file.content || "").replace(/\s/g, "");
  const binary = Uint8Array.from(atob(compact), c => c.charCodeAt(0));
  return { data: JSON.parse(new TextDecoder().decode(binary)), sha: file.sha };
}
function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
async function writeArticles(env, document, sha) {
  const response = await fetch(githubFileUrl(env).split("?")[0], {
    method: "PUT",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Update articles from blog admin",
      content: encodeBase64Utf8(JSON.stringify(document, null, 2) + "\n"),
      sha,
      branch: env.GITHUB_BRANCH
    })
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 409 || response.status === 422) return { conflict: true };
  if (!response.ok) throw new Error(`GitHub write failed (${response.status})`);
  return { conflict: false, sha: body.content && body.content.sha };
}
async function constantTimePasswordMatch(input, expected) {
  const [actual, target] = await Promise.all([input, expected].map(x => crypto.subtle.digest("SHA-256", new TextEncoder().encode(x))));
  const a = new Uint8Array(actual), b = new Uint8Array(target);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function validArticleDocument(value) {
  if (!value || !Array.isArray(value.articles) || value.articles.length > 500) return false;
  const ids = new Set();
  for (const article of value.articles) {
    if (!article || !Number.isFinite(Number(article.id)) || !String(article.title_id || "").trim() || !String(article.title_en || "").trim()) return false;
    const id = String(article.id);
    if (ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      const headers = corsHeaders(request);
      if (!headers["Access-Control-Allow-Origin"]) return json({ error: "Origin tidak diizinkan." }, 403, {}, request);
      return new Response(null, { status: 204, headers });
    }
    if (url.pathname === "/api/articles" && request.method === "GET") {
      try {
        const current = await readArticles(env);
        return json({ ...current.data, sha: current.sha }, 200, {}, request);
      } catch (error) {
        return json({ error: "Gagal membaca artikel bersama." }, 502, {}, request);
      }
    }

    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const authenticated = await validSession(request, env.SESSION_SECRET || "");
      return json({ authenticated }, 200, {}, request);
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (request.headers.get("Origin") !== "https://blog.qcoid.com") return json({ error: "Permintaan tidak diizinkan." }, 403, {}, request);
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ error: "Login backend belum dikonfigurasi." }, 503, {}, request);
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: "Format permintaan tidak valid." }, 400, {}, request); }
      if (!await constantTimePasswordMatch(String(body.password || ""), env.ADMIN_PASSWORD)) return json({ error: "Kata sandi salah." }, 401, {}, request);
      return json({ authenticated: true }, 200, { "Set-Cookie": cookie(await createSession(env.SESSION_SECRET), SESSION_SECONDS) }, request);
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      if (request.headers.get("Origin") !== "https://blog.qcoid.com") return json({ error: "Permintaan tidak diizinkan." }, 403, {}, request);
      return json({ authenticated: false }, 200, { "Set-Cookie": cookie("", 0) }, request);
    }

    if (url.pathname === "/api/articles" && request.method === "PUT") {
      if (request.headers.get("Origin") !== "https://blog.qcoid.com") return json({ error: "Permintaan tidak diizinkan." }, 403, {}, request);
      if (!env.GITHUB_TOKEN) return json({ error: "Penyimpanan backend belum dikonfigurasi." }, 503, {}, request);
      if (!await validSession(request, env.SESSION_SECRET || "")) return json({ error: "Sesi admin berakhir. Silakan masuk kembali." }, 401, {}, request);
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: "Format permintaan tidak valid." }, 400, {}, request); }
      if (!validArticleDocument(body) || !body.sha) return json({ error: "Data artikel tidak valid atau versi dasar tidak tersedia." }, 400, {}, request);
      const document = { version: Number(body.version) || 1, lastUpdated: new Date().toISOString(), articles: body.articles };
      const serialized = JSON.stringify(document, null, 2) + "\n";
      if (new TextEncoder().encode(serialized).byteLength > MAX_ARTICLES_BYTES) return json({ error: "Ukuran artikel terlalu besar untuk disimpan." }, 413, {}, request);
      try {
        const latest = await readArticles(env);
        if (latest.sha !== body.sha) return json({ error: "Artikel berubah di perangkat lain. Muat ulang sebelum menyimpan.", conflict: true }, 409, {}, request);
        const result = await writeArticles(env, document, latest.sha);
        if (result.conflict) return json({ error: "Artikel berubah di perangkat lain. Muat ulang sebelum menyimpan.", conflict: true }, 409, {}, request);
        return json({ ...document, sha: result.sha }, 200, {}, request);
      } catch (error) {
        return json({ error: "Artikel gagal disimpan ke repo. Coba lagi." }, 502, {}, request);
      }
    }

    return json({ error: "Endpoint tidak ditemukan." }, 404, {}, request);
  }
};
