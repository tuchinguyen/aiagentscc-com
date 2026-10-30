/* ============================================================
   app.js — Sidebar toggle, mobile nav, tab switching, utils
   ============================================================ */

// Chiều cao thật đang nhìn thấy của màn hình → --app-h (layout.css dùng cho khung trang trên điện thoại).
// Trình duyệt cũ / trình duyệt trong Zalo, Facebook không hiểu 100dvh nên phần cuối trang bị thanh công cụ che.
(function dhAppHeight() {
  const set = () => document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
  set();
  window.addEventListener('resize', set);
  window.addEventListener('orientationchange', () => setTimeout(set, 250));
  window.addEventListener('pageshow', set);
})();

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

function openMainMenu() {
  document.getElementById('mob-mainmenu')?.classList.add('open');
  document.getElementById('mob-mainmenu-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMainMenu() {
  document.getElementById('mob-mainmenu')?.classList.remove('open');
  document.getElementById('mob-mainmenu-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

function toggleSidebar() {
  document.getElementById('mob-sidebar')?.classList.contains('open') ? closeSidebar() : openSidebar();
}

function toggleMainMenu() {
  document.getElementById('mob-mainmenu')?.classList.contains('open') ? closeMainMenu() : openMainMenu();
}

// ── Phiên đăng nhập ─────────────────────────────────────────
// Đăng xuất phải xoá phiên lưu trong localStorage — nếu còn, index.html sẽ tự đăng nhập lại.
// Mọi nút có title/aria-label "Đăng xuất" đều đi qua đây (vài trang cũ chỉ xoá sessionStorage).
function clearLoginSession() {
  // Đăng xuất → thiết bị này thôi nhận thông báo đẩy của tài khoản cũ (best-effort)
  try { if (window.dhPush) dhPush.forgetDevice(); } catch (e) {}
  try { localStorage.removeItem('currentUser'); } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}
}

// ── Thông báo đẩy (PWA / Web Push) + số đỏ trên icon app ──────────────
// Service worker /sw.js chỉ nhận thông báo, KHÔNG cache trang. Nút bật/tắt nằm cuối khung chuông.
// iPhone: chỉ nhận được khi đã "Thêm vào MH chính" và mở từ icon (iOS 16.4+).
const dhPush = (() => {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  let reg = null;
  const me = () => { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) { return null; } };
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  if ('serviceWorker' in navigator && me()) {
    navigator.serviceWorker.register('/sw.js').then(r => { reg = r; renderRow(); }).catch(() => {});
  }

  function b64ToUint8(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  async function getSub() {
    if (!supported) return null;
    if (!reg) reg = await navigator.serviceWorker.getRegistration('/');
    return reg ? reg.pushManager.getSubscription() : null;
  }
  function note(text, isErr) {
    const el = document.getElementById('notifPushRow');
    if (el) el.insertAdjacentHTML('beforeend', `<div class="notif-push-note${isErr ? ' err' : ''}">${text}</div>`);
  }

  async function enable() {
    const u = me();
    if (!u || !supported) return;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { await renderRow(); return; }
      if (!reg) reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { publicKey } = await fetch('/api/push/public-key').then(r => r.json());
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) });
      const r = await post('/api/push/subscribe', { user_id: u.id, subscription: sub.toJSON() });
      if (!r.ok) throw new Error('subscribe');
      await renderRow();
      test();
    } catch (e) {
      await renderRow();
      note('Không bật được thông báo trên thiết bị này. Vui lòng thử lại sau.', true);
    }
  }

  async function disable() {
    try {
      const sub = await getSub();
      if (sub) { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    } catch (e) {}
    setAppBadge(0);
    renderRow();
  }

  async function test() {
    const u = me();
    if (!u) return;
    const r = await post('/api/push/test', { user_id: u.id }).catch(() => null);
    note(r && r.ok ? '✓ Đã gửi thông báo thử — kiểm tra thông báo trên thiết bị.' : 'Không gửi được thông báo thử.', !(r && r.ok));
  }

  // Đăng xuất: huỷ đăng ký trên máy chủ + trình duyệt (không chờ)
  function forgetDevice() {
    if (!supported) return;
    getSub().then(sub => {
      if (!sub) return;
      try { navigator.sendBeacon('/api/push/unsubscribe', new Blob([JSON.stringify({ endpoint: sub.endpoint })], { type: 'application/json' })); } catch (e) {}
      sub.unsubscribe().catch(() => {});
    }).catch(() => {});
    setAppBadge(0);
  }

  async function renderRow() {
    const el = document.getElementById('notifPushRow');
    if (!el || !me()) return;
    if (!supported) {
      el.innerHTML = isIOS && !standalone
        ? '📱 <b>Nhận thông báo trên iPhone:</b> bấm nút <b>Chia sẻ</b> <span style="font-size:15px">⎋</span> của Safari → <b>"Thêm vào MH chính"</b>, rồi mở <b>AI Agents CC</b> từ icon trên màn hình chính và bật thông báo tại đây.'
        : 'Trình duyệt này chưa hỗ trợ thông báo đẩy.';
      return;
    }
    if (Notification.permission === 'denied') {
      el.innerHTML = '🔕 Bạn đã chặn thông báo cho trang này. Mở <b>cài đặt trang web</b> của trình duyệt (biểu tượng ổ khoá cạnh địa chỉ) → cho phép <b>Thông báo</b>.';
      return;
    }
    const sub = await getSub().catch(() => null);
    if (sub && Notification.permission === 'granted') {
      el.innerHTML = '🔔 Thông báo đẩy: <b>đang bật</b> trên thiết bị này'
        + '<div class="notif-push-actions"><button type="button" onclick="dhPush.test()">Gửi thử</button><button type="button" onclick="dhPush.disable()">Tắt</button></div>';
    } else {
      el.innerHTML = '<button type="button" class="notif-push-btn" onclick="dhPush.enable()">🔔 Bật thông báo trên thiết bị này</button>'
        + '<div class="notif-push-note">Nhận thông báo như app — kể cả khi không mở trang.</div>';
    }
  }

  // Số đỏ trên icon ngoài màn hình chính (Android, iPhone đã thêm vào MH chính, máy tính đã cài app)
  function setAppBadge(n) {
    try {
      if (!('setAppBadge' in navigator)) return;
      if (n > 0) navigator.setAppBadge(n).catch(() => {}); else navigator.clearAppBadge().catch(() => {});
    } catch (e) {}
  }

  return { enable, disable, test, renderRow, setAppBadge, forgetDevice };
})();
window.dhPush = dhPush;
// Trang tự khai báo doLogout() sẽ ghi đè bản này; bản này cho các trang gọi doLogout() mà thiếu hàm.
function doLogout() {
  clearLoginSession();
  window.location.href = 'index.html';
}
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('[title="Đăng xuất"], [aria-label="Đăng xuất"]')) clearLoginSession();
}, true);

