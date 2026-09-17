/* =====================================================================
   الاستراتيجيات — مشغِّلٌ ثم بوّابات.

   البنية مقصودة وتفصل سؤالين يخلطهما أكثرُ المؤشّرات:

   `side(x)` المشغِّل — هل ظهرت الاستراتيجية أصلاً، وفي أي جهة؟ يُعيد
   `+1` أو `−1` أو `0` فتكون غير مفعَّلة.

   `gates` البوّابات — **كم هي قويّة في تلك الجهة**؟ كلٌّ تصوّت ‎+1‎
   (تؤيّد) أو ‎−1‎ (تناقض) أو ‎0‎ (حائرة)، والنتيجة مجموعُها المرجَّح
   منقولاً من ‎−1..+1‎ إلى ‎0..100‎.

   ولماذا الفصل: خلطُهما يعطي رقماً متوسّطاً لا يُعرف أهو «إشارةٌ
   ضعيفة» أم «لا إشارة» — وهما حالتان مختلفتان تماماً. رقمُ ‎50‎ في
   نظامٍ مخلوط يعني الاثنتين، وفي هذا النظام يعني الأولى وحدها لأن
   الثانية لا تصل إلى `gates` أصلاً.

   ---------------------------------------------------------------------
   `fam` العائلة — وهي شرطٌ في الثقة لا تصنيفٌ للعرض.

   ثلاثُ نكهاتٍ من فكرةٍ واحدة تتّفق دائماً، فاتّفاقُها تكرارٌ لا
   تأكيد. ولهذا يشترط `consensus.js` عائلتين متمايزتين قبل أن يسمّي
   التوافقَ قوياً — وبلا هذا الشرط يصير أسهلَ ما في النظام أن يشتعل
   «إجماع» كلّما اتّفق الزخم مع الاختراق مع توافق الفريمات، وثلاثتها
   تقيس الاستمرار نفسه.

   ---------------------------------------------------------------------
   `hz` الآفاق — أي أفقٍ تصلح له.

   `Ichimoku` على فريم الخمس دقائق ضجيج، و`Puell` على الأفق اللحظي بلا
   معنى: مقياسٌ يتحرّك مرّةً في الشهر لا يقول شيئاً عن الساعات الثلاث
   القادمة. فكلُّ استراتيجيةٍ تُعلن آفاقَها ولا تُقحَم فيما لا يناسبها.

   ---------------------------------------------------------------------
   السياق `x`:
     x.a      تحليلُ الفريم القائد للأفق (من `computeAll`)
     x.all    كل الفريمات — للتأكيد من الأعلى
     x.ext    الخارجي: المشتقات، الأونتشين، الماكرو، المشاعر، الأخبار
     x.hz     مُعرِّف الأفق
   ===================================================================== */

var STRATEGIES = [

/* ===================== عائلة الاتجاه ===================== */

{ id: "emaRibbon", lbl: "شريط المتوسّطات", fam: "trend", hz: ["scalp", "daily", "weekly"],
  desc: "ترتيب المتوسّطات ‎20/50/200‎ فوق بعضها أو تحتها — أبسط تعريفٍ للاتجاه وأثبتُها.",
  side: function (x) {
    var a = x.a; if (a.E20 === null || a.E50 === null) return 0;
    if (a.px > a.E20 && a.E20 > a.E50) return 1;
    if (a.px < a.E20 && a.E20 < a.E50) return -1;
    return 0;
  },
  gates: [
    { id: "above200", lbl: "فوق متوسّط 200", w: 2.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E200 === null) return 0;
        return (a.px > a.E200) === (d > 0) ? 1 : -1; } },
    { id: "stack", lbl: "ترتيب كامل", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null || a.E200 === null) return 0;
        return (a.E50 > a.E200) === (d > 0) ? 1 : -1; } },
    { id: "slope", lbl: "ميل المتوسّط", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a, p = prevOf(a.e50, 3); if (p === null || a.E50 === null) return 0;
        return ((a.E50 - p) > 0) === (d > 0) ? 1 : -1; } },
    { id: "adxOn", lbl: "اتجاه قائم", w: 1.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v >= 25 ? 1 : v < 18 ? -1 : 0); } },
    { id: "htf", lbl: "موافقة الفريم الأعلى", w: 2.0, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.E50 === null) return 0;
        return (hi.px > hi.E50) === (d > 0) ? 1 : -1; } },
    { id: "room", lbl: "متّسع عن المتوسّط", w: 1.0, kind: "price", v: function (x) {
        var a = x.a; if (a.E20 === null || !a.ATR) return 0;
        var dist = Math.abs(a.px - a.E20) / a.ATR;
        return dist < 2.5 ? 1 : dist > 4 ? -1 : 0; } }
  ] },

{ id: "goldenCross", lbl: "التقاطع الذهبي/الميت", fam: "trend", hz: ["daily", "weekly"],
  desc: "تقاطع متوسّط ‎50‎ مع ‎200‎ — أبطأ إشارةٍ في السوق وأشهرُها، تصف الحقبة لا اللحظة.",
  side: function (x) {
    var a = x.a; if (a.S50 === null || a.S200 === null) return 0;
    return a.S50 > a.S200 ? 1 : -1;
  },
  gates: [
    { id: "fresh", lbl: "التقاطع حديث", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a, n = a.c.length, cross = -1;
        for (var i = n - 1; i > Math.max(0, n - 120); i--) {
          if (a.s50[i] === null || a.s200[i] === null || a.s50[i - 1] === null) continue;
          if ((a.s50[i] > a.s200[i]) !== (a.s50[i - 1] > a.s200[i - 1])) { cross = n - i; break; }
        }
        if (cross < 0) return 0;
        return cross <= 30 ? 1 : cross > 90 ? -1 : 0; } },
    { id: "gap", lbl: "اتّساع الفجوة", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (!a.S200) return 0;
        var g = (a.S50 - a.S200) / a.S200 * 100;
        return (g > 0) === (d > 0) && Math.abs(g) > 2 ? 1 : Math.abs(g) < 0.5 ? -1 : 0; } },
    { id: "pxSide", lbl: "السعر في الجهة", w: 2.0, kind: "price", v: function (x, d) {
        var a = x.a; return (a.px > a.S200) === (d > 0) ? 1 : -1; } },
    { id: "slope200", lbl: "ميل متوسّط 200", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a, p = prevOf(a.s200, 10); if (p === null) return 0;
        return ((a.S200 - p) > 0) === (d > 0) ? 1 : -1; } }
  ] },

{ id: "supertrend", lbl: "سوبرترند", fam: "trend", hz: ["scalp", "daily", "weekly"],
  desc: "خطُّ وقفٍ زاحف بالتذبذب. الإشارة انقلابُ جهته، وقوّتها في طزاجة الانقلاب.",
  side: function (x) { return x.a.STdir || 0; },
  gates: [
    { id: "flip", lbl: "انقلابٌ حديث", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a, n = a.st.dir.length, since = -1;
        for (var i = n - 1; i > Math.max(0, n - 40); i--) {
          if (a.st.dir[i] !== a.st.dir[i - 1]) { since = n - 1 - i; break; }
        }
        if (since < 0) return 0;
        return since <= 5 ? 1 : since > 25 ? -1 : 0; } },
    { id: "adxOn", lbl: "اتجاه قائم", w: 2.0, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v >= 23 ? 1 : v < 17 ? -1 : 0); } },
    { id: "diSide", lbl: "الجهة المهيمنة", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.PDI === null) return 0;
        return ((a.PDI > a.MDI) === (d > 0)) ? 1 : -1; } },
    { id: "htf", lbl: "موافقة الفريم الأعلى", w: 1.5, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || !hi.STdir) return 0;
        return hi.STdir === d ? 1 : -1; } },
    { id: "notStretched", lbl: "لم يبتعد كثيراً", w: 1.0, kind: "price", v: function (x) {
        var a = x.a; if (!a.STline || !a.ATR) return 0;
        var dist = Math.abs(a.px - a.STline) / a.ATR;
        return dist < 3 ? 1 : dist > 5 ? -1 : 0; } }
  ] },

{ id: "ichimoku", lbl: "إيتشيموكو", fam: "trend", hz: ["daily", "weekly"],
  desc: "نظامٌ كامل: السعر مقابل السحابة، وتقاطع تنكان-كيجون، وسمك السحابة.",
  side: function (x) {
    var a = x.a; if (a.SPANA === null || a.SPANB === null) return 0;
    var top = Math.max(a.SPANA, a.SPANB), bot = Math.min(a.SPANA, a.SPANB);
    if (a.px > top) return 1;
    if (a.px < bot) return -1;
    return 0;
  },
  gates: [
    { id: "tkCross", lbl: "تقاطع تنكان-كيجون", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.TENKAN === null || a.KIJUN === null) return 0;
        return ((a.TENKAN > a.KIJUN) === (d > 0)) ? 1 : -1; } },
    { id: "cloudDir", lbl: "السحابة القادمة في الجهة", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.SPANA === null) return 0;
        return ((a.SPANA > a.SPANB) === (d > 0)) ? 1 : -1; } },
    { id: "thick", lbl: "سحابةٌ سميكة تحمي", w: 1.0, kind: "ind", v: function (x) {
        var a = x.a; if (a.SPANA === null || !a.px) return 0;
        var t = Math.abs(a.SPANA - a.SPANB) / a.px * 100;
        return t > 1.5 ? 1 : t < 0.4 ? -1 : 0; } },
    { id: "kijunSide", lbl: "فوق/تحت كيجون", w: 1.5, kind: "price", v: function (x, d) {
        var a = x.a; if (a.KIJUN === null) return 0;
        return ((a.px > a.KIJUN) === (d > 0)) ? 1 : -1; } },
    { id: "adxOn", lbl: "اتجاه قائم", w: 1.0, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v >= 22 ? 1 : v < 16 ? -1 : 0); } }
  ] },

