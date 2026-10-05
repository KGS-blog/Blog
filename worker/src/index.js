import { handleKabarMemberRequest } from "./kabar-members.js";

const SESSION_COOKIE = "qco_blog_admin";
const SESSION_SECONDS = 4 * 60 * 60;
const MAX_ARTICLES_BYTES = 900_000;
const API_BASE = "https://api.github.com/repos";
const ALLOWED_ORIGINS = new Set(["https://blog.qcoid.com", "https://kgs-blog.github.io", "https://kabarkopi.qcoid.com"]);
const CLUSTER_DECISIONS_FILE = "kabar-kopi-cluster-decisions.json";
const CLUSTER_CANDIDATES_KEY = "cluster-candidates-v1";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (!ALLOWED_ORIGINS.has(origin)) return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  const authorization = request.headers.get("Authorization") || "";
  let token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    const cookies = request.headers.get("Cookie") || "";
    const match = cookies.split(";").map(x => x.trim()).find(x => x.startsWith(SESSION_COOKIE + "="));
    if (!match) return false;
    token = match.slice(SESSION_COOKIE.length + 1);
  }
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
  return `${API_BASE}/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURIComponent(env.GITHUB_FILE)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;
}
async function readGithubJson(env, fileName) {
  const response = await fetch(githubFileUrl({ ...env, GITHUB_FILE: fileName }), { headers: githubHeaders(env), cache: "no-store" });
  if (response.status === 404) return { data: null, sha: null };
  if (!response.ok) throw new Error(`GitHub read failed (${response.status})`);
  const file = await response.json();
  const compact = String(file.content || "").replace(/\s/g, "");
  const binary = Uint8Array.from(atob(compact), c => c.charCodeAt(0));
  return { data: JSON.parse(new TextDecoder().decode(binary)), sha: file.sha };
}
async function readArticles(env) { return readGithubJson(env, env.GITHUB_FILE); }
function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
async function writeGithubJson(env, fileName, document, sha, message) {
  const response = await fetch(githubFileUrl({ ...env, GITHUB_FILE: fileName }).split("?")[0], {
    method: "PUT",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: encodeBase64Utf8(JSON.stringify(document, null, 2) + "\n"),
      ...(sha ? { sha } : {}),
      branch: env.GITHUB_BRANCH
    })
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 409 || response.status === 422) return { conflict: true };
  if (!response.ok) throw new Error(`GitHub write failed (${response.status})`);
  return { conflict: false, sha: body.content && body.content.sha };
}
async function writeArticles(env, document, sha) {
  return writeGithubJson(env, env.GITHUB_FILE, document, sha, "Update articles from blog admin");
}
async function readClusterCandidates() {
  const row = await this.DB.prepare("SELECT document_json FROM kabar_workflow_documents WHERE document_key = ?").bind(CLUSTER_CANDIDATES_KEY).first();
  return row ? JSON.parse(row.document_json) : { version: 1, candidates: [], needs_seed: true };
}
async function saveClusterCandidates(db, document) {
  await db.prepare("INSERT INTO kabar_workflow_documents (document_key, document_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(document_key) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at")
    .bind(CLUSTER_CANDIDATES_KEY, JSON.stringify(document), new Date().toISOString()).run();
}
function validCandidateDocument(value) {
  if (!value || !Array.isArray(value.candidates) || value.candidates.length > 1000) return false;
  if (value.unassigned_articles !== undefined && (!Array.isArray(value.unassigned_articles) || value.unassigned_articles.length > 500)) return false;
  return (value.unassigned_articles || []).every(article => article && typeof article.url === "string" && /^https?:\/\//i.test(article.url) && typeof article.title === "string");
}
async function matchesSecret(input, expected) {
  if (!input || !expected) return false;
  const [actual, target] = await Promise.all([input, expected].map(x => crypto.subtle.digest("SHA-256", new TextEncoder().encode(x))));
  const a = new Uint8Array(actual), b = new Uint8Array(target); let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function validDecisionDocument(value) {
  return value && Array.isArray(value.accepted_candidate_ids) && Array.isArray(value.rejected_candidate_ids);
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
    if (url.pathname === "/api/internal/cluster-candidates" && ["GET", "PUT"].includes(request.method)) {
      const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (!await matchesSecret(bearer, env.MEVO_SYNC_SECRET || "")) return json({ error: "Akses sinkronisasi ditolak." }, 401);
      try {
        if (request.method === "GET") return json(await readClusterCandidates.call(env));
        const document = await request.json();
        if (!validCandidateDocument(document)) return json({ error: "Dokumen kandidat tidak valid." }, 400);
        await saveClusterCandidates(env.DB, document);
        return json({ saved: true, updated_at: new Date().toISOString() });
      } catch (error) {
        console.error("Cluster candidate D1 request failed", error);
        return json({ error: "Penyimpanan kandidat klaster belum siap. Periksa migrasi database." }, 503);
      }
    }
    if (url.pathname === "/api/articles" && request.method === "GET") {
      try {
        const current = await readArticles(env);
        return json({ ...current.data, sha: current.sha }, 200, {}, request);
      } catch (error) {
        return json({ error: "Gagal membaca artikel bersama." }, 502, {}, request);
      }
    }

    if (url.pathname === "/api/cluster-decisions" && request.method === "GET") {
      try {
        const current = await readGithubJson(env, CLUSTER_DECISIONS_FILE);
        return json({ ...(current.data || { version: 1, accepted_candidate_ids: [], rejected_candidate_ids: [] }), sha: current.sha }, 200, {}, request);
      } catch (_) {
        return json({ error: "Gagal membaca keputusan klaster." }, 502, {}, request);
      }
    }

    if (url.pathname === "/api/cluster-candidates" && request.method === "GET") {
      if (!await validSession(request, env.SESSION_SECRET || "")) return json({ error: "Masuk sebagai admin untuk meninjau klaster." }, 401, {}, request);
      try {
        const candidates = await readClusterCandidates.call(env);
        return json(candidates, 200, {}, request);
      } catch (_) {
        return json({ error: "Kandidat klaster belum dapat dimuat." }, 502, {}, request);
      }
    }

    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const authenticated = await validSession(request, env.SESSION_SECRET || "");
      return json({ authenticated }, 200, {}, request);
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (!ALLOWED_ORIGINS.has(request.headers.get("Origin"))) return json({ error: "Permintaan tidak diizinkan." }, 403, {}, request);
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ error: "Login backend belum dikonfigurasi." }, 503, {}, request);
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: "Format permintaan tidak valid." }, 400, {}, request); }
      if (!await constantTimePasswordMatch(String(body.password || ""), env.ADMIN_PASSWORD)) return json({ error: "Kata sandi salah." }, 401, {}, request);
      const session = await createSession(env.SESSION_SECRET);
      const responseBody = request.headers.get("Origin") === "https://kgs-blog.github.io" ? { authenticated: true, session } : { authenticated: true };
      return json(responseBody, 200, { "Set-Cookie": cookie(session, SESSION_SECONDS) }, request);
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      if (!ALLOWED_ORIGINS.has(request.headers.get("Origin"))) return json({ error: "Permintaan tidak diizinkan." }, 403, {}, request);
      return json({ authenticated: false }, 200, { "Set-Cookie": cookie("", 0) }, request);
    }

    if (url.pathname === "/api/cluster-decisions" && request.method === "PUT") {
      if (!new Set(["https://blog.qcoid.com", "https://kgs-blog.github.io"]).has(request.headers.get("Origin"))) return json({ error: "Permintaan tidak diizinkan." }, 403, {}, request);
      if (!env.GITHUB_TOKEN) return json({ error: "Penyimpanan backend belum dikonfigurasi." }, 503, {}, request);
      if (!await validSession(request, env.SESSION_SECRET || "")) return json({ error: "Sesi editor berakhir. Silakan masuk kembali." }, 401, {}, request);
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: "Format permintaan tidak valid." }, 400, {}, request); }
      const candidateId = String(body.candidate_id || "");
      const decision = String(body.decision || "");
      const articleUrl = String(body.article_url || "");
      const clusterId = String(body.cluster_id || "");
      const articleDecision = Boolean(articleUrl);
      if (articleDecision) {
        let parsed;
        try { parsed = new URL(articleUrl); } catch (_) { return json({ error: "URL berita tidak valid." }, 400, {}, request); }
        if (!/^https?:$/.test(parsed.protocol) || !clusterId) return json({ error: "Pilih salah satu klaster yang tersedia." }, 400, {}, request);
      } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidateId) || !["accepted", "rejected"].includes(decision)) {
        return json({ error: "Keputusan kandidat klaster tidak valid." }, 400, {}, request);
      }
      try {
        const candidates = await readClusterCandidates.call(env);
        const knownClusters = new Set(["lainnya", "harga-pasar", "produksi-panen", "kebijakan-regulasi", "event-kompetisi", "barista-teknik-seduh", "riset-tren-konsumen", "kedai-konsumsi-gaya-hidup", "ekspor-daya-saing", "pendidikan-industri", "brand-global"]);
        for (const candidate of candidates.candidates || []) if (candidate.status === "accepted") knownClusters.add(candidate.id);
        if (articleDecision && !knownClusters.has(clusterId)) return json({ error: "Pilih salah satu klaster yang tersedia." }, 400, {}, request);
        if (articleDecision && !(candidates.unassigned_articles || []).some(article => article.url === articleUrl)) {
          return json({ error: "Artikel tidak ditemukan di antrean Lainnya. Muat ulang halaman." }, 404, {}, request);
        }
        if (!articleDecision && !(candidates.candidates || []).some(candidate => candidate.id === candidateId)) {
          return json({ error: "Kandidat ini sudah tidak tersedia. Muat ulang halaman." }, 404, {}, request);
        }
        const latest = await readGithubJson(env, CLUSTER_DECISIONS_FILE);
        const document = latest.data || { version: 1, accepted_candidate_ids: [], rejected_candidate_ids: [] };
        if (!validDecisionDocument(document)) return json({ error: "Format keputusan klaster tidak valid." }, 502, {}, request);
        if (articleDecision) {
          const overrides = Array.isArray(document.overrides) ? document.overrides : [];
          document.overrides = [...overrides.filter(item => String(item.url || item.tautan || "") !== articleUrl), { url: articleUrl, cluster_id: clusterId, decided_at: new Date().toISOString() }];
        } else {
          document.accepted_candidate_ids = document.accepted_candidate_ids.filter(id => id !== candidateId);
          document.rejected_candidate_ids = document.rejected_candidate_ids.filter(id => id !== candidateId);
          document[decision === "accepted" ? "accepted_candidate_ids" : "rejected_candidate_ids"].push(candidateId);
        }
        document.version = 1;
        document.updated_at = new Date().toISOString();
        const result = await writeGithubJson(env, CLUSTER_DECISIONS_FILE, document, latest.sha, articleDecision ? `Classify coffee news: ${clusterId}` : `Review coffee cluster: ${decision}`);
        if (result.conflict) return json({ error: "Keputusan lain baru saja tersimpan. Muat ulang halaman dan coba lagi.", conflict: true }, 409, {}, request);
        if (articleDecision) {
          try {
            await saveClusterCandidates(env.DB, {
              ...candidates,
              unassigned_articles: (candidates.unassigned_articles || []).filter(article => article.url !== articleUrl)
            });
          } catch (queueError) {
            console.error("Editor decision saved, but private review queue refresh failed", queueError);
          }
        }
        return json({ ...document, sha: result.sha }, 200, {}, request);
      } catch (_) {
        return json({ error: "Keputusan gagal disimpan. Coba lagi." }, 502, {}, request);
      }
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

    try {
      const kabarResponse = await handleKabarMemberRequest(request, env, url);
      if (kabarResponse) return kabarResponse;
    } catch (error) {
      console.error("Kabar member API failed", error);
      return json({ error: "Layanan Kabar Kopi sedang bermasalah. Coba lagi nanti." }, 500, {}, request);
    }

    return json({ error: "Endpoint tidak ditemukan." }, 404, {}, request);
  }
};
