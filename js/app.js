/* =====================================================================
   التشغيل — الإقلاع ودوراتُ التحديث والتبويبات.

   ---------------------------------------------------------------------
   دوراتٌ متدرّجة لا دورةٌ واحدة.

   السعر يتغيّر كل ثانية، وتعديلُ صعوبة التعدين كل أسبوعين. وجلبُهما
   بنفس الإيقاع إمّا أن يُهدر حدَّ الطلبات على المصادر المجانية (وتُحجب
   فعلاً)، أو أن يترك السعر بائتاً. فلكلّ طبقةٍ إيقاعُها:

     السعر والفني     ‎20‎ ثانية
     المشتقّات         دقيقتان
     الأونتشين         ‎10‎ دقائق
     الماكرو والأخبار  ‎15‎ دقيقة
     المعايرة          مرّةً كل ‎12‎ ساعة

   ---------------------------------------------------------------------
   والتبويبُ المخفيّ لا يُحدَّث.

   `visibilitychange` يوقف الدورات حين تُخفى الصفحة ويستأنفها عند
   العودة. فجوّالٌ في الجيب لا يستهلك بطاريةً ولا حزمةً على تحديثٍ لا
   يراه أحد — وهو الفرق بين موقعٍ «يعمل ‎24/7‎» وموقعٍ يُحرق الجوّال.
   ===================================================================== */

var busy = false, timers = [], side = "long";

/* =====================================================================
   بوّابة الثقة العالية للحظي.

   لا توصية «مضمونة» — توصيةٌ تُعرض فقط حين تجتمع أربعة شروطٍ معاً: ثقةٌ
   عالية في التوافق، سيولةٌ كافية على آخر شمعةٍ مغلقة، تأكيدٌ هيكلي
   واحد على الأقل (نمط شمعة أو M/W مؤكَّد أو مسحُ سيولة) يوافق الاتجاه،
   وتوافقُ الفريمات الثلاثة. غياب أيٍّ منها يُعلَن سببه لا يُخفى. */
function scalpHighConfidence(cons, lead, all, lv) {
  if (!cons || !cons.dir) return { pass: false, reason: "لا اتجاهٌ واضح بعد — الإجماع متعارض." };
  if (cons.conf !== "high") return { pass: false, reason: "الثقة ليست عالية بعد (" + (cons.confT || "—") + ")." };
  if (!lv) return { pass: false, reason: "المستويات غير محسوبة بعد." };
  if (lead.weakVol) return { pass: false, reason: "سيولة آخر شمعةٍ مغلقة ضعيفة — لا تُعتمد للتأكيد." };

  var rationale = [];
  if (lead.pattern && lead.pattern.dir === cons.dir) rationale.push("نمط شمعة: " + lead.pattern.name);
  if (lead.pat2 && lead.pat2.confirmed && lead.pat2.dir === cons.dir) rationale.push(lead.pat2.note);
  if (lead.sweep && lead.sweep.dir === cons.dir) rationale.push("مسح سيولة: " + lead.sweep.note);
  if (!rationale.length) return { pass: false, reason: "لا تأكيد نمط شمعة أو هيكلٍ يدعم الاتجاه." };

  var conflict = HZ.scalp.tfs.some(function (tf) {
    var a = all[tf];
    if (!a) return false;
    var tfDir = Number.isFinite(a.STdir) && a.STdir !== 0 ? a.STdir
              : (Number.isFinite(a.px) && Number.isFinite(a.E50) ? (a.px > a.E50 ? 1 : a.px < a.E50 ? -1 : 0) : 0);
    return tfDir !== 0 && tfDir !== cons.dir;
  });
  if (conflict) return { pass: false, reason: "الفريمات الثلاثة (3د/5د/15د) غير متوافقة على الاتجاه." };

  return { pass: true, dir: cons.dir, entry: lead.px,
           inv: lv.inv, invSrc: lv.invSrc, invPct: lv.invPct, warn: lv.warn,
           t1: lv.t1, t1Src: lv.t1Src, t2: lv.t2, t2Src: lv.t2Src, rr: lv.rr,
           rationale: rationale };
}

