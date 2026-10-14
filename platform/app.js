/* واجهة منصّة الفرص — تقرأ من خادم المنصّة فقط (/api). لا مفاتيح ولا أسرار هنا.
   كل الأزمنة تصل UTC بالميلّي ثانية وتُعرض بتوقيت الرياض. */
(function () {
  "use strict";
  /* عنوان خادم البيانات: محلياً نفس الأصل؛ على GitHub Pages من platform/config.js (يكتبه scripts/publish-tunnel.mjs) أو ?api=… */
  var API = "";
  try {
    var qa = new URLSearchParams(location.search).get("api");
    if (qa) localStorage.setItem("apiBase", qa.replace(/\/+$/, ""));
    var onPages = location.hostname.indexOf("github.io") >= 0;
    API = (localStorage.getItem("apiBase") || (onPages && window.PLATFORM_API) || "").replace(/\/+$/, "");
  } catch (e) { API = (window.PLATFORM_API || ""); }
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var view = $("#view");
  var state = { route: "home", opps: new Map(), filters: {}, health: null, sse: null, openId: null, sseAt: 0 };

  /* ---------- أدوات ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var tzFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  function T(ts, withMs) {
    if (!ts) return "—";
    var p = {}; tzFmt.formatToParts(new Date(ts)).forEach(function (x) { p[x.type] = x.value; });
    return p.day + "/" + p.month + " " + p.hour + ":" + p.minute + ":" + p.second + (withMs ? "." + String(ts % 1000).padStart(3, "0") : "");
  }
  function ago(ts) {
    if (!ts) return "—";
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return Math.floor(s) + "ث"; if (s < 3600) return Math.floor(s / 60) + "د";
    if (s < 86400) return Math.floor(s / 3600) + "س " + Math.floor(s % 3600 / 60) + "د"; return Math.floor(s / 86400) + "ي";
  }
  function P(v) {
    if (v == null || isNaN(v)) return "—";
    var a = Math.abs(v);
    var d = a >= 1000 ? 2 : a >= 100 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : 7;
    return Number(v).toFixed(d).replace(/\.?0+$/, function (m) { return m.indexOf(".") === 0 && m.length > 1 ? "" : m; });
  }
  function N(v, d) { return v == null || isNaN(v) ? "—" : Number(v).toFixed(d == null ? 1 : d); }
  function pct(v, d) { return v == null ? "—" : N(v, d == null ? 2 : d) + "%"; }
  function money(v) { if (v == null) return "—"; var a = Math.abs(v);
    return a >= 1e9 ? N(v / 1e9, 2) + "B" : a >= 1e6 ? N(v / 1e6, 2) + "M" : a >= 1e3 ? N(v / 1e3, 1) + "K" : N(v, 0); }
  var STATUS = { "new": ["جديدة", "acc"], active: ["نشطة", "acc"], tp1: ["الهدف الأول ✓", "up"], tp2: ["الهدف الثاني ✓", "up"],
    tp3: ["كل الأهداف ✓", "up"], tp_sl: ["هدف ثم وقف عند الدخول", "neu"], sl: ["ضربت الوقف", "dn"],
    expired: ["انتهت الصلاحية", "gray"], cancelled: ["أُلغيت", "gray"] };
  function statusPill(s) { var x = STATUS[s] || [s, "gray"]; return '<span class="pill ' + x[1] + '">' + x[0] + "</span>"; }
  function dirLabel(o) {
    if (o.market === "OPTIONS") return o.side === "BUY" ? "CALL" : "PUT";
    if (o.market === "SPOT") return "BUY";
    return o.side === "BUY" ? "LONG" : "SHORT";
  }
  function isBuy(o) { return o.side === "BUY"; }
  function api(path, opts) {
    return fetch(path, opts).then(function (r) { if (!r.ok) throw new Error(path + " → " + r.status); return r.json(); });
  }
  function toast(msg) {
    var d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2600);
  }

  /* ---------- بطاقة فرصة ---------- */
  function oppRow(o) {
    var buy = isBuy(o);
    var inst = o.market === "OPTIONS" ? '<small class="mono">' + esc(o.instrument) + "</small>" : "<small>" + esc(marketName(o)) + "</small>";
    var lastP = o.lastPrice != null ? '<small>الآن</small><b>' + P(o.lastPrice) + "</b>" : "";
    var conf = o.hour_confirmed ? '<span class="pill up">ساعة ✓</span>' : '<span class="pill gray">ساعة ✗</span>';
    var tier = o.tier ? '<span class="tier tier' + o.tier + '" title="' + esc(o.tierLabel || "") + '">' + o.tier + "</span>" : "";
    var res = o.r_net != null ? '<span class="' + (o.r_net > 0 ? "up" : "dn") + ' mono">' + N(o.r_net, 2) + "R</span>" : "";
    return '<div class="opp ' + (buy ? "buy" : "sell") + '" data-id="' + o.id + '">' +
      '<div><span class="sym">' + esc(o.symbol) + '</span> <span class="pill ' + (buy ? "up" : "dn") + '">' + dirLabel(o) + "</span><br>" + inst + "</div>" +
      '<div>' + statusPill(o.status) + " " + res + '<br><small class="dim">منذ ' + ago(o.issued_at) + "</small></div>" +
      '<div class="f"><small>الدخول</small><b>' + P(o.entry) + "</b></div>" +
      '<div class="f"><small>الوقف</small><b class="dn">' + P(o.stop) + "</b></div>" +
      '<div class="f"><small>الأهداف</small><b class="up">' + P(o.tp1) + " · " + P(o.tp2) + " · " + P(o.tp3) + "</b></div>" +
      '<div class="f"><small>التقييم</small><span class="score"><b>' + N(o.score, 0) + '</b><span class="meter"><i style="width:' + Math.min(100, o.score) + '%"></i></span></span></div>' +
      '<div class="f"><small>التنفيذ</small>' + tier + ' <b>' + N(o.exec_quality, 0) + "</b></div>" +
      '<div class="f">' + conf + (lastP ? "<br>" + lastP : "") + "</div></div>";
  }
  function marketName(o) {
    return o.market === "SPOT" ? "Spot" : o.market === "FUTURES" ? "Futures" : "Options";
  }

  /* ---------- المسارات ---------- */
  var routes = { home: renderHome, spot: m("SPOT"), futures: m("FUTURES"), options: m("OPTIONS"),
    active: renderActive, closed: renderClosed, stats: renderStats, settings: renderSettings };
  function m(market) { return function () { return renderMarket(market); }; }

  function go() {
    var r = (location.hash.replace(/^#\//, "") || "home").split("?")[0];
    if (!routes[r]) r = "home";
    state.route = r;
    document.querySelectorAll("#nav a[data-r]").forEach(function (a) { a.classList.toggle("on", a.dataset.r === r); });
    view.innerHTML = '<div class="mutBox">جارٍ التحميل…</div>';
    Promise.resolve(routes[r]()).catch(function (e) {
      view.innerHTML = '<div class="card"><h2>تعذّر التحميل</h2><p class="mut">' + esc(e.message) +
        '</p><p class="note">تأكّد أن خادم المنصّة يعمل: <code class="mono">npm start</code></p></div>';
    });
  }
  window.addEventListener("hashchange", go);

  /* ---------- الرئيسية ---------- */
  function renderHome() {
    return api(API + "/api/overview").then(function (o) {
      var b = o.btc, t = b.trend;
      var tcls = t ? (t.state === "صاعد" ? "up" : t.state === "هابط" ? "dn" : "neu") : "mut";
      var h = '<div class="grid g4">' +
        kpi("BTC/USDT", b.price != null ? P(b.price) : "—", b.change24h != null ? '<span class="' + (b.change24h >= 0 ? "up" : "dn") + '">' + N(b.change24h, 2) + "% / 24س</span>" : "") +
        kpi("الاتجاه العام (15د)", '<span class="' + tcls + '">' + (t ? t.state : "—") + "</span>",
          t ? "SMA50 " + P(t.sma50) + " · SMA200 " + P(t.sma200) : "") +
        kpi("فرص نشطة", String(o.openCounts.SPOT + o.openCounts.FUTURES + o.openCounts.OPTIONS),
          "Spot " + o.openCounts.SPOT + " · Futures " + o.openCounts.FUTURES + " · Options " + o.openCounts.OPTIONS) +
        kpi("آخر فرصة", o.lastSignalAt ? ago(o.lastSignalAt) : "—", o.lastSignalAt ? T(o.lastSignalAt) : "لم تصدر بعد") +
        "</div>";
      var f = o.feeds;
      h += '<div class="card"><h2>تغطية التحليل الحيّ</h2><div class="grid g3">' +
        Object.keys(f).map(function (k) { return kpi(k === "spot" ? "Spot" : "Futures",
          f[k].live + " / " + f[k].tracked, "رمزٌ يصل تيّاره الآن · مهيَّأ " + f[k].ready); }).join("") +
        "</div></div>";
      h += '<div class="card"><h2>أقوى الفرص المفتوحة</h2><div class="list">' +
        (o.best.length ? o.best.map(oppRow).join("") : '<div class="mutBox">لا فرص مفتوحة الآن — المحرّك يعمل ويُقيّم كل افتتاح شمعة 15 دقيقة.</div>') +
        '</div></div><div class="card"><h2>أحدث الفرص</h2><div class="list">' +
        (o.recent.length ? o.recent.map(oppRow).join("") : '<div class="mutBox">—</div>') + "</div></div>";
      view.innerHTML = h;
      bindRows();
    });
  }
  function kpi(l, v, s) { return '<div class="kpi"><small>' + l + "</small><b>" + v + '</b><small>' + (s || "") + "</small></div>"; }

  /* ---------- صفحات الأسواق ---------- */
  function renderMarket(market) {
    var key = "f_" + market;
    var F = state.filters[key] || (state.filters[key] = { q: "", side: "", tier: "", hour: "", minScore: "0", sort: "issued_at", win: "86400000", st: "" });
    var sides = market === "FUTURES" ? [["", "كل الاتجاهات"], ["BUY", "LONG"], ["SELL", "SHORT"]]
      : market === "OPTIONS" ? [["", "CALL + PUT"], ["BUY", "CALL"], ["SELL", "PUT"]] : null;
    var h = '<div class="bar">' +
      '<input type="search" id="fq" placeholder="بحث بالعملة…" value="' + esc(F.q) + '">' +
      (sides ? '<select id="fside">' + sides.map(function (s) { return '<option value="' + s[0] + '"' + (F.side === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select>" : "") +
      sel("ftier", F.tier, [["", "كل الفئات"], ["A", "A ممتازة"], ["B", "B جيدة"], ["C", "C متوسّطة"], ["D", "D ضعيفة التنفيذ"]]) +
      sel("fhour", F.hour, [["", "تأكيد الساعة: الكل"], ["1", "مؤكَّدة بالساعة"], ["0", "بلا تأكيد"]]) +
      sel("fscore", F.minScore, [["0", "أي تقييم"], ["60", "≥ 60"], ["70", "≥ 70"], ["80", "≥ 80"], ["90", "≥ 90"]]) +
      sel("fst", F.st, [["", "كل الحالات"], ["open", "مفتوحة فقط"], ["closed", "منتهية فقط"]]) +
      sel("fsort", F.sort, [["issued_at", "الأحدث"], ["score", "الأعلى تقييماً"], ["exec_quality", "الأفضل تنفيذاً"]]) +
      sel("fwin", F.win, [["3600000", "آخر ساعة"], ["86400000", "آخر 24 ساعة"], ["604800000", "آخر 7 أيام"], ["0", "الكل"]]) +
      "</div>" + '<div id="mlist"><div class="mutBox">جارٍ التحميل…</div></div>' +
      (market === "SPOT" ? '<div class="card" id="bear"></div>' : "") +
      (market === "OPTIONS" ? '<div class="card" id="miss"></div>' : "") +
      '<p class="note">' + marketNote(market) + "</p>";
    view.innerHTML = h;
    ["fq", "fside", "ftier", "fhour", "fscore", "fst", "fsort", "fwin"].forEach(function (id) {
      var el = $("#" + id); if (!el) return;
      el.addEventListener(id === "fq" ? "input" : "change", function () {
        F.q = $("#fq").value; if ($("#fside")) F.side = $("#fside").value; F.tier = $("#ftier").value; F.hour = $("#fhour").value;
        F.minScore = $("#fscore").value; F.st = $("#fst").value; F.sort = $("#fsort").value; F.win = $("#fwin").value;
        loadMarket(market, F);
      });
    });
    var p = loadMarket(market, F);
    if (market === "SPOT") api(API + "/api/bearish").then(function (r) {
      $("#bear").innerHTML = "<h2>إشارات هبوط — معلومات فقط</h2>" + (r.items.length ?
        '<div class="tw"><table><tr><th>العملة</th><th>الوقت</th><th class="n">السعر</th><th class="n">التقييم</th></tr>' +
        r.items.slice(0, 30).map(function (i) { return "<tr><td>" + esc(i.symbol) + "</td><td>" + T(i.ts) + '</td><td class="n">' + P(i.price) + '</td><td class="n">' + N(i.score, 0) + "</td></tr>"; }).join("") +
        '</table></div><p class="note">لا يوجد بيع على المكشوف في Spot؛ هذه قراءةٌ للحذر لا فرصة.</p>' : '<div class="mutBox">لا إشارات هبوط منذ التشغيل.</div>');
    }).catch(function () {});
    if (market === "OPTIONS") api(API + "/api/misses").then(function (r) {
      $("#miss").innerHTML = "<h2>إشارات بلا عقدٍ مناسب (لم تصدر فرصة)</h2>" + (r.items.length ?
        '<div class="tw"><table><tr><th>الأصل</th><th>الاتجاه</th><th>الوقت</th><th>سبب الرفض (عدد العقود)</th></tr>' +
        r.items.slice(0, 20).map(function (i) { return "<tr><td>" + esc(i.symbol) + "</td><td>" + (i.side === "BUY" ? "CALL" : "PUT") + "</td><td>" + T(i.ts) + "</td><td class='mut'>" +
          esc(rejectText(i.rejected)) + "</td></tr>"; }).join("") + "</table></div>" : '<div class="mutBox">لا حالات.</div>');
    }).catch(function () {});
    return p;
  }
  function rejectText(r) {
    var n = { side: "اتجاه آخر", dte: "المدّة", delta: "الدلتا", noQuote: "بلا عرض/طلب", spread: "سبريد واسع", oi: "مراكز مفتوحة", volume: "حجم" };
    return Object.keys(r || {}).filter(function (k) { return r[k]; }).map(function (k) { return (n[k] || k) + " " + r[k]; }).join(" · ");
  }
  function sel(id, cur, opts) {
    return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(cur) === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>";
  }
  function marketNote(m) {
    if (m === "SPOT") return "فرص شراء فقط. الدخول = سعر الطلب لحظة الإصدار. الأهداف 1R/2R/3R والوقف 1.5×ATR(15د).";
    if (m === "FUTURES") return "USDT-M الدائمة. الرافعة تُعرض أثرها على الهامش والتصفية ولا تؤثّر في التقييم. التمويل والعقود المفتوحة من Binance مباشرة.";
    return "لا تصدر فرصةٌ إن لم يوجد عقدٌ مناسب. أهداف العلاوة تقديرية؛ المتابعة الفعلية على سعر العقد (العرض). أقصى خسارةٍ = العلاوة.";
  }
  var loadTimer;
  function loadMarket(market, F) {
    var q = "market=" + market + "&sort=" + F.sort + "&limit=300&minScore=" + F.minScore;
    if (F.q) q += "&q=" + encodeURIComponent(F.q);
    if (F.side) q += "&side=" + F.side;
    if (F.tier) q += "&tier=" + F.tier;
    if (F.hour) q += "&hour=" + F.hour;
    if (F.st === "open") q += "&open=1"; if (F.st === "closed") q += "&closed=1";
    if (F.win !== "0") q += "&since=" + (Date.now() - Number(F.win));
    return api(API + "/api/opps?" + q).then(function (r) {
      var el = $("#mlist"); if (!el) return;
      el.innerHTML = r.items.length ? '<div class="list">' + r.items.map(oppRow).join("") + "</div>"
        : '<div class="mutBox">لا فرص مطابقة. المحرّك يُقيّم كل افتتاح شمعة 15 دقيقة، والفرصة نادرة بطبيعة الشرط.</div>';
      bindRows();
    });
  }

  function renderActive() {
    return api(API + "/api/opps?open=1&limit=500&sort=issued_at").then(function (r) {
      view.innerHTML = '<div class="bar"><b>' + r.items.length + ' فرصة مفتوحة</b></div><div class="list">' +
        (r.items.length ? r.items.map(oppRow).join("") : '<div class="mutBox">لا فرص نشطة.</div>') + "</div>";
      bindRows();
    });
  }
  function renderClosed() {
    return api(API + "/api/opps?closed=1&limit=300&sort=closed_at").then(function (r) {
      view.innerHTML = '<div class="bar"><b>' + r.items.length + ' نتيجة</b></div><div class="list">' +
        (r.items.length ? r.items.map(oppRow).join("") : '<div class="mutBox">لم تنتهِ فرصٌ بعد.</div>') + "</div>";
      bindRows();
    });
  }
  function bindRows() {
    view.querySelectorAll(".opp").forEach(function (el) { el.onclick = function () { openDetail(+el.dataset.id); }; });
  }

  /* ---------- الإحصائيات ---------- */
  function statTable(title, obj, label) {
    var keys = Object.keys(obj || {});
    if (!keys.length) return '<div class="card"><h2>' + title + '</h2><div class="mutBox">لا بيانات بعد.</div></div>';
    return '<div class="card"><h2>' + title + '</h2><div class="tw"><table><tr><th>' + (label || "") + '</th><th class="n">العدد</th><th class="n">فوز%</th><th class="n">متوسط ربح%</th><th class="n">متوسط خسارة%</th><th class="n">متوسط R</th><th class="n">مجموع R</th><th class="n">PF</th></tr>' +
      keys.map(function (k) { var a = obj[k]; return "<tr><td>" + esc(k) + '</td><td class="n">' + a.n + '</td><td class="n">' + N(a.winRate, 0) + '</td><td class="n up">' + N(a.avgWinPct, 2) +
        '</td><td class="n dn">' + N(a.avgLossPct, 2) + '</td><td class="n">' + N(a.avgR, 2) + '</td><td class="n">' + N(a.totalR, 1) + '</td><td class="n">' + (a.profitFactor == null ? "∞" : N(a.profitFactor, 2)) + "</td></tr>"; }).join("") + "</table></div></div>";
  }
  function renderStats() {
    return api(API + "/api/stats").then(function (s) {
      var o = s.overall;
      var h = '<div class="grid g4">' + kpi("الفرص المنتهية", String(o.n || 0), "مفتوحة الآن: " + s.open) +
        kpi("نسبة الفوز", o.n ? N(o.winRate, 1) + "%" : "—", o.n ? "خسارة " + N(o.lossRate, 1) + "%" : "") +
        kpi("متوسط العائد/المخاطرة", o.n ? N(o.avgR, 2) + "R" : "—", o.n ? "بعد الرسوم والانزلاق" : "") +
        kpi("أكبر تراجع", s.drawdown.maxDrawdownR != null ? N(s.drawdown.maxDrawdownR, 2) + "R" : "—", "على النتائج الافتراضية") + "</div>";
      h += statTable("حسب السوق", s.byMarket, "السوق") + statTable("حسب السوق والاتجاه", s.bySide, "الاتجاه") +
        statTable("حسب مستوى التقييم", s.byScore, "التقييم") + statTable("حسب فئة التنفيذ", s.byTier, "الفئة") +
        statTable("مقارنة الاستراتيجية (تأكيد الساعة)", s.byHourConfirm, "الاستراتيجية") +
        statTable("أفضل العملات", arr(s.bestSymbols), "العملة") + statTable("أسوأ العملات", arr(s.worstSymbols), "العملة") +
        statTable("حسب اليوم", s.byDay, "اليوم") + statTable("حسب ساعة الإصدار (UTC)", s.byHourOfDayUtc, "الساعة");
      h += '<div class="card"><h2>توزيع النتائج</h2><p class="mut">' + Object.keys(s.outcomes).map(function (k) {
        return (STATUS[k] ? STATUS[k][0] : k) + ": <b>" + s.outcomes[k] + "</b>"; }).join(" · ") + "</p>" +
        '<p class="note">' + esc(s.model.exits) + "<br>" + esc(s.model.costs) + "<br>" + esc(s.model.notice) + "</p></div>";
      view.innerHTML = h;
    });
  }
  function arr(a) { var o = {}; (a || []).forEach(function (x) { o[x.key] = x; }); return o; }

  /* ---------- الإعدادات والصحّة ---------- */
  function renderSettings() {
    return Promise.all([api(API + "/api/settings"), api(API + "/api/health")]).then(function (r) {
      var S = r[0], H = r[1];
      var fields = [
        ["spot.enabled", "تفعيل Spot", "b"], ["spot.minQuoteVolume24h", "أدنى حجم 24س — Spot (USDT)"], ["spot.maxSpreadPct", "أقصى سبريد — Spot %"],
        ["futures.enabled", "تفعيل Futures", "b"], ["futures.minQuoteVolume24h", "أدنى حجم 24س — Futures (USDT)"], ["futures.maxSpreadPct", "أقصى سبريد — Futures %"],
        ["options.enabled", "تفعيل Options", "b"], ["options.deltaMin", "دلتا الأدنى"], ["options.deltaMax", "دلتا الأعلى"], ["options.deltaTarget", "دلتا المستهدفة"],
        ["options.minDteHours", "أدنى مدّةٍ لانتهاء العقد (ساعة)"], ["options.maxDteDays", "أقصى مدّة (يوم)"], ["options.maxSpreadPct", "أقصى سبريد للعقد %"],
        ["options.minOpenInterest", "أدنى مراكز مفتوحة"], ["options.stopLossPct", "وقف العقد (% من العلاوة)"],
        ["plan.stopAtr", "الوقف × ATR"], ["plan.expiryMinutes", "صلاحية الفرصة (دقيقة)"], ["plan.breakevenAfterTp1", "الوقف إلى الدخول بعد الهدف 1", "b"],
        ["plan.cancelOnSmaClose", "إلغاء عند إغلاق 15د عكس SMA200", "b"],
        ["weights.sma", "وزن SMA %"], ["weights.yesterday", "وزن قمة/قاع أمس %"], ["weights.vwap", "وزن VWAP %"],
        ["weights.week", "وزن قمة/قاع الأسبوع %"], ["weights.trend", "وزن الاتجاه العام %"],
        ["weights.tf15", "نقاط فريم 15د"], ["weights.tf1h", "نقاط تأكيد الساعة"], ["weights.indicatorShare", "حصّة المؤشّرات من الدرجة"],
        ["costs.spotFeePct", "رسوم Spot % لكل جهة"], ["costs.futuresFeePct", "رسوم Futures % لكل جهة"], ["costs.slippageBps", "الانزلاق (نقطة أساس)"],
        ["minExecQuality", "أدنى جودة تنفيذ"]
      ];
      function get(p) { return p.split(".").reduce(function (a, k) { return a[k]; }, S); }
      var h = '<div class="card"><h2>الإعدادات</h2>' + fields.map(function (f) {
        var v = get(f[0]);
        return '<div class="field"><label>' + f[1] + "</label>" + (f[2] === "b" ?
          '<input type="checkbox" data-k="' + f[0] + '" data-t="b"' + (v ? " checked" : "") + ">" :
          '<input type="number" step="any" data-k="' + f[0] + '" value="' + v + '">') + "</div>";
      }).join("") + '<div class="bar" style="margin-top:12px"><button class="btn pri" id="sv">حفظ</button><button class="btn" id="rs">استعادة الافتراضي</button>' +
        '<input type="password" id="tok" placeholder="رمز الإدارة (إن لزم)"></div>' +
        '<p class="note">التغييرات تسري على الفرص القادمة فقط. تغيير السيولة الدنيا يسري عند إعادة اكتشاف الرموز.</p></div>';
      h += '<div class="card"><h2>صحّة النظام</h2><div class="grid g3">' +
        kpi("مدّة التشغيل", Math.round(H.uptimeSec / 60) + " د", "ذاكرة " + H.memoryMB + "MB · Node " + H.node) +
        Object.keys(H.feeds).map(function (k) { var f = H.feeds[k];
          return kpi(k === "spot" ? "Spot" : "Futures", f.liveSymbols + " / " + f.tracked + " حيّ",
            "كون " + f.universe + " · مهيَّأ " + f.readySymbols + " · WS " + f.ws.open + "/" + f.ws.connections + " · إعادة اتصال " + f.ws.reconnects + " · تخطّي متأخّر " + f.lateSkipped); }).join("") +
        Object.keys(H.sources).map(function (k) { var s = H.sources[k];
          return kpi("REST " + k, '<span class="' + (s.ok ? "up" : s.ok === false ? "dn" : "mut") + '">' + (s.ok ? "يعمل" : s.ok === false ? "معطّل" : "—") + "</span>",
            "وزن " + s.usedWeight + "/" + s.budget + " · أخطاء " + s.errors + (s.lastError ? " · " + esc(s.lastError) : "")); }).join("") +
        kpi("الفرص المصدرة", H.counters.signals.SPOT + " / " + H.counters.signals.FUTURES + " / " + H.counters.signals.OPTIONS, "Spot / Futures / Options · مكرَّر محجوب " + H.counters.dupes + " · بلا عقد " + H.counters.noOption + " · أخطاء " + H.counters.errors) +
        "</div></div>";
      view.innerHTML = h;
      function auth() { var t = $("#tok").value; return t ? { "x-admin-token": t } : {}; }
      $("#sv").onclick = function () {
        var patch = {};
        view.querySelectorAll("input[data-k]").forEach(function (el) {
          var p = el.dataset.k.split("."), v = el.dataset.t === "b" ? el.checked : Number(el.value);
          if (p.length === 1) patch[p[0]] = v; else { patch[p[0]] = patch[p[0]] || {}; patch[p[0]][p[1]] = v; }
        });
        fetch(API + "/api/settings", { method: "PUT", headers: Object.assign({ "content-type": "application/json" }, auth()), body: JSON.stringify(patch) })
          .then(function (x) { toast(x.ok ? "تم الحفظ" : "رُفض: " + x.status); });
      };
      $("#rs").onclick = function () {
        fetch(API + "/api/settings/reset", { method: "POST", headers: auth() }).then(function (x) { toast(x.ok ? "استُعيدت الإعدادات" : "رُفض: " + x.status); if (x.ok) go(); });
      };
    });
  }

  /* ---------- التفاصيل ---------- */
  function openDetail(id) {
    state.openId = id;
    var modal = $("#modal"), sheet = $("#sheet");
    modal.hidden = false; document.body.style.overflow = "hidden";
    sheet.innerHTML = '<div class="mutBox">جارٍ التحميل…</div>';
    modal.onclick = function (e) { if (e.target === modal) closeDetail(); };
    api(API + "/api/opps/" + id).then(function (o) {
      fetch(API + "/api/opps/" + id + "/seen", { method: "POST" }).catch(function () {});
      sheet.innerHTML = detailHtml(o);
      $("#xBtn").onclick = closeDetail;
      api(API + "/api/opps/" + id + "/chart").then(function (c) { drawChart($("#cv"), c, o); }).catch(function (e) {
        $("#cv").insertAdjacentHTML("afterend", '<p class="mut">تعذّر تحميل الرسم: ' + esc(e.message) + "</p>");
      });
    }).catch(function (e) { sheet.innerHTML = '<div class="mutBox">' + esc(e.message) + "</div>"; });
  }
  function closeDetail() { $("#modal").hidden = true; document.body.style.overflow = ""; state.openId = null; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetail(); });

  function chk(ok, val) { return '<span class="chk ' + (ok ? "up" : "dn") + '">' + (ok ? "✓" : "✗") + "</span> <span class=\"mono mut\">" + (val || "") + "</span>"; }
  function detailHtml(o) {
    var buy = isBuy(o), sg = o.signal || {}, v = sg.values || {}, c = sg.conditions ? (buy ? sg.conditions.buy : sg.conditions.sell) : {};
    var hour = sg.hour || {}, lv = sg.levels || {}, S = o.scoreDetail || {}, parts = S.parts || {};
    var dirName = dirLabel(o);
    var h = '<div class="sheetHead"><h2>' + esc(o.symbol) + '</h2><span class="pill ' + (buy ? "up" : "dn") + '">' + dirName + "</span>" +
      statusPill(o.status) + (o.tier ? '<span class="tier tier' + o.tier + '">' + o.tier + " · " + esc(o.tierLabel) + "</span>" : "") +
      '<button class="btn x" id="xBtn">إغلاق ✕</button></div>';
    if (o.market === "OPTIONS" && o.contract) {
      var k = o.contract;
      h += '<div class="card"><h2>العقد المقترح <span class="mono">' + esc(k.symbol) + "</span></h2><div class=\"grid g4\">" +
        kpi("سعر الشراء (Ask)", P(k.ask), "العرض " + P(k.bid) + " · سبريد " + pct(k.spreadPct, 1)) +
        kpi("Strike / الانتهاء", P(k.strike), T(k.expiry) + " · " + N(k.dteHours / 24, 1) + " يوم") +
        kpi("Delta / Gamma", N(k.delta, 3) + " / " + (+k.gamma).toExponential(1), "Theta " + N(k.theta, 2) + " (" + pct(k.thetaPctPerDay, 1) + " يومياً)") +
        kpi("Vega / IV", N(k.vega, 1) + " / " + N(k.markIV * 100, 1) + "%", "حجم " + N(k.volume24h, 2) + " · مراكز " + N(k.openInterest, 1)) + "</div>" +
        '<p class="note">أقصى خسارة عند الشراء = العلاوة المدفوعة: <b>' + P(o.plan.maxLossPerContract) + " USDT</b> للعقد. أصل العقد: " + esc(o.symbol) +
        " عند " + P(o.underlying && o.underlying.entry) + ".</p></div>";
    }
    h += '<canvas id="cv" height="340"></canvas><div class="legend">' +
      '<span><i style="background:#f5b912"></i>SMA15</span><span><i style="background:#3d7ddb"></i>SMA35</span><span><i style="background:#b57bee"></i>SMA50</span><span><i style="background:#ffffff"></i>SMA200</span>' +
      '<span><i style="background:#00d19b"></i>الأهداف</span><span><i style="background:#ff4d5e"></i>الوقف</span><span class="dim">SMA من الشموع المغلقة السابقة (بدون الشمعة نفسها)</span></div>';

    h += '<div class="grid g2">';
    /* مستويات */
    var optPlan = o.market === "OPTIONS";
    h += '<div class="card"><h2>مستويات الصفقة' + (optPlan ? " (علاوة العقد)" : "") + "</h2><table>" +
      row("الدخول" + (o.quote && o.quote.entrySource ? " (" + o.quote.entrySource + ")" : ""), P(o.entry)) +
      row("الوقف" + (o.currentStop != null && o.currentStop !== o.stop ? " → الآن " + P(o.currentStop) : ""), '<span class="dn">' + P(o.stop) + "</span>") +
      row("الهدف 1", P(o.tp1)) + row("الهدف 2", P(o.tp2)) + row("الهدف 3", P(o.tp3)) +
      row("المخاطرة", o.plan ? pct(o.plan.riskPct * 100, 2) + " من الدخول" : "—") +
      row("العائد/المخاطرة", o.plan && o.plan.rr ? o.plan.rr.join(" : ") + " R" : (optPlan ? "تقديري" : "—")) +
      row("التوزيع", (o.plan && o.plan.split ? o.plan.split.map(function (x) { return Math.round(x * 100) + "%"; }).join(" / ") : "—")) +
      row("تنتهي الصلاحية", T(o.plan && o.plan.expiresAt)) +
      (o.exit_price != null ? row("سعر الخروج الأخير", P(o.exit_price)) + row("النتيجة الصافية", '<span class="' + (o.r_net > 0 ? "up" : "dn") + '">' + N(o.r_net, 2) + "R · " + pct(o.pnl_pct_net, 2) + "</span>") : "") +
      "</table>" + (o.plan && o.plan.note ? '<p class="note">' + esc(o.plan.note) + "</p>" : "") + "</div>";

    /* جدول التأكيدات */
    var nowOpen = v.openPrice;
    h += '<div class="card"><h2>جدول التأكيدات</h2><table>' +
      row("15د: افتتاح " + (buy ? "فوق" : "تحت") + " SMA200", chk(buy ? c.openAboveSma200 : c.openBelowSma200, P(nowOpen) + " / " + P(v.sma200))) +
      row("افتتاح الشمعة السابقة " + (buy ? "≤" : "≥") + " SMA200 التاريخي", chk(buy ? c.prevOpenAtOrBelow : c.prevOpenAtOrAbove, P(v.prevOpen) + " / " + P(v.sma200Prev))) +
      row("SMA35 " + (buy ? "<" : ">") + " SMA200", chk(buy ? c.sma35Below : c.sma35Above, P(v.sma35))) +
      row("SMA50 " + (buy ? "<" : ">") + " SMA200", chk(buy ? c.sma50Below : c.sma50Above, P(v.sma50))) +
      row("تأكيد الساعة (افتتاح " + (buy ? "فوق" : "تحت") + " SMA50 ساعة)", hour.ok ? chk(o.hourConfirmed, P(hour.hourOpen) + " / " + P(hour.sma50)) : '<span class="mut">بيانات غير كافية</span>') +
      row("VWAP (UTC يومي)" + (lv.vwap && lv.vwap.carried ? " — من أمس" : ""), lv.vwap && lv.vwap.value != null ? chk(buy ? nowOpen > lv.vwap.value : nowOpen < lv.vwap.value, P(lv.vwap.value)) : "—") +
      row("قمة/قاع أمس", lv.yesterday ? chk(parts.yesterday && parts.yesterday.score >= 0.5, P(lv.yesterday.low) + " – " + P(lv.yesterday.high)) : "—") +
      row("قمة/قاع الأسبوع السابق", lv.week ? chk(parts.week && parts.week.score >= 0.5, P(lv.week.low) + " – " + P(lv.week.high)) : "—") +
      row("الاتجاه العام (SMA50/200 ساعة)", sg.trendUp == null ? "—" : chk(buy ? sg.trendUp : !sg.trendUp, sg.trendUp ? "صاعد" : "هابط")) +
      "</table></div></div>";

    /* التقييم */
    h += '<div class="grid g2"><div class="card"><h2>التقييم: ' + N(o.score, 1) + " / 100</h2><table>" +
      row("نقاط الفريمات", (S.tfPoints || 0) + " / " + (S.tfMax || 60) + " (15د = 40 · ساعة = 20)") +
      row("جودة المؤشّرات", N(S.indicatorScore, 1) + " / 100") +
      Object.keys(parts).map(function (k) { var p = parts[k]; return row({ sma: "SMA 15/35/50/200", yesterday: "قمة وقاع أمس", vwap: "VWAP", week: "قمة وقاع الأسبوع", trend: "الاتجاه العام" }[k] +
        " (" + p.weight + "%)", N(p.points, 1) + " نقطة"); }).join("") + "</table>" +
      '<p class="note">الدرجة = نقاط الفريمات + 0.4 × جودة المؤشّرات. شروط الدخول الإلزامية منفصلةٌ عن هذا التقييم.</p></div>';
    var ex = o.exec || {};
    h += '<div class="card"><h2>جودة التنفيذ والمخاطرة: ' + N(o.exec_quality, 0) + " / 100</h2><table>" +
      Object.keys(ex.parts || {}).map(function (k) { return row({ spread: "السبريد", volume: "حجم 24س", cost: "التكلفة/المخاطرة", funding: "التمويل", openInterest: "العقود المفتوحة", theta: "اضمحلال Theta", time: "المدّة المتبقية" }[k] || k,
        N(ex.parts[k].value * 100, 0) + " / 100 (وزن " + ex.parts[k].weight + ")"); }).join("") + "</table>" +
      (o.quote && o.quote.spreadPct != null ? '<p class="note">سبريد لحظة الإصدار ' + pct(o.quote.spreadPct, 3) + " · حجم 24س " + money(o.meta && o.meta.quoteVolume24h) + " USDT" +
        (o.futures ? " · تمويل " + pct(o.futures.fundingPct8h, 4) + " · OI " + money(o.futures.oiUsd) + " USDT" : "") + "</p>" : "") + "</div></div>";

    if (o.leverage) {
      h += '<div class="card"><h2>أثر الرافعة (لا يدخل في التقييم)</h2><div class="tw"><table><tr><th>الرافعة</th><th class="n">الهامش</th><th class="n">سعر التصفية التقريبي</th><th class="n">المسافة للتصفية</th><th class="n">خسارة الوقف على الهامش</th><th>تنبيه</th></tr>' +
        o.leverage.map(function (L) { return "<tr><td>" + L.leverage + 'x</td><td class="n">' + pct(L.marginPct, 1) + '</td><td class="n">' + P(L.liqPrice) + '</td><td class="n">' + pct(L.liqDistPct, 2) +
          '</td><td class="n">' + pct(L.stopLossOnMarginPct, 1) + "</td><td>" + (L.liqBeforeStop ? '<span class="dn">التصفية قبل الوقف!</span>' : '<span class="mut">—</span>') + "</td></tr>"; }).join("") +
        '</table></div><p class="note">تقريبٌ بهامشٍ معزول ومعدّل صيانة أول شريحة؛ التصفية الفعلية تختلف بحسب الشرائح والرسوم.</p></div>';
    }

    var tm = o.timing || {};
    h += '<div class="grid g2"><div class="card"><h2>التوقيت (الرياض)</h2><table>' +
      row("افتتاح الشمعة", T(tm.candleOpenTs, true)) + row("وصول بيانات الافتتاح", T(tm.dataArrivedAt, true) + ' <span class="mut">(+' + ((tm.dataArrivedAt - tm.candleOpenTs) / 1000).toFixed(2) + "ث)</span>") +
      row("التقييم", T(tm.detectedAt, true)) + row("الإصدار والحفظ", T(tm.issuedAt, true) + ' <span class="mut">(+' + ((tm.issuedAt - tm.candleOpenTs) / 1000).toFixed(2) + "ث)</span>") +
      row("أول ظهور للمستخدم", o.seen_at ? T(o.seen_at, true) : "الآن") + "</table>" +
      (o.costModel ? '<p class="note">نموذج التكلفة: رسوم ' + pct(o.costModel.feePctPerSide, 3) + " لكل جهة + انزلاق " + o.costModel.slippageBps + "bp + نصف السبريد عند الخروج.</p>" : "") + "</div>";
    h += '<div class="card"><h2>سجلّ التغيّرات</h2><ul class="timeline">' + (o.events || []).map(function (e) {
      return "<li><span class=\"mono mut\">" + T(e.ts) + "</span><b>" + esc(evName(e.type)) + "</b>" + (e.price != null ? '<span class="mono">' + P(e.price) + "</span>" : "") +
        (e.note ? '<span class="mut">' + esc(e.note) + "</span>" : "") + "</li>"; }).join("") + "</ul></div></div>";

    if (o.selection) {
      h += '<div class="card"><h2>اختيار العقد</h2><p class="mut">درجة الاختيار ' + N(o.selection.score, 0) + " من " + o.selection.considered + " عقداً مدرجاً. مرفوضة: " + esc(rejectText(o.selection.rejected)) + "</p>" +
        (o.selection.runnersUp.length ? '<div class="tw"><table><tr><th>بدائل</th><th class="n">Delta</th><th class="n">Ask</th><th class="n">سبريد</th><th class="n">درجة</th></tr>' +
          o.selection.runnersUp.map(function (r) { return '<tr><td class="mono">' + esc(r.symbol) + '</td><td class="n">' + N(r.delta, 2) + '</td><td class="n">' + P(r.ask) + '</td><td class="n">' + pct(r.spreadPct, 1) + '</td><td class="n">' + N(r.score, 0) + "</td></tr>"; }).join("") + "</table></div>" : "") + "</div>";
    }
    return h;
  }
  function row(a, b) { return "<tr><td>" + a + '</td><td class="n" style="text-align:end">' + b + "</td></tr>"; }
  function evName(t) {
    return { issued: "صدرت الفرصة", active: "أصبحت نشطة", tp1: "حقّقت الهدف 1", tp2: "حقّقت الهدف 2", tp3: "حقّقت كل الأهداف", sl: "ضربت الوقف",
      tp_sl: "وقف عند الدخول بعد هدف", expired: "انتهت الصلاحية", cancelled: "أُلغيت", stop_moved: "نُقل الوقف", recovered: "استرجاع بعد توقّف", gap: "فجوة بيانات" }[t] || t;
  }

  /* ---------- الرسم ---------- */
  function drawChart(cv, d, o) {
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext("2d"); g.scale(dpr, dpr);
    var cs = d.candles.slice(); if (d.live) cs.push(d.live);
    if (!cs.length) { g.fillStyle = "#8f9bad"; g.fillText("لا بيانات", 10, 20); return; }
    var padR = 62, padL = 6, padT = 10, padB = 18, w = W - padL - padR, h = H - padT - padB;
    var lv = [o.entry, o.stop, o.tp1, o.tp2, o.tp3];
    if (o.market === "OPTIONS" && o.underlying) lv = [o.underlying.entry, o.underlying.plan.stop].concat(o.underlying.plan.targets);
    var hi = -Infinity, lo = Infinity;
    cs.forEach(function (k) { hi = Math.max(hi, k.h); lo = Math.min(lo, k.l); });
    lv.forEach(function (x) { if (x) { hi = Math.max(hi, x); lo = Math.min(lo, x); } });
    var pad = (hi - lo) * 0.05; hi += pad; lo -= pad;
    var y = function (p) { return padT + (hi - p) / (hi - lo) * h; };
    var n = cs.length, bw = w / n, x = function (i) { return padL + i * bw + bw / 2; };
    g.strokeStyle = "#212a38"; g.fillStyle = "#5e6b7e"; g.font = "10px IBM Plex Mono"; g.lineWidth = 1;
    for (var i = 0; i <= 4; i++) { var p = lo + (hi - lo) * i / 4, yy = y(p); g.beginPath(); g.moveTo(padL, yy); g.lineTo(W - padR, yy); g.stroke(); g.fillText(P(p), W - padR + 4, yy + 3); }
    function line(key, color, wd) {
      g.beginPath(); var st = false; g.strokeStyle = color; g.lineWidth = wd || 1.2;
      cs.forEach(function (k, i) { var v = k[key]; if (v == null) { st = false; return; } if (!st) { g.moveTo(x(i), y(v)); st = true; } else g.lineTo(x(i), y(v)); });
      g.stroke();
    }
    cs.forEach(function (k, i) {
      var up = k.c >= k.o, col = up ? "#00d19b" : "#ff4d5e";
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x(i), y(k.h)); g.lineTo(x(i), y(k.l)); g.stroke();
      var top = y(Math.max(k.o, k.c)), bh = Math.max(1, Math.abs(y(k.o) - y(k.c)));
      g.fillRect(x(i) - Math.max(1, bw * 0.35), top, Math.max(2, bw * 0.7), bh);
    });
    line("sma15", "#f5b912"); line("sma35", "#3d7ddb"); line("sma50", "#b57bee"); line("sma200", "#ffffff", 1.6);
    function hl(p, color, label) {
      if (!p) return; g.strokeStyle = color; g.setLineDash([5, 4]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(padL, y(p)); g.lineTo(W - padR, y(p)); g.stroke(); g.setLineDash([]);
      g.fillStyle = color; g.fillText(label, W - padR + 4, y(p) - 2);
    }
    var base = lv;
    hl(base[0], "#8f9bad", "دخول"); hl(base[1], "#ff4d5e", "وقف");
    hl(base[2], "#00d19b", "T1"); hl(base[3], "#00d19b", "T2"); hl(base[4], "#00d19b", "T3");
    var si = cs.findIndex(function (k) { return k.t === o.candle_open_ts; });
    if (si >= 0) { g.strokeStyle = "#3d7ddb"; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x(si), padT); g.lineTo(x(si), H - padB); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#3d7ddb"; g.fillText("الإشارة", x(si) - 14, H - 5); }
  }

  /* ---------- البثّ اللحظي ---------- */
  function connect() {
    var dot = $("#liveDot");
    var es = new EventSource(API + "/api/stream");
    es.onopen = function () { dot.className = "live on"; };
    es.onerror = function () { dot.className = "live bad"; };
    es.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      state.sseAt = Date.now();
      if (m.type === "opp_new") {
        toast("فرصة جديدة: " + m.opp.symbol + " " + dirLabel(m.opp));
        if (!document.hidden) fetch(API + "/api/opps/" + m.opp.id + "/seen", { method: "POST" }).catch(function () {});
        if (["home", "spot", "futures", "options", "active"].indexOf(state.route) >= 0) go();
      } else if (m.type === "opp_update") {
        if (state.route === "active" || state.route === "closed" || state.route === "home") { clearTimeout(loadTimer); loadTimer = setTimeout(go, 800); }
      } else if (m.type === "health") {
        state.health = m.health; $("#hStamp").textContent = "آخر تحديث " + T(m.health.now);
        $("#nActive").textContent = m.health.openOpportunities || "";
      }
    };
  }

  /* تحديثٌ دوريّ هادئ للأسعار الحيّة في الصفحات المفتوحة */
  setInterval(function () { if (!document.hidden && ["home", "active"].indexOf(state.route) >= 0 && $("#modal").hidden) go(); }, 30000);

  go(); connect();
})();
