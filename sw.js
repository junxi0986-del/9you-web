/* 九游平台 Service Worker：最简缓存优先策略（cache-first，网络兜底） */
const CACHE_NAME = 'jiuyou-cache-v1';

/* 预缓存资源：核心页面 + 图标 + 清单 */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/logo.jpg',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

/* 安装阶段：预缓存核心资源（单个失败不阻塞安装，跳过即可） */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(PRECACHE_URLS.map(u => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

/* 激活阶段：清理旧版本缓存 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 请求拦截：缓存优先，未命中走网络；网络失败回退缓存 */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                     // 只处理 GET（Supabase API 均为非缓存请求）

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;                        // 命中缓存直接返回
      return fetch(req).then(res => {
        // 仅缓存同源成功响应，避免把 Supabase/CDN 响应写入缓存
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => {
        // 网络失败（离线）：页面导航请求回退到缓存的首页
        if (req.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});
