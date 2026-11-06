/* =====================================================================
   تدقيق الفرص المسجّلة — إعادة متابعة عيّنةٍ عشوائية من الفرص المنتهية
   بشموع الدقيقة الفعلية من Binance، بقواعد موحّدة موثّقة:

   1. الدخول = سعر الإصدار المسجّل (السوق: ask للشراء / bid للبيع). كل فرص
      هذا المحرّك تُدخل فوراً، فلا توجد حالة «لم تتفعل».
   2. تبدأ المتابعة من أول دقيقةٍ كاملة بعد الإصدار؛ ما قبل الإصدار لا يُحتسب.
   3. داخل الدقيقة الواحدة: الوقف أولاً إن ظهر مع الهدف (افتراضٌ محافظ).
   4. الوقف يُنفَّذ عند مستواه (أو أفضل سعرٍ بعد فجوة) + انزلاق مضاعف.
   5. الأهداف تُنفَّذ عند مستواها، والوقف إلى الدخول بعد الهدف الأول.
   6. الانتهاء عند expiresAt المسجّل بسعر إغلاق تلك الدقيقة.
   7. التكاليف: النموذج المسجّل في كل فرصة (رسوم + انزلاق + نصف السبريد).

   لا يعدّل قاعدة البيانات (تُفتح للقراءة من النسخة الاحتياطية).
   التشغيل: node research/audit-live.mjs <db> [حجم العيّنة لكل سوق]
   ===================================================================== */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initTrack, applyUpdate } from "../server/tracker.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "research");
const dbPath = process.argv[2];
const N = Number(process.argv[3] || 800);
const HOST = { SPOT: "https://api.binance.com/api/v3/klines", FUTURES: "https://fapi.binance.com/fapi/v1/klines" };

const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
async function klines(market, symbol, startTime) {
  const w = last + 300 - Date.now(); if (w > 0) await sleep(w); last = Date.now();
  const url = HOST[market] + "?" + new URLSearchParams({ symbol, interval: "1m", startTime, limit: 1000 });
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status === 418) { await sleep(60000); continue; }
      if (r.status === 400) return null;                     // رمزٌ أُزيل من المنصّة
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()).map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], ct: k[6] }));
    } catch (e) { if (a === 4) throw e; await sleep(2000 * (a + 1)); }
  }
}

/* عيّنة عشوائية ثابتة البذرة (قابلة للإعادة) */
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function sample(arr, n, seed) { const r = rng(seed), a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }

const db = new DatabaseSync(dbPath, { readOnly: true });
const all = db.prepare(`select id, market, symbol, side, status, r_net, issued_at, closed_at, data from opportunities
  where market in ('SPOT','FUTURES') and status in ('sl','tp3','tp_sl','expired','cancelled')`).all();
const picks = [...sample(all.filter(r => r.market === "FUTURES"), N, 7), ...sample(all.filter(r => r.market === "SPOT"), Math.round(N / 2), 11)];

