import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { rankGainers, futuresFor, diffLists } from "../server/gainers.js";
import { evaluateMR20, planMR20, wilson } from "../server/selective.js";

const info = new Map([
  ["AAAUSDT", { base: "AAA", quote: "USDT", status: "TRADING" }],
  ["BBBUSDT", { base: "BBB", quote: "USDT", status: "TRADING" }],
  ["CCCUSDT", { base: "CCC", quote: "USDT", status: "BREAK" }],
  ["DDDBTC", { base: "DDD", quote: "BTC", status: "TRADING" }],
  ["USDCUSDT", { base: "USDC", quote: "USDT", status: "TRADING" }],
  ["XUPUSDT", { base: "XUP", quote: "USDT", status: "TRADING" }],
  ["PEPEUSDT", { base: "PEPE", quote: "USDT", status: "TRADING" }]
]);
const tk = (symbol, chg, qv = 1e6) => ({ symbol, priceChangePercent: String(chg), quoteVolume: String(qv), lastPrice: "1" });

test("الأعلى ربحاً: ترتيب تنازلي بـ priceChangePercent، USDT النشطة فقط، بلا مستقرّة ولا مرفوعة", () => {
  const r = rankGainers([tk("AAAUSDT", 5), tk("BBBUSDT", 30), tk("CCCUSDT", 99), tk("DDDBTC", 80), tk("USDCUSDT", 1), tk("XUPUSDT", 50), tk("PEPEUSDT", 12)],
    { spotInfo: info, topN: 10 });
  assert.deepEqual(r.map(x => x.symbol), ["BBBUSDT", "PEPEUSDT", "AAAUSDT"]);
  assert.equal(r[0].rank, 1);
});

test("الأعلى ربحاً: حدّ العدد والحجم الأدنى", () => {
  const r = rankGainers([tk("AAAUSDT", 5, 10), tk("BBBUSDT", 30, 1e6), tk("PEPEUSDT", 12, 1e6)], { spotInfo: info, topN: 1, minQuoteVolume24h: 100 });
  assert.deepEqual(r.map(x => x.symbol), ["BBBUSDT"]);
});

test("عقد Futures المقابل: مباشر أو بادئة 1000، وإلا null", () => {
  const fut = new Set(["AAAUSDT", "1000PEPEUSDT"]);
  assert.equal(futuresFor("AAA", fut), "AAAUSDT");
  assert.equal(futuresFor("PEPE", fut), "1000PEPEUSDT");
  assert.equal(futuresFor("BBB", fut), null);
});

test("الإضافة والإزالة بين قائمتين", () => {
  const d = diffLists([{ symbol: "A" }, { symbol: "B" }], [{ symbol: "B" }, { symbol: "C" }]);
  assert.deepEqual(d.added.map(x => x.symbol), ["C"]);
  assert.deepEqual(d.removed.map(x => x.symbol), ["A"]);
});

/* سلاسل اصطناعية: يومي صاعد + ساعةٌ تنهار في آخرها → RSI منخفض جداً */
function series({ crash = true, dailyUp = true }) {
  const h1 = [], d1 = [];
  let p = 100;
  for (let i = 0; i < 300; i++) { const c = crash && i > 285 ? p * 0.985 : p * (1 + (i % 2 ? 0.002 : -0.0015)); h1.push({ t: i * 3600e3, o: p, h: Math.max(p, c) * 1.001, l: Math.min(p, c) * 0.999, c }); p = c; }
  let q = 100;
  for (let i = 0; i < 120; i++) { const c = q * (dailyUp ? 1.004 : 0.996); d1.push({ t: i * 86400e3, o: q, h: Math.max(q, c), l: Math.min(q, c), c }); q = c; }
  return { h1, d1 };
}

