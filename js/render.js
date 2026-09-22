/* =====================================================================
   العرض — من الحالة إلى DOM.

   قاعدةٌ واحدة تحكم كل دالّةٍ هنا: **الغياب يُعلَن ولا يُزوَّر**. حقلٌ
   لا نعرفه يُكتب «—» ومعه سببُه إن وُجد، ولا يُملأ بصفرٍ ولا يُخفى
   الصفُّ كأنه غير موجود. فالقارئ يتّخذ قراراً، وفرقُ «صفر» عن «لا
   أعرف» هو فرقُ القرار الصحيح عن الخاطئ.
   ===================================================================== */

function el(id) { return document.getElementById(id); }
function setHTML(id, html) { var e = el(id); if (e) e.innerHTML = html; }

/* ---------------------------------------------------------------------
   الترويسة
   --------------------------------------------------------------------- */
function renderHeader() {
  var t = state.ticker;
  if (!t) return;
  var px = +t.lastPrice, chg = +t.priceChangePercent;
  setHTML("hPrice", money(px, 0));
  var e = el("hChg");
  if (e) {
    e.textContent = pct(chg);
    e.style.color = chg >= 0 ? "var(--up)" : "var(--dn)";
  }
  var d = state.derivs;
  setHTML("hFund", d && Number.isFinite(d.funding)
    ? '<b style="color:' + (d.funding >= 0 ? "var(--up)" : "var(--dn)") + '">' +
      fmt(d.funding * 100, 4) + "%</b>" : "—");
  setHTML("hFundNext", d && d.nextFunding ? until(d.nextFunding) : "—");

  /* نقطة الطزاجة: خضراء دون دقيقة، صفراء دون خمس، حمراء بعدها. ولا
     تُقرأ من آخر محاولةٍ بل من آخر **نجاح** — فمحاولةٌ فاشلة كل ثانية
     لا تجعل البيانات طازجة. */
  var age = state.lastOk ? (Date.now() - state.lastOk) / 1000 : 1e9;
  var dot = el("hDot");
  if (dot) {
    dot.style.background = age < 60 ? "var(--up)" : age < 300 ? "var(--neu)" : "var(--dn)";
    dot.title = state.lastOk ? "آخر تحديث ناجح " + ago(state.lastOk) : "لم يكتمل تحديثٌ بعد";
  }
  setHTML("hStamp", state.lastOk ? ago(state.lastOk) : "جارٍ التحميل…");
}

/* =====================================================================
   بطاقاتُ القرار — الشاشة الأولى، وهي جوهر الموقع.

   ترتيبُ العناصر داخل البطاقة مقصود: الاتجاه ثم الثقة ثم **مستوى
   الإبطال** قبل الأهداف. لأن السؤال الذي يُنقذ المال ليس «إلى أين
   يصعد؟» بل «متى أعرف أنني كنت مخطئاً؟» — وعرضُ الهدف قبل الإبطال
   يقلب الأولوية.
   ===================================================================== */
function verdictCard(hz, cons, lv) {
  var b = BAND_LABEL[cons.band];
  var confCls = cons.conf === "high" ? "ok" : cons.conf === "med" ? "mid" : "low";
  var mixed = cons.k === "mixed";

  var top = cons.items.filter(function (x) { return x.dir === cons.dir; }).slice(0, 3);
  var against = cons.items.filter(function (x) { return x.dir === -cons.dir; }).slice(0, 3);

  var gaugePct = Math.round((cons.score + 100) / 2);

  return '' +
  '<div class="vcard" data-dir="' + (mixed ? 0 : cons.dir) + '">' +
    '<div class="vhead">' +
      '<div class="vtitle"><span class="vicon">' + hz.icon + '</span>' +
        '<div><b>' + hz.lbl + '</b><small>' + hz.span + '</small></div></div>' +
      '<div class="vdir" style="color:' + (mixed ? "var(--neu)" : b.c) + '">' +
        (mixed ? "◆" : b.arrow) + '</div>' +
    '</div>' +

    '<div class="vlabel" style="color:' + (mixed ? "var(--neu)" : b.c) + '">' +
      (mixed ? "متعارض — لا اتجاه واضح" : b.t) + '</div>' +

    '<div class="gauge"><div class="gfill" style="width:' + gaugePct + '%"></div>' +
      '<div class="gmid"></div></div>' +
    '<div class="grow"><span>هبوط</span><b>' + (cons.score > 0 ? "+" : "") + cons.score +
      '</b><span>صعود</span></div>' +

    '<div class="vstats">' +
      '<div><small>الثقة</small><b class="' + confCls + '">' + (cons.confT || "—") + '</b></div>' +
      '<div><small>الإجماع</small><b>' + Math.round((cons.agree || 0) * 100) + '%</b></div>' +
      '<div><small>مفعَّلة</small><b>' + cons.n + '<small class="mut">/' +
        (cons.n + cons.nQuiet + cons.nOff) + '</small></b></div>' +
      '<div><small>مُعايَرة</small><b>' + cons.measured + '</b></div>' +
    '</div>' +

    '<div class="vwhy">' + (cons.why || "") + '</div>' +

    (lv && !mixed ? '<div class="vlevels">' +
      '<div class="lvrow inv"><span>مستوى الإبطال</span>' +
        '<b>' + money(lv.inv) + '</b>' +
        '<small>' + fmt(lv.invPct, 1) + '% · ' + lv.invSrc + '</small></div>' +
      '<div class="lvrow"><span>نطاق الهدف</span>' +
        '<b>' + money(lv.t1) + ' – ' + money(lv.t2) + '</b>' +
        '<small>' + (lv.t1Src ? lv.t1Src + (lv.t2Src && lv.t2Src !== lv.t1Src ? " ↔ " + lv.t2Src : "") + " · " : "") +
        (lv.rr ? "عائد/مخاطرة ‎" + fmt(lv.rr, 1) : "") + '</small></div>' +
      (lv.warn ? '<div class="warn high" style="margin-top:6px">⚠︎ ' + lv.warn + '</div>' : '') +
    '</div>' : '') +

    (top.length ? '<div class="vreasons"><h4>يدعم الاتجاه</h4>' +
      top.map(function (x) {
        return '<div class="rrow"><i class="dot up"></i><span>' + x.lbl + '</span>' +
          '<em>' + x.sc + '</em></div>';
      }).join("") + '</div>' : '') +

    (against.length ? '<div class="vreasons against"><h4>يعارضه</h4>' +
      against.map(function (x) {
        return '<div class="rrow"><i class="dot dn"></i><span>' + x.lbl + '</span>' +
          '<em>' + x.sc + '</em></div>';
      }).join("") + '</div>' : '') +
  '</div>';
}

