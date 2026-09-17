/* =====================================================================
   جلبُ البيانات — كل مصدرٍ خارجي يمرّ من هنا.

   قاعدتان تحكمان الملف:

   **الفشلُ الجزئي ليس فشلاً كلّياً.** كلُّ جالبٍ يُغلَّف بحيث يُعيد
   `null` بدل أن يرمي، فتعطُّلُ `mempool.space` لا يمنع عرض السعر.
   والموقع يعمل ‎24/7‎ على عشرة مصادر مجانية، وتعطُّلُ أحدها أمرٌ يقع
   لا احتمالٌ نظري.

   **كلُّ نجاحٍ وكلُّ فشلٍ يُوسَم** في `state.src` عبر `srcMark`، فتعرض
   الواجهة لوحةَ صحّةٍ حقيقية بدل أن تُخفي الانقطاع خلف قيمةٍ قديمة
   تبدو حيّة.
   ===================================================================== */

/* ---------------------------------------------------------------------
   الشموع. `limit` ألفٌ عمداً، ولسببين لا سببٍ واحد:

   الأول: المعايرة التاريخية تحتاج هذا العمق، وجلبُ ‎320‎ ثم طلبُ المزيد
   لاحقاً طلبان بدل واحد.

   والثاني أدقّ وأخفى: **المتوسّط الأسّي يحتاج تاريخاً يتجاوز مدّته
   بكثير حتى يستقرّ.** فهو يُبذَر بمتوسّطٍ بسيط لأوّل `n` شمعة، ويبقى
   أثرُ البذرة محسوساً مئات الشموع. وقِيس هذا فعلاً: ‎EMA200‎ اليومي
   بـ‎400‎ شمعة أعطى ‎74,040‎ وبـ‎1000‎ شمعة أعطى ‎73,157‎ — فارقُ ‎1.2%‎،
   وهو فارقٌ يقلب قراءة «السعر فوق المتوسّط أم تحته» في الحالات القريبة.

   والصحيحُ هو الأعمق: ‎800‎ شمعةٍ بعد البذرة تعني أثراً متلاشياً، بينما
   ‎200‎ شمعة تعني متوسّطاً ما زال يحمل بذرتَه. فالعمق هنا شرطُ صحّةٍ لا
   ترفُ أداء.
   --------------------------------------------------------------------- */
function fetchCandles(tf, limit) {
  return jget(SPOT_HOSTS,
    "/api/v3/klines?symbol=" + SYMBOL + "&interval=" + tf + "&limit=" + (limit || 1000),
    "binance", "بايننس — الشموع")
    .then(function (raw) {
      return raw.map(function (r) {
        return { t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5],
                 tb: +r[9] };   // حجم المشتري الآخذ — أساس الدلتا
      });
    });
}

function fetchTicker() {
  return jget(SPOT_HOSTS, "/api/v3/ticker/24hr?symbol=" + SYMBOL,
              "binance", "بايننس — السعر");
}

/* =====================================================================
   المشتقّات — التمويل والعقود المفتوحة وتموضع الحشد.

   التمويل يُقرأ **بالانحراف المعياري لا بالمطلق**: ‎0.01%‎ رقمٌ عادي في
   سوقٍ هادئ ومتطرّفٌ في سوقٍ خامد، وقراءتُه بالمطلق تجعل الاستراتيجية
   تُطلق في أوقاتٍ لا معنى لها. فيُجلب تاريخُ ‎500‎ تمويلةٍ (نحو خمسة
   أشهر) ويُقاس الحاضر عليه.
   ===================================================================== */
