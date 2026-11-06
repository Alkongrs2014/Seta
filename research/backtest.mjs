/* =====================================================================
   مولّد الإشارات التاريخية + المحاكاة.

   OLD  = المحرّك الحيّ نفسه: يستدعي evaluateCandleOpen من server/strategy.js
          حرفياً، بخطّته (وقف pivot ساعة − 0.1×ATR، أهداف مستويات/مضاعفات R).
   PB   = استمرار اتجاه بعد ارتداد (Pullback) — اتجاه 4س و1س متوافقان،
          ارتدادٌ إلى EMA50 ثم استئناف. وقف تحت قاع الارتداد.
   BO   = اختراق قناة 48 شمعة بحجمٍ مرتفع في اتجاه الفريم الأعلى.

   كل إشارة تُقيَّم عند افتتاح الشمعة التالية لاكتمال شروطها، بالشموع المغلقة فقط.
   الناتج: data/research/signals.json — إشارة + سماتها + نتيجتها تحت عدّة نماذج خروج.
   التشغيل: node research/backtest.mjs
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { universe, DIR } from "./klines.mjs";
import { loadSymbol, ema, sma, atr, rsi, adx, lastClosedIdx, simulate, M15, H1, H4, DAY } from "./lib.mjs";
import { evaluateCandleOpen, utcWeekStart, utcDayStart } from "../server/strategy.js";

/* نماذج الخروج المختبرة (نفس القواعد لكل الاستراتيجيات) */
export const EXITS = {
  live:      { targetsR: [1, 2, 3], split: [1 / 3, 1 / 3, 1 / 3], be: 1 },     // الحالي
  beAfter2:  { targetsR: [1, 2, 3], split: [1 / 3, 1 / 3, 1 / 3], be: 2 },
  noBE:      { targetsR: [1, 2, 3], split: [1 / 3, 1 / 3, 1 / 3], be: 0 },
  half1R:    { targetsR: [1, 2], split: [0.5, 0.5], be: 0 },
  single1R:  { targetsR: [1], split: [1], be: 0 },
  single15R: { targetsR: [1.5], split: [1], be: 0 },
  single2R:  { targetsR: [2], split: [1], be: 0 },
  trail:     { targetsR: [1, 4], split: [0.5, 0.5], be: 1, beOffsetR: 0.1, trailAtr: 2.5, trailAfter: 1 }
};

function htfState(S, t) {
  const i4 = lastClosedIdx(S.b4h, H4, t), i1 = lastClosedIdx(S.b1h, H1, t), id = lastClosedIdx(S.b1d, DAY, t);
  return { i4, i1, id };
}

function prep(S) {
  const c15 = S.b15.map(b => b.c), c1h = S.b1h.map(b => b.c), c4h = S.b4h.map(b => b.c), c1d = S.b1d.map(b => b.c);
  return {
    e20: ema(c15, 20), e50: ema(c15, 50), e200: ema(c15, 200), atr15: atr(S.b15, 14), rsi15: rsi(c15, 14),
    vol20: sma(S.b15.map(b => b.qv), 20), atr100: sma(atr(S.b15, 14).map(x => x ?? 0), 100),
    h_e20: ema(c1h, 20), h_e50: ema(c1h, 50), h_e200: ema(c1h, 200), h_adx: adx(S.b1h, 14), h_atr: atr(S.b1h, 14), h_rsi: rsi(c1h, 14),
    q_e50: ema(c4h, 50), q_e200: ema(c4h, 200),
    d_e20: ema(c1d, 20), d_e50: ema(c1d, 50)
  };
}

function fundingAt(S, t) {
  let r = null; for (const [ft, v] of S.funding) { if (ft <= t) r = v; else break; } return r;
}