// ── Markdown đơn giản (trang Giới thiệu, Nội quy, popup Nội quy) ─────────
// # tiêu đề, **đậm**, *nghiêng*, danh sách (* / - / 1.), > trích dẫn, --- đường kẻ.
// Luôn escape HTML trước rồi mới thêm thẻ → không chèn được mã lạ.
function renderSimpleMarkdown(src) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = s => esc(s)
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
  return String(src || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(block => {
    const b = block.replace(/^\n+|\n+$/g, '');
    if (!b.trim()) return '';
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(b)) return '<hr>';
    const h = b.match(/^(#{1,4})\s+([^\n]+)$/);
    if (h) { const lv = h[1].length + 1; return `<h${lv}>${inline(h[2].trim())}</h${lv}>`; }
    const lines = b.split('\n');
    if (lines.every(l => /^\s*>/.test(l))) return `<blockquote><p>${inline(lines.map(l => l.replace(/^\s*>\s?/, '')).join('\n'))}</p></blockquote>`;
    if (lines.every(l => /^\s*[*-]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[*-]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every(l => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map(l => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    return `<p>${inline(b)}</p>`;
  }).join('');
}

// ── Link video → URL nhúng được trong <iframe> ─────────────────
// YouTube (watch?v=, youtu.be/, /live/, /shorts/, /embed/), Vimeo, Google Drive (…/file/d/ID/view → /preview).
// Link watch/live/view gốc bị chặn nhúng nên phải đổi. Trả về null nếu không nhận ra.
function videoEmbedUrl(raw) {
  if (!raw) return null;
  const srcMatch = String(raw).match(/\bsrc=["']([^"']+)["']/i); // dán cả mã <iframe>
  const url = (srcMatch ? srcMatch[1] : String(raw)).trim();
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1).split('/')[0]}`;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname.startsWith('/embed/')) return url;
      const p = u.pathname.match(/^\/(live|shorts|v)\/([^/?]+)/);
      if (p) return `https://www.youtube-nocookie.com/embed/${p[2]}`;
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
      return null;
    }
    if (host === 'player.vimeo.com') return url;
    if (host === 'vimeo.com') {
      const m = u.pathname.match(/^\/(\d+)/);
      return m ? `https://player.vimeo.com/video/${m[1]}` : null;
    }
    if (host === 'drive.google.com' || host === 'docs.google.com') {
      const id = (u.pathname.match(/\/d\/([\w-]{15,})/) || [])[1] || u.searchParams.get('id');
      return id ? `https://drive.google.com/file/d/${id}/preview` : null;
    }
  } catch (e) { /* không phải URL */ }
  return null;
}

// Bấm vào ảnh trong popup bài đăng → mở ảnh gốc ở tab mới
document.addEventListener('click', e => {
  const img = e.target.closest && e.target.closest('.pm-body .post-media-img');
  if (img && img.src) window.open(img.src, '_blank', 'noopener');
});

// ── Popup chi tiết bài đăng (feed, space, profile, qa, signal, cot): tác giả sửa bài ──────
// Mỗi trang gọi pmPostExtras(p) sau khi vẽ header popup (#pmHeaderBadges, #pmBody).
let _pmEditPost = null;
function pmPostExtras(p) {
  _pmEditPost = p;
  document.getElementById('postModalOverlay')?.classList.remove('pe-editing');   // mở lại bài → thoát chế độ sửa
  if (p) document.getElementById('pmLikeBtn')?.classList.toggle('liked', !!p.liked);
  const badges = document.getElementById('pmHeaderBadges');
  if (!badges || !p) return;
  const me = typeof currentUser !== 'undefined' ? currentUser : null;
  if (p.hidden) {
    badges.insertAdjacentHTML('beforeend', '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:#e2e8f0;color:#475569">🙈 Admin đã ẩn bài này</span>');
  }
  if (me && (Number(me.id) === Number(p.author_id) || me.is_admin)) {
    badges.insertAdjacentHTML('beforeend', '<button type="button" onclick="editPmPost()" style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-family:inherit;">✏️ Sửa bài</button>');
  }
  // Admin chọn bài làm "bài giới thiệu" ở khung 8 buổi / 377 ngày trên Feed (chỉ có tác dụng với bài trong Space của chương trình)
  if (me && me.is_admin && p.space_id) {
    badges.insertAdjacentHTML('beforeend', `<button type="button" id="pmShowcaseBtn" onclick="togglePmShowcase()" title="Người chưa tham gia chương trình thấy 1/2 bài này ở khung giới thiệu trên Feed" style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid ${p.showcase ? '#f59e0b' : 'var(--border)'};background:${p.showcase ? '#fef3c7' : 'var(--bg-card)'};color:${p.showcase ? '#92400e' : 'var(--text)'};cursor:pointer;font-family:inherit;">${p.showcase ? '⭐ Đang là bài giới thiệu' : '☆ Dùng làm bài giới thiệu'}</button>`);
  }
}
// ── Thích / bỏ thích bài (mỗi người 1 lượt) ─────────────────────────
// Trái tim đỏ = mình đã thích. Cập nhật mọi nút thích của bài trên trang (thẻ trong danh sách + popup đang mở).
(function () {
  if (document.getElementById('dhLikeCss')) return;
  const st = document.createElement('style');
  st.id = 'dhLikeCss';
  st.textContent = `.post-stat.liked, .card-like-btn.liked, .pm-like-btn.liked { color: #ef4444 !important; }
    .post-stat.liked svg, .card-like-btn.liked svg, .pm-like-btn.liked svg { fill: #ef4444; stroke: #ef4444; }`;
  document.head.appendChild(st);
})();
function dhLikeEls(postId) {
  const els = Array.from(document.querySelectorAll(`[onclick*="likePost(${postId},"], [onclick*="cardLike(${postId},"]`));
  if (typeof _pmPostId !== 'undefined' && Number(_pmPostId) === Number(postId)) {
    const b = document.getElementById('pmLikeBtn');
    if (b) els.push(b);
  }
  return els;
}
function dhSetLiked(postId, liked, count) {
  dhLikeEls(postId).forEach(el => {
    el.classList.toggle('liked', !!liked);
    const cnt = el.id === 'pmLikeBtn' ? document.getElementById('pmLikeCount') : el.querySelector('.like-count, .card-like-count');
    if (cnt && count != null) cnt.textContent = count;
  });
}
async function dhToggleLike(postId) {
  if (!postId) return null;
  const me = typeof currentUser !== 'undefined' ? currentUser : null;
  try {
    const r = await fetch(`/api/posts/${postId}/like`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: me ? me.id : null }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Lỗi');
    dhSetLiked(postId, j.liked, j.likes_count);
    return j;
  } catch (e) { return null; }
}

async function togglePmShowcase() {
  const p = _pmEditPost;
  const me = typeof currentUser !== 'undefined' ? currentUser : null;
  if (!p || !me) return;
  try {
    const r = await fetch(`/api/posts/${p.id}/showcase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: me.id }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Lỗi');
    p.showcase = j.showcase;
    const btn = document.getElementById('pmShowcaseBtn');
    if (btn) {
      btn.textContent = j.showcase ? '⭐ Đang là bài giới thiệu' : '☆ Dùng làm bài giới thiệu';
      btn.style.borderColor = j.showcase ? '#f59e0b' : 'var(--border)';
      btn.style.background = j.showcase ? '#fef3c7' : 'var(--bg-card)';
      btn.style.color = j.showcase ? '#92400e' : 'var(--text)';
    }
    if (typeof loadShowcase === 'function') loadShowcase();
  } catch (e) { alert(e.message); }
}

// Khung sửa bài — giống lúc đăng bài: tiêu đề, nội dung, emoji, ảnh (tải từ máy hoặc dán link), video, tài liệu, GIF,
// đổi Space / Topic / Trụ cột. Tác giả sửa bài của mình; admin sửa được mọi bài.
const PE_EMOJI = ['😀','😂','😍','🤔','👍','🔥','🎉','💡','🚀','❤️','😢','😅','🙌','👏','💪','🤝','✅','⚡','🎯','📌','😎','🥳','🤯','😴','👀','🙏','💯','⭐','✨','🌿','🍵','🥗','🍋','🫚','🌾','🍚','🥬','💧'];
const PE_DRIVE_RE = /(drive|docs)\.google\.com/i;
const PE_ATTACH = {
  image: ['🖼️', 'Ảnh', 'image_url', 'Dán link ảnh hoặc bấm Tải ảnh lên'],
  video: ['🎬', 'Video', 'video_url', 'Dán link video (YouTube, Google Drive...)'],
  doc:   ['📄', 'Tài liệu', 'doc_url', 'Dán link tài liệu (Google Docs, PDF...)'],
  gif:   ['🎞️', 'GIF', 'gif_url', 'Dán link GIF (https://...)'],
};
function peCss() {
  if (document.getElementById('peCss')) return;
  const st = document.createElement('style');
  st.id = 'peCss';
  st.textContent = `.pe-in{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-input, var(--bg-card));color:var(--text);font-family:inherit;font-size:14px;}
    .pe-title{font-size:16px;font-weight:700;}
    .pe-tools{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 4px;position:relative;}
    .pe-tool{border:1px solid var(--border);background:var(--bg-card);color:var(--text);border-radius:9px;padding:6px 10px;font-family:inherit;font-size:13px;cursor:pointer;display:inline-flex;gap:5px;align-items:center;}
    .pe-tool.on{background:var(--color-primary);border-color:var(--color-primary);color:#fff;}
    .pe-emoji{position:absolute;top:100%;left:0;z-index:30;display:none;grid-template-columns:repeat(8,34px);gap:2px;padding:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);}
    .pe-emoji.open{display:grid;}
    .pe-emoji button{border:none;background:none;font-size:20px;cursor:pointer;border-radius:6px;padding:3px;}
    .pe-emoji button:hover{background:var(--bg-hover);}
    .pe-att{display:flex;gap:6px;align-items:center;margin-top:8px;}
    .pe-att .ic{font-size:16px;flex-shrink:0;}
    .pe-att .pe-in{flex:1;min-width:0;padding:8px 10px;font-size:13.5px;}
    .pe-x{border:none;background:none;color:var(--text-muted);font-size:18px;cursor:pointer;padding:0 4px;}
    .pe-up{border:1px solid var(--border);background:var(--bg-hover);color:var(--text);border-radius:8px;padding:7px 10px;font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;}
    .pe-prev{max-width:180px;max-height:120px;border-radius:8px;margin:6px 0 0 26px;display:block;object-fit:cover;}
    .pe-note{font-size:11.5px;color:var(--text-muted);margin:4px 0 0 26px;}
    .pe-sel{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
    .pe-editing #pmComments,.pe-editing .pm-comment-form,.pe-editing .pm-actions{display:none !important;}
    .pe-sel select{flex:1;min-width:150px;padding:9px 10px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card);color:var(--text);font-family:inherit;font-size:13.5px;}`;
  document.head.appendChild(st);
}
async function editPmPost() {
  const p = _pmEditPost;
  const body = document.getElementById('pmBody');
  const me = typeof currentUser !== 'undefined' ? currentUser : null;
  if (!p || !body || !me) return;
  peCss();
  document.getElementById('postModalOverlay')?.classList.add('pe-editing');   // đang sửa: ẩn bình luận để khung sửa rộng
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const open = new Set(Object.keys(PE_ATTACH).filter(k => p[PE_ATTACH[k][2]]));
  body.innerHTML = `
    <div style="font-weight:700;font-size:15px;margin-bottom:10px;">✏️ Sửa bài viết${Number(me.id) !== Number(p.author_id) ? ' <span style="font-size:12px;font-weight:600;color:#f59e0b;">(admin sửa bài của thành viên)</span>' : ''}</div>
    <input id="pmEditTitle" class="pe-in pe-title" maxlength="200" placeholder="Tiêu đề (tuỳ chọn)" value="${esc(p.title)}">
    <textarea id="pmEditContent" class="pe-in" rows="9" style="margin-top:8px;resize:vertical;line-height:1.6;" placeholder="Nội dung bài viết *">${esc(p.content)}</textarea>
    <div class="pe-tools">
      ${Object.entries(PE_ATTACH).map(([k, a]) => `<button type="button" class="pe-tool${open.has(k) ? ' on' : ''}" data-k="${k}">${a[0]} ${a[1]}</button>`).join('')}
      <button type="button" class="pe-tool" id="peEmojiBtn">😀 Emoji</button>
      <div class="pe-emoji" id="peEmoji">${PE_EMOJI.map(e => `<button type="button">${e}</button>`).join('')}</div>
    </div>
    <div id="peAtt"></div>
    ${p.poll_question ? '<div class="pe-note" style="margin-left:0;margin-top:8px;">📊 Bình chọn giữ nguyên (không sửa được sau khi đăng để không làm sai kết quả đã bình chọn).</div>' : ''}
    <div class="pe-sel">
      <select id="peSpace" aria-label="Space"><option value="">🏠 Feed chung (không thuộc Space)</option></select>
      <select id="peTopic" aria-label="Topic"><option value="">Không chọn Topic</option></select>
      <select id="pePillar" aria-label="Trụ cột"><option value="">Không thuộc trụ cột</option></select>
    </div>
    <div id="pmEditErr" style="color:#ef4444;font-size:13px;margin-top:10px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button type="button" onclick="openPost(${Number(p.id)})" style="padding:9px 18px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-family:inherit;font-weight:600;">Huỷ</button>
      <button type="button" id="pmEditSave" onclick="savePmPost()" style="padding:9px 18px;border-radius:10px;border:none;background:var(--color-primary);color:#fff;cursor:pointer;font-family:inherit;font-weight:700;">Lưu thay đổi</button>
    </div>`;
  const vals = Object.fromEntries(Object.keys(PE_ATTACH).map(k => [k, p[PE_ATTACH[k][2]] || '']));
  const attWrap = body.querySelector('#peAtt');
  const renderAtt = () => {
    attWrap.querySelectorAll('input[data-k]').forEach(i => { vals[i.dataset.k] = i.value.trim(); });
    attWrap.innerHTML = Object.entries(PE_ATTACH).filter(([k]) => open.has(k)).map(([k, a]) => `
      <div class="pe-att"><span class="ic">${a[0]}</span><input class="pe-in" data-k="${k}" placeholder="${a[3]}" value="${esc(vals[k])}">
        ${k === 'image' ? '<button type="button" class="pe-up" id="peUpBtn">📤 Tải ảnh lên</button><input type="file" accept="image/*" id="peUpFile" hidden>' : ''}
        <button type="button" class="pe-x" data-x="${k}" title="Bỏ ${a[1].toLowerCase()}">×</button></div>
      ${k === 'image' ? `<div id="peUpStatus" class="pe-note"></div>${vals.image ? `<img class="pe-prev" src="${esc(vals.image)}" alt="Ảnh hiện tại" onerror="this.remove()">` : ''}` : ''}
      ${k === 'image' || k === 'gif' ? `<div class="pe-note pe-drive" data-for="${k}"${PE_DRIVE_RE.test(vals[k]) ? '' : ' hidden'}>💡 Link Google Drive: nhớ đặt chia sẻ "Bất kỳ ai có đường liên kết" thì ảnh mới hiện.</div>` : ''}`).join('');
    // Lời nhắc Google Drive chỉ hiện khi đang dán link Drive
    attWrap.querySelectorAll('input[data-k]').forEach(i => i.addEventListener('input', () => {
      const n = attWrap.querySelector(`.pe-drive[data-for="${i.dataset.k}"]`);
      if (n) n.hidden = !PE_DRIVE_RE.test(i.value);
    }));
    attWrap.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { vals[b.dataset.x] = ''; open.delete(b.dataset.x); syncTools(); renderAtt(); });
    const up = attWrap.querySelector('#peUpBtn'), file = attWrap.querySelector('#peUpFile');
    if (up) {
      up.onclick = () => file.click();
      file.onchange = async () => {
        const f = file.files[0]; file.value = '';
        if (!f) return;
        const status = attWrap.querySelector('#peUpStatus'), save = document.getElementById('pmEditSave');
        up.disabled = true; save.disabled = true;
        try {
          const url = await dhUploadImage(f, me.id, 'post', t => { status.textContent = t; });
          // Ghi vào ô link trước khi vẽ lại (renderAtt đọc lại giá trị từ các ô)
          const inp = attWrap.querySelector('input[data-k="image"]');
          if (inp) inp.value = url;
          vals.image = url;
          renderAtt();
          const st2 = attWrap.querySelector('#peUpStatus');
          if (st2) st2.textContent = '✅ Đã tải ảnh lên — bấm "Lưu thay đổi" để cập nhật bài.';
        } catch (e) { status.textContent = '⚠️ ' + (e.message || 'Tải ảnh thất bại, vui lòng thử lại.'); }
        up.disabled = false; save.disabled = false;
      };
    }
  };
  const syncTools = () => body.querySelectorAll('.pe-tool[data-k]').forEach(b => b.classList.toggle('on', open.has(b.dataset.k)));
  body.querySelectorAll('.pe-tool[data-k]').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (open.has(k) && !(attWrap.querySelector(`input[data-k="${k}"]`)?.value.trim())) open.delete(k); else open.add(k);
    syncTools(); renderAtt();
    attWrap.querySelector(`input[data-k="${k}"]`)?.focus();
  });
  // Emoji chèn vào chỗ con trỏ trong nội dung
  const ta = body.querySelector('#pmEditContent'), emo = body.querySelector('#peEmoji');
  body.querySelector('#peEmojiBtn').onclick = e => { e.stopPropagation(); emo.classList.toggle('open'); };
  emo.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = ta.selectionStart ?? ta.value.length, z = ta.selectionEnd ?? a;
    ta.value = ta.value.slice(0, a) + b.textContent + ta.value.slice(z);
    ta.focus(); ta.setSelectionRange(a + b.textContent.length, a + b.textContent.length);
    emo.classList.remove('open');
  };
  body.addEventListener('click', e => { if (!e.target.closest('#peEmoji') && e.target.id !== 'peEmojiBtn') emo.classList.remove('open'); });
  renderAtt();
  // Space / Topic / Trụ cột — như lúc đăng bài
  const spSel = body.querySelector('#peSpace'), tpSel = body.querySelector('#peTopic'), plSel = body.querySelector('#pePillar');
  const loadTopics = async (spaceId, keep) => {
    tpSel.innerHTML = '<option value="">Không chọn Topic</option>';
    if (!spaceId) return;
    try {
      const { topics } = await fetch(`/api/topics?space_id=${spaceId}`).then(r => r.json());
      (topics || []).forEach(t => tpSel.insertAdjacentHTML('beforeend', `<option value="${t.id}">${esc(t.icon || '🏷️')} ${esc(t.name)}</option>`));
      if (keep) tpSel.value = String(keep);
    } catch (e) { /* bỏ qua */ }
  };
  try {
    const [{ spaces }, { pillars }] = await Promise.all([
      fetch(`/api/spaces?user_id=${me.id}`).then(r => r.json()),
      fetch('/api/pillars').then(r => r.json()).catch(() => ({ pillars: [] })),
    ]);
    (spaces || []).filter(sp => sp.visibility === 'public' || sp.join_status === 'approved' || me.is_admin || sp.id === p.space_id)
      .forEach(sp => spSel.insertAdjacentHTML('beforeend', `<option value="${sp.id}">${esc(sp.icon || '💬')} ${esc(sp.name)}</option>`));
    (pillars || []).forEach(pl => plSel.insertAdjacentHTML('beforeend', `<option value="${esc(pl.key)}">${esc(pl.icon || '')} ${esc(pl.label)}</option>`));
  } catch (e) { /* bỏ qua */ }
  spSel.value = p.space_id ? String(p.space_id) : '';
  plSel.value = p.pillar || '';
  await loadTopics(spSel.value, p.topic_id);
  spSel.onchange = () => loadTopics(spSel.value);
  body._peVals = () => { attWrap.querySelectorAll('input[data-k]').forEach(i => { vals[i.dataset.k] = i.value.trim(); }); return vals; };
}

async function savePmPost() {
  const p = _pmEditPost;
  const me = typeof currentUser !== 'undefined' ? currentUser : null;
  const bodyEl = document.getElementById('pmBody');
  if (!p || !me || !bodyEl) return;
  const err = document.getElementById('pmEditErr');
  const vals = bodyEl._peVals ? bodyEl._peVals() : {};
  const sp = document.getElementById('peSpace'), tp = document.getElementById('peTopic'), pl = document.getElementById('pePillar');
  const body = {
    user_id: me.id,
    title: document.getElementById('pmEditTitle').value.trim(),
    content: document.getElementById('pmEditContent').value,
    image_url: vals.image || '', video_url: vals.video || '', doc_url: vals.doc || '', gif_url: vals.gif || '',
  };
  if (sp) { body.space_id = sp.value ? Number(sp.value) : null; body.topic_id = tp && tp.value ? Number(tp.value) : null; }
  if (pl) body.pillar = pl.value || null;
  if (!body.content.trim()) { err.textContent = 'Nội dung không được để trống.'; return; }
  if (['image_url', 'video_url', 'doc_url', 'gif_url'].some(k => body[k] && !/^https?:\/\//i.test(body[k]))) {
    err.textContent = 'Link phải bắt đầu bằng https://'; return;
  }
  const btn = document.getElementById('pmEditSave');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const r = await fetch(`/api/posts/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Không lưu được.');
    if (typeof openPost === 'function') openPost(p.id);
    if (typeof loadFeed === 'function') loadFeed();
    else if (typeof loadPosts === 'function') loadPosts();
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = 'Lưu thay đổi';
  }
}

// ── Popup Nội quy: thành viên chưa đồng ý phiên bản nội quy hiện tại phải xác nhận mới dùng tiếp ──
function showRulesConsent(userId, onDone) {
  if (document.getElementById('rulesConsent')) return;
  const wrap = document.createElement('div');
  wrap.id = 'rulesConsent';
  wrap.className = 'rules-consent';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
    <div class="rules-consent-box">
      <div class="rules-consent-head">
        <div class="rules-consent-title">📜 Nội quy cộng đồng</div>
        <div class="rules-consent-sub">Vui lòng đọc kỹ và xác nhận để tiếp tục sử dụng cộng đồng.</div>
      </div>
      <div class="rules-consent-body md-content">Đang tải nội quy...</div>
      <div class="rules-consent-foot">
        <label class="rules-consent-check"><input type="checkbox" id="rulesConsentChk"> Tôi đã đọc và đồng ý với Nội quy cộng đồng</label>
        <div class="rules-consent-actions">
          <a href="index.html" class="rules-consent-logout" onclick="clearLoginSession()">Đăng xuất</a>
          <button type="button" class="rules-consent-btn" id="rulesConsentBtn" disabled>Tôi đồng ý</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const chk = wrap.querySelector('#rulesConsentChk');
  const btn = wrap.querySelector('#rulesConsentBtn');
  chk.addEventListener('change', () => { btn.disabled = !chk.checked; });
  fetch('/api/settings').then(r => r.json()).then(s => {
    wrap.querySelector('.rules-consent-body').innerHTML = renderSimpleMarkdown(s.rules_content || '');
  }).catch(() => { wrap.querySelector('.rules-consent-body').textContent = 'Không tải được nội quy. Vui lòng tải lại trang.'; });
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    try {
      const r = await fetch('/api/rules/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) });
      if (!r.ok) throw new Error();
      wrap.remove();
      document.body.style.overflow = '';
      if (typeof onDone === 'function') onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Thử lại';
    }
  });
}

