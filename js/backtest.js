/* =====================================================================
   المعايرة — كم تساوي كلُّ استراتيجيةٍ فعلاً على البتكوين؟

   لماذا هذا الملفّ موجود أصلاً: كلُّ نظامٍ يجمع مؤشّراتٍ يواجه سؤالاً
   لا مهرب منه — بأيّ وزنٍ يُجمَع؟ والجواب الشائع أوزانٌ يخترعها
   المؤلّف من حدسه («الاتجاه أهمّ من الزخم»)، وهي في النهاية رأيٌ
   مغلَّفٌ برقم.

   والجواب هنا: تُختبر كلُّ استراتيجيةٍ على تاريخ البتكوين نفسه، في
   الأفق نفسه، ويصير **وزنُها حافّتَها المقيسة**. فيرى القارئ أيَّ
   مؤشّرٍ يستحقّ الثقة وأيَّها ضجيج — بالأرقام لا بالمأثور.

   ---------------------------------------------------------------------
   ثلاثةُ احترازاتٍ ضدّ الوهم:

   **الانكماشُ نحو الصفر عند العينات الصغيرة.** استراتيجيةٌ أصابت ‎9‎
   من ‎10‎ ليست أفضلَ من أخرى أصابت ‎560‎ من ‎1000‎: الأولى حظٌّ محتمل.
   فالحافّة تُضرب في `n/(n+25)`، ولا تبلغ قيمتَها الكاملة إلا بعشرات
   الإشارات.

   **نسبةُ الإصابة وحدها لا تكفي.** استراتيجيةٌ تربح ‎70%‎ من المرّات
   ربحاً ضئيلاً وتخسر ‎30%‎ خسارةً فادحة هي استراتيجيةٌ خاسرة. فإن كان
   متوسّطُ العائد سالباً، لا تُمنح حافّةً موجبة مهما بلغت إصابتُها.

   **لا تسريبَ مستقبل.** التقييم عند الشمعة `i` يرى `0..i` فقط، والعائد
   يُقاس من إغلاق `i` إلى إغلاق `i + bars`. وهذه أسهلُ قاعدةٍ تُخرَق
   بلا انتباه، وخرقُها يعطي نِسباً خرافية — ‎95%‎ إصابةً علامةُ عطبٍ
   لا علامةُ عبقرية.

   ---------------------------------------------------------------------
   ما **لا** يُعاير، ولماذا يُقال صراحةً:

   استراتيجياتُ التمويل والعقود المفتوحة والأونتشين والماكرو والأخبار
   تحتاج تاريخَ تلك البيانات، ولا تعطيه المصادر المجانية بعمقٍ كافٍ.
   فتبقى أوزانُها ‎1.0‎ وتُوسَم «لم تُقَس» في الجدول — ويُخفَّض تصنيفُ
   الثقة حين لا يكون المقيسُ من الإجماع شيئاً.

   وإعلانُ ذلك أصدقُ من منحها وزناً مخترعاً ثم تقديمِه كأنه مقيس.
   ===================================================================== */

var SHRINK_N = 25;

/* بناءُ «رؤية» التحليل عند شمعةٍ ماضية.

   السلاسل تُقتطع إلى `i+1`، والقيم القياسية تُقرأ عند `i`. والمشتقّات
   التي لا تُحسب سلسلةً (الهيكل، النمط، المسح، فيبوناتشي، ملفُّ الحجم)
   تُعاد حسابُها من الشموع المقتطعة — وهي الجزء المكلف، ولهذا تُقاس
   المعايرة بالخطوة لا بكل شمعة. */
