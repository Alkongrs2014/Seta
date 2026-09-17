/* =====================================================================
   الشارت — رسمٌ على `canvas` بلا مكتبة.

   لماذا بلا مكتبة: مكتبةُ شارتٍ وزنُها ‎200KB+‎ وتأتي بخطٍّ خاصّ ونمطٍ
   لونيٍّ يُقاوَم. والمطلوب هنا شموعٌ ومتوسّطاتٌ ومستويات — نحو مئتي
   سطر، تُقرأ وتُعدَّل، وتُلوَّن بمتغيّرات الصفحة نفسها فلا يبدو الشارت
   غريباً عمّا حوله.

   ودقّةُ الشاشة (`devicePixelRatio`) مقروءةٌ صراحةً: بدونها يظهر الرسم
   ضبابياً على كل جوالٍ حديث.
   ===================================================================== */

var CHART = { hover: null, layers: { ema: true, bb: false, vp: true, levels: true } };

function cssVar(n) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";
}

function drawChart() {
  var cv = $("#chart");
  if (!cv) return;
  var k = state.candles[state.activeTF];
  if (!k || k.length < 10) return;

  var dpr = window.devicePixelRatio || 1;
  var W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  cv.width = W * dpr; cv.height = H * dpr;
  var g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  var view = Math.min(k.length, CHART.bars || 140);
  var data = k.slice(-view);
  var a = state.analysis && state.analysis[state.activeTF];

  var padL = 6, padR = 62, padT = 10, padB = 22;
  var cw = W - padL - padR, ch = H - padT - padB;

  var hi = -Infinity, lo = Infinity;
  data.forEach(function (c) { if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; });

  /* المتوسّطات تدخل في المدى: خطٌّ يخرج خارج الإطار يوحي بأن السعر
     بعيدٌ عنه أكثر مما هو، وهي قراءةٌ خاطئة لا عيبٌ تجميلي. */
  var series = [];
  if (a && CHART.layers.ema) {
    series.push({ v: a.e20.slice(-view), c: "#3d7ddb", w: 1.2 });
    series.push({ v: a.e50.slice(-view), c: "#f5b912", w: 1.2 });
    series.push({ v: a.e200.slice(-view), c: "#b06cff", w: 1.6 });
  }
  if (a && CHART.layers.bb) {
    series.push({ v: a.bb.up.slice(-view), c: "rgba(143,155,173,.45)", w: 1 });
    series.push({ v: a.bb.lo.slice(-view), c: "rgba(143,155,173,.45)", w: 1 });
  }
  series.forEach(function (s) {
    s.v.forEach(function (x) { if (x !== null && Number.isFinite(x)) { if (x > hi) hi = x; if (x < lo) lo = x; } });
  });

  var pad = (hi - lo) * 0.08 || 1;
  hi += pad; lo -= pad;
  var Y = function (p) { return padT + (hi - p) / (hi - lo) * ch; };
  var bw = cw / view;
  var X = function (i) { return padL + i * bw + bw / 2; };

  /* الشبكة والمحور السعري */
  g.font = "10px ui-monospace, monospace";
  g.textAlign = "left";
  var steps = 5;
  for (var s2 = 0; s2 <= steps; s2++) {
    var p = lo + (hi - lo) * s2 / steps, y = Y(p);
    g.strokeStyle = "rgba(255,255,255,.05)";
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + cw, y); g.stroke();
    g.fillStyle = cssVar("--dim");
    g.fillText(p >= 1000 ? Math.round(p).toLocaleString("en-US") : p.toFixed(1), padL + cw + 6, y + 3);
  }

  /* ملفُّ الحجم — يُرسم خلف الشموع بشفافية، ويُعلَّم `POC`. */
  if (a && a.vp && CHART.layers.vp) {
    var vp = a.vp, mx = Math.max.apply(null, vp.bins);
    g.globalAlpha = 0.16;
    vp.bins.forEach(function (vv, bi) {
      if (!vv) return;
      var y0 = Y(vp.lo + (bi + 1) * vp.step), y1 = Y(vp.lo + bi * vp.step);
      var w = vv / mx * cw * 0.26;
      g.fillStyle = cssVar("--acc");
      g.fillRect(padL, y0, w, Math.max(1, y1 - y0));
    });
    g.globalAlpha = 1;
    [[vp.poc, "#f5b912", "POC"], [vp.vah, "rgba(143,155,173,.5)", ""],
     [vp.val, "rgba(143,155,173,.5)", ""]].forEach(function (lv) {
      if (!Number.isFinite(lv[0]) || lv[0] > hi || lv[0] < lo) return;
      g.strokeStyle = lv[1]; g.setLineDash([3, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(padL, Y(lv[0])); g.lineTo(padL + cw, Y(lv[0])); g.stroke();
      g.setLineDash([]);
    });
  }

  /* الشموع */
  var up = cssVar("--up"), dn = cssVar("--dn");
  data.forEach(function (c, i) {
    var x = X(i), col = c.c >= c.o ? up : dn;
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, Y(c.h)); g.lineTo(x, Y(c.l)); g.stroke();
    var yO = Y(c.o), yC = Y(c.c);
    var top = Math.min(yO, yC), hgt = Math.max(1, Math.abs(yC - yO));
    g.fillRect(x - Math.max(1, bw * 0.32), top, Math.max(1.5, bw * 0.64), hgt);
  });

  /* المتوسّطات فوق الشموع */
  series.forEach(function (s) {
    g.strokeStyle = s.c; g.lineWidth = s.w; g.beginPath();
    var started = false;
    s.v.forEach(function (val, i) {
      if (val === null || !Number.isFinite(val)) return;
      var x = X(i), y = Y(val);
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    });
    g.stroke();
  });

  /* مستوياتُ الإجماع — الإبطال والأهداف للأفق المعروض. */
  if (CHART.layers.levels && state.chartLevels) {
    var L = state.chartLevels;
    [[L.inv, cssVar("--dn"), "إبطال"], [L.t1, cssVar("--up"), "هدف ١"],
     [L.t2, cssVar("--up"), "هدف ٢"]].forEach(function (lv) {
      if (!Number.isFinite(lv[0]) || lv[0] > hi || lv[0] < lo) return;
      g.strokeStyle = lv[1]; g.setLineDash([5, 4]); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(padL, Y(lv[0])); g.lineTo(padL + cw, Y(lv[0])); g.stroke();
      g.setLineDash([]);
      g.fillStyle = lv[1]; g.font = "9px ui-sans-serif, system-ui";
      g.textAlign = "right";
      g.fillText(lv[2], padL + cw - 4, Y(lv[0]) - 3);
      g.textAlign = "left";
    });
  }

  /* السعر الآن */
  var px = data[data.length - 1].c;
  g.fillStyle = cssVar("--tx");
  g.fillRect(padL + cw, Y(px) - 8, padR - 2, 16);
  g.fillStyle = cssVar("--bg");
  g.font = "600 10px ui-monospace, monospace";
  g.fillText(Math.round(px).toLocaleString("en-US"), padL + cw + 5, Y(px) + 3);

  /* التواريخ */
  g.fillStyle = cssVar("--dim");
  g.font = "9px ui-sans-serif, system-ui";
  var every = Math.max(1, Math.floor(view / 6));
  data.forEach(function (c, i) {
    if (i % every !== 0) return;
    var d = new Date(c.t);
    var lblT = TF_MS[state.activeTF] >= 864e5
      ? (d.getUTCMonth() + 1) + "/" + d.getUTCDate()
      : String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
    g.fillText(lblT, X(i) - 12, H - 7);
  });
}