/* ---------------------------------------------------------------------
   إعادةُ الحساب — من الشموع إلى ثلاث بطاقات قرار.
   --------------------------------------------------------------------- */
function recompute() {
  /* شمعاتٌ مغلقة فقط: الشمعة الأخيرة الجارية تتغيّر قيمتها كل تحديث،
     ومؤشّرٌ يُبنى عليها يتذبذب بلا داعٍ — خصوصاً في اللحظي السريع. */
  state.analysis = {};
  TFS.forEach(function (tf) {
    if (state.candles[tf]) {
      try { state.analysis[tf] = computeAll(closedCandles(state.candles[tf], tf)); } catch (e) {}
    }
  });
  if (!state.analysis["1h"]) return;

  /* مقاييسُ الدورة تُشتقّ من الشموع اليومية — تُحسب هنا لا في الجلب،
     فتبقى محدَّثةً مع كل شمعةٍ جديدة بلا طلبِ شبكةٍ إضافي. */
  if (state.candles["1d"]) {
    if (state.onchain && Number.isFinite(state.onchain.height)) {
      state.onchain.supply = supplyAt(state.onchain.height);
    }
    state.onchain = cycleMetrics(state.candles["1d"], state.onchain || {});
  }

  var ns = newsScore(state.news);
  var ext = {
    derivs: state.derivs || {},
    onchain: state.onchain || {},
    macro: state.macro || {},
    global: state.global || {},
    cross: state.cross || {},
    fngVal: state.fng && state.fng.length ? state.fng[0].v : null,
    fngHist: state.fng,
    newsScore: ns.score, newsCount: ns.count,
    priceChg24: state.ticker ? +state.ticker.priceChangePercent : null,
    season: state.candles["1d"] ? seasonalityOf(state.candles["1d"]) : null
  };
  state.ext = ext;

  /* توقيت اللحظي: لا تُعاد كتابة توافقه ومستوياته إلا عند إغلاق شمعة
     ‎3m‎ جديدة — لا كل عشرين ثانية كبقية الأفق. وحين يغيب فريم ‎3m‎ (فشل
     شبكة مثلاً) يُعاد الحساب كل دورةٍ كالسابق بدل تجميد البطاقة أبداً. */
  var closed3 = closedCandles(state.candles["3m"], "3m");
  var lastClosedT = closed3 && closed3.length ? closed3[closed3.length - 1].t : null;
  var scalpFresh = lastClosedT === null ? true : lastClosedT !== state.scalpLastClosedT;

  var prevScalpRaw = state.stratRaw && state.stratRaw.scalp;
  var prevScalpCons = state.cons && state.cons.scalp;
  var prevScalpLevels = state.levels && state.levels.scalp;
  var prevScalpHC = state.scalpHC;

  state.stratRaw = {};
  state.levels = {};
  var prevBands = load("bands", {});
  HORIZONS.forEach(function (hz) {
    if (hz.id === "scalp" && !scalpFresh && prevScalpCons) {
      state.stratRaw.scalp = prevScalpRaw;
      state.cons.scalp = prevScalpCons;
      state.levels.scalp = prevScalpLevels;
      state.scalpHC = prevScalpHC;
      prevBands.scalp = prevScalpCons.band;
      return;
    }
    var lead = state.analysis[hz.lead];
    if (!lead) return;
    var x = { a: lead, all: state.analysis, tfs: hz.tfs, hz: hz.id, ext: ext };
    var res = runStrategies(x, hz.id);
    state.stratRaw[hz.id] = res;
    var cons = consensusOf(res, { hz: hz.id, edge: state.edge && state.edge.horizons,
                                  prevBand: prevBands[hz.id] });
    state.cons[hz.id] = cons;
    prevBands[hz.id] = cons.band;
    state.levels[hz.id] = levelsOf(cons, lead, hz);
    if (hz.id === "scalp") {
      state.scalpLastClosedT = lastClosedT;
      state.scalpHC = scalpHighConfidence(cons, lead, state.analysis, state.levels.scalp);
    }
  });
  save("bands", prevBands);

  state.regime = regimeOf(state.analysis["1d"]);
  var shown = state.cons[state.stratHz || "daily"];
  state.chartLevels = state.levels[state.stratHz || "daily"];

  renderVerdicts(); renderScalpHC(); renderChanges(); renderToday(); renderIndicators();
  renderLevels(); renderStrategies(); renderOnchain(); renderMacro();
  renderSources(); drawChart();
  checkAlerts(state.analysis["1h"].px);
}

