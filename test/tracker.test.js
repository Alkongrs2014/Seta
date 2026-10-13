import { test } from "node:test";
import assert from "node:assert/strict";
import { initTrack, applyUpdate } from "../server/tracker.js";
import { selectOption, optionPlan, modelPremium } from "../server/options.js";
import { tierOf, leverageTable, execQualityLinear, legNetPct } from "../server/quality.js";

const COSTS = { spotFeePct: 0.1, futuresFeePct: 0.05, slippageBps: 2, stopSlippageMult: 2 };
const PLAN = { tpSplit: [0.5, 0.3, 0.2], breakevenAfterTp1: true, cancelOnSmaClose: true };
const T0 = 1_700_000_000_000;

function mk(side = "BUY", over = {}) {
  const entry = 100, risk = 2;
  const dir = side === "BUY" ? 1 : -1;
  return initTrack({
    side, entry, stop: entry - dir * risk,
    targets: [1, 2, 3].map(r => entry + dir * risk * r),
    issuedAt: T0, expiresAt: T0 + 12 * 3600e3, emitCandleT: T0, sma200: 99,
    seenHi: 100.2, seenLo: 99.9, plan: PLAN, feePct: 0.05, halfSpreadPct: 0.01, costs: COSTS, market: "FUTURES",
    ...over
  });
}
const upd = (ts, price, hi = price, lo = price, candleT = T0, closedCandle) =>
  ({ ts, price, candleT, cumHi: hi, cumLo: lo, closedCandle });

test("قمم ما قبل الإصدار لا تُحتسب هدفاً", () => {
  const st = mk("BUY");
  // الشمعة الجارية فيها قمّةٌ سابقة 103 لكن seenHi=100.2 عند الإصدار؛ التحديث يحمل cumHi=100.2 فلا جديد
  const r = applyUpdate(st, upd(T0 + 1000, 100.1, 100.2, 99.9));
  assert.equal(r.events.length, 0);
  assert.equal(st.tpsHit, 0);
});

test("هدفٌ أول ثم وقفٌ عند التعادل: tp_sl وصافي موجبٌ صغير", () => {
  const st = mk("BUY");
  let r = applyUpdate(st, upd(T0 + 10_000, 102.1, 102.1, 100));
  assert.ok(r.events.some(e => e.type === "tp1"));
  assert.equal(st.stop, 100);
  r = applyUpdate(st, upd(T0 + 20_000, 99.9, 102.1, 99.9));
  assert.equal(st.status, "tp_sl");
  assert.ok(st.final.rNet > 0 && st.final.rNet < 1);
});

test("الوقف والهدف في التحديث نفسه: الوقف أولاً", () => {
  const st = mk("BUY");
  const r = applyUpdate(st, upd(T0 + 5000, 101, 103, 97));
  assert.equal(st.status, "sl");
  assert.ok(st.final.rNet < 0);
});

test("ثلاثة أهداف: tp3 والعائد قرب 0.5·1R+0.3·2R+0.2·3R بعد التكاليف", () => {
  const st = mk("BUY");
  applyUpdate(st, upd(T0 + 1000, 106.5, 106.5, 100));
  assert.equal(st.status, "tp3");
  assert.ok(st.final.rNet > 1.5 && st.final.rNet < 1.7, String(st.final.rNet));
});

test("SELL: الوقف فوق والأهداف تحت", () => {
  const st = mk("SELL");
  applyUpdate(st, upd(T0 + 1000, 97.9, 100, 97.9));
  assert.equal(st.status, "tp1");
  applyUpdate(st, upd(T0 + 2000, 102.5, 102.5, 97.9));
  assert.equal(st.status, "tp_sl");
});

test("وقفٌ بفجوة: الخروج عند السعر الأسوأ لا الوقف", () => {
  const st = mk("BUY");
  applyUpdate(st, upd(T0 + 1000, 95, 100.2, 95));
  assert.equal(st.legs[0].exit, 95);
});

test("إلغاء: إغلاق شمعة 15د تحت SMA200 قبل أيّ هدف", () => {
  const st = mk("BUY", { stop: 90 });
  const r = applyUpdate(st, upd(T0 + 900e3, 98.5, 100.2, 98.5, T0, { c: 98.5 }));
  assert.equal(st.status, "cancelled");
  assert.equal(st.legs[0].exit, 98.5);
});

test("لا إلغاء بعد تحقق هدف", () => {
  const st = mk("BUY", { stop: 90 });
  applyUpdate(st, upd(T0 + 1000, 102.2, 102.2, 100));
  applyUpdate(st, upd(T0 + 900e3, 98.5, 102.2, 98.5, T0, { c: 98.5 }));
  assert.notEqual(st.status, "cancelled");
});

test("انتهاء الصلاحية يُغلق الأرجل المتبقية بسعر السوق", () => {
  const st = mk("BUY");
  applyUpdate(st, upd(T0 + 13 * 3600e3, 100.5, 100.5, 100.5, T0 + 13 * 3600e3));
  assert.equal(st.status, "expired");
});

test("الحالة تنتقل من new إلى active بعد النافذة", () => {
  const st = mk("BUY");
  applyUpdate(st, upd(T0 + 60e3, 100.1, 100.2, 99.9));
  assert.equal(st.status, "new");
  applyUpdate(st, upd(T0 + 6 * 60e3, 100.1, 100.2, 99.9));
  assert.equal(st.status, "active");
});