function renderVerdicts() {
  var host = el("verdicts");
  if (!host) return;
  var html = "";
  HORIZONS.forEach(function (hz) {
    var c = state.cons[hz.id];
    if (!c) { html += '<div class="vcard skel">' + hz.icon + " " + hz.lbl + " — جارٍ الحساب…</div>"; return; }
    html += verdictCard(hz, c, state.levels && state.levels[hz.id]);
  });
  host.innerHTML = html;

  /* تحذيرُ التعارض بين الآفاق */
  var cf = horizonConflict(state.cons);
  setHTML("conflicts", cf.length
    ? cf.map(function (c) {
        return '<div class="warn ' + c.level + '">⚠︎ ' + c.txt + '</div>';
      }).join("")
    : '<div class="warn ok">✓ الآفاق الثلاثة متّسقة — لا تعارض بين المدى القصير والطويل.</div>');
}

/* =====================================================================
   بطاقة اللحظي عالية الثقة — تحت بطاقات القرار مباشرةً.

   لا توصية تُفبرك: حين لا تكتمل الشروط تُعرض رسالةُ السبب صراحةً بدل
   بطاقةٍ فارغة أو مضلِّلة. وحين تكتمل، تُعرض التوصية مع مصدر كل رقمٍ
   وتنويهٍ صريح أنها «عالية الثقة» لا «مضمونة».
   ===================================================================== */
function renderScalpHC() {
  var host = el("scalpHC");
  if (!host) return;
  var hc = state.scalpHC;
  if (!hc) { host.innerHTML = ""; return; }

  if (!hc.pass) {
    host.innerHTML = '<div class="vcard hc-off">' +
      '<b>⚡ توصية اللحظي عالية الثقة</b>' +
      '<p class="note" style="margin:6px 0 0">لا توصية حالياً — ' + hc.reason + '</p>' +
    '</div>';
    return;
  }

  var up = hc.dir > 0;
  host.innerHTML =
    '<div class="vcard hc-on" data-dir="' + hc.dir + '">' +
      '<div class="vhead"><b>⚡ توصية اللحظي عالية الثقة</b>' +
        '<span style="color:' + (up ? "var(--up)" : "var(--dn)") + '">' + (up ? "شراء ▲" : "بيع ▼") + '</span></div>' +
      '<div class="vlevels">' +
        '<div class="lvrow"><span>الدخول (آخر إغلاقٍ مؤكَّد)</span><b>' + money(hc.entry) + '</b></div>' +
        '<div class="lvrow inv"><span>مستوى الإبطال</span><b>' + money(hc.inv) + '</b>' +
          '<small>' + fmt(hc.invPct, 1) + '% · ' + hc.invSrc + '</small></div>' +
        '<div class="lvrow"><span>نطاق الهدف</span><b>' + money(hc.t1) + ' – ' + money(hc.t2) + '</b>' +
          '<small>' + hc.t1Src + (hc.t2Src && hc.t2Src !== hc.t1Src ? " ↔ " + hc.t2Src : "") + '</small></div>' +
        (hc.warn ? '<div class="warn high" style="margin-top:6px">⚠︎ ' + hc.warn + '</div>' : '') +
      '</div>' +
      '<div class="vreasons"><h4>مبنيّةٌ على</h4>' +
        hc.rationale.map(function (r) { return '<div class="rrow"><i class="dot ' + (up ? "up" : "dn") + '"></i><span>' + r + '</span></div>'; }).join("") +
      '</div>' +
      '<p class="note">توصيةٌ عالية الثقة بناءً على تصفيةٍ صارمة — وليست ضماناً مطلقاً. راقب مستوى الإبطال.</p>' +
    '</div>';
}