{ id: "adxTrend", lbl: "قوّة الاتجاه ADX", fam: "trend", hz: ["scalp", "daily", "weekly"],
  desc: "‎ADX‎ يقيس القوّة و‎DI‎ يقيس الجهة. لا تُطلَق إلا فوق ‎25‎ — تحتها السوق عرضي.",
  side: function (x) {
    var a = x.a; if (a.ADX === null || a.ADX < 25 || a.PDI === null) return 0;
    return a.PDI > a.MDI ? 1 : -1;
  },
  gates: [
    { id: "strength", lbl: "قوّة الاتجاه", w: 2.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v >= 35 ? 1 : v >= 27 ? 0 : -1; } },
    { id: "rising", lbl: "القوّة تتصاعد", w: 2.0, kind: "ind", v: function (x) {
        var a = x.a, p = prevOf(a.adx, 3); if (p === null) return 0;
        return a.ADX > p ? 1 : -1; } },
    { id: "spread", lbl: "فجوة DI واضحة", w: 1.5, kind: "ind", v: function (x) {
        var a = x.a; var s = Math.abs(a.PDI - a.MDI);
        return s > 12 ? 1 : s < 5 ? -1 : 0; } },
    { id: "maAgree", lbl: "المتوسّط يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "psarFlip", lbl: "انقلاب بارابوليك", fam: "trend", hz: ["scalp", "daily"],
  desc: "نقاطُ وقفٍ تتسارع مع الاتجاه. إشارتُها الانقلاب، وضعفُها السوق العرضي.",
  side: function (x) { return x.a.SARdir || 0; },
  gates: [
    { id: "fresh", lbl: "انقلابٌ حديث", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a; return (a.SARdirP !== null && a.SARdirP !== a.SARdir) ? 1 : 0; } },
    { id: "adxOn", lbl: "ليس سوقاً عرضياً", w: 2.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v >= 25 ? 1 : v < 18 ? -1 : 0); } },
    { id: "maAgree", lbl: "المتوسّط يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E20 === null) return 0;
        return ((a.px > a.E20) === (d > 0)) ? 1 : -1; } },
    { id: "htf", lbl: "موافقة الفريم الأعلى", w: 1.5, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || !hi.STdir) return 0;
        return hi.STdir === d ? 1 : -1; } }
  ] },

{ id: "donchian", lbl: "اختراق دونشيان", fam: "trend", hz: ["daily", "weekly"],
  desc: "نظام السلاحف: اختراق قمّة/قاع ‎20‎ شمعة. أقدم استراتيجيةٍ منهجية موثَّقة.",
  side: function (x) {
    var a = x.a, p = a.c.length - 2;
    if (a.D20u === null) return 0;
    var pu = a.d20.up[p], pl = a.d20.lo[p];
    if (pu !== null && a.px > pu) return 1;
    if (pl !== null && a.px < pl) return -1;
    return 0;
  },
  gates: [
    { id: "vol", lbl: "حجمٌ مؤكِّد", w: 2.0, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        var r = a.VOL / a.volMed; return r > 1.5 ? 1 : r < 0.8 ? -1 : 0; } },
    { id: "d55", lbl: "اختراق النطاق الأطول", w: 2.0, kind: "price", v: function (x, d) {
        var a = x.a;
        if (d > 0 && a.D55u !== null) return a.px >= a.D55u ? 1 : 0;
        if (d < 0 && a.D55l !== null) return a.px <= a.D55l ? 1 : 0;
        return 0; } },
    { id: "adxOn", lbl: "اتجاه قائم", w: 1.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v >= 22 ? 1 : v < 16 ? -1 : 0); } },
    { id: "notBlowoff", lbl: "لا استنزاف في RSI", w: 1.5, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        if (d > 0) return r > 82 ? -1 : r < 72 ? 1 : 0;
        return r < 18 ? -1 : r > 28 ? 1 : 0; } },
    { id: "close", lbl: "إغلاقٌ في طرف الشمعة", w: 1.0, kind: "price", v: function (x, d) {
        var c = x.a.k[x.a.n - 1], rng = c.h - c.l; if (rng <= 0) return 0;
        var pos = (c.c - c.l) / rng;
        return (d > 0 ? pos > 0.7 : pos < 0.3) ? 1 : -1; } }
  ] },

{ id: "ma200w", lbl: "متوسّط 200 أسبوع", fam: "cycle", hz: ["weekly"],
  desc: "أرضيةُ الدورة التاريخية. البتكوين لم يُغلق تحته إلا في قيعانٍ كبرى معدودة.",
  side: function (x) {
    var w = x.all["1w"]; if (!w || w.n < 210) return 0;
    var m = sma(w.c, 200), v = last(m);
    if (v === null) return 0;
    return w.px > v ? 1 : -1;
  },
  gates: [
    { id: "dist", lbl: "المسافة عن الأرضية", w: 2.5, kind: "price", v: function (x, d) {
        var w = x.all["1w"]; var v = last(sma(w.c, 200)); if (!v) return 0;
        var r = w.px / v;
        if (d > 0) return r > 1.3 ? 1 : r < 1.05 ? -1 : 0;
        return r < 0.9 ? 1 : 0; } },
    { id: "slope", lbl: "الأرضية ترتفع", w: 2.0, kind: "ind", v: function (x) {
        var w = x.all["1w"]; var m = sma(w.c, 200);
        var a = last(m), b = prevOf(m, 8); if (a === null || b === null) return 0;
        return a > b ? 1 : -1; } },
    { id: "wTrend", lbl: "الاتجاه الأسبوعي", w: 1.5, kind: "ind", v: function (x, d) {
        var w = x.all["1w"]; if (!w || w.E50 === null) return 0;
        return ((w.px > w.E50) === (d > 0)) ? 1 : -1; } }
  ] },

/* ===================== عائلة الزخم ===================== */

{ id: "macdCross", lbl: "تقاطع الماكد", fam: "momo", hz: ["scalp", "daily", "weekly"],
  desc: "خطُّ الماكد فوق إشارته أو تحتها، وقوّةُ الإشارة في تسارع الهيستوغرام.",
  side: function (x) {
    var a = x.a; if (a.MACD === null || a.SIG === null) return 0;
    return a.MACD > a.SIG ? 1 : -1;
  },
  gates: [
    { id: "rising", lbl: "الهيستوغرام يتسارع", w: 2.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.HIST === null || a.HISTp === null) return 0;
        var g = a.HIST - a.HISTp;
        return (g > 0) === (d > 0) ? 1 : -1; } },
    { id: "zero", lbl: "في الجهة الصحيحة من الصفر", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a; return ((a.MACD > 0) === (d > 0)) ? 1 : -1; } },
    { id: "fresh", lbl: "تقاطعٌ حديث", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a, n = a.macd.hist.length, since = -1;
        for (var i = n - 1; i > Math.max(1, n - 30); i--) {
          if (a.macd.hist[i] === null || a.macd.hist[i - 1] === null) continue;
          if ((a.macd.hist[i] > 0) !== (a.macd.hist[i - 1] > 0)) { since = n - 1 - i; break; }
        }
        return since < 0 ? 0 : since <= 4 ? 1 : since > 15 ? -1 : 0; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } },
    { id: "htf", lbl: "موافقة الفريم الأعلى", w: 1.0, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.HIST === null) return 0;
        return ((hi.HIST > 0) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "rsiRegime", lbl: "نظام RSI", fam: "momo", hz: ["scalp", "daily", "weekly"],
  desc: "في الاتجاه الصاعد يعمل ‎RSI‎ بين ‎40‎ و‎80‎، وفي الهابط بين ‎20‎ و‎60‎. النطاق نفسه إشارة.",
  side: function (x) {
    var r = x.a.RSI; if (r === null) return 0;
    if (r > 55) return 1;
    if (r < 45) return -1;
    return 0;
  },
  gates: [
    { id: "holds", lbl: "يحترم نطاق الاتجاه", w: 2.5, kind: "ind", v: function (x, d) {
        var a = x.a, w = a.rsi.slice(-20).filter(function (v) { return v !== null; });
        if (w.length < 10) return 0;
        var mn = Math.min.apply(null, w), mx = Math.max.apply(null, w);
        if (d > 0) return mn > 38 ? 1 : mn < 30 ? -1 : 0;
        return mx < 62 ? 1 : mx > 70 ? -1 : 0; } },
    { id: "notExtreme", lbl: "لم يبلغ التطرّف", w: 2.0, kind: "ind", v: function (x, d) {
        var r = x.a.RSI;
        if (d > 0) return r > 78 ? -1 : r < 70 ? 1 : 0;
        return r < 22 ? -1 : r > 30 ? 1 : 0; } },
    { id: "slope", lbl: "الزخم يتصاعد", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.RSIp === null) return 0;
        return ((a.RSI - a.RSIp) > 0) === (d > 0) ? 1 : -1; } },
    { id: "maAgree", lbl: "المتوسّط يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "rsiDiv", lbl: "تباعد RSI", fam: "revert", hz: ["scalp", "daily", "weekly"],
  desc: "قمّةٌ أعلى في السعر وأدنى في ‎RSI‎ — الزخمُ يتخلّى عن الحركة قبل انعكاسها.",
  side: function (x) {
    var d = (x.a.divRsi || []).filter(function (v) { return v.kind === "regular"; });
    return d.length ? d[d.length - 1].dir : 0;
  },
  gates: [
    { id: "extreme", lbl: "عند حافّة RSI", w: 2.5, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        if (d > 0) return r < 35 ? 1 : r > 50 ? -1 : 0;
        return r > 65 ? 1 : r < 50 ? -1 : 0; } },
    { id: "atBand", lbl: "عند حافّة بولنجر", w: 2.0, kind: "price", v: function (x, d) {
        var b = x.a.PCTB; if (b === null) return 0;
        if (d > 0) return b < 0.15 ? 1 : b > 0.5 ? -1 : 0;
        return b > 0.85 ? 1 : b < 0.5 ? -1 : 0; } },
    { id: "notStrongTrend", lbl: "لا اتجاه ساحق", w: 2.0, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v < 30 ? 1 : v > 40 ? -1 : 0); } },
    { id: "macdAgree", lbl: "الماكد يوافق التباعد", w: 1.5, kind: "ind", v: function (x, d) {
        var dm = (x.a.divMacd || []).filter(function (v) { return v.kind === "regular" && v.dir === d; });
        return dm.length ? 1 : 0; } },
    { id: "pattern", lbl: "شمعةٌ مؤكِّدة", w: 1.0, kind: "price", v: function (x, d) {
        var p = x.a.pattern; if (!p || !p.dir) return 0;
        return p.dir === d ? 1 : -1; } }
  ] },

