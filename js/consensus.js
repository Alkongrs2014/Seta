/* =====================================================================
   الإجماع — من أصوات الاستراتيجيات إلى اتجاهٍ واحد لكل أفق.

   القاعدة الحاكمة: **الكتلة لا العدد**. استراتيجيةٌ نتيجتها ‎95‎ تزن
   أكثر من أخرى نتيجتها ‎57‎ وإن تساوى وزناهما، والعدُّ المجرَّد
   («‎7 من 9‎») يسوّي بينهما. ويُعرض العدُّ كذلك لأنه يُفهم فوراً، لكنه
   لا يقرّر.

   الكتلة = الوزن المقيس × القناعة.
   والوزن المقيس يأتي من `backtest.js` — حافّةُ الاستراتيجية التاريخية
   على البتكوين نفسه في هذا الأفق بالذات. وبلا معايرةٍ يكون الوزن ‎1‎
   للجميع، وتُخفَّض الثقة صراحةً لأن إجماع اثنتي عشرة استراتيجيةً لم
   تُقَس واحدةٌ منها ليس دليلاً قوياً — بل اثنتا عشرة رأياً.
   ===================================================================== */

var W_MIN = 0.4, W_MAX = 1.8;
function clampW(x) { return Math.max(W_MIN, Math.min(W_MAX, x)); }

/* الحافّة وزناً. `0` حافّةً ⇒ `1.0` وزناً — فالمحايد هو الحياد بالضبط
   لا تفضيلٌ خفيّ. */
function edgeWeight(e) {
  return Number.isFinite(e) ? clampW(1 + e / 2) : 1;
}

function weightFor(id, hzId, edge) {
  var row = edge && edge[hzId] && edge[hzId][id];
  if (!row || !Number.isFinite(row.edge)) {
    return { w: 1, measured: false, n: 0, note: "لم تُقَس بعد" };
  }
  return { w: edgeWeight(row.edge), measured: true, n: row.n || 0,
           hit: row.hit, avg: row.avg,
           note: "حافّة مقيسة " + (row.edge > 0 ? "+" : "") + row.edge.toFixed(2) +
                 " على " + (row.n || 0) + " إشارة · نسبة الإصابة " +
                 Math.round((row.hit || 0) * 100) + "%" };
}

/* =====================================================================
   حدودُ القرار.

   `MIX_SHARE` كتلةُ الأقلّية التي فوقها لا تُعطى جهة. و«‎4‎ صعود و‎3‎
   هبوط» ليست صعوداً ضعيفاً: هي حالةٌ **يعرف فيها النظام أنه لا يعرف**،
   وإعلانُ ذلك أصدقُ من رقمٍ متوسّطٍ يوهم بالحسم.

   `CONF_HI` و`CONF_MD` حدود الثقة، ومعها شرطان لا يُستغنى عنهما:
   عددٌ كافٍ، و**عائلتان متمايزتان**. فثلاثُ نكهاتٍ من فكرةٍ واحدة
   تتّفق دائماً، واتّفاقُها تكرارٌ لا تأكيد.
   ===================================================================== */
var MIX_SHARE = 0.35;
var CONF_HI = 0.78, CONF_MD = 0.62;

/* حدود التسمية — ونفسها تُستعمل في كل مكان فلا يختلف اللفظ عن الرقم. */
var BANDS = [-45, -15, 15, 45];
function bandOf(sc) {
  for (var i = 0; i < BANDS.length; i++) if (sc < BANDS[i]) return i;
  return BANDS.length;
}
var BAND_LABEL = [
  { t: "هبوط قوي", c: "var(--dn)", arrow: "▼▼" },
  { t: "ميل هابط", c: "var(--dn)", arrow: "▼" },
  { t: "عرضي — غير محسوم", c: "var(--neu)", arrow: "◆" },
  { t: "ميل صاعد", c: "var(--up)", arrow: "▲" },
  { t: "صعود قوي", c: "var(--up)", arrow: "▲▲" }
];

/* =====================================================================
   الهيستريسس — لماذا النطاق لا يتغيّر بنقطةٍ واحدة.

   رقمٌ يستقرّ على الحدّ (‎−15.2‎ ثم ‎−14.8‎ ثم ‎−15.1‎) يقلب البطاقة من
   «هابط» إلى «عرضي» إلى «هابط» كل ثلاثين ثانية — وهو أسوأُ سلوكٍ
   يمكن أن تُظهره أداةُ قرار: يُفقد الثقة بلا أن يضيف معلومة.

   فالنطاق لا يتغيّر إلا بتجاوز حدّه بـ‎3‎ نقاط. والثمن تأخّرُ نقطتين
   في التصنيف، والمقابل ثباتٌ يُقرأ.
   ===================================================================== */