/* ---------------------------------------------------------------------
   «ما الذي تغيّر؟» — مقارنةٌ بآخر زيارة.

   لماذا تستحقّ بطاقةً: من يفتح الموقع مرّتين في اليوم لا يريد أن يقرأ
   كل شيءٍ من جديد، بل أن يعرف ما استجدّ. وبلا هذه البطاقة يصير عليه
   أن يحفظ الأرقام في رأسه ليقارن — وهو ما لا يفعله أحد.
   --------------------------------------------------------------------- */
function renderChanges() {
  var prev = load("lastSnap", null);
  var now = {};
  HORIZONS.forEach(function (h) {
    var c = state.cons[h.id];
    if (c) now[h.id] = { band: c.band, dir: c.dir, score: c.score };
  });
  var px = state.ticker ? +state.ticker.lastPrice : null;

  var rows = [];
  if (prev && prev.cons) {
    HORIZONS.forEach(function (h) {
      var a = prev.cons[h.id], b = now[h.id];
      if (!a || !b) return;
      if (a.band !== b.band) {
        rows.push('<div class="chg"><b>' + h.icon + " " + h.lbl + '</b> تحوّل من «' +
          BAND_LABEL[a.band].t + '» إلى «<span style="color:' + BAND_LABEL[b.band].c + '">' +
          BAND_LABEL[b.band].t + '</span>»</div>');
      } else if (Math.abs(a.score - b.score) >= 15) {
        rows.push('<div class="chg"><b>' + h.icon + " " + h.lbl + '</b> النتيجة ' +
          (b.score > a.score ? "ارتفعت" : "انخفضت") + " من " + a.score + " إلى " + b.score + '</div>');
      }
    });
    if (px && prev.px) {
      var d = (px - prev.px) / prev.px * 100;
      if (Math.abs(d) >= 0.8) {
        rows.push('<div class="chg"><b>السعر</b> ' + pct(d) + " منذ زيارتك (" +
          ago(prev.t) + ")</div>");
      }
    }
  }
  setHTML("changes", rows.length
    ? rows.join("")
    : '<div class="chg mut">لا تغيّر جوهري منذ آخر زيارة' +
      (prev ? " (" + ago(prev.t) + ")" : "") + ".</div>");

  /* تُحفظ اللقطة كل ‎20‎ دقيقة فقط: حفظُها كل تحديثٍ يجعل «منذ آخر
     زيارة» تعني «منذ ثلاثين ثانية» فتفقد البطاقة معناها. */
  if (!prev || Date.now() - prev.t > 20 * 6e4) {
    save("lastSnap", { cons: now, px: px, t: Date.now() });
  }
}

/* ---------------------------------------------------------------------
   أرقام اليوم + المشتقّات + المشاعر
   --------------------------------------------------------------------- */
function renderToday() {
  var t = state.ticker;
  if (!t) return;
  var d1 = state.analysis && state.analysis["1d"];
  setHTML("today",
    kv("الافتتاح", money(+t.openPrice)) +
    kv("أعلى 24س", money(+t.highPrice)) +
    kv("أدنى 24س", money(+t.lowPrice)) +
    kv("المدى", money(+t.highPrice - +t.lowPrice) + " · " +
       fmt((+t.highPrice - +t.lowPrice) / +t.lastPrice * 100, 2) + "%") +
    kv("حجم 24س", "$" + compact(+t.quoteVolume)) +
    kv("الصفقات", compact(+t.count)) +
    (d1 && d1.atrPct !== null ? kv("التذبذب اليومي (ATR)", fmt(d1.atrPct, 2) + "%") : "") +
    (state.cross && state.cross.range
      ? kv("مدى المنصّات", money(state.cross.range.lo) + " – " + money(state.cross.range.hi)) : "")
  );
}

function kv(k, v, cls) {
  return '<div class="kv"><span>' + k + '</span><b class="' + (cls || "") + '">' + v + '</b></div>';
}

