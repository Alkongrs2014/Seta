/* =====================================================================
   محرّك الاستراتيجية — دوالّ نقيّة بلا شبكة ولا حالة.

   هذا الملفّ هو مصدر الحقيقة الوحيد لشروط الدخول. يستعمله الخادم
   الحيّ كما تستعمله الاختبارات، فلا توجد نسختان قد تختلفان.

   القاعدة الحاكمة: **كل SMA يُحسب من الشموع المغلقة السابقة للشمعة
   المقيَّمة فقط**. الشمعة الجارية لا تدخل في أيّ متوسّط، ولا يُستعمل
   إغلاقها بديلاً عن افتتاحها.

   `closed` مصفوفةٌ تصاعديةٌ من الشموع المغلقة { t, o, h, l, c, v, q }
   وآخر عنصرٍ فيها هو الشمعة السابقة مباشرةً للشمعة المقيَّمة.
   ===================================================================== */

export const M15 = 15 * 60 * 1000;
export const H1 = 60 * 60 * 1000;
export const DAY = 24 * H1;
export const WEEK = 7 * DAY;

/* متوسّط بسيط لآخر n إغلاقٍ تنتهي قبل الفهرس `endExcl` (غير شاملٍ له). */
export function smaAt(closed, endExcl, n) {
  const s = endExcl - n;
  if (s < 0 || endExcl > closed.length) return null;
  let sum = 0;
  for (let i = s; i < endExcl; i++) sum += closed[i].c;
  return sum / n;
}

/* متوسّط المدى الحقيقي (متوسّط بسيط) لآخر n شمعةٍ مغلقة. */
export function atr(closed, n = 14) {
  if (closed.length < n + 1) return null;
  let sum = 0;
  for (let i = closed.length - n; i < closed.length; i++) {
    const p = closed[i - 1].c, k = closed[i];
    sum += Math.max(k.h - k.l, Math.abs(k.h - p), Math.abs(k.l - p));
  }
  return sum / n;
}

/* تجميع شموع 15 دقيقة إلى ساعات UTC. لا نعتمد على عدّ الشموع:
   الأزواج الضعيفة تفتقد شموعاً بلا تداول. */
