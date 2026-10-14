/* =====================================================================
   الإحصائيات — دوالّ نقيّة على الفرص المنتهية.

   كل رقمٍ هنا **بعد الرسوم والانزلاق والسبريد** وفق النموذج المعلَن
   في كل فرصة (r_net / pnl_pct_net). والنتيجة الافتراضية ليست أداءً
   حقيقياً: لا تنفيذ فعلي، والتنفيذ العملي قد يختلف.
   ===================================================================== */

function agg(rows) {
  const n = rows.length;
  if (!n) return { n: 0 };
  const wins = rows.filter(r => r.r_net > 0);
  const losses = rows.filter(r => r.r_net <= 0);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const grossWin = sum(wins.map(r => r.r_net));
  const grossLoss = Math.abs(sum(losses.map(r => r.r_net)));
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / n * 100,
    lossRate: losses.length / n * 100,
    avgWinPct: wins.length ? sum(wins.map(r => r.pnl_pct_net)) / wins.length : 0,
    avgLossPct: losses.length ? sum(losses.map(r => r.pnl_pct_net)) / losses.length : 0,
    avgR: sum(rows.map(r => r.r_net)) / n,
    totalR: sum(rows.map(r => r.r_net)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0),
    avgPnlPct: sum(rows.map(r => r.pnl_pct_net)) / n
  };
}

export function maxDrawdownR(rowsChrono) {
  let eq = 0, peak = 0, dd = 0;
  const curve = [];
  for (const r of rowsChrono) {
    eq += r.r_net;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    curve.push({ ts: r.closed_at, eq: Math.round(eq * 1000) / 1000 });
  }
  return { maxDrawdownR: dd, finalR: eq, curve };
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}
const obj = (m, minN = 1) => {
  const out = {};
  for (const [k, v] of m) if (v.length >= minN) out[k] = agg(v);
  return out;
};

const scoreBucket = s => (s >= 85 ? "85+" : s >= 75 ? "75-85" : s >= 65 ? "65-75" : s >= 55 ? "55-65" : "<55");

export function buildStats(closed, { openCount = 0 } = {}) {
  const rows = closed.filter(r => r.r_net != null);
  const chrono = rows.slice().sort((a, b) => a.closed_at - b.closed_at);
  const outcomes = {};
  for (const r of rows) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;

  const bySymbol = [...groupBy(rows, r => r.market + ":" + r.symbol)].map(([k, v]) => ({ key: k, ...agg(v) }))
    .filter(x => x.n >= 2).sort((a, b) => b.totalR - a.totalR);
  const byDay = groupBy(rows, r => new Date(r.closed_at).toISOString().slice(0, 10));
  const byHourUtc = groupBy(rows, r => new Date(r.issued_at).getUTCHours());

  return {
    generatedAt: Date.now(),
    open: openCount,
    overall: agg(rows),
    drawdown: maxDrawdownR(chrono),
    outcomes,
    byMarket: obj(groupBy(rows, r => r.market)),
    bySide: obj(groupBy(rows, r => r.market + ":" + (r.market === "OPTIONS" ? (r.side === "BUY" ? "CALL" : "PUT") : r.side))),
    byTier: obj(groupBy(rows, r => r.data?.tier)),
    byScore: obj(groupBy(rows, r => scoreBucket(r.score))),
    byHourConfirm: obj(groupBy(rows, r => (r.hour_confirmed ? "15د + تأكيد الساعة" : "15د فقط"))),
    bestSymbols: bySymbol.slice(0, 10),
    worstSymbols: bySymbol.slice(-10).reverse(),
    byDay: Object.fromEntries([...byDay].sort().map(([k, v]) => [k, agg(v)])),
    byHourOfDayUtc: obj(byHourUtc),
    model: {
      exits: "3 أرجل بتقسيم متساوٍ (افتراض حسابي غير معتمد) · الوقف إلى الدخول بعد الهدف الأول · الوقف أولاً عند تعذّر الترتيب",
      costs: "رسوم + انزلاق + نصف السبريد عند الخروج؛ الخروج بالوقف بانزلاقٍ مضاعف",
      notice: "نتائج افتراضية بلا تنفيذ فعلي؛ لا تعكس أداءً حقيقياً مضموناً."
    }
  };
}
