/* يشغّل نفق Cloudflare المجاني (بلا حساب) إلى خادم المنصة المحلي، ثم ينشر عنوانه
   في platform/config.js ويدفعه إلى GitHub فتقرأه الصفحة على Pages. يعيد المحاولة عند الانقطاع.
   التشغيل: node scripts/publish-tunnel.mjs   (يحتاج cloudflared.exe في data/bin أو PATH) */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CF = fs.existsSync(path.join(ROOT, "data", "bin", "cloudflared.exe")) ? path.join(ROOT, "data", "bin", "cloudflared.exe") : "cloudflared";
const CFG = path.join(ROOT, "platform", "config.js");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, stdio: "pipe" }).toString();

/* منع النسخ المكررة: قفلٌ بمعرّف العملية؛ إن كانت نسخةٌ أخرى حيّة ننتهي بصمت */
const LOCK = path.join(ROOT, "data", "tunnel.lock");
try {
  const old = parseInt(fs.readFileSync(LOCK, "utf8"), 10);
  if (old && old !== process.pid) { try { process.kill(old, 0); console.log("نسخة أخرى تعمل:", old); process.exit(0); } catch {} }
} catch {}
fs.writeFileSync(LOCK, String(process.pid));
process.on("exit", () => { try { if (fs.readFileSync(LOCK, "utf8") === String(process.pid)) fs.unlinkSync(LOCK); } catch {} });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const localOk = () => fetch("http://127.0.0.1:8787/api/health", { signal: AbortSignal.timeout(5000) }).then(r => r.ok).catch(() => false);

function publish(url) {
  fs.writeFileSync(CFG, `/* يكتبه scripts/publish-tunnel.mjs */\nwindow.PLATFORM_API = ${JSON.stringify(url)};\n`);
  try {
    git("add", "platform/config.js");
    git("commit", "-m", `عنوان الخادم المباشر: ${url}`);
    git("pull", "--rebase", "--autostash", "-q", "origin", "main");
    git("push", "-q", "origin", "main");
    log("نُشر:", url);
  } catch (e) { log("فشل النشر:", String(e.stderr || e.message).slice(0, 300)); }
}

/* تأخير متصاعد بين محاولات إنشاء النفق: الإعادة السريعة المتكرّرة تولّد عناوين متلاحقة
   (14 عنواناً في 45 دقيقة يوم 2026-11-06) وكل عنوانٍ جديد يكسر الصفحات المفتوحة حتى يُنشر. */
let fails = 0;
/* --protocol http2: QUIC (UDP) على هذه الشبكة ينقطع بـ"failed to accept QUIC stream: timeout" فيسقط النفق ويتبدّل العنوان؛ TCP/443 أثبت. */
function run() {
  const startedAt = Date.now();
  const p = spawn(CF, ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", "http://127.0.0.1:8787"], { cwd: ROOT });
  let done = false;
  const on = b => {
    const s = String(b);
    for (const line of s.split(/\r?\n/)) if (/\b(ERR|error|failed)\b/i.test(line) && !/context canceled/.test(line)) log("cloudflared:", line.slice(0, 240));
    const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !done) { done = true; publish(m[0]); }
  };
  p.stdout.on("data", on); p.stderr.on("data", on);
  p.on("error", e => { log("cloudflared:", e.message); setTimeout(run, 30000); });
  p.on("exit", code => {
    clearInterval(wd);
    fails = Date.now() - startedAt < 10 * 60e3 ? fails + 1 : 0;
    const delay = Math.min(5000 * 2 ** fails, 5 * 60e3);
    log(`cloudflared خرج (code=${code}) بعد ${Math.round((Date.now() - startedAt) / 1000)}ث — إعادة بعد ${delay / 1000}ث`);
    setTimeout(run, delay);
  });
  /* حارس: إن لم يعد العنوان العام يردّ 4 مرّات متتالية نقتل النفق ليُعاد إنشاؤه بعنوانٍ جديد */
  let bad = 0, cur = null, since = 0;
  const wd = setInterval(async () => {
    if (!done) return;
    since ||= Date.now();
    if (Date.now() - since < 120000) return; /* مهلة تسجيل النفق على حافة Cloudflare */
    cur ||= (fs.readFileSync(CFG, "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) || [])[0];
    try { const r = await fetch(cur + "/api/health", { signal: AbortSignal.timeout(15000) }); bad = r.ok ? 0 : bad + 1; }
    catch { bad++; }
    /* عنوانٌ جديد لا يُصلح خادماً متوقّفاً: لا نعيد إنشاء النفق إلا والخادم المحلي سليم */
    if (bad && !(await localOk())) { log("الخادم المحلي لا يردّ — النفق يبقى كما هو"); bad = 0; return; }
    if (bad >= 4) { log("النفق لا يردّ والخادم المحلي سليم — إعادة إنشائه"); p.kill(); }
  }, 60000);
}
run();