{ id: "macdDiv", lbl: "تباعد الماكد", fam: "revert", hz: ["daily", "weekly"],
  desc: "التباعد على الهيستوغرام — أبطأ من ‎RSI‎ وأقلّ إنذاراً كاذباً على الفريمات الكبيرة.",
  side: function (x) {
    var d = (x.a.divMacd || []).filter(function (v) { return v.kind === "regular"; });
    return d.length ? d[d.length - 1].dir : 0;
  },
  gates: [
    { id: "histTurn", lbl: "الهيستوغرام ينعطف", w: 2.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.HIST === null || a.HISTp === null) return 0;
        return ((a.HIST - a.HISTp) > 0) === (d > 0) ? 1 : -1; } },
    { id: "extreme", lbl: "عند حافّة السعر", w: 2.0, kind: "price", v: function (x, d) {
        var b = x.a.PCTB; if (b === null) return 0;
        if (d > 0) return b < 0.2 ? 1 : -1;
        return b > 0.8 ? 1 : -1; } },
    { id: "notStrongTrend", lbl: "لا اتجاه ساحق", w: 1.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v < 32 ? 1 : v > 42 ? -1 : 0); } },
    { id: "rsiAgree", lbl: "RSI يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var dr = (x.a.divRsi || []).filter(function (v) { return v.kind === "regular" && v.dir === d; });
        return dr.length ? 1 : 0; } }
  ] },

{ id: "stochRsi", lbl: "ستوكاستك RSI", fam: "momo", hz: ["scalp", "daily"],
  desc: "أسرع مقاييس الزخم. يُقرأ عند الحوافّ وحدها — وسطُه بلا دلالة.",
  side: function (x) {
    var a = x.a; if (a.SRSIK === null || a.SRSID === null) return 0;
    if (a.SRSIK < 20 && a.SRSIK > a.SRSID) return 1;
    if (a.SRSIK > 80 && a.SRSIK < a.SRSID) return -1;
    return 0;
  },
  gates: [
    { id: "turn", lbl: "انعطافٌ مؤكَّد", w: 2.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.SRSIKp === null) return 0;
        return ((a.SRSIK - a.SRSIKp) > 0) === (d > 0) ? 1 : -1; } },
    { id: "trendAgree", lbl: "في جهة الاتجاه الأمّ", w: 2.5, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.E50 === null) return 0;
        return ((hi.px > hi.E50) === (d > 0)) ? 1 : -1; } },
    { id: "rsiRoom", lbl: "متّسع في RSI", w: 1.5, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        if (d > 0) return r < 45 ? 1 : r > 60 ? -1 : 0;
        return r > 55 ? 1 : r < 40 ? -1 : 0; } },
    { id: "notTrending", lbl: "ليس اتجاهاً ساحقاً", w: 1.0, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v < 35 ? 1 : -1); } }
  ] },

{ id: "mfiFlow", lbl: "تدفّق الأموال MFI", fam: "flow", hz: ["scalp", "daily", "weekly"],
  desc: "‎RSI‎ مرجّحاً بالحجم. يفرّق بين حركةٍ يدعمها تدفّقٌ وحركةٍ فارغة.",
  side: function (x) {
    var m = x.a.MFI; if (m === null) return 0;
    if (m > 55) return 1;
    if (m < 45) return -1;
    return 0;
  },
  gates: [
    { id: "notExtreme", lbl: "لم يبلغ التطرّف", w: 2.0, kind: "ind", v: function (x, d) {
        var m = x.a.MFI;
        if (d > 0) return m > 85 ? -1 : m < 75 ? 1 : 0;
        return m < 15 ? -1 : m > 25 ? 1 : 0; } },
    { id: "agreeRsi", lbl: "يوافق RSI", w: 2.0, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        return ((r > 50) === (d > 0)) ? 1 : -1; } },
    { id: "volReal", lbl: "حجمٌ حقيقي", w: 1.5, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        return a.VOL / a.volMed > 0.9 ? 1 : -1; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "rocMomo", lbl: "زخم معدّل التغيّر", fam: "momo", hz: ["scalp", "daily"],
  desc: "التغيّر النسبي عبر ‎12‎ شمعة — أبسط مقياسٍ للتسارع، ويُقرأ مع الاتجاه.",
  side: function (x) {
    var r = x.a.ROC; if (r === null) return 0;
    return r > 0.6 ? 1 : r < -0.6 ? -1 : 0;
  },
  gates: [
    { id: "accel", lbl: "التسارع مستمر", w: 2.5, kind: "ind", v: function (x, d) {
        var a = x.a, p = prevOf(a.roc, 2); if (p === null) return 0;
        return ((a.ROC - p) > 0) === (d > 0) ? 1 : -1; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } },
    { id: "adxOn", lbl: "اتجاه قائم", w: 1.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v >= 22 ? 1 : -1); } },
    { id: "notBlowoff", lbl: "لا استنزاف", w: 1.0, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        return (d > 0 ? r < 78 : r > 22) ? 1 : -1; } }
  ] },

/* ===================== عائلة التذبذب ===================== */

{ id: "sqzBreak", lbl: "خروجٌ من انضغاط", fam: "vol", hz: ["scalp", "daily", "weekly"],
  desc: "بولنجر داخل كيلتنر يعني هدوءاً، والخروجُ منه حركةٌ موجَّهة. الجهة من الزخم.",
  side: function (x) {
    var a = x.a;
    if (a.SQZ !== false || a.SQZp !== true) return 0;   // خرج للتوّ من الانضغاط
    if (a.HIST === null) return 0;
    return a.HIST > 0 ? 1 : -1;
  },
  gates: [
    { id: "vol", lbl: "حجمٌ مؤكِّد", w: 2.5, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        var r = a.VOL / a.volMed; return r > 1.4 ? 1 : r < 0.9 ? -1 : 0; } },
    { id: "wasQuiet", lbl: "هدوءٌ طويل سبقه", w: 2.0, kind: "ind", v: function (x) {
        var a = x.a, cnt = 0;
        for (var i = a.sq.length - 2; i >= 0 && a.sq[i] === true; i--) cnt++;
        return cnt >= 8 ? 1 : cnt < 3 ? -1 : 0; } },
    { id: "bodyDir", lbl: "جسمُ الشمعة في الجهة", w: 2.0, kind: "price", v: function (x, d) {
        var c = x.a.k[x.a.n - 1], rng = c.h - c.l; if (rng <= 0) return 0;
        var pos = (c.c - c.l) / rng;
        return (d > 0 ? pos > 0.65 : pos < 0.35) ? 1 : -1; } },
    { id: "htf", lbl: "موافقة الفريم الأعلى", w: 1.5, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.E50 === null) return 0;
        return ((hi.px > hi.E50) === (d > 0)) ? 1 : -1; } },
    { id: "widening", lbl: "النطاق يتّسع", w: 1.0, kind: "ind", v: function (x) {
        var a = x.a, p = prevOf(a.bb.width, 2);
        if (a.BBW === null || p === null) return 0;
        return a.BBW > p ? 1 : -1; } }
  ] },

{ id: "bbRevert", lbl: "عودة من حافّة بولنجر", fam: "revert", hz: ["scalp", "daily"],
  desc: "لمسُ الحافّة في سوقٍ عرضي عودةٌ للوسط. وفي الاتجاه القوي ليست إشارةً بل استمراراً.",
  side: function (x) {
    var a = x.a; if (a.PCTB === null) return 0;
    if (a.ADX !== null && a.ADX > 32) return 0;      // اتجاهٌ قوي: لا ارتداد
    if (a.PCTB < 0.05) return 1;
    if (a.PCTB > 0.95) return -1;
    return 0;
  },
  gates: [
    { id: "range", lbl: "سوقٌ عرضي فعلاً", w: 2.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v < 20 ? 1 : v > 28 ? -1 : 0); } },
    { id: "rsiExtreme", lbl: "RSI متطرّف", w: 2.0, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        return (d > 0 ? r < 32 : r > 68) ? 1 : (d > 0 ? r > 45 : r < 55) ? -1 : 0; } },
    { id: "wick", lbl: "فتيلُ رفضٍ عند الحافّة", w: 2.0, kind: "price", v: function (x, d) {
        var c = x.a.k[x.a.n - 1], rng = c.h - c.l; if (rng <= 0) return 0;
        var w = d > 0 ? (Math.min(c.c, c.o) - c.l) / rng : (c.h - Math.max(c.c, c.o)) / rng;
        return w > 0.35 ? 1 : w < 0.12 ? -1 : 0; } },
    { id: "notFalling", lbl: "الوسط لا ينهار", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a, p = prevOf(a.bb.mid, 5); if (p === null || a.BBm === null) return 0;
        var sl = a.BBm - p;
        return (d > 0 ? sl > -a.ATR : sl < a.ATR) ? 1 : -1; } },
    { id: "pattern", lbl: "شمعةٌ مؤكِّدة", w: 1.0, kind: "price", v: function (x, d) {
        var p = x.a.pattern; if (!p || !p.dir) return 0;
        return p.dir === d ? 1 : -1; } }
  ] },

{ id: "keltnerBreak", lbl: "اختراق كيلتنر", fam: "vol", hz: ["scalp", "daily"],
  desc: "الخروج خارج قناة كيلتنر حركةٌ تفوق التذبذب المعتاد — استمرارٌ لا ارتداد.",
  side: function (x) {
    var a = x.a; if (a.KCu === null) return 0;
    if (a.px > a.KCu) return 1;
    if (a.px < a.KCl) return -1;
    return 0;
  },
  gates: [
    { id: "adxOn", lbl: "اتجاه قائم", w: 2.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v >= 25 ? 1 : v < 18 ? -1 : 0); } },
    { id: "vol", lbl: "حجمٌ مؤكِّد", w: 2.0, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        return a.VOL / a.volMed > 1.3 ? 1 : -1; } },
    { id: "htf", lbl: "موافقة الفريم الأعلى", w: 1.5, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.E50 === null) return 0;
        return ((hi.px > hi.E50) === (d > 0)) ? 1 : -1; } },
    { id: "notBlowoff", lbl: "لا استنزاف", w: 1.5, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        return (d > 0 ? r < 80 : r > 20) ? 1 : -1; } }
  ] },

{ id: "atrExpand", lbl: "توسّع التذبذب", fam: "vol", hz: ["scalp", "daily"],
  desc: "قفزةُ ‎ATR‎ فوق عادته تعني دخول لاعبٍ كبير. الجهة من جسم الشمعة.",
  side: function (x) {
    var a = x.a, r = pctRankOf(a.atr, 100);
    if (r === null || r < 80) return 0;
    var c = a.k[a.n - 1], rng = c.h - c.l; if (rng <= 0) return 0;
    var pos = (c.c - c.l) / rng;
    if (pos > 0.65) return 1;
    if (pos < 0.35) return -1;
    return 0;
  },
  gates: [
    { id: "vol", lbl: "حجمٌ يرافق", w: 2.5, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        return a.VOL / a.volMed > 1.6 ? 1 : -1; } },
    { id: "trendAgree", lbl: "في جهة الاتجاه", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } },
    { id: "cvdAgree", lbl: "الدلتا توافق", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.CVD === null || a.CVDp === null) return 0;
        return ((a.CVD - a.CVDp) > 0) === (d > 0) ? 1 : -1; } },
    { id: "notExhausted", lbl: "ليس استنزافاً", w: 1.5, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        return (d > 0 ? r < 82 : r > 18) ? 1 : -1; } }
  ] },