const results = [];
let i = 0;
for (const o of picks) {
  i++;
  const d = JSON.parse(o.data), s = d.track;
  if (!s) continue;
  const st = initTrack({
    side: s.side, entry: s.entry, stop: s.stop0, targets: s.targets, issuedAt: s.issuedAt, expiresAt: s.expiresAt,
    emitCandleT: -1, sma200: s.sma200, seenHi: s.entry, seenLo: s.entry,
    plan: { tpSplit: s.legs.map(l => l.w), breakevenAfterTp1: s.breakeven, cancelOnSmaClose: s.cancelOnSmaClose },
    feePct: s.feePct, halfSpreadPct: s.halfSpreadPct, costs: s.costs, market: o.market
  });
  let from = Math.floor(s.issuedAt / 60e3) * 60e3 + 60e3, ok = true, mfeR = 0, maeR = 0;
  const dir = s.side === "BUY" ? 1 : -1, risk = Math.abs(s.entry - s.stop0);
  outer: while (from < s.expiresAt + 60e3) {
    const ks = await klines(o.market, o.symbol, from);
    if (!ks) { ok = false; break; }
    if (!ks.length) break;
    for (const k of ks) {
      if (k.ct > Date.now()) break outer;
      /* أقصى حركة لصالح الصفقة وضدّها قبل الإغلاق (بوحدات R) */
      mfeR = Math.max(mfeR, ((dir > 0 ? k.h : k.l) - s.entry) * dir / risk);
      maeR = Math.min(maeR, ((dir > 0 ? k.l : k.h) - s.entry) * dir / risk);
      const ts = Math.min(k.ct, Math.max(k.t, s.expiresAt));
      applyUpdate(st, { ts: k.ct >= s.expiresAt ? s.expiresAt : k.ct, price: k.c, candleT: k.t, cumHi: k.h, cumLo: k.l,
        closedCandle: (k.t + 60e3) % 900e3 === 0 ? { c: k.c } : undefined });
      if (["sl", "tp3", "tp_sl", "expired", "cancelled"].includes(st.status)) break outer;
      void ts;
    }
    from = ks[ks.length - 1].t + 60e3;
    if (ks.length < 1000) break;
  }
  if (!ok || !st.final) continue;
  results.push({ id: o.id, market: o.market, symbol: o.symbol, side: o.side, recorded: o.status, recR: o.r_net,
    audited: st.status, audR: st.final.rNet, tpsHit: st.tpsHit, mfeR, maeR,
    minutes: (st.closedAt - s.issuedAt) / 60e3, score: d.score?.total, tier: d.tier,
    withTrend: d.signal?.trendUp == null ? null : (o.side === "BUY") === d.signal.trendUp });
  if (i % 100 === 0) console.log(new Date().toISOString(), i, "/", picks.length);
}
fs.writeFileSync(path.join(OUT, "audit-live.json"), JSON.stringify(results));

/* --------- الملخّص --------- */
function summary(rows, key) {
  const n = rows.length, wins = rows.filter(r => r[key] > 0), loss = rows.filter(r => r[key] <= 0);
  const gw = wins.reduce((a, r) => a + r[key], 0), gl = -loss.reduce((a, r) => a + r[key], 0);
  return { n, winPct: +(wins.length / n * 100).toFixed(1), avgR: +(rows.reduce((a, r) => a + r[key], 0) / n).toFixed(3), pf: +(gw / gl).toFixed(2) };
}
for (const m of ["FUTURES", "SPOT"]) {
  const rows = results.filter(r => r.market === m);
  if (!rows.length) continue;
  console.log(`\n== ${m} (n=${rows.length}) المسجّل:`, summary(rows, "recR"), " المدقَّق:", summary(rows, "audR"));
  const cats = ["sl", "tp_sl", "tp3", "expired", "cancelled"];
  const mat = {};
  for (const a of cats) { mat[a] = {}; for (const b of cats) mat[a][b] = rows.filter(r => r.recorded === a && r.audited === b).length; }
  console.log("مصفوفة: صفوف = المسجّل، أعمدة = المدقَّق"); console.table(mat);
  const tp = k => (rows.filter(r => r.tpsHit >= k).length / rows.length * 100).toFixed(1) + "%";
  console.log("نسب الوصول (مدقَّق): TP1", tp(1), "TP2", tp(2), "TP3", tp(3),
    "| وقف قبل أي هدف", (rows.filter(r => r.audited === "sl").length / rows.length * 100).toFixed(1) + "%",
    "| هدف ثم خروج عند الدخول", (rows.filter(r => r.audited === "tp_sl").length / rows.length * 100).toFixed(1) + "%");
  const slRows = rows.filter(r => r.audited === "sl");
  console.log("من صفقات الوقف المباشر: نسبة التي تحرّكت ≥0.5R لصالحها أولاً:",
    (slRows.filter(r => r.mfeR >= 0.5).length / slRows.length * 100).toFixed(1) + "%");
}
