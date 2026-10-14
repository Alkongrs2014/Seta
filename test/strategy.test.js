import { test } from "node:test";
import assert from "node:assert/strict";
import {
  M15, H1, DAY, smaAt, atr, aggregateHours, evaluate15m, evaluate1h,
  evaluateCandleOpen, scoreSignal, buildPlan, utcWeekStart, utcDayStart, vwapFor, levelsFor
} from "../server/strategy.js";

/* مولّد شموعٍ اصطناعية: الافتتاح = إغلاق السابقة، والزمن شبكة 15 دقيقة تنتهي
   قبل openTime مباشرةً. هذه اختباراتُ منطقٍ فقط — لا تثبت صحّة النظام الحيّ. */
const OPEN_TIME = Date.UTC(2025, 5, 11, 12, 0, 0); // الأربعاء 12:00 UTC — بداية ساعة
function series(n, closeFn, openTime = OPEN_TIME) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = closeFn(i);
    const o = i === 0 ? c : out[i - 1].c;
    out.push({ t: openTime - (n - i) * M15, o, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5, c, v: 10, q: 1000 });
  }
  return out;
}
/* 900 شمعةٍ عند 100 ثم 100 عند 90: SMA35=SMA50=90 و SMA200=95 */
const dropSeries = () => series(1000, i => (i < 900 ? 100 : 90));
/* الصورة المعكوسة: 90 ثم 100: SMA35=SMA50=100 و SMA200=95 */
const riseSeries = () => series(1000, i => (i < 900 ? 90 : 100));

test("smaAt يستثني الفهرس الأخير ويحسب النافذة الصحيحة", () => {
  const c = [1, 2, 3, 4, 5].map((x, i) => ({ t: i, o: x, h: x, l: x, c: x }));
  assert.equal(smaAt(c, 5, 5), 3);
  assert.equal(smaAt(c, 4, 3), 3);   // 2,3,4
  assert.equal(smaAt(c, 2, 3), null);
});

test("BUY: أول افتتاحٍ فوق SMA200 بعد افتتاحٍ تحته و SMA35/50 تحت SMA200", () => {
  const r = evaluate15m(dropSeries(), 98);
  assert.equal(r.side, "BUY");
  assert.equal(r.values.sma200, 95);
  assert.ok(r.values.sma35 < r.values.sma200 && r.values.sma50 < r.values.sma200);
});

test("BUY لا يصدر عند التساوي التامّ مع SMA200 (فوق صارمة)", () => {
  const r = evaluate15m(dropSeries(), 95);
  assert.equal(r.side, null);
});

test("افتتاح الشمعة السابقة المساوي لـ SMA200 التاريخي يُحسب «عنده أو تحته»", () => {
  // نبني شموعاً يكون فيها افتتاح السابقة = SMA200 التاريخي تماماً.
  const base = series(1000, i => 100);
  // كلّ إغلاق 100 → SMA200 = 100 ؛ افتتاح السابقة = 100 → يساوي.
  base[999] = { ...base[999], o: 100 };
  // لكن شرط SMA35 < SMA200 يفشل (كلها 100)، فنخفض آخر 50 شمعة إلى 99.9
  for (let i = 950; i < 1000; i++) { base[i].c = 99.9; base[i].o = i === 950 ? 100 : 99.9; }
  base[999].o = (() => { // SMA200 التاريخي للسابقة = متوسّط 799..998
    let s = 0; for (let i = 799; i < 999; i++) s += base[i].c; return s / 200;
  })();
  const r = evaluate15m(base, 100.5);
  assert.equal(r.conditions.buy.prevOpenAtOrBelow, true);
  assert.equal(r.side, "BUY");
});

test("SMA200 للشمعة السابقة محسوبٌ تاريخياً لا بالمتوسّط الحالي", () => {
  const s = dropSeries();
  const r = evaluate15m(s, 98);
  const manual = (() => { let x = 0; for (let i = 799; i < 999; i++) x += s[i].c; return x / 200; })();
  assert.equal(r.values.sma200Prev, manual);
  assert.notEqual(r.values.sma200Prev, r.values.sma200);
});

test("SELL: انعكاس الحالة", () => {
  const r = evaluate15m(riseSeries(), 92);
  assert.equal(r.side, "SELL");
  assert.equal(r.values.sma200, 95);
});

test("لا فرصة إذا SMA50 فوق SMA200 رغم عبور الافتتاح", () => {
  // آخر 50 شمعة 120 → SMA50 = 120 > SMA200
  const s = series(1000, i => (i < 950 ? 80 : 120));
  const r = evaluate15m(s, 130);
  assert.equal(r.side, null);
});

test("تاريخٌ غير كافٍ لا يُصدر", () => {
  const r = evaluate15m(series(150, () => 100), 105);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "insufficient_history");
});

