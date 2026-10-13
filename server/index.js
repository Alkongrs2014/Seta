/* نقطة الدخول: قاعدة البيانات ← المحرّك ← الخادم. تعمل باستمرار وتتعافى ذاتياً. */
import { ENV } from "./config.js";
import { openDb } from "./db.js";
import { Engine } from "./engine.js";
import { startHttp } from "./http.js";

openDb();
const engine = new Engine();
startHttp(engine);

/* لا يُسقط خطأٌ غير متوقَّع العملية: يُسجَّل ويستمرّ المحرّك. */
process.on("unhandledRejection", e => engine.log(`unhandledRejection: ${e?.stack || e}`));
process.on("uncaughtException", e => engine.log(`uncaughtException: ${e?.stack || e}`));

engine.start().then(() => engine.log("المحرّك يعمل")).catch(e => engine.log(`فشل بدء المحرّك: ${e.stack || e}`));

const bye = () => { engine.log("إيقاف"); engine.stop(); setTimeout(() => process.exit(0), 200); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