function features(S, P, i, side, btc) {
  const t = S.b15[i].t, { i4, i1, id } = htfState(S, t);
  const dir = side === "BUY" ? 1 : -1;
  const b = S.b15[i - 1];
  const f = {
    h4Trend: i4 >= 0 && P.q_e200[i4] != null ? Math.sign(P.q_e50[i4] - P.q_e200[i4]) * dir : null,
    h4Above: i4 >= 0 && P.q_e50[i4] != null ? Math.sign(S.b4h[i4].c - P.q_e50[i4]) * dir : null,
    h1Trend: i1 >= 0 && P.h_e50[i1] != null ? Math.sign(P.h_e20[i1] - P.h_e50[i1]) * dir : null,
    h1Long: i1 >= 0 && P.h_e200[i1] != null ? Math.sign(P.h_e50[i1] - P.h_e200[i1]) * dir : null,
    dTrend: id >= 0 && P.d_e50[id] != null ? Math.sign(P.d_e20[id] - P.d_e50[id]) * dir : null,
    adx1h: i1 >= 0 && P.h_adx[i1] ? P.h_adx[i1].adx : null,
    rsi15: P.rsi15[i - 1], rsi1h: i1 >= 0 ? P.h_rsi[i1] : null,
    volRatio: P.vol20[i - 2] ? b.qv / P.vol20[i - 2] : null,
    atrPct: P.atr15[i - 1] / b.c * 100,
    atrRegime: P.atr100[i - 1] ? P.atr15[i - 1] / P.atr100[i - 1] : null,
    takerBuy: b.v ? b.tb / b.v : null,
    funding: fundingAt(S, t),
    hourUtc: new Date(t).getUTCHours()
  };
  if (btc) {
    const j4 = lastClosedIdx(btc.S.b4h, H4, t), jd = lastClosedIdx(btc.S.b1d, DAY, t);
    f.btc4h = j4 >= 0 && btc.P.q_e200[j4] != null ? Math.sign(btc.P.q_e50[j4] - btc.P.q_e200[j4]) * dir : null;
    f.btcD = jd >= 0 && btc.P.d_e50[jd] != null ? Math.sign(btc.P.d_e20[jd] - btc.P.d_e50[jd]) * dir : null;
  }
  return f;
}

/* ---------- OLD: المحرّك الحيّ حرفياً ---------- */
function* oldSignals(S) {
  const b = S.b15, n = b.length;
  const c = b.map(x => x.c);
  const s200 = sma(c, 200), s35 = sma(c, 35), s50 = sma(c, 50);
  for (let i = 400; i < n; i++) {
    /* فحص سريع مكافئ لـ evaluate15m قبل الاستدعاء الكامل (SMA على المغلقة 0..i-1) */
    const sm = s200[i - 1], smPrev = s200[i - 2], o = b[i].o;
    const buy = o > sm && b[i - 1].o <= smPrev && s35[i - 1] < sm && s50[i - 1] < sm;
    const sell = o < sm && b[i - 1].o >= smPrev && s35[i - 1] > sm && s50[i - 1] > sm;
    if (!buy && !sell) continue;
    const t = b[i].t;
    const ws = utcWeekStart(t);
    let wh = -Infinity, wl = Infinity;
    for (let j = i - 1; j >= 0 && b[j].t >= ws - 7 * DAY; j--) if (b[j].t < ws) { wh = Math.max(wh, b[j].h); wl = Math.min(wl, b[j].l); }
    const r = evaluateCandleOpen({ closed15: b.slice(Math.max(0, i - 900), i), openTime: t, openPrice: o,
      weekly: Number.isFinite(wh) ? { high: wh, low: wl } : null });
    if (!r.signal || !r.plan) continue;
    yield { i, side: r.side, entry: o, stop: r.plan.stop, targetsLive: r.plan.targets, atr: r.atr15,
      expiryMs: utcDayStart(t) + 6 * DAY - t, score: r.score.total, hourConfirmed: r.hourConfirmed };
  }
}

/* ---------- PB: ارتدادٌ في اتجاه الفريمات الأعلى ---------- */
function* pbSignals(S, P) {
  const b = S.b15;
  for (let i = 300; i < b.length; i++) {
    const t = b[i].t, { i4, i1 } = htfState(S, t);
    if (i4 < 0 || i1 < 0 || P.q_e200[i4] == null || P.h_e50[i1] == null) continue;
    const a = P.atr15[i - 1]; if (!a) continue;
    for (const side of ["BUY", "SELL"]) {
      const d = side === "BUY" ? 1 : -1;
      const up4 = (P.q_e50[i4] - P.q_e200[i4]) * d > 0 && (S.b4h[i4].c - P.q_e50[i4]) * d > 0;
      const up1 = (P.h_e20[i1] - P.h_e50[i1]) * d > 0;
      if (!up4 || !up1) continue;
      /* ارتدادٌ خلال آخر 6 شموع لمس EMA50 (15د) أو هبط RSI دون 40 (للشراء) */
      let touched = false;
      for (let j = i - 6; j < i; j++) {
        if ((d > 0 ? b[j].l <= P.e50[j] : b[j].h >= P.e50[j]) || (d > 0 ? P.rsi15[j] < 40 : P.rsi15[j] > 60)) { touched = true; break; }
      }
      if (!touched) continue;
      const k = b[i - 1], p = b[i - 2];
      /* الاستئناف: إغلاقٌ عائدٌ فوق EMA20 وشمعةٌ في الاتجاه تتجاوز قمّة السابقة */
      const resume = (k.c - P.e20[i - 1]) * d > 0 && (k.c - k.o) * d > 0 && (d > 0 ? k.c > p.h : k.c < p.l);
      if (!resume) continue;
      let ext = d > 0 ? Infinity : -Infinity;
      for (let j = i - 8; j < i; j++) ext = d > 0 ? Math.min(ext, b[j].l) : Math.max(ext, b[j].h);
      const entry = b[i].o, stop = ext - d * 0.2 * a, risk = (entry - stop) * d;
      if (!(risk > 0) || risk / a < 0.5 || risk / a > 4) continue;
      yield { i, side, entry, stop, atr: a };
    }
  }
}

