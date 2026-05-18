// Load .env if present (no dotenv dependency needed)
const fs0 = require('fs'), path0 = require('path');
const envPath = path0.join(__dirname, '.env');
if (fs0.existsSync(envPath)) {
  fs0.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const express   = require('express');
const bcrypt    = require('bcryptjs');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const initSqlJs = require('sql.js');

const https    = require('https');
const http     = require('http');
const { Resend } = require('resend');

const app      = express();
const PORT     = process.env.PORT || 3000;
const ADMIN_KEY   = process.env.ADMIN_KEY   || 'aiagent-admin-2025';
const SEPAY_KEY   = process.env.SEPAY_KEY   || 'ae3066fa595768259e92553aa371405a8fa814c6';
const GSHEET_ID   = process.env.GSHEET_ID   || '1TNzXmIR9Qcu_oqeNxYGFdnFxt2YN9xik4OPJOtac4nI';
const RESEND_KEY  = process.env.RESEND_API_KEY || '';
const FROM_EMAIL  = process.env.FROM_EMAIL || 'AI AGENTS CC <congdong@aiagentscc.com>';
const ADMIN_EMAIL = 'tuchinguyen.ctv@gmail.com';

const resendClient = RESEND_KEY ? new Resend(RESEND_KEY) : null;

async function sendEmail({ to, subject, html }) {
  if (!resendClient) {
    console.warn('[Email] Skipped — RESEND_API_KEY not set');
    return;
  }
  try {
    console.log(`[Email] Sending to ${to} | "${subject}"`);
    const result = await resendClient.emails.send({ from: FROM_EMAIL, to, subject, html });
    console.log(`[Email] ✅ Sent — id: ${result?.data?.id || result?.id || JSON.stringify(result)}`);
  } catch (err) {
    console.error('[Email] ❌ Error:', err.message, err?.response?.data || '');
  }
}

function emailWrap(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:24px}
    .box{background:#fff;border-radius:12px;max-width:560px;margin:0 auto;padding:40px;border:1px solid #e2e8f0}
    h1{color:#0f172a;font-size:22px;margin:0 0 16px}
    p{color:#475569;line-height:1.6;margin:0 0 12px}
    .btn{display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;margin:16px 0}
    .footer{color:#94a3b8;font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0}
    .badge{background:#e0f2fe;color:#0284c7;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:600}
    .rule{background:#f8fafc;border-left:3px solid #0ea5e9;padding:12px 16px;border-radius:0 8px 8px 0;margin:8px 0}
    .green{color:#10b981;font-weight:700}
  </style></head><body>
  <div class="box">
    <p style="color:#0ea5e9;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">AI AGENTS CC</p>
    <h1>${title}</h1>
    ${body}
    <div class="footer">AI AGENTS CC — Cộng đồng học AI Agent Việt Nam<br>aiagentscc.com</div>
  </div></body></html>`;
}

// Fetch URL với redirect support (dùng cho Google Sheet CSV export)
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// Parse một dòng CSV (xử lý quoted fields)
function parseCSVRow(line) {
  const cells = []; let inQ = false; let cell = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cell += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { cells.push(cell.trim()); cell = ''; }
    else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}
const DB_PATH  = path.join(__dirname, 'brain.db');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ── Thin wrapper: sql.js → better-sqlite3-style API ──────────
class DB {
  constructor(sqlJs) {
    this._ = fs.existsSync(DB_PATH)
      ? new sqlJs.Database(fs.readFileSync(DB_PATH))
      : new sqlJs.Database();
  }

  _save() {
    fs.writeFileSync(DB_PATH, Buffer.from(this._.export()));
  }

  exec(sql) {
    this._.run(sql);
    this._save();
    return this;
  }

  run(sql, params = []) {
    this._.run(sql, params);
    const lastInsertRowid = this._.exec('SELECT last_insert_rowid()')[0].values[0][0];
    this._save();
    return { lastInsertRowid };
  }

  get(sql, params = []) {
    const stmt = this._.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }

  all(sql, params = []) {
    const stmt = this._.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}

// ── Schema ────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name     TEXT    NOT NULL,
    last_name      TEXT    NOT NULL,
    email          TEXT    UNIQUE NOT NULL,
    password_hash  TEXT,
    google_id      TEXT,
    avatar_url     TEXT,
    level          INTEGER DEFAULT 1,
    xp             INTEGER DEFAULT 0,
    streak         INTEGER DEFAULT 0,
    status         TEXT    DEFAULT 'active',
    last_active_at TEXT,
    created_at     TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS posts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    title          TEXT    NOT NULL,
    content        TEXT    NOT NULL,
    pillar         TEXT,
    post_type      TEXT    DEFAULT 'post',
    likes_count    INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    is_pinned      INTEGER DEFAULT 0,
    created_at     TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    content    TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS challenge_days (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number  INTEGER UNIQUE NOT NULL,
    title       TEXT    NOT NULL,
    description TEXT,
    xp_reward   INTEGER DEFAULT 5
  );
  CREATE TABLE IF NOT EXISTS user_challenge_progress (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    day_number   INTEGER NOT NULL,
    completed_at TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, day_number)
  );
  CREATE TABLE IF NOT EXISTS xp_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    amount     INTEGER NOT NULL,
    source     TEXT    NOT NULL,
    note       TEXT,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    type       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    is_read    INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    token      TEXT    UNIQUE NOT NULL,
    expires_at TEXT    NOT NULL,
    used       INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS challenges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    duration    INTEGER NOT NULL DEFAULT 21,
    status      TEXT DEFAULT 'active',
    cover_color TEXT DEFAULT '#0ea5e9',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS challenge_submissions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    challenge_id INTEGER NOT NULL REFERENCES challenges(id),
    day_id       INTEGER NOT NULL REFERENCES challenge_days(id),
    content      TEXT NOT NULL,
    status       TEXT DEFAULT 'pending',
    admin_note   TEXT,
    submitted_at TEXT DEFAULT (datetime('now','localtime')),
    reviewed_at  TEXT,
    is_late      INTEGER DEFAULT 0,
    UNIQUE(user_id, day_id)
  );
  CREATE TABLE IF NOT EXISTS late_reminders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    challenge_id INTEGER NOT NULL REFERENCES challenges(id),
    day_id       INTEGER NOT NULL REFERENCES challenge_days(id),
    first_sent_at TEXT DEFAULT (datetime('now','localtime')),
    last_sent_at  TEXT DEFAULT (datetime('now','localtime')),
    sent_count   INTEGER DEFAULT 1,
    UNIQUE(user_id, day_id)
  );
  CREATE TABLE IF NOT EXISTS challenge_enrollments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    challenge_id INTEGER NOT NULL REFERENCES challenges(id),
    status       TEXT DEFAULT 'pending',
    enrolled_at  TEXT DEFAULT (datetime('now','localtime')),
    approved_at  TEXT,
    started_at   TEXT,
    UNIQUE(user_id, challenge_id)
  );
  CREATE TABLE IF NOT EXISTS site_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS products (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id        INTEGER NOT NULL REFERENCES users(id),
    title            TEXT NOT NULL,
    description      TEXT,
    long_description TEXT,
    price            INTEGER NOT NULL DEFAULT 0,
    category         TEXT DEFAULT 'other',
    cover_color      TEXT DEFAULT '#0ea5e9',
    status           TEXT DEFAULT 'published',
    sales_count      INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    buyer_id        INTEGER NOT NULL REFERENCES users(id),
    amount          INTEGER NOT NULL,
    payment_method  TEXT DEFAULT 'bank',
    status          TEXT DEFAULT 'pending',
    note            TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS courses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT,
    cover_color  TEXT DEFAULT '#6366f1',
    status       TEXT DEFAULT 'draft',
    instructor   TEXT,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS course_lessons (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL REFERENCES courses(id),
    title        TEXT NOT NULL,
    content      TEXT,
    video_url    TEXT,
    duration_min INTEGER DEFAULT 0,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
`;

// [day_number, title, description, instructions, xp_reward]
const CHALLENGE_DAYS = [
  [1,  'Kick Off: Tham Gia Meeting & Cài Công Cụ',
   'Nắm tổng quan thử thách, cài đặt đủ 3 công cụ cần thiết.',
   'Công cụ cần cài:\n1. VS Code — editor viết code\n2. Claude Desktop — AI local, kết nối MCP\n3. Antigravity — AI coding agent\n\nYêu cầu:\n- Xem recording buổi kick-off\n- Tham gia nhóm Telegram cộng đồng\n\nNộp bài:\n- Ảnh chụp màn hình đã xem video kick-off\n- Ảnh đã cài VS Code\n- Ảnh đăng ký tài khoản Claude.ai\n- Ảnh đã cài Claude Desktop\n- Ảnh đã cài Antigravity\n\n✅ Được duyệt khi: Có đủ 5 ảnh chứng minh đã cài xong 3 công cụ.',
   10],
  [2,  'Làm Landing Page Đơn Giản Bằng AI',
   'Dùng Antigravity (AI coding agent) tạo landing page HTML hoàn chỉnh từ 0, không cần biết code.',
   'Cách làm:\n- Mở Antigravity → tạo thư mục dự án mới\n- Ra lệnh cho AI viết landing page HTML hoàn chỉnh (giới thiệu sản phẩm/dịch vụ của bạn)\n- Deploy lên Netlify hoặc Vercel (miễn phí, không cần server)\n\nNộp bài:\n- Ảnh chụp màn hình landing page\n- Link truy cập được (VD: thuthach21ngay.netlify.app)\n\n✅ Được duyệt khi: Landing page mở được, có nội dung thật về sản phẩm/dịch vụ.',
   5],
  [3,  'Deploy Website Thật + Thu Lead Thật',
   'Đưa website lên domain thật, gắn form thu thập lead → dữ liệu tự chảy vào Google Sheet.',
   'Các bước:\n1. Đăng ký domain thật tại 123host.vn\n2. Trỏ domain vào Netlify/Vercel (thay đổi DNS)\n3. Gắn form thu lead bằng Google Forms hoặc Formspree\n4. Kết nối form → Google Sheet để lưu tự động\n\nNộp bài:\n- Link website thật (domain, không phải netlify.app)\n- Link trang đăng ký/form\n- Link Google Sheet đang nhận data (reviewer phải xem được)\n- Ảnh chứng minh từng bước\n\n✅ Được duyệt khi: Vào domain thật thấy website, điền form → data xuất hiện trong Google Sheet.',
   5],
  [4,  'Traffic – Lead – Money',
   'Chạy traffic thật vào website, kiểm tra toàn bộ luồng hoạt động từ đầu đến cuối.',
   'Các bước:\n1. Đăng bài lên ít nhất 3 kênh mạng xã hội (Facebook, Instagram, Threads, TikTok...)\n2. Gửi email thủ công cho 1 lead đầu tiên từ Google Sheet ngày 3\n3. Kiểm tra Google Sheet có lead thật chưa\n\nNộp bài:\n- Link website (đang chạy và nhận lead)\n- Link bài đăng Facebook (link public)\n- Link ảnh bài đăng (Google Drive)\n- Link Google Sheet lưu lead\n- Screenshot email đã gửi cho lead\n\n✅ Được duyệt khi: Có lead thật trong Google Sheet, có ít nhất 1 bài đăng public.',
   5],
  [5,  'Build Bộ Não Thứ 2 (SQLite brain.db + Brand Voice)',
   'Tạo "bộ não kỹ thuật số" — database SQLite lưu brand voice và kiến thức của bạn.',
   'Cấu trúc thư mục:\nmy-brain/\n  brain.db ← SQLite database\n  brain_score.md ← Tracking điểm mỗi ngày\n\nBảng brand_voice gồm: tone, words_to_use, words_to_avoid, target_audience, writing_example\n\nSau khi AI tạo xong:\n- Điền brand voice THẬT của bạn (không dùng data mẫu)\n- Nhờ AI đọc brain.db → viết 1 bài theo giọng bạn → lưu vào post.txt\n- Nhận xét: bài có nghe giống giọng bạn không?\n\nNộp bài:\n1. Screenshot thư mục my-brain có brain.db\n2. Screenshot bảng brand_voice đã điền đầy đủ (data thật, không phải mẫu)\n3. Nội dung file post.txt + nhận xét về độ chính xác\n\n✅ Được duyệt khi: brain.db chạy được, brand_voice có data thật, AI đã viết được bài từ database.',
   5],
  [6,  'Mở Danh Sách Chờ + Bắt Đầu 7 Ngày Đăng Bài Liên Tục',
   'Ra mắt trang waitlist + lên kế hoạch content 7 ngày + đăng bài ngày đầu tiên.',
   '⚠️ Chuỗi 7 ngày này chạy song song từ Ngày 6 đến Ngày 12. Mỗi ngày phải đăng ≥ 3 bài.\n\nBước 1: Tạo trang /dang-ky.html — form: tên, email, số điện thoại. Khi submit → lưu vào waitlist.json.\n\nBước 2: Lên kế hoạch content 7 ngày với bộ não thứ 2 → lưu vào plan.md:\nFormat: Ngày X | Ý tưởng | Hook gợi ý | CTA\n\nBước 3: Viết và đăng bài ngày 1 lên ≥ 3 kênh.\n\nNộp bài:\n- Link trang waitlist (reviewer phải điền được)\n- Link bài đăng ngày 1 (≥ 3 kênh, link public)\n- Screenshot file plan.md (7 ngày × 3 ý tưởng)\n- Screenshot brain_score.md đã cập nhật\n\n✅ Được duyệt khi: Waitlist mở được + form submit được + plan.md có 7 ngày × 3 ý tưởng.',
   5],
  [7,  'Week 1 Review Meeting',
   'Review tuần 1 cùng toàn bộ thành viên. Học cách dùng agent đọc thư mục và tự quản lý công việc.',
   'Bài tập thực hành TRONG meeting (7 hạng mục):\n1. Dùng Agent tạo toàn bộ cấu trúc thư mục bằng 1 câu lệnh duy nhất\n2. Dùng Agent điền nội dung vào README.md\n3. Dùng Agent tạo danh sách task trong tasks/\n4. Ra lệnh cho Agent đọc toàn bộ thư mục và phân tích\n5. Ra lệnh cho Agent lên lịch tuần tự động\n6. Ra lệnh cho Agent cập nhật task khi xong việc\n7. Chia sẻ 3 câu hỏi cốt lõi: Use case là gì? Agent làm được gì? Tiết kiệm bao nhiêu thời gian?\n\nNộp bài: Screenshot từng bước + link recording nếu không tham gia live.\n\n✅ Được duyệt khi: Có đủ 7 screenshot + chứng minh đã tham gia/xem recording.',
   10],
  [8,  'Relax Day (Nghỉ Lễ 30/4–1/5)',
   'Không có task bắt buộc. Nghỉ ngơi, tái nạp năng lượng.',
   'Ngày nghỉ — không có yêu cầu bắt buộc.\n\nGợi ý:\n- Nghiên cứu thêm về AI agents, xem video về MCP hoặc Claude\n- Xem lại ghi chú tuần 1, ôn lại những gì đã học được\n- Hoặc đơn giản là nghỉ ngơi — bạn xứng đáng!\n\nNộp bài:\n- Ảnh hoặc note bất kỳ — suy nghĩ về hành trình 7 ngày đầu, điều thú vị học được, hoặc ảnh bạn đang nghỉ ngơi\n\n✅ Được duyệt khi: Nộp bất cứ nội dung nào — ảnh, note, suy nghĩ về hành trình 7 ngày đầu.',
   3],
  [9,  'Build Chatbot Bán Hàng 24/7',
   'Gắn chatbot có kịch bản bán hàng thật vào website. Khách vào là chatbot chào và tư vấn.',
   'SOP 6 bước:\n1. Tạo kho dữ liệu: /data/products, /data/faq, /data/customers, /data/objections\n2. Copy brain.db vào thư mục website\n3. Nhờ AI viết kịch bản bán hàng → lưu vào sales_script.md (câu chào, 10 FAQ, câu chốt đơn, hướng vào form)\n4. Gắn chatbot vào website (góc dưới phải màn hình)\n5. Test 3 tình huống: hỏi giá / hỏi phù hợp không / "để tôi nghĩ thêm"\n6. Đăng bài thông báo lên ≥ 2 kênh + cập nhật brain_score.md\n\nNộp bài:\n- Link website có chatbot (reviewer vào và chat thử)\n- Link bài đăng (≥ 2 kênh, link public)\n- Screenshot 4 thư mục /data (phải có data THẬT)\n- Screenshot brain_score.md đã cập nhật\n\n✅ Được duyệt khi: Chatbot trả lời được ≥ 3 câu hỏi cơ bản, có câu chốt đơn, /data có data thật.',
   5],
  [10, 'Nhận Tiền Tự Động + CRM + Admin Panel',
   'Hoàn thiện hệ thống bán hàng — nhận tiền qua QR tự động, quản lý đơn hàng và khách hàng.',
   'SOP 7 bước:\n1. Đăng ký Sepay (sepay.vn) — miễn phí, kết nối ngân hàng\n2. Kết nối Sepay vào website (đọc docs.sepay.vn)\n3. Build CRM trong brain.db: bảng products, customers, orders\n4. Build Admin Panel tại /admin — 3 tab: Sản phẩm, Khách hàng, Đơn hàng\n5. Tạo sản phẩm số nếu chưa có (ebook, template, checklist)\n6. Test nhận tiền thật: tự chuyển 2.000đ cho chính mình\n7. Viết tổng kết bộ não thứ 2 sau 7 ngày → brain_review.md\n\nNộp bài:\n- Link trang thanh toán (reviewer thấy QR, quét được)\n- Link trang /admin (đủ 3 tab có data thật)\n- Screenshot nhận tiền 2.000đ thành công\n- Link bài đăng (≥ 2 kênh)\n\n✅ Được duyệt khi: Sepay kết nối thật, /admin có 3 tab, đã test nhận tiền thật.',
   5],
  [11, 'Email Marketing Tự Động (Resend.com)',
   'Biến danh sách khách hàng thành cỗ máy chăm sóc tự động — khách điền form → tự nhận 3 email.',
   'SOP 6 bước:\n1. Thêm trường email vào form và CRM (nếu chưa có)\n2. Đăng ký Resend.com (miễn phí) → lấy API Key\n3. Kết nối Resend vào website\n4. Viết 3 email tự động:\n   - Email 1: Chào mừng — gửi ngay khi khách điền form\n   - Email 2: Nurture — gửi ngày +2 (insight có giá trị, không bán hàng)\n   - Email 3: Chốt — gửi ngày +3 (giới thiệu sản phẩm + CTA)\n5. Gắn email sequence + chế độ test (email chứa "+test" → gửi cả 3 ngay)\n6. Thêm email xác nhận đơn hàng tự động\n\nTest: Điền form với ten+test@gmail.com → nhận cả 3 email ngay.\n\nNộp bài:\n- Screenshot hộp thư (cả 3 email sau khi test)\n- Screenshot email xác nhận đơn\n- Screenshot email_sequence.md\n- Link bài đăng (≥ 2 kênh)\n\n✅ Được duyệt khi: Nhận được cả 3 email trong hộp thư thật sau khi test +test.',
   5],
  [12, 'Week 2 Review + Chuẩn Bị Deploy',
   'Nhìn lại 2 tuần, viết thật, chuẩn bị sẵn sàng đưa project lên server thật.',
   'Ngày hôm nay KHÔNG build thêm gì — đây là ngày nhìn lại, viết thật, và chuẩn bị.\n\nSOP 4 bước:\n1. Tự viết week2_review.md (KHÔNG nhờ AI viết thay) — 5 câu hỏi:\n   - Tôi đã build được gì sau 12 ngày?\n   - Số liệu thật: bao nhiêu lead, bao nhiêu bài đăng, đã có đơn chưa?\n   - Điều gì khó nhất tôi đã vượt qua?\n   - Điều gì tôi thấy chưa tốt?\n   - Nếu bắt đầu lại, tôi sẽ làm khác gì?\n2. AI biến review thành bài đăng (week2_post.md) — giữ đúng giọng thật\n3. Kiểm tra dự án sẵn sàng deploy (deploy_checklist.md)\n4. Đăng ≥ 3 bài hôm nay (ngày cuối chuỗi 7 ngày)\n\nNộp bài:\n- Link bài cảm nhận 2 tuần (≥ 2 kênh)\n- Screenshot week2_review.md (5 câu trả lời thật tự viết)\n- Screenshot deploy_checklist.md đã tick đủ\n\n✅ Được duyệt khi: Bài cảm nhận có tiếng nói thật của bạn (không phải AI viết hoàn toàn).',
   10],
  [13, 'Build AI Agent (Goclaw) trên VPS',
   'Thiết lập AI Agent hoàn chỉnh để hỗ trợ công việc + hỗ trợ mọi người trong group Telegram.',
   'Tool: goclaw — open source AI agent framework\nRepo: github.com/nextlevelbuilder/goclaw\n\nPrompt mẫu paste vào AI coding agent:\n"Tôi muốn clone repo goclaw từ https://github.com/nextlevelbuilder/goclaw về và chạy trên VPS. GitHub để deploy bằng GitHub Actions là: [LINK GITHUB]. Đọc repo goclaw chi tiết và lên kế hoạch cài đặt theo thông tin VPS bên dưới. Domain [TÊN DOMAIN] đã được trỏ tới IP VPS rồi. Đảm bảo phân tích sâu để tôi chỉ cần vào domain là dùng được goclaw.\nTHÔNG TIN VPS: [Điền thông tin VPS — IP, OS, RAM, CPU...]"\n\nNộp bài:\n- Screenshot goclaw đang chạy trên domain thật (URL hiển thị rõ trên thanh địa chỉ)\n- Screenshot terminal hoặc dashboard cho thấy service đang active\n- Theo hướng dẫn bổ sung được chia sẻ trong meeting\n\n✅ Được duyệt khi: Vào domain thấy goclaw hoạt động, agent phản hồi được lệnh cơ bản.',
   10],
  [14, 'Website Lên VPS + Trao Cánh Tay Cho Agent (MCP)',
   'Deploy website lên VPS Linux thật + trang bị cho AI Agent khả năng thao tác server qua MCP.',
   'MCP (Model Context Protocol) cho phép AI agent không chỉ trả lời — mà còn thực sự thao tác được: đọc/ghi file, SSH vào server, chạy commands, gọi API...\n\nKết quả: Agent của bạn từ "biết nói" trở thành "biết làm".\n\nHướng dẫn chi tiết: taip.io/day14-vps-mcp.html (chỉ cho thành viên)\n\n⚠️ Đừng share link hướng dẫn ra nhóm hay cho người ngoài thử thách.\n\nNộp bài:\n- Screenshot VPS đang chạy website thật (domain hiển thị rõ)\n- Screenshot Claude Desktop đã kết nối MCP (list tools hiện)\n- Screenshot demo agent thực hiện 1 thao tác thật qua MCP (tạo file, đọc log, hoặc tương tự)\n\n✅ Được duyệt khi: Website chạy trên VPS với domain thật, MCP connected, agent thao tác được ít nhất 1 việc thật trên server.',
   5],
  [15, 'Agent Trở Thành Cộng Sự Tức Thì',
   'Cho agent việc cụ thể, giọng riêng, và thói quen chủ động. Lần đầu agent tự Telegram khi có đơn mới.',
   'Cách làm (~2-3 giờ):\n1. AI coding agent viết MCP function + MD files\n2. Upload lên VPS\n3. Bật Heartbeat qua Dashboard (không cần SSH)\n\nAgent sẽ tự động:\n- Telegram khi có đơn hàng mới\n- Telegram khi có form waitlist mới\n- Mỗi sáng: tổng kết hoạt động đêm trước\n\nHướng dẫn: taip.io/day15-agent-brain.html (chỉ cho thành viên)\n\nNộp bài:\n- Screenshot agent đang chạy trên VPS (dashboard hoặc terminal)\n- Screenshot Telegram notification thật (đơn hàng hoặc form mới)\n- Screenshot báo cáo sáng tự động (nếu đã test qua đêm)\n\n✅ Được duyệt khi: Agent gửi được ít nhất 1 Telegram notification thật từ event thực tế (đơn hàng hoặc form submission).',
   5],
  [16, 'Tự Tay Tạo Skill Cho Claude',
   'Biến tri thức thành tài sản số có thể tái sử dụng vĩnh viễn — tự tạo Claude Skill đầu tiên.',
   '5 cấp độ Claude Skills:\nCấp 1: SKILL.md — tác vụ đơn giản, không cần file phụ\nCấp 2: SKILL.md + assets/ — cần template, file mẫu\nCấp 3: SKILL.md + scripts/ — cần code chạy được (Python, FFmpeg...)\nCấp 4: SKILL.md + references/ — cần kiến thức sâu (pháp lý, kỹ thuật...)\nCấp 5: Đầy đủ tất cả — tác vụ phức tạp tổng hợp\n\nNhiệm vụ:\n1. Làm quiz 10 câu trong hướng dẫn (mỗi câu đúng = +2 XP)\n2. Chọn 1 ý tưởng → agent coding tạo skill → test ở 2 nơi khác nhau\n\nHướng dẫn: taip.io/day16-tu-tao-skill.html (chỉ cho thành viên)\n\nNộp bài:\n- Screenshot SKILL.md đã tạo (tên skill + nội dung hướng dẫn)\n- Screenshot kết quả test lần 1 (project hoặc context đầu tiên)\n- Screenshot kết quả test lần 2 (project hoặc context khác)\n- Bonus: Ảnh kết quả quiz 10 câu\n\n✅ Được duyệt khi: Skill tạo được, chạy đúng ở 2 context khác nhau, output có ích thật sự.',
   5],
  [17, 'Skill Sản Xuất Content + Auto-Post Facebook',
   'Agent tự gen full content (ảnh đẹp + văn bản) và tự đăng lên Facebook Page mỗi sáng 9h.',
   '2 Mode:\n- Mode 1 — Content Free: Agent gen ý tưởng 9h sáng → Telegram bạn duyệt → tự đăng\n- Mode 2 — Creative Ads: Gen 3 bộ ảnh + copy để paste vào Ads Manager\n\n14 bước trong guide:\n1. Lấy OpenAI API key\n2. Setup project Facebook Developer\n3. Lấy Permanent Page Token ⚠️ (phần khó nhất)\n4. Test token với Token Debugger\n5-14. Build skill 2 mode, setup cron 9h sáng, test, monitoring\n\nKết quả: Dậy sáng thấy Facebook Page đã có bài đăng đầy đủ ảnh + văn bản — bạn không làm gì.\n\nHướng dẫn: taip.io/day17-skill-creative-fb.html (chỉ cho thành viên)\n\nNộp bài:\n- Screenshot Facebook Page có bài vừa được đăng tự động (timestamp tự động, không phải tay)\n- Screenshot Telegram nhận thông báo duyệt bài (Mode 1) hoặc 3 bộ creative đã tạo (Mode 2)\n- Screenshot cron job đang chạy hoặc scheduler đã cài\n\n✅ Được duyệt khi: Facebook Page có ít nhất 1 bài được đăng tự động bởi agent, có timestamp chứng minh không đăng tay.',
   5],
  [18, 'Skill Sản Xuất Video AI Trên Higgsfield',
   'Tạo video AI với Higgsfield (Stream 4.5 sinh ảnh + Kling 2.6/3.0 animate). Tạm dừng đến 04/05/2026.',
   '⏸ TẠM DỪNG — Tiếp tục 04/05/2026. Timer đóng băng, không bị tính trễ.\n\n1 tool duy nhất: Higgsfield AI — vừa sinh ảnh vừa animate.\n\nChọn 1 trong 2 hướng:\nA. Sản phẩm/dịch vụ đang kinh doanh — gen video quảng bá đăng Reels/TikTok/FB Page\nB. Video vui tặng bạn bè — sinh nhật, kỷ niệm (áp lực thấp, tập trung học workflow)\n\nWorkflow 9 bước:\n1. Chọn chủ đề A hoặc B\n2. Dùng ChatGPT viết kịch bản\n3. Tạo ảnh với Stream 4.5 trong Higgsfield Image\n4. Mặc đồ cho model (nếu cần)\n5. Animate với Kling 2.6 hoặc 3.0\n6. Multishot — nối nhiều shot tự động\n7. Edit ghép trong CapCut\n8. Build skill tao-video-ai\n9. Tích hợp auto-post (mở rộng pipeline Day 17)\n\nNguyên tắc: "Ra ảnh ưng cái nào lụm cái đó, đừng mất công sửa hoài"\n\nNộp bài:\n- Link video AI đã tạo (Reels, TikTok, YouTube Shorts, hoặc Google Drive)\n- Screenshot quy trình Higgsfield (ít nhất bước sinh ảnh + bước animate)\n- Mô tả ngắn: chọn hướng A hay B, kết quả thế nào\n\n✅ Được duyệt khi: Có video thật được tạo từ Higgsfield, độ dài ≥ 5 giây, đã đăng lên ít nhất 1 kênh hoặc chia sẻ link Google Drive.',
   5],
  [19, 'Agent Logging & Monitoring',
   'Thêm logging và monitoring cho Agent — track được usage, errors, và performance.',
   'SOP 5 bước:\n1. Thêm logging vào agent: mỗi request/response ghi vào logs/agent.log với timestamp\n2. Phân loại log: INFO (request thường), WARN (chậm > 3s), ERROR (thất bại) + lưu context đầy đủ\n3. Build dashboard đơn giản tại /admin/logs — xem 50 log gần nhất, lọc theo loại\n4. Cấu hình alert: nếu ≥ 3 ERROR trong 10 phút → Telegram thông báo ngay\n5. Tạo báo cáo tự động hàng ngày: tổng requests, tỷ lệ lỗi, thời gian phản hồi trung bình\n\nNộp bài:\n- Screenshot /admin/logs đang hiển thị log thật (có dữ liệu thật)\n- Screenshot Telegram alert khi có lỗi (test bằng cách trigger lỗi cố ý)\n- Screenshot báo cáo hàng ngày của agent (hoặc preview dashboard)\n- Mô tả ngắn: agent đang log những gì, alert khi nào\n\n✅ Được duyệt khi: Logs ghi được ít nhất 10 entries thật, có ≥ 1 alert được gửi qua Telegram khi test lỗi.',
   5],
  [20, 'Optimize & Scale',
   'Tối ưu chi phí API, caching responses, xử lý concurrent requests.',
   'SOP 6 bước:\n1. Audit chi phí: xem lại logs ngày 19, tính token usage và cost mỗi ngày\n2. Thêm response cache: câu hỏi đã trả lời → lưu cache 1 giờ (Redis hoặc file JSON)\n3. Xử lý concurrent: queue system đơn giản, tránh gọi API trùng lặp\n4. Rate limiting: tối đa 10 requests/user/phút để tránh lạm dụng\n5. Optimize prompt: cắt context thừa, rút ngắn system prompt\n6. Load test: gửi 50 requests cùng lúc, đo thời gian phản hồi trước và sau\n\nNộp bài:\n- Screenshot chi phí API trước và sau optimize (so sánh cụ thể)\n- Screenshot cache đang hoạt động (cache hit count > 0)\n- Kết quả load test: response time với nhiều requests cùng lúc\n- Mô tả: đã tối ưu được bao nhiêu % chi phí hoặc thời gian phản hồi\n\n✅ Được duyệt khi: Cache đang hoạt động với ít nhất 1 cache hit thật, thể hiện được số liệu cải thiện cụ thể.',
   5],
  [21, 'Demo Cuối Khoá & Tổng Kết',
   'Trình bày Agent hoàn chỉnh của bạn — chia sẻ bài học, kết quả, kế hoạch tiếp theo.',
   'Chuẩn bị bài demo (làm trước meeting 30-60 phút):\n1. Chạy thử toàn bộ hệ thống lần cuối — đảm bảo không có lỗi\n2. Chuẩn bị số liệu thật: bao nhiêu đơn, bao nhiêu lead, tiết kiệm bao nhiêu giờ/tuần\n3. Slide hoặc demo live: agent làm được gì (chọn 3-5 tính năng nổi bật nhất)\n4. Chuẩn bị 3 bài học quan trọng nhất sau 21 ngày\n5. Chuẩn bị kế hoạch tiếp theo: bạn sẽ làm gì với agent này sau khoá học?\n\nNộp bài:\n- Link recording demo (YouTube, Google Drive, hoặc Loom)\n- Link sản phẩm/website agent đang chạy thật\n- Số liệu kết quả cụ thể (dù nhỏ): đơn hàng, lead, thời gian tiết kiệm được\n- Cảm nhận cá nhân: điều gì thay đổi nhất sau 21 ngày\n\n✅ Được duyệt khi: Có demo agent thật đang chạy (không chỉ là code), chia sẻ ≥ 1 số liệu kết quả cụ thể, và cảm nhận thật (không phải AI viết hoàn toàn).',
   10],
];

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  const SQL = await initSqlJs();
  const db  = new DB(SQL);

  db.exec(SCHEMA);

  // Migrate challenge_days: add challenge_id + instructions if missing
  const cdCols = db.all('PRAGMA table_info(challenge_days)').map(c => c.name);
  if (!cdCols.includes('challenge_id')) {
    db.exec(`CREATE TABLE challenge_days_v2 (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id   INTEGER NOT NULL DEFAULT 1,
      day_number     INTEGER NOT NULL,
      title          TEXT    NOT NULL,
      description    TEXT,
      instructions   TEXT,
      xp_reward      INTEGER DEFAULT 5,
      duration_hours INTEGER DEFAULT 24,
      UNIQUE(challenge_id, day_number)
    )`);
    const oldDays = db.all('SELECT * FROM challenge_days');
    oldDays.forEach(r => db.run(
      'INSERT INTO challenge_days_v2 (id, challenge_id, day_number, title, description, xp_reward) VALUES (?,1,?,?,?,?)',
      [r.id, r.day_number, r.title, r.description, r.xp_reward]
    ));
    db.exec('DROP TABLE challenge_days');
    db.exec('ALTER TABLE challenge_days_v2 RENAME TO challenge_days');
    console.log('  Migrated challenge_days (added challenge_id + instructions).');
  } else if (!cdCols.includes('instructions')) {
    db.exec('ALTER TABLE challenge_days ADD COLUMN instructions TEXT');
  }
  // Migrate duration_hours regardless of which branch above ran
  const cdCols2 = db.all('PRAGMA table_info(challenge_days)').map(c => c.name);
  if (!cdCols2.includes('duration_hours')) {
    db.exec('ALTER TABLE challenge_days ADD COLUMN duration_hours INTEGER DEFAULT 24');
    console.log('  Migrated challenge_days: added duration_hours.');
  }
  const cdCols3 = db.all('PRAGMA table_info(challenge_days)').map(c => c.name);
  if (!cdCols3.includes('submission_deadline')) {
    db.exec('ALTER TABLE challenge_days ADD COLUMN submission_deadline TEXT');
    console.log('  Migrated challenge_days: added submission_deadline.');
  }
  const cdCols4 = db.all('PRAGMA table_info(challenge_days)').map(c => c.name);
  if (!cdCols4.includes('intro')) {
    db.exec('ALTER TABLE challenge_days ADD COLUMN intro TEXT');
    console.log('  Migrated challenge_days: added intro.');
  }

  // Migrate comments: add parent_id for nested replies
  const cmtCols = db.all('PRAGMA table_info(comments)').map(c => c.name);
  if (!cmtCols.includes('parent_id')) {
    db.exec('ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id)');
    console.log('  Migrated comments: added parent_id.');
  }

  // Migrate orders: add email-sent flags for drip campaigns
  const ordCols = db.all('PRAGMA table_info(orders)').map(c => c.name);
  if (!ordCols.includes('mail_15m')) {
    db.exec('ALTER TABLE orders ADD COLUMN mail_15m INTEGER DEFAULT 0');
    db.exec('ALTER TABLE orders ADD COLUMN mail_1d  INTEGER DEFAULT 0');
    db.exec('ALTER TABLE orders ADD COLUMN mail_2d  INTEGER DEFAULT 0');
    db.exec('ALTER TABLE orders ADD COLUMN mail_4d  INTEGER DEFAULT 0');
    console.log('  Migrated orders: added email drip flag columns.');
  }

  // Migrate challenge_submissions: add is_late flag
  const subCols = db.all('PRAGMA table_info(challenge_submissions)').map(c => c.name);
  if (!subCols.includes('is_late')) {
    db.exec('ALTER TABLE challenge_submissions ADD COLUMN is_late INTEGER DEFAULT 0');
    console.log('  Migrated challenge_submissions: added is_late.');
  }

  // Migrate notifications: add title, link, sent_by_admin
  const notifCols = db.all('PRAGMA table_info(notifications)').map(c => c.name);
  if (!notifCols.includes('title')) {
    db.exec('ALTER TABLE notifications ADD COLUMN title TEXT');
    console.log('  Migrated notifications: added title.');
  }
  if (!notifCols.includes('link')) {
    db.exec('ALTER TABLE notifications ADD COLUMN link TEXT');
    console.log('  Migrated notifications: added link.');
  }
  if (!notifCols.includes('sent_by_admin')) {
    db.exec('ALTER TABLE notifications ADD COLUMN sent_by_admin INTEGER DEFAULT 0');
    console.log('  Migrated notifications: added sent_by_admin.');
  }

  const dayCount = db.get('SELECT COUNT(*) AS n FROM challenge_days').n;
  if (dayCount === 0) {
    CHALLENGE_DAYS.forEach(([num, title, desc, instructions, xp]) =>
      db.run(
        'INSERT INTO challenge_days (challenge_id, day_number, title, description, instructions, xp_reward) VALUES (1,?,?,?,?,?)',
        [num, title, desc, instructions, xp]
      )
    );
    console.log('  Seeded 21 challenge days.');
  } else {
    // One-time content migration: overwrite placeholder seed data with real content
    const day1 = db.get('SELECT title FROM challenge_days WHERE day_number = 1 LIMIT 1');
    if (day1 && day1.title === 'Giới thiệu bản thân') {
      CHALLENGE_DAYS.forEach(([num, title, desc, instructions, xp]) =>
        db.run(
          'UPDATE challenge_days SET title = ?, description = ?, instructions = ?, xp_reward = ? WHERE day_number = ?',
          [title, desc, instructions, xp, num]
        )
      );
      console.log('  One-time content migration: updated all 21 days with real content.');
    }
  }

  // Migration: update days 13-21 with complete Nộp bài + ✅ format
  const day19check = db.get('SELECT instructions FROM challenge_days WHERE day_number = 19 LIMIT 1');
  const needsFormatUpdate = day19check && day19check.instructions &&
    day19check.instructions.includes('chưa unlock');
  if (needsFormatUpdate) {
    [13, 14, 15, 16, 17, 18, 19, 20, 21].forEach(num => {
      const d = CHALLENGE_DAYS.find(c => c[0] === num);
      if (d) db.run('UPDATE challenge_days SET title=?,description=?,instructions=?,xp_reward=? WHERE day_number=?', [d[1], d[2], d[3], d[4], num]);
    });
    console.log('  Updated challenge days 13-21: added Nộp bài + ✅ Được duyệt khi sections.');
  }

  // Seed default site settings
  const defaultSettings = [
    ['announcement_enabled', '0'],
    ['announcement_text',    ''],
    ['announcement_icon',    '📢'],
  ];
  defaultSettings.forEach(([key, value]) => {
    const existing = db.get('SELECT key FROM site_settings WHERE key = ?', [key]);
    if (!existing) db.run('INSERT INTO site_settings (key, value) VALUES (?,?)', [key, value]);
  });

  // Seed sample products if empty
  const prodCount = db.get('SELECT COUNT(*) AS n FROM products').n;
  if (prodCount === 0) {
    const adminUser = db.get('SELECT id FROM users LIMIT 1');
    if (adminUser) {
      const sampleProducts = [
        [adminUser.id, 'Bộ Prompt ChatGPT Bán Hàng 2025', 'Tập hợp 50+ prompt đã kiểm chứng giúp viết copy bán hàng, email marketing và content mạng xã hội cực nhanh.', '## Nội dung bộ prompt\n\n- 20 prompt viết caption Facebook/Instagram\n- 15 prompt viết email marketing\n- 10 prompt tạo kịch bản video TikTok\n- 5 prompt phân tích đối thủ\n\n**Phù hợp cho:** Người kinh doanh online, marketer, content creator\n\n**Cách dùng:** Copy prompt → dán vào ChatGPT → chỉnh thông tin sản phẩm → dùng ngay', 199000, 'prompt', '#f59e0b'],
        [adminUser.id, 'Template Slide Pitch AI Agent', 'Bộ slide PowerPoint/Canva chuyên nghiệp để trình bày dự án AI Agent cho khách hàng hoặc nhà đầu tư.', '## Bao gồm\n\n- 30 slide thiết kế sẵn (Canva + PPTX)\n- Hướng dẫn điền nội dung\n- 3 màu theme: Dark, Light, Gradient\n\n**Định dạng:** Canva Template + File PPTX editable', 149000, 'agent', '#8b5cf6'],
        [adminUser.id, 'Ebook: Xây Dựng AI Workflow Tự Động', 'Hướng dẫn từng bước tạo workflow AI tự động hóa công việc hàng ngày — không cần biết code.', '## Nội dung 120 trang\n\n**Chương 1:** Tư duy về tự động hóa\n**Chương 2:** Các công cụ AI phổ biến (Make, Zapier, n8n)\n**Chương 3:** 10 workflow mẫu có thể dùng ngay\n**Chương 4:** Kết hợp AI + CRM\n**Chương 5:** Scale hệ thống', 89000, 'ebook', '#10b981'],
        [adminUser.id, 'Script Python Tự Động Đăng Bài Facebook', 'Tool Python tự động đăng bài lên Facebook Page theo lịch, hỗ trợ thêm ảnh, hashtag và lên lịch đăng.', '## Tính năng\n\n- Đăng bài theo lịch (hàng ngày, hàng tuần)\n- Hỗ trợ text + ảnh\n- Tự động thêm hashtag\n- Log hoạt động\n- Retry khi lỗi\n\n**Yêu cầu:** Python 3.10+, Facebook Developer Account', 249000, 'tool', '#3b82f6'],
        [adminUser.id, 'Mini Course: Prompt Engineering Nâng Cao', 'Khóa học 6 buổi video về kỹ thuật viết prompt cho GPT-4, Claude và Gemini — từ cơ bản đến nâng cao.', '## Chương trình học\n\n**Buổi 1:** Nền tảng Prompt Engineering\n**Buổi 2:** Chain-of-Thought & Few-shot\n**Buổi 3:** Prompt cho phân tích dữ liệu\n**Buổi 4:** Prompt cho sáng tạo nội dung\n**Buổi 5:** Tối ưu hóa và đánh giá\n**Buổi 6:** Dự án thực hành\n\n**Thời lượng:** ~8 giờ video + tài liệu', 399000, 'course', '#ec4899'],
      ];
      sampleProducts.forEach(([sid, title, desc, longDesc, price, cat, color]) => {
        db.run(
          'INSERT INTO products (seller_id, title, description, long_description, price, category, cover_color) VALUES (?,?,?,?,?,?,?)',
          [sid, title, desc, longDesc, price, cat, color]
        );
      });
      console.log('  Seeded 5 sample products.');
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  function addXP(userId, amount, source, note = null) {
    db.run('UPDATE users SET xp = xp + ? WHERE id = ?', [amount, userId]);
    db.run(
      'INSERT INTO xp_log (user_id, amount, source, note) VALUES (?,?,?,?)',
      [userId, amount, source, note]
    );
  }

  // ── Admin middleware ───────────────────────────────────────
  function requireAdmin(req, res, next) {
    if (req.headers['x-admin-key'] !== ADMIN_KEY)
      return res.status(401).json({ error: 'Unauthorized' });
    next();
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC ROUTES
  // ══════════════════════════════════════════════════════════

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: 'brain.db' }));

  // Test email (admin only)
  app.get('/api/admin/test-email', requireAdmin, async (req, res) => {
    const to = req.query.to || ADMIN_EMAIL;
    await sendEmail({
      to,
      subject: '🧪 Test email từ AI AGENTS CC',
      html: emailWrap('Email test thành công!', `
        <p>Email system đang hoạt động bình thường.</p>
        <p>From: <strong>${FROM_EMAIL}</strong></p>
        <p>Resend key: <strong>${RESEND_KEY ? '✅ Đã cấu hình' : '❌ Chưa cấu hình'}</strong></p>
      `)
    });
    res.json({ ok: true, sent_to: to, resend_active: !!resendClient });
  });

  // Public site settings
  app.get('/api/settings', (_req, res) => {
    const rows = db.all('SELECT key, value FROM site_settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  });

  // Public courses list
  app.get('/api/courses', (_req, res) => {
    const courses = db.all(`
      SELECT c.id, c.title, c.description, c.cover_color, c.status,
             c.instructor, c.order_num, c.created_at,
             COUNT(cl.id) AS lesson_count
      FROM courses c
      LEFT JOIN course_lessons cl ON cl.course_id = c.id
      WHERE c.status = 'published'
      GROUP BY c.id
      ORDER BY c.order_num ASC, c.created_at DESC
    `);
    const total_lessons = db.get('SELECT COUNT(*) AS n FROM course_lessons cl JOIN courses c ON c.id = cl.course_id WHERE c.status = ?', ['published']).n;
    res.json({ courses, total_lessons });
  });

  // Course detail with lessons
  app.get('/api/courses/:id', (req, res) => {
    const course = db.get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    const lessons = db.all(
      'SELECT id, title, content, video_url, duration_min, order_num FROM course_lessons WHERE course_id = ? ORDER BY order_num ASC, id ASC',
      [req.params.id]
    );
    res.json({ course, lessons });
  });

  // Register
  app.post('/api/auth/register', (req, res) => {
    const { first_name, last_name, email, password } = req.body;

    if (!first_name || !last_name || !email || !password)
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin.' });
    if (!/\S+@\S+\.\S+/.test(email))
      return res.status(400).json({ error: 'Email không hợp lệ.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 8 ký tự.' });

    const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing)
      return res.status(409).json({ error: 'Email này đã được đăng ký.' });

    const hash   = bcrypt.hashSync(password, 10);
    const result = db.run(
      'INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?,?,?,?)',
      [first_name, last_name, email, hash]
    );

    const userId = result.lastInsertRowid;
    addXP(userId, 10, 'register', 'Chào mừng thành viên mới');

    const user = db.get(
      'SELECT id, first_name, last_name, email, level, xp, created_at FROM users WHERE id = ?',
      [userId]
    );
    res.status(201).json({ success: true, user });

    // Welcome email (fire-and-forget after response)
    sendEmail({
      to: email,
      subject: '🎉 Chào mừng bạn đến với AI AGENTS CC!',
      html: emailWrap('Chào mừng đến với cộng đồng!', `
        <p>Xin chào <strong>${first_name} ${last_name}</strong>,</p>
        <p>Bạn đã đăng ký thành công tài khoản tại <strong>AI AGENTS CC</strong> — cộng đồng học AI Agent hàng đầu Việt Nam.</p>
        <p>Với tài khoản này, bạn có thể:</p>
        <ul style="color:#475569;line-height:2">
          <li>📝 Chia sẻ bài viết và học hỏi từ cộng đồng</li>
          <li>🏆 Tham gia Thử Thách 21 Ngày AI Agent</li>
          <li>🛒 Mua sắm sản phẩm số từ các thành viên</li>
          <li>📚 Truy cập khoá học và tài liệu độc quyền</li>
        </ul>
        <a class="btn" href="https://aiagentscc.com/feed.html">Vào Bảng Tin Ngay</a>
        <p>Nếu có bất kỳ câu hỏi nào, hãy đăng lên cộng đồng — chúng tôi luôn sẵn sàng hỗ trợ!</p>
      `)
    });
  });

  // Login
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Vui lòng nhập email và mật khẩu.' });

    const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !bcrypt.compareSync(password, user.password_hash || ''))
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
    if (user.status !== 'active')
      return res.status(403).json({ error: 'Tài khoản này đã bị khoá.' });

    db.run("UPDATE users SET last_active_at = datetime('now','localtime') WHERE id = ?", [user.id]);
    res.json({
      success: true,
      user: { id: user.id, first_name: user.first_name, last_name: user.last_name,
              email: user.email, level: user.level, xp: user.xp },
    });
  });

  // Google OAuth
  app.post('/api/auth/google', async (req, res) => {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Thiếu access_token.' });

    let gUser;
    try {
      const gRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!gRes.ok) return res.status(401).json({ error: 'Token Google không hợp lệ.' });
      gUser = await gRes.json();
    } catch (err) {
      return res.status(502).json({ error: 'Không thể xác thực với Google.' });
    }

    if (!gUser.email_verified) return res.status(401).json({ error: 'Email Google chưa xác minh.' });

    const { sub: google_id, email, given_name, family_name, picture } = gUser;
    const first_name = given_name || (gUser.name || '').split(' ').pop() || 'Thành viên';
    const last_name  = family_name || (gUser.name || '').split(' ').slice(0, -1).join(' ') || '';

    let user = db.get('SELECT * FROM users WHERE google_id = ?', [google_id]);

    if (!user) {
      user = db.get('SELECT * FROM users WHERE email = ?', [email]);
      if (user) {
        // Liên kết Google vào tài khoản email đã có
        db.run('UPDATE users SET google_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?',
          [google_id, picture, user.id]);
        user = db.get('SELECT * FROM users WHERE id = ?', [user.id]);
      } else {
        // Tạo tài khoản mới qua Google
        const result = db.run(
          'INSERT INTO users (first_name, last_name, email, google_id, avatar_url, status, level, xp) VALUES (?,?,?,?,?,?,?,?)',
          [first_name, last_name, email, google_id, picture, 'active', 1, 0]
        );
        addXP(result.lastInsertRowid, 10, 'register', 'Chào mừng thành viên mới');
        user = db.get('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);
        sendEmail({
          to: email,
          subject: '🎉 Chào mừng bạn đến với AI AGENTS CC!',
          html: emailWrap('Chào mừng đến với cộng đồng!', `
            <p>Xin chào <strong>${first_name}</strong>,</p>
            <p>Bạn đã đăng ký thành công tài khoản tại <strong>AI AGENTS CC</strong> qua Google.</p>
            <a class="btn" href="https://aiagentscc.com/feed.html">Vào Bảng Tin Ngay</a>
          `)
        });
      }
    }

    if (user.status === 'banned') return res.status(403).json({ error: 'Tài khoản đã bị khoá.' });

    db.run("UPDATE users SET last_active_at = datetime('now','localtime') WHERE id = ?", [user.id]);
    res.json({
      success: true,
      user: {
        id: user.id, first_name: user.first_name, last_name: user.last_name,
        email: user.email, level: user.level, xp: user.xp,
        avatar: user.avatar_url || picture,
      },
    });
  });

  // Forgot password — generate reset token
  app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Vui lòng nhập email.' });

    const user = db.get('SELECT id, email, first_name FROM users WHERE email = ?', [email]);
    // Always return success to avoid email enumeration
    if (!user) return res.json({ success: true });

    // Invalidate old tokens for this user
    db.run('UPDATE reset_tokens SET used = 1 WHERE user_id = ?', [user.id]);

    // Generate a random 32-char hex token
    const token = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.run('INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?,?,?)',
      [user.id, token, expires_at]);

    // In production: send email with reset link. In dev: return token in response.
    res.json({ success: true, dev_token: token, dev_hint: `Dùng token này tại /reset-password.html?token=${token}` });
  });

  // Reset password — use token to set new password
  app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Thiếu thông tin.' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự.' });

    const row = db.get(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.used
       FROM reset_tokens rt WHERE rt.token = ?`, [token]
    );
    if (!row) return res.status(400).json({ error: 'Token không hợp lệ.' });
    if (row.used) return res.status(400).json({ error: 'Token đã được sử dụng.' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Token đã hết hạn.' });

    const hash = bcrypt.hashSync(password, 10);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.user_id]);
    db.run('UPDATE reset_tokens SET used = 1 WHERE id = ?', [row.id]);

    res.json({ success: true });
  });

  // ══════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ══════════════════════════════════════════════════════════

  app.post('/api/admin/verify', (req, res) => {
    res.json({ ok: req.body.key === ADMIN_KEY });
  });

  // Stats
  app.get('/api/admin/stats', requireAdmin, (_req, res) => {
    const total_users  = db.get('SELECT COUNT(*) AS n FROM users').n;
    const new_today    = db.get("SELECT COUNT(*) AS n FROM users WHERE date(created_at) = date('now','localtime')").n;
    const total_posts  = db.get('SELECT COUNT(*) AS n FROM posts').n;
    const posts_today  = db.get("SELECT COUNT(*) AS n FROM posts WHERE date(created_at) = date('now','localtime')").n;
    const total_xp     = db.get('SELECT COALESCE(SUM(xp),0) AS n FROM users').n;
    const xp_today     = db.get("SELECT COALESCE(SUM(amount),0) AS n FROM xp_log WHERE date(created_at) = date('now','localtime')").n;
    const completions  = db.get('SELECT COUNT(*) AS n FROM user_challenge_progress').n;
    const active_users = db.get("SELECT COUNT(*) AS n FROM users WHERE last_active_at >= datetime('now','-7 days','localtime')").n;

    const by_level = db.all(
      'SELECT level, COUNT(*) AS count FROM users GROUP BY level ORDER BY level'
    );
    const recent_users = db.all(
      'SELECT id, first_name, last_name, email, level, xp, created_at FROM users ORDER BY created_at DESC LIMIT 5'
    );

    res.json({ total_users, new_today, total_posts, posts_today,
               total_xp, xp_today, completions, active_users, by_level, recent_users });
  });

  // List users
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const { search = '', status = '', limit = 50, offset = 0 } = req.query;
    const like = `%${search}%`;

    let sql = `SELECT id, first_name, last_name, email, level, xp, streak,
                      status, last_active_at, created_at
               FROM users
               WHERE (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)`;
    const params = [like, like, like];

    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const users = db.all(sql, params);

    let cntSql = `SELECT COUNT(*) AS n FROM users WHERE (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)`;
    const cntP = [like, like, like];
    if (status) { cntSql += ' AND status = ?'; cntP.push(status); }
    const total = db.get(cntSql, cntP).n;

    res.json({ users, total });
  });

  // Update user status
  app.patch('/api/admin/users/:id/status', requireAdmin, (req, res) => {
    const { status } = req.body;
    if (!['active','banned','suspended'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    db.run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  });

  // Delete user
  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // List posts
  app.get('/api/admin/posts', requireAdmin, (req, res) => {
    const { search = '', pillar = '', limit = 50, offset = 0 } = req.query;
    const like = `%${search}%`;

    let sql = `SELECT p.id, p.title, p.pillar, p.post_type, p.likes_count, p.comments_count,
                      p.is_pinned, p.created_at,
                      u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email
               FROM posts p JOIN users u ON u.id = p.user_id
               WHERE (p.title LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`;
    const params = [like, like, like];
    if (pillar) { sql += ' AND p.pillar = ?'; params.push(pillar); }
    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    res.json({ posts: db.all(sql, params) });
  });

  app.post('/api/admin/posts', requireAdmin, (req, res) => {
    const { user_id, title, content, pillar, post_type = 'post' } = req.body;
    if (!content || !String(content).trim())
      return res.status(400).json({ error: 'Nội dung bài đăng không được để trống.' });
    const uid = user_id ? Number(user_id) : db.get('SELECT id FROM users ORDER BY id LIMIT 1').id;
    const user = db.get('SELECT id FROM users WHERE id = ?', [uid]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tác giả.' });
    const result = db.run(
      'INSERT INTO posts (user_id, title, content, pillar, post_type) VALUES (?,?,?,?,?)',
      [uid, (title || '').trim(), content.trim(), pillar || null, post_type]
    );
    res.status(201).json({ success: true, post_id: result.lastInsertRowid });
  });

  // Delete post
  app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // XP log
  app.get('/api/admin/xp-log', requireAdmin, (_req, res) => {
    const rows = db.all(`
      SELECT x.id, x.amount, x.source, x.note, x.created_at,
             u.first_name || ' ' || u.last_name AS user_name, u.email
      FROM xp_log x JOIN users u ON u.id = x.user_id
      ORDER BY x.created_at DESC LIMIT 100`);
    res.json({ rows });
  });

  // ── Seed sample posts (chỉ chạy 1 lần khi DB trống) ─────────
  const seedPosts = () => {
    const uRow = db.get('SELECT id FROM users LIMIT 1');
    if (!uRow) return;
    const uid = uRow.id;
    const samples = [
      ['How to Win With AI in 2026', 'Chia sẻ video hay về chiến lược dùng AI để thắng trong năm 2026. AI không phải công cụ — đó là đối tác chiến lược.', 'traffic', 'post', 33, 31],
      ['AI first mindset', 'Chỉ một khi bạn muốn làm, thì 1 bà nội trợ cũng có thể làm được bài tập theo SOP hướng dẫn, và AI first!!!', 'delivery', 'post', 26, 25],
      ['Giới thiệu bản thân — Ngày 1 Challenge', 'Hello mọi người! Em là người mới tham gia cộng đồng. Rất vui được học AI Agent cùng các bạn. 🙌', 'offer', 'cot', 30, 56],
      ['Kickoff: AI Agent Challenge 04.2026', 'Thứ tư, 1 tháng 4 · 7:30 – 10:30PM · Asia/Ho_Chi_Minh. Cùng nhau kickoff thử thách tháng 4 nào! 🚀', 'conversion', 'signal', 25, 42],
      ['Tìm hiểu Prompt Engineering từ A-Z', 'Tổng hợp 20 kỹ thuật prompt engineering hiệu quả nhất hiện tại. Chain-of-thought, few-shot, role prompting...', 'traffic', 'cot', 24, 27],
    ];
    samples.forEach(([title, content, pillar, type, likes, comments]) =>
      db.run(
        'INSERT INTO posts (user_id, title, content, pillar, post_type, likes_count, comments_count) VALUES (?,?,?,?,?,?,?)',
        [uid, title, content, pillar, type, likes, comments]
      )
    );
    console.log('  Seeded 5 sample posts.');
  };

  const postCount = db.get('SELECT COUNT(*) AS n FROM posts').n;
  if (postCount === 0) seedPosts();

  const challengeCount = db.get('SELECT COUNT(*) AS n FROM challenges').n;
  if (challengeCount === 0) {
    db.run(
      `INSERT INTO challenges (id, title, description, duration, status, cover_color) VALUES (1,?,?,21,'active','#0ea5e9')`,
      ['21 Ngày Làm Chủ AI Agent', 'Thử thách thực chiến từ prompt engineering đến deploy agent thật. Mỗi ngày một task cụ thể, học qua làm.']
    );
    db.exec('UPDATE challenge_days SET challenge_id = 1');
    console.log('  Seeded default challenge.');
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC CONTENT ROUTES
  // ══════════════════════════════════════════════════════════

  // Feed
  app.get('/api/feed', (req, res) => {
    const { limit = 20, offset = 0, pillar = '', type = '', sort = '' } = req.query;
    let sql = `
      SELECT p.id, p.title, p.content, p.pillar, p.post_type,
             p.likes_count, p.comments_count, p.is_pinned, p.created_at,
             u.id AS author_id, u.first_name, u.last_name, u.level
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE 1=1`;
    const params = [];
    if (pillar) { sql += ' AND p.pillar = ?'; params.push(pillar); }
    if (type)   { sql += ' AND p.post_type = ?'; params.push(type); }
    const order = sort === 'popular'
      ? 'p.likes_count DESC, p.comments_count DESC'
      : 'p.is_pinned DESC, p.created_at DESC';
    sql += ` ORDER BY ${order} LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));
    const posts = db.all(sql, params);
    const total = db.get('SELECT COUNT(*) AS n FROM posts').n;
    res.json({ posts, total });
  });

  // Create post
  app.post('/api/posts', (req, res) => {
    const { user_id, title, content, pillar, post_type = 'post' } = req.body;
    if (!user_id || !content)
      return res.status(400).json({ error: 'Thiếu thông tin bài đăng.' });
    const user = db.get('SELECT id, level FROM users WHERE id = ?', [user_id]);
    if (!user) return res.status(404).json({ error: 'User không tồn tại.' });
    const result = db.run(
      'INSERT INTO posts (user_id, title, content, pillar, post_type) VALUES (?,?,?,?,?)',
      [user_id, title || '', content, pillar || null, post_type]
    );
    addXP(user_id, 3, 'post', `Đăng bài: ${title || content.slice(0, 30)}`);
    res.status(201).json({ success: true, post_id: result.lastInsertRowid });
  });

  // Single post detail
  app.get('/api/posts/:id', (req, res) => {
    const p = db.get(
      `SELECT p.id, p.title, p.content, p.pillar, p.post_type,
              p.likes_count, p.comments_count, p.created_at,
              u.id AS author_id, u.first_name, u.last_name, u.level
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!p) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    res.json(p);
  });

  // Comments for a post (flat list with parent_id; frontend builds tree)
  app.get('/api/posts/:id/comments', (req, res) => {
    const comments = db.all(
      `SELECT c.id, c.parent_id, c.content, c.created_at,
              u.id AS author_id, u.first_name, u.last_name, u.level
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ?
       ORDER BY COALESCE(c.parent_id, c.id), c.id ASC`,
      [req.params.id]
    );
    res.json({ comments });
  });

  // Add comment or reply
  app.post('/api/posts/:id/comments', (req, res) => {
    const { user_id, content, parent_id = null } = req.body;
    if (!user_id || !content?.trim()) return res.status(400).json({ error: 'Thiếu thông tin' });
    db.run('INSERT INTO comments (post_id, user_id, content, parent_id) VALUES (?,?,?,?)',
      [req.params.id, user_id, content.trim(), parent_id || null]);
    db.run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [req.params.id]);
    const post = db.get('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (post && post.user_id !== Number(user_id)) {
      db.run('UPDATE users SET xp = xp + 2 WHERE id = ?', [user_id]);
      db.run("INSERT INTO xp_log (user_id, amount, reason) VALUES (?,?,?)", [user_id, 2, 'comment']);
    }
    res.json({ success: true });
  });

  // Like a post (toggle)
  app.post('/api/posts/:id/like', (req, res) => {
    db.run('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Leaderboard
  app.get('/api/leaderboard', (req, res) => {
    const { period = 'alltime', limit = 10, user_id } = req.query;

    let ranked;
    if (period === 'alltime') {
      ranked = db.all(
        `SELECT u.id, u.first_name, u.last_name, u.level, u.xp AS period_xp
         FROM users u WHERE u.status = 'active'
         ORDER BY u.xp DESC LIMIT ?`, [Number(limit)]
      );
    } else {
      const days = period === '7day' ? 7 : 30;
      ranked = db.all(
        `SELECT u.id, u.first_name, u.last_name, u.level,
                COALESCE(SUM(x.amount), 0) AS period_xp
         FROM users u
         LEFT JOIN xp_log x ON x.user_id = u.id
           AND x.created_at >= datetime('now', ? || ' days', 'localtime')
         WHERE u.status = 'active'
         GROUP BY u.id
         ORDER BY period_xp DESC LIMIT ?`,
        [`-${days}`, Number(limit)]
      );
    }

    ranked.forEach((r, i) => { r.rank = i + 1; });

    // User's own rank
    let myRank = null;
    if (user_id) {
      const uid = Number(user_id);
      if (period === 'alltime') {
        const me = db.get('SELECT xp FROM users WHERE id = ?', [uid]);
        if (me) {
          const above = db.get('SELECT COUNT(*) AS n FROM users WHERE xp > ? AND status = ?', [me.xp, 'active']).n;
          const myXp  = db.get(
            `SELECT u.xp AS period_xp FROM users u WHERE u.id = ?`, [uid]
          );
          myRank = { rank: above + 1, period_xp: myXp ? myXp.period_xp : 0 };
        }
      } else {
        const days = period === '7day' ? 7 : 30;
        const myXpRow = db.get(
          `SELECT COALESCE(SUM(amount), 0) AS period_xp FROM xp_log
           WHERE user_id = ? AND created_at >= datetime('now', ? || ' days', 'localtime')`,
          [uid, `-${days}`]
        );
        const myPxp = myXpRow ? myXpRow.period_xp : 0;
        const aboveCount = db.get(
          `SELECT COUNT(DISTINCT u.id) AS n FROM users u
           LEFT JOIN xp_log x ON x.user_id = u.id
             AND x.created_at >= datetime('now', ? || ' days', 'localtime')
           WHERE u.status = 'active'
           GROUP BY u.id
           HAVING COALESCE(SUM(x.amount), 0) > ?`,
          [`-${days}`, myPxp]
        );
        myRank = { rank: (aboveCount ? aboveCount.n : 0) + 1, period_xp: myPxp };
      }
    }

    res.json({ ranked, my_rank: myRank });
  });

  // Challenge days + user progress
  app.get('/api/challenge/days', (req, res) => {
    const { user_id } = req.query;
    const days = db.all('SELECT * FROM challenge_days ORDER BY day_number');
    if (!user_id) return res.json({ days, completed: [] });

    const completed = db.all(
      'SELECT day_number FROM user_challenge_progress WHERE user_id = ?',
      [Number(user_id)]
    ).map(r => r.day_number);

    res.json({ days, completed });
  });

  // Complete a challenge day
  app.post('/api/challenge/complete', (req, res) => {
    const { user_id, day_number } = req.body;
    if (!user_id || !day_number)
      return res.status(400).json({ error: 'Thiếu thông tin.' });

    const already = db.get(
      'SELECT id FROM user_challenge_progress WHERE user_id = ? AND day_number = ?',
      [user_id, day_number]
    );
    if (already) return res.status(409).json({ error: 'Ngày này đã hoàn thành.' });

    const day = db.get('SELECT xp_reward FROM challenge_days WHERE day_number = ?', [day_number]);
    if (!day) return res.status(404).json({ error: 'Ngày không tồn tại.' });

    db.run(
      'INSERT INTO user_challenge_progress (user_id, day_number) VALUES (?,?)',
      [user_id, day_number]
    );
    addXP(user_id, day.xp_reward, 'challenge', `Hoàn thành ngày ${day_number}`);

    res.json({ success: true, xp_earned: day.xp_reward });
  });

  // Members list (public)
  app.get('/api/members', (req, res) => {
    const { search = '', limit = 24, offset = 0 } = req.query;
    const like = `%${search}%`;
    const users = db.all(`
      SELECT id, first_name, last_name, level, xp, streak, created_at
      FROM users
      WHERE status = 'active' AND (first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?)
      ORDER BY xp DESC
      LIMIT ? OFFSET ?
    `, [like, like, like, Number(limit), Number(offset)]);
    users.forEach(u => {
      u.post_count      = db.get('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?', [u.id]).n;
      u.completed_days  = db.get('SELECT COUNT(*) AS n FROM user_challenge_progress WHERE user_id = ?', [u.id]).n;
    });
    const total = db.get(
      `SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND (first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?)`,
      [like, like, like]
    ).n;
    res.json({ users, total });
  });

  // User's recent posts
  app.get('/api/users/:id/posts', (req, res) => {
    const posts = db.all(
      `SELECT id, title, content, pillar, post_type, likes_count, comments_count, created_at
       FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`,
      [req.params.id]
    );
    res.json({ posts });
  });

  // User profile
  app.get('/api/users/:id', (req, res) => {
    const user = db.get(
      'SELECT id, first_name, last_name, level, xp, streak, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User không tồn tại.' });

    const completed_days = db.get(
      'SELECT COUNT(*) AS n FROM user_challenge_progress WHERE user_id = ?',
      [req.params.id]
    ).n;
    const post_count = db.get(
      'SELECT COUNT(*) AS n FROM posts WHERE user_id = ?',
      [req.params.id]
    ).n;
    const cot_count = db.get(
      "SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND post_type = 'cot'",
      [req.params.id]
    ).n;

    // Pillar post counts
    const pillarRows = db.all(
      "SELECT pillar, COUNT(*) AS n FROM posts WHERE user_id = ? GROUP BY pillar",
      [req.params.id]
    );
    const pillar_counts = { offer: 0, traffic: 0, conversion: 0, delivery: 0, continuity: 0 };
    pillarRows.forEach(r => { if (r.pillar in pillar_counts) pillar_counts[r.pillar] = r.n; });

    res.json({ ...user, completed_days, post_count, cot_count, pillar_counts });
  });

  // User activity heatmap (last 365 days of XP)
  app.get('/api/users/:id/activity', (req, res) => {
    const rows = db.all(
      `SELECT date(created_at) AS day, SUM(amount) AS xp
       FROM xp_log WHERE user_id = ? AND created_at >= date('now','-365 days')
       GROUP BY date(created_at)`,
      [req.params.id]
    );
    const map = {};
    rows.forEach(r => { map[r.day] = r.xp; });
    res.json({ activity: map });
  });

  // User's commented posts
  app.get('/api/users/:id/comments', (req, res) => {
    const posts = db.all(
      `SELECT DISTINCT p.id, p.title, p.content, p.pillar, p.post_type,
        p.likes_count, p.comments_count, p.created_at,
        u.first_name AS author_first, u.last_name AS author_last,
        (SELECT content FROM comments WHERE post_id = p.id AND user_id = ? ORDER BY created_at DESC LIMIT 1) AS my_comment,
        (SELECT created_at FROM comments WHERE post_id = p.id AND user_id = ? ORDER BY created_at DESC LIMIT 1) AS commented_at
       FROM comments c
       JOIN posts p ON p.id = c.post_id
       JOIN users u ON u.id = p.user_id
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC
       LIMIT 20`,
      [req.params.id, req.params.id, req.params.id]
    );
    res.json({ posts });
  });

  // ══════════════════════════════════════════════════════════
  // CHALLENGE SYSTEM (multi-challenge)
  // ══════════════════════════════════════════════════════════

  app.get('/api/challenges', (req, res) => {
    const { user_id } = req.query;
    const list = db.all("SELECT * FROM challenges WHERE status = 'active' ORDER BY created_at DESC");
    list.forEach(c => {
      c.day_count = db.get('SELECT COUNT(*) AS n FROM challenge_days WHERE challenge_id = ?', [c.id]).n;
      c.member_count = db.get(
        "SELECT COUNT(*) AS n FROM challenge_enrollments WHERE challenge_id = ? AND status IN ('approved','started')",
        [c.id]
      ).n;
      if (user_id) {
        c.my_completed = db.get(
          "SELECT COUNT(*) AS n FROM challenge_submissions WHERE challenge_id = ? AND user_id = ? AND status = 'approved'",
          [c.id, Number(user_id)]
        ).n;
        c.enrollment = db.get(
          'SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ?',
          [Number(user_id), c.id]
        ) || null;
      }
    });
    res.json({ challenges: list });
  });

  app.get('/api/challenges/:id', (req, res) => {
    const cid = Number(req.params.id);
    const { user_id } = req.query;
    const challenge = db.get('SELECT * FROM challenges WHERE id = ?', [cid]);
    if (!challenge) return res.status(404).json({ error: 'Challenge không tồn tại.' });
    const days = db.all('SELECT * FROM challenge_days WHERE challenge_id = ? ORDER BY day_number', [cid]);
    const submissions = {};
    let enrollment = null;
    if (user_id) {
      db.all('SELECT * FROM challenge_submissions WHERE challenge_id = ? AND user_id = ?', [cid, Number(user_id)])
        .forEach(s => { submissions[s.day_id] = s; });
      enrollment = db.get(
        'SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ?',
        [Number(user_id), cid]
      ) || null;
    }
    res.json({ challenge, days, submissions, enrollment });
  });

  app.post('/api/challenges/:id/days/:dayId/submit', (req, res) => {
    const { user_id, content } = req.body;
    const challenge_id = Number(req.params.id);
    const day_id = Number(req.params.dayId);
    if (!user_id || !String(content || '').trim())
      return res.status(400).json({ error: 'Vui lòng nhập nội dung bài nộp.' });
    const day = db.get('SELECT * FROM challenge_days WHERE id = ? AND challenge_id = ?', [day_id, challenge_id]);
    if (!day) return res.status(404).json({ error: 'Ngày không tồn tại.' });
    const enrollment = db.get(
      "SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ? AND status = 'approved'",
      [Number(user_id), challenge_id]
    );
    if (!enrollment || !enrollment.started_at)
      return res.status(403).json({ error: 'Bạn chưa bắt đầu thử thách.' });
    const DAY_MS = 24 * 3600 * 1000;
    const startMs = new Date(enrollment.started_at).getTime();
    const closeMs = startMs + day.day_number * DAY_MS;
    const isLate = Date.now() > closeMs ? 1 : 0;
    const existing = db.get('SELECT id, status FROM challenge_submissions WHERE user_id = ? AND day_id = ?', [user_id, day_id]);
    if (existing) {
      if (existing.status === 'pending')  return res.status(409).json({ error: 'Bài đang chờ duyệt.' });
      if (existing.status === 'approved') return res.status(409).json({ error: 'Bài đã được duyệt.' });
      db.run(
        "UPDATE challenge_submissions SET content = ?, status = 'pending', admin_note = NULL, submitted_at = datetime('now','localtime'), is_late = ? WHERE id = ?",
        [content.trim(), isLate, existing.id]
      );
      return res.json({ success: true, action: 'resubmitted' });
    }
    const result = db.run(
      'INSERT INTO challenge_submissions (user_id, challenge_id, day_id, content, is_late) VALUES (?,?,?,?,?)',
      [user_id, challenge_id, day_id, content.trim(), isLate]
    );
    res.status(201).json({ success: true, submission_id: result.lastInsertRowid });
  });

  app.post('/api/challenges/:id/enroll', (req, res) => {
    const { user_id } = req.body;
    const challenge_id = Number(req.params.id);
    if (!user_id) return res.status(400).json({ error: 'Vui lòng đăng nhập.' });
    const challenge = db.get("SELECT id FROM challenges WHERE id = ? AND status = 'active'", [challenge_id]);
    if (!challenge) return res.status(404).json({ error: 'Thử thách không tồn tại.' });
    const existing = db.get(
      'SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ?',
      [Number(user_id), challenge_id]
    );
    if (existing) return res.status(409).json({ error: 'Bạn đã đăng ký thử thách này rồi.', enrollment: existing });
    db.run('INSERT INTO challenge_enrollments (user_id, challenge_id) VALUES (?,?)', [Number(user_id), challenge_id]);
    res.status(201).json({ success: true, status: 'pending' });

    // Enrollment pending email
    const enrollUser = db.get('SELECT first_name, last_name, email FROM users WHERE id = ?', [Number(user_id)]);
    const enrollChallenge = db.get('SELECT title FROM challenges WHERE id = ?', [challenge_id]);
    if (enrollUser && enrollChallenge) {
      sendEmail({
        to: enrollUser.email,
        subject: '✅ Yêu cầu tham gia thử thách đã được nhận',
        html: emailWrap('Yêu cầu của bạn đã được ghi nhận!', `
          <p>Xin chào <strong>${enrollUser.first_name}</strong>,</p>
          <p>Chúng tôi đã nhận được yêu cầu tham gia thử thách của bạn:</p>
          <div class="rule"><strong>${enrollChallenge.title}</strong></div>
          <p>Yêu cầu của bạn đang <span class="badge">Chờ duyệt</span>. Admin sẽ xem xét và phê duyệt trong vòng <strong>24 giờ</strong>.</p>
          <p>Khi được duyệt, bạn sẽ nhận thêm một email xác nhận kèm nội quy tham gia.</p>
          <a class="btn" href="https://aiagentscc.com/challenge.html">Xem trang thử thách</a>
        `)
      });
    }
  });

  app.post('/api/challenges/:id/start', (req, res) => {
    const { user_id } = req.body;
    const challenge_id = Number(req.params.id);
    if (!user_id) return res.status(400).json({ error: 'Vui lòng đăng nhập.' });
    const enroll = db.get(
      "SELECT * FROM challenge_enrollments WHERE user_id = ? AND challenge_id = ? AND status = 'approved'",
      [Number(user_id), challenge_id]
    );
    if (!enroll) return res.status(403).json({ error: 'Bạn chưa được duyệt tham gia.' });
    if (enroll.started_at) return res.json({ success: true, already: true });
    db.run("UPDATE challenge_enrollments SET started_at = datetime('now','localtime') WHERE id = ?", [enroll.id]);
    res.json({ success: true });
  });

  // ── Admin challenge routes ─────────────────────────────────

  app.get('/api/admin/challenges', requireAdmin, (_req, res) => {
    const list = db.all('SELECT * FROM challenges ORDER BY created_at DESC');
    list.forEach(c => {
      c.day_count = db.get('SELECT COUNT(*) AS n FROM challenge_days WHERE challenge_id = ?', [c.id]).n;
      c.pending_count = db.get("SELECT COUNT(*) AS n FROM challenge_submissions WHERE challenge_id = ? AND status = 'pending'", [c.id]).n;
    });
    res.json({ challenges: list });
  });

  app.post('/api/admin/challenges', requireAdmin, (req, res) => {
    const { title, description, duration = 21, cover_color = '#0ea5e9', status = 'draft' } = req.body;
    if (!title) return res.status(400).json({ error: 'Tiêu đề là bắt buộc.' });
    const result = db.run(
      'INSERT INTO challenges (title, description, duration, cover_color, status) VALUES (?,?,?,?,?)',
      [title, description || '', Number(duration), cover_color, status]
    );
    res.status(201).json({ success: true, id: result.lastInsertRowid });
  });

  app.patch('/api/admin/challenges/:id', requireAdmin, (req, res) => {
    const { title, description, status, cover_color, duration } = req.body;
    const id = req.params.id;
    if (title !== undefined)       db.run('UPDATE challenges SET title = ? WHERE id = ?', [title, id]);
    if (description !== undefined) db.run('UPDATE challenges SET description = ? WHERE id = ?', [description, id]);
    if (status !== undefined)      db.run('UPDATE challenges SET status = ? WHERE id = ?', [status, id]);
    if (cover_color !== undefined) db.run('UPDATE challenges SET cover_color = ? WHERE id = ?', [cover_color, id]);
    if (duration !== undefined)    db.run('UPDATE challenges SET duration = ? WHERE id = ?', [Number(duration), id]);
    res.json({ success: true });
  });

  app.post('/api/admin/challenges/:id/days', requireAdmin, (req, res) => {
    const { title, intro, description, instructions, xp_reward = 5, duration_hours = 24 } = req.body;
    const challenge_id = Number(req.params.id);
    if (!title) return res.status(400).json({ error: 'Tiêu đề ngày là bắt buộc.' });
    const maxDay = db.get('SELECT COALESCE(MAX(day_number),0) AS m FROM challenge_days WHERE challenge_id = ?', [challenge_id]);
    const day_number = maxDay.m + 1;
    const result = db.run(
      'INSERT INTO challenge_days (challenge_id, day_number, title, intro, description, instructions, xp_reward, duration_hours) VALUES (?,?,?,?,?,?,?,?)',
      [challenge_id, day_number, title, intro || '', description || '', instructions || '', Number(xp_reward), Number(duration_hours)]
    );
    res.status(201).json({ success: true, id: result.lastInsertRowid, day_number });
  });

  app.patch('/api/admin/challenge-days/:id', requireAdmin, (req, res) => {
    const { title, intro, description, instructions, xp_reward, duration_hours, submission_deadline } = req.body;
    const id = req.params.id;
    if (title !== undefined)               db.run('UPDATE challenge_days SET title = ? WHERE id = ?', [title, id]);
    if (intro !== undefined)               db.run('UPDATE challenge_days SET intro = ? WHERE id = ?', [intro, id]);
    if (description !== undefined)         db.run('UPDATE challenge_days SET description = ? WHERE id = ?', [description, id]);
    if (instructions !== undefined)        db.run('UPDATE challenge_days SET instructions = ? WHERE id = ?', [instructions, id]);
    if (xp_reward !== undefined)           db.run('UPDATE challenge_days SET xp_reward = ? WHERE id = ?', [Number(xp_reward), id]);
    if (duration_hours !== undefined)      db.run('UPDATE challenge_days SET duration_hours = ? WHERE id = ?', [Number(duration_hours), id]);
    if (submission_deadline !== undefined) db.run('UPDATE challenge_days SET submission_deadline = ? WHERE id = ?', [submission_deadline || null, id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/challenge-days/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    const subCount = db.get('SELECT COUNT(*) AS n FROM challenge_submissions WHERE day_id = ?', [id]).n;
    if (subCount > 0)
      return res.status(409).json({ error: `Ngày này có ${subCount} bài nộp. Xoá bài nộp trước rồi mới xoá ngày.` });
    db.run('DELETE FROM challenge_days WHERE id = ?', [id]);
    res.json({ success: true });
  });

  app.get('/api/admin/submissions', requireAdmin, (req, res) => {
    const { challenge_id = '', status = '', limit = 50, offset = 0 } = req.query;
    let sql = `
      SELECT cs.id, cs.status, cs.content, cs.admin_note, cs.submitted_at,
             u.id AS user_id, u.first_name, u.last_name, u.email,
             cd.day_number, cd.title AS day_title, cd.xp_reward,
             c.title AS challenge_title, c.id AS challenge_id
      FROM challenge_submissions cs
      JOIN users u ON u.id = cs.user_id
      JOIN challenge_days cd ON cd.id = cs.day_id
      JOIN challenges c ON c.id = cs.challenge_id
      WHERE 1=1`;
    const params = [];
    if (challenge_id) { sql += ' AND cs.challenge_id = ?'; params.push(Number(challenge_id)); }
    if (status)       { sql += ' AND cs.status = ?';       params.push(status); }
    sql += ' ORDER BY cs.submitted_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const submissions = db.all(sql, params);
    let cntSql = 'SELECT COUNT(*) AS n FROM challenge_submissions WHERE 1=1';
    const cntP = [];
    if (challenge_id) { cntSql += ' AND challenge_id = ?'; cntP.push(Number(challenge_id)); }
    if (status)       { cntSql += ' AND status = ?';       cntP.push(status); }
    const total = db.get(cntSql, cntP).n;
    const pending_count = db.get("SELECT COUNT(*) AS n FROM challenge_submissions WHERE status = 'pending'").n;
    res.json({ submissions, total, pending_count });
  });

  app.patch('/api/admin/submissions/:id', requireAdmin, (req, res) => {
    const { action, admin_note } = req.body;
    const id = Number(req.params.id);
    if (!['approve', 'revision'].includes(action))
      return res.status(400).json({ error: 'Action không hợp lệ.' });
    const sub = db.get(
      `SELECT cs.*, cs.user_id, cd.xp_reward, cd.day_number
       FROM challenge_submissions cs JOIN challenge_days cd ON cd.id = cs.day_id WHERE cs.id = ?`, [id]
    );
    if (!sub) return res.status(404).json({ error: 'Submission không tồn tại.' });
    if (action === 'approve') {
      db.run("UPDATE challenge_submissions SET status = 'approved', reviewed_at = datetime('now','localtime'), admin_note = NULL WHERE id = ?", [id]);
      const already = db.get('SELECT id FROM user_challenge_progress WHERE user_id = ? AND day_number = ?', [sub.user_id, sub.day_number]);
      if (!already) {
        db.run('INSERT INTO user_challenge_progress (user_id, day_number) VALUES (?,?)', [sub.user_id, sub.day_number]);
        addXP(sub.user_id, sub.xp_reward, 'challenge', `Hoàn thành Ngày ${sub.day_number} (đã duyệt)`);
      }
    } else {
      db.run(
        "UPDATE challenge_submissions SET status = 'needs_revision', admin_note = ?, reviewed_at = datetime('now','localtime') WHERE id = ?",
        [admin_note || 'Vui lòng chỉnh sửa và nộp lại.', id]
      );
    }
    res.json({ success: true });
  });

  // ── Admin enrollment routes ────────────────────────────────

  app.get('/api/admin/enrollments', requireAdmin, (req, res) => {
    const { challenge_id = '', status = '', limit = 50, offset = 0 } = req.query;
    let sql = `
      SELECT ce.id, ce.status, ce.enrolled_at, ce.approved_at, ce.started_at,
             u.id AS user_id, u.first_name, u.last_name, u.email,
             c.title AS challenge_title, c.id AS challenge_id
      FROM challenge_enrollments ce
      JOIN users u ON u.id = ce.user_id
      JOIN challenges c ON c.id = ce.challenge_id
      WHERE 1=1`;
    const params = [];
    if (challenge_id) { sql += ' AND ce.challenge_id = ?'; params.push(Number(challenge_id)); }
    if (status)       { sql += ' AND ce.status = ?';       params.push(status); }
    sql += ' ORDER BY ce.enrolled_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const enrollments = db.all(sql, params);
    let cntSql = 'SELECT COUNT(*) AS n FROM challenge_enrollments WHERE 1=1';
    const cntP = [];
    if (challenge_id) { cntSql += ' AND challenge_id = ?'; cntP.push(Number(challenge_id)); }
    if (status)       { cntSql += ' AND status = ?';       cntP.push(status); }
    const total = db.get(cntSql, cntP).n;
    const pending_count = db.get("SELECT COUNT(*) AS n FROM challenge_enrollments WHERE status = 'pending'").n;
    res.json({ enrollments, total, pending_count });
  });

  app.patch('/api/admin/enrollments/:id', requireAdmin, (req, res) => {
    const { action } = req.body;
    const id = Number(req.params.id);
    if (!['approve', 'reject'].includes(action))
      return res.status(400).json({ error: 'Action không hợp lệ.' });
    const enroll = db.get('SELECT * FROM challenge_enrollments WHERE id = ?', [id]);
    if (!enroll) return res.status(404).json({ error: 'Enrollment không tồn tại.' });
    if (action === 'approve') {
      db.run("UPDATE challenge_enrollments SET status = 'approved', approved_at = datetime('now','localtime') WHERE id = ?", [id]);
      db.run('INSERT INTO notifications (user_id, type, content) VALUES (?,?,?)',
        [enroll.user_id, 'enrollment_approved', 'Yêu cầu tham gia thử thách đã được duyệt! Vào trang thử thách để bắt đầu.']);

      // Approval email with community rules
      const approvedUser = db.get('SELECT first_name, last_name, email FROM users WHERE id = ?', [enroll.user_id]);
      const approvedChallenge = db.get('SELECT title FROM challenges WHERE id = ?', [enroll.challenge_id]);
      if (approvedUser && approvedChallenge) {
        sendEmail({
          to: approvedUser.email,
          subject: '🎉 Chúc mừng! Bạn đã được duyệt tham gia thử thách',
          html: emailWrap('Chào mừng bạn tham gia thử thách!', `
            <p>Xin chào <strong>${approvedUser.first_name}</strong>,</p>
            <p>🎉 Tuyệt vời! Bạn đã được duyệt tham gia:</p>
            <div class="rule"><strong>${approvedChallenge.title}</strong></div>
            <a class="btn" href="https://aiagentscc.com/challenge.html">Bắt đầu thử thách ngay</a>
            <p style="margin-top:24px"><strong>📋 Nội quy cộng đồng</strong></p>
            <div class="rule">1️⃣ <strong>Cam kết hoàn thành:</strong> Nộp bài đúng hạn mỗi ngày. Mỗi ngày có deadline riêng — hãy kiểm tra trang thử thách.</div>
            <div class="rule">2️⃣ <strong>Nộp bài thật:</strong> Không copy bài của người khác. Screenshot, link, ảnh phải là kết quả thực tế của bạn.</div>
            <div class="rule">3️⃣ <strong>Tương tác tích cực:</strong> Comment, like, chia sẻ bài của thành viên khác. Cộng đồng mạnh khi mọi người cùng nhau.</div>
            <div class="rule">4️⃣ <strong>Tôn trọng nhau:</strong> Không spam, không chỉ trích tiêu cực. Feedback phải mang tính xây dựng.</div>
            <div class="rule">5️⃣ <strong>Chia sẻ học hỏi:</strong> Đăng bài lên Bảng Tin sau khi hoàn thành mỗi ngày — XP sẽ được nhân đôi!</div>
            <p style="color:#10b981;font-weight:600">Chúc bạn hoàn thành thành công 21 ngày! 💪</p>
          `)
        });
      }
    } else {
      db.run("UPDATE challenge_enrollments SET status = 'rejected' WHERE id = ?", [id]);
      db.run('INSERT INTO notifications (user_id, type, content) VALUES (?,?,?)',
        [enroll.user_id, 'enrollment_rejected', 'Yêu cầu tham gia thử thách chưa được chấp thuận.']);
    }
    res.json({ success: true });
  });

  // ── Admin courses ──────────────────────────────────────────
  app.get('/api/admin/courses', requireAdmin, (_req, res) => {
    const courses = db.all(`
      SELECT c.*, COUNT(cl.id) AS lesson_count
      FROM courses c LEFT JOIN course_lessons cl ON cl.course_id = c.id
      GROUP BY c.id ORDER BY c.order_num ASC, c.created_at DESC
    `);
    res.json({ courses });
  });

  app.post('/api/admin/courses', requireAdmin, (req, res) => {
    const { title, description, cover_color = '#6366f1', instructor, status = 'draft', order_num = 0 } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Tên khóa học không được để trống.' });
    const r = db.run(
      'INSERT INTO courses (title, description, cover_color, instructor, status, order_num) VALUES (?,?,?,?,?,?)',
      [title.trim(), description || '', cover_color, instructor || '', status, Number(order_num)]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/courses/:id', requireAdmin, (req, res) => {
    const { title, description, cover_color, instructor, status, order_num } = req.body;
    const c = db.get('SELECT id FROM courses WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    if (title !== undefined)       db.run('UPDATE courses SET title = ? WHERE id = ?', [title, req.params.id]);
    if (description !== undefined) db.run('UPDATE courses SET description = ? WHERE id = ?', [description, req.params.id]);
    if (cover_color !== undefined) db.run('UPDATE courses SET cover_color = ? WHERE id = ?', [cover_color, req.params.id]);
    if (instructor !== undefined)  db.run('UPDATE courses SET instructor = ? WHERE id = ?', [instructor, req.params.id]);
    if (status !== undefined)      db.run('UPDATE courses SET status = ? WHERE id = ?', [status, req.params.id]);
    if (order_num !== undefined)   db.run('UPDATE courses SET order_num = ? WHERE id = ?', [Number(order_num), req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/courses/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM course_lessons WHERE course_id = ?', [req.params.id]);
    db.run('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Course lessons
  app.get('/api/admin/courses/:id/lessons', requireAdmin, (req, res) => {
    const lessons = db.all(
      'SELECT * FROM course_lessons WHERE course_id = ? ORDER BY order_num ASC, id ASC',
      [req.params.id]
    );
    res.json({ lessons });
  });

  app.post('/api/admin/courses/:id/lessons', requireAdmin, (req, res) => {
    const { title, content, video_url, duration_min = 0, order_num = 0 } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Tên bài học không được để trống.' });
    const course = db.get('SELECT id FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    const r = db.run(
      'INSERT INTO course_lessons (course_id, title, content, video_url, duration_min, order_num) VALUES (?,?,?,?,?,?)',
      [req.params.id, title.trim(), content || '', video_url || '', Number(duration_min), Number(order_num)]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/lessons/:id', requireAdmin, (req, res) => {
    const { title, content, video_url, duration_min, order_num } = req.body;
    const l = db.get('SELECT id FROM course_lessons WHERE id = ?', [req.params.id]);
    if (!l) return res.status(404).json({ error: 'Bài học không tồn tại.' });
    if (title !== undefined)       db.run('UPDATE course_lessons SET title = ? WHERE id = ?', [title, req.params.id]);
    if (content !== undefined)     db.run('UPDATE course_lessons SET content = ? WHERE id = ?', [content, req.params.id]);
    if (video_url !== undefined)   db.run('UPDATE course_lessons SET video_url = ? WHERE id = ?', [video_url, req.params.id]);
    if (duration_min !== undefined) db.run('UPDATE course_lessons SET duration_min = ? WHERE id = ?', [Number(duration_min), req.params.id]);
    if (order_num !== undefined)   db.run('UPDATE course_lessons SET order_num = ? WHERE id = ?', [Number(order_num), req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/lessons/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM course_lessons WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin settings ────────────────────────────────────────
  app.patch('/api/admin/settings', requireAdmin, (req, res) => {
    const allowed = ['announcement_enabled', 'announcement_text', 'announcement_icon'];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'Không có trường hợp lệ.' });
    updates.forEach(([key, value]) => {
      db.run('INSERT INTO site_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
    });
    res.json({ success: true });
  });

  // ── Notifications (user) ──────────────────────────────────
  app.get('/api/notifications', (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const notifications = db.all(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [user_id]
    );
    const unread = notifications.filter(n => !n.is_read).length;
    res.json({ notifications, unread });
  });

  app.patch('/api/notifications/:id/read', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, user_id]);
    res.json({ success: true });
  });

  app.post('/api/notifications/read-all', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [user_id]);
    res.json({ success: true });
  });

  // ── Admin notifications ────────────────────────────────────
  app.get('/api/admin/notifications', requireAdmin, (_req, res) => {
    const notifs = db.all(`
      SELECT type, title, content, link,
             MAX(created_at) AS created_at,
             COUNT(*) AS sent_count
      FROM notifications
      WHERE sent_by_admin = 1
      GROUP BY title, content, type, link
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json(notifs);
  });

  app.post('/api/admin/notifications', requireAdmin, (req, res) => {
    const { user_id, type, title, content, link } = req.body;
    if (!type || !title || !content) return res.status(400).json({ error: 'Thiếu type, title hoặc content.' });

    if (user_id === 'all') {
      const users = db.all("SELECT id FROM users WHERE status = 'active'");
      for (const u of users) {
        db.run(
          'INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)',
          [u.id, type, title, content, link || null]
        );
      }
      res.json({ success: true, sent: users.length });
    } else {
      const uid = Number(user_id);
      if (!uid) return res.status(400).json({ error: 'user_id không hợp lệ.' });
      const user = db.get('SELECT id FROM users WHERE id = ?', [uid]);
      if (!user) return res.status(404).json({ error: 'Không tìm thấy user.' });
      db.run(
        'INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)',
        [uid, type, title, content, link || null]
      );
      res.json({ success: true, sent: 1 });
    }
  });

  // ══════════════════════════════════════════════════════════
  // MARKETPLACE ROUTES
  // ══════════════════════════════════════════════════════════

  // List products (public)
  app.get('/api/products', (req, res) => {
    const { category, sort, q } = req.query;
    let where = "p.status = 'published'";
    const params = [];
    if (category && category !== 'all') { where += ' AND p.category = ?'; params.push(category); }
    if (q) { where += ' AND (p.title LIKE ? OR p.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    const orderMap = { newest: 'p.created_at DESC', popular: 'p.sales_count DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC' };
    const orderBy = orderMap[sort] || 'p.created_at DESC';
    const products = db.all(`
      SELECT p.id, p.title, p.description, p.price, p.category, p.cover_color,
             p.sales_count, p.created_at,
             u.first_name, u.last_name, u.xp
      FROM products p
      JOIN users u ON u.id = p.seller_id
      WHERE ${where}
      ORDER BY ${orderBy}
    `, params);
    const total = db.get('SELECT COUNT(*) AS n FROM products WHERE status = ?', ['published']).n;
    res.json({ products, total });
  });

  // Product detail (public)
  app.get('/api/products/:id', (req, res) => {
    const product = db.get(`
      SELECT p.*, u.first_name, u.last_name, u.xp, u.level
      FROM products p
      JOIN users u ON u.id = p.seller_id
      WHERE p.id = ? AND p.status = 'published'
    `, [req.params.id]);
    if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại.' });
    res.json(product);
  });

  // Create product (user) — status = pending_review, chờ admin duyệt
  app.post('/api/products', (req, res) => {
    const { user_id, title, description, long_description, price, category, cover_color } = req.body;
    if (!user_id || !title || price === undefined)
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc.' });
    const seller = db.get('SELECT id, first_name, last_name, email FROM users WHERE id = ? AND status = ?', [user_id, 'active']);
    if (!seller) return res.status(403).json({ error: 'Tài khoản không hợp lệ.' });
    const result = db.run(
      "INSERT INTO products (seller_id, title, description, long_description, price, category, cover_color, status) VALUES (?,?,?,?,?,?,?,'pending_review')",
      [user_id, title, description || '', long_description || '', Number(price), category || 'other', cover_color || '#0ea5e9']
    );
    const product = db.get('SELECT * FROM products WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, product });

    const amtFmt = Number(price) === 0 ? 'Miễn phí' : Number(price).toLocaleString('vi-VN') + 'đ';
    // Email xác nhận cho người bán
    sendEmail({
      to: seller.email,
      subject: '⏳ Sản phẩm đã gửi — đang chờ admin duyệt',
      html: emailWrap('Sản phẩm đang chờ duyệt', `
        <p>Xin chào <strong>${seller.first_name}</strong>,</p>
        <p>Sản phẩm của bạn đã được gửi thành công và đang chờ admin xem xét:</p>
        <div class="rule">
          🛍️ <strong>${title}</strong><br>
          💰 Giá: <strong>${amtFmt}</strong>
        </div>
        <p>Admin sẽ duyệt trong vòng <strong>24 giờ</strong>. Bạn sẽ nhận email ngay khi có kết quả.</p>
        <a class="btn" href="https://aiagentscc.com/marketplace.html">Xem Marketplace</a>
      `)
    });
    // Thông báo cho admin
    sendEmail({
      to: ADMIN_EMAIL,
      subject: `🆕 Sản phẩm mới chờ duyệt: ${title}`,
      html: emailWrap('Có sản phẩm mới cần duyệt', `
        <p>Thành viên vừa đăng sản phẩm mới:</p>
        <div class="rule">
          🛍️ <strong>${title}</strong><br>
          👤 Người bán: <strong>${seller.first_name} ${seller.last_name}</strong> (${seller.email})<br>
          💰 Giá: <strong>${amtFmt}</strong><br>
          🆔 ID sản phẩm: #${product.id}
        </div>
        <a class="btn" href="https://aiagentscc.com/admin.html">Duyệt trong Admin Panel</a>
      `)
    });
  });

  // Place order (user)
  app.post('/api/orders', (req, res) => {
    const { product_id, buyer_id, payment_method, note } = req.body;
    if (!product_id || !buyer_id)
      return res.status(400).json({ error: 'Thiếu thông tin đặt hàng.' });
    const product = db.get("SELECT * FROM products WHERE id = ? AND status = 'published'", [product_id]);
    if (!product) return res.status(404).json({ error: 'Sản phẩm không tồn tại.' });
    const buyer = db.get('SELECT id FROM users WHERE id = ? AND status = ?', [buyer_id, 'active']);
    if (!buyer) return res.status(403).json({ error: 'Tài khoản không hợp lệ.' });
    const result = db.run(
      'INSERT INTO orders (product_id, buyer_id, amount, payment_method, note) VALUES (?,?,?,?,?)',
      [product_id, buyer_id, product.price, payment_method || 'bank', note || '']
    );
    db.run('UPDATE products SET sales_count = sales_count + 1 WHERE id = ?', [product_id]);
    const order = db.get('SELECT * FROM orders WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, order });

    // 15-min reminder email if still pending after 15 minutes
    const orderId  = order.id;
    const buyerRow = db.get('SELECT first_name, last_name, email FROM users WHERE id = ?', [buyer_id]);
    const qrUrl    = `https://qr.sepay.vn/img?bank=BIDV&acc=96247NGUYEN&template=compact&amount=${product.price}&des=AIAGENT%20${product_id}%20${buyer_id}`;
    const amountFmt = Number(product.price).toLocaleString('vi-VN') + 'đ';

    if (buyerRow) {
      setTimeout(() => {
        const current = db.get('SELECT status, mail_15m FROM orders WHERE id = ?', [orderId]);
        if (!current || current.status === 'completed' || current.mail_15m) return;
        db.run('UPDATE orders SET mail_15m = 1 WHERE id = ?', [orderId]);
        sendEmail({
          to: buyerRow.email,
          subject: '⏰ Đơn hàng của bạn chưa được thanh toán',
          html: emailWrap('Nhắc nhở: Hoàn tất thanh toán', `
            <p>Xin chào <strong>${buyerRow.first_name}</strong>,</p>
            <p>Đơn hàng <strong>${product.title}</strong> (${amountFmt}) của bạn vẫn đang chờ thanh toán.</p>
            <p>Vui lòng chuyển khoản đến:</p>
            <div class="rule">
              🏦 <strong>BIDV</strong> — STK: <strong>96247NGUYEN</strong><br>
              Chủ TK: <strong>TỪ CHÍ NGUYỆN</strong><br>
              Số tiền: <strong>${amountFmt}</strong><br>
              Nội dung: <strong>AIAGENT ${product_id} ${buyer_id}</strong>
            </div>
            <p>Quét mã QR để thanh toán nhanh:</p>
            <p><img src="${qrUrl}" alt="QR Code" style="width:180px;border-radius:8px;border:1px solid #e2e8f0"></p>
            <a class="btn" href="https://aiagentscc.com/checkout.html?id=${product_id}">Xem lại đơn hàng</a>
            <p style="color:#94a3b8;font-size:13px">Đơn hàng sẽ tự động hủy nếu không nhận được thanh toán trong 48 giờ.</p>
          `)
        });
      }, 15 * 60 * 1000);
    }
  });

  // My orders (buyer)
  app.get('/api/my/orders', (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const orders = db.all(`
      SELECT o.id, o.amount, o.payment_method, o.status, o.created_at,
             p.title, p.cover_color, p.category,
             u.first_name AS seller_first, u.last_name AS seller_last
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN users u ON u.id = p.seller_id
      WHERE o.buyer_id = ?
      ORDER BY o.created_at DESC
    `, [user_id]);
    res.json(orders);
  });

  // My products (seller)
  app.get('/api/my/products', (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const products = db.all(
      'SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC',
      [user_id]
    );
    res.json(products);
  });

  // Admin — list all products
  app.get('/api/admin/products', requireAdmin, (_req, res) => {
    const products = db.all(`
      SELECT p.*, u.first_name, u.last_name, u.email
      FROM products p
      JOIN users u ON u.id = p.seller_id
      ORDER BY p.created_at DESC
    `);
    res.json(products);
  });

  // Admin — create product
  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const { title, description, long_description, price, category, cover_color, status, seller_id } = req.body;
    if (!title) return res.status(400).json({ error: 'Thiếu tên sản phẩm.' });
    const sid = seller_id || db.get('SELECT id FROM users ORDER BY id ASC LIMIT 1')?.id || 1;
    const result = db.run(
      'INSERT INTO products (seller_id, title, description, long_description, price, category, cover_color, status) VALUES (?,?,?,?,?,?,?,?)',
      [sid, title, description || '', long_description || '', Number(price) || 0,
       category || 'other', cover_color || '#0ea5e9', status || 'published']
    );
    const product = db.get('SELECT * FROM products WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, product });
  });

  // Admin — update product
  app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
    const { status, title, description, long_description, price, category, cover_color } = req.body;
    const fields = []; const params = [];
    if (status !== undefined)           { fields.push('status = ?');           params.push(status); }
    if (title !== undefined)            { fields.push('title = ?');            params.push(title); }
    if (description !== undefined)      { fields.push('description = ?');      params.push(description); }
    if (long_description !== undefined) { fields.push('long_description = ?'); params.push(long_description); }
    if (price !== undefined)            { fields.push('price = ?');            params.push(Number(price)); }
    if (category !== undefined)         { fields.push('category = ?');         params.push(category); }
    if (cover_color !== undefined)      { fields.push('cover_color = ?');      params.push(cover_color); }
    if (!fields.length) return res.status(400).json({ error: 'Không có trường cần cập nhật.' });
    const productId = Number(req.params.id);
    const prevProduct = db.get('SELECT status FROM products WHERE id = ?', [productId]);
    params.push(productId);
    db.run(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });

    // Gửi email khi admin thay đổi status sản phẩm
    if (status && prevProduct && prevProduct.status !== status) {
      const prod = db.get(`
        SELECT p.title, p.price, u.first_name, u.last_name, u.email
        FROM products p JOIN users u ON u.id = p.seller_id
        WHERE p.id = ?
      `, [productId]);
      if (prod) {
        const amtFmt = Number(prod.price) === 0 ? 'Miễn phí' : Number(prod.price).toLocaleString('vi-VN') + 'đ';
        if (status === 'published') {
          sendEmail({
            to: prod.email,
            subject: '✅ Sản phẩm của bạn đã được duyệt!',
            html: emailWrap('Sản phẩm đã được duyệt', `
              <p>Xin chào <strong>${prod.first_name}</strong>,</p>
              <p>Tuyệt vời! Sản phẩm của bạn đã được admin duyệt và hiện đang hiển thị trên Marketplace:</p>
              <div class="rule">
                🛍️ <strong>${prod.title}</strong><br>
                💰 Giá: <strong>${amtFmt}</strong>
              </div>
              <a class="btn" href="https://aiagentscc.com/marketplace.html">Xem trên Marketplace</a>
            `)
          });
        } else if (status === 'rejected') {
          sendEmail({
            to: prod.email,
            subject: '❌ Sản phẩm chưa được duyệt',
            html: emailWrap('Sản phẩm chưa được duyệt', `
              <p>Xin chào <strong>${prod.first_name}</strong>,</p>
              <p>Rất tiếc, sản phẩm dưới đây chưa đáp ứng tiêu chí duyệt của chúng tôi:</p>
              <div class="rule">🛍️ <strong>${prod.title}</strong></div>
              <p>Vui lòng liên hệ admin để biết lý do và chỉnh sửa lại trước khi đăng lại.</p>
              <a class="btn" href="https://aiagentscc.com/marketplace.html">Về Marketplace</a>
            `)
          });
        }
      }
    }
  });

  // Admin — delete product
  app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Admin — list all orders
  app.get('/api/admin/orders', requireAdmin, (_req, res) => {
    const orders = db.all(`
      SELECT o.id, o.amount, o.payment_method, o.status, o.created_at,
             p.title AS product_title,
             ub.first_name AS buyer_first, ub.last_name AS buyer_last, ub.email AS buyer_email,
             us.first_name AS seller_first, us.last_name AS seller_last
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN users ub ON ub.id = o.buyer_id
      JOIN users us ON us.id = p.seller_id
      ORDER BY o.created_at DESC
    `);
    res.json(orders);
  });

  // Admin — update order status
  app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
    const { status } = req.body;
    const orderId = Number(req.params.id);
    const prev = db.get('SELECT status FROM orders WHERE id = ?', [orderId]);
    db.run('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
    res.json({ success: true });

    if (!prev || prev.status === status) return;

    // Fetch full order info for email
    const info = db.get(`
      SELECT o.amount, p.title AS product_title, p.id AS product_id,
             u.first_name, u.last_name, u.email AS buyer_email
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN users u ON u.id = o.buyer_id
      WHERE o.id = ?
    `, [orderId]);
    if (!info) return;

    const amtFmt = Number(info.amount).toLocaleString('vi-VN') + 'đ';

    if (status === 'completed') {
      sendPaymentConfirmedEmails(orderId);
    } else if (status === 'cancelled') {
      sendEmail({
        to: info.buyer_email,
        subject: '❌ Đơn hàng của bạn đã bị hủy',
        html: emailWrap('Đơn hàng đã bị hủy', `
          <p>Xin chào <strong>${info.first_name}</strong>,</p>
          <p>Rất tiếc, đơn hàng dưới đây đã bị hủy:</p>
          <div class="rule">
            🛍️ Sản phẩm: <strong>${info.product_title}</strong><br>
            💰 Số tiền: <strong>${amtFmt}</strong><br>
            🆔 Mã đơn: #${orderId}
          </div>
          <p>Nếu bạn đã chuyển khoản, vui lòng liên hệ admin để được hoàn tiền hoặc hỗ trợ.</p>
          <a class="btn" href="https://aiagentscc.com/marketplace.html">Xem Marketplace</a>
        `)
      });
    }
  });

  // Buyer — manual claim (đã chuyển khoản, chờ admin xác nhận)
  app.post('/api/orders/:id/claim', (req, res) => {
    const { user_id } = req.body;
    const orderId = Number(req.params.id);
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const order = db.get(
      "SELECT o.*, p.title AS product_title, u.first_name, u.last_name, u.email FROM orders o JOIN products p ON p.id=o.product_id JOIN users u ON u.id=o.buyer_id WHERE o.id=? AND o.buyer_id=?",
      [orderId, user_id]
    );
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });
    if (order.status === 'completed') return res.json({ success: true, already: true });

    db.run("UPDATE orders SET status = 'claimed' WHERE id = ?", [orderId]);
    res.json({ success: true });

    const amtFmt = Number(order.amount).toLocaleString('vi-VN') + 'đ';
    sendEmail({
      to: order.email,
      subject: '⏳ Đã nhận yêu cầu — đang chờ xác nhận thanh toán',
      html: emailWrap('Yêu cầu của bạn đã được ghi nhận', `
        <p>Xin chào <strong>${order.first_name}</strong>,</p>
        <p>Chúng tôi đã nhận được xác nhận chuyển khoản của bạn cho đơn hàng:</p>
        <div class="rule">
          🛍️ Sản phẩm: <strong>${order.product_title}</strong><br>
          💰 Số tiền: <strong>${amtFmt}</strong><br>
          🆔 Mã đơn: #${orderId}
        </div>
        <p>Admin sẽ kiểm tra và xác nhận thanh toán trong vòng <strong>1–4 giờ</strong> (giờ hành chính). Bạn sẽ nhận thêm email sau khi được xác nhận.</p>
        <p style="color:#94a3b8;font-size:13px">Nếu có thắc mắc, hãy liên hệ qua cộng đồng AI AGENTS CC.</p>
      `)
    });
    // Notify admin
    sendEmail({
      to: ADMIN_EMAIL,
      subject: `🔔 Đơn #${orderId} — khách xác nhận đã chuyển khoản`,
      html: emailWrap(`Khách xác nhận đơn #${orderId}`, `
        <p>Khách hàng vừa bấm "Tôi đã chuyển khoản":</p>
        <div class="rule">
          👤 <strong>${order.first_name} ${order.last_name}</strong> (${order.email})<br>
          🛍️ ${order.product_title}<br>
          💰 ${amtFmt}<br>
          🆔 Đơn #${orderId}
        </div>
        <a class="btn" href="https://aiagentscc.com/admin.html">Xác nhận trong Admin Panel</a>
      `)
    });
  });

  // ── Order status (buyer polling) ──────────────────────────
  app.get('/api/orders/:id', (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const order = db.get(
      'SELECT id, status, payment_method, amount FROM orders WHERE id = ? AND buyer_id = ?',
      [req.params.id, user_id]
    );
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng.' });
    res.json(order);
  });

  // ── Payment confirmed emails (called by webhook + GSheet polling) ──
  function sendPaymentConfirmedEmails(orderId) {
    try {
      const orderInfo = db.get(`
        SELECT o.amount, p.title AS product_title,
               u.first_name, u.last_name, u.email AS buyer_email
        FROM orders o
        JOIN products p ON p.id = o.product_id
        JOIN users u ON u.id = o.buyer_id
        WHERE o.id = ?
      `, [orderId]);
      if (!orderInfo) return;

      const amtFmt = Number(orderInfo.amount).toLocaleString('vi-VN') + 'đ';

      // Email to buyer
      sendEmail({
        to: orderInfo.buyer_email,
        subject: '✅ Thanh toán thành công — cảm ơn bạn!',
        html: emailWrap('Thanh toán thành công!', `
          <p>Xin chào <strong>${orderInfo.first_name}</strong>,</p>
          <p>Chúng tôi đã xác nhận nhận được thanh toán của bạn. Cảm ơn bạn rất nhiều! 🎉</p>
          <div class="rule">
            🛍️ Sản phẩm: <strong>${orderInfo.product_title}</strong><br>
            💰 Số tiền: <strong>${amtFmt}</strong><br>
            📦 Trạng thái: <span class="green">Đã xác nhận</span>
          </div>
          <p>Người bán sẽ liên hệ với bạn trong vòng <strong>24 giờ</strong> để hướng dẫn nhận sản phẩm.</p>
          <a class="btn" href="https://aiagentscc.com/feed.html">Về trang cộng đồng</a>
        `)
      });

      // Notification email to admin
      sendEmail({
        to: ADMIN_EMAIL,
        subject: `💰 Đơn hàng #${orderId} đã được thanh toán`,
        html: emailWrap(`Đơn hàng #${orderId} hoàn tất`, `
          <p>Đơn hàng mới vừa được xác nhận thanh toán:</p>
          <div class="rule">
            📦 Sản phẩm: <strong>${orderInfo.product_title}</strong><br>
            👤 Người mua: <strong>${orderInfo.first_name} ${orderInfo.last_name}</strong> (${orderInfo.buyer_email})<br>
            💰 Số tiền: <strong>${amtFmt}</strong><br>
            🆔 Đơn hàng: #${orderId}
          </div>
          <a class="btn" href="https://aiagentscc.com/admin.html">Xem trong Admin Panel</a>
        `)
      });
    } catch (err) {
      console.error('[Email] sendPaymentConfirmedEmails error:', err.message);
    }
  }

  // ── SePay webhook ──────────────────────────────────────────
  app.post('/api/webhook/sepay', (req, res) => {
    const apikey = req.headers['apikey'] || req.headers['x-api-key'] || req.body?.apikey;
    if (apikey !== SEPAY_KEY) {
      console.warn('SePay webhook: unauthorized request');
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { content, transferAmount, transferType } = req.body;
    console.log(`SePay webhook received: type=${transferType} amount=${transferAmount} content="${content}"`);

    if (transferType !== 'in') return res.json({ success: true });

    // Parse "AIAGENT {product_id} {buyer_id}" from nội dung chuyển khoản
    const match = String(content || '').match(/AIAGENT\s+(\d+)\s+(\d+)/i);
    if (!match) {
      console.log('SePay: content không khớp định dạng AIAGENT');
      return res.json({ success: false, message: 'Nội dung không khớp.' });
    }

    const productId = parseInt(match[1]);
    const buyerId   = parseInt(match[2]);

    const order = db.get(`
      SELECT o.id, o.amount FROM orders o
      WHERE o.product_id = ? AND o.buyer_id = ? AND o.status = 'pending'
      ORDER BY o.created_at DESC LIMIT 1
    `, [productId, buyerId]);

    if (!order) {
      console.log(`SePay: không tìm thấy đơn pending — product=${productId} buyer=${buyerId}`);
      return res.json({ success: false, message: 'Không tìm thấy đơn hàng pending.' });
    }

    if (transferAmount < order.amount) {
      console.log(`SePay: số tiền không đủ — nhận ${transferAmount}, cần ${order.amount}`);
      return res.json({ success: false, message: `Số tiền không đủ.` });
    }

    db.run('UPDATE orders SET status = ? WHERE id = ?', ['completed', order.id]);
    db.run('UPDATE products SET sales_count = sales_count + 1 WHERE id = ?', [productId]);
    console.log(`✅ SePay: Order #${order.id} completed — ${transferAmount}₫`);
    res.json({ success: true });

    sendPaymentConfirmedEmails(order.id);
  });

  // ── Google Sheet polling (auto-confirm khi SePay ghi vào Sheet) ──
  const processedRows = new Set();

  async function pollGoogleSheet() {
    try {
      const csv = await fetchText(
        `https://docs.google.com/spreadsheets/d/${GSHEET_ID}/export?format=csv&gid=0`
      );
      const lines = csv.split('\n').filter(l => l.trim());
      if (lines.length < 2) return; // Chỉ có header, chưa có dữ liệu

      for (let i = 1; i < lines.length; i++) {
        const rowKey = lines[i].trim();
        if (!rowKey || processedRows.has(rowKey)) continue;

        const cells  = parseCSVRow(lines[i]);
        const rowStr = cells.join(' ');

        // Tìm pattern AIAGENT {product_id} {buyer_id} trong bất kỳ cột nào
        const match = rowStr.match(/AIAGENT[\s_]+(\d+)[\s_]+(\d+)/i);
        if (!match) { processedRows.add(rowKey); continue; }

        const [, productId, buyerId] = match;

        // Tìm số tiền lớn nhất trong dòng (lọc ra các số > 1000)
        let amount = 0;
        for (const cell of cells) {
          const n = parseFloat(cell.replace(/[^\d]/g, ''));
          if (n > 1000 && n > amount) amount = n;
        }

        const order = db.get(`
          SELECT o.id, o.amount FROM orders o
          WHERE o.product_id = ? AND o.buyer_id = ? AND o.status = 'pending'
          ORDER BY o.created_at DESC LIMIT 1
        `, [productId, buyerId]);

        processedRows.add(rowKey);
        if (!order) continue;
        if (amount > 0 && amount < order.amount) {
          console.log(`⚠️  GSheet: Số tiền không đủ — nhận ${amount}, cần ${order.amount}`);
          continue;
        }

        db.run('UPDATE orders SET status = ? WHERE id = ?', ['completed', order.id]);
        db.run('UPDATE products SET sales_count = sales_count + 1 WHERE id = ?', [productId]);
        console.log(`✅ GSheet: Đơn #${order.id} xác nhận tự động (${amount}₫)`);
        sendPaymentConfirmedEmails(order.id);
      }
    } catch (_) { /* silent — sheet chưa public hoặc mất mạng */ }
  }

  // Poll mỗi 5 giây
  setInterval(pollGoogleSheet, 5000);

  // ── Abandoned cart drip emails (1d / 2d / 4d) ──────────────
  setInterval(() => {
    const now = Date.now();
    const pending = db.all(`
      SELECT o.id, o.product_id, o.buyer_id, o.amount, o.created_at,
             o.mail_1d, o.mail_2d, o.mail_4d,
             p.title AS product_title,
             u.first_name, u.last_name, u.email
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN users u ON u.id = o.buyer_id
      WHERE o.status = 'pending'
    `);
    for (const row of pending) {
      const age = now - new Date(row.created_at).getTime();
      const D1 = 24 * 3600 * 1000;
      const amtFmt = Number(row.amount).toLocaleString('vi-VN') + 'đ';
      const qrUrl = `https://qr.sepay.vn/img?bank=BIDV&acc=96247NGUYEN&template=compact&amount=${row.amount}&des=AIAGENT%20${row.product_id}%20${row.buyer_id}`;

      const drips = [
        { flag: 'mail_1d', col: 'mail_1d', min: D1,     max: 2 * D1, day: 1,
          subject: '🛒 Bạn còn quên gì không? Đơn hàng chưa được thanh toán',
          intro: 'Hôm qua bạn đã đặt hàng nhưng chưa hoàn tất thanh toán.' },
        { flag: 'mail_2d', col: 'mail_2d', min: 2 * D1, max: 4 * D1, day: 2,
          subject: '⚠️ Nhắc lần 2: Đơn hàng sắp hết hạn',
          intro: '2 ngày trước bạn đã đặt hàng nhưng chưa thanh toán. Đơn sẽ hết hạn sau 2 ngày nữa.' },
        { flag: 'mail_4d', col: 'mail_4d', min: 4 * D1, max: Infinity, day: 4,
          subject: '🔔 Cơ hội cuối cùng — Đơn hàng sẽ bị hủy hôm nay',
          intro: 'Đây là email nhắc nhở cuối cùng. Nếu không thanh toán, đơn hàng sẽ tự động bị hủy.' },
      ];

      for (const drip of drips) {
        if (age >= drip.min && age < drip.max && !row[drip.flag]) {
          db.run(`UPDATE orders SET ${drip.col} = 1 WHERE id = ?`, [row.id]);
          sendEmail({
            to: row.email,
            subject: drip.subject,
            html: emailWrap('Đơn hàng chưa thanh toán', `
              <p>Xin chào <strong>${row.first_name}</strong>,</p>
              <p>${drip.intro}</p>
              <div class="rule">
                🛍️ <strong>${row.product_title}</strong><br>
                💰 Số tiền: <strong>${amtFmt}</strong>
              </div>
              <p>Chuyển khoản để hoàn tất:</p>
              <div class="rule">
                🏦 <strong>BIDV</strong> — STK: <strong>96247NGUYEN</strong><br>
                Chủ TK: <strong>TỪ CHÍ NGUYỆN</strong><br>
                Số tiền: <strong>${amtFmt}</strong><br>
                Nội dung: <strong>AIAGENT ${row.product_id} ${row.buyer_id}</strong>
              </div>
              <p><img src="${qrUrl}" alt="QR" style="width:160px;border-radius:8px;border:1px solid #e2e8f0"></p>
              <a class="btn" href="https://aiagentscc.com/checkout.html?id=${row.product_id}">Hoàn tất thanh toán</a>
            `)
          });
        }
      }
    }
  }, 30 * 60 * 1000); // check every 30 min

  // ── Late submission reminder cron (every hour) ──────────────
  setInterval(async () => {
    const DAY_MS = 24 * 3600 * 1000;
    const now = Date.now();
    // Find all active enrollments
    const enrollments = db.all(
      "SELECT e.*, u.email, u.first_name, c.title AS challenge_title FROM challenge_enrollments e JOIN users u ON u.id = e.user_id JOIN challenges c ON c.id = e.challenge_id WHERE e.status = 'approved' AND e.started_at IS NOT NULL"
    );
    for (const e of enrollments) {
      const startMs = new Date(e.started_at).getTime();
      // Get all days for this challenge
      const days = db.all('SELECT * FROM challenge_days WHERE challenge_id = ? ORDER BY day_number', [e.challenge_id]);
      for (const day of days) {
        const closeMs = startMs + day.day_number * DAY_MS;
        // Only process days whose deadline has passed
        if (now <= closeMs) continue;
        // Check if already submitted
        const sub = db.get(
          "SELECT id FROM challenge_submissions WHERE user_id = ? AND day_id = ? AND status != 'rejected'",
          [e.user_id, day.id]
        );
        if (sub) continue; // already submitted (pending/approved/revision)
        // Check if we already sent a reminder today
        const reminder = db.get('SELECT * FROM late_reminders WHERE user_id = ? AND day_id = ?', [e.user_id, day.id]);
        const lastSentMs = reminder ? new Date(reminder.last_sent_at).getTime() : 0;
        const hoursSinceLast = (now - lastSentMs) / (3600 * 1000);
        if (reminder && hoursSinceLast < 20) continue; // send at most once per ~day
        // Compose email
        const isFirst = !reminder;
        const subject = isFirst
          ? `⚠️ Ngày ${day.day_number} thử thách chưa hoàn thành — ${e.challenge_title}`
          : `🔔 Nhắc nhở: Ngày ${day.day_number} vẫn đang chờ bạn nộp bài`;
        const bodyIntro = isFirst
          ? `<p>Xin chào <strong>${e.first_name}</strong>,</p>
             <p>Thử thách ngày thứ <strong>${day.day_number}</strong> đã hết hạn mà chưa thấy bài nộp từ bạn. Mặc dù thử thách <strong>không còn được tính là hoàn thành đúng hạn</strong>, bạn <strong>vẫn phải nộp bài</strong> để mở khóa ngày tiếp theo.</p>`
          : `<p>Xin chào <strong>${e.first_name}</strong>,</p>
             <p>Bạn vẫn chưa nộp bài ngày thứ <strong>${day.day_number}</strong>. Hãy hoàn thành để tiếp tục hành trình nhé!</p>`;
        await sendEmail({
          to: e.email,
          subject,
          html: emailWrap(isFirst ? 'Thử thách chưa hoàn thành đúng hạn' : 'Nhắc nhở nộp bài', `
            ${bodyIntro}
            <div class="rule">
              📅 <strong>${e.challenge_title}</strong><br>
              Ngày ${day.day_number}: <strong>${day.title}</strong>
            </div>
            <p>Dù trễ hạn, bài nộp của bạn vẫn được chấp nhận. Ngày tiếp theo sẽ mở sau khi bài được duyệt.</p>
            <a class="btn" href="https://aiagentscc.com/challenge-day-detail.html?challenge_id=${e.challenge_id}&day_id=${day.id}">Nộp bài ngay</a>
          `)
        });
        // Update late_reminders table
        if (reminder) {
          db.run(
            "UPDATE late_reminders SET last_sent_at = datetime('now','localtime'), sent_count = sent_count + 1 WHERE id = ?",
            [reminder.id]
          );
        } else {
          db.run(
            'INSERT INTO late_reminders (user_id, challenge_id, day_id) VALUES (?,?,?)',
            [e.user_id, e.challenge_id, day.id]
          );
        }
      }
    }
  }, 60 * 60 * 1000); // check every hour

  // ── Start ──────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`\n✅  AI Agent Command Center API`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`   Admin: http://localhost:${PORT}/admin.html`);
    console.log(`   Admin key : ${ADMIN_KEY}`);
    console.log(`\n🔔  SePay Webhook`);
    console.log(`   SePay Key : ${SEPAY_KEY}`);
    console.log(`   Webhook   : https://aiagentscc.com/api/webhook/sepay`);
    console.log(`\n📧  Email (Resend)`);
    console.log(`   Status    : ${resendClient ? '✅ Active' : '⚠️  No RESEND_API_KEY — emails disabled'}`);
    console.log(`   From      : ${FROM_EMAIL}`);
    console.log(`   Admin     : ${ADMIN_EMAIL}\n`);
  });
})();
