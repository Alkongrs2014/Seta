/* نقطة الدخول: قاعدة البيانات ← المحرّك ← الخادم. تعمل باستمرار وتتعافى ذاتياً. */
import { ENV } from "./config.js";
import fs from "node:fs";
import path from "node:path";
import { openDb, kvGet, kvSet } from "./db.js";
import { Engine } from "./engine.js";
import { startHttp } from "./http.js";

/* قفل نسخةٍ واحدة: ملف pid + فحص حياة العملية. (ومنفذ HTTP حارسٌ ثانٍ). */
const LOCK = path.join(path.dirname(ENV.DB_PATH), "server.lock");
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
try {
  const old = Number(fs.readFileSync(LOCK, "utf8"));
  if (old && old !== process.pid) {
    let alive = false;
    try { process.kill(old, 0); alive = true; } catch { /* ميتة */ }
    if (alive) { console.error(`نسخةٌ تعمل بالفعل (pid ${old}) — خروج.`); process.exit(3); }
  }
} catch { /* لا قفل */ }
fs.writeFileSync(LOCK, String(process.pid));
const unlock = () => { try { if (Number(fs.readFileSync(LOCK, "utf8")) === process.pid) fs.unlinkSync(LOCK); } catch { /* */ } };
process.on("exit", unlock);

openDb();
if (!kvGet("monitor_started_at")) kvSet("monitor_started_at", Date.now());
const engine = new Engine();
startHttp(engine);

/* لا يُسقط خطأٌ غير متوقَّع العملية: يُسجَّل ويستمرّ المحرّك. */
process.on("unhandledRejection", e => engine.log(`unhandledRejection: ${e?.stack || e}`));
process.on("uncaughtException", e => engine.log(`uncaughtException: ${e?.stack || e}`));

engine.start().then(() => engine.log("المحرّك يعمل")).catch(e => engine.log(`فشل بدء المحرّك: ${e.stack || e}`));

const bye = () => { engine.log("إيقاف"); engine.stop(); setTimeout(() => process.exit(0), 200); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
