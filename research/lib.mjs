/* =====================================================================
   مكتبة البحث — تحضير البيانات، مؤشّرات بلا تسريب، محاكي مسارٍ محافظ،
   ومقاييس الأداء. كل الحسابات بعد الرسوم والانزلاق والتمويل.

   قواعد المحاكي (موحّدة لكل الاستراتيجيات، القديمة والجديدة):
   - الدخول عند افتتاح شمعة 15د التالية لاكتمال الإشارة (لا شمعة لم تُغلق).
   - المسار على شموع 5د. داخل الشمعة الواحدة: الوقف قبل الهدف دائماً إن ظهرا
     معاً، والوقف المنقول بعد هدفٍ يُفحص على الشمعة نفسها (أسوأ ترتيبٍ ممكن).
   - الوقف يُنفَّذ عند مستواه، أو عند الافتتاح إن افتُتحت الشمعة خلفه (فجوة).
   - الأهداف تُنفَّذ عند مستواها فقط إذا تجاوزها السعر (لمسٌ مجرّد لا يكفي:
     يلزم أن يتعدّاها بـ tick تقريبي = 0.01% من السعر).
   - التكاليف: رسوم taker لكل جهة + انزلاق (مضاعف للوقف) + نصف سبريد،
     والتمويل الفعلي التاريخي لمدّة الاحتفاظ (Futures).
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { DIR, load } from "./klines.mjs";
import { ema, sma, atr, rsi } from "../server/ta.js";
export { ema, sma, atr, rsi };

export const M5 = 300e3, M15 = 900e3, H1 = 3600e3, H4 = 4 * H1, DAY = 86400e3;

/* ---------- تجميع الفريمات ---------- */
export function aggregate(rows5, span) {
  const out = [];
  let cur = null;
  for (const r of rows5) {
    const t = Math.floor(r[0] / span) * span;
    if (!cur || cur.t !== t) {
      if (cur && cur.n === span / M5) out.push(cur);
      cur = { t, o: r[1], h: r[2], l: r[3], c: r[4], v: r[5], qv: r[6], tb: r[7], n: 1 };
    } else {
      cur.h = Math.max(cur.h, r[2]); cur.l = Math.min(cur.l, r[3]); cur.c = r[4];
      cur.v += r[5]; cur.qv += r[6]; cur.tb += r[7]; cur.n++;
    }
  }
  if (cur && cur.n === span / M5) out.push(cur);
  return out;
}

/* ---------- مؤشّرات: القيمة عند i تستعمل الشموع 0..i (المغلقة) فقط ---------- */
export function adx(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let tr = 0, pdm = 0, ndm = 0, adxv = null, dxs = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    const up = b.h - p.h, dn = p.l - b.l;
    const t = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    const pd = up > dn && up > 0 ? up : 0, nd = dn > up && dn > 0 ? dn : 0;
    if (i <= n) { tr += t; pdm += pd; ndm += nd; if (i < n) continue; }
    else { tr = tr - tr / n + t; pdm = pdm - pdm / n + pd; ndm = ndm - ndm / n + nd; }
    const pdi = 100 * pdm / tr, ndi = 100 * ndm / tr, dx = 100 * Math.abs(pdi - ndi) / ((pdi + ndi) || 1e-12);
    if (adxv == null) { dxs.push(dx); if (dxs.length === n) adxv = dxs.reduce((a, x) => a + x, 0) / n; }
    else adxv = (adxv * (n - 1) + dx) / n;
    out[i] = adxv == null ? null : { adx: adxv, pdi, ndi };
  }
  return out;
}
export function rollMax(vals, n) { const out = new Array(vals.length).fill(null); for (let i = n - 1; i < vals.length; i++) { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) m = Math.max(m, vals[j]); out[i] = m; } return out; }
export function rollMin(vals, n) { const out = new Array(vals.length).fill(null); for (let i = n - 1; i < vals.length; i++) { let m = Infinity; for (let j = i - n + 1; j <= i; j++) m = Math.min(m, vals[j]); out[i] = m; } return out; }

/* قيمة فريمٍ أعلى «آخر شمعة مغلقة قبل t» — البحث الثنائي يمنع التسريب */
export function lastClosedIdx(bars, span, t) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].t + span <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

/* ---------- تحميل رمز كاملاً ---------- */
export function loadSymbol(sym) {
  const r5 = load(sym, "5m");
  if (!r5.length) return null;
  const b5 = r5.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5], qv: r[6], tb: r[7] }));
  const fundingF = path.join(DIR, `${sym}_funding.json`);
  const funding = fs.existsSync(fundingF) ? JSON.parse(fs.readFileSync(fundingF, "utf8")) : [];
  const b15 = aggregate(r5, M15), b1h = aggregate(r5, H1), b4h = aggregate(r5, H4), b1d = aggregate(r5, DAY);
  const idx5 = new Map(b5.map((b, i) => [b.t, i]));
  return { sym, b5, b15, b1h, b4h, b1d, funding, idx5 };
}

/* ---------- المحاكي ---------- */
export const COSTS = { feePct: 0.05, slippageBps: 2, stopSlippageMult: 2, halfSpreadPct: 0.01 };

function legNet(side, entry, exit, kind, c) {
  const dir = side === "BUY" ? 1 : -1;
  const gross = dir * (exit - entry) / entry * 100;
  const slip = c.slippageBps / 100;
  const cost = 2 * c.feePct + slip + (kind === "stop" ? slip * c.stopSlippageMult : slip) + c.halfSpreadPct;
  return gross - cost;
}
function fundingPct(funding, side, from, to) {
  if (!funding.length) return 0;
  let s = 0;
  for (const [t, r] of funding) if (t > from && t <= to) s += r;
  return (side === "BUY" ? -1 : 1) * s * 100;   // الطويل يدفع التمويل الموجب
}