function renderDerivs() {
  var d = state.derivs;
  if (!d) { setHTML("derivs", muted("تعذّر جلب بيانات العقود")); return; }
  var fCol = d.funding >= 0 ? "var(--up)" : "var(--dn)";
  var zTxt = Number.isFinite(d.fundingZ)
    ? (Math.abs(d.fundingZ) > 1.6 ? "<b style='color:var(--neu)'>متطرّف</b>" : "ضمن المعتاد") +
      " · انحراف " + fmt(d.fundingZ, 2)
    : "—";
  setHTML("derivs",
    '<div class="kv"><span>رسوم التمويل</span><b style="color:' + fCol + '">' +
      fmt(d.funding * 100, 4) + "%</b></div>" +
    kv("سنوياً (تقريباً)", Number.isFinite(d.fundingAnnual) ? pct(d.fundingAnnual, 1) : "—") +
    kv("موقع التمويل تاريخياً", zTxt) +
    kv("التمويل القادم", d.nextFunding ? until(d.nextFunding) : "—") +
    kv("العقود المفتوحة", d.oi ? "$" + compact(d.oi) : "—") +
    kv("تغيّرها (24س)", Number.isFinite(d.oiChg) ? pct(d.oiChg, 1) : "—") +
    kv("موقعها تاريخياً", Number.isFinite(d.oiRank) ? fmt(d.oiRank, 0) + "%" : "—") +
    kv("نسبة الشراء/البيع", Number.isFinite(d.ls) ? fmt(d.ls, 2) : "—") +
    kv("حسابات الشراء", Number.isFinite(d.longPct) ? fmt(d.longPct, 1) + "%" : "—") +
    kv("فارق العقد عن السبوت", Number.isFinite(d.basisPct) ? pct(d.basisPct, 3) : "—") +
    '<p class="note">تمويلٌ موجبٌ مرتفع يعني ازدحام الشراء بالرافعة — وقودُ تصفيةٍ عند أول هبوط، لا دليلَ قوّة.</p>'
  );
}

function renderFng() {
  var f = state.fng;
  if (!f || !f.length) { setHTML("fng", muted("تعذّر جلب مؤشّر المشاعر")); return; }
  var v = f[0].v;
  var col = v <= 25 ? "#d32f2f" : v <= 45 ? "#fb8c00" : v <= 55 ? "#f5b912"
          : v <= 75 ? "#7cb342" : "#00d19b";
  var AR = { "Extreme Fear": "خوفٌ شديد", "Fear": "خوف", "Neutral": "محايد",
             "Greed": "طمع", "Extreme Greed": "طمعٌ شديد" };
  var spark = f.slice(0, 14).reverse().map(function (x) {
    return '<i style="height:' + Math.max(8, x.v) + '%;background:' +
      (x.v <= 25 ? "#d32f2f" : x.v <= 45 ? "#fb8c00" : x.v <= 55 ? "#f5b912"
       : x.v <= 75 ? "#7cb342" : "#00d19b") + '" title="' + x.v + '"></i>';
  }).join("");
  setHTML("fng",
    '<div class="fngBig" style="color:' + col + '">' + v +
      '<small>' + (AR[f[0].cls] || f[0].cls) + '</small></div>' +
    '<div class="spark">' + spark + '</div>' +
    '<div class="sparkLbl"><span>قبل أسبوعين</span><span>اليوم</span></div>' +
    '<p class="note">إشارةٌ عكسية عند الحوافّ وحدها: الخوف الشديد تاريخياً منطقةُ تجميع، والطمع الشديد منطقةُ حذر. وما بين ‎30‎ و‎70‎ بلا دلالة.</p>'
  );
}

/* ---------------------------------------------------------------------
   جدول الاستراتيجيات — مع مصداقيتها المقيسة
   --------------------------------------------------------------------- */
function renderStrategies() {
  var hzId = state.stratHz || "daily";
  var cons = state.cons[hzId];
  var host = el("strategies");
  if (!host) return;
  if (!cons) { host.innerHTML = muted("جارٍ الحساب…"); return; }

  var res = state.stratRaw && state.stratRaw[hzId] || [];
  var byId = {};
  cons.items.forEach(function (x) { byId[x.id] = x; });

  var rows = res.map(function (r) {
    var it = byId[r.id];
    var edge = state.edge && state.edge.horizons && state.edge.horizons[hzId] &&
               state.edge.horizons[hzId][r.id];
    var sig = r.off ? '<em class="off">متعذّرة</em>'
      : !r.active ? '<em class="quiet">لم تتفعّل</em>'
      : '<em class="' + (r.dir > 0 ? "up" : "dn") + '">' +
        (r.dir > 0 ? "▲ صعود" : "▼ هبوط") + '</em>';
    var hit = edge && Number.isFinite(edge.hit)
      ? '<b>' + Math.round(edge.hit * 100) + '%</b><small class="mut"> على ' + edge.n + '</small>'
      : '<small class="mut">لم تُقَس</small>';
    var w = it ? fmt(it.w, 2) : "—";
    return '<tr class="' + (r.active ? "on" : "") + '">' +
      '<td><b>' + r.lbl + '</b><small>' + (FAM_LABEL[r.fam] || r.fam) + '</small>' +
        '<p class="sdesc">' + (r.desc || "") + '</p></td>' +
      '<td class="c">' + sig + '</td>' +
      '<td class="c">' + (r.active ? r.sc : "—") + '</td>' +
      '<td class="c">' + hit + '</td>' +
      '<td class="c">' + w + '</td>' +
      '</tr>';
  });

  var meas = cons.measured, tot = cons.n;
  host.innerHTML =
    '<div class="calibNote">' +
      (state.edge
        ? '✓ مُعايَرة على تاريخ البتكوين — آخر معايرة ' + ago(state.edge.at) +
          '. ‎' + meas + '‎ من ‎' + tot + '‎ استراتيجيةٍ مفعَّلة لها حافّةٌ مقيسة.'
        : '⏳ المعايرة تعمل في الخلفية… الأوزان مؤقّتاً ‎1.0‎ للجميع.') +
      '<p>استراتيجياتُ التمويل والأونتشين والماكرو والأخبار لا تُعاير: المصادر المجانية لا تعطي تاريخَ تلك البيانات بعمقٍ كافٍ. فتبقى أوزانُها ‎1.0‎ وتُوسم «لم تُقَس» — وإعلانُ ذلك أصدقُ من وزنٍ مخترَع يُقدَّم كأنه مقيس.</p>' +
    '</div>' +
    '<div class="tblWrap"><table class="stbl"><thead><tr>' +
      '<th>الاستراتيجية</th><th class="c">الإشارة</th><th class="c">القناعة</th>' +
      '<th class="c">نسبة النجاح</th><th class="c">الوزن</th>' +
    '</tr></thead><tbody>' + rows.join("") + '</tbody></table></div>';
}

