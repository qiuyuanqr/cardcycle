/* 卡周期 · Service Worker
   目的：装到主屏幕后没网也能打开。
   策略：页面走「网络优先、失败回退缓存」，保证联网时总是最新版；
        图标等静态资源走「缓存优先」。 */

const CACHE = 'cardcycle-v3';
const SHELL = ['./', './index.html', './core.js', './manifest.webmanifest',
               './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // 页面和 core.js 必须配套更新，都走网络优先；只有图标等真正的静态资源缓存优先
  const isPage = req.mode === 'navigate' || req.destination === 'document'
              || new URL(req.url).pathname.endsWith('/core.js');

  if (isPage) {
    // 网络优先：拿到新版就更新缓存；断网时回退到缓存
    // 只缓存 res.ok 的响应：部署间隙的 404/500 错误页一旦写进缓存，
    // 会顶掉好版本，之后离线打开 PWA 看到的就是错误页
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
  } else {
    // 静态资源：缓存优先（同样只缓存 res.ok 的响应）
    e.respondWith(
      caches.match(req).then(r => r || fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }))
    );
  }
});
