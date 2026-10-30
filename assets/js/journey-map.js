// Bản đồ hành trình "Làng" — phần vẽ dùng chung cho ban-do-hanh-trinh.html (admin) và hanh-trinh.html (thành viên).
// Chiếu nghiêng 2:1: toạ độ lưới (x, y, độ cao z) → điểm SVG. Các khu là đảo nổi theo Ngũ Hành, đi từ dưới (kênh vào) lên đỉnh 377 ngày.
(function () {
  const HW = 40, HH = 20;
  const P = (x, y, z = 0) => [(x - y) * HW, (x + y) * HH - z];
  const pts = a => a.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const poly = (a, fill, extra = '') => `<polygon points="${pts(a)}" fill="${fill}" ${extra}/>`;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const ZONES = {
    summit:  { x0: 1,  y0: 1,  x1: 7,  y1: 7,  h: 96, thick: 30, title: '⛰️ ĐỈNH 377 NGÀY · KIM', tc: '#a16207',
      top: ['#fbf3d0', '#efe2a8'], sideL: '#cfd6e0', sideR: '#aab4c3', lipL: '#e8d690', lipR: '#d4c070', rockL: '#8a94a6', rockR: '#6b7487' },
    garden:  { x0: 8,  y0: 8,  x1: 15, y1: 15, h: 68, thick: 30, title: '🌺 VƯỜN RIÊNG TƯ · HỎA', tc: '#c2410c',
      top: ['#ffd6b8', '#f7b48a'], sideL: '#b9734a', sideR: '#985a36', lipL: '#f08a5d', lipR: '#d9703f', rockL: '#7a4a2e', rockR: '#5e3822' },
    village: { x0: 16, y0: 16, x1: 25, y1: 25, h: 40, thick: 30, title: '🌳 LÀNG CỘNG ĐỒNG · MỘC', tc: '#15803d',
      top: ['#a9e59a', '#7fcf6e'], sideL: '#a77445', sideR: '#875a32', lipL: '#5fbf5a', lipR: '#4aa646', rockL: '#6d4c30', rockR: '#553a24' },
    gate:    { x0: 26, y0: 26, x1: 31, y1: 31, h: 20, thick: 24, title: '🏮 CỔNG LÀNG · THỔ', tc: '#92400e', titleFront: true,
      top: ['#f1e0b0', '#dcc387'], sideL: '#b98d50', sideR: '#9b743f', lipL: '#d6b77a', lipR: '#c29f5f', rockL: '#7d6038', rockR: '#634b2b' },
    // Đảo hỗ trợ cạnh Phòng Nội quy, nối cầu từ Cổng làng
    support: { x0: 26.6, y0: 32.4, x1: 29.6, y1: 35.4, h: 16, thick: 18, title: '🛟 HỖ TRỢ', tc: '#0f766e',
      top: ['#d5f5ee', '#a7e6d7'], sideL: '#5aa596', sideR: '#3f8a7c', lipL: '#5ccfb8', lipR: '#3fb9a1', rockL: '#3d6b62', rockR: '#2c5249' },
    // Khu cẩm nang: cầu từ Phòng cẩm nang (làng) sang; Nhật ký ăn uống: cầu tiếp từ khu cẩm nang
    camnang: { x0: 26.4, y0: 14.4, x1: 31, y1: 20, h: 32, thick: 24, title: '📖 KHU CẨM NANG', tc: '#a16207',
      top: ['#fdf0c8', '#f3dc96'], sideL: '#b8913f', sideR: '#9a7630', lipL: '#e0b44c', lipR: '#c99a33', rockL: '#7a5d26', rockR: '#5f481c' },
    nhatky:  { x0: 32, y0: 18.2, x1: 34.4, y1: 20.6, h: 28, thick: 18, title: '📒 NHẬT KÝ', tc: '#0369a1', titleRight: true, tdx: -110,
      top: ['#dff1fb', '#bfe3f6'], sideL: '#6a9ec0', sideR: '#4f83a6', lipL: '#60b6e3', lipR: '#3f9fd4', rockL: '#3e627a', rockR: '#2e4b5e' },
    // Đảo giới thiệu cạnh Phòng lưu trữ hồ sơ (đối xứng đảo hỗ trợ)
    intro:   { x0: 32.4, y0: 26.6, x1: 35.4, y1: 29.6, h: 16, thick: 18, title: '📣 GIỚI THIỆU', tc: '#6d28d9', titleRight: true,
      top: ['#ece4fb', '#d6c8f5'], sideL: '#8b78c4', sideR: '#6f5ca8', lipL: '#a78bfa', lipR: '#8b5cf6', rockL: '#55467f', rockR: '#40355f' },
    exit:    { x0: 20, y0: 28, x1: 23, y1: 31, h: 30, thick: 20, title: '', tc: '#64748b',
      top: ['#e5e7eb', '#cbd5e1'], sideL: '#9ca3af', sideR: '#7b8494', lipL: '#a3a3a3', lipR: '#8f8f8f', rockL: '#6b7280', rockR: '#4b5563' },
  };
  // rank: vị trí xa nhất trên đường đi (cổng 1 → làng 2 → cổng vườn 3 → vườn 4 → đỉnh 5)
  const ROOMS = {
    noi_quy:        { zone: 'gate',    rank: 1, x: 27.4, y: 29.6, s: .75, ldx: -30, icon: '📜', label: 'Phòng Nội quy', roof: '#b45309', hint: 'Đã đồng ý Nội quy, hoặc mở trang Nội quy.' },
    ho_tro:         { zone: 'support', rank: 1, x: 28.1, y: 33.9, s: .85, icon: '🛟', label: 'Phòng hỗ trợ', roof: '#0d9488', hint: 'Mở Hướng dẫn sử dụng, Liên hệ BTC hoặc Danh sách địa điểm (ghi từ 22/10/2026).' },
    gioi_thieu:     { zone: 'intro',   rank: 1, x: 33.9, y: 28.1, s: .85, icon: '📣', label: 'Phòng giới thiệu', roof: '#7c3aed', hint: 'Mở trang Giới thiệu (ghi từ 22/10/2026).' },
    ho_so:          { zone: 'gate',    rank: 1, x: 29.6, y: 27.4, s: .75, ldx: 30, icon: '🗂️', label: 'Phòng lưu trữ hồ sơ', roof: '#92400e', hint: 'Đã có SĐT trong hồ sơ hoặc làm khảo sát Thân – Tâm – Mệnh; mở Lộ trình, Thành viên, Bảng xếp hạng.' },
    w3:             { zone: 'village', rank: 2, x: 18.6, y: 18.6, s: 1.05, icon: '🎓', label: '3 buổi Workshop', roof: '#16a34a', hint: 'Được vào Space / khoá 3 buổi, điểm danh Zoom 3 buổi, viết bài trong Space 3 buổi, hoặc mở trang 3 buổi.' },
    thao_luan:      { zone: 'village', rank: 2, x: 17.4, y: 22.6, s: .9, icon: '💬', label: 'Phòng thảo luận', roof: '#0284c7', hint: 'Đăng bài / bình luận ở cộng đồng (Feed, Space chung), hoặc mở Space, Hỏi đáp.' },
    cam_nang:       { zone: 'village', rank: 2, x: 22.6, y: 17.4, s: .9, icon: '📖', label: 'Phòng cẩm nang', roof: '#a16207', hint: 'Ghé bất kỳ phòng nào trong Khu cẩm nang, làm trắc nghiệm Hàn – Nhiệt, hoặc mở Thực đơn 7 ngày.' },
    tro_ly:         { zone: 'camnang', rank: 2, x: 27.3, y: 15.3, s: .7, ldx: -30, icon: '🤖', label: 'Phòng trợ lý', roof: '#0891b2', hint: 'Hỏi Trợ lý Ngũ Hành, hoặc mở trang Trợ lý.' },
    tai_lieu:       { zone: 'camnang', rank: 2, x: 30.0, y: 16.0, s: .75, ldx: 55, icon: '📚', label: 'Phòng tài liệu', roof: '#b45309', hint: 'Mở Ngũ Hành – Chìa khoá sức khoẻ hoặc Tài liệu PDF (ghi từ 22/10/2026).' },
    tra_cuu:        { zone: 'camnang', rank: 2, x: 27.8, y: 18.9, s: .8, ldx: -30, icon: '🔎', label: 'Phòng tra cứu', roof: '#65a30d', hint: 'Mở Tra cứu thực phẩm, Quy trình 1 ngày hoặc Thư viện công thức (ghi từ 22/10/2026).' },
    nhat_ky:        { zone: 'nhatky',  rank: 2, x: 33.2, y: 19.4, s: .7, icon: '📒', label: 'Nhật ký ăn uống', roof: '#0284c7', hint: 'Ghi nhật ký ăn uống (dành cho thành viên chưa vào 377 ngày — học viên 377 dùng Báo cáo 377).' },
    mot_mot:        { zone: 'village', rank: 2, x: 20.8, y: 20.8, s: .8, icon: '☕', label: 'Nói chuyện 1-1', roof: '#db2777', hint: 'Đặt lịch tư vấn 1-1, gửi tin cho Ban tổ chức, hoặc mở trang Coach 1-1.' },
    khoa_free:      { zone: 'village', rank: 2, x: 20.2, y: 24.0, s: .85, ldx: -55, icon: '📚', label: 'Khoá học miễn phí', roof: '#7c3aed', hint: 'Được mở khoá học công khai, hoặc mở trang Khoá học.' },
    cho:            { zone: 'village', rank: 2, x: 24.0, y: 20.2, s: .85, ldx: 55, icon: '🛒', label: 'Phòng chợ', roof: '#ea580c', hint: 'Có đơn hàng, hoặc mở Chợ / Thanh toán.' },
    ngam:           { zone: 'garden',  rank: 3, x: 14.3, y: 14.3, gate: true, icon: '👀', label: 'Cổng vườn · đang ngắm', hint: 'Chưa là học viên nhưng mở bài khoá / xem chi tiết / bấm tư vấn trên Feed, mở trang 8 buổi – 377, hoặc có đơn đang chờ duyệt / bị từ chối.' },
    w8:             { zone: 'garden',  rank: 4, x: 10.8, y: 10.8, s: 1.1, icon: '💎', label: '8 buổi chuyên sâu', roof: '#dc2626', hint: 'Được duyệt 8 buổi (học viên 377 tính khi mở trang 8 buổi).' },
    w8_thao_luan:   { zone: 'garden',  rank: 4, x: 13.5, y: 8.9, s: .85, icon: '🗣️', label: 'Thảo luận 8 buổi', roof: '#f97316', hint: 'Đăng bài / bình luận trong nhóm 8 buổi, hoặc mở nhóm khi đã là học viên.' },
    khoa_rieng:     { zone: 'garden',  rank: 4, x: 8.9, y: 13.5, s: .85, icon: '🔐', label: 'Khoá học riêng', roof: '#be123c', hint: 'Được mở khoá học riêng tư.' },
    p377:           { zone: 'summit',  rank: 5, x: 3.4, y: 3.4, s: 1.2, icon: '🏯', label: '377 ngày thực hành', roof: '#d4a017', hint: 'Được duyệt 377 ngày.' },
    p377_thao_luan: { zone: 'summit',  rank: 5, x: 5.7, y: 2.2, s: .7, icon: '🗣️', label: 'Thảo luận 377', roof: '#ca8a04', hint: 'Đăng bài / bình luận trong nhóm 377 ngày.' },
    p377_bao_cao:   { zone: 'summit',  rank: 5, x: 2.2, y: 5.7, s: .7, icon: '📊', label: 'Báo cáo kết quả', roof: '#b7791f', hint: 'Đã nộp báo cáo 377 ngày.' },
    p377_hoc:       { zone: 'summit',  rank: 5, x: 6.05, y: 6.05, s: .62, ldx: 95, icon: '📖', label: 'Học tập 377', roof: '#a3740f', hint: 'Mở nội dung từng ngày của 377 ngày (ghi từ 22/10/2026), hoặc đánh dấu xong bài tập 377.' },
  };
  const SOURCES = [
    { key: 'facebook', label: 'Facebook cá nhân', color: '#1877f2', u: -12.6 },
    { key: 'fanpage',  label: 'Fanpage',          color: '#4f46e5', u: -8.4 },
    { key: 'zalo',     label: 'Zalo',             color: '#0068ff', u: -4.2 },
    { key: 'unknown',  label: 'Chưa rõ nguồn',    color: '#94a3b8', u: 0, cloud: true },
    { key: 'tiktok',   label: 'TikTok',           color: '#111827', u: 4.2 },
    { key: 'youtube',  label: 'YouTube',          color: '#ef4444', u: 8.4 },
    { key: 'other',    label: 'Kênh khác',        color: '#64748b', u: 12.6 },
  ];
  SOURCES.forEach(s => { const t = s.cloud ? 75 : 71; s.x = (t + s.u) / 2; s.y = (t - s.u) / 2; });
  const SRC = Object.fromEntries(SOURCES.map(s => [s.key, s]));
  const EXIT = { x: 21.5, y: 29.5 };
  const VIEWBOX = { x: -720, y: -240, w: 1440, h: 1790 };
  // Điểm trên mặt đất trước cửa phòng (dùng cho ghim, dấu chân, mũi tên)
  const roomFoot = k => { const r = ROOMS[k]; return P(r.x + (r.s || .6) + .3, r.y + (r.s || .6) + .3, ZONES[r.zone].h); };
  // Chỗ đặt nhãn trên mái nhà (ldx: dịch nhãn sang ngang để 2 nhãn gần nhau không đè)
  const roomTop = k => { const r = ROOMS[k], p = P(r.x, r.y, ZONES[r.zone].h + (r.gate ? 70 : r.s * 52 + r.s * 44 + 16)); return [p[0] + (r.ldx || 0), p[1]]; };

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const m = c => Math.max(0, Math.min(255, Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f)));
    return '#' + [m(r), m(g), m(b)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  function island(Z) {
    const { x0, y0, x1, y1, h, thick } = Z;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, b = h - thick;
    const apex = P(cx + .6, cy + .6, b - (x1 - x0) * 15);
    let s = '';
    s += poly([P(x1, y0, b), P(x1, y1, b), apex], Z.rockR) + poly([P(x0, y1, b), P(x1, y1, b), apex], Z.rockL);
    s += poly([P(x1, y0, h), P(x1, y1, h), P(x1, y1, b), P(x1, y0, b)], Z.sideR) + poly([P(x0, y1, h), P(x1, y1, h), P(x1, y1, b), P(x0, y1, b)], Z.sideL);
    s += poly([P(x1, y0, h), P(x1, y1, h), P(x1, y1, h - 7), P(x1, y0, h - 7)], Z.lipR) + poly([P(x0, y1, h), P(x1, y1, h), P(x1, y1, h - 7), P(x0, y1, h - 7)], Z.lipL);
    s += poly([P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)], `url(#gt-${Z.key})`);
    // ô ruộng kẻ caro nhẹ
    for (let i = Math.ceil(x0); i < x1; i++) for (let j = Math.ceil(y0); j < y1; j++)
      if ((i + j) % 2 === 0) s += poly([P(i, j, h), P(Math.min(i + 1, x1), j, h), P(Math.min(i + 1, x1), Math.min(j + 1, y1), h), P(i, Math.min(j + 1, y1), h)], 'rgba(255,255,255,.13)');
    return s;
  }
  function tree(x, y, z, k, kind) {
    const [sx, sy] = P(x, y, z);
    if (kind === 'flower') {
      const c = ['#ef4444', '#f59e0b', '#ec4899', '#ffffff', '#a855f7'][k % 5];
      return `<circle cx="${sx}" cy="${sy - 3}" r="3.2" fill="${c}"/><circle cx="${sx}" cy="${sy - 3}" r="1.2" fill="#fde047"/>`;
    }
    if (kind === 'rock') return `<ellipse cx="${sx}" cy="${sy - 4}" rx="9" ry="6" fill="#cbd5e1"/><ellipse cx="${sx - 2}" cy="${sy - 6}" rx="5" ry="3" fill="#e2e8f0"/>`;
    const g = ['#2f9e44', '#37b24d', '#40c057', '#2b8a3e'][k % 4], r = 9 + (k % 3) * 2;
    return `<ellipse cx="${sx + 3}" cy="${sy}" rx="${r}" ry="${r * .45}" fill="rgba(0,0,0,.16)"/>` +
      `<rect x="${sx - 2}" y="${sy - 14}" width="4" height="14" fill="#7c4a1e"/>` +
      `<circle cx="${sx}" cy="${sy - 18 - r * .4}" r="${r}" fill="${g}"/><circle cx="${sx - r * .35}" cy="${sy - 22 - r * .5}" r="${r * .55}" fill="rgba(255,255,255,.18)"/>`;
  }
  function person(x, y, z, k, shirt) {
    const [sx, sy] = P(x, y, z);
    shirt = shirt || ['#0ea5e9', '#f43f5e', '#8b5cf6', '#f59e0b', '#10b981'][k % 5];
    return `<ellipse cx="${sx}" cy="${sy}" rx="5" ry="2.2" fill="rgba(0,0,0,.2)"/><rect x="${sx - 3.5}" y="${sy - 12}" width="7" height="10" rx="3" fill="${shirt}"/><circle cx="${sx}" cy="${sy - 15}" r="3.6" fill="#f2c9a0"/>`;
  }
  // Sương mù phủ lên 1 vùng (nhà chưa khám phá / khu chưa mở)
  function fog(cx, cy, rx, ry, k) {
    const r = rng(k * 97 + 13);
    let g = '';
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, d = r() * .6;
      g += `<ellipse cx="${(cx + Math.cos(a) * rx * d).toFixed(1)}" cy="${(cy + Math.sin(a) * ry * d).toFixed(1)}" rx="${(rx * (.45 + r() * .35)).toFixed(1)}" ry="${(ry * (.45 + r() * .35)).toFixed(1)}" fill="#f8fafc" opacity="${(.55 + r() * .3).toFixed(2)}"/>`;
    }
    return `<g class="fog" filter="url(#fogblur)">${g}</g>`;
  }
  // o: { here (số người đang ở), ring (đang chọn), glow (đã ghé — viền xanh), dim, fog (chưa khám phá) }
  function house(key, R, z, o = {}) {
    const { x, y, s } = R, h = s * 52, rh = s * 44, ov = s * .16;
    const x0 = x - s, x1 = x + s, y0 = y - s, y1 = y + s;
    const wl = o.fog ? '#e2e8f0' : '#fff7e8', wr = o.fog ? '#cbd5e1' : '#ecd9b6', roof = o.fog ? '#94a3b8' : R.roof;
    const a = P(x0 - ov, y0 - ov, z + h), b = P(x1 + ov, y0 - ov, z + h), c = P(x1 + ov, y1 + ov, z + h), d = P(x0 - ov, y1 + ov, z + h), ap = P(x, y, z + h + rh);
    const [shx, shy] = P(x + .3, y + .3, z);
    let g = `<ellipse cx="${shx}" cy="${shy}" rx="${s * HW * 1.7}" ry="${s * HH * 1.7}" fill="rgba(0,0,0,.16)"/>`;
    if (o.ring) g += `<ellipse cx="${shx}" cy="${shy}" rx="${s * HW * 2.1}" ry="${s * HH * 2.1}" fill="none" stroke="${o.ring === true ? '#f59e0b' : o.ring}" stroke-width="3" stroke-dasharray="8 7" class="ring"/>`;
    if (o.glow) g += `<ellipse cx="${shx}" cy="${shy}" rx="${s * HW * 2}" ry="${s * HH * 2}" fill="rgba(34,197,94,.18)" stroke="#22c55e" stroke-width="2.5"/>`;
    g += poly([P(x0, y1, z), P(x1, y1, z), P(x1, y1, z + h), P(x0, y1, z + h)], wl, 'stroke="rgba(0,0,0,.12)"');
    g += poly([P(x1, y1, z), P(x1, y0, z), P(x1, y0, z + h), P(x1, y1, z + h)], wr, 'stroke="rgba(0,0,0,.12)"');
    const dw = Math.min(.24, s * .26);
    g += poly([P(x - dw, y1, z), P(x + dw, y1, z), P(x + dw, y1, z + h * .58), P(x - dw, y1, z + h * .58)], o.fog ? '#64748b' : '#8a5a2b');
    [-.45, .45].forEach(t => { const yc = y + t * s, w = s * .2;
      g += poly([P(x1, yc - w, z + h * .42), P(x1, yc + w, z + h * .42), P(x1, yc + w, z + h * .78), P(x1, yc - w, z + h * .78)], o.fog ? '#e2e8f0' : '#bfe6ff', 'stroke="#7c4a1e" stroke-width="1"'); });
    g += poly([a, b, ap], shade(roof, -.35)) + poly([d, a, ap], shade(roof, -.3));
    g += poly([d, c, ap], roof, 'stroke="rgba(0,0,0,.15)"') + poly([c, b, ap], shade(roof, -.18), 'stroke="rgba(0,0,0,.15)"');
    const here = o.here || 0;
    if (here) {
      const [cx, cy] = P(x + s * .45, y - s * .15, z + h + rh * .4);
      g += `<rect x="${cx - 3}" y="${cy - 14}" width="7" height="15" fill="${shade(roof, -.45)}"/>`;
      ['', ' d2', ' d3'].forEach(dd => { g += `<circle class="smoke${dd}" cx="${cx}" cy="${cy - 18}" r="${4 + Math.min(4, here / 4)}" fill="rgba(255,255,255,.85)"/>`; });
      for (let i = 0; i < Math.min(3, here); i++) g += person(x - .45 + i * .45, y1 + .55 + (i % 2) * .2, z, i + key.length);
    }
    if (o.fog) { const [fx, fy] = P(x, y, z + h * .8); g += fog(fx, fy, s * HW * 1.9, s * HH * 3.2, key.length * 7 + Math.round(x)); }
    return `<g class="bld${o.dim ? ' dim' : ''}" data-room="${key}">${g}</g>`;
  }
  function gateArch(key, R, z, label, o = {}) {
    const L = P(R.x + .9, R.y - .9, z), Rr = P(R.x - .9, R.y + .9, z), hh = 46;
    let g = '';
    if (o.glow) { const [gx, gy] = P(R.x, R.y, z); g += `<ellipse cx="${gx}" cy="${gy}" rx="70" ry="35" fill="rgba(34,197,94,.18)" stroke="#22c55e" stroke-width="2.5"/>`; }
    if (o.ring) { const [gx, gy] = P(R.x, R.y, z); g += `<ellipse cx="${gx}" cy="${gy}" rx="78" ry="39" fill="none" stroke="${o.ring === true ? '#f59e0b' : o.ring}" stroke-width="3" stroke-dasharray="8 7" class="ring"/>`; }
    [L, Rr].forEach(p => { g += `<rect x="${p[0] - 4}" y="${p[1] - hh}" width="8" height="${hh}" fill="#8a3b12"/><rect x="${p[0] - 6}" y="${p[1] - hh - 4}" width="12" height="6" fill="#b45309"/>`; });
    g += `<path d="M${L[0]} ${L[1] - hh} Q ${(L[0] + Rr[0]) / 2} ${Math.min(L[1], Rr[1]) - hh - 26} ${Rr[0]} ${Rr[1] - hh}" fill="none" stroke="#b91c1c" stroke-width="7" stroke-linecap="round"/>`;
    if (label) { const mx = (L[0] + Rr[0]) / 2, my = Math.min(L[1], Rr[1]) - hh - 12;
      g += `<rect x="${mx - 30}" y="${my - 10}" width="60" height="18" rx="4" fill="#fde68a" stroke="#92400e"/><text x="${mx}" y="${my + 3}" text-anchor="middle" font-size="10" font-weight="700" fill="#7c2d12" font-family="Inter">${label}</text>`; }
    for (let i = 0; i < Math.min(4, o.here || 0); i++) g += person(R.x + .6 + i * .35, R.y + .9 + i * .3, z, i + 3);
    return `<g class="${key ? 'bld' : ''}${o.dim ? ' dim' : ''}" ${key ? `data-room="${key}"` : ''}>${g}</g>`;
  }
  function fence(Z, front) {
    const { x0, y0, x1, y1, h } = Z, z = h;
    const segs = front ? [[[x0, y1], [x1 - 1.4, y1]], [[x1, y1 - 1.4], [x1, y0]]] : [[[x0, y0], [x1, y0]], [[x0, y0], [x0, y1]]];
    let g = '';
    segs.forEach(([A, B]) => {
      const n = Math.round(Math.hypot(B[0] - A[0], B[1] - A[1]) / .7);
      [9, 17].forEach(hh => { const a = P(A[0], A[1], z + hh), b = P(B[0], B[1], z + hh); g += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#9a5b2e" stroke-width="2.5"/>`; });
      for (let i = 0; i <= n; i++) { const t = i / n, p = P(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, z); g += `<rect x="${p[0] - 2}" y="${p[1] - 21}" width="4" height="21" fill="#7c4a1e"/>`; }
    });
    return g;
  }
  // Đường đất kiểu ô lưới: đi dọc trục x rồi trục y
  function road(A, B, z, w) {
    const m = [B[0], A[1]];
    const d = [A, m, B].map((p, i) => { const q = P(p[0], p[1], z); return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' ');
    return `<path d="${d}" fill="none" stroke="#b08a57" stroke-width="${w + 4}" stroke-linejoin="round" stroke-linecap="round" opacity=".55"/>` +
      `<path d="${d}" fill="none" stroke="#e9d3a4" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  const flowW = (n, max) => n ? 4 + 16 * Math.sqrt(n / Math.max(1, max)) : 2;
  function bridge(A, za, B, zb, w) {
    const a = P(A[0], A[1], za), b = P(B[0], B[1], zb);
    const d = `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`;
    return `<path d="${d}" stroke="#5b3a1e" stroke-width="${w + 7}" stroke-linecap="round"/>` +
      `<path d="${d}" stroke="#c8915a" stroke-width="${w + 2}" stroke-linecap="round"/>` +
      `<path d="${d}" stroke="#8b5a2b" stroke-width="${w + 2}" stroke-dasharray="2 7"/>`;
  }
  function flowLabel(x, y, text, color) {
    if (!text) return '';
    const w = text.length * 8 + 18;
    return `<g class="flow-lbl"><rect x="${x}" y="${y - 12}" width="${w}" height="24" rx="12" fill="${color}" opacity=".92"/><text x="${x + w / 2}" y="${y + 5}" text-anchor="middle">${esc(text)}</text></g>`;
  }
  function sourceDock(S, o = {}) {
    const z = 8;
    let g = '';
    if (S.cloud) {
      const [cx, cy] = P(S.x, S.y, 30);
      g += `<g opacity=".95"><ellipse cx="${cx}" cy="${cy}" rx="58" ry="22" fill="#f1f5f9"/><circle cx="${cx - 26}" cy="${cy - 10}" r="20" fill="#f8fafc"/><circle cx="${cx + 8}" cy="${cy - 18}" r="26" fill="#ffffff"/><circle cx="${cx + 34}" cy="${cy - 6}" r="16" fill="#f1f5f9"/></g>`;
    } else {
      const Z = { x0: S.x - 1.1, y0: S.y - 1.1, x1: S.x + 1.1, y1: S.y + 1.1, h: z, thick: 14, key: 'src',
        sideL: '#6b9bc3', sideR: '#4f7fa8', lipL: '#38bdf8', lipR: '#0ea5e9', rockL: '#4b6584', rockR: '#3b5068' };
      g += island(Z);
      const [px, py] = P(S.x, S.y, z);
      g += `<rect x="${px - 2.5}" y="${py - 44}" width="5" height="44" fill="#7c4a1e"/>`;
      g += `<rect x="${px - 44}" y="${py - 68}" width="88" height="28" rx="7" fill="${S.color}" stroke="rgba(0,0,0,.25)"/>`;
      g += `<text x="${px}" y="${py - 49}" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="Inter">${esc(S.label.replace(' cá nhân', ''))}</text>`;
      for (let i = 0; i < Math.min(3, o.here || 0); i++) g += person(S.x - .5 + i * .5, S.y + .7, z, i + 1);
    }
    return `<g class="src${o.dim ? ' dim' : ''}" data-room="src:${S.key}">${g}</g>`;
  }
  function defs() {
    return '<defs>' + Object.entries(ZONES).map(([k, Z]) => `<linearGradient id="gt-${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${Z.top[0]}"/><stop offset="1" stop-color="${Z.top[1]}"/></linearGradient>`).join('') +
      `<linearGradient id="gt-src" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bae6fd"/><stop offset="1" stop-color="#7dd3fc"/></linearGradient>` +
      `<radialGradient id="sun"><stop offset="0" stop-color="#fff7c2"/><stop offset=".6" stop-color="#fde047"/><stop offset="1" stop-color="#fde04700"/></radialGradient>` +
      `<filter id="fogblur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter></defs>`;
  }
  function backdrop() {
    return `<circle cx="470" cy="-170" r="60" fill="url(#sun)"/>` +
      `<g class="cloud"><ellipse cx="-330" cy="-120" rx="70" ry="18" fill="#fff" opacity=".85"/><ellipse cx="-300" cy="-134" rx="38" ry="18" fill="#fff" opacity=".85"/></g>` +
      `<g class="cloud c2"><ellipse cx="330" cy="-60" rx="80" ry="20" fill="#fff" opacity=".8"/><ellipse cx="360" cy="-76" rx="42" ry="20" fill="#fff" opacity=".8"/></g>` +
      `<g class="cloud"><ellipse cx="470" cy="520" rx="70" ry="16" fill="#fff" opacity=".6"/></g><g class="cloud c2"><ellipse cx="-480" cy="700" rx="80" ry="18" fill="#fff" opacity=".6"/></g>`;
  }
  // Toàn cảnh: đảo, đường, nhà, cầu, sông, bến kênh, tên khu.
  // opt.room(key) → tuỳ chọn nhà (xem house); opt.roadW(key) → bề rộng đường tới nhà; opt.trunk = { w3, w8 } (đường lên khu trên);
  // opt.bridgeW = { summit, garden, village }; opt.exit = null | { w, here }; opt.river(key) → { w, dim }; opt.dock(key) → { here, dim };
  // opt.locked = ['garden', 'summit'] khu phủ sương (thành viên chưa mở)
  function scene(opt) {
    const room = opt.room || (() => ({})), roadW = opt.roadW || (() => 4);
    const trunk = opt.trunk || { w3: 4, w8: 4 }, bw = opt.bridgeW || { summit: 4, garden: 4, village: 4 };
    const locked = new Set(opt.locked || []);
    const R = ROOMS;
    let body = '';
    ['summit', 'garden', 'village', 'camnang', 'gate', 'nhatky', 'intro', 'support'].forEach(zk => {
      const Z = { ...ZONES[zk], key: zk };
      body += island(Z);
      if (zk === 'garden') body += fence(Z, false);
      // trang trí: cây / hoa / đá, tránh nhà
      const rnd = rng({ summit: 7, garden: 13, village: 29, gate: 41, support: 53, intro: 61, camnang: 67, nhatky: 71 }[zk]);
      const items = [];
      const nItems = { summit: 10, garden: 26, village: 30, gate: 6, support: 4, intro: 4, camnang: 9, nhatky: 3 }[zk];
      for (let i = 0; i < nItems * 4 && items.length < nItems; i++) {
        const x = Z.x0 + .4 + rnd() * (Z.x1 - Z.x0 - .8), y = Z.y0 + .4 + rnd() * (Z.y1 - Z.y0 - .8);
        if (Object.values(R).some(r => r.zone === zk && Math.abs(r.x - x) < (r.s || 1) + .9 && Math.abs(r.y - y) < (r.s || 1) + .9)) continue;
        if (Math.abs(x - y) < .9) continue;   // để trống lối đi chính giữa
        items.push([x, y]);
      }
      const kind = zk === 'summit' ? 'rock' : 'tree';
      // đường nội khu
      if (zk === 'gate') ['noi_quy', 'ho_so'].forEach(k => { body += road([30.4, 30.4], [R[k].x, R[k].y], Z.h, roadW(k)); });
      if (zk === 'village') {
        ['w3', 'thao_luan', 'cam_nang', 'mot_mot', 'khoa_free', 'cho'].forEach(k => { body += road([24.6, 24.6], [R[k].x, R[k].y], Z.h, roadW(k)); });
        body += road([R.w3.x, R.w3.y], [16.4, 16.4], Z.h, trunk.w3);
        if (opt.exit) body += road([R.khoa_free.x, R.khoa_free.y], [21.5, 24.9], Z.h, 4);
        body += road([R.cam_nang.x, R.cam_nang.y], [24.9, 17.4], Z.h, roadW('cam_nang'));
      }
      if (zk === 'garden') {
        ['w8', 'w8_thao_luan', 'khoa_rieng'].forEach(k => { body += road([14.2, 14.2], [R[k].x, R[k].y], Z.h, roadW(k)); });
        body += road([R.w8.x, R.w8.y], [8.4, 8.4], Z.h, trunk.w8);
      }
      if (zk === 'summit') ['p377', 'p377_thao_luan', 'p377_bao_cao', 'p377_hoc'].forEach(k => { body += road([6.85, 6.85], [R[k].x, R[k].y], Z.h, roadW(k)); });
      // đồ vật + nhà theo chiều sâu (xa vẽ trước)
      const things = items.map((p, i) => ({ t: p[0] + p[1], s: zk === 'garden' ? tree(p[0], p[1], Z.h, i, i % 3 ? 'flower' : 'tree') : tree(p[0], p[1], Z.h, i, kind) }));
      Object.entries(R).filter(([, r]) => r.zone === zk).forEach(([k, r]) => {
        things.push({ t: r.x + r.y + (r.s || 0), s: r.gate ? gateArch(k, r, Z.h, 'Cổng vườn', room(k)) : house(k, r, Z.h, room(k)) });
      });
      things.sort((a, b) => a.t - b.t).forEach(o => { body += o.s; });
      if (zk === 'garden') body += fence(Z, true);
      if (zk === 'gate') {
        body += gateArch(null, { x: 30.5, y: 30.5 }, Z.h, 'Cổng làng');
        body += road([R.noi_quy.x, R.noi_quy.y], [27.8, 30.9], Z.h, roadW('ho_tro'));
        body += bridge([27.8, 31], ZONES.gate.h, [27.8, 32.4], ZONES.support.h, Math.max(4, roadW('ho_tro')));
        body += road([R.ho_so.x, R.ho_so.y], [30.9, 27.8], Z.h, roadW('gioi_thieu'));
        body += bridge([31, 27.8], ZONES.gate.h, [32.4, 27.8], ZONES.intro.h, Math.max(4, roadW('gioi_thieu')));
      }
      if (zk === 'camnang') {
        ['tro_ly', 'tai_lieu', 'tra_cuu'].forEach(k => { body += road([26.5, 17.4], [R[k].x, R[k].y], Z.h, roadW(k)); });
        body += road([R.tra_cuu.x, R.tra_cuu.y], [30.9, 19.4], Z.h, roadW('nhat_ky'));
      }
      if (zk === 'nhatky') body += road([32.1, 19.4], [R.nhat_ky.x, R.nhat_ky.y], Z.h, roadW('nhat_ky'));
      if (zk === 'intro') body += road([32.5, 27.8], [R.gioi_thieu.x, R.gioi_thieu.y], Z.h, roadW('gioi_thieu'));
      if (zk === 'support') body += road([27.8, 32.5], [R.ho_tro.x, R.ho_tro.y], Z.h, roadW('ho_tro'));
      // khu chưa mở: sương mù nhẹ phủ cả đảo + biển khoá
      if (locked.has(zk)) {
        const [mx, my] = P((Z.x0 + Z.x1) / 2 - .6, (Z.y0 + Z.y1) / 2 - .6, Z.h + 30);
        body += `<g class="fog drift" opacity=".55">${fog(mx, my, (Z.x1 - Z.x0) * HW * .75, (Z.y1 - Z.y0) * HH * .8, zk.length * 31)}</g>`;
      }
      // cầu sang khu kế tiếp
      if (zk === 'summit') body += bridge([7, 7], ZONES.summit.h, [8, 8], ZONES.garden.h, bw.summit);
      if (zk === 'village') body += bridge([25, 17.4], ZONES.village.h, [26.4, 17.4], ZONES.camnang.h, Math.max(4, roadW('cam_nang')));
      if (zk === 'camnang') body += bridge([31, 19.4], ZONES.camnang.h, [32, 19.4], ZONES.nhatky.h, Math.max(4, roadW('nhat_ky')));
      if (zk === 'garden') body += bridge([15, 15], ZONES.garden.h, [16, 16], ZONES.village.h, bw.garden);
      if (zk === 'village') {
        body += bridge([25, 25], ZONES.village.h, [26, 26], ZONES.gate.h, bw.village);
        if (opt.exit) {
          // cổng sau → đảo "rời đi"
          const EZ = { ...ZONES.exit, key: 'exit' };
          body += bridge([21.5, 25], ZONES.village.h, [21.5, 28], EZ.h, opt.exit.w);
          body += island(EZ);
          const [ex, ey] = P(EXIT.x, EXIT.y, EZ.h);
          body += `<g class="bld" data-room="exit"><rect x="${ex - 3}" y="${ey - 48}" width="6" height="48" fill="#57534e"/><polygon points="${ex - 4},${ey - 50} ${ex + 44},${ey - 50} ${ex + 54},${ey - 40} ${ex + 44},${ey - 30} ${ex - 4},${ey - 30}" fill="#64748b"/><text x="${ex + 22}" y="${ey - 36}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" font-family="Inter">RỜI ĐI</text>`;
          for (let i = 0; i < Math.min(4, opt.exit.here || 0); i++) body += person(EXIT.x - .6 + i * .4, EXIT.y + .8, EZ.h, i + 2);
          body += '</g>';
        }
      }
    });
    // Sông từ các kênh chảy về cổng làng
    let rivers = '';
    const gtip = P(31, 31, ZONES.gate.h - 10);
    SOURCES.forEach(S => {
      const rv = opt.river ? opt.river(S.key) : { w: 4 }, w = rv.w;
      const a = P(S.x, S.y, S.cloud ? 18 : 8);
      const d = `M${a[0]} ${a[1]} C ${a[0]} ${a[1] - 70}, ${gtip[0] + (a[0] - gtip[0]) * .25} ${gtip[1] + 60}, ${gtip[0]} ${gtip[1]}`;
      rivers += `<g${rv.dim ? ' class="dim"' : ''}><path d="${d}" fill="none" stroke="#2b8fd6" stroke-width="${w + 4}" stroke-linecap="round" opacity=".55"/>` +
        `<path d="${d}" fill="none" stroke="#7dd3fc" stroke-width="${w}" stroke-linecap="round"/>` +
        `<path d="${d}" fill="none" stroke="#e0f2fe" stroke-width="${Math.max(1.5, w / 4)}" stroke-dasharray="6 14" stroke-linecap="round" class="water-flow"/></g>`;
    });
    const docks = SOURCES.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y)).map(S => sourceDock(S, opt.dock ? opt.dock(S.key) : {})).join('');
    // Tên khu
    let titles = '';
    ['summit', 'garden', 'village', 'gate', 'support', 'intro', 'camnang', 'nhatky'].forEach(zk => {
      const Z = ZONES[zk], p = Z.titleFront ? P(Z.x1, Z.y1, Z.h) : Z.titleRight ? P(Z.x1, Z.y0, Z.h) : P(Z.x0, Z.y1, Z.h);
      const x = p[0] + (Z.titleFront ? 0 : Z.titleRight ? 10 : -10) + (Z.tdx || 0), y = p[1] + (Z.titleFront ? 95 : 62);
      titles += `<text class="zone-title" x="${x}" y="${y}" text-anchor="middle" fill="${Z.tc}">${Z.title}</text>`; });
    titles += `<text class="zone-title" x="0" y="${P(35, 35)[1] + 6}" text-anchor="middle" fill="#0369a1">🌊 CÁC KÊNH ĐẦU VÀO · THỦY</text>`;
    return rivers + body + docks + titles;   // sông chảy bên dưới các đảo nổi
  }
  // Khung nhãn vừa chữ (gọi sau khi SVG đã vào trang)
  // Nhãn có 1–3 dòng chữ (.t1, .t2, .t3): khung ôm theo dòng dài nhất
  function fitLabels(root) {
    root.querySelectorAll('.lbl').forEach(g => {
      const lines = [...g.querySelectorAll('text')], r = g.querySelector('rect.bg');
      const w = Math.max(...lines.map(t => t.getBBox().width)) + 18;
      const h = lines.length === 1 ? 30 : lines.length === 2 ? 48 : 66;
      r.setAttribute('x', -w / 2); r.setAttribute('y', lines.length === 1 ? -18 : -26); r.setAttribute('width', w); r.setAttribute('height', h);
    });
  }

  // ── Bong bóng hoạt động thật (bài mới, bình luận, lượt thích, thành viên mới, báo cáo) lần lượt bay lên từ đúng ngôi nhà ──
  const ACT = { post: ['📝', 'vừa đăng bài', '#0ea5e9'], comment: ['💬', 'vừa bình luận', '#8b5cf6'], like: ['❤️', 'vừa thích một bài', '#ef4444'],
    member: ['👋', 'vừa vào làng', '#10b981'], report: ['📊', 'vừa nộp báo cáo', '#f59e0b'] };
  const SVGNS = 'http://www.w3.org/2000/svg';
  function ago(at, now) {
    const m = Math.max(0, Math.round((Date.parse(String(now).replace(' ', 'T')) - Date.parse(String(at).replace(' ', 'T'))) / 60000));
    return m < 1 ? 'vừa xong' : m < 60 ? m + ' phút trước' : m < 1440 ? Math.round(m / 60) + ' giờ trước' : Math.round(m / 1440) + ' ngày trước';
  }
  let actTimer = null;
  // getSvg(): SVG đang hiện (bản đồ có thể vẽ lại bất cứ lúc nào); data = { now, events }
  function startActivity(getSvg, data, every = 1700) {
    clearInterval(actTimer);
    const events = (data && data.events || []).filter(e => ROOMS[e.room] && ACT[e.kind]);
    if (!events.length) return;
    let i = 0, lastRoom = '';
    const tick = () => {
      const svg = getSvg();
      if (!svg || document.hidden) return;
      let e = events[i++ % events.length];
      if (events.length > 2 && e.room === lastRoom) e = events[i++ % events.length];   // 2 bong bóng liền nhau không cùng một nhà
      lastRoom = e.room;
      const [x, y] = roomTop(e.room), [ic, verb, color] = ACT[e.kind];
      let line = `${e.who} ${verb}`;
      if (e.title) line += `: “${e.title.length > 34 ? e.title.slice(0, 33) + '…' : e.title}”`;
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('transform', `translate(${(x + (Math.random() - .5) * 80).toFixed(1)},${(y - 40).toFixed(1)})`);
      g.setAttribute('pointer-events', 'none');
      g.innerHTML = `<g class="fly-in"><rect class="fb" rx="16" fill="#fff" stroke="${color}" stroke-width="2.5"/>` +
        `<text class="ft1" text-anchor="middle" y="-3">${esc(ic + ' ' + line)}</text><text class="ft2" text-anchor="middle" y="18" fill="${color}">${esc(ago(e.at, data.now))}</text>` +
        (e.kind === 'like' ? `<text class="heart h1" x="-30" y="-30">❤️</text><text class="heart h2" x="22" y="-40">❤️</text>` : '') + '</g>';
      svg.appendChild(g);
      const b1 = g.querySelector('.ft1').getBBox(), r = g.querySelector('.fb'), w = b1.width + 26;
      r.setAttribute('x', -w / 2); r.setAttribute('y', -27); r.setAttribute('width', w); r.setAttribute('height', 54);
      setTimeout(() => g.remove(), 6200);
    };
    tick();
    actTimer = setInterval(tick, every);
  }

  // Hoạt ảnh + kiểu chữ dùng chung
  const css = document.createElement('style');
  css.textContent = `
    .bld, .lbl, .src { cursor: pointer; }
    .bld:hover polygon { filter: brightness(1.06); }
    .lbl rect.bg { fill: #ffffff; stroke: rgba(15,23,42,.18); }
    .lbl:hover rect.bg { stroke: #0ea5e9; stroke-width: 2; }
    .lbl.sel rect.bg { stroke: #f59e0b; stroke-width: 2.5; }
    .lbl text { font-family: Inter, sans-serif; fill: #0f172a; }
    .lbl .t1 { font-size: 17px; font-weight: 700; }
    .lbl .t2 { font-size: 14px; fill: #475569; }
    .lbl .t2 tspan.here, .lbl .t3 tspan.here { fill: #16a34a; font-weight: 700; }
    .lbl .t3 { font-size: 13.5px; fill: #475569; }
    .dim { opacity: .28; }
    .zone-title { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 21px; paint-order: stroke; stroke: rgba(255,255,255,.9); stroke-width: 5px; stroke-linejoin: round; }
    [data-theme="dark"] .zone-title { fill: #f8fafc; stroke: rgba(2,6,23,.75); }
    .flow-lbl text { font-family: Inter, sans-serif; font-size: 14px; font-weight: 700; fill: #fff; }
    @keyframes jmSmoke { 0% { transform: translate(0, 0) scale(.6); opacity: .75; } 100% { transform: translate(6px, -26px) scale(1.5); opacity: 0; } }
    .smoke { animation: jmSmoke 2.6s ease-out infinite; transform-box: fill-box; transform-origin: center; }
    .smoke.d2 { animation-delay: .9s; } .smoke.d3 { animation-delay: 1.8s; }
    @keyframes jmFlow { to { stroke-dashoffset: -40; } }
    .water-flow { animation: jmFlow 1.6s linear infinite; }
    @keyframes jmCloud { from { transform: translateX(-30px); } to { transform: translateX(30px); } }
    .cloud { animation: jmCloud 18s ease-in-out infinite alternate; }
    .cloud.c2 { animation-duration: 24s; animation-direction: alternate-reverse; }
    .fog.drift { animation: jmCloud 14s ease-in-out infinite alternate; }
    @keyframes jmBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
    .pin { animation: jmBounce 1.2s ease-in-out infinite; }
    @keyframes jmRing { to { stroke-dashoffset: -30; } }
    .ring { animation: jmRing 1.4s linear infinite; }
    .fly-in { animation: jmFly 6s ease-out forwards; transform-box: fill-box; transform-origin: center bottom; }
    @keyframes jmFly { 0% { transform: translateY(18px) scale(.5); opacity: 0; } 8% { transform: translateY(0) scale(1.08); opacity: 1; } 14% { transform: translateY(-6px) scale(1); } 82% { opacity: 1; } 100% { transform: translateY(-110px) scale(1); opacity: 0; } }
    .fly-in .ft1 { font-family: Inter, sans-serif; font-size: 19px; font-weight: 700; fill: #0f172a; }
    .fly-in .ft2 { font-family: Inter, sans-serif; font-size: 14.5px; font-weight: 600; }
    .fly-in rect.fb { filter: drop-shadow(0 4px 10px rgba(0,0,0,.18)); }
    .heart { font-size: 20px; animation: jmHeart 2.2s ease-out infinite; transform-box: fill-box; }
    .heart.h2 { animation-delay: .5s; }
    @keyframes jmHeart { 0% { transform: translateY(0) scale(.6); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(-30px) scale(1.2); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .smoke, .water-flow, .cloud, .pin, .ring, .fog.drift, .heart { animation: none; } .fly-in { animation: none; } }`;
  document.head.appendChild(css);

  window.JM = { HW, HH, P, pts, poly, esc, ZONES, ROOMS, SOURCES, SRC, EXIT, VIEWBOX, roomFoot, roomTop,
    shade, rng, island, tree, person, fog, house, gateArch, fence, road, flowW, bridge, flowLabel, sourceDock, defs, backdrop, scene, fitLabels, startActivity };
})();