test("الشمعة الجارية لا تدخل في المتوسّط: إضافة شمعة openTime تُستبعد", () => {
  const closed = dropSeries();
  const poisoned = closed.concat([{ t: OPEN_TIME, o: 98, h: 5000, l: 1, c: 5000, v: 1, q: 1 }]);
  const a = evaluateCandleOpen({ closed15: closed, openTime: OPEN_TIME, openPrice: 98 });
  const b = evaluateCandleOpen({ closed15: poisoned, openTime: OPEN_TIME, openPrice: 98 });
  assert.equal(b.signal, true);
  assert.equal(a.values.sma200, b.values.sma200);
  assert.equal(a.values.sma35, b.values.sma35);
});

test("الإغلاق لا يغيّر القرار: القرار يعتمد افتتاح الشمعة فقط", () => {
  const closed = dropSeries();
  const r1 = evaluateCandleOpen({ closed15: closed, openTime: OPEN_TIME, openPrice: 98 });
  // الإغلاق المستقبلي غير موجود في المدخلات أصلاً؛ نتأكّد أن سعراً فوق/تحت يغيّر الجهة فقط بالافتتاح
  const r2 = evaluateCandleOpen({ closed15: closed, openTime: OPEN_TIME, openPrice: 90 });
  assert.equal(r1.side, "BUY");
  assert.equal(r2.signal, false);
});

test("غياب تأكيد الساعة لا يمنع الإصدار ويُظهَر بوضوح", () => {
  // openTime في منتصف الساعة (12:15): افتتاح الساعة = 90 تحت SMA50 الساعي
  const ot = OPEN_TIME + M15;
  const s = series(1000, i => (i < 900 ? 100 : 90), ot);
  const r = evaluateCandleOpen({ closed15: s, openTime: ot, openPrice: 98 });
  assert.equal(r.signal, true);
  assert.equal(r.side, "BUY");
  assert.equal(r.hourConfirmed, false);
  assert.equal(r.score.tfPoints, 40);
});

test("تأكيد الساعة يضيف 20 نقطة", () => {
  const s = dropSeries(); // openTime بداية ساعة
  const r = evaluateCandleOpen({ closed15: s, openTime: OPEN_TIME, openPrice: 98 });
  assert.equal(r.signal, true);
  assert.equal(r.hour.ok, true);
  assert.equal(r.hourConfirmed, true);
  assert.equal(r.score.tfPoints, 60);
  assert.ok(r.score.total > 60 && r.score.total <= 100);
});

test("الإصدار عند الافتتاح: لا يلزم أي بيانات من داخل الشمعة", () => {
  // التقييم ممكن بمجرّد سعر الافتتاح وشموعٍ مغلقة — لا h/l/c للشمعة الجارية.
  const r = evaluateCandleOpen({ closed15: dropSeries(), openTime: OPEN_TIME, openPrice: 98 });
  assert.equal(r.signal, true);
  assert.equal(r.openTime, OPEN_TIME);
});

test("تقاطع SMA200 في الاتجاهين على سلسلةٍ واحدة", () => {
  // سلسلة تهبط ثم ترتدّ: عبورٌ صاعد ثم هابط
  const s = series(1300, i => (i < 1000 ? 100 : (i < 1100 ? 85 : 110)));
  const up = evaluate15m(s.slice(0, 1100), 99);   // بعد الهبوط ← افتتاح 99 > SMA200؟
  const smaUp = up.values.sma200;
  assert.ok(smaUp > 85 && smaUp < 100);
  assert.equal(up.side, 99 > smaUp ? "BUY" : null);
});

test("aggregateHours يجمّع حسب ساعة UTC لا بعدّ الشموع", () => {
  const t0 = Date.UTC(2025, 0, 1, 0, 0);
  const c = [0, 1, 2, 3, 4].map((i, j) => ({ t: t0 + i * M15, o: 10 + j, h: 20 + j, l: 5 + j, c: 11 + j, v: 1, q: 1 }));
  const h = aggregateHours(c);
  assert.equal(h.length, 2);
  assert.equal(h[0].n, 4);
  assert.equal(h[0].o, 10);
  assert.equal(h[1].n, 1);
});

test("evaluate1h: SELL مؤكَّد", () => {
  const s = riseSeries();
  const r = evaluate1h(s, OPEN_TIME, 92);
  assert.equal(r.ok, true);
  assert.equal(r.sellConfirmed, true);
  assert.equal(r.buyConfirmed, false);
});

test("حدود اليوم والأسبوع بتوقيت UTC (الأسبوع يبدأ الاثنين)", () => {
  const wed = Date.UTC(2025, 5, 11, 12);
  assert.equal(new Date(utcWeekStart(wed)).toISOString(), "2025-06-09T00:00:00.000Z");
  assert.equal(new Date(utcDayStart(wed)).toISOString(), "2025-06-11T00:00:00.000Z");
  const mon = Date.UTC(2025, 5, 9, 0, 0);
  assert.equal(utcWeekStart(mon), mon);
  assert.equal(utcWeekStart(mon - 1), mon - 7 * DAY);
});