function fetchDerivs(spotPx) {
  var out = {};
  var jobs = [];

  jobs.push(jget(FUT_HOSTS, "/fapi/v1/premiumIndex?symbol=" + SYMBOL,
                 "fut", "بايننس — العقود")
    .then(function (p) {
      out.funding = +p.lastFundingRate;
      out.nextFunding = +p.nextFundingTime;
      out.mark = +p.markPrice;
      out.index = +p.indexPrice;
      if (Number.isFinite(spotPx) && spotPx > 0) out.basisPct = (out.mark - spotPx) / spotPx * 100;
    }).catch(function () {}));

  jobs.push(jget(FUT_HOSTS, "/fapi/v1/fundingRate?symbol=" + SYMBOL + "&limit=500")
    .then(function (h) {
      var s = h.map(function (r) { return +r.fundingRate; });
      out.fundingHist = s;
      out.fundingZ = zOf(s, 500);
      out.fundingRank = pctRankOf(s, 500);
      out.fundingAnnual = out.funding * 3 * 365 * 100;   // ثلاث تمويلاتٍ يومياً
    }).catch(function () {}));

  jobs.push(jget(FUT_HOSTS, "/futures/data/openInterestHist?symbol=" + SYMBOL + "&period=1h&limit=200")
    .then(function (oi) {
      if (!oi.length) return;
      var s = oi.map(function (r) { return +r.sumOpenInterestValue; });
      out.oi = s[s.length - 1];
      out.oiSeries = s;
      var back = s[Math.max(0, s.length - 25)];
      out.oiChg = back > 0 ? (out.oi - back) / back * 100 : null;
      out.oiRank = pctRankOf(s, 200);
    }).catch(function () {}));

  jobs.push(jget(FUT_HOSTS, "/futures/data/globalLongShortAccountRatio?symbol=" + SYMBOL + "&period=1h&limit=30")
    .then(function (ls) {
      if (!ls.length) return;
      out.ls = +ls[ls.length - 1].longShortRatio;
      out.longPct = +ls[ls.length - 1].longAccount * 100;
      out.lsSeries = ls.map(function (r) { return +r.longShortRatio; });
    }).catch(function () {}));

  jobs.push(jget(FUT_HOSTS, "/futures/data/topLongShortPositionRatio?symbol=" + SYMBOL + "&period=1h&limit=2")
    .then(function (t) {
      if (t.length) out.topLs = +t[t.length - 1].longShortRatio;
    }).catch(function () {}));

  return Promise.all(jobs).then(function () { return out; });
}

/* =====================================================================
   الأسعار عبر المنصّات — وبريميوم كوينبيز.

   بريميوم كوينبيز مقياسٌ مؤسّسيٌّ أمريكي معروف: كوينبيز هي بوّابةُ
   الشراء الأمريكية، وارتفاعُ سعرها فوق بايننس يعني طلباً أمريكياً
   يسبق السوق. ويُحسب نسبةً لا بالدولار لأن الفارق المطلق بلا معنى
   عبر مستويات السعر.
   ===================================================================== */
function fetchCross(binPx) {
  var out = { venues: [] };
  var jobs = [];

  jobs.push(fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker",
                  { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var p = +j.price;
      if (Number.isFinite(p)) {
        out.coinbase = p;
        out.venues.push({ name: "كوينبيز", px: p });
        if (Number.isFinite(binPx) && binPx > 0) out.cbPrem = (p - binPx) / binPx * 100;
      }
      srcMark("coinbase", "كوينبيز", true);
    }).catch(function (e) { srcMark("coinbase", "كوينبيز", false, e); }));

  jobs.push(fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var k = j.result && j.result[Object.keys(j.result)[0]];
      var p = k && +k.c[0];
      if (Number.isFinite(p)) { out.kraken = p; out.venues.push({ name: "كراكن", px: p }); }
      srcMark("kraken", "كراكن", true);
    }).catch(function (e) { srcMark("kraken", "كراكن", false, e); }));

  jobs.push(fetch("https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT",
                  { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var p = j.result && j.result.list && +j.result.list[0].lastPrice;
      if (Number.isFinite(p)) { out.bybit = p; out.venues.push({ name: "بايبت", px: p }); }
      srcMark("bybit", "بايبت", true);
    }).catch(function (e) { srcMark("bybit", "بايبت", false, e); }));

  jobs.push(fetch("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var p = j.data && j.data.length && +j.data[0].last;
      if (Number.isFinite(p)) { out.okx = p; out.venues.push({ name: "أوكي إكس", px: p }); }
      srcMark("okx", "أوكي إكس", true);
    }).catch(function (e) { srcMark("okx", "أوكي إكس", false, e); }));

  return Promise.all(jobs).then(function () {
    if (Number.isFinite(binPx)) out.venues.unshift({ name: "بايننس", px: binPx });
    var px = out.venues.map(function (v) { return v.px; });
    if (px.length > 1) {
      var hi = Math.max.apply(null, px), lo = Math.min.apply(null, px);
      out.spread = hi - lo;
      out.spreadPct = Number.isFinite(out.cbPrem) ? out.cbPrem : (hi - lo) / lo * 100;
      out.range = { hi: hi, lo: lo };
    }
    return out;
  });
}

