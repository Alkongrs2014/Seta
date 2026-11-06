/* =====================================================================
   كون «الأعلى ربحاً» الديناميكي (Binance Top Gainers).

   المصدر: GET /api/v3/ticker/24hr (Spot، وزن 80) كل 60 ثانية — نفس
   المقياس الذي يرتّب به قسم Top Gainers في Binance: priceChangePercent
   لآخر 24 ساعة متحرّكة. الحدّ 6000 وزن/دقيقة، فالمزامنة تستهلك ≈1.3%.

   الفلاتر (مطابقةٌ لما يعرضه القسم، ومعلنة):
   - أزواج USDT فقط وحالتها TRADING في exchangeInfo (يُحدَّث كل ساعة).
   - تُستبعد الرموز المرفوعة (UP/DOWN/BULL/BEAR) والعملات المستقرة.
   - حجمٌ أدنى اختياري (minQuoteVolume24h، افتراضياً 0 = بلا حدّ إضافي).
   Binance قد تطبّق في واجهتها فلاتر عرضٍ غير منشورة، فقد يختلف ترتيبُ
   بعض العناصر الهامشية — والفرق يُعرض ولا يُخفى.

   الثبات: فشل طلبٍ لا يمسح القائمة. تبقى آخر قائمةٍ صحيحة موسومةً
   «قديمة» مع عمرها، ولا تُحتسب إضافةٌ أو إزالة إلا من جلبٍ ناجح.
   ===================================================================== */
import { bget } from "./binance.js";
import * as DB from "./db.js";

const STABLE = new Set(["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "EUR", "EURI", "USDE", "USD1", "PYUSD", "AEUR", "XUSD", "BFUSD", "RLUSD", "USDS"]);
const LEVERAGED = /(UP|DOWN|BULL|BEAR)$/;

/* نقيّ: يحوّل ticker/24hr إلى قائمة مرتّبة */
export function rankGainers(tickers, { spotInfo, topN = 20, minQuoteVolume24h = 0, tags = null, excludeTags = [] }) {
  const rows = [];
  for (const t of tickers) {
    const info = spotInfo.get(t.symbol);
    if (!info || info.quote !== "USDT" || info.status !== "TRADING") continue;
    if (tags && excludeTags.length && (tags.get(t.symbol) || []).some(x => excludeTags.includes(x))) continue;
    if (STABLE.has(info.base) || LEVERAGED.test(info.base)) continue;
    const qv = +t.quoteVolume, chg = +t.priceChangePercent;
    if (!(qv > 0) || !Number.isFinite(chg) || qv < minQuoteVolume24h) continue;
    rows.push({ symbol: t.symbol, base: info.base, changePct: chg, lastPrice: +t.lastPrice, quoteVolume24h: qv });
  }
  rows.sort((a, b) => b.changePct - a.changePct);
  return rows.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1 }));
}

/* نقيّ: عقد USDT-M الدائم المقابل للأصل (PEPE ← 1000PEPEUSDT) أو null */
export function futuresFor(base, futPerp) {
  for (const s of [`${base}USDT`, `1000${base}USDT`, `1000000${base}USDT`, `1M${base}USDT`]) if (futPerp.has(s)) return s;
  return null;
}

/* نقيّ: الفرق بين قائمتين */
export function diffLists(prev, next) {
  const a = new Set(prev.map(x => x.symbol)), b = new Set(next.map(x => x.symbol));
  return { added: next.filter(x => !a.has(x.symbol)), removed: prev.filter(x => !b.has(x.symbol)) };
}

export class GainersUniverse {
  constructor({ getSettings, log, onChange, now = () => Date.now() }) {
    this.getSettings = getSettings; this.log = log; this.onChange = onChange || (() => {}); this.now = now;
    const saved = DB.kvGet("gainers_state");
    this.list = saved?.list || [];
    this.fetchedAt = saved?.fetchedAt || 0;
    this.lastAttemptAt = 0; this.lastError = null; this.failures = 0; this.refreshes = 0;
    this.spotInfo = new Map(); this.futPerp = new Set(); this.infoAt = 0;
  }
  get cfg() { return { topN: 20, minQuoteVolume24h: 0, refreshSec: 60, excludeTags: ["bStocks"], ...(this.getSettings().gainers || {}) }; }
  get stale() { return !this.fetchedAt || this.now() - this.fetchedAt > 3 * this.cfg.refreshSec * 1000; }