test("MR20: تُستوفى فقط مع RSI<20 واتجاهين يوميّين صاعدين", () => {
  const up = series({});
  const ok = evaluateMR20({ h1: up.h1, d1: up.d1, btcD1: up.d1 });
  assert.ok(ok.rsi < 20, "rsi=" + ok.rsi);
  assert.equal(ok.pass, true);
  const btcDown = series({ dailyUp: false });
  assert.equal(evaluateMR20({ h1: up.h1, d1: up.d1, btcD1: btcDown.d1 }).pass, false);
  const calm = series({ crash: false });
  assert.equal(evaluateMR20({ h1: calm.h1, d1: calm.d1, btcD1: calm.d1 }).pass, false);
});

test("MR20: الخطة — وقف 1.5×ATR وأهداف 1/2/3R", () => {
  const p = planMR20(100, 2);
  assert.equal(p.stop, 97);
  assert.deepEqual(p.targets, [103, 106, 109]);
});

test("فاصل Wilson يحتوي النسبة ويضيق مع العيّنة", () => {
  const [a, b] = wilson(0.584, 89), [c, d] = wilson(0.584, 890);
  assert.ok(a < 0.584 && b > 0.584 && d - c < b - a);
});

test("ترحيل قاعدة البيانات: يضيف عمود المحرّك دون تغيير الصفوف القديمة", async () => {
  const f = path.join(os.tmpdir(), `mig-${Date.now()}.db`);
  const old = new DatabaseSync(f);
  old.exec(`CREATE TABLE opportunities (id INTEGER PRIMARY KEY AUTOINCREMENT, market TEXT NOT NULL, symbol TEXT NOT NULL, instrument TEXT,
    side TEXT NOT NULL, candle_open_ts INTEGER NOT NULL, status TEXT NOT NULL, score REAL, exec_quality REAL, hour_confirmed INTEGER,
    entry REAL, stop REAL, tp1 REAL, tp2 REAL, tp3 REAL, candle_arrived_at INTEGER, detected_at INTEGER, issued_at INTEGER, seen_at INTEGER,
    closed_at INTEGER, exit_price REAL, outcome TEXT, r_net REAL, pnl_pct_net REAL, last_check_ts INTEGER, data TEXT NOT NULL);
    CREATE UNIQUE INDEX ux_opp ON opportunities(market, symbol, side, candle_open_ts);
    INSERT INTO opportunities(market,symbol,side,candle_open_ts,status,r_net,data) VALUES('FUTURES','X','BUY',1,'sl',-1.2,'{}');`);
  old.close();
  const DB = await import("../server/db.js?mig=" + Date.now());
  DB.openDb(f);
  const row = DB.getDb().prepare("SELECT engine, r_net, status FROM opportunities").get();
  assert.equal(row.engine, "sma15"); assert.equal(row.r_net, -1.2); assert.equal(row.status, "sl");
  /* نفس الشمعة والرمز لمحرّكٍ آخر = صفٌّ جديد مسموح */
  const r = DB.insertOpportunity({ engine: "mr20", market: "FUTURES", symbol: "X", side: "BUY", candle_open_ts: 1, status: "new", data: {} });
  assert.equal(r.inserted, true);
  assert.equal(DB.insertOpportunity({ market: "FUTURES", symbol: "X", side: "BUY", candle_open_ts: 1, status: "new", data: {} }).inserted, false);
  DB.getDb().close(); fs.rmSync(f, { force: true }); fs.rmSync(f + "-wal", { force: true }); fs.rmSync(f + "-shm", { force: true });
});

test("الأعلى ربحاً: استبعاد وسوم Binance المحدّدة (bStocks)", () => {
  const tags = new Map([["BBBUSDT", ["bStocks"]], ["PEPEUSDT", ["Meme"]]]);
  const r = rankGainers([tk("AAAUSDT", 5), tk("BBBUSDT", 30), tk("PEPEUSDT", 12)], { spotInfo: info, topN: 10, tags, excludeTags: ["bStocks"] });
  assert.deepEqual(r.map(x => x.symbol), ["PEPEUSDT", "AAAUSDT"]);
});
