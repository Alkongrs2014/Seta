/* =====================================================================
   المحرّك: يربط المغذّيات بالتقييم والتخزين والمتابعة والبثّ.

   مسار الفرصة:
     أول رسالة تحمل افتتاح شمعة 15د جديدة  ──►  evaluateCandleOpen
       ──► (سعر العرض/الطلب + التمويل + OI)  ──►  الخطّة والجودة
       ──► قاعدة البيانات (منع التكرار)  ──►  بثّ SSE  ──►  المتابعة بالتيّار نفسه.
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { ENV } from "./config.js";
import * as DB from "./db.js";
import { bget, fetchKlines, sourceHealth } from "./binance.js";
import { MarketFeed } from "./feed.js";
import { evaluateCandleOpen, buildPlan, smaAt, M15 } from "./strategy.js";
import { execQualityLinear, tierOf, TIER_LABEL, leverageTable, optionExecQuality } from "./quality.js";
import { initTrack, applyUpdate, summarize, CLOSED } from "./tracker.js";
import { buildReport, reportMarkdown } from "./report.js";
import { loadOptionUniverse, fetchChain, selectOption, optionPlan, fetchContractQuote } from "./options.js";

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export class Engine {
  constructor() {
    this.feeds = {};
    this.clients = new Set();
    this.tracks = new Map();         // oppId → { opp, st }
    this.byKey = new Map();          // "spot:BTCUSDT" → Set(oppId)
    this.bearish = [];               // معلوماتٌ فقط (Spot)
    this.misses = [];                // خيارات: لم يُوجد عقدٌ مناسب
    this.optionUnderlyings = new Set();
    this.startedAt = Date.now();
    this.counters = { signals: { SPOT: 0, FUTURES: 0, OPTIONS: 0 }, dupes: 0, noOption: 0, errors: 0, lastSignalAt: null };
    this._settings = null;
    this.logs = [];
  }

  log(msg) {
    const line = `${new Date().toISOString()} ${msg}`;
    this.logs.push(line); if (this.logs.length > 300) this.logs.shift();
    console.log(line);
    try {
      const dir = path.join(path.dirname(ENV.DB_PATH), "logs");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, `engine-${line.slice(0, 10)}.log`), line + "\n");
    } catch { /* التسجيل لا يُسقط المحرّك */ }
  }

  /* الوقت المصحَّح بفرق ساعة بايننس (يُقاس عند بدء كل مغذٍّ). */
  now() {
    const f = this.feeds && (this.feeds.spot || this.feeds.futures);
    return Date.now() + (f ? f.stats.clockOffset : 0);
  }

  get settings() {
    if (!this._settings) this._settings = DB.getSettings();
    return this._settings;
  }
  updateSettings(patch) { this._settings = DB.saveSettings(patch); return this._settings; }
  resetSettings() { this._settings = DB.resetSettings(); return this._settings; }

  /* ----------------------------- البدء ----------------------------- */
  async start() {
    const want = new Set(ENV.MARKETS);

    /* أصول الخيارات: تُراقَب مهما كانت سيولتها. */
    if (want.has("OPTIONS")) {
      try {
        const u = await loadOptionUniverse();
        this.optionUnderlyings = new Set(u.underlyings.keys());
        this.log(`[options] أصول: ${[...this.optionUnderlyings].join(",")} عقود=${u.symbols.size}`);
      } catch (e) { this.log(`[options] تعذّر تحميل الكون: ${e.message}`); }
    }

    await this._loadOpenTracks();

    const mkFeed = market => new MarketFeed({
      market,
      getSettings: () => this.settings,
      forceTrack: () => [...this.optionUnderlyings],
      onCandleOpen: ev => this._onCandleOpen(ev),
      onTick: ev => this._onTick(ev),
      log: m => this.log(m)
    });
    const starts = [];
    if (want.has("SPOT") && this.settings.spot.enabled || want.has("OPTIONS")) {
      this.feeds.spot = mkFeed("spot");
      starts.push(this.feeds.spot.start().catch(e => this.log(`[spot] فشل البدء: ${e.message}`)));
    }
    if (want.has("FUTURES") && this.settings.futures.enabled || want.has("OPTIONS")) {
      this.feeds.futures = mkFeed("futures");
      starts.push(this.feeds.futures.start().catch(e => this.log(`[futures] فشل البدء: ${e.message}`)));
    }

    this._timers = [
      setInterval(() => this._sweep(), 20e3),
      setInterval(() => this._pollOptions().catch(e => this.log(`[options] متابعة: ${e.message}`)), 15e3),
      setInterval(() => this._broadcast({ type: "health", health: this.health() }), 10e3),
      setInterval(() => { try { DB.pruneEvalLog(); } catch { /* */ } }, 6 * 3600e3),
      setInterval(() => this._maybeReport(), 5 * 60e3)
    ];
    await Promise.all(starts);
    this.recoverOpen().catch(e => this.log(`[recover] ${e.message}`));
    this._maybeReport();
  }

  /* تقريرٌ آليٌّ كل 24 ساعةً فعلية منذ بدء المراقبة (يُستكمل ما فات بعد التوقّف). */
  _maybeReport() {
    try {
      const DAYMS = 24 * 3600e3;
      let last = DB.kvGet("last_report_at") || DB.kvGet("monitor_started_at");
      if (!last) return;
      const dir = path.join(path.dirname(ENV.DB_PATH), "reports");
      for (let guard = 0; guard < 30 && Date.now() >= last + DAYMS; guard++) {
        const from = last, to = last + DAYMS;
        const r = buildReport({ from, to, issued: DB.issuedBetween(from, to),
                                evalCounts: DB.evalCountsBetween(from, to), health: this.health() });
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date(to).toISOString().replace(/[:.]/g, "-").slice(0, 16);
        fs.writeFileSync(path.join(dir, `report-${stamp}.json`), JSON.stringify(r, null, 1));
        fs.writeFileSync(path.join(dir, `report-${stamp}.md`), reportMarkdown(r));
        DB.kvSet("last_report_at", to);
        last = to;
        this.log(`[report] أُنشئ تقرير ${stamp}: صدرت=${r.issued} منتهية=${r.closed}`);
      }
    } catch (e) { this.log(`[report] ${e.message}`); }
  }

  stop() {
    for (const f of Object.values(this.feeds)) f.stop();
    for (const t of this._timers || []) clearInterval(t);
  }

  /* ----------------------------- الاسترداد ----------------------------- */
  async _loadOpenTracks() {
    for (const opp of DB.listOpen()) {
      const st = opp.data.track;
      if (!st) continue;
      this._registerTrack(opp, st);
    }
    this.log(`[recover] فرصٌ مفتوحة محمّلة: ${this.tracks.size}`);
  }

  _registerTrack(opp, st) {
    this.tracks.set(opp.id, { opp, st });
    if (opp.market !== "OPTIONS") {
      const key = `${opp.market.toLowerCase()}:${opp.symbol}`;
      if (!this.byKey.has(key)) this.byKey.set(key, new Set());
      this.byKey.get(key).add(opp.id);
    }
  }

  _unregister(opp) {
    this.tracks.delete(opp.id);
    const key = `${opp.market.toLowerCase()}:${opp.symbol}`;
    this.byKey.get(key)?.delete(opp.id);
  }

  /* يعيد تشغيل ما فات أثناء التوقّف بشموع الدقيقة بترتيبها الزمني. */
  async recoverOpen() {
    for (const [id, { opp, st }] of [...this.tracks]) {
      if (opp.market === "OPTIONS") {
        DB.addEvent(id, this.now(), "gap", null, "إعادة تشغيل: لا تاريخ لحظي لعلاوة الخيار خلال التوقّف");
        continue;
      }
      const market = opp.market.toLowerCase();
      const from = Math.max(opp.last_check_ts || 0, opp.issued_at || 0);
      const now = this.now();
      if (now - from < 90e3) continue;
      try {
        const start = Math.floor(from / 60e3) * 60e3 + 60e3;       // أول دقيقةٍ كاملةٍ بعد الإصدار
        const rows = await fetchKlines(market, opp.symbol, "1m", { limit: 1000, startTime: start });
        let replayed = 0;
        for (const k of rows) {
          if (k.ct >= now - 1000) break;                        // الدقيقة الجارية تتولاها التيّارات
          const ts = k.ct;
          const is15Boundary = (k.t + 60e3) % M15 === 0;
          const res = applyUpdate(st, {
            ts, price: k.c, candleT: k.t, cumHi: k.h, cumLo: k.l,
            closedCandle: is15Boundary ? { c: k.c } : undefined
          });
          replayed++;
          this._persist(opp, st, res.events, ts);
          if (CLOSED.has(st.status)) break;
        }
        if (!CLOSED.has(st.status)) {
          /* الشمعة الجارية: ابدأ التتبّع من حدودها الحالية فلا تُحتسب قممٌ قديمة */
          const cur = Math.floor(now / M15) * M15;
          const inCur = rows.filter(k => k.t >= cur);
          st.seen = {
            t: cur,
            hi: inCur.length ? Math.max(...inCur.map(k => k.h)) : -Infinity,
            lo: inCur.length ? Math.min(...inCur.map(k => k.l)) : Infinity
          };
        }
        DB.addEvent(id, now, "recovered", null, `استُرجعت ${replayed} دقيقة بعد التوقّف`);
        DB.updateOpportunity(id, { last_check_ts: now });
      } catch (e) {
        this.log(`[recover] ${opp.symbol}: ${e.message}`);
      }
    }
  }

  /* ----------------------------- افتتاح الشمعة ----------------------------- */
  _onCandleOpen(ev) {
    const marketKey = ev.market;                       // spot | futures
    try {
      if (ev.skipped) {
        DB.logEval(this.now(), marketKey, ev.symbol, ev.timing.candleOpenTs, "skipped_" + ev.skipped, null);
        return;
      }
      const S = this.settings;
      const r = evaluateCandleOpen({
        closed15: ev.closed15, openTime: ev.openTime, openPrice: ev.openPrice,
        weekly: ev.weekly, weights: S.weights, planCfg: S.plan
      });
      if (!r.ok || !r.signal) return;

      const detectedAt = this.now();
      const optSource = this._optionSource(ev.symbol);

      if (marketKey === "spot") {
        if (r.side === "SELL") {
          this._pushBearish(ev, r, detectedAt);
        } else if (S.spot.enabled && ENV.MARKETS.includes("SPOT")) {
          this._issueLinear("SPOT", ev, r, detectedAt).catch(e => this._err("spot", ev.symbol, e));
        }
      } else if (S.futures.enabled && ENV.MARKETS.includes("FUTURES")) {
        this._issueLinear("FUTURES", ev, r, detectedAt).catch(e => this._err("futures", ev.symbol, e));
      }

      if (optSource === marketKey && S.options.enabled && ENV.MARKETS.includes("OPTIONS")) {
        this._issueOption(ev, r, detectedAt).catch(e => this._err("options", ev.symbol, e));
      }
    } catch (e) {
      this._err(marketKey, ev.symbol, e);
    }
  }

  _err(where, sym, e) {
    this.counters.errors++;
    this.log(`[${where}] خطأ ${sym}: ${e.stack?.split("\n").slice(0, 2).join(" | ") || e.message}`);
  }

  /* مصدر تحليل أصل الخيارات: السبوت إن وُجد الزوج، وإلا العقود الآجلة. */
  _optionSource(symbol) {
    if (!this.optionUnderlyings.has(symbol)) return null;
    if (this.feeds.spot?.meta.has(symbol)) return "spot";
    if (this.feeds.futures?.meta.has(symbol)) return "futures";
    return null;
  }

  _pushBearish(ev, r, detectedAt) {
    const item = {
      symbol: ev.symbol, ts: detectedAt, candleOpenTs: ev.openTime, price: ev.openPrice,
      score: r.score.total, hourConfirmed: r.hourConfirmed,
      note: "إشارة هبوط — معلومات فقط (لا بيع على المكشوف في Spot)"
    };
    this.bearish.unshift(item);
    if (this.bearish.length > 200) this.bearish.pop();
    this._broadcast({ type: "bearish", item });
  }

  /* ----------------------------- Spot / Futures ----------------------------- */
  async _fetchQuote(market, symbol) {
    const base = market === "spot" ? "/api/v3" : "/fapi/v1";
    const jobs = [withTimeout(bget(market, `${base}/ticker/bookTicker`, { symbol }, { weight: 2, retries: 0, timeoutMs: 2500 }), 3000)];
    if (market === "futures") {
      jobs.push(withTimeout(bget("futures", "/fapi/v1/premiumIndex", { symbol }, { weight: 1, retries: 0, timeoutMs: 2500 }), 3000));
      jobs.push(withTimeout(bget("futures", "/fapi/v1/openInterest", { symbol }, { weight: 1, retries: 0, timeoutMs: 2500 }), 3000));
    }
    const res = await Promise.allSettled(jobs);
    const out = { fetchedAt: this.now() };
    if (res[0].status === "fulfilled") {
      const b = res[0].value;
      out.bid = +b.bidPrice; out.ask = +b.askPrice;
      if (out.bid > 0 && out.ask > 0) { out.mid = (out.bid + out.ask) / 2; out.spreadPct = (out.ask - out.bid) / out.mid * 100; }
    }
    if (market === "futures") {
      if (res[1]?.status === "fulfilled") {
        out.fundingPct8h = +res[1].value.lastFundingRate * 100;
        out.markPrice = +res[1].value.markPrice;
        out.nextFundingTime = res[1].value.nextFundingTime;
      }
      if (res[2]?.status === "fulfilled") out.oiContracts = +res[2].value.openInterest;
    }
    return out;
  }

  async _issueLinear(market, ev, r, detectedAt) {
    const S = this.settings;
    const mk = market.toLowerCase();
    const feed = this.feeds[mk];
    const meta = ev.meta || feed.meta.get(ev.symbol) || {};
    const quote = await this._fetchQuote(mk, ev.symbol);
    const side = r.side;

    const lastTick = feed.getLast(ev.symbol);
    const haveQuote = quote.bid > 0 && quote.ask > 0;
    const entry = haveQuote ? (side === "BUY" ? quote.ask : quote.bid) : (lastTick ? lastTick.c : r.openPrice);
    const plan = buildPlan({ side, entry, atr15: r.atr15, cfg: S.plan });
    if (!r.atr15) { DB.logEval(this.now(), mk, ev.symbol, ev.openTime, "no_atr"); return; }

    const oiUsd = quote.oiContracts && (quote.markPrice || entry) ? quote.oiContracts * (quote.markPrice || entry) : null;
    const limits = S[mk];
    const execQ = execQualityLinear({
      market, spreadPct: quote.spreadPct, quoteVol24h: meta.quoteVolume24h, riskPct: plan.riskPct,
      costs: S.costs, maxSpreadPct: limits.maxSpreadPct, fundingPct8h: quote.fundingPct8h, oiUsd,
      side, minVol: limits.minQuoteVolume24h
    });
    const tier = tierOf(r.score.total, execQ.score, S.minExecQuality);

    const issuedAt = this.now();
    const timing = {
      candleOpenTs: ev.openTime, dataArrivedAt: ev.timing.arrivedAt, exchangeEventTs: ev.timing.eventTs,
      detectedAt, issuedAt, lateMs: ev.timing.lateMs, quoteAt: quote.fetchedAt
    };
    const feePct = market === "FUTURES" ? S.costs.futuresFeePct : S.costs.spotFeePct;
    const halfSpreadPct = (quote.spreadPct || 0) / 2;
    const expiresAt = issuedAt + S.plan.expiryMinutes * 60e3;

    const st = initTrack({
      side, entry, stop: plan.stop, targets: plan.targets, issuedAt, expiresAt,
      emitCandleT: ev.openTime, sma200: r.values.sma200,
      seenHi: lastTick ? lastTick.h : entry, seenLo: lastTick ? lastTick.l : entry,
      plan: S.plan, feePct, halfSpreadPct, costs: S.costs, market
    });

    const data = {
      signal: {
        values: r.values, conditions: r.conditions, hour: r.hour, hourConfirmed: r.hourConfirmed,
        trendUp: r.trendUp, levels: r.levels, atr15: r.atr15, openPrice: r.openPrice
      },
      score: r.score, exec: execQ, tier, tierLabel: TIER_LABEL[tier],
      plan: { ...plan, split: S.plan.tpSplit, expiresAt, breakeven: S.plan.breakevenAfterTp1 },
      quote: { ...quote, haveQuote, entrySource: haveQuote ? (side === "BUY" ? "ask" : "bid") : "last" },
      meta: { quoteVolume24h: meta.quoteVolume24h, contractType: meta.contractType, change24h: meta.change24h },
      timing,
      costModel: {
        feePctPerSide: feePct, slippageBps: S.costs.slippageBps, stopSlippageMult: S.costs.stopSlippageMult,
        halfSpreadPct, roundTripPct: execQ.roundTripCostPct
      },
      track: st
    };
    if (market === "FUTURES") {
      data.leverage = leverageTable({ side, entry, stop: plan.stop, leverages: S.leverages, mmrPct: meta.maintMarginPct });
      data.futures = { fundingPct8h: quote.fundingPct8h, oiUsd, markPrice: quote.markPrice, nextFundingTime: quote.nextFundingTime };
    }

    const row = {
      market, symbol: ev.symbol, side, candle_open_ts: ev.openTime, status: "new",
      score: r.score.total, exec_quality: execQ.score, hour_confirmed: r.hourConfirmed ? 1 : 0,
      entry, stop: plan.stop, tp1: plan.targets[0], tp2: plan.targets[1], tp3: plan.targets[2],
      candle_arrived_at: ev.timing.arrivedAt, detected_at: detectedAt, issued_at: issuedAt, data
    };
    this._insertAndTrack(row, st, market);
  }

  _insertAndTrack(row, st, market) {
    const { id, inserted } = DB.insertOpportunity(row);
    if (!inserted) { this.counters.dupes++; return null; }
    DB.addEvent(id, row.issued_at, "issued", row.entry, `الشمعة ${new Date(row.candle_open_ts).toISOString()}`);
    const opp = DB.getOpportunity(id);
    this._registerTrack(opp, st);
    this.counters.signals[market]++;
    this.counters.lastSignalAt = row.issued_at;
    this.log(`[فرصة] ${market} ${row.symbol}${row.instrument ? " " + row.instrument : ""} ${row.side} درجة=${row.score} جودة=${row.exec_quality}`);
    this._broadcast({ type: "opp_new", opp: this.publicOpp(opp) });
    return id;
  }

  /* ----------------------------- Options ----------------------------- */
  async _issueOption(ev, r, detectedAt) {
    const S = this.settings;
    const symbol = ev.symbol;
    const chain = await fetchChain(symbol);
    const now = this.now();
    const sel = selectOption({ direction: r.side, contracts: chain.contracts, now, settings: S.options });
    if (!sel.selected) {
      const miss = { symbol, side: r.side, ts: now, candleOpenTs: ev.openTime, rejected: sel.rejected,
                     considered: sel.considered, note: "لا عقد خيارات مناسب — لم تصدر فرصة" };
      this.misses.unshift(miss); if (this.misses.length > 100) this.misses.pop();
      this.counters.noOption++;
      DB.logEval(now, "options", symbol, ev.openTime, "no_contract", JSON.stringify(sel.rejected));
      this._broadcast({ type: "option_miss", item: miss });
      return;
    }
    const c = sel.selected;
    const feed = this.feeds[this._optionSource(symbol)] || this.feeds.spot || this.feeds.futures;
    const lastTick = feed?.getLast(symbol);
    const uEntry = lastTick ? lastTick.c : r.openPrice;
    const uPlan = buildPlan({ side: r.side, entry: uEntry, atr15: r.atr15, cfg: S.plan });
    const oplan = optionPlan({ contract: c, underlyingEntry: uEntry, underlyingTargets: uPlan.targets, settings: S.options });

    const dteHours = c.dteH;
    const execQ = optionExecQuality({
      spreadPct: c.spreadPct, openInterest: c.openInterest, volume24h: c.volume,
      thetaPctPerDay: c.thetaPctDay, dteHours, maxSpreadPct: S.options.maxSpreadPct
    });
    const tier = tierOf(r.score.total, execQ.score, S.minExecQuality);

    const issuedAt = this.now();
    const expiresAt = Math.min(issuedAt + S.plan.expiryMinutes * 60e3, c.expiry - 2 * 3600e3);
    const feeUsdPct = Math.min(0.0003 * uEntry * (c.unit || 1) / c.ask * 100, 12.5);
    /* الدخول عند Ask والمتابعة/الخروج عند Bid: السبريد كاملاً مدفوعٌ في السعرين،
       فلا يُضاف نصف سبريدٍ ثانٍ في التكلفة (كان يُحتسب مرّتين). */
    const halfSpreadPct = 0;
    const st = initTrack({
      side: "BUY", entry: oplan.entry, stop: oplan.stop, targets: oplan.targets, issuedAt, expiresAt,
      emitCandleT: 0, sma200: null, seenHi: c.bid, seenLo: c.bid,
      plan: { ...S.plan, cancelOnSmaClose: false }, feePct: feeUsdPct, halfSpreadPct, costs: S.costs, market: "OPTIONS"
    });

    const data = {
      signal: {
        values: r.values, conditions: r.conditions, hour: r.hour, hourConfirmed: r.hourConfirmed,
        trendUp: r.trendUp, levels: r.levels, atr15: r.atr15, openPrice: r.openPrice
      },
      underlying: { symbol, entry: uEntry, plan: uPlan, source: this._optionSource(symbol) },
      score: r.score, exec: execQ, tier, tierLabel: TIER_LABEL[tier],
      contract: {
        symbol: c.symbol, type: c.side, strike: c.strike, expiry: c.expiry, dteHours,
        delta: c.delta, gamma: c.gamma, theta: c.theta, vega: c.vega, markIV: c.markIV, bidIV: c.bidIV, askIV: c.askIV,
        bid: c.bid, ask: c.ask, mark: c.mark, spreadPct: c.spreadPct, volume24h: c.volume, openInterest: c.openInterest,
        thetaPctPerDay: c.thetaPctDay, unit: c.unit
      },
      selection: { score: c.selection.score, parts: c.selection.parts, runnersUp: sel.runnersUp.map(x => ({
        symbol: x.symbol, score: x.selection.score, delta: x.delta, ask: x.ask, spreadPct: x.spreadPct })),
        rejected: sel.rejected, considered: sel.considered },
      plan: {
        entry: oplan.entry, stop: oplan.stop, targets: oplan.targets, risk: oplan.entry - oplan.stop,
        riskPct: (oplan.entry - oplan.stop) / oplan.entry, maxLossPerContract: oplan.maxLossPerContract,
        cost: oplan.entry * (c.unit || 1), split: S.plan.tpSplit, expiresAt, modelled: true,
        note: "أهداف العلاوة تقديرٌ بدلتا/غاما/ثيتا؛ المتابعة الفعلية على سعر العقد (العرض Bid)."
      },
      timing: {
        candleOpenTs: ev.openTime, dataArrivedAt: ev.timing.arrivedAt, exchangeEventTs: ev.timing.eventTs,
        detectedAt, issuedAt, lateMs: ev.timing.lateMs
      },
      costModel: { feePctPerSide: feeUsdPct, halfSpreadPct, spreadPaidInPricesPct: c.spreadPct, slippageBps: S.costs.slippageBps },
      track: st
    };
    const row = {
      market: "OPTIONS", symbol, instrument: c.symbol, side: r.side, candle_open_ts: ev.openTime, status: "new",
      score: r.score.total, exec_quality: execQ.score, hour_confirmed: r.hourConfirmed ? 1 : 0,
      entry: oplan.entry, stop: oplan.stop, tp1: oplan.targets[0], tp2: oplan.targets[1], tp3: oplan.targets[2],
      candle_arrived_at: ev.timing.arrivedAt, detected_at: detectedAt, issued_at: issuedAt, data
    };
    this._insertAndTrack(row, st, "OPTIONS");
  }

  /* ----------------------------- المتابعة ----------------------------- */
  _onTick(ev) {
    const key = `${ev.market}:${ev.symbol}`;
    const ids = this.byKey.get(key);
    if (!ids || !ids.size) return;
    const { k } = ev;
    for (const id of [...ids]) {
      const t = this.tracks.get(id);
      if (!t) continue;
      const res = applyUpdate(t.st, {
        ts: ev.arrivedAt, price: k.c, candleT: k.t, cumHi: k.h, cumLo: k.l,
        closedCandle: ev.closed ? { c: k.c } : undefined
      });
      if (res.changed) this._persist(t.opp, t.st, res.events, ev.arrivedAt);
    }
  }

  /* مسحٌ دوري: الانتهاء لا يحتاج تحديث سعر، ويُحدَّث last_check للاسترداد. */
  _sweep() {
    const now = this.now();
    for (const { opp, st } of [...this.tracks.values()]) {
      if (opp.market === "OPTIONS") continue;
      const last = this.feeds[opp.market.toLowerCase()]?.getLast(opp.symbol);
      const price = last ? last.c : st.entry;
      const res = applyUpdate(st, { ts: now, price, candleT: st.seen.t, cumHi: st.seen.hi, cumLo: st.seen.lo });
      if (res.changed) this._persist(opp, st, res.events, now);
      DB.updateOpportunity(opp.id, { last_check_ts: now });
    }
  }

  async _pollOptions() {
    const open = [...this.tracks.values()].filter(t => t.opp.market === "OPTIONS");
    for (const { opp, st } of open) {
      let q;
      try { q = await fetchContractQuote(opp.instrument); } catch { continue; }
      const now = this.now();
      const price = q.bid > 0 ? q.bid : (q.mark > 0 ? q.mark : null);
      if (price == null) continue;
      const res = applyUpdate(st, { ts: now, price, candleT: 0, cumHi: price, cumLo: price });
      st.lastQuote = { bid: q.bid, ask: q.ask, mark: q.mark, at: now };
      if (res.changed) this._persist(opp, st, res.events, now);
      else DB.updateOpportunity(opp.id, { last_check_ts: now, data: { ...opp.data, track: st } });
    }
  }

  _persist(opp, st, events, ts) {
    for (const e of events) DB.addEvent(opp.id, ts, e.type, e.price, e.note);
    const fields = { status: st.status, last_check_ts: ts };
    opp.data.track = st;
    fields.data = opp.data;
    if (CLOSED.has(st.status)) {
      fields.closed_at = st.closedAt;
      fields.outcome = st.status;
      fields.exit_price = st.final.exitPrice;
      fields.r_net = Math.round(st.final.rNet * 1000) / 1000;
      fields.pnl_pct_net = Math.round(st.final.pnlPctNet * 1000) / 1000;
      opp.data.result = summarize(st);
      this._unregister(opp);
    }
    DB.updateOpportunity(opp.id, fields);
    opp.status = st.status;
    this._broadcast({
      type: "opp_update", id: opp.id, status: st.status, ts, events,
      r_net: fields.r_net ?? null, exit_price: fields.exit_price ?? null, closed_at: fields.closed_at ?? null
    });
  }

  /* ----------------------------- بثّ ----------------------------- */
  addClient(res) { this.clients.add(res); }
  removeClient(res) { this.clients.delete(res); }
  _broadcast(obj) {
    if (!this.clients.size) return;
    const line = `data: ${JSON.stringify(obj)}\n\n`;
    for (const c of this.clients) { try { c.write(line); } catch { this.clients.delete(c); } }
  }

  /* نسخةٌ للعرض (بلا حالة المتابعة الداخلية الثقيلة) */
  publicOpp(o) {
    const { track, score: scoreDetail, ...d } = o.data;
    return {
      scoreDetail,
      id: o.id, market: o.market, symbol: o.symbol, instrument: o.instrument, side: o.side,
      candle_open_ts: o.candle_open_ts, status: o.status, score: o.score, exec_quality: o.exec_quality,
      hour_confirmed: o.hour_confirmed, entry: o.entry, stop: o.stop, tp1: o.tp1, tp2: o.tp2, tp3: o.tp3,
      candle_arrived_at: o.candle_arrived_at, detected_at: o.detected_at, issued_at: o.issued_at,
      seen_at: o.seen_at, closed_at: o.closed_at, exit_price: o.exit_price, outcome: o.outcome,
      r_net: o.r_net, pnl_pct_net: o.pnl_pct_net,
      tpsHit: track ? track.tpsHit : null, currentStop: track ? track.stop : null,
      lastPrice: this._lastPrice(o, track),
      ...d
    };
  }

  _lastPrice(o, track) {
    if (o.market === "OPTIONS") return track?.lastQuote?.bid ?? null;
    return this.feeds[o.market.toLowerCase()]?.getLast(o.symbol)?.c ?? null;
  }

  /* ----------------------------- الصحّة ----------------------------- */
  health() {
    const feeds = {};
    for (const [k, f] of Object.entries(this.feeds)) feeds[k] = f.health();
    const open = this.tracks.size;
    return {
      now: this.now(), startedAt: this.startedAt, uptimeSec: Math.round((this.now() - this.startedAt) / 1000),
      feeds, sources: sourceHealth(), openOpportunities: open, counters: this.counters,
      optionUnderlyings: [...this.optionUnderlyings],
      monitorStartedAt: DB.kvGet("monitor_started_at"), pid: process.pid,
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version
    };
  }
}
