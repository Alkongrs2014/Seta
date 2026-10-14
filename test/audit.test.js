import { test } from "node:test";
import assert from "node:assert/strict";
import { M15, evaluate15m, evaluateCandleOpen, scoreSignal, DEFAULT_WEIGHTS } from "../server/strategy.js";
import { tierOf } from "../server/quality.js";
import { buildReport, reportMarkdown, liquidityBucket } from "../server/report.js";

/* حالات حدّية للشروط (تكمّل strategy.test.js). كل الإغلاقات ثابتة لتكون SMA معلومة. */
const T = Date.UTC(2025, 5, 11, 12, 0, 0);
function flat(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = fn(i);
    out.push({ t: T - (n - i) * M15, o: i === 0 ? c : out[i - 1].c, h: c + 1, l: c - 1, c, v: 10, q: 100 });
  }
  return out;
}
/* 900 عند 90 ثم 100 عند 100 → SMA35=SMA50=100 > SMA200 (95) : سياق SELL */
const up = () => flat(1000, i => (i < 900 ? 90 : 100));
const down = () => flat(1000, i => (i < 900 ? 100 : 90));

test("SELL: الافتتاح المساوي لـ SMA200 تماماً لا يصدر (تحت صارمة)", () => {
  const r = evaluate15m(up(), 95);
  assert.equal(r.side, null);
  assert.equal(r.conditions.sell.openBelowSma200, false);
});

test("SELL يصدر بافتتاحٍ تحت SMA200 حين السابقة عند/فوق SMA200 و SMA35/50 فوقه", () => {
  const r = evaluate15m(up(), 94);
  assert.equal(r.side, "SELL");
  assert.ok(Object.values(r.conditions.sell).every(Boolean));
});

test("SMA35 المساوي لـ SMA200 لا يحقّق «تحت» ولا «فوق» (صارمة في الاتجاهين)", () => {
  const s = flat(1000, () => 100);                 // كل المتوسطات = 100
  assert.equal(evaluate15m(s, 101).side, null);
  assert.equal(evaluate15m(s, 99).side, null);
});

test("BUY و SELL لا يصدران معاً أبداً", () => {
  for (const s of [up(), down()]) for (const px of [80, 94, 95, 96, 120]) {
    const r = evaluate15m(s, px);
    const b = Object.values(r.conditions.buy).every(Boolean), se = Object.values(r.conditions.sell).every(Boolean);
    assert.ok(!(b && se));
  }
});

test("إصدار عند الافتتاح: لا تتغيّر النتيجة إن أُضيفت شمعةٌ جارية داخل closed15", () => {
  const closed = down();
  const a = evaluateCandleOpen({ closed15: closed, openTime: T, openPrice: 98 });
  const withCurrent = closed.concat([{ t: T, o: 98, h: 500, l: 1, c: 7, v: 1, q: 1 }]);
  const b = evaluateCandleOpen({ closed15: withCurrent, openTime: T, openPrice: 98 });
  assert.equal(b.side, a.side);
  assert.equal(b.values.sma200, a.values.sma200);
});

test("الأوزان المعلنة 60/20/10/5/5 ومجموع الفريمات 40+20", () => {
  const W = DEFAULT_WEIGHTS;
  assert.deepEqual([W.sma, W.yesterday, W.vwap, W.week, W.trend], [60, 20, 10, 5, 5]);
  assert.equal(W.tf15 + W.tf1h, 60);
});

test("تأكيد الساعة هو الفارق الوحيد = 20 نقطة فريمات (ولا يمنع الإصدار)", () => {
  const base = { side: "BUY", openPrice: 101, sma15: 100, sma35: 100, sma50: 100, sma200: 100,
                 levels: null, trendUp: null };
  const a = scoreSignal({ ...base, hourConfirmed: false });
  const b = scoreSignal({ ...base, hourConfirmed: true });
  assert.equal(b.tfPoints - a.tfPoints, 20);
  assert.equal(a.tfPoints, 40);
});

test("الفئة: جودة التنفيذ تُنزل الفئة ولا ترفعها", () => {
  assert.equal(tierOf(95, 30), "D");
  assert.equal(tierOf(95, 45), "C");
  assert.equal(tierOf(95, 90), "A");
  assert.equal(tierOf(55, 90), "C");
});

test("التقرير: يفصل cancelled عن sl ولا يعدّ المفتوحة منتهية", () => {
  const mk = (id, outcome, r, exec, market = "SPOT") => ({
    id, market, symbol: "X" + id, side: "BUY", candle_open_ts: 1000, issued_at: 3000, candle_arrived_at: 2000,
    closed_at: outcome ? 9000 : null, outcome, r_net: outcome ? r : null, pnl_pct_net: outcome ? r * 0.5 : null,
    exec_quality: exec, score: 70, hour_confirmed: 0, data: { tier: "B" }
  });
  const issued = [mk(1, "cancelled", -0.6, 70), mk(2, "sl", -1.3, 30), mk(3, "tp3", 1.5, 50), mk(4, null, null, 50)];
  const r = buildReport({ from: 0, to: 1, issued });
  assert.equal(r.issued, 4);
  assert.equal(r.closed, 3);
  assert.equal(r.open, 1);
  assert.equal(r.outcomes.cancelled, 1);
  assert.equal(r.outcomes.sl, 1);
  assert.ok(Math.abs(r.cancelledShare - 1 / 3) < 1e-9);
  assert.equal(r.latencyMs.issue.p50, 2000);
  assert.equal(liquidityBucket(30).includes("<40"), true);
  assert.ok(reportMarkdown(r).includes("cancelled"));
});
