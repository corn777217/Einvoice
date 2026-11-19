// 離線快取 + Android 分享（share_target）
const VERSION = 'einv-v1';
const SHELL = ['./', 'index.html', 'assets/app.js', 'assets/providers.js', 'assets/style.css', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'einv-share').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);

  // 分享進來的圖片／文字：暫存後導回首頁處理
  if (e.request.method === 'POST' && url.href === new URL('share', scope).href) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const cache = await caches.open('einv-share');
      let i = 0;
      for (const f of form.getAll('image')) {
        if (f && f.size) await cache.put(new Request(`share/${Date.now()}-${i++}`), new Response(f, { headers: { 'content-type': f.type } }));
      }
      const q = new URLSearchParams({ shared: '1' });
      for (const k of ['title', 'text', 'url']) if (form.get(k)) q.set(k, form.get(k));
      return Response.redirect(new URL(`./?${q}`, scope).href, 303);
    })());
    return;
  }

  if (e.request.method !== 'GET') return;

  // 版本固定的 CDN 檔（條碼、OCR 元件）：快取優先
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  // 自己的檔案：網路優先，離線時用快取
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  }
});