/* ---------------------------------------------------------------------
   الدورات
   --------------------------------------------------------------------- */
function refreshCore() {
  if (busy) return Promise.resolve();
  busy = true;
  var btn = el("btnRefresh");
  if (btn) btn.innerHTML = '<span class="spin">⟳</span>';

  return Promise.all([fetchTicker()].concat(TFS.map(function (tf) {
      /* الفريمات السريعة لا تحتاج ألف شمعة للعرض، لكن المعايرة تحتاج.
         فتُجلب ألفٌ مرّةً عند الإقلاع، ثم ‎300‎ في التحديثات — والدمج
         يبقي التاريخ العميق في الذاكرة. */
      return fetchCandles(tf, state.deep ? 300 : 1000).catch(function () { return null; });
    })))
    .then(function (r) {
      state.ticker = r[0];
      TFS.forEach(function (tf, i) {
        var fresh = r[i + 1];
        if (!fresh || !fresh.length) return;
        var old = state.candles[tf];
        if (old && old.length && state.deep) {
          /* الدمج بالطابع الزمني: الشمعة الأخيرة في المحفوظ غالباً
             غيرُ مكتملة، فتُستبدل لا تُضاف. */
          var cut = fresh[0].t;
          state.candles[tf] = old.filter(function (c) { return c.t < cut; }).concat(fresh);
        } else state.candles[tf] = fresh;
      });
      state.deep = true;
      state.lastOk = Date.now();
      recompute();
      renderHeader();
      try {
        save("cache", { ticker: state.ticker, t: Date.now(),
          candles: { "1h": state.candles["1h"].slice(-200),
                     "4h": state.candles["4h"].slice(-200),
                     "1d": state.candles["1d"].slice(-300) } });
      } catch (e) {}
    })
    .catch(function () { renderHeader(); })
    .then(function () {
      if (btn) btn.textContent = "⟳";
      busy = false;
    });
}

function refreshDerivs() {
  var px = state.ticker ? +state.ticker.lastPrice : null;
  fetchDerivs(px).then(function (d) {
    state.derivs = d; renderDerivs(); renderHeader(); recompute();
  }).catch(function () {});
  fetchCross(px).then(function (c) { state.cross = c; renderMacro(); }).catch(function () {});
}

function refreshSlow() {
  fetchOnchain().then(function (o) {
    state.onchain = Object.assign(state.onchain || {}, o);
    if (Number.isFinite(o.height)) state.onchain.supply = supplyAt(o.height);
    if (state.candles["1d"]) state.onchain = cycleMetrics(state.candles["1d"], state.onchain);
    renderOnchain(); renderSources();
  }).catch(function () {});
  fetchGlobal().then(function (g) { state.global = g; renderMacro(); }).catch(function () {});
}

function refreshExtras() {
  fetchFng().then(function (f) { if (f) { state.fng = f; renderFng(); } }).catch(function () {});
  fetchNews().then(function (n) { if (n) { state.news = n; renderNews(); } }).catch(function () {});
  fetchMacro().then(function (m) { if (m) { state.macro = m; renderMacro(); } }).catch(function () {});
}

/* =====================================================================
   المعايرة — تُطلَق في الخلفية ولا تُعطّل شيئاً.

   تُحفظ نتيجتُها وتُعاد مرّةً كل ‎12‎ ساعة: الحافّة التاريخية لا تتغيّر
   في ساعة، وإعادةُ حسابها كل فتحةٍ إهدارٌ خالص. وحتى تصل، يعمل الموقع
   بأوزانٍ ‎1.0‎ ويقول ذلك صراحةً في جدول الاستراتيجيات.
   ===================================================================== */
