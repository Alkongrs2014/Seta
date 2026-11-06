/* =====================================================================
   التحليل: مقارنة المحرّك القديم بالمرشّحين الجدد، بحثُ فلاتر على فترة
   التطوير وحدها، ثم اختبارٌ على فترةٍ مستقلّة لم تُستعمل، وWalk-Forward.

   الفترات (UTC):
     DEV = من بداية البيانات حتى 2026-06-30   (تطوير واختيار)
     OOS = 2026-07-01 حتى النهاية             (لا يُلمس أثناء الاختيار)
   التشغيل: node research/analyze.mjs  ← يكتب data/research/report.json
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { DIR } from "./klines.mjs";
import { metrics, by } from "./lib.mjs";

export const SPLIT = Date.UTC(2026, 6, 1);
const sigs = JSON.parse(fs.readFileSync(path.join(DIR, "signals.json"), "utf8"));
const WARM = Date.UTC(2025, 10, 15);          // إحماء مؤشّرات 4س/يومي
const all = sigs.filter(s => s.t >= WARM);
const dev = all.filter(s => s.t < SPLIT), oos = all.filter(s => s.t >= SPLIT);
const tr = (arr, exit) => arr.map(s => s.res[exit] && { ...s.res[exit], s }).filter(Boolean);

/* لا تداخل: صفقةٌ واحدة مفتوحة لكل رمز — الإشارة أثناء صفقةٍ مفتوحة تُتجاهل */
export function noOverlap(trades) {
  const busy = new Map(), out = [];
  for (const t of trades.slice().sort((a, b) => a.s.t - b.s.t)) {
    if ((busy.get(t.s.sym) || 0) > t.s.t) continue;
    busy.set(t.s.sym, t.exitTs); out.push(t);
  }
  return out;
}
/* انتقاء: أقصى K إشارة في اليوم بأعلى ترتيب */
export function topK(trades, K, rank) {
  const days = new Map();
  for (const t of trades) { const d = Math.floor(t.s.t / 86400e3); if (!days.has(d)) days.set(d, []); days.get(d).push(t); }
  return [...days.values()].flatMap(v => v.sort((a, b) => rank(b.s) - rank(a.s)).slice(0, K));
}

const report = { split: new Date(SPLIT).toISOString(), counts: {} };
for (const st of ["OLD", "PB", "BO"]) report.counts[st] = { dev: dev.filter(s => s.strat === st).length, oos: oos.filter(s => s.strat === st).length };

/* 1) كل استراتيجية × نموذج خروج، DEV و OOS */
report.grid = {};
for (const st of ["OLD", "PB", "BO"]) {
  for (const ex of Object.keys(all[0].res).concat(st === "OLD" ? [] : [])) {
    const d = tr(dev.filter(s => s.strat === st), ex), o = tr(oos.filter(s => s.strat === st), ex);
    if (!d.length) continue;
    report.grid[`${st}/${ex}`] = { dev: metrics(d), oos: metrics(o) };
  }
}

