/* =====================================================================
   التقرير الدوري المحلي (كل 24 ساعة فعلية من بدء المراقبة).

   دالّةٌ نقيّةٌ تبني الأرقام والنصّ؛ والمحرّك يكتب الملفّين في
   data/reports/. لا يعتمد على جلسة Claude ولا على المتصفّح.

   قاعدة العدّ: «الإلغاء» (cancelled) في هذا النظام يحدث **بعد** الدخول
   (الدخول عند الإصدار)، فهو خروجٌ بسعر السوق وله r_net حقيقي — يُعدّ
   ضمن النتائج المنفَّذة ويُعرض منفصلاً لا مخفيّاً.
   ===================================================================== */
import { buildStats } from "./stats.js";

const pct = (a, p) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const f1 = x => (x == null ? "—" : (Math.round(x * 10) / 10).toString());
const f2 = x => (x == null ? "—" : (Math.round(x * 100) / 100).toString());

export function liquidityBucket(execQuality) {
  if (execQuality == null) return "غير معروف";
  return execQuality >= 60 ? "تنفيذ مرتفع (≥60)" : execQuality >= 40 ? "تنفيذ متوسط (40–60)" : "تنفيذ منخفض (<40)";
}

export function buildReport({ from, to, issued, evalCounts = {}, health = null }) {
  const closed = issued.filter(o => o.closed_at != null && o.r_net != null);
  const stats = buildStats(closed);
  const byLiq = {};
  for (const o of closed) (byLiq[liquidityBucket(o.exec_quality)] ||= []).push(o);
  const liq = Object.fromEntries(Object.entries(byLiq).map(([k, v]) => [k, buildStats(v).overall]));
  const bySide = {};
  for (const o of issued) { const k = `${o.market}:${o.side}`; bySide[k] = (bySide[k] || 0) + 1; }
  const issueMs = issued.map(o => o.issued_at - o.candle_open_ts).filter(x => x >= 0);
  const arriveMs = issued.map(o => o.candle_arrived_at - o.candle_open_ts).filter(x => x >= 0);
  const cancelled = closed.filter(o => o.outcome === "cancelled");
  return {
    from, to, generatedAt: Date.now(),
    issued: issued.length, issuedBySide: bySide,
    open: issued.length - closed.length,
    closed: closed.length,
    outcomes: stats.outcomes,
    cancelledShare: closed.length ? cancelled.length / closed.length : null,
    overall: stats.overall, byMarket: stats.byMarket, byTier: stats.byTier, byScore: stats.byScore,
    byHourConfirm: stats.byHourConfirm, byLiquidity: liq,
    drawdown: { maxDrawdownR: stats.drawdown.maxDrawdownR, finalR: stats.drawdown.finalR },
    latencyMs: {
      issue: { p50: pct(issueMs, 0.5), p90: pct(issueMs, 0.9), p99: pct(issueMs, 0.99), max: pct(issueMs, 1), n: issueMs.length },
      arrive: { p50: pct(arriveMs, 0.5), p90: pct(arriveMs, 0.9), max: pct(arriveMs, 1) }
    },
    evalCounts,
    health: health && {
      uptimeSec: health.uptimeSec, openOpportunities: health.openOpportunities, counters: health.counters,
      feeds: Object.fromEntries(Object.entries(health.feeds || {}).map(([k, f]) => [k, {
        tracked: f.tracked, ready: f.readySymbols, live: f.liveSymbols, evaluations: f.evaluations,
        lateSkipped: f.lateSkipped, reconnects: f.ws?.reconnects, clockOffsetMs: f.clockOffsetMs }]))
    }
  };
}

export function reportMarkdown(r) {
  const iso = t => new Date(t).toISOString().replace(".000Z", "Z");
  const row = (name, a) => a && a.n
    ? `| ${name} | ${a.n} | ${f1(a.winRate)}% | ${f2(a.avgR)} | ${f2(a.totalR)} | ${f2(a.avgPnlPct)}% |`
    : `| ${name} | 0 | — | — | — | — |`;
  const L = [];
  L.push(`# تقرير المراقبة — ${iso(r.from)} → ${iso(r.to)}`);
  L.push("", `أُنشئ آلياً: ${iso(r.generatedAt)} (UTC). نتائج افتراضية بعد الرسوم والانزلاق والسبريد، بلا تنفيذ فعلي.`);
  L.push("", "## الفرص", `- صدرت: **${r.issued}** — منتهية: **${r.closed}** — مفتوحة: ${r.open}`);
  L.push(`- حسب السوق/الاتجاه: ${Object.entries(r.issuedBySide).map(([k, v]) => `${k}=${v}`).join(" · ") || "—"}`);
  L.push("", "## النتائج (المنتهية فقط)", "| الفئة | العدد | الفوز | متوسط R | مجموع R | متوسط % |", "|---|---|---|---|---|---|");
  L.push(row("الكل", r.overall));
  for (const [k, v] of Object.entries(r.byMarket)) L.push(row(k, v));
  for (const [k, v] of Object.entries(r.byTier)) L.push(row("الفئة " + k, v));
  for (const [k, v] of Object.entries(r.byLiquidity)) L.push(row(k, v));
  for (const [k, v] of Object.entries(r.byHourConfirm)) L.push(row(k, v));
  L.push("", "## أسباب الإغلاق", Object.entries(r.outcomes).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "—");
  L.push(`- حصة «cancelled» (خروجٌ بسعر السوق بعد الدخول عند إغلاق شمعة عكس SMA200): ${r.cancelledShare == null ? "—" : f1(r.cancelledShare * 100) + "%"}`);
  L.push(`- أقصى تراجع: ${f2(r.drawdown.maxDrawdownR)}R — الصافي: ${f2(r.drawdown.finalR)}R`);
  const l = r.latencyMs;
  L.push("", "## التأخير (من افتتاح الشمعة)", `- وصول البيانات: p50=${l.arrive.p50 ?? "—"}ms · p90=${l.arrive.p90 ?? "—"}ms · max=${l.arrive.max ?? "—"}ms`);
  L.push(`- الإصدار: p50=${l.issue.p50 ?? "—"}ms · p90=${l.issue.p90 ?? "—"}ms · p99=${l.issue.p99 ?? "—"}ms · max=${l.issue.max ?? "—"}ms (n=${l.issue.n})`);
  L.push("", "## الفحص", Object.entries(r.evalCounts).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- لا سجلّات تخطٍّ");
  if (r.health) {
    L.push("", "## الصحّة لحظة التقرير", `- مدة التشغيل: ${Math.round(r.health.uptimeSec / 60)} دقيقة · مفتوحة: ${r.health.openOpportunities}`);
    for (const [k, f] of Object.entries(r.health.feeds)) {
      L.push(`- ${k}: مراقَب ${f.tracked} · جاهز ${f.ready} · حيّ ${f.live} · تقييمات ${f.evaluations} · تخطٍّ متأخّر ${f.lateSkipped} · إعادة اتصال ${f.reconnects} · فرق الساعة ${f.clockOffsetMs}ms`);
    }
  }
  return L.join("\n") + "\n";
}
