const CACHE = 'billiards-aim-v39';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/specs.js',
  './src/math/linalg.js',
  './src/math/homography.js',
  './src/math/aiming.js',
  './src/math/kick.js',
  './src/ui/overlay.js',
  './src/ui/magnifier.js',
  './src/ui/calibrator.js',
  './src/ui/picker.js',
  './src/ui/util.js',
  './src/ui/cutDiagram.js',
  './src/demo/scene.js',
  './src/vision/detector.js',
  './vendor/opencv.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

function normalizeForStore(res) {
  if (!res || res.type === 'opaque' || !res.body) return res;
  const h = new Headers(res.headers);
  h.delete('Content-Encoding');
  h.delete('Content-Length');
  h.delete('Vary');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(
        ASSETS.map(async (a) => {
          const res = await fetch(a, { cache: 'reload' });
          if (!res || !res.ok) throw new Error('prefetch ' + a);
          await cache.put(a, normalizeForStore(res));
        })
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const path = new URL(req.url).pathname;
  const isVendor = path.startsWith('/vendor/');
  const isFresh =
    req.mode === 'navigate' || path === '/' || path.endsWith('/') ||
    (/\.(html|js|css|webmanifest)$/.test(path) && !isVendor);
  event.respondWith(
    (async () => {
      if (!isFresh) {
        const cached = await caches.match(req);
        if (cached) return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = normalizeForStore(res.clone());
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('offline', { status: 503, statusText: 'offline' });
      }
    })()
  );
});