// SĐT hợp lệ — giống validPhone ở server: VN di động đủ 10 số (03/05/07/08/09), máy bàn 11 số (02),
// +84 / 84 coi như 0; nước ngoài +mã nước, 8–15 chữ số
function dhValidPhone(p) {
  let s = String(p || '').replace(/[\s.\-()]/g, '');
  if (/^\+84/.test(s)) s = '0' + s.slice(3);
  else if (/^84[35789]\d{8}$/.test(s)) s = '0' + s.slice(2);
  return /^0[35789]\d{8}$/.test(s) || /^02\d{9}$/.test(s) || /^\+[1-9]\d{7,14}$/.test(s);
}

// ── Bắt buộc đủ Họ, Tên, Email, Số điện thoại: thiếu thì hiện bảng cập nhật, chưa lưu xong thì không dùng tiếp được ──
function showProfileRequired(u, missing) {
  if (document.getElementById('profileRequired')) return;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const wrap = document.createElement('div');
  wrap.id = 'profileRequired';
  wrap.className = 'rules-consent';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  const field = (id, label, val, attrs) => `<label for="${id}" style="display:block;font-size:13px;font-weight:600;margin:12px 0 5px;">${label} *</label>
    <input id="${id}" value="${esc(val)}" ${attrs} style="width:100%;box-sizing:border-box;padding:11px 12px;font-size:16px;font-family:inherit;border:1px solid var(--border);border-radius:10px;background:var(--bg-card);color:var(--text);">`;
  wrap.innerHTML = `
    <div class="rules-consent-box" style="max-width:460px;">
      <div class="rules-consent-head">
        <div class="rules-consent-title">👤 Hoàn thiện thông tin của bạn</div>
        <div class="rules-consent-sub">Ban tổ chức cần đủ <b>Họ, Tên, Email và Số điện thoại</b> để liên hệ, gửi lịch Zoom và chăm sóc bạn trong chương trình. Vui lòng cập nhật để tiếp tục sử dụng cộng đồng.</div>
      </div>
      <div class="rules-consent-body" style="padding-top:4px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px;">
          <div>${field('prFirst', 'Họ', u.first_name, 'autocomplete="family-name" placeholder="VD: Nguyễn"')}</div>
          <div>${field('prLast', 'Tên', u.last_name, 'autocomplete="given-name" placeholder="VD: Thị Lan"')}</div>
        </div>
        ${field('prEmail', 'Email', u.email, 'type="email" readonly')}
        ${field('prPhone', 'Số điện thoại (Zalo)', missing.includes('phone') ? '' : u.phone, 'type="tel" inputmode="tel" autocomplete="tel" placeholder="VD: 0912 345 678 (nước ngoài: +mã nước)"')}
        <div id="prErr" style="display:none;margin-top:12px;padding:10px 12px;border-radius:10px;background:#fee2e2;color:#991b1b;font-size:13.5px;"></div>
      </div>
      <div class="rules-consent-foot">
        <div class="rules-consent-actions">
          <a href="index.html" class="rules-consent-logout" onclick="clearLoginSession()">Đăng xuất</a>
          <button type="button" class="rules-consent-btn" id="prSave">💾 Lưu và tiếp tục</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const $ = id => wrap.querySelector('#' + id);
  $('prEmail').style.opacity = '.7';
  (missing.includes('phone') ? $('prPhone') : $('prFirst')).focus();
  $('prSave').addEventListener('click', async () => {
    const first = $('prFirst').value.trim(), last = $('prLast').value.trim(), phone = $('prPhone').value.trim();
    const err = $('prErr');
    const fail = m => { err.textContent = m; err.style.display = 'block'; };
    err.style.display = 'none';
    if (!first || !last) return fail('Vui lòng nhập đủ Họ và Tên.');
    if (!dhValidPhone(phone)) return fail('Số điện thoại chưa đúng hoặc thiếu số. Số Việt Nam phải đủ 10 số, VD: 0912345678 — ở nước ngoài ghi +mã nước, VD +61412345678.');
    const btn = $('prSave');
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    try {
      await dhSecureFetch(`/api/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ user_id: u.id, first_name: first, last_name: last, phone }) });
      try {
        const cur = JSON.parse(localStorage.getItem('currentUser') || '{}');
        Object.assign(cur, { first_name: first, last_name: last, phone });
        localStorage.setItem('currentUser', JSON.stringify(cur));
      } catch (e) { /* bỏ qua */ }
      wrap.remove();
      document.body.style.overflow = '';
    } catch (e) {
      fail(e.message);
      btn.disabled = false; btn.textContent = '💾 Lưu và tiếp tục';
    }
  });
}

// Tài khoản đã bị xoá / bị khoá mà trình duyệt vẫn giữ phiên cũ → buộc đăng nhập (hoặc đăng ký) lại.
// Còn hợp lệ nhưng chưa đồng ý Nội quy (phiên bản hiện tại) → hiện popup xác nhận.
(function checkLoginSession() {
  let u = null;
  try { u = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) {}
  if (!u || !u.id) return;
  fetch('/api/auth/session-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: u.id }),
  })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (d && d.valid === false) {
        clearLoginSession();
        window.location.href = 'index.html?session=expired';
        return;
      }
      // Nội quy trước (nếu cần), xong tới bảng thông tin bắt buộc
      const page = location.pathname.split('/').pop() || 'index.html';
      const needProfile = d && Array.isArray(d.profile_missing) && d.profile_missing.length
        && !/^(index|login|register|forgot-password|reset-password)\.html$/i.test(page);
      const profile = () => { if (needProfile) showProfileRequired(u, d.profile_missing); };
      const run = () => (d && d.rules_pending ? showRulesConsent(u.id, profile) : profile());
      if (d) { if (document.body) run(); else document.addEventListener('DOMContentLoaded', run); }
    })
    .catch(() => {}); // lỗi mạng: không đăng xuất nhầm
})();

// ── Dynamic community branding ─────────────────────────────
(function applyCommunityBranding() {
  const DEFAULT_NAME = 'AI AGENTS CC';
  const CACHE_KEY = 'communitySettingsCache';
  let _titleObserver = null;

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeCache(s) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // Replace the fallback name with the real community name — guarded so it can't loop
  // when `name` itself contains DEFAULT_NAME (e.g. "AI AGENTS CC").
  function replaceInTitle(name) {
    if (name === DEFAULT_NAME) return;
    if (document.title.includes(name)) return;           // already branded
    if (!document.title.includes(DEFAULT_NAME)) return;  // nothing to replace
    const next = document.title.split(DEFAULT_NAME).join(name);
    if (next === document.title) return;
    // pause the observer while we set the title so our own write doesn't re-trigger it
    if (_titleObserver) _titleObserver.disconnect();
    document.title = next;
    if (_titleObserver) _titleObserver.observe(document.querySelector('title'), { childList: true });
  }

  function apply(s) {
    const tagline = (s.home_tagline || '').trim();
    const taglineEl = document.getElementById('pageTagline');
    if (tagline && taglineEl) taglineEl.textContent = tagline;

    const name = (s.community_name || '').trim();
    if (!name) return;

    // Logo luôn lấy theo tên đã cài (kể cả khi trùng DEFAULT_NAME) — markup tĩnh của
    // các trang vẫn còn logo cũ "Ngũ Hành ÂU".
    document.querySelectorAll('.sidebar-logo-text, .form-logo-name, .mob-brand-name, #aboutCommunityName, .co-logo-text, .logo-text, .login-logo-name, .header-name').forEach(el => {
      el.textContent = name;
    });

    if (name === DEFAULT_NAME) return; // tiêu đề trang đã đúng sẵn
    const titleEl = document.querySelector('title');
    if (titleEl && !_titleObserver) {
      _titleObserver = new MutationObserver(() => replaceInTitle(name));
      _titleObserver.observe(titleEl, { childList: true });
    }
    replaceInTitle(name);
  }

  // Render from last-known settings immediately (no fetch wait) so the brand
  // name/tagline don't visibly flash from the default → real value on every
  // page navigation; then refresh in the background and re-apply if changed.
  const cached = readCache();
  if (cached) apply(cached);

  fetch('/api/settings').then(r => r.json()).then(s => {
    if (JSON.stringify(s) !== JSON.stringify(cached)) apply(s);
    writeCache(s);
  }).catch(() => {});
})();

