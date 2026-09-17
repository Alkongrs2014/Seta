/* =====================================================================
   النواة — الإعدادات والحالة والجلب والتنسيق.

   لماذا ملفّ مستقلّ: كل وحدةٍ أخرى تحتاج `jget` و`fmt` و`state`. ولو
   عاشت في `app.js` لصار ترتيب وسوم `<script>` عقدةً: الوحدة التي
   تُحمَّل أولاً لا تجد ما تحتاجه. فالنواة أولاً، ثم البقية بأي ترتيب.

   والنطاق كلاسيكي مشترك (لا ES modules) لسببين: `file://` يمنع
   الوحدات فلا يعمل الموقع بنقرةٍ مزدوجة، و`sw.js` يصير مدخلاً واحداً
   لكل ملف. والثمن المعروف: تعارض الأسماء — فكل اسمٍ عامّ هنا مسبوق
   بدلالته ولا يُعاد استعماله في ملفٍ آخر.
   ===================================================================== */

/* ---------------------------------------------------------------------
   المصادر — قوائم بديلة لا مضيفاً واحداً.

   بايننس تُحجب جغرافياً في مناطق، و`data-api.binance.vision` مرآةٌ
   عامة لنفس البيانات بلا حساب. والترتيب مقصود: الأسرع أولاً، والمرآة
   آخراً لأنها أبطأ لكنها تعمل حين يُحجب الأصل.
   --------------------------------------------------------------------- */
var SPOT_HOSTS = ["https://api.binance.com", "https://data-api.binance.vision",
                  "https://api1.binance.com", "https://api2.binance.com"];
var FUT_HOSTS  = ["https://fapi.binance.com"];
var SYMBOL = "BTCUSDT";

/* الفريمات الستة. `5m` و`1w` إضافتان على النسخة السابقة: بلا الأول لا
   يوجد تحليلٌ لحظيّ حقيقي، وبلا الثاني لا يوجد أفقٌ أسبوعي — وكلاهما
   مطلوبٌ صراحةً. */
var TFS = ["5m", "15m", "1h", "4h", "1d", "1w"];
var TF_LABEL = { "5m": "5 دقائق", "15m": "15 دقيقة", "1h": "ساعة",
                 "4h": "4 ساعات", "1d": "يومي", "1w": "أسبوعي" };