/* 2) بحث فلاتر على DEV فقط */
const CONDS = {
  h4Trend: s => s.f.h4Trend === 1, h4Above: s => s.f.h4Above === 1, h1Trend: s => s.f.h1Trend === 1, h1Long: s => s.f.h1Long === 1,
  dTrend: s => s.f.dTrend === 1, btc4h: s => s.f.btc4h === 1, btcD: s => s.f.btcD === 1,
  adx20: s => s.f.adx1h >= 20, adx25: s => s.f.adx1h >= 25,
  vol15: s => s.f.volRatio >= 1.5, vol25: s => s.f.volRatio >= 2.5,
  atrCalm: s => s.f.atrRegime != null && s.f.atrRegime < 1.0, atrHot: s => s.f.atrRegime != null && s.f.atrRegime >= 1.3,
  fundOk: s => s.f.funding == null || (s.side === "BUY" ? s.f.funding < 0.0003 : s.f.funding > -0.0003),
  fundContra: s => s.f.funding != null && (s.side === "BUY" ? s.f.funding < 0 : s.f.funding > 0),
  risk1: s => s.riskPct >= 1.0, risk07: s => s.riskPct >= 0.7,
  takerWith: s => s.f.takerBuy != null && (s.side === "BUY" ? s.f.takerBuy > 0.55 : s.f.takerBuy < 0.45),
  rsiMid: s => s.f.rsi1h != null && (s.side === "BUY" ? s.f.rsi1h < 65 : s.f.rsi1h > 35),
  buyOnly: s => s.side === "BUY", sellOnly: s => s.side === "SELL"
};
for (const s of all) s.fl = Object.fromEntries(Object.entries(CONDS).map(([k, f]) => [k, !!f(s)]));
function search(base, exit, minN) {
  const names = Object.keys(CONDS), res = [];
  const combos = [[]];
  for (const a of names) combos.push([a]);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) combos.push([names[i], names[j]]);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) for (let k = j + 1; k < names.length; k++) combos.push([names[i], names[j], names[k]]);
  for (const c of combos) {
    const sel = base.filter(s => c.every(n => s.fl[n]));
    const t = noOverlap(tr(sel, exit));
    if (t.length < minN) continue;
    const m = metrics(t);
    /* المعيار: متوسط R مع عقوبة صغر العيّنة (انكماش n/(n+50)) */
    res.push({ conds: c, ...m, shrunk: m.avgR * t.length / (t.length + 50) });
  }
  return res.sort((a, b) => b.shrunk - a.shrunk);
}
report.search = {};
for (const st of ["OLD", "PB", "BO"]) for (const ex of ["live", "beAfter2", "single15R", "trail"]) {
  const base = dev.filter(s => s.strat === st);
  if (!base.length) continue;
  const top = search(base, ex, 60).slice(0, 5);
  /* نفس القاعدة كما هي على OOS — بلا أي تعديل */
  report.search[`${st}/${ex}`] = top.map(r => {
    const o = noOverlap(tr(oos.filter(s => s.strat === st && r.conds.every(n => CONDS[n](s))), ex));
    return { conds: r.conds.join("+") || "(بلا فلتر)", dev: { n: r.n, winPct: r.winPct, avgR: r.avgR, pf: r.pf, maxDDR: r.maxDDR }, oos: metrics(o) };
  });
}

/* 3) Walk-Forward: نافذة تدريب 4 أشهر ← اختبار الشهر التالي، القاعدة تُختار من التدريب فقط */
function walkForward(st, ex) {
  const months = [];
  for (let y = 2025, m = 11; ; m++) { if (m > 11) { m = 0; y++; } const t = Date.UTC(y, m, 1); if (t > Date.now()) break; months.push(t); }
  const tests = [], picks = [];
  for (let k = 4; k < months.length; k++) {
    const train = all.filter(s => s.strat === st && s.t >= months[k - 4] && s.t < months[k]);
    const test = all.filter(s => s.strat === st && s.t >= months[k] && (k + 1 < months.length ? s.t < months[k + 1] : true));
    const best = search(train, ex, 40)[0];
    if (!best) continue;
    picks.push({ month: new Date(months[k]).toISOString().slice(0, 7), conds: best.conds.join("+"), trainAvgR: best.avgR });
    tests.push(...noOverlap(tr(test.filter(s => best.conds.every(n => CONDS[n](s))), ex)));
  }
  return { picks, test: metrics(tests), byMonth: by(tests, t => new Date(t.s.t).toISOString().slice(0, 7)) };
}
report.walkForward = {};
for (const st of ["OLD", "PB", "BO"]) for (const ex of ["live", "single15R", "trail"]) report.walkForward[`${st}/${ex}`] = walkForward(st, ex);

fs.writeFileSync(path.join(DIR, "report.json"), JSON.stringify(report, null, 1));
const brief = o => o && o.n ? `n=${o.n} win=${o.winPct}% tp1=${o.tp1}% sl1st=${o.slFirst}% avgR=${o.avgR} pf=${o.pf} dd=${o.maxDDR}` : "n=0";
console.log("counts", JSON.stringify(report.counts));
console.log("\n== GRID (كل الإشارات، بلا فلاتر، تداخل مسموح)");
for (const [k, v] of Object.entries(report.grid)) console.log(k.padEnd(20), "DEV", brief(v.dev), "\n".padEnd(21), "OOS", brief(v.oos));
console.log("\n== أفضل فلاتر DEV ← نفس القاعدة على OOS (صفقة واحدة لكل رمز)");
for (const [k, v] of Object.entries(report.search)) { console.log(k); for (const r of v.slice(0, 3)) console.log("  ", r.conds.padEnd(30), "DEV", brief(r.dev), "| OOS", brief(r.oos)); }
console.log("\n== WALK-FORWARD (تدريب 4 أشهر → اختبار شهر)");
for (const [k, v] of Object.entries(report.walkForward)) console.log(k.padEnd(20), brief(v.test));
