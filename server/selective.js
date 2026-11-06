/* =====================================================================
   المحرّك المنتقي — MR20 (ارتداد التشبّع البيعي الحادّ داخل اتجاهٍ صاعد).

   لماذا هذه القاعدة وحدها؟ اختُبرت 5 عائلات × 11 نموذج خروج على 30 عقداً
   و13 شهراً (research/). كلّها عند مستوى العشوائية خارج العيّنة، إلا هذه:
   OOS (2026-07 → 2026-11): n=89، الهدف الأول قبل الوقف 58.4%، متوسط +0.31R،
   PF 1.68. العيّنة صغيرة والدليل غير قاطع؛ لذا تُتابَع ورقياً وتُعرض أرقامها.

   الشروط (كلّها على شموعٍ مغلقة من عقود USDT-M):
   1) RSI(14) لآخر ساعةٍ مغلقة < 20.
   2) اتجاه العملة اليومي صاعد: EMA20 > EMA50 على الإغلاقات اليومية المغلقة.
   3) اتجاه BTC اليومي صاعد بالتعريف نفسه.
   4) الدخول عند افتتاح الساعة التالية (خلال نافذةٍ قصيرة، وإلا تُعدّ متأخّرة).
   5) الوقف = الدخول − 1.5×ATR(14) ساعة؛ الأهداف 1R/2R/3R بثلث لكلٍّ،
      والوقف إلى الدخول بعد الهدف الأول؛ الصلاحية 3 أيام.
   حواجز تكلفة (غير مختبرة تاريخياً، احترازية): سبريد ≤ 0.10% وتكلفة/مخاطرة ≤ 15%.
   شراء فقط: جهة البيع من العائلة نفسها خاسرة خارج العيّنة (PF 0.53).
   ===================================================================== */
import { fetchKlines } from "./binance.js";
import { ema, rsi, atr } from "./ta.js";
import { initTrack } from "./tracker.js";
import * as DB from "./db.js";

const H1 = 3600e3, DAY = 86400e3;
export const MR20 = {
  id: "mr20", rsiMax: 20, stopAtr: 1.5, targetsR: [1, 2, 3], split: [1 / 3, 1 / 3, 1 / 3],
  expiryMs: 3 * DAY, entryWindowMs: 10 * 60e3, maxSpreadPct: 0.10, maxCostOverRisk: 0.15,
  /* نتائج التحقق المعلنة (research/mr-rsi.mjs، 2026-11-06) */
  validation: {
    period: "OOS 2026-07-01 → 2026-11-06 (لم تُستعمل في التطوير)", universe: "أعلى 30 عقداً سيولةً (لا كون الأعلى ربحاً)",
    n: 89, tp1BeforeStopPct: 58.4, tp2Pct: 43.8, slFirstPct: 40.4, winPct: 57.3, avgR: 0.307, pf: 1.68, maxDDR: 23.8,
    dev: { n: 26, tp1BeforeStopPct: 84.6, avgR: 0.542, pf: 4.24 },
    costs: "رسوم 0.05% لكل جهة + انزلاق 2bps (مضاعف للوقف) + نصف سبريد 0.01% + التمويل التاريخي الفعلي",
    caveat: "عيّنةٌ صغيرة وأحداثٌ متركّزة في موجات هبوطٍ عامة؛ فاصل الثقة واسع. ليست ضماناً."
  }
};

