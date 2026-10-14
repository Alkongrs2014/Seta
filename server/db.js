/* =====================================================================
   قاعدة البيانات — SQLite المدمجة في Node (`node:sqlite`) بلا اعتماديات.

   كل الأزمنة تُخزَّن UTC بالميلّي ثانية. العرض بتوقيت الرياض مسؤولية
   الواجهة وحدها.
   ===================================================================== */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { ENV, DEFAULT_SETTINGS, mergeSettings } from "./config.js";

let db;

export function openDb(file = ENV.DB_PATH) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS opportunities (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      market        TEXT NOT NULL,             -- SPOT | FUTURES | OPTIONS
      symbol        TEXT NOT NULL,             -- الرمز (للخيارات: الأصل الأساسي)
      instrument    TEXT,                      -- للخيارات: رمز العقد
      side          TEXT NOT NULL,             -- BUY | SELL (اتجاه الأصل)
      candle_open_ts INTEGER NOT NULL,         -- افتتاح شمعة الـ15د (UTC ms)
      status        TEXT NOT NULL,             -- new|active|tp1|tp2|tp3|sl|expired|cancelled
      score         REAL,
      exec_quality  REAL,
      hour_confirmed INTEGER,
      entry         REAL, stop REAL, tp1 REAL, tp2 REAL, tp3 REAL,
      candle_arrived_at INTEGER,               -- وصول بيانات الافتتاح
      detected_at   INTEGER,                   -- لحظة التقييم
      issued_at     INTEGER,                   -- لحظة الإصدار/الحفظ
      seen_at       INTEGER,                   -- أول ظهور للمستخدم
      closed_at     INTEGER,
      exit_price    REAL,
      outcome       TEXT,
      r_net         REAL,
      pnl_pct_net   REAL,
      last_check_ts INTEGER,
      data          TEXT NOT NULL              -- JSON كامل (إشارة، تقييم، خطّة، جودة، عقد)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_opp ON opportunities(market, symbol, side, candle_open_ts);
    CREATE INDEX IF NOT EXISTS ix_opp_status ON opportunities(status);
    CREATE INDEX IF NOT EXISTS ix_opp_created ON opportunities(issued_at);
    CREATE TABLE IF NOT EXISTS opp_events (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      opp_id  INTEGER NOT NULL,
      ts      INTEGER NOT NULL,
      type    TEXT NOT NULL,
      price   REAL,
      note    TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_ev_opp ON opp_events(opp_id);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS eval_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, market TEXT, symbol TEXT,
      candle_open_ts INTEGER, result TEXT, note TEXT
    );
  `);
  return db;
}

export function getDb() { return db; }

export function getSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key='main'").get();
  if (!row) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  try { return mergeSettings(DEFAULT_SETTINGS, JSON.parse(row.value)); }
  catch { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
}
export function saveSettings(patch) {
  const merged = mergeSettings(getSettings(), patch);
  db.prepare("INSERT INTO settings(key,value) VALUES('main',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(merged));
  return merged;
}
export function resetSettings() {
  db.prepare("DELETE FROM settings WHERE key='main'").run();
  return getSettings();
}

export function kvGet(key, def = null) {
  const r = db.prepare("SELECT value FROM kv WHERE key=?").get(key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch { return def; }
}
export function kvSet(key, val) {
  db.prepare("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, JSON.stringify(val));
}

/* ---------- الفرص ---------- */
const COLS = ["market","symbol","instrument","side","candle_open_ts","status","score","exec_quality",
  "hour_confirmed","entry","stop","tp1","tp2","tp3","candle_arrived_at","detected_at","issued_at","data"];

/* يُرجع {id, inserted}. التكرار (نفس الرمز والاتجاه والشمعة والسوق) لا يُدرَج. */
export function insertOpportunity(o) {
  const exist = db.prepare(
    "SELECT id FROM opportunities WHERE market=? AND symbol=? AND side=? AND candle_open_ts=?"
  ).get(o.market, o.symbol, o.side, o.candle_open_ts);
  if (exist) return { id: exist.id, inserted: false };
  const vals = COLS.map(c => (c === "data" ? JSON.stringify(o.data) : (o[c] ?? null)));
  const r = db.prepare(
    `INSERT INTO opportunities(${COLS.join(",")}) VALUES(${COLS.map(() => "?").join(",")})`
  ).run(...vals);
  return { id: Number(r.lastInsertRowid), inserted: true };
}

export function addEvent(oppId, ts, type, price, note) {
  db.prepare("INSERT INTO opp_events(opp_id,ts,type,price,note) VALUES(?,?,?,?,?)")
    .run(oppId, ts, type, price ?? null, note ?? null);
}

export function updateOpportunity(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map(k => `${k}=?`).join(",");
  const vals = keys.map(k => (k === "data" ? JSON.stringify(fields[k]) : fields[k]));
  db.prepare(`UPDATE opportunities SET ${set} WHERE id=?`).run(...vals, id);
}

const OPEN_STATUSES = ["new", "active", "tp1", "tp2"];
export function listOpen() {
  return db.prepare(
    `SELECT * FROM opportunities WHERE status IN (${OPEN_STATUSES.map(() => "?").join(",")}) ORDER BY issued_at DESC`
  ).all(...OPEN_STATUSES).map(inflate);
}

export function inflate(r) {
  if (!r) return r;
  let data = {};
  try { data = JSON.parse(r.data); } catch { /* تالف */ }
  return { ...r, data };
}

export function getOpportunity(id) {
  const r = inflate(db.prepare("SELECT * FROM opportunities WHERE id=?").get(id));
  if (!r) return null;
  r.events = db.prepare("SELECT ts,type,price,note FROM opp_events WHERE opp_id=? ORDER BY ts, id").all(id);
  return r;
}

export function queryOpportunities({ market, status, side, symbol, minScore, since, limit = 200, offset = 0,
                                     closed, open, sort = "issued_at", dir = "DESC" } = {}) {
  const where = [], args = [];
  if (market) { where.push("market=?"); args.push(market); }
  if (side) { where.push("side=?"); args.push(side); }
  if (symbol) { where.push("(symbol LIKE ? OR instrument LIKE ?)"); args.push(`%${symbol}%`, `%${symbol}%`); }
  if (status) { where.push("status=?"); args.push(status); }
  if (minScore != null) { where.push("score>=?"); args.push(minScore); }
  if (since) { where.push("issued_at>=?"); args.push(since); }
  if (open) where.push(`status IN (${OPEN_STATUSES.map(s => `'${s}'`).join(",")})`);
  if (closed) where.push(`status NOT IN (${OPEN_STATUSES.map(s => `'${s}'`).join(",")})`);
  const sortCol = ["issued_at", "score", "exec_quality", "closed_at", "r_net"].includes(sort) ? sort : "issued_at";
  const sql = `SELECT * FROM opportunities ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY ${sortCol} ${dir === "ASC" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...args, limit, offset).map(inflate);
}