  async _loadInfo() {
    if (this.spotInfo.size && this.now() - this.infoAt < 3600e3) return;
    const [spot, fut] = await Promise.all([
      bget("spot", "/api/v3/exchangeInfo", { permissions: "SPOT" }, { weight: 20 }),
      bget("futures", "/fapi/v1/exchangeInfo", {}, { weight: 1 })
    ]);
    this.spotInfo = new Map(spot.symbols.map(s => [s.symbol, { base: s.baseAsset, quote: s.quoteAsset, status: s.status }]));
    this.futPerp = new Set(fut.symbols.filter(s => s.contractType === "PERPETUAL" && s.quoteAsset === "USDT" && s.status === "TRADING").map(s => s.symbol));
    /* وسوم Binance (نفس مصدر صفحة الأسواق): لاستبعاد الأسهم المرمّزة bStocks. فشلها لا يوقف المزامنة. */
    try {
      const r = await fetch("https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=true", { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      this.tags = new Map((j.data || []).map(p => [p.s, p.tags || []]));
    } catch (e) { this.log(`[gainers] تعذّر جلب الوسوم: ${e.message}`); }
    this.infoAt = this.now();
  }

  async refresh() {
    this.lastAttemptAt = this.now();
    try {
      await this._loadInfo();
      const tickers = await bget("spot", "/api/v3/ticker/24hr", {}, { weight: 80, retries: 1 });
      const next = rankGainers(tickers, { spotInfo: this.spotInfo, tags: this.tags || null, ...this.cfg })
        .map(r => ({ ...r, futuresSymbol: futuresFor(r.base, this.futPerp) }));
      if (!next.length) throw new Error("قائمةٌ فارغة من Binance — تُتجاهل");
      const { added, removed } = diffLists(this.list, next);
      const ts = this.now();
      for (const x of added) DB.addUniverseEvent(ts, x.symbol, "added", x.changePct, x.futuresSymbol ? null : "لا عقد Futures");
      for (const x of removed) DB.addUniverseEvent(ts, x.symbol, "removed", next.find(n => n.symbol === x.symbol)?.changePct ?? null, null);
      this.list = next; this.fetchedAt = ts; this.lastError = null; this.failures = 0; this.refreshes++;
      DB.kvSet("gainers_state", { list: next, fetchedAt: ts });
      if (added.length || removed.length) {
        this.log(`[gainers] +${added.map(x => x.symbol).join(",") || "—"} −${removed.map(x => x.symbol).join(",") || "—"}`);
        this.onChange({ added, removed, list: next });
      }
    } catch (e) {
      this.failures++; this.lastError = String(e.message || e).slice(0, 200);
      this.log(`[gainers] فشل التحديث (${this.failures}) — تبقى آخر قائمة صحيحة: ${this.lastError}`);
    }
  }

  start() {
    this.refresh();
    this._t = setInterval(() => this.refresh(), this.cfg.refreshSec * 1000);
  }
  stop() { clearInterval(this._t); }

  snapshot() {
    return { list: this.list, fetchedAt: this.fetchedAt, stale: this.stale, lastAttemptAt: this.lastAttemptAt,
      lastError: this.lastError, failures: this.failures, refreshSec: this.cfg.refreshSec, topN: this.cfg.topN,
      source: "Binance Spot GET /api/v3/ticker/24hr — ترتيب priceChangePercent (24 ساعة متحرّكة)، أزواج USDT النشطة" + (this.cfg.excludeTags.length ? "، بلا الوسوم: " + this.cfg.excludeTags.join(",") + " (أسهم مرمّزة)" : ""), tagsLoaded: !!(this.tags && this.tags.size) };
  }
}