/* ===================== عائلة الحجم والتدفّق ===================== */

{ id: "obvConfirm", lbl: "تأكيد OBV", fam: "flow", hz: ["daily", "weekly"],
  desc: "الحجم التراكمي يوافق السعر أم يخالفه. مخالفتُه إنذارٌ مبكّر بانقطاع الوقود.",
  side: function (x) {
    var a = x.a, p = prevOf(a.obv, 10); if (a.OBV === null || p === null) return 0;
    return a.OBV > p ? 1 : -1;
  },
  gates: [
    { id: "pxAgree", lbl: "السعر يوافق", w: 2.5, kind: "price", v: function (x, d) {
        var a = x.a, p = a.c[Math.max(0, a.n - 11)];
        return ((a.px > p) === (d > 0)) ? 1 : -1; } },
    { id: "noDiv", lbl: "لا تباعد معاكس", w: 2.0, kind: "ind", v: function (x, d) {
        var dv = (x.a.divObv || []).filter(function (v) { return v.kind === "regular"; });
        if (!dv.length) return 1;
        return dv[dv.length - 1].dir === d ? 1 : -1; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } },
    { id: "adAgree", lbl: "خطُّ التجميع يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a, p = prevOf(a.ad, 10); if (a.AD === null || p === null) return 0;
        return ((a.AD > p) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "cvdDelta", lbl: "دلتا المشتري الآخذ", fam: "flow", hz: ["scalp", "daily"],
  desc: "من كان يبادر: المشتري الذي يضرب العرض أم البائع. أقربُ ما نبلغه من تدفّق الأوامر.",
  side: function (x) {
    var a = x.a, p = prevOf(a.cvd, 6);
    if (a.CVD === null || p === null) return 0;
    var chg = a.CVD - p;
    if (!a.volMed) return 0;
    if (Math.abs(chg) < a.volMed * 0.5) return 0;
    return chg > 0 ? 1 : -1;
  },
  gates: [
    { id: "pxAgree", lbl: "السعر يوافق الدلتا", w: 2.5, kind: "price", v: function (x, d) {
        var a = x.a, p = a.c[Math.max(0, a.n - 7)];
        return ((a.px > p) === (d > 0)) ? 1 : -1; } },
    { id: "accel", lbl: "الدلتا تتسارع", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a, p1 = prevOf(a.cvd, 1), p2 = prevOf(a.cvd, 2);
        if (p1 === null || p2 === null) return 0;
        var g1 = a.CVD - p1, g2 = p1 - p2;
        return (Math.abs(g1) > Math.abs(g2) && (g1 > 0) === (d > 0)) ? 1 : -1; } },
    { id: "vol", lbl: "حجمٌ حقيقي", w: 1.5, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        return a.VOL / a.volMed > 1.1 ? 1 : -1; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E20 === null) return 0;
        return ((a.px > a.E20) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "vwapRevert", lbl: "الانحراف عن VWAP", fam: "revert", hz: ["scalp", "daily"],
  desc: "‎VWAP‎ اليومي هو متوسّطُ تكلفة السوق. الابتعاد عنه بانحرافين يميل للعودة.",
  side: function (x) {
    var a = x.a; if (a.VWAPD === null || !a.VWSD) return 0;
    var z = (a.px - a.VWAPD) / a.VWSD;
    if (z < -2) return 1;
    if (z > 2) return -1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق الانحراف", w: 2.5, kind: "price", v: function (x, d) {
        var a = x.a; var z = Math.abs((a.px - a.VWAPD) / a.VWSD);
        return z > 2.6 ? 1 : z < 2.1 ? -1 : 0; } },
    { id: "notTrending", lbl: "ليس اتجاهاً ساحقاً", w: 2.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v < 28 ? 1 : v > 36 ? -1 : 0); } },
    { id: "wick", lbl: "فتيلُ رفض", w: 1.5, kind: "price", v: function (x, d) {
        var c = x.a.k[x.a.n - 1], rng = c.h - c.l; if (rng <= 0) return 0;
        var w = d > 0 ? (Math.min(c.c, c.o) - c.l) / rng : (c.h - Math.max(c.c, c.o)) / rng;
        return w > 0.3 ? 1 : -1; } },
    { id: "weekAnchor", lbl: "الجهة الصحيحة أسبوعياً", w: 1.0, kind: "price", v: function (x, d) {
        var a = x.a; if (a.VWAPW === null) return 0;
        return ((a.px > a.VWAPW) === (d > 0)) ? 1 : 0; } }
  ] },

{ id: "volProfile", lbl: "تفاعل ملفّ الحجم", fam: "level", hz: ["scalp", "daily"],
  desc: "‎POC‎ أكثر سعرٍ تداولاً، وحوافُّ منطقة القيمة حيث يتوقّف السوق فعلاً.",
  side: function (x) {
    var a = x.a, vp = a.vp; if (!vp || !a.ATR) return 0;
    var nearVal = Math.abs(a.px - vp.val) < a.ATR * 0.7;
    var nearVah = Math.abs(a.px - vp.vah) < a.ATR * 0.7;
    if (nearVal && a.px > vp.val) return 1;
    if (nearVah && a.px < vp.vah) return -1;
    return 0;
  },
  gates: [
    { id: "pocSide", lbl: "الجهة الصحيحة من POC", w: 2.0, kind: "price", v: function (x, d) {
        var a = x.a; return ((a.px > a.vp.poc) === (d > 0)) ? 1 : -1; } },
    { id: "wick", lbl: "فتيلُ رفضٍ عند الحافّة", w: 2.0, kind: "price", v: function (x, d) {
        var c = x.a.k[x.a.n - 1], rng = c.h - c.l; if (rng <= 0) return 0;
        var w = d > 0 ? (Math.min(c.c, c.o) - c.l) / rng : (c.h - Math.max(c.c, c.o)) / rng;
        return w > 0.3 ? 1 : -1; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } },
    { id: "vol", lbl: "حجمٌ عند المستوى", w: 1.5, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        return a.VOL / a.volMed > 1.1 ? 1 : 0; } }
  ] },

/* ===================== عائلة هيكل السوق ===================== */

{ id: "structure", lbl: "هيكل السوق", fam: "struct", hz: ["scalp", "daily", "weekly"],
  desc: "قممٌ وقيعان صاعدة أم هابطة. أنقى تعريفٍ للاتجاه، بلا مؤشّرٍ ولا وسيط.",
  side: function (x) { return x.a.ms ? x.a.ms.trend : 0; },
  gates: [
    { id: "bos", lbl: "كسرُ هيكلٍ مؤكِّد", w: 2.5, kind: "price", v: function (x, d) {
        var ms = x.a.ms; if (!ms) return 0;
        if (ms.bos === d) return 1;
        if (ms.choch && ms.choch !== d) return -1;
        return 0; } },
    { id: "noChoch", lbl: "لا تغيّر طابعٍ معاكس", w: 2.0, kind: "price", v: function (x, d) {
        var ms = x.a.ms; if (!ms || !ms.choch) return 1;
        return ms.choch === d ? 1 : -1; } },
    { id: "htf", lbl: "موافقة الفريم الأعلى", w: 2.0, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || !hi.ms) return 0;
        return hi.ms.trend === d ? 1 : hi.ms.trend === 0 ? 0 : -1; } },
    { id: "adxOn", lbl: "اتجاه قائم", w: 1.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v >= 22 ? 1 : v < 16 ? -1 : 0); } }
  ] },

{ id: "fvgOb", lbl: "فجوة قيمةٍ عادلة", fam: "struct", hz: ["scalp", "daily"],
  desc: "ثلاثُ شموعٍ لا تتلامس أطرافُها — منطقةٌ يميل السعر للعودة إليها قبل أن يكمل.",
  side: function (x) {
    var g = (x.a.fvg || [])[0]; if (!g || !x.a.ATR) return 0;
    var mid = (g.hi + g.lo) / 2;
    if (Math.abs(x.a.px - mid) > x.a.ATR * 2) return 0;
    return g.dir;
  },
  gates: [
    { id: "near", lbl: "قريبٌ من الفجوة", w: 2.5, kind: "price", v: function (x) {
        var g = x.a.fvg[0], a = x.a;
        var d = Math.abs(a.px - (g.hi + g.lo) / 2) / a.ATR;
        return d < 0.8 ? 1 : d > 1.6 ? -1 : 0; } },
    { id: "fresh", lbl: "فجوةٌ حديثة", w: 1.5, kind: "ind", v: function (x) {
        var g = x.a.fvg[0], age = x.a.n - g.i;
        return age < 25 ? 1 : age > 70 ? -1 : 0; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } },
    { id: "structAgree", lbl: "الهيكل يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var ms = x.a.ms; if (!ms || !ms.trend) return 0;
        return ms.trend === d ? 1 : -1; } }
  ] },

{ id: "sweep", lbl: "مسحُ السيولة", fam: "struct", hz: ["scalp", "daily"],
  desc: "فتيلٌ يخترق قمّةً سابقة ثم يُغلق تحتها — إخراجُ الأوقاف قبل الحركة الحقيقية.",
  side: function (x) { return x.a.sweep ? x.a.sweep.dir : 0; },
  gates: [
    { id: "wickSize", lbl: "فتيلٌ طويل", w: 2.5, kind: "price", v: function (x, d) {
        var c = x.a.k[x.a.n - 1], rng = c.h - c.l; if (rng <= 0) return 0;
        var w = d > 0 ? (Math.min(c.c, c.o) - c.l) / rng : (c.h - Math.max(c.c, c.o)) / rng;
        return w > 0.5 ? 1 : w < 0.3 ? -1 : 0; } },
    { id: "vol", lbl: "حجمٌ عند المسح", w: 2.0, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        return a.VOL / a.volMed > 1.4 ? 1 : -1; } },
    { id: "htf", lbl: "موافقة الفريم الأعلى", w: 2.0, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.E50 === null) return 0;
        return ((hi.px > hi.E50) === (d > 0)) ? 1 : -1; } },
    { id: "rsiRoom", lbl: "متّسع في RSI", w: 1.0, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        return (d > 0 ? r < 50 : r > 50) ? 1 : -1; } }
  ] },

