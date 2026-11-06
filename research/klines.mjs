/* =====================================================================
   مخزن بيانات البحث — شموع Binance USDT-M التاريخية + التمويل.

   البيانات عامة (بلا مفاتيح). تُخزَّن في data/research/ (خارج git).
   كل ملف: مصفوفة [t, o, h, l, c, v, quoteV, takerBuyV] بالترتيب الزمني.

   التشغيل:
     node research/klines.mjs universe 30            # يختار أعلى 30 عقداً سيولةً
     node research/klines.mjs fetch 5m 400           # 400 يوم من شموع 5د للكون المختار
     node research/klines.mjs funding 400
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DIR = path.join(ROOT, "data", "research");
fs.mkdirSync(DIR, { recursive: true });
const FAPI = "https://fapi.binance.com";
const SPAN = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3 };

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastReq = 0;
/* ~3 طلبات/ث × وزن 5 = 900 وزن/د — نصف حدّ 2400 تقريباً، فلا يتأثّر خادم المنصّة الحيّ */
async function get(p, q) {
  const wait = lastReq + 330 - Date.now();
  if (wait > 0) await sleep(wait);
  lastReq = Date.now();
  const url = FAPI + p + "?" + new URLSearchParams(q);
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status === 418) { await sleep(60000); continue; }
      if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 120));
      return await r.json();
    } catch (e) { if (a === 5) throw e; await sleep(2000 * (a + 1)); }
  }
}

export const file = (sym, tf) => path.join(DIR, `${sym}_${tf}.json`);
export function load(sym, tf) {
  const f = file(sym, tf);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
}
export function universe() {
  const f = path.join(DIR, "universe.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
}

/* أعلى العقود سيولةً، مع شرط تاريخٍ كافٍ (أُدرج قبل سنة على الأقل) */
async function pickUniverse(n) {
  const info = await get("/fapi/v1/exchangeInfo", {});
  const perp = new Map(info.symbols.filter(s => s.contractType === "PERPETUAL" && s.quoteAsset === "USDT" && s.status === "TRADING")
    .map(s => [s.symbol, s.onboardDate]));
  const t = await get("/fapi/v1/ticker/24hr", {});
  const yearAgo = Date.now() - 400 * 86400e3;
  const list = t.filter(x => perp.has(x.symbol) && perp.get(x.symbol) < yearAgo)
    .sort((a, b) => +b.quoteVolume - +a.quoteVolume).slice(0, n).map(x => x.symbol);
  if (!list.includes("BTCUSDT")) list.unshift("BTCUSDT");
  fs.writeFileSync(path.join(DIR, "universe.json"), JSON.stringify(list));
  console.log(list.join(","));
}

/* يُكمل الملف من آخر شمعة محفوظة؛ لا يعيد تنزيل الموجود */
export async function fetchRange(sym, tf, startMs, endMs = Date.now()) {
  const have = load(sym, tf);
  let from = have.length ? have[have.length - 1][0] + SPAN[tf] : startMs;
  const out = have;
  while (from < endMs - SPAN[tf]) {
    const rows = await get("/fapi/v1/klines", { symbol: sym, interval: tf, startTime: from, limit: 1000 });
    if (!rows.length) break;
    for (const k of rows) if (k[6] < Date.now()) out.push([k[0], +k[1], +k[2], +k[3], +k[4], +k[5], +k[7], +k[9]]);
    from = rows[rows.length - 1][0] + SPAN[tf];
    if (rows.length < 1000) break;
  }
  fs.writeFileSync(file(sym, tf), JSON.stringify(out));
  return out;
}

async function fetchFunding(sym, startMs) {
  const f = path.join(DIR, `${sym}_funding.json`);
  const out = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
  let from = out.length ? out[out.length - 1][0] + 1 : startMs;
  for (;;) {
    const rows = await get("/fapi/v1/fundingRate", { symbol: sym, startTime: from, limit: 1000 });
    if (!rows.length) break;
    for (const r of rows) out.push([r.fundingTime, +r.fundingRate]);
    from = rows[rows.length - 1].fundingTime + 1;
    if (rows.length < 1000) break;
  }
  fs.writeFileSync(f, JSON.stringify(out));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "universe") await pickUniverse(Number(a || 30));
  else if (cmd === "fetch") {
    const start = Date.now() - Number(b || 400) * 86400e3;
    for (const s of universe()) {
      const rows = await fetchRange(s, a, start);
      console.log(new Date().toISOString(), s, a, rows.length);
    }
  } else if (cmd === "funding") {
    const start = Date.now() - Number(a || 400) * 86400e3;
    for (const s of universe()) { await fetchFunding(s, start); console.log("funding", s); }
  } else console.log("usage: universe N | fetch TF DAYS | funding DAYS");
}
