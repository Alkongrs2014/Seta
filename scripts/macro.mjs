/* =====================================================================
   جالبُ الماكرو — يعمل على خوادم GitHub لا في المتصفّح.

   سببُ وجوده كلِّه: `CORS`. مؤشّراتُ الأسهم والدولار والذهب وجداولُ
   تدفّقات الصناديق لا يرسل أيٌّ منها ترويسةَ `Access-Control-Allow-Origin`،
   فالمتصفّح يرفض قراءتها مهما كان الطلب صحيحاً. و`CORS` قيدُ متصفّحٍ لا
   قيدُ خادم — فالجلب من بيئة Actions يمرّ بلا عائق.

   والمخرَج `data/macro.json` في المستودع نفسه، فيقرأه الموقع من دومينه
   هو. لا وسيطَ طرفٍ ثالث يتعطّل، ولا اعتمادَ على جهاز المستخدم.

   ---------------------------------------------------------------------
   الفشلُ الجزئي مقبول، والصمتُ غيرُ مقبول.

   كلُّ مصدرٍ مغلَّفٌ على حدة. وتعطُّلُ الذهب لا يمنع كتابة الدولار
   والأسهم. والحقلُ الغائب يُحذف من الملفّ ولا يُكتب صفراً — فالواجهة
   تعرض «—» وتعرف أنها لا تعرف.

   وملاحظةٌ موثّقة على المصادر: `Stooq` أضاف تحدّي JavaScript
   و`Farside` يردّ ‎403‎ للطلبات بلا ترويسة متصفّح. فالبديل ياهو
   فاينانس (مختبَر)، و`Farside` بترويسةٍ كاملة (مختبَر)، و`FRED`
   احتياطاً للدولار.
   ===================================================================== */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* =====================================================================
   الجلبُ عبر `curl` لا عبر `fetch` — لموقعٍ واحد وبسببٍ مقيس.

   `Farside` يردّ ‎403‎ على كل طلبٍ من `fetch` في Node مهما بلغت
   الترويسات دقّةً، ويردّ ‎200‎ على `curl` بنفس الترويسات بالضبط. والفرق
   ليس في الترويسات بل في **بصمة TLS**: حمايةُ الموقع تتعرّف على عميل
   `undici` وترفضه قبل قراءة أيّ ترويسة.

   فلا يُصلحه تعديلُ ترويسةٍ ولا تكرارُ المحاولة. و`curl` موجودٌ أصلاً
   على منفّذات GitHub، فاستعمالُه هنا أبسطُ من إضافة اعتماديةٍ تحاكي
   بصمةَ المتصفّح.
   ===================================================================== */
function curlText(url) {
  return execFileSync("curl", [
    "-sSL", "--compressed", "--max-time", "30",
    "-A", UA,
    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "-H", "Accept-Language: en-US,en;q=0.9",
    url
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

async function get(url, asText, extraHeaders) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: Object.assign({
        "User-Agent": UA,
        "Accept": asText ? "text/html,application/xhtml+xml,text/csv,*/*" : "application/json,*/*",
        "Accept-Language": "en-US,en;q=0.9"
      }, extraHeaders || {})
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return asText ? await r.text() : await r.json();
  } finally { clearTimeout(t); }
}

/* ياهو فاينانس — سلسلةُ إغلاقاتٍ يومية نظيفة. */
async function yahoo(symbol, range = "1y") {
  const j = await get("https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?range=" + range + "&interval=1d");
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error("لا نتيجة");
  const ts = res.timestamp || [];
  const cl = res.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (cl[i] === null || !Number.isFinite(cl[i])) continue;
    out.push({ t: ts[i] * 1000, c: cl[i] });
  }
  if (out.length < 30) throw new Error("سلسلة قصيرة");
  return out;
}

/* شموعُ البتكوين اليومية — تُجلب هنا أيضاً لأن الارتباط يُحسب على
   الخادم لا في المتصفّح: حسابُه هناك يعني تحميل سلاسل الماكرو كاملةً
   إلى الجوّال بلا داعٍ. */
async function btcDaily() {
  const raw = await get("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=400");
  return raw.map(r => ({ t: r[0], c: +r[4] }));
}

/* محاذاةُ سلسلتين باليوم — الأسهم تُغلق في العطل والبتكوين لا يُغلق،
   فمقارنةُ المصفوفتين بالفهرس تزيح البيانات بأيام وتُفسد الارتباط. */
function alignReturns(a, b, days) {
  const map = new Map();
  for (const x of b) map.set(new Date(x.t).toISOString().slice(0, 10), x.c);
  const pa = [], pb = [];
  for (const x of a) {
    const k = new Date(x.t).toISOString().slice(0, 10);
    if (!map.has(k)) continue;
    pa.push(x.c); pb.push(map.get(k));
  }
  const ra = [], rb = [];
  for (let i = 1; i < pa.length; i++) {
    ra.push((pa[i] - pa[i - 1]) / pa[i - 1]);
    rb.push((pb[i] - pb[i - 1]) / pb[i - 1]);
  }
  return { a: ra.slice(-days), b: rb.slice(-days) };
}

