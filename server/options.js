/* =====================================================================
   اختيار عقد الخيارات — دوالّ نقيّة + جالبُ بيانات.

   مبدأ: لا عقدَ مناسبٌ ⇒ لا فرصة. لا نختلق عقداً أبداً ولا نخفّف
   الشروط تلقائياً لنجد «شيئاً».

   اتجاه الأصل الأساسي صاعدٌ ⇒ CALL ، هابطٌ ⇒ PUT. شراءُ عقدٍ فقط؛ أقصى
   خسارةٍ = العلاوة المدفوعة.
   ===================================================================== */
import { bget } from "./binance.js";

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/* @param contracts مصفوفةٌ موحَّدة:
   { symbol, underlying, side:'CALL'|'PUT', strike, expiry, delta, gamma, theta, vega, markIV, bidIV, askIV,
     bid, ask, mark, volume, openInterest, unit } */
export function selectOption({ direction, contracts, now, settings }) {
  const want = direction === "BUY" ? "CALL" : "PUT";
  const S = settings;
  const rejected = { side: 0, dte: 0, delta: 0, noQuote: 0, spread: 0, oi: 0, volume: 0 };
  const pool = [];
  for (const c of contracts) {
    if (c.side !== want) { rejected.side++; continue; }
    const dteH = (c.expiry - now) / 36e5;
    if (dteH < S.minDteHours || dteH > S.maxDteDays * 24) { rejected.dte++; continue; }
    const ad = Math.abs(c.delta);
    if (!(ad >= S.deltaMin && ad <= S.deltaMax)) { rejected.delta++; continue; }
    if (!(c.bid > 0 && c.ask > 0 && c.ask >= c.bid)) { rejected.noQuote++; continue; }
    const mid = (c.bid + c.ask) / 2;
    const spreadPct = (c.ask - c.bid) / mid * 100;
    if (spreadPct > S.maxSpreadPct) { rejected.spread++; continue; }
    if ((c.openInterest || 0) < S.minOpenInterest) { rejected.oi++; continue; }
    if ((c.volume || 0) < S.minVolume24h) { rejected.volume++; continue; }
    pool.push({ ...c, dteH, spreadPct, mid });
  }
  if (!pool.length) return { selected: null, rejected, considered: contracts.length };

  const half = Math.max((S.deltaMax - S.deltaMin) / 2, 1e-9);
  const ivs = pool.map(c => c.markIV).filter(x => x > 0).sort((a, b) => a - b);
  const medIv = ivs.length ? ivs[Math.floor(ivs.length / 2)] : null;

  for (const c of pool) {
    const thetaPctDay = c.ask > 0 ? Math.abs(c.theta) / c.ask * 100 : 100;
    const parts = {
      delta: clamp(1 - Math.abs(Math.abs(c.delta) - S.deltaTarget) / half),
      spread: clamp(1 - c.spreadPct / S.maxSpreadPct),
      liquidity: clamp(0.6 * Math.log10(1 + c.openInterest) / 2.5 + 0.4 * Math.log10(1 + c.volume) / 2),
      theta: clamp(1 - (thetaPctDay - 3) / 17),
      iv: medIv && c.markIV > 0 ? clamp(1 - (c.markIV / medIv - 0.8) / 0.6) : 0.5
    };
    const w = { delta: 30, spread: 25, liquidity: 20, theta: 15, iv: 10 };
    c.thetaPctDay = thetaPctDay;
    c.selection = {
      score: Math.round(Object.entries(w).reduce((a, [k, v]) => a + parts[k] * v, 0) * 10) / 10,
      parts
    };
  }
  pool.sort((a, b) => b.selection.score - a.selection.score);
  return { selected: pool[0], runnersUp: pool.slice(1, 4), rejected, considered: contracts.length };
}

/* هدفٌ تقديريٌّ لعلاوة العقد عند بلوغ الأصل مستوى معيّناً:
   دلتا + ½ غاما × ΔS² + ثيتا × (ساعات الاحتفاظ/24). نموذجٌ تقريبي يُعلَن
   كذلك؛ والمتابعة الفعلية تعتمد سعر العقد نفسه لا هذا التقدير. */
export function modelPremium({ ask, delta, gamma, theta, dS, holdHours }) {
  const v = ask + delta * dS + 0.5 * gamma * dS * dS + theta * (holdHours / 24);
  return Math.max(v, 0);
}

