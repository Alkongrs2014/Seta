/* =====================================================================
   أثر قاعدة الإلغاء عند إغلاق شمعة 15د عكس SMA200 على النتائج.

   لا يُغيّر شيئاً في النظام ولا في السجلّات: يقرأ الفرص المنتهية (Spot/Futures)
   من قاعدة البيانات للقراءة فقط، ويعيد تشغيل نموذج الخروج نفسه (tracker.js)
   على شموع الدقيقة الحقيقية من Binance مرّتين:
     A) كما هو معتمدٌ حالياً (cancelOnSmaClose = true)
     B) بلا قاعدة الإلغاء (يبقى الوقف والأهداف والانتهاء فقط)
   المقارنة A↔B على الإعادة نفسها (دقة شموع الدقيقة، الوقف أولاً عند الالتباس)
   فهي مقارنةٌ متكافئة؛ ولا تُقارَن مباشرةً بأرقام التتبّع الحيّ.

   الاستعمال: node scripts/exit-impact.mjs [--days=N]
   ===================================================================== */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initTrack, applyUpdate } from "../server/tracker.js";
import { fetchKlines } from "../server/binance.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(process.env.DB_PATH || path.join(ROOT, "data", "opps.db"), { readOnly: true });
const M15 = 15 * 60e3;

const rows = db.prepare(
  `SELECT * FROM opportunities WHERE market IN ('SPOT','FUTURES') AND closed_at IS NOT NULL AND r_net IS NOT NULL ORDER BY issued_at`
).all().map(r => ({ ...r, data: JSON.parse(r.data) }));

function replay(opp, bars, cancelRule) {
  const t = opp.data.track;
  const st = initTrack({
    side: opp.side, entry: t.entry, stop: t.stop0, targets: t.targets,
    issuedAt: t.issuedAt, expiresAt: t.expiresAt, emitCandleT: t.emitCandleT, sma200: t.sma200,
    seenHi: t.entry, seenLo: t.entry,
    plan: { tpSplit: t.legs.map(l => l.w), breakevenAfterTp1: t.breakeven, cancelOnSmaClose: cancelRule },
    feePct: t.feePct, halfSpreadPct: t.halfSpreadPct, costs: t.costs, market: opp.market
  });
  for (const k of bars) {
    const ts = k.ct;
    const res = applyUpdate(st, {
      ts, price: k.c, candleT: k.t, cumHi: k.h, cumLo: k.l,
      closedCandle: (k.t + 60e3) % M15 === 0 ? { c: k.c } : undefined
    });
    if (res.changed && ["tp3", "sl", "tp_sl", "expired", "cancelled"].includes(st.status)) break;
  }
  return st;
}

function agg(list) {
  const n = list.length;
  if (!n) return null;
  const w = list.filter(x => x.rNet > 0).length;
  const sum = list.reduce((a, x) => a + x.rNet, 0);
  const oc = {};
  for (const x of list) oc[x.status] = (oc[x.status] || 0) + 1;
  return { n, winRate: +(w / n * 100).toFixed(1), avgR: +(sum / n).toFixed(3), totalR: +sum.toFixed(1), outcomes: oc };
}

const A = [], B = [], by = {};
let done = 0, failed = 0;
const queue = rows.slice();
async function worker() {
  while (queue.length) {
    const o = queue.shift();
    try {
      const start = Math.floor(o.issued_at / 60e3) * 60e3 + 60e3;
      const bars = (await fetchKlines(o.market.toLowerCase(), o.symbol, "1m", { limit: 1000, startTime: start }))
        .filter(k => k.ct < o.closed_at + 12 * 3600e3);
      const a = replay(o, bars, true), b = replay(o, bars, false);
      if (!a.final || !b.final) { failed++; continue; }
      const ra = { status: a.status, rNet: a.final.rNet }, rb = { status: b.status, rNet: b.final.rNet };
      A.push(ra); B.push(rb);
      const key = `${o.market}`;
      (by[key] ||= { A: [], B: [] }); by[key].A.push(ra); by[key].B.push(rb);
      done++;
    } catch { failed++; }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

const out = {
  replayed: done, failed,
  A_current_rules: agg(A), B_without_cancel_rule: agg(B),
  byMarket: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { A: agg(v.A), B: agg(v.B) }])),
  note: "إعادةٌ على شموع دقيقة؛ الوقف أولاً عند الالتباس. للمقارنة بين A و B فقط. لا يغيّر النظام."
};
console.log(JSON.stringify(out, null, 1));
