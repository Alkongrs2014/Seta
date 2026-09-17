/* =====================================================================
   عاملُ الخدمة — الفتحُ الفوري والعملُ بلا شبكة.

   استراتيجيتان لا واحدة، والفرق بينهما جوهري:

   **قشرةُ التطبيق** (`index.html` وملفّات `js/`) تُخدَم من الذاكرة أوّلاً
   ثم تُحدَّث في الخلفية. فالموقع يفتح فوراً حتى على شبكةٍ رديئة.

   **بياناتُ السوق** لا تُخزَّن إطلاقاً. وهذه القاعدة غيرُ قابلة
   للتفاوض: سعرٌ مخزَّنٌ يُعرض كأنه الآن أسوأُ من غياب السعر — لأن
   القارئ يبني عليه قراراً وهو لا يعلم أنه من ساعة. فطلباتُ بايننس
   وغيرها تمرّ إلى الشبكة مباشرةً، وإن فشلت أعلنت الواجهة انقطاعها في
   لوحة صحّة المصادر.

   و`data/macro.json` استثناءٌ معلَن: تكتبه مهمّةٌ مجدولة كل ساعة، فهو
   بطبيعته بياناتٌ يومية لا لحظية، ويحمل `updated` يُعرض عمرُه منه.
   ===================================================================== */

/* =====================================================================
   القشرة: **الشبكة أوّلاً** لا المخزَّن أوّلاً.

   النسخة الأولى كانت تخدم المخزَّن أوّلاً وتحدّثه في الخلفية، وهو النمط
   الشائع لأنه أسرع فتحاً. وثمنُه أن كل مستخدمٍ يبقى على **الكود القديم
   دورةَ زيارةٍ كاملة** بعد كل تحديث: الزيارة التالية تعرض القديم
   وتُنزل الجديد، والتي تليها تعرض الجديد.

   وهذا مقبولٌ في موقع محتوى، وغيرُ مقبولٍ هنا: الملفّات كودُ تحليلٍ
   يُبنى عليه قرارٌ مالي. وإصلاحُ خطأٍ في حساب مؤشّرٍ يجب أن يصل فوراً
   لا بعد زيارتين. وقد وقع هذا فعلاً أثناء التطوير — نسخةٌ مخزَّنة
   ظلّت تعمل بعد إصلاح الخطأ فبدا الإصلاح فاشلاً.

   فالشبكة أوّلاً، والمخزَّن شبكةُ أمانٍ للانقطاع وحده. والكلفة مهلةُ
   الشبكة عند الفتح، وهي أرخص من عرض حسابٍ خاطئ.
   ===================================================================== */
var CACHE = "btc-v4";
var SHELL = [
  "./", "./index.html",
  "./js/core.js", "./js/indicators.js", "./js/strategies.js",
  "./js/consensus.js", "./js/onchain.js", "./js/data.js",
  "./js/backtest.js", "./js/backtest.worker.js",
  "./js/chart.js", "./js/render.js", "./js/app.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  /* كلُّ ما هو خارج الدومين بياناتُ سوقٍ حيّة — لا تُخزَّن ولا تُعترض. */
  if (url.origin !== self.location.origin) return;

  /* `macro.json` من الشبكة أوّلاً، والمخزَّن احتياطٌ عند الانقطاع. */
  if (url.pathname.indexOf("/data/") >= 0) {
    e.respondWith(
      fetch(req).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return r;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  /* القشرة: الشبكة أوّلاً، والمخزَّن عند الانقطاع وحده. */
  e.respondWith(
    fetch(req).then(function (r) {
      if (r && r.ok) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return r;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || new Response("غير متاح بلا اتصال", {
          status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      });
    })
  );
});
