/* =====================================================================
   المؤشّرات — رياضياتٌ صرفة. أرقامٌ تدخل وأرقامٌ تخرج.

   قاعدةُ هذا الملف الوحيدة: **لا `state` ولا DOM ولا شبكة**. فكل دالّة
   هنا قابلةٌ للاستدعاء من الاختبار التاريخي داخل `Worker` حيث لا يوجد
   `document` أصلاً — وهي ليست نظافةً معماريةً بل شرطُ عمل المعايرة.

   وكل الدوالّ تُعيد **سلسلةً بطول المدخل** مبدوءةً بـ`null` حتى تكتمل
   مدّة المؤشّر. ولا تُختصر بإرجاع القيمة الأخيرة وحدها: الاختبار
   التاريخي يحتاج المؤشّر عند كل شمعةٍ ماضية، وحسابُه مرّةً لكل شمعة
   يجعل المعايرة أبطأ بمئة ضعف.
   ===================================================================== */

function sma(a, p) {
  var o = new Array(a.length).fill(null), s = 0;
  for (var i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= p) s -= a[i - p];
    if (i >= p - 1) o[i] = s / p;
  }
  return o;
}

function ema(a, p) {
  var o = new Array(a.length).fill(null), k = 2 / (p + 1);
  if (a.length < p) return o;
  var s = 0;
  for (var i = 0; i < p; i++) s += a[i];
  o[p - 1] = s / p;
  for (var j = p; j < a.length; j++) o[j] = a[j] * k + o[j - 1] * (1 - k);
  return o;
}

function wma(a, p) {
  var o = new Array(a.length).fill(null), den = p * (p + 1) / 2;
  for (var i = p - 1; i < a.length; i++) {
    var s = 0;
    for (var j = 0; j < p; j++) s += a[i - j] * (p - j);
    o[i] = s / den;
  }
  return o;
}

/* متوسّط هَل — أسرع استجابةً من الأسّي بنفس النعومة. يُستعمل للميل
   لا للتقاطع: تقاطعاتُه كثيرةُ الضجيج. */
function hma(a, p) {
  var h = wma(a, Math.round(p / 2)), f = wma(a, p);
  var diff = a.map(function (_, i) {
    return (h[i] !== null && f[i] !== null) ? 2 * h[i] - f[i] : null;
  });
  var clean = diff.filter(function (v) { return v !== null; });
  var sq = wma(clean, Math.round(Math.sqrt(p)));
  var o = new Array(a.length).fill(null), off = diff.length - clean.length;
  sq.forEach(function (v, i) { if (v !== null) o[i + off] = v; });
  return o;
}

function vwma(c, v, p) {
  var o = new Array(c.length).fill(null);
  for (var i = p - 1; i < c.length; i++) {
    var pv = 0, vv = 0;
    for (var j = i - p + 1; j <= i; j++) { pv += c[j] * v[j]; vv += v[j]; }
    o[i] = vv > 0 ? pv / vv : null;
  }
  return o;
}

/* ---------------------------------------------------------------------
   RSI بتنعيم وايلدر — لا بمتوسّطٍ بسيط.

   الفرق ليس تجميلياً: النسخة البسيطة تعطي قيماً تختلف بنقاطٍ كاملة عن
   كل منصّةٍ في السوق، فيرى القارئ ‎58‎ عندنا و‎63‎ في تريدنغ فيو ويظنّ
   أحدهما معطوباً. والمرجع هو وايلدر.
   --------------------------------------------------------------------- */
