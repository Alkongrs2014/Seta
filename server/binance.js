/* =====================================================================
   عميل Binance العام (REST) — بلا مفاتيح.

   ثلاث مسؤوليات:
   1) مضيفاتٌ بديلة للسوق الفوري (المرآة data-api.binance.vision).
   2) تنظيم الوزن: دلو توكنات لكل سوق بحسب حدّ الدقيقة المعلن، مع
      قراءة ترويسة x-mbx-used-weight-1m الفعلية والتراجع عند 429/418.
   3) تسجيل صحّة المصدر لتُعرض للمستخدم لا لتُخفى.
   ===================================================================== */
import { HOSTS, WEIGHT_BUDGET } from "./config.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Limiter {
  constructor(budgetPerMin) {
    this.budget = budgetPerMin;
    this.used = 0;
    this.windowStart = Date.now();
    this.blockedUntil = 0;
    this.serverUsed = 0;
  }
  _roll() {
    const now = Date.now();
    if (now - this.windowStart >= 60000) { this.windowStart = now; this.used = 0; }
  }
  async acquire(weight) {
    for (;;) {
      this._roll();
      const now = Date.now();
      if (now < this.blockedUntil) { await sleep(this.blockedUntil - now); continue; }
      const eff = Math.max(this.used, this.serverUsed);
      if (eff + weight <= this.budget) { this.used += weight; return; }
      await sleep(Math.max(250, this.windowStart + 60000 - now));
    }
  }
  observe(headerVal) {
    const n = Number(headerVal);
    if (Number.isFinite(n)) { this.serverUsed = n; this.serverUsedAt = Date.now(); }
  }
  block(ms) { this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms); }
}

const limiters = {};
const health = {};
for (const m of Object.keys(HOSTS)) {
  limiters[m] = new Limiter(WEIGHT_BUDGET[m]);
  health[m] = { ok: null, lastOkAt: null, lastErrAt: null, lastError: null, host: HOSTS[m][0], errors: 0, calls: 0 };
}

export function sourceHealth() {
  const out = {};
  for (const m of Object.keys(health)) {
    out[m] = { ...health[m], usedWeight: limiters[m].serverUsed, budget: limiters[m].budget };
  }
  return out;
}

/* يمنع تصاعد استدعاءاتٍ متوازية تفوق ما يتحمّله النظام. */
const inflight = { spot: 0, futures: 0, options: 0 };
const MAX_INFLIGHT = { spot: 8, futures: 6, options: 3 };
async function slot(market) {
  while (inflight[market] >= MAX_INFLIGHT[market]) await sleep(15);
  inflight[market]++;
}

export async function bget(market, pathname, params = {}, { weight = 1, timeoutMs = 12000, retries = 2 } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const hosts = HOSTS[market];
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const host = hosts[attempt % hosts.length];
    await limiters[market].acquire(weight);
    await slot(market);
    health[market].calls++;
    try {
      const url = `${host}${pathname}${qs.size ? "?" + qs : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      limiters[market].observe(res.headers.get("x-mbx-used-weight-1m"));
      if (res.status === 429 || res.status === 418) {
        const ra = Number(res.headers.get("retry-after") || 30);
        limiters[market].block(ra * 1000);
        throw new Error(`HTTP ${res.status} (rate limit) retry-after=${ra}s`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        /* 451 = حجبٌ جغرافي؛ نجرّب المضيف التالي إن وُجد */
        throw new Error(`HTTP ${res.status} ${body.slice(0, 160)}`);
      }
      const json = await res.json();
      health[market].ok = true; health[market].lastOkAt = Date.now(); health[market].host = host;
      return json;
    } catch (e) {
      lastErr = e;
      health[market].errors++;
      health[market].lastErrAt = Date.now();
      health[market].lastError = String(e.message || e).slice(0, 200);
      if (attempt === retries) health[market].ok = false;
      await sleep(250 * (attempt + 1));
    } finally {
      inflight[market]--;
    }
  }
  throw lastErr;
}

/* شمعة REST → كائنٌ موحَّد. */
export function parseKline(a) {
  return { t: a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4], v: +a[5], q: +a[7], n: a[8], ct: a[6] };
}

const KLINE_PATH = { spot: "/api/v3/klines", futures: "/fapi/v1/klines" };

/* وزن الشموع: <100 → 1، <500 → 2، <=1000 → 5 (سبوت)؛ للعقود <100→1، <500→2، <1000→5، >=1000→10 */
function klineWeight(market, limit) {
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  if (market === "futures") return limit < 1000 ? 5 : 10;
  return 5;
}

export async function fetchKlines(market, symbol, interval, { limit = 500, startTime, endTime } = {}) {
  const rows = await bget(market, KLINE_PATH[market],
    { symbol, interval, limit, startTime, endTime }, { weight: klineWeight(market, limit) });
  return rows.map(parseKline);
}

export const serverTime = async market => {
  const p = market === "futures" ? "/fapi/v1/time" : market === "options" ? "/eapi/v1/time" : "/api/v3/time";
  const r = await bget(market, p, {}, { weight: 1, retries: 1 });
  return r.serverTime;
};
