/* =====================================================================
   تبويبات العرض: أحدث / قوية / عالية السيولة والنشاط.
   للفلترة والترتيب فقط — لا تُصدر فرصاً ولا تغيّر الاستراتيجية ولا الخطة.
   كل المدخلات مأخوذةٌ من بياناتٍ مخزّنةٍ وقت الإصدار (لا بيانات مستقبلية).
   ===================================================================== */

/* نشاط الشمعة: RVOL = حجم آخر شمعة 15د مغلقة (بالدولار) ÷ متوسط الشموع السابقة */
export function computeActivity(closed15, openTime, openPrice, atr15, lookback = 20) {
  const k = (closed15 || []).filter(c => c.t < openTime);
  let rvol = null;
  if (k.length > 3) {
    const last = k[k.length - 1];
    const prev = k.slice(-1 - lookback, -1);
    const base = prev.reduce((a, c) => a + (c.q || 0), 0) / prev.length;
    if (base > 0 && last.q != null) rvol = Math.round(last.q / base * 100) / 100;
  }
  const atrPct = atr15 && openPrice ? Math.round(atr15 / openPrice * 10000) / 100 : null;
  return { rvol15: rvol, atrPct };
}

const fmtM = v => v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : (v / 1e3).toFixed(0) + "K";

function liqPart(o) {
  const p = o.exec && o.exec.parts;
  if (!p) return 50;
  const vs = o.market === "OPTIONS" ? [p.openInterest, p.volume, p.spread] : [p.volume, p.spread];
  const xs = vs.filter(Boolean).map(x => x.value);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length * 100 : 50;
}

export function classify(o, S) {
  const A = S.activity;
  const sc = o.score || 0, ex = o.exec_quality || 0;
  const out = { strong: false, liquid: false, strongRank: 0, liquidRank: 0, reasons: [], liquidReasons: [], weak: [] };
  const liq = liqPart(o);

  /* القوية */
  if (sc >= A.strongMinScore && ex >= A.strongMinExec && o.tier !== "D") {
    out.strong = true;
    out.strongRank = Math.round((0.5 * sc + 0.35 * ex + 0.15 * liq) * 10) / 10;
    out.reasons.push(`تقييم الإشارة ${sc.toFixed(0)}`, `جودة التنفيذ ${ex.toFixed(0)}`);
    if (liq >= 60) out.reasons.push("سيولة جيدة");
  }

  /* عالية السيولة والنشاط */
  const mk = o.market;
  const atrPct = o.activity?.atrPct ?? (o.signal?.atr15 && o.signal?.openPrice ? o.signal.atr15 / o.signal.openPrice * 100 : null);
  const rvol = o.activity?.rvol15 ?? null;
  const checks = [];
  if (mk === "OPTIONS") {
    const c = o.contract || {};
    checks.push([c.spreadPct != null && c.spreadPct <= A.optMaxSpreadPct, `سبريد العقد ${c.spreadPct?.toFixed(1)}%`, "سبريد العقد واسع"]);
    checks.push([(c.openInterest || 0) >= A.optMinOpenInterest, `مراكز مفتوحة ${c.openInterest}`, "مراكز العقد قليلة"]);
    checks.push([(c.volume24h || 0) >= A.optMinVolume24h, `حجم العقد 24س ${c.volume24h}`, "حجم العقد ضعيف"]);
  } else {
    const minV = mk === "FUTURES" ? A.futuresMinQuoteVolume24h : A.spotMinQuoteVolume24h;
    const maxS = mk === "FUTURES" ? A.futuresMaxSpreadPct : A.spotMaxSpreadPct;
    const v = o.meta?.quoteVolume24h, sp = o.quote?.spreadPct;
    checks.push([v != null && v >= minV, `حجم 24س ${fmtM(v || 0)}$`, "حجم التداول منخفض"]);
    checks.push([sp != null && sp <= maxS, `سبريد منخفض ${sp?.toFixed(3)}%`, "سبريد مرتفع"]);
  }
  if (atrPct != null) checks.push([atrPct >= (mk === "OPTIONS" ? A.optMinAtrPct : A.minAtrPct) && atrPct <= A.maxAtrPct, `ATR% مناسب ${atrPct.toFixed(2)}%`,
    atrPct < (mk === "OPTIONS" ? A.optMinAtrPct : A.minAtrPct) ? "حركة سعرية ضعيفة (ATR% منخفض)" : "تذبذب مفرط (ATR% مرتفع)"]);
  else checks.push([false, "", "ATR% غير متاح"]);
  if (rvol != null) checks.push([rvol >= A.minRvol, `نشاط حديث RVOL ${rvol.toFixed(2)}×`, `نشاط حديث ضعيف (RVOL ${rvol.toFixed(2)}×)`]);
  else checks.push([false, "", "RVOL غير مسجّل — لا تُصنَّف حتى تتوفر البيانات"]); /* لا يُخمَّن */

  const bad = checks.filter(c => !c[0]);
  out.weak = bad.map(c => c[2]);
  if (!bad.length) {
    out.liquid = true;
    out.liquidReasons.push(...checks.map(c => c[1]));
    const v = o.meta?.quoteVolume24h || 0;
    out.liquidRank = Math.round((liq * 0.4 + Math.min(rvol ?? 1, 3) / 3 * 100 * 0.3 + Math.min(Math.log10(v + 1) / 9, 1) * 100 * 0.3) * 10) / 10;
  }
  return out;
}