function rsi(a, p) {
  p = p || 14;
  var o = new Array(a.length).fill(null);
  if (a.length <= p) return o;
  var g = 0, l = 0;
  for (var i = 1; i <= p; i++) { var d = a[i] - a[i - 1]; d >= 0 ? g += d : l -= d; }
  g /= p; l /= p;
  o[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (var j = p + 1; j < a.length; j++) {
    var dd = a[j] - a[j - 1];
    g = (g * (p - 1) + (dd > 0 ? dd : 0)) / p;
    l = (l * (p - 1) + (dd < 0 ? -dd : 0)) / p;
    o[j] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
}

function macd(a, f, s, sg) {
  f = f || 12; s = s || 26; sg = sg || 9;
  var ef = ema(a, f), es = ema(a, s);
  var line = a.map(function (_, i) {
    return (ef[i] !== null && es[i] !== null) ? ef[i] - es[i] : null;
  });
  var vals = line.filter(function (v) { return v !== null; });
  var sigVals = ema(vals, sg);
  var off = line.length - vals.length;
  var signal = new Array(a.length).fill(null);
  sigVals.forEach(function (v, i) { if (v !== null) signal[i + off] = v; });
  var hist = line.map(function (v, i) {
    return (v !== null && signal[i] !== null) ? v - signal[i] : null;
  });
  return { line: line, signal: signal, hist: hist };
}

function bb(a, p, m) {
  p = p || 20; m = m || 2;
  var mid = sma(a, p);
  var up = new Array(a.length).fill(null), lo = new Array(a.length).fill(null);
  var wid = new Array(a.length).fill(null), pb = new Array(a.length).fill(null);
  for (var i = p - 1; i < a.length; i++) {
    var v = 0;
    for (var j = i - p + 1; j <= i; j++) v += Math.pow(a[j] - mid[i], 2);
    var sd = Math.sqrt(v / p);
    up[i] = mid[i] + m * sd; lo[i] = mid[i] - m * sd;
    wid[i] = mid[i] > 0 ? (up[i] - lo[i]) / mid[i] * 100 : null;
    pb[i] = (up[i] - lo[i]) > 0 ? (a[i] - lo[i]) / (up[i] - lo[i]) : null;
  }
  return { mid: mid, up: up, lo: lo, width: wid, pctB: pb };
}

function trueRange(h, l, c) {
  var tr = [];
  for (var i = 0; i < c.length; i++) {
    tr.push(i === 0 ? h[i] - l[i]
      : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  return tr;
}

function atr(h, l, c, p) {
  p = p || 14;
  var tr = trueRange(h, l, c);
  var o = new Array(c.length).fill(null);
  if (tr.length < p) return o;
  var s = 0;
  for (var i = 0; i < p; i++) s += tr[i];
  o[p - 1] = s / p;
  for (var j = p; j < tr.length; j++) o[j] = (o[j - 1] * (p - 1) + tr[j]) / p;
  return o;
}

/* ---------------------------------------------------------------------
   ADX و DI — قوّةُ الاتجاه لا جهتُه.

   وهو أهمّ فلترٍ في المجموعة كلّها: كل استراتيجية اتجاهٍ تخسر داخل
   السوق العرضي، وكل استراتيجية ارتدادٍ تخسر داخل الاتجاه القوي.
   فـ`ADX` هو ما يفصل الحالتين، ويُستعمل بوّابةً لا إشارةً.
   --------------------------------------------------------------------- */
function adx(h, l, c, p) {
  p = p || 14;
  var n = c.length;
  var pDM = new Array(n).fill(0), mDM = new Array(n).fill(0);
  var tr = trueRange(h, l, c);
  for (var i = 1; i < n; i++) {
    var upMove = h[i] - h[i - 1], dnMove = l[i - 1] - l[i];
    pDM[i] = (upMove > dnMove && upMove > 0) ? upMove : 0;
    mDM[i] = (dnMove > upMove && dnMove > 0) ? dnMove : 0;
  }
  var sTR = new Array(n).fill(null), sP = new Array(n).fill(null), sM = new Array(n).fill(null);
  var pDI = new Array(n).fill(null), mDI = new Array(n).fill(null), dx = new Array(n).fill(null);
  var out = new Array(n).fill(null);
  if (n <= p * 2) return { adx: out, pDI: pDI, mDI: mDI };
  var t = 0, pp = 0, mm = 0;
  for (var j = 1; j <= p; j++) { t += tr[j]; pp += pDM[j]; mm += mDM[j]; }
  sTR[p] = t; sP[p] = pp; sM[p] = mm;
  for (var k = p + 1; k < n; k++) {
    sTR[k] = sTR[k - 1] - sTR[k - 1] / p + tr[k];
    sP[k]  = sP[k - 1]  - sP[k - 1]  / p + pDM[k];
    sM[k]  = sM[k - 1]  - sM[k - 1]  / p + mDM[k];
  }
  for (var q = p; q < n; q++) {
    if (!sTR[q]) continue;
    pDI[q] = 100 * sP[q] / sTR[q];
    mDI[q] = 100 * sM[q] / sTR[q];
    var sum = pDI[q] + mDI[q];
    dx[q] = sum > 0 ? 100 * Math.abs(pDI[q] - mDI[q]) / sum : 0;
  }
  var acc = 0, cnt = 0;
  for (var r = p; r < Math.min(n, p * 2); r++) { if (dx[r] !== null) { acc += dx[r]; cnt++; } }
  if (cnt === 0) return { adx: out, pDI: pDI, mDI: mDI };
  out[p * 2 - 1] = acc / cnt;
  for (var z = p * 2; z < n; z++) {
    if (dx[z] === null || out[z - 1] === null) continue;
    out[z] = (out[z - 1] * (p - 1) + dx[z]) / p;
  }
  return { adx: out, pDI: pDI, mDI: mDI };
}

/* سوبرترند — خطُّ وقفٍ زاحف يتبع التذبذب. الإشارة انقلابُ الجهة. */
function supertrend(h, l, c, p, mult) {
  p = p || 10; mult = mult || 3;
  var a = atr(h, l, c, p), n = c.length;
  var dir = new Array(n).fill(null), line = new Array(n).fill(null);
  var upper = null, lower = null, d = 1;
  for (var i = 0; i < n; i++) {
    if (a[i] === null) continue;
    var mid = (h[i] + l[i]) / 2;
    var bu = mid + mult * a[i], bl = mid - mult * a[i];
    upper = (upper === null || bu < upper || c[i - 1] > upper) ? bu : upper;
    lower = (lower === null || bl > lower || c[i - 1] < lower) ? bl : lower;
    if (c[i] > upper) d = 1; else if (c[i] < lower) d = -1;
    dir[i] = d; line[i] = d > 0 ? lower : upper;
  }
  return { dir: dir, line: line };
}

/* إيتشيموكو الكامل. السحابة أُزيحت ‎26‎ شمعةً للأمام كما في الأصل —
   فمقارنةُ السعر بسحابةِ اليوم خطأٌ شائع، والصحيح مقارنتُه بالسحابة
   المرسومة له. */
function ichimoku(h, l, c) {
  var n = c.length;
  function donch(p) {
    var o = new Array(n).fill(null);
    for (var i = p - 1; i < n; i++) {
      var hh = -Infinity, ll = Infinity;
      for (var j = i - p + 1; j <= i; j++) { if (h[j] > hh) hh = h[j]; if (l[j] < ll) ll = l[j]; }
      o[i] = (hh + ll) / 2;
    }
    return o;
  }
  var tenkan = donch(9), kijun = donch(26), b52 = donch(52);
  var spanA = new Array(n).fill(null), spanB = new Array(n).fill(null);
  for (var i = 0; i < n; i++) {
    var src = i - 26;
    if (src >= 0 && tenkan[src] !== null && kijun[src] !== null) spanA[i] = (tenkan[src] + kijun[src]) / 2;
    if (src >= 0 && b52[src] !== null) spanB[i] = b52[src];
  }
  return { tenkan: tenkan, kijun: kijun, spanA: spanA, spanB: spanB };
}

function psar(h, l, step, maxStep) {
  step = step || 0.02; maxStep = maxStep || 0.2;
  var n = h.length, o = new Array(n).fill(null), dir = new Array(n).fill(null);
  if (n < 3) return { sar: o, dir: dir };
  var up = true, af = step, ep = h[0], sar = l[0];
  for (var i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      if (l[i] < sar) { up = false; sar = ep; ep = l[i]; af = step; }
      else if (h[i] > ep) { ep = h[i]; af = Math.min(af + step, maxStep); }
    } else {
      if (h[i] > sar) { up = true; sar = ep; ep = h[i]; af = step; }
      else if (l[i] < ep) { ep = l[i]; af = Math.min(af + step, maxStep); }
    }
    o[i] = sar; dir[i] = up ? 1 : -1;
  }
  return { sar: o, dir: dir };
}

function donchian(h, l, p) {
  var n = h.length, up = new Array(n).fill(null), lo = new Array(n).fill(null),
      mid = new Array(n).fill(null);
  for (var i = p - 1; i < n; i++) {
    var hh = -Infinity, ll = Infinity;
    for (var j = i - p + 1; j <= i; j++) { if (h[j] > hh) hh = h[j]; if (l[j] < ll) ll = l[j]; }
    up[i] = hh; lo[i] = ll; mid[i] = (hh + ll) / 2;
  }
  return { up: up, lo: lo, mid: mid };
}

function keltner(h, l, c, p, mult) {
  p = p || 20; mult = mult || 2;
  var mid = ema(c, p), a = atr(h, l, c, p);
  var up = c.map(function (_, i) { return (mid[i] !== null && a[i] !== null) ? mid[i] + mult * a[i] : null; });
  var lo = c.map(function (_, i) { return (mid[i] !== null && a[i] !== null) ? mid[i] - mult * a[i] : null; });
  return { mid: mid, up: up, lo: lo };
}

/* انضغاطُ بولنجر داخل كيلتنر — مقياسُ «الهدوء الذي يسبق الحركة».
   الانضغاط ليس إشارةً بذاته: جهةُ الخروج منه هي الإشارة. */
function squeeze(h, l, c) {
  var b = bb(c, 20, 2), k = keltner(h, l, c, 20, 1.5);
  return c.map(function (_, i) {
    if (b.up[i] === null || k.up[i] === null) return null;
    return (b.up[i] < k.up[i] && b.lo[i] > k.lo[i]);
  });
}

function stoch(h, l, c, p, sm, sd) {
  p = p || 14; sm = sm || 3; sd = sd || 3;
  var n = c.length, raw = new Array(n).fill(null);
  for (var i = p - 1; i < n; i++) {
    var hh = -Infinity, ll = Infinity;
    for (var j = i - p + 1; j <= i; j++) { if (h[j] > hh) hh = h[j]; if (l[j] < ll) ll = l[j]; }
    raw[i] = (hh - ll) > 0 ? (c[i] - ll) / (hh - ll) * 100 : 50;
  }
  var clean = raw.filter(function (v) { return v !== null; });
  var kS = sma(clean, sm), off = raw.length - clean.length;
  var kArr = new Array(n).fill(null);
  kS.forEach(function (v, i) { if (v !== null) kArr[i + off] = v; });
  var kClean = kArr.filter(function (v) { return v !== null; });
  var dS = sma(kClean, sd), off2 = kArr.length - kClean.length;
  var dArr = new Array(n).fill(null);
  dS.forEach(function (v, i) { if (v !== null) dArr[i + off2] = v; });
  return { k: kArr, d: dArr };
}

/* ستوكاستك RSI — الستوكاستك مطبَّقاً على RSI لا على السعر. أسرع
   استجابةً وأكثر تطرّفاً، فيُقرأ عند الحوافّ ‎<20‎ و`>80` وحدها. */
function stochRsi(c, p, k, d) {
  p = p || 14;
  var r = rsi(c, p), n = c.length, raw = new Array(n).fill(null);
  for (var i = 0; i < n; i++) {
    if (r[i] === null) continue;
    var hh = -Infinity, ll = Infinity, have = 0;
    for (var j = Math.max(0, i - p + 1); j <= i; j++) {
      if (r[j] === null) continue;
      have++; if (r[j] > hh) hh = r[j]; if (r[j] < ll) ll = r[j];
    }
    if (have < p) continue;
    raw[i] = (hh - ll) > 0 ? (r[i] - ll) / (hh - ll) * 100 : 50;
  }
  var clean = raw.filter(function (v) { return v !== null; });
  var kS = sma(clean, k || 3), off = raw.length - clean.length;
  var kArr = new Array(n).fill(null);
  kS.forEach(function (v, i) { if (v !== null) kArr[i + off] = v; });
  var kClean = kArr.filter(function (v) { return v !== null; });
  var dS = sma(kClean, d || 3), off2 = kArr.length - kClean.length;
  var dArr = new Array(n).fill(null);
  dS.forEach(function (v, i) { if (v !== null) dArr[i + off2] = v; });
  return { k: kArr, d: dArr };
}

function cci(h, l, c, p) {
  p = p || 20;
  var tp = c.map(function (_, i) { return (h[i] + l[i] + c[i]) / 3; });
  var m = sma(tp, p), o = new Array(c.length).fill(null);
  for (var i = p - 1; i < c.length; i++) {
    var dev = 0;
    for (var j = i - p + 1; j <= i; j++) dev += Math.abs(tp[j] - m[i]);
    dev /= p;
    o[i] = dev > 0 ? (tp[i] - m[i]) / (0.015 * dev) : 0;
  }
  return o;
}

function williamsR(h, l, c, p) {
  p = p || 14;
  var o = new Array(c.length).fill(null);
  for (var i = p - 1; i < c.length; i++) {
    var hh = -Infinity, ll = Infinity;
    for (var j = i - p + 1; j <= i; j++) { if (h[j] > hh) hh = h[j]; if (l[j] < ll) ll = l[j]; }
    o[i] = (hh - ll) > 0 ? (hh - c[i]) / (hh - ll) * -100 : -50;
  }
  return o;
}

function roc(c, p) {
  p = p || 12;
  return c.map(function (v, i) {
    return (i >= p && c[i - p] > 0) ? (v - c[i - p]) / c[i - p] * 100 : null;
  });
}

/* مؤشّر تدفّق الأموال — RSI مرجّحاً بالحجم. يكشف ما يخفيه السعر:
   صعودٌ بلا تدفّقٍ هو صعودٌ فارغ. */
function mfi(h, l, c, v, p) {
  p = p || 14;
  var n = c.length, tp = new Array(n), o = new Array(n).fill(null);
  for (var i = 0; i < n; i++) tp[i] = (h[i] + l[i] + c[i]) / 3;
  for (var j = p; j < n; j++) {
    var pos = 0, neg = 0;
    for (var k = j - p + 1; k <= j; k++) {
      var flow = tp[k] * v[k];
      if (tp[k] > tp[k - 1]) pos += flow; else if (tp[k] < tp[k - 1]) neg += flow;
    }
    o[j] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return o;
}

function obv(c, v) {
  var o = new Array(c.length).fill(null); o[0] = 0;
  for (var i = 1; i < c.length; i++) {
    o[i] = o[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0);
  }
  return o;
}

/* خطّ التجميع والتوزيع — يزن موقع الإغلاق داخل الشمعة لا اتجاهها
   فقط، فيفرّق بين إغلاقٍ عند القمّة وإغلاقٍ عند القاع في شمعةٍ صاعدة. */
function adLine(h, l, c, v) {
  var o = new Array(c.length).fill(null), acc = 0;
  for (var i = 0; i < c.length; i++) {
    var rng = h[i] - l[i];
    var mfm = rng > 0 ? ((c[i] - l[i]) - (h[i] - c[i])) / rng : 0;
    acc += mfm * v[i];
    o[i] = acc;
  }
  return o;
}

/* =====================================================================
   دلتا الحجم التراكمية — من حجم المشتري الآخذ.

   بايننس تعطي في كل شمعةٍ `takerBuyBaseVolume` (الحقل ‎9‎)، فيكون حجم
   البائع الآخذ = الحجم الكلّي ناقصه. والدلتا = الفرق، وتراكمُها يقيس
   **من كان يبادر**: المشتري الذي يضرب العرض أم البائع الذي يضرب الطلب.

   وهذا أقرب ما يمكن بلوغه من تدفّق الأوامر الحقيقي بلا اشتراكٍ مدفوع،
   وهو يكشف حالةً لا يكشفها الحجم وحده: سعرٌ يصعد ودلتا تهبط تعني
   صعوداً يُقابَل ببيعٍ مبادر — أي توزيع.
   ===================================================================== */
function cvd(k) {
  var o = new Array(k.length).fill(null), acc = 0;
  for (var i = 0; i < k.length; i++) {
    var tb = k[i].tb;
    if (!Number.isFinite(tb)) { o[i] = acc; continue; }
    acc += (2 * tb - k[i].v);
    o[i] = acc;
  }
  return o;
}

/* VWAP مرساة — من بداية كل يوم/أسبوع بتوقيت UTC.

   والبتكوين سوقٌ بلا جلسات، فحدُّ اليوم هو ‎00:00 UTC‎ — وهو نفس الحدّ
   الذي تُبنى عليه الشمعة اليومية في كل منصّة، فلا يختلف رقمُنا عن
   رقمِ الشارت الذي يقرأه المستخدم. */
function anchoredVwap(k, period) {
  var o = new Array(k.length).fill(null), bands = new Array(k.length).fill(null);
  var pv = 0, vv = 0, pv2 = 0, curKey = null;
  for (var i = 0; i < k.length; i++) {
    var d = new Date(k[i].t);
    var key = period === "week"
      ? (function () { var x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); })()
      : d.toISOString().slice(0, 10);
    if (key !== curKey) { curKey = key; pv = 0; vv = 0; pv2 = 0; }
    var tp = (k[i].h + k[i].l + k[i].c) / 3;
    pv += tp * k[i].v; vv += k[i].v; pv2 += tp * tp * k[i].v;
    if (vv > 0) {
      o[i] = pv / vv;
      var varr = Math.max(0, pv2 / vv - o[i] * o[i]);
      bands[i] = Math.sqrt(varr);
    }
  }
  return { vwap: o, sd: bands };
}

/* =====================================================================
   القمم والقيعان المحورية — أساسُ كل ما يليها.

   `k` شمعاتٍ على كل جانب. والقيمة تُثبَّت بأثرٍ رجعي: قمّةٌ لا تُعرف
   قمّةً إلا بعد مرور `k` شمعة، فاستعمالُها قبل ذلك تسريبُ مستقبلٍ
   يُفسد الاختبار التاريخي كلَّه. ولهذا كل مستهلكٍ هنا يقرأ حتى
   `n − k` لا حتى `n`.
   ===================================================================== */
function pivots(h, l, k) {
  k = k || 3;
  var hi = [], lo = [];
  for (var i = k; i < h.length - k; i++) {
    var isH = true, isL = true;
    for (var j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (h[j] >= h[i]) isH = false;
      if (l[j] <= l[i]) isL = false;
    }
    if (isH) hi.push({ i: i, v: h[i] });
    if (isL) lo.push({ i: i, v: l[i] });
  }
  return { hi: hi, lo: lo };
}

/* هيكل السوق — قممٌ وقيعان صاعدة أم هابطة، وأين انكسر الهيكل.

   `BOS` كسرُ استمرار (قمّةٌ جديدة في اتجاهٍ صاعد)، و`CHoCH` تغيّرُ
   طابعٍ (قاعٌ أدنى بعد سلسلةٍ صاعدة) — وهو أوّلُ إنذارٍ بالانعكاس. */
function marketStructure(h, l, k) {
  var p = pivots(h, l, k || 3);
  var hi = p.hi.slice(-4), lo = p.lo.slice(-4);
  if (hi.length < 2 || lo.length < 2) return { trend: 0, label: "غير محدّد", bos: null, choch: null };
  var hh = hi[hi.length - 1].v > hi[hi.length - 2].v;
  var hl = lo[lo.length - 1].v > lo[lo.length - 2].v;
  var lh = hi[hi.length - 1].v < hi[hi.length - 2].v;
  var ll = lo[lo.length - 1].v < lo[lo.length - 2].v;
  var trend = (hh && hl) ? 1 : (lh && ll) ? -1 : 0;
  var label = trend > 0 ? "قمم وقيعان صاعدة" : trend < 0 ? "قمم وقيعان هابطة" : "هيكل مختلط";
  var lastC = h.length - 1;
  var bos = null, choch = null;
  var lastHi = hi[hi.length - 1], lastLo = lo[lo.length - 1];
  if (lastHi && h[lastC] > lastHi.v) bos = trend >= 0 ? 1 : null, choch = trend < 0 ? 1 : null;
  if (lastLo && l[lastC] < lastLo.v) bos = trend <= 0 ? -1 : null, choch = trend > 0 ? -1 : null;
  return { trend: trend, label: label, bos: bos, choch: choch,
           lastHigh: lastHi ? lastHi.v : null, lastLow: lastLo ? lastLo.v : null };
}

/* فجوات القيمة العادلة — ثلاثُ شموعٍ لا تتلامس أطرافُها. تُقرأ مناطقَ
   يميل السعر للعودة إليها، والمهمّ منها ما لم يُملأ بعد. */
function fvg(k, lookback) {
  var out = [], n = k.length, start = Math.max(2, n - (lookback || 120));
  for (var i = start; i < n; i++) {
    var a = k[i - 2], c = k[i];
    if (c.l > a.h) out.push({ i: i, dir: 1, lo: a.h, hi: c.l, t: k[i].t });
    else if (c.h < a.l) out.push({ i: i, dir: -1, lo: c.h, hi: a.l, t: k[i].t });
  }
  var px = k[n - 1].c;
  return out.filter(function (g) {
    for (var j = g.i + 1; j < n; j++) {
      if (g.dir > 0 && k[j].l <= g.lo) return false;
      if (g.dir < 0 && k[j].h >= g.hi) return false;
    }
    return true;
  }).map(function (g) {
    g.dist = Math.abs(px - (g.hi + g.lo) / 2) / px * 100;
    return g;
  }).sort(function (a, b) { return a.dist - b.dist; }).slice(0, 6);
}

/* مسحُ السيولة — فتيلٌ يخترق قمّةً/قاعاً سابقاً ثم يُغلق داخل النطاق.
   وهو أصدقُ نمطٍ انعكاسي في سوقٍ مرفوع: إخراجُ الأوقاف قبل الحركة. */
function liquiditySweep(k, look) {
  var n = k.length;
  if (n < 6) return null;
  var c = k[n - 1], win = k.slice(Math.max(0, n - 1 - (look || 20)), n - 1);
  if (!win.length) return null;
  var hh = Math.max.apply(null, win.map(function (x) { return x.h; }));
  var ll = Math.min.apply(null, win.map(function (x) { return x.l; }));
  var rng = c.h - c.l;
  if (rng <= 0) return null;
  if (c.h > hh && c.c < hh && (c.h - Math.max(c.c, c.o)) / rng > 0.4)
    return { dir: -1, level: hh, note: "فتيلٌ اخترق قمّة " + Math.round(look || 20) + " شمعة ثم أُغلق تحتها" };
  if (c.l < ll && c.c > ll && (Math.min(c.c, c.o) - c.l) / rng > 0.4)
    return { dir: 1, level: ll, note: "فتيلٌ اخترق قاع " + Math.round(look || 20) + " شمعة ثم أُغلق فوقه" };
  return null;
}

/* =====================================================================
   التباعد — عادي ومخفيّ.

   العادي انعكاس: سعرٌ يصنع قمّةً أعلى ومؤشّرٌ يصنع قمّةً أدنى.
   والمخفيّ استمرار: سعرٌ يصنع قاعاً أعلى ومؤشّرٌ يصنع قاعاً أدنى.
   وخلطُهما خطأٌ شائع يقلب معنى الإشارة رأساً على عقب.
   ===================================================================== */
function divergence(h, l, ind, k, look) {
  var p = pivots(h, l, k || 3);
  var n = h.length, minI = n - (look || 60);
  function pick(arr) { return arr.filter(function (x) { return x.i >= minI && ind[x.i] !== null; }).slice(-2); }
  var hs = pick(p.hi), ls = pick(p.lo);
  var out = [];
  if (hs.length === 2) {
    var pHi = hs[1].v > hs[0].v, iHi = ind[hs[1].i] > ind[hs[0].i];
    if (pHi && !iHi) out.push({ kind: "regular", dir: -1, note: "قمّةٌ أعلى في السعر وأدنى في المؤشّر" });
    if (!pHi && iHi) out.push({ kind: "hidden", dir: -1, note: "قمّةٌ أدنى في السعر وأعلى في المؤشّر" });
  }
  if (ls.length === 2) {
    var pLo = ls[1].v < ls[0].v, iLo = ind[ls[1].i] < ind[ls[0].i];
    if (pLo && !iLo) out.push({ kind: "regular", dir: 1, note: "قاعٌ أدنى في السعر وأعلى في المؤشّر" });
    if (!pLo && iLo) out.push({ kind: "hidden", dir: 1, note: "قاعٌ أعلى في السعر وأدنى في المؤشّر" });
  }
  return out;
}

/* ملفّ الحجم — أين تداول السوق فعلاً. `POC` أكثر سعرٍ تداولاً،
   و`VAH/VAL` حدود ‎70%‎ من النشاط. مستوياتٌ يبنيها السوق لا نرسمها. */
function volumeProfile(k, bins, win) {
  var w = k.slice(-(win || 240));
  if (!w.length) return null;
  bins = bins || 48;
  var hi = Math.max.apply(null, w.map(function (x) { return x.h; }));
  var lo = Math.min.apply(null, w.map(function (x) { return x.l; }));
  if (!(hi > lo)) return null;
  var step = (hi - lo) / bins, vol = new Array(bins).fill(0);
  w.forEach(function (c) {
    var a = Math.max(0, Math.floor((c.l - lo) / step));
    var b = Math.min(bins - 1, Math.floor((c.h - lo) / step));
    var share = c.v / Math.max(1, b - a + 1);
    for (var i = a; i <= b; i++) vol[i] += share;
  });
  var total = vol.reduce(function (s, x) { return s + x; }, 0);
  var pocI = vol.indexOf(Math.max.apply(null, vol));
  var acc = vol[pocI], lo_i = pocI, hi_i = pocI;
  while (acc < total * 0.7 && (lo_i > 0 || hi_i < bins - 1)) {
    var dn = lo_i > 0 ? vol[lo_i - 1] : -1, up = hi_i < bins - 1 ? vol[hi_i + 1] : -1;
    if (up >= dn) { hi_i++; acc += vol[hi_i]; } else { lo_i--; acc += vol[lo_i]; }
  }
  return { poc: lo + (pocI + 0.5) * step, val: lo + lo_i * step, vah: lo + (hi_i + 1) * step,
           lo: lo, hi: hi, bins: vol, step: step };
}

/* النقاط المحورية — الكلاسيكية والفيبوناتشية. تُحسب من الشمعة السابقة
   المكتملة لا من الجارية: نقطةٌ تتغيّر كل دقيقة ليست مستوى. */
function pivotLevels(prevH, prevL, prevC, kind) {
  var p = (prevH + prevL + prevC) / 3, r = prevH - prevL;
  if (kind === "fib") {
    return { p: p, r1: p + r * 0.382, r2: p + r * 0.618, r3: p + r,
             s1: p - r * 0.382, s2: p - r * 0.618, s3: p - r };
  }
  if (kind === "cam") {
    return { p: p, r1: prevC + r * 1.1 / 12, r2: prevC + r * 1.1 / 6, r3: prevC + r * 1.1 / 4,
             s1: prevC - r * 1.1 / 12, s2: prevC - r * 1.1 / 6, s3: prevC - r * 1.1 / 4 };
  }
  return { p: p, r1: 2 * p - prevL, r2: p + r, r3: prevH + 2 * (p - prevL),
           s1: 2 * p - prevH, s2: p - r, s3: prevL - 2 * (prevH - p) };
}

/* فيبوناتشي من آخر تأرجحٍ معتبر. «الجيب الذهبي» ‎0.618–0.65‎ هو أكثر
   منطقةٍ يُراقبها السوق، فتُعلَّم صراحةً. */
function fibLevels(h, l, k) {
  var p = pivots(h, l, k || 5);
  if (!p.hi.length || !p.lo.length) return null;
  var lastHi = p.hi[p.hi.length - 1], lastLo = p.lo[p.lo.length - 1];
  var up = lastLo.i < lastHi.i;
  var a = up ? lastLo.v : lastHi.v, b = up ? lastHi.v : lastLo.v;
  var d = b - a;
  var lv = {}; [0.236, 0.382, 0.5, 0.618, 0.786].forEach(function (r) { lv["r" + r] = b - d * r; });
  [1.272, 1.618].forEach(function (r) { lv["e" + r] = a + d * r; });
  return { dir: up ? 1 : -1, from: a, to: b, levels: lv,
           golden: [b - d * 0.618, b - d * 0.65] };
}

/* اتجاهٌ قصير المدى قبل شمعة الفحص — ستّ شموعٍ سابقة لها، بلا الشمعة
   نفسها. أساسُ التمييز بين مطرقة ورجلٍ مشنوق: نفس الشكل الهندسي
   بالضبط، لكن معناه ينقلب بحسب ما سبقه. */
function priorTrend(k, idx) {
  var from = Math.max(0, idx - 6), a = k[from], b = k[idx - 1];
  if (!a || !b) return 0;
  var chg = (b.c - a.c) / a.c;
  if (chg > 0.001) return 1;
  if (chg < -0.001) return -1;
  return 0;
}

/* أنماط الشموع. كلٌّ يُعيد جهةً أو `0` — والقاعدة المعروفة: النمط بلا
   مستوىً ضجيج، فالمستهلك يشترط التقاءه بمستوى قبل أن يعدّه إشارة. */
function candlePattern(k) {
  var n = k.length;
  if (n < 3) return null;
  var c = k[n - 1], p = k[n - 2], p2 = k[n - 3];
  var body = Math.abs(c.c - c.o), rng = c.h - c.l;
  if (rng <= 0) return null;
  var upW = c.h - Math.max(c.c, c.o), dnW = Math.min(c.c, c.o) - c.l;
  var pBody = Math.abs(p.c - p.o);

  if (c.c > c.o && p.c < p.o && c.c >= p.o && c.o <= p.c && body > pBody)
    return { dir: 1, name: "ابتلاع شرائي", strong: true };
  if (c.c < c.o && p.c > p.o && c.c <= p.o && c.o >= p.c && body > pBody)
    return { dir: -1, name: "ابتلاع بيعي", strong: true };
  /* فتيلٌ سفلي طويل: مطرقةٌ صعودية إن سبقه هبوط، ورجلٌ مشنوقٌ تحذيري
     إن سبقه صعود — الشكل واحد، والسياق هو الفارق. */
  if (dnW > body * 2 && upW < body * 0.6 && body / rng < 0.4) {
    var tD = priorTrend(k, n - 1);
    return tD <= 0 ? { dir: 1, name: "مطرقة", strong: false }
                   : { dir: -1, name: "الرجل المشنوق", strong: false };
  }
  /* فتيلٌ علوي طويل: شهابٌ هبوطي إن سبقه صعود، ومطرقةٌ مقلوبة (إشارةٌ
     ضعيفة تحتاج تأكيد الشمعة التالية) إن سبقه هبوط. */
  if (upW > body * 2 && dnW < body * 0.6 && body / rng < 0.4) {
    var tU = priorTrend(k, n - 1);
    return tU >= 0 ? { dir: -1, name: "شهاب", strong: false }
                   : { dir: 1, name: "مطرقة مقلوبة", strong: false };
  }
  if (body / rng < 0.1) return { dir: 0, name: "دوجي — تردّد", strong: false };
  if (p2.c < p2.o && Math.abs(p.c - p.o) / Math.max(1e-9, p.h - p.l) < 0.3 && c.c > c.o && c.c > (p2.o + p2.c) / 2)
    return { dir: 1, name: "نجمة الصباح", strong: true };
  if (p2.c > p2.o && Math.abs(p.c - p.o) / Math.max(1e-9, p.h - p.l) < 0.3 && c.c < c.o && c.c < (p2.o + p2.c) / 2)
    return { dir: -1, name: "نجمة المساء", strong: true };
  if (c.h < p.h && c.l > p.l) return { dir: 0, name: "شمعة داخلية — انضغاط", strong: false };
  if (body / rng > 0.85) return { dir: c.c > c.o ? 1 : -1, name: "ماروبوزو", strong: false };
  return null;
}

/* قمّتان متقاربتان (M) أو قاعان متقاربان (W) — أعيد استخدام `pivots`
   الموجودة بدل بناء كاشفٍ منفصل. `confirmed` يشترط إغلاق شمعةٍ (مغلقة
   دائماً هنا لأن `k` المُمرَّرة أصلاً مصفّاة) عبر خطّ الرقبة، و
   `targetProjection` هو قياس الهدف الكلاسيكي: الرقبة ∓ ارتفاع النمط. */
function doubleTopBottom(h, l, k, tolPct) {
  var n = k.length;
  if (n < 20) return null;
  tolPct = tolPct || 0.6;
  var p = pivots(h, l, 3);
  var px = k[n - 1].c;

  if (p.hi.length >= 2) {
    var h2 = p.hi[p.hi.length - 1], h1 = p.hi[p.hi.length - 2];
    if (h2.i > h1.i && Math.abs(h2.v - h1.v) / h1.v * 100 <= tolPct) {
      var troughs = p.lo.filter(function (x) { return x.i > h1.i && x.i < h2.i; });
      if (troughs.length) {
        var neck = Math.min.apply(null, troughs.map(function (x) { return x.v; }));
        var height = Math.max(h1.v, h2.v) - neck;
        var confirmed = px < neck;
        return { pattern: "M", dir: -1, neckline: neck,
                 confirmed: confirmed, targetProjection: neck - height,
                 note: "قمّتان متقاربتان (M) — سقفٌ عند " + Math.round(Math.max(h1.v, h2.v)) };
      }
    }
  }
  if (p.lo.length >= 2) {
    var l2 = p.lo[p.lo.length - 1], l1 = p.lo[p.lo.length - 2];
    if (l2.i > l1.i && Math.abs(l2.v - l1.v) / l1.v * 100 <= tolPct) {
      var peaks = p.hi.filter(function (x) { return x.i > l1.i && x.i < l2.i; });
      if (peaks.length) {
        var neck2 = Math.max.apply(null, peaks.map(function (x) { return x.v; }));
        var height2 = neck2 - Math.min(l1.v, l2.v);
        var confirmed2 = px > neck2;
        return { pattern: "W", dir: 1, neckline: neck2,
                 confirmed: confirmed2, targetProjection: neck2 + height2,
                 note: "قاعان متقاربان (W) — أرضيّةٌ عند " + Math.round(Math.min(l1.v, l2.v)) };
      }
    }
  }
  return null;
}

/* الكوب والعروة — محاولةُ أفضل جهد. تنبيهٌ صريح: هذا نمطٌ يُستخدم عادة
   على الأطر اليومية لأنه يحتاج عشرات/مئات الشموع ليتشكّل بمعنى — وعلى
   فريمات ٣-١٥ دقيقة يبقى ضعيف الموثوقية. لذا يُستخدم هنا كتأكيدٍ
   إضافيٍّ اختياري فقط، لا كشرطٍ أساسي في أي بوّابة قرار. */
function cupHandle(k, win) {
  var n = k.length;
  win = win || 80;
  if (n < win + 10) return null;
  var w = k.slice(-win);
  var leftRim = w[0].h, rimI = 0;
  for (var i = 0; i < Math.floor(win * 0.3); i++) if (w[i].h > leftRim) { leftRim = w[i].h; rimI = i; }
  var bottomI = 0, bottom = w[0].l;
  for (var j = 0; j < win; j++) if (w[j].l < bottom) { bottom = w[j].l; bottomI = j; }
  if (bottomI < win * 0.25 || bottomI > win * 0.75) return null;   // ليس قاعاً وسطياً مستديراً
  var rightRim = w[win - 1].h, rimJ = win - 1;
  for (var m = Math.floor(win * 0.7); m < win; m++) if (w[m].h > rightRim) { rightRim = w[m].h; rimJ = m; }
  if (rimJ <= bottomI) return null;
  var rimAvg = (leftRim + rightRim) / 2;
  if (Math.abs(leftRim - rightRim) / rimAvg > 0.03) return null;   // حافّتان متفاوتتان جداً
  var depth = rimAvg - bottom;
  if (depth / rimAvg < 0.02) return null;   // كوبٌ ضحلٌ جداً ليكون ذا معنى

  /* العروة: انسحابٌ ضحل بعد الحافة اليمنى، لا يتجاوز نصف عمق الكوب. */
  var handle = w.slice(rimJ);
  if (handle.length < 3) return null;
  var handleLow = Math.min.apply(null, handle.map(function (x) { return x.l; }));
  if (rimAvg - handleLow > depth * 0.5) return null;

  var px = k[n - 1].c;
  return { pattern: "cup-handle", dir: 1, rim: rimAvg,
           confirmed: px > rimAvg, targetProjection: rimAvg + depth,
           note: "كوبٌ وعروة — موثوقيته منخفضة على فريماتٍ قصيرة" };
}

/* التذبذب التاريخي السنوي — لمقارنة الحاضر بعادة البتكوين نفسه. */
function histVol(c, p, barsPerYear) {
  p = p || 20;
  var r = [];
  for (var i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  var o = new Array(c.length).fill(null);
  for (var j = p; j < r.length; j++) {
    var w = r.slice(j - p, j);
    var m = w.reduce(function (s, x) { return s + x; }, 0) / p;
    var sd = Math.sqrt(w.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / p);
    o[j + 1] = sd * Math.sqrt(barsPerYear || 365) * 100;
  }
  return o;
}

/* =====================================================================
   الحزمة الكاملة لفريمٍ واحد — تُحسب مرّةً ويقرأها كلُّ المستهلكين.

   لماذا كائنٌ واحد ضخم: الاستراتيجيات الاثنتان والخمسون تقرأ نفس
   المؤشّرات. وحسابُ RSI داخل كل استراتيجيةٍ يعني حسابَه اثنتي عشرة
   مرّة لنفس الفريم — وهو ما يجعل المعايرة التاريخية تستغرق دقائق بدل
   ثوانٍ. فالحساب هنا مرّةً، والاستراتيجيات تقرأ.
   ===================================================================== */
function computeAll(k) {
  if (!k || k.length < 60) return null;
  var c = k.map(function (x) { return x.c; });
  var h = k.map(function (x) { return x.h; });
  var l = k.map(function (x) { return x.l; });
  var v = k.map(function (x) { return x.v; });
  var o = k.map(function (x) { return x.o; });

  var e20 = ema(c, 20), e50 = ema(c, 50), e100 = ema(c, 100), e200 = ema(c, 200);
  var s50 = sma(c, 50), s200 = sma(c, 200);
  var m = macd(c), b = bb(c, 20, 2), a = atr(h, l, c, 14);
  var r = rsi(c, 14), dmi = adx(h, l, c, 14);
  var st = supertrend(h, l, c, 10, 3), ich = ichimoku(h, l, c);
  var sar = psar(h, l), d20 = donchian(h, l, 20), d55 = donchian(h, l, 55);
  var kc = keltner(h, l, c, 20, 2), sq = squeeze(h, l, c);
  var sto = stoch(h, l, c, 14, 3, 3), srsi = stochRsi(c, 14, 3, 3);
  var cc = cci(h, l, c, 20), wr = williamsR(h, l, c, 14), rc = roc(c, 12);
  var mf = mfi(h, l, c, v, 14), ob = obv(c, v), ad = adLine(h, l, c, v);
  var cd = cvd(k), vwD = anchoredVwap(k, "day"), vwW = anchoredVwap(k, "week");
  var ms = marketStructure(h, l, 3), vp = volumeProfile(k, 48, 240);
  var fib = fibLevels(h, l, 5), gaps = fvg(k, 120), sweep = liquiditySweep(k, 20);
  var pat = candlePattern(k), pat2 = doubleTopBottom(h, l, k), cup = cupHandle(k);
  var divR = divergence(h, l, r, 3, 60), divM = divergence(h, l, m.hist, 3, 60);
  var divO = divergence(h, l, ob, 3, 60);

  var px = c[c.length - 1];
  var A = last(a);
  var vMed = (function () {
    var w = v.slice(-50).slice().sort(function (x, y) { return x - y; });
    return w.length ? w[Math.floor(w.length / 2)] : null;
  })();
  var vLast = v[v.length - 1];
  var vRatio = (vMed && vMed > 0) ? vLast / vMed : null;
  return {
    k: k, c: c, h: h, l: l, v: v, o: o, px: px, n: k.length,
    e20: e20, e50: e50, e100: e100, e200: e200, s50: s50, s200: s200,
    E20: last(e20), E50: last(e50), E100: last(e100), E200: last(e200),
    S50: last(s50), S200: last(s200),
    macd: m, MACD: last(m.line), SIG: last(m.signal), HIST: last(m.hist),
    HISTp: prevOf(m.hist, 1),
    bb: b, BBu: last(b.up), BBl: last(b.lo), BBm: last(b.mid),
    BBW: last(b.width), PCTB: last(b.pctB),
    atr: a, ATR: A, atrPct: (A && px) ? A / px * 100 : null,
    rsi: r, RSI: last(r), RSIp: prevOf(r, 1),
    adx: dmi.adx, ADX: last(dmi.adx), PDI: last(dmi.pDI), MDI: last(dmi.mDI),
    st: st, STdir: last(st.dir), STline: last(st.line), STdirP: prevOf(st.dir, 1),
    ich: ich, TENKAN: last(ich.tenkan), KIJUN: last(ich.kijun),
    SPANA: last(ich.spanA), SPANB: last(ich.spanB),
    psar: sar, SARdir: last(sar.dir), SARdirP: prevOf(sar.dir, 1), SAR: last(sar.sar),
    d20: d20, d55: d55, D20u: last(d20.up), D20l: last(d20.lo),
    D55u: last(d55.up), D55l: last(d55.lo),
    kc: kc, KCu: last(kc.up), KCl: last(kc.lo),
    sq: sq, SQZ: sq[sq.length - 1], SQZp: sq[sq.length - 2],
    stoch: sto, STOK: last(sto.k), STOD: last(sto.d),
    srsi: srsi, SRSIK: last(srsi.k), SRSID: last(srsi.d), SRSIKp: prevOf(srsi.k, 1),
    cci: cc, CCI: last(cc), wr: wr, WR: last(wr), roc: rc, ROC: last(rc),
    mfi: mf, MFI: last(mf), obv: ob, OBV: last(ob), ad: ad, AD: last(ad),
    cvd: cd, CVD: last(cd), CVDp: prevOf(cd, 1),
    vwapD: vwD, VWAPD: last(vwD.vwap), VWSD: last(vwD.sd),
    vwapW: vwW, VWAPW: last(vwW.vwap),
    ms: ms, vp: vp, fib: fib, fvg: gaps, sweep: sweep, pattern: pat,
    pat2: pat2, cup: cup,
    divRsi: divR, divMacd: divM, divObv: divO,
    volMed: vMed, VOL: vLast,
    /* السيولة النسبية لآخر شمعة — أساس فلتر «الشموع الوهمية» في
       اللحظي: حجمٌ دون ‎40%‎ من الوسيط لا يُعتمَد وحده تأكيداً. */
    volRatio: vRatio, weakVol: vRatio !== null ? vRatio < 0.4 : null
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { sma, ema, wma, hma, vwma, rsi, macd, bb, atr, trueRange, adx,
                     supertrend, ichimoku, psar, donchian, keltner, squeeze,
                     stoch, stochRsi, cci, williamsR, roc, mfi, obv, adLine, cvd,
                     anchoredVwap, pivots, marketStructure, fvg, liquiditySweep,
                     divergence, volumeProfile, pivotLevels, fibLevels,
                     candlePattern, doubleTopBottom, cupHandle, histVol, computeAll };
}