function corr(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 10) return null;
  const A = x.slice(-n), B = y.slice(-n);
  const ma = A.reduce((s, v) => s + v, 0) / n, mb = B.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = A[i] - ma, db = B[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  return (saa > 0 && sbb > 0) ? sab / Math.sqrt(saa * sbb) : null;
}

const chgN = (s, n) => (s.length > n && s[s.length - 1 - n].c > 0)
  ? (s[s.length - 1].c - s[s.length - 1 - n].c) / s[s.length - 1 - n].c * 100 : null;

/* =====================================================================
   تدفّقاتُ صناديق البتكوين الفورية — من جدول Farside.

   الأرقام بملايين الدولارات، والسالب بين قوسين («‎(450.4)‎»)، و«‎-‎»
   تعني لا بيانات لا صفراً. وعمودُ `Total` هو الصافي اليومي.

   والتحليلُ بتعبيرٍ نمطي لا بمحلّل HTML كامل: صفحةٌ واحدة وجدولٌ واحد
   لا يستحقّان اعتماديةً إضافية. والثمن المعروف هشاشةٌ أمام تغيّر
   التخطيط — ولهذا يُتحقَّق من عدد الصفوف ومن أن آخر تاريخٍ حديث، وإن
   فشل التحقّق يُحذف الحقل بدل أن يُكتب رقمٌ خاطئ.
   ===================================================================== */
function parseMoney(s) {
  if (!s) return null;
  const t = s.replace(/[$,\s]/g, "").trim();
  if (!t || t === "-" || t === "—") return null;
  const neg = /^\(.*\)$/.test(t);
  const num = parseFloat(t.replace(/[()]/g, ""));
  return Number.isFinite(num) ? (neg ? -num : num) : null;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
                 Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

async function etfFlows() {
  const html = curlText("https://farside.co.uk/bitcoin-etf-flow-all-data/");
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  const cellsOf = r => (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || [])
    .map(c => c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());

  const data = [];
  for (const r of rows) {
    const c = cellsOf(r);
    if (!c.length) continue;
    const m = /^(\d{1,2})\s+(\w{3})\s+(\d{4})$/.exec(c[0]);
    if (!m) continue;
    const d = Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1]);
    const total = parseMoney(c[c.length - 1]);
    if (total === null) continue;

    /* صفُّ اليوم الجاري يظهر قبل صدور الأرقام: كلُّ صندوقٍ فيه «‎-‎»
       بينما عمودُ `Total` يُكتب «‎0.0‎». وقراءتُه صفراً تعني «لا تدفّق
       اليوم» وهي كذبة — الصحيح «لم يصدر بعد».

       فيُشترط أن يحمل الصفُّ رقماً واحداً حقيقياً على الأقلّ في أعمدة
       الصناديق. وبلا هذا الشرط يدخل صفرٌ كاذب في `flow5d` ويكسر
       `streak` كلَّ يومٍ عند فتح السوق. */
    const funds = c.slice(1, -1).filter(x => parseMoney(x) !== null);
    if (!funds.length) continue;

    data.push({ t: d, v: total });
  }
  if (data.length < 100) throw new Error("جدولٌ غيرُ متوقَّع — " + data.length + " صفاً");
  data.sort((a, b) => a.t - b.t);
  const lastAge = (Date.now() - data[data.length - 1].t) / 864e5;
  if (lastAge > 12) throw new Error("آخر صفٍّ عمرُه " + Math.round(lastAge) + " يوماً");

  const last5 = data.slice(-5), last20 = data.slice(-20);
  const sum = a => a.reduce((s, x) => s + x.v, 0);

  /* السلسلةُ المتّصلة: كم يوماً متتالياً في نفس الجهة. `streak` موجبٌ
     دخولاً وسالبٌ خروجاً. */
  let streak = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].v === 0) break;
    const s = data[i].v > 0 ? 1 : -1;
    if (streak === 0) streak = s;
    else if (Math.sign(streak) === s) streak += s;
    else break;
  }

  return {
    last: data[data.length - 1].v,
    lastDate: data[data.length - 1].t,
    flow5d: sum(last5),
    flow20d: sum(last20),
    streak,
    cumulative: sum(data),
    days: data.length
  };
}

/* =====================================================================
   البناء
   ===================================================================== */
const out = { updated: new Date().toISOString(), sources: {} };

function note(key, ok, err) {
  out.sources[key] = ok ? "ok" : ("فشل: " + String(err?.message || err).slice(0, 120));
  console.log((ok ? "✓ " : "✗ ") + key + (ok ? "" : " — " + out.sources[key]));
}

