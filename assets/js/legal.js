/* ============================================================
   legal.js — Shared shell for policy pages
   Renders topbar, policy nav, footer and fills [data-info] fields.
   Edit SITE_INFO once → every policy page updates.
   ============================================================ */

// Values wrapped in [brackets] are placeholders — fill before submitting to Bộ Công Thương.
const SITE_INFO = {
  brand:         'AI AGENTS CC',
  domain:        'aiagentscc.com',
  owner:         'Từ Chí Nguyện',
  legalName:     'Từ Chí Nguyện',
  taxId:         '096080000900',
  address:       '1109, Quốc lộ 63, Khóm 16, Phường An Xuyên, Cà Mau',
  phone:         '0918 694 886',
  email:         'tuchinguyen.ctv@gmail.com',
  zalo:          '0918 694 886',
  facebook:      'facebook.com/tuchinguyen.cm',
  supportHours:  '08:00 – 21:00, Thứ 2 – Chủ nhật',
  bankName:      'BIDV',
  bankAcc:       '96247NGUYEN',
  bankOwner:     'TỪ CHÍ NGUYỆN',
  sellerFee:     '30%',
  effectiveDate: '25/09/2026',
};

const POLICY_PAGES = [
  { id: 'privacy',    href: 'privacy-policy.html',     title: 'Chính sách bảo mật' },
  { id: 'complaint',  href: 'complaint-policy.html',   title: 'Tiếp nhận & giải quyết khiếu nại' },
  { id: 'pricing',    href: 'pricing-policy.html',     title: 'Chính sách giá' },
  { id: 'payment',    href: 'payment-policy.html',     title: 'Chính sách thanh toán' },
  { id: 'conditions', href: 'service-conditions.html', title: 'Điều kiện cung cấp dịch vụ' },
  { id: 'refund',     href: 'refund-policy.html',      title: 'Cung cấp dịch vụ & hoàn tiền' },
  { id: 'support',    href: 'support.html',            title: 'Hỗ trợ trực tuyến' },
  { id: 'terms',      href: 'terms.html',              title: 'Quy chế & Điều khoản sử dụng' },
];

const LOGO_SVG = `
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="3" fill="currentColor"/>
    <path d="M10 3v2M10 15v2M3 10h2M15 10h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

function isPlaceholder(value) {
  return typeof value === 'string' && value.startsWith('[');
}

function renderHeader(el) {
  el.innerHTML = `
    <div class="legal-topbar__inner">
      <a class="legal-logo" href="index.html" aria-label="${SITE_INFO.brand} — Trang chủ">
        <span class="legal-logo__mark">${LOGO_SVG}</span>
        <span class="legal-logo__name">AI AGENTS <span>CC</span></span>
      </a>
      <nav class="legal-topbar__links" aria-label="Liên kết nhanh">
        <a href="policies.html">Chính sách</a>
        <a href="support.html">Hỗ trợ</a>
        <a class="btn btn-primary btn-sm" href="index.html">Đăng nhập</a>
      </nav>
    </div>`;
}

function renderNav(el, currentId) {
  const items = POLICY_PAGES.map((p, i) => `
    <li>
      <a href="${p.href}" class="legal-nav__link${p.id === currentId ? ' is-active' : ''}"
         ${p.id === currentId ? 'aria-current="page"' : ''}>
        <span class="legal-nav__num">${i + 1}</span>${p.title}
      </a>
    </li>`).join('');
  el.innerHTML = `
    <a href="policies.html" class="legal-nav__title${currentId === 'hub' ? ' is-active' : ''}">Tất cả chính sách</a>
    <ul class="legal-nav__list">${items}</ul>`;
}

function renderFooter(el) {
  const links = POLICY_PAGES.map(p => `<li><a href="${p.href}">${p.title}</a></li>`).join('');
  el.innerHTML = `
    <div class="legal-footer__inner">
      <div class="legal-footer__biz">
        <div class="legal-footer__brand">${SITE_INFO.brand}</div>
        <p><span data-info="legalName"></span></p>
        <p>Mã số thuế: <span data-info="taxId"></span></p>
        <p>Địa chỉ: <span data-info="address"></span></p>
        <p>Hotline: <span data-info="phone"></span> · Email: <span data-info="email"></span></p>
        <p>Người chịu trách nhiệm: <span data-info="owner"></span></p>
      </div>
      <div>
        <div class="legal-footer__heading">Chính sách</div>
        <ul class="legal-footer__links">${links}</ul>
      </div>
    </div>
    <div class="legal-footer__copy">© ${new Date().getFullYear()} ${SITE_INFO.brand}. All rights reserved.</div>`;
}

// Contact fields rendered as clickable links
const INFO_LINKS = {
  phone:    v => `tel:${v.replace(/\s/g, '')}`,
  zalo:     v => `https://zalo.me/${v.replace(/\s/g, '')}`,
  email:    v => `mailto:${v}`,
  facebook: v => `https://www.${v}`,
};

function fillInfo(root) {
  root.querySelectorAll('[data-info]').forEach(node => {
    const key = node.dataset.info;
    const value = SITE_INFO[key];
    if (value === undefined) return;
    const toHref = INFO_LINKS[key];
    if (toHref && !isPlaceholder(value)) {
      const link = document.createElement('a');
      link.href = toHref(value);
      link.textContent = value;
      if (link.href.startsWith('http')) { link.target = '_blank'; link.rel = 'noopener'; }
      node.replaceChildren(link);
      return;
    }
    node.textContent = value;
    node.classList.toggle('legal-todo', isPlaceholder(value));
    if (isPlaceholder(value)) node.title = 'Chưa điền — cập nhật SITE_INFO trong assets/js/legal.js';
  });
}

// "Trong trang này" — table of contents from the article's h2
function renderToc(article) {
  const tocEl = document.querySelector('[data-legal-toc]');
  if (!tocEl || !article) return;
  const headings = [...article.querySelectorAll('h2')];
  if (headings.length < 3) { tocEl.remove(); return; }
  headings.forEach((h, i) => { if (!h.id) h.id = `muc-${i + 1}`; });
  tocEl.innerHTML = `
    <div class="legal-toc__title">Nội dung chính</div>
    <ol>${headings.map(h => `<li><a href="#${h.id}">${h.textContent}</a></li>`).join('')}</ol>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const currentId = document.body.dataset.policy;
  const header = document.querySelector('[data-legal-header]');
  const nav    = document.querySelector('[data-legal-nav]');
  const footer = document.querySelector('[data-legal-footer]');

  if (header) renderHeader(header);
  if (nav)    renderNav(nav, currentId);
  if (footer) renderFooter(footer);
  fillInfo(document); // before TOC so headings containing [data-info] have text
  renderToc(document.querySelector('.legal-doc'));
});