export function aggregateHours(c15) {
  const out = [];
  let cur = null;
  for (const k of c15) {
    const ht = Math.floor(k.t / H1) * H1;
    if (!cur || cur.t !== ht) {
      if (cur) out.push(cur);
      cur = { t: ht, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, q: k.q, n: 1 };
    } else {
      cur.h = Math.max(cur.h, k.h); cur.l = Math.min(cur.l, k.l);
      cur.c = k.c; cur.v += k.v; cur.q += k.q; cur.n++;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ---------------------------------------------------------------------
   شرط الـ15 دقيقة.

   الشمعة المقيَّمة افتتاحها `openPrice`، و`closed` = الشموع المغلقة
   قبلها (N عنصراً، آخرها الشمعة السابقة).

   SMA الحالي           = متوسّط إغلاقات closed[N-n .. N-1].
   SMA200 للشمعة السابقة = متوسّط إغلاقات closed[N-201 .. N-2]، أي
   المحسوب من الشموع التي سبقتها هي، لا ببياناتٍ لاحقة لها.
   --------------------------------------------------------------------- */
export const MIN_CLOSED_15M = 201;

export function evaluate15m(closed, openPrice) {
  const N = closed.length;
  if (!(openPrice > 0)) return { ok: false, reason: "no_open_price" };
  if (N < MIN_CLOSED_15M) return { ok: false, reason: "insufficient_history", have: N, need: MIN_CLOSED_15M };

  const prev = closed[N - 1];
  const sma15 = smaAt(closed, N, 15);
  const sma35 = smaAt(closed, N, 35);
  const sma50 = smaAt(closed, N, 50);
  const sma200 = smaAt(closed, N, 200);
  const sma200Prev = smaAt(closed, N - 1, 200);
  const prevOpen = prev.o;

  const buy = {
    openAboveSma200: openPrice > sma200,
    prevOpenAtOrBelow: prevOpen <= sma200Prev,
    sma35Below: sma35 < sma200,
    sma50Below: sma50 < sma200
  };
  const sell = {
    openBelowSma200: openPrice < sma200,
    prevOpenAtOrAbove: prevOpen >= sma200Prev,
    sma35Above: sma35 > sma200,
    sma50Above: sma50 > sma200
  };
  const buyOk = Object.values(buy).every(Boolean);
  const sellOk = Object.values(sell).every(Boolean);

  return {
    ok: true,
    side: buyOk ? "BUY" : sellOk ? "SELL" : null,
    conditions: { buy, sell },
    values: { openPrice, prevOpen, sma15, sma35, sma50, sma200, sma200Prev }
  };
}

/* ---------------------------------------------------------------------
   تأكيد الساعة (ليس شرطاً إلزامياً ولا يؤخّر الإصدار).

   افتتاح الساعة الحالية = افتتاح أول شمعة 15 دقيقة فيها. إن كانت
   شمعتنا هي الأولى في الساعة فافتتاح الساعة = openPrice نفسه.
   متوسّط SMA50 للساعة يُحسب من الساعات المغلقة السابقة للساعة الحالية.
   --------------------------------------------------------------------- */
export function evaluate1h(c15, openTime, openPrice) {
  const hourStart = Math.floor(openTime / H1) * H1;
  const inHour = c15.filter(k => k.t >= hourStart && k.t < openTime);
  const hourOpen = inHour.length ? inHour[0].o : openPrice;

  const hours = aggregateHours(c15.filter(k => k.t < hourStart));
  const M = hours.length;
  if (M < 52) return { ok: false, reason: "insufficient_history", have: M, need: 52 };
  const prevH = hours[M - 1];
  if (prevH.t !== hourStart - H1) return { ok: false, reason: "gap_prev_hour" };
  const sma50 = smaAt(hours, M, 50);
  const sma50Prev = smaAt(hours, M - 1, 50);
  const sma200 = smaAt(hours, M, 200);          // null إن قلّ التاريخ
  const prevOpen = prevH.o;

  return {
    ok: true,
    hourStart, hourOpen, prevOpen, sma50, sma50Prev, sma200,
    buyConfirmed: hourOpen > sma50 && prevOpen <= sma50Prev,
    sellConfirmed: hourOpen < sma50 && prevOpen >= sma50Prev
  };
}

/* ---------------------------------------------------------------------
   قمّة/قاع أمس والأسبوع السابق (UTC) وVWAP — تعريفاتٌ معلَنة:

   - اليوم = يوم UTC (00:00–24:00). «أمس» = اليوم الذي قبل يوم الشمعة.
   - الأسبوع = أسبوع UTC يبدأ الاثنين 00:00. «السابق» = الذي قبله.
   - VWAP = Σ(السعر النموذجي × الحجم) ÷ Σ الحجم على شموع 15 دقيقة
     المغلقة منذ 00:00 UTC من يوم الشمعة، ويُعاد ضبطه كل يوم UTC.
     إن لم تُغلق شمعةٌ اليوم بعد يُحمَل VWAP أمس النهائي ويُوسَم carried.
   --------------------------------------------------------------------- */
export function utcDayStart(ts) { return Math.floor(ts / DAY) * DAY; }
/* 1970-01-01 خميس، فالاثنين = +4 أيام. */
export function utcWeekStart(ts) { return Math.floor((ts - 4 * DAY) / WEEK) * WEEK + 4 * DAY; }

function rangeOf(c15, from, to) {
  let h = -Infinity, l = Infinity, n = 0;
  for (const k of c15) if (k.t >= from && k.t < to) { h = Math.max(h, k.h); l = Math.min(l, k.l); n++; }
  return n ? { high: h, low: l, n } : null;
}

export function vwapFor(c15, openTime) {
  const d0 = utcDayStart(openTime);
  const calc = (from, to) => {
    let pv = 0, vv = 0;
    for (const k of c15) {
      if (k.t >= from && k.t < to && k.t < openTime) {
        pv += ((k.h + k.l + k.c) / 3) * k.v; vv += k.v;
      }
    }
    return vv > 0 ? pv / vv : null;
  };
  const today = calc(d0, d0 + DAY);
  if (today != null) return { value: today, carried: false };
  const y = calc(d0 - DAY, d0);
  return y != null ? { value: y, carried: true } : { value: null, carried: false };
}

export function levelsFor(c15, openTime, weekly) {
  const d0 = utcDayStart(openTime);
  const y = rangeOf(c15, d0 - DAY, d0);
  /* يومٌ ناقص (بداية التاريخ المتاح) لا يُعتمد: يلزم أن تغطّي الشموع بدايته. */
  const yOk = y && c15.some(k => k.t < d0 - DAY + 2 * H1 && k.t >= d0 - DAY);
  return {
    yesterday: yOk ? y : null,
    week: weekly || null,
    vwap: vwapFor(c15, openTime)
  };
}

/* ---------------------------------------------------------------------
   التقييم — ثلاثة أرقامٍ مفصولة، كلٌّ قابلٌ للاختبار وحده:

   1) نقاط الفريمات (0–60): 15د = 40 (تتحقّق دائماً لأنها شرط الإصدار)،
      + 20 عند تأكيد الساعة.
   2) جودة المؤشّرات (0–100) بالأوزان المعلنة: SMA 60 · أمس 20 · VWAP 10
      · الأسبوع 5 · الاتجاه 5.
   3) الدرجة الكلّية (0–100) = (نقاط الفريمات + 0.4 × جودة المؤشّرات)،
      أي 40 + 20 + 40 كحدٍّ أعلى. لا تُعوَّض الشروط بمؤشّراتٍ قوية،
      ولا يُسقط غيابُ تأكيد الساعة الفرصة.
   --------------------------------------------------------------------- */
export const DEFAULT_WEIGHTS = {
  sma: 60, yesterday: 20, vwap: 10, week: 5, trend: 5,
  tf15: 40, tf1h: 20, indicatorShare: 40
};

const clamp01 = x => Math.max(0, Math.min(1, x));

function rangePosition(price, rng) {
  if (!rng || !(rng.high > rng.low)) return null;
  return clamp01((price - rng.low) / (rng.high - rng.low));
}

export function scoreSignal({ side, openPrice, sma15, sma35, sma50, sma200,
                              levels, trendUp, hourConfirmed, weights }) {
  const W = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const buy = side === "BUY";
  const vs = lvl => (lvl == null ? 0.5 : (buy ? (openPrice > lvl ? 1 : 0) : (openPrice < lvl ? 1 : 0)));

  const smaParts = { sma15: vs(sma15), sma35: vs(sma35), sma50: vs(sma50), sma200: vs(sma200) };
  const smaScore = (smaParts.sma15 + smaParts.sma35 + smaParts.sma50 + smaParts.sma200) / 4;

  const yp = rangePosition(openPrice, levels && levels.yesterday);
  const yScore = yp == null ? 0.5 : (buy ? yp : 1 - yp);
  const wp = rangePosition(openPrice, levels && levels.week);
  const wScore = wp == null ? 0.5 : (buy ? wp : 1 - wp);
  const vScore = levels && levels.vwap && levels.vwap.value != null ? vs(levels.vwap.value) : 0.5;
  const tScore = trendUp == null ? 0.5 : ((buy ? trendUp : !trendUp) ? 1 : 0);

  const tot = W.sma + W.yesterday + W.vwap + W.week + W.trend;
  const part = (score, w, extra) => ({ score, weight: w, points: score * w / tot * 100, ...(extra || {}) });
  const parts = {
    sma: part(smaScore, W.sma, { detail: smaParts }),
    yesterday: part(yScore, W.yesterday),
    vwap: part(vScore, W.vwap),
    week: part(wScore, W.week),
    trend: part(tScore, W.trend)
  };
  const indicatorScore = Object.values(parts).reduce((a, p) => a + p.points, 0);
  const tfPoints = W.tf15 + (hourConfirmed ? W.tf1h : 0);
  const maxTotal = W.tf15 + W.tf1h + W.indicatorShare;
  const raw = tfPoints + (W.indicatorShare / 100) * indicatorScore;
  return {
    tfPoints, tfMax: W.tf15 + W.tf1h,
    indicatorScore: Math.round(indicatorScore * 10) / 10,
    parts,
    total: Math.round(raw / maxTotal * 1000) / 10
  };
}

/* ---------------------------------------------------------------------
   الخطّة: وقفٌ وأهدافٌ من ATR الـ15 دقيقة.
   --------------------------------------------------------------------- */
export const DEFAULT_PLAN = { stopAtrMargin: 0.1, targetsR: [1, 2, 3], minTargetR: 1, maxTargets: 3 };

/* آخر قاع/قمّة ساعةٍ مؤكَّدة (Pivot): ساعةٌ مغلقة قاعُها أدنى من قاعَي جارَتَيها
   (للبيع: قمّتها أعلى)، وتقع في جهة الحماية من سعر الدخول. بحثٌ حتى 72 ساعة. */
export function hourPivots(c15, openTime, side, entry) {
  const hourStart = Math.floor(openTime / H1) * H1;
  const hours = aggregateHours(c15.filter(k => k.t < hourStart)).slice(-74);
  const buy = side === "BUY";
  const out = [];   // الأحدث أولاً
  for (let i = hours.length - 2; i >= 1; i--) {
    const h = hours[i], a = hours[i - 1], b = hours[i + 1];
    if (buy ? (h.l < a.l && h.l < b.l) : (h.h > a.h && h.h > b.h)) out.push(buy ? h.l : h.h);
  }
  return out;
}

/* الوقف = آخر pivot ساعة مؤكَّد في جهة الحماية ∓ هامش 0.1×ATR(15د).
   الأهداف = مستوياتٌ سعريةٌ حقيقية (أمس/الأسبوع/VWAP/pivots الساعة المعاكسة) بعائد ≥ minTargetR،
   وتُستكمل بمضاعفات R حين لا تكفي. */
export function buildPlan({ side, entry, atr15, cfg, stopRef, levels }) {
  const c = { ...DEFAULT_PLAN, ...(cfg || {}) };
  if (stopRef == null || !atr15) return null;
  const dir = side === "BUY" ? 1 : -1;
  const stop = stopRef - dir * c.stopAtrMargin * atr15;
  const risk = (entry - stop) * dir;
  if (!(risk > 0)) return null;
  const real = (levels || []).filter(x => Number.isFinite(x) && (x - entry) * dir / risk >= c.minTargetR - 1e-9)
    .sort((x, y) => (x - y) * dir);
  const targets = [];
  const far = x => targets.every(t => Math.abs(x - t) / risk > 0.05);
  for (const x of real) { if (targets.length >= c.maxTargets) break; if (far(x)) targets.push(x); }
  const kinds = targets.map(() => "level");
  for (let m = 1; targets.length < c.maxTargets && m < 50; m++) {
    const x = entry + dir * risk * m;
    const last = targets.length ? targets[targets.length - 1] : entry;
    if (m >= c.minTargetR && (x - last) * dir / risk > 0.25) { targets.push(x); kinds.push("multiple"); }
  }
  return {
    entry, stop, stopRef, targets, targetKinds: kinds,
    risk, riskPct: risk / entry, rr: targets.map(t => Math.round((t - entry) * dir / risk * 100) / 100)
  };
}

/* مدخلات الخطة لجهةٍ معيّنة، تُحسب مرّةً عند التقييم. */
export function planContext(hist, openTime, side, openPrice, levels) {
  const buy = side === "BUY";
  const piv = hourPivots(hist, openTime, side, openPrice);
  const stopRef = piv.length ? piv[0] : null;
  const opp = hourPivots(hist, openTime, buy ? "SELL" : "BUY", openPrice);
  const lv = [];
  if (levels && levels.yesterday) lv.push(levels.yesterday.high, levels.yesterday.low);
  if (levels && levels.week) lv.push(levels.week.high, levels.week.low);
  if (levels && levels.vwap && levels.vwap.value != null) lv.push(levels.vwap.value);
  return { stopRef, levels: lv.concat(opp) };
}

/* ---------------------------------------------------------------------
   تقييم افتتاح الشمعة كاملاً. `closed15` شموعٌ مغلقة؛ وأيّ شمعةٍ
   بدأت عند openTime أو بعده تُستبعَد دفاعياً من الحساب.
   `weekly` = {high, low} للأسبوع السابق (من شموع 1w).
   --------------------------------------------------------------------- */
export function evaluateCandleOpen({ closed15, openTime, openPrice, weekly, weights, planCfg }) {
  const hist = closed15.filter(k => k.t < openTime);

  const e15 = evaluate15m(hist, openPrice);
  if (!e15.ok) return { ...e15, signal: false };

  /* التأكيد والتقييم يُحسبان للجهتين ليُعرض جدول الشروط كاملاً حتى
     حين لا تصدر فرصة. */
  const h = evaluate1h(hist, openTime, openPrice);
  const v = e15.values;
  const levels = levelsFor(hist, openTime, weekly);
  const trendUp = h.ok && h.sma200 != null ? h.sma50 > h.sma200 : null;
  const side = e15.side;
  if (!side) return { ok: true, signal: false, side: null, openTime, openPrice, values: v,
                      conditions: e15.conditions, hour: h };

  const hourConfirmed = h.ok ? (side === "BUY" ? h.buyConfirmed : h.sellConfirmed) : false;
  const score = scoreSignal({
    side, openPrice, sma15: v.sma15, sma35: v.sma35, sma50: v.sma50, sma200: v.sma200,
    levels, trendUp, hourConfirmed, weights
  });
  const a = atr(hist, 14);
  const planCtx = planContext(hist, openTime, side, openPrice, levels);
  const plan = a ? buildPlan({ side, entry: openPrice, atr15: a, cfg: planCfg, ...planCtx }) : null;
  return { ok: true, signal: true, side, openTime, openPrice, values: v,
           conditions: e15.conditions, hour: h, hourConfirmed, trendUp, levels,
           score, atr15: a, plan, planCtx };
}
