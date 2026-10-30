/* ============================================================
   sw.js — Service worker của AI AGENTS CC
   CHỈ dùng cho: thông báo đẩy (Web Push) + số đỏ trên icon app.
   KHÔNG có sự kiện 'fetch' → không cache trang nào; duyệt web luôn lấy
   bản mới nhất từ máy chủ, deploy xong người dùng thấy ngay.
   ============================================================ */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Nhận thông báo đẩy từ máy chủ: { title, body, url, badge }
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  const tasks = [
    self.registration.showNotification(data.title || 'AI AGENTS CC', {
      body: data.body || '',
      icon: '/assets/img/icon-192.png',
      badge: '/assets/img/badge-96.png', // icon đơn sắc trên thanh trạng thái Android
      data: { url: data.url || '/feed.html' },
    }),
  ];
  // Số đỏ trên icon ngoài màn hình chính (= số thông báo chưa đọc)
  if (typeof data.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    tasks.push(data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge());
  }
  event.waitUntil(Promise.all(tasks).catch(() => {}));
});

// Bấm vào thông báo → mở (hoặc chuyển tới) đúng trang
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/feed.html', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const exact = wins.find((w) => w.url === url);
    if (exact) return exact.focus();
    const same = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (same && 'navigate' in same) {
      const w = await same.navigate(url).catch(() => null);
      return (w || same).focus();
    }
    return self.clients.openWindow(url);
  })());
});
