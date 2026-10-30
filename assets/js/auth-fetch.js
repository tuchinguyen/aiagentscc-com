// Bảo mật: tự gửi kèm phiên đăng nhập (x-user-token) cho mọi lời gọi /api/ của trang.
// Máy chủ không còn tin số tài khoản trình duyệt tự gửi — thiếu phiên thì báo "session_required",
// khi đó trang mời đăng nhập lại 1 lần rồi quay về đúng trang đang mở.
(function () {
  if (window.__dhAuthFetch) return;
  window.__dhAuthFetch = true;

  function token() {
    try { return (JSON.parse(localStorage.getItem('currentUser') || 'null') || {}).session_token || ''; } catch (e) { return ''; }
  }
  function isApi(url) {
    try { var u = new URL(url, location.href); return u.origin === location.origin && u.pathname.indexOf('/api/') === 0; } catch (e) { return false; }
  }

  var asked = false;
  function needLogin() {
    if (asked) return;
    var page = location.pathname.split('/').pop() || '';
    if (page === '' || /^(index|login|register|forgot-password|reset-password)\.html$/.test(page)) return;
    asked = true;
    alert('Vì lý do bảo mật, vui lòng đăng nhập lại 1 lần để tiếp tục.');
    try { localStorage.removeItem('currentUser'); } catch (e) {}
    location.href = 'index.html?redirect=' + encodeURIComponent(page + location.search);
  }

  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
    if (!isApi(url)) return origFetch(input, init);
    init = init || {};
    var headers = new Headers(init.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
    var t = token();
    if (t && !headers.has('x-user-token') && !headers.has('x-admin-key')) headers.set('x-user-token', t);
    var opts = {};
    for (var k in init) opts[k] = init[k];
    opts.headers = headers;
    return origFetch(input, opts).then(function (res) {
      if (res.status === 401 && !headers.has('x-admin-key')) {
        res.clone().json().then(function (d) { if (d && d.code === 'session_required') needLogin(); }).catch(function () {});
      }
      return res;
    });
  };

  // XMLHttpRequest (tải video báo cáo có thanh tiến độ)
  var xOpen = XMLHttpRequest.prototype.open, xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__dhApi = isApi(url); return xOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    if (this.__dhApi) { var t = token(); if (t) { try { this.setRequestHeader('x-user-token', t); } catch (e) {} } }
    return xSend.apply(this, arguments);
  };
})();
