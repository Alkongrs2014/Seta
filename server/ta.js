/* مؤشّراتٌ مشتركة بين الخادم الحيّ وأدوات البحث (research/lib.mjs يستوردها) — القيمة عند i من الشموع 0..i فقط. */
export function ema(vals, n) {
  const out = new Array(vals.length).fill(null), k = 2 / (n + 1);
  let e = null, s = 0;
  for (let i = 0; i < vals.length; i++) {
    if (i < n) { s += vals[i]; if (i === n - 1) { e = s / n; out[i] = e; } continue; }
    e = vals[i] * k + e * (1 - k); out[i] = e;
  }
  return out;
}
export function sma(vals, n) {
  const out = new Array(vals.length).fill(null); let s = 0;
  for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
export function atr(bars, n = 14) {
  const out = new Array(bars.length).fill(null); let a = null;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1].c;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p));
    a = a == null ? tr : (a * (n - 1) + tr) / n;
    if (i >= n) out[i] = a;
  }
  return out;
}
export function rsi(vals, n = 14) {
  const out = new Array(vals.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1];
    if (i <= n) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i === n) { g /= n; l /= n; out[i] = 100 - 100 / (1 + g / (l || 1e-12)); } continue; }
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = 100 - 100 / (1 + g / (l || 1e-12));
  }
  return out;
}
