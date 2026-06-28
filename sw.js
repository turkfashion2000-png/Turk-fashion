// ===================================================
// Turk Fashion PWA Service Worker v6
// كاش ذكي — بيانات + صور + أصول ثابتة
// ===================================================

const CACHE_NAME    = 'turk-fashion-v6';
const IMG_CACHE     = 'tf-images-v6';
const STATIC_ASSETS = [
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=Cairo:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
];

// الحد الأقصى لعدد الصور في الكاش (لتجنب امتلاء المساحة)
const MAX_IMG_CACHE = 120;

// ==================== INSTALL ====================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of STATIC_ASSETS) {
        try { await cache.add(url); } catch {}
      }
    })
  );
  self.skipWaiting();
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== IMG_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// ==================== HELPERS ====================
function isImage(url) {
  return /\.(jpe?g|png|webp|gif|svg)(\?.*)?$/i.test(url)
    || url.includes('images.unsplash.com')
    || url.includes('firebasestorage.googleapis.com')
    || url.includes('lh3.googleusercontent.com');
}

async function limitImageCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_IMG_CACHE) {
    // نحذف الأقدم (FIFO)
    const toDelete = keys.slice(0, keys.length - MAX_IMG_CACHE);
    await Promise.all(toDelete.map(k => cache.delete(k)));
  }
}

// ==================== FETCH STRATEGY ====================
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // ── 1. الصور: Cache-First (نفرق بين كاش الصور وكاش الأصول)
  if (isImage(request.url)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) {
            cache.put(request, res.clone());
            limitImageCache(cache); // تنظيف في الخلفية
          }
          return res;
        } catch {
          return new Response('', { status: 404 });
        }
      })
    );
    return;
  }

  // ── 2. الخطوط + CDN: Cache-First
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudflare.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('fontawesome.com')
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fetch(request).catch(() => new Response('', { status: 404 }));
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // ── 3. Firebase / Firestore API: Network-Only (لا نكاش الـ API)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com')
  ) {
    return; // نتركها تمر بدون كاش
  }

  // ── 4. صفحة HTML الرئيسية: Network-First مع fallback
  if (
    request.headers.get('accept')?.includes('text/html') ||
    request.url.endsWith('.html') ||
    request.url.endsWith('/')
  ) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // ── 5. الباقي: Network-First مع fallback من الكاش
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    console.log('[SW] Background sync: orders');
  }
});

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const options = {
    body: data.body || 'لديك إشعار جديد من ترك فاشون',
    icon: './icon-192.png',
    badge: './icon-72.png',
    vibrate: [200, 100, 200],
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || './' },
    actions: [
      { action: 'open', title: 'فتح التطبيق' },
      { action: 'close', title: 'إغلاق' }
    ]
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'ترك فاشون 👗', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    const url = event.notification.data?.url || './index.html';
    event.waitUntil(clients.openWindow(url));
  }
});
