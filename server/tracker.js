/* =====================================================================
   دورة حياة الفرصة — دالّةٌ نقيّة `applyUpdate`.

   نموذج الخروج المعلَن:
   - الصفقة ثلاث «أرجل» بنسب tpSplit (50/30/20)، لكلٍّ هدفُها.
   - عند الهدف الأول يُنقل الوقف إلى سعر الدخول (إن فُعّل).
   - الوقف يُغلق كل ما تبقّى.

   ترتيب الأحداث (لتجنّب ادّعاء نجاحٍ غير قابلٍ للتنفيذ):
   - لا نستعمل «أفضل سعرٍ وصل إليه السوق» عند الإصدار: القمم/القيعان
     المعتمدة هي الجديدة منذ آخر تحديثٍ فقط (seen)، فما سبق الإصدار
     لا يُحتسب أبداً.
   - إن ظهر الوقف والهدف معاً في تحديثٍ واحد (الترتيب مجهول) فالوقف أولاً.
   - الدخول عند سعر العرض (للشراء) أو الطلب (للبيع) لحظة الإصدار،
     والتكاليف: رسوم + انزلاق + نصف السبريد عند الخروج.
   ===================================================================== */
import { legNetPct } from "./quality.js";

export const CLOSED = new Set(["tp3", "sl", "tp_sl", "expired", "cancelled"]);
export const OPEN = new Set(["new", "active", "tp1", "tp2"]);

export function initTrack({ side, entry, stop, targets, issuedAt, expiresAt, emitCandleT, sma200,
                            seenHi, seenLo, plan, feePct, halfSpreadPct, costs, market }) {
  const split = plan.tpSplit;
  return {
    market, side, entry, stop0: stop, stop, targets: targets.slice(),
    riskPct: Math.abs(entry - stop) / entry,
    legs: targets.map((tp, i) => ({ w: split[i] ?? 0, tp, open: true, exit: null, exitTs: null, kind: null, net: null })),
    seen: { t: emitCandleT, hi: seenHi ?? entry, lo: seenLo ?? entry },
    emitCandleT, issuedAt, expiresAt, sma200,
    tpsHit: 0, breakeven: !!plan.breakevenAfterTp1, cancelOnSmaClose: !!plan.cancelOnSmaClose,
    feePct, halfSpreadPct: halfSpreadPct || 0, costs,
    status: "new", closedAt: null, final: null
  };
}

function closeLeg(st, leg, price, ts, kind) {
  leg.open = false; leg.exit = price; leg.exitTs = ts; leg.kind = kind;
  const r = legNetPct({ side: st.side, entry: st.entry, exit: price, kind, costs: st.costs,
                        feePct: st.feePct, halfSpreadPct: st.halfSpreadPct });
  leg.net = r.net; leg.gross = r.gross; leg.cost = r.cost;
}

function openLegs(st) { return st.legs.filter(l => l.open); }

/**
 * @param st  حالة المتابعة (تُعدَّل في مكانها)
 * @param u   { ts, price, candleT, cumHi, cumLo, closedCandle?:{c} }
 * @returns { events:[{type,price,note}], changed:boolean }
 */
export function applyUpdate(st, u, { newWindowMs = 5 * 60e3 } = {}) {
  const events = [];
  if (CLOSED.has(st.status)) return { events, changed: false };
  const buy = st.side === "BUY";

  /* القمم/القيعان الجديدة منذ آخر تحديث */
  if (u.candleT !== st.seen.t) st.seen = { t: u.candleT, hi: -Infinity, lo: Infinity };
  const newHi = u.cumHi > st.seen.hi ? u.cumHi : null;
  const newLo = u.cumLo < st.seen.lo ? u.cumLo : null;
  st.seen.hi = Math.max(st.seen.hi, u.cumHi);
  st.seen.lo = Math.min(st.seen.lo, u.cumLo);
  const hi = Math.max(newHi ?? -Infinity, u.price);
  const lo = Math.min(newLo ?? Infinity, u.price);

  const finish = (status, ts) => {
    st.status = status; st.closedAt = ts;
    const done = st.legs;
    st.final = {
      rNet: done.reduce((a, l) => a + l.w * (l.net ?? 0) / (st.riskPct * 100), 0),
      pnlPctNet: done.reduce((a, l) => a + l.w * (l.net ?? 0), 0),
      exitPrice: done.length ? done.filter(l => l.exit != null).slice(-1)[0]?.exit ?? u.price : u.price
    };
    events.push({ type: status, price: u.price, note: null });
  };

  for (let guard = 0; guard < 8 && openLegs(st).length; guard++) {
    /* 1) الوقف أولاً (تحفّظ) */
    const stopHit = buy ? lo <= st.stop : hi >= st.stop;
    if (stopHit) {
      const px = buy ? Math.min(st.stop, u.price) : Math.max(st.stop, u.price);
      for (const l of openLegs(st)) closeLeg(st, l, px, u.ts, "stop");
      finish(st.tpsHit > 0 ? "tp_sl" : "sl", u.ts);
      events[events.length - 1].price = px;
      return { events, changed: true };
    }
    /* 2) هدفٌ تالٍ */
    const i = st.tpsHit;
    const leg = st.legs[i];
    if (leg && leg.open && (buy ? hi >= leg.tp : lo <= leg.tp)) {
      closeLeg(st, leg, leg.tp, u.ts, "tp");
      st.tpsHit++;
      events.push({ type: `tp${st.tpsHit}`, price: leg.tp, note: null });
      if (st.tpsHit === 1 && st.breakeven) {
        st.stop = st.entry;
        events.push({ type: "stop_moved", price: st.entry, note: "الوقف إلى سعر الدخول" });
      }
      if (!openLegs(st).length) { finish("tp3", u.ts); events[events.length - 1].price = leg.tp; return { events, changed: true }; }
      continue;
    }
    break;
  }

  /* 3) إلغاءٌ مسبق التعريف: إغلاق شمعة 15د عكس SMA200 قبل أي هدف */
  if (u.closedCandle && st.tpsHit === 0 && st.cancelOnSmaClose && st.sma200 != null) {
    const c = u.closedCandle.c;
    const bad = buy ? c < st.sma200 : c > st.sma200;
    if (bad) {
      for (const l of openLegs(st)) closeLeg(st, l, c, u.ts, "mkt");
      finish("cancelled", u.ts);
      events[events.length - 1].note = "أُغلقت شمعة 15د عكس SMA200 قبل أي هدف";
      events[events.length - 1].price = c;
      return { events, changed: true };
    }
  }

  /* 4) انتهاء الصلاحية */
  if (u.ts >= st.expiresAt) {
    for (const l of openLegs(st)) closeLeg(st, l, u.price, u.ts, "mkt");
    finish("expired", u.ts);
    return { events, changed: true };
  }

  /* 5) الحالة الجارية */
  let status = st.status;
  if (st.tpsHit >= 2) status = "tp2";
  else if (st.tpsHit === 1) status = "tp1";
  else status = u.ts - st.issuedAt > newWindowMs ? "active" : "new";
  const changed = status !== st.status || events.length > 0;
  if (status !== st.status && !events.some(e => e.type === status) && status === "active") {
    events.push({ type: "active", price: u.price, note: null });
  }
  st.status = status;
  return { events, changed };
}

/* حالة الأرجل بعد الإغلاق → أرقام للتخزين */
export function summarize(st) {
  const legs = st.legs.map(l => ({ w: l.w, tp: l.tp, exit: l.exit, kind: l.kind, net: l.net }));
  return { legs, final: st.final, tpsHit: st.tpsHit };
}
