// ── Hồ sơ y khoa (tab "🩺 Hồ sơ y khoa" trong lo-trinh.html) ─────────────────
// Lần khám (ngày, nơi khám) → phiếu đính kèm (ảnh/PDF, lưu Drive riêng tư, xem qua máy chủ),
// chỉ số xét nghiệm, chẩn đoán hình ảnh. Mọi API cần token đăng nhập (currentUser.session_token).
// Trạng thái: draft (nháp) → submitted (chờ BTC kiểm tra) → verified (đã xác nhận) | returned (BTC trả lại).
(function () {
  const ROOT_ID = 'panel-medical';
  const STATUS = {
    draft: ['Nháp', '#64748b', '#f1f5f9'],
    submitted: ['Chờ BTC kiểm tra', '#b45309', '#fef3c7'],
    verified: ['✅ Đã xác nhận', '#047857', '#d1fae5'],
    returned: ['↩️ BTC trả lại', '#b91c1c', '#fee2e2'],
  };
  const QUICK_GROUPS = {
    'Mỡ máu': ['cholesterol', 'ldl', 'hdl', 'triglyceride'],
    'Đường huyết': ['glucose', 'hba1c'],
    'Gan': ['ast', 'alt', 'ggt'],
    'Thận': ['urea', 'creatinine', 'uric_acid'],
    'Công thức máu': ['rbc', 'hgb', 'wbc', 'plt'],
    'Chỉ số cơ thể': ['weight', 'waist', 'bp_sys', 'bp_dia'],
  };

  let tests = [], testMap = {}, imagingKinds = {};
  let visits = [], editing = null;   // editing: bản sao lần khám đang sửa
  let busy = 0;
  let aiConsent = false;
  let listTab = 'visits';   // 'visits' | 'compare'

  const $root = () => document.getElementById(ROOT_ID);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || ''); };
  const token = () => { try { return JSON.parse(localStorage.getItem('currentUser') || '{}').session_token || ''; } catch { return ''; } };

  async function api(url, opts = {}) {
    const headers = { 'x-user-token': token(), ...(opts.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch('/api/health-records' + url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Có lỗi, vui lòng thử lại.'); e.code = data.code; throw e; }
    return data;
  }
  function relogin() {
    try { localStorage.removeItem('currentUser'); } catch {}
    location.href = 'index.html?redirect=' + encodeURIComponent('lo-trinh.html?tab=medical');
  }
  function handleErr(e) {
    if (e.code === 'session_required') return renderNeedLogin();
    if (e.code === 'consent_required') return renderConsent();
    alert(e.message);
  }

  // Ảnh phiếu: giữ đủ nét để đọc chữ (cạnh dài 2400px, JPEG 0.85). PDF giữ nguyên.
  async function compressSheet(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)/i.test(file.type)) return file;
    try {
      const src = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 2400 / Math.max(src.width, src.height));
      const c = document.createElement('canvas');
      c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      return blob && blob.size < file.size ? new File([blob], 'phieu.jpg', { type: 'image/jpeg' }) : file;
    } catch { return file; }
  }

  // ── Màn hình: cần đăng nhập lại / đồng ý ──────────────────────────────
  function renderNeedLogin() {
    $root().innerHTML = `<div class="state-card"><div class="state-icon">🔐</div>
      <div class="state-title">Đăng nhập lại để mở Hồ sơ y khoa</div>
      <div class="state-body">Hồ sơ y khoa chứa thông tin sức khoẻ riêng tư nên cần xác thực lại 1 lần trên thiết bị này.</div>
      <button class="hr-btn primary" style="margin-top:18px;" onclick="HR.relogin()">Đăng nhập lại</button></div>`;
  }
  function renderConsent() {
    $root().innerHTML = `<div class="hr-card">
      <div class="hr-title">🩺 Hồ sơ y khoa của bạn</div>
      <div class="hr-text">Lưu kết quả <b>xét nghiệm máu, siêu âm, X-quang…</b> theo từng lần khám để sau một thời gian thực hành bạn
        <b>đối chiếu trước – sau</b> và thấy rõ cơ thể thay đổi thế nào.</div>
      <div class="hr-consent">
        <b>Trước khi bắt đầu, vui lòng đọc và đồng ý:</b>
        <ul>
          <li>Thông tin sức khoẻ là <b>dữ liệu cá nhân nhạy cảm</b>. AI Agents CC lưu trữ để bạn theo dõi và để Ban tổ chức hỗ trợ đúng hơn.</li>
          <li>Chỉ <b>bạn</b> và <b>Ban tổ chức (admin)</b> xem được hồ sơ. Không chia sẻ cho thành viên khác hay bên thứ ba. Mọi lần admin xem đều được ghi lại và bạn xem được.</li>
          <li>Phiếu bạn tải lên được lưu ở kho riêng tư, không ai mở được bằng đường link.</li>
          <li>Hồ sơ dùng để theo dõi thay đổi, <b>không thay thế chẩn đoán của bác sĩ</b>.</li>
          <li>Bạn có thể rút lại sự đồng ý hoặc xoá các lần khám chưa gửi bất cứ lúc nào.</li>
        </ul>
        <label class="hr-check"><input type="checkbox" id="hrAgree"> Tôi đã đọc và đồng ý cho lưu trữ, xử lý dữ liệu sức khoẻ của tôi như trên.</label>
        <label class="hr-check"><input type="checkbox" id="hrAiAgree" checked> Đồng ý cho AI đọc ảnh phiếu để điền sẵn chỉ số (tôi sẽ kiểm tra lại trước khi lưu).</label>
      </div>
      <button class="hr-btn primary" onclick="HR.agree()">Đồng ý và mở hồ sơ</button>
    </div>`;
  }
  async function agree() {
    if (!document.getElementById('hrAgree').checked) { alert('Vui lòng tích ô đồng ý để tiếp tục.'); return; }
    try { await api('/consent', { method: 'POST', body: JSON.stringify({ agree: true, ai_consent: document.getElementById('hrAiAgree').checked }) }); load(); }
    catch (e) { handleErr(e); }
  }

  // ── Danh sách lần khám ───────────────────────────────────────────────
  const badge = st => { const [t, c, bg] = STATUS[st] || STATUS.draft; return `<span class="hr-badge" style="color:${c};background:${bg};">${t}</span>`; };
  function renderList() {
    editing = null;
    $root().innerHTML = `<div class="hr-card">
        <div class="hr-head"><div><div class="hr-title">🩺 Hồ sơ y khoa</div>
          <div class="hr-sub">Mỗi lần đi khám / xét nghiệm, bạn thêm 1 "lần khám" và tải phiếu kết quả lên.</div></div>
          <button class="hr-btn primary" onclick="HR.newVisit()">+ Thêm lần khám</button></div>
        <div class="hr-note">ℹ️ Hồ sơ dùng để theo dõi thay đổi, không thay thế chẩn đoán của bác sĩ.</div>
        <div class="hr-subtabs">
          <button class="${listTab === 'visits' ? 'active' : ''}" onclick="HR.setTab('visits')">📋 Các lần khám</button>
          <button class="${listTab === 'compare' ? 'active' : ''}" onclick="HR.setTab('compare')">📈 So sánh trước – sau</button>
        </div>
      </div>
      ${listTab === 'compare' ? compareHtml() : !visits.length ? `<div class="state-card"><div class="state-icon">📋</div><div class="state-title">Chưa có lần khám nào</div>
        <div class="state-body">Bấm <b>+ Thêm lần khám</b> và tải phiếu xét nghiệm / siêu âm gần nhất của bạn lên — đó sẽ là mốc "trước" để so sánh về sau.</div></div>`
      : visits.map(v => `<div class="hr-visit" onclick="HR.open(${v.id})">
          <div class="hr-visit-date">${fmtDate(v.visit_date)}</div>
          <div class="hr-visit-main"><div class="hr-visit-title">${esc(v.title || 'Lần khám')}${v.place ? ` · <span>${esc(v.place)}</span>` : ''}</div>
            <div class="hr-visit-meta">${v.results.length} chỉ số · ${v.imaging.length} kết quả hình ảnh · ${v.files.length} phiếu</div>
            ${v.status === 'returned' && v.admin_note ? `<div class="hr-visit-return">BTC: ${esc(v.admin_note)}</div>` : ''}</div>
          ${badge(v.status)}</div>`).join('')}
      <div style="text-align:center;margin-top:14px;"><button class="hr-link" onclick="HR.showLog()">🔍 Ai đã xem hồ sơ của tôi?</button></div>`;
  }
  function setTab(t) { listTab = t; renderList(); }

  // ── So sánh trước – sau ──────────────────────────────────────────────
  // Dùng các lần khám đã gửi BTC (đã xác nhận / chờ kiểm tra / bị trả lại), bỏ nháp. Mỗi chỉ số
  // 1 hàng, mỗi lần khám 1 cột (cũ → mới). Một lần khám có 2 kết quả cùng chỉ số (VD glucose
  // mmol/L và mg/dL) thì lấy kết quả cùng đơn vị với lần đo đầu tiên để so sánh đúng.
  const normUnit = u => String(u || '').toLowerCase().replace(/\s+/g, '').replace('μ', 'µ');
  const resKey = r => r.test_code && !r.test_code.startsWith('custom:') ? r.test_code : 'custom:' + String(r.test_name || '').trim().toLowerCase();
  function compareData() {
    const cols = visits.filter(v => v.status !== 'draft').slice().sort((a, b) => a.visit_date.localeCompare(b.visit_date) || a.id - b.id);
    const order = tests.map(t => t.code);
    const rows = new Map();
    cols.forEach(v => v.results.forEach(r => {
      const k = resKey(r);
      if (!rows.has(k)) rows.set(k, { key: k, name: testMap[r.test_code]?.name || r.test_name, group: testMap[r.test_code]?.group || 'Chỉ số khác', unit: r.unit });
    }));
    const list = [...rows.values()].sort((a, b) => {
      const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.name.localeCompare(b.name, 'vi');
    });
    list.forEach(row => {
      row.cells = cols.map(v => {
        const same = v.results.filter(r => resKey(r) === row.key);
        return same.find(r => normUnit(r.unit) === normUnit(row.unit)) || same[0] || null;
      });
      row.count = row.cells.filter(Boolean).length;
    });
    return { cols, rows: list };
  }
  function cellHtml(r, prev) {
    if (!r) return '<td class="hr-c-empty">—</td>';
    const cls = r.flag === 'high' ? 'hi' : r.flag === 'low' ? 'lo' : r.flag === 'normal' ? 'ok' : '';
    let delta = '';
    if (prev && r.value_num != null && prev.value_num != null && normUnit(prev.unit) === normUnit(r.unit) && prev.value_num !== 0) {
      const d = r.value_num - prev.value_num;
      if (Math.abs(d) > 1e-9) {
        const pct = Math.round(d / Math.abs(prev.value_num) * 100);
        // tốt lên: từ ngoài khoảng tham chiếu về trong khoảng, hoặc tiến lại gần khoảng
        const better = (prev.flag === 'high' && d < 0) || (prev.flag === 'low' && d > 0) || (prev.flag !== 'normal' && r.flag === 'normal');
        const worse = (r.flag === 'high' && d > 0) || (r.flag === 'low' && d < 0);
        delta = `<span class="hr-delta ${better ? 'good' : worse ? 'bad' : ''}">${d > 0 ? '↑' : '↓'} ${Math.abs(pct)}%</span>`;
      }
    }
    return `<td class="hr-c ${cls}"><b>${esc(r.value_text)}</b>${delta}</td>`;
  }
  function compareHtml() {
    const { cols, rows } = compareData();
    if (!cols.length) return `<div class="state-card"><div class="state-icon">📈</div><div class="state-title">Chưa có dữ liệu để so sánh</div>
      <div class="state-body">Gửi Ban tổ chức ít nhất 1 lần khám có chỉ số. Từ lần khám thứ 2 trở đi, bảng sẽ cho thấy chỉ số tăng / giảm thế nào.</div></div>`;
    const groups = [];
    rows.forEach(r => { const g = groups.find(x => x.name === r.group); g ? g.rows.push(r) : groups.push({ name: r.group, rows: [r] }); });
    const imgGroups = {};
    cols.forEach(v => v.imaging.forEach(m => {
      const k = `${imagingKinds[m.kind] || m.kind} · ${m.body_part || 'Không ghi vùng'}`;
      (imgGroups[k] = imgGroups[k] || []).push({ date: v.visit_date, conclusion: m.conclusion || m.findings, verified: v.status === 'verified' });
    }));
    return `<div class="hr-card hr-print-area">
      <div class="hr-print-head">
        <div class="hr-title">Hồ sơ y khoa — So sánh trước / sau</div>
        <div class="hr-sub">${esc([currentName(), 'In ngày ' + fmtDate(new Date().toISOString())].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="hr-head hr-no-print"><div class="hr-sub">${cols.length} lần khám · ${rows.length} chỉ số. Bấm vào tên chỉ số để xem biểu đồ.
        <br><span class="hr-delta good" style="display:inline;">↓ 12%</span> thay đổi theo hướng tốt · <span class="hr-delta bad" style="display:inline;">↑ 8%</span> xa khoảng tham chiếu hơn · số <b style="color:#b91c1c;">đỏ</b> / <b style="color:#1d4ed8;">xanh dương</b>: cao / thấp hơn tham chiếu</div>
        <button class="hr-btn" onclick="window.print()">🖨️ In / Lưu PDF</button></div>
      ${rows.length ? `<div class="hr-cmp-wrap"><table class="hr-cmp">
        <thead><tr><th>Chỉ số</th><th>Tham chiếu</th>${cols.map(v => `<th>${fmtDate(v.visit_date)}${v.status !== 'verified' ? '<div class="hr-unv">chưa xác nhận</div>' : ''}</th>`).join('')}</tr></thead>
        <tbody>${groups.map(g => `<tr class="hr-cmp-group"><td colspan="${cols.length + 2}">${esc(g.name)}</td></tr>` + g.rows.map(row => {
          const last = [...row.cells].reverse().find(Boolean);
          const ref = last && (last.ref_low != null || last.ref_high != null)
            ? (last.ref_low != null && last.ref_high != null ? `${last.ref_low} – ${last.ref_high}` : last.ref_low != null ? `≥ ${last.ref_low}` : `≤ ${last.ref_high}`) : '';
          let prev = null;
          return `<tr><td class="hr-cmp-name" onclick="HR.chart('${esc(row.key)}')">${esc(row.name)}<span>${esc(row.unit || '')}</span></td><td class="hr-cmp-ref">${esc(ref)}</td>
            ${row.cells.map(c => { const h = cellHtml(c, prev); if (c) prev = c; return h; }).join('')}</tr>`;
        }).join('')).join('')}</tbody></table></div>`
        : '<div class="hr-empty">Các lần khám chưa có chỉ số xét nghiệm.</div>'}
      <div id="hrChartBox" class="hr-no-print"></div>
      ${Object.keys(imgGroups).length ? `<div class="hr-sec" style="margin-top:18px;">🩻 Chẩn đoán hình ảnh theo thời gian</div>
        ${Object.entries(imgGroups).map(([k, list]) => `<div class="hr-img-tl"><div class="hr-img-tl-k">${esc(k)}</div>
          ${list.map(x => `<div class="hr-img-tl-row"><span>${fmtDate(x.date)}</span><div>${esc(x.conclusion)}${x.verified ? '' : ' <i class="hr-unv">(chưa xác nhận)</i>'}</div></div>`).join('')}</div>`).join('')}` : ''}
      <div class="hr-note" style="margin-top:14px;">Hồ sơ dùng để theo dõi thay đổi, không thay thế chẩn đoán của bác sĩ. Khoảng tham chiếu lấy theo phiếu gần nhất của từng chỉ số.</div>
    </div>`;
  }
  function currentName() {
    try { const u = JSON.parse(localStorage.getItem('currentUser') || '{}'); return `${u.first_name || ''} ${u.last_name || ''}`.trim(); } catch { return ''; }
  }

  // Biểu đồ 1 chỉ số theo thời gian (Chart.js nạp khi cần)
  let chartObj = null;
  function loadChartJs() {
    if (window.Chart) return Promise.resolve();
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload = ok; s.onerror = () => fail(new Error('Không tải được thư viện biểu đồ.'));
      document.head.appendChild(s);
    });
  }
  async function chart(key) {
    const { cols, rows } = compareData();
    const row = rows.find(r => r.key === key);
    const box = document.getElementById('hrChartBox');
    if (!row || !box) return;
    const pts = row.cells.map((c, i) => c && c.value_num != null && normUnit(c.unit) === normUnit(row.unit) ? { x: fmtDate(cols[i].visit_date), y: c.value_num, c } : null).filter(Boolean);
    if (pts.length < 1) { box.innerHTML = `<div class="hr-note" style="margin-top:12px;">${esc(row.name)}: kết quả không phải dạng số nên không vẽ được biểu đồ.</div>`; return; }
    box.innerHTML = `<div class="hr-chart"><div class="hr-head"><b>📈 ${esc(row.name)} (${esc(row.unit || '')})</b><button class="hr-link" onclick="document.getElementById('hrChartBox').innerHTML=''">Đóng ×</button></div>
      <div style="position:relative;height:260px;"><canvas id="hrChartCanvas"></canvas></div>
      ${pts.length < 2 ? '<div class="hr-sub">Mới có 1 lần đo — từ lần khám sau sẽ thấy đường thay đổi.</div>' : ''}</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try { await loadChartJs(); } catch (e) { box.innerHTML = `<div class="hr-note">${esc(e.message)}</div>`; return; }
    const last = pts[pts.length - 1].c;
    const band = (v, label, color) => v == null ? null : { label, data: pts.map(() => v), borderColor: color, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false };
    if (chartObj) chartObj.destroy();
    chartObj = new Chart(document.getElementById('hrChartCanvas'), {
      type: 'line',
      data: { labels: pts.map(p => p.x), datasets: [
        { label: row.name, data: pts.map(p => p.y), borderColor: '#0ea5e9', backgroundColor: '#0ea5e9', tension: 0.25, pointRadius: 5,
          pointBackgroundColor: pts.map(p => p.c.flag === 'high' ? '#dc2626' : p.c.flag === 'low' ? '#2563eb' : '#10b981') },
        band(last.ref_high, 'Ngưỡng cao', '#f87171'), band(last.ref_low, 'Ngưỡng thấp', '#60a5fa'),
      ].filter(Boolean) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } },
    });
  }

  async function newVisit() {
    const today = new Date(); const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    try { const r = await api('/visits', { method: 'POST', body: JSON.stringify({ visit_date: d, title: visits.length ? '' : 'Khám trước khi bắt đầu chương trình' }) });
      visits.unshift(r.visit); open(r.visit.id); }
    catch (e) { handleErr(e); }
  }

  // ── Sửa 1 lần khám ───────────────────────────────────────────────────
  function open(id) {
    const v = visits.find(x => x.id === id);
    if (!v) return;
    editing = JSON.parse(JSON.stringify(v));
    renderEditor();
    window.scrollTo({ top: $root().offsetTop - 10, behavior: 'smooth' });
  }
  const canEdit = () => editing && ['draft', 'returned'].includes(editing.status);

  function testOptions(code) {
    const groups = {};
    tests.forEach(t => (groups[t.group] = groups[t.group] || []).push(t));
    return `<option value="">— Chọn chỉ số —</option>` + Object.entries(groups).map(([g, list]) =>
      `<optgroup label="${esc(g)}">${list.map(t => `<option value="${t.code}"${t.code === code ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`).join('')
      + `<option value="__custom"${code && (code === '__custom' || code.startsWith('custom:')) ? ' selected' : ''}>Chỉ số khác…</option>`;
  }
  function flagOf(r) {
    const n = parseFloat(String(r.value ?? r.value_text ?? '').replace(',', '.'));
    const lo = r.ref_low === '' || r.ref_low == null ? null : parseFloat(String(r.ref_low).replace(',', '.'));
    const hi = r.ref_high === '' || r.ref_high == null ? null : parseFloat(String(r.ref_high).replace(',', '.'));
    if (!Number.isFinite(n) || (lo === null && hi === null)) return '';
    if (lo !== null && n < lo) return '<span class="hr-flag low">↓ Thấp</span>';
    if (hi !== null && n > hi) return '<span class="hr-flag high">↑ Cao</span>';
    return '<span class="hr-flag ok">Bình thường</span>';
  }

  function renderEditor() {
    const v = editing, ro = !canEdit(), dis = ro ? 'disabled' : '';
    const results = v.results.map(r => ({ ...r, value: r.value ?? r.value_text ?? '' }));
    v.results = results;
    $root().innerHTML = `<div class="hr-card">
      <div class="hr-head"><button class="hr-link" onclick="HR.back()">← Danh sách lần khám</button>${badge(v.status)}</div>
      ${v.status === 'returned' && v.admin_note ? `<div class="hr-alert">↩️ Ban tổ chức trả lại: ${esc(v.admin_note)}</div>` : ''}
      ${v.status === 'submitted' ? `<div class="hr-alert info">Đã gửi Ban tổ chức kiểm tra — trong lúc chờ không sửa được.</div>` : ''}
      ${v.status === 'verified' ? `<div class="hr-alert ok">✅ Ban tổ chức đã xác nhận lần khám này.</div>` : ''}
      <div class="hr-grid3">
        <label>Ngày khám<input type="date" id="hrDate" value="${esc(v.visit_date)}" ${dis}></label>
        <label>Nơi khám<input id="hrPlace" value="${esc(v.place || '')}" placeholder="VD: BV Đại học Y Dược" ${dis}></label>
        <label>Tiêu đề<input id="hrTitle" value="${esc(v.title || '')}" placeholder="VD: Khám tổng quát" ${dis}></label>
      </div>
      <label class="hr-full">Ghi chú<textarea id="hrNote" rows="2" placeholder="Triệu chứng, thuốc đang dùng, lời dặn của bác sĩ…" ${dis}>${esc(v.note || '')}</textarea></label>
    </div>

    <div class="hr-card">
      <div class="hr-sec">📎 Phiếu kết quả <span>(ảnh chụp hoặc PDF — lưu riêng tư)</span></div>
      <div class="hr-files" id="hrFiles">${v.files.map(f => `<div class="hr-file" data-id="${f.id}">
          <div class="hr-file-thumb" id="hrThumb${f.id}" onclick="HR.viewFile(${f.id})">${f.mime === 'application/pdf' ? '📄 PDF' : '⏳'}</div>
          <div class="hr-file-name">${esc(f.original_name || 'phiếu')}</div>
          ${ro ? '' : `<button class="hr-file-del" title="Xoá" onclick="HR.delFile(${f.id})">×</button>`}</div>`).join('')}
        ${ro ? '' : `<button class="hr-file-add" onclick="HR.addFiles()" ${busy ? 'disabled' : ''}><span>＋</span>Thêm phiếu</button>`}</div>
      <div class="hr-sub" id="hrFileStatus"></div>
      ${!ro && v.files.length ? (aiConsent
        ? `<div class="hr-ai-bar"><button class="hr-btn primary" onclick="HR.aiRead()" ${busy ? 'disabled' : ''}>🤖 AI đọc phiếu &amp; điền sẵn chỉ số</button>
            <span>AI chỉ điền gợi ý — bạn dò lại với phiếu trước khi gửi.</span></div>`
        : `<div class="hr-ai-bar"><span>Muốn AI đọc phiếu và điền sẵn chỉ số?</span> <button class="hr-link" onclick="HR.enableAi()">Bật AI đọc phiếu</button></div>`) : ''}
    </div>

    <div class="hr-card">
      <div class="hr-sec">🧪 Chỉ số xét nghiệm / đo cơ thể</div>
      ${!ro && results.some(r => r.source === 'ai') ? `<div class="hr-ai-note">🤖 Các dòng <b>tô vàng</b> do AI đọc từ phiếu. Hãy dò lại từng số, đơn vị và khoảng tham chiếu với phiếu gốc (bấm vào ảnh phiếu để xem lớn) rồi mới gửi.</div>` : ''}
      ${ro ? '' : `<div class="hr-quick">Thêm nhanh: ${Object.keys(QUICK_GROUPS).map(g => `<button class="hr-chip" onclick="HR.addGroup('${g}')">+ ${g}</button>`).join('')}</div>`}
      <div class="hr-table-wrap"><table class="hr-table"><thead><tr><th>Chỉ số</th><th>Kết quả</th><th>Đơn vị</th><th>Tham chiếu (thấp – cao)</th><th></th>${ro ? '' : '<th></th>'}</tr></thead>
        <tbody>${results.map((r, i) => resultRow(r, i, ro)).join('') || `<tr><td colspan="6" class="hr-empty">Chưa có chỉ số nào.</td></tr>`}</tbody></table></div>
      ${ro ? '' : `<button class="hr-btn" onclick="HR.addRow()">+ Thêm chỉ số</button>`}
      <div class="hr-sub">Khoảng tham chiếu ghi theo đúng phiếu của nơi xét nghiệm (mỗi nơi có thể khác nhau).</div>
    </div>

    <div class="hr-card">
      <div class="hr-sec">🩻 Chẩn đoán hình ảnh <span>(siêu âm, X-quang, nội soi…)</span></div>
      ${v.imaging.map((m, i) => `<div class="hr-img-row">
        <div class="hr-grid3">
          <label>Loại<select data-i="${i}" data-k="kind" ${dis}>${Object.entries(imagingKinds).map(([k, n]) => `<option value="${k}"${k === m.kind ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Vùng / cơ quan<input data-i="${i}" data-k="body_part" value="${esc(m.body_part || '')}" placeholder="VD: Ổ bụng, Tuyến giáp, Phổi" ${dis}></label>
          ${ro ? '<span></span>' : `<button class="hr-link danger" onclick="HR.delImg(${i})">Xoá</button>`}
        </div>
        <label class="hr-full">Mô tả<textarea data-i="${i}" data-k="findings" rows="3" placeholder="Chép phần mô tả trên phiếu" ${dis}>${esc(m.findings || '')}</textarea></label>
        <label class="hr-full">Kết luận<textarea data-i="${i}" data-k="conclusion" rows="2" placeholder="VD: Gan nhiễm mỡ độ 1" ${dis}>${esc(m.conclusion || '')}</textarea></label>
      </div>`).join('') || '<div class="hr-empty">Chưa có kết quả hình ảnh.</div>'}
      ${ro ? '' : `<button class="hr-btn" onclick="HR.addImg()">+ Thêm kết quả hình ảnh</button>`}
    </div>

    ${ro ? '' : `<div class="hr-actions">
      <button class="hr-btn" onclick="HR.save()">💾 Lưu nháp</button>
      <button class="hr-btn primary" onclick="HR.submit()">📤 Gửi Ban tổ chức kiểm tra</button>
      <button class="hr-link danger" onclick="HR.delVisit()">Xoá lần khám</button></div>`}
    <div class="hr-sub" id="hrMsg" style="text-align:center;"></div>`;
    bindInputs();
    v.files.filter(f => f.mime !== 'application/pdf').forEach(f => loadThumb(f.id));
  }

  function resultRow(r, i, ro) {
    const dis = ro ? 'disabled' : '';
    const custom = r.test_code && r.test_code.startsWith('custom:');
    return `<tr${!ro && r.source === 'ai' ? ' class="hr-ai-row"' : ''}>
      <td>${ro ? esc(r.test_name || testMap[r.test_code]?.name || '') : `<select data-r="${i}" data-k="test_code">${testOptions(r.test_code)}</select>
        ${custom || r.test_code === '__custom' ? `<input data-r="${i}" data-k="test_name" value="${esc(r.test_name || '')}" placeholder="Tên chỉ số" style="margin-top:4px;">` : ''}`}</td>
      <td><input data-r="${i}" data-k="value" value="${esc(r.value)}" placeholder="Kết quả" inputmode="decimal" ${dis} style="width:80px;"></td>
      <td><input data-r="${i}" data-k="unit" value="${esc(r.unit || '')}" placeholder="Đơn vị" ${dis} style="width:80px;"></td>
      <td class="hr-ref"><input data-r="${i}" data-k="ref_low" value="${esc(r.ref_low ?? '')}" placeholder="thấp" inputmode="decimal" ${dis}> – <input data-r="${i}" data-k="ref_high" value="${esc(r.ref_high ?? '')}" placeholder="cao" inputmode="decimal" ${dis}></td>
      <td data-flag="${i}">${flagOf(r)}</td>
      ${ro ? '' : `<td><button class="hr-link danger" onclick="HR.delRow(${i})">×</button></td>`}</tr>`;
  }

  function bindInputs() {
    $root().querySelectorAll('[data-r]').forEach(el => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const r = editing.results[+el.dataset.r], k = el.dataset.k;
        r[k] = el.value;
        if (k === 'test_code') {
          if (el.value === '__custom') { r.test_code = '__custom'; r.test_name = ''; }
          else if (testMap[el.value]) { r.test_name = testMap[el.value].name; if (!r.unit) r.unit = testMap[el.value].unit; }
          collect(); renderEditor(); return;
        }
        const cell = $root().querySelector(`[data-flag="${el.dataset.r}"]`);
        if (cell) cell.innerHTML = flagOf(r);
      });
    });
    $root().querySelectorAll('[data-i]').forEach(el => el.addEventListener('input', () => { editing.imaging[+el.dataset.i][el.dataset.k] = el.value; }));
    $root().querySelectorAll('[data-i][data-k="kind"]').forEach(el => el.addEventListener('change', () => { editing.imaging[+el.dataset.i].kind = el.value; }));
  }
  function collect() {
    if (!canEdit()) return;
    const g = id => document.getElementById(id);
    editing.visit_date = g('hrDate').value; editing.place = g('hrPlace').value; editing.title = g('hrTitle').value; editing.note = g('hrNote').value;
  }

  function addRow(code) {
    collect();
    const t = code && testMap[code];
    editing.results.push({ test_code: code || '', test_name: t ? t.name : '', value: '', unit: t ? t.unit : '', ref_low: '', ref_high: '' });
    renderEditor();
  }
  function addGroup(g) {
    collect();
    const have = new Set(editing.results.map(r => r.test_code));
    QUICK_GROUPS[g].filter(c => !have.has(c)).forEach(c => editing.results.push({ test_code: c, test_name: testMap[c].name, value: '', unit: testMap[c].unit, ref_low: '', ref_high: '' }));
    renderEditor();
  }
  function delRow(i) { collect(); editing.results.splice(i, 1); renderEditor(); }
  function addImg() { collect(); editing.imaging.push({ kind: 'sieu_am', body_part: '', findings: '', conclusion: '' }); renderEditor(); }
  function delImg(i) { collect(); editing.imaging.splice(i, 1); renderEditor(); }

  function payload() {
    collect();
    return {
      visit_date: editing.visit_date, place: editing.place, title: editing.title, note: editing.note,
      results: editing.results.filter(r => String(r.value).trim()).map(r => ({
        test_code: r.test_code === '__custom' ? '' : r.test_code, test_name: r.test_name, value: r.value, unit: r.unit,
        ref_low: r.ref_low, ref_high: r.ref_high, source: r.source })),
      imaging: editing.imaging,
    };
  }
  function msg(t, color) { const el = document.getElementById('hrMsg'); if (el) { el.textContent = t; el.style.color = color || ''; } }
  async function save(silent) {
    try {
      const r = await api(`/visits/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload()) });
      replaceVisit(r.visit);
      if (!silent) { editing = JSON.parse(JSON.stringify(r.visit)); renderEditor(); msg('✅ Đã lưu.', '#10b981'); }
      return true;
    } catch (e) { handleErr(e); return false; }
  }
  async function submit() {
    if (busy) { alert('Đang tải phiếu, vui lòng đợi xong.'); return; }
    if (!(await save(true))) return;
    if (!confirm('Gửi lần khám này cho Ban tổ chức kiểm tra? Sau khi gửi bạn sẽ không sửa được nữa (trừ khi BTC trả lại).')) { open(editing.id); return; }
    try { const r = await api(`/visits/${editing.id}/submit`, { method: 'POST' }); replaceVisit(r.visit); open(r.visit.id); msg('📤 Đã gửi Ban tổ chức kiểm tra.', '#10b981'); }
    catch (e) { handleErr(e); }
  }
  async function delVisit() {
    if (!confirm('Xoá lần khám này cùng các phiếu đã tải lên?')) return;
    try { await api(`/visits/${editing.id}`, { method: 'DELETE' }); visits = visits.filter(v => v.id !== editing.id); renderList(); }
    catch (e) { handleErr(e); }
  }
  function replaceVisit(v) { const i = visits.findIndex(x => x.id === v.id); if (i >= 0) visits[i] = v; else visits.unshift(v); }
  function back() { if (canEdit()) save(true).then(renderList); else renderList(); }

  // ── Phiếu đính kèm ───────────────────────────────────────────────────
  function addFiles() {
    const p = document.createElement('input');
    p.type = 'file'; p.accept = 'image/*,application/pdf'; p.multiple = true;
    p.onchange = async () => {
      const files = [...p.files]; if (!files.length) return;
      collect(); await save(true);
      busy++; const st = document.getElementById('hrFileStatus');
      let last = null;
      for (let i = 0; i < files.length; i++) {
        if (st) st.textContent = `⏳ Đang tải phiếu ${i + 1}/${files.length}...`;
        try {
          const f = await compressSheet(files[i]);
          const fd = new FormData(); fd.append('file', f, f.name || files[i].name); fd.append('kind', 'xet_nghiem');
          last = (await api(`/visits/${editing.id}/files`, { method: 'POST', body: fd })).visit;
        } catch (e) { busy--; handleErr(e); if (last) { replaceVisit(last); open(last.id); } return; }
      }
      busy--;
      if (last) { replaceVisit(last); open(last.id); }
    };
    p.click();
  }
  async function delFile(id) {
    if (!confirm('Xoá phiếu này?')) return;
    collect(); await save(true);
    try { const r = await api(`/files/${id}`, { method: 'DELETE' }); replaceVisit(r.visit); open(r.visit.id); } catch (e) { handleErr(e); }
  }
  const blobCache = {};
  async function fileBlobUrl(id) {
    if (blobCache[id]) return blobCache[id];
    const res = await fetch(`/api/health-records/file/${id}`, { headers: { 'x-user-token': token() } });
    if (!res.ok) throw new Error('Không tải được phiếu.');
    return (blobCache[id] = URL.createObjectURL(await res.blob()));
  }
  async function loadThumb(id) {
    const el = document.getElementById('hrThumb' + id);
    try { const u = await fileBlobUrl(id); if (el) el.innerHTML = `<img src="${u}" alt="Phiếu">`; }
    catch { if (el) el.textContent = '⚠️'; }
  }
  async function viewFile(id) {
    try { const u = await fileBlobUrl(id); window.open(u, '_blank'); } catch (e) { alert(e.message); }
  }

  // ── AI đọc phiếu ─────────────────────────────────────────────────────
  async function enableAi() {
    try { await api('/ai-consent', { method: 'POST', body: JSON.stringify({ ai_consent: true }) }); aiConsent = true; collect(); renderEditor(); }
    catch (e) { handleErr(e); }
  }
  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  function mergeAi(out) {
    let added = 0, filled = 0, kept = 0;
    out.results.forEach(ai => {
      const ex = editing.results.find(r => ai.test_code ? r.test_code === ai.test_code : sameName(r.test_name, ai.test_name));
      if (ex && String(ex.value ?? '').trim()) { kept++; return; }   // khách đã nhập → giữ nguyên
      const row = { test_code: ai.test_code || '__custom', test_name: ai.test_name, value: ai.value, unit: ai.unit,
        ref_low: ai.ref_low ?? '', ref_high: ai.ref_high ?? '', source: 'ai' };
      if (ex) { Object.assign(ex, row); filled++; } else { editing.results.push(row); added++; }
    });
    let imgs = 0;
    out.imaging.forEach(m => {
      if (editing.imaging.some(x => sameName(x.conclusion, m.conclusion) && sameName(x.body_part, m.body_part))) return;
      editing.imaging.push(m); imgs++;
    });
    if (out.place && !String(editing.place || '').trim()) editing.place = out.place;
    const today = new Date().toISOString().slice(0, 10);
    if (out.visit_date && (editing.visit_date === today || !editing.visit_date)) editing.visit_date = out.visit_date;
    return { added, filled, kept, imgs };
  }
  async function aiRead() {
    if (busy) return;
    collect();
    if (!(await save(true))) return;
    busy++; renderEditor();
    const st = document.getElementById('hrFileStatus');
    if (st) st.innerHTML = `🤖 AI đang đọc ${editing.files.length} phiếu… thường mất 20–60 giây, vui lòng giữ trang mở.`;
    try {
      const out = await api(`/visits/${editing.id}/extract`, { method: 'POST', body: '{}' });
      busy--;
      const r = mergeAi(out);
      renderEditor();
      const parts = [];
      if (r.added + r.filled) parts.push(`điền ${r.added + r.filled} chỉ số`);
      if (r.imgs) parts.push(`${r.imgs} kết quả hình ảnh`);
      msg(parts.length ? `🤖 AI đã ${parts.join(' và ')}${r.kept ? ` (giữ nguyên ${r.kept} chỉ số bạn đã nhập)` : ''}. Dò lại các dòng tô vàng rồi bấm Lưu nháp.`
        : '🤖 AI không đọc được chỉ số nào rõ ràng trên phiếu — bạn nhập tay giúp nhé (hoặc chụp lại phiếu rõ hơn).', '#b45309');
      document.querySelector('.hr-ai-note, .hr-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { busy--; renderEditor(); if (e.code === 'ai_consent_required') { aiConsent = false; renderEditor(); } else handleErr(e); }
  }

  async function showLog() {
    try {
      const d = await api('/access-log');
      const LABEL = { consent: 'Đồng ý lưu dữ liệu', consent_withdraw: 'Rút lại đồng ý', visit_create: 'Tạo lần khám', visit_update: 'Sửa lần khám',
        visit_submit: 'Gửi BTC kiểm tra', visit_delete: 'Xoá lần khám', file_upload: 'Tải phiếu', file_delete: 'Xoá phiếu', file_view: 'Xem phiếu',
        visit_view: 'Xem hồ sơ', visit_verify: 'Xác nhận', visit_return: 'Trả lại', visit_admin_edit: 'Chỉnh sửa', ai_extract: 'Cho AI đọc phiếu' };
      const rows = d.log.filter(l => l.actor_role === 'admin');
      alert(rows.length ? 'Ban tổ chức đã truy cập hồ sơ của bạn:\n\n' + rows.slice(0, 30).map(l =>
        `• ${l.created_at} — ${(l.first_name || 'Admin') + ' ' + (l.last_name || '')}: ${LABEL[l.action] || l.action}`).join('\n')
        : 'Chưa có ai trong Ban tổ chức mở hồ sơ của bạn.');
    } catch (e) { handleErr(e); }
  }

  async function load() {
    if (!token()) return renderNeedLogin();
    $root().innerHTML = '<div class="state-card"><div class="state-icon">⏳</div><div class="state-title">Đang tải...</div></div>';
    try {
      if (!tests.length) {
        const t = await fetch('/api/health-records/tests').then(r => r.json());
        tests = t.tests; imagingKinds = t.imaging_kinds; testMap = Object.fromEntries(tests.map(x => [x.code, x]));
      }
      const c = await api('/consent');
      if (!c.consent_at) return renderConsent();
      aiConsent = !!c.ai_consent;
      visits = (await api('/visits')).visits;
      renderList();
    } catch (e) { handleErr(e); }
  }

  window.HR = { load, relogin, agree, newVisit, open, back, addRow, addGroup, delRow, addImg, delImg, save, submit, delVisit, addFiles, delFile, viewFile, showLog, aiRead, enableAi, setTab, chart };
})();
