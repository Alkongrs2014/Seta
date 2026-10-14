/* =====================================================================
   الإعدادات — افتراضاتٌ معلَنة، تُعدَّل من صفحة الإعدادات وتُحفَظ في
   قاعدة البيانات. لا أسرار هنا: المنصّة تستعمل بيانات Binance العامة
   فقط ولا تطلب مفاتيح حساب ولا صلاحيات تداول.
   ===================================================================== */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ENV = {
  ROOT,
  HOST: process.env.HOST || "127.0.0.1",
  PORT: Number(process.env.PORT || 8787),
  DB_PATH: process.env.DB_PATH || path.join(ROOT, "data", "opps.db"),
  /* اختياري: إن حُدِّد فهو لازمٌ لتعديل الإعدادات من الواجهة. */
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || "",
  /* لتعطيل أسواقٍ عند الحاجة: SPOT,FUTURES,OPTIONS */
  MARKETS: (process.env.MARKETS || "SPOT,FUTURES,OPTIONS").split(",").map(s => s.trim().toUpperCase()),
  /* حدّ للرموز لأغراض الاختبار السريع (0 = بلا حدّ) */
  MAX_SYMBOLS: Number(process.env.MAX_SYMBOLS || 0)
};

export const HOSTS = {
  spot: ["https://api.binance.com", "https://data-api.binance.vision", "https://api1.binance.com", "https://api2.binance.com"],
  futures: ["https://fapi.binance.com"],
  options: ["https://eapi.binance.com"]
};
export const WS_HOSTS = {
  spot: ["wss://stream.binance.com:9443", "wss://data-stream.binance.vision"],
  futures: ["wss://fstream.binance.com/market"]
};

/* حدود الوزن في الدقيقة (من rateLimits في exchangeInfo) × هامش أمان. */
export const WEIGHT_BUDGET = { spot: 4800, futures: 1900, options: 300 };

export const DEFAULT_SETTINGS = {
  /* الفلاتر */
  spot:    { enabled: true, minQuoteVolume24h: 100000, maxSpreadPct: 0.6 },
  futures: { enabled: true, minQuoteVolume24h: 500000, maxSpreadPct: 0.3, includeQuarterly: false },
  options: { enabled: true, deltaMin: 0.35, deltaMax: 0.60, deltaTarget: 0.45,
             minDteHours: 20, maxDteDays: 45, maxSpreadPct: 12, minOpenInterest: 1, minVolume24h: 0,
             stopLossPct: 35, holdHoursModel: 6 },
  /* الخطة */
  plan: { stopAtrMargin: 0.1, targetsR: [1, 2, 3], minTargetR: 1, maxTargets: 3,
          /* الجلسة = يوم UTC (السوق 24/7)؛ انتهاء الفرصة بعد 5 جلسات كاملة تلي يوم الإصدار */
          expirySessions: 5,
          /* غير معتمد من الاستراتيجية: تقسيمٌ متساوٍ لغرض الحساب فقط، ويظهر كذلك في الواجهة */
          tpSplit: [1 / 3, 1 / 3, 1 / 3], breakevenAfterTp1: true, cancelOnSmaClose: false },
  /* التقييم */
  weights: { sma: 60, yesterday: 20, vwap: 10, week: 5, trend: 5, tf15: 40, tf1h: 20, indicatorShare: 40 },
  /* نموذج التكلفة المعلن */
  costs: { spotFeePct: 0.10, futuresFeePct: 0.05, slippageBps: 2, stopSlippageMult: 2 },
  /* الرافعة المعروضة للمستخدم (أثرٌ على الهامش والتصفية فقط) */
  leverages: [3, 5, 10, 20],
  /* تبويبات العرض (فلترة وترتيب فقط؛ لا تؤثّر في إصدار الفرص) — القيم مبنية على توزيع Binance الفعلي:
     Futures USDT-M: وسيط حجم 24س ≈ 3M وP75 ≈ 14M وP90 ≈ 74M؛ وسيط ATR%(15د) ≈ 0.6؛ RVOL وسيط ≈ 0.6 وP75 ≈ 1.0 وP90 ≈ 1.9 (الحدّ 1.5 = نشاطٌ مرتفع) */
  activity: {
    strongMinScore: 70, strongMinExec: 50,
    futuresMinQuoteVolume24h: 20000000, futuresMaxSpreadPct: 0.05,
    spotMinQuoteVolume24h: 5000000, spotMaxSpreadPct: 0.08,
    minAtrPct: 0.35, maxAtrPct: 2.5,
    minRvol: 1.5, rvolLookback: 20,
    optMinAtrPct: 0.15, optMaxSpreadPct: 8, optMinOpenInterest: 20, optMinVolume24h: 5
  },
  /* أدنى جودة تنفيذ لتصنيف الفرصة «قابلة للتنفيذ» */
  minExecQuality: 40
};

export function mergeSettings(base, patch) {
  const out = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(patch || {})) {
    if (!(k in out)) continue;
    if (out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) && patch[k] && typeof patch[k] === "object") {
      for (const kk of Object.keys(patch[k])) if (kk in out[k]) out[k][kk] = patch[k][kk];
    } else if (typeof patch[k] === typeof out[k]) {
      out[k] = patch[k];
    }
  }
  return out;
}
