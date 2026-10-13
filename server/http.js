/* =====================================================================
   خادم HTTP: واجهة JSON + بثّ SSE + ملفّاتٌ ثابتة بقائمةٍ بيضاء.

   لا شيءَ حسّاسٌ هنا: بيانات Binance عامة. تعديل الإعدادات يتطلّب
   ADMIN_TOKEN إن حُدِّد في البيئة، والربط الافتراضي على 127.0.0.1.
   ===================================================================== */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ENV } from "./config.js";
import * as DB from "./db.js";
import { fetchKlines } from "./binance.js";
import { buildStats } from "./stats.js";
import { M15, smaAt } from "./strategy.js";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"
};

/* قائمةٌ بيضاء: ما عداها لا يُخدَم (قاعدة البيانات، الخادم، الاختبارات). */
const STATIC_OK = [
  /^\/$/, /^\/index\.html$/, /^\/platform\.html$/, /^\/sw\.js$/, /^\/js\/[\w.-]+\.js$/,
  /^\/platform\/[\w.-]+\.(js|css|svg)$/, /^\/data\/macro\.json$/
];

function send(res, code, body, headers = {}) {
  const buf = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": typeof body === "string" || Buffer.isBuffer(body) ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers
  });
  res.end(buf);
}

async function readJson(req) {
  let s = "";
  for await (const ch of req) { s += ch; if (s.length > 1e5) throw new Error("too large"); }
  return s ? JSON.parse(s) : {};
}

const chartCache = new Map();

async function buildChart(engine, opp) {
  const cached = chartCache.get(opp.id);
  if (cached && Date.now() - cached.at < (opp.closed_at ? 3600e3 : 20e3)) return cached.v;

  const market = opp.market === "OPTIONS" ? (opp.data.underlying?.source || "spot") : opp.market.toLowerCase();
  const symbol = opp.symbol;
  const from = opp.candle_open_ts - 140 * M15;
  const to = opp.closed_at ? Math.min(opp.closed_at + 24 * M15, Date.now()) : Date.now();
  const warm = 205 * M15;
  let rows = [];
  let start = from - warm;
  /* 1000 شمعةٍ كحدٍّ أعلى لكل طلب */
  while (start < to && rows.length < 2000) {
    const part = await fetchKlines(market, symbol, "15m", { limit: 1000, startTime: start, endTime: to });
    if (!part.length) break;
    rows = rows.concat(part);
    const last = part[part.length - 1].t;
    if (part.length < 1000 || last + M15 >= to) break;
    start = last + M15;
  }
  const now = Date.now();
  const closed = rows.filter(k => k.ct < now);
  const live = rows.find(k => k.ct >= now) || null;
  const idx0 = closed.findIndex(k => k.t >= from);
  const series = [];
  /* SMA «قبل الافتتاح»: متوسّط إغلاقات الشموع السابقة فقط — كما في الاستراتيجية. */
  for (let i = Math.max(idx0, 0); i < closed.length; i++) {
    series.push({
      t: closed[i].t, o: closed[i].o, h: closed[i].h, l: closed[i].l, c: closed[i].c, v: closed[i].v,
      sma15: smaAt(closed, i, 15), sma35: smaAt(closed, i, 35), sma50: smaAt(closed, i, 50), sma200: smaAt(closed, i, 200)
    });
  }
  const v = {
    market, symbol, interval: "15m", candles: series,
    live: live ? { t: live.t, o: live.o, h: live.h, l: live.l, c: live.c } : null,
    smaNote: "SMA المعروضة محسوبة من الشموع المغلقة السابقة لكل شمعة (بدون الشمعة نفسها)"
  };
  chartCache.set(opp.id, { at: Date.now(), v });
  if (chartCache.size > 100) chartCache.delete(chartCache.keys().next().value);
  return v;
}

export function startHttp(engine) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    try {
      if (p.startsWith("/api/")) return await api(engine, req, res, url, p);
      return serveStatic(req, res, p);
    } catch (e) {
      engine.log(`[http] ${req.method} ${p}: ${e.message}`);
      if (!res.headersSent) send(res, 500, { error: e.message });
    }
  });
  server.listen(ENV.PORT, ENV.HOST, () => engine.log(`الخادم: http://${ENV.HOST}:${ENV.PORT}`));
  return server;
}

function serveStatic(req, res, p) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
  if (!STATIC_OK.some(rx => rx.test(p))) return send(res, 404, "not found");
  const rel = p === "/" ? "index.html" : p.slice(1);
  const file = path.join(ENV.ROOT, rel);
  if (!file.startsWith(ENV.ROOT)) return send(res, 403, "forbidden");
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "not found");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"
    });
    res.end(buf);
  });
}

