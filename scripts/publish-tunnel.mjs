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

function publish(url) {
  fs.writeFileSync(CFG, `/* يكتبه scripts/publish-tunnel.mjs */\nwindow.PLATFORM_API = ${JSON.stringify(url)};\n`);
  try {
    git("add", "platform/config.js");
    git("commit", "-m", `عنوان الخادم المباشر: ${url}`);
    git("pull", "--rebase", "--autostash", "-q", "origin", "main");
    git("push", "-q", "origin", "main");
    console.log("نُشر:", url);
  } catch (e) { console.error("فشل النشر:", String(e.stderr || e.message).slice(0, 300)); }
}

function run() {
  const p = spawn(CF, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:8787"], { cwd: ROOT });
  let done = false;
  const on = b => {
    const m = String(b).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !done) { done = true; publish(m[0]); }
  };
  p.stdout.on("data", on); p.stderr.on("data", on);
  p.on("error", e => { console.error("cloudflared:", e.message); setTimeout(run, 30000); });
  p.on("exit", () => { clearInterval(wd); setTimeout(run, 5000); });
  /* حارس: إن لم يعد العنوان العام يردّ مرّتين متتاليتين نقتل النفق ليُعاد إنشاؤه بعنوانٍ جديد */
  let bad = 0, cur = null;
  const wd = setInterval(async () => {
    if (!done) return;
    cur ||= (fs.readFileSync(CFG, "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) || [])[0];
    try { const r = await fetch(cur + "/api/health", { signal: AbortSignal.timeout(10000) }); bad = r.ok ? 0 : bad + 1; }
    catch { bad++; }
    if (bad >= 2) { console.error("النفق لا يردّ — إعادة إنشائه"); p.kill(); }
  }, 60000);
}
run();