/* فاصل ثقة Wilson 95% لنسبة */
export function wilson(p, n, z = 1.96) {
  if (!n) return [0, 1];
  const d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

/* نقيّ: تقييم القاعدة على شموعٍ مغلقة. h1/d1/btcD1 = مصفوفات {t,o,h,l,c} مغلقة ومرتّبة */
export function evaluateMR20({ h1, d1, btcD1, cfg = MR20 }) {
  const out = { pass: false, checks: [], rsi: null, atr: null };
  if (h1.length < 60 || d1.length < 55 || btcD1.length < 55) { out.checks.push({ ok: false, text: "تاريخٌ غير كافٍ" }); return out; }
  const r = rsi(h1.map(k => k.c), 14), a = atr(h1, 14);
  const de20 = ema(d1.map(k => k.c), 20), de50 = ema(d1.map(k => k.c), 50);
  const be20 = ema(btcD1.map(k => k.c), 20), be50 = ema(btcD1.map(k => k.c), 50);
  const i = h1.length - 1, j = d1.length - 1, b = btcD1.length - 1;
  out.rsi = r[i]; out.atr = a[i]; out.hourT = h1[i].t;
  const c1 = r[i] < cfg.rsiMax, c2 = de20[j] > de50[j], c3 = be20[b] > be50[b];
  out.checks.push({ ok: c1, text: `RSI ساعة = ${r[i]?.toFixed(1)} (المطلوب < ${cfg.rsiMax})` });
  out.checks.push({ ok: c2, text: `اتجاه العملة اليومي ${c2 ? "صاعد" : "غير صاعد"} (EMA20 ${c2 ? ">" : "≤"} EMA50)` });
  out.checks.push({ ok: c3, text: `اتجاه BTC اليومي ${c3 ? "صاعد" : "غير صاعد"}` });
  out.pass = c1 && c2 && c3 && a[i] > 0;
  return out;
}

/* نقيّ: الخطة من سعر الدخول وATR */
export function planMR20(entry, atrH1, cfg = MR20) {
  const risk = cfg.stopAtr * atrH1, stop = entry - risk;
  return { entry, stop, risk, riskPct: risk / entry, targets: cfg.targetsR.map(m => entry + m * risk), rr: cfg.targetsR.slice(),
    entryZone: [entry - 0.1 * risk, entry + 0.25 * risk] };
}

export class SelectiveEngine {
  constructor({ engine, gainers, log }) {
    this.engine = engine; this.gainers = gainers; this.log = log;
    this.status = new Map();            // symbol(spot) → حالة التحليل المعروضة
    this.cache = new Map();             // futuresSymbol → {h1, d1, hourT, dayT}
    this.btc = null; this.lastRunAt = 0; this.running = false;
  }
  now() { return this.engine.now(); }

  async _klines(fsym, interval, limit) {
    return (await fetchKlines("futures", fsym, interval, { limit })).filter(k => k.ct < this.now());
  }
  async _series(fsym) {
    const hourStart = Math.floor(this.now() / H1) * H1, dayStart = Math.floor(this.now() / DAY) * DAY;
    let c = this.cache.get(fsym);
    if (!c || c.hourT < hourStart) {
      const h1 = await this._klines(fsym, "1h", 300);
      const d1 = !c || c.dayT < dayStart ? await this._klines(fsym, "1d", 120) : c.d1;
      c = { h1, d1, hourT: hourStart, dayT: dayStart };
      this.cache.set(fsym, c);
    }
    return c;
  }

  /* كل دقيقة: يحلّل كل عملات القائمة الحالية؛ والإصدار فقط قرب افتتاح الساعة */
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const snap = this.gainers.snapshot();
      const btc = await this._series("BTCUSDT");
      const hourStart = Math.floor(this.now() / H1) * H1;
      const inWindow = this.now() - hourStart <= MR20.entryWindowMs;
      const seen = new Set();
      for (const g of snap.list) {
        seen.add(g.symbol);
        const st = { symbol: g.symbol, futuresSymbol: g.futuresSymbol, rank: g.rank, changePct: g.changePct,
          quoteVolume24h: g.quoteVolume24h, evaluatedAt: this.now(), state: "", checks: [], rsi: null };
        if (!g.futuresSymbol) { st.state = "no_futures"; st.note = "لا يوجد عقد USDT-M دائم لهذه العملة — تحليل Futures غير ممكن"; this.status.set(g.symbol, st); continue; }
        try {
          const s = await this._series(g.futuresSymbol);
          const ev = evaluateMR20({ h1: s.h1, d1: s.d1, btcD1: btc.d1 });
          st.checks = ev.checks; st.rsi = ev.rsi; st.state = ev.pass ? "signal" : "no_signal";
          if (ev.pass) {
            if (!inWindow) { st.state = "late"; st.note = "تحقّقت الشروط لكن خارج نافذة الدخول (أول 10 دقائق من الساعة) — لا إصدار متأخّر"; }
            else st.issued = await this._issue(g, ev);
          }
        } catch (e) { st.state = "error"; st.note = "تعذّر جلب البيانات: " + String(e.message).slice(0, 120); }
        this.status.set(g.symbol, st);
      }
      /* من خرج من القائمة: يتوقّف تحليله، وصفقاته المفتوحة تبقى متابَعةً في المتعقّب */
      for (const k of [...this.status.keys()]) if (!seen.has(k)) this.status.delete(k);
      this.lastRunAt = this.now();
    } catch (e) { this.log(`[selective] ${e.message}`); }
    finally { this.running = false; }
  }

  async _issue(g, ev) {
    const E = this.engine, S = E.settings, fsym = g.futuresSymbol;
    const candleT = Math.floor(this.now() / H1) * H1;
    if (DB.queryOpportunities({ engine: MR20.id, symbol: fsym, open: true, limit: 5 }).some(o => o.symbol === fsym)) return "open_exists";
    /* لا إصدار قبل أن يصل تيّار السعر الحيّ للعقد — وإلا قد يفوت ضربُ وقفٍ أو هدف */
    const feed = E.feeds.futures;
    if (!feed?.trackedSet?.has(fsym) || !feed.getLast(fsym)) {
      feed?.ensureTracked([fsym]).catch(() => {});
      return "stream_not_ready";
    }
    const quote = await E._fetchQuote("futures", fsym);
    if (!(quote.ask > 0)) return "no_quote";
    const entry = quote.ask, plan = planMR20(entry, ev.atr);
    const feePct = S.costs.futuresFeePct, slip = S.costs.slippageBps / 100, halfSpreadPct = (quote.spreadPct || 0) / 2;
    const roundTrip = 2 * feePct + 2 * slip + (quote.spreadPct || 0);
    const costOverRisk = roundTrip / (plan.riskPct * 100);
    if ((quote.spreadPct || 0) > MR20.maxSpreadPct) return "spread";
    if (costOverRisk > MR20.maxCostOverRisk) return "cost";
    const now = this.now(), last = E.feeds.futures?.getLast(fsym);
    const st = initTrack({
      side: "BUY", entry, stop: plan.stop, targets: plan.targets, issuedAt: now, expiresAt: now + MR20.expiryMs,
      emitCandleT: last?.t ?? candleT, sma200: null, seenHi: last?.h ?? entry, seenLo: last?.l ?? entry,
      plan: { tpSplit: MR20.split, breakevenAfterTp1: true, cancelOnSmaClose: false },
      feePct, halfSpreadPct, costs: S.costs, market: "FUTURES",
      funding: { pct8h: quote.fundingPct8h, next: quote.nextFundingTime }
    });
    const [lo, hi] = wilson(MR20.validation.tp1BeforeStopPct / 100, MR20.validation.n);
    const data = {
      engine: MR20.id, strategy: "MR20 — ارتداد تشبّع بيعي حادّ داخل اتجاهٍ يومي صاعد",
      source: { list: "Binance Top Gainers", spotSymbol: g.symbol, rank: g.rank, change24hPct: g.changePct },
      checks: ev.checks, rsi1h: ev.rsi, atr1h: ev.atr,
      plan: { ...plan, split: MR20.split, breakeven: true, expiresAt: now + MR20.expiryMs },
      stopReason: `1.5 × ATR(14) لشموع الساعة = ${(plan.risk).toPrecision(4)} تحت الدخول — مسافةٌ تتّسع لتذبذب الساعة الطبيعي`,
      cancelBefore: [
        `لا تدخل إن تجاوز السعر ${plan.entryZone[1].toPrecision(6)} (ابتعد 0.25R فوق منطقة الدخول) — نسبة العائد للمخاطرة تسوء`,
        `تُلغى إن لامس السعر الوقف ${plan.stop.toPrecision(6)} قبل دخولك`,
        "تُلغى إن انقلب اتجاه BTC اليومي هابطاً قبل الدخول",
        "تُلغى إن مرّت 10 دقائق على افتتاح الساعة دون دخول"
      ],
      confidence: { tp1BeforeStopPct: MR20.validation.tp1BeforeStopPct, ci95: [Math.round(lo * 1000) / 10, Math.round(hi * 1000) / 10],
        basis: `اختبار خارج العيّنة n=${MR20.validation.n} — ${MR20.validation.period}` },
      risk: { level: plan.riskPct * 100 > 4 ? "مرتفع" : plan.riskPct * 100 > 2 ? "متوسّط" : "منخفض", riskPct: plan.riskPct * 100, costOverRisk },
      quote: { ...quote, entrySource: "ask" },
      costModel: { feePctPerSide: feePct, slippageBps: S.costs.slippageBps, stopSlippageMult: S.costs.stopSlippageMult, halfSpreadPct },
      track: st
    };
    const row = {
      engine: MR20.id, market: "FUTURES", symbol: fsym, side: "BUY", candle_open_ts: candleT, status: "new",
      score: null, exec_quality: null, hour_confirmed: null,
      entry, stop: plan.stop, tp1: plan.targets[0], tp2: plan.targets[1], tp3: plan.targets[2],
      candle_arrived_at: now, detected_at: now, issued_at: now, data
    };
    const id = E._insertAndTrack(row, st, "FUTURES");
    return id ? "issued" : "duplicate";
  }

  start() {
    const tick = () => this.run().catch(e => this.log(`[selective] ${e.message}`));
    setTimeout(tick, 20e3);
    /* بعد كل افتتاح ساعة بـ15ث (اكتمال الشمعة لدى Binance) ثم كل دقيقة */
    this._t = setInterval(tick, 60e3);
  }
  stop() { clearInterval(this._t); }

  snapshot() {
    const open = DB.queryOpportunities({ engine: MR20.id, open: true, limit: 100 }).map(o => this.engine.publicOpp(o));
    const recent = DB.queryOpportunities({ engine: MR20.id, limit: 30 }).map(o => this.engine.publicOpp(o));
    const fresh = open.filter(o => this.now() - o.issued_at < MR20.entryWindowMs);
    return { rule: MR20, lastRunAt: this.lastRunAt, statuses: [...this.status.values()].sort((a, b) => (a.rank || 99) - (b.rank || 99)),
      open, recent, actionable: fresh,
      verdict: fresh.length ? `${fresh.length} فرصة مستوفية للشروط الآن` : "لا توجد فرصة مناسبة حاليًا" };
  }
}
