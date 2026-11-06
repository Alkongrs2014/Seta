/* أدوات مشتركة للتحليل بلا آثار جانبية عند الاستيراد */
export const SPLIT = Date.UTC(2026, 6, 1);
export function noOverlap(trades) {
  const busy = new Map(), out = [];
  for (const t of trades.slice().sort((a, b) => a.s.t - b.s.t)) {
    if ((busy.get(t.s.sym) || 0) > t.s.t) continue;
    busy.set(t.s.sym, t.exitTs); out.push(t);
  }
  return out;
}