/* ---------- BO: اختراق قناة بحجم ---------- */
function* boSignals(S, P) {
  const b = S.b15;
  for (let i = 300; i < b.length; i++) {
    const t = b[i].t, { i4 } = htfState(S, t);
    if (i4 < 0 || P.q_e200[i4] == null) continue;
    const a = P.atr15[i - 1]; if (!a) continue;
    const k = b[i - 1];
    let hh = -Infinity, ll = Infinity;
    for (let j = i - 49; j < i - 1; j++) { hh = Math.max(hh, b[j].h); ll = Math.min(ll, b[j].l); }
    const vr = P.vol20[i - 2] ? k.qv / P.vol20[i - 2] : 0;
    if (vr < 1.8) continue;
    for (const side of ["BUY", "SELL"]) {
      const d = side === "BUY" ? 1 : -1;
      if ((P.q_e50[i4] - P.q_e200[i4]) * d <= 0) continue;
      if (!(d > 0 ? k.c > hh : k.c < ll)) continue;
      const entry = b[i].o;
      const stop = d > 0 ? Math.max(k.l, entry - 2 * a) - 0.1 * a : Math.min(k.h, entry + 2 * a) + 0.1 * a;
      const risk = (entry - stop) * d;
      if (!(risk > 0) || risk / a < 0.5) continue;
      yield { i, side, entry, stop, atr: a };
    }
  }
}

export function run({ strategies = ["OLD", "PB", "BO"] } = {}) {
  const syms = universe();
  const btcS = loadSymbol("BTCUSDT"); const btc = { S: btcS, P: prep(btcS) };
  const out = [];
  for (const sym of syms) {
    const S = sym === "BTCUSDT" ? btcS : loadSymbol(sym);
    if (!S) continue;
    const P = sym === "BTCUSDT" ? btc.P : prep(S);
    const gens = { OLD: () => oldSignals(S), PB: () => pbSignals(S, P), BO: () => boSignals(S, P) };
    let cnt = 0;
    for (const st of strategies) {
      for (const g of gens[st]()) {
        const t = S.b15[g.i].t;
        const rec = { strat: st, sym, t, side: g.side, entry: g.entry, stop: g.stop,
          riskPct: Math.abs(g.entry - g.stop) / g.entry * 100, riskAtr: Math.abs(g.entry - g.stop) / g.atr,
          score: g.score, hourConfirmed: g.hourConfirmed, f: features(S, P, g.i, g.side, btc), res: {} };
        const dir = g.side === "BUY" ? 1 : -1, risk = Math.abs(g.entry - g.stop);
        if (st === "OLD") {
          rec.res.liveExact = simulate(S, { t, side: g.side, entry: g.entry, stop: g.stop, targets: g.targetsLive, atr: g.atr },
            { split: [1 / 3, 1 / 3, 1 / 3], be: 1, expiryMs: g.expiryMs });
        }
        for (const [name, e] of Object.entries(EXITS)) {
          const targets = e.targetsR.map(r => g.entry + dir * r * risk);
          rec.res[name] = simulate(S, { t, side: g.side, entry: g.entry, stop: g.stop, targets, split: e.split, atr: g.atr },
            { be: e.be, beOffsetR: e.beOffsetR, trailAtr: e.trailAtr, trailAfter: e.trailAfter, expiryMs: st === "OLD" ? g.expiryMs : 3 * DAY });
        }
        out.push(rec); cnt++;
      }
    }
    console.log(new Date().toISOString(), sym, cnt);
  }
  fs.writeFileSync(path.join(DIR, "signals.json"), JSON.stringify(out));
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("backtest.mjs")) run();