function viewAt(full, i) {
  function sl(a) { return a ? a.slice(0, i + 1) : a; }
  var k = full.k.slice(0, i + 1);
  var h = full.h.slice(0, i + 1), l = full.l.slice(0, i + 1);
  var c = full.c.slice(0, i + 1), v = full.v.slice(0, i + 1);

  var v_ = {
    k: k, c: c, h: h, l: l, v: v, o: full.o.slice(0, i + 1), px: full.c[i], n: i + 1,
    e20: sl(full.e20), e50: sl(full.e50), e100: sl(full.e100), e200: sl(full.e200),
    s50: sl(full.s50), s200: sl(full.s200),
    E20: full.e20[i], E50: full.e50[i], E100: full.e100[i], E200: full.e200[i],
    S50: full.s50[i], S200: full.s200[i],
    macd: { line: sl(full.macd.line), signal: sl(full.macd.signal), hist: sl(full.macd.hist) },
    MACD: full.macd.line[i], SIG: full.macd.signal[i],
    HIST: full.macd.hist[i], HISTp: full.macd.hist[i - 1],
    bb: { mid: sl(full.bb.mid), up: sl(full.bb.up), lo: sl(full.bb.lo),
          width: sl(full.bb.width), pctB: sl(full.bb.pctB) },
    BBu: full.bb.up[i], BBl: full.bb.lo[i], BBm: full.bb.mid[i],
    BBW: full.bb.width[i], PCTB: full.bb.pctB[i],
    atr: sl(full.atr), ATR: full.atr[i],
    atrPct: (full.atr[i] && full.c[i]) ? full.atr[i] / full.c[i] * 100 : null,
    rsi: sl(full.rsi), RSI: full.rsi[i], RSIp: full.rsi[i - 1],
    adx: sl(full.adx), ADX: full.adx[i], PDI: full._pDI[i], MDI: full._mDI[i],
    st: { dir: sl(full.st.dir), line: sl(full.st.line) },
    STdir: full.st.dir[i], STline: full.st.line[i], STdirP: full.st.dir[i - 1],
    ich: full.ich, TENKAN: full.ich.tenkan[i], KIJUN: full.ich.kijun[i],
    SPANA: full.ich.spanA[i], SPANB: full.ich.spanB[i],
    psar: full.psar, SARdir: full.psar.dir[i], SARdirP: full.psar.dir[i - 1],
    SAR: full.psar.sar[i],
    d20: { up: sl(full.d20.up), lo: sl(full.d20.lo) },
    d55: { up: sl(full.d55.up), lo: sl(full.d55.lo) },
    D20u: full.d20.up[i], D20l: full.d20.lo[i],
    D55u: full.d55.up[i], D55l: full.d55.lo[i],
    KCu: full.kc.up[i], KCl: full.kc.lo[i],
    sq: sl(full.sq), SQZ: full.sq[i], SQZp: full.sq[i - 1],
    STOK: full.stoch.k[i], STOD: full.stoch.d[i],
    srsi: full.srsi, SRSIK: full.srsi.k[i], SRSID: full.srsi.d[i], SRSIKp: full.srsi.k[i - 1],
    cci: sl(full.cci), CCI: full.cci[i], WR: full.wr[i],
    roc: sl(full.roc), ROC: full.roc[i],
    mfi: sl(full.mfi), MFI: full.mfi[i],
    obv: sl(full.obv), OBV: full.obv[i], ad: sl(full.ad), AD: full.ad[i],
    cvd: sl(full.cvd), CVD: full.cvd[i], CVDp: full.cvd[i - 1],
    vwapD: full.vwapD, VWAPD: full.vwapD.vwap[i], VWSD: full.vwapD.sd[i],
    VWAPW: full.vwapW.vwap[i],
    VOL: full.v[i],
    volMed: (function () {
      var w = v.slice(-50).slice().sort(function (a, b) { return a - b; });
      return w.length ? w[Math.floor(w.length / 2)] : null;
    })()
  };

  /* المشتقّات المعادُ حسابها — تُقيَّد بنافذةٍ قصيرة لأنها الجزء
     المكلف، ونتيجتُها لا تتغيّر بزيادة العمق. */
  v_.ms = marketStructure(h, l, 3);
  v_.pattern = candlePattern(k);
  v_.sweep = liquiditySweep(k, 20);
  v_.fib = fibLevels(h, l, 5);
  v_.vp = volumeProfile(k, 32, 160);
  v_.fvg = fvg(k, 80);
  v_.divRsi = divergence(h, l, v_.rsi, 3, 60);
  v_.divMacd = divergence(h, l, v_.macd.hist, 3, 60);
  v_.divObv = divergence(h, l, v_.obv, 3, 60);
  return v_;
}

/* التحليل الكامل للسلاسل، مرّةً واحدة لكل فريم. مخرَجُه مدخلُ `viewAt`. */
function fullSeries(k) {
  var c = k.map(function (x) { return x.c; });
  var h = k.map(function (x) { return x.h; });
  var l = k.map(function (x) { return x.l; });
  var v = k.map(function (x) { return x.v; });
  var o = k.map(function (x) { return x.o; });
  var dmi = adx(h, l, c, 14);
  return {
    k: k, c: c, h: h, l: l, v: v, o: o,
    e20: ema(c, 20), e50: ema(c, 50), e100: ema(c, 100), e200: ema(c, 200),
    s50: sma(c, 50), s200: sma(c, 200),
    macd: macd(c), bb: bb(c, 20, 2), atr: atr(h, l, c, 14), rsi: rsi(c, 14),
    adx: dmi.adx, _pDI: dmi.pDI, _mDI: dmi.mDI,
    st: supertrend(h, l, c, 10, 3), ich: ichimoku(h, l, c), psar: psar(h, l),
    d20: donchian(h, l, 20), d55: donchian(h, l, 55),
    kc: keltner(h, l, c, 20, 2), sq: squeeze(h, l, c),
    stoch: stoch(h, l, c, 14, 3, 3), srsi: stochRsi(c, 14, 3, 3),
    cci: cci(h, l, c, 20), wr: williamsR(h, l, c, 14), roc: roc(c, 12),
    mfi: mfi(h, l, c, v, 14), obv: obv(c, v), ad: adLine(h, l, c, v), cvd: cvd(k),
    vwapD: anchoredVwap(k, "day"), vwapW: anchoredVwap(k, "week")
  };
}