/**
 * sig: { t (افتتاح شمعة الدخول), side, entry, stop, targets[], split[] }
 * opts: { be: رقم الهدف الذي يُنقل بعده الوقف للدخول (0 = لا نقل), beOffsetR, trailAtr, trailAfter, expiryMs, costs }
 */
export function simulate(S, sig, opts = {}) {
  const c = opts.costs || COSTS;
  const buy = sig.side === "BUY", dir = buy ? 1 : -1;
  const risk = Math.abs(sig.entry - sig.stop);
  const split = sig.split || opts.split || [1 / 3, 1 / 3, 1 / 3];
  const legs = sig.targets.map((tp, i) => ({ w: split[i] ?? 0, tp, open: (split[i] ?? 0) > 0, exit: null, kind: null, ts: null }));
  let stop = sig.stop, hits = 0, beMoved = false, mfe = 0, mae = 0;
  const tick = sig.entry * 1e-4;
  const expiry = sig.t + (opts.expiryMs ?? 6 * DAY);
  let i = S.idx5.get(sig.t);
  if (i == null) return null;
  let trailRef = sig.entry;
  const closeAll = (px, kind, ts) => { for (const l of legs) if (l.open) { l.open = false; l.exit = px; l.kind = kind; l.ts = ts; } };
  for (; i < S.b5.length; i++) {
    const b = S.b5[i];
    if (b.t >= expiry) { closeAll(b.o, "mkt", b.t); break; }
    mfe = Math.max(mfe, ((buy ? b.h : b.l) - sig.entry) * dir / risk);
    mae = Math.min(mae, ((buy ? b.l : b.h) - sig.entry) * dir / risk);
    const stopTouched = s => (buy ? b.l <= s : b.h >= s);
    const stopFill = s => (buy ? (b.o < s ? b.o : s) : (b.o > s ? b.o : s));
    if (stopTouched(stop)) { closeAll(stopFill(stop), "stop", b.t); break; }
    let progressed = false;
    for (const l of legs) {
      if (!l.open) continue;
      if (buy ? b.h >= l.tp + tick : b.l <= l.tp - tick) {
        l.open = false; l.exit = l.tp; l.kind = "tp"; l.ts = b.t; hits++; progressed = true;
      } else break;
    }
    if (progressed) {
      if (opts.be && hits >= opts.be && !beMoved) {
        const beLvl = sig.entry + dir * (opts.beOffsetR || 0) * risk;
        if ((beLvl - stop) * dir > 0) stop = beLvl;
        beMoved = true;
      }
      if (!legs.some(l => l.open)) break;
      /* أسوأ ترتيب: الوقف الجديد قد يُضرب في الشمعة نفسها */
      if (stopTouched(stop)) { closeAll(stop, "stop", b.t); break; }
    }
    if (opts.trailAtr && hits >= (opts.trailAfter ?? 1)) {
      trailRef = buy ? Math.max(trailRef, b.c) : Math.min(trailRef, b.c);
      const tr = trailRef - dir * opts.trailAtr * sig.atr;
      if ((tr - stop) * dir > 0) stop = tr;
    }
  }
  if (legs.some(l => l.open)) return null;               // بيانات غير كافية حتى النهاية
  let net = 0, lastTs = sig.t;
  for (const l of legs) {
    if (!l.w) continue;
    net += l.w * (legNet(sig.side, sig.entry, l.exit, l.kind, c) + fundingPct(S.funding, sig.side, sig.t, l.ts));
    lastTs = Math.max(lastTs, l.ts);
  }
  const riskPct = risk / sig.entry * 100;
  const stopped = legs.some(l => l.kind === "stop");
  const outcome = hits === 0 ? (stopped ? "sl" : "expired")
    : hits >= legs.filter(l => l.w > 0).length ? "tp_all"
    : stopped ? (beMoved ? "tp_then_be" : "tp_then_sl") : "tp_then_expired";
  return { r: net / riskPct, netPct: net, riskPct, hits, outcome, exitTs: lastTs, mfe, mae, holdH: (lastTs - sig.t) / H1 };
}

/* ---------- المقاييس ---------- */
export function metrics(trades) {
  const n = trades.length;
  if (!n) return { n: 0 };
  const w = trades.filter(t => t.r > 0), L = trades.filter(t => t.r <= 0);
  const gw = w.reduce((a, t) => a + t.r, 0), gl = -L.reduce((a, t) => a + t.r, 0);
  const chrono = trades.slice().sort((a, b) => a.exitTs - b.exitTs);
  let eq = 0, pk = 0, dd = 0;
  for (const t of chrono) { eq += t.r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const pct = f => +(trades.filter(f).length / n * 100).toFixed(1);
  return {
    n, winPct: pct(t => t.r > 0),
    tp1: pct(t => t.hits >= 1), tp2: pct(t => t.hits >= 2), tp3: pct(t => t.hits >= 3),
    slFirst: pct(t => t.outcome === "sl"), tpThenBE: pct(t => t.outcome === "tp_then_be"),
    avgWinR: w.length ? +(gw / w.length).toFixed(2) : 0, avgLossR: L.length ? +(-gl / L.length).toFixed(2) : 0,
    avgR: +((gw - gl) / n).toFixed(3), totalR: +(gw - gl).toFixed(1), pf: gl ? +(gw / gl).toFixed(2) : null, maxDDR: +dd.toFixed(1)
  };
}
export function by(trades, key) {
  const m = new Map();
  for (const t of trades) { const k = key(t); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return Object.fromEntries([...m].sort().map(([k, v]) => [k, metrics(v)]));
}
