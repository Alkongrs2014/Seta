import fs from "node:fs"; import { metrics } from "./lib.mjs"; import { noOverlap, SPLIT } from "./analyze-lib.mjs";
const s = JSON.parse(fs.readFileSync("data/research/signals.json","utf8")).filter(s=>s.strat==="MR"&&s.side==="BUY"&&s.f.btcD===1&&s.t>=Date.UTC(2025,10,15));
const tr=(a,ex)=>noOverlap(a.map(x=>x.res[ex]&&{...x.res[ex],s:x}).filter(Boolean));
for (const [nm,f] of [["rsi<20",x=>x.f.rsi1h<20],["rsi20-25",x=>x.f.rsi1h>=20]]) for (const [p,g] of [["DEV",x=>x.t<SPLIT],["OOS",x=>x.t>=SPLIT]]) { const m=metrics(tr(s.filter(x=>f(x)&&g(x)),"live")); console.log(nm,p,`n=${m.n} win=${m.winPct}% tp1=${m.tp1}% tp2=${m.tp2}% sl1st=${m.slFirst}% avgR=${m.avgR} pf=${m.pf} dd=${m.maxDDR}`); }