{ id: "fibGolden", lbl: "الجيب الذهبي", fam: "level", hz: ["scalp", "daily", "weekly"],
  desc: "ارتدادُ ‎0.618–0.65‎ من آخر تأرجح — أكثرُ منطقةٍ يراقبها السوق فعلاً.",
  side: function (x) {
    var f = x.a.fib; if (!f || !x.a.ATR) return 0;
    var lo = Math.min(f.golden[0], f.golden[1]), hi = Math.max(f.golden[0], f.golden[1]);
    var pad = x.a.ATR * 0.6;
    if (x.a.px >= lo - pad && x.a.px <= hi + pad) return f.dir;
    return 0;
  },
  gates: [
    { id: "inZone", lbl: "داخل المنطقة", w: 2.5, kind: "price", v: function (x) {
        var f = x.a.fib, a = x.a;
        var lo = Math.min(f.golden[0], f.golden[1]), hi = Math.max(f.golden[0], f.golden[1]);
        return (a.px >= lo && a.px <= hi) ? 1 : 0; } },
    { id: "trendAgree", lbl: "الاتجاه الأمّ يوافق", w: 2.5, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.E50 === null) return 0;
        return ((hi.px > hi.E50) === (d > 0)) ? 1 : -1; } },
    { id: "wick", lbl: "فتيلُ رفض", w: 1.5, kind: "price", v: function (x, d) {
        var c = x.a.k[x.a.n - 1], rng = c.h - c.l; if (rng <= 0) return 0;
        var w = d > 0 ? (Math.min(c.c, c.o) - c.l) / rng : (c.h - Math.max(c.c, c.o)) / rng;
        return w > 0.3 ? 1 : -1; } },
    { id: "rsiRoom", lbl: "متّسع في RSI", w: 1.5, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        return (d > 0 ? (r > 35 && r < 60) : (r < 65 && r > 40)) ? 1 : -1; } }
  ] },

{ id: "pivotLevel", lbl: "النقاط المحورية", fam: "level", hz: ["scalp", "daily"],
  desc: "محاورُ اليوم السابق — مستوياتٌ يضعها آلافُ المتداولين فتصير حقيقةً بذاتها.",
  side: function (x) {
    var d1 = x.all["1d"]; if (!d1 || d1.n < 3 || !x.a.ATR) return 0;
    var p = d1.n - 2;
    var pv = pivotLevels(d1.h[p], d1.l[p], d1.c[p], "classic");
    var px = x.a.px, pad = x.a.ATR * 0.5;
    if (Math.abs(px - pv.s1) < pad) return 1;
    if (Math.abs(px - pv.r1) < pad) return -1;
    if (Math.abs(px - pv.p) < pad) return px > pv.p ? 1 : -1;
    return 0;
  },
  gates: [
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } },
    { id: "wick", lbl: "فتيلُ رفضٍ عند المحور", w: 2.0, kind: "price", v: function (x, d) {
        var c = x.a.k[x.a.n - 1], rng = c.h - c.l; if (rng <= 0) return 0;
        var w = d > 0 ? (Math.min(c.c, c.o) - c.l) / rng : (c.h - Math.max(c.c, c.o)) / rng;
        return w > 0.3 ? 1 : -1; } },
    { id: "notTrending", lbl: "ليس اختراقاً ساحقاً", w: 1.5, kind: "ind", v: function (x) {
        var v = x.a.ADX; return v === null ? 0 : (v < 32 ? 1 : -1); } },
    { id: "vol", lbl: "حجمٌ عند المستوى", w: 1.0, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        return a.VOL / a.volMed > 1.1 ? 1 : 0; } }
  ] },

{ id: "rangeBreak", lbl: "اختراق نطاق اليوم", fam: "level", hz: ["scalp", "daily"],
  desc: "كسرُ قمّة أو قاع اليوم السابق بإغلاقٍ مقنع — أبسط اختراقٍ يتابعه السوق.",
  side: function (x) {
    var d1 = x.all["1d"]; if (!d1 || d1.n < 3) return 0;
    var p = d1.n - 2, px = x.a.px;
    if (px > d1.h[p]) return 1;
    if (px < d1.l[p]) return -1;
    return 0;
  },
  gates: [
    { id: "clear", lbl: "وضوح الكسر", w: 2.5, kind: "price", v: function (x, d) {
        var d1 = x.all["1d"], p = d1.n - 2, a = x.a;
        if (!a.ATR) return 0;
        var lv = d > 0 ? d1.h[p] : d1.l[p];
        var dist = Math.abs(a.px - lv) / a.ATR;
        return dist > 0.35 ? 1 : dist < 0.12 ? -1 : 0; } },
    { id: "notChase", lbl: "لم يفت الكسر", w: 2.0, kind: "price", v: function (x, d) {
        var d1 = x.all["1d"], p = d1.n - 2, a = x.a;
        if (!a.ATR) return 0;
        var lv = d > 0 ? d1.h[p] : d1.l[p];
        return Math.abs(a.px - lv) / a.ATR < 2 ? 1 : -1; } },
    { id: "vol", lbl: "حجمٌ مؤكِّد", w: 2.0, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        return a.VOL / a.volMed > 1.3 ? 1 : -1; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "candleLevel", lbl: "انعكاسٌ شمعي عند مستوى", fam: "struct", hz: ["scalp", "daily"],
  desc: "النمط الشمعي بلا مستوىً ضجيج. لا يُحتسب إلا عند التقائه بمستوىً يراقبه السوق.",
  side: function (x) {
    var p = x.a.pattern; if (!p || !p.dir || !x.a.ATR) return 0;
    var a = x.a, near = false, pad = a.ATR * 0.7;
    if (a.vp) {
      [a.vp.poc, a.vp.val, a.vp.vah].forEach(function (lv) {
        if (Math.abs(a.px - lv) < pad) near = true;
      });
    }
    if (a.E200 !== null && Math.abs(a.px - a.E200) < pad) near = true;
    if (a.VWAPD !== null && Math.abs(a.px - a.VWAPD) < pad) near = true;
    if (a.fib) {
      var g = a.fib.golden;
      if (a.px >= Math.min(g[0], g[1]) - pad && a.px <= Math.max(g[0], g[1]) + pad) near = true;
    }
    return near ? p.dir : 0;
  },
  gates: [
    { id: "strong", lbl: "نمطٌ قويّ", w: 2.5, kind: "price", v: function (x) {
        return x.a.pattern.strong ? 1 : 0; } },
    { id: "vol", lbl: "حجمٌ مؤكِّد", w: 2.0, kind: "ind", v: function (x) {
        var a = x.a; if (!a.volMed) return 0;
        return a.VOL / a.volMed > 1.2 ? 1 : -1; } },
    { id: "trendAgree", lbl: "الاتجاه الأمّ يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.E50 === null) return 0;
        return ((hi.px > hi.E50) === (d > 0)) ? 1 : -1; } },
    { id: "rsiRoom", lbl: "متّسع في RSI", w: 1.0, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        return (d > 0 ? r < 55 : r > 45) ? 1 : -1; } }
  ] },

{ id: "tfAlign", lbl: "توافق الفريمات", fam: "trend", hz: ["scalp", "daily", "weekly"],
  desc: "فريماتُ الأفق الثلاثة في جهةٍ واحدة. أقوى تأكيدٍ للاستمرار وأبطأُ إشارةٍ للانعكاس.",
  side: function (x) {
    var up = 0, dn = 0;
    x.tfs.forEach(function (tf) {
      var a = x.all[tf]; if (!a || a.E50 === null) return;
      if (a.px > a.E50) up++; else dn++;
    });
    if (up === x.tfs.length) return 1;
    if (dn === x.tfs.length) return -1;
    return 0;
  },
  gates: [
    { id: "ema200", lbl: "فوق/تحت 200 في الأعلى", w: 2.5, kind: "ind", v: function (x, d) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.E200 === null) return 0;
        return ((hi.px > hi.E200) === (d > 0)) ? 1 : -1; } },
    { id: "adxAll", lbl: "اتجاهٌ قائم في الأعلى", w: 2.0, kind: "ind", v: function (x) {
        var hi = x.all[x.tfs[2]]; if (!hi || hi.ADX === null) return 0;
        return hi.ADX >= 22 ? 1 : hi.ADX < 16 ? -1 : 0; } },
    { id: "stAll", lbl: "سوبرترند متوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var ok = 0, n = 0;
        x.tfs.forEach(function (tf) {
          var a = x.all[tf]; if (!a || !a.STdir) return;
          n++; if (a.STdir === d) ok++;
        });
        return n === 0 ? 0 : ok === n ? 1 : ok < n / 2 ? -1 : 0; } },
    { id: "momo", lbl: "الزخم يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.a; if (a.HIST === null) return 0;
        return ((a.HIST > 0) === (d > 0)) ? 1 : -1; } }
  ] },

/* ===================== عائلة المشتقّات والتموضع ===================== */

{ id: "fundingExtreme", lbl: "تطرّف التمويل", fam: "deriv", hz: ["scalp", "daily"],
  desc: "تمويلٌ موجبٌ متطرّف يعني ازدحام الشراء بالرافعة — وقودُ تصفيةٍ لا دليلَ قوّة. إشارةٌ عكسية.",
  side: function (x) {
    var d = x.ext.derivs; if (!d || !Number.isFinite(d.fundingZ)) return 0;
    if (d.fundingZ > 1.6) return -1;
    if (d.fundingZ < -1.6) return 1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق التطرّف", w: 2.5, kind: "ind", v: function (x) {
        var z = Math.abs(x.ext.derivs.fundingZ);
        return z > 2.2 ? 1 : z < 1.8 ? -1 : 0; } },
    { id: "oiHigh", lbl: "عقودٌ مفتوحة مرتفعة", w: 2.0, kind: "ind", v: function (x) {
        var d = x.ext.derivs;
        return Number.isFinite(d.oiRank) ? (d.oiRank > 70 ? 1 : d.oiRank < 40 ? -1 : 0) : 0; } },
    { id: "rsiAgree", lbl: "RSI في الجهة", w: 1.5, kind: "ind", v: function (x, d) {
        var r = x.a.RSI; if (r === null) return 0;
        return (d > 0 ? r < 40 : r > 60) ? 1 : -1; } },
    { id: "notTrending", lbl: "ليس اتجاهاً ساحقاً", w: 1.5, kind: "ind", v: function (x) {
        var v = x.all["1d"] ? x.all["1d"].ADX : null;
        return v === null ? 0 : (v < 32 ? 1 : -1); } }
  ] },