test("نموذج التكلفة: الخروج بالوقف أكلف من الهدف", () => {
  const a = legNetPct({ side: "BUY", entry: 100, exit: 102, kind: "tp", costs: COSTS, feePct: 0.05 });
  const b = legNetPct({ side: "BUY", entry: 100, exit: 102, kind: "stop", costs: COSTS, feePct: 0.05 });
  assert.ok(a.net > b.net);
  assert.ok(a.net < a.gross);
});

/* ---------------- خيارات ---------------- */
const NOW = Date.UTC(2026, 9, 14, 12);
const S = { deltaMin: 0.35, deltaMax: 0.60, deltaTarget: 0.45, minDteHours: 20, maxDteDays: 45,
            maxSpreadPct: 12, minOpenInterest: 1, minVolume24h: 0, stopLossPct: 35, holdHoursModel: 6 };
const opt = (o) => ({ symbol: "X", side: "CALL", strike: 100, expiry: NOW + 3 * 864e5, delta: 0.45, gamma: 0.001,
  theta: -2, vega: 1, markIV: 0.5, bid: 10, ask: 10.5, volume: 5, openInterest: 50, unit: 1, ...o });

test("CALL للصعود و PUT للهبوط ولا يُخلط بينهما", () => {
  const cs = [opt({ symbol: "C", side: "CALL" }), opt({ symbol: "P", side: "PUT", delta: -0.45 })];
  assert.equal(selectOption({ direction: "BUY", contracts: cs, now: NOW, settings: S }).selected.symbol, "C");
  assert.equal(selectOption({ direction: "SELL", contracts: cs, now: NOW, settings: S }).selected.symbol, "P");
});

test("نطاق الدلتا بالقيمة المطلقة وأقرب إلى 0.45 يتفوّق", () => {
  const cs = [opt({ symbol: "A", delta: 0.36 }), opt({ symbol: "B", delta: 0.46 }), opt({ symbol: "Z", delta: 0.8 })];
  const r = selectOption({ direction: "BUY", contracts: cs, now: NOW, settings: S });
  assert.equal(r.selected.symbol, "B");
  assert.equal(r.rejected.delta, 1);
});

test("لا عقد مناسب ⇒ لا اختيار (سبريد واسع/بلا عرض/سيولة)", () => {
  const cs = [
    opt({ symbol: "W", bid: 5, ask: 10 }),         // سبريد 66%
    opt({ symbol: "N", bid: 0, ask: 10 }),         // بلا عرض
    opt({ symbol: "O", openInterest: 0 }),         // بلا مراكز
    opt({ symbol: "E", expiry: NOW + 3600e3 })     // ينتهي خلال ساعة
  ];
  const r = selectOption({ direction: "BUY", contracts: cs, now: NOW, settings: S });
  assert.equal(r.selected, null);
  assert.equal(r.rejected.spread, 1);
  assert.equal(r.rejected.noQuote, 1);
  assert.equal(r.rejected.oi, 1);
  assert.equal(r.rejected.dte, 1);
});

test("خطّة الخيار: أقصى خسارة = العلاوة والوقف نسبة منها والأهداف ≥ +20%", () => {
  const c = opt({ ask: 100, delta: 0.5, gamma: 0.0001, theta: -10 });
  const p = optionPlan({ contract: c, underlyingEntry: 1000, underlyingTargets: [1010, 1020, 1030], settings: S });
  assert.equal(p.stop, 65);
  assert.equal(p.maxLossPerContract, 100);
  assert.ok(p.targets.every(t => t >= 120));
  assert.ok(p.targets[2] >= p.targets[0]);
  assert.ok(modelPremium({ ask: 100, delta: 0.5, gamma: 0, theta: -24, dS: 0, holdHours: 24 }) === 76);
});

/* ---------------- جودة التنفيذ ---------------- */
test("الإشارة القوية لا ترفع الفئة فوق جودة التنفيذ", () => {
  assert.equal(tierOf(95, 30), "D");
  assert.equal(tierOf(95, 55), "B");
  assert.equal(tierOf(95, 85), "A");
  assert.equal(tierOf(50, 85), "C");
});

test("جودة التنفيذ تنهار مع سبريدٍ واسع وحجمٍ ضعيف", () => {
  const good = execQualityLinear({ market: "SPOT", spreadPct: 0.01, quoteVol24h: 5e7, riskPct: 0.01, costs: COSTS, maxSpreadPct: 0.6, minVol: 5e5 });
  const bad = execQualityLinear({ market: "SPOT", spreadPct: 0.5, quoteVol24h: 6e5, riskPct: 0.01, costs: COSTS, maxSpreadPct: 0.6, minVol: 5e5 });
  assert.ok(good.score > 70);
  assert.ok(bad.score < 35);
});

test("الرافعة تُعرض ولا تدخل في التقييم؛ وتحذّر حين التصفية قبل الوقف", () => {
  const t = leverageTable({ side: "BUY", entry: 100, stop: 94, leverages: [3, 10, 20], mmrPct: 0.5 });
  assert.equal(t[0].liqBeforeStop, false);
  assert.equal(t[2].liqBeforeStop, true);     // 20x: التصفية عند 4.5% بينما الوقف عند 6%
});