/* ---------------------------------------------------------------------
   قراءاتُ المؤشّرات للفريم المختار
   --------------------------------------------------------------------- */
function renderIndicators() {
  var a = state.analysis && state.analysis[state.activeTF];
  if (!a) { setHTML("indicators", muted("جارٍ التحميل…")); return; }
  var px = a.px;

  function sideOf(cond) { return cond ? "up" : "dn"; }
  var rows = [
    ["السعر مقابل EMA 20", a.E20 === null ? "—" : money(a.E20), a.px > a.E20],
    ["السعر مقابل EMA 50", a.E50 === null ? "—" : money(a.E50), a.px > a.E50],
    ["السعر مقابل EMA 200", a.E200 === null ? "—" : money(a.E200), a.px > a.E200],
    ["RSI (14)", a.RSI === null ? "—" : fmt(a.RSI, 1) +
      (a.RSI > 70 ? " · تشبّع شراء" : a.RSI < 30 ? " · تشبّع بيع" : ""), a.RSI > 50],
    ["ماكد", a.HIST === null ? "—" : fmt(a.HIST, 1) +
      (a.HIST > a.HISTp ? " ↑" : " ↓"), a.HIST > 0],
    ["ADX — قوّة الاتجاه", a.ADX === null ? "—" : fmt(a.ADX, 1) +
      (a.ADX >= 25 ? " · اتجاهٌ قائم" : " · سوقٌ عرضي"), a.ADX >= 25],
    ["سوبرترند", a.STdir === null ? "—" : (a.STdir > 0 ? "صاعد" : "هابط") +
      " عند " + money(a.STline), a.STdir > 0],
    ["ستوكاستك RSI", a.SRSIK === null ? "—" : fmt(a.SRSIK, 0), a.SRSIK > 50],
    ["MFI — تدفّق الأموال", a.MFI === null ? "—" : fmt(a.MFI, 0), a.MFI > 50],
    ["موقع بولنجر (%B)", a.PCTB === null ? "—" : fmt(a.PCTB * 100, 0) + "%", a.PCTB > 0.5],
    ["عرض بولنجر", a.BBW === null ? "—" : fmt(a.BBW, 2) + "%" +
      (a.SQZ ? " · انضغاط" : ""), !a.SQZ],
    ["ATR — التذبذب", a.ATR === null ? "—" : money(a.ATR) +
      " (" + fmt(a.atrPct, 2) + "%)", true],
    ["VWAP اليومي", a.VWAPD === null ? "—" : money(a.VWAPD), a.px > a.VWAPD],
    ["إيتشيموكو", a.SPANA === null ? "—" :
      (px > Math.max(a.SPANA, a.SPANB) ? "فوق السحابة"
       : px < Math.min(a.SPANA, a.SPANB) ? "تحت السحابة" : "داخل السحابة"),
      a.SPANA !== null && px > Math.max(a.SPANA, a.SPANB)],
    ["دلتا المشتري", a.CVD === null ? "—" :
      (a.CVD > a.CVDp ? "شراءٌ مبادر" : "بيعٌ مبادر"), a.CVD > a.CVDp],
    ["هيكل السوق", a.ms ? a.ms.label : "—", a.ms && a.ms.trend > 0]
  ];

  var divs = [].concat(
    (a.divRsi || []).map(function (d) { return ["RSI", d]; }),
    (a.divMacd || []).map(function (d) { return ["ماكد", d]; }),
    (a.divObv || []).map(function (d) { return ["OBV", d]; })
  );

  setHTML("indicators",
    rows.map(function (r) {
      return '<div class="kv"><span>' + r[0] + '</span><b class="' +
        (r[2] ? "up" : "dn") + '">' + r[1] + "</b></div>";
    }).join("") +
    (a.pattern ? '<div class="kv"><span>نمطُ الشمعة</span><b class="' +
      (a.pattern.dir > 0 ? "up" : a.pattern.dir < 0 ? "dn" : "") + '">' +
      a.pattern.name + "</b></div>" : "") +
    (divs.length ? '<div class="divs"><h4>تباعدات مرصودة</h4>' +
      divs.map(function (d) {
        return '<div class="drow ' + (d[1].dir > 0 ? "up" : "dn") + '">' +
          "<b>" + d[0] + "</b> — " + (d[1].kind === "regular" ? "تباعدٌ عادي" : "تباعدٌ مخفيّ") +
          " " + (d[1].dir > 0 ? "صاعد" : "هابط") + '<small>' + d[1].note + "</small></div>";
      }).join("") + "</div>" : "")
  );
}