/* مؤشّر الخوف والطمع — ثلاثون يوماً لقراءة الاستمرار لا اللحظة. */
function fetchFng() {
  return fetch("https://api.alternative.me/fng/?limit=30", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      srcMark("fng", "الخوف والطمع", true);
      return j.data.map(function (d) {
        return { v: +d.value, cls: d.value_classification, t: +d.timestamp * 1000 };
      });
    })
    .catch(function (e) { srcMark("fng", "الخوف والطمع", false, e); return null; });
}

/* =====================================================================
   الأونتشين — من `mempool.space` و`blockchain.info`.

   هذه هي الطبقة التي تفصل تحليل البتكوين عن تحليل أي أصلٍ آخر: شبكةٌ
   مفتوحة يمكن قياسُ صحّتها مباشرةً — من يعدّن، وبأي تكلفة، وكم يُستعمل
   الدفتر فعلاً. ولا يوجد ما يقابلها في الأسهم.
   ===================================================================== */
function fetchOnchain() {
  var out = {};
  var jobs = [];

  jobs.push(fetch("https://mempool.space/api/v1/difficulty-adjustment", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      out.diffProgress = j.progressPercent;
      out.diffEst = j.difficultyChange;
      out.diffDate = j.estimatedRetargetDate;
      out.diffBlocks = j.remainingBlocks;
      out.blockTimeAvg = j.timeAvg / 1000;
      srcMark("mempool", "mempool.space", true);
    }).catch(function (e) { srcMark("mempool", "mempool.space", false, e); }));

  jobs.push(fetch("https://mempool.space/api/v1/fees/recommended", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) { out.feeFast = j.fastestFee; out.feeHour = j.hourFee; })
    .catch(function () {}));

  jobs.push(fetch("https://mempool.space/api/mempool", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) { out.mempoolCount = j.count; out.mempoolVsize = j.vsize; })
    .catch(function () {}));

  jobs.push(fetch("https://mempool.space/api/blocks/tip/height", { cache: "no-store" })
    .then(function (r) { return r.text(); })
    .then(function (t) {
      var h = +t;
      if (!Number.isFinite(h)) return;
      out.height = h;
      /* التنصيف كل ‎210,000‎ كتلة. والرابع وقع عند ‎840,000‎ — فما بعده
         يُحسب بالقسمة لا بجدولٍ مكتوبٍ يدوياً يَبلى. */
      var era = Math.floor(h / 210000);
      out.lastHalvingHeight = era * 210000;
      out.nextHalvingHeight = (era + 1) * 210000;
      out.blocksToHalving = out.nextHalvingHeight - h;
      /* عشر دقائق للكتلة متوسّطاً — تقديرٌ يكفي لعدّادٍ بالأشهر. */
      out.halvingDate = Date.now() + out.blocksToHalving * 600 * 1000;
      out.monthsSinceHalving = (h - out.lastHalvingHeight) * 600 * 1000 / (30.44 * 864e5);
      out.subsidy = 50 / Math.pow(2, era);
    }).catch(function () {}));

  /* الهاش — سنةٌ كاملة لحساب شرائط ‎30/60‎ يوماً. */
  jobs.push(fetch("https://mempool.space/api/v1/mining/hashrate/1y", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var hr = (j.hashrates || []).map(function (x) { return x.avgHashrate; });
      if (hr.length < 70) return;
      out.hashrate = hr[hr.length - 1];
      out.hashSeries = hr;
      var m30 = sma(hr, 30), m60 = sma(hr, 60);
      var a = last(m30), b = last(m60);
      if (a !== null && b !== null) {
        out.hashRibbon = a > b ? 1 : -1;
        /* عمرُ التقاطع: إشارةُ شرائط الهاش قيمتُها في طزاجتها — تقاطعٌ
           عمرُه أربعة أشهر معلومةٌ تاريخية لا إشارة. */
        for (var i = m30.length - 1; i > 60; i--) {
          if (m30[i] === null || m60[i] === null || m30[i - 1] === null) continue;
          if ((m30[i] > m60[i]) !== (m30[i - 1] > m60[i - 1])) {
            out.hashCrossAge = m30.length - 1 - i; break;
          }
        }
      }
      var back = hr[Math.max(0, hr.length - 31)];
      out.hashGrowth = back > 0 ? (out.hashrate - back) / back * 100 : null;
    }).catch(function () {}));

  /* إيرادُ المعدّنين — أساس `Puell`. سنتان لأن المقام متوسّطُ ‎365‎ يوماً. */
  jobs.push(fetch("https://api.blockchain.info/charts/miners-revenue?timespan=2years&format=json&cors=true",
                  { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var v = (j.values || []).map(function (x) { return x.y; });
      if (v.length < 370) return;
      var m365 = sma(v, 365), den = last(m365);
      out.minerRev = v[v.length - 1];
      if (den > 0) out.puell = v[v.length - 1] / den;
      srcMark("chain", "blockchain.info", true);
    }).catch(function (e) { srcMark("chain", "blockchain.info", false, e); }));

  /* حجمُ التحويلات بالدولار — أساس `NVT`. */
  jobs.push(fetch("https://api.blockchain.info/charts/estimated-transaction-volume-usd?timespan=1year&format=json&cors=true",
                  { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      out.txVolSeries = (j.values || []).map(function (x) { return x.y; });
      out.txVol = out.txVolSeries[out.txVolSeries.length - 1];
    }).catch(function () {}));

  return Promise.all(jobs).then(function () { return out; });
}