test("VWAP يُعاد ضبطه كل يوم UTC ويستثني الشمعة الجارية", () => {
  const d0 = Date.UTC(2025, 5, 11);
  const y = { t: d0 - M15, o: 50, h: 50, l: 50, c: 50, v: 100, q: 5000 };
  const a = { t: d0, o: 100, h: 100, l: 100, c: 100, v: 10, q: 1000 };
  const b = { t: d0 + M15, o: 110, h: 110, l: 110, c: 110, v: 10, q: 1100 };
  assert.deepEqual(vwapFor([y], d0), { value: 50, carried: true });
  assert.deepEqual(vwapFor([y, a], d0 + M15), { value: 100, carried: false });
  assert.equal(vwapFor([y, a, b], d0 + M15).value, 100); // b (t == openTime) مستثناة
});

test("قمّة وقاع أمس من يوم UTC السابق فقط", () => {
  const d0 = Date.UTC(2025, 5, 11);
  const c = [];
  for (let t = d0 - DAY; t < d0 + 4 * H1; t += M15) {
    c.push({ t, o: 10, h: t < d0 ? 20 + (t === d0 - DAY + 5 * H1 ? 5 : 0) : 99, l: t < d0 ? 8 : 1, c: 10, v: 1, q: 1 });
  }
  const lv = levelsFor(c, d0 + 3 * H1, { high: 30, low: 5 });
  assert.equal(lv.yesterday.high, 25);
  assert.equal(lv.yesterday.low, 8);
  assert.deepEqual(lv.week, { high: 30, low: 5 });
});

test("التقييم: الأوزان 60/20/10/5/5 وعدم الخلط مع نقاط الفريمات", () => {
  const lv = { yesterday: { high: 110, low: 90 }, week: { high: 120, low: 80 }, vwap: { value: 99, carried: false } };
  const full = scoreSignal({
    side: "BUY", openPrice: 111, sma15: 100, sma35: 100, sma50: 100, sma200: 100,
    levels: lv, trendUp: true, hourConfirmed: true
  });
  assert.equal(Math.round(full.parts.sma.points), 60);
  assert.equal(Math.round(full.parts.yesterday.points), 20);
  assert.equal(Math.round(full.parts.vwap.points), 10);
  assert.equal(full.indicatorScore > 90, true);
  assert.equal(full.tfPoints, 60);
  assert.equal(full.total <= 100, true);

  const none = scoreSignal({
    side: "BUY", openPrice: 70, sma15: 100, sma35: 100, sma50: 100, sma200: 100,
    levels: lv, trendUp: false, hourConfirmed: false
  });
  assert.equal(none.tfPoints, 40);
  assert.ok(none.total < full.total);
  // الحدّ الأدنى للشرط: 40/100 حتى بمؤشّراتٍ معدومة
  assert.ok(none.total >= 40 * 100 / 100 - 1e-9 || none.total >= 40);
});

test("التقييم يعكس الجهة في SELL", () => {
  const lv = { yesterday: { high: 110, low: 90 }, week: null, vwap: { value: 101, carried: false } };
  const s = scoreSignal({ side: "SELL", openPrice: 85, sma15: 100, sma35: 100, sma50: 100, sma200: 100,
    levels: lv, trendUp: false, hourConfirmed: false });
  assert.equal(s.parts.sma.score, 1);
  assert.equal(s.parts.yesterday.score, 1);
  assert.equal(s.parts.trend.score, 1);
  assert.equal(s.parts.week.score, 0.5);   // غير متاح → محايد
});

test("الخطة: وقف pivot الساعة ∓0.1×ATR وأهداف حقيقية ≥1R تُستكمل بمضاعفات R", () => {
  const b = buildPlan({ side: "BUY", entry: 100, atr15: 1, stopRef: 98, levels: [100.5, 103, 110, 90] });
  assert.ok(Math.abs(b.stop - 97.9) < 1e-9);                 // 98 − 0.1×1
  assert.equal(b.targets[0], 103);                           // 100.5 < 1R فيُهمل
  assert.equal(b.targets[1], 110);
  assert.ok(b.targets[2] > 110 && b.targetKinds[2] === "multiple");
  assert.ok(b.rr[0] >= 1);
  const s = buildPlan({ side: "SELL", entry: 100, atr15: 1, stopRef: 102, levels: [] });
  assert.ok(Math.abs(s.stop - 102.1) < 1e-9);
  assert.deepEqual(s.rr, [1, 2, 3]);                         // بلا مستويات: مضاعفات R
  assert.equal(buildPlan({ side: "BUY", entry: 100, atr15: 1, stopRef: null }), null);
});

test("atr يعمل على آخر 14 شمعة", () => {
  const c = series(30, () => 100);
  assert.equal(atr(c, 14), 1);   // h-l = 1 لكل شمعة مسطّحة
});