var BAND_MARGIN = 3;
function bandStable(sc, prevBand) {
  var b = bandOf(sc);
  if (!Number.isFinite(prevBand) || prevBand === null) return b;
  if (b === prevBand) return b;
  if (b > prevBand) {
    var lo = BANDS[prevBand];
    return (Number.isFinite(lo) && sc < lo + BAND_MARGIN) ? prevBand : b;
  }
  var hi = BANDS[b];
  return (Number.isFinite(hi) && sc > hi - BAND_MARGIN) ? prevBand : b;
}

/* =====================================================================
   الإجماع لأفقٍ واحد.
   ===================================================================== */
function consensusOf(res, o) {
  o = o || {};
  var hzId = o.hz, edge = o.edge;
  var act = (res || []).filter(function (r) { return r.dir && r.active && Number.isFinite(r.sc); });
  var off = (res || []).filter(function (r) { return r.off; });
  var base = {
    hz: hzId, dir: 0, k: "none", t: "لا إشارة", score: 0,
    up: 0, dn: 0, n: 0, nUp: 0, nDn: 0,
    nQuiet: (res || []).length - act.length - off.length, nOff: off.length,
    items: [], fams: [], conf: null, measured: 0, agree: 0, band: 2
  };
  if (!act.length) return base;

  var up = 0, dn = 0, items = [], measured = 0;
  for (var i = 0; i < act.length; i++) {
    var r = act[i], w = weightFor(r.id, hzId, edge);
    /* القناعة تُنقل من ‎0..100‎ إلى ‎0..1‎ حول ‎50‎: استراتيجيةٌ نتيجتها
       ‎52‎ مفعَّلةٌ بالكاد، فكتلتُها يجب أن تقارب الصفر لا نصف الوزن. */
    var conv = Math.max(0, (r.sc - 50) / 50);
    var mass = w.w * conv;
    if (r.dir > 0) up += mass; else dn += mass;
    if (w.measured) measured++;
    items.push({ id: r.id, lbl: r.lbl, fam: r.fam, desc: r.desc, dir: r.dir,
                 sc: r.sc, w: w.w, mass: mass, measured: w.measured,
                 n: w.n, hit: w.hit, note: w.note, pros: r.pros, cons: r.cons });
  }
  items.sort(function (a, b) { return b.mass - a.mass; });

  var total = up + dn;
  var nUp = act.filter(function (r) { return r.dir > 0; }).length;
  var nDn = act.length - nUp;
  var maj = up >= dn ? 1 : -1;
  var majM = Math.max(up, dn), minM = Math.min(up, dn);
  var agree = total > 0 ? majM / total : 0;
  var fams = [];
  items.forEach(function (x) { if (x.dir === maj && fams.indexOf(x.fam) < 0) fams.push(x.fam); });

  /* النتيجة ‎−100..+100‎: صافي الكتلة منسوباً إلى مجموعها. فالرقم يصف
     **ميلَ السوق** لا حجم الأدلّة — والحجم يُقرأ من `n` و`agree`. */
  var score = total > 0 ? Math.round((up - dn) / total * 100) : 0;

  var out = Object.assign({}, base, {
    up: up, dn: dn, n: act.length, nUp: nUp, nDn: nDn, items: items,
    fams: fams, agree: agree, measured: measured, mass: majM, score: score
  });

  /* التعارض قبل الاتجاه — ولا خطة معه. */
  if (total > 0 && minM / total > MIX_SHARE) {
    return Object.assign(out, {
      dir: 0, k: "mixed", band: 2, t: "متعارض — لا اتجاه واضح",
      why: "كتلةُ الجهة المخالفة " + Math.round(minM / total * 100) +
           "% من الإجماع، وفوق " + Math.round(MIX_SHARE * 100) + "% لا تُعطى جهة"
    });
  }

  var solo = act.length === 1;
  var conf = (agree >= CONF_HI && fams.length >= 2 && act.length >= 3) ? "high"
           : ((agree >= CONF_MD && act.length >= 2) ? "med" : "low");
  if (measured === 0 && conf === "high") conf = "med";

  var band = bandStable(score, o.prevBand);

  return Object.assign(out, {
    dir: maj, k: solo ? "solo" : (maj > 0 ? "up" : "dn"), solo: solo, band: band,
    t: BAND_LABEL[band].t,
    conf: conf,
    confT: conf === "high" ? "عالية" : conf === "med" ? "متوسطة" : "منخفضة",
    why: nUp + " صعود · " + nDn + " هبوط · " + out.nQuiet + " لم تتفعّل" +
         (out.nOff ? " · " + out.nOff + " متعذّرة" : "") +
         (solo ? " — استراتيجيةٌ واحدة لا إجماع" : "")
  });
}

