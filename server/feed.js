/* =====================================================================
   مغذّي سوقٍ واحد (Spot أو Futures).

   المسؤوليات:
   1) اكتشاف الرموز من exchangeInfo + سيولة 24س وتحديثها دورياً.
   2) تهيئة الشموع المغلقة (REST) ثم الاستمرار عبر WebSocket.
   3) كشف افتتاح شمعة 15 دقيقة جديدة **من أول رسالةٍ تحمل بدايتها**
      وتسليمها للمحرّك فوراً — دون انتظار إغلاقها.
   4) ترقيع الفجوات بعد انقطاع الاتصال.

   لماذا رسالة kline لا رسالة trade: أول تحديثٍ لشمعةٍ جديدة يحمل
   `k.o` = سعر أول صفقةٍ فيها = افتتاحها الحقيقي. فلا حاجة لاشتراك
   صفقاتٍ لكل رمز (آلاف الرسائل في الثانية).
   ===================================================================== */
import { bget, fetchKlines, serverTime } from "./binance.js";
import { WS_HOSTS, ENV } from "./config.js";
import { StreamGroup } from "./ws.js";
import { M15, WEEK, utcWeekStart } from "./strategy.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const KEEP = 900;                       // شموع 15د محفوظة لكل رمز
const STABLES = new Set(["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "AEUR", "EUR", "USD1", "USDE",
  "XUSD", "PAXG_", "EURI", "UST", "USTC", "BFUSD", "RLUSD", "USDS", "PYUSD", "GUSD", "SUSD", "LUSDT"]);

export class MarketFeed {
  /**
   * @param {object} o
   * @param {"spot"|"futures"} o.market
   * @param {()=>object} o.getSettings
   * @param {(ev:object)=>void} o.onCandleOpen  حدث افتتاح شمعةٍ جديدة
   * @param {(ev:object)=>void} o.onTick        كل تحديث kline (للمتابعة)
   * @param {(extra:string[])=>string[]} [o.forceTrack]  رموز تُراقَب مهما كانت سيولتها
   */
  constructor({ market, getSettings, onCandleOpen, onTick, forceTrack, log }) {
    this.market = market;
    this.getSettings = getSettings;
    this.onCandleOpen = onCandleOpen;
    this.onTick = onTick;
    this.forceTrack = forceTrack || (() => []);
    this.log = log || (() => {});
    this.meta = new Map();           // symbol → معلومات العقد/الزوج
    this.state = new Map();          // symbol → حالة الشموع
    this.stats = { universe: 0, tracked: 0, seeded: 0, seedFailed: 0, seeding: false, evalCount: 0,
                   signals: 0, lateSkipped: 0, startedAt: Date.now(), universeAt: 0, clockOffset: 0 };
    this.group = null;
    this.maxLateMs = 90e3;
  }

  now() { return Date.now() + this.stats.clockOffset; }

  /* ----------------------------- الاكتشاف ----------------------------- */
  async discover() {
    const set = this.getSettings()[this.market];
    const isSpot = this.market === "spot";
    const [info, tickers] = await Promise.all([
      bget(this.market, isSpot ? "/api/v3/exchangeInfo" : "/fapi/v1/exchangeInfo", {}, { weight: isSpot ? 20 : 1 }),
      bget(this.market, isSpot ? "/api/v3/ticker/24hr" : "/fapi/v1/ticker/24hr", {}, { weight: isSpot ? 80 : 40 })
    ]);
    const vol = new Map(tickers.map(t => [t.symbol, { qv: +t.quoteVolume, last: +t.lastPrice, chg: +t.priceChangePercent }]));
    const out = new Map();
    for (const s of info.symbols) {
      if (s.status !== "TRADING" || s.quoteAsset !== "USDT") continue;
      if (isSpot) {
        if (!s.isSpotTradingAllowed) continue;
        if (STABLES.has(s.baseAsset)) continue;
        if (/(UP|DOWN|BULL|BEAR)$/.test(s.baseAsset)) continue;
      } else {
        const okType = s.contractType === "PERPETUAL" || s.contractType === "TRADIFI_PERPETUAL" ||
          (set.includeQuarterly && /QUARTER/.test(s.contractType));
        if (!okType) continue;
      }
      const v = vol.get(s.symbol) || { qv: 0, last: 0, chg: 0 };
      out.set(s.symbol, {
        symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset,
        contractType: s.contractType || "SPOT",
        quoteVolume24h: v.qv, last: v.last, change24h: v.chg,
        maintMarginPct: s.maintMarginPercent ? +s.maintMarginPercent : null,
        onboardDate: s.onboardDate || null,
        pricePrecision: s.pricePrecision
      });
    }
    this.meta = out;
    this.stats.universe = out.size;
    this.stats.universeAt = Date.now();
    return out;
  }