// ── Global topbar search ─────────────────────────────────────
(function initGlobalSearch() {
  const input = document.getElementById('globalSearchInput');
  const panel = document.getElementById('globalSearchResults');
  if (!input || !panel) return;

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function renderResults(data) {
    const posts = data.posts || [], users = data.users || [], products = data.products || [];
    if (!posts.length && !users.length && !products.length) {
      panel.innerHTML = '<div class="gsr-empty">Không tìm thấy kết quả nào.</div>';
      return;
    }
    let html = '';
    if (posts.length) {
      html += '<div class="gsr-group-title">Bài viết</div>' + posts.map(p => `
        <a class="gsr-item" href="feed.html?post_id=${p.id}">
          <div class="gsr-item-icon">📝</div>
          <div class="gsr-item-text">
            <div class="gsr-item-title">${esc(p.title)}</div>
            <div class="gsr-item-sub">${esc(p.first_name)} ${esc(p.last_name)}</div>
          </div>
        </a>`).join('');
    }
    if (users.length) {
      html += '<div class="gsr-group-title">Thành viên</div>' + users.map(u => `
        <a class="gsr-item" href="profile.html?id=${u.id}">
          <div class="gsr-item-icon">${esc((u.first_name || '?')[0])}</div>
          <div class="gsr-item-text">
            <div class="gsr-item-title">${esc(u.first_name)} ${esc(u.last_name)}</div>
            <div class="gsr-item-sub">Lv.${u.level || 1} · ${u.xp || 0} XP</div>
          </div>
        </a>`).join('');
    }
    if (products.length) {
      html += '<div class="gsr-group-title">Sản phẩm</div>' + products.map(p => `
        <a class="gsr-item" href="marketplace.html?product_id=${p.id}">
          <div class="gsr-item-icon" style="background:${p.cover_color || 'var(--color-primary)'}">🛍️</div>
          <div class="gsr-item-text">
            <div class="gsr-item-title">${esc(p.title)}</div>
            <div class="gsr-item-sub">${Number(p.price || 0).toLocaleString('vi-VN')}₫</div>
          </div>
        </a>`).join('');
    }
    panel.innerHTML = html;
  }

  async function runSearch(q) {
    panel.innerHTML = '<div class="gsr-loading">Đang tìm...</div>';
    panel.classList.add('open');
    try {
      const data = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json());
      renderResults(data);
    } catch (e) {
      panel.innerHTML = '<div class="gsr-empty">Lỗi kết nối server.</div>';
    }
  }

  let debounceTimer = null;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (!q) { panel.classList.remove('open'); panel.innerHTML = ''; return; }
    debounceTimer = setTimeout(() => runSearch(q), 300);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim() && panel.innerHTML) panel.classList.add('open');
  });

  document.addEventListener('click', (e) => {
    if (e.target !== input && !panel.contains(e.target)) panel.classList.remove('open');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { panel.classList.remove('open'); input.blur(); }
  });
})();

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

  injectSidebarPolicyLinks();
});

// Policy links above the user card in every sidebar (desktop + mobile)
function injectSidebarPolicyLinks() {
  document.querySelectorAll('#sidebar-user, #mob-sidebar-user').forEach(userCard => {
    if (userCard.previousElementSibling?.classList.contains('sidebar-policy')) return;
    const links = document.createElement('nav');
    links.className = 'sidebar-policy';
    links.setAttribute('aria-label', 'Chính sách');
    links.innerHTML = `
      <a href="policies.html">Chính sách</a>
      <a href="refund-policy.html">Hoàn tiền</a>
      <a href="terms.html">Điều khoản</a>
      <a href="support.html">Hỗ trợ</a>`;
    userCard.before(links);
  });
}