function runCalibration(force) {
  var cached = load("edge", null);
  if (cached && !force && Date.now() - cached.at < 12 * 36e5) {
    state.edge = cached;
    recompute();
    return;
  }
  if (!window.Worker) return;
  if (!state.candles["1d"] || state.candles["1d"].length < 400) return;

  var note = el("calibState");
  if (note) note.textContent = "المعايرة تعمل…";
  try {
    var w = new Worker("js/backtest.worker.js");
    w.onmessage = function (e) {
      var d = e.data || {};
      if (d.ok && d.result) {
        state.edge = d.result;
        save("edge", d.result);
        recompute();
        if (note) note.textContent = "";
      } else if (note) {
        note.textContent = "تعذّرت المعايرة: " + (d.error || "سبب غير معروف");
      }
      w.terminate();
    };
    w.onerror = function () { if (note) note.textContent = ""; w.terminate(); };
    var payload = {};
    TFS.forEach(function (tf) { if (state.candles[tf]) payload[tf] = state.candles[tf]; });
    w.postMessage({ cmd: "calibrate", candles: payload });
  } catch (e) { if (note) note.textContent = ""; }
}

/* =====================================================================
   حاسبةُ المخاطرة.

   ما يميّزها عن الحاسبات الشائعة: تقارن **سعر التصفية بوقف الخسارة**
   وتحذّر حين تقع التصفية أولاً. وهي الحالة التي تُفني الحساب: متداولٌ
   يضع وقفاً عند ‎−3%‎ برافعة ‎50‎ ضعفاً، فتقع تصفيتُه عند ‎−2%‎ ولا يصل
   وقفُه أبداً.

   وحجمُ الصفقة يُشتقّ من المخاطرة لا من رأس المال: «كم أخسر إن أخطأت»
   هو السؤال الذي يحدّد الحجم، لا «كم أملك».
   ===================================================================== */
function calc() {
  var cap = +el("iCap").value, riskPct = +el("iRisk").value;
  var entry = +el("iEntry").value, stop = +el("iStop").value, lev = +el("iLev").value || 1;
  var out = el("calcOut");
  if (!(cap > 0 && riskPct > 0 && entry > 0 && stop > 0)) {
    out.innerHTML = muted("أدخل رأس المال ونسبة المخاطرة وسعر الدخول ووقف الخسارة.");
    return;
  }
  var isLong = side === "long";
  if (isLong && stop >= entry) { out.innerHTML = '<div class="warn high">في صفقة الشراء يجب أن يكون الوقف <b>تحت</b> سعر الدخول.</div>'; return; }
  if (!isLong && stop <= entry) { out.innerHTML = '<div class="warn high">في صفقة البيع يجب أن يكون الوقف <b>فوق</b> سعر الدخول.</div>'; return; }

  var riskAmt = cap * riskPct / 100;
  var stopDist = Math.abs(entry - stop);
  var stopPct = stopDist / entry * 100;
  var qty = riskAmt / stopDist;
  var notional = qty * entry;
  var margin = notional / lev;

  /* التصفية التقريبية: تجاهلُ رسوم التمويل والصيانة يجعلها متفائلة
     قليلاً — وتُعلَن تقريبيةً لأن كل منصّةٍ تحسبها بهامشِ صيانةٍ مختلف. */
  var liq = isLong ? entry * (1 - 1 / lev) : entry * (1 + 1 / lev);
  var liqFirst = isLong ? liq > stop : liq < stop;

  var a = state.analysis && state.analysis["4h"];
  var atrSuggest = a && a.ATR
    ? (isLong ? entry - a.ATR * 1.5 : entry + a.ATR * 1.5) : null;

  out.innerHTML =
    (liqFirst ? '<div class="warn high">⚠︎ <b>التصفية تقع قبل وقف الخسارة.</b> ' +
      'سعر التصفية ' + money(liq) + ' ووقفُك ' + money(stop) +
      ' — الرافعة ' + lev + '× عالية جداً لهذه المسافة. خفّضها إلى ' +
      Math.max(1, Math.floor(100 / stopPct * 0.7)) + '× أو أقلّ.</div>'
      : '<div class="warn ok">✓ وقف الخسارة يقع قبل التصفية — الترتيب سليم.</div>') +
    kv("المبلغ المعرَّض للخطر", money(riskAmt, 2)) +
    kv("مسافة الوقف", money(stopDist, 2) + " · " + fmt(stopPct, 2) + "%") +
    kv("حجم الصفقة", fmt(qty, 6) + " ‎BTC‎") +
    kv("القيمة الاسمية", money(notional, 2)) +
    kv("الهامش المطلوب", money(margin, 2)) +
    kv("سعر التصفية التقريبي", money(liq, 2), liqFirst ? "dn" : "") +
    (atrSuggest ? kv("وقفٌ مقترح (‎1.5×ATR‎ على 4 ساعات)", money(atrSuggest, 2)) : "") +
    '<div class="rmult"><h4>مضاعفات العائد</h4>' +
      [1, 2, 3].map(function (r) {
        var tgt = isLong ? entry + stopDist * r : entry - stopDist * r;
        return '<div class="kv"><span>' + r + 'R</span><b>' + money(tgt, 2) +
          '<small class="mut"> ربح ' + money(riskAmt * r, 0) + '</small></b></div>';
      }).join("") + '</div>' +
    '<p class="note">أرقامٌ تقريبية للتخطيط. التصفية تختلف بين المنصّات بحسب هامش الصيانة ورسوم التمويل، والانزلاق عند التقلّب العنيف قد يُنفّذ وقفَك أسوأ من سعره.</p>';
}

