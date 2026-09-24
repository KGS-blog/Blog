// QCO Data Pipeline — fetch.js — v2026.09.24-1
// Sumber: ICE coffee via stooq (tanpa key) | USD/IDR via frankfurter (tanpa key) | BPS ekspor HS0901 (key)
// Usage:
//   node scripts/fetch.js            -> fetch semua, tulis ke data/*.json
//   node scripts/fetch.js discover kopi -> cari tabel BPS berkeyword (explorasi)
// Secret: BPS_API_KEY di GitHub Secrets. Tanpa key, sumber BPS dilewati (tidak gagal total).

const fs = require("fs");
const path = require("path");

const BPS_KEY = process.env.BPS_API_KEY || "";
const OUT = path.join(__dirname, "..", "data");
fs.mkdirSync(OUT, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const YEAR = process.env.FETCH_YEAR || String(new Date().getFullYear());

const REPO_RAW = "https://raw.githubusercontent.com/OWNER/Update-Coffee-Data/main/data"; // ganti OWNER

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "qco-data-pipeline" } });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return r.text();
}
async function getJSON(url) {
  return JSON.parse(await getText(url));
}
function save(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify({ ...obj, fetched: today }, null, 2));
  console.log("saved data/" + name);
}

// ---- mode discover: node fetch.js discover <keyword> ----
if (process.argv[2] === "discover") {
  const kw = encodeURIComponent(process.argv[3] || "kopi");
  if (!BPS_KEY) { console.error("BPS_API_KEY belum di-set"); process.exit(1); }
  const url = `https://webapi.bps.go.id/v1/api/list/model/var/lang/ind/domain/0000/keyword/${kw}/th/${YEAR}/key/${BPS_KEY}`;
  getJSON(url)
    .then(j => { save("_discover-" + (process.argv[3] || "kopi") + ".json", j); })
    .catch(e => { console.error("DISCOVER ERROR:", e.message); process.exit(1); });
  return;
}

(async () => {
  const errors = {};

  // 1) Harga futures kopi Arabica ICE (stooq, tanpa key) — KC.F, US cents/lb
  try {
    const csv = await getText("https://stooq.com/q/l/?s=kc.f&f=sd2t2ohlcv&h&e=csv");
    const lines = csv.trim().split(/\r?\n/);
    const v = lines[1].split(",");
    save("ice.json", {
      source: "stooq KC.F — ICE Arabica futures, US cents/lb",
      symbol: v[0], date: v[1], time: v[2],
      open: v[3], high: v[4], low: v[5], close: v[6], volume: v[7]
    });
  } catch (e) { errors.ice = e.message; }

  // 2) Kurs USD/IDR (frankfurter, tanpa key — referensi ECB)
  try {
    const j = await getJSON("https://api.frankfurter.app/latest?from=USD&to=IDR");
    save("kurs.json", { source: "frankfurter.app (ECB reference rate)", rate: j.rates.IDR, date: j.date });
  } catch (e) { errors.kurs = e.message; }

  // 3) BPS: ekspor kopi HS 0901, tahun berjalan (butuh key)
  if (BPS_KEY) {
    try {
      const j = await getJSON(`https://webapi.bps.go.id/v1/api/dataexim/sumber/1/kodehs/0901/th/${YEAR}/key/${BPS_KEY}`);
      save("ekspor.json", j);
    } catch (e) { errors.ekspor = e.message; }
  } else {
    errors.ekspor = "BPS_API_KEY tidak di-set (lewati)";
  }

  console.log(JSON.stringify({ date: today, errors }, null, 2));
  process.exit(Object.keys(errors).length ? 1 : 0);
})();
