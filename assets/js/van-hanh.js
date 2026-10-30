// Khu vận hành nội bộ: thanh bên trái + tiện ích dùng chung cho phan-cong-nhiem-vu.html và kanban-nhiem-vu.html
(function () {
  var VH = {};
  VH.user = function () { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; } };
  VH.token = function () { var u = VH.user(); return (u && u.session_token) || ''; };
  VH.esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  // Chữ thường + **in đậm**
  VH.fmt = function (s) { return VH.esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); };
  VH.FREQ = { daily: 'mỗi ngày', weekly: 'mỗi tuần', monthly: 'mỗi tháng', adhoc: 'khi phát sinh', once: 'theo sự kiện' };
  VH.relogin = function () {
    var here = location.pathname.split('/').pop() + location.search;
    try { localStorage.removeItem('currentUser'); } catch (e) {}
    location.href = 'index.html?redirect=' + encodeURIComponent(here);
  };
  VH.api = function (url, opts) {
    opts = opts || {};
    var headers = { 'x-user-token': VH.token() };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401 && d.code === 'session_required') {
            if (confirm((d.error || 'Vui lòng đăng nhập.') + '\n\nĐăng nhập ngay?')) VH.relogin();
            throw new Error(d.error || 'Chưa đăng nhập');
          }
          if (!r.ok) throw new Error(d.error || ('Lỗi ' + r.status));
          return d;
        });
      });
  };
  VH.today = function () { return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); };
  VH.fmtDate = function (d) { var p = d.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  VH.canEdit = function (me, memberId) { return !!me && (me.is_admin || (me.member_ids || []).indexOf(memberId) >= 0); };
  // Người cập nhật được 1 lần việc: nếu đã nhận hỗ trợ thì là người nhận, không thì chủ việc (admin luôn được)
  VH.helpOf = function (d, memberId, taskId) { return (d.helps || {})[memberId + '|' + taskId] || null; };
  VH.canEditItem = function (d, memberId, taskId) {
    var h = VH.helpOf(d, memberId, taskId);
    return VH.canEdit(d.me, h && h.status === 'accepted' ? h.to_member_id : memberId);
  };

  // Dòng báo quyền cho trang: vì sao chỉ xem, hoặc được cập nhật thẻ của ai. d = kết quả /api/task-board/state
  VH.accessNote = function (d) {
    var me = d.me, btn = function (t) { return ' <button type="button" class="vh-note-btn" onclick="VH.relogin()">' + t + '</button>'; };
    var hint = '<small>Lưu ý: đăng nhập trang Admin bằng khoá admin là riêng — ở đây cần đăng nhập <b>tài khoản cộng đồng</b> (email) có quyền admin hoặc đã được gắn vào bảng.</small>';
    if (!VH.token()) return '<div class="vh-note warn">👁️ <b>Bạn đang ở chế độ chỉ xem</b> — lý do: chưa đăng nhập.' + btn('🔑 Đăng nhập') + '</div>';
    if (!me) return '<div class="vh-note warn">👁️ <b>Bạn đang ở chế độ chỉ xem</b> — lý do: phiên đăng nhập đã hết hạn.' + btn('🔑 Đăng nhập lại') + '</div>';
    var who = '<b>' + VH.esc(me.email || me.name || 'của bạn') + '</b>';
    if (me.is_admin) return '<div class="vh-note">✏️ Tài khoản admin ' + who + ' — cập nhật được thẻ của mọi người.</div>';
    if (!me.member_ids.length) return '<div class="vh-note warn">👁️ <b>Bạn đang ở chế độ chỉ xem</b> — lý do: tài khoản ' + who +
      ' không phải admin và chưa được gắn với thành viên nào trong bảng. Nhờ admin nhập email này vào ô 🔑 Email tài khoản ở Admin → Phân công nhiệm vụ, hoặc đăng nhập tài khoản khác.' +
      btn('🔄 Đăng nhập tài khoản khác') + hint + '</div>';
    var names = (d.board.members || []).filter(function (m) { return me.member_ids.indexOf(m.id) >= 0; }).map(function (m) { return VH.esc(m.name); }).join(', ');
    return '<div class="vh-note">✏️ Tài khoản ' + who + ' cập nhật được thẻ của: <b>' + names + '</b>. Thẻ của người khác chỉ xem.</div>';
  };

  VH.nav = function (active) {
    var el = document.getElementById('vhSide');
    if (!el) return;
    var links = [
      ['phan-cong', 'phan-cong-nhiem-vu.html', '📋', 'Bảng phân công'],
      ['kanban', 'kanban-nhiem-vu.html', '🗂️', 'Kanban & KPI'],
      ['khach-hang', 'kanban-khach-hang.html', '🤝', 'Kanban khách hàng'],
      ['kich-ban', 'kich-ban-zoom.html', '🎤', 'Kịch bản Zoom'],
    ];
    var u = VH.user();
    var here = location.pathname.split('/').pop();
    el.innerHTML =
      '<div class="vh-brand"><img src="/assets/img/logo.png" alt=""><div><b>AI Agents CC</b><span>Vận hành cộng đồng</span></div></div>' +
      '<div class="vh-label">Công việc</div>' +
      links.map(function (l) {
        return '<a class="vh-link' + (l[0] === active ? ' active' : '') + '" href="' + l[1] + '"' + (l[0] === active ? ' aria-current="page"' : '') + '><span class="ic">' + l[2] + '</span>' + l[3] + '</a>';
      }).join('') +
      '<div class="vh-label">Lối tắt</div>' +
      '<a class="vh-link" href="feed.html"><span class="ic">🏠</span>Về cộng đồng</a>' +
      '<a class="vh-link" href="admin.html" target="_blank" rel="noopener"><span class="ic">⚙️</span>Chỉnh bảng (admin)</a>' +
      '<div class="vh-user">' + (u && u.session_token
        ? '<b>' + VH.esc(((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.email || 'Bạn') + '</b><span>' + VH.esc(u.email || 'Đang đăng nhập') + '</span><br><a href="#" onclick="VH.relogin();return false;" style="font-size:12px;">🔄 Đổi tài khoản</a>'
        : '<a href="index.html?redirect=' + encodeURIComponent(here) + '" onclick="VH.relogin();return false;">🔑 Đăng nhập</a><br><span>để cập nhật việc của bạn</span>') + '</div>';
  };
  window.VH = VH;
})();