/* ---------------------------------------------------------------------
   المستويات
   --------------------------------------------------------------------- */
function renderLevels() {
  var a = state.analysis && state.analysis[state.activeTF];
  var d1 = state.analysis && state.analysis["1d"];
  if (!a) { setHTML("levels", muted("جارٍ التحميل…")); return; }
  var px = a.px, out = [];

  function lvl(name, v, tag) {
    if (!Number.isFinite(v)) return;
    out.push({ name: name, v: v, d: (v - px) / px * 100, tag: tag });
  }
  if (a.vp) {
    lvl("نقطة التحكّم POC", a.vp.poc, "حجم");
    lvl("أعلى منطقة القيمة", a.vp.vah, "حجم");
    lvl("أدنى منطقة القيمة", a.vp.val, "حجم");
  }
  if (d1 && d1.n > 2) {
    var p = d1.n - 2;
    lvl("قمّة أمس", d1.h[p], "يومي");
    lvl("قاع أمس", d1.l[p], "يومي");
    var pv = pivotLevels(d1.h[p], d1.l[p], d1.c[p], "classic");
    lvl("المحور", pv.p, "محور");
    lvl("مقاومة 1", pv.r1, "محور");
    lvl("دعم 1", pv.s1, "محور");
  }
  if (a.fib) {
    lvl("فيبو 0.618", a.fib.levels["r0.618"], "فيبو");
    lvl("فيبو 0.5", a.fib.levels["r0.5"], "فيبو");
  }
  if (a.E200 !== null) lvl("متوسّط 200", a.E200, "متوسّط");
  if (a.VWAPD !== null) lvl("VWAP اليومي", a.VWAPD, "تكلفة");
  if (a.ms) { lvl("آخر قمّة محورية", a.ms.lastHigh, "هيكل"); lvl("آخر قاع محوري", a.ms.lastLow, "هيكل"); }

  out.sort(function (x, y) { return y.v - x.v; });
  var html = out.map(function (o) {
    var near = Math.abs(o.d) < 0.6;
    return '<div class="lvl ' + (o.v > px ? "above" : "below") + (near ? " near" : "") + '">' +
      '<b>' + money(o.v) + '</b><span>' + o.name + '</span>' +
      '<em class="tag">' + o.tag + '</em>' +
      '<i>' + pct(o.d, 2) + '</i></div>';
  }).join("");

  setHTML("levels", '<div class="pxNow">السعر الآن <b>' + money(px) + '</b></div>' + html +
    '<p class="note">المستويات مرتّبة من الأعلى للأدنى. المظلَّل قريبٌ من السعر (أقلّ من ‎0.6%‎).</p>');
}

/* ---------------------------------------------------------------------
   الأونتشين
   --------------------------------------------------------------------- */