async function api(engine, req, res, url, p) {
  const q = Object.fromEntries(url.searchParams);

  if (p === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store",
      Connection: "keep-alive", "X-Accel-Buffering": "no"
    });
    res.write(`data: ${JSON.stringify({ type: "hello", now: Date.now() })}\n\n`);
    engine.addClient(res);
    const hb = setInterval(() => { try { res.write(": hb\n\n"); } catch { /* */ } }, 20000);
    req.on("close", () => { clearInterval(hb); engine.removeClient(res); });
    return;
  }

  if (p === "/api/health") return send(res, 200, engine.health());

  if (p === "/api/overview") return send(res, 200, overview(engine));

  if (p === "/api/settings" && req.method === "GET") return send(res, 200, engine.settings);
  if (p === "/api/settings" && req.method === "PUT") {
    if (ENV.ADMIN_TOKEN && req.headers["x-admin-token"] !== ENV.ADMIN_TOKEN) return send(res, 401, { error: "unauthorized" });
    const patch = await readJson(req);
    return send(res, 200, engine.updateSettings(patch));
  }
  if (p === "/api/settings/reset" && req.method === "POST") {
    if (ENV.ADMIN_TOKEN && req.headers["x-admin-token"] !== ENV.ADMIN_TOKEN) return send(res, 401, { error: "unauthorized" });
    return send(res, 200, engine.resetSettings());
  }

  if (p === "/api/opps") {
    const rows = DB.queryOpportunities({
      market: q.market || undefined, status: q.status || undefined, side: q.side || undefined,
      symbol: q.q ? q.q.toUpperCase() : undefined,
      minScore: q.minScore ? +q.minScore : undefined,
      since: q.since ? +q.since : undefined,
      open: q.open === "1", closed: q.closed === "1",
      sort: q.sort || "issued_at", dir: q.dir || "DESC",
      limit: Math.min(+q.limit || 200, 1000), offset: +q.offset || 0
    });
    let list = rows.map(r => engine.publicOpp(r));
    if (q.tier) list = list.filter(o => o.tier === q.tier);
    if (q.hour === "1") list = list.filter(o => o.hour_confirmed);
    if (q.hour === "0") list = list.filter(o => !o.hour_confirmed);
    if (q.minExec) list = list.filter(o => (o.exec_quality ?? 0) >= +q.minExec);
    return send(res, 200, { now: Date.now(), count: list.length, items: list });
  }

  let m;
  if ((m = p.match(/^\/api\/opps\/(\d+)$/))) {
    const o = DB.getOpportunity(+m[1]);
    if (!o) return send(res, 404, { error: "not found" });
    const pub = engine.publicOpp(o);
    pub.events = o.events;
    pub.track = o.data.track ? {
      legs: o.data.track.legs, stop: o.data.track.stop, tpsHit: o.data.track.tpsHit, expiresAt: o.data.track.expiresAt
    } : null;
    return send(res, 200, pub);
  }
  if ((m = p.match(/^\/api\/opps\/(\d+)\/chart$/))) {
    const o = DB.getOpportunity(+m[1]);
    if (!o) return send(res, 404, { error: "not found" });
    return send(res, 200, await buildChart(engine, o));
  }
  if ((m = p.match(/^\/api\/opps\/(\d+)\/seen$/)) && req.method === "POST") {
    DB.markSeen(+m[1], Date.now());
    return send(res, 200, { ok: true });
  }

  if (p === "/api/stats") {
    const since = q.days ? Date.now() - (+q.days) * 86400e3 : 0;
    const closed = DB.closedForStats(since);
    return send(res, 200, buildStats(closed, { openCount: engine.tracks.size }));
  }

  if (p === "/api/bearish") return send(res, 200, { items: engine.bearish });
  if (p === "/api/misses") return send(res, 200, { items: engine.misses });

  if (p === "/api/universe") {
    const out = {};
    for (const [k, f] of Object.entries(engine.feeds)) {
      out[k] = {
        total: f.meta.size, tracked: f.stats.tracked,
        symbols: [...f.meta.values()].filter(x => f.trackedSet?.has(x.symbol))
          .map(x => ({ symbol: x.symbol, quoteVolume24h: x.quoteVolume24h, contractType: x.contractType,
                       ready: !!f.state.get(x.symbol)?.ready, candles: f.state.get(x.symbol)?.closed.length || 0 }))
      };
    }
    return send(res, 200, out);
  }

  if (p === "/api/logs") return send(res, 200, { lines: engine.logs.slice(-150) });

  return send(res, 404, { error: "unknown endpoint" });
}

function overview(engine) {
  const spot = engine.feeds.spot, fut = engine.feeds.futures;
  const feed = spot || fut;
  const sym = "BTCUSDT";
  const closed = feed?.getCandles(sym) || [];
  const last = feed?.getLast(sym) || null;
  const meta = feed?.meta.get(sym) || null;
  let trend = null;
  if (closed.length >= 201) {
    const N = closed.length;
    const px = last ? last.c : closed[N - 1].c;
    const s50 = smaAt(closed, N, 50), s200 = smaAt(closed, N, 200), s35 = smaAt(closed, N, 35);
    trend = {
      price: px, sma35: s35, sma50: s50, sma200: s200,
      state: px > s200 && s50 > s200 ? "صاعد" : px < s200 && s50 < s200 ? "هابط" : "مختلط"
    };
  }
  const open = DB.queryOpportunities({ open: true, limit: 500 });
  const counts = { SPOT: 0, FUTURES: 0, OPTIONS: 0 };
  for (const o of open) counts[o.market]++;
  const recent = DB.queryOpportunities({ limit: 12 }).map(o => engine.publicOpp(o));
  const best = open.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6).map(o => engine.publicOpp(o));
  return {
    now: Date.now(), btc: { price: last ? last.c : null, change24h: meta ? meta.change24h : null, trend },
    openCounts: counts, recent, best,
    feeds: Object.fromEntries(Object.entries(engine.feeds).map(([k, f]) => [k, {
      tracked: f.stats.tracked, ready: f.health().readySymbols, live: f.health().liveSymbols }])),
    lastSignalAt: engine.counters.lastSignalAt
  };
}
