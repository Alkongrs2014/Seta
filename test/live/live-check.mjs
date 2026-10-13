/* فحصٌ حيّ ببيانات Binance العامة (يحتاج اتصالاً): الأسواق الثلاثة + اختيار العقود
   + تمرير الاستراتيجية على تاريخٍ حقيقي للتحقق من عدم الانهيار وعدد الإشارات. */
import { fetchKlines, bget } from "../../server/binance.js";
import { evaluateCandleOpen, M15 } from "../../server/strategy.js";
import { fetchChain, selectOption, loadOptionUniverse } from "../../server/options.js";
import { DEFAULT_SETTINGS } from "../../server/config.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "✔ " : "✖ ") + m); if (!c) fail++; };

/* 1) الأسواق الثلاثة */
const spot = await bget("spot", "/api/v3/exchangeInfo", {}, { weight: 20 });
const spotN = spot.symbols.filter(s => s.status === "TRADING" && s.quoteAsset === "USDT" && s.isSpotTradingAllowed).length;
ok(spotN > 100, `Spot: ${spotN} زوج USDT قابل للتداول`);
const fut = await bget("futures", "/fapi/v1/exchangeInfo", {}, { weight: 1 });
const futN = fut.symbols.filter(s => s.status === "TRADING" && s.contractType === "PERPETUAL" && s.quoteAsset === "USDT").length;
ok(futN > 100, `Futures: ${futN} عقد USDT-M دائم`);
const uni = await loadOptionUniverse(true);
ok(uni.symbols.size > 100, `Options: ${uni.symbols.size} عقد مدرج (${[...uni.underlyings.keys()].join(",")})`);

/* 2) اختيار عقود الخيارات الحقيقية */
for (const u of ["BTCUSDT", "ETHUSDT"]) {
  const chain = await fetchChain(u);
  for (const dir of ["BUY", "SELL"]) {
    const r = selectOption({ direction: dir, contracts: chain.contracts, now: Date.now(), settings: DEFAULT_SETTINGS.options });
    if (r.selected) {
      const c = r.selected;
      ok(true, `${u} ${dir === "BUY" ? "CALL" : "PUT"} → ${c.symbol} Δ=${c.delta.toFixed(2)} ask=${c.ask} سبريد=${c.spreadPct.toFixed(1)}% OI=${c.openInterest} درجة=${c.selection.score}`);
      ok(c.side === (dir === "BUY" ? "CALL" : "PUT") && Math.abs(c.delta) >= 0.35 && Math.abs(c.delta) <= 0.6, "   النوع والدلتا ضمن النطاق");
    } else {
      console.log(`• ${u} ${dir}: لا عقد مناسب`, JSON.stringify(r.rejected));
    }
  }
}

/* 3) الاستراتيجية على تاريخٍ حقيقي: مسحٌ لكل شمعة (يحاكي الافتتاح بدقّة) */
for (const [market, sym] of [["spot", "BTCUSDT"], ["spot", "SOLUSDT"], ["futures", "ETHUSDT"], ["futures", "DOGEUSDT"]]) {
  const rows = await fetchKlines(market, sym, "15m", { limit: 1000 });
  const closed = rows.slice(0, -1);
  let signals = 0, buys = 0, confirmed = 0;
  for (let i = 260; i < closed.length; i++) {
    const hist = closed.slice(0, i);
    const r = evaluateCandleOpen({ closed15: hist, openTime: closed[i].t, openPrice: closed[i].o });
    if (r.signal) { signals++; if (r.side === "BUY") buys++; if (r.hourConfirmed) confirmed++; }
  }
  ok(true, `${market} ${sym}: ${closed.length - 260} شمعة ممسوحة → ${signals} إشارة (${buys} شراء، ${confirmed} مؤكَّدة بالساعة)`);
}
console.log(fail ? `\nفشل ${fail}` : "\nكل الفحوص الحيّة نجحت");
process.exit(fail ? 1 : 0);