function renderOnchain() {
  var o = state.onchain;
  if (!o) { setHTML("onchain", muted("تعذّر جلب بيانات الشبكة")); return; }

  function band(v, lo, hi, invert) {
    if (!Number.isFinite(v)) return "";
    var bad = invert ? v < lo : v > hi;
    var good = invert ? v > hi : v < lo;
    return good ? "up" : bad ? "dn" : "";
  }

  setHTML("onchain",
    '<h3 class="sub">صحّةُ الشبكة</h3>' +
    kv("قوّة التعدين", Number.isFinite(o.hashrate) ? compact(o.hashrate / 1e18) + " EH/s" : "—") +
    kv("نموّها (30 يوم)", Number.isFinite(o.hashGrowth) ? pct(o.hashGrowth, 1) : "—",
       o.hashGrowth > 0 ? "up" : "dn") +
    kv("شرائط الهاش", Number.isFinite(o.hashRibbon)
       ? (o.hashRibbon > 0 ? "تعافٍ — إيجابي" : "استسلامُ معدّنين")
       : "—", o.hashRibbon > 0 ? "up" : "dn") +
    kv("ارتفاع الكتلة", Number.isFinite(o.height) ? o.height.toLocaleString("en-US") : "—") +
    kv("تعديل الصعوبة القادم", Number.isFinite(o.diffEst) ? pct(o.diffEst, 2) : "—",
       o.diffEst > 0 ? "up" : "dn") +
    kv("بعد", Number.isFinite(o.diffBlocks) ? o.diffBlocks + " كتلة · " + until(o.diffDate) : "—") +
    kv("متوسّط زمن الكتلة", Number.isFinite(o.blockTimeAvg) ? fmt(o.blockTimeAvg / 60, 1) + " دقيقة" : "—") +
    kv("رسوم سريعة", Number.isFinite(o.feeFast) ? o.feeFast + " ساتوشي/بايت" : "—") +
    kv("معاملاتٌ منتظرة", Number.isFinite(o.mempoolCount) ? compact(o.mempoolCount) : "—") +

    '<h3 class="sub">دورةُ التنصيف</h3>' +
    kv("مكافأة الكتلة", Number.isFinite(o.subsidy) ? fmt(o.subsidy, 4) + " ‎BTC‎" : "—") +
    kv("منذ آخر تنصيف", Number.isFinite(o.monthsSinceHalving) ? fmt(o.monthsSinceHalving, 1) + " شهر" : "—") +
    kv("التنصيف القادم", Number.isFinite(o.blocksToHalving)
       ? compact(o.blocksToHalving) + " كتلة · " + until(o.halvingDate) : "—") +
    kv("المعروض المتداول", Number.isFinite(o.supply) ? compact(o.supply) + " ‎BTC‎" : "—") +

    '<h3 class="sub">مقاييسُ الدورة</h3>' +
    kv("مضاعف ماير", Number.isFinite(o.mayer) ? fmt(o.mayer, 2) : "—", band(o.mayer, 0.9, 2.2)) +
    kv("متوسّط 200 يوم", Number.isFinite(o.ma200d) ? money(o.ma200d) : "—") +
    kv("بي سايكل (قربُ القمّة)", Number.isFinite(o.piRatio) ? fmt(o.piRatio * 100, 0) + "%" : "—",
       band(o.piRatio, 0.6, 0.95)) +
    kv("مضاعف بويل", Number.isFinite(o.puell) ? fmt(o.puell, 2) : "—", band(o.puell, 0.7, 3.0)) +
    kv("متوسّط السنتين", Number.isFinite(o.twoYr) ? fmt(o.twoYr, 2) + "×" : "—", band(o.twoYr, 1.0, 3.5)) +
    kv("NVT (موقعه تاريخياً)", Number.isFinite(o.nvtRank) ? fmt(o.nvtRank, 0) + "%" : "—",
       band(o.nvtRank, 25, 85)) +
    (Number.isFinite(o.rainbow)
      ? '<div class="kv"><span>قوسُ قزح</span><b style="color:' + o.rainbowC + '">' +
        o.rainbowT + "</b></div>" : "") +
    (Number.isFinite(o.rainbowMid) ? kv("القيمة العادلة على المنحنى", money(o.rainbowMid)) : "") +
    '<p class="note">هذه مقاييسُ دورةٍ مداها شهورٌ وسنوات — تُقرأ في الأفق الأسبوعي وحده، ولا تقول شيئاً عن الساعات القادمة. ومضاعفُ ماير تحت ‎0.8‎ وبويل تحت ‎0.5‎ وقعا تاريخياً عند قيعانٍ كبرى، لكنّ أربع دوراتٍ ليست عيّنةً تُبنى عليها يقينيات.</p>'
  );
}

/* ---------------------------------------------------------------------
   السوق والماكرو
   --------------------------------------------------------------------- */
function renderMacro() {
  var g = state.global, m = state.macro, c = state.cross, d = state.derivs;
  var html = '<h3 class="sub">السوق</h3>' +
    kv("هيمنة البتكوين", g && Number.isFinite(g.dom) ? fmt(g.dom, 2) + "%" : "—") +
    kv("تغيّرها", g && Number.isFinite(g.domChg) ? pct(g.domChg, 2) : "—",
       g && g.domChg > 0 ? "up" : "dn") +
    kv("القيمة السوقية الكلّية", g && Number.isFinite(g.totalMcap) ? "$" + compact(g.totalMcap) : "—") +
    kv("سيولة العملات المستقرة", g && Number.isFinite(g.stable) ? "$" + compact(g.stable) : "—") +
    kv("نموّها (شهرياً)", g && Number.isFinite(g.stableChg30) ? pct(g.stableChg30, 2) : "—",
       g && g.stableChg30 > 0 ? "up" : "dn");

  html += '<h3 class="sub">الأسعار عبر المنصّات</h3>';
  if (c && c.venues && c.venues.length) {
    c.venues.forEach(function (v) { html += kv(v.name, money(v.px, 2)); });
    html += kv("بريميوم كوينبيز", Number.isFinite(c.cbPrem) ? pct(c.cbPrem, 3) : "—",
               c.cbPrem > 0 ? "up" : "dn");
    html += '<p class="note">بريميوم كوينبيز موجبٌ يعني طلباً أمريكياً مؤسّسياً يسبق السوق — وسالبٌ يعني بيعاً منه.</p>';
  } else html += muted("تعذّر جلب أسعار المنصّات");

  html += '<h3 class="sub">الماكرو وتدفّقات الصناديق</h3>';
  if (m) {
    html += kv("مؤشّر الدولار", Number.isFinite(m.dxy) ? fmt(m.dxy, 2) : "—") +
      kv("تغيّره (5 أيام)", Number.isFinite(m.dxyChg5) ? pct(m.dxyChg5, 2) : "—",
         m.dxyChg5 < 0 ? "up" : "dn") +
      kv("S&P 500", Number.isFinite(m.spx) ? fmt(m.spx, 0) : "—") +
      kv("تغيّره (5 أيام)", Number.isFinite(m.spxChg5) ? pct(m.spxChg5, 2) : "—",
         m.spxChg5 > 0 ? "up" : "dn") +
      kv("الذهب", Number.isFinite(m.gold) ? money(m.gold, 0) : "—") +
      kv("ارتباط البتكوين بالدولار (30ي)", Number.isFinite(m.corrDxy30) ? fmt(m.corrDxy30, 2) : "—") +
      kv("ارتباطه بالأسهم (30ي)", Number.isFinite(m.corrSpx30) ? fmt(m.corrSpx30, 2) : "—") +
      (m.etf ? kv("تدفّق الصناديق (5 أيام)",
          Number.isFinite(m.etf.flow5d) ? "$" + compact(m.etf.flow5d * 1e6) : "—",
          m.etf.flow5d > 0 ? "up" : "dn") +
        kv("أيامٌ متّصلة", Number.isFinite(m.etf.streak)
          ? Math.abs(m.etf.streak) + (m.etf.streak > 0 ? " دخولاً" : " خروجاً") : "—") : "") +
      '<p class="note">تُحدَّث هذه الأرقام كل ساعة عبر مهمّةٍ مجدولة في مستودع الموقع — ' +
      (m.updated ? "آخر تحديث " + ago(m.updated) : "بلا طابعٍ زمني") + ".</p>";
  } else {
    html += '<div class="warn med">لم تصل بيانات الماكرو بعد. تكتبها مهمّةُ ' +
      '<code>.github/workflows/macro.yml</code> كل ساعة في <code>data/macro.json</code>. ' +
      'إن كانت المهمّة لم تُشغَّل بعد، شغّلها يدوياً من تبويب Actions في المستودع.</div>';
  }

  html += '<h3 class="sub">سوق الرافعة</h3>';
  html += d && Number.isFinite(d.oi)
    ? kv("العقود المفتوحة", "$" + compact(d.oi)) +
      kv("نسبة الشراء/البيع", Number.isFinite(d.ls) ? fmt(d.ls, 2) : "—") +
      kv("كبار المتداولين", Number.isFinite(d.topLs) ? fmt(d.topLs, 2) : "—")
    : muted("تعذّر");

  setHTML("macro", html);
}