  /* الرموز المراقَبة = الكون المصفّى بالسيولة + المفروضة (أصول الخيارات). */
  pickTracked() {
    const set = this.getSettings()[this.market];
    const force = new Set(this.forceTrack());
    let list = [...this.meta.values()].filter(m => m.quoteVolume24h >= set.minQuoteVolume24h || force.has(m.symbol));
    list.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
    if (ENV.MAX_SYMBOLS > 0) list = list.slice(0, ENV.MAX_SYMBOLS);
    return list.map(m => m.symbol);
  }

  /* ----------------------------- التهيئة ----------------------------- */
  _st(symbol) {
    let s = this.state.get(symbol);
    if (!s) {
      s = { symbol, closed: [], curT: 0, ready: false, pending: [], weekly: null, weeklyFor: 0,
            lastMsgAt: 0, last: null, lastEvalT: 0 };
      this.state.set(symbol, s);
    }
    return s;
  }

  async seedOne(symbol) {
    const s = this._st(symbol);
    const rows = await fetchKlines(this.market, symbol, "15m", { limit: 1000 });
    const now = this.now();
    const closed = rows.filter(k => k.ct < now);
    /* ادمج ما وصل عبر WS أثناء التهيئة */
    const lastT = closed.length ? closed[closed.length - 1].t : 0;
    for (const p of s.pending) if (p.t > lastT) closed.push(p);
    s.pending = [];
    s.closed = closed.slice(-KEEP);
    s.ready = s.closed.length > 0;
    await this.refreshWeekly(symbol).catch(() => {});
    return s;
  }

  async refreshWeekly(symbol) {
    const s = this._st(symbol);
    const wk = utcWeekStart(this.now());
    const rows = await fetchKlines(this.market, symbol, "1w", { limit: 3 });
    const prev = rows.find(k => k.t === wk - WEEK);
    s.weekly = prev ? { high: prev.h, low: prev.l } : null;
    s.weeklyFor = wk;
  }

