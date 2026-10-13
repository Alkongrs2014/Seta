/* =====================================================================
   جودة المخاطرة والتنفيذ — تقييمٌ منفصلٌ تماماً عن قوّة الإشارة الفنية.

   لماذا منفصل: عقدٌ ضعيف السيولة قد يحمل إشارةً فنيةً ممتازة ويبقى
   غير قابلٍ للتنفيذ بسعرٍ معقول. فلا تُرفع «توصيةٌ ممتازة» بالإشارة
   وحدها: الفئة النهائية = الأدنى من فئتَي الإشارة والتنفيذ.

   كل دوالّ هذا الملفّ نقيّة.
   ===================================================================== */

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/* ---------- نموذج التكلفة المعلن ---------- */
export function legNetPct({ side, entry, exit, kind, costs, feePct, halfSpreadPct = 0 }) {
  const dir = side === "BUY" ? 1 : -1;
  const gross = dir * (exit - entry) / entry * 100;
  const slip = costs.slippageBps / 100;                 // % لكل جهة
  const exitSlip = kind === "stop" ? slip * costs.stopSlippageMult : slip;
  const cost = 2 * feePct + slip + exitSlip + halfSpreadPct;
  return { gross, cost, net: gross - cost };
}

/* ---------- Spot / Futures ---------- */
export function execQualityLinear({ market, spreadPct, quoteVol24h, riskPct, costs, maxSpreadPct,
                                    fundingPct8h, oiUsd, side, minVol }) {
  const feePct = market === "FUTURES" ? costs.futuresFeePct : costs.spotFeePct;
  const roundTrip = 2 * feePct + 2 * costs.slippageBps / 100 + (spreadPct || 0);
  const costOverRisk = riskPct > 0 ? roundTrip / (riskPct * 100) : 1;

  const comp = {};
  comp.spread = spreadPct == null ? 0.4 : clamp(1 - spreadPct / Math.max(maxSpreadPct, 1e-9));
  const vFloor = Math.log10(Math.max(minVol || 5e5, 1));
  comp.volume = clamp((Math.log10(Math.max(quoteVol24h || 1, 1)) - vFloor) / (8.3 - vFloor));
  comp.cost = clamp(1 - (costOverRisk - 0.05) / 0.45);

  let weights = { spread: 35, volume: 35, cost: 30 };
  if (market === "FUTURES") {
    /* التمويل: يُحسب ضدّ الصفقة فقط (اللونج يدفع حين التمويل موجب). */
    const adverse = fundingPct8h == null ? 0 : (side === "BUY" ? fundingPct8h : -fundingPct8h);
    comp.funding = clamp(1 - Math.max(0, adverse) / 0.1);
    comp.openInterest = oiUsd == null ? 0.5 : clamp((Math.log10(Math.max(oiUsd, 1)) - 5.5) / (9 - 5.5));
    weights = { spread: 25, volume: 25, cost: 25, funding: 10, openInterest: 15 };
  }
  const wsum = Object.values(weights).reduce((a, b) => a + b, 0);
  let score = 0;
  const parts = {};
  for (const [k, w] of Object.entries(weights)) {
    parts[k] = { value: comp[k], weight: w };
    score += comp[k] * w / wsum;
  }
  return { score: Math.round(score * 1000) / 10, parts, roundTripCostPct: roundTrip, costOverRisk };
}

export function tierOf(signalScore, execScore, minExec = 40) {
  /* الفئة = الأدنى. «د» = غير قابلةٍ للتنفيذ عملياً. */
  if (execScore < minExec) return "D";
  const s = signalScore >= 75 ? 3 : signalScore >= 60 ? 2 : 1;
  const e = execScore >= 70 ? 3 : execScore >= 50 ? 2 : 1;
  return ["", "C", "B", "A"][Math.min(s, e)];
}

export const TIER_LABEL = {
  A: "ممتازة", B: "جيدة", C: "متوسّطة", D: "ضعيفة التنفيذ"
};

/* ---------- الرافعة (Futures) ----------
   هامشٌ معزول مبسّط: سعر التصفية التقريبي = الدخول × (1 ∓ 1/L ± mmr).
   لا يدخل في التقييم إطلاقاً — يُعرض كي يرى المستخدم المخاطرة. */
export function leverageTable({ side, entry, stop, leverages, mmrPct }) {
  const dir = side === "BUY" ? 1 : -1;
  const mmr = (mmrPct == null ? 0.5 : mmrPct) / 100;
  const stopPct = Math.abs(entry - stop) / entry;
  return leverages.map(L => {
    const liqDist = 1 / L - mmr;                         // نسبة الحركة المسموحة قبل التصفية
    const liq = entry * (1 - dir * liqDist);
    return {
      leverage: L,
      marginPct: 100 / L,                                // الهامش كنسبةٍ من القيمة الاسمية
      liqPrice: liq,
      liqDistPct: liqDist * 100,
      stopLossOnMarginPct: stopPct * L * 100,            // خسارة الوقف نسبةً إلى الهامش
      liqBeforeStop: liqDist <= stopPct                  // تحذير: التصفية قبل الوقف
    };
  });
}

/* ---------- Options ---------- */
export function optionExecQuality({ spreadPct, openInterest, volume24h, thetaPctPerDay, dteHours,
                                    maxSpreadPct }) {
  const comp = {
    spread: clamp(1 - spreadPct / Math.max(maxSpreadPct, 1e-9)),
    openInterest: clamp(Math.log10(1 + (openInterest || 0)) / 2.5),
    volume: clamp(Math.log10(1 + (volume24h || 0)) / 2),
    theta: clamp(1 - (thetaPctPerDay - 3) / 17),
    time: clamp((dteHours - 12) / 60)
  };
  const w = { spread: 35, openInterest: 20, volume: 15, theta: 20, time: 10 };
  let s = 0;
  const parts = {};
  for (const [k, v] of Object.entries(w)) { parts[k] = { value: comp[k], weight: v }; s += comp[k] * v / 100; }
  return { score: Math.round(s * 1000) / 10, parts };
}