export function optionPlan({ contract, underlyingEntry, underlyingTargets, settings }) {
  const ask = contract.ask;
  const targets = underlyingTargets.map(T => {
    const p = modelPremium({
      ask, delta: contract.delta, gamma: contract.gamma, theta: contract.theta,
      dS: T - underlyingEntry, holdHours: settings.holdHoursModel
    });
    return Math.max(p, ask * 1.2);       // لا هدف أقلّ من +20% (غير مجزٍ بعد الرسوم والسبريد)
  });
  const stop = ask * (1 - settings.stopLossPct / 100);
  return { entry: ask, stop, targets, maxLossPerContract: ask * (contract.unit || 1) };
}

/* ---------------- الجلب ---------------- */
let cache = { at: 0, exch: null, exchAt: 0 };

export async function loadOptionUniverse(force = false) {
  if (!force && cache.exch && Date.now() - cache.exchAt < 30 * 60e3) return cache.exch;
  const info = await bget("options", "/eapi/v1/exchangeInfo", {}, { weight: 1 });
  const underlyings = new Map();
  for (const c of info.optionContracts) underlyings.set(c.underlying, c);
  const symbols = new Map();
  for (const s of info.optionSymbols) {
    if (s.status !== "TRADING") continue;
    symbols.set(s.symbol, {
      symbol: s.symbol, underlying: s.underlying, side: s.side, strike: +s.strikePrice,
      expiry: s.expiryDate, unit: s.unit, minQty: +s.minQty
    });
  }
  cache.exch = { underlyings, symbols, serverTime: info.serverTime };
  cache.exchAt = Date.now();
  return cache.exch;
}

function expiryCode(ms) {
  const d = new Date(ms);
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return yy + mm + dd;
}

/* يجلب العقود الحيّة (Greeks + سعر عرض/طلب + حجم + مراكز مفتوحة) لأصلٍ واحد. */
export async function fetchChain(underlying) {
  const uni = await loadOptionUniverse();
  const mine = [...uni.symbols.values()].filter(s => s.underlying === underlying);
  if (!mine.length) return { contracts: [], note: "لا عقود مدرجة لهذا الأصل" };

  const [mark, ticker] = await Promise.all([
    bget("options", "/eapi/v1/mark", {}, { weight: 5 }),
    bget("options", "/eapi/v1/ticker", {}, { weight: 5 })
  ]);
  const mk = new Map(mark.map(m => [m.symbol, m]));
  const tk = new Map(ticker.map(t => [t.symbol, t]));

  /* OI لكل تاريخ انتهاء (يُجلب فقط للتواريخ التي فيها عقودٌ مرشَّحة بالدلتا) */
  const base = uni.underlyings.get(underlying)?.baseAsset || underlying.replace(/USDT$/, "");
  const exps = [...new Set(mine.map(s => s.expiry))];
  const oi = new Map();
  await Promise.all(exps.map(async e => {
    try {
      const rows = await bget("options", "/eapi/v1/openInterest",
        { underlyingAsset: base, expiration: expiryCode(e) }, { weight: 0, retries: 1 });
      for (const r of rows) oi.set(r.symbol, +r.sumOpenInterest);
    } catch { /* نكمل بلا OI لهذا التاريخ */ }
  }));

  const contracts = [];
  for (const s of mine) {
    const m = mk.get(s.symbol), t = tk.get(s.symbol);
    if (!m) continue;
    contracts.push({
      ...s,
      delta: +m.delta, gamma: +m.gamma, theta: +m.theta, vega: +m.vega,
      markIV: +m.markIV, bidIV: +m.bidIV, askIV: +m.askIV, mark: +m.markPrice,
      bid: t ? +t.bidPrice : 0, ask: t ? +t.askPrice : 0,
      volume: t ? +t.volume : 0, amount: t ? +t.amount : 0,
      lastPrice: t ? +t.lastPrice : 0,
      openInterest: oi.get(s.symbol) || 0,
      riskFree: +m.riskFreeInterest
    });
  }
  return { contracts };
}

/* لقطةٌ لعقدٍ واحد للمتابعة. */
export async function fetchContractQuote(symbol) {
  const [t, m] = await Promise.all([
    bget("options", "/eapi/v1/ticker", { symbol }, { weight: 1 }),
    bget("options", "/eapi/v1/mark", { symbol }, { weight: 1 })
  ]);
  const tt = Array.isArray(t) ? t[0] : t, mm = Array.isArray(m) ? m[0] : m;
  return {
    bid: tt ? +tt.bidPrice : 0, ask: tt ? +tt.askPrice : 0, last: tt ? +tt.lastPrice : 0,
    mark: mm ? +mm.markPrice : 0, delta: mm ? +mm.delta : null, iv: mm ? +mm.markIV : null
  };
}