export function closedForStats(since = 0) {
  return db.prepare(
    `SELECT * FROM opportunities WHERE status NOT IN ('new','active','tp1','tp2') AND r_net IS NOT NULL AND issued_at>=?
     ORDER BY closed_at`
  ).all(since).map(inflate);
}

export function markSeen(id, ts) {
  db.prepare("UPDATE opportunities SET seen_at=? WHERE id=? AND seen_at IS NULL").run(ts, id);
}

export function logEval(ts, market, symbol, candleOpen, result, note) {
  db.prepare("INSERT INTO eval_log(ts,market,symbol,candle_open_ts,result,note) VALUES(?,?,?,?,?,?)")
    .run(ts, market, symbol, candleOpen, result, note ?? null);
}
export function pruneEvalLog(keepMs = 3 * 86400e3) {
  db.prepare("DELETE FROM eval_log WHERE ts<?").run(Date.now() - keepMs);
}

/* ---------- للتقارير الدورية ---------- */
export function issuedBetween(from, to) {
  return db.prepare("SELECT * FROM opportunities WHERE issued_at>=? AND issued_at<? ORDER BY issued_at").all(from, to).map(inflate);
}
export function evalCountsBetween(from, to) {
  const out = {};
  for (const r of db.prepare("SELECT market, result, COUNT(*) n FROM eval_log WHERE ts>=? AND ts<? GROUP BY 1,2").all(from, to)) {
    out[`${r.market}:${r.result}`] = r.n;
  }
  return out;
}
