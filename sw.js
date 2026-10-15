const CACHE = 'billiards-aim-v34';
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(
        ASSETS.map(async (a) => {
          const res = await fetch(a, { cache: 'reload' });
          if (!res || !res.ok) throw new Error('prefetch ' + a);
          await cache.put(a, res);
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
  const isFresh =
    req.mode === 'navigate' || path === '/' || path.endsWith('/') ||
    /\.(html|js|css|webmanifest)$/.test(path);
  event.respondWith(
    (async () => {
      if (!isFresh) {
        const cached = await caches.match(req);
        if (cached) return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
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