var TF_MS = { "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5, "1w": 6048e5 };

/* =====================================================================
   الآفاق الثلاثة — وهي بنيةُ الموقع كلّها لا تصنيفاً تجميلياً.

   كل أفقٍ يقرأ فريماتٍ مختلفة ويقيس مدىً مختلفاً، فخلطُهم في رقمٍ
   واحد هو العلّة التي جعلت النسخة السابقة تعطي «اتجاهاً» واحداً لا
   يَصلُح لمضاربٍ ولا لمستثمر.

   `bars` = عدد الشموع الأمامية التي يقيس عليها الاختبارُ التاريخي
   نجاحَ الاستراتيجية — وهو تعريفُ «الأفق» عملياً: لحظيٌّ يُحكم عليه
   بعد ‎12‎ شمعة ‎15m‎ (ثلاث ساعات)، لا بعد أسبوع.
   ===================================================================== */
var HORIZONS = [
  { id: "scalp",  lbl: "لحظي",   icon: "⚡", tfs: ["5m", "15m", "1h"],
    lead: "15m", bars: 12, span: "الساعات القليلة القادمة" },
  { id: "daily",  lbl: "يومي",   icon: "📅", tfs: ["1h", "4h", "1d"],
    lead: "4h",  bars: 6,  span: "من يوم إلى خمسة أيام" },
  { id: "weekly", lbl: "أسبوعي", icon: "📆", tfs: ["4h", "1d", "1w"],
    lead: "1d",  bars: 10, span: "من أسبوعين إلى شهرين" }
];
var HZ = {}; HORIZONS.forEach(function (h) { HZ[h.id] = h; });

/* وزن الفريم داخل الأفق: الأبطأ أثقل. متوسّطٌ يومي يعاكس الاتجاه لا
   يُلغيه ارتدادُ خمس دقائق — وهي القاعدة التي يخرقها كل مؤشّرٍ يسوّي
   بين الفريمات. */
var TF_WEIGHT = { "5m": 0.6, "15m": 1, "1h": 1.4, "4h": 1.8, "1d": 2.2, "1w": 2.6 };

var $  = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

/* =====================================================================
   الحالة — كائنٌ واحد. و`src` سجلّ صحّة المصادر.

   لماذا سجلّ صحّة: الموقع يعمل ‎24/7‎ على بياناتِ عشرة مصادر مجانية،
   وتعطُّلُ أحدها أمرٌ يقع لا احتمالٌ نظري. والسلوك المطلوب ليس صفحةً
   فارغة بل **آخر قيمةٍ سليمة موسومةً بعمرها** — فيعرف القارئ أن رقم
   التمويل من ساعةٍ مضت بدل أن يظنّه الآن.
   ===================================================================== */
var state = {
  candles: {}, ticker: null, derivs: null, fng: null, news: null,
  onchain: null, macro: null, cross: null, global: null,
  edge: null, cons: {}, prevCons: null, activeTF: "1h", lastOk: 0,
  src: {}   // { key: {ok, t, err, label} }
};

function srcMark(key, label, ok, err) {
  var p = state.src[key] || {};
  state.src[key] = { label: label, ok: ok,
                     t: ok ? Date.now() : (p.t || 0),
                     err: ok ? null : (err ? String(err.message || err) : "تعذّر") };
}

/* عمر المصدر بالدقائق — `null` إن لم ينجح قطّ. */
function srcAge(key) {
  var s = state.src[key];
  return (s && s.t) ? (Date.now() - s.t) / 6e4 : null;
}

/* ---------------------------------------------------------------------
   التنسيق. `fmt` تُعيد «—» للقيم غير المنتهية بدل `NaN` أو `0`:
   الصفر رقمٌ له معنى، وغيابُ الرقم ليس صفراً.
   --------------------------------------------------------------------- */
function fmt(n, d) {
  d = d === undefined ? 2 : d;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function money(n, d) { return Number.isFinite(n) ? "$" + fmt(n, d === undefined ? 0 : d) : "—"; }
function pct(n, d) {
  if (!Number.isFinite(n)) return "—";
  return (n > 0 ? "+" : "") + fmt(n, d === undefined ? 2 : d) + "%";
}
function compact(n) {
  if (!Number.isFinite(n)) return "—";
  var a = Math.abs(n);
  if (a >= 1e12) return fmt(n / 1e12, 2) + "T";
  if (a >= 1e9)  return fmt(n / 1e9, 2) + "B";
  if (a >= 1e6)  return fmt(n / 1e6, 2) + "M";
  if (a >= 1e3)  return fmt(n / 1e3, 1) + "K";
  return fmt(n, 1);
}
function ago(ts) {
  if (!ts) return "—";
  var s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "قبل ثوانٍ";
  if (s < 3600) return "قبل " + Math.floor(s / 60) + " دقيقة";
  if (s < 86400) return "قبل " + Math.floor(s / 3600) + " ساعة";
  return "قبل " + Math.floor(s / 86400) + " يوم";
}
/* عدّاد تنازلي — للتمويل القادم وتعديل الصعوبة والتنصيف. */
function until(ts) {
  var s = Math.floor((ts - Date.now()) / 1000);
  if (!Number.isFinite(s) || s <= 0) return "—";
  var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d > 0) return d + " يوم و" + h + " ساعة";
  if (h > 0) return h + " ساعة و" + m + " دقيقة";
  return m + " دقيقة";
}

function save(k, v) { try { localStorage.setItem("btc_" + k, JSON.stringify(v)); } catch (e) {} }
function load(k, d) {
  try { var v = localStorage.getItem("btc_" + k); return v ? JSON.parse(v) : d; }
  catch (e) { return d; }
}

/* =====================================================================
   الجلب — تبديلٌ تلقائي بين المضيفات، ومهلةٌ صريحة.

   المهلة ‎12‎ ثانية لا لانتظارٍ أطول: طلبٌ معلَّق يمنع `Promise.all`
   كلَّها من الاكتمال، فتتجمّد الصفحة على مصدرٍ واحد بطيء. والإجهاض
   يُحوِّل البطء إلى فشلٍ صريح يُوسَم في سجلّ الصحّة.
   ===================================================================== */
function jget(hosts, path, key, label) {
  var list = Array.isArray(hosts) ? hosts : [hosts];
  var i = 0;
  function attempt() {
    if (i >= list.length) {
      var e = new Error("فشل الاتصال بكل المضيفات");
      if (key) srcMark(key, label, false, e);
      return Promise.reject(e);
    }
    var url = list[i++] + (path || "");
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 12000);
    return fetch(url, { cache: "no-store", signal: ctl.signal })
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) { if (key) srcMark(key, label, true); return j; })
      .catch(function () { clearTimeout(timer); return attempt(); });
  }
  return attempt();
}