/* بيانات السوق العامة — الهيمنة وسيولة العملات المستقرة. */
function fetchGlobal() {
  var out = {};
  var jobs = [];

  jobs.push(fetch("https://api.coingecko.com/api/v3/global", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var d = j.data;
      out.dom = d.market_cap_percentage.btc;
      out.totalMcap = d.total_market_cap.usd;
      out.mcapChg24 = d.market_cap_change_percentage_24h_usd;
      /* تغيّرُ الهيمنة يحتاج قيمةً سابقة، ولا يعطيها المصدر — فتُحفظ
         محلّياً بطابعٍ زمني. ولا تُقارن قيمتان بينهما دقيقتان: يُشترط
         ستّ ساعاتٍ على الأقل حتى يكون الفارق إشارةً لا ضجيجاً. */
      var prevD = load("domPrev", null);
      if (prevD && Number.isFinite(prevD.v) && Date.now() - prevD.t > 6 * 36e5) {
        out.domChg = out.dom - prevD.v;
        save("domPrev", { v: out.dom, t: Date.now() });
      } else if (!prevD) {
        save("domPrev", { v: out.dom, t: Date.now() });
      } else if (Number.isFinite(prevD.v)) {
        out.domChg = out.dom - prevD.v;
      }
      srcMark("cg", "كوين جيكو", true);
    }).catch(function (e) { srcMark("cg", "كوين جيكو", false, e); }));

  jobs.push(fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin",
                  { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (list) {
      var total = 0;
      list.forEach(function (c) { if (Number.isFinite(c.market_cap)) total += c.market_cap; });
      if (!total) return;
      out.stable = total;
      var prevS = load("stablePrev", null);
      if (!prevS) { save("stablePrev", { v: total, t: Date.now() }); return; }
      if (Number.isFinite(prevS.v) && prevS.v > 0) {
        var days = Math.max(1, (Date.now() - prevS.t) / 864e5);
        out.stableChg30 = (total - prevS.v) / prevS.v * 100 * (30 / days);
        if (Date.now() - prevS.t > 7 * 864e5) save("stablePrev", { v: total, t: Date.now() });
      }
    }).catch(function () {}));

  return Promise.all(jobs).then(function () { return out; });
}