// ── Theme toggle (sáng/tối) ──────────────────────────────────
(function initThemeToggle() {
  const MOON = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
  const SUN  = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke-linecap="round"/>';

  function applyIcon(btn, isDark) {
    const svg = btn.querySelector('svg');
    if (svg) svg.innerHTML = isDark ? SUN : MOON;
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) {}
    document.querySelectorAll('#themeToggle, #themeToggleMob').forEach(btn => applyIcon(btn, theme === 'dark'));
  }

  function setup() {
    const btns = document.querySelectorAll('#themeToggle, #themeToggleMob');
    if (!btns.length) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    btns.forEach(btn => {
      applyIcon(btn, isDark);
      btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        setTheme(next);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ── Spaces sidebar section ───────────────────────────────────
(function initSpacesNav() {
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function currentSpaceId() {
    if (!location.pathname.endsWith('space.html')) return null;
    return new URLSearchParams(location.search).get('id');
  }

  function insertInto(navEl, groups) {
    if (!navEl) return;
    navEl.querySelectorAll('.spaces-nav-group').forEach(el => el.remove());
    if (!groups.length) return;

    let target = null;
    navEl.querySelectorAll('.nav-section-label').forEach(l => {
      if (l.textContent.trim() === 'Học tập') target = l;
    });
    if (!target) return;

    const activeId = currentSpaceId();
    groups.forEach(g => {
      const hasActive = g.spaces.some(s => String(s.id) === activeId);
      const storeKey = 'spacesNavCollapsed:' + g.id;
      const collapsed = !hasActive && localStorage.getItem(storeKey) === '1';

      const wrap = document.createElement('div');
      wrap.className = 'spaces-nav-group' + (collapsed ? ' collapsed' : '');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-section-label spaces-nav-label';
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.innerHTML = `<span>${esc(g.name)}</span><svg class="spaces-nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>`;
      btn.addEventListener('click', () => {
        const isCollapsed = wrap.classList.toggle('collapsed');
        btn.setAttribute('aria-expanded', String(!isCollapsed));
        localStorage.setItem(storeKey, isCollapsed ? '1' : '0');
      });

      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'spaces-nav-items';
      g.spaces.forEach(s => {
        const a = document.createElement('a');
        a.href = `space.html?id=${s.id}`;
        a.className = 'nav-item spaces-nav-item' + (String(s.id) === activeId ? ' active' : '');
        a.innerHTML = `<span style="width:17px;flex-shrink:0;text-align:center;font-size:14px;">${esc(s.icon || '💬')}</span>${esc(s.name)}`;
        itemsWrap.appendChild(a);
      });

      wrap.appendChild(btn);
      wrap.appendChild(itemsWrap);
      target.parentNode.insertBefore(wrap, target);
    });
  }

  function readCache(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  async function setup() {
    const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    const cacheKey = 'spacesNavCache:' + (user ? user.id : 'guest');
    // Render from last-known groups immediately so the sidebar doesn't
    // visibly pop in new items after the page has already rendered; then
    // refresh in the background and only touch the DOM again if it changed.
    const cached = readCache(cacheKey);
    if (cached) {
      insertInto(document.getElementById('sidebar-nav'), cached);
      insertInto(document.querySelector('#mob-sidebar nav'), cached);
    }
    try {
      const qs = user ? `?user_id=${user.id}` : '';
      const { groups } = await fetch(`/api/space-groups${qs}`).then(r => r.json());
      const fresh = groups || [];
      if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
        insertInto(document.getElementById('sidebar-nav'), fresh);
        insertInto(document.querySelector('#mob-sidebar nav'), fresh);
      }
      writeCache(cacheKey, fresh);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ── Courses sidebar section (only courses the user has joined) ─
(function initCoursesNav() {
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function currentCourseId() {
    if (!location.pathname.endsWith('courses.html')) return null;
    return new URLSearchParams(location.search).get('course_id');
  }

  function insertInto(navEl, courses) {
    if (!navEl) return;
    navEl.querySelectorAll('.courses-nav-item').forEach(el => el.remove());
    if (!courses.length) return;

    let anchor = null;
    navEl.querySelectorAll('.nav-section-label').forEach(l => {
      if (l.textContent.trim() === 'Học tập') anchor = l;
    });
    if (!anchor) return;

    const activeId = currentCourseId();
    let ref = anchor;
    courses.forEach(c => {
      const a = document.createElement('a');
      a.href = `courses.html?course_id=${c.id}`;
      a.className = 'nav-item courses-nav-item' + (String(c.id) === activeId ? ' active' : '');
      a.innerHTML = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z"/></svg>${esc(c.title)}`;
      ref.parentNode.insertBefore(a, ref.nextSibling);
      ref = a;
    });
  }

  function readCache(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  async function setup() {
    const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!user) return;
    const cacheKey = 'coursesNavCache:' + user.id;
    const cached = readCache(cacheKey);
    if (cached) {
      insertInto(document.getElementById('sidebar-nav'), cached);
      insertInto(document.querySelector('#mob-sidebar nav'), cached);
    }
    try {
      const { courses } = await fetch(`/api/courses?user_id=${user.id}`).then(r => r.json());
      const mine = (courses || []).filter(c => c.enroll_status === 'approved');
      if (JSON.stringify(mine) !== JSON.stringify(cached)) {
        insertInto(document.getElementById('sidebar-nav'), mine);
        insertInto(document.querySelector('#mob-sidebar nav'), mine);
      }
      writeCache(cacheKey, mine);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ── Collapsible sidebar sections ("Học tập", "Cẩm nang") ──────
// Each section collapses/expands independently, with its own remembered
// state in localStorage (keyed by SECTIONS[].storeKey below).
(function initCollapsibleNavSections() {
  const SECTIONS = [
    { label: 'Học tập', itemClass: 'group-hoctap', storeKey: 'navCollapsed:hoctap' },
    { label: 'Cẩm nang', itemClass: 'group-camnang', storeKey: 'navCollapsed:camnang' },
  ];

  function findLabel(navEl, text) {
    if (!navEl) return null;
    return Array.from(navEl.querySelectorAll('.nav-section-label'))
      .find(l => l.textContent.trim() === text) || null;
  }

  function applyState(label, collapsed) {
    label.classList.toggle('collapsed', collapsed);
    label.setAttribute('aria-expanded', String(!collapsed));
  }

  function setState(label, storeKey, collapsed) {
    try { localStorage.setItem(storeKey, collapsed ? '1' : '0'); } catch (e) {}
    applyState(label, collapsed);
  }

  function setupLabel(label, storeKey) {
    if (!label || label.dataset.collapsible === '1') return;
    label.dataset.collapsible = '1';
    label.classList.add('nav-section-toggle');
    label.setAttribute('role', 'button');
    label.setAttribute('tabindex', '0');
    label.innerHTML = `<span>${label.textContent.trim()}</span>` +
      `<svg class="spaces-nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">` +
      `<path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>`;

    function toggle() {
      setState(label, storeKey, localStorage.getItem(storeKey) !== '1');
    }
    label.addEventListener('click', toggle);
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }

  function markItems(navEl, label, itemClass) {
    navEl.querySelectorAll(`.nav-item.${itemClass}`).forEach(el => el.classList.remove(itemClass));
    let sib = label.nextElementSibling;
    while (sib && !sib.classList.contains('nav-section-label')) {
      if (sib.classList.contains('nav-item')) sib.classList.add(itemClass);
      sib = sib.nextElementSibling;
    }
  }

  function refresh() {
    [document.getElementById('sidebar-nav'), document.querySelector('#mob-sidebar nav')].forEach(navEl => {
      SECTIONS.forEach(({ label: text, itemClass, storeKey }) => {
        const label = findLabel(navEl, text);
        if (!label) return;
        setupLabel(label, storeKey);
        markItems(navEl, label, itemClass);
        applyState(label, localStorage.getItem(storeKey) === '1');
      });
    });
  }

  function setup() {
    refresh();
    [document.getElementById('sidebar-nav'), document.querySelector('#mob-sidebar nav')].forEach(navEl => {
      if (navEl) new MutationObserver(refresh).observe(navEl, { childList: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ── Notification Bell ────────────────────────────────────────
(function initNotifSystem() {
  const NOTIF_API = '/api';
  let _notifOpen = false;
  let _notifUserId = null;
  let _seenIds = new Set();
  let _firstLoad = true;

  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _icon(type) {
    return ({challenge:'🎯',course:'📚',feed:'📢',marketplace:'🛍️',system:'⚙️',
             enrollment_approved:'✅',enrollment_rejected:'❌',submission_reviewed:'📝',p377_reminder:'📝',mention:'💬',comment:'💬'})[type] || '🔔';
  }
  function _timeAgo(s) {
    const d = Date.now() - new Date(s).getTime();
    if (d < 60000) return 'Vừa xong';
    if (d < 3600000) return Math.floor(d/60000) + ' phút trước';
    if (d < 86400000) return Math.floor(d/3600000) + ' giờ trước';
    return Math.floor(d/86400000) + ' ngày trước';
  }

  function _showToast(notif) {
    const icon = notif.icon || _icon(notif.type);
    const wrap = document.createElement('div');
    wrap.className = 'notif-toast';
    wrap.innerHTML = `
      <div class="notif-toast-icon">${icon}</div>
      <div class="notif-toast-body">
        ${notif.title ? `<div class="notif-toast-title">${_esc(notif.title)}</div>` : ''}
        <div class="notif-toast-text">${_esc(notif.content)}</div>
      </div>
      <button class="notif-toast-close" onclick="this.closest('.notif-toast').remove()">×</button>
    `;
    if (notif.link) {
      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('.notif-toast-close')) return;
        wrap.remove();
        window._notifClick && window._notifClick(notif.id, notif.link);
      });
    }
    document.body.appendChild(wrap);
    // Stack toasts vertically
    const existing = document.querySelectorAll('.notif-toast');
    let top = 72;
    existing.forEach(el => { if (el !== wrap) top += el.offsetHeight + 8; });
    wrap.style.top = top + 'px';
    // Auto-dismiss after 6s
    setTimeout(() => { wrap.style.opacity = '0'; setTimeout(() => wrap.remove(), 400); }, 6000);
  }

  async function _load() {
    if (!_notifUserId) return;
    try {
      const r = await fetch(`${NOTIF_API}/notifications?user_id=${_notifUserId}`);
      const data = await r.json();
      const notifs = data.notifications || [];
      _renderBadge(data.unread);
      _renderDropdown(notifs);
      // On first load: toast unread from last 5 min. On polls: toast all new unread.
      const RECENT = 5 * 60 * 1000;
      const now = Date.now();
      notifs
        .filter(n => {
          if (n.is_read || _seenIds.has(n.id)) return false;
          if (_firstLoad) return (now - new Date(n.created_at).getTime()) < RECENT;
          return true;
        })
        .forEach(_showToast);
      _seenIds = new Set(notifs.map(n => n.id));
      _firstLoad = false;
    } catch(e) {}
  }

  function _renderBadge(unread) {
    dhPush.setAppBadge(unread);
    document.querySelectorAll('#notifBadge, #notifBadgeMob').forEach(el => {
      if (unread > 0) {
        el.textContent = unread > 99 ? '99+' : unread;
        el.style.display = 'inline-flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
      } else {
        el.style.display = 'none';
      }
    });
  }

  function _renderDropdown(notifs) {
    const el = document.getElementById('notifDropdown');
    if (!el) return;
    const keepScroll = el.querySelector('.notif-list')?.scrollTop || 0;
    requestAnimationFrame(() => { const l = el.querySelector('.notif-list'); if (l && keepScroll) l.scrollTop = keepScroll; });
    if (!notifs || !notifs.length) {
      el.innerHTML = '<div class="notif-header"><span>Thông báo</span></div><div class="notif-empty">🔔 Chưa có thông báo nào</div><div class="notif-push" id="notifPushRow"></div>';
      dhPush.renderRow();
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
          <div class="notif-item-icon">${_esc(n.icon || _icon(n.type))}</div>
          <div class="notif-item-body">
            ${n.title ? `<div class="notif-item-title">${_esc(n.title)}</div>` : ''}
            <div class="notif-item-text">${_esc(n.content)}</div>
            <div class="notif-item-time">${_timeAgo(n.created_at)}</div>
          </div>
          ${!n.is_read ? '<div class="notif-item-dot"></div>' : ''}
        </div>`).join('')}
      </div>
      <div class="notif-push" id="notifPushRow"></div>`;
    dhPush.renderRow();
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

  function _positionNotifDropdown(bell, dd) {
    const r = bell.getBoundingClientRect();
    const width = 340;
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    dd.style.top = (r.bottom + 8) + 'px';
    dd.style.left = left + 'px';
  }

  function _setup() {
    const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!user) return;
    _notifUserId = user.id;
    const bells = Array.from(document.querySelectorAll('#notifBell, #notifBellMob'));
    const dd    = document.getElementById('notifDropdown');
    if (!bells.length || !dd) return;

    // Move the dropdown to <body> so position:fixed is never clipped by an
    // ancestor's overflow (e.g. #subnav-bar's overflow-x:auto scroll strip).
    document.body.appendChild(dd);

    _load();
    setInterval(_load, 15000); // poll every 15s for faster notification display

    bells.forEach(bell => {
      bell.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        _notifOpen = !_notifOpen;
        if (_notifOpen) _positionNotifDropdown(bell, dd);
        dd.style.display = _notifOpen ? 'block' : 'none';
      });
    });
    document.addEventListener('click', (e) => {
      if (_notifOpen && !bells.some(b => b.contains(e.target)) && !dd.contains(e.target)) {
        _notifOpen = false; dd.style.display = 'none';
      }
    });
    let _lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === _lastW) return;
      _lastW = window.innerWidth;
      if (_notifOpen) { _notifOpen = false; dd.style.display = 'none'; }
    });
    window.addEventListener('scroll', (e) => {
      if (!_notifOpen || (e.target instanceof Node && dd.contains(e.target))) return; // cuộn trong danh sách thông báo
      _notifOpen = false; dd.style.display = 'none';
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _setup);
  } else {
    setTimeout(_setup, 300);
  }
})();

// ── Mobile topbar avatar (mirrors each page's own #topbarAvatar) ──
(function initMobTopbarAvatar() {
  const AV_COLORS = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#ef4444', '#14b8a6'];

  function setup() {
    const el = document.getElementById('topbarAvatarMob');
    if (!el) return;
    const user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!user) return;
    const initials = (user.first_name?.[0] || '?') + (user.last_name?.[0] || '');
    el.textContent = initials.toUpperCase();
    el.style.background = AV_COLORS[(user.id || 0) % AV_COLORS.length];
    el.style.cursor = 'pointer';
    el.onclick = () => { window.location.href = `profile.html?id=${user.id}`; };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

// ── Cẩm Nang Ngũ Hành nav injector ───────────────────────────
// Groups the nutrition tools under a single "Cẩm nang" labelled section
// in the left sidebar + mobile menu.
(function injectNguHanhNav() {
  const ITEMS = [
    ['tai-lieu.html',   'Tài liệu PDF', '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h6"/>'],
  ];
  const here = location.pathname.split('/').pop() || 'index.html';
  const svg = p => `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

  // "Khác" is always the last static section in the markup — after Cẩm nang
  // is appended (below) it would sit second-to-last, so move it (label + its
  // items) to the very end of navEl. Stops at the next .nav-section-label OR
  // at the Cẩm nang wrapper (which isn't itself a .nav-section-label).
  function moveKhacToBottom(navEl) {
    if (!navEl) return;
    const khacLabel = Array.from(navEl.querySelectorAll('.nav-section-label'))
      .find(l => l.textContent.trim() === 'Khác');
    if (!khacLabel) return;
    const nodes = [khacLabel];
    let sib = khacLabel.nextElementSibling;
    while (sib && !sib.classList.contains('nav-section-label') && !sib.classList.contains('camnang-nav-section')) {
      nodes.push(sib);
      sib = sib.nextElementSibling;
    }
    nodes.forEach(n => navEl.appendChild(n)); // re-appending in order moves the whole block to the end
  }

  // Left sidebar + mobile drawer — "Cẩm nang" labelled section.
  // Wrapped in its own container (rather than appended as loose siblings) so
  // the collapse feature below can reliably find "the items in this section"
  // without depending on DOM order relative to the other nav injectors
  // (Spaces, Khoá học) that also mutate this same list.
  function addSection(navEl, itemClass) {
    if (!navEl || navEl.dataset.nguhanh) return;
    navEl.dataset.nguhanh = '1';
    const section = document.createElement('div');
    section.className = 'camnang-nav-section';
    const label = document.createElement('div');
    label.className = 'nav-section-label';
    label.style.marginTop = '8px';
    label.textContent = 'Cẩm nang';
    section.appendChild(label);
    ITEMS.forEach(([href, label2, path]) => {
      const a = document.createElement('a');
      a.href = href;
      a.className = itemClass + (here === href ? ' active' : '');
      a.innerHTML = svg(path) + label2;
      section.appendChild(a);
    });
    navEl.appendChild(section);
    moveKhacToBottom(navEl);
  }
  addSection(document.getElementById('sidebar-nav'), 'nav-item');
  addSection(document.querySelector('#mob-sidebar nav'), 'nav-item');
  addSection(document.querySelector('#mob-mainmenu nav'), 'nav-item');
})();

// ── "Hỗ trợ" nav injector ─────────────────────────────────────
// Luôn nằm cuối sidebar (sau "Khác"): Hướng dẫn sử dụng, Liên hệ BTC, Danh sách địa điểm, Nội quy cộng đồng.
(function injectContactNav() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const icon = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/></svg>';
  const pinIcon = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  const ITEMS = [
    ['huong-dan.html', 'Hướng dẫn sử dụng', '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 014 4v13a3 3 0 00-3-3H2z"/><path d="M22 4h-6a4 4 0 00-4 4v13a3 3 0 013-3h7z"/></svg>'],
    ['lien-he.html', 'Liên hệ BTC', icon],
    ['noi-quy.html', 'Nội quy cộng đồng', '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>'],
  ];

  function addSection(navEl) {
    if (!navEl || navEl.dataset.contactNav) return;
    navEl.dataset.contactNav = '1';
    const section = document.createElement('div');
    section.className = 'contact-nav-section';
    const label = document.createElement('div');
    label.className = 'nav-section-label';
    label.style.marginTop = '8px';
    label.textContent = 'Hỗ trợ';
    section.appendChild(label);
    ITEMS.forEach(([href, text, ico]) => {
      const a = document.createElement('a');
      a.href = href;
      a.className = 'nav-item' + (here === href ? ' active' : '');
      a.innerHTML = ico + text;
      section.appendChild(a);
    });
    navEl.appendChild(section);
  }
  addSection(document.getElementById('sidebar-nav'));
  addSection(document.querySelector('#mob-sidebar nav'));
  addSection(document.querySelector('#mob-mainmenu nav'));
})();

// ── Nút "Đăng xuất" trong menu điện thoại ─────────────────────
// Trên máy tính nút nằm ở góc dưới thanh bên; trên điện thoại thanh bên bị ẩn nên thêm vào cuối 2 menu trượt.
(function injectMobileLogout() {
  let loggedIn = false;
  try { loggedIn = !!localStorage.getItem('currentUser') || !!sessionStorage.getItem('currentUser'); } catch (e) {}
  if (!loggedIn) return;
  const icon = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
  ['mob-sidebar', 'mob-mainmenu'].forEach(id => {
    const drawer = document.getElementById(id);
    if (!drawer || drawer.querySelector('.mob-logout')) return;
    const a = document.createElement('a');
    a.href = 'index.html';
    a.className = 'nav-item mob-logout';
    a.setAttribute('aria-label', 'Đăng xuất');
    a.style.cssText = 'color:#dc2626;margin:6px 8px calc(var(--mob-nav-h, 60px) + 6px + env(safe-area-inset-bottom, 0px));flex-shrink:0;';
    a.innerHTML = icon + 'Đăng xuất';
    a.addEventListener('click', () => { if (typeof clearLoginSession === 'function') clearLoginSession(); });
    const userBox = drawer.querySelector('#mob-sidebar-user');
    if (userBox) { userBox.style.flexWrap = 'wrap'; drawer.insertBefore(a, userBox.nextSibling); }
    else drawer.appendChild(a);
  });
})();

// ── Khung nổi bật "Lịch Zoom / sự kiện trong 24 giờ" (3 buổi, 8 buổi, 377 ngày) ──
// events: [{ title, date:'YYYY-MM-DD', time:'20:00 - 21:30 (Zoom mở lúc 19:45)', link, content_html }]
// content_html do admin soạn — chỉ hiện khi canJoin (người đã được duyệt), giống phần nội dung buổi ở trang.
// Giờ hiểu theo giờ Việt Nam (+07:00). Hiện buổi bắt đầu trong 24 giờ tới, hoặc đã diễn ra trong ngày hôm nay.
function dhEventWindow(ev) {
  const date = String(ev.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = (h, m) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`);
  const times = [...String(ev.time || '').matchAll(/(\d{1,2})\s*[:hH]\s*(\d{2})?/g)]
    .map(m => [+m[1], +(m[2] || 0)]).filter(([h, m]) => h < 24 && m < 60);
  const dayEnd = at(23, 59);
  if (!times.length) return { start: at(0, 0), end: dayEnd, dayEnd, hasTime: false };
  const start = at(...times[0]);
  let end = times[1] ? at(...times[1]) : new Date(start.getTime() + 90 * 60000);
  if (end <= start) end = new Date(start.getTime() + 90 * 60000);
  return { start, end, dayEnd, hasTime: true };
}

// Nút Zoom (daymai / zoom.us) đi qua form điểm danh /zoom rồi mới tới đúng link của buổi
function dhZoomHref(url, src) {
  return /^https:\/\/(([a-z0-9-]+\.)*zoom\.us|(www\.)?daymai\.vn)\//i.test(url || '')
    ? '/zoom?src=' + encodeURIComponent(src || 'congdong') + '&to=' + encodeURIComponent(url) : url;
}
window.dhZoomHref = dhZoomHref;

function renderTodayEventBanner(el, events, opts) {
  if (!el) return;
  const canJoin = !opts || opts.canJoin !== false;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const draw = () => {
    const now = new Date();
    const list = (events || []).map(ev => ({ ev, w: dhEventWindow(ev) }))
      .filter(x => x.w && x.w.start - now <= 24 * 3600000 && now <= x.w.dayEnd)
      .sort((a, b) => a.w.start - b.w.start);
    if (!list.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = list.map(({ ev, w }) => {
      let cls, label;
      if (!w.hasTime) { cls = 'today'; label = '📅 Diễn ra hôm nay'; }
      else if (now < w.start) {
        const mins = Math.max(1, Math.ceil((w.start - now) / 60000));
        const h = Math.floor(mins / 60), m = mins % 60;
        cls = 'soon'; label = `⏳ Chưa bắt đầu · còn ${h ? h + ' giờ ' : ''}${m ? m + ' phút' : ''} nữa`;
      } else if (now <= w.end) { cls = 'live'; label = '🔴 Đang diễn ra'; }
      else { cls = 'ended'; label = '✅ Đã kết thúc'; }
      const dd = String(ev.date).slice(0, 10).split('-').reverse().join('/');
      const when = [dd, ev.time].filter(Boolean).join(' · ');
      const showBtn = ev.link && canJoin && cls !== 'ended';
      return `
        <div class="dh-live dh-live--${cls}">
          <div class="dh-live-top"><span class="dh-live-kicker">📣 Lịch Zoom / sự kiện trong 24 giờ</span><span class="dh-live-status">${label}</span></div>
          <div class="dh-live-title">${esc(ev.title || 'Buổi Zoom')}</div>
          <div class="dh-live-when">🕐 ${esc(when)}</div>
          ${ev.content_html && canJoin ? `<div class="dh-live-body">${ev.content_html}</div>` : ''}
          ${showBtn ? `<a class="dh-live-btn" href="${esc(dhZoomHref(ev.link))}" target="_blank" rel="noopener">📹 ${cls === 'live' ? 'Vào Zoom ngay' : 'Tham gia Zoom'}</a>` : ''}
        </div>`;
    }).join('');
  };
  draw();
  clearInterval(el._dhTimer);
  el._dhTimer = setInterval(draw, 30000);
}

// ── Nút "?" (Hướng dẫn sử dụng) cạnh chuông thông báo + lời mời cho người mới ở Feed ──
(function injectGuideHelp() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const qIcon = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  function addHelp(bell) {
    if (!bell || document.getElementById(bell.id + 'Help')) return;
    const a = document.createElement('a');
    a.id = bell.id + 'Help';
    a.href = 'huong-dan.html';
    a.className = 'icon-btn' + (here === 'huong-dan.html' ? ' active' : '');
    a.title = 'Hướng dẫn sử dụng';
    a.setAttribute('aria-label', 'Hướng dẫn sử dụng');
    a.innerHTML = qIcon;
    // Chuông trên máy tính nằm trong 1 <div> bọc (chứa cả khung thông báo) → chèn trước khung đó
    const anchor = bell.parentElement && bell.parentElement.children.length > 1 && bell.parentElement.tagName === 'DIV' && !bell.parentElement.classList.contains('mob-topbar-right')
      ? bell.parentElement : bell;
    anchor.parentElement.insertBefore(a, anchor);
  }
  addHelp(document.getElementById('notifBell'));
  addHelp(document.getElementById('notifBellMob'));

  // Lời mời xem hướng dẫn: chỉ ở Feed, chỉ khi chưa mở hướng dẫn và chưa bấm đóng
  if (here !== 'feed.html') return;
  let seen = false;
  try { seen = !!localStorage.getItem('dh_guide_seen'); } catch (e) {}
  const feed = document.getElementById('feed');
  if (seen || !feed) return;
  const box = document.createElement('div');
  box.className = 'dh-guide-invite';
  box.innerHTML = `<div class="dh-guide-invite-ico">📖</div>
    <div class="dh-guide-invite-text"><b>Mới tham gia AI Agents CC?</b><span>Xem hướng dẫn 3 phút: đăng nhập, cài ứng dụng, bật thông báo, đăng bài, vào Zoom…</span></div>
    <a class="dh-guide-invite-btn" href="huong-dan.html">Xem hướng dẫn →</a>
    <button type="button" class="dh-guide-invite-close" aria-label="Đóng">×</button>`;
  box.querySelector('.dh-guide-invite-close').onclick = () => {
    try { localStorage.setItem('dh_guide_seen', '1'); } catch (e) {}
    box.remove();
  };
  feed.insertBefore(box, feed.firstChild);
})();

// ── Upload ảnh khi đăng bài (Feed/Space) ─────────────────────────────
// Nén ngay trên trình duyệt: cạnh dài tối đa 1920px, WebP chất lượng 0.82 (trình duyệt không xuất
// được WebP, ví dụ Safari cũ, thì dùng JPEG 0.85). Ảnh GIF giữ nguyên để không mất chuyển động.
async function dhCompressImage(file) {
  if (!file || !/^image\//.test(file.type) || file.type === 'image/gif') return file;
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không đọc được ảnh này. Vui lòng chọn ảnh JPG/PNG/WebP.'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const scale = Math.min(1, 1920 / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(src, 0, 0, w, h);
  const toBlob = (type, q) => new Promise(r => canvas.toBlob(r, type, q));
  let blob = await toBlob('image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85);
  if (!blob) return file;
  if (blob.size >= file.size && scale === 1 && /^image\/(jpeg|webp)$/.test(file.type)) return file; // ảnh gốc đã nhỏ hơn
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `anh.${ext}`, { type: blob.type });
}

// Nén rồi tải 1 ảnh lên Google Drive qua server, trả về link hiển thị.
// purpose: 'post' (ảnh bài đăng) | 'p377_meal' (ảnh bữa ăn báo cáo 377 ngày) — mỗi loại 1 thư mục Drive.
async function dhUploadImage(file, userId, purpose, onStatus) {
  const say = t => { try { onStatus && onStatus(t); } catch (e) {} };
  say('⏳ Đang nén ảnh...');
  const small = await dhCompressImage(file);
  say(`⏳ Đang tải ảnh lên (${Math.max(1, Math.round(small.size / 1024))} KB)...`);
  const fd = new FormData();
  fd.append('user_id', userId);
  fd.append('purpose', purpose || 'post');
  fd.append('image', small, small.name || 'anh.jpg');
  const res = await fetch('/api/posts/upload-image', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error || 'Tải ảnh thất bại, vui lòng thử lại.');
  return data.url;
}

// Gắn nút "Tải ảnh lên" vào ô link ảnh của composer (#composerAttachUrl). Upload xong điền link
// Drive vào ô và hiện ảnh xem trước.
function dhSetupComposerImageUpload(userId) {
  const input = document.getElementById('composerAttachUrl');
  const box = input?.closest('.composer-attach-box');
  if (!box || box.querySelector('.dh-img-upload-btn')) return;
  const picker = document.createElement('input');
  picker.type = 'file'; picker.accept = 'image/*'; picker.hidden = true;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'dh-img-upload-btn'; btn.textContent = '📤 Tải ảnh lên';
  const status = document.createElement('div');
  status.className = 'dh-img-upload-status';
  box.insertBefore(btn, box.querySelector('.composer-attach-remove'));
  box.appendChild(picker);
  box.after(status);
  const showPreview = url => {
    status.innerHTML = url ? `<img src="${url.replace(/"/g, '&quot;')}" alt="Ảnh xem trước" class="dh-img-upload-preview">` : '';
  };
  btn.onclick = () => picker.click();
  picker.onchange = async () => {
    const file = picker.files[0];
    picker.value = '';
    if (!file) return;
    if (!userId) { alert('Bạn cần đăng nhập để tải ảnh.'); return; }
    btn.disabled = true;
    const submit = document.getElementById('composerSubmitBtn');
    if (submit) submit.disabled = true;
    try {
      const url = await dhUploadImage(file, userId, 'post', t => { status.textContent = t; });
      input.value = url;
      showPreview(url);
    } catch (e) {
      status.textContent = '⚠️ ' + (e.message || 'Tải ảnh thất bại, vui lòng thử lại.');
    } finally {
      btn.disabled = false;
      if (submit) submit.disabled = false;
    }
  };
}

// ── Gọi API cần phiên đăng nhập thật (Hồ sơ y khoa) ────────────────────
// Token nằm trong currentUser.session_token (máy chủ trả khi đăng nhập). Máy chủ trả 401
// code "session_required" khi thiếu / hết hạn token → lỗi có .needLogin để trang hiện nút đăng nhập lại.
// ── Múi giờ: nhắc nhở theo giờ địa phương cho thành viên ở nước ngoài ──
const DH_TIMEZONES = [
  ['Asia/Ho_Chi_Minh', 'Việt Nam'], ['Asia/Bangkok', 'Thái Lan'], ['Asia/Singapore', 'Singapore / Malaysia'],
  ['Asia/Shanghai', 'Trung Quốc / Đài Loan'], ['Asia/Seoul', 'Hàn Quốc'], ['Asia/Tokyo', 'Nhật Bản'],
  ['Australia/Perth', 'Úc (Perth)'], ['Australia/Sydney', 'Úc (Sydney / Melbourne)'], ['Pacific/Auckland', 'New Zealand'],
  ['Asia/Dubai', 'UAE (Dubai)'], ['Europe/London', 'Anh'], ['Europe/Paris', 'Pháp / Đức / Séc / Ba Lan'], ['Europe/Moscow', 'Nga (Moskva)'],
  ['America/New_York', 'Mỹ — miền Đông (New York)'], ['America/Chicago', 'Mỹ — miền Trung (Texas, Chicago)'],
  ['America/Denver', 'Mỹ — miền núi (Denver)'], ['America/Los_Angeles', 'Mỹ — miền Tây (California, Seattle)'],
  ['America/Toronto', 'Canada — miền Đông (Toronto)'], ['America/Vancouver', 'Canada — miền Tây (Vancouver)'],
];
function dhDeviceTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
// "UTC+7" của một múi giờ ở thời điểm hiện tại
function dhTzOffsetLabel(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(x => x.type === 'timeZoneName');
    return (p ? p.value : '').replace('GMT', 'UTC') || 'UTC';
  } catch (e) { return ''; }
}
// <option> cho ô chọn múi giờ (có thêm múi giờ hiện tại / của thiết bị nếu không nằm trong danh sách)
function dhTimezoneOptions(selected) {
  const list = DH_TIMEZONES.slice(), dev = dhDeviceTimezone();
  [selected, dev].forEach(z => { if (z && !list.some(x => x[0] === z)) list.push([z, z.replace(/_/g, ' ')]); });
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return list.map(([z, label]) => `<option value="${esc(z)}"${z === (selected || 'Asia/Ho_Chi_Minh') ? ' selected' : ''}>${esc(label)} (${dhTzOffsetLabel(z)})${z === dev ? ' — thiết bị này' : ''}</option>`).join('');
}
// Tự gửi múi giờ thiết bị lên tài khoản (máy chủ chỉ lưu khi tài khoản chưa có múi giờ)
(function dhSyncTimezone() {
  try {
    const u = JSON.parse(localStorage.getItem('currentUser') || 'null'), tz = dhDeviceTimezone();
    if (!u || !u.id || !tz || localStorage.getItem('dhTzSent') === u.id + '|' + tz) return;
    fetch(`/api/users/${u.id}/timezone-detect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: u.id, timezone: tz }) })
      .then(r => { if (r.ok) localStorage.setItem('dhTzSent', u.id + '|' + tz); }).catch(() => {});
  } catch (e) {}
})();

function dhSessionToken() {
  try { return JSON.parse(localStorage.getItem('currentUser') || '{}').session_token || ''; } catch (e) { return ''; }
}
async function dhSecureFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}), 'x-user-token': dhSessionToken() };
  if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Có lỗi, vui lòng thử lại.');
    err.status = res.status;
    err.needLogin = data.code === 'session_required';
    throw err;
  }
  return data;
}
// Đăng nhập lại rồi quay về trang hiện tại
function dhRelogin() {
  const here = location.pathname.split('/').pop() + location.search;
  try { localStorage.removeItem('currentUser'); } catch (e) {}
  location.href = 'index.html?redirect=' + encodeURIComponent(here);
}


// ── Gắn tên thành viên (@) trong ô bình luận bài viết + tô sáng tên đã gắn ──
// Dùng chung cho mọi trang có khung bình luận (#pmCommentInput, .pm-reply-input): gõ @ → hiện danh sách
// thành viên, chọn bằng chuột / ↑ ↓ Enter. Server tự tìm "@Họ Tên" trong nội dung và báo cho người được gắn tên.
(function dhMentions() {
  if (!dhSessionToken()) return;   // chưa đăng nhập: không gợi ý / tô sáng
  const SEL = '#pmCommentInput, .pm-reply-input';
  let members = null, loading = null, box = null, st = null;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function load() {
    if (members) return Promise.resolve(members);
    if (!loading) {
      loading = fetch('/api/members/mentions', { headers: { 'x-user-token': dhSessionToken() } })
        .then(r => (r.ok ? r.json() : { members: [] })).then(d => (members = d.members || []))
        .catch(() => { loading = null; return []; });
    }
    return loading;
  }
  function css() {
    if (document.getElementById('dhMentionCss')) return;
    const s = document.createElement('style');
    s.id = 'dhMentionCss';
    s.textContent = `.dh-mention-box{position:fixed;z-index:10050;background:var(--bg-card,#fff);color:var(--text,#0f172a);border:1px solid var(--border,#e2e8f0);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);max-height:260px;overflow-y:auto;padding:4px;display:none;}
      .dh-mention-item{display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:7px;cursor:pointer;font-size:14px;}
      .dh-mention-item.on,.dh-mention-item:hover{background:var(--bg-active,#e0f2fe);}
      .dh-mention-av{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;flex-shrink:0;}
      .dh-mention-empty{padding:8px 10px;font-size:13px;color:var(--text-muted,#64748b);}
      a.dh-mention{color:var(--color-primary,#0ea5e9);font-weight:600;text-decoration:none;}
      a.dh-mention:hover{text-decoration:underline;}`;
    document.head.appendChild(s);
  }
  function ensureBox() {
    if (box) return box;
    css();
    box = document.createElement('div');
    box.className = 'dh-mention-box';
    box.setAttribute('role', 'listbox');
    box.addEventListener('mousedown', e => {
      e.preventDefault();   // giữ con trỏ trong ô bình luận
      const it = e.target.closest('.dh-mention-item');
      if (it && st) pick(+it.dataset.i);
    });
    document.body.appendChild(box);
    return box;
  }
  function close() { if (box) box.style.display = 'none'; st = null; }
  const COLORS = ['#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#3b82f6', '#ef4444', '#14b8a6'];
  function render() {
    const b = ensureBox();
    b.innerHTML = st.items.length
      ? st.items.map((m, i) => {
          const ini = m.name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
          return `<div class="dh-mention-item${i === st.idx ? ' on' : ''}" data-i="${i}" role="option"><span class="dh-mention-av" style="background:${COLORS[m.id % COLORS.length]}">${esc(ini)}</span>${esc(m.name)}</div>`;
        }).join('')
      : '<div class="dh-mention-empty">Không tìm thấy thành viên</div>';
    const r = st.input.getBoundingClientRect();
    b.style.display = 'block';
    b.style.width = Math.min(Math.max(r.width, 220), 320) + 'px';
    b.style.left = Math.max(8, Math.min(r.left, window.innerWidth - b.offsetWidth - 8)) + 'px';
    const h = b.offsetHeight;
    b.style.top = (r.bottom + 4 + h > window.innerHeight && r.top - h - 4 > 0 ? r.top - h - 4 : r.bottom + 4) + 'px';
    b.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  async function update(input) {
    const pos = input.selectionStart, before = input.value.slice(0, pos);
    const m = before.match(/(^|\s)@([^@\n]{0,30})$/);
    if (!m || /\s{2}$/.test(m[2])) return close();
    const list = await load();
    if (input.value.slice(0, input.selectionStart) !== before) return;   // đã gõ tiếp trong lúc tải
    const q = norm(m[2]).trim();
    const items = list.filter(x => {
      const n = norm(x.name);
      return !q || n.startsWith(q) || n.includes(' ' + q) || (q.length >= 2 && n.includes(q));
    }).slice(0, 8);
    if (!items.length && m[2].includes(' ')) return close();
    st = { input, start: pos - m[2].length - 1, end: pos, items, idx: 0 };
    render();
  }
  function pick(i) {
    const m = st && st.items[i];
    if (!m) return;
    const { input, start, end } = st;
    const ins = '@' + m.name + ' ';
    input.value = input.value.slice(0, start) + ins + input.value.slice(end);
    const c = start + ins.length;
    input.setSelectionRange(c, c);
    input.focus();
    close();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.addEventListener('input', e => {
    const t = e.target;
    if (t && t.matches && t.matches(SEL)) update(t);
  }, true);
  // Bắt phím trước khi ô bình luận nhận Enter (Enter = gửi bình luận)
  document.addEventListener('keydown', e => {
    if (!st || e.target !== st.input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!st.items.length) return;
      st.idx = (st.idx + (e.key === 'ArrowDown' ? 1 : st.items.length - 1)) % st.items.length;
      render();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && st.items.length) {
      pick(st.idx);
    } else if (e.key === 'Escape') {
      close();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('focusout', e => { if (st && e.target === st.input) setTimeout(() => { if (st && document.activeElement !== st.input) close(); }, 150); }, true);
  document.addEventListener('scroll', e => { if (st && !(box && box.contains(e.target))) close(); }, true);
  // Gợi ý cách dùng ngay trong ô
  document.addEventListener('focusin', e => {
    const t = e.target;
    if (t && t.matches && t.matches(SEL) && t.placeholder && !t.placeholder.includes('@')) t.placeholder = t.placeholder.replace(/\.*$/, '') + ' (gõ @ để gắn tên)';
  }, true);

  // Tô sáng "@Họ Tên" trong bình luận đã hiển thị → link tới hồ sơ
  function highlight(el) {
    if (!members || !members.length) return;
    el.dataset.dhm = '1';
    const names = members.slice().sort((a, b) => b.name.length - a.name.length);
    const re = new RegExp('@(' + names.map(x => x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
    const byName = new Map(names.map(x => [x.name.normalize('NFC').toLowerCase(), x]));
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('@')) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const text = node.nodeValue.normalize('NFC');
      re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, mm;
      while ((mm = re.exec(text))) {
        const u = byName.get(mm[1].toLowerCase());
        if (!u) continue;
        frag.appendChild(document.createTextNode(text.slice(last, mm.index)));
        const a = document.createElement('a');
        a.className = 'dh-mention';
        a.href = `profile.html?id=${u.id}`;
        a.textContent = '@' + u.name;
        frag.appendChild(a);
        last = mm.index + mm[0].length;
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }
  function scan() {
    const els = [...document.querySelectorAll('.pm-cmt-text:not([data-dhm])')].filter(el => el.textContent.includes('@'));
    if (!els.length) return;
    css();
    load().then(() => els.forEach(el => { if (!el.dataset.dhm) highlight(el); }));
  }
  let timer = null;
  const start = () => {
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 60); }).observe(document.body, { childList: true, subtree: true });
    scan();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();


// ── Lưu bài viết vào thư mục tự tạo (nút 🔖 trên thẻ bài + trong khung xem bài) + link "Bài đã lưu" ở menu ──
(function dhSaved() {
  if (!dhSessionToken()) return;
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const H = () => ({ 'x-user-token': dhSessionToken(), 'Content-Type': 'application/json' });
  const api = (url, opts = {}) => fetch('/api/saved' + url, { ...opts, headers: H() }).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Có lỗi, vui lòng thử lại.');
    return d;
  });
  let savedIds = null;
  const ICON = on => `<svg width="15" height="15" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>`;
  function css() {
    if (document.getElementById('dhSavedCss')) return;
    const s = document.createElement('style');
    s.id = 'dhSavedCss';
    s.textContent = `.dh-save-btn{cursor:pointer;display:inline-flex;align-items:center;gap:4px;}
      .dh-save-btn.on{color:#f59e0b;}
      .post-footer .dh-save-btn{margin-left:auto;}
      .dh-save-pm{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;font-size:14px;font-weight:600;cursor:pointer;}
      .dh-save-pm.on{color:#f59e0b;border-color:#f59e0b;}
      .dh-save-ov{position:fixed;inset:0;z-index:10060;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:16px;}
      .dh-save-dlg{background:var(--bg-card,#fff);color:var(--text,#0f172a);border-radius:16px;width:100%;max-width:400px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.35);}
      .dh-save-head{padding:16px 18px 10px;font-weight:700;font-size:16px;display:flex;justify-content:space-between;align-items:center;}
      .dh-save-head button{border:none;background:none;color:var(--text-muted);font-size:20px;cursor:pointer;line-height:1;}
      .dh-save-body{padding:0 18px;overflow-y:auto;}
      .dh-save-f{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;font-size:14.5px;}
      .dh-save-f:hover{background:var(--bg-hover,#f1f5f9);}
      .dh-save-f input{width:18px;height:18px;accent-color:#f59e0b;flex-shrink:0;}
      .dh-save-new{display:flex;gap:8px;margin:8px 0 4px;}
      .dh-save-new input,.dh-save-note{flex:1;width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--bg-app,#f8fafc);color:var(--text);font:inherit;font-size:14px;}
      .dh-save-new button{padding:0 14px;border-radius:9px;border:1px solid var(--border);background:var(--bg-hover,#f1f5f9);color:var(--text);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap;}
      .dh-save-lbl{font-size:12px;font-weight:600;color:var(--text-muted);margin:12px 0 5px;}
      .dh-save-hint{font-size:12.5px;color:var(--text-muted);padding:6px 2px;}
      .dh-save-foot{display:flex;gap:8px;justify-content:space-between;align-items:center;padding:14px 18px;border-top:1px solid var(--border);margin-top:12px;}
      .dh-save-foot .ok{padding:9px 18px;border-radius:10px;border:none;background:#10b981;color:#fff;font:inherit;font-weight:700;cursor:pointer;}
      .dh-save-foot .rm{border:none;background:none;color:#ef4444;font:inherit;font-size:13.5px;cursor:pointer;padding:6px 0;}
      .dh-save-err{color:#ef4444;font-size:13px;margin-top:6px;}`;
    document.head.appendChild(s);
  }
  function loadIds() {
    if (!savedIds) savedIds = api('/ids').then(d => new Set(d.ids)).catch(() => new Set());
    return savedIds;
  }
  function paint(pid, on) {
    document.querySelectorAll(`[data-dh-save="${pid}"]`).forEach(b => {
      b.classList.toggle('on', on);
      b.innerHTML = ICON(on) + `<span>${on ? 'Đã lưu' : 'Lưu'}</span>`;
      b.title = on ? 'Đã lưu — bấm để đổi thư mục / bỏ lưu' : 'Lưu bài vào thư mục của bạn';
    });
  }
  // Bảng chọn thư mục
  async function openDialog(pid) {
    css();
    const ov = document.createElement('div');
    ov.className = 'dh-save-ov';
    ov.innerHTML = '<div class="dh-save-dlg" role="dialog" aria-modal="true" aria-label="Lưu bài viết"><div class="dh-save-head">🔖 Lưu bài viết<button type="button" aria-label="Đóng">×</button></div><div class="dh-save-body"><div class="dh-save-hint">Đang tải…</div></div></div>';
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    ov.querySelector('.dh-save-head button').onclick = close;
    let st;
    try { st = await api('/post/' + pid); } catch (e) { ov.querySelector('.dh-save-body').innerHTML = `<div class="dh-save-err">${esc(e.message)}</div>`; return; }
    const sel = new Set(st.folder_ids);
    const dlg = ov.querySelector('.dh-save-dlg');
    const render = () => {
      dlg.innerHTML = `<div class="dh-save-head">🔖 ${st.saved ? 'Đã lưu — chọn thư mục' : 'Lưu bài viết'}<button type="button" aria-label="Đóng">×</button></div>
        <div class="dh-save-body">
          <div class="dh-save-lbl">Chọn thư mục (có thể chọn nhiều)</div>
          ${st.folders.length ? st.folders.map(f => `<label class="dh-save-f"><input type="checkbox" value="${f.id}" ${sel.has(f.id) ? 'checked' : ''}><span style="flex:1;">📁 ${esc(f.name)}</span><span style="font-size:12px;color:var(--text-muted);">${f.count}</span></label>`).join('')
            : '<div class="dh-save-hint">Bạn chưa có thư mục nào. Tạo thư mục bên dưới, hoặc bấm Lưu để cất vào "Chưa phân loại".</div>'}
          <div class="dh-save-new"><input id="dhSaveNew" maxlength="50" placeholder="+ Tạo thư mục mới (VD: Món ăn thể Hàn)"><button type="button" id="dhSaveAdd">Tạo</button></div>
          <div class="dh-save-lbl">Ghi chú riêng (không bắt buộc)</div>
          <textarea class="dh-save-note" id="dhSaveNote" rows="2" maxlength="500" placeholder="VD: Thử vào thứ 7">${esc(st.note)}</textarea>
          <div class="dh-save-err" id="dhSaveErr"></div>
        </div>
        <div class="dh-save-foot">${st.saved ? '<button type="button" class="rm" id="dhSaveRm">Bỏ lưu</button>' : '<span style="font-size:12px;color:var(--text-muted);">Chỉ mình bạn thấy</span>'}
          <button type="button" class="ok" id="dhSaveOk">${st.saved ? 'Cập nhật' : 'Lưu'}</button></div>`;
      dlg.querySelector('.dh-save-head button').onclick = close;
      dlg.querySelectorAll('.dh-save-f input').forEach(cb => cb.onchange = () => { cb.checked ? sel.add(+cb.value) : sel.delete(+cb.value); });
      const err = m => { dlg.querySelector('#dhSaveErr').textContent = m || ''; };
      const add = async () => {
        const inp = dlg.querySelector('#dhSaveNew'), name = inp.value.trim();
        if (!name) return inp.focus();
        try {
          const r = await api('/folders', { method: 'POST', body: JSON.stringify({ name }) });
          const note = dlg.querySelector('#dhSaveNote').value;
          st = { ...st, ...(await api('/folders')), note };
          sel.add(r.id);
          render();
        } catch (e) { err(e.message); }
      };
      dlg.querySelector('#dhSaveAdd').onclick = add;
      dlg.querySelector('#dhSaveNew').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
      dlg.querySelector('#dhSaveOk').onclick = async () => {
        try {
          await api('/post/' + pid, { method: 'PUT', body: JSON.stringify({ folder_ids: [...sel], note: dlg.querySelector('#dhSaveNote').value }) });
          (await loadIds()).add(+pid);
          paint(pid, true);
          close();
          if (typeof showToast === 'function') showToast('🔖 Đã lưu bài viết', 'green');
          document.dispatchEvent(new CustomEvent('dh-saved-change'));
        } catch (e) { err(e.message); }
      };
      const rm = dlg.querySelector('#dhSaveRm');
      if (rm) rm.onclick = async () => {
        try {
          await api('/post/' + pid, { method: 'DELETE' });
          (await loadIds()).delete(+pid);
          paint(pid, false);
          close();
          document.dispatchEvent(new CustomEvent('dh-saved-change'));
        } catch (e) { err(e.message); }
      };
    };
    render();
  }
  window.dhOpenSave = openDialog;
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-dh-save]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();   // không mở bài khi bấm nút Lưu trên thẻ bài
    openDialog(b.dataset.dhSave);
  }, true);

  // Gắn nút vào thẻ bài (.post-card / .signal-card có onclick="openPost(id)") và khung xem bài (.pm-actions)
  async function scan() {
    const cards = [...document.querySelectorAll('article[onclick*="openPost("]:not([data-dhs])')];
    cards.forEach(c => { c.dataset.dhs = '1'; });   // đánh dấu ngay — 2 lượt quét chạy chồng nhau không gắn 2 nút
    const pmBar = document.querySelector('#postModalOverlay.open .pm-actions');
    let pmId = null;
    try { pmId = typeof _pmPostId !== 'undefined' ? _pmPostId : null; } catch (e) { pmId = null; }
    const needPm = pmBar && pmId && (!pmBar.querySelector('.dh-save-pm') || pmBar.querySelector('.dh-save-pm').dataset.dhSave !== String(pmId));
    if (!cards.length && !needPm) return;
    css();
    const ids = await loadIds();
    cards.forEach(card => {
      const m = (card.getAttribute('onclick') || '').match(/openPost\((\d+)\)/);
      const foot = card.querySelector('.post-footer, .signal-card-footer') || null;
      if (!m || !foot || foot.querySelector('.dh-save-btn')) return;
      const b = document.createElement('span');
      b.className = 'post-stat dh-save-btn';
      b.dataset.dhSave = m[1];
      foot.appendChild(b);
      paint(m[1], ids.has(+m[1]));
    });
    if (needPm) {
      let b = pmBar.querySelector('.dh-save-pm');
      if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'dh-save-pm'; pmBar.appendChild(b); }
      b.dataset.dhSave = String(pmId);
      paint(pmId, ids.has(+pmId));
    }
  }
  // Link "Bài đã lưu" ngay dưới "Feed" ở menu trái / menu điện thoại
  function navLink() {
    const here = location.pathname.split('/').pop();
    document.querySelectorAll('a.nav-item[href="feed.html"]').forEach(a => {
      if (a.nextElementSibling && a.nextElementSibling.getAttribute('href') === 'da-luu.html') return;
      const l = document.createElement('a');
      l.href = 'da-luu.html';
      l.className = 'nav-item' + (here === 'da-luu.html' ? ' active' : '');
      l.innerHTML = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>Bài đã lưu';
      a.after(l);
      if (here === 'da-luu.html') a.classList.remove('active');
      // AI AGENTS CC: ẩn "Hành trình của tôi" (bản đồ làng sức khỏe)
      if (true) return;
      const j = document.createElement('a');
      j.href = 'hanh-trinh.html';
      j.className = 'nav-item' + (here === 'hanh-trinh.html' ? ' active' : '');
      j.innerHTML = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>Hành trình của tôi';
      l.after(j);
      if (here === 'hanh-trinh.html') a.classList.remove('active');
    });
  }
  let t = null;
  const start = () => {
    navLink();
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 80); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    scan();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

// ── Bài tập sau buổi (3 buổi / 8 buổi / 377 ngày): lời hướng dẫn + bài chọn từ Thư viện bài tập ──
// Trang gọi await dhLoadHomeworkLib() trước khi vẽ danh sách buổi, rồi chèn dhHomeworkHtml(note, ids) vào cuối mỗi buổi.
let dhHwLib = null;
async function dhLoadHomeworkLib() {
  if (dhHwLib) return dhHwLib;
  try { dhHwLib = (await fetch('/api/assignments').then(r => r.json())).assignments || []; } catch (e) { dhHwLib = []; }
  return dhHwLib;
}
function dhHomeworkHtml(note, ids, head) {
  let list = ids;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = []; } }
  const items = (Array.isArray(list) ? list : []).map(id => (dhHwLib || []).find(a => a.id === Number(id))).filter(Boolean);
  const txt = String(note || '').trim();
  if (!txt && !items.length) return '';
  if (!document.getElementById('dhHwCss')) {
    const st = document.createElement('style'); st.id = 'dhHwCss';
    st.textContent = `.dh-hw{margin-top:16px;border:1.5px solid #fcd34d;background:#fffbeb;border-radius:12px;padding:14px 16px;color:#422006}
      .dh-hw h4{margin:0 0 8px;font-size:15.5px;color:#92400e}.dh-hw-note{font-size:14px;line-height:1.65;margin-bottom:10px;white-space:pre-line}
      .dh-hw-item{display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;margin-top:8px}
      .dh-hw-item .t{font-weight:700;font-size:14.5px}.dh-hw-item .d{font-size:13px;color:#78716c;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}
      .dh-hw-item .b{flex:1;min-width:200px}.dh-hw-item a{background:#d97706;color:#fff;text-decoration:none;font-weight:700;font-size:13.5px;border-radius:9px;padding:8px 14px;white-space:nowrap}
      [data-theme="dark"] .dh-hw{background:#2a2110;border-color:#92400e;color:#fde68a}[data-theme="dark"] .dh-hw h4{color:#fcd34d}
      [data-theme="dark"] .dh-hw-item{background:#1c1917;border-color:#78350f}[data-theme="dark"] .dh-hw-item .d{color:#d6d3d1}`;
    document.head.appendChild(st);
  }
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const link = u => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x : null; } catch (er) { return null; } };
  return `<div class="dh-hw">${head === undefined ? '<h4>📝 Bài tập sau buổi</h4>' : head}${txt ? `<div class="dh-hw-note">${e(txt)}</div>` : ''}${items.map(a => {
    const u = link(a.link_url), same = u && u.origin === location.origin;
    const desc = String(a.instructions || '').replace(/[#*>`]/g, '').replace(/\n{2,}/g, '\n').trim();
    return `<div class="dh-hw-item"><div class="b"><div class="t">${e(a.title)}</div>${desc ? `<div class="d">${e(desc)}</div>` : ''}</div>
      ${u ? `<a href="${e(u.href)}"${same ? '' : ' target="_blank" rel="noopener"'}>Làm bài tập →</a>` : ''}</div>`;
  }).join('')}</div>`;
}

// Khung nhắc phía trên "Lịch Zoom trong 24 giờ": bài tập của buổi gần nhất đã diễn ra (trong 14 ngày),
// hỏi khách đã làm chưa; bấm "Mình đã làm xong" → lưu lên máy chủ và ẩn khung.
// sessions: [{ key, title, date: 'YYYY-MM-DD', hw_note, hw_ids }]
async function dhHomeworkReminder(prog, sessions) {
  const anchor = document.getElementById('dhLiveBanner');
  if (!anchor || !Array.isArray(sessions)) return;
  let box = document.getElementById('dhHwRemind');
  if (!box) { box = document.createElement('div'); box.id = 'dhHwRemind'; anchor.parentNode.insertBefore(box, anchor); }
  await dhLoadHomeworkLib();
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  d.setDate(d.getDate() - 14);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const prev = sessions.filter(s => { const x = String(s.date || '').slice(0, 10); return x && x < today && x >= from && dhHomeworkHtml(s.hw_note, s.hw_ids); })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!prev) { box.innerHTML = ''; return; }
  const tok = typeof dhSessionToken === 'function' ? dhSessionToken() : '';
  let done = [];
  try { done = (await fetch(`/api/homework/done?prog=${encodeURIComponent(prog)}`, { headers: tok ? { 'x-user-token': tok } : {} }).then(r => r.json())).keys || []; } catch (e) {}
  if (done.includes(String(prev.key))) { box.innerHTML = ''; return; }
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dm = String(prev.date).slice(8, 10) + '/' + String(prev.date).slice(5, 7);
  box.innerHTML = dhHomeworkHtml(prev.hw_note, prev.hw_ids,
    `<h4 style="font-size:16.5px;">⏰ Bạn đã làm bài tập buổi trước chưa?</h4>
     <div style="font-size:14px;margin:-2px 0 10px;"><b>${e(prev.title || 'Buổi trước')}</b> (${dm}) — nếu chưa, vào làm ngay nhé! 💪</div>`)
    .replace(/<\/div>$/, `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <button type="button" id="dhHwDoneBtn" style="border:1.5px solid #059669;background:#ecfdf5;color:#047857;border-radius:9px;padding:8px 14px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;">✅ Mình đã làm xong</button>
      <span style="font-size:12px;opacity:.75;">Bấm khi đã hoàn thành để ẩn lời nhắc này.</span></div></div>`);
  box.style.marginBottom = '16px';
  document.getElementById('dhHwDoneBtn').onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const r = await fetch('/api/homework/done', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { 'x-user-token': tok } : {}) }, body: JSON.stringify({ prog, key: String(prev.key) }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Chưa lưu được, thử lại nhé.');
      box.innerHTML = `<div class="dh-hw" style="text-align:center;font-weight:700;">🎉 Tuyệt vời! Bạn đã hoàn thành bài tập buổi trước.</div>`;
      setTimeout(() => { box.innerHTML = ''; }, 3500);
    } catch (er) { alert(er.message); btn.disabled = false; }
  };
}

// ── Bản đồ hành trình: nhớ kênh khách đến lần đầu (?src=… hoặc trình duyệt trong app) + ghi phòng đã ghé (1 lần/ngày/trang) ──
(function () {
  try {
    const qs = new URLSearchParams(location.search);
    let src = (qs.get('src') || qs.get('utm_source') || '').toLowerCase();
    if (!src) {
      const ua = navigator.userAgent || '', ref = document.referrer || '';
      if (/zalo/i.test(ua) || /zalo\.me/i.test(ref)) src = 'zalo';
      else if (/musical_ly|tiktok|bytedance/i.test(ua) || /tiktok\.com/i.test(ref)) src = 'tiktok';
      else if (/FBAN|FBAV|FB_IAB/.test(ua) || /facebook\.com|fb\.com/i.test(ref)) src = 'facebook';
      else if (/youtube\.com|youtu\.be/i.test(ref)) src = 'youtube';
    }
    if (src && !localStorage.getItem('dh_src')) localStorage.setItem('dh_src', src);
  } catch (e) {}
  function run() {
    let u = null;
    try { u = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) {}
    if (!u || !u.session_token || u.is_admin) return;
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-token': u.session_token }, body: JSON.stringify(body) }).catch(() => {});
    try {
      const src = localStorage.getItem('dh_src');
      if (src && !localStorage.getItem('dh_src_sent')) { localStorage.setItem('dh_src_sent', '1'); post('/api/journey/source', { source: src }); }
    } catch (e) {}
    const page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    if (/^(index|feed|login|register|profile)$/.test(page)) return;
    const id = Number(new URLSearchParams(location.search).get('id')) || 0;
    const key = 'dh_jv:' + page + ':' + id, today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch (e) {}
    post('/api/journey/ping', { page, id });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