  async seedAll(symbols) {
    this.stats.seeding = true;
    let i = 0, ok = 0, fail = 0;
    const worker = async () => {
      while (i < symbols.length) {
        const sym = symbols[i++];
        try { await this.seedOne(sym); ok++; }
        catch (e) { fail++; this.log(`[${this.market}] seed ${sym} فشل: ${e.message}`); }
        this.stats.seeded = ok; this.stats.seedFailed = fail;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.stats.seeding = false;
  }

  /* ----------------------------- التشغيل ----------------------------- */
  async start() {
    try { this.stats.clockOffset = (await serverTime(this.market)) - Date.now(); } catch { /* */ }
    await this.discover();
    const tracked = this.pickTracked();
    this.stats.tracked = tracked.length;
    this.trackedSet = new Set(tracked);
    this._connect(tracked);
    await this.seedAll(tracked);
    this.log(`[${this.market}] كون=${this.stats.universe} مراقَب=${tracked.length} مهيّأ=${this.stats.seeded} فشل=${this.stats.seedFailed}`);

    this._timers = [
      setInterval(() => this._refreshUniverse().catch(e => this.log(`[${this.market}] تحديث الكون: ${e.message}`)), 10 * 60e3),
      setInterval(() => this._weeklyRollover().catch(() => {}), 60e3)
    ];
  }

  stop() {
    this.group?.stop();
    for (const t of this._timers || []) clearInterval(t);
  }

  _connect(symbols) {
    const streams = symbols.map(s => `${s.toLowerCase()}@kline_15m`);
    this.group = new StreamGroup({
      name: this.market,
      hosts: WS_HOSTS[this.market],
      streams,
      perConn: 150,
      onMessage: (msg, idx) => this._onMsg(msg, { group: this.group, idx }),
      onReconnect: (idx, streamNames) => this._patch(streamNames.map(x => x.split("@")[0].toUpperCase())),
      onStatus: () => {}
    });
    this.group.start();
  }

  async _refreshUniverse() {
    await this.discover();
    const next = this.pickTracked();
    const fresh = next.filter(s => !this.trackedSet.has(s));
    this.stats.tracked = next.length;
    if (!fresh.length) return;
    /* رموزٌ جديدة: اتصالٌ إضافي صغير لها */
    this.log(`[${this.market}] رموز جديدة: ${fresh.join(",")}`);
    for (const s of fresh) this.trackedSet.add(s);
    await this.seedAll(fresh);
    const extra = new StreamGroup({
      name: this.market + "+", hosts: WS_HOSTS[this.market],
      streams: fresh.map(s => `${s.toLowerCase()}@kline_15m`), perConn: 150,
      onMessage: (msg, idx) => this._onMsg(msg, { group: extra, idx }),
      onReconnect: (idx, names) => this._patch(names.map(x => x.split("@")[0].toUpperCase()))
    });
    extra.start();
    this.extraGroups = (this.extraGroups || []).concat(extra);
  }

  async _weeklyRollover() {
    const wk = utcWeekStart(this.now());
    for (const s of this.state.values()) {
      if (s.weeklyFor && s.weeklyFor !== wk && this.now() - wk > 5000) {
        s.weeklyFor = wk;              // امنع التكرار قبل الجلب
        await this.refreshWeekly(s.symbol).catch(() => {});
      }
    }
  }

  async _patch(symbols) {
    for (const sym of symbols) {
      try {
        const s = this._st(sym);
        const rows = await fetchKlines(this.market, sym, "15m", { limit: 12 });
        const now = this.now();
        for (const k of rows) {
          if (k.ct >= now) continue;
          const last = s.closed.length ? s.closed[s.closed.length - 1].t : 0;
          if (k.t > last) s.closed.push(k);
        }
        if (s.closed.length > KEEP) s.closed.splice(0, s.closed.length - KEEP);
      } catch (e) { this.log(`[${this.market}] ترقيع ${sym}: ${e.message}`); }
      await sleep(40);
    }
  }

  /* ----------------------------- الرسائل ----------------------------- */
  _connOpenedAt(ref) {
    return ref?.group?.conns?.[ref.idx]?.openedAt || 0;
  }

  _onMsg(msg, connIdx) {
    const d = msg.data;
    if (!d || d.e !== "kline" || !d.k) return;
    const arrivedAt = Date.now();
    const k = d.k;
    const symbol = d.s;
    const s = this._st(symbol);
    s.lastMsgAt = arrivedAt;
    const c = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, q: +k.q };
    s.last = c;

    /* ---- شمعةٌ جديدة؟ (أول رسالةٍ بهذا الـ t) ---- */
    if (s.curT !== k.t) {
      const prevCurT = s.curT;
      s.curT = k.t;
      if (s.ready) {
        /* لا تدخل شمعةٌ مفتوحة في closed. إن فاتنا إغلاق السابقة نُرقّع أولاً. */
        const last = s.closed.length ? s.closed[s.closed.length - 1].t : 0;
        const connAt = this._connOpenedAt(connIdx);
        const wasConnected = connAt && connAt <= k.t + this.maxLateMs;
        const lateMs = arrivedAt - k.t;
        const timing = { candleOpenTs: k.t, arrivedAt, eventTs: d.E, lateMs };
        if (!wasConnected && lateMs > this.maxLateMs) {
          this.stats.lateSkipped++;
          this.onCandleOpen({ market: this.market, symbol, skipped: "late_start", timing });
        } else if (last >= k.t) {
          /* شمعةٌ مغلقةٌ مسبقاً بنفس الـ t — لا تقييم */
        } else if (prevCurT && last < prevCurT && !k.x) {
          /* إغلاق الشمعة السابقة لم يصل بعد: نرقّع ثم نقيّم */
          this._evalAfterPatch(s, c, timing, connIdx);
        } else {
          this._evaluate(s, c, timing);
        }
      } else {
        s.pendingOpenSeen = k.t;
      }
    }

    /* ---- إغلاق شمعة ---- */
    if (k.x) {
      if (s.ready) {
        const last = s.closed.length ? s.closed[s.closed.length - 1].t : 0;
        if (c.t > last) {
          s.closed.push(c);
          if (s.closed.length > KEEP) s.closed.shift();
        }
      } else {
        s.pending.push(c);
      }
    }

    this.onTick({ market: this.market, symbol, k: c, closed: !!k.x, arrivedAt, eventTs: d.E });
  }

  async _evalAfterPatch(s, c, timing, connIdx) {
    await this._patch([s.symbol]);
    timing.patchedAt = Date.now();
    this._evaluate(s, c, timing);
  }

  _evaluate(s, c, timing) {
    if (s.lastEvalT === c.t) return;        // مرّةً واحدة لكل رمزٍ وشمعة
    s.lastEvalT = c.t;
    this.stats.evalCount++;
    this.onCandleOpen({
      market: this.market, symbol: s.symbol, openTime: c.t, openPrice: c.o,
      closed15: s.closed, weekly: s.weekly && s.weeklyFor === utcWeekStart(c.t) ? s.weekly : null,
      timing, meta: this.meta.get(s.symbol)
    });
  }

  /* ----------------------------- واجهة قراءة ----------------------------- */
  getCandles(symbol) { return this.state.get(symbol)?.closed || []; }
  getLast(symbol) { return this.state.get(symbol)?.last || null; }

  health() {
    const st = this.group?.status() || {};
    const extra = (this.extraGroups || []).map(g => g.status());
    const states = [...this.state.values()];
    const now = Date.now();
    const fresh = states.filter(s => now - s.lastMsgAt < 90e3).length;
    return {
      market: this.market,
      universe: this.stats.universe,
      tracked: this.stats.tracked,
      seeded: this.stats.seeded,
      seedFailed: this.stats.seedFailed,
      seeding: this.stats.seeding,
      readySymbols: states.filter(s => s.ready).length,
      liveSymbols: fresh,
      evaluations: this.stats.evalCount,
      lateSkipped: this.stats.lateSkipped,
      ws: { ...st, extra },
      universeAt: this.stats.universeAt,
      clockOffsetMs: this.stats.clockOffset
    };
  }
}
