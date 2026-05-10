/* ============================================================
   app.js — Sidebar toggle, mobile nav, tab switching, utils
   ============================================================ */

// Mobile sidebar
function openSidebar() {
  document.getElementById('mob-sidebar')?.classList.add('open');
  document.getElementById('mob-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('mob-sidebar')?.classList.remove('open');
  document.getElementById('mob-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

// Tab switching
function setActiveTab(tabEl, groupSelector = '.tab-item') {
  const group = tabEl.closest('.tab-nav') || document.querySelector('.tab-nav');
  if (!group) return;
  group.querySelectorAll(groupSelector).forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
}

// Password toggle helper
function initPasswordToggle(inputId, toggleBtnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(toggleBtnId);
  if (!input || !btn) return;

  const eyeOpen   = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  const eyeClosed = `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" stroke-linecap="round"/>`;

  let visible = false;
  btn.addEventListener('click', () => {
    visible = !visible;
    input.type = visible ? 'text' : 'password';
    const icon = btn.querySelector('svg');
    if (icon) icon.innerHTML = visible ? eyeClosed : eyeOpen;
  });
}

// Google OAuth (placeholder)
function handleGoogleLogin() {
  const btn     = document.getElementById('googleBtn');
  const spinner = document.getElementById('gSpinner');
  const text    = document.getElementById('googleBtnText');
  if (!btn) return;

  btn.disabled = true;
  if (spinner) spinner.style.display = 'block';
  if (text) text.textContent = 'Đang chuyển hướng...';

  // Replace with real OAuth redirect: window.location.href = '/auth/google';
  setTimeout(() => {
    btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (text) text.textContent = 'Tiếp tục với Google';
  }, 2000);
}

// Show/hide alert banner
function showAlert(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  const msg = el.querySelector('[data-msg]');
  if (msg && message) msg.textContent = message;
  el.style.display = 'flex';
}

function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Password toggles
  initPasswordToggle('password', 'togglePw');
  initPasswordToggle('password_confirmation', 'togglePwConfirm');

  // Close sidebar on overlay click
  document.getElementById('mob-overlay')?.addEventListener('click', closeSidebar);

  // Close sidebar on nav item click (mobile)
  document.querySelectorAll('#mob-sidebar .nav-item').forEach(item => {
    item.addEventListener('click', closeSidebar);
  });

  // Tab switching
  document.querySelectorAll('.tab-item[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => setActiveTab(tab));
  });
});

// ── Notification Bell ────────────────────────────────────────
(function initNotifSystem() {
  const NOTIF_API = '/api';
  let _notifOpen = false;
  let _notifUserId = null;

  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _icon(type) {
    return ({challenge:'🎯',course:'📚',feed:'📢',marketplace:'🛍️',system:'⚙️',
             enrollment_approved:'✅',enrollment_rejected:'❌',submission_reviewed:'📝'})[type] || '🔔';
  }
  function _timeAgo(s) {
    const d = Date.now() - new Date(s).getTime();
    if (d < 60000) return 'Vừa xong';
    if (d < 3600000) return Math.floor(d/60000) + ' phút trước';
    if (d < 86400000) return Math.floor(d/3600000) + ' giờ trước';
    return Math.floor(d/86400000) + ' ngày trước';
  }

  async function _load() {
    if (!_notifUserId) return;
    try {
      const r = await fetch(`${NOTIF_API}/notifications?user_id=${_notifUserId}`);
      const data = await r.json();
      _renderBadge(data.unread);
      _renderDropdown(data.notifications);
    } catch(e) {}
  }

  function _renderBadge(unread) {
    const el = document.getElementById('notifBadge');
    if (!el) return;
    if (unread > 0) { el.textContent = unread > 99 ? '99+' : unread; el.style.display = 'flex'; }
    else { el.style.display = 'none'; }
  }

  function _renderDropdown(notifs) {
    const el = document.getElementById('notifDropdown');
    if (!el) return;
    if (!notifs || !notifs.length) {
      el.innerHTML = '<div class="notif-header"><span>Thông báo</span></div><div class="notif-empty">🔔 Chưa có thông báo nào</div>';
      return;
    }
    const unread = notifs.filter(n => !n.is_read).length;
    el.innerHTML = `
      <div class="notif-header">
        <div class="notif-header-left">
          Thông báo
          ${unread > 0 ? `<span class="notif-unread-count">${unread}</span>` : ''}
        </div>
        ${unread > 0 ? `<button class="notif-read-all-btn" onclick="window._notifMarkAll()">Đọc tất cả</button>` : ''}
      </div>
      <div class="notif-list">${notifs.map(n => `
        <div class="notif-item ${n.is_read?'read':'unread'}" onclick="window._notifClick(${n.id},'${_esc(n.link||'')}')">
          <div class="notif-item-icon">${_icon(n.type)}</div>
          <div class="notif-item-body">
            ${n.title ? `<div class="notif-item-title">${_esc(n.title)}</div>` : ''}
            <div class="notif-item-text">${_esc(n.content)}</div>
            <div class="notif-item-time">${_timeAgo(n.created_at)}</div>
          </div>
          ${!n.is_read ? '<div class="notif-item-dot"></div>' : ''}
        </div>`).join('')}
      </div>`;
  }

  window._notifClick = async function(id, link) {
    if (!_notifUserId) return;
    await fetch(`${NOTIF_API}/notifications/${id}/read`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({user_id: _notifUserId})
    }).catch(()=>{});
    _notifOpen = false;
    const dd = document.getElementById('notifDropdown');
    if (dd) dd.style.display = 'none';
    await _load();
    if (link) location.href = link;
  };

  window._notifMarkAll = async function() {
    if (!_notifUserId) return;
    await fetch(`${NOTIF_API}/notifications/read-all`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({user_id: _notifUserId})
    }).catch(()=>{});
    await _load();
  };

  function _setup() {
    const user = JSON.parse(sessionStorage.getItem('user') || 'null');
    if (!user) return;
    _notifUserId = user.id;
    const bell = document.getElementById('notifBell');
    const dd   = document.getElementById('notifDropdown');
    if (!bell || !dd) return;

    _load();
    setInterval(_load, 60000);

    bell.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      _notifOpen = !_notifOpen;
      dd.style.display = _notifOpen ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
      if (_notifOpen && !bell.contains(e.target) && !dd.contains(e.target)) {
        _notifOpen = false; dd.style.display = 'none';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _setup);
  } else {
    setTimeout(_setup, 300);
  }
})();