/* =====================================================================
   المستويات — الإبطال والهدف.

   `invalidation` السعر الذي **ينقلب عنده السيناريو**، وهو أهمّ رقمٍ
   في البطاقة كلّها: اتجاهٌ بلا نقطةِ إبطالٍ رأيٌ لا قراءة. ويُبنى من
   بنية السوق أولاً (آخر قاعٍ/قمّة محورية) لأنها ما يراقبه السوق فعلاً،
   ومن `ATR` احتياطاً حين يغيب الهيكل.

   والهدف نطاقٌ لا رقم: مضاعفاتُ `ATR` تصف المدى المعقول للأفق، وعرضُ
   رقمٍ واحد بفاصلةٍ عشرية يوهم بدقّةٍ لا يملكها أحد.
   ===================================================================== */
function levelsOf(cons, a, hz) {
  if (!a || !a.ATR || !cons.dir) return null;
  var px = a.px, atrV = a.ATR, d = cons.dir;
  var inv = null, invSrc = "";

  if (a.ms && d > 0 && Number.isFinite(a.ms.lastLow) && a.ms.lastLow < px) {
    inv = a.ms.lastLow; invSrc = "آخر قاعٍ محوري";
  } else if (a.ms && d < 0 && Number.isFinite(a.ms.lastHigh) && a.ms.lastHigh > px) {
    inv = a.ms.lastHigh; invSrc = "آخر قمّةٍ محورية";
  }
  /* الهيكل يُقبل فقط إن كان على بُعدٍ معقول **بمقياس الأفق**.

     والحدُّ يختلف بالأفق لا برقمٍ واحد: مضاربُ الساعات لا يحتمل وقفاً
     على بُعد ثلاثة أضعاف التذبذب لهدفٍ على بُعد ضعفٍ واحد — تلك صفقةٌ
     عائدُها أقلُّ من مخاطرتها بحكم البناء. أمّا صاحبُ الأفق الأسبوعي
     فوقفٌ بعيد عنده طبيعيّ لأن هدفه أبعد.

     وحين يتجاوز الهيكلُ الحدَّ يُستبدل بوقفٍ من التذبذب، ويُعلَن
     مصدرُه صراحةً في البطاقة فلا يظنّه القارئ مستوىً بنيوياً. */
  var invCap  = hz.id === "scalp" ? 2 : hz.id === "daily" ? 3.2 : 4.5;
  var invFall = hz.id === "scalp" ? 1.2 : hz.id === "daily" ? 1.8 : 2.5;
  if (inv === null || Math.abs(px - inv) > atrV * invCap) {
    inv = d > 0 ? px - atrV * invFall : px + atrV * invFall;
    invSrc = fmt(invFall, 1) + " ضعف التذبذب";
  }

  var mult = hz.id === "scalp" ? [1.5, 2.8] : hz.id === "daily" ? [2.5, 5] : [4, 8];
  var atrT1 = d > 0 ? px + atrV * mult[0] : px - atrV * mult[0];
  var atrT2 = d > 0 ? px + atrV * mult[1] : px - atrV * mult[1];

  /* الهدف: الهيكل مصدرٌ أول — أقرب مستوى معاكسٍ فعلي من بنية السوق أو
     نمط M/W مؤكَّد أو ملفّ الحجم — لا مضاعفات ATR على حركة الشمعة
     الحالية. وATR يبقى بديلاً فقط حين يغيب الهيكل أو يكون بعيداً جداً،
     بنفس منطق بديل الإبطال أعلاه. */
  var cands = [];
  if (a.ms) {
    var opp = d > 0 ? a.ms.lastHigh : a.ms.lastLow;
    if (Number.isFinite(opp) && (d > 0 ? opp > px : opp < px))
      cands.push({ v: opp, src: d > 0 ? "آخر قمّةٍ محورية" : "آخر قاعٍ محوري" });
  }
  if (a.pat2 && a.pat2.confirmed && a.pat2.dir === d && Number.isFinite(a.pat2.targetProjection)) {
    var tp = a.pat2.targetProjection;
    if (d > 0 ? tp > px : tp < px)
      cands.push({ v: tp, src: "إسقاط نمط " + a.pat2.pattern });
  }
  if (a.vp) {
    [a.vp.vah, a.vp.val, a.vp.poc].forEach(function (v) {
      if (Number.isFinite(v) && (d > 0 ? v > px : v < px))
        cands.push({ v: v, src: "ملفّ الحجم" });
    });
  }
  var capDist = atrV * mult[1] * 1.5;
  cands = cands.filter(function (x) {
    var dist = Math.abs(x.v - px);
    return dist <= capDist && dist > atrV * 0.3;
  }).sort(function (x, y) { return Math.abs(x.v - px) - Math.abs(y.v - px); });

  var t1 = cands.length ? cands[0].v : atrT1;
  var t1Src = cands.length ? cands[0].src : fmt(mult[0], 1) + " ضعف التذبذب";
  var far = cands.filter(function (x) { return Math.abs(x.v - px) > Math.abs(t1 - px) * 1.05; })[0];
  var t2 = far ? far.v : atrT2;
  var t2Src = far ? far.src : fmt(mult[1], 1) + " ضعف التذبذب";

  /* تحذيرٌ مبكر: السعر قريبٌ من الإبطال وآخر شمعةٍ مغلقة تُظهر نمطاً
     معاكساً أو سيولةً ضعيفة — إنذارٌ قبل وقوع الإبطال لا بعده. */
  var warn = null;
  if (Math.abs(px - inv) <= atrV * 0.3) {
    if (a.pattern && a.pattern.dir === -d) {
      warn = "السعر يقترب من مستوى الإبطال وظهرت شمعة " + a.pattern.name +
             " قرب المستوى — احتمال الإبطال يرتفع.";
    } else if (a.weakVol) {
      warn = "السعر يقترب من مستوى الإبطال والشمعة الأخيرة ضعيفة السيولة — قراءةٌ أقل موثوقية.";
    }
  }

  var risk = Math.abs(px - inv);
  return { inv: inv, invSrc: invSrc, t1: t1, t1Src: t1Src, t2: t2, t2Src: t2Src,
           invPct: risk / px * 100, warn: warn,
           rr: risk > 0 ? Math.abs(t1 - px) / risk : null };
}