/* =====================================================================
   المعايرة لأفقٍ واحد.

   `candles` خريطةُ فريمٍ ← شموع. والفريم القائد هو محورُ المشي، وبقيّةُ
   فريمات الأفق تُحاذى به زمنياً: عند الشمعة `i` من الفريم القائد،
   نأخذ من كل فريمٍ آخر آخرَ شمعةٍ **أُغلقت قبل** طابع `i` الزمني.

   ومحاذاةُ الزمن هذه هي الاحتراز الثالث ضدّ تسريب المستقبل: أخذُ آخر
   شمعةٍ يومية بلا فحصِ طابعها يعني قراءةَ إغلاقٍ لم يقع بعد.
   ===================================================================== */
function calibrateHorizon(hz, candles, opt) {
  opt = opt || {};
  var lead = hz.lead, leadK = candles[lead];
  if (!leadK || leadK.length < 320) return null;

  var series = {}, idxCache = {};
  hz.tfs.forEach(function (tf) {
    if (candles[tf] && candles[tf].length >= 260) series[tf] = fullSeries(candles[tf]);
  });
  if (!series[lead]) return null;

  var n = leadK.length;
  var start = Math.max(260, n - (opt.window || 900));
  var end = n - hz.bars - 1;
  if (end - start < 60) return null;

  /* الخطوة: نستهدف نحو ‎450‎ نقطة قياس. المشي بكل شمعةٍ يضاعف الزمن بلا
     أن يضيف معنى — الإشارات المتجاورة متداخلة أصلاً فليست مستقلّة. */
  var step = Math.max(1, Math.floor((end - start) / (opt.samples || 450)));

  var acc = {};   // id → {win, n, sum, wins[], losses[]}
  function bump(id, dir, ret) {
    var a = acc[id] || (acc[id] = { n: 0, win: 0, sum: 0, gain: 0, loss: 0 });
    var r = dir * ret;
    a.n++; a.sum += r;
    if (r > 0) { a.win++; a.gain += r; } else { a.loss += -r; }
  }

  for (var i = start; i <= end; i += step) {
    var tNow = leadK[i].t;
    var all = {};
    all[lead] = viewAt(series[lead], i);
    var ok = true;
    hz.tfs.forEach(function (tf) {
      if (tf === lead) return;
      if (!series[tf]) { ok = false; return; }
      var kk = candles[tf], j = -1;
      /* آخر شمعةٍ أُغلقت قبل الآن. الإغلاق = بداية الشمعة + مدّتها. */
      var cache = idxCache[tf] || (idxCache[tf] = { last: 0 });
      for (var q = cache.last; q < kk.length; q++) {
        if (kk[q].t + TF_MS[tf] > tNow) break;
        j = q;
      }
      cache.last = Math.max(0, j);
      if (j < 220) { ok = false; return; }
      all[tf] = viewAt(series[tf], j);
    });
    if (!ok) continue;

    var x = { a: all[lead], all: all, tfs: hz.tfs, hz: hz.id, ext: {} };
    var fwd = (leadK[i + hz.bars].c - leadK[i].c) / leadK[i].c * 100;

    for (var s = 0; s < STRATEGIES.length; s++) {
      var st = STRATEGIES[s];
      if (st.hz.indexOf(hz.id) < 0) continue;
      var d;
      try { d = st.side(x); } catch (e) { continue; }
      if (d !== 1 && d !== -1) continue;
      var g;
      try { g = evalGates(st, x, d); } catch (e) { continue; }
      /* لا تُحتسب إلا الإشارات ذات القناعة: نتيجةٌ تحت ‎55‎ تعني بوّاباتٍ
         متعادلة، وإدخالُها يقيس الضجيج لا الاستراتيجية. */
      if (g.sc < 55) continue;
      bump(st.id, d, fwd);
    }
  }

  var out = {};
  Object.keys(acc).forEach(function (id) {
    var a = acc[id];
    if (a.n < 8) { out[id] = { n: a.n, edge: null, hit: null, avg: null }; return; }
    var hit = a.win / a.n, avgR = a.sum / a.n;
    var raw = (hit - 0.5) * 4;
    /* الإصابة العالية بعائدٍ سالب ليست حافّة — تُقصَّ عند الصفر. */
    if (avgR < 0 && raw > 0) raw = 0;
    if (avgR > 0 && raw < 0) raw = Math.min(0, raw + 0.2);
    var shrink = a.n / (a.n + SHRINK_N);
    out[id] = { n: a.n, hit: hit, avg: avgR,
                pf: a.loss > 0 ? a.gain / a.loss : null,
                edge: raw * shrink };
  });
  return out;
}

function calibrateAll(candles, opt) {
  var out = { at: Date.now(), horizons: {} };
  HORIZONS.forEach(function (hz) {
    var r = calibrateHorizon(hz, candles, opt);
    if (r) out.horizons[hz.id] = r;
  });
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { calibrateAll, calibrateHorizon, fullSeries, viewAt };
}
