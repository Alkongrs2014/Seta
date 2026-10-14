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

/* ---------- القوية ---------- */
export function strongOf(o, S) {
  const A = S.activity;
  const sc = o.score || 0, ex = o.exec_quality || 0, liq = liqPart(o);
  const out = { strong: false, strongRank: 0, reasons: [] };
  if (sc >= A.strongMinScore && ex >= A.strongMinExec && o.tier !== "D") {
    out.strong = true;
    out.strongRank = Math.round((0.5 * sc + 0.35 * ex + 0.15 * liq) * 10) / 10;
    out.reasons.push(`تقييم الإشارة ${sc.toFixed(0)}`, `جودة التنفيذ ${ex.toFixed(0)}`);
    if (liq >= 60) out.reasons.push("سيولة جيدة");
  }
  return out;
}

/* ---------- عالية السيولة والنشاط ----------
   القيم الحيّة (o.live) تُفضَّل؛ وإن غابت نرجع لقيمة وقت الإصدار.
   RVOL غير مسجّل = شرطٌ غير مستوفى (لا تُصنَّف الفرصة بلا بيانات). */
export function liquidOf(o, S) {
  const A = S.activity, mk = o.market, live = o.live || {}, c = o.contract || {};
  const isOpt = mk === "OPTIONS";
  const checks = [];
  const add = (key, ok, pass, fail) => checks.push({ key, ok: !!ok, text: ok ? pass : fail });

  if (isOpt) {
    const v = c.volume24h, oi = c.openInterest, sp = c.spreadPct;
    add("volume", v != null && v >= A.optMinVolume24h, `حجم العقد 24س ${v}`, "حجم العقد ضعيف");
    add("oi", oi != null && oi >= A.optMinOpenInterest, `مراكز مفتوحة ${oi}`, "مراكز العقد قليلة");
    const spread = live.spreadPct ?? sp;
    add("spread", spread != null && spread <= A.optMaxSpreadPct, `سبريد العقد ${spread?.toFixed(1)}%`, "سبريد العقد واسع");
  } else {
    const v = live.volume24h ?? o.meta?.quoteVolume24h;
    const minV = mk === "FUTURES" ? A.futuresMinQuoteVolume24h : A.spotMinQuoteVolume24h;
    const maxS = mk === "FUTURES" ? A.futuresMaxSpreadPct : A.spotMaxSpreadPct;
    const sp = live.spreadPct ?? o.quote?.spreadPct;
    add("volume", v != null && v >= minV, `حجم 24س ${fmtM(v || 0)}$`, "حجم التداول منخفض");
    add("spread", sp != null && sp <= maxS, `سبريد منخفض ${sp?.toFixed(3)}%`, "سبريد مرتفع");
  }

  const atrPct = live.atrPct ?? o.activity?.atrPct ?? (o.signal?.atr15 && o.signal?.openPrice ? o.signal.atr15 / o.signal.openPrice * 100 : null);
  const minA = isOpt ? A.optMinAtrPct : A.minAtrPct;
  add("atr", atrPct != null && atrPct >= minA && atrPct <= A.maxAtrPct,
    `ATR% مناسب ${atrPct?.toFixed(2)}%`, atrPct == null ? "ATR% غير متاح" : atrPct < minA ? "حركة سعرية ضعيفة (ATR% منخفض)" : "تذبذب مفرط (ATR% مرتفع)");

  const rvol = live.rvol15 ?? o.activity?.rvol15 ?? null;
  add("rvol", rvol != null && rvol >= A.minRvol, `نشاط حديث RVOL ${rvol?.toFixed(2)}×`,
    rvol == null ? "RVOL غير مسجّل — لا تُصنَّف حتى تتوفر البيانات" : `نشاط حديث ضعيف (RVOL ${rvol.toFixed(2)}×)`);

  const passed = checks.filter(k => k.ok).length, total = checks.length;
  const pass = passed === total;
  const liq = liqPart(o);
  const rv = Math.min(rvol ?? 1, 3) / 3 * 100, vv = Math.min(Math.log10((live.volume24h ?? o.meta?.quoteVolume24h ?? 0) + 1) / 9, 1) * 100;
  return {
    liquid: pass, passed, total, checks,
    liquidRank: Math.round((liq * 0.4 + rv * 0.3 + vv * 0.3) * 10) / 10,
    liquidReasons: checks.filter(k => k.ok).map(k => k.text),
    weak: checks.filter(k => !k.ok).map(k => k.text)
  };
}

export function classify(o, S) {
  return { ...strongOf(o, S), ...liquidOf(o, S) };
}

/* تشخيص: كم فرصةً تفشل في كل شرط من مجموعة (نشطة عادةً) */
export function liquidDiag(list, S) {
  const failed = {}, passing = [];
  for (const o of list) {
    const t = o.tabInfo;
    if (t.liquid) passing.push(o);
    for (const k of t.checks) if (!k.ok) failed[k.key] = (failed[k.key] || 0) + 1;
  }
  return { active: list.length, passing: passing.length, failed };
}