{ id: "oiPrice", lbl: "العقود المفتوحة والسعر", fam: "deriv", hz: ["scalp", "daily"],
  desc: "أربعُ حالات: صعودٌ بعقودٍ متزايدة صعودٌ حقيقي، وهبوطٌ بعقودٍ متزايدة بيعٌ جديد.",
  side: function (x) {
    var d = x.ext.derivs; if (!d || !Number.isFinite(d.oiChg)) return 0;
    var pc = x.ext.priceChg24; if (!Number.isFinite(pc)) return 0;
    if (Math.abs(d.oiChg) < 1.5) return 0;
    if (pc > 0.5 && d.oiChg > 0) return 1;      // شراءٌ جديد
    if (pc < -0.5 && d.oiChg > 0) return -1;    // بيعٌ جديد
    if (pc > 0.5 && d.oiChg < 0) return -1;     // تغطيةُ بيعٍ — صعودٌ فارغ
    if (pc < -0.5 && d.oiChg < 0) return 1;     // تصفيةُ شراء — هبوطٌ فارغ
    return 0;
  },
  gates: [
    { id: "oiSize", lbl: "تغيّرٌ معتبر", w: 2.5, kind: "ind", v: function (x) {
        var c = Math.abs(x.ext.derivs.oiChg);
        return c > 4 ? 1 : c < 2 ? -1 : 0; } },
    { id: "pxSize", lbl: "حركةُ سعرٍ معتبرة", w: 2.0, kind: "price", v: function (x) {
        var c = Math.abs(x.ext.priceChg24);
        return c > 2 ? 1 : c < 0.8 ? -1 : 0; } },
    { id: "cvdAgree", lbl: "الدلتا توافق", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.all["1h"]; if (!a || a.CVD === null || a.CVDp === null) return 0;
        return ((a.CVD - a.CVDp) > 0) === (d > 0) ? 1 : -1; } },
    { id: "fundAgree", lbl: "التمويل لا يعارض", w: 1.5, kind: "ind", v: function (x, d) {
        var z = x.ext.derivs.fundingZ; if (!Number.isFinite(z)) return 0;
        if (d > 0 && z > 2) return -1;
        if (d < 0 && z < -2) return -1;
        return 1; } }
  ] },

{ id: "longShort", lbl: "تموضع الحشد", fam: "deriv", hz: ["daily"],
  desc: "نسبة حسابات الشراء إلى البيع. تطرّفُها إشارةٌ عكسية — الحشدُ يخطئ عند الحوافّ.",
  side: function (x) {
    var d = x.ext.derivs; if (!d || !Number.isFinite(d.ls)) return 0;
    if (d.ls > 2.2) return -1;
    if (d.ls < 0.85) return 1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق التطرّف", w: 2.5, kind: "ind", v: function (x) {
        var r = x.ext.derivs.ls;
        return (r > 2.6 || r < 0.72) ? 1 : (r < 2.35 && r > 0.82) ? -1 : 0; } },
    { id: "fundAgree", lbl: "التمويل يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var z = x.ext.derivs.fundingZ; if (!Number.isFinite(z)) return 0;
        return ((z > 0) !== (d > 0)) ? 1 : -1; } },
    { id: "fngAgree", lbl: "المشاعر توافق", w: 1.5, kind: "ind", v: function (x, d) {
        var f = x.ext.fngVal; if (!Number.isFinite(f)) return 0;
        return (d > 0 ? f < 35 : f > 65) ? 1 : 0; } },
    { id: "notTrending", lbl: "ليس اتجاهاً ساحقاً", w: 1.5, kind: "ind", v: function (x) {
        var v = x.all["1d"] ? x.all["1d"].ADX : null;
        return v === null ? 0 : (v < 32 ? 1 : -1); } }
  ] },

{ id: "basis", lbl: "فارق العقود عن السبوت", fam: "deriv", hz: ["daily"],
  desc: "سعرُ العقد الدائم مقابل السبوت. فارقٌ موجبٌ كبير يعني حماسةً مرفوعة تسبق التصحيح.",
  side: function (x) {
    var d = x.ext.derivs; if (!d || !Number.isFinite(d.basisPct)) return 0;
    if (d.basisPct > 0.12) return -1;
    if (d.basisPct < -0.08) return 1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق الفارق", w: 2.5, kind: "ind", v: function (x) {
        var b = Math.abs(x.ext.derivs.basisPct);
        return b > 0.2 ? 1 : b < 0.14 ? -1 : 0; } },
    { id: "fundAgree", lbl: "التمويل يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var z = x.ext.derivs.fundingZ; if (!Number.isFinite(z)) return 0;
        return ((z > 0) !== (d > 0)) ? 1 : -1; } },
    { id: "rsiAgree", lbl: "RSI في الجهة", w: 1.5, kind: "ind", v: function (x, d) {
        var r = x.all["1d"] ? x.all["1d"].RSI : null; if (r === null) return 0;
        return (d > 0 ? r < 45 : r > 55) ? 1 : -1; } }
  ] },

{ id: "cbPremium", lbl: "بريميوم كوينبيز", fam: "deriv", hz: ["daily", "weekly"],
  desc: "سعرُ كوينبيز فوق بايننس يعني شراءً مؤسّسياً أمريكياً — وتحتَه بيعاً منه.",
  side: function (x) {
    var c = x.ext.cross; if (!c || !Number.isFinite(c.cbPrem)) return 0;
    if (c.cbPrem > 0.04) return 1;
    if (c.cbPrem < -0.04) return -1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق البريميوم", w: 2.5, kind: "ind", v: function (x) {
        var p = Math.abs(x.ext.cross.cbPrem);
        return p > 0.09 ? 1 : p < 0.05 ? -1 : 0; } },
    { id: "trendAgree", lbl: "الاتجاه اليومي يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.all["1d"]; if (!a || a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } },
    { id: "etfAgree", lbl: "تدفّقات الصناديق توافق", w: 2.0, kind: "ind", v: function (x, d) {
        var e = x.ext.macro && x.ext.macro.etf;
        if (!e || !Number.isFinite(e.flow5d)) return 0;
        return ((e.flow5d > 0) === (d > 0)) ? 1 : -1; } },
    { id: "cvdAgree", lbl: "الدلتا توافق", w: 1.0, kind: "ind", v: function (x, d) {
        var a = x.all["1d"]; if (!a || a.CVD === null || a.CVDp === null) return 0;
        return ((a.CVD - a.CVDp) > 0) === (d > 0) ? 1 : -1; } }
  ] },

{ id: "venueSpread", lbl: "فروقات المنصّات", fam: "deriv", hz: ["scalp"],
  desc: "تباعدُ الأسعار بين المنصّات يكشف ضغطاً حقيقياً في جهةٍ قبل أن يتساوى السوق.",
  side: function (x) {
    var c = x.ext.cross; if (!c || !Number.isFinite(c.spreadPct)) return 0;
    if (Math.abs(c.spreadPct) < 0.05) return 0;
    return c.spreadPct > 0 ? 1 : -1;
  },
  gates: [
    { id: "depth", lbl: "اتّساع الفارق", w: 2.5, kind: "ind", v: function (x) {
        var s = Math.abs(x.ext.cross.spreadPct);
        return s > 0.1 ? 1 : s < 0.06 ? -1 : 0; } },
    { id: "cbAgree", lbl: "كوينبيز يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var p = x.ext.cross.cbPrem; if (!Number.isFinite(p)) return 0;
        return ((p > 0) === (d > 0)) ? 1 : -1; } },
    { id: "cvdAgree", lbl: "الدلتا توافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.all["15m"]; if (!a || a.CVD === null || a.CVDp === null) return 0;
        return ((a.CVD - a.CVDp) > 0) === (d > 0) ? 1 : -1; } }
  ] },

/* ===================== عائلة المشاعر ===================== */

{ id: "fearGreed", lbl: "الخوف والطمع", fam: "senti", hz: ["daily", "weekly"],
  desc: "إشارةٌ عكسية عند الحوافّ وحدها: خوفٌ شديد فرصةٌ تاريخية، وطمعٌ شديد خطر.",
  side: function (x) {
    var f = x.ext.fngVal; if (!Number.isFinite(f)) return 0;
    if (f <= 25) return 1;
    if (f >= 75) return -1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق التطرّف", w: 2.5, kind: "ind", v: function (x) {
        var f = x.ext.fngVal;
        return (f <= 15 || f >= 85) ? 1 : (f > 30 && f < 70) ? -1 : 0; } },
    { id: "persist", lbl: "التطرّف مستمر", w: 2.0, kind: "ind", v: function (x, d) {
        var h = x.ext.fngHist; if (!h || h.length < 4) return 0;
        var recent = h.slice(0, 4);
        var ok = recent.filter(function (v) { return d > 0 ? v.v <= 32 : v.v >= 68; }).length;
        return ok >= 3 ? 1 : ok <= 1 ? -1 : 0; } },
    { id: "turning", lbl: "المشاعر تنعطف", w: 1.5, kind: "ind", v: function (x, d) {
        var h = x.ext.fngHist; if (!h || h.length < 2) return 0;
        return ((h[0].v - h[1].v) > 0) === (d > 0) ? 1 : 0; } },
    { id: "cycleAgree", lbl: "الدورة لا تعارض", w: 1.5, kind: "ind", v: function (x, d) {
        var o = x.ext.onchain; if (!o || !Number.isFinite(o.mayer)) return 0;
        if (d > 0) return o.mayer < 1.1 ? 1 : o.mayer > 1.6 ? -1 : 0;
        return o.mayer > 1.5 ? 1 : o.mayer < 1.0 ? -1 : 0; } }
  ] },

{ id: "newsTone", lbl: "نبرة الأخبار", fam: "senti", hz: ["scalp", "daily"],
  desc: "درجةٌ مرجّحة بحداثة العنوان. تُقرأ تأكيداً لا قيادةً — الخبر يتبع السعر غالباً.",
  side: function (x) {
    var s = x.ext.newsScore; if (!Number.isFinite(s)) return 0;
    if (s > 22) return 1;
    if (s < -22) return -1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "قوّة النبرة", w: 2.0, kind: "ind", v: function (x) {
        var s = Math.abs(x.ext.newsScore);
        return s > 40 ? 1 : s < 28 ? -1 : 0; } },
    { id: "count", lbl: "عددٌ كافٍ من العناوين", w: 1.5, kind: "ind", v: function (x) {
        var n = x.ext.newsCount || 0;
        return n >= 12 ? 1 : n < 6 ? -1 : 0; } },
    { id: "pxAgree", lbl: "السعر يوافق", w: 2.5, kind: "price", v: function (x, d) {
        var c = x.ext.priceChg24; if (!Number.isFinite(c)) return 0;
        return ((c > 0) === (d > 0)) ? 1 : -1; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.all["4h"]; if (!a || a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } }
  ] },