/* ---------------------------------------------------------------------
   التنبيهات — سعرية، وعلى انقلاب الإجماع.
   --------------------------------------------------------------------- */
function renderAlerts() {
  var l = load("alerts", []);
  setHTML("alerts", l.length
    ? l.map(function (a, i) {
        return '<div class="arow"><b>' + (a.kind === "flip"
          ? "انقلاب اتجاه " + (HZ[a.hz] ? HZ[a.hz].lbl : a.hz)
          : money(a.p) + " " + (a.dir === "above" ? "صعوداً ↑" : "هبوطاً ↓")) +
          '</b><button data-del="' + i + '">حذف</button></div>';
      }).join("")
    : muted("لا تنبيهات."));
  $$("#alerts button[data-del]").forEach(function (b) {
    b.onclick = function () {
      var l2 = load("alerts", []);
      l2.splice(+b.dataset.del, 1);
      save("alerts", l2); renderAlerts();
    };
  });
}

function notify(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body: body });
    }
  } catch (e) {}
  beep();
  var bar = el("alertBar");
  if (bar) {
    bar.textContent = "🔔 " + title + " — " + body;
    bar.classList.add("on");
    setTimeout(function () { bar.classList.remove("on"); }, 12000);
  }
}

function beep() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; o.type = "sine";
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch (e) {}
}

function checkAlerts(px) {
  var l = load("alerts", []);
  if (!l.length) return;
  var keep = [], fired = false;
  l.forEach(function (a) {
    if (a.kind === "flip") {
      var c = state.cons[a.hz];
      if (c && Number.isFinite(a.lastBand) && c.band !== a.lastBand) {
        notify("انقلاب اتجاه " + (HZ[a.hz] ? HZ[a.hz].lbl : a.hz),
               "من «" + BAND_LABEL[a.lastBand].t + "» إلى «" + BAND_LABEL[c.band].t + "»");
        fired = true;
      }
      if (c) a.lastBand = c.band;
      keep.push(a);
      return;
    }
    var hit = a.dir === "above" ? px >= a.p : px <= a.p;
    if (hit) {
      notify("تنبيه سعر", "البتكوين " + (a.dir === "above" ? "تجاوز" : "نزل تحت") + " " + money(a.p));
      fired = true;
    } else keep.push(a);
  });
  save("alerts", keep);
  if (fired) renderAlerts();
}

/* ---------------------------------------------------------------------
   الإقلاع
   --------------------------------------------------------------------- */