/* =====================================================================
   الماكرو — يُقرأ من ملفٍّ في نفس الدومين لا من الشبكة مباشرةً.

   السبب: `Stooq` و`Farside` لا يرسلان ترويسة `CORS`، فالمتصفّح يمنع
   قراءتهما مهما كان الطلب صحيحاً. والحلّ مهمّةٌ مجدولة في
   `.github/workflows/macro.yml` تجلبهما من خوادم GitHub — حيث لا وجود
   لـ`CORS` أصلاً — وتكتب `data/macro.json` في المستودع.

   فالموقع يقرأ ملفَّه هو. ولا وسيطَ طرفٍ ثالث يتعطّل، ولا اعتماد على
   جهاز المستخدم.
   ===================================================================== */
function fetchMacro() {
  return fetch("data/macro.json?t=" + Math.floor(Date.now() / 3e5), { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (j) {
      srcMark("macro", "الماكرو والصناديق", true);
      if (j.updated) j.updated = new Date(j.updated).getTime();
      return j;
    })
    .catch(function (e) { srcMark("macro", "الماكرو والصناديق", false, e); return null; });
}

/* =====================================================================
   الأخبار — تغذياتٌ متعدّدة ونبرةٌ مرجّحة.

   الترجيح بالحداثة مقصود: عنوانٌ عمرُه ثلاثة أيام لا يصف السوق الآن.
   والمعجم موسَّعٌ بأوزان — «اختراق» ليست بقوّة «إفلاس»، وتسويتُهما
   تجعل الدرجة بلا معنى.
   ===================================================================== */
var NEWS_FEEDS = [
  ["CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss"],
  ["Cointelegraph", "https://cointelegraph.com/rss/tag/bitcoin"],
  ["Bitcoin Magazine", "https://bitcoinmagazine.com/feed"],
  ["Decrypt", "https://decrypt.co/feed"],
  ["The Block", "https://www.theblock.co/rss.xml"]
];

var TONE_POS = [
  [/\b(all[- ]?time high|record high|ath)\b/i, 3], [/\bsurge|soar|skyrocket|rally\b/i, 2.5],
  [/\bbullish|breakout\b/i, 2], [/\b(etf )?inflow|accumulat/i, 2.5],
  [/\badopt|approval|approve|greenlight/i, 2.5], [/\binstitutional|treasury buy/i, 2],
  [/\bjump|climb|gain|rise|boost|up \d+%/i, 1.5], [/\bhalving|scarcity/i, 1],
  [/\bpartnership|integrat|launch/i, 1]
];
var TONE_NEG = [
  [/\bcrash|collapse|plunge|plummet\b/i, 3], [/\bhack|exploit|stolen|breach/i, 3],
  [/\bbankrupt|insolven|fraud|ponzi|scam/i, 3], [/\bban\b|crackdown|prohibit/i, 2.5],
  [/\b(etf )?outflow|liquidat|capitulat/i, 2.5], [/\blawsuit|sec sues|charged|indict/i, 2],
  [/\bbearish|selloff|sell[- ]off|dump/i, 2], [/\bdrop|fall|slump|decline|down \d+%/i, 1.5],
  [/\bwarn|risk|concern|fear|caution/i, 1], [/\bdelay|reject|denied/i, 1.5]
];

function toneOf(title) {
  var s = 0;
  TONE_POS.forEach(function (p) { if (p[0].test(title)) s += p[1]; });
  TONE_NEG.forEach(function (p) { if (p[0].test(title)) s -= p[1]; });
  return s;
}

function fetchNews() {
  var all = [];
  var jobs = NEWS_FEEDS.map(function (f) {
    return fetch("https://api.rss2json.com/v1/api.json?rss_url=" +
                 encodeURIComponent(f[1]), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.status !== "ok" || !j.items) return;
        j.items.forEach(function (it) {
          var t = new Date(it.pubDate).getTime();
          if (!Number.isFinite(t)) return;
          /* فلترُ البتكوين: الموقع متخصّص، وخبرُ عملةٍ أخرى ضجيجٌ هنا.
             ويُقبل العنوان إن ذكر البتكوين أو ما يخصّه مباشرةً. */
          var txt = it.title + " " + (it.description || "").slice(0, 200);
          if (!/bitcoin|btc|satoshi|halving|miner|mining|etf|spot etf/i.test(txt)) return;
          all.push({ src: f[0], title: it.title, link: it.link, t: t, tone: toneOf(it.title) });
        });
      }).catch(function () {});
  });

  return Promise.all(jobs).then(function () {
    if (!all.length) { srcMark("news", "الأخبار", false, new Error("لا عناوين")); return null; }
    srcMark("news", "الأخبار", true);
    /* إزالة المكرّر: نفس الخبر ينشره أكثر من مصدر، وعدُّه مرّتين
       يضاعف أثره في الدرجة بلا سبب. */
    var seen = {}, uniq = [];
    all.sort(function (a, b) { return b.t - a.t; }).forEach(function (n) {
      var key = n.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 45);
      if (seen[key]) return;
      seen[key] = 1; uniq.push(n);
    });
    return uniq.slice(0, 40);
  });
}