/* ===================== عائلة الدورة والأونتشين ===================== */

{ id: "mayer", lbl: "مضاعف ماير", fam: "cycle", hz: ["weekly"],
  desc: "السعر ÷ متوسّط ‎200‎ يوم. فوق ‎2.4‎ منطقةُ قممٍ تاريخية، وتحت ‎0.8‎ منطقةُ قيعان.",
  side: function (x) {
    var o = x.ext.onchain; if (!o || !Number.isFinite(o.mayer)) return 0;
    if (o.mayer < 0.85) return 1;
    if (o.mayer > 2.2) return -1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق التطرّف", w: 2.5, kind: "ind", v: function (x) {
        var m = x.ext.onchain.mayer;
        return (m < 0.75 || m > 2.4) ? 1 : (m > 0.95 && m < 2.0) ? -1 : 0; } },
    { id: "wTrend", lbl: "الاتجاه الأسبوعي", w: 2.0, kind: "ind", v: function (x, d) {
        var w = x.all["1w"]; if (!w || w.E50 === null) return 0;
        return ((w.px > w.E50) === (d > 0)) ? 1 : 0; } },
    { id: "puellAgree", lbl: "بويل يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var p = x.ext.onchain.puell; if (!Number.isFinite(p)) return 0;
        return (d > 0 ? p < 0.8 : p > 2.5) ? 1 : 0; } }
  ] },

{ id: "piCycle", lbl: "مؤشّر بي سايكل", fam: "cycle", hz: ["weekly"],
  desc: "تقاطع متوسّط ‎111‎ يوماً فوق ضعف متوسّط ‎350‎ — أصاب كل قمّةٍ كبرى في تاريخ البتكوين.",
  side: function (x) {
    var o = x.ext.onchain; if (!o || !Number.isFinite(o.piRatio)) return 0;
    if (o.piRatio > 0.95) return -1;
    if (o.piRatio < 0.55) return 1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "قربُ التقاطع", w: 3.0, kind: "ind", v: function (x) {
        var r = x.ext.onchain.piRatio;
        return (r > 0.99 || r < 0.45) ? 1 : (r < 0.9 && r > 0.6) ? -1 : 0; } },
    { id: "mayerAgree", lbl: "ماير يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var m = x.ext.onchain.mayer; if (!Number.isFinite(m)) return 0;
        return (d > 0 ? m < 1.0 : m > 1.8) ? 1 : -1; } },
    { id: "wTrend", lbl: "الاتجاه الأسبوعي", w: 1.5, kind: "ind", v: function (x, d) {
        var w = x.all["1w"]; if (!w || w.E50 === null) return 0;
        return ((w.px > w.E50) === (d > 0)) ? 1 : 0; } }
  ] },

{ id: "puell", lbl: "مضاعف بويل", fam: "cycle", hz: ["weekly"],
  desc: "إيراد المعدّنين ÷ متوسّطه السنوي. تحت ‎0.5‎ استسلامُ معدّنين — قيعانٌ تاريخية.",
  side: function (x) {
    var o = x.ext.onchain; if (!o || !Number.isFinite(o.puell)) return 0;
    if (o.puell < 0.6) return 1;
    if (o.puell > 3.0) return -1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق التطرّف", w: 2.5, kind: "ind", v: function (x) {
        var p = x.ext.onchain.puell;
        return (p < 0.45 || p > 3.8) ? 1 : (p > 0.75 && p < 2.5) ? -1 : 0; } },
    { id: "hashAgree", lbl: "شرائط الهاش توافق", w: 2.0, kind: "ind", v: function (x, d) {
        var h = x.ext.onchain.hashRibbon; if (!Number.isFinite(h)) return 0;
        return (d > 0 ? h > 0 : h < 0) ? 1 : 0; } },
    { id: "mayerAgree", lbl: "ماير يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var m = x.ext.onchain.mayer; if (!Number.isFinite(m)) return 0;
        return (d > 0 ? m < 1.0 : m > 1.8) ? 1 : -1; } }
  ] },

{ id: "hashRibbon", lbl: "شرائط الهاش", fam: "cycle", hz: ["weekly"],
  desc: "متوسّط الهاش ‎30‎ يوماً مقابل ‎60‎. تقاطعُه صعوداً بعد استسلامٍ من أدقّ إشارات القيعان.",
  side: function (x) {
    var o = x.ext.onchain; if (!o || !Number.isFinite(o.hashRibbon)) return 0;
    return o.hashRibbon > 0 ? 1 : -1;
  },
  gates: [
    { id: "fresh", lbl: "تقاطعٌ حديث", w: 2.5, kind: "ind", v: function (x) {
        var s = x.ext.onchain.hashCrossAge;
        return Number.isFinite(s) ? (s <= 14 ? 1 : s > 45 ? -1 : 0) : 0; } },
    { id: "hashGrow", lbl: "الهاش ينمو", w: 2.0, kind: "ind", v: function (x, d) {
        var g = x.ext.onchain.hashGrowth; if (!Number.isFinite(g)) return 0;
        return ((g > 0) === (d > 0)) ? 1 : -1; } },
    { id: "diffAgree", lbl: "الصعوبة توافق", w: 1.5, kind: "ind", v: function (x, d) {
        var e = x.ext.onchain.diffEst; if (!Number.isFinite(e)) return 0;
        return ((e > 0) === (d > 0)) ? 1 : 0; } }
  ] },

{ id: "twoYearMa", lbl: "متوسّط السنتين", fam: "cycle", hz: ["weekly"],
  desc: "تحت متوسّط السنتين منطقةُ تجميعٍ تاريخية، وفوق خمسة أضعافه منطقةُ توزيع.",
  side: function (x) {
    var o = x.ext.onchain; if (!o || !Number.isFinite(o.twoYr)) return 0;
    if (o.twoYr < 1.0) return 1;
    if (o.twoYr > 3.5) return -1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق الموقع", w: 2.5, kind: "ind", v: function (x) {
        var t = x.ext.onchain.twoYr;
        return (t < 0.85 || t > 4.2) ? 1 : (t > 1.2 && t < 3.0) ? -1 : 0; } },
    { id: "mayerAgree", lbl: "ماير يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var m = x.ext.onchain.mayer; if (!Number.isFinite(m)) return 0;
        return (d > 0 ? m < 1.0 : m > 1.8) ? 1 : -1; } },
    { id: "wTrend", lbl: "الاتجاه الأسبوعي", w: 1.5, kind: "ind", v: function (x, d) {
        var w = x.all["1w"]; if (!w || w.E50 === null) return 0;
        return ((w.px > w.E50) === (d > 0)) ? 1 : 0; } }
  ] },

{ id: "halving", lbl: "دورة التنصيف", fam: "cycle", hz: ["weekly"],
  desc: "تاريخياً: الأشهر ‎6–18‎ بعد التنصيف صاعدة، والأشهر ‎24–36‎ توزيعٌ ثم هبوط.",
  side: function (x) {
    var o = x.ext.onchain; if (!o || !Number.isFinite(o.monthsSinceHalving)) return 0;
    var m = o.monthsSinceHalving;
    if (m >= 5 && m <= 18) return 1;
    if (m >= 24 && m <= 38) return -1;
    return 0;
  },
  gates: [
    { id: "sweet", lbl: "في قلب المرحلة", w: 2.5, kind: "ind", v: function (x, d) {
        var m = x.ext.onchain.monthsSinceHalving;
        if (d > 0) return (m >= 8 && m <= 15) ? 1 : 0;
        return (m >= 27 && m <= 34) ? 1 : 0; } },
    { id: "wTrend", lbl: "الاتجاه الأسبوعي يوافق", w: 2.5, kind: "ind", v: function (x, d) {
        var w = x.all["1w"]; if (!w || w.E50 === null) return 0;
        return ((w.px > w.E50) === (d > 0)) ? 1 : -1; } },
    { id: "mayerAgree", lbl: "ماير لا يعارض", w: 1.5, kind: "ind", v: function (x, d) {
        var m = x.ext.onchain.mayer; if (!Number.isFinite(m)) return 0;
        if (d > 0) return m < 2.2 ? 1 : -1;
        return m > 0.9 ? 1 : -1; } }
  ] },

{ id: "nvt", lbl: "نسبة NVT", fam: "cycle", hz: ["weekly"],
  desc: "القيمة السوقية ÷ حجم التحويلات. مرتفعةٌ تعني سعراً يسبق الاستعمال الفعلي للشبكة.",
  side: function (x) {
    var o = x.ext.onchain; if (!o || !Number.isFinite(o.nvtRank)) return 0;
    if (o.nvtRank > 85) return -1;
    if (o.nvtRank < 15) return 1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق التطرّف", w: 2.5, kind: "ind", v: function (x) {
        var r = x.ext.onchain.nvtRank;
        return (r > 93 || r < 8) ? 1 : (r < 80 && r > 20) ? -1 : 0; } },
    { id: "mayerAgree", lbl: "ماير يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var m = x.ext.onchain.mayer; if (!Number.isFinite(m)) return 0;
        return (d > 0 ? m < 1.1 : m > 1.7) ? 1 : -1; } }
  ] },

{ id: "mempool", lbl: "ازدحام الشبكة", fam: "cycle", hz: ["daily", "weekly"],
  desc: "الطلبُ على مساحة الكتل. ازدحامٌ مرتفع يعني نشاطاً حقيقياً يسبق الحركة غالباً.",
  side: function (x) {
    var o = x.ext.onchain; if (!o || !Number.isFinite(o.feeRank)) return 0;
    if (o.feeRank > 80) return 1;
    if (o.feeRank < 12) return -1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "عمق الازدحام", w: 2.0, kind: "ind", v: function (x) {
        var r = x.ext.onchain.feeRank;
        return (r > 90 || r < 6) ? 1 : 0; } },
    { id: "trendAgree", lbl: "الاتجاه اليومي يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.all["1d"]; if (!a || a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } },
    { id: "hashAgree", lbl: "الهاش يوافق", w: 1.0, kind: "ind", v: function (x, d) {
        var g = x.ext.onchain.hashGrowth; if (!Number.isFinite(g)) return 0;
        return ((g > 0) === (d > 0)) ? 1 : 0; } }
  ] },