function boot() {
  /* عرضٌ فوري من آخر نسخةٍ محفوظة — الصفحة لا تبدأ فارغة. */
  var c = load("cache", null);
  if (c && Date.now() - c.t < 6 * 36e5) {
    state.ticker = c.ticker;
    Object.keys(c.candles || {}).forEach(function (tf) { state.candles[tf] = c.candles[tf]; });
    try { renderHeader(); recompute(); } catch (e) {}
  }

  /* التبويبات */
  $$("#tabbar button").forEach(function (b) {
    b.onclick = function () {
      $$("#tabbar button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      $$("section[data-view]").forEach(function (s) {
        s.classList.toggle("on", s.dataset.view === b.dataset.go);
      });
      window.scrollTo({ top: 0, behavior: "instant" });
      if (b.dataset.go === "tech") setTimeout(drawChart, 60);
    };
  });

  /* اختيار الفريم */
  $$("#tfPicker button").forEach(function (b) {
    b.onclick = function () {
      $$("#tfPicker button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      state.activeTF = b.dataset.tf;
      drawChart(); renderIndicators(); renderLevels();
    };
  });

  /* اختيار الأفق في تبويب الاستراتيجيات */
  $$("#hzPicker button").forEach(function (b) {
    b.onclick = function () {
      $$("#hzPicker button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      state.stratHz = b.dataset.hz;
      state.chartLevels = state.levels && state.levels[state.stratHz];
      renderStrategies(); drawChart();
    };
  });

  /* طبقات الشارت */
  $$("#layerPicker button").forEach(function (b) {
    b.onclick = function () {
      var k = b.dataset.layer;
      CHART.layers[k] = !CHART.layers[k];
      b.classList.toggle("on", CHART.layers[k]);
      drawChart();
    };
  });

  $$("#sideSeg button").forEach(function (b) {
    b.onclick = function () {
      $$("#sideSeg button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      side = b.dataset.side;
      if (el("iEntry").value) calc();
    };
  });

  el("btnCalc").onclick = calc;
  el("btnRefresh").onclick = function () { refreshCore(); refreshDerivs(); refreshExtras(); refreshSlow(); };
  el("btnRecalib").onclick = function () { runCalibration(true); };

  el("btnAddAlert").onclick = function () {
    var p = +el("aPrice").value;
    if (!(p > 0)) return alert("أدخل سعراً صحيحاً");
    var l = load("alerts", []);
    l.push({ p: p, dir: el("aDir").value });
    save("alerts", l);
    el("aPrice").value = "";
    renderAlerts();
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  };
  el("btnAddFlip").onclick = function () {
    var hz = el("aHz").value;
    var l = load("alerts", []);
    if (l.some(function (a) { return a.kind === "flip" && a.hz === hz; })) return;
    l.push({ kind: "flip", hz: hz, lastBand: state.cons[hz] ? state.cons[hz].band : null });
    save("alerts", l);
    renderAlerts();
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  };

  renderAlerts();

  window.addEventListener("resize", function () {
    clearTimeout(window._rz);
    window._rz = setTimeout(drawChart, 150);
  });

  /* الدورات — وتُوقَف عند إخفاء التبويب. */
  function startTimers() {
    stopTimers();
    timers.push(setInterval(refreshCore, 20000));
    timers.push(setInterval(refreshDerivs, 120000));
    timers.push(setInterval(refreshSlow, 600000));
    timers.push(setInterval(refreshExtras, 900000));
    timers.push(setInterval(renderHeader, 10000));
  }
  function stopTimers() { timers.forEach(clearInterval); timers = []; }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopTimers();
    else {
      startTimers();
      if (Date.now() - state.lastOk > 30000) { refreshCore(); refreshDerivs(); }
    }
  });

  refreshCore().then(function () {
    if (state.ticker && !el("iEntry").value) el("iEntry").value = Math.round(+state.ticker.lastPrice);
    runCalibration(false);
  });
  refreshDerivs();
  refreshExtras();
  refreshSlow();
  startTimers();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
}

boot();