/* =====================================================================
   التعارض بين الآفاق — يُعلَن ولا يُخفى.

   أفقٌ لحظيٌّ صاعد تحت أفقٍ أسبوعيٍّ هابط ليس تناقضاً في النظام: هو
   وصفٌ صحيح لارتدادٍ داخل هبوط. والخطأ أن يُعرض الصاعد وحده فيظنّ
   القارئ أن السوق صاعد.
   ===================================================================== */
function horizonConflict(all) {
  var s = all.scalp, d = all.daily, w = all.weekly;
  var out = [];
  if (s && w && s.dir && w.dir && s.dir !== w.dir) {
    out.push({ level: "high", txt: "الأفق اللحظي " + (s.dir > 0 ? "صاعد" : "هابط") +
      " بينما الأسبوعي " + (w.dir > 0 ? "صاعد" : "هابط") +
      " — حركةٌ مضادّة للاتجاه الكبير، وهي أقصرُ عمراً وأعلى مخاطرة." });
  }
  if (d && w && d.dir && w.dir && d.dir !== w.dir) {
    out.push({ level: "med", txt: "الأفق اليومي يخالف الأسبوعي — غالباً تصحيحٌ داخل اتجاه." });
  }
  if (s && d && s.dir && d.dir && s.dir !== d.dir) {
    out.push({ level: "low", txt: "الأفق اللحظي يخالف اليومي — تذبذبٌ قصير داخل الاتجاه." });
  }
  return out;
}

/* حالةُ السوق — تُقرأ من الفريم اليومي وتوصف بكلمةٍ واحدة. تُستعمل في
   العرض وفي معايرة الأوزان لاحقاً. */
function regimeOf(a) {
  if (!a || a.ADX === null) return { id: "unknown", t: "غير محدّد" };
  var trend = a.ADX >= 25, volHi = a.atrPct !== null && a.atrPct > 3.2;
  if (trend && a.px > a.E50) return { id: volHi ? "bullVol" : "bull",
    t: volHi ? "صعودٌ متقلّب" : "اتجاهٌ صاعد" };
  if (trend && a.px < a.E50) return { id: volHi ? "bearVol" : "bear",
    t: volHi ? "هبوطٌ متقلّب" : "اتجاهٌ هابط" };
  return { id: volHi ? "chopVol" : "chop", t: volHi ? "تذبذبٌ عنيف" : "سوقٌ عرضي" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { consensusOf, weightFor, edgeWeight, levelsOf,
                     horizonConflict, regimeOf, bandOf, bandStable,
                     BAND_LABEL, BANDS, MIX_SHARE };
}