{ id: "stableLiq", lbl: "سيولة العملات المستقرة", fam: "macro", hz: ["weekly"],
  desc: "نموُّ معروض ‎USDT+USDC‎ هو البارود الجاهز للشراء. انكماشُه سحبُ سيولةٍ من السوق.",
  side: function (x) {
    var g = x.ext.global; if (!g || !Number.isFinite(g.stableChg30)) return 0;
    if (g.stableChg30 > 1.5) return 1;
    if (g.stableChg30 < -1.0) return -1;
    return 0;
  },
  gates: [
    { id: "depth", lbl: "قوّة التغيّر", w: 2.5, kind: "ind", v: function (x) {
        var c = Math.abs(x.ext.global.stableChg30);
        return c > 3 ? 1 : c < 2 ? -1 : 0; } },
    { id: "domAgree", lbl: "الهيمنة توافق", w: 1.5, kind: "ind", v: function (x, d) {
        var g = x.ext.global; if (!Number.isFinite(g.domChg)) return 0;
        return ((g.domChg > 0) === (d > 0)) ? 1 : 0; } },
    { id: "wTrend", lbl: "الاتجاه الأسبوعي", w: 1.5, kind: "ind", v: function (x, d) {
        var w = x.all["1w"]; if (!w || w.E50 === null) return 0;
        return ((w.px > w.E50) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "dominance", lbl: "هيمنة البتكوين", fam: "macro", hz: ["daily", "weekly"],
  desc: "حصّةُ البتكوين من السوق. ارتفاعُها مع صعود السعر يعني تدفّقاً إليه لا دوراناً.",
  side: function (x) {
    var g = x.ext.global; if (!g || !Number.isFinite(g.domChg)) return 0;
    if (Math.abs(g.domChg) < 0.3) return 0;
    return g.domChg > 0 ? 1 : -1;
  },
  gates: [
    { id: "pxAgree", lbl: "السعر يوافق", w: 2.5, kind: "price", v: function (x, d) {
        var c = x.ext.priceChg24; if (!Number.isFinite(c)) return 0;
        return ((c > 0) === (d > 0)) ? 1 : -1; } },
    { id: "depth", lbl: "تغيّرٌ معتبر", w: 2.0, kind: "ind", v: function (x) {
        var c = Math.abs(x.ext.global.domChg);
        return c > 0.8 ? 1 : c < 0.4 ? -1 : 0; } },
    { id: "trendAgree", lbl: "الاتجاه يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.all["1d"]; if (!a || a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "macroCorr", lbl: "ارتباط الماكرو", fam: "macro", hz: ["daily", "weekly"],
  desc: "الدولار يعاكس البتكوين تاريخياً، والأسهم تقوده. الإشارة من اتجاه المؤشّرين معاً.",
  side: function (x) {
    var m = x.ext.macro; if (!m || !m.series) return 0;
    var sig = 0;
    if (Number.isFinite(m.dxyChg5)) sig += m.dxyChg5 < -0.5 ? 1 : m.dxyChg5 > 0.5 ? -1 : 0;
    if (Number.isFinite(m.spxChg5)) sig += m.spxChg5 > 1 ? 1 : m.spxChg5 < -1 ? -1 : 0;
    if (sig >= 2) return 1;
    if (sig <= -2) return -1;
    return 0;
  },
  gates: [
    { id: "corrReal", lbl: "الارتباط قائم فعلاً", w: 2.5, kind: "ind", v: function (x, d) {
        var m = x.ext.macro;
        var c = Number.isFinite(m.corrDxy30) ? Math.abs(m.corrDxy30) : 0;
        return c > 0.4 ? 1 : c < 0.2 ? -1 : 0; } },
    { id: "spxAgree", lbl: "الأسهم توافق", w: 2.0, kind: "ind", v: function (x, d) {
        var m = x.ext.macro; if (!Number.isFinite(m.spxChg5)) return 0;
        return ((m.spxChg5 > 0) === (d > 0)) ? 1 : -1; } },
    { id: "dxyAgree", lbl: "الدولار يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var m = x.ext.macro; if (!Number.isFinite(m.dxyChg5)) return 0;
        return ((m.dxyChg5 < 0) === (d > 0)) ? 1 : -1; } },
    { id: "fresh", lbl: "البيانات طازجة", w: 1.0, kind: "ind", v: function (x) {
        var m = x.ext.macro; if (!m.updated) return -1;
        var h = (Date.now() - m.updated) / 36e5;
        return h < 6 ? 1 : h > 36 ? -1 : 0; } }
  ] },

{ id: "etfFlow", lbl: "تدفّقات صناديق البتكوين", fam: "macro", hz: ["daily", "weekly"],
  desc: "صافي التدفّق إلى الصناديق الفورية — أوضحُ مقياسٍ للطلب المؤسّسي الأمريكي.",
  side: function (x) {
    var e = x.ext.macro && x.ext.macro.etf;
    if (!e || !Number.isFinite(e.flow5d)) return 0;
    if (e.flow5d > 150) return 1;
    if (e.flow5d < -150) return -1;
    return 0;
  },
  gates: [
    { id: "size", lbl: "حجمُ التدفّق", w: 2.5, kind: "ind", v: function (x) {
        var f = Math.abs(x.ext.macro.etf.flow5d);
        return f > 600 ? 1 : f < 250 ? -1 : 0; } },
    { id: "streak", lbl: "تدفّقٌ متّصل", w: 2.0, kind: "ind", v: function (x, d) {
        var s = x.ext.macro.etf.streak; if (!Number.isFinite(s)) return 0;
        return (Math.abs(s) >= 3 && (s > 0) === (d > 0)) ? 1 : 0; } },
    { id: "cbAgree", lbl: "بريميوم كوينبيز يوافق", w: 2.0, kind: "ind", v: function (x, d) {
        var c = x.ext.cross; if (!c || !Number.isFinite(c.cbPrem)) return 0;
        return ((c.cbPrem > 0) === (d > 0)) ? 1 : -1; } },
    { id: "trendAgree", lbl: "الاتجاه اليومي يوافق", w: 1.5, kind: "ind", v: function (x, d) {
        var a = x.all["1d"]; if (!a || a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } }
  ] },

{ id: "seasonality", lbl: "الموسمية", fam: "macro", hz: ["daily", "weekly"],
  desc: "حافّةٌ إحصائية لشهر السنة ويوم الأسبوع، محسوبةً من تاريخ البتكوين نفسه لا من مأثور.",
  side: function (x) {
    var s = x.ext.season; if (!s || !Number.isFinite(s.edge)) return 0;
    if (s.n < 20) return 0;
    if (s.edge > 0.35) return 1;
    if (s.edge < -0.35) return -1;
    return 0;
  },
  gates: [
    { id: "sample", lbl: "عيّنةٌ كافية", w: 2.5, kind: "ind", v: function (x) {
        var n = x.ext.season.n;
        return n >= 40 ? 1 : n < 25 ? -1 : 0; } },
    { id: "depth", lbl: "قوّة الحافّة", w: 2.0, kind: "ind", v: function (x) {
        var e = Math.abs(x.ext.season.edge);
        return e > 0.7 ? 1 : e < 0.45 ? -1 : 0; } },
    { id: "trendAgree", lbl: "الاتجاه لا يعارض", w: 2.0, kind: "ind", v: function (x, d) {
        var a = x.all["1d"]; if (!a || a.E50 === null) return 0;
        return ((a.px > a.E50) === (d > 0)) ? 1 : -1; } }
  ] }

];

/* =====================================================================
   تقييمُ البوّابات — الدالّة الوحيدة التي تحوّل استراتيجيةً إلى رقم.

   `only` يقصر الحساب على نوعٍ من البوّابات (`price` وحدها في دورة
   الأسعار السريعة)، ويأخذ تصويت البقية من الدورة السابقة كما هو.
   والدالّة **واحدة** في الحالتين فلا يوجد مسارٌ سريع يتباعد عن المسار
   الكامل — وهو أشهرُ مصدرٍ لاختلاف الرقم المعروض عن الرقم المحفوظ.
   ===================================================================== */
function evalGates(st, x, dir, prevVotes, only) {
  var num = 0, den = 0, votes = {}, pros = [], cons = [];
  for (var i = 0; i < st.gates.length; i++) {
    var g = st.gates[i], val;
    if (only && g.kind !== only && prevVotes && prevVotes[g.id] !== undefined) {
      val = prevVotes[g.id];
    } else {
      try { val = g.v(x, dir); } catch (e) { val = 0; }
      if (val !== 1 && val !== -1 && val !== 0) val = 0;
    }
    votes[g.id] = val;
    num += val * g.w; den += g.w;
    if (val > 0) pros.push(g.lbl);
    else if (val < 0) cons.push(g.lbl);
  }
  var norm = den > 0 ? num / den : 0;             // −1..+1
  return { sc: Math.round((norm + 1) / 2 * 100),  // 0..100
           votes: votes, pros: pros, cons: cons };
}

/* تشغيلُ الطاقم كلّه على أفقٍ واحد. المخرَج صفٌّ لكل استراتيجية:
   مفعَّلةٌ بجهةٍ ونتيجة، أو هادئة، أو متعذّرة لغياب بياناتها. */
function runStrategies(x, hzId) {
  var out = [];
  for (var i = 0; i < STRATEGIES.length; i++) {
    var st = STRATEGIES[i];
    if (st.hz.indexOf(hzId) < 0) continue;
    var row = { id: st.id, lbl: st.lbl, fam: st.fam, desc: st.desc,
                dir: 0, sc: null, active: false, off: false, pros: [], cons: [] };
    var d;
    try { d = st.side(x); } catch (e) { d = null; }
    if (d === null || d === undefined) { row.off = true; out.push(row); continue; }
    if (d !== 1 && d !== -1) { out.push(row); continue; }
    var g = evalGates(st, x, d);
    row.dir = d; row.sc = g.sc; row.active = true;
    row.pros = g.pros; row.cons = g.cons; row.votes = g.votes;
    out.push(row);
  }
  return out;
}

var FAM_LABEL = { trend: "اتجاه", momo: "زخم", revert: "ارتداد", vol: "تذبذب",
                  flow: "تدفّق", struct: "هيكل", level: "مستويات",
                  deriv: "مشتقّات", senti: "مشاعر", cycle: "دورة", macro: "ماكرو" };

if (typeof module !== "undefined" && module.exports) {
  module.exports = { STRATEGIES, evalGates, runStrategies, FAM_LABEL };
}