/* ---------------------------------------------------------------------
   الأخبار
   --------------------------------------------------------------------- */
function renderNews() {
  var n = state.news;
  if (!n || !n.length) { setHTML("news", muted("تعذّر جلب الأخبار — قد تكون خدمة التغذية مشغولة")); return; }
  var sc = newsScore(n);
  var col = sc.score > 15 ? "var(--up)" : sc.score < -15 ? "var(--dn)" : "var(--neu)";
  setHTML("news",
    '<div class="newsScore" style="border-color:' + col + '">' +
      '<b style="color:' + col + '">' + (Number.isFinite(sc.score) ? (sc.score > 0 ? "+" : "") + fmt(sc.score, 0) : "—") + '</b>' +
      '<span>نبرةُ ' + sc.count + ' عنواناً خلال ‎72‎ ساعة، مرجّحةً بالحداثة</span></div>' +
    n.slice(0, 30).map(function (x) {
      var t = x.tone > 1 ? ["إيجابي", "var(--up)"] : x.tone < -1 ? ["سلبي", "var(--dn)"]
            : ["محايد", "var(--mut)"];
      return '<a class="nrow" href="' + x.link + '" target="_blank" rel="noopener">' +
        '<div class="nmeta"><em style="color:' + t[1] + '">' + t[0] + '</em>' +
        '<span>' + x.src + '</span><i>' + ago(x.t) + '</i></div>' +
        '<p>' + x.title + '</p></a>';
    }).join("") +
    '<p class="note">النبرة تُقاس بمعجمٍ موزون، لا بفهمٍ للسياق — فهي مؤشّرٌ تقريبي يُقرأ تأكيداً لا قيادةً. والخبر يتبع السعر أكثر ممّا يقوده.</p>'
  );
}

/* ---------------------------------------------------------------------
   صحّةُ المصادر — لوحةٌ صريحة
   --------------------------------------------------------------------- */
function renderSources() {
  var keys = Object.keys(state.src);
  if (!keys.length) { setHTML("sources", muted("—")); return; }
  setHTML("sources", keys.map(function (k) {
    var s = state.src[k];
    var age = srcAge(k);
    var cls = s.ok ? (age !== null && age > 20 ? "mid" : "ok") : "bad";
    return '<div class="srow ' + cls + '"><i></i><span>' + s.label + '</span>' +
      '<b>' + (s.ok ? (s.t ? ago(s.t) : "حيّ") : (s.t ? "متعذّر — آخر نجاح " + ago(s.t) : "متعذّر")) +
      '</b></div>';
  }).join("") +
  '<p class="note">المصدر الأصفر يعني بياناتٍ قديمة تُعرض كما هي موسومةً بعمرها، والأحمر يعني انقطاعاً. ولا يُستبدل الغائب بصفر.</p>');
}

function muted(t) { return '<p class="mutBox">' + t + "</p>"; }