let btc = null;
try { btc = await btcDaily(); note("btc", true); }
catch (e) { note("btc", false, e); }

/* مؤشّر الدولار — ياهو أولاً، ثم FRED احتياطاً.

   والاحتياطُ ليس ترفاً: مؤشّر الدولار أهمُّ متغيّرٍ ماكرو للبتكوين
   تاريخياً، وغيابُه يُسقط استراتيجيةً كاملة. */
let dxy = null;
try {
  dxy = await yahoo("DX-Y.NYB");
  note("dxy", true);
} catch (e) {
  try {
    const csv = await get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS", true);
    const lines = csv.trim().split("\n").slice(1);
    dxy = lines.map(l => {
      const [d, v] = l.split(",");
      return { t: Date.parse(d), c: parseFloat(v) };
    }).filter(x => Number.isFinite(x.c) && Number.isFinite(x.t)).slice(-400);
    note("dxy", dxy.length > 30, dxy.length <= 30 ? new Error("FRED قصير") : null);
    if (dxy.length <= 30) dxy = null;
  } catch (e2) { note("dxy", false, e); dxy = null; }
}

let spx = null;
try { spx = await yahoo("^GSPC"); note("spx", true); }
catch (e) { note("spx", false, e); }

let gold = null;
try { gold = await yahoo("GC=F"); note("gold", true); }
catch (e) { note("gold", false, e); }

let vix = null;
try { vix = await yahoo("^VIX", "6mo"); note("vix", true); }
catch (e) { note("vix", false, e); }

let ibit = null;
try { ibit = await yahoo("IBIT", "6mo"); note("ibit", true); }
catch (e) { note("ibit", false, e); }

if (dxy)  { out.dxy  = dxy[dxy.length - 1].c;   out.dxyChg5  = chgN(dxy, 5);  out.dxyChg20  = chgN(dxy, 20); }
if (spx)  { out.spx  = spx[spx.length - 1].c;   out.spxChg5  = chgN(spx, 5);  out.spxChg20  = chgN(spx, 20); }
if (gold) { out.gold = gold[gold.length - 1].c; out.goldChg5 = chgN(gold, 5); out.goldChg20 = chgN(gold, 20); }
if (vix)  { out.vix  = vix[vix.length - 1].c;   out.vixChg5  = chgN(vix, 5); }
if (ibit) { out.ibit = ibit[ibit.length - 1].c; out.ibitChg5 = chgN(ibit, 5); }

if (btc) {
  if (dxy)  { const p = alignReturns(btc, dxy, 30);  out.corrDxy30  = corr(p.a, p.b);
              const q = alignReturns(btc, dxy, 90);  out.corrDxy90  = corr(q.a, q.b); }
  if (spx)  { const p = alignReturns(btc, spx, 30);  out.corrSpx30  = corr(p.a, p.b);
              const q = alignReturns(btc, spx, 90);  out.corrSpx90  = corr(q.a, q.b); }
  if (gold) { const p = alignReturns(btc, gold, 30); out.corrGold30 = corr(p.a, p.b); }
}

try { out.etf = await etfFlows(); note("etf", true); }
catch (e) { note("etf", false, e); }

/* حذفُ الحقول الفارغة — الغياب يُقرأ غياباً لا صفراً. */
for (const k of Object.keys(out)) {
  if (out[k] === null || out[k] === undefined || Number.isNaN(out[k])) delete out[k];
}
out.series = true;   // علامةٌ للواجهة أن الملفّ مبنيٌّ لا فارغ

/* =====================================================================
   الكتابة — وفحصُ التغيّر قبل الإيداع.

   بلا هذا الفحص يُنشئ الجدولُ إيداعاً كلّ ساعةٍ ولو لم يتغيّر رقم،
   فيمتلئ تاريخُ المستودع بضجيجٍ ويُعاد بناءُ الصفحات بلا سبب.
   والمقارنةُ تتجاهل `updated` لأنه يتغيّر دائماً بطبيعته.
   ===================================================================== */
mkdirSync("data", { recursive: true });
const path = "data/macro.json";
const next = JSON.stringify(out, null, 2);

let changed = true;
if (existsSync(path)) {
  try {
    const prev = JSON.parse(readFileSync(path, "utf8"));
    const strip = o => { const c = { ...o }; delete c.updated; delete c.sources; return JSON.stringify(c); };
    changed = strip(prev) !== strip(out);
  } catch { changed = true; }
}

const okCount = Object.values(out.sources).filter(v => v === "ok").length;
if (okCount === 0) {
  console.error("كل المصادر فشلت — لا يُكتب الملفّ حتى لا يُمحى الصالح بفارغ.");
  process.exit(1);
}

writeFileSync(path, next);
console.log(changed ? "تغيّر الملفّ — سيُودَع." : "لا تغيّر — لن يُودَع.");
console.log("نجح " + okCount + " من " + Object.keys(out.sources).length + " مصدراً.");
