/* فحص متانة MR (ارتداد التشبّع البيعي في اتجاهٍ يومي صاعد) — قاعدة قليلة المعاملات:
   MR شراء فقط + اتجاه BTC اليومي صاعد. يُفحص حسب الشهر والرمز وعمق RSI ونموذج الخروج،
   على DEV وOOS منفصلين، بصفقةٍ واحدة لكل رمز. */
import fs from "node:fs";
import path from "node:path";
import { DIR } from "./klines.mjs";
import { metrics, by } from "./lib.mjs";
import { noOverlap, SPLIT } from "./analyze-lib.mjs";

const sigs = JSON.parse(fs.readFileSync(path.join(DIR, "signals.json"), "utf8"))
  .filter(s => s.strat === "MR" && s.t >= Date.UTC(2025, 10, 15));
const tr = (arr, ex) => arr.map(s => s.res[ex] && { ...s.res[ex], s }).filter(Boolean);
const brief = o => o && o.n ? `n=${o.n} win=${o.winPct}% tp1=${o.tp1}% tp2=${o.tp2}% sl1st=${o.slFirst}% avgR=${o.avgR} pf=${o.pf} dd=${o.maxDDR}` : "n=0";
const rules = {
  "MR-buy": s => s.side === "BUY",
  "MR-buy+btcD": s => s.side === "BUY" && s.f.btcD === 1,
  "MR-buy+btcD+btc4h": s => s.side === "BUY" && s.f.btcD === 1 && s.f.btc4h === 1,
  "MR-sell": s => s.side === "SELL",
  "MR-sell+btcD": s => s.side === "SELL" && s.f.btcD === 1
};
for (const [name, f] of Object.entries(rules)) for (const ex of ["live", "trail", "single1R", "quick"]) {
  const d = noOverlap(tr(sigs.filter(s => s.t < SPLIT && f(s)), ex)), o = noOverlap(tr(sigs.filter(s => s.t >= SPLIT && f(s)), ex));
  console.log(`${name}/${ex}`.padEnd(26), "DEV", brief(metrics(d)), "\n".padEnd(27), "OOS", brief(metrics(o)));
}
const base = noOverlap(tr(sigs.filter(rules["MR-buy+btcD"]), "live"));
console.log("\nMR-buy+btcD/live حسب الشهر"); for (const [k, v] of Object.entries(by(base, t => new Date(t.s.t).toISOString().slice(0, 7)))) console.log(" ", k, brief(v));
console.log("\nحسب عمق RSI ساعة عند الإشارة"); for (const [k, v] of Object.entries(by(base, t => t.s.f.rsi1h < 20 ? "a<20" : "b20-25"))) console.log(" ", k, brief(v));
console.log("\nحسب الرمز (n≥8)"); for (const [k, v] of Object.entries(by(base, t => t.s.sym))) if (v.n >= 8) console.log(" ", k.padEnd(14), brief(v));
/* إحصاء t لمتوسط R */
const rs = base.map(t => t.r), m = rs.reduce((a, x) => a + x, 0) / rs.length;
const sd = Math.sqrt(rs.reduce((a, x) => a + (x - m) ** 2, 0) / (rs.length - 1));
console.log(`\nالكل: n=${rs.length} avgR=${m.toFixed(3)} sd=${sd.toFixed(2)} t=${(m / (sd / Math.sqrt(rs.length))).toFixed(2)}`);
