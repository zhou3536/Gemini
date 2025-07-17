// service-worker.js

// 1. 安装事件
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installed');
    self.skipWaiting(); // 立即激活Service Worker
});

// 2. 激活事件
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activated');
    self.clients.claim(); // 立即控制所有客户端
});

// 3. Fetch事件 (必需，让SW真正“工作”)
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request)); // 直接从网络获取资源，不进行缓存
});

console.log('Service Worker script loaded.');
