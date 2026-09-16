/* 项目跟踪管理平台 Service Worker
   策略：
   - 页面导航请求（HTML）：网络优先，保证用户每次刷新拿到最新版；离线时回退缓存
   - APP 版本检查（app-version.json）：网络优先，确保老用户能及时收到更新提示；离线回退缓存
   - APK 安装包：不缓存（由系统 DownloadManager 下载，避免占空间/下到旧包）
   - 其他静态资源（图标/CSS/JS等）：缓存优先，未命中走网络并写入缓存
   更新代码后无需手动改版本：HTML 网络优先即自动生效 */
const CACHE_NAME = 'jiuyou-cache-v3';

/* 预缓存资源：核心页面 + 图标 + 清单（单个失败不阻塞安装） */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/logo.jpg',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

/* 安装阶段：预缓存核心资源，立即激活新 SW */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(PRECACHE_URLS.map(u => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

/* 激活阶段：清理旧版本缓存并立即接管所有标签页 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                     // 只处理 GET（Supabase API 不缓存）
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // 跨域请求（Supabase/CDN）直接放行，不拦截

  /* 页面导航：网络优先，保证代码更新即时生效；离线回退缓存首页 */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/index.html', clone));
          return res;
        })
        .catch(() => caches.match(req).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  /* APP 版本文件：网络优先，拿到最新版本号才能正确触发更新弹窗；离线回退缓存 */
  if (url.pathname === '/app-version.json') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  /* APK 安装包：不拦截，直接交给网络/系统下载器 */
  if (url.pathname.endsWith('.apk')) return;

  /* 同源静态资源：缓存优先，未命中走网络并缓存 */
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      });
    })
  );
});