/* الدرجة المرجّحة بالحداثة: نصفُ الوزن كل ‎24‎ ساعة. */
function newsScore(news) {
  if (!news || !news.length) return { score: null, count: 0 };
  var num = 0, den = 0, now = Date.now();
  news.forEach(function (n) {
    var hrs = (now - n.t) / 36e5;
    if (hrs > 72) return;
    var w = Math.pow(0.5, hrs / 24);
    num += n.tone * w; den += w;
  });
  if (den < 1) return { score: null, count: 0 };
  return { score: clamp(num / den * 18, -100, 100),
           count: news.filter(function (n) { return (now - n.t) / 36e5 <= 72; }).length };
}

/* =====================================================================
   الموسمية — حافّةٌ محسوبةٌ من تاريخ البتكوين نفسه.

   لا من مأثورٍ («سبتمبر أحمر»): تُمرَّر الشموع اليومية، ويُقاس متوسّط
   عائد هذا الشهر وهذا اليوم من الأسبوع تاريخياً. و`n` معروضٌ دائماً
   لأن حافّةً على ‎11‎ عيّنة ليست حافّة.
   ===================================================================== */
function seasonalityOf(daily) {
  if (!daily || daily.length < 400) return null;
  var now = new Date();
  var mo = now.getUTCMonth(), dow = now.getUTCDay();
  var moR = [], dowR = [];
  for (var i = 1; i < daily.length; i++) {
    var d = new Date(daily[i].t);
    var ret = (daily[i].c - daily[i - 1].c) / daily[i - 1].c * 100;
    if (!Number.isFinite(ret)) continue;
    if (d.getUTCMonth() === mo) moR.push(ret);
    if (d.getUTCDay() === dow) dowR.push(ret);
  }
  function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  var mAvg = avg(moR), dAvg = avg(dowR);
  var edge = 0, n = 0;
  if (mAvg !== null) { edge += mAvg; n += moR.length; }
  if (dAvg !== null) { edge += dAvg * 0.6; n = Math.min(n || 1e9, dowR.length); }
  var MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو",
                "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  var DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  return { edge: edge, n: n, monthAvg: mAvg, dowAvg: dAvg,
           monthN: moR.length, dowN: dowR.length,
           month: MONTHS[mo], dow: DAYS[dow] };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { toneOf, newsScore, seasonalityOf };
}