/* آخر قيمةٍ صالحة في سلسلة — السلاسل مليئة بـ`null` في بدايتها لأن
   المتوسّط لا يوجد قبل اكتمال مدّته. */
function last(a) {
  if (!a) return null;
  for (var i = a.length - 1; i >= 0; i--) if (a[i] !== null && Number.isFinite(a[i])) return a[i];
  return null;
}
/* القيمة قبل الأخيرة — لكشف التقاطعات: «كان تحت وصار فوق». */
function prevOf(a, back) {
  back = back || 1;
  if (!a) return null;
  var seen = 0;
  for (var i = a.length - 1; i >= 0; i--) {
    if (a[i] !== null && Number.isFinite(a[i])) { if (seen++ === back) return a[i]; }
  }
  return null;
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/* النسبة المئوية لموقع قيمةٍ داخل نافذةٍ تاريخية — الأساس لكل مقياسٍ
   «متطرّف أم عادي»: التمويل و`OI` و`Puell` كلها بلا معنى بالمطلق. */
function pctRankOf(series, win) {
  var a = (series || []).filter(function (v) { return v !== null && Number.isFinite(v); });
  if (a.length < 10) return null;
  var w = a.slice(-(win || a.length));
  var v = w[w.length - 1];
  var below = w.filter(function (x) { return x < v; }).length;
  return below / w.length * 100;
}
function zOf(series, win) {
  var a = (series || []).filter(function (v) { return v !== null && Number.isFinite(v); });
  if (a.length < 10) return null;
  var w = a.slice(-(win || a.length));
  var m = w.reduce(function (s, x) { return s + x; }, 0) / w.length;
  var sd = Math.sqrt(w.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / w.length);
  return sd > 0 ? (w[w.length - 1] - m) / sd : 0;
}

/* الارتباط الخطّي بين سلسلتين — للماكرو (الدولار والذهب والأسهم). */
function corrOf(a, b) {
  var n = Math.min(a.length, b.length);
  if (n < 10) return null;
  var x = a.slice(-n), y = b.slice(-n);
  var mx = x.reduce(function (s, v) { return s + v; }, 0) / n;
  var my = y.reduce(function (s, v) { return s + v; }, 0) / n;
  var sxy = 0, sxx = 0, syy = 0;
  for (var i = 0; i < n; i++) {
    var dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TFS, TF_LABEL, TF_MS, TF_WEIGHT, HORIZONS, HZ,
                     fmt, money, pct, compact, last, prevOf, clamp,
                     pctRankOf, zOf, corrOf };
}
