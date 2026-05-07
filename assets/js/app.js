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
