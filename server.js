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
const multer    = require('multer');
const webpush   = require('web-push'); // thông báo đẩy (PWA) — xem mục "Web Push"
const initSqlJs = require('sql.js');

const https    = require('https');
const http     = require('http');
const crypto   = require('crypto');
const { Resend } = require('resend');

const app      = express();
const PORT     = process.env.PORT || 3000;
const ADMIN_KEY   = process.env.ADMIN_KEY   || (() => { const k = require('crypto').randomBytes(12).toString('hex'); console.warn(`⚠️  Chưa đặt ADMIN_KEY trong .env — mã admin tạm cho lần chạy này: ${k}`); return k; })();
const SEPAY_KEY   = process.env.SEPAY_KEY   || ''; // key webhook SePay đặt trong Admin → Cài đặt → Thanh toán
const GSHEET_ID   = process.env.GSHEET_ID   || '1TNzXmIR9Qcu_oqeNxYGFdnFxt2YN9xik4OPJOtac4nI';
const RESEND_KEY       = process.env.RESEND_API_KEY    || '';
const OPENROUTER_KEY   = process.env.OPENROUTER_API_KEY || '';

// ── Community identity (override via .env) ───────────────────
const COMMUNITY_NAME = process.env.COMMUNITY_NAME || 'AI AGENTS CC';
// ASCII-only version for HTTP headers (Latin-1 only) — strips Vietnamese diacritics
const COMMUNITY_NAME_ASCII = COMMUNITY_NAME
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[^\x20-\x7E]/g, '').trim() || 'Community';
const SITE_URL       = (process.env.SITE_URL || 'https://aiagentscc.com').replace(/\/$/, '');
const SITE_DOMAIN    = SITE_URL.replace(/^https?:\/\//, '');
const FROM_EMAIL  = process.env.FROM_EMAIL || `${COMMUNITY_NAME} <no-reply@${SITE_DOMAIN.split(':')[0]}>`;
// Chỉ lấy phần địa chỉ; tên hiển thị người gửi lấy theo communityName() lúc gửi
const FROM_ADDRESS = (FROM_EMAIL.match(/<([^>]+)>/) || [null, FROM_EMAIL])[1].trim();
// Tên cộng đồng hiện hành — đọc từ site_settings.community_name (admin sửa ở Cài đặt),
// fallback về COMMUNITY_NAME (env). Được gán lại sau khi DB khởi tạo.
let communityName = () => COMMUNITY_NAME;
const SEPAY_MEMO_PREFIX = process.env.SEPAY_MEMO_PREFIX || 'AIAGENT';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

const resendClient = RESEND_KEY ? new Resend(RESEND_KEY) : null;

// Trả về { ok, id, error } — phần lớn nơi gọi bỏ qua kết quả; gửi email thủ công (CRM) dùng để báo admin.
async function sendEmail({ to, subject, html }) {
  if (!resendClient) {
    console.warn('[Email] Skipped — RESEND_API_KEY not set');
    return { ok: false, error: 'Chưa cấu hình dịch vụ gửi email (RESEND_API_KEY).' };
  }
  try {
    console.log(`[Email] Sending to ${to} | "${subject}"`);
    const result = await resendClient.emails.send({ from: `${communityName()} <${FROM_ADDRESS}>`, to, subject, html });
    if (result?.error) {
      console.error(`[Email] ❌ Rejected by Resend — ${result.error.name || ''}: ${result.error.message || JSON.stringify(result.error)}`);
      return { ok: false, error: result.error.message || 'Dịch vụ email từ chối gửi.' };
    }
    const id = result?.data?.id || result?.id || '';
    console.log(`[Email] ✅ Sent — id: ${id || JSON.stringify(result)}`);
    return { ok: true, id };
  } catch (err) {
    console.error('[Email] ❌ Error:', err.message, err?.response?.data || '');
    return { ok: false, error: err.message };
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
    <p style="color:#0ea5e9;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">${communityName().toUpperCase()}</p>
    <h1>${title}</h1>
    ${body}
    <div class="footer">${communityName()}<br>${SITE_DOMAIN}</div>
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

// ── Ttm body photos/video upload (Hồ sơ ảnh) — lưu tạm rồi đẩy lên Google Drive ──
const TTM_PHOTOS_TMP_DIR = path.join(__dirname, 'uploads', 'ttm-photos-tmp');
fs.mkdirSync(TTM_PHOTOS_TMP_DIR, { recursive: true });

const ttmPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TTM_PHOTOS_TMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `u${req.params.userId}-${file.fieldname}-${Date.now()}${ext}`);
  },
});
const ttmPhotoUpload = multer({
  storage: ttmPhotoStorage,
  limits: { fileSize: 60 * 1024 * 1024 }, // 60MB — đủ cho ảnh + 1 video ngắn
  fileFilter: (req, file, cb) => {
    const isImage = ['front', 'back', 'side'].includes(file.fieldname) && file.mimetype.startsWith('image/');
    const isVideo = file.fieldname === 'video' && file.mimetype.startsWith('video/');
    cb(isImage || isVideo ? null : new Error('Định dạng file không hợp lệ.'), isImage || isVideo);
  },
});

// ── Google Drive (OAuth với tài khoản Google của bạn — kho lưu ảnh/video Hồ sơ ảnh) ──
// Service Account trần không có storage quota nên không upload được file thật (chỉ tạo được
// thư mục 0-byte) — phải dùng OAuth với 1 tài khoản Google thật để file dùng đúng quota của
// tài khoản đó, khớp với cách dữ liệu cũ (thư mục "Hồ sơ Khách hàng") đang được lưu.
const { google }                    = require('googleapis');
const GOOGLE_DRIVE_OAUTH_CLIENT_ID     = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || '';
const GOOGLE_DRIVE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET || '';
const GOOGLE_DRIVE_REDIRECT_URI        = `${SITE_URL}/api/admin/drive-oauth/callback`;
const GOOGLE_DRIVE_PARENT_FOLDER_ID    = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || '';
const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
];

function newDriveOAuthClient() {
  if (!GOOGLE_DRIVE_OAUTH_CLIENT_ID || !GOOGLE_DRIVE_OAUTH_CLIENT_SECRET) {
    throw new Error('Chưa cấu hình GOOGLE_DRIVE_OAUTH_CLIENT_ID / GOOGLE_DRIVE_OAUTH_CLIENT_SECRET.');
  }
  return new google.auth.OAuth2(GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI);
}

// Upload 1 file local lên 1 thư mục Drive, set quyền "anyone with link" để nhúng lại được,
// trả về { fileId, displayUrl } — ảnh dùng link xem trực tiếp, video dùng link nhúng iframe.
async function uploadToUserDrive(drive, localFilePath, filename, mimeType, folderId, isVideo, makePublic = true) {
  const created = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: fs.createReadStream(localFilePath) },
    fields: 'id',
  });
  const fileId = created.data.id;

  // Ảnh cơ thể (makePublic = false): giữ riêng tư, xem qua /api/ttm/photo-file có chữ ký
  if (makePublic) await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  // `uc?export=view` đôi khi trả về trang HTML xác nhận thay vì ảnh thật khi nhúng trực tiếp trong
  // trình duyệt (tuỳ session/cookie của người xem) — dùng endpoint thumbnail chính thức của Drive,
  // ổn định hơn cho việc nhúng <img>.
  const displayUrl = isVideo
    ? `https://drive.google.com/file/d/${fileId}/preview`
    : `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  return { fileId, displayUrl };
}

// Link chia sẻ ảnh Google Drive (…/file/d/ID/view, open?id=, uc?export=view&id=) không nhúng được
// vào <img> — đổi sang endpoint thumbnail. Link không phải Drive giữ nguyên.
function driveImageUrl(url) {
  const s = String(url || '').trim();
  if (!/^https?:\/\/(drive|docs)\.google\.com\//i.test(s) || /\/thumbnail\?/.test(s)) return s;
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{15,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600` : s;
}

// Xoá 1 file Drive cũ khi bị thay thế (best-effort, không throw nếu lỗi).
async function deleteDriveFileByUrl(drive, url) {
  if (!url) return;
  const m = url.match(/[?&]id=([^&]+)/) || url.match(/\/file\/d\/([^/]+)/);
  if (!m) return;
  try {
    await drive.files.delete({ fileId: m[1] });
  } catch (e) { /* file đã bị xoá tay trên Drive hoặc lỗi mạng — bỏ qua */ }
}

// Bảo mật: không lộ "X-Powered-By: Express"; chỉ cho chính trang của mình gọi API từ trình duyệt (CORS)
app.disable('x-powered-by');
const CORS_ALLOWED = new Set([SITE_URL, 'http://localhost:3000', 'http://127.0.0.1:3000']);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || CORS_ALLOWED.has(origin)) }));
// Header bảo mật cho trình duyệt (không nhúng trang vào web lạ, không đoán kiểu file, hạn chế gửi địa chỉ trang)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
  if (SITE_URL.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json());

// Giới hạn số lần thử (chống dò mật khẩu / khoá admin). IP thật lấy từ Cloudflare (cf-connecting-ip) hoặc nginx (x-real-ip).
const rlHits = new Map();
const clientIp = req => String(req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').slice(0, 64);
function rateLimited(key, max, windowMs) {
  const now = Date.now(), arr = (rlHits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); rlHits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of rlHits) if (!v.some(t => now - t < 3600e3)) rlHits.delete(k); }, 600e3).unref?.();
const rl = (name, max, windowMs, byEmail) => (req, res, next) => {
  const keys = [`${name}|ip|${clientIp(req)}`];
  if (byEmail && req.body?.email) keys.push(`${name}|em|${String(req.body.email).trim().toLowerCase()}`);
  if (keys.some(k => rateLimited(k, max, windowMs))) return res.status(429).json({ error: 'Bạn thử quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.' });
  next();
};
app.post('/api/auth/login', rl('login', 10, 15 * 60e3, true));
app.post('/api/admin/verify', rl('adminverify', 10, 15 * 60e3));
app.post('/api/admin/login', rl('adminlogin', 10, 15 * 60e3));
app.post('/api/auth/register', rl('register', 10, 60 * 60e3));
app.post('/api/auth/forgot-password', rl('forgot', 10, 60 * 60e3, true));
app.post('/api/auth/reset-password', rl('reset', 20, 60 * 60e3));
app.post('/api/auth/email-code/verify', rl('codeverify', 30, 15 * 60e3));
app.post('/api/auth/email-code/register', rl('coderegister', 10, 60 * 60e3));
app.post('/api/lead-magnet/:key/signup', rl('leadmagnet', 10, 60 * 60e3));
app.post('/api/zoom/checkin', rl('zoomcheckin', 20, 10 * 60e3));

// Thư mục gốc được phục vụ static → chặn các file nội bộ (DB, mã nguồn server, tài liệu,
// ảnh hồ sơ khách...). Chỉ cho phép uploads/locations/ (ảnh cửa hàng công khai), uploads/docs/ (tài liệu PDF công khai)
// và uploads/music/ (nhạc thư giãn 377 ngày).
// Chặn cả file/thư mục ẩn (.git, .env… — trừ .well-known) và mọi bản sao lưu DB (brain.db.bak-*).
const BLOCKED_STATIC = /^\/(?:server\.js|_repro\.js|package(?:-lock)?\.json|start-server\.bat|gsheet-webhook\.gs|node_modules\/|tai-lieu\/|content\/|scripts\/|ttm-photos|uploads\/(?!(?:locations|docs|music)\/))|\.(?:db|db-journal|sqlite3?|bak|md|docx)$|(?:^|\/)\.(?!well-known(?:\/|$))|brain\.db|\.bak/i;
app.use((req, res, next) => {
  let p;
  try { p = path.posix.normalize(decodeURIComponent(req.path)); } catch { return res.status(400).end(); }
  if (BLOCKED_STATIC.test(p)) return res.status(404).end();
  next();
});
// AI AGENTS CC: các trang sức khỏe / Ngũ Hành của template đã ẩn — mở trực tiếp sẽ về Feed
const HIDDEN_PAGES = new Set(["tro-ly.html","nhat-ky.html","thuc-don-7-ngay.html","thuc-pham.html","cong-thuc.html","kiem-tra-han-nhiet.html","quy-trinh.html","workshop3.html","workshop8.html","workshop8-thu-ngo.html","program377.html","program377-thu-ngo.html","intake-than-tam-menh.html","lo-trinh.html","ban-do-hanh-trinh.html","hanh-trinh.html","coach-1-1.html","dia-diem.html"]);
app.use((req, res, next) => {
  const name = req.path.split('/').pop().toLowerCase();
  if (HIDDEN_PAGES.has(name) || HIDDEN_PAGES.has(name + '.html')) return res.redirect(302, '/feed.html');
  next();
});
app.use(express.static(path.join(__dirname), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      // `no-cache` (not `no-store`): browser still revalidates every request
      // (never serves stale JS/CSS/HTML after an edit) but can get a 304
      // instead of re-downloading the whole file — full downloads on every
      // single page navigation were a major source of the menu-click stutter.
      // .html was added after repeatedly seeing real devices (mobile Safari
      // in particular) render an old page's markup/inline script for a while
      // after a deploy, even though desktop/hard-reload always saw the fix.
      res.setHeader('Cache-Control', 'no-cache');
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
  CREATE TABLE IF NOT EXISTS manual_email_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email      TEXT NOT NULL,
    to_name       TEXT,
    template_id   INTEGER,
    template_name TEXT,
    subject       TEXT,
    status        TEXT,
    error         TEXT,
    sent_by       INTEGER,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS user_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    token_hash   TEXT    UNIQUE NOT NULL,
    expires_at   TEXT    NOT NULL,
    last_used_at TEXT,
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS health_visits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    visit_date  TEXT NOT NULL,
    place       TEXT,
    title       TEXT,
    note        TEXT,
    status      TEXT DEFAULT 'draft',
    admin_note  TEXT,
    submitted_at TEXT,
    verified_by INTEGER,
    verified_at TEXT,
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    updated_at  TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS health_results (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id   INTEGER NOT NULL REFERENCES health_visits(id),
    test_code  TEXT NOT NULL,
    test_name  TEXT,
    value_text TEXT,
    value_num  REAL,
    unit       TEXT,
    ref_low    REAL,
    ref_high   REAL,
    flag       TEXT,
    source     TEXT DEFAULT 'manual',
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS health_imaging (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id   INTEGER NOT NULL REFERENCES health_visits(id),
    kind       TEXT NOT NULL,
    body_part  TEXT,
    findings   TEXT,
    conclusion TEXT,
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS health_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id      INTEGER NOT NULL REFERENCES health_visits(id),
    drive_file_id TEXT NOT NULL,
    mime          TEXT,
    original_name TEXT,
    size_bytes    INTEGER,
    kind          TEXT DEFAULT 'xet_nghiem',
    ai_status     TEXT,
    ai_raw_json   TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS health_record_access_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    actor_user_id INTEGER,
    actor_role    TEXT,
    action        TEXT NOT NULL,
    detail        TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    token      TEXT    UNIQUE NOT NULL,
    expires_at TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS admin_secrets (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  -- Mã đăng nhập 6 số gửi qua email (đăng nhập không cần mật khẩu / không cần Google)
  CREATE TABLE IF NOT EXISTS login_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL,
    code_hash   TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    attempts    INTEGER DEFAULT 0,
    used        INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
  );
  -- Thiết bị đã bật thông báo đẩy (Web Push) — mỗi trình duyệt/điện thoại 1 dòng
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    endpoint        TEXT    NOT NULL UNIQUE,
    p256dh          TEXT    NOT NULL,
    auth            TEXT    NOT NULL,
    user_agent      TEXT,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    last_success_at TEXT
  );
  CREATE TABLE IF NOT EXISTS ai_providers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    provider_type TEXT    NOT NULL,
    api_key       TEXT    NOT NULL,
    model         TEXT,
    is_active     INTEGER DEFAULT 0,
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
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
  -- Coach 1-1: 1 dòng mỗi đơn hàng gói coaching đã hoàn tất (UNIQUE order_id
  -- chống cộng buổi 2 lần nếu webhook xử lý trùng). Số buổi còn lại của 1
  -- user = SUM(sessions) - COUNT(coaching_bookings chưa bị hủy).
  CREATE TABLE IF NOT EXISTS coaching_credits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    order_id    INTEGER NOT NULL UNIQUE REFERENCES orders(id),
    sessions    INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS coaching_bookings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    preferred_date  TEXT,
    preferred_time  TEXT,
    note            TEXT,
    status          TEXT DEFAULT 'pending',
    confirmed_date  TEXT,
    confirmed_time  TEXT,
    meeting_link    TEXT,
    admin_note      TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT
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
  CREATE TABLE IF NOT EXISTS course_modules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL REFERENCES courses(id),
    title        TEXT NOT NULL,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS course_lessons (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL REFERENCES courses(id),
    module_id    INTEGER REFERENCES course_modules(id),
    title        TEXT NOT NULL,
    content      TEXT,
    video_url    TEXT,
    duration_min INTEGER DEFAULT 0,
    order_num    INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'published',
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS course_enrollments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL REFERENCES courses(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    status       TEXT DEFAULT 'pending',
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
  -- Quyền học cấp trước theo email (học viên cũ chưa có tài khoản). Khi user đăng ký /
  -- đăng nhập bằng email này, quyền được chuyển thành course_enrollments 'approved' rồi xoá.
  CREATE TABLE IF NOT EXISTS course_email_grants (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id    INTEGER NOT NULL REFERENCES courses(id),
    email        TEXT NOT NULL,
    name         TEXT,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(course_id, email)
  );
  -- Địa điểm làm tác động cột sống / cung cấp nguyên liệu AI Agents CC. Người dùng đăng ký
  -- (status 'pending'), admin duyệt thành 'approved' thì mới hiện ở trang dia-diem.html.
  CREATE TABLE IF NOT EXISTS locations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    full_name       TEXT NOT NULL,
    phone           TEXT NOT NULL,
    email           TEXT,
    place_name      TEXT,
    address         TEXT,
    description     TEXT,
    map_url         TEXT,
    image_url       TEXT,
    open_time       TEXT,
    close_time      TEXT,
    do_spine        INTEGER DEFAULT 0,
    do_supply       INTEGER DEFAULT 0,
    certified       INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'pending',
    sort_order      INTEGER DEFAULT 0,
    admin_note      TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT,
    approved_at     TEXT
  );
  -- Tin nhắn từ form "Liên hệ Ban tổ chức" (lien-he.html), admin xem & xử lý
  CREATE TABLE IF NOT EXISTS contact_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    full_name       TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    department      TEXT NOT NULL,
    message         TEXT NOT NULL,
    status          TEXT DEFAULT 'new',
    admin_note      TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    handled_at      TEXT
  );
  -- Thư viện bài tập dùng lại (không AI chấm điểm) — chỉ hướng dẫn + 1 link, học
  -- viên tự đọc và bấm vào làm. Dùng chung cho bài học (exercise_type='link') và
  -- nội dung 377 ngày (program377_days.linked_assignment_id).
  CREATE TABLE IF NOT EXISTS assignments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    instructions  TEXT,
    link_url      TEXT,
    display_mode  TEXT    DEFAULT 'link',
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT    DEFAULT (datetime('now','localtime')),
    updated_at    TEXT
  );
  -- Minigame công khai "Kiểm tra cơ thể Hàn - Nhiệt" (kiem-tra-han-nhiet.html) —
  -- công cụ marketing/thu lead, không cần đăng nhập. Khác với ttm_roadmaps
  -- (khảo sát 29 câu + AI phân tích cho khách đã đăng ký), đây là bản rút gọn
  -- công khai, tính điểm bằng công thức cố định (classifyHanNhiet), không AI.
  CREATE TABLE IF NOT EXISTS han_nhiet_quiz_results (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    phone         TEXT    NOT NULL,
    han_count     INTEGER DEFAULT 0,
    nhiet_count   INTEGER DEFAULT 0,
    result_type   TEXT    NOT NULL,
    answers_json  TEXT,
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS lesson_exercise_submissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    lesson_id       INTEGER NOT NULL REFERENCES course_lessons(id),
    course_id       INTEGER NOT NULL REFERENCES courses(id),
    answer_text     TEXT    NOT NULL,
    score           INTEGER NOT NULL,
    max_score       INTEGER NOT NULL,
    pass_score      INTEGER NOT NULL,
    passed          INTEGER NOT NULL DEFAULT 0,
    issues          TEXT,
    hints           TEXT,
    ai_feedback_raw TEXT,
    xp_awarded      INTEGER NOT NULL DEFAULT 0,
    submitted_at    TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, lesson_id)
  );
  CREATE TABLE IF NOT EXISTS lesson_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id  INTEGER NOT NULL REFERENCES course_lessons(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    content    TEXT    NOT NULL,
    parent_id  INTEGER REFERENCES lesson_comments(id),
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS lesson_exercise_questions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id     INTEGER NOT NULL REFERENCES course_lessons(id),
    question_text TEXT NOT NULL,
    options       TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    explanation   TEXT,
    order_num     INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS ielts_tests (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    skill              TEXT NOT NULL,
    title              TEXT NOT NULL,
    description        TEXT,
    time_limit_minutes INTEGER DEFAULT 60,
    status             TEXT DEFAULT 'published',
    max_score          INTEGER DEFAULT 100,
    passages           TEXT,
    task_type          TEXT,
    writing_prompt     TEXT,
    writing_rubric     TEXT,
    writing_image_url  TEXT,
    created_at         TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS ielts_test_questions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id        INTEGER NOT NULL REFERENCES ielts_tests(id),
    question_type  TEXT NOT NULL,
    passage_ref    TEXT,
    question_text  TEXT NOT NULL,
    options        TEXT,
    correct_answer TEXT NOT NULL,
    explanation    TEXT,
    order_num      INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS space_groups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS spaces (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id            INTEGER REFERENCES space_groups(id),
    name                TEXT    NOT NULL,
    icon                TEXT    DEFAULT '💬',
    description         TEXT,
    visibility          TEXT    DEFAULT 'public',
    min_level           INTEGER DEFAULT 1,
    allow_join_requests INTEGER DEFAULT 1,
    order_num           INTEGER DEFAULT 0,
    created_at          TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS space_members (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id     INTEGER NOT NULL REFERENCES spaces(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    status       TEXT    DEFAULT 'pending',
    invited_by   INTEGER REFERENCES users(id),
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(space_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS topics (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id     INTEGER NOT NULL REFERENCES spaces(id),
    name         TEXT    NOT NULL,
    icon         TEXT    DEFAULT '🏷️',
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS poll_votes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id      INTEGER NOT NULL REFERENCES posts(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    option_index INTEGER NOT NULL,
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(post_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS pillars (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT    UNIQUE NOT NULL,
    label      TEXT    NOT NULL,
    icon       TEXT    DEFAULT '🔥',
    color      TEXT    DEFAULT '#0ea5e9',
    order_num  INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS foods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    element    TEXT,          -- kim | moc | thuy | hoa | tho
    color      TEXT,          -- trắng | xanh | đen | đỏ | vàng
    taste      TEXT,          -- cay | chua | mặn | đắng | ngọt | chát
    nature     TEXT,          -- hàn | lương | bình | ôn | nhiệt
    organ      TEXT,          -- Phổi/Đại tràng, Gan/Mật, ...
    note       TEXT,
    order_num  INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    element_tags TEXT,        -- comma-separated: kim,moc,...
    buoi         TEXT,        -- sáng | trưa | tối | cả ngày
    summary      TEXT,
    ingredients  TEXT,
    steps        TEXT,
    dung_khi     TEXT,        -- "dùng khi" — điều kiện phù hợp
    note         TEXT,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS camnang_docs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    pdf_url    TEXT    NOT NULL,
    icon       TEXT    DEFAULT '📄',
    note       TEXT,
    order_num  INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS meal_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    log_date   TEXT    NOT NULL,   -- YYYY-MM-DD
    breakfast  TEXT,
    lunch      TEXT,
    dinner     TEXT,
    colors     TEXT,   -- JSON array: ["xanh","đỏ",...]
    tastes     TEXT,   -- JSON array: ["chua","cay",...]
    note       TEXT,
    created_at TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, log_date)
  );
  CREATE TABLE IF NOT EXISTS meal_log_reminders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    reminder_date TEXT    NOT NULL,   -- YYYY-MM-DD
    sent_count    INTEGER DEFAULT 1,
    last_sent_at  TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, reminder_date)
  );
  CREATE TABLE IF NOT EXISTS assistant_usage (
    user_id    INTEGER NOT NULL REFERENCES users(id),
    usage_date TEXT    NOT NULL,   -- YYYY-MM-DD (localtime)
    count      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, usage_date)
  );
  CREATE TABLE IF NOT EXISTS assistant_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    question   TEXT    NOT NULL,
    answer     TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS ttm_intake_responses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    answers_json TEXT    NOT NULL,
    summary_text TEXT    NOT NULL,
    submitted_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS ttm_roadmaps (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    intake_id     INTEGER NOT NULL REFERENCES ttm_intake_responses(id),
    draft_content TEXT    NOT NULL,
    status        TEXT    DEFAULT 'pending_approval',
    admin_note    TEXT,
    final_content TEXT,
    reviewed_at   TEXT,
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS ttm_body_photos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id),
    front_url    TEXT,
    back_url     TEXT,
    side_url     TEXT,
    video_url    TEXT,
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
  );

  -- ── Chương trình 377 ngày ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS program377_enrollments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id),
    status       TEXT    DEFAULT 'pending',
    enrolled_at  TEXT    DEFAULT (datetime('now','localtime')),
    approved_at  TEXT,
    approved_by  INTEGER REFERENCES users(id),
    start_date   TEXT,
    admin_note   TEXT
  );
  CREATE TABLE IF NOT EXISTS program377_days (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number      INTEGER UNIQUE NOT NULL,
    topic_key       TEXT,
    title           TEXT    NOT NULL,
    body_html       TEXT,
    video_url       TEXT,
    exercise_title  TEXT,
    exercise_body   TEXT,
    xp_reward       INTEGER DEFAULT 0,
    created_at      TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS program377_reports (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    report_date      TEXT    NOT NULL,
    day_number       INTEGER,
    meal_breakfast   TEXT,
    meal_lunch       TEXT,
    meal_dinner      TEXT,
    meal_colors      TEXT,
    meal_tastes      TEXT,
    urine_amount     TEXT,
    urine_color      TEXT,
    stool_shape      TEXT,
    stool_color      TEXT,
    exercise_type    TEXT,
    exercise_minutes INTEGER,
    sweat_amount     TEXT,
    sweat_taste      TEXT,
    feeling_note     TEXT,
    is_late          INTEGER DEFAULT 0,
    created_at       TEXT    DEFAULT (datetime('now','localtime')),
    updated_at       TEXT,
    UNIQUE(user_id, report_date)
  );
  CREATE TABLE IF NOT EXISTS program377_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_date  TEXT    NOT NULL,
    title         TEXT    NOT NULL,
    session_type  TEXT    DEFAULT 'zoom',
    link_url      TEXT,
    description   TEXT,
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS program377_content_blocks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT    NOT NULL,
    season        TEXT    NOT NULL DEFAULT 'all',
    the_trang     TEXT    NOT NULL DEFAULT 'all',
    title         TEXT,
    body_html     TEXT    NOT NULL,
    status        TEXT    DEFAULT 'draft',
    ai_generated  INTEGER DEFAULT 0,
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT    DEFAULT (datetime('now','localtime')),
    updated_at    TEXT
  );

  -- ── 8 Buổi Chuyên Sâu (có phí, duyệt thủ công như 377 ngày) ────────
  CREATE TABLE IF NOT EXISTS workshop8_enrollments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id),
    status       TEXT    DEFAULT 'pending',
    enrolled_at  TEXT    DEFAULT (datetime('now','localtime')),
    approved_at  TEXT,
    approved_by  INTEGER REFERENCES users(id),
    admin_note   TEXT
  );
`;

// [day_number, title, description, instructions, xp_reward] — thử thách theo Ngũ Hành
const PROTOCOL_SOP = `<h3>🕒 Quy trình 1 ngày 3 buổi (làm mỗi ngày)</h3>
<table><thead><tr><th>Giờ</th><th>Việc</th><th>Hướng dẫn</th></tr></thead><tbody>
<tr><td>05:30</td><td>Uống sữa kháng thể</td><td>Pha với nước nguội, lắc dọc ~30 giây; uống trước ăn 30 phút (trước thuốc 60 phút nếu có).</td></tr>
<tr><td>06:00</td><td>Mật mía chanh + vận động 30 phút</td><td>~5 thìa mật mía + 250ml nước ấm + 1 lát chanh (dùng chanh có hạt). Trời lạnh thêm 1 lát gừng. Sau đó vỗ tay 4 nhịp / yoga / chạy bộ — nơi nhiều oxy, chân tiếp đất, tắm nắng.</td></tr>
<tr><td>06:30–07:30</td><td>Ăn sáng theo Ngũ Hành</td><td>Ưu tiên vị CHUA (Hành Mộc): vắt chanh vào nước chấm, ăn kèm lá diếp cá, uống nước cam. Trời lạnh thêm vị CAY: tỏi, ớt, tiêu, lá bạc hà.</td></tr>
<tr><td>08:00–09:00</td><td>Café / cacao / trà tim sen</td><td>Huyết áp thấp hoặc bình thường → vị đắng màu đỏ (café / cacao / socola). Huyết áp cao → vị đắng màu xanh (trà tim sen).</td></tr>
<tr><td>11:30–12:00</td><td>Ăn trưa theo Ngũ Hành</td><td>Kết hợp vị + màu: Xanh+Chua, Đỏ+Đắng, thêm Chát. VD canh chua lá giang, canh sườn nấu sấu, canh khổ qua, chuối xanh nấu tía tô.</td></tr>
<tr><td>18:30–19:00</td><td>Ăn tối theo Ngũ Hành + 1 ly rượu vang (20–50ml)</td><td>Ưu tiên vị CAY màu trắng (Hành Kim) + vị MẶN màu đen (Hành Thủy). VD lẩu Thái, rau muống xào tỏi, mè đen rang muối, canh gà ác, tỏi đen ngâm tương.</td></tr>
<tr><td>19:30</td><td>Uống trà thải độc</td><td>1 gói + 200ml nước sôi (trời lạnh 100ml). Nếu hôm sau không đi vệ sinh được → tăng 2 gói với 300ml.</td></tr>
</tbody></table>
<blockquote>Lưu ý chung: dùng chanh có hạt · nhai kỹ (ăn như uống) · cố ăn đủ 5 màu + 5 vị · nếu không đủ cả màu cả vị thì ưu tiên VỊ.</blockquote>`;

const SUBMIT_BLOCK = `Nộp bài:
<ul>
<li>Ảnh ít nhất 1 bữa ăn hôm nay (nêu rõ có những màu gì / vị gì)</li>
<li>Tự đánh giá: hôm nay bạn ăn đủ mấy màu (xanh/đỏ/vàng/trắng/đen) và mấy vị (chua/cay/đắng/mặn/ngọt)?</li>
<li>Cảm nhận cơ thể trong ngày (tiêu hóa, năng lượng, giấc ngủ, tâm trạng)</li>
</ul>
✅ Được duyệt khi: Có ảnh bữa ăn thật + phần tự đánh giá màu/vị + 1–2 câu cảm nhận cơ thể.`;

const NGU_HANH_DAYS = [];

const CHALLENGE_DAYS = NGU_HANH_DAYS.map(([num, title, lesson, focus]) => {
  const milestone = (num % 7 === 0) || num === 1;
  const description = `<h3>📖 Bài học ngày ${num}</h3>\n<p>${lesson}</p>`;
  const instructions = `<h3>🎯 Trọng tâm hôm nay</h3>\n<p>${focus}</p>\n${PROTOCOL_SOP}\n${SUBMIT_BLOCK}`;
  return [num, title, description, instructions, milestone ? 10 : 5];
});

const CHALLENGE_DAYS_TEACHER = [];

// ── Seed courses (Ngũ Hành) ──────────────────────────────────
// [title, description, cover_color, [ [lessonTitle, contentHTML, durationMin], ... ] ]
// ── Seed dữ liệu Ngũ Hành: thực phẩm + công thức ─────────────
// food: [name, element, color, taste, nature, organ, note]
const FOOD_SEED = [];

// recipe: [title, element_tags, buoi, summary, ingredients, steps, dung_khi, note]
const RECIPE_SEED = [];

const COURSE_SEED = [];

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  const SQL = await initSqlJs();
  const db  = new DB(SQL);
  communityName = () => {
    try {
      const row = db.get("SELECT value FROM site_settings WHERE key = 'community_name'");
      return (row && row.value && row.value.trim()) || COMMUNITY_NAME;
    } catch { return COMMUNITY_NAME; }
  };

  db.exec(SCHEMA);

  // Legacy single-key storage (admin_secrets, from before multi-provider support) — only
  // read once below to seed ai_providers on first boot, not used at runtime after that.
  function getOpenRouterKey() {
    const row = db.get("SELECT value FROM admin_secrets WHERE key = 'openrouter_api_key'");
    return (row && row.value) || OPENROUTER_KEY;
  }

  // One-time migration: turn whatever OpenRouter key was already configured (admin_secrets
  // or .env) into the first ai_providers row, so switching to the multi-provider model doesn't
  // interrupt the 3 AI features on an already-running deployment.
  if (db.get('SELECT COUNT(*) AS n FROM ai_providers').n === 0) {
    const legacyKey = getOpenRouterKey();
    if (legacyKey) {
      db.run(
        'INSERT INTO ai_providers (name, provider_type, api_key, model, is_active) VALUES (?,?,?,?,1)',
        ['OpenRouter (mặc định)', 'openrouter', legacyKey, 'google/gemini-2.5-flash']
      );
      console.log('  Migrated legacy OpenRouter key into ai_providers.');
    }
  }

  function getActiveAiProvider() {
    return db.get('SELECT * FROM ai_providers WHERE is_active = 1 LIMIT 1') || null;
  }

  function maskKey(key) {
    if (!key || key.length <= 8) return '****';
    return `${key.slice(0, 5)}...${key.slice(-4)}`;
  }

  // ── GoClaw Agent 1 ("An Lộ") webhook ────────────────────────
  // Calls the LLM webhook (mode=sync) created on the GoClaw dashboard for the
  // Thân-Tâm-Mệnh roadmap-drafting agent. Bearer auth (webhook has
  // require_hmac=false) — simplest, no signing needed. Returns { ok, text, error }.
  const GOCLAW_BASE_URL = process.env.GOCLAW_BASE_URL || '';
  const GOCLAW_WEBHOOK_SECRET = process.env.GOCLAW_WEBHOOK_SECRET || '';

  const THE_TRANG_VALUES = ['Nhiệt', 'Hàn', 'Hàn giả nhiệt', 'Nhiệt giả hàn'];

  // Cố định 11 "khu vực" cho bản đồ ưu tiên — khớp 1:1 với 11 nhãn `group` trên
  // các câu hỏi khảo sát (intake-than-tam-menh.html), để agent không tự đặt tên
  // tùy hứng mỗi lần chạy (không so sánh được giữa các khách hàng nếu tên đổi).
  const TTM_PRIORITY_AREAS = [
    'Hệ thần kinh & cơ xương khớp',
    'Giác quan & vùng đầu mặt',
    'Hệ tiêu hóa & bài tiết',
    'Thân nhiệt & mồ hôi',
    'Sinh hoạt, vận động & thói quen',
    'Hơi thở & sự lưu thông khí',
    'Áp lực công việc & sự nghiệp',
    'Tình cảm gia đình & không gian sống',
    'Bạn bè & các mối quan hệ xã hội',
    'Đầu tư, tài chính & nỗi lo tiền bạc',
    'Khả năng tự cân bằng',
  ];

  // ── Chương trình 377 ngày: khối nội dung tái sử dụng theo mùa/thể trạng ──
  // 6 mục cố định mỗi ngày (ăn uống, tập luyện, bát tà/bát phong/bát hư, quan
  // sát cơ thể, phong thủy, biết ơn). Ngày bắt đầu của mỗi người khác nhau nên
  // "ngày thứ N" rơi vào mùa khác nhau tùy người — nội dung được lắp ghép động
  // theo mùa thực tế + thể trạng, không gán cứng theo day_number.
  const PROGRAM377_BLOCK_CATEGORIES = [
    'an_uong',
    'tap_luyen',
    'bat_ta_bat_phong_bat_hu',
    'quan_sat_co_the',
    'phong_thuy',
    'biet_on',
  ];
  const PROGRAM377_SEASONS = ['xuan', 'ha', 'thu', 'dong'];

  // Ranh giới mùa theo quý dương lịch — mặc định tạm thời, có thể chỉnh lại 1
  // chỗ duy nhất nếu user muốn tính theo tiết khí thay vì quý dương lịch.
  const SEASON_MONTH_MAP = {
    1: 'dong', 2: 'xuan', 3: 'xuan', 4: 'xuan',
    5: 'ha', 6: 'ha', 7: 'ha',
    8: 'thu', 9: 'thu', 10: 'thu',
    11: 'dong', 12: 'dong',
  };
  function seasonForDate(dateStr) {
    const month = Number(String(dateStr).slice(5, 7));
    return SEASON_MONTH_MAP[month] || 'xuan';
  }

  // Hướng dẫn phân tích + cấu trúc output cho Agent 1 ("An Lộ"). Gửi kèm mỗi lần
  // gọi (không cấu hình trong GoClaw dashboard) để version-controlled và deploy
  // được qua quy trình chuẩn. Không được chẩn đoán bệnh — chỉ phân tích biểu
  // hiện khách tự khai báo trong khảo sát.
  function buildTtmAgentInstructions(summaryText) {
    return `[VAI TRÒ] Bạn là trợ lý phân tích khảo sát THÂN - TÂM - MỆNH. Bạn KHÔNG phải bác sĩ và KHÔNG được chẩn đoán bệnh. Bạn chỉ được: phân tích các biểu hiện khách tự khai báo, nhận diện mẫu hình lặp lại giữa nhiều câu trả lời, đánh giá mức độ ưu tiên cải thiện, đề xuất lộ trình chăm sóc sức khỏe tự nhiên, và khuyến nghị gặp chuyên gia y tế khi biểu hiện kéo dài/nghiêm trọng.

[NGUYÊN TẮC PHÂN TÍCH]
- Không phân tích từng câu rời rạc — tìm MẪU HÌNH xuyên suốt nhiều câu trả lời liên quan (ví dụ: cổ vai gáy + đau đầu + hơi thở nông + ít vận động → mô tả là "nhóm biểu hiện liên quan đến căng thẳng cơ thể và thói quen vận động", KHÔNG viết "bạn bị thoái hóa đốt sống cổ").
- Mỗi nhận định phải xếp vào 1 trong 3 mức: TÍN HIỆU TÍCH CỰC (không có biểu hiện khó chịu đáng kể — ghi nhận rõ, không cố tìm vấn đề), CẦN QUAN TÂM (biểu hiện lặp lại, thói quen chưa tối ưu — ưu tiên điều chỉnh lối sống), CẦN QUAN TÂM SỚM (biểu hiện thường xuyên/kéo dài, ảnh hưởng sinh hoạt rõ rệt — phải kèm câu: "Khảo sát này không thay thế thăm khám y tế. Nếu biểu hiện kéo dài, tăng dần hoặc ảnh hưởng sinh hoạt, bạn nên trao đổi trực tiếp với bác sĩ/chuyên gia y tế.").
- Nếu khách hàng phần lớn tích cực: KHÔNG bịa vấn đề để bán chương trình. Chuyển trọng tâm sang DUY TRÌ → CỦNG CỐ → PHÒNG NGỪA thay vì "sửa chữa".
- Khi tìm nguyên nhân, xét theo 5 nhóm: ăn uống, vận động, giấc ngủ & sinh hoạt, căng thẳng & tâm lý, môi trường sống. Không khẳng định một nguyên nhân duy nhất nếu dữ liệu không đủ — dùng "một số yếu tố có thể đang cùng góp phần...".
- Lộ trình cải thiện cá nhân hóa theo 4 giai đoạn: (1) Ổn định nền tảng (ăn uống, nước, ngủ, đại tiện, vận động nhẹ), (2) Thanh lọc & điều chỉnh (ăn uống theo chương trình, hỗ trợ bài tiết, theo dõi phản ứng cơ thể), (3) Khơi thông vận động (cơ xương khớp, cổ vai gáy, thắt lưng, hơi thở), (4) Duy trì lối sống (biến thành thói quen lâu dài). Không phải khách nào cũng cần cả 4 giai đoạn ở cùng mức độ — chỉ nhấn mạnh giai đoạn phù hợp nhất với vấn đề nổi bật của khách.
- Không dùng câu chẩn đoán ("bạn bị bệnh X", "bạn đang mắc X", "cơ quan X đang có vấn đề"). Dùng "bạn đang có biểu hiện...", "các câu trả lời gợi ý...", "đây là nhóm cần được quan tâm...".
- Văn phong: dễ hiểu, thân thiện, không hù dọa, không phán xét, không thuật ngữ y khoa khó hiểu, cá nhân hóa theo đúng câu trả lời của khách, ưu tiên hành động cụ thể.
- Chỉ dùng văn bản thuần (plain text) và ký tự Unicode thường (VD mũi tên →). KHÔNG dùng ký hiệu LaTeX/toán học (VD \\rightarrow, $...$) vì nội dung được hiển thị dạng text thô, không render được công thức.

[QUY TẮC ĂN UỐNG THEO NGŨ HÀNH — ưu tiên số 1 trong lộ trình, vận động là thứ yếu]
"Bệnh từ miệng mà vào" — ăn uống đúng cách theo Ngũ Hành là nền tảng để thải độc lục phủ ngũ tạng, LUÔN là phần quan trọng và cụ thể nhất trong lộ trình (mục 7 bên dưới), đứng trước phần vận động/tập luyện.
- Khung vị theo giờ trong ngày (áp dụng chung, chọn món cụ thể theo thể trạng Hàn/Nhiệt của khách):
  • Sáng: vị CHUA (ưu tiên thực phẩm màu xanh) + vị ĐẮNG (ưu tiên thực phẩm màu đỏ) + vị NGỌT (dùng đường/mật mía, KHÔNG dùng mật ong).
  • Trưa: ăn bình thường, ưu tiên vị CHUA + ĐẮNG.
  • Chiều: vị CAY (ưu tiên thực phẩm màu trắng) + vị MẶN (ưu tiên thực phẩm màu đen).
  • Vị CHÁT và chất béo: có thể bổ sung xen kẽ trong ngày.
- Mỗi vị thải độc cho một tạng riêng — LUÔN nêu rõ tạng được hỗ trợ khi gợi ý món ăn: Chua → Gan; Ngọt (đường/mật mía) → Dạ dày, Lá lách; Chát → Ruột; Cay → Phổi; Mặn → Thận; Đắng → Tim.
- Mỗi loại thực phẩm trong từng vị còn có tính Hàn hoặc Nhiệt riêng. Dựa vào THE_TRANG đã xác định: khách thuộc nhóm Nhiệt → ưu tiên thực phẩm tính Hàn/mát trong mỗi vị; khách thuộc nhóm Hàn → ưu tiên thực phẩm tính Nhiệt/ấm; Hàn giả nhiệt/Nhiệt giả hàn → ưu tiên món trung tính, cân bằng nhẹ nhàng. Vận dụng kiến thức Ngũ Hành ẩm thực đã có (theo từng hành Kim/Mộc/Thủy/Hỏa/Thổ, cẩm nang dinh dưỡng Ngũ Hành) để chọn đúng món ăn theo vị, màu sắc và tính hàn/nhiệt phù hợp — không chỉ liệt kê tên vị chung chung.

[ĐỊNH DẠNG TRẢ LỜI BẮT BUỘC — theo đúng thứ tự sau]

1. Dòng ĐẦU TIÊN PHẢI là: THE_TRANG: <một trong 4 loại: Nhiệt, Hàn, Hàn giả nhiệt, Nhiệt giả hàn> — xác định dựa trên các dấu hiệu Hàn/Nhiệt trong bảng trả lời (tay chân lạnh/ấm, sợ lạnh/sợ nóng, ra mồ hôi, màu nước tiểu, rêu lưỡi, nhiệt miệng, v.v.).

2. Ngay sau đó, xuất ĐÚNG khối sau (không thêm chữ nào trước/sau 2 dòng delimiter):
===BAN_DO_UU_TIEN_JSON===
[{"area": "<đúng 1 trong 11 khu vực bên dưới>", "status": "<mô tả ngắn 1 câu>", "priority": "Cao" | "Trung bình" | "Thấp"}, ...]
===HET_BAN_DO===
Phải liệt kê ĐỦ cả 11 khu vực sau (kể cả khu vực ổn định thì vẫn ghi, priority "Thấp"), không tự đặt tên khác, không bỏ sót, không thêm khu vực ngoài danh sách:
${TTM_PRIORITY_AREAS.map((a, i) => `${i + 1}. ${a}`).join('\n')}

3. Sau đó viết bản tổng hợp đầy đủ theo đúng cấu trúc sau (dùng đúng các tiêu đề số thứ tự này):
## 1. TỔNG QUAN SỨC KHỎE HIỆN TẠI (1-3 đoạn ngắn)
## 2. NHỮNG ĐIỂM ĐANG TỐT (3-5 điểm; nếu không đủ dữ liệu tích cực, ghi rõ khách có thể bắt đầu từ thay đổi nhỏ)
## 3. NHỮNG BIỂU HIỆN CẦN QUAN TÂM (tối đa 5 vấn đề, mỗi vấn đề nêu: biểu hiện, câu hỏi liên quan, mức độ, yếu tố có thể liên quan)
## 4. PHÂN TÍCH NGUYÊN NHÂN CÓ THỂ LIÊN QUAN (chia theo 5 nhóm: Ăn uống / Vận động / Ngủ nghỉ / Tâm lý-áp lực / Lối sống)
## 5. PHẦN TÂM (đánh giá công việc, gia đình, quan hệ xã hội, tài chính, khả năng tự cân bằng; kết luận 2-4 câu)
## 6. VẤN ĐỀ CẦN ƯU TIÊN (tối đa 3 ưu tiên)
## 7. LỘ TRÌNH CẢI THIỆN CÁ NHÂN — đây là phần quan trọng nhất, PHẢI cụ thể, không viết chung chung:
   a) 1-2 câu nêu giai đoạn nào (trong 4 giai đoạn ở trên) phù hợp nhất với khách, theo đúng tính chất Ngũ Hành ăn uống ở trên.
   b) Bắt buộc có một bảng thực đơn cụ thể theo khung giờ, viết đúng cú pháp bảng markdown (dòng tiêu đề, dòng "|---|---|---|---|", rồi các dòng dữ liệu) với 4 cột: "Bữa ăn" | "Gợi ý món ăn cụ thể" | "Vị & màu ưu tiên" | "Tạng được hỗ trợ". Liệt kê đủ: Sáng sớm, Bữa sáng, Bữa trưa, Bữa phụ, Bữa tối — món ăn phải cụ thể (tên món/thực phẩm thật), đã điều chỉnh tính hàn/nhiệt theo đúng THE_TRANG của khách, không chỉ ghi tên vị.
   c) Sau bảng thực đơn, thêm 1 đoạn ngắn về vận động/tập luyện bổ sung (thứ yếu, hỗ trợ thêm — không thay thế phần ăn uống ở trên).
## 8. 3 VIỆC NÊN BẮT ĐẦU NGAY (đúng 3 hành động cụ thể, đơn giản, thực hiện được ngay)
## 9. ĐIỀU CẦN THEO DÕI (các biểu hiện nên theo dõi trong quá trình thay đổi)
## 10. KHUYẾN NGHỊ AN TOÀN (câu cảnh báo y tế phù hợp theo mức độ ở trên; nếu không có dấu hiệu đáng chú ý vẫn ghi: "Bản khảo sát nhằm giúp bạn nhìn lại thói quen và biểu hiện sức khỏe hiện tại, không thay thế cho thăm khám y khoa.")

[BẢN TỔNG KẾT KHẢO SÁT]
${summaryText}`;
  }

  const PROGRAM377_BLOCK_CATEGORY_LABELS = {
    an_uong: 'Ăn uống theo Ngũ Hành',
    tap_luyen: 'Duy trì tập luyện / vận động',
    bat_ta_bat_phong_bat_hu: 'Bài trừ bát tà, bát phong, bát hư',
    quan_sat_co_the: 'Quan sát biểu hiện cơ thể',
    phong_thuy: 'Phong thuỷ nhà ở & tài chính',
    biet_on: '3 điều biết ơn mỗi ngày',
  };
  const PROGRAM377_SEASON_LABELS = { xuan: 'Xuân', ha: 'Hạ', thu: 'Thu', dong: 'Đông', all: 'Tất cả các mùa' };

  // Soạn nháp 1 khối nội dung của Chương trình 377 ngày, đúng 1 category, đúng
  // mùa, đúng thể trạng — admin sẽ đọc/sửa trước khi xuất bản, không tự động
  // hiển thị cho khách. Dùng cùng khung Ngũ Hành ăn uống đã áp dụng cho An Lộ.
  function buildProgram377BlockPrompt(category, season, theTrang) {
    const categoryLabel = PROGRAM377_BLOCK_CATEGORY_LABELS[category] || category;
    const seasonLabel = PROGRAM377_SEASON_LABELS[season] || season;
    const theTrangLabel = theTrang === 'all' ? 'mọi thể trạng (không phân biệt Hàn/Nhiệt)' : theTrang;

    let extra = '';
    if (category === 'an_uong') {
      extra = `
[QUY TẮC ĂN UỐNG THEO NGŨ HÀNH — bắt buộc áp dụng]
- Khung vị theo giờ trong ngày: Sáng vị CHUA (ưu tiên màu xanh) + ĐẮNG (ưu tiên màu đỏ) + NGỌT (đường/mật mía, KHÔNG dùng mật ong); Trưa ưu tiên CHUA + ĐẮNG; Chiều vị CAY (ưu tiên màu trắng) + MẶN (ưu tiên màu đen); CHÁT và chất béo bổ sung xen kẽ.
- Mỗi vị thải độc 1 tạng: Chua → Gan; Ngọt (mật mía) → Dạ dày, Lá lách; Chát → Ruột; Cay → Phổi; Mặn → Thận; Đắng → Tim — luôn nêu rõ tạng được hỗ trợ khi gợi ý món.
- Thể trạng ${theTrangLabel}: ${theTrang === 'Nhiệt' ? 'ưu tiên thực phẩm tính Hàn/mát trong mỗi vị' : theTrang === 'Hàn' ? 'ưu tiên thực phẩm tính Nhiệt/ấm trong mỗi vị' : theTrang === 'all' ? 'nêu rõ gợi ý riêng cho từng nhóm thể trạng (Nhiệt dùng món mát, Hàn dùng món ấm) thay vì chỉ 1 phương án chung' : 'ưu tiên món trung tính, cân bằng nhẹ nhàng'}.
- Mùa ${seasonLabel}: chọn thực phẩm/món ăn theo mùa thực tế (rau củ quả trái mùa, món giữ ấm/giải nhiệt phù hợp thời tiết mùa này).
- Đưa ra thực đơn CỤ THỂ (tên món/thực phẩm thật), không viết chung chung.`;
    } else if (category === 'tap_luyen') {
      extra = `\n[LƯU Ý] Vận động là thứ yếu, hỗ trợ thêm cho phần ăn uống — gợi ý bài tập nhẹ nhàng, cụ thể (tên bài tập, thời lượng), phù hợp mùa ${seasonLabel} và thể trạng ${theTrangLabel} (VD thể Hàn nên vận động buổi có nắng ấm, thể Nhiệt tránh vận động quá sức lúc nắng gắt).`;
    }

    return `[VAI TRÒ] Bạn là trợ lý soạn nội dung hướng dẫn hằng ngày cho "Chương trình 377 ngày" của AI AGENTS CC, dựa trên kiến thức Ngũ Hành (tham khảo các tài liệu Ngũ Hành đã có: ăn uống theo hành Thổ/Thủy/Hỏa/Kim/Mộc, cẩm nang dinh dưỡng Ngũ Hành 24h).

[NHIỆM VỤ] Soạn 1 khối nội dung ngắn gọn, thực tế, áp dụng được ngay hôm nay cho mục "${categoryLabel}", dành cho người có thể trạng: ${theTrangLabel}, vào mùa: ${seasonLabel}.
${extra}

[YÊU CẦU CHUNG]
- Văn phong thân thiện, dễ hiểu, không thuật ngữ y khoa khó hiểu, không chẩn đoán bệnh.
- Nội dung súc tích (đủ đọc trong 1-2 phút), có thể dùng danh sách gạch đầu dòng hoặc bảng markdown nếu cần liệt kê nhiều món/bài tập.
- Chỉ dùng văn bản thuần và ký tự Unicode thường. KHÔNG dùng ký hiệu LaTeX/toán học (VD \\rightarrow, $...$).
- Trả lời TRỰC TIẾP nội dung khối này — không thêm lời chào, không nhắc lại yêu cầu, không thêm tiêu đề "## ${categoryLabel}" (admin sẽ tự đặt tiêu đề khi lưu).`;
  }

  // Gọi thẳng webhook GoClaw (mode=sync) với 1 chuỗi input đã soạn sẵn — dùng
  // chung cho mọi agent gửi qua webhook này (An Lộ, và soạn nháp khối nội dung
  // 377 ngày), mỗi caller tự soạn instructions riêng trước khi gọi hàm này.
  async function callGoclawWebhook(inputText) {
    if (!GOCLAW_WEBHOOK_SECRET) {
      return { ok: false, error: 'Chưa cấu hình GOCLAW_WEBHOOK_SECRET trong .env' };
    }
    try {
      const body = JSON.stringify({ input: inputText, mode: 'sync' });

      const resp = await fetch(`${GOCLAW_BASE_URL}/v1/webhooks/llm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GOCLAW_WEBHOOK_SECRET}`,
        },
        body,
        // Callers no longer block a customer-facing request on this (see
        // /api/ttm/intake/save), so it's safe to give GoClaw generous room —
        // a full 29-question roadmap draft has been observed to genuinely
        // take longer than the old 35s budget while still completing fine.
        signal: AbortSignal.timeout(120000),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data) {
        return { ok: false, error: goclawErr(data, resp.status) };
      }
      return { ok: true, text: data.output || '' };
    } catch (err) {
      return { ok: false, error: `Không gọi được GoClaw: ${err.message}` };
    }
  }

  // Hướng dẫn bổ sung admin tự soạn (Admin → Kỹ thuật → Agent An Lộ / An Nhiên), gửi kèm đầu mỗi yêu cầu
  function withAiGuide(key, text) {
    const guide = String(db.get('SELECT value FROM site_settings WHERE key = ?', [key])?.value || '').trim().slice(0, 12000);
    if (!guide) return text;
    return '[HƯỚNG DẪN BỔ SUNG TỪ BAN TỔ CHỨC — luôn tuân theo khi nhận xét / tư vấn; '
      + 'không thay đổi định dạng trả lời bắt buộc (các dòng THE_TRANG / FLAG / REASON nếu được yêu cầu)]\n'
      + guide + '\n[HẾT HƯỚNG DẪN BỔ SUNG]\n\n' + text;
  }

  async function callGoclawAgent1(summaryText) {
    return callGoclawWebhook(withAiGuide('ai_guide_anlo', buildTtmAgentInstructions(summaryText)));
  }

  // ── GoClaw Agent 2 ("Đồng hành & Thúc đẩy lối sống") webhook ─
  // Same shape as callGoclawAgent1 but talks to a separate GoClaw agent/webhook
  // configured for daily meal-log coaching. Kept as its own const/secret so the
  // two agents can be rotated/disabled independently.
  const GOCLAW_AGENT2_WEBHOOK_SECRET = process.env.GOCLAW_AGENT2_WEBHOOK_SECRET || '';

  // Lỗi GoClaw → câu dễ hiểu (GoClaw trả error dạng object: { code, message }). Khoá API mô hình AI hết hạn / sai /
  // hết tiền → báo admin qua Telegram ngay (tối đa 1 lần / 6 giờ) vì khi đó MỌI nhận xét / lộ trình AI đều dừng.
  let goclawKeyAlertAt = 0;
  function goclawErr(data, status) {
    const raw = data && data.error;
    let msg = typeof raw === 'string' ? raw : (raw && (raw.message || JSON.stringify(raw))) || `GoClaw webhook lỗi (HTTP ${status})`;
    let key = '';
    if (/API key expired/i.test(msg)) key = 'Khoá API của mô hình AI (nhà cung cấp mô hình trong GoClaw) đã HẾT HẠN — tạo khoá mới trên OpenRouter rồi cập nhật trong GoClaw → Providers.';
    else if (/HTTP 402|insufficient|credits/i.test(msg)) key = 'Tài khoản mô hình AI đã HẾT TIỀN (credits) — nạp thêm trên OpenRouter.';
    else if (/HTTP 401|invalid_token|unauthorized/i.test(msg)) key = 'Khoá API của mô hình AI KHÔNG HỢP LỆ (HTTP 401) — kiểm tra khoá trong GoClaw → Providers.';
    if (key) {
      msg = key;
      if (Date.now() - goclawKeyAlertAt > 6 * 3600e3) {
        goclawKeyAlertAt = Date.now();
        try {
          const admins = db.all("SELECT telegram_chat_id FROM users WHERE is_admin = 1 AND status = 'active' AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''");
          admins.forEach(a => sendTelegramMessage(a.telegram_chat_id, '🚨 <b>AI đang ngừng hoạt động</b>\n' + key
            + '\n\nTrong lúc chờ: An Nhiên không nhận xét được báo cáo, An Lộ không soạn được lộ trình. Sửa xong, báo cáo 3 ngày gần nhất sẽ tự được nhận xét lại.').catch(() => {}));
        } catch (e) { console.error('[GoClaw] báo lỗi khoá:', e.message); }
      }
    }
    return String(msg).slice(0, 300);
  }

  async function callGoclawAgent2(summaryText) {
    if (!GOCLAW_AGENT2_WEBHOOK_SECRET) {
      return { ok: false, error: 'Chưa cấu hình GOCLAW_AGENT2_WEBHOOK_SECRET trong .env' };
    }
    try {
      const body = JSON.stringify({ input: withAiGuide('ai_guide_annhien', summaryText), mode: 'sync' });

      const resp = await fetch(`${GOCLAW_BASE_URL}/v1/webhooks/llm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GOCLAW_AGENT2_WEBHOOK_SECRET}`,
        },
        body,
        // An Nhiên đọc cả ngữ cảnh khách (lộ trình, 7 ngày gần nhất) — 35 giây hay bị quá giờ → chờ 90 giây
        signal: AbortSignal.timeout(90000),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data) {
        return { ok: false, error: goclawErr(data, resp.status) };
      }
      return { ok: true, text: data.output || '' };
    } catch (err) {
      return { ok: false, error: `Không gọi được GoClaw: ${err.message}` };
    }
  }

  // Agent 2 is instructed (see its AGENTS.md) to always answer in the form:
  //   FLAG: none|warning|urgent
  //   REASON: <short reason, blank if none>
  //   ---
  //   <customer-facing comment>
  // Parsed defensively — if the model drifts from the format, we fall back to
  // flag_level='none' and use the raw text as the feedback rather than losing it.
  // Robust on purpose: in practice the model doesn't reliably put FLAG/REASON
  // at the very start, or use "---" as the separator (seen: feedback text
  // first, then "FLAG:.../REASON:..." at the end after a "***" line). Rather
  // than requiring an exact anchored shape, find FLAG/REASON anywhere in the
  // text and strip them out (plus any --- / *** / ___ separator lines) so
  // the customer never sees the raw metadata.
  // Agent 1 ("An Lộ") được yêu cầu (trong wrappedInput ở callGoclawAgent1, và lý tưởng là cả trong
  // prompt cấu hình bên GoClaw) trả về dòng đầu THE_TRANG: <loại>. Parse robust như Agent 2: tìm marker
  // ở bất kỳ đâu trong text, không yêu cầu đúng vị trí — nếu agent không tuân thủ format thì trả về
  // theTrang=null thay vì làm hỏng nội dung lộ trình.
  // Bản đồ ưu tiên (Khu vực | Trạng thái | Ưu tiên) — agent xuất dưới dạng khối
  // JSON có delimiter cố định (yêu cầu trong buildTtmAgentInstructions), tách
  // riêng khỏi phần THE_TRANG và nội dung tự do. Parse robust: nếu agent trả
  // sai định dạng, priorityMap = null (không có bảng) thay vì làm hỏng cả
  // draft_content — không chặn luồng.
  function parseAgent1Response(raw) {
    const text = (raw || '').trim();
    const match = text.match(/THE_TRANG:\s*([^\n]+)/i);
    let theTrang = null;
    if (match) {
      const val = match[1].trim();
      theTrang = THE_TRANG_VALUES.find(v => v.toLowerCase() === val.toLowerCase()) || null;
    }

    let priorityMap = null;
    const mapMatch = text.match(/===BAN_DO_UU_TIEN_JSON===([\s\S]*?)===HET_BAN_DO===/);
    let withoutMap = text;
    if (mapMatch) {
      withoutMap = text.replace(mapMatch[0], '');
      try {
        const parsed = JSON.parse(mapMatch[1].trim());
        if (Array.isArray(parsed)) {
          const items = parsed.filter(it => it && typeof it.area === 'string' &&
            typeof it.status === 'string' && ['Cao', 'Trung bình', 'Thấp'].includes(it.priority));
          if (items.length) priorityMap = items;
        }
      } catch (e) { /* agent trả sai định dạng JSON — bỏ qua, không có bảng */ }
    }

    const content = withoutMap
      .replace(/^\s*THE_TRANG:.*$/im, '')
      .replace(/^\s*[-*_]{3,}\s*$/gm, '')
      // Model đôi khi phớt lờ yêu cầu "không dùng LaTeX" trong prompt và vẫn
      // chèn $\rightarrow$ / \rightarrow — chặn ở tầng parse cho chắc, không
      // phụ thuộc hoàn toàn vào việc model tuân thủ đúng mỗi lần.
      .replace(/\$?\\rightarrow\$?/g, '→')
      .replace(/\$?\\leftarrow\$?/g, '←')
      .replace(/\$?\\Rightarrow\$?/g, '⇒')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { theTrang, content, priorityMap };
  }

  function parseAgent2Response(raw) {
    const text = (raw || '').trim();
    // Chấp nhận cả dạng in đậm "**FLAG:** warning" và đặt ở cuối tin (An Nhiên đôi khi viết vậy)
    const flagMatch = text.match(/\**[ \t]*FLAG[ \t]*:?[ \t]*\**[ \t]*(none|warning|urgent)/i);
    const reasonMatch = text.match(/\**[ \t]*REASON[ \t]*:?[ \t]*\**[ \t]*([^\n]*)/i);
    const feedback = text
      .replace(/^[ \t]*\**[ \t]*FLAG[ \t]*:.*$/gim, '')
      .replace(/^[ \t]*\**[ \t]*REASON[ \t]*:.*$/gim, '')
      .replace(/^[ \t]*\**[ \t]*THE_TRANG[ \t]*:.*$/gim, '') // dòng kỹ thuật, không cho khách thấy
      .replace(/^\s*[-*_]{3,}\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return {
      flagLevel: flagMatch ? flagMatch[1].toLowerCase() : 'none',
      flaggedReason: reasonMatch ? reasonMatch[1].trim() : '',
      feedback,
    };
  }

  // ── Telegram Bot API ──────────────────────────────────────────
  // Outbound push only (reminders + Agent 2 feedback + admin alerts). The only
  // inbound handling is the /start <code> account-link command (see the
  // /api/telegram/webhook route below) — customers don't free-chat with the bot.
  const TELEGRAM_BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN    || '';
  const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';

  async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return { ok: false };
    // Lỗi mạng / Telegram bận (5xx, 429) → thử lại tối đa 3 lần; lỗi do người nhận (chặn bot…) thì dừng
    let out;
    for (let i = 0; i < 3; i++) {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
          signal: AbortSignal.timeout(15000),
        });
        out = await resp.json().catch(() => ({ ok: false, error_code: resp.status }));
      } catch (err) {
        out = { ok: false, error: err.message };
      }
      if (out.ok) return out;
      const transient = out.error_code === 429 || out.error_code >= 500 || !out.error_code;
      if (!transient || i === 2) break;
      await new Promise(res => setTimeout(res, out.error_code === 429 ? Math.min(30, Number(out.parameters?.retry_after) || 5) * 1000 : (i === 0 ? 2000 : 5000)));
    }
    return out;
  }

  // Unified chat call across providers. `messages` is OpenAI-style [{role, content}] (role:
  // system/user/assistant) — the shape every caller already builds. Returns a normalized
  // { ok, text, truncated, error } regardless of which provider actually served the request.
  async function callAiChat({ messages, maxTokens, disableReasoning = false }) {
    const provider = getActiveAiProvider();
    if (!provider) return { ok: false, error: 'Chưa cấu hình API AI. Vào Cài đặt > AI để thêm.' };

    if (provider.provider_type === 'google_ai_studio') {
      return callGoogleAiStudio({ provider, messages, maxTokens, disableReasoning });
    }
    return callOpenRouterChat({ provider, messages, maxTokens, disableReasoning });
  }

  async function callOpenRouterChat({ provider, messages, maxTokens, disableReasoning }) {
    try {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key}`,
          'HTTP-Referer': SITE_URL,
          'X-Title': COMMUNITY_NAME_ASCII,
        },
        body: JSON.stringify({
          model: provider.model || 'google/gemini-2.5-flash',
          max_tokens: maxTokens,
          ...(disableReasoning ? { reasoning: { enabled: false } } : {}),
          messages,
        }),
      });
      if (!apiRes.ok) {
        const errText = await apiRes.text();
        console.error('[AI/OpenRouter] error:', apiRes.status, errText);
        return { ok: false, error: 'AI service error' };
      }
      const data = await apiRes.json();
      const choice = data.choices?.[0];
      return { ok: true, text: choice?.message?.content || '', truncated: choice?.finish_reason === 'length' };
    } catch (err) {
      console.error('[AI/OpenRouter] Error:', err.message);
      return { ok: false, error: err.message };
    }
  }

  async function callGoogleAiStudio({ provider, messages, maxTokens, disableReasoning }) {
    // 'gemini-2.5-flash' (dated model) has been restricted for new API keys/projects by
    // Google ("no longer available to new users") — the -latest alias always points to
    // whatever flash model Google currently supports, avoiding this going stale again.
    const model = provider.model || 'gemini-flash-latest';
    const systemMsg = messages.find(m => m.role === 'system');
    // content có thể là chuỗi, hoặc mảng kiểu OpenRouter [{type:'text'}, {type:'image_url'}, {type:'file'}]
    // (AI đọc phiếu Hồ sơ y khoa) → đổi sang parts của Gemini (text / inline_data).
    const toParts = c => !Array.isArray(c) ? [{ text: c }] : c.map(x => {
      if (x.type === 'text') return { text: x.text };
      const url = x.type === 'image_url' ? x.image_url?.url : x.file?.file_data;
      const m = String(url || '').match(/^data:([^;]+);base64,(.+)$/);
      return m ? { inline_data: { mime_type: m[1], data: m[2] } } : { text: '' };
    });
    const turns = messages.filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toParts(m.content) }));
    const body = {
      contents: turns,
      generationConfig: {
        maxOutputTokens: maxTokens,
        // thinkingConfig.thinkingBudget:0 (the Gemini 2.5-era way to disable thinking) is
        // rejected as INVALID_ARGUMENT on newer models — confirmed against the real key/model
        // in production that thinkingLevel:"LOW" is what actually drives thinking tokens to 0
        // now ("NONE" is rejected too).
        ...(disableReasoning ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {}),
      },
    };
    if (systemMsg) body.system_instruction = { parts: [{ text: systemMsg.content }] };

    try {
      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.api_key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!apiRes.ok) {
        const errText = await apiRes.text();
        console.error('[AI/GoogleAIStudio] error:', apiRes.status, errText);
        return { ok: false, error: 'AI service error' };
      }
      const data = await apiRes.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.map(p => p.text || '').join('') || '';
      return { ok: true, text, truncated: candidate?.finishReason === 'MAX_TOKENS' };
    } catch (err) {
      console.error('[AI/GoogleAIStudio] Error:', err.message);
      return { ok: false, error: err.message };
    }
  }

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
  if (!notifCols.includes('icon')) {
    db.exec('ALTER TABLE notifications ADD COLUMN icon TEXT');
    console.log('  Migrated notifications: added icon.');
  }

  // Migrate users: add intake_profile
  const userCols = db.all('PRAGMA table_info(users)').map(c => c.name);
  // Xác nhận Nội quy cộng đồng: phiên bản nội quy thành viên đã đồng ý (so với site_settings.rules_version)
  if (!userCols.includes('rules_accepted_version')) {
    db.exec('ALTER TABLE users ADD COLUMN rules_accepted_version INTEGER DEFAULT 0');
    db.exec('ALTER TABLE users ADD COLUMN rules_accepted_at TEXT');
    console.log('  Migrated users: added rules_accepted_version, rules_accepted_at.');
  }
  if (!userCols.includes('intake_profile')) {
    db.exec('ALTER TABLE users ADD COLUMN intake_profile TEXT');
    db.exec('ALTER TABLE users ADD COLUMN intake_done_at TEXT');
    console.log('  Migrated users: added intake_profile.');
  }
  // Migrate users: add ttm_intake_done_at (Thân-Tâm-Mệnh intake — dùng để
  // bắt buộc redirect khách mới chưa làm khảo sát 29 câu trước khi dùng site)
  if (!userCols.includes('ttm_intake_done_at')) {
    db.exec('ALTER TABLE users ADD COLUMN ttm_intake_done_at TEXT');
    console.log('  Migrated users: added ttm_intake_done_at.');
  }
  // Migrate users: add Telegram link fields (Agent 2 coaching — reminders,
  // meal-log feedback, admin escalation alerts are pushed via Telegram)
  if (!userCols.includes('telegram_chat_id')) {
    db.exec('ALTER TABLE users ADD COLUMN telegram_chat_id TEXT');
    db.exec('ALTER TABLE users ADD COLUMN telegram_link_code TEXT');
    db.exec('ALTER TABLE users ADD COLUMN telegram_link_code_expires_at TEXT');
    console.log('  Migrated users: added telegram_chat_id + link code fields.');
  }
  // Người nhận cảnh báo An Nhiên qua Telegram mà KHÔNG cần quyền admin (coach, trợ lý…)
  if (!db.all('PRAGMA table_info(users)').some(c => c.name === 'agent2_alert_recipient')) {
    db.exec('ALTER TABLE users ADD COLUMN agent2_alert_recipient INTEGER DEFAULT 0');
    console.log('  Migrated users: added agent2_alert_recipient.');
  }
  // Người xem & duyệt lộ trình An Lộ — đăng nhập admin.html nhưng CHỈ thấy trang duyệt lộ trình
  if (!db.all('PRAGMA table_info(users)').some(c => c.name === 'agent1_reviewer')) {
    db.exec('ALTER TABLE users ADD COLUMN agent1_reviewer INTEGER DEFAULT 0');
    console.log('  Migrated users: added agent1_reviewer.');
  }
  // Tắt riêng tin Telegram "An Lộ soạn xong lộ trình" cho 1 admin/người duyệt (vẫn giữ quyền duyệt)
  if (!db.all('PRAGMA table_info(users)').some(c => c.name === 'agent1_notify_off')) {
    db.exec('ALTER TABLE users ADD COLUMN agent1_notify_off INTEGER DEFAULT 0');
    console.log('  Migrated users: added agent1_notify_off.');
  }
  // ── Múi giờ từng thành viên: nhắc nhở theo giờ địa phương (khách ở nước ngoài) ──
  const VN_TZ = 'Asia/Ho_Chi_Minh';
  const tzValid = tz => { if (!tz || typeof tz !== 'string' || tz.length > 64) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
  const tzOf = tz => tzValid(tz) ? tz : VN_TZ;
  const tzParts = (tz, when = new Date()) => {
    const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tzOf(tz), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(when).forEach(x => { p[x.type] = x.value; });
    return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, minute: +p.minute, hm: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` };
  };
  // Giờ VN (ngày + "HH:MM") → nhãn giờ địa phương, vd "06:00 giờ của bạn" (null nếu người xem ở giờ VN)
  const vnToLocalLabel = (date, time, tz) => {
    if (!time || tzOf(tz) === VN_TZ) return null;
    const [y, m, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
    const p = tzParts(tz, new Date(Date.UTC(y, m - 1, d, h - 7, mi)));
    return `${p.hm}${p.date !== date ? ' ngày ' + p.date.slice(8, 10) + '/' + p.date.slice(5, 7) : ''} giờ của bạn`;
  };

  // Agent An Tâm (bot Telegram vận hành riêng): kết nối Telegram riêng + quyền nhận tin / bấm duyệt
  {
    const cols = db.all('PRAGMA table_info(users)').map(c => c.name);
    [['antam_chat_id', 'TEXT'], ['antam_link_code', 'TEXT'], ['antam_link_expires', 'TEXT'],
     ['antam_recipient', 'INTEGER DEFAULT 0'], ['antam_can_approve', 'INTEGER DEFAULT 0'], ['antam_notify_off', 'INTEGER DEFAULT 0'],
     ['antam_can_email', 'INTEGER'],   // quyền gửi email khách qua An Tâm — NULL: admin mặc định có, người khác không
     ['timezone', 'TEXT']]             // múi giờ của thành viên (vd America/Los_Angeles) — NULL = giờ Việt Nam
      .forEach(([c, t]) => { if (!cols.includes(c)) { db.exec(`ALTER TABLE users ADD COLUMN ${c} ${t}`); console.log(`  Migrated users: added ${c}.`); } });
    db.exec(`CREATE TABLE IF NOT EXISTS task_digest_log (user_id INTEGER NOT NULL, d TEXT NOT NULL, UNIQUE(user_id, d))`);
    db.exec(`CREATE TABLE IF NOT EXISTS antam_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref_id TEXT NOT NULL,
      chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, text TEXT, resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')))`);
    db.exec(`CREATE TABLE IF NOT EXISTS antam_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref_id TEXT NOT NULL, action TEXT NOT NULL,
      by_user_id INTEGER, via TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))`);
  }

  // Admin tắt riêng tin cảnh báo An Nhiên (người không phải admin thì dùng agent2_alert_recipient)
  if (!db.all('PRAGMA table_info(users)').some(c => c.name === 'agent2_notify_off')) {
    db.exec('ALTER TABLE users ADD COLUMN agent2_notify_off INTEGER DEFAULT 0');
    console.log('  Migrated users: added agent2_notify_off.');
  }

  // Migrate meal_logs: add Agent 2 AI feedback + warning-flag fields
  const mealLogCols = db.all('PRAGMA table_info(meal_logs)').map(c => c.name);
  if (!mealLogCols.includes('ai_feedback')) {
    db.exec('ALTER TABLE meal_logs ADD COLUMN ai_feedback TEXT');
    db.exec("ALTER TABLE meal_logs ADD COLUMN flag_level TEXT");
    db.exec('ALTER TABLE meal_logs ADD COLUMN flagged_reason TEXT');
    db.exec('ALTER TABLE meal_logs ADD COLUMN agent2_notified_at TEXT');
    db.exec('ALTER TABLE meal_logs ADD COLUMN admin_notified_at TEXT');
    console.log('  Migrated meal_logs: added ai_feedback + flag fields.');
  }

  // Migrate posts: add space_id
  const locationCols = db.all('PRAGMA table_info(locations)').map(c => c.name);
  if (!locationCols.includes('open_time')) {
    db.exec('ALTER TABLE locations ADD COLUMN open_time TEXT');
    db.exec('ALTER TABLE locations ADD COLUMN close_time TEXT');
    console.log('  Migrated locations: added open_time, close_time.');
  }
  const postCols = db.all('PRAGMA table_info(posts)').map(c => c.name);
  if (!postCols.includes('space_id')) {
    db.exec('ALTER TABLE posts ADD COLUMN space_id INTEGER REFERENCES spaces(id)');
    console.log('  Migrated posts: added space_id.');
  }
  // Migrate posts: add topic_id + rich embed fields (image/video/doc/gif links, poll)
  if (!postCols.includes('topic_id')) {
    db.exec('ALTER TABLE posts ADD COLUMN topic_id INTEGER REFERENCES topics(id)');
    console.log('  Migrated posts: added topic_id.');
  }
  if (!postCols.includes('image_url')) {
    db.exec('ALTER TABLE posts ADD COLUMN image_url TEXT');
    console.log('  Migrated posts: added image_url.');
  }
  if (!postCols.includes('video_url')) {
    db.exec('ALTER TABLE posts ADD COLUMN video_url TEXT');
    console.log('  Migrated posts: added video_url.');
  }
  if (!postCols.includes('doc_url')) {
    db.exec('ALTER TABLE posts ADD COLUMN doc_url TEXT');
    console.log('  Migrated posts: added doc_url.');
  }
  if (!postCols.includes('gif_url')) {
    db.exec('ALTER TABLE posts ADD COLUMN gif_url TEXT');
    console.log('  Migrated posts: added gif_url.');
  }
  if (!postCols.includes('poll_question')) {
    db.exec('ALTER TABLE posts ADD COLUMN poll_question TEXT');
    console.log('  Migrated posts: added poll_question.');
  }
  if (!postCols.includes('poll_options')) {
    db.exec('ALTER TABLE posts ADD COLUMN poll_options TEXT');
    console.log('  Migrated posts: added poll_options.');
  }
  // Admin ẩn bài (vẫn giữ trong DB) + thời điểm sửa gần nhất
  if (!postCols.includes('hidden')) {
    db.exec('ALTER TABLE posts ADD COLUMN hidden INTEGER DEFAULT 0');
    db.exec('ALTER TABLE posts ADD COLUMN updated_at TEXT');
    console.log('  Migrated posts: added hidden, updated_at.');
  }
  // Bài admin chọn làm "bài giới thiệu" ở khung 8 buổi / 377 ngày trên Feed (người chưa tham gia thấy 1/2 nội dung)
  if (!postCols.includes('showcase')) {
    db.exec('ALTER TABLE posts ADD COLUMN showcase INTEGER DEFAULT 0');
    console.log('  Migrated posts: added showcase.');
  }
  // Link ảnh Google Drive dạng "uc?export=view" / ".../file/d/ID/view" không hiển thị trong <img>
  // → đổi sang endpoint thumbnail (idempotent: chỉ đụng các link chưa đổi)
  ['image_url', 'gif_url'].forEach(col => {
    db.all(`SELECT id, ${col} AS url FROM posts WHERE ${col} LIKE '%drive.google.com%' AND ${col} NOT LIKE '%/thumbnail?%'`)
      .forEach(r => {
        const fixed = driveImageUrl(r.url);
        if (fixed !== r.url) db.run(`UPDATE posts SET ${col} = ? WHERE id = ?`, [fixed, r.id]);
      });
  });

  // Migrate courses: add space_id (course shows in a member's sidebar only if they belong to this space)
  const courseCols = db.all('PRAGMA table_info(courses)').map(c => c.name);
  if (!courseCols.includes('space_id')) {
    db.exec('ALTER TABLE courses ADD COLUMN space_id INTEGER REFERENCES spaces(id)');
    console.log('  Migrated courses: added space_id.');
  }

  // Migrate courses: add group_id (attach a course to a whole Space Group instead of a single Space —
  // anyone approved in ANY space under that group can see the course)
  if (!courseCols.includes('group_id')) {
    db.exec('ALTER TABLE courses ADD COLUMN group_id INTEGER REFERENCES space_groups(id)');
    console.log('  Migrated courses: added group_id.');
  }

  // Migrate courses: add visibility (public = enroll instantly, private = must pay via a linked product)
  if (!courseCols.includes('visibility')) {
    db.exec("ALTER TABLE courses ADD COLUMN visibility TEXT DEFAULT 'public'");
    console.log('  Migrated courses: added visibility.');
  }
  if (!courseCols.includes('price')) {
    db.exec('ALTER TABLE courses ADD COLUMN price INTEGER DEFAULT 0');
    console.log('  Migrated courses: added price.');
  }
  if (!courseCols.includes('compare_price')) {
    db.exec('ALTER TABLE courses ADD COLUMN compare_price INTEGER DEFAULT 0');
    console.log('  Migrated courses: added compare_price.');
  }
  // Khoá riêng tư CÓ PHÍ: 'payment' = thanh toán qua checkout, 'approval' = gửi yêu cầu, admin duyệt.
  // (Riêng tư 0đ luôn là admin duyệt; công khai luôn vào học ngay — xem courseJoinMode.)
  if (!courseCols.includes('private_access')) {
    db.exec("ALTER TABLE courses ADD COLUMN private_access TEXT DEFAULT 'payment'");
    console.log('  Migrated courses: added private_access.');
  }

  // Migrate products: add course_id — a product can represent the paid checkout for a private course.
  // Completing this product's order auto-enrolls the buyer into the course.
  const productCols = db.all('PRAGMA table_info(products)').map(c => c.name);
  if (!productCols.includes('course_id')) {
    db.exec('ALTER TABLE products ADD COLUMN course_id INTEGER REFERENCES courses(id)');
    console.log('  Migrated products: added course_id.');
  }
  if (!productCols.includes('compare_price')) {
    db.exec('ALTER TABLE products ADD COLUMN compare_price INTEGER DEFAULT 0');
    console.log('  Migrated products: added compare_price.');
  }
  if (!productCols.includes('detail_url')) {
    db.exec('ALTER TABLE products ADD COLUMN detail_url TEXT');
    console.log('  Migrated products: added detail_url.');
  }
  if (!productCols.includes('is_featured')) {
    db.exec('ALTER TABLE products ADD COLUMN is_featured INTEGER DEFAULT 0');
    console.log('  Migrated products: added is_featured.');
  }
  // Sản phẩm gói Coach 1-1 — hoàn tất đơn hàng sẽ cộng số buổi này vào
  // coaching_credits của người mua (song song với course_id ở trên).
  if (!productCols.includes('coaching_sessions')) {
    db.exec('ALTER TABLE products ADD COLUMN coaching_sessions INTEGER');
    console.log('  Migrated products: added coaching_sessions.');
  }

  // Migrate course_lessons: add status (draft/published, independent from the parent course's status)
  const lessonCols = db.all('PRAGMA table_info(course_lessons)').map(c => c.name);
  if (!lessonCols.includes('status')) {
    db.exec("ALTER TABLE course_lessons ADD COLUMN status TEXT DEFAULT 'published'");
    console.log('  Migrated course_lessons: added status.');
  }

  // Migrate course_lessons: add module_id (groups lessons into modules/chapters)
  if (!lessonCols.includes('module_id')) {
    db.exec('ALTER TABLE course_lessons ADD COLUMN module_id INTEGER REFERENCES course_modules(id)');
    console.log('  Migrated course_lessons: added module_id.');
  }

  // Migrate course_lessons: add AI-graded exercise fields
  if (!lessonCols.includes('exercise_enabled')) {
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_enabled INTEGER DEFAULT 0');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_prompt TEXT');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_rubric TEXT');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_max_score INTEGER DEFAULT 100');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_pass_score INTEGER DEFAULT 70');
    db.exec('ALTER TABLE course_lessons ADD COLUMN exercise_xp_reward INTEGER DEFAULT 0');
    console.log('  Migrated course_lessons: added AI exercise fields.');
  }

  // Migrate course_lessons: add exercise_type ('text' = AI-graded free text, 'quiz' = auto-graded multiple choice)
  if (!lessonCols.includes('exercise_type')) {
    db.exec("ALTER TABLE course_lessons ADD COLUMN exercise_type TEXT DEFAULT 'text'");
    console.log('  Migrated course_lessons: added exercise_type.');
  }
  // exercise_type='link' — bài tập không AI chấm, chỉ hướng dẫn + link, chọn từ
  // thư viện assignments dùng chung với nội dung 377 ngày.
  if (!lessonCols.includes('linked_assignment_id')) {
    db.exec('ALTER TABLE course_lessons ADD COLUMN linked_assignment_id INTEGER REFERENCES assignments(id)');
    console.log('  Migrated course_lessons: added linked_assignment_id.');
  }

  // Migrate lesson_exercise_submissions: add teacher workflow fields (resubmit request / manual final grade)
  const lesCols = db.all('PRAGMA table_info(lesson_exercise_submissions)').map(c => c.name);
  if (!lesCols.includes('status')) {
    db.exec("ALTER TABLE lesson_exercise_submissions ADD COLUMN status TEXT DEFAULT 'graded'");
    db.exec('ALTER TABLE lesson_exercise_submissions ADD COLUMN teacher_note TEXT');
    console.log('  Migrated lesson_exercise_submissions: added status, teacher_note.');
  }

  // Migrate course_lessons: link to a shared IELTS test-bank entry (ielts_tests), replacing
  // the ad-hoc exercise_* fields for that lesson when set — see server.js docs near the submit endpoint.
  if (!lessonCols.includes('ielts_test_id')) {
    db.exec('ALTER TABLE course_lessons ADD COLUMN ielts_test_id INTEGER REFERENCES ielts_tests(id)');
    console.log('  Migrated course_lessons: added ielts_test_id.');
  }

  // Migrate lesson_exercise_submissions: add IELTS Writing band-score feedback (null unless
  // the graded exercise is an attached IELTS Writing test)
  if (!lesCols.includes('ielts_band_feedback')) {
    db.exec('ALTER TABLE lesson_exercise_submissions ADD COLUMN ielts_band_feedback TEXT');
    console.log('  Migrated lesson_exercise_submissions: added ielts_band_feedback.');
  }

  // Migrate ielts_tests: add chatgpt_url for the Speaking skill (link students open to
  // practice speaking with an AI chatbot). Listening reuses the existing `passages` JSON
  // column — each passage gets an optional video_url instead of body_html.
  const ieltsTestCols = db.all('PRAGMA table_info(ielts_tests)').map(c => c.name);
  if (!ieltsTestCols.includes('chatgpt_url')) {
    db.exec('ALTER TABLE ielts_tests ADD COLUMN chatgpt_url TEXT');
    console.log('  Migrated ielts_tests: added chatgpt_url.');
  }

  // Migrate users: add is_admin (community-level admin, separate from ADMIN_KEY back office)
  const userCols2 = db.all('PRAGMA table_info(users)').map(c => c.name);
  if (!userCols2.includes('is_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
    console.log('  Migrated users: added is_admin.');
  }

  // Migrate users: add editable profile fields (bio, location, social_links as JSON)
  if (!userCols2.includes('bio')) {
    db.exec('ALTER TABLE users ADD COLUMN bio TEXT');
    db.exec('ALTER TABLE users ADD COLUMN location TEXT');
    db.exec('ALTER TABLE users ADD COLUMN social_links TEXT');
    console.log('  Migrated users: added bio, location, social_links.');
  }
  if (!userCols2.includes('phone')) {
    db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    console.log('  Migrated users: added phone.');
  }

  // Migrate users: add admin_pin_hash (2nd factor PIN for community admins logging into admin.html)
  if (!userCols2.includes('admin_pin_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN admin_pin_hash TEXT');
    console.log('  Migrated users: added admin_pin_hash.');
  }

  // Migrate spaces: add group_id, backfill a default group for ungrouped spaces
  const spaceCols = db.all('PRAGMA table_info(spaces)').map(c => c.name);
  if (!spaceCols.includes('group_id')) {
    db.exec('ALTER TABLE spaces ADD COLUMN group_id INTEGER REFERENCES space_groups(id)');
    console.log('  Migrated spaces: added group_id.');
  }
  const ungroupedCount = db.get('SELECT COUNT(*) AS n FROM spaces WHERE group_id IS NULL').n;
  if (ungroupedCount > 0) {
    let defaultGroup = db.get("SELECT id FROM space_groups WHERE name = 'Chung'");
    if (!defaultGroup) {
      const r = db.run("INSERT INTO space_groups (name, order_num) VALUES ('Chung', 0)");
      defaultGroup = { id: r.lastInsertRowid };
    }
    db.run('UPDATE spaces SET group_id = ? WHERE group_id IS NULL', [defaultGroup.id]);
    console.log(`  Migrated ${ungroupedCount} ungrouped space(s) into default group "Chung".`);
  }
  if (!spaceCols.includes('allow_join_requests')) {
    db.exec('ALTER TABLE spaces ADD COLUMN allow_join_requests INTEGER DEFAULT 1');
    console.log('  Migrated spaces: added allow_join_requests.');
  }

  // Migrate ttm_roadmaps: add reviewed_by (ai đã duyệt/từ chối lộ trình)
  const ttmRoadmapCols = db.all('PRAGMA table_info(ttm_roadmaps)').map(c => c.name);
  if (!ttmRoadmapCols.includes('reviewed_by')) {
    db.exec('ALTER TABLE ttm_roadmaps ADD COLUMN reviewed_by INTEGER REFERENCES users(id)');
    console.log('  Migrated ttm_roadmaps: added reviewed_by.');
  }
  if (!ttmRoadmapCols.includes('the_trang')) {
    db.exec('ALTER TABLE ttm_roadmaps ADD COLUMN the_trang TEXT');
    console.log('  Migrated ttm_roadmaps: added the_trang.');
  }
  if (!ttmRoadmapCols.includes('priority_map_json')) {
    db.exec('ALTER TABLE ttm_roadmaps ADD COLUMN priority_map_json TEXT');
    console.log('  Migrated ttm_roadmaps: added priority_map_json.');
  }

  // Migrate program377_reports: thêm cột AI feedback (An Nhiên nhận xét thay đổi sức khỏe
  // dựa trên hồ sơ/lộ trình + báo cáo hằng ngày — tab "Kết quả" ở trang khách).
  if (!db.all('PRAGMA table_info(manual_email_log)').some(c => c.name === 'via')) db.exec("ALTER TABLE manual_email_log ADD COLUMN via TEXT DEFAULT 'web'");

  // Hồ sơ y khoa: thời điểm khách đồng ý cho lưu dữ liệu sức khoẻ + có cho AI đọc phiếu không
  const hrUserCols = db.all('PRAGMA table_info(users)').map(c => c.name);
  if (!hrUserCols.includes('health_consent_at')) db.exec('ALTER TABLE users ADD COLUMN health_consent_at TEXT');
  if (!hrUserCols.includes('health_ai_consent')) db.exec('ALTER TABLE users ADD COLUMN health_ai_consent INTEGER DEFAULT 0');

  const p377ReportCols = db.all('PRAGMA table_info(program377_reports)').map(c => c.name);
  ['ai_feedback', 'flag_level', 'flagged_reason', 'agent2_notified_at', 'gratitude_1', 'gratitude_2', 'gratitude_3',
   'meal_breakfast_img', 'meal_lunch_img', 'meal_dinner_img', 'feeling_video_url',
   // Theo dõi lần gọi An Nhiên (tự thử lại khi lỗi) + ai viết nhận xét ('admin' = Ban tổ chức tự nhận xét)
   'ai_attempts', 'ai_error', 'ai_last_try', 'ai_fail_notified', 'feedback_by'].forEach((col) => {
    if (!p377ReportCols.includes(col)) {
      db.exec(`ALTER TABLE program377_reports ADD COLUMN ${col} TEXT`);
      console.log(`  Migrated program377_reports: added ${col}.`);
    }
  });
  // Cân nặng (kg) trong báo cáo hằng ngày 377 ngày
  if (!p377ReportCols.includes('weight_kg')) db.exec('ALTER TABLE program377_reports ADD COLUMN weight_kg REAL');

  // Migrate program377_sessions: giờ học (vd "20:00 - 21:30 (Zoom mở lúc 19:45)") — hiển thị như trang 8 buổi
  const p377SessCols = db.all('PRAGMA table_info(program377_sessions)').map(c => c.name);
  if (!p377SessCols.includes('session_time')) {
    db.exec('ALTER TABLE program377_sessions ADD COLUMN session_time TEXT');
    console.log('  Migrated program377_sessions: added session_time.');
  }
  // Nội dung buổi soạn bằng khung soạn thảo (HTML) — giống 8 buổi
  if (!p377SessCols.includes('content_html')) {
    db.exec('ALTER TABLE program377_sessions ADD COLUMN content_html TEXT');
    console.log('  Migrated program377_sessions: added content_html.');
  }
  // Bài tập sau buổi: lời hướng dẫn + danh sách bài chọn từ Thư viện bài tập (JSON mảng id)
  if (!p377SessCols.includes('hw_note')) db.exec('ALTER TABLE program377_sessions ADD COLUMN hw_note TEXT');
  if (!p377SessCols.includes('hw_ids')) db.exec('ALTER TABLE program377_sessions ADD COLUMN hw_ids TEXT');

  // Migrate program377_days: thêm liên kết bài học (mục II.1 — "chọn trong danh
  // sách bài học" — liên kết tới 1 course_lessons có sẵn cho ngày đó).
  const p377DaysCols = db.all('PRAGMA table_info(program377_days)').map(c => c.name);
  if (!p377DaysCols.includes('linked_lesson_id')) {
    db.exec('ALTER TABLE program377_days ADD COLUMN linked_lesson_id INTEGER REFERENCES course_lessons(id)');
    console.log('  Migrated program377_days: added linked_lesson_id.');
  }
  if (!p377DaysCols.includes('linked_assignment_id')) {
    db.exec('ALTER TABLE program377_days ADD COLUMN linked_assignment_id INTEGER REFERENCES assignments(id)');
    console.log('  Migrated program377_days: added linked_assignment_id.');
  }
  // Cho phép admin ghim cứng 1 khối cụ thể cho 1 trong 6 mục của riêng ngày này
  // (VD muốn đúng khối "Ăn uống — Xuân — Nhiệt" bất kể mùa/thể trạng thật của
  // khách) — JSON { [category]: blockId }. Mục nào không ghim thì vẫn tự động
  // chọn theo mùa/thể trạng như cũ (resolveProgram377DayContent).
  if (!p377DaysCols.includes('block_overrides_json')) {
    db.exec('ALTER TABLE program377_days ADD COLUMN block_overrides_json TEXT');
    console.log('  Migrated program377_days: added block_overrides_json.');
  }

  // Vá dữ liệu cũ từ trước khi runProgram377Coaching biết đồng bộ sang meal_logs: những báo cáo
  // 377 ngày đã có nhận xét AI nhưng dòng meal_logs cùng ngày vẫn trống ai_feedback.
  {
    const staleRows = db.all(
      `SELECT r.user_id, r.report_date, r.ai_feedback, r.flag_level, r.flagged_reason
       FROM program377_reports r JOIN meal_logs m ON m.user_id = r.user_id AND m.log_date = r.report_date
       WHERE r.ai_feedback IS NOT NULL AND m.ai_feedback IS NULL`
    );
    staleRows.forEach((r) => {
      db.run(
        'UPDATE meal_logs SET ai_feedback=?, flag_level=?, flagged_reason=? WHERE user_id=? AND log_date=?',
        [r.ai_feedback, r.flag_level, r.flagged_reason, r.user_id, r.report_date]
      );
    });
    if (staleRows.length) console.log(`  Migrated meal_logs: đồng bộ ${staleRows.length} nhận xét AI từ program377_reports (dữ liệu cũ trước khi có đồng bộ tự động).`);
  }
  // Dọn dòng kỹ thuật "THE_TRANG: …" lọt vào nhận xét An Nhiên đã lưu (khách đang thấy dòng này)
  for (const t of ['program377_reports', 'meal_logs']) {
    const rows = db.all(`SELECT id, ai_feedback FROM ${t} WHERE ai_feedback LIKE '%THE_TRANG%'`);
    rows.forEach(r => db.run(`UPDATE ${t} SET ai_feedback = ? WHERE id = ?`,
      [String(r.ai_feedback).replace(/^[ \t]*\**[ \t]*THE_TRANG[ \t]*:.*$/gim, '').replace(/\n{3,}/g, '\n\n').trim(), r.id]));
    if (rows.length) console.log(`  Dọn THE_TRANG khỏi ${rows.length} nhận xét trong ${t}.`);
  }

  // Migrate ttm_body_photos: add drive_folder_id (mỗi user 1 thư mục Drive riêng, tái dùng lần sau)
  const ttmPhotoCols = db.all('PRAGMA table_info(ttm_body_photos)').map(c => c.name);
  if (!ttmPhotoCols.includes('drive_folder_id')) {
    db.exec('ALTER TABLE ttm_body_photos ADD COLUMN drive_folder_id TEXT');
    console.log('  Migrated ttm_body_photos: added drive_folder_id.');
  }

  // Migrate ttm_body_photos: link ảnh cũ dùng dạng "uc?export=view" (đôi khi trả HTML thay vì ảnh
  // thật khi nhúng trên trình duyệt) — đổi sang endpoint thumbnail chính thức của Drive, ổn định hơn.
  ['front_url', 'back_url', 'side_url'].forEach((col) => {
    const rows = db.all(`SELECT user_id, ${col} AS url FROM ttm_body_photos WHERE ${col} LIKE '%uc?export=view%'`);
    rows.forEach((r) => {
      const fixed = r.url.replace(/https:\/\/drive\.google\.com\/uc\?export=view&id=([^&]+)/, 'https://drive.google.com/thumbnail?id=$1&sz=w1000');
      db.run(`UPDATE ttm_body_photos SET ${col} = ? WHERE user_id = ?`, [fixed, r.user_id]);
    });
    if (rows.length) console.log(`  Migrated ttm_body_photos.${col}: ${rows.length} link(s) đổi sang thumbnail endpoint.`);
  });

  // Migrate program377_days: video_url admin dán dạng watch/live/shorts (bị YouTube chặn nhúng
  // iframe) -> đổi sang dạng embed. normalizeEmbedVideoUrl được định nghĩa ở dưới (hoisted).
  {
    const badVideoRows = db.all("SELECT id, video_url FROM program377_days WHERE video_url IS NOT NULL AND video_url NOT LIKE '%/embed/%'");
    badVideoRows.forEach((r) => {
      db.run('UPDATE program377_days SET video_url = ? WHERE id = ?', [normalizeEmbedVideoUrl(r.video_url), r.id]);
    });
    if (badVideoRows.length) console.log(`  Migrated program377_days.video_url: ${badVideoRows.length} link(s) đổi sang dạng embed.`);
  }

  // Lấy Drive client đã xác thực bằng OAuth refresh token (kết nối 1 lần qua Admin > Cài đặt >
  // Google Drive). Refresh token được lưu trong admin_secrets, googleapis tự làm mới access token.
  function getDriveClient() {
    if (!GOOGLE_DRIVE_PARENT_FOLDER_ID) {
      throw new Error('Chưa cấu hình GOOGLE_DRIVE_PARENT_FOLDER_ID.');
    }
    const refreshToken = db.get("SELECT value FROM admin_secrets WHERE key = 'google_drive_refresh_token'")?.value;
    if (!refreshToken) {
      throw new Error('Chưa kết nối Google Drive — vào Admin > Cài đặt > Google Drive để kết nối.');
    }
    const oauth2Client = newDriveOAuthClient();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth: oauth2Client });
  }

  // Mỗi user có 1 thư mục con riêng trong thư mục cha trên Drive — tạo 1 lần, tái dùng cho các lần
  // upload sau. Đặt tên theo đúng quy ước thư mục cũ: "Tên - SĐT - Ngày tạo".
  async function ensureUserDriveFolder(drive, userId) {
    const existing = db.get('SELECT drive_folder_id FROM ttm_body_photos WHERE user_id = ?', [userId]);
    if (existing?.drive_folder_id) return existing.drive_folder_id;

    const user = db.get('SELECT first_name, last_name, phone FROM users WHERE id = ?', [userId]);
    const fullName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || `User #${userId}`;
    const today = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
    const folderName = `${fullName} - ${user?.phone || 'N/A'} - ${today}`;

    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [GOOGLE_DRIVE_PARENT_FOLDER_ID],
      },
      fields: 'id',
    });
    const folderId = folder.data.id;

    if (existing) {
      db.run('UPDATE ttm_body_photos SET drive_folder_id = ? WHERE user_id = ?', [folderId, userId]);
    } else {
      db.run('INSERT INTO ttm_body_photos (user_id, drive_folder_id) VALUES (?, ?)', [userId, folderId]);
    }
    return folderId;
  }

  const seedChallengeDays = () => {
    db.run('DELETE FROM challenge_days WHERE challenge_id = 1');
    CHALLENGE_DAYS.forEach(([num, title, desc, instructions, xp]) =>
      db.run(
        'INSERT INTO challenge_days (challenge_id, day_number, title, description, instructions, xp_reward) VALUES (1,?,?,?,?,?)',
        [num, title, desc, instructions, xp]
      )
    );
    console.log(`  Seeded ${CHALLENGE_DAYS.length} challenge days (Ngũ Hành).`);
  };
  const day1 = db.get('SELECT title FROM challenge_days WHERE challenge_id = 1 AND day_number = 1 LIMIT 1');
  const cd1Count = db.get('SELECT COUNT(*) AS n FROM challenge_days WHERE challenge_id = 1').n;
  const looksLikeOldContent = day1 && /Kick Off|Cài Tool|Giới thiệu bản thân|Landing Page/i.test(day1.title || '');
  if (cd1Count === 0 && CHALLENGE_DAYS.length) {
    seedChallengeDays();
  }

  // Nội dung mặc định 3 buổi Workshop (dùng nếu admin chưa cấu hình qua
  // trang admin → mục Thân Tâm Mệnh → Lịch Zoom / sự kiện → tab "Zoom 3 buổi")
  const WORKSHOP3_DEFAULT_SESSIONS = [
    {
      title: 'Buổi 1: Nhìn Nhận Sự Thật: "Tôi Sai"',
      date: '',
      zoom_link: '',
      content_html:
        '<p><strong>Nguyên tắc 5Đ — Ăn đúng theo tự nhiên:</strong> Đúng thổ nhưỡng, Đúng cơ địa, Đúng thời điểm, Đúng màu, Đúng vị. Tại sao uống nước cam sai giờ gây mất ngủ?</p>' +
        '<p><strong>Bài test cơ địa Hàn–Nhiệt:</strong> Xác định nhóm cơ địa cá nhân: Hàn, Nhiệt, Nhiệt giả Hàn, Hàn giả Nhiệt — nền tảng điều chỉnh ăn uống.</p>' +
        '<p><strong>Mô hình 4 hướng Đông-Tây-Nam-Bắc:</strong> Kết hợp Tây y, Đông-Bắc y và Nam y để tạo ra phương pháp DƯỠNG HÓA phù hợp người Việt.</p>' +
        '<p><strong>Ma trận Eisenhower — Xác định mục tiêu:</strong> Sắp xếp 8 mục tiêu cuộc đời (nhà, xe, sức khỏe, gia đình...) để biết đâu là ưu tiên thực sự.</p>' +
        '<p style="margin-top:12px;padding:10px 14px;background:#fef3c7;border-radius:8px;color:#78350f;"><strong>🎯 Kết quả đầu ra:</strong> Biết rõ cơ địa Hàn-Nhiệt của mình và xác định mục tiêu sức khỏe ưu tiên qua Ma trận Eisenhower.</p>',
    },
    {
      title: 'Buổi 2: Đánh Thức Cơ Thể: "Tôi Cần Làm Ngay"',
      date: '',
      zoom_link: '',
      content_html:
        '<p><strong>Metaphor "Ngôi nhà cũ" — Độc tố thế kỷ 21:</strong> Cơ thể như ngôi nhà hỏng điện, tắc cống. Dùng thuốc khi hệ thống đang hỏng giống như sơn tường mà không sửa đường cống.</p>' +
        '<p><strong>Đại tràng — "Máy lọc nước" của cơ thể:</strong> Mối liên hệ đại tràng với phổi, da, tuyến giáp, hệ bạch huyết. Quy trình thanh lọc: Đại tràng → Gan → Thận → Bạch huyết.</p>' +
        '<p><strong>Tác động Cột sống (TDCS) — Gốc bệnh:</strong> "Trăm bệnh từ cột sống mà ra." Khi cột sống lệch, dây thần kinh bị chèn ép, tín hiệu từ não xuống nội tạng bị sai lệch.</p>' +
        '<p><strong>Thực hành TDCS trực tiếp trên Zoom:</strong> Hướng dẫn làm ấm tay chân, tạo môi trường cơ thể kiềm, đủ oxy — điều kiện cần để phòng ngừa tái phát.</p>' +
        '<p style="margin-top:12px;padding:10px 14px;background:#fef3c7;border-radius:8px;color:#78350f;"><strong>🎯 Kết quả đầu ra:</strong> Nhận diện 2 nguyên nhân cốt lõi khiến bệnh tái phát và thực hành Tác động Cột sống ngay trên Zoom.</p>',
    },
    {
      title: 'Buổi 3: Tái Sinh Toàn Diện: "Tôi Phải Thay Đổi Cuộc Đời"',
      date: '',
      zoom_link: '',
      content_html:
        '<p><strong>Tần số năng lượng Hawkins:</strong> Dưới 200 (sợ hãi, oán giận) = gốc rễ viêm mãn tính. Trên 500 (yêu thương, bình an) = chìa khóa tự chữa lành.</p>' +
        '<p><strong>Quy luật 4 mùa — Sinh Trưởng Lão Tử:</strong> Thiên nhiên vận hành theo Xuân-Hạ-Thu-Đông. Cơ thể cũng vậy. Sống ngược quy luật này = nguồn gốc của bệnh.</p>' +
        '<p><strong>Thực hành 2 ly nước — Biết ơn &amp; Yêu thương:</strong> Trải nghiệm trực tiếp sức mạnh của tâm thái đối với cơ thể. Bài tập biết ơn chuyển hóa năng lượng ngay tại lớp.</p>' +
        '<p><strong>Phong thủy nhà &amp; Lộ trình 377 ngày:</strong> Tối ưu không gian sống (hướng giường, bếp, luồng khí). Giới thiệu trọn vẹn hành trình 377 ngày tái tạo cấp tế bào.</p>' +
        '<p style="margin-top:12px;padding:10px 14px;background:#fef3c7;border-radius:8px;color:#78350f;"><strong>🎯 Kết quả đầu ra:</strong> Hiểu tại sao 377 ngày là chu trình tối thiểu và đưa ra quyết định rõ ràng cho hành trình hồi sinh dài hạn.</p>',
    },
  ];

  // Nội dung mặc định 8 Buổi Chuyên Sâu (dùng nếu admin chưa cấu hình qua
  // trang admin → mục Thân Tâm Mệnh → Lịch Zoom / sự kiện → tab "Zoom 8 buổi")
  const WORKSHOP8_DEFAULT_LETTER_HTML =
    '<p>Trong <strong>8 buổi học</strong>, bạn sẽ được dẫn dắt theo đúng tiến trình sinh học tự nhiên của cơ thể — ứng dụng triết lý <strong>5 chữ vàng Dưỡng Hóa: MẬT - ÂM - ẤM - KIÊN - KIẾT</strong> để giảm gánh nặng tiêu hóa, phục hồi tự nhiên và tìm lại sự cân bằng Thân – Tâm, không cần ép buộc, không cần vội vã.</p>' +
    '<div style="font-weight:700;font-size:14px;margin:16px 0 8px;">Nội dung 8 buổi:</div>' +
    '<ol style="padding-left:20px;font-size:13.5px;line-height:1.8;margin-bottom:10px;">' +
    '<li>Hiểu Cơ Thể &amp; Ăn Uống Theo Ngũ Hành</li>' +
    '<li>Thanh Lọc Gan – Thận – Ruột &amp; Tái Tạo Cấp Tế Bào</li>' +
    '<li>Khai Thông 33 Đốt Sống, Hơi Thở Đan Điền &amp; Tự Chăm Sóc</li>' +
    '<li>Tăng Miễn Dịch, Sauna Thải Độc &amp; Chấm Dứt Viêm Mạn Tính</li>' +
    '<li>Điều Hòa Nhịp Sinh Học Bốn Mùa &amp; Làm Chủ Hormone</li>' +
    '<li>Phong Thủy Không Gian Sống &amp; Tối Ưu Giấc Ngủ 24h</li>' +
    '<li>Xây Dựng Thói Quen &amp; Kế Hoạch 377 Ngày Tái Tạo</li>' +
    '<li>Tổng Kết, Lễ Thắp Nến Tri Ân &amp; Định Hướng</li>' +
    '</ol>' +
    '<div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:8px;padding:16px 18px;margin:16px 0;color:#78350f;">' +
    '<div style="font-weight:700;font-size:14px;margin-bottom:6px;">Mức đầu tư</div>' +
    '<div style="font-size:13.5px;line-height:1.7;">Giá niêm yết: <b>6.800.000đ</b> / Trọn gói 8 buổi.<br><br>Ưu đãi ghi danh sớm — chỉ còn <b>4.800.000đ</b> / người.</div>' +
    '</div>';

  const WORKSHOP8_DEFAULT_SESSIONS = [
    {
      title: 'Buổi 1: Hiểu Cơ Thể & Ăn Uống Theo Ngũ Hành',
      date: '', zoom_link: '',
      content_html:
        '<ul><li>Nhận diện cơ địa <strong>Hàn hay Nhiệt</strong> ở cả 3 cấp độ: Da cơ gân – Phủ tạng – Cốt tủy</li>' +
        '<li>Biết chính xác nên ăn gì, tránh gì theo đúng cơ địa</li>' +
        '<li>Tự xây được <strong>thực đơn 7 ngày</strong> phù hợp với chính mình</li></ul>',
    },
    {
      title: 'Buổi 2: Thanh Lọc Gan – Thận – Ruột & Tái Tạo Cấp Tế Bào',
      date: '', zoom_link: '',
      content_html:
        '<ul><li>Hiểu cơ chế <strong>tiêu hóa – hấp thu</strong> của cơ thể</li>' +
        '<li>Nắm nguyên tắc giảm viêm bằng <strong>Ngủ – Nước – Vi chất</strong></li>' +
        '<li>Có trong tay <strong>kế hoạch 21 ngày</strong> để cơ thể tự làm sạch, tự phục hồi</li></ul>',
    },
    {
      title: 'Buổi 3: Khai Thông 33 Đốt Sống, Hơi Thở Đan Điền & Tự Chăm Sóc',
      date: '', zoom_link: '',
      content_html:
        '<ul><li>Thực hành <strong>5 bài khai thông khí huyết</strong> vùng Đầu – Mặt – Ngực/Bụng – Tay – Chân</li>' +
        '<li>Hiểu đúng chuyển động cột sống khi đi, khi ngồi</li>' +
        '<li>Làm chủ kỹ thuật <strong>thở bụng, thở Đan điền</strong></li></ul>',
    },
    {
      title: 'Buổi 4: Tăng Miễn Dịch, Sauna Thải Độc & Chấm Dứt Viêm Mạn Tính',
      date: '', zoom_link: '',
      content_html:
        '<ul><li>Nắm được mối liên hệ <strong>Dinh dưỡng – Vận động – Giấc ngủ – Miễn dịch</strong></li>' +
        '<li>Nhận diện đúng biểu hiện viêm theo cơ địa <strong>Hàn/Nhiệt</strong></li>' +
        '<li>Biết cách ứng dụng <strong>Sauna</strong> để thải độc tân dịch, hệ bạch huyết</li></ul>',
    },
    {
      title: 'Buổi 5: Điều Hòa Nhịp Sinh Học Bốn Mùa & Làm Chủ Hormone',
      date: '', zoom_link: '',
      content_html:
        '<ul><li>Hiểu cách <strong>Dopamine, Serotonin, Melatonin, Cortisol</strong> biến đổi theo mùa và theo cảm xúc</li>' +
        '<li>Học kỹ thuật thở để điều hòa cảm xúc</li>' +
        '<li>Thực hành lòng biết ơn để chủ động quản lý stress, thay vì bị nó cuốn đi</li></ul>',
    },
    {
      title: 'Buổi 6: Phong Thủy Không Gian Sống & Tối Ưu Giấc Ngủ 24h',
      date: '', zoom_link: '',
      content_html:
        '<ul><li>Biết cách sắp xếp ánh sáng theo <strong>nhịp sinh học 24 giờ</strong> của cơ thể</li>' +
        '<li>Bố trí không gian phòng ngủ tối ưu cho giấc ngủ sâu</li>' +
        '<li>Biến môi trường sống thành nơi hỗ trợ chữa lành, thay vì cản trở</li></ul>',
    },
    {
      title: 'Buổi 7: Xây Dựng Thói Quen & Kế Hoạch 377 Ngày Tái Tạo',
      date: '', zoom_link: '',
      content_html:
        '<ul><li>Nhìn lại chặng đường đã tiến bộ qua 7 buổi học</li>' +
        '<li>Nhận kế hoạch chi tiết cho <strong>hành trình 377 ngày</strong> tái tạo</li>' +
        '<li>Biến thay đổi tích cực thành thói quen bền vững, không phụ thuộc vào động lực nhất thời</li></ul>',
    },
    {
      title: 'Buổi 8: Tổng Kết, Lễ Thắp Nến Tri Ân & Định Hướng',
      date: '', zoom_link: '',
      content_html:
        '<ul><li>Nhìn lại toàn bộ <strong>hành trình 8 buổi</strong> đã đi qua</li>' +
        '<li>Tham gia <strong>nghi thức thắp nến tri ân</strong> đầy xúc động</li>' +
        '<li>Nhận định hướng rõ ràng cho chặng đường tiếp theo — kể cả nếu muốn đồng hành lâu dài hoặc làm nghề</li></ul>',
    },
  ];

  // Seed default site settings
  const defaultSettings = [
    ['announcement_enabled',   '0'],
    ['announcement_text',      ''],
    ['announcement_icon',      '📢'],
    ['late_reminder_enabled',  '0'],
    ['calendar_embed_url',     ''],
    ['about_intro',            ''],
    ['about_media',            '[]'],
    ['community_name',         COMMUNITY_NAME],
    ['challenge_hero_icon',    '🚀'],
    ['challenge_hero_title',   'Thử thách cộng đồng'],
    ['challenge_hero_desc',    'Mỗi ngày một bước nhỏ — cùng nhau hoàn thành thử thách.'],
    ['mp_store_name',          COMMUNITY_NAME + ' Marketplace'],
    ['mp_store_desc',          'Sản phẩm, tài liệu và khoá học dành cho thành viên cộng đồng.'],
    ['mp_bank_name',           'BIDV'],
    ['mp_bank_account_name',   'TỪ CHÍ NGUYỆN'],
    ['mp_bank_account_number', '96247NGUYEN'],
    ['home_tagline',           'AI AGENTS CC'],
    ['home_heading_line1',     'Làm chủ'],
    ['home_heading_highlight', 'AI Agent'],
    ['home_heading_line2',     'từ hôm nay.'],
    ['home_desc',              'Nơi học viên thực chiến cùng nhau — từ prompt engineering đến deploy agent thực tế trong 21 ngày.'],
    ['home_stat1_value',       '2K+'],
    ['home_stat1_label',       'Học viên'],
    ['home_stat2_value',       '120+'],
    ['home_stat2_label',       'Bài học'],
    ['home_stat3_value',       '21'],
    ['home_stat3_label',       'Day Challenge'],
    ['home_tags',              'AI Agent, Prompt Engineering, n8n / Make, Automation, LLM Apps'],
    ['courses_hero_icon',      '📗'],
    ['courses_hero_title',     'Khoá học'],
    ['courses_hero_desc',      'Các khoá học dành cho thành viên cộng đồng.'],
    ['workshop3_video_url',    ''],
    ['workshop3_space_url',    'space.html?id=6'],
    ['workshop3_course_url',   'course-view.html?id=10'],
    ['workshop3_sessions',     JSON.stringify(WORKSHOP3_DEFAULT_SESSIONS)],
    ['workshop3_time_note',    '20:00 - 21:30 (Zoom mở lúc 19:45)'],
    ['workshop8_video_url',    ''],
    ['workshop8_letter_html',  WORKSHOP8_DEFAULT_LETTER_HTML],
    ['workshop8_time_note',    '20:00 - 21:30 (Zoom mở lúc 19:45)'],
    ['workshop8_page_mode',    'classic'],           // Người chưa đăng ký 8 buổi thấy: classic = trang ngắn workshop8.html, letter = thư ngỏ dài workshop8-thu-ngo.html
    ['workshop8_price_regular', '6.800.000'],        // Học phí 8 buổi — hiện ở thẻ Feed + thư ngỏ dài (đăng ký xong BTC gọi tư vấn, không hiện QR)
    ['workshop8_price_offer',  '4.800.000'],
    ['workshop8_bonuses',      'Ứng dụng tạo thực đơn 7 ngày theo Ngũ Hành | thuc-don-7-ngay.html | 490.000\nỨng dụng trắc nghiệm cơ thể Hàn – Nhiệt | kiem-tra-han-nhiet.html | 290.000'],
    // Bảng giá trị (value stack) ở thư ngỏ dài — mỗi dòng "Tên | mô tả | giá trị"; {tro_ly} = số câu Trợ lý Ngũ Hành / ngày
    ['workshop8_value_stack',  [
      '8 buổi học trực tuyến qua Zoom | cùng Ban tổ chức, có hỏi đáp trực tiếp | 6.800.000',
      'Phiếu khảo sát Thân – Tâm – Mệnh + lộ trình cá nhân | xây theo đúng cơ địa của riêng bạn | 1.500.000',
      'Nhóm thảo luận riêng của lớp | hỏi đáp, chia sẻ cùng các bạn học suốt khoá | 1.000.000',
      'Bài tập thực hành sau mỗi buổi | áp dụng ngay trong tuần | 500.000',
      'Trợ lý Ngũ Hành | hỏi đến {tro_ly} câu mỗi ngày về ăn uống theo cơ địa | 600.000',
    ].join('\n')],
    ['workshop8_course_values', '{}'],              // {"<id khoá>": "1.500.000"} — trống: khoá riêng tư 1.500.000đ, khoá công khai = miễn phí cho thành viên
    ['workshop8_sessions',     JSON.stringify(WORKSHOP8_DEFAULT_SESSIONS)],
    ['program377_video_url',   ''],
    ['workshop8_space_url',    'space.html?id=7'],   // nút "Vào nhóm thảo luận" ở trang 8 buổi
    ['program377_space_url',   'space.html?id=8'],   // nút "Vào nhóm thảo luận" ở trang 377 ngày
    ['feed_default_space_id',  ''],                  // Space chọn sẵn khi đăng bài ở Feed
    ['feed_showcase_enabled',  '0'],                 // Khung giới thiệu 8 buổi / 377 ngày trên Feed (1 = bật)
    ['post_image_drive_folder_id', ''], // Thư mục Drive chứa ảnh upload khi đăng bài
    ['p377_meal_image_drive_folder_id', ''], // Thư mục Drive chứa ảnh bữa ăn (báo cáo 377 ngày)
    ['p377_video_drive_folder_id', ''],      // Thư mục Drive chứa video cảm nhận (báo cáo 377 ngày)
    ['health_record_drive_folder_id', ''],   // Thư mục Drive RIÊNG TƯ chứa phiếu xét nghiệm / siêu âm (Hồ sơ y khoa)
    ['p377_video_guide', '**Gợi ý cho video 2–5 phút:**\n\n- Hôm nay cơ thể bạn cảm thấy thế nào? (ăn, ngủ, tiêu hoá, năng lượng)\n- Bạn đã thay đổi điều gì trong ăn uống / sinh hoạt?\n- Điều gì khiến bạn vui, biết ơn hoặc còn băn khoăn?\n\nQuay nơi đủ sáng, ít ồn, nói tự nhiên như kể chuyện với bạn bè. Video chỉ Ban tổ chức xem.'],
    // Giá 377 ngày: giá thường + giá riêng cho người đã được duyệt 8 buổi (trang 377 ngày gạch giá thường)
    ['p377_price_regular',     '11.800.000'],
    ['p377_price_w8',          '7.000.000'],
    ['p377_price_list',        '37.800.000'],        // Giá niêm yết 377 (gạch ngang ở thư ngỏ dài); p377_price_regular = giá trợ giá hiện tại
    ['p377_page_mode',         'classic'],           // Người chưa đăng ký 377 thấy: classic = program377.html, letter = thư ngỏ dài program377-thu-ngo.html
    // Bảng giá trị thư ngỏ 377 — mỗi dòng "Tên | mô tả | giá trị"; trọn bộ 8 buổi + khoá học + quà được cộng tự động
    ['p377_value_stack',       [
      '377 ngày đồng hành mỗi ngày | mỗi ngày một nội dung mới theo lộ trình Hồi sinh Thân – Tâm – Mệnh | 12.000.000',
      'Báo cáo cơ thể hằng ngày có nhận xét | bữa ăn, tiêu hoá, giấc ngủ, cảm nhận — được Ban tổ chức đọc và phản hồi | 6.000.000',
      'Zoom định kỳ ngày 1 và ngày 15 hằng tháng | 24 buổi trong năm, hỏi đáp trực tiếp | 4.800.000',
      'Lộ trình cá nhân theo cơ địa | khảo sát Thân – Tâm – Mệnh, điều chỉnh theo tiến trình của bạn | 1.500.000',
      'Nhóm thảo luận riêng 377 ngày | đồng hành cùng các bạn thực hành suốt hành trình | 2.000.000',
    ].join('\n')],
    ['p377_bonuses',           'Ứng dụng tạo thực đơn 7 ngày theo Ngũ Hành | thuc-don-7-ngay.html | 490.000\nỨng dụng trắc nghiệm cơ thể Hàn – Nhiệt | kiem-tra-han-nhiet.html | 290.000'],
    // Trợ lý Ngũ Hành — lượt hỏi/ngày theo mức tham gia + lời mời khi hết lượt (Markdown, sửa ở admin)
    ['assistant_limit_basic',  '5'],                 // chưa tham gia / mới 3 buổi
    ['assistant_limit_w8',     '7'],                 // đã tham gia 8 buổi
    ['assistant_upsell_w8', [
      '## 🌿 Bạn đã dùng hết lượt hỏi miễn phí hôm nay',
      '',
      'Mình thấy bạn đang rất quan tâm đến việc chăm sóc cơ thể — đó là bước khởi đầu quý giá nhất! Nhưng hỏi từng câu lẻ chỉ giải quyết được từng triệu chứng. Để **hiểu tận gốc cơ thể mình và tự chăm sóc lâu dài**, chương trình **8 Buổi Chuyên Sâu Hồi Sinh Thân – Tâm – Mệnh** sẽ dẫn bạn đi trọn lộ trình:',
      '',
      '- **Buổi 1:** Hiểu cơ thể & ăn uống theo Ngũ Hành — nhận diện cơ địa Hàn/Nhiệt, tự xây thực đơn 7 ngày',
      '- **Buổi 2:** Thanh lọc Gan – Thận – Ruột & tái tạo cấp tế bào — kế hoạch 21 ngày tự làm sạch',
      '- **Buổi 3:** Khai thông 33 đốt sống, hơi thở Đan Điền & tự chăm sóc',
      '- **Buổi 4:** Tăng miễn dịch, Sauna thải độc & chấm dứt viêm mạn tính',
      '- **Buổi 5:** Điều hoà nhịp sinh học bốn mùa & làm chủ hormone',
      '- **Buổi 6:** Phong thuỷ không gian sống & tối ưu giấc ngủ 24h',
      '- **Buổi 7:** Xây dựng thói quen & kế hoạch 377 ngày tái tạo',
      '- **Buổi 8:** Tổng kết, lễ thắp nến tri ân & định hướng',
      '',
      '💎 Giá niêm yết ~~6.800.000đ~~ → ưu đãi ghi danh sớm chỉ còn **4.800.000đ** / trọn gói 8 buổi.',
      '',
      '🎁 Học viên 8 buổi được hỏi Trợ lý **7 câu mỗi ngày**. Ưu đãi có hạn — đăng ký hôm nay để giữ chỗ nhé!',
    ].join('\n')],
    ['assistant_upsell_p377', [
      '## 🌿 Bạn đã dùng hết lượt hỏi hôm nay',
      '',
      'Bạn đã đi qua 8 buổi chuyên sâu — giờ là lúc biến kiến thức thành **thói quen sống mỗi ngày**. Chương trình **377 ngày thực hành Hồi sinh Thân – Tâm – Mệnh** đồng hành cùng bạn mỗi ngày: mỗi ngày 1 nội dung mới, bạn báo cáo tình trạng cơ thể và được theo dõi sát sao.',
      '',
      'Nội dung trọng tâm trong 377 ngày:',
      '',
      '- Dinh dưỡng Ngũ Hành cá nhân hoá theo cơ địa Hàn – Nhiệt',
      '- Dưỡng sinh chăm sóc, phục hồi Lục phủ Ngũ tạng',
      '- Khai thông kinh lạc — tác động cột sống, kích hoạt cơ chế tự chữa lành',
      '- Chu kỳ sinh học & tái tạo cơ thể cấp độ tế bào',
      '- Phong thuỷ nhà ở & phong thuỷ tài chính cá nhân, gia đình',
      '- Năm vòng tròn lỗi đạo & Năm vòng tròn kiểm soát — làm chủ tư duy, hàn gắn các mối quan hệ',
      '- Ứng dụng trí tuệ Kinh Dịch: nghệ thuật cân bằng Thân – Tâm',
      '',
      '💎 Giá dành riêng cho học viên đã tham gia 8 buổi: ~~11.800.000đ~~ → **chỉ còn 7.000.000đ** (giảm 4.800.000đ).',
      '',
      '🎁 Thành viên 377 ngày được hỏi Trợ lý nhiều hơn mỗi ngày. Đăng ký ngay để giữ mức ưu đãi dành riêng cho bạn!',
    ].join('\n')],
    // Thời điểm bắt buộc khảo sát Thân-Tâm-Mệnh: 'signup' (ngay khi tạo tài
    // khoản, mặc định) | 'workshop8' | 'program377' | 'none' (không bắt buộc)
    ['ttm_intake_trigger',     'none'],
    // Trang Liên hệ BTC (lien-he.html) — admin sửa ở Cài đặt → Liên hệ
    ['contact_heading',        'THÔNG TIN LIÊN HỆ VỚI AI AGENTS CC'],
    ['contact_intro',          'Cộng đồng này được điều hành và quản lý bởi (Tên đơn vị của bạn)'],
    ['contact_people',         JSON.stringify([
      { role: 'Điều hành', name: '(Tên người điều hành)', phone: '' },
      { role: 'Hỗ trợ tư vấn', name: '(Tên người tư vấn)', phone: '' },
    ])],
    ['contact_bank_name',      ''],
    ['contact_bank_account',   ''],
    ['contact_bank_holder',    ''],
    ['contact_bank_note',      ''],
    // [{ platform: facebook|youtube|tiktok|zalo|instagram|website|other, label, url }]
    ['contact_socials',        '[]'],
    // Nội quy cộng đồng (Markdown) — trang noi-quy.html + popup xác nhận. Tăng rules_version để
    // yêu cầu mọi thành viên xác nhận lại.
    ['rules_content',          (() => { try { return fs.readFileSync(path.join(__dirname, 'content', 'noi-quy-mac-dinh.md'), 'utf8'); } catch (e) { return ''; } })()],
    ['rules_version',          '1'],
    // Hướng dẫn sử dụng (Markdown) — trang huong-dan.html; mỗi "## " là 1 mục mở/thu gọn
    ['guide_content',          (() => { try { return fs.readFileSync(path.join(__dirname, 'content', 'huong-dan-mac-dinh.md'), 'utf8'); } catch (e) { return ''; } })()],
  ];
  defaultSettings.forEach(([key, value]) => {
    const existing = db.get('SELECT key FROM site_settings WHERE key = ?', [key]);
    if (!existing) db.run('INSERT INTO site_settings (key, value) VALUES (?,?)', [key, value]);
  });






  // Seed 3 gói Coach 1-1 sức khỏe (60 phút/buổi) — mua qua checkout.html như
  // sản phẩm bình thường; hoàn tất đơn hàng sẽ cộng số buổi vào coaching_credits
  // (xem autoEnrollFromProductPurchase). Giá/buổi giảm dần theo gói lớn hơn.
  // AI AGENTS CC: tắt tự tạo gói coach sức khỏe mẫu — tạo gói coach thủ công trong Admin nếu cần
  if (process.env.SEED_COACHING_PACKAGES === '1' && db.get("SELECT COUNT(*) AS n FROM products WHERE coaching_sessions IS NOT NULL").n === 0) {
    const adminUser = db.get('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    if (adminUser) {
      const coachingPackages = [
        [1, 5000000, 5000000, 'Coach 1-1 sức khỏe — Gói 1 buổi',
         'Đồng hành 1-1 trực tiếp cùng chuyên gia, 60 phút/buổi.'],
        [5, 21250000, 25000000, 'Coach 1-1 sức khỏe — Gói 5 buổi (giảm 15%/buổi)',
         '5 buổi × 60 phút, đồng hành 1-1 trực tiếp — giảm 15% mỗi buổi so với mua lẻ.'],
        [10, 37500000, 50000000, 'Coach 1-1 sức khỏe — Gói 10 buổi (giảm 25%/buổi)',
         '10 buổi × 60 phút, đồng hành 1-1 trực tiếp — giảm 25% mỗi buổi so với mua lẻ.'],
      ];
      coachingPackages.forEach(([sessions, price, comparePrice, title, desc]) => {
        db.run(
          `INSERT INTO products (seller_id, title, description, long_description, price, compare_price, category, cover_color, status, coaching_sessions)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [adminUser.id, title, desc,
           `## ${title}\n\n- Mỗi buổi 60 phút, coach 1-1 trực tiếp.\n- Sau khi thanh toán, bạn đặt lịch hẹn ngày/giờ mong muốn tại trang "Đặt lịch coach 1-1".\n- Đội ngũ sẽ xác nhận lịch cụ thể trong vòng 24 giờ.`,
           price, comparePrice, 'coaching', '#0ea5e9', 'published', sessions]
        );
      });
      console.log('  Seeded 3 gói Coach 1-1 sức khỏe.');
    }
  }

  // Capitalizes the first letter of each word ("nguyễn văn an" → "Nguyễn Văn
  // An"). Used to normalize user display names — many were stored
  // exactly as typed at registration (often all-lowercase on mobile).
  // String.prototype.toUpperCase/toLowerCase are Unicode-aware in Node, so
  // Vietnamese diacritics (đ/Đ, ạ/Ạ, ...) round-trip correctly.
  function toTitleCase(s) {
    return String(s || '')
      .replace(/[<>"'`\\]/g, '') // tên không được chứa ký tự có thể chèn mã HTML
      .trim()
      .split(/\s+/)
      .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)
      .join(' ');
  }

  // One-time cleanup: normalize any already-stored names that aren't Title
  // Case yet. Idempotent — once names are fixed, this is a no-op on every
  // future startup.
  db.all('SELECT id, first_name, last_name FROM users').forEach(u => {
    const fn = toTitleCase(u.first_name);
    const ln = toTitleCase(u.last_name);
    if (fn !== u.first_name || ln !== u.last_name) {
      db.run('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?', [fn, ln, u.id]);
    }
  });

  // Chủ đề bài đăng mặc định — admin đổi tên / thêm trong trang Admin
  const pillarCount = db.get('SELECT COUNT(*) AS n FROM pillars').n;
  if (pillarCount === 0) {
    [
      ['offer',      'Offer',      '🔥', '#f59e0b', 0],
      ['traffic',    'Thu hút',    '✨', '#3b82f6', 1],
      ['conversion', 'Chuyển đổi', '🎯', '#8b5cf6', 2],
      ['delivery',   'Cung ứng',   '⚙️', '#10b981', 3],
      ['continuity', 'Continuity', '🔄', '#ec4899', 4],
    ].forEach(([key, label, icon, color, order_num]) =>
      db.run('INSERT INTO pillars (key, label, icon, color, order_num) VALUES (?,?,?,?,?)', [key, label, icon, color, order_num]));
    console.log('  Seeded default pillars.');
  }

  // ── Helpers ────────────────────────────────────────────────
  // Enroll (approved) — dùng chung cho cấp quyền thủ công, CSV và grant theo email
  function approveCourseEnrollment(courseId, userId) {
    const existing = db.get('SELECT id FROM course_enrollments WHERE course_id = ? AND user_id = ?', [courseId, userId]);
    if (existing) db.run("UPDATE course_enrollments SET status = 'approved' WHERE id = ?", [existing.id]);
    else db.run('INSERT INTO course_enrollments (course_id, user_id, status) VALUES (?,?,?)', [courseId, userId, 'approved']);
  }

  // Tài khoản nhận thanh toán Marketplace — đọc từ Cài đặt Marketplace (mp_bank_*)
  function paymentBank() {
    const get = k => (db.get('SELECT value FROM site_settings WHERE key = ?', [k])?.value || '').trim();
    return {
      name:  get('mp_bank_name') || 'BIDV',
      acc:   get('mp_bank_account_number') || '96247NGUYEN',
      owner: get('mp_bank_account_name') || 'TỪ CHÍ NGUYỆN',
    };
  }

  // Chuyển các quyền học cấp trước theo email thành enrollment thật cho user này
  function applyCourseEmailGrants(userId, email) {
    if (!userId || !email) return;
    const grants = db.all('SELECT id, course_id FROM course_email_grants WHERE email = ?', [String(email).trim().toLowerCase()]);
    grants.forEach(g => {
      approveCourseEnrollment(g.course_id, userId);
      db.run('DELETE FROM course_email_grants WHERE id = ?', [g.id]);
    });
  }

  function addXP(userId, amount, source, note = null) {
    db.run('UPDATE users SET xp = xp + ? WHERE id = ?', [amount, userId]);
    db.run(
      'INSERT INTO xp_log (user_id, amount, source, note) VALUES (?,?,?,?)',
      [userId, amount, source, note]
    );
  }

  // Recompute a user's streak = number of consecutive days (ending today) that have a meal_log.
  // Returns the new streak. Awards a bonus XP the first time each 7-day milestone is reached.
  function recomputeStreak(userId) {
    const set = new Set(
      db.all("SELECT DISTINCT log_date FROM meal_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 90", [userId])
        .map(r => r.log_date)
    );
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayStr = db.get("SELECT date('now','localtime') AS d").d;
    const cur = new Date(todayStr + 'T12:00:00');
    // if today not logged yet, count from yesterday so the streak doesn't drop mid-day
    if (!set.has(iso(cur))) cur.setDate(cur.getDate() - 1);
    let streak = 0;
    while (set.has(iso(cur))) { streak++; cur.setDate(cur.getDate() - 1); }
    const prev = db.get('SELECT streak FROM users WHERE id = ?', [userId])?.streak || 0;
    db.run('UPDATE users SET streak = ? WHERE id = ?', [streak, userId]);
    // milestone bonus: +10 XP each new multiple of 7, only when crossing upward
    if (streak > prev && streak % 7 === 0) {
      addXP(userId, 10, 'streak', `Chuỗi ${streak} ngày ghi nhật ký ăn uống`);
    }
    return streak;
  }

  function slugify(label) {
    let s = String(label || '').trim().toLowerCase();
    s = s.replace(/đ/g, 'd').replace(/Đ/g, 'd');
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return s || 'pillar';
  }
  function uniquePillarKey(base) {
    let key = base;
    let i = 2;
    while (db.get('SELECT id FROM pillars WHERE key = ?', [key])) { key = `${base}_${i}`; i++; }
    return key;
  }

  function extractJsonObject(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object in AI response');
    return JSON.parse(candidate.slice(start, end + 1));
  }

  function gradeQuizExercise(questions, answers, maxScore) {
    const issues = [];
    const hints = [];
    let correctCount = 0;
    questions.forEach((q, i) => {
      const picked = answers[q.id];
      if (picked === q.correct_index) {
        correctCount++;
      } else {
        issues.push(`Câu ${i + 1}: "${q.question_text}" — bạn chọn sai.`);
        if (q.explanation) hints.push(`Câu ${i + 1}: ${q.explanation}`);
      }
    });
    const score = questions.length ? Math.round((correctCount / questions.length) * maxScore) : 0;
    return { score, issues, hints };
  }

  async function gradeExerciseWithGemini({ lessonTitle, exercisePrompt, rubric, maxScore, studentAnswer }) {
    const systemPrompt = `Bạn là trợ giảng chấm bài tập cho khoá học "${lessonTitle}". Chấm nghiêm túc, công bằng theo đúng tiêu chí chấm điểm được cung cấp.

Trả lời DUY NHẤT một JSON object theo đúng format sau, không thêm chữ nào khác trước/sau:
{"score": <số nguyên 0-${maxScore}>, "issues": [<chuỗi tiếng Việt, mỗi phần tử là 1 lỗi/điểm sai cụ thể trong bài làm>], "hints": [<chuỗi tiếng Việt, mỗi phần tử là 1 gợi ý/câu hỏi dẫn dắt để học viên TỰ nhận ra và TỰ sửa lỗi>]}

QUY TẮC BẮT BUỘC:
- "issues" phải cụ thể, chỉ đúng chỗ sai trong bài làm của học viên, không nói chung chung.
- "hints" phải mang tính gợi mở, đặt câu hỏi hoặc chỉ ra hướng suy nghĩ — TUYỆT ĐỐI KHÔNG được viết ra đáp án đúng, lời giải hoàn chỉnh, hay đoạn văn bản sửa sẵn. Mục tiêu là để học viên tự hiểu và tự sửa, không phải giải hộ.
- Nếu bài làm tốt/đúng hoàn toàn, "issues" và "hints" có thể là mảng rỗng.`;

    const userPrompt = `ĐỀ BÀI (học viên thấy):\n${exercisePrompt}\n\nTIÊU CHÍ CHẤM ĐIỂM (nội bộ, học viên không thấy):\n${rubric || '(không có tiêu chí riêng, chấm theo mức độ đúng/đủ so với đề bài)'}\n\nBÀI LÀM CỦA HỌC VIÊN:\n${studentAnswer}`;

    try {
      const result = await callAiChat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: 1500,
      });
      if (!result.ok) return { ok: false, error: result.error };

      const raw = result.text;
      const parsed = extractJsonObject(raw);

      let score = Number(parsed.score);
      if (!Number.isFinite(score)) throw new Error('Invalid score in AI response');
      score = Math.max(0, Math.min(maxScore, Math.round(score)));

      const toStrArray = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : (v ? [String(v).trim()] : []);

      return { ok: true, score, issues: toStrArray(parsed.issues), hints: toStrArray(parsed.hints), raw };
    } catch (err) {
      console.error('[ExerciseGrade] Error:', err.message);
      return { ok: false, error: err.message };
    }
  }


  // ── Admin middleware ───────────────────────────────────────
  // Accepts either the shared ADMIN_KEY (master/bootstrap) or a per-admin
  // session token from /api/admin/login. The session's is_admin/status are
  // re-checked on every request, so revoking admin access takes effect immediately.
  function requireAdmin(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!key) return res.status(401).json({ error: 'Unauthorized' });
    if (key === ADMIN_KEY) { req.adminUserId = null; return next(); } // master key — không gắn với 1 người cụ thể

    const session = adminSessionUser(key);
    if (session && session.is_admin && session.status === 'active') { req.adminUserId = session.id; return next(); }
    // Người duyệt lộ trình đã đăng nhập nhưng gọi chức năng admin khác → 403 (không phải 401,
    // để trang admin không tự đăng xuất họ)
    if (session && session.agent1_reviewer && session.status === 'active')
      return res.status(403).json({ error: 'Bạn chỉ có quyền xem và duyệt lộ trình.' });

    return res.status(401).json({ error: 'Unauthorized' });
  }

  function adminSessionUser(token) {
    return db.get(
      `SELECT u.id, u.is_admin, u.agent1_reviewer, u.status FROM admin_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now','localtime')`,
      [token]
    );
  }

  // Admin HOẶC người được cấp quyền "xem & duyệt lộ trình" (Cài đặt → Agent An Lộ)
  function requireRoadmapReviewer(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!key) return res.status(401).json({ error: 'Unauthorized' });
    if (key === ADMIN_KEY) { req.adminUserId = null; req.adminRole = 'admin'; return next(); }
    const s = adminSessionUser(key);
    if (s && s.status === 'active' && (s.is_admin || s.agent1_reviewer)) {
      req.adminUserId = s.id; req.adminRole = s.is_admin ? 'admin' : 'reviewer'; return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC ROUTES
  // ══════════════════════════════════════════════════════════

  // ── Bảo mật đợt C: API thành viên không còn tin số tài khoản trình duyệt tự gửi ──
  // Yêu cầu nào mang user_id / requester_id (query, body) hoặc /:userId trên các đường riêng tư
  // thì phải kèm phiên đăng nhập (header x-user-token) của chính tài khoản đó — hoặc tài khoản admin.
  // Trang admin (x-admin-key hợp lệ), webhook và các đường /api/admin, /api/auth có xác thực riêng nên bỏ qua.
  const MEMBER_PARAM_ROUTES = [
    /^\/api\/ttm\/(?:roadmap|intake|intake-status|photos)\/(\d+)$/,
    /^\/api\/intake\/profile\/(\d+)$/,
    /^\/api\/telegram\/link-code\/(\d+)$/,
    /^\/api\/users\/(\d+)\/timezone-detect$/,
  ];
  app.use('/api', (req, res, next) => {
    const path = req.baseUrl + req.path;
    if (/^\/api\/(admin|auth)\//.test(path) || /^\/api\/(webhook\/|antam\/webhook|telegram\/webhook)/.test(path)) return next();
    const key = req.headers['x-admin-key'];
    if (key) {
      if (key === ADMIN_KEY) return next();
      const s = adminSessionUser(key);
      if (s && s.status === 'active' && (s.is_admin || s.agent1_reviewer)) return next();
    }
    const claimed = new Set();
    const add = v => { if (v !== undefined && v !== null && v !== '') claimed.add(String(v)); };
    add(req.query?.user_id); add(req.query?.requester_id);
    if (req.body && typeof req.body === 'object') { add(req.body.user_id); add(req.body.requester_id); }
    for (const re of MEMBER_PARAM_ROUTES) { const m = path.match(re); if (m) add(m[1]); }
    if (req.method === 'PATCH' && /^\/api\/users\/(\d+)$/.test(path)) add(path.split('/').pop());
    if (!claimed.size) return next();
    const u = userFromSession(req);
    if (!u) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc chưa có — vui lòng đăng nhập lại.', code: 'session_required' });
    if (!u.is_admin && [...claimed].some(v => Number(v) !== u.id))
      return res.status(403).json({ error: 'Bạn không có quyền truy cập dữ liệu của tài khoản khác.' });
    req.sessionUserId = u.id;
    next();
  });

  // ── Ảnh hồ sơ cơ thể: riêng tư trên Drive, xem qua link có chữ ký (hết hạn 1 giờ) ──
  const PHOTO_SIG_SECRET = (() => {
    let v = db.get("SELECT value FROM admin_secrets WHERE key='photo_sig_secret'")?.value;
    if (!v) { v = crypto.randomBytes(32).toString('hex'); db.run("INSERT OR REPLACE INTO admin_secrets (key, value) VALUES ('photo_sig_secret', ?)", [v]); }
    return v;
  })();
  const driveIdOf = url => { const m = String(url || '').match(/[?&]id=([a-zA-Z0-9_-]{15,})/) || String(url || '').match(/\/d\/([a-zA-Z0-9_-]{15,})/); return m ? m[1] : null; };
  const photoSig = (userId, kind, exp) => crypto.createHmac('sha256', PHOTO_SIG_SECRET).update(`${userId}|${kind}|${exp}`).digest('hex').slice(0, 32);
  const signedPhotoUrl = (userId, kind, url) => {
    if (!url) return null;
    if (!driveIdOf(url)) return url; // không phải file Drive → giữ nguyên
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return `/api/ttm/photo-file/${userId}/${kind}?exp=${exp}&sig=${photoSig(userId, kind, exp)}`;
  };
  const photosOut = (row) => row ? {
    front: signedPhotoUrl(row.user_id, 'front', row.front_url), back: signedPhotoUrl(row.user_id, 'back', row.back_url),
    side: signedPhotoUrl(row.user_id, 'side', row.side_url), video: signedPhotoUrl(row.user_id, 'video', row.video_url),
    updatedAt: row.updated_at,
  } : null;
  app.get('/api/ttm/photo-file/:userId/:kind', async (req, res) => {
    const { userId, kind } = req.params, exp = parseInt(req.query.exp, 10);
    if (!['front', 'back', 'side', 'video'].includes(kind) || !exp || exp < Date.now() / 1000) return res.status(403).end();
    const sig = String(req.query.sig || '');
    const good = photoSig(userId, kind, exp);
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return res.status(403).end();
    const row = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [userId]);
    const fileId = row && driveIdOf(row[`${kind}_url`]);
    if (!fileId) return res.status(404).end();
    try {
      const drive = getDriveClient();
      const headers = req.headers.range ? { Range: req.headers.range } : {};
      const r = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream', headers });
      // Thư viện Drive mới trả headers kiểu Headers (dùng .get), bản cũ là object thường
      const hv = k => (r.headers && typeof r.headers.get === 'function' ? r.headers.get(k) : r.headers?.[k]) || null;
      res.status(r.status === 206 && hv('content-range') ? 206 : 200);
      for (const h of ['content-type', 'content-length', 'content-range']) if (hv(h)) res.setHeader(h, hv(h));
      if (!hv('content-type')) res.setHeader('Content-Type', kind === 'video' ? 'video/mp4' : 'image/jpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=600');
      r.data.on('error', () => res.end()).pipe(res);
    } catch (e) {
      console.error('[Ảnh cơ thể] tải từ Drive:', e.message);
      if (!res.headersSent) res.status(502).end();
    }
  });
  // Một lần: gỡ quyền "ai có link cũng xem được" khỏi ảnh / video cơ thể đã tải lên trước đây
  setTimeout(async () => {
    if (db.get("SELECT value FROM site_settings WHERE key='ttm_photos_private_done'")?.value) return;
    let drive; try { drive = getDriveClient(); } catch { return; }
    let n = 0, fail = 0;
    for (const row of db.all('SELECT * FROM ttm_body_photos')) {
      for (const k of ['front_url', 'back_url', 'side_url', 'video_url']) {
        const id = driveIdOf(row[k]); if (!id) continue;
        try {
          const perms = (await drive.permissions.list({ fileId: id, fields: 'permissions(id,type)', supportsAllDrives: true })).data.permissions || [];
          for (const pm of perms.filter(x => x.type === 'anyone')) { await drive.permissions.delete({ fileId: id, permissionId: pm.id, supportsAllDrives: true }); n++; }
        } catch (e) { fail++; }
      }
    }
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('ttm_photos_private_done', ?)", [new Date().toISOString()]);
    console.log(`[Ảnh cơ thể] đã chuyển riêng tư: gỡ ${n} quyền công khai${fail ? `, lỗi ${fail} file` : ''}.`);
  }, 20000);

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: 'brain.db' }));

  // Test email (admin only)
  app.get('/api/admin/test-email', requireAdmin, async (req, res) => {
    const to = req.query.to || ADMIN_EMAIL;
    await sendEmail({
      to,
      subject: `🧪 Test email từ ${communityName()}`,
      html: emailWrap('Email test thành công!', `
        <p>Email system đang hoạt động bình thường.</p>
        <p>From: <strong>${FROM_EMAIL}</strong></p>
        <p>Resend key: <strong>${RESEND_KEY ? '✅ Đã cấu hình' : '❌ Chưa cấu hình'}</strong></p>
      `)
    });
    res.json({ ok: true, sent_to: to, resend_active: !!resendClient });
  });

  // Public site settings — ẩn các mục nội bộ (email nhóm, mẫu email, mã thư mục Drive…) và link Zoom của khoá có phí
  const PRIVATE_SETTING_KEYS = /^(email_templates|email_tpl_.*|task_board|task_digest_.*|calendar_program_remind|event_role_offsets|ai_guide_.*|zoom_join_url|zoom_care_config|.*_drive_folder_id)$/;
  const stripZoomLinks = v => { try { return JSON.stringify(JSON.parse(v || '[]').map(({ zoom_link, ...x }) => ({ ...x, has_zoom: !!zoom_link }))); } catch { return '[]'; } };
  app.get('/api/settings', (_req, res) => {
    const rows = db.all('SELECT key, value FROM site_settings');
    const settings = {};
    rows.forEach(r => { if (!PRIVATE_SETTING_KEYS.test(r.key)) settings[r.key] = r.value; });
    if (settings.workshop8_sessions) settings.workshop8_sessions = stripZoomLinks(settings.workshop8_sessions);
    res.json(settings);
  });
  app.get('/api/settings-full', requireAdmin, (_req, res) => {
    const settings = {};
    db.all('SELECT key, value FROM site_settings').forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  });
  // Buổi học 8 buổi kèm link Zoom — chỉ cho học viên đã được duyệt (ưu tiên phiên đăng nhập an toàn)
  app.get('/api/workshop8/sessions', (req, res) => {
    const su = userFromSession(req);
    const userId = su ? su.id : Number(req.query.user_id);
    const u = userId && db.get('SELECT id, is_admin, status FROM users WHERE id = ?', [userId]);
    const ok = u && u.status === 'active' && (u.is_admin || db.get("SELECT 1 AS x FROM workshop8_enrollments WHERE user_id = ? AND status = 'approved'", [u.id])
      || db.get("SELECT 1 AS x FROM program377_enrollments WHERE user_id = ? AND status = 'approved'", [u.id]));   // gói 377 có luôn 8 buổi
    if (!ok) return res.status(403).json({ error: 'Chỉ học viên đã được duyệt mới xem được link Zoom.' });
    let sessions = []; try { sessions = JSON.parse(db.get("SELECT value FROM site_settings WHERE key='workshop8_sessions'")?.value || '[]'); } catch {}
    res.json({ sessions });
  });

  // ── Bảng phân công nhiệm vụ (phan-cong-nhiem-vu.html) — admin chỉnh ở tab "Phân công nhiệm vụ" ──
  const TASK_BOARD_DEFAULT = {
    title: 'Bảng phân công công việc hằng ngày',
    subtitle: 'Ai làm gì — để cộng đồng AI Agent vận hành đều đặn mỗi ngày.',
    columns: [
      { id: 'challenge', name: 'Thử thách', role: 'Duyệt đăng ký · chấm bài', color: '#0ea5e9', desc: 'Duyệt đăng ký thử thách, chấm bài nộp mỗi ngày, nhắc học viên chậm tiến độ.', is_agent: false },
      { id: 'sales', name: 'Bán hàng', role: 'Đơn hàng · thanh toán', color: '#8b5cf6', desc: 'Theo dõi đơn hàng Marketplace, kiểm tra các đơn "Báo đã chuyển" mà SePay chưa tự xác nhận.', is_agent: false },
      { id: 'direct', name: 'Việc trực tiếp', role: 'Nội dung, kênh, cộng đồng', color: '#f59e0b', desc: '', is_agent: false },
    ],
    members: [
      { id: 'm1', name: 'Người điều hành', role: 'Nội dung · Zoom', tasks: [
        { id: 'm1a', col: 'direct', text: 'Đăng bài chia sẻ / tín hiệu AI mới lên Bảng tin', tag: 'mỗi ngày' },
        { id: 'm1b', col: 'direct', text: 'Dẫn buổi Zoom hằng tuần cùng học viên thử thách', tag: 'mỗi tuần' },
      ] },
      { id: 'm2', name: 'Hỗ trợ học viên', role: 'Thử thách · đơn hàng', tasks: [
        { id: 'm2a', col: 'challenge', text: 'Chấm **bài nộp thử thách** trong ngày', tag: 'mỗi ngày' },
        { id: 'm2b', col: 'challenge', text: 'Duyệt **đăng ký thử thách** và **yêu cầu vào khoá học**', tag: 'khi có tin' },
        { id: 'm2c', col: 'sales', text: 'Kiểm tra đơn hàng chờ xử lý trong Admin', tag: 'mỗi ngày' },
      ] },
    ],
    flow: [
      { title: '1 · Thu hút', text: 'Đăng nội dung, chạy quảng cáo → người quan tâm tạo tài khoản và làm khảo sát **Khám phá lộ trình**.' },
      { title: '2 · Bán hàng', text: 'Học viên mua thử thách / sản phẩm trên **Marketplace** → SePay tự xác nhận khi nhận tiền.' },
      { title: '3 · Thử thách', text: 'Duyệt đăng ký → học viên nộp bài mỗi ngày → **chấm bài trong ngày** để giữ nhịp cả lớp.' },
      { title: '4 · Đồng hành', text: 'Zoom hằng tuần, trả lời câu hỏi trên Bảng tin, ghi nhận thành quả học viên.' },
    ],
    notes: [
      'Bài nộp và đăng ký nên xử lý **trong ngày** để học viên không phải chờ.',
      '**Đăng nhập** rồi tick việc của mình khi làm xong — cả nhóm cùng thấy trên **Kanban** và **KPI**.',
    ],
  };
  const getTaskBoard = () => {
    try { const v = db.get("SELECT value FROM site_settings WHERE key='task_board'")?.value; if (v) return JSON.parse(v); } catch {}
    return TASK_BOARD_DEFAULT;
  };
  // Làm sạch dữ liệu admin gửi lên: chỉ giữ chuỗi, cắt độ dài, mã màu hợp lệ, link http(s)
  const cleanTaskBoard = (b) => {
    const s = (v, n = 300) => String(v ?? '').trim().slice(0, n);
    const id = (v) => s(v, 40).replace(/[^\w-]/g, '') || Math.random().toString(36).slice(2, 10);
    const arr = (v, n) => (Array.isArray(v) ? v : []).slice(0, n);
    const columns = arr(b.columns, 12).map(c => ({
      id: id(c.id), name: s(c.name, 60), role: s(c.role, 120), desc: s(c.desc, 600),
      color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#64748b', is_agent: c.is_agent !== false,
    })).filter(c => c.name);
    const colIds = new Set(columns.map(c => c.id));
    return {
      title: s(b.title, 120) || TASK_BOARD_DEFAULT.title, subtitle: s(b.subtitle, 300),
      columns,
      members: arr(b.members, 40).map(m => {
        // Gắn thành viên với tài khoản đăng nhập (theo email) để họ tự cập nhật việc của mình trên Kanban
        const email = s(m.user_email, 120).toLowerCase();
        const u = email ? db.get('SELECT id FROM users WHERE lower(email) = ?', [email]) : null;
        return {
          id: id(m.id), name: s(m.name, 60), role: s(m.role, 120),
          ...(email ? { user_email: email } : {}), ...(u ? { user_id: u.id } : {}),
          tasks: arr(m.tasks, 30).map(t => ({
            id: id(t.id), col: colIds.has(t.col) ? t.col : (columns[columns.length - 1]?.id || ''), text: s(t.text, 400),
            ...(s(t.tag, 30) ? { tag: s(t.tag, 30) } : {}),
            ...(/^https?:\/\//i.test(s(t.link, 500)) ? { link: s(t.link, 500) } : {}),
            ...(TASK_FREQS.includes(t.freq) ? { freq: t.freq } : {}),
          })).filter(t => t.text),
        };
      }).filter(m => m.name),
      flow: arr(b.flow, 15).map(f => ({ title: s(f.title, 80), text: s(f.text, 400) })).filter(f => f.title || f.text),
      notes: arr(b.notes, 15).map(n => s(n, 400)).filter(Boolean),
    };
  };
  // Tần suất: daily mỗi ngày · weekly mỗi tuần · monthly mỗi tháng · adhoc khi phát sinh (không tính vào % KPI, chỉ đếm lượt)
  const TASK_FREQS = ['daily', 'weekly', 'monthly', 'adhoc'];
  const taskFreq = t => t.event ? 'once' : TASK_FREQS.includes(t.freq) ? t.freq : (/^khi/i.test(t.tag || '') ? 'adhoc' : /tuần/i.test(t.tag || '') ? 'weekly' : /tháng/i.test(t.tag || '') ? 'monthly' : 'daily');
  // Bản công khai: bỏ email tài khoản, thêm freq đã suy ra
  const publicTaskBoard = (b = getTaskBoard()) => ({
    ...b,
    members: (b.members || []).map(({ user_email, user_id, ...m }) => ({ ...m, linked: !!user_id, tasks: (m.tasks || []).map(t => ({ ...t, freq: taskFreq(t) })) })),
  });
  app.get('/api/task-board', (_req, res) => res.json(publicTaskBoard()));
  app.get('/api/admin/task-board', requireAdmin, (_req, res) => res.json(getTaskBoard()));
  app.put('/api/admin/task-board', requireAdmin, (req, res) => {
    const board = cleanTaskBoard(req.body || {});
    if (!board.columns.length) return res.status(400).json({ error: 'Cần ít nhất 1 cột.' });
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('task_board',?)", [JSON.stringify(board)]);
    const unlinked = board.members.filter(m => m.user_email && !m.user_id).map(m => `${m.name} (${m.user_email})`);
    res.json({ ok: true, board, unlinked });
  });
  app.post('/api/admin/task-board/reset', requireAdmin, (_req, res) => {
    db.run("DELETE FROM site_settings WHERE key='task_board'");
    res.json({ ok: true, board: TASK_BOARD_DEFAULT });
  });

  // ── Kanban + KPI: trạng thái từng việc theo kỳ (ngày / tuần / tháng) ──
  db.exec(`CREATE TABLE IF NOT EXISTS task_board_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL, task_id TEXT NOT NULL, period_key TEXT NOT NULL,
    status TEXT NOT NULL, user_id INTEGER, updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(member_id, task_id, period_key))`);
  // Nhờ hỗ trợ: chủ việc nhờ thành viên khác làm giúp 1 lần việc (của ngày/tuần/tháng đó). Chấp nhận thì lần việc chuyển cho người nhận.
  db.exec(`CREATE TABLE IF NOT EXISTS task_help (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL, task_id TEXT NOT NULL, period_key TEXT NOT NULL, work_date TEXT NOT NULL,
    to_member_id TEXT NOT NULL, from_user_id INTEGER, note TEXT,
    status TEXT NOT NULL DEFAULT 'pending', responded_by INTEGER, responded_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')))`);
  if (!db.get("SELECT 1 AS x FROM site_settings WHERE key='task_board_kpi_start'"))
    db.run("INSERT INTO site_settings (key,value) VALUES ('task_board_kpi_start',?)", [new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)]);
  const tbToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // giờ Việt Nam
  const tbAddDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const tbMonday = d => tbAddDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const tbPeriodKey = (freq, d) => freq === 'weekly' ? 'W:' + tbMonday(d) : freq === 'monthly' ? 'M:' + d.slice(0, 7) : 'D:' + d;
  const tbValidDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(new Date(d + 'T00:00:00Z'));
  const tbMe = (req) => {
    const u = userFromSession(req);
    if (!u) return null;
    const b = getTaskBoard();
    const info = db.get('SELECT email, first_name, last_name FROM users WHERE id = ?', [u.id]) || {};
    return { id: u.id, is_admin: !!u.is_admin, email: info.email || '', name: `${info.first_name || ''} ${info.last_name || ''}`.trim(),
      member_ids: (b.members || []).filter(m => m.user_id === u.id).map(m => m.id) };
  };

  // Lần nhờ hỗ trợ đang hiệu lực (chờ trả lời / đã nhận) của 1 lần việc
  const tbActiveHelp = (memberId, taskId, key) => db.get(
    "SELECT * FROM task_help WHERE member_id = ? AND task_id = ? AND period_key = ? AND status IN ('pending','accepted') ORDER BY id DESC LIMIT 1",
    [memberId, taskId, key]);
  // Ai được cập nhật lần việc này: người đã nhận hỗ trợ (nếu có), không thì chủ việc; admin luôn được
  const tbCanEditInstance = (u, m, help) => {
    if (u.is_admin) return true;
    if (help && help.status === 'accepted') {
      const hm = (getTaskBoard().members || []).find(x => x.id === help.to_member_id);
      return !!hm && hm.user_id === u.id;
    }
    return m.user_id === u.id;
  };
  const tbMemberName = (id) => (getTaskBoard().members || []).find(x => x.id === id)?.name || '(đã xoá)';
  const tbUserName = (id) => { const r = id && db.get('SELECT first_name, last_name FROM users WHERE id = ?', [id]); return r ? `${r.first_name || ''} ${r.last_name || ''}`.trim() : ''; };
  const tbHelpOut = h => h && ({ id: h.id, status: h.status, to_member_id: h.to_member_id, to_name: tbMemberName(h.to_member_id), from_name: tbUserName(h.from_user_id), note: h.note || '' });
  // Gửi 1 tin Telegram cho người dùng qua bot họ đã kết nối (mỗi người 1 tin):
  // admin / thành viên quản lý ưu tiên An Tâm; khách ưu tiên An Nhiên (bot nhắc bữa ăn); thiếu bot nào thì dùng bot còn lại.
  const ntEsc = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const notifyTelegram = async (userId, title, content, link, btnText = 'Mở trang') => {
    const u = userId && db.get("SELECT is_admin, telegram_chat_id, antam_chat_id FROM users WHERE id = ? AND status = 'active'", [userId]);
    if (!u) return null;
    const url = link ? `${SITE_URL}/${link}` : SITE_URL;
    const text = `<b>${ntEsc(title)}</b>\n${ntEsc(content)}`;
    const viaAntam = () => antamApi('sendMessage', { chat_id: u.antam_chat_id, parse_mode: 'HTML', text, reply_markup: { inline_keyboard: [[{ text: btnText, url }]] } });
    const viaAnNhien = () => sendTelegramMessage(u.telegram_chat_id, `${text}\n<a href="${ntEsc(url)}">👉 ${ntEsc(btnText)}</a>`);
    try {
      if (u.antam_chat_id && (u.is_admin || !u.telegram_chat_id)) { if ((await viaAntam())?.ok) return 'antam'; }
      if (u.telegram_chat_id) { if ((await viaAnNhien())?.ok) return 'annhien'; }
      if (u.antam_chat_id && !u.is_admin && u.telegram_chat_id) { if ((await viaAntam())?.ok) return 'antam'; }
    } catch (e) { console.error('[Telegram] gửi:', e.message); }
    return null;
  };
  // Gửi lần lượt (tránh vượt giới hạn Telegram ~30 tin/giây)
  const notifyTelegramMany = async (userIds, title, content, link, btnText) => {
    let n = 0;
    for (const id of userIds) { if (await notifyTelegram(id, title, content, link, btnText)) n++; await new Promise(r => setTimeout(r, 60)); }
    return n;
  };

  // Báo cho khách: đã nhận yêu cầu tham gia chương trình / khoá học trả phí (chuông + đẩy + Telegram nếu đã kết nối)
  const notifyEnrollRequested = (userId, programName, link) => {
    const title = `📩 Đã nhận yêu cầu tham gia ${programName}`;
    const content = 'Ban tổ chức đã nhận yêu cầu của bạn và sẽ liên hệ trong thời gian sớm nhất. Khi được duyệt, bạn sẽ nhận thông báo để bắt đầu.';
    try {
      db.run('INSERT INTO notifications (user_id, type, title, content, link) VALUES (?,?,?,?,?)', [userId, 'course', title, content, link]);
      pushNotify(userId, { title, body: content, link });
    } catch (e) { console.error('[enroll notify]', e.message); }
    notifyTelegram(userId, title, content, link, '🔎 Xem chi tiết').catch(() => {});
  };

  // Báo cho khách: yêu cầu tham gia chưa được duyệt (chuông + đẩy + Telegram). note = lý do admin nhập (tuỳ chọn).
  const notifyEnrollRejected = (userId, programName, note) => {
    const title = `Yêu cầu tham gia ${programName} chưa được duyệt`;
    const reason = String(note || '').trim();
    const content = `Ban tổ chức chưa thể duyệt yêu cầu tham gia ${programName} của bạn lúc này.`
      + (reason && reason !== 'Từ chối qua Telegram' ? ` Lý do: ${reason}.` : '')
      + ' Nếu cần trao đổi thêm, bạn nhắn cho Ban tổ chức ở mục Liên hệ BTC nhé.';
    const link = 'lien-he.html';
    try {
      db.run('INSERT INTO notifications (user_id, type, title, content, link) VALUES (?,?,?,?,?)', [userId, 'course', title, content, link]);
      pushNotify(userId, { title, body: content, link });
    } catch (e) { console.error('[enroll reject notify]', e.message); }
    notifyTelegram(userId, title, content, link, '💬 Liên hệ BTC').catch(() => {});
  };

  // Bài đăng mới: Space công khai (hoặc không thuộc Space) → mọi thành viên đang hoạt động;
  // Space riêng tư / bí mật → chỉ thành viên đã được duyệt vào Space đó. Không báo cho người đăng.
  const notifyNewPost = (postId, authorId, spaceId, title, content) => {
    try {
      const space = spaceId ? db.get('SELECT id, name, visibility FROM spaces WHERE id = ?', [spaceId]) : null;
      const recipients = space && space.visibility !== 'public'
        ? db.all(`SELECT DISTINCT u.id FROM space_members m JOIN users u ON u.id = m.user_id
                  WHERE m.space_id = ? AND m.status = 'approved' AND u.status = 'active' AND u.id <> ?`, [space.id, authorId])
        : db.all("SELECT id FROM users WHERE status = 'active' AND id <> ?", [authorId]);
      if (!recipients.length) return;
      const a = db.get('SELECT first_name, last_name FROM users WHERE id = ?', [authorId]) || {};
      const who = `${a.first_name || ''} ${a.last_name || ''}`.trim() || 'Một thành viên';
      const nTitle = `📝 ${who} vừa đăng bài${space ? ` trong ${space.name}` : ' trên Feed'}`;
      const snippet = String(title || '').trim() || String(content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const body = snippet.length > 160 ? snippet.slice(0, 157) + '…' : snippet;
      const link = `feed.html?post_id=${postId}`;
      // Ghi 1 lần cho cả nhóm (db.run lưu file sau mỗi lệnh)
      const stmt = db._.prepare('INSERT INTO notifications (user_id, type, title, content, link) VALUES (?,?,?,?,?)');
      recipients.forEach(r => stmt.run([r.id, 'feed', nTitle, body, link]));
      stmt.free();
      db._save();
      recipients.forEach(r => pushNotify(r.id, { title: nTitle, body, link }));
      console.log(`[post notify] bài ${postId} → ${recipients.length} người (${space ? space.visibility : 'feed'})`);
    } catch (e) { console.error('[post notify]', e.message); }
  };

  // Báo cho người dùng: thông báo trong app + đẩy + Telegram (An Tâm / An Nhiên nếu đã kết nối)
  const tbNotify = (userId, title, content) => {
    if (!userId) return;
    const link = 'kanban-nhiem-vu.html';
    try {
      db.run('INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)', [userId, 'system', title, content, link]);
      pushNotify(userId, { title, body: content, link });
    } catch (e) { console.error('[Kanban] thông báo:', e.message); }
    notifyTelegram(userId, title, content, link, '🗂️ Mở Kanban').catch(() => {});
  };

  // ── Phân công theo sự kiện: mỗi sự kiện / buổi Zoom có 5 vai trò, giao cho thành viên trong bảng phân công.
  // Việc hiện trên Kanban của người được giao vào ngày = ngày sự kiện − số ngày "làm trước" của vai trò.
  db.exec(`CREATE TABLE IF NOT EXISTS event_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL, role TEXT NOT NULL, member_id TEXT NOT NULL,
    event_title TEXT, event_date TEXT NOT NULL, event_time TEXT, task_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(event_key, role))`);
  const EVENT_ROLES = [
    { id: 'content', icon: '✍️', label: 'Lên nội dung, kịch bản', offset: 2 },
    { id: 'host', icon: '🎤', label: 'Thực hiện (dẫn / trình bày)', offset: 0 },
    { id: 'tech', icon: '🖥️', label: 'Mở phòng Zoom, kỹ thuật', offset: 0 },
    { id: 'marketing', icon: '📣', label: 'Marketing', offset: 3 },
    { id: 'reminder', icon: '🔔', label: 'Nhắc nhở cộng đồng', offset: 0 },
  ];
  const eventRoleOffsets = () => {
    let saved = {}; try { saved = JSON.parse(db.get("SELECT value FROM site_settings WHERE key='event_role_offsets'")?.value || '{}'); } catch {}
    const out = {}; EVENT_ROLES.forEach(r => { out[r.id] = Number.isInteger(saved[r.id]) ? saved[r.id] : r.offset; }); return out;
  };
  const tbEventTask = (row) => {
    const r = EVENT_ROLES.find(x => x.id === row.role) || { icon: '📅', label: row.role };
    return { id: 'evt:' + row.id, col: '__event', event: true, freq: 'once', date: row.task_date, role: row.role,
      text: `${r.icon} ${r.label} — **${row.event_title || 'Sự kiện'}** (${row.event_date.slice(8, 10)}/${row.event_date.slice(5, 7)}${row.event_time ? ' ' + row.event_time : ''})`,
      tag: row.task_date === row.event_date ? 'ngày diễn ra' : `trước ${Math.round((new Date(row.event_date) - new Date(row.task_date)) / 864e5)} ngày` };
  };
  const TB_EVENT_COLUMN = { id: '__event', name: 'Sự kiện / Zoom', role: 'Việc được giao theo lịch', color: '#e11d48', desc: '', is_agent: false };
  // Việc chăm sóc khách hàng ("care:<SĐT>"): mỗi khách đang được giao cho thành viên (theo tên trong bảng) là 1 việc
  // mỗi ngày, cho tới khi khách "Đã mua" / "Chưa mua" hoặc không nhận tin. Đánh dấu xong = đã chăm sóc khách hôm nay.
  const TB_CARE_COLUMN = { id: '__care', name: 'Chăm sóc khách hàng', role: 'Khách được giao trong Kanban khách hàng', color: '#0d9488', desc: '', is_agent: false };
  const CARE_NEXT = { new: 'Nhắn Zalo làm quen', messaged: 'Gọi điện hỏi thăm, tư vấn', called: 'Hẹn lịch tư vấn 1-1', booked: 'Tư vấn 1-1 & chốt' };
  const CARE_LABEL = { new: 'Chưa liên hệ', messaged: 'Đã nhắn', called: 'Đã gọi', booked: 'Đặt lịch 1-1', bought: 'Đã mua', not_bought: 'Chưa mua' };
  // Khách đã được duyệt vào 8 buổi / 377 ngày (tức đã mua) mà thẻ Kanban khách hàng vẫn ở bước chăm sóc
  // → tự chuyển "Đã mua" để việc chăm sóc hằng ngày kết thúc. Nhận ra khách qua user_id / email lúc điểm danh Zoom.
  let careSyncAt = 0;
  function careSyncStudents() {
    if (Date.now() - careSyncAt < 60e3) return;
    careSyncAt = Date.now();
    try {
      const rows = db.all(`SELECT c.phone FROM zoom_care c
        WHERE COALESCE(c.status,'new') NOT IN ('bought','not_bought')
          AND (EXISTS (SELECT 1 FROM zoom_checkins z JOIN users u ON (u.id = z.user_id OR (z.email <> '' AND lower(u.email) = lower(z.email)))
            WHERE z.phone = c.phone AND (
              EXISTS (SELECT 1 FROM workshop8_enrollments w WHERE w.user_id = u.id AND w.status = 'approved')
              OR EXISTS (SELECT 1 FROM program377_enrollments p WHERE p.user_id = u.id AND p.status = 'approved')))
          OR EXISTS (SELECT 1 FROM care_leads l WHERE l.phone = c.phone AND (
              EXISTS (SELECT 1 FROM workshop8_enrollments w WHERE w.user_id = l.user_id AND w.status = 'approved')
              OR EXISTS (SELECT 1 FROM program377_enrollments p WHERE p.user_id = l.user_id AND p.status = 'approved'))))`);
      rows.forEach(r => {
        db.run("UPDATE zoom_care SET status = 'bought', note = TRIM(COALESCE(note,'') || CASE WHEN COALESCE(note,'') = '' THEN '' ELSE ' · ' END || 'Tự chuyển Đã mua: đã được duyệt vào chương trình'), updated_at = datetime('now','localtime') WHERE phone = ?", [r.phone]);
        console.log(`[Kanban khách hàng] ${r.phone} đã được duyệt vào chương trình → Đã mua`);
      });
    } catch (e) { console.error('[Kanban khách hàng] tự chuyển Đã mua:', e.message); }
  }
  const careRowsFor = (memberName, onlyActive = true) => {
    if (!memberName) return [];
    careSyncStudents();
    try {
      return db.all(`SELECT c.phone, c.status, c.note, COALESCE((SELECT MAX(z.name) FROM zoom_checkins z WHERE z.phone = c.phone),
          (SELECT l.name FROM care_leads l WHERE l.phone = c.phone)) AS name
        FROM zoom_care c WHERE LOWER(TRIM(c.owner)) = LOWER(TRIM(?))${onlyActive ? " AND COALESCE(c.status,'new') NOT IN ('bought','not_bought') AND COALESCE(c.opt_out,0) = 0" : ''}
        ORDER BY c.updated_at`, [memberName]).filter(r => r.name);
    } catch (e) { return []; }
  };
  const tbCareTask = r => ({ id: 'care:' + r.phone, col: '__care', care: true, freq: 'daily', link: 'kanban-khach-hang.html',
    text: `🤝 ${CARE_NEXT[r.status || 'new'] || 'Chăm sóc khách'} — **${r.name}** (${r.phone})`, tag: CARE_LABEL[r.status || 'new'] || '' });
  // Tìm việc của thành viên: việc cố định trong bảng, hoặc việc theo sự kiện ("evt:<id>"), hoặc khách được giao ("care:<SĐT>")
  const tbFindTask = (m, taskId) => {
    if (!m) return null;
    if (String(taskId || '').startsWith('care:')) {
      const r = careRowsFor(m.name, false).find(x => x.phone === String(taskId).slice(5));
      return r ? tbCareTask(r) : null;
    }
    if (String(taskId || '').startsWith('evt:')) {
      const row = db.get('SELECT * FROM event_assignments WHERE id = ? AND member_id = ?', [parseInt(String(taskId).slice(4), 10) || 0, m.id]);
      return row ? tbEventTask(row) : null;
    }
    return (m.tasks || []).find(x => x.id === taskId) || null;
  };
  // Kỳ của 1 lần việc: việc sự kiện cố định theo ngày được giao
  const tbKey = (t, date) => t.event ? 'D:' + t.date : tbPeriodKey(taskFreq(t), date);

  // Trạng thái các việc trong ngày `date` (việc tuần/tháng lấy theo tuần/tháng chứa ngày đó)
  app.get('/api/task-board/state', (req, res) => {
    const date = tbValidDate(req.query.date) ? req.query.date : tbToday();
    const board = publicTaskBoard();
    // Việc theo sự kiện của ngày này
    if (date >= tbAddDays(tbToday(), -1)) eaPruneOrphans();
    const evRows = db.all('SELECT * FROM event_assignments WHERE task_date = ? ORDER BY event_time, id', [date]);
    if (evRows.length) {
      board.columns = [...(board.columns || []), TB_EVENT_COLUMN];
      evRows.forEach(r => { const m = board.members.find(x => x.id === r.member_id); if (m) m.tasks = [...m.tasks, tbEventTask(r)]; });
    }
    // Khách đang được giao: hiện ở ngày hôm nay (và các ngày đã đánh dấu chăm sóc)
    let careAdded = false;
    board.members.forEach(m => {
      const active = date === tbToday() ? careRowsFor(m.name).map(r => r.phone) : [];
      const rows = careRowsFor(m.name, false).filter(r => active.includes(r.phone)
        || db.get("SELECT 1 AS x FROM task_board_log WHERE member_id = ? AND task_id = ? AND period_key = ?", [m.id, 'care:' + r.phone, 'D:' + date]));
      if (rows.length) { m.tasks = [...m.tasks, ...rows.map(tbCareTask)]; careAdded = true; }
    });
    if (careAdded) board.columns = [...(board.columns || []), TB_CARE_COLUMN];
    const statuses = {}, helps = {};
    board.members.forEach(m => m.tasks.forEach(t => {
      const key = tbKey(t, date);
      const row = db.get(`SELECT l.status, l.updated_at, u.first_name, u.last_name FROM task_board_log l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.member_id = ? AND l.task_id = ? AND l.period_key = ?`, [m.id, t.id, key]);
      if (row) statuses[`${m.id}|${t.id}`] = { status: row.status, at: row.updated_at, by: `${row.first_name || ''} ${row.last_name || ''}`.trim() };
      const h = tbActiveHelp(m.id, t.id, key);
      if (h) helps[`${m.id}|${t.id}`] = tbHelpOut(h);
    }));
    const me = tbMe(req);
    // Hộp thư: lời nhờ đang chờ gửi đến (các) thành viên của tôi
    let inbox = [];
    // Admin thấy mọi lời nhờ đang chờ (nhận / từ chối giúp được)
    if (me && (me.member_ids.length || me.is_admin)) {
      const all = getTaskBoard().members || [];
      inbox = (me.is_admin
        ? db.all("SELECT * FROM task_help WHERE status = 'pending' ORDER BY id DESC LIMIT 50")
        : db.all(`SELECT * FROM task_help WHERE status = 'pending' AND to_member_id IN (${me.member_ids.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 50`, me.member_ids))
        .map(h => {
          const m = all.find(x => x.id === h.member_id), t = tbFindTask(m, h.task_id);
          return t ? { ...tbHelpOut(h), owner_name: m.name, task_text: t.text, work_date: h.work_date, freq: taskFreq(t), created_at: h.created_at } : null;
        }).filter(Boolean);
    }
    res.json({ date, today: tbToday(), board, statuses, helps, inbox, me });
  });

  app.post('/api/task-board/state', (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.status(401).json({ error: 'Vui lòng đăng nhập để cập nhật việc của bạn.', code: 'session_required' });
    const { member_id, task_id, status } = req.body || {};
    const date = tbValidDate(req.body?.date) ? req.body.date : tbToday();
    if (!['todo', 'doing', 'done'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    if (date > tbToday()) return res.status(400).json({ error: 'Không cập nhật được ngày trong tương lai.' });
    if (date < tbAddDays(tbToday(), -92)) return res.status(400).json({ error: 'Chỉ cập nhật được trong 3 tháng gần nhất.' });
    const m = (getTaskBoard().members || []).find(x => x.id === member_id);
    const t = tbFindTask(m, task_id);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy việc này (bảng có thể vừa được sửa — tải lại trang).' });
    const key = tbKey(t, date);
    const help = tbActiveHelp(m.id, t.id, key);
    if (!tbCanEditInstance(u, m, help)) return res.status(403).json({ error: help && help.status === 'accepted'
      ? `Việc này đã chuyển cho ${tbMemberName(help.to_member_id)} hỗ trợ.` : `Bạn chỉ cập nhật được việc của mình. Việc này của ${m.name}.` });
    if (status === 'todo') db.run('DELETE FROM task_board_log WHERE member_id = ? AND task_id = ? AND period_key = ?', [m.id, t.id, key]);
    else db.run(`INSERT INTO task_board_log (member_id, task_id, period_key, status, user_id, updated_at) VALUES (?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(member_id, task_id, period_key) DO UPDATE SET status = excluded.status, user_id = excluded.user_id, updated_at = excluded.updated_at`,
      [m.id, t.id, key, status, u.id]);
    res.json({ ok: true });
  });

  // Gửi lời nhờ hỗ trợ cho 1 lần việc
  app.post('/api/task-board/help', (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.status(401).json({ error: 'Vui lòng đăng nhập để nhờ hỗ trợ.', code: 'session_required' });
    const { member_id, task_id, to_member_id } = req.body || {};
    const note = String(req.body?.note || '').trim().slice(0, 300);
    const date = tbValidDate(req.body?.date) ? req.body.date : tbToday();
    if (date > tbToday() || date < tbAddDays(tbToday(), -92)) return res.status(400).json({ error: 'Ngày không hợp lệ.' });
    const members = getTaskBoard().members || [];
    const m = members.find(x => x.id === member_id), t = tbFindTask(m, task_id);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy việc này (tải lại trang).' });
    const to = members.find(x => x.id === to_member_id);
    if (!to || to.id === m.id) return res.status(400).json({ error: 'Chọn một thành viên khác để nhờ.' });
    if (!to.user_id) return res.status(400).json({ error: `${to.name} chưa được gắn tài khoản nên chưa nhận được lời nhờ. Nhờ admin gắn email ở Admin → Phân công nhiệm vụ.` });
    const key = tbKey(t, date);
    const cur = tbActiveHelp(m.id, t.id, key);
    if (cur && cur.status === 'accepted') return res.status(400).json({ error: `Việc này đã chuyển cho ${tbMemberName(cur.to_member_id)}.` });
    if (!u.is_admin && m.user_id !== u.id) return res.status(403).json({ error: `Chỉ ${m.name} (hoặc admin) mới nhờ hỗ trợ việc này.` });
    if (db.get("SELECT 1 AS x FROM task_board_log WHERE member_id = ? AND task_id = ? AND period_key = ? AND status = 'done'", [m.id, t.id, key]))
      return res.status(400).json({ error: 'Việc này đã xong rồi.' });
    if (cur) db.run("UPDATE task_help SET status = 'cancelled', responded_by = ?, responded_at = datetime('now','localtime') WHERE id = ?", [u.id, cur.id]);
    const r = db.run('INSERT INTO task_help (member_id, task_id, period_key, work_date, to_member_id, from_user_id, note) VALUES (?,?,?,?,?,?,?)',
      [m.id, t.id, key, date, to.id, u.id, note || null]);
    const plain = String(t.text).replace(/\*\*/g, '');
    tbNotify(to.user_id, `🤝 ${m.name} nhờ bạn hỗ trợ`, `"${plain}" (${date.split('-').reverse().join('/')})${note ? ' — ' + note : ''}. Mở Kanban để Nhận việc hoặc Từ chối.`);
    res.json({ ok: true, id: r.lastInsertRowid });
  });

  // Trả lời lời nhờ: accept / decline (người được nhờ hoặc admin), cancel (người nhờ, chủ việc hoặc admin)
  app.post('/api/task-board/help/:id/respond', (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.status(401).json({ error: 'Vui lòng đăng nhập.', code: 'session_required' });
    const action = req.body?.action;
    if (!['accept', 'decline', 'cancel'].includes(action)) return res.status(400).json({ error: 'Thao tác không hợp lệ.' });
    const h = db.get('SELECT * FROM task_help WHERE id = ?', [parseInt(req.params.id, 10) || 0]);
    if (!h || h.status !== 'pending') return res.status(400).json({ error: 'Lời nhờ này đã được xử lý hoặc đã huỷ (tải lại trang).' });
    const members = getTaskBoard().members || [];
    const owner = members.find(x => x.id === h.member_id), to = members.find(x => x.id === h.to_member_id);
    const t = tbFindTask(owner, h.task_id);
    if (!t) return res.status(404).json({ error: 'Việc này không còn trong bảng.' });
    if (action === 'cancel') {
      if (!u.is_admin && h.from_user_id !== u.id && owner.user_id !== u.id) return res.status(403).json({ error: 'Chỉ người nhờ (hoặc admin) mới huỷ được.' });
    } else if (!u.is_admin && (!to || to.user_id !== u.id)) return res.status(403).json({ error: `Lời nhờ này gửi cho ${to?.name || 'người khác'}.` });
    const status = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[action];
    db.run("UPDATE task_help SET status = ?, responded_by = ?, responded_at = datetime('now','localtime') WHERE id = ?", [status, u.id, h.id]);
    const plain = String(t.text).replace(/\*\*/g, '');
    if (action === 'accept') tbNotify(h.from_user_id !== u.id ? h.from_user_id : null, `✅ ${to.name} đã nhận hỗ trợ`, `"${plain}" đã chuyển cho ${to.name}.`);
    if (action === 'decline') tbNotify(h.from_user_id !== u.id ? h.from_user_id : null, `✖ ${to.name} chưa nhận được`, `"${plain}" — bạn có thể nhờ người khác.`);
    res.json({ ok: true, status });
  });

  // KPI: tỉ lệ hoàn thành theo ngày / tuần / tháng / quý (tính đến hôm nay, từ ngày bắt đầu theo dõi)
  app.get('/api/task-board/kpi', (req, res) => {
    const period = ['day', 'week', 'month', 'quarter'].includes(req.query.period) ? req.query.period : 'day';
    const today = tbToday();
    const ref = tbValidDate(req.query.date) && req.query.date <= today ? req.query.date : today;
    let from, to;
    if (period === 'day') from = to = ref;
    else if (period === 'week') { from = tbMonday(ref); to = tbAddDays(from, 6); }
    else if (period === 'month') { from = ref.slice(0, 8) + '01'; to = tbAddDays(tbAddDays(from, 32).slice(0, 8) + '01', -1); }
    else { const q = Math.floor((+ref.slice(5, 7) - 1) / 3); from = `${ref.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}-01`; to = tbAddDays(tbAddDays(from, 95).slice(0, 8) + '01', -1); }
    const kpiStart = db.get("SELECT value FROM site_settings WHERE key='task_board_kpi_start'")?.value || today;
    const a = from > kpiStart ? from : kpiStart, z = to < today ? to : today;
    // Các kỳ (ngày/tuần/tháng) nằm trong khoảng [a, z]
    const keys = { daily: [], weekly: [], monthly: [] };
    if (a <= z) for (let d = a; d <= z; d = tbAddDays(d, 1)) {
      keys.daily.push('D:' + d);
      if (!keys.weekly.includes('W:' + tbMonday(d))) keys.weekly.push('W:' + tbMonday(d));
      if (!keys.monthly.includes('M:' + d.slice(0, 7))) keys.monthly.push('M:' + d.slice(0, 7));
    }
    const board = publicTaskBoard();
    const members = board.members.map(m => {
      const logs = db.all("SELECT task_id, period_key FROM task_board_log WHERE member_id = ? AND status = 'done'", [m.id]);
      const doneSet = new Set(logs.map(l => l.task_id + '|' + l.period_key));
      let expected = 0, done = 0, adhoc = 0;
      const tasks = m.tasks.map(t => {
        if (t.freq === 'adhoc') {
          const n = keys.daily.filter(k => doneSet.has(t.id + '|' + k)).length;
          adhoc += n;
          return { id: t.id, text: t.text, freq: t.freq, done: n };
        }
        const ks = keys[t.freq];
        const n = ks.filter(k => doneSet.has(t.id + '|' + k)).length;
        expected += ks.length; done += n;
        return { id: t.id, text: t.text, freq: t.freq, expected: ks.length, done: n };
      });
      // Việc theo sự kiện được giao trong khoảng [a, z]
      if (a <= z) db.all('SELECT * FROM event_assignments WHERE member_id = ? AND task_date BETWEEN ? AND ? ORDER BY task_date', [m.id, a, z]).forEach(r => {
        const t = tbEventTask(r), n = doneSet.has(t.id + '|D:' + r.task_date) ? 1 : 0;
        expected += 1; done += n;
        tasks.push({ id: t.id, text: t.text, freq: 'once', expected: 1, done: n });
      });
      // Chăm sóc khách hàng: mỗi lần đánh dấu "đã chăm sóc" trong ngày tính là 1 việc phát sinh đã làm
      const careDone = logs.filter(l => String(l.task_id).startsWith('care:') && keys.daily.includes(l.period_key)).length;
      if (careDone) { adhoc += careDone; tasks.push({ id: 'care', text: '🤝 Chăm sóc khách hàng được giao', freq: 'adhoc', done: careDone }); }
      return { id: m.id, name: m.name, role: m.role, expected, done, adhoc, tasks };
    });
    // Lần việc đã nhận hỗ trợ: chuyển phần "cần làm" (và "đã xong" nếu xong) từ chủ việc sang người nhận
    const byId = {}; members.forEach(m => { byId[m.id] = m; });
    db.all("SELECT member_id, task_id, period_key, to_member_id FROM task_help WHERE status = 'accepted'").forEach(h => {
      const owner = byId[h.member_id], helper = byId[h.to_member_id];
      const t = owner && tbFindTask(getTaskBoard().members.find(x => x.id === h.member_id), h.task_id);
      if (!t || !helper) return;
      const tf = taskFreq(t);
      const inRange = (tf === 'adhoc' || tf === 'once' ? keys.daily : keys[tf]).includes(h.period_key);
      if (!inRange) return;
      const isDone = db.get("SELECT 1 AS x FROM task_board_log WHERE member_id = ? AND task_id = ? AND period_key = ? AND status = 'done'", [h.member_id, h.task_id, h.period_key]) ? 1 : 0;
      const ot = owner.tasks.find(x => x.id === t.id);
      if (!ot) return;
      if (tf === 'adhoc') { owner.adhoc -= isDone; helper.adhoc += isDone; ot.done -= isDone; }
      else { owner.expected -= 1; owner.done -= isDone; helper.expected += 1; helper.done += isDone; ot.expected -= 1; ot.done -= isDone; }
      helper.tasks.push({ id: t.id, text: `🤝 ${t.text} (giúp ${owner.name})`, freq: tf, ...(tf === 'adhoc' ? {} : { expected: 1 }), done: isDone });
    });
    members.forEach(m => { m.pct = m.expected ? Math.round(m.done * 100 / m.expected) : null; });
    const te = members.reduce((s, m) => s + m.expected, 0), td = members.reduce((s, m) => s + m.done, 0);
    res.json({ period, from, to, counted_from: a, counted_to: z, kpi_start: kpiStart, members,
      team: { expected: te, done: td, pct: te ? Math.round(td * 100 / te) : null, adhoc: members.reduce((s, m) => s + m.adhoc, 0) } });
  });

  // ── Lịch cộng đồng (thay cho nhúng Google Calendar): sự kiện + lặp lại + nhắc lịch ──
  db.exec(`CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT, location TEXT, link TEXT, color TEXT,
    start_date TEXT NOT NULL, start_time TEXT, end_time TEXT,
    repeat TEXT DEFAULT 'none', repeat_until TEXT, skip_dates TEXT,
    remind_minutes INTEGER DEFAULT 0, remind_target TEXT DEFAULT 'all',
    source_uid TEXT, created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS calendar_reminder_log (
    event_id INTEGER NOT NULL, occ_date TEXT NOT NULL, sent_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(event_id, occ_date))`);
  const CAL_REPEATS = ['none', 'daily', 'weekly', 'monthly'];
  const CAL_TARGETS = ['all', 'admins'];
  const calNowVN = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); // "YYYY-MM-DD HH:MM"
  const calTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : null;
  const calSkips = ev => { try { return JSON.parse(ev.skip_dates || '[]'); } catch { return []; } };
  // Trải sự kiện (kể cả lặp lại) ra các lần diễn ra trong [from, to]
  const calExpand = (ev, from, to) => {
    const out = [], skips = new Set(calSkips(ev));
    const until = ev.repeat_until && ev.repeat_until < to ? ev.repeat_until : to;
    const push = d => { if (d >= from && d <= until && d >= ev.start_date && !skips.has(d)) out.push(d); };
    if (ev.repeat === 'none' || !ev.repeat) { push(ev.start_date); return out; }
    if (ev.repeat === 'daily' || ev.repeat === 'weekly') {
      const step = ev.repeat === 'daily' ? 1 : 7;
      let d = ev.start_date;
      if (d < from) { const gap = Math.round((new Date(from + 'T00:00:00Z') - new Date(d + 'T00:00:00Z')) / 864e5); d = tbAddDays(d, Math.floor(gap / step) * step); }
      for (let i = 0; d <= until && i < 400; d = tbAddDays(d, step), i++) push(d);
      return out;
    }
    // monthly: cùng ngày trong tháng (tháng không có ngày đó thì bỏ qua)
    const day = ev.start_date.slice(8, 10);
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    for (let i = 0; i < 40; i++) {
      const d = `${y}-${String(m).padStart(2, '0')}-${day}`;
      if (d > until) break;
      if (tbValidDate(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d) push(d);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  };
  const calPublic = (ev, date) => ({
    id: ev.id, date, title: ev.title, description: ev.description || '', location: ev.location || '', link: ev.link || '',
    color: ev.color || '#0ea5e9', start_time: ev.start_time || null, end_time: ev.end_time || null,
    repeat: ev.repeat || 'none', repeat_until: ev.repeat_until || null, start_date: ev.start_date,
    remind_minutes: ev.remind_minutes || 0, remind_target: ev.remind_target || 'all',
  });
  const calAdmin = (req, res) => {
    const u = userFromSession(req);
    if (!u) { res.status(401).json({ error: 'Vui lòng đăng nhập bằng tài khoản admin.', code: 'session_required' }); return null; }
    if (!u.is_admin) { res.status(403).json({ error: 'Chỉ admin mới chỉnh được lịch.' }); return null; }
    return u;
  };
  const calClean = (b) => {
    const s = (v, n) => String(v ?? '').trim().slice(0, n);
    const ev = {
      title: s(b.title, 150), description: s(b.description, 3000), location: s(b.location, 150),
      link: /^https?:\/\//i.test(s(b.link, 500)) ? s(b.link, 500) : '',
      color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#0ea5e9',
      start_date: tbValidDate(b.start_date) ? b.start_date : null,
      start_time: calTime(b.start_time), end_time: calTime(b.end_time),
      repeat: CAL_REPEATS.includes(b.repeat) ? b.repeat : 'none',
      repeat_until: tbValidDate(b.repeat_until) ? b.repeat_until : null,
      remind_minutes: Math.max(0, Math.min(10080, parseInt(b.remind_minutes, 10) || 0)),
      remind_target: CAL_TARGETS.includes(b.remind_target) ? b.remind_target : 'all',
    };
    if (!ev.title) return { error: 'Nhập tiêu đề sự kiện.' };
    if (!ev.start_date) return { error: 'Chọn ngày.' };
    if (!ev.start_time) ev.end_time = null;
    if (ev.start_time && ev.end_time && ev.end_time <= ev.start_time) return { error: 'Giờ kết thúc phải sau giờ bắt đầu.' };
    if (ev.repeat === 'none') ev.repeat_until = null;
    return { ev };
  };

  // Buổi Zoom của 3 chương trình — đọc thẳng từ thiết lập admin (3 buổi / 8 buổi: site_settings; 377 ngày: program377_sessions)
  // nên admin sửa ở đó là lịch đổi theo, không nhập 2 lần. Không đưa link Zoom ra lịch công khai — dẫn về trang chương trình.
  db.exec('CREATE TABLE IF NOT EXISTS calendar_program_reminder_log (rkey TEXT PRIMARY KEY, sent_at TEXT DEFAULT (datetime(\'now\',\'localtime\')))');
  const CAL_PROGRAMS = {
    workshop3: { label: '3 Buổi Workshop', color: '#f59e0b', page: 'workshop3.html' },
    workshop8: { label: '8 Buổi Chuyên Sâu', color: '#8b5cf6', page: 'workshop8.html' },
    program377: { label: '377 ngày thực hành', color: '#10b981', page: 'program377.html' },
  };
  // "20:00 - 21:30 (Zoom mở lúc 19:45)" → { start: '20:00', end: '21:30' }
  const calParseTime = (note) => {
    const t = String(note || ''), pad = (h, m) => `${String(+h).padStart(2, '0')}:${m}`;
    const r = t.match(/(\d{1,2})[:hg](\d{2})\s*[-–đến]+\s*(\d{1,2})[:hg](\d{2})/);
    if (r && +r[1] < 24 && +r[3] < 24) return { start: pad(r[1], r[2]), end: pad(r[3], r[4]) };
    const one = t.match(/(\d{1,2})[:hg](\d{2})/);
    return one && +one[1] < 24 ? { start: pad(one[1], one[2]), end: null } : { start: null, end: null };
  };
  const calStripHtml = h => String(h || '').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200);
  const calProgramRemind = () => {
    try { return { workshop3: 60, workshop8: 60, program377: 60, ...JSON.parse(db.get("SELECT value FROM site_settings WHERE key='calendar_program_remind'")?.value || '{}') }; }
    catch { return { workshop3: 60, workshop8: 60, program377: 60 }; }
  };
  const calProgramEvents = (from, to) => {
    const out = [], rem = calProgramRemind();
    const add = (prog, idx, date, title, timeNote, desc) => {
      if (!tbValidDate(date) || date < from || date > to) return;
      const t = calParseTime(timeNote), P = CAL_PROGRAMS[prog];
      out.push({ id: `${prog}-${idx}`, program: prog, program_label: P.label, page: P.page, readonly: true, date, start_date: date,
        title: title || P.label, description: calStripHtml(desc), location: 'Zoom', link: '', color: P.color,
        start_time: t.start, end_time: t.start ? t.end : null, time_note: String(timeNote || ''), repeat: 'none', repeat_until: null,
        remind_minutes: t.start ? (+rem[prog] || 0) : 0, remind_target: prog === 'workshop3' ? 'all' : 'enrolled' });
    };
    for (const prog of ['workshop3', 'workshop8']) {
      let list = [];
      try { list = JSON.parse(db.get('SELECT value FROM site_settings WHERE key = ?', [`${prog}_sessions`])?.value || '[]'); } catch {}
      const note = db.get('SELECT value FROM site_settings WHERE key = ?', [`${prog}_time_note`])?.value || '';
      (Array.isArray(list) ? list : []).forEach((x, i) => add(prog, i, String(x.date || '').slice(0, 10), x.title, x.time || note, x.content_html));
    }
    db.all('SELECT id, session_date, session_time, title, description, content_html FROM program377_sessions WHERE session_date BETWEEN ? AND ?', [from, to])
      .forEach(x => add('program377', x.id, x.session_date, x.title, x.session_time, x.content_html || x.description));
    return out;
  };

  app.get('/api/calendar/events', (req, res) => {
    const from = tbValidDate(req.query.from) ? req.query.from : tbToday().slice(0, 8) + '01';
    let to = tbValidDate(req.query.to) ? req.query.to : tbAddDays(from, 41);
    if (to < from) to = from;
    if (to > tbAddDays(from, 400)) to = tbAddDays(from, 400);
    const u = userFromSession(req);
    const events = [];
    db.all('SELECT * FROM calendar_events WHERE start_date <= ?', [to]).forEach(ev => {
      calExpand(ev, from, to).forEach(d => events.push(calPublic(ev, d)));
    });
    events.push(...calProgramEvents(from, to));
    events.sort((a, b) => (a.date + (a.start_time || '00:00')).localeCompare(b.date + (b.start_time || '00:00')));
    res.json({ from, to, today: tbToday(), events, can_edit: !!(u && u.is_admin), programs: CAL_PROGRAMS, program_remind: calProgramRemind() });
  });


  // ── Vào Zoom qua form điểm danh: /vao-zoom?src=zalo → khách nhập Họ tên + Email + SĐT → ghi điểm danh
  // cho buổi Zoom đang diễn ra (theo Lịch) → chuyển sang phòng Zoom cố định, tự điền tên (uname).
  db.exec(`CREATE TABLE IF NOT EXISTS zoom_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT NOT NULL, session_title TEXT, session_date TEXT, session_time TEXT, program TEXT,
    user_id INTEGER, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, source TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_zoom_checkins_session ON zoom_checkins(session_key)');
  // Mặc định: link cố định của daymai (daymai tự tạo phòng Zoom mỗi buổi nên luôn dẫn đúng phòng)
  const ZOOM_DEFAULT_URL = '';
  const ZOOM_URL_RE = /^https:\/\/(([a-z0-9-]+\.)*zoom\.us|(www\.)?daymai\.vn)\//i;
  const zoomJoinUrl = () => {
    const v = String(db.get("SELECT value FROM site_settings WHERE key = 'zoom_join_url'")?.value || '').trim();
    return ZOOM_URL_RE.test(v) ? v : ZOOM_DEFAULT_URL;
  };
  const zoomPhone = p => String(p || '').replace(/[^\d+]/g, '').replace(/^\+?84/, '0');
  const zoomMin = hm => { const [h, m] = String(hm || '').split(':').map(Number); return h * 60 + (m || 0); };
  // Buổi Zoom "hiện tại" hôm nay: đang diễn ra hoặc sắp bắt đầu (mở trước 90 phút, nhận tới 3 giờ sau giờ bắt đầu
  // hoặc tới giờ kết thúc). Ưu tiên buổi của 3 chương trình, sau đó sự kiện Lịch có chữ "zoom".
  const ZOOM_OPEN_BEFORE = 90;   // phút mở cửa trước giờ học
  const zoomHM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const zoomTitleOf = e => (e.program_label && !String(e.title).includes(e.program_label) ? `${e.program_label}: ${e.title}` : e.title);
  // Các buổi Zoom trong khoảng ngày: buổi của 3 chương trình + sự kiện Lịch có chữ "zoom"
  function zoomEventsBetween(from, to) {
    const evs = [...calProgramEvents(from, to)];
    db.all('SELECT * FROM calendar_events WHERE start_date <= ?', [to]).forEach(ev => {
      calExpand(ev, from, to).forEach(d => {
        if (/zoom/i.test(`${ev.title} ${ev.location} ${ev.link} ${ev.description}`)) evs.push({ ...calPublic(ev, d), id: `cal${ev.id}`, program: 'calendar' });
      });
    });
    return evs;
  }
  // Buổi Zoom "hiện tại" hôm nay. open=false khi hôm nay có buổi trong Lịch nhưng chưa tới giờ mở cửa
  // (90 phút trước giờ học) hoặc đã kết thúc — khi đó trả next = buổi kế tiếp + giờ mở cửa.
  // Hôm nay không có buổi nào có giờ (Zoom đột xuất) thì vẫn mở như cũ.
  function zoomCurrentSession() {
    const now = calNowVN(), today = now.slice(0, 10), nowMin = zoomMin(now.slice(11));
    const evs = zoomEventsBetween(today, today);
    const timed = evs.filter(e => e.start_time).map(e => {
      const s = zoomMin(e.start_time), end = e.end_time ? Math.max(zoomMin(e.end_time), s + 60) : s + 180;
      return { e, s, end };
    });
    const live = timed.filter(x => nowMin >= x.s - ZOOM_OPEN_BEFORE && nowMin <= x.end).sort((a, b) => Math.abs(nowMin - a.s) - Math.abs(nowMin - b.s))[0];
    const pick = live?.e || (timed.length ? null : evs[0]);
    if (!pick) {
      const base = { key: `zoom@${today}`, title: `Zoom ngày ${today.split('-').reverse().join('/')}`, date: today, time: '', program: 'other' };
      if (!timed.length) return { ...base, open: true };
      // Có buổi hôm nay nhưng chưa mở / đã xong → tìm buổi kế tiếp (hôm nay hoặc 60 ngày tới)
      const later = timed.filter(x => x.s - ZOOM_OPEN_BEFORE > nowMin).sort((a, b) => a.s - b.s)[0];
      let next = later ? { title: zoomTitleOf(later.e), date: today, start: later.e.start_time, opens_at: zoomHM(Math.max(0, later.s - ZOOM_OPEN_BEFORE)) } : null;
      if (!next) {
        const ahead = zoomEventsBetween(tbAddDays(today, 1), tbAddDays(today, 60)).filter(e => e.start_time)
          .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))[0];
        if (ahead) next = { title: zoomTitleOf(ahead), date: ahead.date, start: ahead.start_time, opens_at: zoomHM(Math.max(0, zoomMin(ahead.start_time) - ZOOM_OPEN_BEFORE)) };
      }
      return { ...base, open: false, reason: later ? 'early' : 'ended', next };
    }
    return { key: `${pick.id}@${today}`, title: zoomTitleOf(pick),
      date: today, time: [pick.start_time, pick.end_time].filter(Boolean).join(' - '), program: pick.program, open: true };
  }
  app.get(['/zoom', '/vao-zoom'], (req, res) => res.redirect('/vao-zoom.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));
  app.get('/api/zoom/session', (_req, res) => {
    const s = zoomCurrentSession();
    res.json({ session: { title: s.title, date: s.date, time: s.time, program: s.program }, open: s.open, reason: s.reason || null, next: s.next || null, now: calNowVN() });
  });
  app.post('/api/zoom/checkin', (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    const phone = zoomPhone(b.phone).slice(0, 15);
    const source = String(b.src || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'khac';
    if (name.length < 2) return res.status(400).json({ error: 'Vui lòng nhập họ tên.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Email chưa đúng, vui lòng kiểm tra lại.' });
    if (!validPhone(phone)) return res.status(400).json({ error: 'Số điện thoại chưa đúng hoặc thiếu số. Số Việt Nam phải đủ 10 số (VD: 0912345678); ở nước ngoài ghi +mã nước.' });
    const s = zoomCurrentSession();
    if (!s.open) return res.status(409).json({ closed: true, reason: s.reason, next: s.next || null,
      error: s.next ? `Phòng Zoom chưa mở. Buổi tiếp theo mở cửa lúc ${s.next.opens_at} ngày ${s.next.date.split('-').reverse().join('/')}.` : 'Phòng Zoom chưa mở.' });
    const su = userFromSession(req);
    const user = (su && db.get('SELECT id FROM users WHERE id = ?', [su.id]))
      || db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email])
      || db.all("SELECT id, phone FROM users WHERE phone IS NOT NULL AND phone <> ''").find(u => zoomPhone(u.phone) === phone);
    db.run(`INSERT INTO zoom_checkins (session_key, session_title, session_date, session_time, program, user_id, name, email, phone, source)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [s.key, s.title, s.date, s.time, s.program, user?.id || null, name, email, phone, source]);
    const to = String(b.to || '').trim().slice(0, 500);
    const base = ZOOM_URL_RE.test(to) && !/zoom\.us\/s\//i.test(to) ? to : zoomJoinUrl();
    // Link zoom.us: tự điền tên (uname). Link daymai: để nguyên (daymai tự dẫn vào phòng Zoom của buổi).
    const url = /zoom\.us\//i.test(base) ? `${base}${base.includes('?') ? '&' : '?'}uname=${encodeURIComponent(name)}` : base;
    res.json({ ok: true, url, session: { title: s.title } });
  });

  // ══ Chăm sóc sau Zoom ═════════════════════════════════════════════════════════
  // 1) Trạng thái chăm sóc từng người (theo SĐT) — 2) gửi tin hàng loạt từ danh sách Zoom —
  // 3) chuỗi tin tự động sau mỗi buổi Workshop 3 buổi — 4) báo người phụ trách nhắn Zalo khách sau buổi.
  // Toàn bộ nội dung tin nằm trong site_settings.zoom_care_config (admin sửa được). Mặc định TẮT gửi tự động.
  db.exec(`CREATE TABLE IF NOT EXISTS zoom_care (
    phone TEXT PRIMARY KEY, status TEXT DEFAULT 'new', owner TEXT, note TEXT, reason TEXT, opt_out INTEGER DEFAULT 0,
    updated_at TEXT, updated_by INTEGER
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS zoom_care_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT, step_id TEXT, phone TEXT, channels TEXT, ok INTEGER DEFAULT 1, error TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')), UNIQUE(session_key, step_id, phone)
  )`);
  const ZC_STATUSES = { new: 'Chưa liên hệ', messaged: 'Đã nhắn', called: 'Đã gọi', booked: 'Đặt lịch 1-1', bought: 'Đã mua', not_bought: 'Chưa mua' };
  const ZC_SIGN = 'Ban tổ chức AI AGENTS CC';
  const ZC_DEFAULT = {
    enabled: false, enabled_at: null, signature: ZC_SIGN, booking_link: '', offer: '', offer_deadline: '', owner_email: '',
    // Chương trình nào được tự gửi tin / báo người phụ trách sau buổi
    programs: { workshop3: true, workshop8: false, program377: false, other: false },
    owner_programs: { workshop3: true, workshop8: false, program377: false, other: true },
    // Nội dung từng buổi: "0","1"… = Workshop 3 buổi; "w8:0"… = 8 buổi chuyên sâu; "p377:<id>" = buổi 377 ngày
    sessions: {},
    steps: [
      { id: 'early_thanks', group: 'early', label: 'Buổi 1–2 · 1 giờ sau Zoom: cảm ơn + việc nhỏ', enabled: true, timing: 'after', minutes: 60, only_not_booked: false,
        channels: { email: true, bell: true, telegram: true },
        title: 'Cảm ơn {ten} đã tham gia {buoi} 🌿',
        body: 'Chào {ten}, cảm ơn bạn đã dành thời gian cùng AI AGENTS CC tối nay.\n\nĐiều quan trọng nhất của buổi hôm nay: {tom_tat}\n\n👉 Việc nhỏ trong 24 giờ tới: {viec_nho}. Buổi sau mình cùng chia sẻ kết quả nhé.\n\nHẹn gặp bạn ở buổi tiếp theo: {buoi_sau}.' },
      { id: 'early_checkin', group: 'early', label: 'Buổi 1–2 · sau 24 giờ: hỏi thăm', enabled: true, timing: 'after', minutes: 1440, only_not_booked: false,
        channels: { email: true, bell: true, telegram: true },
        title: '{ten} làm thử chưa?',
        body: 'Chào {ten}, việc nhỏ hôm qua bạn làm được chưa, cơ thể có thay đổi gì không?\n\nDù chỉ là một thay đổi nhỏ (ngủ sâu hơn, đi vệ sinh dễ hơn, đỡ mệt…) hay chưa thấy gì, bạn cứ chia sẻ trong nhóm thảo luận hoặc nhắn cho Ban tổ chức. Mình sẽ dùng chính trải nghiệm của bạn trong buổi tới.' },
      { id: 'final_invite', group: 'final', label: 'Buổi 3 · 1 giờ sau Zoom: cảm ơn + mời tư vấn 1-1', enabled: true, timing: 'after', minutes: 60, only_not_booked: false,
        channels: { email: true, bell: true, telegram: true },
        title: '{ten} ơi, đây là bước tiếp theo của bạn',
        body: 'Cảm ơn {ten} đã đồng hành trọn 3 buổi workshop.\n\n3 buổi mới là bước khởi đầu. Để cơ thể thật sự chuyển hoá, bạn cần một lộ trình đúng với thể trạng của mình.\n\n📞 Đặt lịch tư vấn 1-1 miễn phí (15–20 phút): Ban tổ chức sẽ xem kết quả của bạn, giải đáp thắc mắc và gợi ý lộ trình phù hợp. Bạn không bắt buộc phải tham gia gói nào.\n👉 {link_dat_lich}\n\n🎁 Đặt lịch trước {han}: {uu_dai}.' },
      { id: 'final_doubt', group: 'final', label: 'Buổi 3 · sau 24 giờ (chưa đặt lịch): điều gì còn phân vân?', enabled: true, timing: 'after', minutes: 1440, only_not_booked: true,
        channels: { email: true, bell: true, telegram: true },
        title: 'Một câu hỏi nhỏ cho {ten}',
        body: 'Chào {ten}, mình thấy bạn chưa đặt lịch tư vấn. Không sao cả!\n\nMình chỉ muốn hỏi: điều gì khiến bạn còn phân vân? (thời gian, chi phí, chưa chắc có hợp với mình, hay sức khoẻ đang có bệnh nền…)\n\nBạn trả lời 1 dòng qua Zalo hoặc mục Liên hệ BTC, mình sẽ giải đáp riêng cho bạn.' },
      { id: 'final_deadline', group: 'final', label: 'Buổi 3 · ngày hết hạn ưu đãi (9:00 sáng): nhắc nhẹ', enabled: true, timing: 'deadline', minutes: 0, only_not_booked: true,
        channels: { email: true, bell: true, telegram: true },
        title: 'Hôm nay là ngày cuối nhận {uu_dai}',
        body: 'Chào {ten}, nhắc nhẹ: ưu đãi {uu_dai} dành cho học viên workshop kết thúc lúc 23:59 hôm nay.\n\nNếu bạn muốn được tư vấn lộ trình riêng, đặt lịch tại: {link_dat_lich}\n\nNếu chưa phải lúc, cũng hoàn toàn ổn. Cánh cửa AI AGENTS CC luôn mở 🌿' },
      { id: 'final_value', group: 'final', label: 'Buổi 3 · sau 5 ngày: nội dung hữu ích (không bán)', enabled: true, timing: 'after', minutes: 7200, only_not_booked: false,
        channels: { email: true, bell: true, telegram: false },
        title: 'Một mẹo nhỏ cho {ten} tuần này',
        body: 'Chào {ten}, chia sẻ với bạn một mẹo nhỏ: buổi sáng uống 1 ly nước ấm trước khi ăn, người thể Hàn có thể thêm 1–2 lát gừng.\n\n👉 Xem thêm trong cộng đồng: {link_cong_dong}\n\nChúc bạn một tuần nhẹ nhàng và khoẻ mạnh.' },
      { id: 'w8_thanks', group: 'w8', audience: 'attended', label: '8 buổi · 1 giờ sau Zoom: cảm ơn + bài tập', enabled: true, timing: 'after', minutes: 60, only_not_booked: false,
        channels: { email: true, bell: true, telegram: true },
        title: 'Cảm ơn {ten} đã tham gia {buoi} 🌿',
        body: 'Chào {ten}, cảm ơn bạn đã có mặt trong {buoi} hôm nay.\n\nĐiều quan trọng nhất của buổi: {tom_tat}\n\n👉 Bài thực hành tuần này: {viec_nho}\n\n🎬 Xem lại buổi học: {link_xem_lai}\n\nBuổi tiếp theo: {buoi_sau}.\n\nCó thắc mắc gì bạn cứ hỏi trong nhóm thảo luận 8 buổi nhé.' },
      { id: 'w8_absent', group: 'w8', audience: 'absent', label: '8 buổi · 2 giờ sau Zoom: nhắc học viên vắng mặt', enabled: false, timing: 'after', minutes: 120, only_not_booked: false,
        channels: { email: true, bell: true, telegram: true },
        title: '{ten} ơi, bạn đã bỏ lỡ {buoi}',
        body: 'Chào {ten}, hôm nay Ban tổ chức không thấy bạn trong {buoi}. Mong là mọi việc vẫn ổn với bạn.\n\nĐiều quan trọng nhất của buổi: {tom_tat}\n\n🎬 Bạn xem lại buổi học tại đây: {link_xem_lai}\n\n👉 Bài thực hành tuần này: {viec_nho}\n\nBuổi tiếp theo: {buoi_sau}.\n\nHẹn gặp bạn ở buổi sau nhé!' },
      { id: 'p377_thanks', group: 'p377', audience: 'attended', label: '377 ngày · 1 giờ sau Zoom: cảm ơn + việc thực hành', enabled: true, timing: 'after', minutes: 60, only_not_booked: false,
        channels: { email: false, bell: true, telegram: true },
        title: 'Cảm ơn {ten} đã tham gia {buoi} 🌿',
        body: 'Chào {ten}, cảm ơn bạn đã có mặt trong {buoi}.\n\nĐiều quan trọng nhất: {tom_tat}\n\n👉 Việc thực hành tiếp theo: {viec_nho}\n\n🎬 Xem lại: {link_xem_lai}\n\nBuổi tiếp theo: {buoi_sau}.\n\nNhớ ghi báo cáo hằng ngày để Ban tổ chức theo dõi cùng bạn nhé.' },
      { id: 'p377_absent', group: 'p377', audience: 'absent', label: '377 ngày · 2 giờ sau Zoom: nhắc học viên vắng mặt', enabled: false, timing: 'after', minutes: 120, only_not_booked: false,
        channels: { email: false, bell: true, telegram: true },
        title: '{ten} ơi, bạn đã bỏ lỡ {buoi}',
        body: 'Chào {ten}, hôm nay Ban tổ chức không thấy bạn trong {buoi}.\n\nĐiều quan trọng nhất: {tom_tat}\n\n🎬 Xem lại: {link_xem_lai}\n\nBuổi tiếp theo: {buoi_sau}.\n\nNếu bạn đang gặp khó khăn khi thực hành, cứ nhắn Ban tổ chức nhé.' },
      { id: 'other_thanks', group: 'other', audience: 'attended', label: 'Zoom khác · 1 giờ sau Zoom: cảm ơn', enabled: true, timing: 'after', minutes: 60, only_not_booked: false,
        channels: { email: true, bell: true, telegram: true },
        title: 'Cảm ơn {ten} đã tham gia {buoi} 🌿',
        body: 'Chào {ten}, cảm ơn bạn đã tham gia {buoi} cùng AI AGENTS CC.\n\nĐiều quan trọng nhất: {tom_tat}\n\n🎬 Xem lại: {link_xem_lai}\n\n👉 Tiếp tục trao đổi trong cộng đồng: {link_cong_dong}\n\nNếu bạn muốn được tư vấn riêng, đặt lịch 1-1 miễn phí tại: {link_dat_lich}' },
    ],
  };
  const ZC_GROUPS = ['early', 'final', 'w8', 'p377', 'other'];
  const ZC_PROG = {
    workshop3: { label: 'Workshop 3 buổi', page: 'workshop3.html' },
    workshop8: { label: '8 buổi chuyên sâu', page: 'workshop8.html' },
    program377: { label: '377 ngày thực hành', page: 'program377.html' },
    other: { label: 'Zoom khác (không định kỳ)', page: 'feed.html' },
  };
  function zcConfig() {
    let c = {};
    try { c = JSON.parse(db.get("SELECT value FROM site_settings WHERE key = 'zoom_care_config'")?.value || '{}') || {}; } catch { c = {}; }
    const out = { ...ZC_DEFAULT, ...c };
    out.sessions = c.sessions && typeof c.sessions === 'object' ? c.sessions : {};
    out.programs = { ...ZC_DEFAULT.programs, ...(c.programs || {}) };
    out.owner_programs = { ...ZC_DEFAULT.owner_programs, ...(c.owner_programs || {}) };
    out.steps = Array.isArray(c.steps) && c.steps.length ? c.steps : ZC_DEFAULT.steps;
    // Cấu hình lưu từ trước chỉ có tin của 3 buổi → bổ sung mẫu tin mặc định của chương trình mới
    const have = new Set(out.steps.map(s => s.id));
    out.steps = [...out.steps, ...ZC_DEFAULT.steps.filter(s => !have.has(s.id))];
    return out;
  }
  const zcSecret = () => {
    let s = db.get("SELECT value FROM admin_secrets WHERE key = 'zoom_care_secret'")?.value;
    if (!s) { s = crypto.randomBytes(24).toString('hex'); db.run("INSERT OR REPLACE INTO admin_secrets (key, value) VALUES ('zoom_care_secret', ?)", [s]); }
    return s;
  };
  const zcSig = phone => crypto.createHmac('sha256', zcSecret()).update('unsub:' + phone).digest('hex').slice(0, 20);
  const zcEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const zcKey = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/\s+/g, '_');
  // {ten} / {tên} / {Tên} đều được
  const zcFill = (tpl, vars) => String(tpl || '').replace(/\{([^{}]{1,30})\}/g, (m, k) => (zcKey(k) in vars ? String(vars[zcKey(k)] ?? '') : m));
  const zcFmtDate = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
  // Buổi Zoom thuộc chương trình nào (từ session_key "workshop3-<i>@…", "workshop8-<i>@…", "program377-<id>@…",
  // còn lại = Zoom khác) → nhóm tin, khoá nội dung buổi, tên buổi, buổi tiếp theo
  function zcSessInfo(sessionKey, fallbackTitle) {
    const key = String(sessionKey || '');
    const nextTxt = (title, date, time) => `${title}${date ? ' — ' + zcFmtDate(date) : ''}${calParseTime(time).start ? ' lúc ' + calParseTime(time).start : ''}`;
    let m = key.match(/^workshop([38])-(\d+)@/);
    if (m) {
      const prog = 'workshop' + m[1];
      let list = [];
      try { list = JSON.parse(db.get('SELECT value FROM site_settings WHERE key = ?', [`${prog}_sessions`])?.value || '[]'); } catch {}
      if (!Array.isArray(list)) list = [];
      const note = db.get('SELECT value FROM site_settings WHERE key = ?', [`${prog}_time_note`])?.value || '';
      const i = +m[2], next = list[i + 1], final = i >= list.length - 1;
      return { prog, ckey: prog === 'workshop3' ? String(i) : `w8:${i}`, final,
        group: prog === 'workshop3' ? (final ? 'final' : 'early') : 'w8',
        title: list[i]?.title || `Buổi ${i + 1}`, next: next ? nextTxt(next.title || `Buổi ${i + 2}`, next.date, next.time || note) : '' };
    }
    m = key.match(/^program377-(\d+)@/);
    if (m) {
      const row = db.get('SELECT id, session_date, title FROM program377_sessions WHERE id = ?', [+m[1]]);
      const next = row && db.get('SELECT title, session_date, session_time FROM program377_sessions WHERE session_date > ? ORDER BY session_date, id LIMIT 1', [row.session_date]);
      return { prog: 'program377', ckey: `p377:${+m[1]}`, group: 'p377', final: false,
        title: row?.title || fallbackTitle || 'buổi Zoom 377 ngày', next: next ? nextTxt(next.title, next.session_date, next.session_time) : '' };
    }
    return { prog: 'other', ckey: null, group: 'other', final: false, title: fallbackTitle || 'buổi Zoom', next: '' };
  }
  // Dòng chứa chữ tự điền đang trống (tóm tắt, việc nhỏ, link xem lại, ưu đãi…) thì bỏ cả dòng
  const ZC_OPTIONAL = ['tom_tat', 'viec_nho', 'buoi_sau', 'link_xem_lai', 'uu_dai', 'han'];
  function zcBody(tpl, vars) {
    const lines = String(tpl || '').split('\n').filter(l => {
      if (!vars.uu_dai && /🎁/.test(l)) return false;
      return ![...l.matchAll(/\{([^{}]{1,30})\}/g)].some(m => ZC_OPTIONAL.includes(zcKey(m[1])) && !String(vars[zcKey(m[1])] ?? '').trim());
    });
    return zcFill(lines.join('\n'), vars).replace(/\n{3,}/g, '\n\n').trim();
  }
  // Link mở khi bấm chuông / nút Telegram: học viên → trang chương trình; khách → đặt lịch tư vấn
  const zcLinkFor = prog => (prog === 'workshop8' || prog === 'program377'
    ? { link: ZC_PROG[prog].page, btn: '📖 Mở chương trình' } : { link: 'coach-1-1.html', btn: '📞 Đặt lịch tư vấn' });
  // Người đã đặt lịch 1-1 / đã mua → không gửi các tin "chưa đặt lịch"
  function zcBooked(phone, userId, sinceDate) {
    const c = db.get('SELECT status FROM zoom_care WHERE phone = ?', [phone]);
    if (c && ['booked', 'bought'].includes(c.status)) return true;
    return !!(userId && db.get("SELECT 1 AS x FROM coaching_bookings WHERE user_id = ? AND status <> 'cancelled' AND created_at >= ?", [userId, sinceDate || '2000-01-01']));
  }
  function zcVars(cfg, person, sessionKey, sessionTitle) {
    const info = sessionKey ? zcSessInfo(sessionKey, sessionTitle) : null;
    const s = info?.ckey != null ? (cfg.sessions[info.ckey] || {}) : {};
    return {
      ten: person.name, buoi: info?.title || sessionTitle || 'buổi Zoom', tom_tat: s.summary || '', viec_nho: s.task || '',
      link_xem_lai: s.replay || '', buoi_sau: info?.next || '', link_chuong_trinh: `${SITE_URL}/${ZC_PROG[info?.prog || 'other'].page}`,
      link_dat_lich: cfg.booking_link || `${SITE_URL}/coach-1-1.html`, link_cong_dong: `${SITE_URL}/feed.html`,
      uu_dai: cfg.offer || '', han: zcFmtDate(cfg.offer_deadline), ky_ten: cfg.signature || ZC_SIGN,
    };
  }
  // Gửi 1 tin cho 1 người qua các kênh đã chọn. person: { phone, name, email, user_id }
  async function zcSendOne(person, title, body, channels, cfg, link = 'coach-1-1.html', btnText = '📞 Đặt lịch tư vấn') {
    const done = [], errs = [];
    if (channels.email && person.email) {
      const unsub = `${SITE_URL}/api/zoom-care/unsub?p=${encodeURIComponent(person.phone)}&s=${zcSig(person.phone)}`;
      const html = zcEsc(body).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('')
        + `<p style="margin-top:18px;">${zcEsc(cfg.signature || ZC_SIGN)}</p>`
        + `<p style="font-size:11px;color:#94a3b8;margin-top:20px;">Bạn nhận email này vì là thành viên / đã tham gia Zoom của ${zcEsc(communityName())}.${/^[0+]\d/.test(String(person.phone)) ? ` <a href="${unsub}" style="color:#94a3b8;">Không nhận email chăm sóc nữa</a>.` : ''}</p>`;
      const r = await sendEmail({ to: person.email, subject: title, html: emailWrap(zcEsc(title), html) });
      r.ok ? done.push('email') : errs.push('email: ' + r.error);
    }
    if (person.user_id && channels.bell) {
      try {
        db.run('INSERT INTO notifications (user_id, type, title, content, link) VALUES (?,?,?,?,?)', [person.user_id, 'system', title, body.slice(0, 1000), link]);
        pushNotify(person.user_id, { title, body, link });
        done.push('bell');
      } catch (e) { errs.push('bell: ' + e.message); }
    }
    if (person.user_id && channels.telegram) {
      try { if (await notifyTelegram(person.user_id, title, body, link, btnText)) done.push('telegram'); } catch (e) { /* chưa kết nối */ }
    }
    return { done, errs };
  }
  // Người đã vào 1 buổi (mỗi SĐT 1 lần) + trạng thái chăm sóc
  const zcAttendees = sessionKey => db.all(`SELECT z.phone, MAX(z.name) AS name, MAX(z.email) AS email, MAX(z.user_id) AS user_id,
      MAX(z.session_date) AS session_date, MAX(z.session_time) AS session_time, MAX(z.session_title) AS session_title,
      c.opt_out, c.status AS care_status
    FROM zoom_checkins z LEFT JOIN zoom_care c ON c.phone = z.phone
    WHERE z.session_key = ? GROUP BY z.phone`, [sessionKey]);
  // Học viên đã duyệt của 8 buổi / 377 ngày nhưng KHÔNG điểm danh buổi này (so theo tài khoản, email, SĐT)
  function zcAbsentees(prog, sessionKey) {
    const table = prog === 'workshop8' ? 'workshop8_enrollments' : prog === 'program377' ? 'program377_enrollments' : null;
    if (!table) return [];
    const came = zcAttendees(sessionKey);
    const ids = new Set(came.map(p => p.user_id).filter(Boolean)), phones = new Set(came.map(p => p.phone));
    const emails = new Set(came.map(p => String(p.email || '').toLowerCase()).filter(Boolean));
    return db.all(`SELECT u.id AS user_id, u.first_name, u.last_name, u.email, u.phone FROM ${table} e JOIN users u ON u.id = e.user_id
        WHERE e.status = 'approved' AND COALESCE(u.status, 'active') <> 'banned'`)
      .map(u => {
        const ph = zoomPhone(u.phone);
        return { phone: ph || `u${u.user_id}`, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'bạn', email: u.email, user_id: u.user_id,
          opt_out: ph ? db.get('SELECT opt_out FROM zoom_care WHERE phone = ?', [ph])?.opt_out : 0 };
      })
      .filter(p => !ids.has(p.user_id) && !phones.has(p.phone) && !emails.has(String(p.email || '').toLowerCase()));
  }

  // ── 3) + 4) Tự động sau mỗi buổi Zoom (3 buổi, 8 buổi, 377 ngày, Zoom khác) — chạy mỗi 5 phút ──
  let zcRunning = false;
  async function zcTick() {
    if (zcRunning) return;
    zcRunning = true;
    try {
      const cfg = zcConfig();
      const now = calNowVN(), nowMs = Date.parse(now.replace(' ', 'T') + ':00Z');
      const since = tbAddDays(now.slice(0, 10), -10);
      const sessions = db.all(`SELECT session_key, MAX(session_date) AS d, MAX(session_time) AS t, MAX(session_title) AS title
        FROM zoom_checkins WHERE session_date >= ? GROUP BY session_key`, [since]);
      for (const s of sessions) {
        const info = zcSessInfo(s.session_key, s.title);
        const tm = calParseTime(s.t);
        const endHM = tm.end || (tm.start ? `${String(Math.min(23, +tm.start.slice(0, 2) + 2)).padStart(2, '0')}:${tm.start.slice(3)}` : '22:00');
        const endMs = Date.parse(`${s.d}T${endHM}:00Z`);
        // 4) Báo người phụ trách: 30 phút sau buổi, 1 lần
        if (nowMs >= endMs + 30 * 60e3 && cfg.owner_email && cfg.owner_programs[info.prog] && !db.get("SELECT 1 AS x FROM zoom_care_log WHERE session_key = ? AND step_id = 'owner_task' AND phone = '-'", [s.session_key])) {
          db.run("INSERT OR IGNORE INTO zoom_care_log (session_key, step_id, phone, channels) VALUES (?, 'owner_task', '-', 'bell')", [s.session_key]);
          const owner = db.get('SELECT id FROM users WHERE LOWER(email) = ?', [String(cfg.owner_email).trim().toLowerCase()]);
          const people = zcAttendees(s.session_key);
          const fresh = people.filter(p => !p.user_id).length;
          if (owner && people.length) {
            const title = `📋 Chăm sóc sau ${info.title}`;
            const content = `${people.length} người đã vào Zoom (${fresh} khách mới). Mở Admin → Danh sách tổng hợp → Điểm danh Zoom để nhắn Zalo và cập nhật trạng thái từng người.`;
            db.run('INSERT INTO notifications (user_id, type, title, content, link) VALUES (?,?,?,?,?)', [owner.id, 'system', title, content, 'admin.html']);
            pushNotify(owner.id, { title, body: content, link: 'admin.html' });
            notifyTelegram(owner.id, title, content, 'admin.html', '📋 Mở danh sách').catch(() => {});
          }
        }
        if (!cfg.enabled || !cfg.programs[info.prog]) continue;
        const { link, btn } = zcLinkFor(info.prog);
        const enabledMs = cfg.enabled_at ? Date.parse(String(cfg.enabled_at).replace(' ', 'T') + ':00Z') : nowMs;
        for (const step of cfg.steps) {
          if (!step.enabled || step.group !== info.group) continue;
          let dueMs;
          if (step.timing === 'deadline') {
            if (!cfg.offer || !cfg.offer_deadline || cfg.offer_deadline < s.d) continue;
            dueMs = Date.parse(`${cfg.offer_deadline}T09:00:00Z`);
            if (nowMs > Date.parse(`${cfg.offer_deadline}T23:00:00Z`)) continue;
          } else dueMs = endMs + (Number(step.minutes) || 0) * 60e3;
          // Không gửi bù tin đã quá hạn từ trước lúc bật; tin quá 2 ngày thì bỏ
          if (nowMs < dueMs || dueMs < enabledMs - 10 * 60e3 || nowMs > dueMs + 48 * 3600e3) continue;
          const people = step.audience === 'absent' ? zcAbsentees(info.prog, s.session_key) : zcAttendees(s.session_key);
          for (const p of people) {
            if (p.opt_out) continue;
            if (db.get('SELECT 1 AS x FROM zoom_care_log WHERE session_key = ? AND step_id = ? AND phone = ?', [s.session_key, step.id, p.phone])) continue;
            if (step.only_not_booked && zcBooked(p.phone, p.user_id, s.d)) continue;
            // Tin mời tư vấn / ưu đãi sau buổi cuối: bỏ qua người đã là học viên 8 buổi hoặc 377 ngày
            if (step.group === 'final' && p.user_id && db.get(`SELECT 1 AS x FROM workshop8_enrollments WHERE user_id = ? AND status = 'approved'
              UNION SELECT 1 FROM program377_enrollments WHERE user_id = ? AND status = 'approved'`, [p.user_id, p.user_id])) continue;
            db.run('INSERT OR IGNORE INTO zoom_care_log (session_key, step_id, phone, channels) VALUES (?,?,?,?)', [s.session_key, step.id, p.phone, '']);
            const vars = zcVars(cfg, p, s.session_key, s.title);
            const r = await zcSendOne(p, zcFill(step.title, vars), zcBody(step.body, vars), step.channels || {}, cfg, link, btn);
            db.run('UPDATE zoom_care_log SET channels = ?, ok = ?, error = ? WHERE session_key = ? AND step_id = ? AND phone = ?',
              [r.done.join(','), r.done.length ? 1 : 0, r.errs.join(' | ') || null, s.session_key, step.id, p.phone]);
            await new Promise(res => setTimeout(res, 300));
          }
        }
      }
    } catch (e) { console.error('[zoom-care]', e.message); }
    zcRunning = false;
  }
  setInterval(zcTick, 5 * 60e3);
  setTimeout(zcTick, 60e3);

  // ── API admin ──
  app.get('/api/admin/zoom-care/config', requireAdmin, (_req, res) => {
    const list = k => { try { const v = JSON.parse(db.get('SELECT value FROM site_settings WHERE key = ?', [k])?.value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
    const cfg = zcConfig();
    // 377 ngày: buổi từ 30 ngày trước trở đi + buổi cũ hơn đã có nội dung
    const p377 = db.all('SELECT id, session_date, title FROM program377_sessions ORDER BY session_date, id')
      .filter(x => x.session_date >= tbAddDays(tbToday(), -30) || cfg.sessions[`p377:${x.id}`]).slice(0, 60);
    res.json({ config: cfg, defaults: ZC_DEFAULT, programs: ZC_PROG,
      workshop3: list('workshop3_sessions').map((x, i) => ({ key: String(i), title: x.title, date: x.date })),
      workshop8: list('workshop8_sessions').map((x, i) => ({ key: `w8:${i}`, title: x.title, date: x.date })),
      program377: p377.map(x => ({ key: `p377:${x.id}`, title: x.title, date: x.session_date })),
      statuses: ZC_STATUSES, booking_default: `${SITE_URL}/coach-1-1.html`,
      log: db.all(`SELECT l.session_key, l.step_id, l.phone, l.channels, l.ok, l.error, l.created_at,
          COALESCE((SELECT MAX(name) FROM zoom_checkins z WHERE z.phone = l.phone), (SELECT TRIM(first_name || ' ' || last_name) FROM users WHERE 'u' || id = l.phone)) AS name
        FROM zoom_care_log l WHERE l.step_id <> 'owner_task' ORDER BY l.id DESC LIMIT 100`) });
  });
  app.put('/api/admin/zoom-care/config', requireAdmin, (req, res) => {
    const b = req.body || {}, old = zcConfig();
    const str = (v, n) => String(v ?? '').slice(0, n);
    const cfg = {
      enabled: !!b.enabled,
      enabled_at: b.enabled ? (old.enabled ? old.enabled_at : calNowVN()) : null,
      programs: Object.fromEntries(Object.keys(ZC_PROG).map(k => [k, !!b.programs?.[k]])),
      owner_programs: Object.fromEntries(Object.keys(ZC_PROG).map(k => [k, !!b.owner_programs?.[k]])),
      signature: str(b.signature, 120) || ZC_SIGN,
      booking_link: /^https?:\/\//.test(str(b.booking_link, 300)) ? str(b.booking_link, 300) : '',
      offer: str(b.offer, 300), offer_deadline: tbValidDate(b.offer_deadline) ? b.offer_deadline : '',
      owner_email: str(b.owner_email, 120).trim(),
      sessions: {},
      steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 20).map(s => ({
        id: str(s.id, 40).replace(/[^a-z0-9_]/gi, '') || ('step_' + Math.random().toString(36).slice(2, 8)),
        group: ZC_GROUPS.includes(s.group) ? s.group : 'early', label: str(s.label, 120), enabled: !!s.enabled,
        audience: s.audience === 'absent' && ['w8', 'p377'].includes(s.group) ? 'absent' : 'attended',
        timing: s.timing === 'deadline' ? 'deadline' : 'after', minutes: Math.max(0, Math.min(43200, parseInt(s.minutes, 10) || 0)),
        only_not_booked: !!s.only_not_booked,
        channels: { email: !!s.channels?.email, bell: !!s.channels?.bell, telegram: !!s.channels?.telegram },
        title: str(s.title, 200), body: str(s.body, 4000),
      })),
    };
    Object.entries(b.sessions || {}).forEach(([k, v]) => {
      if (!/^(\d{1,2}|w8:\d{1,2}|p377:\d{1,7})$/.test(k)) return;
      const replay = str(v?.replay, 400).trim();
      const row = { summary: str(v?.summary, 600), task: str(v?.task, 300), replay: /^https?:\/\//.test(replay) ? replay : '' };
      if (row.summary || row.task || row.replay) cfg.sessions[k] = row;
    });
    if (!cfg.steps.length) cfg.steps = ZC_DEFAULT.steps;
    db.run("INSERT INTO site_settings (key, value) VALUES ('zoom_care_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(cfg)]);
    res.json({ ok: true, config: cfg });
  });
  // Xem trước / gửi thử 1 tin (dữ liệu mẫu) tới email admin nhập
  app.post('/api/admin/zoom-care/test', requireAdmin, async (req, res) => {
    const { step, email, session_index } = req.body || {};
    if (!step || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''))) return res.status(400).json({ error: 'Nhập email nhận thử.' });
    const cfg = zcConfig();
    // Buổi mẫu: session_key do admin chọn (workshop3-0@x, workshop8-2@x, program377-15@x, zoom@x)
    const sk = /^(workshop[38]-\d+|program377-\d+|zoom)@x$/.test(String(req.body.session_key || '')) ? req.body.session_key : `workshop3-${parseInt(session_index, 10) || 0}@x`;
    const vars = zcVars(cfg, { name: 'Nguyễn Thị Lan' }, sk, 'Zoom chia sẻ chủ đề Ăn uống theo mùa');
    const body = zcBody(step.body, vars);
    const title = zcFill(step.title, vars);
    if (req.body.preview) return res.json({ ok: true, title, body });
    const r = await zcSendOne({ phone: 'test', name: 'Nguyễn Thị Lan', email: String(email).trim() }, '[THỬ] ' + title, body, { email: true }, cfg);
    if (!r.done.length) return res.status(400).json({ error: r.errs.join(' | ') || 'Không gửi được.' });
    res.json({ ok: true, title, body });
  });
  // 1) Cập nhật trạng thái chăm sóc 1 người
  app.put('/api/admin/zoom-care/person', requireAdmin, (req, res) => {
    const b = req.body || {};
    const phone = zoomPhone(b.phone);
    if (!phone) return res.status(400).json({ error: 'Thiếu số điện thoại.' });
    const status = ZC_STATUSES[b.status] ? b.status : 'new';
    const prevOwner = db.get('SELECT owner FROM zoom_care WHERE phone = ?', [phone])?.owner;
    db.run(`INSERT INTO zoom_care (phone, status, owner, note, reason, opt_out, updated_at, updated_by) VALUES (?,?,?,?,?,?,datetime('now','localtime'),?)
      ON CONFLICT(phone) DO UPDATE SET status = excluded.status, owner = excluded.owner, note = excluded.note, reason = excluded.reason,
        opt_out = excluded.opt_out, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [phone, status, String(b.owner || '').slice(0, 80), String(b.note || '').slice(0, 1000), String(b.reason || '').slice(0, 300), b.opt_out ? 1 : 0, req.adminUserId || null]);
    careNotifyOwner(String(b.owner || '').slice(0, 80), prevOwner, phone, req.adminUserId);
    res.json({ ok: true });
  });
  // 2) Gửi tin hàng loạt cho 1 danh sách Zoom (1 buổi hoặc tất cả)
  app.post('/api/admin/zoom-care/send', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 200), body = String(b.body || '').trim().slice(0, 4000);
    const channels = { email: !!b.channels?.email, bell: !!b.channels?.bell, telegram: !!b.channels?.telegram };
    if (!title || !body) return res.status(400).json({ error: 'Nhập tiêu đề và nội dung.' });
    if (!channels.email && !channels.bell && !channels.telegram) return res.status(400).json({ error: 'Chọn ít nhất 1 kênh gửi.' });
    const key = String(b.session_key || '');
    let people = key === 'all'
      ? db.all(`SELECT z.phone, MAX(z.name) AS name, MAX(z.email) AS email, MAX(z.user_id) AS user_id, c.opt_out, c.status AS care_status
          FROM zoom_checkins z LEFT JOIN zoom_care c ON c.phone = z.phone GROUP BY z.phone`)
      : zcAttendees(key);
    if (Array.isArray(b.phones) && b.phones.length) { const set = new Set(b.phones.map(zoomPhone)); people = people.filter(p => set.has(p.phone)); }
    people = people.filter(p => !p.opt_out);
    if (b.dry_run) return res.json({ ok: true, count: people.length, with_account: people.filter(p => p.user_id).length });
    const cfg = zcConfig(), stepId = 'manual_' + Date.now().toString(36);
    let sent = 0, failed = 0;
    for (const p of people) {
      const vars = zcVars(cfg, p, key === 'all' ? null : key, p.session_title);
      const lk = zcLinkFor(key === 'all' ? 'other' : zcSessInfo(key).prog);
      const r = await zcSendOne(p, zcFill(title, vars), zcBody(body, vars), channels, cfg, lk.link, lk.btn);
      db.run('INSERT OR IGNORE INTO zoom_care_log (session_key, step_id, phone, channels, ok, error) VALUES (?,?,?,?,?,?)',
        [key, stepId, p.phone, r.done.join(','), r.done.length ? 1 : 0, r.errs.join(' | ') || null]);
      r.done.length ? sent++ : failed++;
      await new Promise(rs => setTimeout(rs, 250));
    }
    res.json({ ok: true, sent, failed, total: people.length });
  });

  // ── Kanban khách hàng (kanban-khach-hang.html): nhân viên trong bảng phân công + admin xem / kéo thẻ khách
  // giữa các cột trạng thái chăm sóc. Dữ liệu: người đã điểm danh Zoom (theo SĐT) + zoom_care.
  function zcHeat(r, c) {
    return r.p377 === 'approved' ? '⭐ Học viên 377 ngày' : r.w8 === 'approved' ? '⭐ Học viên 8 buổi'
      : ['booked', 'bought'].includes(c.status) || r.w8 === 'pending' || r.p377 === 'pending' || r.sessions >= 3
        || r.lead_consults > 0 || r.lead_opens >= 2 ? '🔥 Nóng'
      : r.sessions >= 2 ? '🌤️ Ấm' : '❄️ Lạnh';
  }
  function zcPeople() {
    careSyncStudents();
    return db.all(`SELECT g.*,
        (SELECT status FROM workshop8_enrollments w WHERE w.user_id = g.user_id) AS w8,
        (SELECT status FROM program377_enrollments p WHERE p.user_id = g.user_id) AS p377,
        c.status AS care_status, c.owner, c.note, c.reason, c.opt_out, c.updated_at,
        TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS updated_by_name
        , cl.programs AS lead_programs, cl.opens AS lead_opens, cl.consults AS lead_consults
      FROM (SELECT z.phone, MAX(z.name) AS name, MAX(z.email) AS email, MAX(z.user_id) AS user_id,
          COUNT(DISTINCT z.session_key) AS sessions, MIN(z.created_at) AS first, MAX(z.created_at) AS last,
          GROUP_CONCAT(DISTINCT z.session_key) AS keys
        FROM zoom_checkins z GROUP BY z.phone
        UNION ALL
        -- Khách quan tâm trên Feed (mở bài bị khoá / bấm Nhận tư vấn) chưa từng điểm danh Zoom
        SELECT l.phone, l.name, l.email, l.user_id, 0, l.first_at, COALESCE(l.last_at, l.first_at), ''
        FROM care_leads l WHERE l.phone NOT IN (SELECT phone FROM zoom_checkins)) g
      LEFT JOIN zoom_care c ON c.phone = g.phone LEFT JOIN users u ON u.id = c.updated_by
      LEFT JOIN care_leads cl ON cl.phone = g.phone
      ORDER BY g.last DESC`).map(r => ({
      phone: r.phone, name: r.name, email: r.email, user_id: r.user_id, sessions: r.sessions, first: r.first, last: r.last,
      keys: String(r.keys || '').split(',').filter(Boolean), w8: r.w8, p377: r.p377,
      status: ZC_STATUSES[r.care_status] ? r.care_status : 'new', owner: r.owner || '', note: r.note || '', reason: r.reason || '',
      opt_out: r.opt_out ? 1 : 0, updated_at: r.updated_at || '', updated_by: r.updated_by_name || '',
      heat: zcHeat(r, { status: r.care_status }),
      lead: r.lead_programs ? (r.lead_programs === 'journey' ? '🗺️ Thêm từ Bản đồ hành trình' : `🎯 Quan tâm trên Feed: ${String(r.lead_programs).split(',').filter(k => k !== 'journey').map(k => SHOWCASE_PROGRAMS[k]?.label || k).join(', ')}`)
        + `${r.lead_opens ? ` · mở ${r.lead_opens} bài khoá` : ''}${r.lead_consults ? ' · đã bấm Nhận tư vấn' : ''}` : '',
    }));
  }
  const careBoardMe = (req, res) => {
    const me = tbMe(req);
    if (!me) { res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản cộng đồng.', code: 'session_required' }); return null; }
    if (!me.is_admin && !me.member_ids.length) {
      res.status(403).json({ error: 'Tài khoản này chưa có trong bảng phân công nhiệm vụ. Nhờ admin nhập email của bạn ở Admin → Phân công nhiệm vụ.' });
      return null;
    }
    return me;
  };
  app.get('/api/care-board', (req, res) => {
    const me = careBoardMe(req, res); if (!me) return;
    const members = getTaskBoard().members || [];
    const myNames = members.filter(m => me.member_ids.includes(m.id)).map(m => m.name);
    const sessions = db.all(`SELECT session_key AS key, MAX(session_title) AS title, MAX(session_date) AS date
      FROM zoom_checkins GROUP BY session_key ORDER BY MAX(created_at) DESC LIMIT 60`);
    res.json({ me: { name: me.name, email: me.email, is_admin: me.is_admin, names: myNames.length ? myNames : [me.name].filter(Boolean) },
      staff: members.map(m => m.name).filter(Boolean), statuses: ZC_STATUSES, sessions, people: zcPeople(),
      // Người trong bảng phân công đã kết nối email (có tài khoản) — admin chọn để giao khách; việc hiện ở Kanban nhiệm vụ của họ
      team: members.filter(m => m.name && m.user_id).map(m => ({ name: m.name, role: m.role || '',
        email: me.is_admin ? (m.user_email || '') : '', active: careRowsFor(m.name).length })),
      unlinked: members.filter(m => m.name && !m.user_id).map(m => m.name) });
  });
  // Báo thành viên khi được giao chăm sóc 1 khách (chuông + điện thoại + Telegram)
  function careNotifyOwner(newOwner, oldOwner, phone, byUserId) {
    if (!newOwner || String(newOwner).trim().toLowerCase() === String(oldOwner || '').trim().toLowerCase()) return;
    const m = (getTaskBoard().members || []).find(x => String(x.name || '').trim().toLowerCase() === String(newOwner).trim().toLowerCase());
    if (!m || !m.user_id || m.user_id === byUserId) return;
    const p = db.get('SELECT MAX(name) AS name, COUNT(DISTINCT session_key) AS n FROM zoom_checkins WHERE phone = ?', [phone]) || {};
    if (!p.name) p.name = db.get('SELECT name FROM care_leads WHERE phone = ?', [phone])?.name;
    const title = `🤝 Bạn được giao chăm sóc khách: ${p.name || phone}`;
    const content = `SĐT ${phone} · đã vào ${p.n || 0} buổi Zoom. Việc này có trong Kanban công việc hôm nay; cập nhật tiến độ ở Kanban khách hàng.`;
    try {
      db.run('INSERT INTO notifications (user_id, type, title, content, link) VALUES (?,?,?,?,?)', [m.user_id, 'system', title, content, 'kanban-khach-hang.html']);
      pushNotify(m.user_id, { title, body: content, link: 'kanban-khach-hang.html' });
    } catch (e) { console.error('[care notify]', e.message); }
    notifyTelegram(m.user_id, title, content, 'kanban-khach-hang.html', '🤝 Mở Kanban khách hàng').catch(() => {});
  }
  app.put('/api/care-board/person', (req, res) => {
    const me = careBoardMe(req, res); if (!me) return;
    const b = req.body || {};
    const phone = zoomPhone(b.phone);
    if (!phone || !(db.get('SELECT 1 AS x FROM zoom_checkins WHERE phone = ?', [phone]) || db.get('SELECT 1 AS x FROM care_leads WHERE phone = ?', [phone])))
      return res.status(404).json({ error: 'Không tìm thấy khách này.' });
    const cur = db.get('SELECT * FROM zoom_care WHERE phone = ?', [phone]) || {};
    const pick = (k, n) => (b[k] !== undefined ? String(b[k] ?? '').slice(0, n) : (cur[k] || ''));
    const status = b.status !== undefined ? (ZC_STATUSES[b.status] ? b.status : 'new') : (cur.status || 'new');
    const optOut = b.opt_out !== undefined ? (b.opt_out ? 1 : 0) : (cur.opt_out ? 1 : 0);
    db.run(`INSERT INTO zoom_care (phone, status, owner, note, reason, opt_out, updated_at, updated_by) VALUES (?,?,?,?,?,?,datetime('now','localtime'),?)
      ON CONFLICT(phone) DO UPDATE SET status = excluded.status, owner = excluded.owner, note = excluded.note, reason = excluded.reason,
        opt_out = excluded.opt_out, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [phone, status, pick('owner', 80), pick('note', 1000), pick('reason', 300), optOut, me.id]);
    careNotifyOwner(pick('owner', 80), cur.owner, phone, me.id);
    res.json({ ok: true, person: zcPeople().find(p => p.phone === phone) });
  });

  // ── Kịch bản live Zoom (kich-ban-zoom.html): mỗi buổi của 3 buổi / 8 buổi, 377 ngày (Ngày 1, Ngày 15), Zoom khác.
  // Mỗi kịch bản = danh sách phần (nội dung / chốt sale) có số phút, người phụ trách, lời dẫn. Xem: admin + nhân viên
  // trong bảng phân công; sửa: admin. Chưa sửa thì dùng mẫu gốc content/kich-ban-zoom-mac-dinh.json.
  db.exec(`CREATE TABLE IF NOT EXISTS zoom_scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, program TEXT NOT NULL, slot TEXT NOT NULL, title TEXT, event_date TEXT, start_time TEXT,
    segments TEXT, notes TEXT, updated_at TEXT, updated_by INTEGER, UNIQUE(program, slot)
  )`);
  const ZS_PROGRAMS = { workshop3: 'Workshop 3 buổi', workshop8: '8 buổi chuyên sâu', program377: '377 ngày thực hành', other: 'Zoom khác' };
  const ZS_ROLES = ['tech', 'host', 'content', 'marketing', 'reminder'];
  let zsDefaultsCache = null;
  const zsDefaults = () => {
    if (!zsDefaultsCache) {
      try { zsDefaultsCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'kich-ban-zoom-mac-dinh.json'), 'utf8')); }
      catch (e) { console.error('[kịch bản zoom] mẫu gốc:', e.message); zsDefaultsCache = {}; }
    }
    return zsDefaultsCache;
  };
  const zsSeg = (s, i) => ({ id: s.id || `s${i + 1}`, kind: s.kind === 'sale' ? 'sale' : 'content', title: s.title || '', minutes: Number(s.minutes) || 0,
    role: ZS_ROLES.includes(s.role) ? s.role : 'host', script: s.script || '' });
  // Danh sách buổi của từng chương trình (lấy từ trang 3 buổi / 8 buổi; 377 ngày = 2 mẫu Ngày 1, Ngày 15)
  function zsSlots() {
    const list = k => { try { const v = JSON.parse(db.get('SELECT value FROM site_settings WHERE key = ?', [k])?.value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
    const note = k => db.get('SELECT value FROM site_settings WHERE key = ?', [k])?.value || '';
    const out = {};
    ['workshop3', 'workshop8'].forEach(p => {
      const tn = note(`${p}_time_note`);
      out[p] = list(`${p}_sessions`).map((s, i) => ({ slot: String(i), title: s.title || `Buổi ${i + 1}`, date: String(s.date || '').slice(0, 10), start: calParseTime(s.time || tn).start || '20:00' }));
    });
    const p377 = db.get("SELECT session_time FROM program377_sessions WHERE session_time IS NOT NULL ORDER BY session_date DESC LIMIT 1")?.session_time;
    const st377 = calParseTime(p377 || '').start || '20:00';
    const nextOf = day => db.get(`SELECT session_date FROM program377_sessions WHERE substr(session_date, 9, 2) = ? AND session_date >= ? ORDER BY session_date LIMIT 1`, [day, tbToday()])?.session_date || '';
    out.program377 = [
      { slot: 'day1', title: 'Zoom ngày 1 hằng tháng', date: nextOf('01'), start: st377 },
      { slot: 'day15', title: 'Zoom ngày 15 hằng tháng', date: nextOf('15'), start: st377 },
    ];
    out.other = db.all("SELECT slot, title, event_date, start_time FROM zoom_scripts WHERE program = 'other' ORDER BY COALESCE(event_date, '9999') DESC, id DESC")
      .map(r => ({ slot: r.slot, title: r.title || 'Zoom khác', date: r.event_date || '', start: r.start_time || '20:00' }));
    return out;
  }
  function zsScript(program, slotInfo) {
    const row = db.get(`SELECT z.*, u.first_name || ' ' || u.last_name AS by_name FROM zoom_scripts z LEFT JOIN users u ON u.id = z.updated_by
      WHERE z.program = ? AND z.slot = ?`, [program, slotInfo.slot]);
    const def = program === 'other' ? zsDefaults().other : (zsDefaults()[program] || {})[slotInfo.slot];
    let segs = null;
    try { segs = row?.segments ? JSON.parse(row.segments) : null; } catch { segs = null; }
    return {
      program, slot: slotInfo.slot, session_title: slotInfo.title, date: slotInfo.date,
      title: row?.title || slotInfo.title, start_time: row?.start_time || slotInfo.start || '20:00', notes: row?.notes || '',
      segments: (segs || def || []).map(zsSeg), customized: !!(row && row.segments), has_default: !!def,
      updated_at: row?.updated_at || null, updated_by: row?.updated_at ? (row.by_name || '').trim() : null,
    };
  }
  app.get('/api/zoom-scripts', (req, res) => {
    const me = careBoardMe(req, res); if (!me) return;
    const slots = zsSlots();
    res.json({
      me: { is_admin: !!me.is_admin, name: me.name || me.email },
      programs: Object.entries(ZS_PROGRAMS).map(([k, label]) => ({ key: k, label, scripts: (slots[k] || []).map(s => zsScript(k, s)) })),
      roles: { tech: 'Kỹ thuật / mở phòng', host: 'Người dẫn / trình bày', content: 'Nội dung', marketing: 'Marketing', reminder: 'Nhắc nhở cộng đồng' },
    });
  });
  const zsAdmin = (req, res) => {
    const me = careBoardMe(req, res); if (!me) return null;
    if (!me.is_admin) { res.status(403).json({ error: 'Chỉ admin được sửa kịch bản.' }); return null; }
    return me;
  };
  const zsValidSlot = (program, slot) => ZS_PROGRAMS[program] && /^[a-z0-9_-]{1,40}$/i.test(String(slot || ''));
  app.put('/api/zoom-scripts/:program/:slot', (req, res) => {
    const me = zsAdmin(req, res); if (!me) return;
    const { program, slot } = req.params;
    if (!zsValidSlot(program, slot)) return res.status(400).json({ error: 'Kịch bản không hợp lệ.' });
    if (program === 'other' && !db.get("SELECT 1 AS x FROM zoom_scripts WHERE program = 'other' AND slot = ?", [slot])) return res.status(404).json({ error: 'Không tìm thấy kịch bản.' });
    const b = req.body || {};
    const segs = (Array.isArray(b.segments) ? b.segments : []).slice(0, 40).map((s, i) => ({
      id: String(s.id || `s${i + 1}`).slice(0, 20), kind: s.kind === 'sale' ? 'sale' : 'content',
      title: String(s.title || '').trim().slice(0, 150), minutes: Math.max(0, Math.min(240, parseInt(s.minutes, 10) || 0)),
      role: ZS_ROLES.includes(s.role) ? s.role : 'host', script: String(s.script || '').slice(0, 5000),
    })).filter(s => s.title || s.script);
    if (!segs.length) return res.status(400).json({ error: 'Kịch bản cần ít nhất 1 phần.' });
    const st = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.start_time || '')) ? b.start_time : '20:00';
    const date = tbValidDate(b.event_date) ? b.event_date : null;
    db.run(`INSERT INTO zoom_scripts (program, slot, title, event_date, start_time, segments, notes, updated_at, updated_by)
      VALUES (?,?,?,?,?,?,?,datetime('now','localtime'),?)
      ON CONFLICT(program, slot) DO UPDATE SET title = excluded.title, event_date = COALESCE(excluded.event_date, zoom_scripts.event_date),
        start_time = excluded.start_time, segments = excluded.segments, notes = excluded.notes, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [program, slot, String(b.title || '').trim().slice(0, 200), date, st, JSON.stringify(segs), String(b.notes || '').slice(0, 3000), me.id]);
    const info = (zsSlots()[program] || []).find(s => s.slot === slot) || { slot, title: b.title, date: date || '', start: st };
    res.json({ ok: true, script: zsScript(program, info) });
  });
  // Khôi phục mẫu gốc (3 buổi / 8 buổi / 377) hoặc xoá kịch bản Zoom khác
  app.delete('/api/zoom-scripts/:program/:slot', (req, res) => {
    const me = zsAdmin(req, res); if (!me) return;
    const { program, slot } = req.params;
    if (!zsValidSlot(program, slot)) return res.status(400).json({ error: 'Kịch bản không hợp lệ.' });
    db.run('DELETE FROM zoom_scripts WHERE program = ? AND slot = ?', [program, slot]);
    res.json({ ok: true });
  });
  // Thêm kịch bản Zoom khác (không định kỳ) — bắt đầu từ mẫu chung
  app.post('/api/zoom-scripts/other', (req, res) => {
    const me = zsAdmin(req, res); if (!me) return;
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: 'Nhập tên buổi Zoom.' });
    const slot = 'o' + Date.now().toString(36);
    const st = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.start_time || '')) ? b.start_time : '20:00';
    db.run(`INSERT INTO zoom_scripts (program, slot, title, event_date, start_time, segments, updated_at, updated_by)
      VALUES ('other', ?, ?, ?, ?, ?, datetime('now','localtime'), ?)`,
      [slot, title, tbValidDate(b.event_date) ? b.event_date : null, st, JSON.stringify((zsDefaults().other || []).map(zsSeg)), me.id]);
    res.json({ ok: true, slot });
  });

  // Khách bấm "Không nhận email chăm sóc nữa"
  app.get('/api/zoom-care/unsub', (req, res) => {
    const phone = zoomPhone(req.query.p);
    if (!phone || String(req.query.s || '') !== zcSig(phone)) return res.status(400).send('Link không hợp lệ.');
    db.run(`INSERT INTO zoom_care (phone, opt_out, updated_at) VALUES (?, 1, datetime('now','localtime'))
      ON CONFLICT(phone) DO UPDATE SET opt_out = 1, updated_at = excluded.updated_at`, [phone]);
    res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <div style="font-family:system-ui,sans-serif;max-width:460px;margin:60px auto;padding:0 16px;text-align:center;color:#334155">
      <h2>Đã huỷ nhận email chăm sóc</h2><p>Bạn sẽ không nhận email chăm sóc sau Zoom từ ${zcEsc(communityName())} nữa.</p></div>`);
  });

  app.post('/api/calendar/events', (req, res) => {
    const u = calAdmin(req, res); if (!u) return;
    const { ev, error } = calClean(req.body || {});
    if (error) return res.status(400).json({ error });
    const r = db.run(`INSERT INTO calendar_events (title, description, location, link, color, start_date, start_time, end_time, repeat, repeat_until, remind_minutes, remind_target, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [ev.title, ev.description, ev.location, ev.link, ev.color, ev.start_date, ev.start_time, ev.end_time, ev.repeat, ev.repeat_until, ev.remind_minutes, ev.remind_target, u.id]);
    res.json({ ok: true, id: r.lastInsertRowid });
  });

  app.put('/api/calendar/events/:id', (req, res) => {
    const u = calAdmin(req, res); if (!u) return;
    const old = db.get('SELECT * FROM calendar_events WHERE id = ?', [parseInt(req.params.id, 10) || 0]);
    if (!old) return res.status(404).json({ error: 'Không tìm thấy sự kiện.' });
    const { ev, error } = calClean(req.body || {});
    if (error) return res.status(400).json({ error });
    db.run(`UPDATE calendar_events SET title=?, description=?, location=?, link=?, color=?, start_date=?, start_time=?, end_time=?, repeat=?, repeat_until=?,
      remind_minutes=?, remind_target=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [ev.title, ev.description, ev.location, ev.link, ev.color, ev.start_date, ev.start_time, ev.end_time, ev.repeat, ev.repeat_until, ev.remind_minutes, ev.remind_target, old.id]);
    res.json({ ok: true });
  });

  app.put('/api/calendar/program-remind', (req, res) => {
    const u = calAdmin(req, res); if (!u) return;
    const cur = calProgramRemind();
    for (const k of Object.keys(CAL_PROGRAMS)) if (req.body && k in req.body) cur[k] = Math.max(0, Math.min(10080, parseInt(req.body[k], 10) || 0));
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('calendar_program_remind',?)", [JSON.stringify(cur)]);
    res.json({ ok: true, program_remind: cur });
  });

  // Xoá: ?date=YYYY-MM-DD chỉ bỏ 1 lần của sự kiện lặp lại; không có thì xoá cả sự kiện
  app.delete('/api/calendar/events/:id', (req, res) => {
    const u = calAdmin(req, res); if (!u) return;
    const ev = db.get('SELECT * FROM calendar_events WHERE id = ?', [parseInt(req.params.id, 10) || 0]);
    if (!ev) return res.status(404).json({ error: 'Không tìm thấy sự kiện.' });
    if (tbValidDate(req.query.date) && ev.repeat && ev.repeat !== 'none') {
      const skips = calSkips(ev); if (!skips.includes(req.query.date)) skips.push(req.query.date);
      db.run('UPDATE calendar_events SET skip_dates = ? WHERE id = ?', [JSON.stringify(skips.slice(-200)), ev.id]);
      return res.json({ ok: true, skipped: req.query.date });
    }
    db.run('DELETE FROM calendar_events WHERE id = ?', [ev.id]);
    db.run('DELETE FROM calendar_reminder_log WHERE event_id = ?', [ev.id]);
    res.json({ ok: true });
  });

  // Nhập 1 lần từ lịch Google đang nhúng (lịch công khai, đọc file .ics). Bỏ qua sự kiện đã nhập (theo UID).
  app.post('/api/calendar/import-google', async (req, res) => {
    const u = calAdmin(req, res); if (!u) return;
    const url = db.get("SELECT value FROM site_settings WHERE key='calendar_embed_url'")?.value || '';
    const m = url.match(/[?&]src=([^&]+)/);
    if (!m) return res.status(400).json({ error: 'Chưa có link nhúng Google Calendar trong Cài đặt.' });
    try {
      const r = await fetch(`https://calendar.google.com/calendar/ical/${encodeURIComponent(decodeURIComponent(m[1]))}/public/basic.ics`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return res.status(502).json({ error: `Google trả lỗi ${r.status} — lịch cần để Công khai.` });
      const text = (await r.text()).replace(/\r?\n[ \t]/g, ''); // gộp dòng bị ngắt
      const unesc = v => String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
      // "20261011T130000Z" (UTC) hoặc TZID=Asia/Ho_Chi_Minh:20261001T194500 → giờ Việt Nam
      const toVN = (line) => {
        if (!line) return null;
        const v = line.slice(line.lastIndexOf(':') + 1).trim();
        const dm = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/);
        if (!dm) return null;
        if (!dm[4]) return { date: `${dm[1]}-${dm[2]}-${dm[3]}`, time: null };
        let dt = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +dm[4], +dm[5]));
        if (dm[6]) dt = new Date(dt.getTime() + 7 * 3600e3);
        const iso = dt.toISOString();
        return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
      };
      let added = 0, skipped = 0;
      const notes = [];
      text.split('BEGIN:VEVENT').slice(1).forEach(block => {
        const get = k => (block.split(/\r?\n/).find(l => l.startsWith(k + ':') || l.startsWith(k + ';')) || '');
        const val = k => { const l = get(k); return l ? l.slice(l.indexOf(':') + 1) : ''; };
        const uid = val('UID').trim();
        if (uid && db.get('SELECT 1 AS x FROM calendar_events WHERE source_uid = ?', [uid])) { skipped++; return; }
        const st = toVN(get('DTSTART')), en = toVN(get('DTEND'));
        if (!st) return;
        const rr = val('RRULE');
        let repeat = 'none', until = null;
        if (rr) {
          const f = (rr.match(/FREQ=(\w+)/) || [])[1];
          repeat = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }[f] || 'none';
          const um = rr.match(/UNTIL=(\d{8})/); if (um) until = `${um[1].slice(0, 4)}-${um[1].slice(4, 6)}-${um[1].slice(6, 8)}`;
          if (repeat === 'none' || /INTERVAL=([2-9]|\d{2})|BYDAY=.*,|BYSETPOS/.test(rr)) notes.push(`"${unesc(val('SUMMARY'))}": kiểu lặp phức tạp, đã nhập theo dạng gần nhất — kiểm tra lại.`);
        }
        const loc = unesc(val('LOCATION')).trim();
        db.run(`INSERT INTO calendar_events (title, description, location, link, color, start_date, start_time, end_time, repeat, repeat_until, remind_minutes, remind_target, source_uid, created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          unesc(val('SUMMARY')).trim().slice(0, 150) || '(Không tiêu đề)', unesc(val('DESCRIPTION')).trim().slice(0, 3000),
          /^https?:\/\//i.test(loc) ? '' : loc.slice(0, 150), /^https?:\/\//i.test(loc) ? loc.slice(0, 500) : '',
          '#0ea5e9', st.date, st.time, st.time && en && en.date === st.date ? en.time : null, repeat, until, 0, 'all', uid || null, u.id]);
        added++;
      });
      res.json({ ok: true, added, skipped, notes });
    } catch (e) { res.status(502).json({ error: 'Không đọc được lịch Google: ' + e.message }); }
  });

  // Gửi nhắc cho từng người: chuông + đẩy + Telegram, nội dung riêng theo múi giờ của họ (lần lượt, tránh giới hạn Telegram)
  const calSendReminder = async (users, title, contentFor, tgExtra, link, btnText) => {
    let n = 0;
    for (const x of users) {
      const content = contentFor(x);
      try {
        db.run('INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)', [x.id, 'system', title, content, link]);
        pushNotify(x.id, { title, body: content, link });
      } catch {}
      if (await notifyTelegram(x.id, title, content + (tgExtra || ''), link, btnText)) { n++; await new Promise(r => setTimeout(r, 60)); }
    }
    return n;
  };
  // Nhắc lịch: mỗi phút kiểm tra các lần diễn ra sắp tới, gửi thông báo trong app + đẩy (mỗi lần chỉ gửi 1 lần)
  const calRemind = () => {
    try {
      const now = calNowVN(), today = now.slice(0, 10);
      db.all('SELECT * FROM calendar_events WHERE remind_minutes > 0 AND start_time IS NOT NULL AND start_date <= ?', [tbAddDays(today, 8)]).forEach(ev => {
        calExpand(ev, today, tbAddDays(today, 7)).forEach(d => {
          const start = `${d} ${ev.start_time}`;
          const at = new Date(new Date(`${d}T${ev.start_time}:00Z`).getTime() - ev.remind_minutes * 60e3).toISOString().slice(0, 16).replace('T', ' ');
          if (now < at || now >= start) return;
          if (db.get('SELECT 1 AS x FROM calendar_reminder_log WHERE event_id = ? AND occ_date = ?', [ev.id, d])) return;
          db.run('INSERT INTO calendar_reminder_log (event_id, occ_date) VALUES (?,?)', [ev.id, d]);
          const users = db.all(`SELECT id, timezone FROM users WHERE status = 'active'${ev.remind_target === 'admins' ? ' AND is_admin = 1' : ''}`);
          const when = d === today ? `hôm nay lúc ${ev.start_time}` : `${d.split('-').reverse().join('/')} lúc ${ev.start_time}`;
          const title = `📅 Sắp diễn ra: ${ev.title}`;
          calSendReminder(users, title, x => {
            const loc = vnToLocalLabel(d, ev.start_time, x.timezone);
            return `${when}${loc ? ` giờ VN (${loc})` : ''}${ev.location ? ' · ' + ev.location : ''}. Bấm để xem chi tiết.`;
          }, ev.description ? '\n\n' + String(ev.description).slice(0, 500) : '', 'calendar.html', '🗓️ Xem lịch')
            .then(n => console.log(`[Lịch] nhắc "${ev.title}" ${d} → ${users.length} người (Telegram ${n})`));
        });
      });
      // Buổi Zoom chương trình: 3 buổi → cả cộng đồng; 8 buổi / 377 ngày → học viên đã duyệt + admin
      calProgramEvents(today, tbAddDays(today, 7)).forEach(ev => {
        if (!ev.remind_minutes || !ev.start_time) return;
        const d = ev.date, start = `${d} ${ev.start_time}`;
        const at = new Date(new Date(`${d}T${ev.start_time}:00Z`).getTime() - ev.remind_minutes * 60e3).toISOString().slice(0, 16).replace('T', ' ');
        if (now < at || now >= start) return;
        const rkey = `${ev.program}|${d}|${ev.start_time}|${ev.title}`.slice(0, 300);
        if (db.get('SELECT 1 AS x FROM calendar_program_reminder_log WHERE rkey = ?', [rkey])) return;
        db.run('INSERT INTO calendar_program_reminder_log (rkey) VALUES (?)', [rkey]);
        const table = { workshop8: 'workshop8_enrollments', program377: 'program377_enrollments' }[ev.program];
        const users = table
          ? db.all(`SELECT id, timezone FROM users WHERE status = 'active' AND (is_admin = 1 OR id IN (SELECT user_id FROM ${table} WHERE status = 'approved'))`)
          : db.all("SELECT id, timezone FROM users WHERE status = 'active'");
        const when = d === today ? `hôm nay lúc ${ev.start_time}` : `${d.split('-').reverse().join('/')} lúc ${ev.start_time}`;
        const title = `📅 ${ev.program_label}: ${ev.title}`;
        calSendReminder(users, title, x => {
          const loc = vnToLocalLabel(d, ev.start_time, x.timezone);
          return `Zoom ${when}${loc ? ` giờ VN (${loc})` : ''}. Bấm để mở trang và vào Zoom.`;
        }, '', ev.page, '🎥 Mở trang & vào Zoom')
          .then(n => console.log(`[Lịch] nhắc ${ev.program} "${ev.title}" ${d} → ${users.length} người (Telegram ${n})`));
      });
    } catch (e) { console.error('[Lịch] nhắc lịch:', e.message); }
  };
  setInterval(calRemind, 60e3).unref?.();

  // Bản tin "Việc hôm nay" lúc 7:00 (giờ VN) qua Telegram cho từng thành viên trong bảng phân công (đã gắn tài khoản)
  const tbDayTasks = (m, date) => {
    eaPruneOrphans();
    const pub = publicTaskBoard().members.find(x => x.id === m.id);
    const list = [...(pub?.tasks || []).filter(t => t.freq !== 'adhoc'),
      ...db.all('SELECT * FROM event_assignments WHERE member_id = ? AND task_date = ?', [m.id, date]).map(tbEventTask),
      ...careRowsFor(m.name).map(tbCareTask)];
    return list.filter(t => {
      const key = tbKey(t, date);
      const h = tbActiveHelp(m.id, t.id, key);
      if (h && h.status === 'accepted') return false; // đã chuyển cho người khác
      return !db.get("SELECT 1 AS x FROM task_board_log WHERE member_id = ? AND task_id = ? AND period_key = ? AND status = 'done'", [m.id, t.id, key]);
    });
  };
  const tbSendDigest = async (date, onlyUserId) => {
    const members = (getTaskBoard().members || []).filter(m => m.user_id && (!onlyUserId || m.user_id === onlyUserId));
    const byUser = {};
    members.forEach(m => { (byUser[m.user_id] = byUser[m.user_id] || []).push(m); });
    let sent = 0;
    for (const uid of Object.keys(byUser)) {
      const lines = [];
      byUser[uid].forEach(m => {
        tbDayTasks(m, date).forEach(t => lines.push(`• ${String(t.text).replace(/\*\*/g, '')}${t.freq === 'weekly' ? ' (tuần này)' : t.freq === 'monthly' ? ' (tháng này)' : ''}`));
        // việc người khác nhờ mà mình đã nhận, cho hôm nay
        db.all("SELECT * FROM task_help WHERE to_member_id = ? AND status = 'accepted' AND work_date = ?", [m.id, date]).forEach(h => {
          const owner = (getTaskBoard().members || []).find(x => x.id === h.member_id), t = tbFindTask(owner, h.task_id);
          if (t && !db.get("SELECT 1 AS x FROM task_board_log WHERE member_id = ? AND task_id = ? AND period_key = ? AND status = 'done'", [h.member_id, h.task_id, h.period_key]))
            lines.push(`• 🤝 ${String(t.text).replace(/\*\*/g, '')} (giúp ${owner.name})`);
        });
      });
      const pending = db.all(`SELECT COUNT(*) AS n FROM task_help WHERE status = 'pending' AND to_member_id IN (${byUser[uid].map(() => '?').join(',')})`, byUser[uid].map(m => m.id))[0]?.n || 0;
      if (!lines.length && !pending) continue;
      const content = (lines.length ? `Bạn có ${lines.length} việc cần làm:\n${lines.slice(0, 25).join('\n')}${lines.length > 25 ? `\n… và ${lines.length - 25} việc khác` : ''}` : 'Hôm nay bạn không còn việc nào 🎉')
        + (pending ? `\n\n📨 ${pending} lời nhờ hỗ trợ đang chờ bạn trả lời.` : '');
      if (await notifyTelegram(+uid, `☀️ Việc hôm nay — ${date.split('-').reverse().join('/')}`, content, 'kanban-nhiem-vu.html', '🗂️ Mở Kanban')) sent++;
      await new Promise(r => setTimeout(r, 60));
    }
    return sent;
  };
  setInterval(async () => {
    try {
      const hour = parseInt(db.get("SELECT value FROM site_settings WHERE key='task_digest_hour'")?.value ?? '7', 10);
      if (!(hour >= 0 && hour <= 23)) return;
      // Mỗi thành viên nhận lúc `hour` giờ theo múi giờ của họ (trống = giờ VN), 1 lần/ngày của họ
      const uids = [...new Set((getTaskBoard().members || []).map(m => m.user_id).filter(Boolean))];
      let n = 0;
      for (const uid of uids) {
        const tz = db.get('SELECT timezone FROM users WHERE id = ?', [uid])?.timezone;
        const local = tzParts(tz);
        if (local.hour !== hour) continue;
        if (db.get('SELECT 1 AS x FROM task_digest_log WHERE user_id = ? AND d = ?', [uid, local.date])) continue;
        db.run('INSERT INTO task_digest_log (user_id, d) VALUES (?,?)', [uid, local.date]);
        n += await tbSendDigest(local.date, uid);
      }
      if (n) console.log(`[Kanban] bản tin việc hôm nay → ${n} người (Telegram)`);
    } catch (e) { console.error('[Kanban] bản tin:', e.message); }
  }, 60e3).unref?.();
  // Admin: gửi thử bản tin cho chính mình / đổi giờ gửi (-1 = tắt)
  app.post('/api/task-board/digest-test', async (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.status(401).json({ error: 'Vui lòng đăng nhập.', code: 'session_required' });
    const n = await tbSendDigest(tbToday(), u.id);
    res.json({ ok: true, sent: n });
  });
  app.put('/api/admin/task-digest-hour', requireAdmin, (req, res) => {
    const h = parseInt(req.body?.hour, 10);
    if (!(h >= -1 && h <= 23)) return res.status(400).json({ error: 'Giờ không hợp lệ.' });
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('task_digest_hour',?)", [String(h)]);
    res.json({ ok: true, hour: h });
  });
  app.get('/api/admin/task-digest-hour', requireAdmin, (_req, res) => {
    res.json({ hour: parseInt(db.get("SELECT value FROM site_settings WHERE key='task_digest_hour'")?.value ?? '7', 10) });
  });

  // ── Admin: phân công 5 vai trò cho từng sự kiện / buổi Zoom ──
  const calAllEvents = (from, to) => {
    const out = [];
    db.all('SELECT * FROM calendar_events WHERE start_date <= ?', [to]).forEach(ev => calExpand(ev, from, to).forEach(d => {
      const e = calPublic(ev, d); out.push({ ...e, event_key: `cal:${ev.id}@${d}` });
    }));
    calProgramEvents(from, to).forEach(e => out.push({ ...e, event_key: `${e.id}@${e.date}` }));
    return out.sort((x, y) => (x.date + (x.start_time || '00:00')).localeCompare(y.date + (y.start_time || '00:00')));
  };
  // Tự dọn phân công của buổi đã đổi ngày / bị xoá (event_key gồm ngày → đổi ngày là ra key mới, key cũ thành "mồ côi"
  // và vẫn hiện trên Kanban). Chỉ dọn từ hôm nay trở đi (giữ lịch sử KPI). Buổi chỉ đổi ngày (cùng mã buổi) và
  // vai trò đó ở ngày mới chưa ai nhận → chuyển phân công sang ngày mới; còn lại → xoá. Chạy tối đa 1 lần / phút.
  let eaPrunedAt = 0;
  function eaPruneOrphans(force) {
    if (!force && Date.now() - eaPrunedAt < 60e3) return;
    eaPrunedAt = Date.now();
    try {
      const today = tbToday();
      const rows = db.all('SELECT * FROM event_assignments WHERE event_date >= ?', [today]);
      if (!rows.length) return;
      const maxDate = rows.reduce((m, r) => r.event_date > m ? r.event_date : m, today);
      const evs = calAllEvents(today, tbAddDays(maxDate, 120));
      const keys = new Set(evs.map(e => e.event_key));
      const offs = eventRoleOffsets();
      rows.filter(r => !keys.has(r.event_key)).forEach(r => {
        const base = r.event_key.split('@')[0];
        const nu = evs.find(e => e.event_key.split('@')[0] === base);
        const taken = nu && db.get('SELECT 1 AS x FROM event_assignments WHERE event_key = ? AND role = ?', [nu.event_key, r.role]);
        if (nu && !taken) {
          db.run('UPDATE event_assignments SET event_key = ?, event_title = ?, event_date = ?, event_time = ?, task_date = ? WHERE id = ?',
            [nu.event_key, nu.title, nu.date, nu.start_time || r.event_time, tbAddDays(nu.date, -(offs[r.role] || 0)), r.id]);
          console.log(`[Phân công] Chuyển ${r.role} "${r.event_title}" ${r.event_date} → ${nu.date}`);
        } else {
          db.run('DELETE FROM event_assignments WHERE id = ?', [r.id]);
          console.log(`[Phân công] Xoá ${r.role} "${r.event_title}" ${r.event_date} (buổi đã đổi ngày / bị xoá)`);
        }
      });
    } catch (e) { console.error('[Phân công] dọn mồ côi:', e.message); }
  }
  app.get('/api/admin/event-assign', requireAdmin, (req, res) => {
    const from = tbValidDate(req.query.from) ? req.query.from : tbAddDays(tbToday(), -7);
    let to = tbValidDate(req.query.to) ? req.query.to : tbAddDays(tbToday(), 60);
    if (to > tbAddDays(from, 200)) to = tbAddDays(from, 200);
    eaPruneOrphans(true);
    const rows = db.all('SELECT * FROM event_assignments WHERE event_date BETWEEN ? AND ?', [from, to]);
    const by = {}; rows.forEach(r => { (by[r.event_key] = by[r.event_key] || {})[r.role] = r.member_id; });
    const events = calAllEvents(from, to).map(e => ({ event_key: e.event_key, date: e.date, start_time: e.start_time, title: e.title,
      color: e.color, program_label: e.program_label || '', assign: by[e.event_key] || {} }));
    // Phân công của sự kiện đã bị xoá / đổi ngày (không còn khớp) — để admin dọn
    const keys = new Set(events.map(e => e.event_key));
    const orphans = rows.filter(r => !keys.has(r.event_key)).map(r => ({ event_key: r.event_key, title: r.event_title, date: r.event_date, role: r.role, member_id: r.member_id }));
    res.json({ from, to, roles: EVENT_ROLES, offsets: eventRoleOffsets(), events, orphans });
  });
  app.put('/api/admin/event-assign', requireAdmin, (req, res) => {
    const { event_key } = req.body || {};
    const roles = req.body?.roles || {};
    if (!event_key || !/^[\w:.@-]{3,120}$/.test(event_key)) return res.status(400).json({ error: 'Sự kiện không hợp lệ.' });
    const date = String(event_key.split('@')[1] || '');
    const ev = calAllEvents(date, date).find(e => e.event_key === event_key);
    const existing = db.all('SELECT * FROM event_assignments WHERE event_key = ?', [event_key]);
    if (!ev && !existing.length) return res.status(404).json({ error: 'Không tìm thấy sự kiện (lịch có thể vừa đổi — tải lại).' });
    const title = ev ? ev.title : existing[0].event_title, time = ev ? ev.start_time : existing[0].event_time;
    const members = getTaskBoard().members || [], offs = eventRoleOffsets();
    let notified = 0;
    EVENT_ROLES.forEach(role => {
      if (!(role.id in roles)) return;
      const mid = String(roles[role.id] || '');
      const old = existing.find(r => r.role === role.id);
      if (!mid) { if (old) db.run('DELETE FROM event_assignments WHERE id = ?', [old.id]); return; }
      const m = members.find(x => x.id === mid);
      if (!m) return;
      const taskDate = tbAddDays(date, -(offs[role.id] || 0));
      if (old && old.member_id === mid) { db.run('UPDATE event_assignments SET event_title = ?, event_time = ?, task_date = ? WHERE id = ?', [title, time, taskDate, old.id]); return; }
      if (old) db.run('DELETE FROM event_assignments WHERE id = ?', [old.id]);
      db.run('INSERT INTO event_assignments (event_key, role, member_id, event_title, event_date, event_time, task_date) VALUES (?,?,?,?,?,?,?)',
        [event_key, role.id, mid, title, date, time, taskDate]);
      if (m.user_id && date >= tbToday()) {
        tbNotify(m.user_id, `📋 Bạn được phân công: ${role.icon} ${role.label}`,
          `${title} (${date.split('-').reverse().join('/')}${time ? ' ' + time : ''}). Việc sẽ hiện trên Kanban ngày ${taskDate.split('-').reverse().join('/')}.`);
        notified++;
      }
    });
    res.json({ ok: true, notified });
  });
  // Đổi số ngày "làm trước" của vai trò → cập nhật lại ngày hiện việc cho các sự kiện sắp tới
  app.put('/api/admin/event-assign/offsets', requireAdmin, (req, res) => {
    const cur = eventRoleOffsets();
    EVENT_ROLES.forEach(r => { if (req.body && r.id in req.body) cur[r.id] = Math.max(0, Math.min(30, parseInt(req.body[r.id], 10) || 0)); });
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('event_role_offsets',?)", [JSON.stringify(cur)]);
    db.all('SELECT id, role, event_date FROM event_assignments WHERE event_date >= ?', [tbToday()])
      .forEach(r => db.run('UPDATE event_assignments SET task_date = ? WHERE id = ?', [tbAddDays(r.event_date, -(cur[r.role] || 0)), r.id]));
    res.json({ ok: true, offsets: cur });
  });
  app.delete('/api/admin/event-assign', requireAdmin, (req, res) => {
    const key = String(req.query.event_key || '');
    db.run('DELETE FROM event_assignments WHERE event_key = ?', [key]);
    res.json({ ok: true });
  });

  // ── Sao lưu dữ liệu lên Google Drive (mã hoá AES-256-GCM) — mỗi đêm 03:00 giờ VN + nút "Sao lưu ngay" ──
  // Gói gồm: brain.db (bản chụp), dữ liệu GoClaw (file goclaw-YYYYMMDD.tar.gz do scripts/goclaw-backup.sh tạo lúc 02:45),
  // bản sao .env, cấu hình nginx, ảnh cửa hàng. Mã hoá bằng BACKUP_KEY (.env) rồi tải lên thư mục Drive riêng tư.
  // Giữ: 14 ngày gần nhất + 1 bản/tuần trong 8 tuần + 1 bản/tháng trong 12 tháng. Giải mã: scripts/restore-backup.js.
  const { execFileSync } = require('child_process');
  const BACKUP_LOCAL_DIR = process.env.BACKUP_LOCAL_DIR || path.join(require('os').homedir(), 'db-backups');
  const BACKUP_FOLDER_NAME = 'Sao lưu (riêng tư)';
  let backupRunning = false;
  const backupKey = () => { const k = Buffer.from(String(process.env.BACKUP_KEY || ''), 'base64'); return k.length === 32 ? k : null; };
  const backupStatus = () => { try { return JSON.parse(db.get("SELECT value FROM site_settings WHERE key='backup_last'")?.value || 'null'); } catch { return null; } };
  const backupAlert = async (text) => {
    for (const u of db.all("SELECT antam_chat_id FROM users WHERE is_admin = 1 AND status = 'active' AND antam_chat_id IS NOT NULL AND antam_chat_id != ''"))
      await antamApi('sendMessage', { chat_id: u.antam_chat_id, parse_mode: 'HTML', text }).catch(() => {});
  };
  // Thư mục sao lưu: tạo ở "Drive của tôi" nếu chưa có; từ chối tải lên nếu thư mục bị chia sẻ công khai
  const backupFolder = async (drive) => {
    let id = db.get("SELECT value FROM site_settings WHERE key='backup_drive_folder_id'")?.value;
    if (id) { try { await drive.files.get({ fileId: id, fields: 'id,trashed' }).then(r => { if (r.data.trashed) id = null; }); } catch { id = null; } }
    if (!id) {
      const f = await drive.files.create({ requestBody: { name: BACKUP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' });
      id = f.data.id;
      db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('backup_drive_folder_id',?)", [id]);
    }
    const perms = (await drive.permissions.list({ fileId: id, fields: 'permissions(type,role)' })).data.permissions || [];
    if (perms.some(p => p.type === 'anyone' || p.type === 'domain'))
      throw new Error('Thư mục sao lưu trên Drive đang được chia sẻ công khai — đã dừng tải lên. Hãy đặt thư mục về "Bị hạn chế".');
    return id;
  };
  // Chọn bản cần giữ: 14 ngày gần nhất, bản mới nhất mỗi tuần (8 tuần), mỗi tháng (12 tháng)
  const backupKeepSet = (files) => {
    const sorted = [...files].sort((a, b) => b.name.localeCompare(a.name));
    const keep = new Set(), days = new Set(), weeks = new Set(), months = new Set();
    for (const f of sorted) {
      const d = (f.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1]; if (!d) { keep.add(f.id); continue; }
      if (!days.has(d) && days.size < 14) { days.add(d); keep.add(f.id); }
      const w = tbMonday(d); if (!weeks.has(w) && weeks.size < 8) { weeks.add(w); keep.add(f.id); }
      const m = d.slice(0, 7); if (!months.has(m) && months.size < 12) { months.add(m); keep.add(f.id); }
    }
    return keep;
  };
  async function runBackup(reason = 'tự động') {
    if (backupRunning) throw new Error('Đang sao lưu, vui lòng đợi.');
    backupRunning = true;
    const started = Date.now(), stamp = calNowVN().replace(' ', '_').replace(':', '');
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dhbk-'));
    const status = { at: calNowVN(), reason, ok: false };
    try {
      const key = backupKey();
      if (!key) throw new Error('Chưa có BACKUP_KEY trong .env.');
      const dir = path.join(tmp, 'bundle'); fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'brain.db'), Buffer.from(db._.export()));
      // Dữ liệu GoClaw mới nhất (≤ 30 giờ)
      let goclaw = null;
      try {
        const g = fs.readdirSync(BACKUP_LOCAL_DIR).filter(f => /^goclaw-\d{8}\.tar\.gz$/.test(f)).sort().pop();
        if (g && Date.now() - fs.statSync(path.join(BACKUP_LOCAL_DIR, g)).mtimeMs < 30 * 3600e3) { fs.copyFileSync(path.join(BACKUP_LOCAL_DIR, g), path.join(dir, g)); goclaw = g; }
      } catch {}
      try { fs.copyFileSync(path.join(__dirname, '.env'), path.join(dir, 'env.txt')); } catch {}
      try { for (const f of fs.readdirSync('/etc/nginx/sites-available')) fs.copyFileSync(path.join('/etc/nginx/sites-available', f), path.join(dir, `nginx-${f}.conf`)); } catch {}
      try { const loc = path.join(__dirname, 'uploads', 'locations'); if (fs.existsSync(loc)) execFileSync('tar', ['-czf', path.join(dir, 'uploads-locations.tar.gz'), '-C', path.join(__dirname, 'uploads'), 'locations']); } catch {}
      try { const docs = path.join(__dirname, 'uploads', 'docs'); if (fs.existsSync(docs)) execFileSync('tar', ['-czf', path.join(dir, 'uploads-docs.tar.gz'), '-C', path.join(__dirname, 'uploads'), 'docs']); } catch {}
      try { const mus = path.join(__dirname, 'uploads', 'music'); if (fs.existsSync(mus)) execFileSync('tar', ['-czf', path.join(dir, 'uploads-music.tar.gz'), '-C', path.join(__dirname, 'uploads'), 'music']); } catch {}
      const counts = {}; for (const t of ['users', 'posts', 'program377_reports', 'meal_logs', 'health_visits', 'orders']) { try { counts[t] = db.get(`SELECT COUNT(*) AS n FROM ${t}`).n; } catch {} }
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ created_at: status.at, reason, site: SITE_URL, goclaw, counts }, null, 2));
      fs.writeFileSync(path.join(dir, 'RESTORE.md'), [
        '# Khôi phục từ bản sao lưu',
        '1. brain.db — dừng dịch vụ (sudo systemctl stop ttm-community), chép đè /opt/ttm-community/brain.db (giữ bản cũ), chạy lại (sudo systemctl start ttm-community).',
        '2. env.txt — đổi tên thành .env đặt trong /opt/ttm-community (chmod 600).',
        '3. goclaw-*.tar.gz — giải nén: goclaw-db.sql.gz (gunzip | docker exec -i goclaw-postgres-1 psql -U goclaw -d goclaw), goclaw-volumes.tar.gz (giải nén vào /var/lib/docker/volumes khi GoClaw đang dừng), docker-compose*.yml + .env vào /opt/goclaw.',
        '4. nginx-*.conf — chép vào /etc/nginx/sites-available, sudo nginx -t && sudo systemctl reload nginx.',
        '5. Mã nguồn: git clone từ kho mã nguồn của bạn, npm install --omit=dev.',
      ].join('\n'));
      const tgz = path.join(tmp, 'bundle.tar.gz');
      execFileSync('tar', ['-czf', tgz, '-C', dir, '.']);
      // Mã hoá: "DHBK1" + iv(12) + dữ liệu + tag(16)
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([Buffer.from('DHBK1'), iv, c.update(fs.readFileSync(tgz)), c.final(), c.getAuthTag()]);
      const out = path.join(tmp, `backup-${stamp}.dhbk`); fs.writeFileSync(out, enc);
      const drive = getDriveClient(), folderId = await backupFolder(drive);
      const up = await drive.files.create({
        requestBody: { name: path.basename(out), parents: [folderId], appProperties: { kind: 'dhbackup' } },
        media: { mimeType: 'application/octet-stream', body: fs.createReadStream(out) }, fields: 'id,size',
      });
      // Dọn bản cũ trên Drive
      const list = (await drive.files.list({ q: `'${folderId}' in parents and trashed = false and name contains 'backup-'`, fields: 'files(id,name)', pageSize: 500 })).data.files || [];
      const keep = backupKeepSet(list); let removed = 0;
      for (const f of list) if (!keep.has(f.id)) { try { await drive.files.delete({ fileId: f.id }); removed++; } catch {} }
      // Dọn bản sao lưu cục bộ cũ hơn 14 ngày
      try { for (const f of fs.readdirSync(BACKUP_LOCAL_DIR)) { const p = path.join(BACKUP_LOCAL_DIR, f); if (/^(brain\.db\.bak-|goclaw-)/.test(f) && Date.now() - fs.statSync(p).mtimeMs > 14 * 864e5) fs.unlinkSync(p); } } catch {}
      Object.assign(status, { ok: true, file: path.basename(out), size: enc.length, file_id: up.data.id, folder_id: folderId, goclaw: !!goclaw, kept: keep.size, removed, seconds: Math.round((Date.now() - started) / 1000), counts });
      console.log(`[Sao lưu] OK ${status.file} ${(enc.length / 1048576).toFixed(1)}MB${goclaw ? ' (+GoClaw)' : ' (thiếu GoClaw)'} — giữ ${keep.size}, xoá ${removed}`);
    } catch (e) {
      status.error = e.message;
      console.error('[Sao lưu] lỗi:', e.message);
      backupAlert(`⚠️ <b>Sao lưu dữ liệu thất bại</b> (${reason})\n${String(e.message).replace(/</g, '&lt;')}\nVào Admin → Google Drive → Sao lưu để thử lại.`);
    } finally {
      backupRunning = false;
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('backup_last',?)", [JSON.stringify(status)]);
    }
    return status;
  }
  // Mỗi 10 phút: nếu đã qua 03:00 giờ VN mà hôm nay chưa sao lưu tự động thì chạy
  setInterval(() => {
    const now = calNowVN();
    if (+now.slice(11, 13) < 3) return;
    if (db.get("SELECT value FROM site_settings WHERE key='backup_auto_date'")?.value === now.slice(0, 10)) return;
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('backup_auto_date',?)", [now.slice(0, 10)]);
    runBackup('tự động hằng đêm').catch(() => {});
  }, 10 * 60e3).unref?.();
  app.get('/api/admin/backup/status', requireAdmin, (_req, res) => {
    let goclaw = null;
    try { goclaw = fs.readdirSync(BACKUP_LOCAL_DIR).filter(f => /^goclaw-\d{8}\.tar\.gz$/.test(f)).sort().pop() || null; } catch {}
    const folder = db.get("SELECT value FROM site_settings WHERE key='backup_drive_folder_id'")?.value || null;
    res.json({ last: backupStatus(), running: backupRunning, has_key: !!backupKey(), folder_url: folder ? `https://drive.google.com/drive/folders/${folder}` : null, goclaw_latest: goclaw });
  });
  // Admin xem khoá giải mã để cất giữ (ghi nhật ký mỗi lần xem)
  app.get('/api/admin/backup/key', requireAdmin, (req, res) => {
    const k = process.env.BACKUP_KEY || '';
    if (!backupKey()) return res.status(404).json({ error: 'Chưa có khoá giải mã trên máy chủ.' });
    console.log(`[Sao lưu] admin #${req.adminUserId || 'master'} xem khoá giải mã lúc ${calNowVN()}`);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ key: k });
  });
  app.post('/api/admin/backup/run', requireAdmin, async (_req, res) => {
    try { res.json(await runBackup('bấm tay trong Admin')); }
    catch (e) { res.status(409).json({ error: e.message }); }
  });

  // Public courses list
  // Private courses must always have a published, in-sync checkout product. Courses saved
  // before that pairing existed (or whose product drifted out of sync some other way) get
  // healed here on read, so the "Thanh toán" button never dead-ends.
  // Cách tham gia khoá học:
  //   'open'     — công khai: bấm là vào học ngay
  //   'approval' — riêng tư 0đ, hoặc riêng tư có phí mà admin chọn "Admin duyệt": gửi yêu cầu, chờ duyệt
  //   'payment'  — riêng tư có phí, admin chọn "Thanh toán": qua checkout, thanh toán xong tự vào học
  function courseJoinMode(course) {
    if (!course || course.visibility !== 'private') return 'open';
    if (!(Number(course.price) > 0)) return 'approval';
    return course.private_access === 'approval' ? 'approval' : 'payment';
  }

  function ensureCourseProduct(courseId) {
    const product = db.get("SELECT id FROM products WHERE course_id = ? AND status = 'published'", [courseId]);
    if (product) return product.id;
    syncCourseProduct(courseId);
    return db.get("SELECT id FROM products WHERE course_id = ? AND status = 'published'", [courseId])?.id || null;
  }

  app.get('/api/courses', (req, res) => {
    const { user_id = '' } = req.query;
    const courses = db.all(`
      SELECT c.id, c.title, c.description, c.cover_color, c.status, c.visibility, c.price, c.compare_price,
             c.private_access, c.instructor, c.order_num, c.created_at, c.space_id, c.group_id,
             s.name AS space_name, s.icon AS space_icon, g.name AS group_name,
             p.id AS checkout_product_id,
             COUNT(cl.id) AS lesson_count
      FROM courses c
      LEFT JOIN course_lessons cl ON cl.course_id = c.id AND cl.status = 'published'
      LEFT JOIN spaces s ON s.id = c.space_id
      LEFT JOIN space_groups g ON g.id = c.group_id
      LEFT JOIN products p ON p.course_id = c.id AND p.status = 'published'
      WHERE c.status = 'published'
      GROUP BY c.id
      ORDER BY c.order_num ASC, c.created_at DESC
    `).map(c => ({
      ...c,
      join_status: c.group_id ? (getGroupMembership(c.group_id, user_id)?.status || 'none')
        : c.space_id ? (getMembership(c.space_id, user_id)?.status || 'none')
        : null,
      enroll_status: user_id ? (getEnrollment(c.id, user_id)?.status || 'none') : 'none',
      join_mode: courseJoinMode(c),
      checkout_product_id: courseJoinMode(c) !== 'payment' ? null
        : (c.checkout_product_id || ensureCourseProduct(c.id)),
    }));
    const total_lessons = db.get("SELECT COUNT(*) AS n FROM course_lessons cl JOIN courses c ON c.id = cl.course_id WHERE c.status = 'published' AND cl.status = 'published'").n;
    res.json({ courses, total_lessons });
  });

  // Course detail with lessons. Private courses the user hasn't paid for get the lesson
  // curriculum stripped of content — only the checkout prompt should render client-side.
  app.get('/api/courses/:id', (req, res) => {
    const { user_id = '' } = req.query;
    const course = db.get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    const enroll_status = user_id ? (getEnrollment(course.id, user_id)?.status || 'none') : 'none';
    const unlocked = course.visibility !== 'private' || enroll_status === 'approved';
    const lesson_count = db.get("SELECT COUNT(*) AS n FROM course_lessons WHERE course_id = ? AND status = 'published'", [req.params.id]).n;
    const modules = db.all('SELECT id, title, order_num FROM course_modules WHERE course_id = ? ORDER BY order_num ASC, id ASC', [req.params.id]);
    const lessons = unlocked
      ? db.all(
          `SELECT cl.id, cl.module_id, cl.title, cl.content, cl.video_url, cl.duration_min, cl.order_num,
                  cl.exercise_enabled, cl.exercise_type, cl.exercise_prompt, cl.exercise_max_score, cl.exercise_pass_score,
                  cl.linked_assignment_id
           FROM course_lessons cl
           LEFT JOIN course_modules cm ON cm.id = cl.module_id
           WHERE cl.course_id = ? AND cl.status = 'published'
           ORDER BY cm.order_num ASC, cm.id ASC, cl.order_num ASC, cl.id ASC`,
          [req.params.id]
        ).map(l => {
          if (!l.exercise_enabled) return { ...l, my_submission: null };
          // Bài tập 'link' (chọn từ thư viện assignments) không AI chấm, không nộp
          // bài — chỉ cần hiển thị hướng dẫn + link, không cần tra lesson_exercise_submissions.
          if (l.exercise_type === 'link') {
            const linkedAssignment = l.linked_assignment_id
              ? db.get('SELECT id, title, instructions, link_url, display_mode FROM assignments WHERE id = ?', [l.linked_assignment_id])
              : null;
            return { ...l, my_submission: null, linkedAssignment };
          }
          const s = user_id ? db.get(
            'SELECT answer_text, score, max_score, pass_score, passed, issues, hints, xp_awarded, status, teacher_note, submitted_at FROM lesson_exercise_submissions WHERE user_id = ? AND lesson_id = ?',
            [user_id, l.id]
          ) : null;
          const my_submission = s ? {
            ...s,
            issues: JSON.parse(s.issues || '[]'),
            hints: JSON.parse(s.hints || '[]'),
          } : null;
          const result = { ...l, my_submission };
          const needsForm = !my_submission || my_submission.status === 'needs_resubmit';

          if (l.exercise_type === 'quiz') {
            const questions = db.all(
              'SELECT id, question_text, options, correct_index, order_num FROM lesson_exercise_questions WHERE lesson_id = ? ORDER BY order_num ASC, id ASC',
              [l.id]
            );
            if (needsForm) {
              result.quiz_questions = questions.map(q => ({ id: q.id, question_text: q.question_text, options: JSON.parse(q.options), order_num: q.order_num }));
            } else {
              const answers = JSON.parse(s.answer_text || '{}');
              my_submission.quiz_review = questions.map(q => ({
                question_text: q.question_text,
                options: JSON.parse(q.options),
                picked_index: answers[q.id] !== undefined ? Number(answers[q.id]) : null,
                correct_index: q.correct_index,
              }));
            }
          }
          return result;
        })
      : [];
    const join_mode = courseJoinMode(course);
    const checkout_product_id = join_mode === 'payment' ? ensureCourseProduct(course.id) : null;
    res.json({
      course: { ...course, enroll_status, join_mode, checkout_product_id },
      lessons,
      lesson_count,
      modules,
    });
  });

  // Tham gia khoá học theo courseJoinMode: công khai → vào học ngay; cần duyệt → tạo yêu cầu
  // 'pending' chờ admin; thanh toán → 402 kèm sản phẩm checkout (thanh toán xong tự được duyệt).
  app.post('/api/courses/:id/enroll', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const course = db.get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    if (!db.get('SELECT id FROM users WHERE id = ?', [user_id])) return res.status(404).json({ error: 'Tài khoản không tồn tại.' });
    const mode = courseJoinMode(course);
    if (mode === 'payment') {
      return res.status(402).json({ error: 'Khóa học này yêu cầu thanh toán để tham gia.', checkout_product_id: ensureCourseProduct(course.id) });
    }

    const existing = db.get('SELECT id, status FROM course_enrollments WHERE course_id = ? AND user_id = ?', [course.id, user_id]);
    if (existing?.status === 'approved') return res.json({ success: true, status: 'approved' });
    const status = mode === 'open' ? 'approved' : 'pending';
    let enrollId = existing?.id;
    if (existing) db.run('UPDATE course_enrollments SET status = ? WHERE id = ?', [status, existing.id]);
    else enrollId = db.run('INSERT INTO course_enrollments (course_id, user_id, status) VALUES (?,?,?)', [course.id, user_id, status]).lastInsertRowid;
    res.json({ success: true, status });
    // Chỉ báo lần đầu gửi yêu cầu (bấm lại khi đang chờ thì không báo trùng)
    if (status === 'pending' && existing?.status !== 'pending') {
      notifyEnrollRequested(user_id, `khoá học "${course.title}"`, `course-view.html?id=${course.id}`);
      antamNotify('course', enrollId, `📚 <b>Xin vào khoá học</b> — chờ duyệt\n\n${antamWho(user_id)}\n🎓 Khoá: <b>${antamEsc(course.title)}</b>`);
    }
  });

  // AI-graded lesson exercise — student submits once, gets an immediate score + feedback.
  // The row is only inserted after a SUCCESSFUL grading call, so a failed AI call never
  // burns the student's single attempt (see UNIQUE(user_id, lesson_id) on the table).
  app.post('/api/courses/lessons/:lessonId/exercise/submit', async (req, res) => {
    const { user_id, answer, answers } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });

    const lesson = db.get('SELECT * FROM course_lessons WHERE id = ? AND exercise_enabled = 1', [req.params.lessonId]);
    if (!lesson) return res.status(404).json({ error: 'Bài tập không tồn tại.' });
    if (lesson.exercise_type === 'link')
      return res.status(400).json({ error: 'Bài tập này chỉ cần đọc hướng dẫn và bấm vào link, không cần nộp bài.' });

    const enrollment = getEnrollment(lesson.course_id, user_id);
    if (!enrollment || enrollment.status !== 'approved')
      return res.status(403).json({ error: 'Bạn cần tham gia khóa học này trước khi nộp bài tập.' });

    const existing = db.get('SELECT * FROM lesson_exercise_submissions WHERE user_id = ? AND lesson_id = ?', [user_id, lesson.id]);
    if (existing && existing.status !== 'needs_resubmit') {
      return res.status(409).json({
        error: existing.status === 'finalized'
          ? 'Bài tập này đã được giáo viên chấm và kết thúc.'
          : 'Bạn đã nộp bài tập này rồi.',
      });
    }

    let answerText, score, issues, hints, raw = '', maxScore = lesson.exercise_max_score || 100;

    if (lesson.exercise_type === 'quiz') {
      if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'Vui lòng trả lời tất cả câu hỏi.' });
      const questions = db.all('SELECT * FROM lesson_exercise_questions WHERE lesson_id = ? ORDER BY order_num ASC, id ASC', [lesson.id]);
      if (!questions.length) return res.status(400).json({ error: 'Bài tập trắc nghiệm chưa có câu hỏi.' });
      const normalizedAnswers = {};
      questions.forEach(q => { if (answers[q.id] !== undefined) normalizedAnswers[q.id] = Number(answers[q.id]); });
      if (Object.keys(normalizedAnswers).length < questions.length)
        return res.status(400).json({ error: 'Vui lòng trả lời tất cả câu hỏi.' });
      const graded = gradeQuizExercise(questions, normalizedAnswers, maxScore);
      answerText = JSON.stringify(normalizedAnswers);
      score = graded.score; issues = graded.issues; hints = graded.hints;
    } else {
      if (!answer || !answer.trim()) return res.status(400).json({ error: 'Vui lòng nhập nội dung bài làm.' });
      const result = await gradeExerciseWithGemini({
        lessonTitle: lesson.title,
        exercisePrompt: lesson.exercise_prompt || '',
        rubric: lesson.exercise_rubric || '',
        maxScore,
        studentAnswer: answer.trim(),
      });
      if (!result.ok) return res.status(502).json({ error: 'AI chấm bài gặp lỗi, vui lòng thử lại sau.' });
      answerText = answer.trim(); score = result.score; issues = result.issues; hints = result.hints; raw = result.raw || '';
    }

    const passed = score >= lesson.exercise_pass_score ? 1 : 0;
    const alreadyAwarded = existing ? existing.xp_awarded > 0 : false;
    const newlyAwardedXp = (passed && !alreadyAwarded) ? (lesson.exercise_xp_reward || 0) : 0;
    const xp_awarded = alreadyAwarded ? existing.xp_awarded : newlyAwardedXp;

    if (existing) {
      db.run(
        `UPDATE lesson_exercise_submissions
           SET answer_text=?, score=?, max_score=?, pass_score=?, passed=?, issues=?, hints=?, ai_feedback_raw=?, xp_awarded=?,
               status='graded', teacher_note=NULL, submitted_at=datetime('now','localtime')
         WHERE id=?`,
        [answerText, score, maxScore, lesson.exercise_pass_score, passed,
         JSON.stringify(issues), JSON.stringify(hints), raw, xp_awarded, existing.id]
      );
    } else {
      db.run(
        `INSERT INTO lesson_exercise_submissions
          (user_id, lesson_id, course_id, answer_text, score, max_score, pass_score, passed, issues, hints, ai_feedback_raw, xp_awarded)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [user_id, lesson.id, lesson.course_id, answerText, score, maxScore, lesson.exercise_pass_score,
         passed, JSON.stringify(issues), JSON.stringify(hints), raw, xp_awarded]
      );
    }

    if (newlyAwardedXp > 0) {
      addXP(user_id, newlyAwardedXp, 'lesson_exercise', `Đạt bài tập: ${lesson.title}`);
    }

    const saved = db.get(
      'SELECT answer_text, score, max_score, pass_score, passed, issues, hints, xp_awarded, status, teacher_note, submitted_at FROM lesson_exercise_submissions WHERE user_id = ? AND lesson_id = ?',
      [user_id, lesson.id]
    );
    res.status(201).json({
      success: true,
      my_submission: {
        ...saved,
        issues: JSON.parse(saved.issues || '[]'),
        hints: JSON.parse(saved.hints || '[]'),
      },
    });
  });

  // ── Lesson discussion (comments right under a course lesson) ────────
  app.get('/api/courses/lessons/:lessonId/comments', (req, res) => {
    const comments = db.all(
      `SELECT c.id, c.parent_id, c.content, c.created_at,
              u.id AS author_id, u.first_name, u.last_name, u.level
       FROM lesson_comments c JOIN users u ON u.id = c.user_id
       WHERE c.lesson_id = ?
       ORDER BY COALESCE(c.parent_id, c.id), c.id ASC`,
      [req.params.lessonId]
    );
    res.json({ comments });
  });

  app.post('/api/courses/lessons/:lessonId/comments', (req, res) => {
    const lesson = db.get('SELECT id FROM course_lessons WHERE id = ?', [req.params.lessonId]);
    if (!lesson) return res.status(404).json({ error: 'Bài học không tồn tại.' });

    const { user_id, content, parent_id = null } = req.body;
    if (!user_id || !content?.trim()) return res.status(400).json({ error: 'Thiếu thông tin' });

    db.run('INSERT INTO lesson_comments (lesson_id, user_id, content, parent_id) VALUES (?,?,?,?)',
      [lesson.id, user_id, content.trim(), parent_id || null]);
    addXP(user_id, 2, 'lesson_comment', 'Bình luận bài học');
    res.json({ success: true });
  });

  // Register
  app.post('/api/auth/register', (req, res) => {
    const { first_name, last_name, email, password, rules_accepted } = req.body;

    if (!first_name || !last_name || !email || !password)
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin.' });
    if (!rules_accepted)
      return res.status(400).json({ error: 'Vui lòng đọc và đồng ý với Nội quy cộng đồng.' });
    if (!/\S+@\S+\.\S+/.test(email))
      return res.status(400).json({ error: 'Email không hợp lệ.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 8 ký tự.' });

    const existing = db.get('SELECT id, google_id, password_hash FROM users WHERE lower(email) = lower(?)', [email]);
    if (existing) {
      // Nói rõ tài khoản đã tạo bằng cách nào để khách vào đúng nút (hay gặp: đã tạo bằng Google rồi quên)
      const viaGoogle = !!existing.google_id && !existing.password_hash;
      return res.status(409).json({
        code: 'email_exists', via: viaGoogle ? 'google' : existing.password_hash ? 'password' : 'code',
        error: viaGoogle
          ? 'Email này đã có tài khoản (tạo bằng Google). Bạn không cần đăng ký lại — bấm "Đăng nhập ngay" rồi chọn "Tiếp tục với Google".'
          : 'Email này đã có tài khoản. Bạn không cần đăng ký lại — bấm "Đăng nhập ngay". Quên mật khẩu thì chọn "Đăng nhập / Đăng ký bằng mã qua email".',
      });
    }

    const hash   = bcrypt.hashSync(password, 10);
    const result = db.run(
      'INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?,?,?,?)',
      [toTitleCase(first_name), toTitleCase(last_name), email, hash]
    );

    const userId = result.lastInsertRowid;
    db.run("UPDATE users SET rules_accepted_version = ?, rules_accepted_at = datetime('now','localtime') WHERE id = ?",
      [currentRulesVersion(), userId]);
    addXP(userId, 10, 'register', 'Chào mừng thành viên mới');
    applyCourseEmailGrants(userId, email);

    const user = db.get(
      'SELECT id, first_name, last_name, email, level, xp, created_at FROM users WHERE id = ?',
      [userId]
    );
    res.status(201).json({ success: true, user: { ...user, session_token: createUserSession(user.id) } });

    // Welcome email (fire-and-forget after response)
    sendEmail({
      to: email,
      subject: `🎉 Chào mừng bạn đến với ${communityName()}!`,
      html: emailWrap('Chào mừng đến với cộng đồng!', `
        <p>Xin chào <strong>${user.first_name} ${user.last_name}</strong>,</p>
        <p>Bạn đã đăng ký thành công tài khoản tại <strong>${communityName()}</strong>.</p>
        <p>Với tài khoản này, bạn có thể:</p>
        <ul style="color:#475569;line-height:2">
          <li>📝 Chia sẻ bữa ăn và học hỏi từ cộng đồng</li>
          <li>🌱 Tham gia Thử thách cộng đồng</li>
          <li>🍚 Tra cứu thực phẩm theo màu – vị – ngũ hành</li>
          <li>📗 Truy cập khoá học và công thức độc quyền</li>
        </ul>
        <a class="btn" href="${SITE_URL}/feed.html">Vào Bảng Tin Ngay</a>
        <p>📖 Lần đầu sử dụng? Xem <a href="${SITE_URL}/huong-dan.html">Hướng dẫn sử dụng</a> (đăng nhập, cài ứng dụng lên điện thoại, bật thông báo, vào Zoom…).</p>
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
    if (!user) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
    if (!user.password_hash)
      return res.status(401).json({ error: 'Tài khoản này đăng nhập bằng Google. Vui lòng dùng nút "Tiếp tục với Google" hoặc "Đăng nhập / Đăng ký bằng mã qua email".' });
    if (!bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
    if (user.status !== 'active')
      return res.status(403).json({ error: 'Tài khoản này đã bị khoá.' });

    db.run("UPDATE users SET last_active_at = datetime('now','localtime') WHERE id = ?", [user.id]);
    applyCourseEmailGrants(user.id, user.email);
    res.json({
      success: true,
      user: { id: user.id, first_name: user.first_name, last_name: user.last_name,
              email: user.email, level: user.level, xp: user.xp, is_admin: !!user.is_admin,
              ttm_intake_done_at: user.ttm_intake_done_at || null,
              telegram_chat_id: user.telegram_chat_id || null,
              session_token: createUserSession(user.id) },
    });
  });

  // ── Đăng nhập bằng mã 6 số qua email ──────────────────────────────────
  // Dùng được ở mọi nơi (kể cả app ở màn hình chính, nơi cửa sổ Google không thấy tài khoản
  // đã đăng nhập trong trình duyệt). Mã lưu dạng băm, hết hạn 10 phút, dùng 1 lần, tối đa 5 lần nhập sai.
  const LOGIN_CODE_TTL_MIN = 10;
  const loginCodeIpHits = new Map(); // ip → [timestamps] (giới hạn gửi mã theo IP, trong bộ nhớ)
  const hashLoginCode = (email, code) => crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');
  const normEmail = e => String(e || '').trim().toLowerCase();

  app.post('/api/auth/email-code/request', (req, res) => {
    const email = normEmail(req.body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ.' });

    // Giới hạn: 20 lần / giờ / IP; 1 lần / 60 giây và 5 lần / giờ cho mỗi email
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const now = Date.now();
    const hits = (loginCodeIpHits.get(ip) || []).filter(t => now - t < 3600e3);
    if (hits.length >= 20) return res.status(429).json({ error: 'Bạn đã yêu cầu quá nhiều mã. Vui lòng thử lại sau ít phút.' });
    const recent = db.get(`SELECT COUNT(*) AS n,
        SUM(CASE WHEN created_at > datetime('now','localtime','-60 seconds') THEN 1 ELSE 0 END) AS last_min
      FROM login_codes WHERE email = ? AND created_at > datetime('now','localtime','-1 hour')`, [email]);
    if (recent.last_min > 0) return res.status(429).json({ error: 'Vui lòng đợi 1 phút trước khi gửi lại mã.' });
    if (recent.n >= 5) return res.status(429).json({ error: 'Email này đã nhận quá nhiều mã trong 1 giờ. Vui lòng thử lại sau.' });
    hits.push(now); loginCodeIpHits.set(ip, hits);

    // Có tài khoản → mã đăng nhập; chưa có tài khoản → mã xác nhận để tạo tài khoản mới ngay bằng mã
    // (khách mới hay bấm nhầm "Đăng nhập bằng mã" — trước đây im lặng không gửi gì nên khách chờ mãi)
    const user = db.get('SELECT id, first_name, status FROM users WHERE lower(email) = ?', [email]);
    if (!user) {
      const code = String(crypto.randomInt(100000, 1000000));
      db.run('UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0', [email]);
      db.run(`INSERT INTO login_codes (email, code_hash, expires_at)
              VALUES (?, ?, datetime('now','localtime','+${LOGIN_CODE_TTL_MIN} minutes'))`, [email, hashLoginCode(email, code)]);
      if (!resendClient) console.log(`[signup-code DEV — chưa cấu hình email] ${email}: ${code}`); // chỉ máy thử
      sendEmail({
        to: email,
        subject: `${code} là mã xác nhận tạo tài khoản ${communityName()}`,
        html: emailWrap('Mã xác nhận tạo tài khoản', `
          <p>Chào bạn,</p>
          <p>Bạn đang tạo tài khoản mới tại <strong>${communityName()}</strong>. Mã xác nhận của bạn là:</p>
          <p style="font-size:34px;font-weight:800;letter-spacing:8px;color:#0f766e;margin:18px 0;">${code}</p>
          <p>Nhập mã này trên trang đăng nhập, sau đó điền họ tên để hoàn tất. Mã có hiệu lực trong ${LOGIN_CODE_TTL_MIN} phút.</p>
          <p style="color:#94a3b8;font-size:13px;">Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
        `),
      }).catch(err => console.error('[signup-code email]', err.message));
      return res.json({ ok: true, ttl_minutes: LOGIN_CODE_TTL_MIN, is_new: true });
    }
    if (user.status === 'active') {
      const code = String(crypto.randomInt(100000, 1000000));
      db.run('UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0', [email]); // mã cũ hết hiệu lực
      db.run(`INSERT INTO login_codes (email, code_hash, expires_at)
              VALUES (?, ?, datetime('now','localtime','+${LOGIN_CODE_TTL_MIN} minutes'))`, [email, hashLoginCode(email, code)]);
      const name = String(user.first_name || '').replace(/[<>&"]/g, '');
      if (!resendClient) console.log(`[login-code DEV — chưa cấu hình email] ${email}: ${code}`); // chỉ máy thử
      sendEmail({
        to: email,
        subject: `${code} là mã đăng nhập ${communityName()}`,
        html: emailWrap('Mã đăng nhập của bạn', `
          <p>Chào ${name || 'bạn'},</p>
          <p>Mã đăng nhập ${communityName()} của bạn là:</p>
          <p style="font-size:34px;font-weight:800;letter-spacing:8px;color:#0f766e;margin:18px 0;">${code}</p>
          <p>Mã có hiệu lực trong ${LOGIN_CODE_TTL_MIN} phút và chỉ dùng được 1 lần.</p>
          <p style="color:#94a3b8;font-size:13px;">Nếu bạn không yêu cầu mã này, hãy bỏ qua email — tài khoản của bạn vẫn an toàn.</p>
        `),
      }).catch(err => console.error('[login-code email]', err.message));
    } else {
      // Vẫn ghi 1 dòng (đã dùng) để giới hạn tần suất áp dụng cả với email không có tài khoản
      db.run(`INSERT INTO login_codes (email, code_hash, expires_at, used) VALUES (?, '-', datetime('now','localtime'), 1)`, [email]);
    }
    res.json({ ok: true, ttl_minutes: LOGIN_CODE_TTL_MIN });
  });

  app.post('/api/auth/email-code/verify', (req, res) => {
    const email = normEmail(req.body?.email);
    const code = String(req.body?.code || '').replace(/\D/g, '');
    if (!email || code.length !== 6) return res.status(400).json({ error: 'Vui lòng nhập đủ 6 số của mã.' });
    const row = db.get(`SELECT * FROM login_codes WHERE email = ? AND used = 0 AND code_hash != '-'
                        AND expires_at > datetime('now','localtime') ORDER BY id DESC LIMIT 1`, [email]);
    if (!row) return res.status(400).json({ error: 'Mã đã hết hạn hoặc chưa được gửi. Vui lòng bấm "Gửi lại mã".' });
    if (row.attempts >= 5) {
      db.run('UPDATE login_codes SET used = 1 WHERE id = ?', [row.id]);
      return res.status(400).json({ error: 'Nhập sai quá nhiều lần. Vui lòng bấm "Gửi lại mã" để nhận mã mới.' });
    }
    const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(hashLoginCode(email, code), 'hex'));
    if (!ok) {
      db.run('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      const left = 4 - row.attempts;
      return res.status(400).json({ error: left > 0 ? `Mã không đúng. Bạn còn ${left} lần thử.` : 'Mã không đúng. Vui lòng bấm "Gửi lại mã".' });
    }
    db.run('UPDATE login_codes SET used = 1 WHERE id = ?', [row.id]);
    const user = db.get('SELECT * FROM users WHERE lower(email) = ?', [email]);
    if (!user) {
      // Email đã xác nhận nhưng chưa có tài khoản → cấp vé tạo tài khoản (30 phút, dùng 1 lần)
      const ticket = crypto.randomBytes(24).toString('hex');
      emailSignupTickets.set(ticket, { email, exp: Date.now() + 30 * 60e3 });
      return res.json({ need_signup: true, signup_token: ticket, email });
    }
    if (user.status !== 'active') return res.status(403).json({ error: 'Tài khoản này đã bị khoá.' });
    db.run("UPDATE users SET last_active_at = datetime('now','localtime') WHERE id = ?", [user.id]);
    applyCourseEmailGrants(user.id, user.email);
    res.json({
      success: true,
      user: { id: user.id, first_name: user.first_name, last_name: user.last_name,
              email: user.email, level: user.level, xp: user.xp, is_admin: !!user.is_admin,
              ttm_intake_done_at: user.ttm_intake_done_at || null,
              telegram_chat_id: user.telegram_chat_id || null,
              session_token: createUserSession(user.id) },
    });
  });

  // Tạo tài khoản bằng mã email (sau khi /verify trả need_signup): chỉ cần Họ + Tên; không có mật khẩu
  // (đăng nhập lại bằng mã email hoặc Google, hoặc tự đặt mật khẩu qua "Quên mật khẩu")
  const emailSignupTickets = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of emailSignupTickets) if (v.exp < now) emailSignupTickets.delete(k); }, 10 * 60e3).unref?.();
  app.post('/api/auth/email-code/register', (req, res) => {
    const b = req.body || {};
    const t = emailSignupTickets.get(String(b.signup_token || ''));
    if (!t || t.exp < Date.now()) return res.status(400).json({ error: 'Phiên tạo tài khoản đã hết hạn. Vui lòng gửi lại mã.' });
    const first = String(b.first_name || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    const last = String(b.last_name || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    if (!first || !last) return res.status(400).json({ error: 'Vui lòng nhập đủ Họ và Tên.' });
    let user = db.get('SELECT * FROM users WHERE lower(email) = ?', [t.email]);
    if (!user) {
      const r = db.run('INSERT INTO users (first_name, last_name, email, status, level, xp) VALUES (?,?,?,?,?,?)',
        [toTitleCase(first), toTitleCase(last), t.email, 'active', 1, 0]);
      addXP(r.lastInsertRowid, 10, 'register', 'Chào mừng thành viên mới');
      applyCourseEmailGrants(r.lastInsertRowid, t.email);
      user = db.get('SELECT * FROM users WHERE id = ?', [r.lastInsertRowid]);
      sendEmail({
        to: t.email,
        subject: `🎉 Chào mừng bạn đến với ${communityName()}!`,
        html: emailWrap('Chào mừng đến với cộng đồng!', `
          <p>Xin chào <strong>${String(user.first_name || '').replace(/[<>&"]/g, '')} ${String(user.last_name || '').replace(/[<>&"]/g, '')}</strong>,</p>
          <p>Bạn đã tạo tài khoản thành công tại <strong>${communityName()}</strong>.</p>
          <p>Lần sau bạn đăng nhập bằng nút <b>"Đăng nhập / Đăng ký bằng mã qua email"</b> với email này (hoặc nút Google nếu là Gmail).</p>
          <a class="btn" href="${SITE_URL}/feed.html">Vào Bảng Tin Ngay</a>
          <p>📖 Lần đầu sử dụng? Xem <a href="${SITE_URL}/huong-dan.html">Hướng dẫn sử dụng</a> (đăng nhập, cài ứng dụng lên điện thoại, bật thông báo, vào Zoom…).</p>
        `),
      }).catch(err => console.error('[signup welcome]', err.message));
    }
    emailSignupTickets.delete(String(b.signup_token));
    if (user.status !== 'active') return res.status(403).json({ error: 'Tài khoản này đã bị khoá.' });
    db.run("UPDATE users SET last_active_at = datetime('now','localtime') WHERE id = ?", [user.id]);
    res.status(201).json({
      success: true, created: true,
      user: { id: user.id, first_name: user.first_name, last_name: user.last_name,
              email: user.email, level: user.level, xp: user.xp, is_admin: !!user.is_admin,
              ttm_intake_done_at: user.ttm_intake_done_at || null,
              telegram_chat_id: user.telegram_chat_id || null,
              session_token: createUserSession(user.id) },
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
    const first_name = toTitleCase(given_name || (gUser.name || '').split(' ').pop() || 'Thành viên');
    const last_name  = toTitleCase(family_name || (gUser.name || '').split(' ').slice(0, -1).join(' ') || '');

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
          subject: `🎉 Chào mừng bạn đến với ${communityName()}!`,
          html: emailWrap('Chào mừng đến với cộng đồng!', `
            <p>Xin chào <strong>${first_name}</strong>,</p>
            <p>Bạn đã đăng ký thành công tài khoản tại <strong>${communityName()}</strong> qua Google.</p>
            <a class="btn" href="${SITE_URL}/feed.html">Vào Bảng Tin Ngay</a>
            <p>📖 Lần đầu sử dụng? Xem <a href="${SITE_URL}/huong-dan.html">Hướng dẫn sử dụng</a> (đăng nhập, cài ứng dụng lên điện thoại, bật thông báo, vào Zoom…).</p>
          `)
        });
      }
    }

    if (user.status === 'banned') return res.status(403).json({ error: 'Tài khoản đã bị khoá.' });

    db.run("UPDATE users SET last_active_at = datetime('now','localtime') WHERE id = ?", [user.id]);
    applyCourseEmailGrants(user.id, user.email);
    res.json({
      success: true,
      user: {
        id: user.id, first_name: user.first_name, last_name: user.last_name,
        email: user.email, level: user.level, xp: user.xp, is_admin: !!user.is_admin,
        avatar: user.avatar_url || picture,
        ttm_intake_done_at: user.ttm_intake_done_at || null,
        telegram_chat_id: user.telegram_chat_id || null,
        session_token: createUserSession(user.id),
      },
    });
  });

  // ── Phiên đăng nhập thành viên (dùng cho dữ liệu nhạy cảm: Hồ sơ y khoa) ──────────
  // Các API cũ vẫn tin user_id gửi lên; riêng API hồ sơ y khoa bắt buộc token thật. Token trả về
  // trong user.session_token khi đăng nhập/đăng ký, trình duyệt lưu kèm currentUser và gửi ở
  // header x-user-token. Chỉ lưu bản băm SHA-256, hạn 90 ngày; đổi mật khẩu → huỷ hết.
  const USER_SESSION_DAYS = 90;
  const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
  function createUserSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    db.run(`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now','localtime','+${USER_SESSION_DAYS} days'))`,
      [userId, hashToken(token)]);
    return token;
  }
  function userFromSession(req) {
    const token = String(req.headers['x-user-token'] || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db.get(
      `SELECT s.id AS sid, s.last_used_at, u.id, u.status, u.is_admin FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now','localtime')`, [hashToken(token)]);
    if (!row || row.status !== 'active') return null;
    if (!row.last_used_at || row.last_used_at < db.get("SELECT datetime('now','localtime','-1 hour') AS t").t)
      db.run("UPDATE user_sessions SET last_used_at = datetime('now','localtime') WHERE id = ?", [row.sid]);
    return row;
  }
  function requireUserSession(req, res, next) {
    const u = userFromSession(req);
    if (!u) return res.status(401).json({ error: 'Vì lý do bảo mật, vui lòng đăng nhập lại để mở Hồ sơ y khoa.', code: 'session_required' });
    req.userId = u.id;
    next();
  }
  setInterval(() => db.run("DELETE FROM user_sessions WHERE expires_at < datetime('now','localtime')"), 24 * 3600e3).unref?.();

  // Nhật ký truy cập Hồ sơ y khoa: ai xem / sửa hồ sơ của ai, lúc nào.
  function logHealthAccess(ownerUserId, actorUserId, actorRole, action, detail) {
    try {
      db.run('INSERT INTO health_record_access_log (owner_user_id, actor_user_id, actor_role, action, detail) VALUES (?,?,?,?,?)',
        [ownerUserId, actorUserId || null, actorRole, action, detail ? String(detail).slice(0, 300) : null]);
    } catch (e) { console.error('[Hồ sơ y khoa] ghi nhật ký:', e.message); }
  }

  // Đồng ý lưu & xử lý dữ liệu sức khoẻ (bắt buộc trước khi dùng Hồ sơ y khoa) + có cho AI đọc phiếu không
  app.get('/api/health-records/consent', requireUserSession, (req, res) => {
    const u = db.get('SELECT health_consent_at, health_ai_consent FROM users WHERE id = ?', [req.userId]);
    res.json({ consent_at: u?.health_consent_at || null, ai_consent: !!u?.health_ai_consent });
  });
  app.post('/api/health-records/consent', requireUserSession, (req, res) => {
    const { agree, ai_consent } = req.body || {};
    if (agree === false) {
      db.run('UPDATE users SET health_consent_at = NULL, health_ai_consent = 0 WHERE id = ?', [req.userId]);
      logHealthAccess(req.userId, req.userId, 'owner', 'consent_withdraw');
      return res.json({ ok: true, consent_at: null, ai_consent: false });
    }
    db.run("UPDATE users SET health_consent_at = COALESCE(health_consent_at, datetime('now','localtime')), health_ai_consent = ? WHERE id = ?",
      [ai_consent ? 1 : 0, req.userId]);
    logHealthAccess(req.userId, req.userId, 'owner', 'consent', ai_consent ? 'có cho AI đọc phiếu' : 'không cho AI đọc phiếu');
    const u = db.get('SELECT health_consent_at, health_ai_consent FROM users WHERE id = ?', [req.userId]);
    res.json({ ok: true, consent_at: u.health_consent_at, ai_consent: !!u.health_ai_consent });
  });
  // Khách xem ai đã truy cập hồ sơ của mình
  app.get('/api/health-records/access-log', requireUserSession, (req, res) => {
    const rows = db.all(
      `SELECT l.action, l.actor_role, l.detail, l.created_at, u.first_name, u.last_name
       FROM health_record_access_log l LEFT JOIN users u ON u.id = l.actor_user_id
       WHERE l.owner_user_id = ? ORDER BY l.id DESC LIMIT 100`, [req.userId]);
    res.json({ log: rows });
  });

  // ── Hồ sơ y khoa: lần khám, chỉ số xét nghiệm, chẩn đoán hình ảnh, phiếu đính kèm ──────────
  // Mã chỉ số chuẩn (dùng chung cho giao diện, AI đọc phiếu và bảng so sánh). Khoảng tham chiếu
  // KHÔNG cố định ở đây — lấy theo phiếu của từng nơi xét nghiệm.
  const HEALTH_TESTS = [
    // [code, tên, đơn vị thường gặp, nhóm, tên gọi khác]
    ['glucose', 'Glucose (đường huyết đói)', 'mmol/L', 'Đường huyết', 'GLU, Glucose máu, Đường huyết'],
    ['hba1c', 'HbA1c', '%', 'Đường huyết', 'Hemoglobin A1c'],
    ['cholesterol', 'Cholesterol toàn phần', 'mmol/L', 'Mỡ máu', 'CHOL, Total Cholesterol'],
    ['ldl', 'LDL-Cholesterol', 'mmol/L', 'Mỡ máu', 'LDL-C'],
    ['hdl', 'HDL-Cholesterol', 'mmol/L', 'Mỡ máu', 'HDL-C'],
    ['triglyceride', 'Triglyceride', 'mmol/L', 'Mỡ máu', 'TG, Triglycerid'],
    ['ast', 'AST (GOT)', 'U/L', 'Gan', 'SGOT, GOT'],
    ['alt', 'ALT (GPT)', 'U/L', 'Gan', 'SGPT, GPT'],
    ['ggt', 'GGT', 'U/L', 'Gan', 'Gamma GT'],
    ['bilirubin_total', 'Bilirubin toàn phần', 'µmol/L', 'Gan', 'Bil TP'],
    ['urea', 'Ure', 'mmol/L', 'Thận', 'Urea, BUN'],
    ['creatinine', 'Creatinine', 'µmol/L', 'Thận', 'Creatinin, CRE'],
    ['egfr', 'eGFR (mức lọc cầu thận)', 'mL/min/1.73m²', 'Thận', 'GFR'],
    ['uric_acid', 'Acid uric', 'µmol/L', 'Thận', 'Axit uric, UA'],
    ['rbc', 'Hồng cầu (RBC)', 'T/L', 'Công thức máu', 'RBC, Số lượng hồng cầu'],
    ['hgb', 'Huyết sắc tố (HGB)', 'g/L', 'Công thức máu', 'Hb, Hemoglobin'],
    ['hct', 'Hematocrit (HCT)', '%', 'Công thức máu', 'Hct'],
    ['wbc', 'Bạch cầu (WBC)', 'G/L', 'Công thức máu', 'WBC, Số lượng bạch cầu'],
    ['plt', 'Tiểu cầu (PLT)', 'G/L', 'Công thức máu', 'PLT, Số lượng tiểu cầu'],
    ['crp', 'CRP', 'mg/L', 'Viêm', 'hs-CRP, CRP định lượng'],
    ['tsh', 'TSH', 'mIU/L', 'Tuyến giáp', 'TSH'],
    ['ft4', 'FT4', 'pmol/L', 'Tuyến giáp', 'Free T4'],
    ['weight', 'Cân nặng', 'kg', 'Chỉ số cơ thể', ''],
    ['height', 'Chiều cao', 'cm', 'Chỉ số cơ thể', ''],
    ['bmi', 'BMI', 'kg/m²', 'Chỉ số cơ thể', 'Chỉ số khối cơ thể'],
    ['waist', 'Vòng eo', 'cm', 'Chỉ số cơ thể', ''],
    ['bp_sys', 'Huyết áp tâm thu', 'mmHg', 'Chỉ số cơ thể', 'Huyết áp tối đa'],
    ['bp_dia', 'Huyết áp tâm trương', 'mmHg', 'Chỉ số cơ thể', 'Huyết áp tối thiểu'],
    ['heart_rate', 'Nhịp tim', 'lần/phút', 'Chỉ số cơ thể', 'Mạch'],
  ].map(([code, name, unit, group, aliases]) => ({ code, name, unit, group, aliases }));
  const HEALTH_TEST_MAP = Object.fromEntries(HEALTH_TESTS.map(t => [t.code, t]));
  const HEALTH_IMAGING_KINDS = { sieu_am: 'Siêu âm', xquang: 'X-quang', ct: 'CT', mri: 'MRI', noi_soi: 'Nội soi', dien_tim: 'Điện tim', khac: 'Khác' };

  // Ai đang xem: chủ hồ sơ (token thành viên) hoặc admin (x-admin-key) — dùng cho xem file phiếu
  function healthViewer(req) {
    const u = userFromSession(req);
    if (u) return { role: u.is_admin ? 'admin' : 'owner', userId: u.id, isAdmin: !!u.is_admin };
    const key = req.headers['x-admin-key'];
    if (key && key === ADMIN_KEY) return { role: 'admin', userId: null, isAdmin: true };
    const s = key && adminSessionUser(key);
    if (s && s.is_admin && s.status === 'active') return { role: 'admin', userId: s.id, isAdmin: true };
    return null;
  }
  function requireHealthConsent(req, res, next) {
    const u = db.get('SELECT health_consent_at FROM users WHERE id = ?', [req.userId]);
    if (!u?.health_consent_at) return res.status(403).json({ error: 'Bạn cần đồng ý cho lưu dữ liệu sức khoẻ trước.', code: 'consent_required' });
    next();
  }
  const numOrNull = v => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const healthFlag = (num, lo, hi) => num === null || (lo === null && hi === null) ? null
    : (lo !== null && num < lo) ? 'low' : (hi !== null && num > hi) ? 'high' : 'normal';

  function healthVisitFull(visitId) {
    const v = db.get('SELECT * FROM health_visits WHERE id = ?', [visitId]);
    if (!v) return null;
    v.results = db.all('SELECT * FROM health_results WHERE visit_id = ? ORDER BY sort_order, id', [visitId]);
    v.imaging = db.all('SELECT * FROM health_imaging WHERE visit_id = ? ORDER BY sort_order, id', [visitId]);
    v.files = db.all('SELECT id, mime, original_name, size_bytes, kind, ai_status, created_at FROM health_files WHERE visit_id = ? ORDER BY id', [visitId]);
    return v;
  }
  // Lần khám của chính người đang đăng nhập (404 nếu của người khác)
  function ownVisit(req, res) {
    const v = db.get('SELECT * FROM health_visits WHERE id = ? AND user_id = ?', [Number(req.params.id), req.userId]);
    if (!v) { res.status(404).json({ error: 'Không tìm thấy lần khám.' }); return null; }
    return v;
  }
  const editable = v => ['draft', 'returned'].includes(v.status);
  const lockedMsg = { error: 'Lần khám đã gửi Ban tổ chức nên không sửa được nữa. Nếu cần sửa, nhắn Ban tổ chức trả lại.' };

  app.get('/api/health-records/tests', (_req, res) => res.json({ tests: HEALTH_TESTS, imaging_kinds: HEALTH_IMAGING_KINDS }));

  app.get('/api/health-records/visits', requireUserSession, requireHealthConsent, (req, res) => {
    const ids = db.all('SELECT id FROM health_visits WHERE user_id = ? ORDER BY visit_date DESC, id DESC', [req.userId]);
    res.json({ visits: ids.map(r => healthVisitFull(r.id)) });
  });

  app.post('/api/health-records/visits', requireUserSession, requireHealthConsent, (req, res) => {
    const { visit_date, place, title, note } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visit_date || '')) return res.status(400).json({ error: 'Vui lòng chọn ngày khám.' });
    const r = db.run('INSERT INTO health_visits (user_id, visit_date, place, title, note) VALUES (?,?,?,?,?)',
      [req.userId, visit_date, String(place || '').slice(0, 200), String(title || '').slice(0, 200), String(note || '').slice(0, 2000)]);
    logHealthAccess(req.userId, req.userId, 'owner', 'visit_create', `#${r.lastInsertRowid} ${visit_date}`);
    res.status(201).json({ visit: healthVisitFull(r.lastInsertRowid) });
  });

  // Lưu cả lần khám: thông tin + toàn bộ chỉ số + chẩn đoán hình ảnh (thay thế danh sách cũ)
  // Lưu thông tin + toàn bộ chỉ số + chẩn đoán hình ảnh của 1 lần khám (thay thế danh sách cũ).
  // Dùng chung cho khách (khi còn nháp / bị trả lại) và admin (khi kiểm tra). Trả về lỗi dạng chuỗi.
  function saveHealthVisitData(visitId, data) {
    const { visit_date, place, title, note, results, imaging } = data || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visit_date || '')) return 'Vui lòng chọn ngày khám.';
    db.run("UPDATE health_visits SET visit_date=?, place=?, title=?, note=?, updated_at=datetime('now','localtime') WHERE id=?",
      [visit_date, String(place || '').slice(0, 200), String(title || '').slice(0, 200), String(note || '').slice(0, 2000), visitId]);
    if (Array.isArray(results)) {
      db.run('DELETE FROM health_results WHERE visit_id = ?', [visitId]);
      results.slice(0, 120).forEach((r, i) => {
        const valueText = String(r.value ?? '').trim().slice(0, 60);
        if (!valueText) return;
        let code = String(r.test_code || '').trim();
        const known = HEALTH_TEST_MAP[code];
        const name = known ? known.name : String(r.test_name || '').trim().slice(0, 120);
        if (!known) { if (!name) return; code = 'custom:' + name.toLowerCase(); }
        const num = numOrNull(valueText), lo = numOrNull(r.ref_low), hi = numOrNull(r.ref_high);
        db.run(`INSERT INTO health_results (visit_id, test_code, test_name, value_text, value_num, unit, ref_low, ref_high, flag, source, sort_order)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [visitId, code, name, valueText, num, String(r.unit || (known && known.unit) || '').slice(0, 30), lo, hi,
           healthFlag(num, lo, hi), r.source === 'ai' ? 'ai' : 'manual', i]);
      });
    }
    if (Array.isArray(imaging)) {
      db.run('DELETE FROM health_imaging WHERE visit_id = ?', [visitId]);
      imaging.slice(0, 30).forEach((m, i) => {
        const findings = String(m.findings || '').trim().slice(0, 4000), conclusion = String(m.conclusion || '').trim().slice(0, 2000);
        if (!findings && !conclusion) return;
        db.run('INSERT INTO health_imaging (visit_id, kind, body_part, findings, conclusion, sort_order) VALUES (?,?,?,?,?,?)',
          [visitId, HEALTH_IMAGING_KINDS[m.kind] ? m.kind : 'khac', String(m.body_part || '').slice(0, 120), findings, conclusion, i]);
      });
    }
    return null;
  }

  app.put('/api/health-records/visits/:id', requireUserSession, requireHealthConsent, (req, res) => {
    const v = ownVisit(req, res); if (!v) return;
    if (!editable(v)) return res.status(409).json(lockedMsg);
    const err = saveHealthVisitData(v.id, req.body);
    if (err) return res.status(400).json({ error: err });
    logHealthAccess(req.userId, req.userId, 'owner', 'visit_update', `#${v.id}`);
    res.json({ visit: healthVisitFull(v.id) });
  });

  app.post('/api/health-records/visits/:id/submit', requireUserSession, requireHealthConsent, (req, res) => {
    const v = ownVisit(req, res); if (!v) return;
    if (!editable(v)) return res.status(409).json(lockedMsg);
    const full = healthVisitFull(v.id);
    if (!full.results.length && !full.imaging.length && !full.files.length)
      return res.status(400).json({ error: 'Lần khám chưa có chỉ số, kết quả hình ảnh hay phiếu nào.' });
    db.run("UPDATE health_visits SET status='submitted', submitted_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?", [v.id]);
    logHealthAccess(req.userId, req.userId, 'owner', 'visit_submit', `#${v.id}`);
    res.json({ visit: healthVisitFull(v.id) });
    // Báo admin qua An Tâm — chỉ tên + link, KHÔNG gửi chỉ số sức khoẻ qua Telegram
    const u = db.get('SELECT first_name, last_name FROM users WHERE id = ?', [req.userId]);
    antamNotify('health', v.id, `🩺 <b>Hồ sơ y khoa mới chờ kiểm tra</b>\nThành viên: <b>${antamEsc(`${u?.first_name || ''} ${u?.last_name || ''}`.trim() || 'Thành viên')}</b>\nNgày khám: ${antamEsc(v.visit_date.split('-').reverse().join('/'))}`, false,
      { linkButton: { text: '🩺 Mở để kiểm tra', url: `${SITE_URL}/admin.html` } }).catch(() => {});
  });

  app.delete('/api/health-records/visits/:id', requireUserSession, requireHealthConsent, async (req, res) => {
    const v = ownVisit(req, res); if (!v) return;
    if (!editable(v)) return res.status(409).json(lockedMsg);
    const files = db.all('SELECT drive_file_id FROM health_files WHERE visit_id = ?', [v.id]);
    ['health_results', 'health_imaging', 'health_files'].forEach(t => db.run(`DELETE FROM ${t} WHERE visit_id = ?`, [v.id]));
    db.run('DELETE FROM health_visits WHERE id = ?', [v.id]);
    logHealthAccess(req.userId, req.userId, 'owner', 'visit_delete', `#${v.id} ${v.visit_date}`);
    res.json({ ok: true });
    if (files.length) { try { const drive = getDriveClient(); for (const f of files) await drive.files.delete({ fileId: f.drive_file_id }).catch(() => {}); } catch {} }
  });

  // ── AI đọc phiếu: gửi ảnh/PDF phiếu của 1 lần khám cho AI, nhận lại GỢI Ý chỉ số + kết quả hình
  // ảnh dạng JSON. KHÔNG tự lưu — người nhập (khách hoặc admin) xem lại từng dòng rồi mới lưu.
  // Chỉ chạy khi khách đã đồng ý cho AI đọc phiếu. Giới hạn 20 lần/người/ngày.
  const healthAiUses = new Map();   // `${userId}:${ngày}` → số lần
  function healthAiQuotaOk(userId) {
    const key = `${userId}:${new Date().toISOString().slice(0, 10)}`;
    const n = healthAiUses.get(key) || 0;
    if (n >= 20) return false;
    healthAiUses.set(key, n + 1);
    if (healthAiUses.size > 500) healthAiUses.clear();
    return true;
  }
  // Tách khoảng tham chiếu dạng chữ trên phiếu: "3.7 - 7.7", "<45", "≤ 5.2", "≥1.55", "> 60", "0,6 – 1,3"
  function parseRefText(t) {
    const s = String(t || '').replace(/,/g, '.').trim();
    // dấu "-" ngay sau 1 chữ số là gạch nối khoảng ("1.005-1.030"), không phải số âm
    const nums = (s.match(/(?<![\d.])-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (/^(<|≤|=<|<=)/.test(s)) return { lo: null, hi: nums[0] ?? null };
    if (/^(>|≥|=>|>=)/.test(s)) return { lo: nums[0] ?? null, hi: null };
    if (nums.length >= 2 && /\d\s*[-–—~]\s*\d/.test(s)) return { lo: nums[0], hi: nums[1] };
    return { lo: null, hi: null };
  }
  // Gán mã danh mục theo tên trên phiếu khi AI để trống — chỉ khi khớp ĐÚNG 1 mã.
  const noAccent = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const HEALTH_TEST_KEYWORDS = Object.fromEntries(HEALTH_TESTS.map(t => [t.code,
    [t.name.replace(/\(.*?\)/g, ''), ...String(t.aliases || '').split(',')].map(k => noAccent(k).trim()).filter(k => k.length >= 2)]));
  function guessTestCode(name) {
    const n = ' ' + noAccent(name).replace(/[^a-z0-9]+/g, ' ') + ' ';
    if (/\b(non|receptor|trab|anti)\b/.test(n)) return '';   // Non-HDL, TSH Receptor (TRAb), Anti-TPO… không phải chỉ số gốc
    const hits = Object.entries(HEALTH_TEST_KEYWORDS).filter(([, kws]) =>
      kws.some(k => n.includes(' ' + k.replace(/[^a-z0-9]+/g, ' ').trim() + ' '))).map(([c]) => c);
    return hits.length === 1 ? hits[0] : '';
  }

  // Đọc TỪNG phiếu riêng (đọc nhiều trang một lúc dễ lẫn hàng / sai số), tối đa 3 phiếu song song.
  async function extractHealthVisit(visit) {
    const files = db.all('SELECT * FROM health_files WHERE visit_id = ? ORDER BY id LIMIT 12', [visit.id]);
    if (!files.length) throw new Error('Lần khám chưa có phiếu nào để AI đọc.');
    const drive = getDriveClient();
    const catalog = HEALTH_TESTS.map(t => `${t.code}: ${t.name}${t.aliases ? ' (' + t.aliases + ')' : ''}`).join('\n');
    const prompt = `Bạn là trợ lý nhập liệu y khoa. Đọc CHÍNH XÁC phiếu kết quả trong file đính kèm (xét nghiệm, siêu âm, X-quang, nội soi…). Ảnh có thể có hình mờ / dấu mộc / nét bút đè lên — bỏ qua, chỉ đọc chữ in.
Với bảng xét nghiệm: đọc TỪNG HÀNG từ trên xuống — tên chỉ số, kết quả, khoảng tham chiếu, đơn vị nằm trên CÙNG một hàng. Không đoán, không tự tính; số nào không chắc chắn thì BỎ hàng đó. Tên không đọc rõ thì để name_on_sheet rỗng (vẫn chép số nếu chắc chắn).
Trả về DUY NHẤT JSON, không giải thích, không markdown:
{"visit_date":"YYYY-MM-DD hoặc null","place":"tên bệnh viện/phòng khám hoặc null",
 "results":[{"name_on_sheet":"","value":"","unit":"","ref_text":"tham chiếu đúng như phiếu","test_code":""}],
 "imaging":[{"kind":"sieu_am|xquang|ct|mri|noi_soi|dien_tim|khac","body_part":"vùng/cơ quan","findings":"phần mô tả","conclusion":"phần kết luận"}]}
- "value": chép đúng số/chữ trên phiếu (VD 6.65, 4,2, Âm tính), bỏ chữ H/L đánh dấu cao/thấp.
- "test_code": mã trong danh mục nếu ĐÚNG chỉ số đó trong MÁU (Non-HDL KHÔNG phải ldl/hdl; HbA1c IFCC đơn vị mmol/mol vẫn là hba1c; đơn vị khác danh mục vẫn gán mã), ngược lại để rỗng.
- Xét nghiệm nước tiểu: test_code rỗng và name_on_sheet thêm tiền tố "Nước tiểu - " (VD "Nước tiểu - Glucose").
- Không có phần nào thì để mảng rỗng.
Danh mục mã:
${catalog}`;
    const readOne = async f => {
      const r = await drive.files.get({ fileId: f.drive_file_id, alt: 'media' }, { responseType: 'arraybuffer' });
      const b64 = Buffer.from(r.data).toString('base64');
      const part = f.mime === 'application/pdf'
        ? { type: 'file', file: { filename: `phieu-${f.id}.pdf`, file_data: `data:application/pdf;base64,${b64}` } }
        : { type: 'image_url', image_url: { url: `data:${f.mime || 'image/jpeg'};base64,${b64}` } };
      const ai = await callAiChat({ messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, part] }], maxTokens: 8000 });
      if (!ai.ok) throw new Error('AI chưa đọc được phiếu (' + (ai.error || 'lỗi') + '). Vui lòng thử lại sau.');
      const raw = String(ai.text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      db.run("UPDATE health_files SET ai_status = 'done', ai_raw_json = ? WHERE id = ?", [raw.slice(0, 50000), f.id]);
      try { return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
      catch { console.error('[Hồ sơ y khoa] AI trả JSON lỗi cho file', f.id); return { results: [], imaging: [] }; }
    };
    const pages = [];
    for (let k = 0; k < files.length; k += 3) pages.push(...await Promise.all(files.slice(k, k + 3).map(readOne)));

    const results = [], imaging = [];
    let visit_date = null, place = null;
    for (const d of pages) {
      if (!visit_date && /^\d{4}-\d{2}-\d{2}$/.test(d.visit_date || '')) visit_date = d.visit_date;
      if (!place && d.place) place = String(d.place).slice(0, 200);
      (Array.isArray(d.results) ? d.results : []).forEach(r => {
        const value = String(r.value ?? '').trim().replace(/\s*[HL]$/, '').slice(0, 60);
        if (!value || value === '?') return;
        const sheetName = String(r.name_on_sheet || '').trim();
        const nameOk = sheetName && !/^[\d.,\s?-]+$/.test(sheetName);
        let code = HEALTH_TEST_MAP[r.test_code] ? r.test_code : (nameOk ? guessTestCode(sheetName) : '');
        if (code && /\b(non|receptor|trab)\b/i.test(noAccent(sheetName))) code = '';
        // Danh mục toàn chỉ số đo bằng số — kết quả dạng chữ (VD "Negative" của tổng phân tích nước tiểu) không gán mã máu
        if (code && numOrNull(value) === null) code = '';
        const ref = parseRefText(r.ref_text);
        results.push({ test_code: code, test_name: code ? HEALTH_TEST_MAP[code].name : (nameOk ? sheetName.slice(0, 120) : '(chưa đọc rõ tên — điền giúp)'),
          name_on_sheet: sheetName.slice(0, 120), value, unit: String(r.unit || '').slice(0, 30), ref_text: String(r.ref_text || '').slice(0, 60),
          ref_low: ref.lo, ref_high: ref.hi, flag: healthFlag(numOrNull(value), ref.lo, ref.hi), source: 'ai' });
      });
      (Array.isArray(d.imaging) ? d.imaging : []).forEach(m => {
        const it = { kind: HEALTH_IMAGING_KINDS[m.kind] ? m.kind : 'khac', body_part: String(m.body_part || '').slice(0, 120),
          findings: String(m.findings || '').slice(0, 4000), conclusion: String(m.conclusion || '').slice(0, 2000) };
        if (it.findings || it.conclusion) imaging.push(it);
      });
    }
    return { visit_date, place, results: results.slice(0, 120), imaging: imaging.slice(0, 30), files_read: files.length };
  }
  function healthAiAllowed(userId) {
    return !!db.get('SELECT health_ai_consent FROM users WHERE id = ?', [userId])?.health_ai_consent;
  }
  app.post('/api/health-records/visits/:id/extract', requireUserSession, requireHealthConsent, async (req, res) => {
    const v = ownVisit(req, res); if (!v) return;
    if (!editable(v)) return res.status(409).json(lockedMsg);
    if (!healthAiAllowed(req.userId)) return res.status(403).json({ error: 'Bạn chưa đồng ý cho AI đọc phiếu.', code: 'ai_consent_required' });
    if (!healthAiQuotaOk(req.userId)) return res.status(429).json({ error: 'Hôm nay bạn đã dùng AI đọc phiếu 20 lần, vui lòng nhập tay hoặc thử lại ngày mai.' });
    try {
      const out = await extractHealthVisit(v);
      logHealthAccess(req.userId, req.userId, 'owner', 'ai_extract', `#${v.id} ${out.results.length} chỉ số`);
      res.json(out);
    } catch (e) { console.error('[Hồ sơ y khoa] AI đọc phiếu:', e.message); res.status(502).json({ error: e.message }); }
  });
  // Bật / tắt riêng quyền cho AI đọc phiếu (khi đã đồng ý lưu dữ liệu)
  app.post('/api/health-records/ai-consent', requireUserSession, requireHealthConsent, (req, res) => {
    const on = !!req.body?.ai_consent;
    db.run('UPDATE users SET health_ai_consent = ? WHERE id = ?', [on ? 1 : 0, req.userId]);
    logHealthAccess(req.userId, req.userId, 'owner', 'consent', on ? 'bật AI đọc phiếu' : 'tắt AI đọc phiếu');
    res.json({ ok: true, ai_consent: on });
  });

  // ── Admin: kiểm tra Hồ sơ y khoa (mọi lần admin mở / sửa / xác nhận đều ghi nhật ký) ──
  const HV_ADMIN_LIST_SQL = `SELECT v.*, u.first_name, u.last_name, u.email,
      (SELECT COUNT(*) FROM health_results r WHERE r.visit_id = v.id) AS n_results,
      (SELECT COUNT(*) FROM health_imaging m WHERE m.visit_id = v.id) AS n_imaging,
      (SELECT COUNT(*) FROM health_files f WHERE f.visit_id = v.id) AS n_files
    FROM health_visits v JOIN users u ON u.id = v.user_id`;
  app.get('/api/admin/health-records/visits', requireAdmin, (req, res) => {
    const st = String(req.query.status || 'submitted');
    const params = [];
    let where = ' WHERE 1=1';
    if (st !== 'all') { where += ' AND v.status = ?'; params.push(st); }
    else where += " AND v.status != 'draft'";   // nháp của khách: admin không xem
    if (req.query.user_id) { where += ' AND v.user_id = ?'; params.push(Number(req.query.user_id)); }
    const order = st === 'submitted' ? ' ORDER BY v.submitted_at ASC' : ' ORDER BY v.updated_at DESC';
    res.json({ visits: db.all(HV_ADMIN_LIST_SQL + where + order + ' LIMIT 200', params) });
  });
  // Lần khám của 1 thành viên (trang hồ sơ thành viên) — không gồm nháp
  app.get('/api/admin/health-records/user/:userId', requireAdmin, (req, res) => {
    res.json({ visits: db.all(HV_ADMIN_LIST_SQL + " WHERE v.user_id = ? AND v.status != 'draft' ORDER BY v.visit_date DESC", [Number(req.params.userId)]) });
  });
  function adminVisit(req, res) {
    const v = healthVisitFull(Number(req.params.id));
    if (!v || v.status === 'draft') { res.status(404).json({ error: 'Không tìm thấy lần khám.' }); return null; }
    return v;
  }
  app.get('/api/admin/health-records/visits/:id', requireAdmin, (req, res) => {
    const v = adminVisit(req, res); if (!v) return;
    v.user = db.get('SELECT id, first_name, last_name, email, phone FROM users WHERE id = ?', [v.user_id]);
    v.verifier = v.verified_by ? db.get('SELECT first_name, last_name FROM users WHERE id = ?', [v.verified_by]) : null;
    logHealthAccess(v.user_id, req.adminUserId, 'admin', 'visit_view', `#${v.id}`);
    res.json({ visit: v });
  });
  app.put('/api/admin/health-records/visits/:id', requireAdmin, (req, res) => {
    const v = adminVisit(req, res); if (!v) return;
    const err = saveHealthVisitData(v.id, req.body);
    if (err) return res.status(400).json({ error: err });
    logHealthAccess(v.user_id, req.adminUserId, 'admin', 'visit_admin_edit', `#${v.id}`);
    res.json({ visit: healthVisitFull(v.id) });
  });
  app.post('/api/admin/health-records/visits/:id/extract', requireAdmin, async (req, res) => {
    const v = adminVisit(req, res); if (!v) return;
    if (!healthAiAllowed(v.user_id)) return res.status(403).json({ error: 'Khách chưa đồng ý cho AI đọc phiếu — vui lòng nhập tay.' });
    if (!healthAiQuotaOk('admin')) return res.status(429).json({ error: 'Đã dùng AI đọc phiếu quá nhiều hôm nay.' });
    try {
      const out = await extractHealthVisit(v);
      logHealthAccess(v.user_id, req.adminUserId, 'admin', 'ai_extract', `#${v.id} ${out.results.length} chỉ số`);
      res.json(out);
    } catch (e) { console.error('[Hồ sơ y khoa] AI đọc phiếu (admin):', e.message); res.status(502).json({ error: e.message }); }
  });
  function notifyHealthOwner(userId, title, content) {
    db.run('INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)',
      [userId, 'course', title, content, 'lo-trinh.html?tab=medical']);
    pushNotify(userId, { title, body: content, link: 'lo-trinh.html?tab=medical' });
  }
  app.post('/api/admin/health-records/visits/:id/verify', requireAdmin, (req, res) => {
    const v = adminVisit(req, res); if (!v) return;
    db.run("UPDATE health_visits SET status='verified', admin_note=NULL, verified_by=?, verified_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?",
      [req.adminUserId || null, v.id]);
    logHealthAccess(v.user_id, req.adminUserId, 'admin', 'visit_verify', `#${v.id}`);
    notifyHealthOwner(v.user_id, 'Hồ sơ y khoa đã được xác nhận ✅',
      `Ban tổ chức đã kiểm tra và xác nhận lần khám ngày ${v.visit_date.split('-').reverse().join('/')}. Bấm để xem.`);
    res.json({ visit: healthVisitFull(v.id) });
  });
  app.post('/api/admin/health-records/visits/:id/return', requireAdmin, (req, res) => {
    const v = adminVisit(req, res); if (!v) return;
    const note = String(req.body?.note || '').trim().slice(0, 1000);
    if (!note) return res.status(400).json({ error: 'Vui lòng ghi lý do trả lại để khách biết cần sửa gì.' });
    db.run("UPDATE health_visits SET status='returned', admin_note=?, updated_at=datetime('now','localtime') WHERE id=?", [note, v.id]);
    logHealthAccess(v.user_id, req.adminUserId, 'admin', 'visit_return', `#${v.id}`);
    notifyHealthOwner(v.user_id, 'Hồ sơ y khoa cần bổ sung ↩️',
      `Ban tổ chức trả lại lần khám ngày ${v.visit_date.split('-').reverse().join('/')}: ${note}`);
    res.json({ visit: healthVisitFull(v.id) });
  });

  // Thư mục Drive của Hồ sơ y khoa phải RIÊNG TƯ: file trong thư mục thừa hưởng quyền chia sẻ của
  // thư mục, nên nếu thư mục bị chia sẻ "bất kỳ ai có link" thì mọi phiếu đều lộ. Kiểm tra trước mỗi
  // lần lưu (kết quả "riêng tư" nhớ 10 phút); công khai → từ chối lưu + báo admin qua An Tâm (≤ 1 lần/giờ).
  let healthFolderOkUntil = 0, healthFolderAlertAt = 0;
  async function checkHealthFolder(drive, folderId) {
    const p = await drive.permissions.list({ fileId: folderId, fields: 'permissions(type,role,emailAddress)' });
    const perms = p.data.permissions || [];
    const isPublic = perms.some(x => x.type === 'anyone' || x.type === 'domain');
    return { isPublic, shared: perms.filter(x => x.role !== 'owner').map(x => x.type === 'anyone' ? `Bất kỳ ai có link (${x.role})` : `${x.emailAddress || x.type} (${x.role})`) };
  }
  async function assertHealthFolderPrivate(drive, folderId) {
    if (Date.now() < healthFolderOkUntil) return;
    const st = await checkHealthFolder(drive, folderId);
    if (!st.isPublic) { healthFolderOkUntil = Date.now() + 10 * 60e3; return; }
    if (Date.now() - healthFolderAlertAt > 3600e3) {
      healthFolderAlertAt = Date.now();
      console.error('[Hồ sơ y khoa] THƯ MỤC DRIVE ĐANG CÔNG KHAI — đã chặn lưu phiếu');
      antamNotify('health_folder', 'folder', `🚨 <b>Hồ sơ y khoa: thư mục Drive đang bị chia sẻ công khai</b>\nĐã TẠM NGỪNG nhận phiếu xét nghiệm của khách để tránh lộ dữ liệu.\nVào Drive → thư mục "Hồ sơ y khoa" → Chia sẻ → Quyền truy cập chung: chọn <b>Bị hạn chế</b>.`, false,
        { linkButton: { text: '🗂️ Mở Admin → Google Drive', url: `${SITE_URL}/admin.html` } }).catch(() => {});
    }
    const e = new Error('Kho lưu hồ sơ đang tạm khoá để bảo vệ dữ liệu của bạn. Ban tổ chức đã được báo, vui lòng thử lại sau.');
    e.folderPublic = true;
    throw e;
  }
  app.get('/api/admin/health-records/folder-check', requireAdmin, async (_req, res) => {
    const folderId = (db.get("SELECT value FROM site_settings WHERE key = 'health_record_drive_folder_id'")?.value || '').trim();
    if (!folderId) return res.json({ configured: false });
    try {
      const st = await checkHealthFolder(getDriveClient(), folderId);
      if (!st.isPublic) healthFolderOkUntil = Date.now() + 10 * 60e3; else healthFolderOkUntil = 0;
      res.json({ configured: true, ...st });
    } catch (e) { res.json({ configured: true, error: e.message }); }
  });

  // Phiếu đính kèm: lưu Drive RIÊNG TƯ (không cấp quyền "anyone") — chỉ xem qua máy chủ
  const healthFileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = /^image\//.test(file.mimetype || '') || file.mimetype === 'application/pdf';
      cb(ok ? null : new Error('Chỉ nhận ảnh hoặc file PDF.'), ok);
    },
  });
  app.post('/api/health-records/visits/:id/files', requireUserSession, requireHealthConsent, (req, res) => {
    healthFileUpload.single('file')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File quá lớn (tối đa 15MB).' : err.message });
      const v = ownVisit(req, res); if (!v) return;
      if (!editable(v)) return res.status(409).json(lockedMsg);
      if (!req.file) return res.status(400).json({ error: 'Chưa chọn file.' });
      if (db.get('SELECT COUNT(*) AS n FROM health_files WHERE visit_id = ?', [v.id]).n >= 20)
        return res.status(400).json({ error: 'Mỗi lần khám tối đa 20 file.' });
      const folderId = (db.get("SELECT value FROM site_settings WHERE key = 'health_record_drive_folder_id'")?.value || '').trim();
      if (!folderId) return res.status(503).json({ error: 'Chưa cấu hình thư mục lưu hồ sơ y khoa.' });
      try {
        const drive = getDriveClient();
        await assertHealthFolderPrivate(drive, folderId);
        const ext = req.file.mimetype === 'application/pdf' ? '.pdf' : ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[req.file.mimetype] || '');
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const created = await drive.files.create({
          requestBody: { name: `hoso-u${req.userId}-v${v.id}-${stamp}${ext}`, parents: [folderId] },
          media: { mimeType: req.file.mimetype, body: require('stream').Readable.from(req.file.buffer) },
          fields: 'id',
        });
        const kind = ['xet_nghiem', 'hinh_anh', 'khac'].includes(req.body.kind) ? req.body.kind : 'xet_nghiem';
        const r = db.run('INSERT INTO health_files (visit_id, drive_file_id, mime, original_name, size_bytes, kind) VALUES (?,?,?,?,?,?)',
          [v.id, created.data.id, req.file.mimetype, String(req.file.originalname || '').slice(0, 200), req.file.size, kind]);
        logHealthAccess(req.userId, req.userId, 'owner', 'file_upload', `#${v.id} file ${r.lastInsertRowid}`);
        res.status(201).json({ visit: healthVisitFull(v.id) });
      } catch (e) {
        if (e.folderPublic) return res.status(503).json({ error: e.message });
        console.error('[Hồ sơ y khoa] tải file lên Drive:', e.message);
        res.status(502).json({ error: 'Lưu file thất bại: ' + e.message });
      }
    });
  });

  app.delete('/api/health-records/files/:fileId', requireUserSession, requireHealthConsent, async (req, res) => {
    const f = db.get(`SELECT f.*, v.user_id, v.status FROM health_files f JOIN health_visits v ON v.id = f.visit_id WHERE f.id = ?`, [Number(req.params.fileId)]);
    if (!f || f.user_id !== req.userId) return res.status(404).json({ error: 'Không tìm thấy file.' });
    if (!editable(f)) return res.status(409).json(lockedMsg);
    db.run('DELETE FROM health_files WHERE id = ?', [f.id]);
    logHealthAccess(req.userId, req.userId, 'owner', 'file_delete', `#${f.visit_id} file ${f.id}`);
    res.json({ visit: healthVisitFull(f.visit_id) });
    try { await getDriveClient().files.delete({ fileId: f.drive_file_id }); } catch {}
  });

  // Xem file phiếu: chủ hồ sơ (x-user-token) hoặc admin (x-admin-key). Lấy từ Drive rồi trả về.
  app.get('/api/health-records/file/:fileId', async (req, res) => {
    const viewer = healthViewer(req);
    if (!viewer) return res.status(401).json({ error: 'Vui lòng đăng nhập lại.', code: 'session_required' });
    const f = db.get(`SELECT f.*, v.user_id FROM health_files f JOIN health_visits v ON v.id = f.visit_id WHERE f.id = ?`, [Number(req.params.fileId)]);
    if (!f || (!viewer.isAdmin && f.user_id !== viewer.userId)) return res.status(404).json({ error: 'Không tìm thấy file.' });
    if (viewer.isAdmin && f.user_id !== viewer.userId) logHealthAccess(f.user_id, viewer.userId, 'admin', 'file_view', `#${f.visit_id} file ${f.id}`);
    try {
      const r = await getDriveClient().files.get({ fileId: f.drive_file_id, alt: 'media' }, { responseType: 'stream' });
      res.setHeader('Content-Type', f.mime || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      r.data.on('error', () => res.end()).pipe(res);
    } catch (e) {
      console.error('[Hồ sơ y khoa] đọc file Drive:', e.message);
      res.status(502).json({ error: 'Không tải được file.' });
    }
  });

  // Kiểm tra phiên đăng nhập lưu ở trình duyệt còn hợp lệ không (app.js gọi mỗi lần mở trang):
  // tài khoản đã bị xoá / bị khoá → buộc đăng nhập lại. (users.id AUTOINCREMENT nên id không bị dùng lại.)
  // Kèm trạng thái Nội quy: rules_pending = true → app.js hiện popup bắt xác nhận.
  app.post('/api/auth/session-check', (req, res) => {
    const { user_id } = req.body || {};
    const user = Number(user_id) ? db.get('SELECT status, rules_accepted_version, first_name, last_name, email, phone FROM users WHERE id = ?', [Number(user_id)]) : null;
    const valid = !!user && user.status !== 'banned';
    const version = currentRulesVersion();
    // Thông tin bắt buộc còn thiếu (chỉ trả tên trường, không trả giá trị)
    const missing = !valid ? [] : [
      !String(user.first_name || '').trim() && 'first_name', !String(user.last_name || '').trim() && 'last_name',
      !String(user.email || '').trim() && 'email', !validPhone(user.phone) && 'phone',
    ].filter(Boolean);
    res.json({ valid, rules_version: version, rules_pending: valid && rulesContentSet() && (Number(user.rules_accepted_version) || 0) < version, profile_missing: missing });
  });

  // ── Nội quy cộng đồng ──────────────────────────────────────────────
  function currentRulesVersion() {
    return Number(db.get("SELECT value FROM site_settings WHERE key = 'rules_version'")?.value) || 1;
  }
  function rulesContentSet() {
    return !!(db.get("SELECT value FROM site_settings WHERE key = 'rules_content'")?.value || '').trim();
  }

  app.post('/api/rules/accept', (req, res) => {
    const userId = Number(req.body?.user_id);
    if (!userId || !db.get('SELECT id FROM users WHERE id = ?', [userId])) return res.status(404).json({ error: 'Tài khoản không tồn tại.' });
    db.run("UPDATE users SET rules_accepted_version = ?, rules_accepted_at = datetime('now','localtime') WHERE id = ?",
      [currentRulesVersion(), userId]);
    res.json({ ok: true });
  });

  // Admin: ai đã đồng ý phiên bản nội quy hiện tại
  app.get('/api/admin/rules/acceptances', requireAdmin, (_req, res) => {
    const version = currentRulesVersion();
    const members = db.all(`SELECT id, first_name, last_name, email, rules_accepted_version, rules_accepted_at
      FROM users ORDER BY (rules_accepted_version >= ?) DESC, rules_accepted_at DESC, id DESC`, [version]);
    const accepted = members.filter(m => (Number(m.rules_accepted_version) || 0) >= version).length;
    res.json({ version, accepted, total: members.length, members });
  });

  // Admin: yêu cầu mọi thành viên xác nhận lại (tăng phiên bản)
  app.post('/api/admin/rules/bump', requireAdmin, (_req, res) => {
    const next = currentRulesVersion() + 1;
    db.run("INSERT INTO site_settings (key, value) VALUES ('rules_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(next)]);
    res.json({ ok: true, version: next });
  });

  // Forgot password — generate reset token
  app.post('/api/auth/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Vui lòng nhập email.' });
    // Bắt đầu từ trang admin → link trong email đưa về luồng đăng nhập admin, không phải trang thành viên
    const fromAdmin = req.body.from === 'admin';

    const user = db.get('SELECT id, email, first_name FROM users WHERE email = ?', [email]);
    // Always return success to avoid email enumeration
    if (!user) return res.json({ success: true });

    // Invalidate old tokens for this user
    db.run('UPDATE reset_tokens SET used = 1 WHERE user_id = ?', [user.id]);

    // Generate a random 32-char hex token
    const token = crypto.randomBytes(16).toString('hex');
    const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.run('INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?,?,?)',
      [user.id, token, expires_at]);

    const resetLink = `${SITE_URL}/reset-password.html?token=${token}${fromAdmin ? '&from=admin' : ''}`;
    sendEmail({
      to: user.email,
      subject: `🔑 Đặt lại mật khẩu — ${communityName()}`,
      html: emailWrap('Đặt lại mật khẩu', `
        <p>Xin chào <strong>${user.first_name}</strong>,</p>
        <p>Có yêu cầu đặt lại mật khẩu cho tài khoản này. Bấm nút bên dưới để đặt mật khẩu mới (link có hiệu lực trong 1 giờ):</p>
        <a class="btn" href="${resetLink}">Đặt lại mật khẩu</a>
        <p>Nếu bạn không yêu cầu điều này, hãy bỏ qua email — mật khẩu hiện tại của bạn vẫn an toàn.</p>
      `)
    });

    // No RESEND_API_KEY configured (local dev) — fall back to returning the token directly
    // instead of silently failing, since there's no way to deliver the email.
    if (!resendClient)
      return res.json({ success: true, dev_token: token, dev_hint: `Dùng token này tại /reset-password.html?token=${token}` });

    res.json({ success: true });
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
    db.run('DELETE FROM user_sessions WHERE user_id = ?', [row.user_id]);   // đổi mật khẩu → đăng xuất mọi máy
    db.run('UPDATE reset_tokens SET used = 1 WHERE id = ?', [row.id]);

    res.json({ success: true });
  });

  // ══════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ══════════════════════════════════════════════════════════

  app.post('/api/admin/verify', (req, res) => {
    res.json({ ok: req.body.key === ADMIN_KEY });
  });

  // Admin login for community admins (is_admin=1): step 1 = email + password.
  // On success, emails a 6-digit OTP; the client then calls verify-otp (step 2)
  // to finish and receive a short-lived admin_sessions token. Replaces the old
  // PIN 2nd factor — separate from /api/auth/login since this gates destructive
  // back-office actions.
  const adminLoginAttempts = new Map(); // email -> { count, resetAt }
  const adminOtpStore = new Map(); // email -> { hash, expiresAt, userId, attempts }

  app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Vui lòng nhập đủ email và mật khẩu.' });

    const attempt = adminLoginAttempts.get(email);
    if (attempt && attempt.count >= 5 && Date.now() < attempt.resetAt)
      return res.status(429).json({ error: 'Sai quá nhiều lần. Vui lòng thử lại sau ít phút.' });

    const fail = (msg) => {
      const a = adminLoginAttempts.get(email) || { count: 0, resetAt: 0 };
      a.count += 1;
      a.resetAt = Date.now() + 15 * 60 * 1000;
      adminLoginAttempts.set(email, a);
      return res.status(401).json({ error: msg });
    };

    const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !(user.is_admin || user.agent1_reviewer)) return fail('Email hoặc mật khẩu không đúng.');
    if (user.status !== 'active') return res.status(403).json({ error: 'Tài khoản đã bị khoá.' });
    if (!user.password_hash)
      return fail('Tài khoản này đăng nhập bằng Google, chưa có mật khẩu. Hãy đặt mật khẩu qua "Quên mật khẩu" trước.');
    if (!bcrypt.compareSync(password, user.password_hash)) return fail('Email hoặc mật khẩu không đúng.');

    adminLoginAttempts.delete(email);

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const hash = bcrypt.hashSync(otp, 10);
    adminOtpStore.set(email, { hash, expiresAt: Date.now() + 10 * 60 * 1000, userId: user.id, attempts: 0 });

    await sendEmail({
      to: user.email,
      subject: `🔐 Mã đăng nhập admin — ${communityName()}`,
      html: emailWrap('Mã đăng nhập admin', `
        <p>Xin chào <strong>${user.first_name}</strong>,</p>
        <p>Mã xác thực để đăng nhập admin.html của bạn là:</p>
        <p style="font-size:32px;font-weight:800;letter-spacing:6px;text-align:center;margin:20px 0;">${otp}</p>
        <p>Mã có hiệu lực trong 10 phút. Nếu không phải bạn yêu cầu đăng nhập, hãy bỏ qua email này.</p>
      `)
    });

    const payload = { success: true, otp_required: true };
    // No RESEND_API_KEY configured (local dev) — return the OTP directly so
    // testing doesn't require a real inbox, matching the forgot-password dev fallback.
    if (!resendClient) payload.dev_otp = otp;
    res.json(payload);
  });

  // Admin login step 2 — verify the emailed OTP and issue the session token.
  app.post('/api/admin/login/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Vui lòng nhập mã OTP.' });

    const entry = adminOtpStore.get(email);
    if (!entry) return res.status(401).json({ error: 'Vui lòng đăng nhập lại để nhận mã mới.' });
    if (Date.now() > entry.expiresAt) {
      adminOtpStore.delete(email);
      return res.status(401).json({ error: 'Mã OTP đã hết hạn. Vui lòng đăng nhập lại.' });
    }
    if (entry.attempts >= 5) {
      adminOtpStore.delete(email);
      return res.status(429).json({ error: 'Sai quá nhiều lần. Vui lòng đăng nhập lại.' });
    }
    if (!bcrypt.compareSync(otp, entry.hash)) {
      entry.attempts += 1;
      return res.status(401).json({ error: 'Mã OTP không đúng.' });
    }

    adminOtpStore.delete(email);
    const user = db.get('SELECT id, first_name, last_name, email, is_admin, agent1_reviewer, status FROM users WHERE id = ?', [entry.userId]);
    if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại.' });
    if (user.status !== 'active' || !(user.is_admin || user.agent1_reviewer)) return res.status(403).json({ error: 'Tài khoản không còn quyền truy cập.' });
    const role = user.is_admin ? 'admin' : 'reviewer';
    delete user.is_admin; delete user.agent1_reviewer; delete user.status;

    db.run("DELETE FROM admin_sessions WHERE expires_at < datetime('now','localtime')");
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    db.run('INSERT INTO admin_sessions (user_id, token, expires_at) VALUES (?,?,?)', [user.id, token, expiresAt]);

    res.json({ success: true, token, user, role });
  });

  // Vai trò của phiên đăng nhập admin.html hiện tại: 'admin' (toàn quyền) hoặc 'reviewer' (chỉ duyệt lộ trình)
  app.get('/api/admin/me', requireRoadmapReviewer, (req, res) => {
    res.json({ role: req.adminRole, user_id: req.adminUserId });
  });

  // Logout — invalidate the current session token (no-op for the master ADMIN_KEY)
  app.post('/api/admin/logout', requireRoadmapReviewer, (req, res) => {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY) db.run('DELETE FROM admin_sessions WHERE token = ?', [key]);
    res.json({ success: true });
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
  // ── Danh sách tổng hợp (Admin): cộng đồng, 3 buổi, 8 buổi, 377 ngày, từng khoá học, tư vấn 1-1, từng sản phẩm, lead ──
  // Mỗi danh sách trả về { title, note?, columns: [{ key, label }], rows: [{ user_id?, ... }] }
  const ROSTER_USER_COLS = `u.id AS user_id, TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS name,
    u.email, u.phone, u.location`;
  const ROSTER_BASE = [{ key: 'name', label: 'Họ tên' }, { key: 'phone', label: 'Điện thoại' }, { key: 'email', label: 'Email' }];
  function rosterW3Ids() {
    const get = k => db.get('SELECT value FROM site_settings WHERE key = ?', [k])?.value || '';
    const sid = Number((get('workshop3_space_url').match(/[?&]id=(\d+)/) || [])[1]) || 6;
    const cid = Number((get('workshop3_course_url').match(/[?&]id=(\d+)/) || [])[1]) || 10;
    return { sid, cid };
  }
  function rosterLists() {
    const n = sql => { try { return db.get(sql).n; } catch { return 0; } };
    const { sid, cid } = rosterW3Ids();
    const lists = [
      { key: 'community', group: 'Cộng đồng', label: '👥 Thành viên cộng đồng', count: n('SELECT COUNT(*) AS n FROM users') },
      ...Object.entries(LEAD_MAGNETS).map(([k, m]) => ({ key: 'magnet:' + k, group: 'Cộng đồng', label: m.label,
        count: n(`SELECT COUNT(*) AS n FROM lead_magnet_signups WHERE magnet = '${k}'`) })),
    ];
    db.all(`SELECT c.id, c.title, (SELECT COUNT(*) FROM challenge_enrollments e WHERE e.challenge_id = c.id AND e.user_id IN (SELECT id FROM users)) AS n
            FROM challenges c WHERE c.status <> 'draft' ORDER BY c.id DESC`)
      .forEach(c => lists.push({ key: 'challenge:' + c.id, group: 'Thử thách', label: '🎯 ' + c.title, count: c.n }));
    lists.push({ key: 'zoom:all', group: 'Điểm danh Zoom', label: '📹 Tổng hợp mọi buổi Zoom', count: n('SELECT COUNT(DISTINCT phone) AS n FROM zoom_checkins') });
    try {
      db.all(`SELECT session_key, MAX(session_title) AS title, MAX(session_date) AS d, COUNT(DISTINCT phone) AS n
              FROM zoom_checkins GROUP BY session_key ORDER BY MAX(created_at) DESC LIMIT 60`)
        .forEach(z => lists.push({ key: 'zoom:' + z.session_key, group: 'Điểm danh Zoom',
          label: `📅 ${String(z.d || '').split('-').reverse().slice(0, 2).join('/')} · ${z.title || 'Zoom'}`, count: z.n }));
    } catch (e) { /* bảng chưa có */ }
    db.all(`SELECT c.id, c.title, (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.user_id IN (SELECT id FROM users)) AS n
            FROM courses c ORDER BY c.order_num ASC, c.id ASC`)
      .forEach(c => lists.push({ key: 'course:' + c.id, group: 'Khoá học', label: '📚 ' + c.title, count: c.n }));
    db.all(`SELECT p.id, p.title, (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id) AS n
            FROM products p ORDER BY p.id DESC`)
      .forEach(p => lists.push({ key: 'product:' + p.id, group: 'Sản phẩm', label: '🛍️ ' + p.title, count: p.n }));
    return lists;
  }
  function rosterData(key) {
    if (key === 'community') {
      return {
        title: 'Thành viên cộng đồng',
        columns: [...ROSTER_BASE, { key: 'location', label: 'Nơi ở' }, { key: 'status', label: 'Trạng thái' },
          { key: 'joined', label: 'Ngày tham gia' }, { key: 'last_active', label: 'Hoạt động gần nhất' },
          { key: 'challenges', label: 'Thử thách' }, { key: 'ai_intake', label: 'Hồ sơ AI Agent' }],
        rows: db.all(`SELECT ${ROSTER_USER_COLS}, u.status, u.created_at AS joined, u.last_active_at AS last_active,
            (SELECT status FROM workshop8_enrollments w WHERE w.user_id = u.id) AS w8,
            (SELECT status FROM program377_enrollments p WHERE p.user_id = u.id) AS p377,
            (SELECT the_trang FROM ttm_roadmaps r WHERE r.user_id = u.id AND r.the_trang IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS the_trang,
            CASE WHEN u.intake_done_at IS NOT NULL THEN 'Đã làm' ELSE '' END AS ai_intake,
            (SELECT GROUP_CONCAT(c.title, ' · ') FROM challenge_enrollments e JOIN challenges c ON c.id = e.challenge_id
              WHERE e.user_id = u.id AND e.status IN ('approved','started')) AS challenges
          FROM users u ORDER BY u.created_at DESC`),
      };
    }
    if (key.startsWith('magnet:') && LEAD_MAGNETS[key.slice(7)]) {
      const mk = key.slice(7), m = LEAD_MAGNETS[mk];
      return {
        title: m.label.replace(/^\S+\s/, ''),
        note: `Người để lại thông tin trên trang ${m.page} để nhận quà (chưa chắc đã có tài khoản). "Đã có tài khoản" = trùng email hoặc số điện thoại với một thành viên.`,
        columns: [{ key: 'name', label: 'Họ tên' }, { key: 'phone', label: 'Điện thoại' }, { key: 'email', label: 'Email' },
          { key: 'source', label: 'Nguồn' }, { key: 'member', label: 'Đã có tài khoản' }, { key: 'created_at', label: 'Ngày đăng ký' }],
        rows: db.all(`SELECT l.name, l.phone, l.email, l.source, l.created_at,
            COALESCE(l.user_id, (SELECT u.id FROM users u WHERE LOWER(u.email) = l.email LIMIT 1)) AS user_id
          FROM lead_magnet_signups l WHERE l.magnet = ? ORDER BY l.id DESC`, [mk]).map(r => ({ ...r, member: r.user_id ? 'Có' : '' })),
      };
    }
    if (key === 'leads') {
      return {
        title: 'Lead Kiểm tra Hàn–Nhiệt',
        note: 'Người làm bài kiểm tra nhanh trên trang kiem-tra-han-nhiet.html (chưa chắc đã có tài khoản). "Đã có tài khoản" = trùng số điện thoại với một thành viên.',
        columns: [{ key: 'name', label: 'Họ tên' }, { key: 'phone', label: 'Điện thoại' }, { key: 'result_type', label: 'Kết quả' },
          { key: 'score', label: 'Hàn / Nhiệt' }, { key: 'member', label: 'Đã có tài khoản' }, { key: 'created_at', label: 'Ngày làm bài' }],
        rows: db.all(`SELECT q.name, q.phone, q.result_type, q.han_count, q.nhiet_count, q.created_at,
            (SELECT u.id FROM users u WHERE u.phone IS NOT NULL AND u.phone <> '' AND REPLACE(REPLACE(u.phone,' ',''),'.','') = REPLACE(REPLACE(q.phone,' ',''),'.','') LIMIT 1) AS user_id
          FROM han_nhiet_quiz_results q ORDER BY q.id DESC`).map(r => ({
          ...r, score: `${r.han_count || 0} / ${r.nhiet_count || 0}`, member: r.user_id ? 'Có' : '',
        })),
      };
    }
    if (key === 'w3') {
      const { sid, cid } = rosterW3Ids();
      return {
        title: 'Workshop 3 buổi',
        note: 'Chưa có bước đăng ký riêng cho 3 buổi — danh sách tạm lấy theo thành viên nhóm thảo luận 3 buổi và người vào khoá tổng hợp video 3 buổi.',
        columns: [...ROSTER_BASE, { key: 'location', label: 'Nơi ở' }, { key: 'source', label: 'Nguồn' },
          { key: 'joined', label: 'Ngày vào' }, { key: 'next', label: 'Đã lên' }],
        rows: db.all(`SELECT ${ROSTER_USER_COLS},
            (SELECT created_at FROM space_members m WHERE m.space_id = ${sid} AND m.user_id = u.id AND m.status = 'approved') AS in_space,
            (SELECT created_at FROM course_enrollments ce WHERE ce.course_id = ${cid} AND ce.user_id = u.id AND ce.status = 'approved') AS in_course,
            (SELECT status FROM workshop8_enrollments w WHERE w.user_id = u.id) AS w8,
            (SELECT status FROM program377_enrollments p WHERE p.user_id = u.id) AS p377
          FROM users u WHERE u.id IN (
            SELECT user_id FROM space_members WHERE space_id = ${sid} AND status = 'approved'
            UNION SELECT user_id FROM course_enrollments WHERE course_id = ${cid} AND status = 'approved')
          ORDER BY u.created_at DESC`).map(r => ({
          ...r,
          source: [r.in_space && 'Nhóm thảo luận', r.in_course && 'Khoá video'].filter(Boolean).join(' + '),
          joined: [r.in_space, r.in_course].filter(Boolean).sort()[0] || '',
          next: [r.w8 && `8 buổi: ${r.w8}`, r.p377 && `377 ngày: ${r.p377}`].filter(Boolean).join(' · '),
        })),
      };
    }
    if (key === 'w8') {
      return {
        title: '8 Buổi Chuyên Sâu',
        columns: [...ROSTER_BASE, { key: 'status', label: 'Trạng thái' }, { key: 'enrolled_at', label: 'Ngày đăng ký' },
          { key: 'approved_at', label: 'Ngày duyệt' }, { key: 'p377', label: '377 ngày' }, { key: 'admin_note', label: 'Ghi chú' }],
        rows: db.all(`SELECT ${ROSTER_USER_COLS}, e.status, e.enrolled_at, e.approved_at, e.admin_note,
            (SELECT status FROM program377_enrollments p WHERE p.user_id = u.id) AS p377
          FROM workshop8_enrollments e JOIN users u ON u.id = e.user_id ORDER BY e.enrolled_at DESC`),
      };
    }
    if (key === 'p377') {
      return {
        title: '377 Ngày Thực Hành',
        columns: [...ROSTER_BASE, { key: 'status', label: 'Trạng thái' }, { key: 'enrolled_at', label: 'Ngày đăng ký' },
          { key: 'start_date', label: 'Ngày bắt đầu' }, { key: 'day', label: 'Đang ở ngày' }, { key: 'reports', label: 'Số báo cáo' },
          { key: 'last_report', label: 'Báo cáo gần nhất' }, { key: 'admin_note', label: 'Ghi chú' }],
        rows: db.all(`SELECT ${ROSTER_USER_COLS}, e.status, e.enrolled_at, e.start_date, e.admin_note,
            (SELECT COUNT(*) FROM program377_reports r WHERE r.user_id = u.id) AS reports,
            (SELECT MAX(report_date) FROM program377_reports r WHERE r.user_id = u.id) AS last_report
          FROM program377_enrollments e JOIN users u ON u.id = e.user_id ORDER BY e.enrolled_at DESC`).map(r => ({
          ...r, day: r.status === 'approved' && r.start_date ? `${Math.min(program377DayNumberToday(r.start_date), 377)}/377` : '',
        })),
      };
    }
    if (key === 'coaching') {
      return {
        title: 'Đặt lịch tư vấn 1-1',
        columns: [...ROSTER_BASE, { key: 'status', label: 'Trạng thái' }, { key: 'wanted', label: 'Khách muốn hẹn' },
          { key: 'confirmed', label: 'Lịch đã chốt' }, { key: 'note', label: 'Khách ghi chú' }, { key: 'admin_note', label: 'Ghi chú BTC' },
          { key: 'created_at', label: 'Ngày đặt' }],
        rows: db.all(`SELECT ${ROSTER_USER_COLS}, b.status, b.preferred_date, b.preferred_time, b.confirmed_date, b.confirmed_time,
            b.note, b.admin_note, b.created_at
          FROM coaching_bookings b JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC`).map(r => ({
          ...r,
          wanted: [r.preferred_date, r.preferred_time].filter(Boolean).join(' '),
          confirmed: [r.confirmed_date, r.confirmed_time].filter(Boolean).join(' '),
        })),
      };
    }
    const zm = key.match(/^zoom:(.+)$/);
    if (zm) {
      const note = `Khách vào Zoom qua link điểm danh: ${SITE_URL}/zoom — thêm ?src=zalo / ?src=messenger / ?src=congdong để biết khách đến từ đâu. `
        + 'Mỗi người tính 1 lần theo số điện thoại. "Giờ vào" = lần bấm đầu tiên.';
      const SRC = { zalo: 'Zalo', messenger: 'Messenger', congdong: 'Cộng đồng', khac: 'Khác' };
      const CARE = { new: 'Chưa liên hệ', messaged: 'Đã nhắn', called: 'Đã gọi', booked: 'Đặt lịch 1-1', bought: 'Đã mua', not_bought: 'Chưa mua' };
      const careOf = phone => db.get('SELECT status, owner, note, reason, opt_out FROM zoom_care WHERE phone = ?', [phone]) || {};
      // Đã là học viên → ghi rõ, không xếp Nóng/Ấm/Lạnh. Đang chờ duyệt 8 buổi / 377, đặt lịch, đã mua → Nóng.
      const heat = zcHeat;
      const tidy = r => { const c = careOf(r.phone); return { ...r, member: r.user_id ? 'Thành viên' : 'Khách mới',
        care: CARE[c.status] || 'Chưa liên hệ', care_status: c.status || 'new', heat: heat(r, c), owner: c.owner || '',
        care_note: [c.status === 'not_bought' && c.reason ? 'Lý do: ' + c.reason : '', c.note || '', c.opt_out ? '⛔ Không nhận email' : ''].filter(Boolean).join(' · '),
        reason: c.reason || '', note: c.note || '', opt_out: c.opt_out ? 1 : 0,
        source: r.source ? String(r.source).split(',').map(x => SRC[x] || x).join(', ') : r.source,
        programs: [r.w8 && `8 buổi: ${r.w8}`, r.p377 && `377 ngày: ${r.p377}`].filter(Boolean).join(' · ') }; };
      const CARE_COLS = [{ key: 'heat', label: 'Mức độ' }, { key: 'care', label: 'Chăm sóc' }, { key: 'owner', label: 'Phụ trách' }, { key: 'care_note', label: 'Ghi chú' }];
      if (zm[1] === 'all') {
        return {
          title: 'Điểm danh Zoom — tổng hợp mọi buổi', note, care: 'all',
          columns: [...ROSTER_BASE, ...CARE_COLS, { key: 'sessions', label: 'Số buổi đã vào' }, { key: 'titles', label: 'Các buổi' },
            { key: 'first', label: 'Lần đầu' }, { key: 'last', label: 'Lần gần nhất' }, { key: 'member', label: 'Thành viên?' }, { key: 'programs', label: 'Chương trình' }],
          rows: db.all(`SELECT g.*,
              (SELECT status FROM workshop8_enrollments w WHERE w.user_id = g.user_id) AS w8,
              (SELECT status FROM program377_enrollments p WHERE p.user_id = g.user_id) AS p377
            FROM (SELECT z.phone, MAX(z.name) AS name, MAX(z.email) AS email, MAX(z.user_id) AS user_id,
              COUNT(DISTINCT z.session_key) AS sessions, MIN(z.created_at) AS first, MAX(z.created_at) AS last,
              GROUP_CONCAT(DISTINCT substr(z.session_date, 9, 2) || '/' || substr(z.session_date, 6, 2) || ' ' || z.session_title) AS titles
              FROM zoom_checkins z GROUP BY z.phone) g ORDER BY g.last DESC`).map(r => ({ ...tidy(r), titles: String(r.titles || '').split(',').join(' · ') })),
        };
      }
      const head = db.get('SELECT MAX(session_title) AS t, MAX(session_date) AS d, MAX(session_time) AS tm FROM zoom_checkins WHERE session_key = ?', [zm[1]]);
      if (!head?.t) return null;
      return {
        title: `Zoom ${String(head.d).split('-').reverse().join('/')}${head.tm ? ' ' + head.tm : ''} — ${head.t}`, note, care: zm[1],
        columns: [...ROSTER_BASE, ...CARE_COLS, { key: 'first', label: 'Giờ vào' }, { key: 'source', label: 'Nguồn' }, { key: 'member', label: 'Thành viên?' },
          { key: 'sessions', label: 'Tổng số buổi đã vào' }, { key: 'programs', label: 'Chương trình' }],
        rows: db.all(`SELECT g.*,
            (SELECT COUNT(DISTINCT x.session_key) FROM zoom_checkins x WHERE x.phone = g.phone) AS sessions,
            (SELECT status FROM workshop8_enrollments w WHERE w.user_id = g.user_id) AS w8,
            (SELECT status FROM program377_enrollments p WHERE p.user_id = g.user_id) AS p377
          FROM (SELECT z.phone, MAX(z.name) AS name, MAX(z.email) AS email, MAX(z.user_id) AS user_id, MIN(z.created_at) AS first,
            GROUP_CONCAT(DISTINCT z.source) AS source
            FROM zoom_checkins z WHERE z.session_key = ? GROUP BY z.phone) g ORDER BY g.first ASC`, [zm[1]]).map(tidy),
      };
    }
    let m = key.match(/^challenge:([0-9]+)$/);
    if (m) {
      const c = db.get('SELECT id, title FROM challenges WHERE id = ?', [Number(m[1])]);
      if (!c) return null;
      const totalDays = db.get('SELECT COUNT(*) AS n FROM challenge_days WHERE challenge_id = ?', [c.id]).n;
      return {
        title: 'Thử thách: ' + c.title,
        columns: [...ROSTER_BASE, { key: 'status', label: 'Trạng thái' }, { key: 'enrolled_at', label: 'Ngày đăng ký' },
          { key: 'progress', label: 'Ngày đã duyệt' }, { key: 'pending', label: 'Bài chờ chấm' }, { key: 'late', label: 'Nộp trễ' }],
        rows: db.all(`SELECT ${ROSTER_USER_COLS}, e.status, e.enrolled_at,
            (SELECT COUNT(*) FROM challenge_submissions s WHERE s.user_id = u.id AND s.challenge_id = e.challenge_id AND s.status = 'approved') AS approved,
            (SELECT COUNT(*) FROM challenge_submissions s WHERE s.user_id = u.id AND s.challenge_id = e.challenge_id AND s.status = 'pending') AS pending,
            (SELECT COUNT(*) FROM challenge_submissions s WHERE s.user_id = u.id AND s.challenge_id = e.challenge_id AND s.is_late = 1) AS late
          FROM challenge_enrollments e JOIN users u ON u.id = e.user_id WHERE e.challenge_id = ? ORDER BY e.enrolled_at DESC`, [c.id])
          .map(r => ({ ...r, progress: `${r.approved}/${totalDays}` })),
      };
    }
    m = key.match(/^course:(\d+)$/);
    if (m) {
      const c = db.get('SELECT id, title, visibility FROM courses WHERE id = ?', [Number(m[1])]);
      if (!c) return null;
      return {
        title: 'Khoá học: ' + c.title,
        columns: [...ROSTER_BASE, { key: 'status', label: 'Trạng thái' }, { key: 'created_at', label: 'Ngày vào / xin vào' },
          { key: 'exercises', label: 'Bài tập đã nộp' }],
        rows: db.all(`SELECT ${ROSTER_USER_COLS}, ce.status, ce.created_at,
            (SELECT COUNT(*) FROM lesson_exercise_submissions s WHERE s.user_id = u.id AND s.course_id = ce.course_id) AS exercises
          FROM course_enrollments ce JOIN users u ON u.id = ce.user_id WHERE ce.course_id = ? ORDER BY ce.created_at DESC`, [c.id]),
      };
    }
    m = key.match(/^product:(\d+)$/);
    if (m) {
      const p = db.get('SELECT id, title FROM products WHERE id = ?', [Number(m[1])]);
      if (!p) return null;
      return {
        title: 'Sản phẩm: ' + p.title,
        columns: [...ROSTER_BASE, { key: 'order_id', label: 'Mã đơn' }, { key: 'amount', label: 'Số tiền' },
          { key: 'status', label: 'Trạng thái' }, { key: 'payment_method', label: 'Thanh toán' }, { key: 'note', label: 'Ghi chú' },
          { key: 'created_at', label: 'Ngày đặt' }],
        rows: db.all(`SELECT ${ROSTER_USER_COLS}, o.id AS order_id, o.amount, o.status, o.payment_method, o.note, o.created_at
          FROM orders o LEFT JOIN users u ON u.id = o.buyer_id WHERE o.product_id = ? ORDER BY o.created_at DESC`, [p.id]),
      };
    }
    return null;
  }
  app.get('/api/admin/rosters', requireAdmin, (_req, res) => res.json({ lists: rosterLists() }));
  app.get('/api/admin/rosters/:key', requireAdmin, (req, res) => {
    try {
      const d = rosterData(String(req.params.key));
      if (!d) return res.status(404).json({ error: 'Không tìm thấy danh sách.' });
      res.json(d);
    } catch (e) {
      console.error('[rosters]', e.message);
      res.status(500).json({ error: 'Lỗi tải danh sách: ' + e.message });
    }
  });

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const { search = '', status = '', limit = 50, offset = 0 } = req.query;
    const like = `%${search}%`;

    // Kèm thông tin hồ sơ để admin nhìn nhanh ngay trong danh sách (khảo sát, 8 buổi, 377 ngày)
    let sql = `SELECT id, first_name, last_name, email, phone, level, xp, streak,
                      status, is_admin, last_active_at, created_at, ttm_intake_done_at,
                      agent2_alert_recipient, agent1_reviewer, COALESCE(agent2_notify_off, 0) AS agent2_notify_off, COALESCE(antam_recipient, 0) AS antam_recipient, (CASE WHEN antam_chat_id IS NOT NULL AND antam_chat_id != '' THEN 1 ELSE 0 END) AS antam_linked,
                      (CASE WHEN telegram_chat_id IS NOT NULL AND telegram_chat_id != '' THEN 1 ELSE 0 END) AS telegram_linked,
                      (SELECT status FROM workshop8_enrollments w WHERE w.user_id = users.id) AS w8_status,
                      (SELECT status FROM program377_enrollments p WHERE p.user_id = users.id) AS p377_status,
                      intake_done_at,
                      (SELECT COUNT(*) FROM challenge_enrollments ce WHERE ce.user_id = users.id AND ce.status IN ('approved','started')) AS challenge_count
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

  // Bật/tắt quyền "Xem & duyệt lộ trình An Lộ" — vào admin.html nhưng chỉ thấy trang duyệt lộ trình
  app.patch('/api/admin/users/:id/roadmap-reviewer', requireAdmin, (req, res) => {
    const on = req.body.enabled ? 1 : 0;
    if (!db.get('SELECT id FROM users WHERE id = ?', [req.params.id])) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });
    db.run('UPDATE users SET agent1_reviewer = ? WHERE id = ?', [on, req.params.id]);
    // Gỡ quyền → đăng xuất ngay khỏi admin.html (trừ khi người đó vẫn là admin)
    if (!on && !db.get('SELECT is_admin FROM users WHERE id = ?', [req.params.id])?.is_admin)
      db.run('DELETE FROM admin_sessions WHERE user_id = ?', [req.params.id]);
    res.json({ success: true, enabled: !!on });
  });

  // Bật/tắt nhận tin Telegram "An Lộ soạn xong lộ trình" (admin hoặc người duyệt) — không đổi quyền
  app.patch('/api/admin/users/:id/roadmap-notify', requireAdmin, (req, res) => {
    if (!db.get('SELECT id FROM users WHERE id = ?', [req.params.id])) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });
    db.run('UPDATE users SET agent1_notify_off = ? WHERE id = ?', [req.body.enabled ? 0 : 1, req.params.id]);
    res.json({ success: true, enabled: !!req.body.enabled });
  });

  // Admin bật/tắt nhận tin cảnh báo An Nhiên của riêng mình/admin khác (không đổi quyền admin)
  app.patch('/api/admin/users/:id/alert-notify', requireAdmin, (req, res) => {
    if (!db.get('SELECT id FROM users WHERE id = ?', [req.params.id])) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });
    db.run('UPDATE users SET agent2_notify_off = ? WHERE id = ?', [req.body.enabled ? 0 : 1, req.params.id]);
    res.json({ success: true, enabled: !!req.body.enabled });
  });

  // Bật/tắt "Nhận cảnh báo An Nhiên" (Telegram) cho 1 thành viên — không cấp quyền admin
  app.patch('/api/admin/users/:id/alert-recipient', requireAdmin, (req, res) => {
    const on = req.body.enabled ? 1 : 0;
    if (!db.get('SELECT id FROM users WHERE id = ?', [req.params.id])) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });
    db.run('UPDATE users SET agent2_alert_recipient = ? WHERE id = ?', [on, req.params.id]);
    res.json({ success: true, enabled: !!on });
  });

  app.patch('/api/admin/users/:id/admin', requireAdmin, (req, res) => {
    const isAdmin = req.body.is_admin ? 1 : 0;
    db.run('UPDATE users SET is_admin = ? WHERE id = ?', [isAdmin, req.params.id]);
    if (!isAdmin) db.run('DELETE FROM admin_sessions WHERE user_id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Delete user
  // Xoá các yêu cầu / quyền / phiên còn sót lại của tài khoản đã bị xoá (không thì "Việc cần xử lý"
  // đếm mãi các yêu cầu chờ duyệt không có chủ). Giữ nguyên bài đăng, báo cáo, hồ sơ.
  const ORPHAN_USER_TABLES = ['program377_enrollments', 'workshop8_enrollments', 'course_enrollments', 'challenge_enrollments',
    'ttm_roadmaps', 'coaching_bookings', 'space_members', 'notifications', 'push_subscriptions', 'user_sessions', 'task_help'];
  function cleanupOrphanUserRows() {
    let n = 0;
    for (const t of ORPHAN_USER_TABLES) {
      try {
        if (!db.all(`PRAGMA table_info(${t})`).some(c => c.name === 'user_id')) continue;
        const c = db.get(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id NOT IN (SELECT id FROM users)`).n;
        if (c) { db.run(`DELETE FROM ${t} WHERE user_id NOT IN (SELECT id FROM users)`); n += c; }
      } catch (e) { /* bảng chưa có */ }
    }
    return n;
  }
  // AI AGENTS CC: không tự xoá dữ liệu cũ lúc khởi động — đặt CLEANUP_ORPHANS_ON_START=1 nếu muốn dọn
  if (process.env.CLEANUP_ORPHANS_ON_START === '1') { const n = cleanupOrphanUserRows(); if (n) console.log(`  Dọn ${n} dòng còn sót của tài khoản đã xoá.`); }

  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    cleanupOrphanUserRows();
    res.json({ success: true });
  });

  // List posts
  app.get('/api/admin/posts', requireAdmin, (req, res) => {
    const { search = '', pillar = '', limit = 50, offset = 0, sort = 'new' } = req.query;
    const like = `%${search}%`;

    let sql = `SELECT p.id, p.title, p.content, p.pillar, p.post_type, p.likes_count, p.comments_count,
                      p.is_pinned, p.created_at, p.updated_at, p.hidden, p.space_id,
                      p.image_url, p.video_url, p.doc_url, p.gif_url,
                      COALESCE((SELECT SUM(views) FROM post_views v WHERE v.post_id = p.id), 0) AS views,
                      (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id) AS viewers,
                      (SELECT COUNT(*) FROM saved_posts s WHERE s.post_id = p.id) AS saves,
                      u.id AS author_id, u.first_name || ' ' || u.last_name AS author_name, u.email AS author_email
               FROM posts p JOIN users u ON u.id = p.user_id
               WHERE (p.title LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`;
    const params = [like, like, like];
    if (pillar) { sql += ' AND p.pillar = ?'; params.push(pillar); }
    const ORDER = { new: 'p.created_at DESC', views: 'views DESC, p.created_at DESC', saves: 'saves DESC, p.created_at DESC',
      likes: 'p.likes_count DESC, p.created_at DESC', comments: 'p.comments_count DESC, p.created_at DESC',
      score: '(p.likes_count + 2 * p.comments_count + 3 * saves) DESC, views DESC' };
    sql += ` ORDER BY ${ORDER[sort] || ORDER.new} LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    res.json({ posts: db.all(sql, params) });
  });

  // ── Tổng quan hiệu quả bài đăng (Admin → Bài đăng) ──
  // Điểm tương tác = thích + 2×bình luận + 3×lưu (lưu và bình luận thể hiện bài có giá trị hơn 1 cái thích).
  function postInsights(days) {
    const since = tbAddDays(tbToday(), -(days - 1));
    const rows = db.all(`SELECT p.id, p.title, p.content, p.created_at, p.likes_count AS likes, p.comments_count AS comments,
        p.image_url, p.video_url, p.doc_url, p.poll_question, p.pillar,
        sp.name AS space_name, t.name AS topic_name, u.first_name || ' ' || u.last_name AS author,
        COALESCE((SELECT SUM(views) FROM post_views v WHERE v.post_id = p.id), 0) AS views,
        (SELECT COUNT(*) FROM post_views v WHERE v.post_id = p.id) AS viewers,
        (SELECT COUNT(*) FROM saved_posts s WHERE s.post_id = p.id) AS saves
      FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN spaces sp ON sp.id = p.space_id LEFT JOIN topics t ON t.id = p.topic_id
      WHERE COALESCE(p.hidden, 0) = 0 AND substr(p.created_at, 1, 10) >= ?`, [since]);
    const active = db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n || 1;
    rows.forEach(r => {
      r.score = r.likes + 2 * r.comments + 3 * r.saves;
      r.reach = Math.round(r.viewers / active * 100);
      r.format = r.video_url ? 'Có video' : r.poll_question ? 'Bình chọn' : r.image_url ? 'Có ảnh' : r.doc_url ? 'Có tài liệu' : 'Chỉ chữ';
      const h = +String(r.created_at).slice(11, 13);
      r.slot = h < 11 ? 'Sáng (trước 11h)' : h < 14 ? 'Trưa (11h–14h)' : h < 18 ? 'Chiều (14h–18h)' : 'Tối (sau 18h)';
      r.weekday = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][new Date(String(r.created_at).slice(0, 10) + 'T00:00:00Z').getUTCDay()];
      r.label = (String(r.title || '').trim() || String(r.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 90);
    });
    const sum = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const group = key => {
      const m = {};
      rows.forEach(r => { const g = r[key] || '(không có)'; (m[g] = m[g] || []).push(r); });
      return Object.entries(m).map(([name, list]) => ({
        name, posts: list.length,
        avg_views: Math.round(list.reduce((s, r) => s + r.views, 0) / list.length * 10) / 10,
        avg_score: Math.round(list.reduce((s, r) => s + r.score, 0) / list.length * 10) / 10,
        saves: list.reduce((s, r) => s + r.saves, 0),
      })).sort((a, b) => b.avg_score - a.avg_score || b.avg_views - a.avg_views);
    };
    const pick = r => ({ id: r.id, label: r.label, author: r.author, space: r.space_name || 'Feed', created_at: r.created_at,
      views: r.views, viewers: r.viewers, likes: r.likes, comments: r.comments, saves: r.saves, score: r.score, reach: r.reach });
    const top = [...rows].sort((a, b) => b.score - a.score || b.views - a.views).slice(0, 5).map(pick);
    // Nhiều người xem nhưng ít tương tác → tiêu đề hút nhưng nội dung chưa giữ chân / chưa có lời kêu gọi
    const leaky = rows.filter(r => r.viewers >= 5 && r.score <= 1).sort((a, b) => b.viewers - a.viewers).slice(0, 3).map(pick);
    const by = { space: group('space_name'), topic: group('topic_name'), format: group('format'), slot: group('slot'), weekday: group('weekday') };
    const tips = [];
    const best = (list, min = 2) => list.filter(g => g.posts >= min && g.name !== '(không có)')[0];
    const avgScore = rows.length ? sum('score') / rows.length : 0;
    const bs = best(by.space); if (bs && bs.avg_score > avgScore) tips.push(`Bài trong "${bs.name}" được tương tác tốt nhất (trung bình ${bs.avg_score} điểm/bài) — nên đăng thêm vào đây.`);
    const bt = best(by.topic); if (bt && bt.avg_score > avgScore) tips.push(`Chủ đề "${bt.name}" hiệu quả nhất (${bt.avg_score} điểm/bài, ${bt.saves} lượt lưu) — làm thành chuỗi bài nhiều kỳ.`);
    const bf = best(by.format); const tf = by.format.find(g => g.name === 'Chỉ chữ');
    if (bf && bf.name !== 'Chỉ chữ') tips.push(`Bài "${bf.name.toLowerCase()}" tương tác cao hơn${tf ? ` bài chỉ chữ (${bf.avg_score} so với ${tf.avg_score} điểm)` : ''} — luôn kèm ảnh món ăn / video ngắn.`);
    const bsl = best(by.slot); if (bsl && bsl.avg_score > avgScore) tips.push(`Đăng vào buổi ${bsl.name.split(' (')[0].toLowerCase()} đạt hiệu quả tốt nhất — ưu tiên khung giờ này cho bài quan trọng.`);
    const bw = best(by.weekday); if (bw && bw.avg_score > avgScore) tips.push(`${bw.name} là ngày đăng có tương tác tốt nhất.`);
    const saveTop = [...rows].sort((a, b) => b.saves - a.saves)[0];
    if (saveTop && saveTop.saves >= 2) tips.push(`Bài được lưu nhiều nhất: "${saveTop.label.slice(0, 60)}" (${saveTop.saves} lượt) — nội dung dạng hướng dẫn / công thức được giữ lại xem sau, nên làm thêm bài cùng kiểu.`);
    if (leaky.length) tips.push(`Có ${leaky.length} bài nhiều người xem nhưng gần như không ai tương tác — thêm câu hỏi cuối bài để mời mọi người bình luận.`);
    if (rows.length && sum('comments') / rows.length < 1) tips.push('Trung bình chưa tới 1 bình luận/bài — kết bài bằng 1 câu hỏi cụ thể (VD: "Nhà bạn hay ăn món này vào bữa nào?") và gắn tên (@) vài thành viên.');
    const viewsSince = db.get('SELECT MIN(first_at) AS d FROM post_views')?.d || null;
    return {
      days, since, views_since: viewsSince, active_members: active,
      totals: { posts: rows.length, views: sum('views'), viewers: sum('viewers'), likes: sum('likes'), comments: sum('comments'), saves: sum('saves'),
        avg_score: rows.length ? Math.round(avgScore * 10) / 10 : 0,
        avg_reach: rows.length ? Math.round(rows.reduce((s, r) => s + r.reach, 0) / rows.length) : 0 },
      top, leaky, by, tips,
      _rows: rows,
    };
  }
  app.get('/api/admin/posts/insights', requireAdmin, (req, res) => {
    const days = [7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 30;
    const { _rows, ...out } = postInsights(days);
    res.json(out);
  });
  // AI đề nghị chủ đề bài viết mới dựa trên bài hiệu quả / kém hiệu quả của cộng đồng
  app.post('/api/admin/posts/insights/ai', requireAdmin, async (req, res) => {
    const days = [7, 30, 90, 365].includes(+req.body?.days) ? +req.body.days : 30;
    const ins = postInsights(days);
    if (ins._rows.length < 3) return res.status(400).json({ error: 'Cần ít nhất 3 bài trong kỳ để AI phân tích. Hãy chọn kỳ dài hơn.' });
    const line = r => `- "${r.label}" | ${r.space_name || 'Feed'}${r.topic_name ? ' / ' + r.topic_name : ''} | ${r.format} | xem ${r.views}, thích ${r.likes}, bình luận ${r.comments}, lưu ${r.saves}`;
    const sorted = [...ins._rows].sort((a, b) => b.score - a.score || b.views - a.views);
    const prompt = `Bạn là chuyên gia nội dung cho cộng đồng học AI Agent "${communityName()}" (prompt engineering, automation n8n / Make, xây và deploy AI Agent, thử thách 21 ngày, sản phẩm số).
Dưới đây là số liệu bài đăng ${days} ngày qua (điểm tương tác = thích + 2×bình luận + 3×lưu).

BÀI HIỆU QUẢ NHẤT:
${sorted.slice(0, 10).map(line).join('\n')}

BÀI KÉM HIỆU QUẢ NHẤT:
${sorted.slice(-5).reverse().map(line).join('\n')}

Hãy trả lời bằng tiếng Việt, ngắn gọn, dễ hiểu cho người không chuyên:
1. **Điều đang hiệu quả** (2–3 gạch đầu dòng: chủ đề, dạng bài, cách viết nào được thích / lưu / bình luận).
2. **8 chủ đề bài viết nên đăng tiếp** — mỗi chủ đề 1 dòng: tiêu đề gợi ý + dạng bài (ảnh / video / bình chọn / hướng dẫn) + câu hỏi kết bài để mời bình luận.
3. **2 lưu ý tránh** (điều làm bài kém hiệu quả).
Không bịa số liệu ngoài dữ liệu trên. Không đưa lời khuyên y khoa thay bác sĩ.`;
    const r = await callAiChat({ messages: [{ role: 'user', content: prompt }], maxTokens: 2500 });
    if (!r.ok) return res.status(502).json({ error: r.error || 'AI chưa trả lời được, thử lại sau.' });
    res.json({ ok: true, text: r.text });
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
    notifyNewPost(result.lastInsertRowid, uid, null, title, content);
  });

  // Admin sửa nội dung / ẩn - hiện bài đăng
  app.patch('/api/admin/posts/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    const post = db.get('SELECT id FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng.' });
    if (b.hidden !== undefined) {
      db.run('UPDATE posts SET hidden = ? WHERE id = ?', [b.hidden ? 1 : 0, post.id]);
    }
    const hasContentFields = ['title', 'content', 'image_url', 'gif_url', 'video_url', 'doc_url'].some(k => b[k] !== undefined);
    if (hasContentFields) {
      const err = updatePostFields(post.id, b);
      if (err) return res.status(400).json({ error: err });
    }
    res.json({ success: true });
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




  // ══════════════════════════════════════════════════════════
  // PUBLIC CONTENT ROUTES
  // ══════════════════════════════════════════════════════════

  // Attach poll tallies + the requesting user's vote to a batch of posts (mutates in place)
  // Lượt thích theo từng người: 1 dòng / (bài, người). Bấm lần 2 = bỏ thích. posts.likes_count vẫn là tổng
  // (gồm cả lượt thích cũ trước khi có bảng này — không biết ai thích nên không bỏ được).
  db.exec(`CREATE TABLE IF NOT EXISTS post_likes (
    post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')), PRIMARY KEY (post_id, user_id)
  )`);
  function attachLiked(posts, userId) {
    if (!posts.length) return;
    const liked = userId
      ? new Set(db.all(`SELECT post_id FROM post_likes WHERE user_id = ? AND post_id IN (${posts.map(() => '?').join(',')})`,
          [Number(userId), ...posts.map(p => p.id)]).map(r => r.post_id))
      : new Set();
    posts.forEach(p => { p.liked = liked.has(p.id); });
  }
  function attachPollData(posts, userId) {
    const pollPosts = posts.filter(p => p.poll_options);
    if (!pollPosts.length) return;
    const ids = pollPosts.map(p => p.id);
    const placeholders = ids.map(() => '?').join(',');
    const voteRows = db.all(`SELECT post_id, option_index, COUNT(*) AS n FROM poll_votes WHERE post_id IN (${placeholders}) GROUP BY post_id, option_index`, ids);
    const myVoteRows = userId
      ? db.all(`SELECT post_id, option_index FROM poll_votes WHERE user_id = ? AND post_id IN (${placeholders})`, [userId, ...ids])
      : [];
    pollPosts.forEach(p => {
      let options = [];
      try { options = JSON.parse(p.poll_options) || []; } catch { options = []; }
      const tallies = options.map((_, i) => voteRows.filter(v => v.post_id === p.id && v.option_index === i).reduce((n, v) => n + v.n, 0));
      p.poll_options = options;
      p.poll_tallies = tallies;
      p.poll_total = tallies.reduce((a, b) => a + b, 0);
      const mine = myVoteRows.find(v => v.post_id === p.id);
      p.my_vote = mine ? mine.option_index : null;
    });
  }

  // Feed
  app.get('/api/feed', (req, res) => {
    const { limit = 20, offset = 0, pillar = '', type = '', sort = '', space_id = '', user_id = '' } = req.query;
    let sql = `
      SELECT p.id, p.title, p.content, p.pillar, p.post_type, p.space_id,
             p.topic_id, p.image_url, p.video_url, p.doc_url, p.gif_url, p.poll_question, p.poll_options,
             p.likes_count, p.comments_count, p.is_pinned, p.created_at,
             u.id AS author_id, u.first_name, u.last_name, u.level,
             t.name AS topic_name, t.icon AS topic_icon
      FROM posts p JOIN users u ON u.id = p.user_id
      LEFT JOIN topics t ON t.id = p.topic_id
      WHERE COALESCE(p.hidden, 0) = 0`;
    const params = [];
    if (pillar) { sql += ' AND p.pillar = ?'; params.push(pillar); }
    if (type)   { sql += ' AND p.post_type = ?'; params.push(type); }
    if (space_id) {
      const space = db.get('SELECT * FROM spaces WHERE id = ?', [space_id]);
      if (space) {
        const { isAdmin } = getUserFlags(user_id);
        if (!canViewContent(space, user_id, isAdmin)) return res.json({ posts: [], total: 0 });
      }
      sql += ' AND p.space_id = ?'; params.push(space_id);
    } else {
      // Aggregate feed: hide posts from spaces the user isn't an approved member of (private/secret)
      const { isAdmin } = getUserFlags(user_id);
      const allSpaces = db.all('SELECT * FROM spaces');
      const accessibleIds = allSpaces.filter(s => canViewContent(s, user_id, isAdmin)).map(s => s.id);
      if (accessibleIds.length) {
        sql += ` AND (p.space_id IS NULL OR p.space_id IN (${accessibleIds.map(() => '?').join(',')}))`;
        params.push(...accessibleIds);
      } else {
        sql += ' AND p.space_id IS NULL';
      }
    }
    const order = sort === 'popular'
      ? 'p.likes_count DESC, p.comments_count DESC'
      : 'p.is_pinned DESC, p.created_at DESC';
    sql += ` ORDER BY ${order} LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));
    const posts = db.all(sql, params);
    attachPollData(posts, user_id);
    attachLiked(posts, userFromSession(req)?.id || user_id);
    const total = db.get('SELECT COUNT(*) AS n FROM posts').n;
    res.json({ posts, total });
  });

  // Create post
  // Chỉ nhận link http(s) cho ảnh / video / tài liệu (chặn link javascript:)
  const httpUrl = v => { const t = String(v || '').trim(); return /^https?:\/\//i.test(t) ? t : ''; };
  app.post('/api/posts', (req, res) => {
    const {
      user_id, title, content, pillar, post_type = 'post', space_id, topic_id,
      image_url, video_url, doc_url, gif_url, poll_question, poll_options,
    } = req.body;
    if (!user_id || !content)
      return res.status(400).json({ error: 'Thiếu thông tin bài đăng.' });
    const user = db.get('SELECT id, level FROM users WHERE id = ?', [user_id]);
    if (!user) return res.status(404).json({ error: 'User không tồn tại.' });
    if (space_id) {
      const space = db.get('SELECT * FROM spaces WHERE id = ?', [space_id]);
      if (!space) return res.status(404).json({ error: 'Space không tồn tại.' });
      const { isAdmin } = getUserFlags(user_id);
      // Public spaces are open to everyone (same rule as viewing); private/secret need an approved membership.
      if (!canViewContent(space, user_id, isAdmin))
        return res.status(403).json({ error: 'Bạn cần tham gia Space này trước khi đăng bài.' });
    }
    let pollOptionsJson = null;
    if (poll_question && Array.isArray(poll_options)) {
      const cleaned = poll_options.map(o => String(o || '').trim()).filter(Boolean);
      if (cleaned.length >= 2) pollOptionsJson = JSON.stringify(cleaned.slice(0, 6));
    }
    const result = db.run(
      `INSERT INTO posts (user_id, title, content, pillar, post_type, space_id, topic_id,
        image_url, video_url, doc_url, gif_url, poll_question, poll_options)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [user_id, title || '', content, pillar || null, post_type, space_id || null, topic_id || null,
       driveImageUrl(httpUrl(image_url)) || null, httpUrl(video_url) || null, httpUrl(doc_url) || null, driveImageUrl(httpUrl(gif_url)) || null,
       pollOptionsJson ? (poll_question || '').trim() : null, pollOptionsJson]
    );
    addXP(user_id, 3, 'post', `Đăng bài: ${title || content.slice(0, 30)}`);
    res.status(201).json({ success: true, post_id: result.lastInsertRowid });
    notifyNewPost(result.lastInsertRowid, Number(user_id), space_id || null, title, content);
  });

  // Upload ảnh khi đăng bài (Feed/Space): trình duyệt đã nén sẵn sang WebP/JPEG, server chỉ đẩy
  // lên thư mục Drive (Admin → Cài đặt → Google Drive) và trả về link hiển thị. Không lưu trên VPS.
  const postImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = /^image\//.test(file.mimetype || '');
      cb(ok ? null : new Error('Chỉ nhận file ảnh.'), ok);
    },
  });
  const postImageUploadLog = new Map(); // user_id → [timestamps] — chống spam: tối đa 30 ảnh/giờ
  app.post('/api/posts/upload-image', (req, res) => {
    postImageUpload.single('image')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Ảnh quá lớn (tối đa 12MB).' : (err.message || 'Upload thất bại.') });
      if (!req.file) return res.status(400).json({ error: 'Chưa chọn ảnh.' });
      const userId = Number(req.body.user_id);
      const user = userId && db.get('SELECT id, status FROM users WHERE id = ?', [userId]);
      if (!user || user.status !== 'active')
        return res.status(403).json({ error: 'Bạn cần đăng nhập để tải ảnh.' });
      const now = Date.now();
      const recent = (postImageUploadLog.get(userId) || []).filter(t => now - t < 3600e3);
      if (recent.length >= 30) return res.status(429).json({ error: 'Bạn đã tải quá nhiều ảnh trong 1 giờ, vui lòng thử lại sau.' });
      const isMeal = req.body.purpose === 'p377_meal';   // ảnh bữa ăn báo cáo 377 ngày → thư mục riêng
      const folderKey = isMeal ? 'p377_meal_image_drive_folder_id' : 'post_image_drive_folder_id';
      const folderId = (db.get('SELECT value FROM site_settings WHERE key = ?', [folderKey])?.value || '').trim();
      if (!folderId) return res.status(503).json({ error: 'Chưa cấu hình thư mục Drive lưu ảnh.' });
      try {
        const drive = getDriveClient();
        const ext = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif' }[req.file.mimetype] || '';
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const created = await drive.files.create({
          requestBody: { name: `${isMeal ? 'bua-an' : 'bai-dang'}-u${userId}-${stamp}${ext}`, parents: [folderId] },
          media: { mimeType: req.file.mimetype, body: require('stream').Readable.from(req.file.buffer) },
          fields: 'id',
        });
        const fileId = created.data.id;
        await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
        recent.push(now); postImageUploadLog.set(userId, recent);
        res.json({ ok: true, url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600` });
      } catch (e) {
        console.error('[POST IMG] Drive upload failed:', e.message);
        res.status(502).json({ error: 'Tải ảnh lên Google Drive thất bại: ' + e.message });
      }
    });
  });

  // Vote (or change vote) on a post's poll
  app.post('/api/posts/:id/vote', (req, res) => {
    const { user_id, option_index } = req.body;
    if (!user_id || option_index === undefined) return res.status(400).json({ error: 'Thiếu thông tin bình chọn.' });
    const post = db.get('SELECT id, poll_options FROM posts WHERE id = ?', [req.params.id]);
    if (!post || !post.poll_options) return res.status(404).json({ error: 'Bài đăng không có poll.' });
    let options = [];
    try { options = JSON.parse(post.poll_options) || []; } catch { options = []; }
    const idx = Number(option_index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= options.length)
      return res.status(400).json({ error: 'Lựa chọn không hợp lệ.' });
    db.run(
      `INSERT INTO poll_votes (post_id, user_id, option_index) VALUES (?,?,?)
       ON CONFLICT(post_id, user_id) DO UPDATE SET option_index = excluded.option_index`,
      [req.params.id, user_id, idx]
    );
    const voteRows = db.all('SELECT option_index, COUNT(*) AS n FROM poll_votes WHERE post_id = ? GROUP BY option_index', [req.params.id]);
    const tallies = options.map((_, i) => voteRows.find(v => v.option_index === i)?.n || 0);
    res.json({ success: true, poll_tallies: tallies, poll_total: tallies.reduce((a, b) => a + b, 0), my_vote: idx });
  });

  // ── Spaces (public) ──────────────────────────────────────────
  function getUserFlags(userId) {
    if (!userId) return { isAdmin: false };
    const u = db.get('SELECT is_admin FROM users WHERE id = ?', [userId]);
    return { isAdmin: !!(u && u.is_admin) };
  }
  function getMembership(spaceId, userId) {
    if (!userId) return null;
    return db.get('SELECT status FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, userId]);
  }
  // Approved in ANY space belonging to this group counts as "in the group".
  function getGroupMembership(groupId, userId) {
    if (!userId) return null;
    return db.get(
      `SELECT sm.status FROM space_members sm
       JOIN spaces s ON s.id = sm.space_id
       WHERE s.group_id = ? AND sm.user_id = ? AND sm.status = 'approved' LIMIT 1`,
      [groupId, userId]
    );
  }
  function getEnrollment(courseId, userId) {
    if (!userId) return null;
    return db.get('SELECT status FROM course_enrollments WHERE course_id = ? AND user_id = ?', [courseId, userId]);
  }
  // Called whenever an order flips to 'completed' — if the purchased product represents
  // a private course's checkout, approve (or create) that buyer's enrollment automatically.
  // Also handles Coach 1-1 packages: crediting the buyer with N bookable sessions.
  function autoEnrollFromProductPurchase(productId, buyerId, orderId) {
    const product = db.get('SELECT course_id, coaching_sessions FROM products WHERE id = ?', [productId]);
    if (!product) return;
    if (product.course_id) {
      const existing = db.get('SELECT id FROM course_enrollments WHERE course_id = ? AND user_id = ?', [product.course_id, buyerId]);
      if (existing) {
        db.run("UPDATE course_enrollments SET status = 'approved' WHERE id = ?", [existing.id]);
      } else {
        db.run('INSERT INTO course_enrollments (course_id, user_id, status) VALUES (?,?,?)', [product.course_id, buyerId, 'approved']);
      }
    }
    if (product.coaching_sessions && orderId) {
      const already = db.get('SELECT id FROM coaching_credits WHERE order_id = ?', [orderId]);
      if (!already) db.run('INSERT INTO coaching_credits (user_id, order_id, sessions) VALUES (?,?,?)', [buyerId, orderId, product.coaching_sessions]);
    }
  }
  function canSeeSpace(space, userId, isAdmin) {
    if (space.visibility !== 'secret') return true;
    if (isAdmin) return true;
    const m = getMembership(space.id, userId);
    return !!(m && m.status === 'approved');
  }
  function canViewContent(space, userId, isAdmin) {
    if (space.visibility === 'public') return true;
    if (isAdmin) return true;
    const m = getMembership(space.id, userId);
    return !!(m && m.status === 'approved');
  }

  app.get('/api/spaces', (req, res) => {
    const { user_id = '' } = req.query;
    const { isAdmin } = getUserFlags(user_id);
    const spaces = db.all(`
      SELECT s.id, s.group_id, s.name, s.icon, s.description, s.visibility, s.min_level, s.allow_join_requests, s.created_at,
             COUNT(DISTINCT p.id) AS post_count,
             (SELECT COUNT(*) FROM space_members sm WHERE sm.space_id = s.id AND sm.status = 'approved') AS member_count,
             SUM(CASE WHEN p.user_id = ? THEN 1 ELSE 0 END) AS my_post_count
      FROM spaces s LEFT JOIN posts p ON p.space_id = s.id
      GROUP BY s.id
      ORDER BY s.order_num ASC, s.created_at ASC
    `, [user_id || 0]);
    const visible = spaces
      .filter(s => canSeeSpace(s, user_id, isAdmin))
      .map(s => {
        const m = getMembership(s.id, user_id);
        return { ...s, join_status: m ? m.status : 'none' };
      });
    res.json({ spaces: visible });
  });

  // Space groups with nested spaces the user has an APPROVED membership in — used by the sidebar.
  // (Discovery of not-yet-joined spaces happens on spaces.html, not the sidebar.)
  app.get('/api/space-groups', (req, res) => {
    const { user_id = '', all = '' } = req.query;
    const { isAdmin } = getUserFlags(user_id);
    const groups = db.all('SELECT id, name FROM space_groups ORDER BY order_num ASC, created_at ASC');
    if (all) return res.json({ groups, is_admin: isAdmin });
    const spaces = db.all(
      'SELECT id, group_id, name, icon, visibility, min_level FROM spaces ORDER BY order_num ASC, created_at ASC'
    );
    const result = groups
      .map(g => ({
        id: g.id,
        name: g.name,
        spaces: spaces
          .filter(s => s.group_id === g.id)
          .map(s => {
            const m = getMembership(s.id, user_id);
            return { ...s, join_status: m ? m.status : 'none' };
          })
          .filter(s => s.join_status === 'approved'),
      }))
      .filter(g => g.spaces.length > 0);
    res.json({ groups: result, is_admin: isAdmin });
  });

  // Member-facing space creation — only community admins (users.is_admin) can create
  app.post('/api/spaces', (req, res) => {
    const { user_id, group_id, name, icon = '💬', description = '', visibility = 'public', allow_join_requests = 1 } = req.body;
    const u = db.get('SELECT is_admin FROM users WHERE id = ?', [user_id]);
    if (!u || !u.is_admin) return res.status(403).json({ error: 'Bạn không có quyền tạo Space.' });
    if (!name?.trim()) return res.status(400).json({ error: 'Tên Space không được để trống.' });
    if (!group_id) return res.status(400).json({ error: 'Vui lòng chọn Group cho Space.' });
    const vis = ['public', 'private', 'secret'].includes(visibility) ? visibility : 'public';
    const r = db.run(
      'INSERT INTO spaces (group_id, name, icon, description, visibility, allow_join_requests) VALUES (?,?,?,?,?,?)',
      [group_id, name.trim(), icon || '💬', description || '', vis, allow_join_requests ? 1 : 0]
    );
    // Auto-join the creator so the new space shows up in their own sidebar immediately
    db.run('INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,?)', [r.lastInsertRowid, user_id, 'approved']);
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.get('/api/spaces/:id', (req, res) => {
    const space = db.get('SELECT * FROM spaces WHERE id = ?', [req.params.id]);
    if (!space) return res.status(404).json({ error: 'Space không tồn tại.' });
    const userId = req.query.user_id;
    const { isAdmin } = getUserFlags(userId);
    if (!canSeeSpace(space, userId, isAdmin))
      return res.status(404).json({ error: 'Space không tồn tại.' });
    const m = getMembership(space.id, userId);
    res.json({
      space,
      join_status: m ? m.status : 'none',
      content_locked: !canViewContent(space, userId, isAdmin),
    });
  });

  // Topics of a space — used to populate the "Topic" select when posting
  app.get('/api/topics', (req, res) => {
    const { space_id } = req.query;
    if (!space_id) return res.status(400).json({ error: 'Thiếu space_id.' });
    const topics = db.all('SELECT id, space_id, name, icon FROM topics WHERE space_id = ? ORDER BY order_num ASC, created_at ASC', [space_id]);
    res.json({ topics });
  });

  // Join / request-to-join a space
  app.post('/api/spaces/:id/join', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    const space = db.get('SELECT * FROM spaces WHERE id = ?', [req.params.id]);
    if (!space) return res.status(404).json({ error: 'Space không tồn tại.' });

    if (space.visibility === 'secret')
      return res.status(403).json({ error: 'Bạn cần được mời để tham gia Space này.' });

    if (space.visibility === 'private' && !space.allow_join_requests)
      return res.status(403).json({ error: 'Space này hiện không nhận yêu cầu tham gia mới.' });

    const status = space.visibility === 'public' ? 'approved' : 'pending';
    const existing = db.get('SELECT id, status FROM space_members WHERE space_id = ? AND user_id = ?', [req.params.id, user_id]);
    if (existing) {
      if (existing.status !== status && !(existing.status === 'approved'))
        db.run('UPDATE space_members SET status = ? WHERE id = ?', [status, existing.id]);
    } else {
      db.run('INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,?)', [req.params.id, user_id, status]);
    }
    res.json({ success: true, status: existing?.status === 'approved' ? 'approved' : status });
  });

  // Bài trong Space riêng tư / bí mật: chỉ thành viên đã được duyệt, tác giả và admin xem được (bài + bình luận).
  // Người xem lấy từ phiên đăng nhập (x-user-token); user_id trên URL đã được guard /api kiểm tra khớp phiên.
  function postViewerId(req) { return userFromSession(req)?.id || Number(req.query.user_id) || 0; }
  function canViewPost(post, viewerId, req) {
    if (!post.space_id) return true;
    const space = db.get('SELECT id, visibility FROM spaces WHERE id = ?', [post.space_id]);
    if (!space || space.visibility === 'public') return true;
    if (viewerId && Number(viewerId) === Number(post.author_id ?? post.user_id)) return true;
    const key = req.headers['x-admin-key'];
    if (key && (key === ADMIN_KEY || adminSessionUser(key)?.is_admin)) return true;
    return canViewContent(space, viewerId, viewerId ? getUserFlags(viewerId).isAdmin : false);
  }

  // Single post detail
  app.get('/api/posts/:id', (req, res) => {
    const p = db.get(
      `SELECT p.id, p.title, p.content, p.pillar, p.post_type, p.space_id, p.is_pinned,
              p.topic_id, p.image_url, p.video_url, p.doc_url, p.gif_url, p.poll_question, p.poll_options,
              p.likes_count, p.comments_count, p.created_at, p.updated_at, p.hidden, p.showcase,
              u.id AS author_id, u.first_name, u.last_name, u.level,
              t.name AS topic_name, t.icon AS topic_icon
       FROM posts p JOIN users u ON u.id = p.user_id
       LEFT JOIN topics t ON t.id = p.topic_id
       WHERE p.id = ?`,
      [req.params.id]
    );
    if (!p) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    if (!canViewPost(p, postViewerId(req), req))
      return res.status(403).json({ error: 'Bài viết này thuộc nhóm riêng tư — chỉ thành viên của nhóm mới xem được.', locked: true });
    // Bài bị admin ẩn: chỉ tác giả và admin còn xem được
    if (p.hidden && Number(req.query.user_id) !== p.author_id && !getUserFlags(req.query.user_id).isAdmin)
      return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    attachPollData([p], req.query.user_id);
    attachLiked([p], postViewerId(req));
    res.json(p);
    // Lượt xem: mỗi lần thành viên (không phải tác giả) mở bài; cùng người mở lại trong 30 phút không tính thêm
    try {
      const viewer = userFromSession(req)?.id || Number(req.query.user_id) || 0;
      if (viewer && viewer !== p.author_id) {
        const v = db.get('SELECT last_at FROM post_views WHERE post_id = ? AND user_id = ?', [p.id, viewer]);
        const now = calNowVN() + ':00';
        if (!v) db.run('INSERT INTO post_views (post_id, user_id, views, first_at, last_at) VALUES (?,?,1,?,?)', [p.id, viewer, now, now]);
        else if (Date.parse(now.replace(' ', 'T') + 'Z') - Date.parse(String(v.last_at).replace(' ', 'T') + 'Z') > 30 * 60e3)
          db.run('UPDATE post_views SET views = views + 1, last_at = ? WHERE post_id = ? AND user_id = ?', [now, p.id, viewer]);
      }
    } catch (e) { console.error('[post view]', e.message); }
  });

  // Tác giả sửa bài của mình (tiêu đề, nội dung, link ảnh/video/tài liệu/GIF)
  app.patch('/api/posts/:id', (req, res) => {
    const b = req.body || {};
    const post = db.get('SELECT id, user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng.' });
    const { isAdmin } = getUserFlags(b.user_id);
    if (!b.user_id || (Number(b.user_id) !== post.user_id && !isAdmin))
      return res.status(403).json({ error: 'Bạn chỉ có thể sửa bài viết của chính mình.' });
    const err = updatePostFields(post.id, b, { userId: Number(b.user_id), isAdmin });
    if (err) return res.status(400).json({ error: err });
    res.json({ success: true });
  });

  // Cập nhật các trường nội dung bài đăng (dùng chung cho tác giả & admin). Trả về lỗi (string) hoặc null.
  // ctx = người sửa ({ userId, isAdmin }); không có ctx = admin (trang quản trị).
  function updatePostFields(postId, b, ctx = { isAdmin: true }) {
    const sets = [], params = [];
    // Đổi Space / Topic: như lúc đăng bài — chỉ Space người sửa được đăng vào, Topic phải thuộc Space đó
    if (b.space_id !== undefined) {
      const sid = Number(b.space_id) || null;
      if (sid) {
        const space = db.get('SELECT * FROM spaces WHERE id = ?', [sid]);
        if (!space) return 'Space không tồn tại.';
        if (!canViewContent(space, ctx.userId, ctx.isAdmin)) return 'Bạn cần tham gia Space này trước khi chuyển bài vào.';
      }
      const tid = Number(b.topic_id) || null;
      if (tid && !db.get('SELECT 1 AS x FROM topics WHERE id = ? AND space_id = ?', [tid, sid])) return 'Topic không thuộc Space đã chọn.';
      sets.push('space_id = ?', 'topic_id = ?'); params.push(sid, tid);
    }
    if (b.pillar !== undefined) {
      const pk = String(b.pillar || '').trim();
      if (pk && !db.get('SELECT 1 AS x FROM pillars WHERE key = ?', [pk])) return 'Trụ cột không hợp lệ.';
      sets.push('pillar = ?'); params.push(pk || null);
    }
    if (b.content !== undefined) {
      if (!String(b.content).trim()) return 'Nội dung bài đăng không được để trống.';
      sets.push('content = ?'); params.push(String(b.content));
    }
    if (b.title !== undefined) { sets.push('title = ?'); params.push(String(b.title || '').trim()); }
    [['image_url', true], ['gif_url', true], ['video_url', false], ['doc_url', false]].forEach(([k, isImg]) => {
      if (b[k] === undefined) return;
      const v = String(b[k] || '').trim();
      if (v && !/^https?:\/\//i.test(v)) return;
      sets.push(`${k} = ?`); params.push(v ? (isImg ? driveImageUrl(v) : v) : null);
    });
    if (!sets.length) return 'Không có gì để cập nhật.';
    sets.push("updated_at = datetime('now','localtime')");
    db.run(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`, [...params, postId]);
    return null;
  }

  // Toggle pin — community admins only
  app.post('/api/posts/:id/pin', (req, res) => {
    const { user_id } = req.body;
    const { isAdmin } = getUserFlags(user_id);
    if (!isAdmin) return res.status(403).json({ error: 'Chỉ admin mới có thể ghim bài viết.' });
    const post = db.get('SELECT id, is_pinned FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng.' });
    const newVal = post.is_pinned ? 0 : 1;
    db.run('UPDATE posts SET is_pinned = ? WHERE id = ?', [newVal, req.params.id]);
    res.json({ success: true, is_pinned: newVal });
  });

  // Comments for a post (flat list with parent_id; frontend builds tree)
  app.get('/api/posts/:id/comments', (req, res) => {
    const post = db.get('SELECT id, user_id, space_id FROM posts WHERE id = ?', [req.params.id]);
    if (post && !canViewPost(post, postViewerId(req), req))
      return res.status(403).json({ error: 'Bài viết này thuộc nhóm riêng tư.', comments: [] });
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
    const post = db.get('SELECT user_id, space_id FROM posts WHERE id = ?', [req.params.id]);
    if (post && post.user_id !== Number(user_id)) {
      addXP(user_id, 2, 'comment', 'Bình luận bài viết');
    }
    res.json({ success: true });
    if (post) notifyComment(Number(req.params.id), post, Number(user_id), content, parent_id);
  });

  // ── Gắn tên thành viên (@Họ Tên) trong bình luận → báo cho người được gắn tên ──
  const mentionName = u => `${u.first_name || ''} ${u.last_name || ''}`.replace(/\s+/g, ' ').trim();
  const mentionMembers = () => db.all("SELECT id, first_name, last_name FROM users WHERE status = 'active'")
    .map(u => ({ id: u.id, name: mentionName(u) })).filter(u => u.name);
  // Danh sách để gợi ý khi gõ @ (chỉ thành viên đã đăng nhập)
  app.get('/api/members/mentions', (req, res) => {
    if (!userFromSession(req)) return res.status(401).json({ error: 'Vui lòng đăng nhập.', code: 'session_required' });
    res.json({ members: mentionMembers().sort((a, b) => a.name.localeCompare(b.name, 'vi')) });
  });
  // Tìm "@Họ Tên" trong nội dung — tên dài so trước để "@Lan Anh" không bị nhận nhầm thành "@Lan"
  function findMentions(content) {
    let text = String(content || '').normalize('NFC').toLowerCase();
    if (!text.includes('@')) return [];
    const found = [];
    for (const u of mentionMembers().sort((a, b) => b.name.length - a.name.length)) {
      const tag = '@' + u.name.normalize('NFC').toLowerCase();
      let i = text.indexOf(tag), hit = false;
      while (i >= 0) {
        if (!/[\p{L}\p{N}]/u.test(text[i + tag.length] || '')) { hit = true; break; }
        i = text.indexOf(tag, i + 1);
      }
      if (!hit) continue;
      found.push(u);
      text = text.split(tag).join(' ');
    }
    return found;
  }
  // Sau mỗi bình luận: báo người được gắn tên, chủ bài viết, người có bình luận được trả lời
  // (mỗi người tối đa 1 thông báo cho 1 bình luận; không báo cho chính người viết)
  function notifyComment(postId, post, authorId, content, parentId) {
    try {
      const space = post.space_id ? db.get('SELECT id, name, visibility FROM spaces WHERE id = ?', [post.space_id]) : null;
      // Bài trong không gian riêng tư: chỉ báo cho thành viên của không gian đó (và admin)
      const canSee = uid => !space || space.visibility === 'public' || !!db.get(`SELECT 1 AS x FROM space_members WHERE space_id = ? AND user_id = ? AND status = 'approved'
          UNION SELECT 1 FROM users WHERE id = ? AND is_admin = 1`, [space.id, uid, uid]);
      const isActive = uid => !!db.get("SELECT 1 AS x FROM users WHERE id = ? AND status = 'active'", [uid]);
      const a = db.get('SELECT first_name, last_name FROM users WHERE id = ?', [authorId]) || {};
      const who = mentionName(a) || 'Một thành viên';
      const plain = String(content).replace(/\s+/g, ' ').trim();
      const body = plain.length > 200 ? plain.slice(0, 197) + '…' : plain;
      const link = `feed.html?post_id=${postId}`;
      const done = new Set([authorId]);
      const send = (uid, type, title) => {
        if (!uid || done.has(uid) || !isActive(uid) || !canSee(uid)) return;
        done.add(uid);
        db.run('INSERT INTO notifications (user_id, type, title, content, link) VALUES (?,?,?,?,?)', [uid, type, title, body, link]);
        pushNotify(uid, { title, body, link });
        notifyTelegram(uid, title, body, link, '💬 Xem bình luận').catch(() => {});
      };
      findMentions(content).slice(0, 20).forEach(u => send(u.id, 'mention', `💬 ${who} đã nhắc đến bạn trong một bình luận`));
      const parent = parentId ? db.get('SELECT user_id FROM comments WHERE id = ? AND post_id = ?', [parentId, postId]) : null;
      if (parent) send(parent.user_id, 'comment', `↩️ ${who} đã trả lời bình luận của bạn`);
      send(post.user_id, 'comment', `💬 ${who} đã bình luận bài viết của bạn`);
    } catch (e) { console.error('[comment notify]', e.message); }
  }

  // ── Thực đơn 7 ngày (thuc-don-7-ngay.html, bài tập trong Thư viện bài tập): mỗi khách tự lên thực đơn
  // nhiều tuần. 1 tuần = 7 ngày × Sáng 3 món / Trưa 5 món / Chiều 5 món + ghi chú. Chỉ chủ thực đơn + admin xem.
  db.exec(`CREATE TABLE IF NOT EXISTS meal_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT, start_date TEXT, days TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_meal_plans_user ON meal_plans(user_id)');
  const MP_SLOTS = { s: 3, t: 5, c: 5 };
  const mpClean = (days) => Array.from({ length: 7 }, (_, i) => {
    const d = (Array.isArray(days) ? days[i] : null) || {};
    const out = { note: String(d.note || '').slice(0, 500) };
    // Mỗi buổi ít nhất 3 / 5 / 5 ô; khách bấm ＋ thêm được tới 12 món (bỏ ô trống thừa ở cuối)
    for (const k in MP_SLOTS) {
      const src = (Array.isArray(d[k]) ? d[k] : []).slice(0, 12).map(v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 120));
      while (src.length > MP_SLOTS[k] && !src[src.length - 1]) src.pop();
      out[k] = Array.from({ length: Math.max(MP_SLOTS[k], src.length) }, (_, j) => src[j] || '');
    }
    return out;
  });
  const mpFilled = days => days.reduce((n, d) => n + ['s', 't', 'c'].reduce((m, k) => m + d[k].filter(Boolean).length, 0), 0);
  const mpOut = r => { const days = mpClean(JSON.parse(r.days || '[]')); return { id: r.id, user_id: r.user_id, title: r.title || '', start_date: r.start_date || '', days, filled: mpFilled(days), total: 91, created_at: r.created_at, updated_at: r.updated_at }; };
  const mpDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '';
  const mpMe = (req, res) => {
    const u = userFromSession(req);
    if (!u) { res.status(401).json({ error: 'Vui lòng đăng nhập để lưu thực đơn.', code: 'session_required' }); return null; }
    return u;
  };
  const mpGet = (req, res, u) => {
    const r = db.get('SELECT * FROM meal_plans WHERE id = ?', [Number(req.params.id) || 0]);
    if (!r || (r.user_id !== u.id && !u.is_admin)) { res.status(404).json({ error: 'Không tìm thấy thực đơn.' }); return null; }
    return r;
  };
  app.get('/api/meal-plans', (req, res) => {
    const u = mpMe(req, res); if (!u) return;
    res.json({ plans: db.all('SELECT * FROM meal_plans WHERE user_id = ? ORDER BY COALESCE(start_date, created_at) DESC, id DESC', [u.id]).map(mpOut), body: mpBodyType(u.id) });
  });
  // Cơ địa Hàn / Nhiệt của khách (để nhắc món cay như gừng): ưu tiên Lộ trình (khảo sát Thân-Tâm-Mệnh),
  // không có thì lấy bài Kiểm tra Hàn–Nhiệt gần nhất cùng số điện thoại
  function mpBodyType(uid) {
    const r = db.get('SELECT the_trang FROM ttm_roadmaps WHERE user_id = ? AND the_trang IS NOT NULL AND the_trang <> \'\' ORDER BY id DESC LIMIT 1', [uid]);
    if (r) return { type: r.the_trang, source: 'Lộ trình của bạn' };
    const ph = String(db.get('SELECT phone FROM users WHERE id = ?', [uid])?.phone || '').replace(/\D/g, '').slice(-9);
    if (ph.length === 9) {
      const q = db.all('SELECT phone, result_type FROM han_nhiet_quiz_results ORDER BY id DESC LIMIT 2000').find(x => String(x.phone || '').replace(/\D/g, '').slice(-9) === ph);
      if (q) return { type: q.result_type, source: 'bài Kiểm tra Hàn–Nhiệt' };
    }
    return { type: '', source: '' };
  }
  app.post('/api/meal-plans', (req, res) => {
    const u = mpMe(req, res); if (!u) return;
    if (db.get('SELECT COUNT(*) AS n FROM meal_plans WHERE user_id = ?', [u.id]).n >= 200) return res.status(400).json({ error: 'Bạn đã có quá nhiều thực đơn — xoá bớt thực đơn cũ.' });
    const b = req.body || {};
    let days = mpClean([]);
    if (b.copy_from) { const src = db.get('SELECT days FROM meal_plans WHERE id = ? AND user_id = ?', [Number(b.copy_from) || 0, u.id]); if (src) days = mpClean(JSON.parse(src.days || '[]')); }
    const r = db.run('INSERT INTO meal_plans (user_id, title, start_date, days) VALUES (?,?,?,?)',
      [u.id, String(b.title || 'Thực đơn 7 ngày').trim().slice(0, 100), mpDate(b.start_date), JSON.stringify(days)]);
    res.status(201).json({ plan: mpOut(db.get('SELECT * FROM meal_plans WHERE id = ?', [r.lastInsertRowid])) });
  });
  app.put('/api/meal-plans/:id', (req, res) => {
    const u = mpMe(req, res); if (!u) return;
    const r = mpGet(req, res, u); if (!r) return;
    if (r.user_id !== u.id) return res.status(403).json({ error: 'Chỉ chủ thực đơn mới sửa được.' });
    const b = req.body || {};
    db.run("UPDATE meal_plans SET title = ?, start_date = ?, days = ?, updated_at = datetime('now','localtime') WHERE id = ?",
      [b.title !== undefined ? String(b.title || '').trim().slice(0, 100) || 'Thực đơn 7 ngày' : r.title, b.start_date !== undefined ? mpDate(b.start_date) : r.start_date,
        b.days !== undefined ? JSON.stringify(mpClean(b.days)) : r.days, r.id]);
    res.json({ plan: mpOut(db.get('SELECT * FROM meal_plans WHERE id = ?', [r.id])) });
  });
  app.delete('/api/meal-plans/:id', (req, res) => {
    const u = mpMe(req, res); if (!u) return;
    const r = mpGet(req, res, u); if (!r) return;
    if (r.user_id !== u.id) return res.status(403).json({ error: 'Chỉ chủ thực đơn mới xoá được.' });
    db.run('DELETE FROM meal_plans WHERE id = ?', [r.id]);
    res.json({ ok: true });
  });
  // Admin xem thực đơn của 1 thành viên (Hồ sơ thành viên) và danh sách ai đã lên thực đơn
  app.get('/api/admin/users/:id/meal-plans', requireAdmin, (req, res) => {
    res.json({ plans: db.all('SELECT * FROM meal_plans WHERE user_id = ? ORDER BY COALESCE(start_date, created_at) DESC, id DESC', [Number(req.params.id) || 0]).map(mpOut) });
  });

  // ── Bài đã lưu: thành viên lưu bài viết vào thư mục do mình tự tạo (chỉ chính người đó thấy) ──
  // saved_posts: 1 dòng / (người, bài) + ghi chú riêng; saved_post_folders: bài nằm trong thư mục nào
  // (không có dòng nào = "Chưa phân loại"). Xoá thư mục → bài về "Chưa phân loại", không mất.
  db.exec(`CREATE TABLE IF NOT EXISTS saved_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')), UNIQUE(user_id, name)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS saved_posts (
    user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')), PRIMARY KEY (user_id, post_id)
  )`);
  // Lượt xem bài: 1 dòng / (bài, người xem), views = số lần mở (cách nhau > 30 phút)
  db.exec(`CREATE TABLE IF NOT EXISTS post_views (
    post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, views INTEGER DEFAULT 1, first_at TEXT, last_at TEXT, PRIMARY KEY (post_id, user_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS saved_post_folders (
    user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, folder_id INTEGER NOT NULL, PRIMARY KEY (user_id, post_id, folder_id)
  )`);
  const savedMe = (req, res) => {
    const u = userFromSession(req);
    if (!u) { res.status(401).json({ error: 'Vui lòng đăng nhập để lưu bài.', code: 'session_required' }); return null; }
    return u;
  };
  // Còn được xem bài không: bài không bị ẩn (trừ tác giả / admin), bài trong không gian riêng tư thì phải là thành viên
  function savedCanView(p, u) {
    if (u.is_admin || p.user_id === u.id) return true;
    if (p.hidden) return false;
    if (!p.space_id) return true;
    const s = db.get('SELECT visibility FROM spaces WHERE id = ?', [p.space_id]);
    if (!s || s.visibility === 'public') return true;
    return !!db.get("SELECT 1 AS x FROM space_members WHERE space_id = ? AND user_id = ? AND status = 'approved'", [p.space_id, u.id]);
  }
  const savedFolderName = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  function savedFolders(uid) {
    // Dọn bài đã bị xoá khỏi cộng đồng
    db._.run('DELETE FROM saved_posts WHERE user_id = ? AND post_id NOT IN (SELECT id FROM posts)', [uid]);
    db._.run('DELETE FROM saved_post_folders WHERE user_id = ? AND (post_id NOT IN (SELECT post_id FROM saved_posts WHERE user_id = ?) OR folder_id NOT IN (SELECT id FROM saved_folders WHERE user_id = ?))', [uid, uid, uid]);
    const folders = db.all(`SELECT f.id, f.name, (SELECT COUNT(*) FROM saved_post_folders x WHERE x.folder_id = f.id AND x.user_id = f.user_id) AS count
      FROM saved_folders f WHERE f.user_id = ? ORDER BY f.name COLLATE NOCASE`, [uid]);
    const total = db.get('SELECT COUNT(*) AS n FROM saved_posts WHERE user_id = ?', [uid]).n;
    const none = db.get('SELECT COUNT(*) AS n FROM saved_posts s WHERE s.user_id = ? AND NOT EXISTS (SELECT 1 FROM saved_post_folders x WHERE x.user_id = s.user_id AND x.post_id = s.post_id)', [uid]).n;
    return { folders, total, uncategorized: none };
  }
  app.get('/api/saved/folders', (req, res) => {
    const u = savedMe(req, res); if (!u) return;
    res.json(savedFolders(u.id));
  });
  app.post('/api/saved/folders', (req, res) => {
    const u = savedMe(req, res); if (!u) return;
    const name = savedFolderName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Nhập tên thư mục.' });
    if (db.get('SELECT COUNT(*) AS n FROM saved_folders WHERE user_id = ?', [u.id]).n >= 50) return res.status(400).json({ error: 'Tối đa 50 thư mục.' });
    const old = db.get('SELECT id FROM saved_folders WHERE user_id = ? AND LOWER(name) = LOWER(?)', [u.id, name]);
    if (old) return res.json({ ok: true, id: old.id, existed: true });
    const id = db.run('INSERT INTO saved_folders (user_id, name) VALUES (?, ?)', [u.id, name]).lastInsertRowid;
    res.json({ ok: true, id });
  });
  app.patch('/api/saved/folders/:id', (req, res) => {
    const u = savedMe(req, res); if (!u) return;
    const name = savedFolderName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Nhập tên thư mục.' });
    const f = db.get('SELECT id FROM saved_folders WHERE id = ? AND user_id = ?', [req.params.id, u.id]);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy thư mục.' });
    if (db.get('SELECT 1 AS x FROM saved_folders WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id <> ?', [u.id, name, f.id]))
      return res.status(400).json({ error: 'Bạn đã có thư mục cùng tên.' });
    db.run('UPDATE saved_folders SET name = ? WHERE id = ?', [name, f.id]);
    res.json({ ok: true });
  });
  app.delete('/api/saved/folders/:id', (req, res) => {
    const u = savedMe(req, res); if (!u) return;
    const f = db.get('SELECT id FROM saved_folders WHERE id = ? AND user_id = ?', [req.params.id, u.id]);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy thư mục.' });
    db._.run('DELETE FROM saved_post_folders WHERE user_id = ? AND folder_id = ?', [u.id, f.id]);
    db.run('DELETE FROM saved_folders WHERE id = ?', [f.id]);
    res.json({ ok: true });
  });
  // Id các bài đã lưu (để nút "Lưu" hiện "Đã lưu")
  app.get('/api/saved/ids', (req, res) => {
    const u = savedMe(req, res); if (!u) return;
    res.json({ ids: db.all('SELECT post_id FROM saved_posts WHERE user_id = ?', [u.id]).map(x => x.post_id) });
  });
  app.get('/api/saved/post/:postId', (req, res) => {
    const u = savedMe(req, res); if (!u) return;
    const s = db.get('SELECT note FROM saved_posts WHERE user_id = ? AND post_id = ?', [u.id, req.params.postId]);
    res.json({ saved: !!s, note: s?.note || '',
      folder_ids: s ? db.all('SELECT folder_id FROM saved_post_folders WHERE user_id = ? AND post_id = ?', [u.id, req.params.postId]).map(x => x.folder_id) : [],
      ...savedFolders(u.id) });
  });
  // Lưu / cập nhật thư mục + ghi chú của 1 bài
  app.put('/api/saved/post/:postId', (req, res) => {
    const u = savedMe(req, res); if (!u) return;
    const pid = Number(req.params.postId);
    const p = db.get('SELECT id, user_id, space_id, hidden FROM posts WHERE id = ?', [pid]);
    if (!p || !savedCanView(p, u)) return res.status(404).json({ error: 'Không tìm thấy bài viết.' });
    const mine = new Set(db.all('SELECT id FROM saved_folders WHERE user_id = ?', [u.id]).map(x => x.id));
    const ids = [...new Set((Array.isArray(req.body?.folder_ids) ? req.body.folder_ids : []).map(Number))].filter(id => mine.has(id));
    const note = String(req.body?.note ?? '').trim().slice(0, 500);
    db._.run(`INSERT INTO saved_posts (user_id, post_id, note) VALUES (?,?,?) ON CONFLICT(user_id, post_id) DO UPDATE SET note = excluded.note`, [u.id, pid, note]);
    db._.run('DELETE FROM saved_post_folders WHERE user_id = ? AND post_id = ?', [u.id, pid]);
    ids.forEach(id => db._.run('INSERT OR IGNORE INTO saved_post_folders (user_id, post_id, folder_id) VALUES (?,?,?)', [u.id, pid, id]));
    db._save();
    res.json({ ok: true, folder_ids: ids });
  });
  app.delete('/api/saved/post/:postId', (req, res) => {
    const u = savedMe(req, res); if (!u) return;
    db._.run('DELETE FROM saved_post_folders WHERE user_id = ? AND post_id = ?', [u.id, req.params.postId]);
    db.run('DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?', [u.id, req.params.postId]);
    res.json({ ok: true });
  });
  // Danh sách bài đã lưu: folder = all | none | <id>, q = tìm trong tiêu đề / nội dung / ghi chú
  app.get('/api/saved/posts', (req, res) => {
    const u = savedMe(req, res); if (!u) return;
    const f = String(req.query.folder || 'all');
    let where = 's.user_id = ?';
    const params = [u.id];
    if (f === 'none') where += ' AND NOT EXISTS (SELECT 1 FROM saved_post_folders x WHERE x.user_id = s.user_id AND x.post_id = s.post_id)';
    else if (/^\d+$/.test(f)) { where += ' AND EXISTS (SELECT 1 FROM saved_post_folders x WHERE x.user_id = s.user_id AND x.post_id = s.post_id AND x.folder_id = ?)'; params.push(Number(f)); }
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const rows = db.all(`SELECT s.post_id, s.note, s.created_at AS saved_at, p.id, p.user_id, p.title, p.content, p.image_url, p.video_url, p.space_id, p.hidden,
        p.likes_count, p.comments_count, p.created_at, u.first_name, u.last_name, sp.name AS space_name
      FROM saved_posts s JOIN posts p ON p.id = s.post_id JOIN users u ON u.id = p.user_id LEFT JOIN spaces sp ON sp.id = p.space_id
      WHERE ${where} ORDER BY s.created_at DESC LIMIT 500`, params);
    const fmap = {};
    db.all('SELECT x.post_id, f.id, f.name FROM saved_post_folders x JOIN saved_folders f ON f.id = x.folder_id WHERE x.user_id = ?', [u.id])
      .forEach(x => (fmap[x.post_id] = fmap[x.post_id] || []).push({ id: x.id, name: x.name }));
    const posts = rows.map(r => {
      const ok = savedCanView(r, u);
      const text = String(r.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return {
        post_id: r.post_id, note: r.note || '', saved_at: r.saved_at, folders: fmap[r.post_id] || [], can_view: ok,
        ...(ok ? { title: r.title || '', excerpt: text.slice(0, 280), image_url: r.image_url || '', has_video: !!r.video_url, space_name: r.space_name || '',
          author: `${r.first_name || ''} ${r.last_name || ''}`.trim(), created_at: r.created_at, likes_count: r.likes_count, comments_count: r.comments_count,
          _search: `${r.title || ''} ${text} ${r.note || ''} ${r.first_name || ''} ${r.last_name || ''}`.toLowerCase() } : {}),
      };
    }).filter(p => !q || (p.can_view ? p._search.includes(q) : String(p.note).toLowerCase().includes(q)))
      .map(({ _search, ...p }) => p);
    res.json({ posts, ...savedFolders(u.id) });
  });

  // Like a post (toggle)
  app.post('/api/posts/:id/like', (req, res) => {
    const userId = userFromSession(req)?.id || Number(req.body?.user_id) || 0;
    if (!userId) return res.status(401).json({ error: 'Vui lòng đăng nhập để thích bài.', code: 'session_required' });
    const post = db.get('SELECT id FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng.' });
    const had = db.get('SELECT 1 AS x FROM post_likes WHERE post_id = ? AND user_id = ?', [post.id, userId]);
    if (had) {
      db.run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [post.id, userId]);
      db.run('UPDATE posts SET likes_count = MAX(COALESCE(likes_count, 0) - 1, 0) WHERE id = ?', [post.id]);
    } else {
      db.run('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [post.id, userId]);
      db.run('UPDATE posts SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = ?', [post.id]);
    }
    const likes_count = db.get('SELECT likes_count FROM posts WHERE id = ?', [post.id]).likes_count || 0;
    res.json({ success: true, liked: !had, likes_count });
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
      SELECT id, first_name, last_name, level, xp, streak, created_at, bio, location
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

  // Global topbar search (public) — posts + members + products, 5 each
  app.get('/api/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ posts: [], users: [], products: [] });
    const like = `%${q}%`;

    const posts = db.all(`
      SELECT p.id, p.title, p.content, u.first_name, u.last_name
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.space_id IS NULL AND COALESCE(p.hidden, 0) = 0 AND (p.title LIKE ? OR p.content LIKE ?)
      ORDER BY p.created_at DESC LIMIT 5
    `, [like, like]);

    const users = db.all(`
      SELECT id, first_name, last_name, level, xp
      FROM users
      WHERE status = 'active' AND (first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?)
      ORDER BY xp DESC LIMIT 5
    `, [like, like, like]);

    const products = db.all(`
      SELECT id, title, price, cover_color
      FROM products
      WHERE status = 'published' AND (title LIKE ? OR description LIKE ?)
      ORDER BY sales_count DESC LIMIT 5
    `, [like, like]);

    res.json({ posts, users, products });
  });

  // Community stats bar (public) — members / admins / online counts
  app.get('/api/community/stats', (req, res) => {
    const members = db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n;
    const admins = db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND is_admin = 1").n;
    const online = db.get(
      "SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND last_active_at >= datetime('now', '-10 minutes', 'localtime')"
    ).n;
    res.json({ members, admins, online });
  });

  // About page bundle (public) — intro, media gallery, member count, creator
  app.get('/api/about', (req, res) => {
    const rows = db.all("SELECT key, value FROM site_settings WHERE key IN ('about_intro','about_media')");
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    let media = [];
    try { media = JSON.parse(settings.about_media || '[]'); } catch { media = []; }

    const member_count = db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n;
    const creator = db.get(
      "SELECT id, first_name, last_name FROM users WHERE is_admin = 1 ORDER BY created_at ASC LIMIT 1"
    );

    res.json({
      intro: settings.about_intro || '',
      media,
      member_count,
      creator: creator || null,
    });
  });

  // User's recent posts
  app.get('/api/users/:id/posts', (req, res) => {
    const posts = db.all(
      `SELECT id, title, content, pillar, post_type, likes_count, comments_count, created_at
       FROM posts WHERE user_id = ? AND COALESCE(hidden, 0) = 0 ORDER BY created_at DESC LIMIT 8`,
      [req.params.id]
    );
    res.json({ posts });
  });

  // User profile — email/phone are only included when viewing your own profile (PII, not public)
  app.get('/api/users/:id', (req, res) => {
    const isSelf = req.query.requester_id && Number(req.query.requester_id) === Number(req.params.id);
    const fields = 'id, first_name, last_name, level, xp, streak, created_at, bio, location, social_links, is_admin'
      + (isSelf ? ', email, phone, telegram_chat_id, timezone' : '');
    const user = db.get(`SELECT ${fields} FROM users WHERE id = ?`, [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User không tồn tại.' });
    user.is_admin = !!user.is_admin;
    try { user.social_links = user.social_links ? JSON.parse(user.social_links) : {}; } catch { user.social_links = {}; }

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
    // Keyed dynamically off whatever pillar keys posts actually use — not a
    // hardcoded whitelist — so admin-created/renamed pillars (see
    // /api/admin/pillars) are always counted correctly.
    const pillar_counts = {};
    pillarRows.forEach(r => { if (r.pillar) pillar_counts[r.pillar] = r.n; });

    res.json({ ...user, completed_days, post_count, cot_count, pillar_counts });
  });

  // Update own profile (bio, location, social links, name) — self-service only
  // SĐT hợp lệ (bỏ khoảng trắng / dấu chấm / gạch / ngoặc; +84 / 84 đổi thành 0):
  //  - Việt Nam: di động đúng 10 số 03x/05x/07x/08x/09x, hoặc máy bàn đúng 11 số 02x
  //  - Nước ngoài: +mã nước (không phải +84) + số, tổng 8–15 chữ số
  function normPhone(p) {
    let s = String(p || '').replace(/[\s.\-()]/g, '');
    if (/^\+84/.test(s)) s = '0' + s.slice(3);
    else if (/^84[35789]\d{8}$/.test(s)) s = '0' + s.slice(2);
    return s;
  }
  function validPhone(p) {
    const s = normPhone(p);
    return /^0[35789]\d{8}$/.test(s) || /^02\d{9}$/.test(s) || /^\+[1-9]\d{7,14}$/.test(s);
  }
  app.patch('/api/users/:id', (req, res) => {
    const targetId = Number(req.params.id);
    const requesterId = Number(req.body.user_id);
    if (!requesterId || requesterId !== targetId)
      return res.status(403).json({ error: 'Bạn chỉ có thể chỉnh sửa hồ sơ của chính mình.' });

    const user = db.get('SELECT id FROM users WHERE id = ?', [targetId]);
    if (!user) return res.status(404).json({ error: 'User không tồn tại.' });

    const { first_name, last_name, bio, location, phone, social_links, timezone } = req.body;
    if (timezone !== undefined) {
      if (timezone && !tzValid(timezone)) return res.status(400).json({ error: 'Múi giờ không hợp lệ.' });
      db.run('UPDATE users SET timezone = ? WHERE id = ?', [timezone && timezone !== VN_TZ ? timezone : null, targetId]);
    }
    if (first_name !== undefined) {
      if (!String(first_name).trim()) return res.status(400).json({ error: 'Tên không được để trống.' });
      db.run('UPDATE users SET first_name = ? WHERE id = ?', [toTitleCase(first_name), targetId]);
    }
    if (last_name !== undefined)  db.run('UPDATE users SET last_name = ? WHERE id = ?', [toTitleCase(last_name), targetId]);
    if (bio !== undefined)        db.run('UPDATE users SET bio = ? WHERE id = ?', [String(bio).slice(0, 300), targetId]);
    if (location !== undefined)   db.run('UPDATE users SET location = ? WHERE id = ?', [String(location).trim(), targetId]);
    if (phone !== undefined) {
      if (!validPhone(phone)) return res.status(400).json({ error: 'Số điện thoại chưa đúng hoặc thiếu số. Số Việt Nam phải đủ 10 số (VD: 0912345678); ở nước ngoài ghi +mã nước (VD: +61412345678).' });
      db.run('UPDATE users SET phone = ? WHERE id = ?', [normPhone(phone).slice(0, 20), targetId]);
    }
    if (social_links !== undefined) {
      const allowed = ['website', 'facebook', 'instagram', 'x', 'youtube', 'linkedin'];
      const clean = {};
      allowed.forEach(k => { if (social_links[k]) clean[k] = String(social_links[k]).trim().slice(0, 200); });
      db.run('UPDATE users SET social_links = ? WHERE id = ?', [JSON.stringify(clean), targetId]);
    }
    res.json({ success: true });
  });

  // Tự nhận múi giờ từ thiết bị (chỉ khi tài khoản chưa có — người dùng / admin đã chọn thì không ghi đè)
  app.post('/api/users/:id/timezone-detect', (req, res) => {
    const id = Number(req.params.id), tz = String(req.body?.timezone || '');
    if (!id || Number(req.body?.user_id) !== id || !tzValid(tz)) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
    const u = db.get('SELECT timezone FROM users WHERE id = ?', [id]);
    if (!u) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    if (!u.timezone && tz !== VN_TZ) db.run('UPDATE users SET timezone = ? WHERE id = ?', [tz, id]);
    res.json({ ok: true, timezone: u.timezone || (tz !== VN_TZ ? tz : null) });
  });
  app.patch('/api/admin/users/:id/timezone', requireAdmin, (req, res) => {
    const tz = String(req.body?.timezone || '');
    if (tz && !tzValid(tz)) return res.status(400).json({ error: 'Múi giờ không hợp lệ.' });
    db.run('UPDATE users SET timezone = ? WHERE id = ?', [tz && tz !== VN_TZ ? tz : null, Number(req.params.id)]);
    res.json({ ok: true });
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
          <a class="btn" href="${SITE_URL}/challenge.html">Xem trang thử thách</a>
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

  app.get('/api/admin/challenge-progress', requireAdmin, (req, res) => {
    try {
      const { challenge_id } = req.query;
      const challenges = db.all('SELECT id, title FROM challenges ORDER BY id');

      const enrollWhere = challenge_id ? 'WHERE e.challenge_id = ?' : '';
      const enrollParams = challenge_id ? [Number(challenge_id)] : [];
      const enrollments = db.all(`
        SELECT e.id AS enrollment_id, e.user_id, e.challenge_id, e.status AS enroll_status, e.enrolled_at, e.started_at,
               (u.first_name || ' ' || u.last_name) AS name, u.email, u.avatar_url AS avatar,
               c.title AS challenge_title,
               (SELECT COUNT(*) FROM challenge_days cd WHERE cd.challenge_id = c.id) AS total_days
        FROM challenge_enrollments e
        JOIN users u ON e.user_id = u.id
        JOIN challenges c ON e.challenge_id = c.id
        ${enrollWhere}
        ORDER BY e.challenge_id, u.first_name
      `, enrollParams);

      const subWhere = challenge_id ? 'WHERE cs.challenge_id = ?' : '';
      const subParams = challenge_id ? [Number(challenge_id)] : [];
      const submissions = db.all(`
        SELECT cs.user_id, cs.challenge_id, cd.day_number, cs.status, cs.is_late
        FROM challenge_submissions cs
        JOIN challenge_days cd ON cs.day_id = cd.id
        ${subWhere}
      `, subParams);

      const subMap = {};
      for (const s of submissions) {
        const key = `${s.user_id}_${s.challenge_id}`;
        if (!subMap[key]) subMap[key] = {};
        subMap[key][s.day_number] = { status: s.status, is_late: s.is_late };
      }

      const members = enrollments.map(e => {
        const key = `${e.user_id}_${e.challenge_id}`;
        const dayMap = subMap[key] || {};
        const totalDays = e.total_days || 21;
        let approved = 0, pending = 0, revision = 0, late = 0;
        const days = [];
        for (let d = 1; d <= totalDays; d++) {
          const entry = dayMap[d] || {};
          const st = entry.status || 'empty';
          days.push({ day: d, status: st, is_late: entry.is_late || 0 });
          if (st === 'approved') approved++;
          else if (st === 'pending') pending++;
          else if (st === 'needs_revision') revision++;
          if (entry.is_late) late++;
        }
        return {
          enrollment_id: e.enrollment_id,
          user_id: e.user_id,
          name: e.name,
          email: e.email,
          avatar: e.avatar,
          challenge_id: e.challenge_id,
          challenge_title: e.challenge_title,
          enroll_status: e.enroll_status,
          enrolled_at: e.enrolled_at,
          started_at: e.started_at || null,
          total_days: totalDays,
          days,
          stats: { approved, pending, revision, late, empty: totalDays - approved - pending - revision }
        };
      });

      const total = members.length;
      const active = members.filter(m => m.stats.approved > 0 || m.stats.pending > 0).length;
      const completed = members.filter(m => m.stats.approved === m.total_days).length;
      const avg_days = total > 0
        ? Math.round(members.reduce((sum, m) => sum + m.stats.approved, 0) / total)
        : 0;

      res.json({ challenges, members, summary: { total, active, completed, avg_days } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
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
      pushNotify(enroll.user_id, { title: 'Đã duyệt tham gia thử thách 🎉', body: 'Vào trang thử thách để bắt đầu.', link: 'challenge.html' });

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
            <a class="btn" href="${SITE_URL}/challenge.html">Bắt đầu thử thách ngay</a>
            <p style="margin-top:24px"><strong>📋 Nội quy cộng đồng</strong></p>
            <div class="rule">1️⃣ <strong>Cam kết hoàn thành:</strong> Nộp bài đúng hạn mỗi ngày. Mỗi ngày có deadline riêng — hãy kiểm tra trang thử thách.</div>
            <div class="rule">2️⃣ <strong>Nộp bài thật:</strong> Không copy bài của người khác. Screenshot, link, ảnh phải là kết quả thực tế của bạn.</div>
            <div class="rule">3️⃣ <strong>Tương tác tích cực:</strong> Comment, like, chia sẻ bài của thành viên khác. Cộng đồng mạnh khi mọi người cùng nhau.</div>
            <div class="rule">4️⃣ <strong>Tôn trọng nhau:</strong> Không spam, không chỉ trích tiêu cực. Feedback phải mang tính xây dựng.</div>
            <div class="rule">5️⃣ <strong>Chia sẻ học hỏi:</strong> Đăng bài lên Bảng Tin sau khi hoàn thành mỗi ngày — XP sẽ được nhân đôi!</div>
            <p style="color:#10b981;font-weight:600">Chúc bạn hoàn thành trọn vẹn thử thách! 💪</p>
          `)
        });
      }
    } else {
      db.run("UPDATE challenge_enrollments SET status = 'rejected' WHERE id = ?", [id]);
      db.run('INSERT INTO notifications (user_id, type, content) VALUES (?,?,?)',
        [enroll.user_id, 'enrollment_rejected', 'Yêu cầu tham gia thử thách chưa được chấp thuận.']);
      pushNotify(enroll.user_id, { title: 'Thử thách', body: 'Yêu cầu tham gia thử thách chưa được chấp thuận.', link: 'challenge.html' });
    }
    res.json({ success: true });
  });

  // ── Admin space groups ────────────────────────────────────────
  app.get('/api/admin/space-groups', requireAdmin, (_req, res) => {
    const groups = db.all('SELECT * FROM space_groups ORDER BY order_num ASC, created_at ASC');
    const spaces = db.all(`
      SELECT s.*, COUNT(p.id) AS post_count
      FROM spaces s LEFT JOIN posts p ON p.space_id = s.id
      GROUP BY s.id ORDER BY s.order_num ASC, s.created_at ASC
    `);
    const result = groups.map(g => ({ ...g, spaces: spaces.filter(s => s.group_id === g.id) }));
    res.json({ groups: result });
  });

  app.post('/api/admin/space-groups', requireAdmin, (req, res) => {
    const { name, order_num = 0 } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Tên group không được để trống.' });
    const r = db.run('INSERT INTO space_groups (name, order_num) VALUES (?,?)', [name.trim(), Number(order_num) || 0]);
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/space-groups/:id', requireAdmin, (req, res) => {
    const { name, order_num } = req.body;
    const g = db.get('SELECT id FROM space_groups WHERE id = ?', [req.params.id]);
    if (!g) return res.status(404).json({ error: 'Group không tồn tại.' });
    if (name !== undefined)      db.run('UPDATE space_groups SET name = ? WHERE id = ?', [name, req.params.id]);
    if (order_num !== undefined) db.run('UPDATE space_groups SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/space-groups/:id', requireAdmin, (req, res) => {
    const spaceIds = db.all('SELECT id FROM spaces WHERE group_id = ?', [req.params.id]).map(s => s.id);
    spaceIds.forEach(id => {
      const topicIds = db.all('SELECT id FROM topics WHERE space_id = ?', [id]).map(t => t.id);
      topicIds.forEach(tid => db.run('UPDATE posts SET topic_id = NULL WHERE topic_id = ?', [tid]));
      db.run('DELETE FROM topics WHERE space_id = ?', [id]);
      db.run('UPDATE posts SET space_id = NULL WHERE space_id = ?', [id]);
    });
    db.run('DELETE FROM spaces WHERE group_id = ?', [req.params.id]);
    db.run('DELETE FROM space_groups WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin spaces ─────────────────────────────────────────────
  app.get('/api/admin/spaces', requireAdmin, (_req, res) => {
    const spaces = db.all(`
      SELECT s.*, COUNT(p.id) AS post_count
      FROM spaces s LEFT JOIN posts p ON p.space_id = s.id
      GROUP BY s.id ORDER BY s.order_num ASC, s.created_at DESC
    `);
    res.json({ spaces });
  });

  app.post('/api/admin/spaces', requireAdmin, (req, res) => {
    const { name, icon = '💬', description = '', visibility = 'public', allow_join_requests = 1, order_num = 0, group_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Tên space không được để trống.' });
    if (!group_id) return res.status(400).json({ error: 'Vui lòng chọn Group cho Space.' });
    const vis = ['public', 'private', 'secret'].includes(visibility) ? visibility : 'public';
    const r = db.run(
      'INSERT INTO spaces (group_id, name, icon, description, visibility, allow_join_requests, order_num) VALUES (?,?,?,?,?,?,?)',
      [group_id, name.trim(), icon || '💬', description || '', vis, allow_join_requests ? 1 : 0, Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/spaces/:id', requireAdmin, (req, res) => {
    const { name, icon, description, visibility, allow_join_requests, order_num, group_id } = req.body;
    const s = db.get('SELECT id FROM spaces WHERE id = ?', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Space không tồn tại.' });
    if (name !== undefined)        db.run('UPDATE spaces SET name = ? WHERE id = ?', [name, req.params.id]);
    if (icon !== undefined)        db.run('UPDATE spaces SET icon = ? WHERE id = ?', [icon, req.params.id]);
    if (description !== undefined) db.run('UPDATE spaces SET description = ? WHERE id = ?', [description, req.params.id]);
    if (visibility !== undefined)  db.run('UPDATE spaces SET visibility = ? WHERE id = ?', [['public','private','secret'].includes(visibility) ? visibility : 'public', req.params.id]);
    if (allow_join_requests !== undefined) db.run('UPDATE spaces SET allow_join_requests = ? WHERE id = ?', [allow_join_requests ? 1 : 0, req.params.id]);
    if (order_num !== undefined)   db.run('UPDATE spaces SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    if (group_id !== undefined)    db.run('UPDATE spaces SET group_id = ? WHERE id = ?', [group_id, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/spaces/:id', requireAdmin, (req, res) => {
    const topicIds = db.all('SELECT id FROM topics WHERE space_id = ?', [req.params.id]).map(t => t.id);
    topicIds.forEach(id => db.run('UPDATE posts SET topic_id = NULL WHERE topic_id = ?', [id]));
    db.run('DELETE FROM topics WHERE space_id = ?', [req.params.id]);
    db.run('UPDATE posts SET space_id = NULL WHERE space_id = ?', [req.params.id]);
    db.run('DELETE FROM space_members WHERE space_id = ?', [req.params.id]);
    db.run('DELETE FROM spaces WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin topics ─────────────────────────────────────────────
  app.get('/api/admin/topics', requireAdmin, (_req, res) => {
    const topics = db.all(`
      SELECT t.*, s.name AS space_name, s.icon AS space_icon,
             (SELECT COUNT(*) FROM posts p WHERE p.topic_id = t.id) AS post_count
      FROM topics t JOIN spaces s ON s.id = t.space_id
      ORDER BY s.order_num ASC, t.order_num ASC, t.created_at ASC
    `);
    res.json({ topics });
  });

  app.post('/api/admin/topics', requireAdmin, (req, res) => {
    const { space_id, name, icon = '🏷️', order_num = 0 } = req.body;
    if (!space_id) return res.status(400).json({ error: 'Vui lòng chọn Space cho Topic.' });
    if (!name?.trim()) return res.status(400).json({ error: 'Tên Topic không được để trống.' });
    const r = db.run(
      'INSERT INTO topics (space_id, name, icon, order_num) VALUES (?,?,?,?)',
      [space_id, name.trim(), icon || '🏷️', Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/topics/:id', requireAdmin, (req, res) => {
    const { space_id, name, icon, order_num } = req.body;
    const t = db.get('SELECT id FROM topics WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Topic không tồn tại.' });
    if (space_id !== undefined) db.run('UPDATE topics SET space_id = ? WHERE id = ?', [space_id, req.params.id]);
    if (name !== undefined)     db.run('UPDATE topics SET name = ? WHERE id = ?', [name, req.params.id]);
    if (icon !== undefined)     db.run('UPDATE topics SET icon = ? WHERE id = ?', [icon || '🏷️', req.params.id]);
    if (order_num !== undefined) db.run('UPDATE topics SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/topics/:id', requireAdmin, (req, res) => {
    db.run('UPDATE posts SET topic_id = NULL WHERE topic_id = ?', [req.params.id]);
    db.run('DELETE FROM topics WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin pillars (trụ cột) ────────────────────────────────────
  app.get('/api/admin/pillars', requireAdmin, (_req, res) => {
    const pillars = db.all(`
      SELECT p.*, (SELECT COUNT(*) FROM posts po WHERE po.pillar = p.key) AS post_count
      FROM pillars p ORDER BY p.order_num ASC, p.created_at ASC
    `);
    res.json({ pillars });
  });

  app.post('/api/admin/pillars', requireAdmin, (req, res) => {
    const { label, icon = '🔥', color = '#0ea5e9', order_num = 0 } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: 'Tên trụ cột không được để trống.' });
    const key = uniquePillarKey(slugify(label));
    const r = db.run(
      'INSERT INTO pillars (key, label, icon, color, order_num) VALUES (?,?,?,?,?)',
      [key, label.trim(), icon || '🔥', color || '#0ea5e9', Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid, key });
  });

  app.patch('/api/admin/pillars/:id', requireAdmin, (req, res) => {
    const { label, icon, color, order_num } = req.body;
    const p = db.get('SELECT id FROM pillars WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Trụ cột không tồn tại.' });
    if (label !== undefined)     db.run('UPDATE pillars SET label = ? WHERE id = ?', [label, req.params.id]);
    if (icon !== undefined)      db.run('UPDATE pillars SET icon = ? WHERE id = ?', [icon || '🔥', req.params.id]);
    if (color !== undefined)     db.run('UPDATE pillars SET color = ? WHERE id = ?', [color || '#0ea5e9', req.params.id]);
    if (order_num !== undefined) db.run('UPDATE pillars SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/pillars/:id', requireAdmin, (req, res) => {
    const pillar = db.get('SELECT key FROM pillars WHERE id = ?', [req.params.id]);
    if (!pillar) return res.status(404).json({ error: 'Trụ cột không tồn tại.' });
    db.run('UPDATE posts SET pillar = NULL WHERE pillar = ?', [pillar.key]);
    db.run('DELETE FROM pillars WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Pillars (public) — used to populate the composer select + filter dropdowns
  app.get('/api/pillars', (_req, res) => {
    const pillars = db.all('SELECT id, key, label, icon, color FROM pillars ORDER BY order_num ASC, created_at ASC');
    res.json({ pillars });
  });

  // ══════════════════════════════════════════════════════════
  // NGŨ HÀNH TOOLS — foods lookup / recipes / meal journal
  // ══════════════════════════════════════════════════════════

  // ── Tra cứu thực phẩm ──────────────────────────────────────
  app.get('/api/foods', (req, res) => {
    const { q = '', element = '', color = '', taste = '', nature = '' } = req.query;
    let sql = 'SELECT id, name, element, color, taste, nature, organ, note FROM foods WHERE 1=1';
    const params = [];
    if (q)       { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
    if (element) { sql += ' AND element = ?'; params.push(element); }
    if (color)   { sql += ' AND color = ?'; params.push(color); }
    if (taste)   { sql += ' AND taste = ?'; params.push(taste); }
    if (nature)  { sql += ' AND nature = ?'; params.push(nature); }
    sql += ' ORDER BY element, order_num ASC, name ASC';
    res.json({ foods: db.all(sql, params) });
  });

  app.get('/api/admin/foods', requireAdmin, (_req, res) => {
    res.json({ foods: db.all('SELECT * FROM foods ORDER BY element, order_num ASC, name ASC') });
  });
  app.post('/api/admin/foods', requireAdmin, (req, res) => {
    const { name, element, color, taste, nature, organ, note, order_num } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Thiếu tên thực phẩm.' });
    const r = db.run(
      'INSERT INTO foods (name, element, color, taste, nature, organ, note, order_num) VALUES (?,?,?,?,?,?,?,?)',
      [name.trim(), element || null, color || null, taste || null, nature || null, organ || null, note || null, Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });
  app.patch('/api/admin/foods/:id', requireAdmin, (req, res) => {
    const f = db.get('SELECT id FROM foods WHERE id = ?', [req.params.id]);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy.' });
    ['name', 'element', 'color', 'taste', 'nature', 'organ', 'note', 'order_num'].forEach(k => {
      if (req.body[k] !== undefined)
        db.run(`UPDATE foods SET ${k} = ? WHERE id = ?`, [k === 'order_num' ? (Number(req.body[k]) || 0) : (req.body[k] || null), req.params.id]);
    });
    res.json({ success: true });
  });
  app.delete('/api/admin/foods/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM foods WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Thư viện công thức ─────────────────────────────────────
  app.get('/api/recipes', (req, res) => {
    const { q = '', element = '', buoi = '' } = req.query;
    let sql = 'SELECT id, title, element_tags, buoi, summary, dung_khi FROM recipes WHERE 1=1';
    const params = [];
    if (q)       { sql += ' AND (title LIKE ? OR summary LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (element) { sql += " AND (',' || element_tags || ',') LIKE ?"; params.push(`%,${element},%`); }
    if (buoi)    { sql += ' AND buoi = ?'; params.push(buoi); }
    sql += ' ORDER BY order_num ASC, id ASC';
    res.json({ recipes: db.all(sql, params) });
  });
  app.get('/api/recipes/:id', (req, res) => {
    const r = db.get('SELECT * FROM recipes WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy công thức.' });
    res.json({ recipe: r });
  });

  app.get('/api/admin/recipes', requireAdmin, (_req, res) => {
    res.json({ recipes: db.all('SELECT * FROM recipes ORDER BY order_num ASC, id ASC') });
  });
  app.post('/api/admin/recipes', requireAdmin, (req, res) => {
    const { title, element_tags, buoi, summary, ingredients, steps, dung_khi, note, order_num } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Thiếu tên công thức.' });
    const r = db.run(
      'INSERT INTO recipes (title, element_tags, buoi, summary, ingredients, steps, dung_khi, note, order_num) VALUES (?,?,?,?,?,?,?,?,?)',
      [title.trim(), element_tags || null, buoi || null, summary || null, ingredients || null, steps || null, dung_khi || null, note || null, Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });
  app.patch('/api/admin/recipes/:id', requireAdmin, (req, res) => {
    const rec = db.get('SELECT id FROM recipes WHERE id = ?', [req.params.id]);
    if (!rec) return res.status(404).json({ error: 'Không tìm thấy.' });
    ['title', 'element_tags', 'buoi', 'summary', 'ingredients', 'steps', 'dung_khi', 'note', 'order_num'].forEach(k => {
      if (req.body[k] !== undefined)
        db.run(`UPDATE recipes SET ${k} = ? WHERE id = ?`, [k === 'order_num' ? (Number(req.body[k]) || 0) : (req.body[k] || null), req.params.id]);
    });
    res.json({ success: true });
  });
  app.delete('/api/admin/recipes/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM recipes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Tài liệu PDF (Cẩm nang) ────────────────────────────────
  // File tải lên từ Admin lưu ở uploads/docs/ (công khai, có trong bản sao lưu)
  const DOC_DIR = path.join(__dirname, 'uploads', 'docs');
  fs.mkdirSync(DOC_DIR, { recursive: true });
  const docUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, DOC_DIR),
      filename: (_req, file, cb) => {
        const raw = file.originalname || 'tai-lieu';
        const name = /[^\x00-\xff]/.test(raw) ? raw : Buffer.from(raw, 'latin1').toString('utf8'); // busboy có thể đã giải mã UTF-8
        const base = path.basename(name, path.extname(name))
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
          .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tai-lieu';
        cb(null, `${base}-${Date.now().toString(36)}.pdf`);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
      cb(ok ? null : new Error('Chỉ nhận file PDF.'), ok);
    },
  });
  // Xoá file đã tải lên khi không còn tài liệu nào dùng
  function removeDocFile(url) {
    if (!url || !url.startsWith('/uploads/docs/')) return;
    if (db.get('SELECT id FROM camnang_docs WHERE pdf_url = ?', [url])) return;
    fs.unlink(path.join(DOC_DIR, path.basename(url)), () => {});
  }
  app.post('/api/admin/camnang-docs/upload', requireAdmin, (req, res) => {
    docUpload.single('file')(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File PDF tối đa 50MB.' : err.message });
      if (!req.file) return res.status(400).json({ error: 'Chưa chọn file.' });
      const fd = fs.openSync(req.file.path, 'r'), head = Buffer.alloc(5); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd);
      if (head.toString() !== '%PDF-') { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'File không phải PDF hợp lệ.' }); }
      res.json({ ok: true, url: `/uploads/docs/${req.file.filename}`, size: req.file.size });
    });
  });
  // ── Nhạc thư giãn 377 ngày: Admin tải mp3 lên; khách chọn bản mặc định, tự phát khi vào báo cáo hằng ngày ──
  db.exec(`CREATE TABLE IF NOT EXISTS music_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, mp3_url TEXT NOT NULL, note TEXT,
    order_num INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')))`);
  const musicUserCols = db.all('PRAGMA table_info(users)').map(c => c.name);
  if (!musicUserCols.includes('music_track_id')) db.exec('ALTER TABLE users ADD COLUMN music_track_id INTEGER');
  if (!musicUserCols.includes('music_autoplay')) db.exec('ALTER TABLE users ADD COLUMN music_autoplay INTEGER DEFAULT 1');
  // Bài từ YouTube: phát bằng trình phát chính thức (khung video nhỏ ≥ 200px theo điều khoản YouTube), mp3_url để trống
  if (!db.all('PRAGMA table_info(music_tracks)').some(c => c.name === 'youtube_id')) db.exec('ALTER TABLE music_tracks ADD COLUMN youtube_id TEXT');
  // Nhận link YouTube dạng watch?v=, youtu.be/, /embed/, /shorts/, /live/ hoặc nguyên mã nhúng <iframe>
  function parseYoutubeId(raw) {
    let s = String(raw || '').trim();
    const m = s.match(/<iframe[^>]*\ssrc\s*=\s*["']?([^"'\s>]+)/i);
    if (m) s = m[1].replace(/&amp;/g, '&');
    if (/^[\w-]{11}$/.test(s)) return s;
    let u; try { u = new URL(s); } catch { return null; }
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com')
      id = (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/) || [])[1] || u.searchParams.get('v');
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }
  const MUSIC_DIR = path.join(__dirname, 'uploads', 'music');
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  const musicUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, MUSIC_DIR),
      filename: (_req, file, cb) => {
        const raw = file.originalname || 'nhac';
        const name = /[^\x00-\xff]/.test(raw) ? raw : Buffer.from(raw, 'latin1').toString('utf8');
        const base = path.basename(name, path.extname(name))
          .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
          .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'nhac';
        cb(null, `${base}-${Date.now().toString(36)}.mp3`);
      },
    }),
    limits: { fileSize: 60 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /^audio\/(mpeg|mp3)$/.test(file.mimetype) || /\.mp3$/i.test(file.originalname || '');
      cb(ok ? null : new Error('Chỉ nhận file nhạc .mp3.'), ok);
    },
  });
  function removeMusicFile(url) {
    if (!url || !url.startsWith('/uploads/music/')) return;
    if (db.get('SELECT id FROM music_tracks WHERE mp3_url = ?', [url])) return;
    fs.unlink(path.join(MUSIC_DIR, path.basename(url)), () => {});
  }
  const musicUrlOk = u => /^\/uploads\/music\/[A-Za-z0-9._-]+\.mp3$/.test(u) || /^https:\/\/\S+$/i.test(u);
  app.post('/api/admin/music/upload', requireAdmin, (req, res) => {
    musicUpload.single('file')(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File nhạc tối đa 60MB.' : err.message });
      if (!req.file) return res.status(400).json({ error: 'Chưa chọn file.' });
      // mp3 hợp lệ: mở đầu bằng thẻ ID3 hoặc khung MPEG (0xFFEx)
      const fd = fs.openSync(req.file.path, 'r'), head = Buffer.alloc(3); fs.readSync(fd, head, 0, 3, 0); fs.closeSync(fd);
      if (head.toString() !== 'ID3' && !(head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'File không phải nhạc mp3 hợp lệ.' });
      }
      res.json({ ok: true, url: `/uploads/music/${req.file.filename}`, size: req.file.size });
    });
  });
  app.get('/api/admin/music', requireAdmin, (_req, res) => {
    res.json({ tracks: db.all(`SELECT t.*, (SELECT COUNT(*) FROM users u WHERE u.music_track_id = t.id) AS chosen_by
      FROM music_tracks t ORDER BY t.order_num ASC, t.id ASC`) });
  });
  app.post('/api/admin/music', requireAdmin, (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 150), url = String(req.body?.mp3_url || '').trim();
    const ytRaw = String(req.body?.youtube || '').trim(), ytId = ytRaw ? parseYoutubeId(ytRaw) : null;
    if (!title) return res.status(400).json({ error: 'Vui lòng nhập tên bản nhạc.' });
    if (ytRaw && !ytId) return res.status(400).json({ error: 'Link YouTube không hợp lệ (dán link dạng youtube.com/watch?v=… hoặc youtu.be/…).' });
    if (!ytId && !musicUrlOk(url)) return res.status(400).json({ error: 'Chưa có nhạc: tải file .mp3 lên, dán link https://…mp3, hoặc dán link YouTube.' });
    const order = db.get('SELECT COALESCE(MAX(order_num), 0) + 1 AS n FROM music_tracks').n;
    const r = db.run('INSERT INTO music_tracks (title, mp3_url, youtube_id, note, order_num) VALUES (?,?,?,?,?)',
      [title, ytId ? '' : url, ytId, String(req.body?.note || '').trim().slice(0, 300) || null, order]);
    res.json({ ok: true, id: r.lastInsertRowid });
  });
  app.put('/api/admin/music/:id', requireAdmin, (req, res) => {
    const t = db.get('SELECT * FROM music_tracks WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy bản nhạc.' });
    const b = req.body || {};
    const title = b.title !== undefined ? String(b.title).trim().slice(0, 150) : t.title;
    if (!title) return res.status(400).json({ error: 'Tên bản nhạc không được để trống.' });
    const url = b.mp3_url !== undefined ? String(b.mp3_url).trim() : t.mp3_url;
    if (!t.youtube_id && !musicUrlOk(url)) return res.status(400).json({ error: 'Link nhạc không hợp lệ.' });
    db.run('UPDATE music_tracks SET title = ?, mp3_url = ?, note = ?, order_num = ?, active = ? WHERE id = ?', [
      title, url,
      b.note !== undefined ? (String(b.note).trim().slice(0, 300) || null) : t.note,
      b.order_num !== undefined ? Number(b.order_num) || 0 : t.order_num,
      b.active !== undefined ? (b.active ? 1 : 0) : t.active,
      t.id,
    ]);
    if (url !== t.mp3_url) removeMusicFile(t.mp3_url);
    res.json({ ok: true });
  });
  app.delete('/api/admin/music/:id', requireAdmin, (req, res) => {
    const t = db.get('SELECT * FROM music_tracks WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy bản nhạc.' });
    db.run('DELETE FROM music_tracks WHERE id = ?', [t.id]);
    db.run('UPDATE users SET music_track_id = NULL WHERE music_track_id = ?', [t.id]);
    removeMusicFile(t.mp3_url);
    res.json({ ok: true });
  });
  // Khách: danh sách nhạc đang bật + bản mặc định của mình + có tự phát không
  app.get('/api/program377/music', (req, res) => {
    const me = userFromSession(req);
    if (!me) return res.status(401).json({ error: 'Vui lòng đăng nhập lại.', code: 'session_required' });
    const u = db.get('SELECT music_track_id, music_autoplay FROM users WHERE id = ?', [me.id]) || {};
    res.json({
      tracks: db.all('SELECT id, title, mp3_url, youtube_id, note FROM music_tracks WHERE active = 1 ORDER BY order_num ASC, id ASC'),
      default_id: u.music_track_id || null,
      autoplay: u.music_autoplay === null || u.music_autoplay === undefined ? true : !!u.music_autoplay,
    });
  });
  app.put('/api/program377/music/pref', (req, res) => {
    const me = userFromSession(req);
    if (!me) return res.status(401).json({ error: 'Vui lòng đăng nhập lại.', code: 'session_required' });
    const b = req.body || {};
    if (b.track_id !== undefined) {
      const id = b.track_id === null ? null : Number(b.track_id);
      if (id !== null && !db.get('SELECT id FROM music_tracks WHERE id = ? AND active = 1', [id])) return res.status(404).json({ error: 'Không tìm thấy bản nhạc.' });
      db.run('UPDATE users SET music_track_id = ? WHERE id = ?', [id, me.id]);
    }
    if (b.autoplay !== undefined) db.run('UPDATE users SET music_autoplay = ? WHERE id = ?', [b.autoplay ? 1 : 0, me.id]);
    res.json({ ok: true });
  });

  app.get('/api/camnang-docs', (_req, res) => {
    res.json({ docs: db.all('SELECT id, title, pdf_url, icon, note FROM camnang_docs ORDER BY order_num ASC, id ASC') });
  });
  app.get('/api/camnang-docs/:id', (req, res) => {
    const d = db.get('SELECT * FROM camnang_docs WHERE id = ?', [req.params.id]);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu.' });
    res.json({ doc: d });
  });
  app.get('/api/admin/camnang-docs', requireAdmin, (_req, res) => {
    res.json({ docs: db.all('SELECT * FROM camnang_docs ORDER BY order_num ASC, id ASC') });
  });
  app.post('/api/admin/camnang-docs', requireAdmin, (req, res) => {
    const { title, pdf_url, icon, note, order_num } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Thiếu tên tài liệu.' });
    if (!pdf_url?.trim()) return res.status(400).json({ error: 'Thiếu đường dẫn file PDF.' });
    const r = db.run(
      'INSERT INTO camnang_docs (title, pdf_url, icon, note, order_num) VALUES (?,?,?,?,?)',
      [title.trim(), pdf_url.trim(), icon?.trim() || '📄', note || null, Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });
  app.patch('/api/admin/camnang-docs/:id', requireAdmin, (req, res) => {
    const d = db.get('SELECT id, pdf_url FROM camnang_docs WHERE id = ?', [req.params.id]);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy.' });
    ['title', 'pdf_url', 'icon', 'note', 'order_num'].forEach(k => {
      if (req.body[k] !== undefined)
        db.run(`UPDATE camnang_docs SET ${k} = ? WHERE id = ?`, [k === 'order_num' ? (Number(req.body[k]) || 0) : (req.body[k] || null), req.params.id]);
    });
    if (req.body.pdf_url !== undefined && req.body.pdf_url !== d.pdf_url) removeDocFile(d.pdf_url);
    res.json({ success: true });
  });
  app.delete('/api/admin/camnang-docs/:id', requireAdmin, (req, res) => {
    const d = db.get('SELECT pdf_url FROM camnang_docs WHERE id = ?', [req.params.id]);
    db.run('DELETE FROM camnang_docs WHERE id = ?', [req.params.id]);
    if (d) removeDocFile(d.pdf_url);
    res.json({ success: true });
  });

  // ── Nhật ký ăn uống ────────────────────────────────────────
  app.get('/api/meal-logs', (req, res) => {
    const { user_id, from = '', to = '' } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    let sql = 'SELECT * FROM meal_logs WHERE user_id = ?';
    const params = [user_id];
    if (from) { sql += ' AND log_date >= ?'; params.push(from); }
    if (to)   { sql += ' AND log_date <= ?'; params.push(to); }
    sql += ' ORDER BY log_date DESC LIMIT 120';
    const logs = db.all(sql, params).map(l => ({
      ...l,
      colors: JSON.parse(l.colors || '[]'),
      tastes: JSON.parse(l.tastes || '[]'),
    }));
    const user = db.get('SELECT streak FROM users WHERE id = ?', [user_id]);
    res.json({ logs, streak: user?.streak || 0 });
  });

  // Hồ sơ cá nhân hoá của khách (thể trạng + lộ trình đã duyệt) — dùng để Agent 2
  // ("An Nhiên") nhận xét đúng theo từng người thay vì lời khuyên chung chung.
  // Dùng chung cho mọi nơi gọi callGoclawAgent2 (nhật ký ăn uống, và sau này là
  // báo cáo hằng ngày trong 377 ngày). Trả về '' nếu khách chưa có lộ trình được duyệt.
  function buildCustomerContext(userId) {
    const roadmap = db.get(
      `SELECT final_content, draft_content, the_trang, reviewed_at, created_at FROM ttm_roadmaps
       WHERE user_id = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1`,
      [userId]
    );
    if (!roadmap) return '';
    // Ngày lập lộ trình: để An Nhiên biết đây là điểm XUẤT PHÁT (có thể đã cũ), không phải tình trạng hôm nay
    const made = String(roadmap.reviewed_at || roadmap.created_at || '').slice(0, 10);
    const ago = made ? Math.max(0, Math.round((Date.now() + 7 * 3600e3 - new Date(made + 'T00:00:00Z').getTime()) / 864e5)) : null;
    const content = stripDraftBanner(roadmap.final_content || roadmap.draft_content || '');
    const parts = [];
    if (roadmap.the_trang) parts.push(`Thể trạng: ${roadmap.the_trang}`);
    if (content) parts.push(`Lộ trình thuận tự nhiên đã duyệt cho khách hàng này${made ? ` (lập ngày ${made.split('-').reverse().join('/')}${ago !== null ? ` — ${ago} ngày trước` : ''})` : ''}:\n${content}`);
    if (!parts.length) return '';
    return `[HỒ SƠ CÁ NHÂN HOÁ CỦA KHÁCH HÀNG — dùng để nhận xét/tư vấn đúng theo thể trạng và lộ trình riêng của người này, không đưa lời khuyên chung chung, không lặp lại nguyên văn lộ trình]\n`
      + 'LƯU Ý: lộ trình là ĐIỂM XUẤT PHÁT lúc khách mới bắt đầu. Tình trạng THỰC TẾ trong báo cáo hôm nay và các ngày gần đây luôn được ưu tiên hơn lộ trình. '
      + 'Vấn đề ghi trong lộ trình (vd khô họng, đau mỏi, táo bón…) mà các báo cáo gần đây không còn nhắc tới, hoặc khách báo sức khỏe bình thường, thì coi là ĐÃ CẢI THIỆN: '
      + 'chỉ nhắc như một thành quả để động viên ("tình trạng … lúc đầu đã cải thiện rõ"), KHÔNG tiếp tục tư vấn như đang có vấn đề đó. '
      + 'Chỉ tư vấn tiếp vấn đề trong lộ trình khi báo cáo gần đây vẫn còn dấu hiệu.\n'
      + `${parts.join('\n\n')}\n`;
  }

  // Hướng dẫn về vị gửi kèm mỗi lần An Nhiên nhận xét: ngoài 5 vị Ngũ Hành, chương trình theo dõi thêm
  // vị chát và chất béo (khách chọn được trong báo cáo / nhật ký) — An Nhiên phải nhắc tới khi nhận xét.
  const TASTE_GUIDE = '[HƯỚNG DẪN VỀ VỊ] Chương trình theo dõi 7 vị: 5 vị Ngũ Hành (chua, cay, đắng, mặn, ngọt) + VỊ CHÁT + CHẤT BÉO. '
    + 'Vị chát hỗ trợ Ruột (ví dụ: hạt óc chó, hạt điều, trà xanh, ổi, chuối chát, búp ổi). '
    + 'Chất béo TỐT hỗ trợ Mật (các loại hạt, dầu ô liu, dầu dừa, dầu lạc ép lạnh, mỡ cá, bơ). '
    + 'Khi nhận xét về vị: đếm trên 7 (vd "6/7 vị"); khen nếu có vị chát / chất béo tốt; nếu thiếu thì gợi ý 1–2 thực phẩm cụ thể, hợp thể trạng và mùa, nên ăn vào bữa nào; '
    + 'nếu chất béo là đồ chiên rán / mỡ động vật nhiều thì nhắc nhẹ đổi sang chất béo tốt. '
    + 'Thiếu vị (kể cả chát / chất béo) chỉ là góp ý ăn uống, KHÔNG phải lý do đặt FLAG warning/urgent — FLAG chỉ dùng cho dấu hiệu sức khỏe đáng lo.\n';

  // Builds the plain-text summary sent to Agent 2 — today's entry plus up to
  // 6 prior days for continuity ("bạn duy trì tốt 3 ngày liên tiếp", v.v.)
  function buildMealLogSummary(todayLog, recentLogs) {
    const lines = [TASTE_GUIDE, `Ngày: ${todayLog.log_date}`];
    if (todayLog.breakfast) lines.push(`Bữa sáng: ${todayLog.breakfast}`);
    if (todayLog.lunch)     lines.push(`Bữa trưa: ${todayLog.lunch}`);
    if (todayLog.dinner)    lines.push(`Bữa tối: ${todayLog.dinner}`);
    lines.push(`Màu sắc đã ăn: ${(JSON.parse(todayLog.colors || '[]')).join(', ') || 'không ghi'}`);
    lines.push(`Vị đã ăn: ${(JSON.parse(todayLog.tastes || '[]')).join(', ') || 'không ghi'}`);
    if (todayLog.note) lines.push(`Cảm nhận/ghi chú của khách: ${todayLog.note}`);
    const prior = (recentLogs || []).filter(r => r.log_date !== todayLog.log_date);
    if (prior.length) {
      lines.push('', 'Các ngày gần đây (để tham khảo xu hướng):');
      prior.forEach(r => {
        const c = JSON.parse(r.colors || '[]').join('/') || '-';
        const t = JSON.parse(r.tastes || '[]').join('/') || '-';
        lines.push(`- ${r.log_date}: màu ${c}, vị ${t}`);
      });
    }
    return lines.join('\n');
  }

  // Runs after the HTTP response is already sent — asks Agent 2 to comment on
  // today's entry, saves the result, and pushes it out over Telegram. Never
  // throws into the caller; any failure here must not affect the meal-log save.
  async function runAgent2Coaching(userId, logId, logDate) {
    try {
      const todayLog = db.get('SELECT * FROM meal_logs WHERE id = ?', [logId]);
      if (!todayLog) return;
      const recentLogs = db.all(
        'SELECT log_date, colors, tastes, breakfast, lunch, dinner FROM meal_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 7',
        [userId]
      );
      const summary = buildMealLogSummary(todayLog, recentLogs);
      const context = buildCustomerContext(userId);
      const input = context ? `${context}\n[BÁO CÁO HÔM NAY]\n${summary}` : summary;
      const result = await callGoclawAgent2(input);
      if (!result.ok) {
        console.error('  [Agent 2] lỗi gọi GoClaw:', result.error);
        return;
      }
      const { flagLevel, flaggedReason, feedback } = parseAgent2Response(result.text);
      db.run(
        'UPDATE meal_logs SET ai_feedback=?, flag_level=?, flagged_reason=? WHERE id=?',
        [feedback, flagLevel, flaggedReason || null, logId]
      );

      const user = db.get('SELECT first_name, telegram_chat_id FROM users WHERE id = ?', [userId]);
      if (user && user.telegram_chat_id && feedback) {
        const sendResult = await sendTelegramMessage(user.telegram_chat_id, feedback);
        if (sendResult.ok) {
          db.run("UPDATE meal_logs SET agent2_notified_at = datetime('now','localtime') WHERE id = ?", [logId]);
        } else {
          console.error('  [Agent 2] gửi Telegram cho khách thất bại:', sendResult.error || sendResult);
        }
      }

      if (flagLevel === 'warning' || flagLevel === 'urgent') {
        const admins = db.all("SELECT telegram_chat_id FROM users WHERE (is_admin = 1 OR agent2_alert_recipient = 1) AND COALESCE(agent2_notify_off, 0) = 0 AND status = 'active' AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''");
        const icon = flagLevel === 'urgent' ? '🚨' : '⚠️';
        const alertText = `${icon} <b>Cảnh báo ${flagLevel.toUpperCase()}</b>\nKhách: ${user ? user.first_name : 'user #' + userId}\nNgày: ${logDate}\nLý do: ${flaggedReason || '(không nêu rõ)'}\n\n${feedback}`;
        let anySent = false;
        for (const a of admins) {
          const r = await sendTelegramMessage(a.telegram_chat_id, alertText);
          if (r.ok) anySent = true;
        }
        if (anySent) {
          db.run("UPDATE meal_logs SET admin_notified_at = datetime('now','localtime') WHERE id = ?", [logId]);
        } else if (!admins.length) {
          console.error('  [Agent 2] có cờ cảnh báo nhưng chưa admin nào liên kết Telegram để báo động.');
        }
      }
    } catch (err) {
      console.error('  [Agent 2] lỗi xử lý coaching:', err.message);
    }
  }

  // Bản tổng kết báo cáo 377 ngày gửi Agent 2 — đầy đủ hơn nhật ký ăn uống (thêm nước tiểu,
  // phân, tập luyện, mồ hôi, cảm nhận) để An Nhiên ghi nhận đúng thay đổi sức khỏe từng ngày.
  function buildProgram377ReportSummary(todayReport, recentReports) {
    const lines = [TASTE_GUIDE, `Ngày báo cáo: ${todayReport.report_date} (ngày thứ ${todayReport.day_number || '?'}/377)`];
    if (todayReport.weight_kg) lines.push(`Cân nặng: ${todayReport.weight_kg} kg`);
    if (todayReport.meal_breakfast) lines.push(`Bữa sáng: ${todayReport.meal_breakfast}`);
    if (todayReport.meal_lunch)     lines.push(`Bữa trưa: ${todayReport.meal_lunch}`);
    if (todayReport.meal_dinner)    lines.push(`Bữa tối: ${todayReport.meal_dinner}`);
    lines.push(`Màu sắc đã ăn: ${(JSON.parse(todayReport.meal_colors || '[]')).join(', ') || 'không ghi'}`);
    lines.push(`Vị đã ăn: ${(JSON.parse(todayReport.meal_tastes || '[]')).join(', ') || 'không ghi'}`);
    if (todayReport.urine_amount || todayReport.urine_color)
      lines.push(`Nước tiểu: ${[todayReport.urine_amount, todayReport.urine_color].filter(Boolean).join(' — ')}`);
    if (todayReport.stool_shape || todayReport.stool_color)
      lines.push(`Phân: ${[todayReport.stool_shape, todayReport.stool_color].filter(Boolean).join(' — ')}`);
    if (todayReport.exercise_type)
      lines.push(`Tập luyện: ${todayReport.exercise_type}${todayReport.exercise_minutes ? ` (${todayReport.exercise_minutes} phút)` : ''}`);
    if (todayReport.sweat_amount || todayReport.sweat_taste)
      lines.push(`Mồ hôi: ${[todayReport.sweat_amount, todayReport.sweat_taste].filter(Boolean).join(' — ')}`);
    if (todayReport.feeling_note) lines.push(`Cảm nhận/biểu hiện cơ thể: ${todayReport.feeling_note}`);
    const prior = (recentReports || []).filter(r => r.report_date !== todayReport.report_date);
    if (prior.length) {
      lines.push('', 'Các ngày gần đây (để tham khảo xu hướng):');
      prior.forEach(r => {
        const c = JSON.parse(r.meal_colors || '[]').join('/') || '-';
        const t = JSON.parse(r.meal_tastes || '[]').join('/') || '-';
        // Kèm phân, mồ hôi, cảm nhận để An Nhiên thấy xu hướng sức khỏe (vd nhiều ngày "bình thường")
        const feel = String(r.feeling_note || '').replace(/\s+/g, ' ').trim();
        lines.push(`- ${r.report_date}: màu ${c}, vị ${t}, nước tiểu ${r.urine_amount || '-'}/${r.urine_color || '-'}, tập luyện ${r.exercise_type || '-'}${r.weight_kg ? `, cân nặng ${r.weight_kg} kg` : ''}`
          + `${r.stool_shape || r.stool_color ? `, phân ${[r.stool_shape, r.stool_color].filter(Boolean).join('/')}` : ''}`
          + `${r.sweat_amount || r.sweat_taste ? `, mồ hôi ${[r.sweat_amount, r.sweat_taste].filter(Boolean).join('/')}` : ''}`
          + `${feel ? `, cảm nhận: "${feel.length > 140 ? feel.slice(0, 140) + '…' : feel}"` : ''}`);
      });
    }
    return lines.join('\n');
  }

  // Giống hệt runAgent2Coaching (meal_logs) nhưng ghi vào program377_reports — dùng làm nội
  // dung tab "Kết quả" (thay đổi sức khỏe qua từng ngày, do An Nhiên ghi nhận tự động).
  // Nhận xét của 3 ngày trước (An Nhiên hoặc Ban tổ chức) gửi kèm để An Nhiên nối tiếp: hỏi lại việc đã dặn,
  // không lặp ý, thấy vấn đề kéo dài. Rút gọn (bỏ lời chào, mật ngôn, định dạng; ~450 ký tự / ngày) để An Nhiên
  // đọc nhanh, tránh quá giờ chờ.
  function condenseFeedback(text) {
    const all = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    // Giữ riêng câu mật ngôn đã dùng (ghi ngắn ở cuối) để An Nhiên không lặp lại
    const mantras = all.filter(l => /^\s*>/.test(l)).map(l => l.replace(/^\s*>\s*/, '').replace(/[*_`]/g, '').trim()).filter(Boolean).slice(0, 2);
    const lines = all
      .filter(l => !/^\s*>/.test(l))                                    // khối mật ngôn
      .filter(l => !/nhắm mắt.*hít thở|nhẩm câu này/i.test(l))           // lời dặn đọc mật ngôn
      .map(l => l.replace(/\*\*|__|#+\s*|`/g, '').replace(/^\s*[-*•]\s+/, '• ').trim())
      .filter(Boolean);
    if (lines.length > 1 && /^(chào|xin chào|hi\b|dear)/i.test(lines[0])) lines.shift();
    // Ưu tiên giữ câu DẶN DÒ (để hôm sau hỏi lại được), bỏ bớt lời khen / chúc ở đầu - cuối
    const sentences = lines.join(' ').replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+|(?=•)/).map(x => x.trim()).filter(Boolean);
    const ADVICE = /\b(hãy|nên|gợi ý|thêm|bổ sung|thay|giảm|hạn chế|tránh|nhớ|uống|ăn|tập|giãn|theo dõi|thử|đổi|duy trì|chú ý|lưu ý)\b/i;
    const picked = new Set(), budget = 450;
    let len = 0;
    for (const pass of [x => ADVICE.test(x) && !/^chúc\b/i.test(x), () => true]) {
      sentences.forEach((x, i) => { if (!picked.has(i) && pass(x) && len + x.length <= budget) { picked.add(i); len += x.length + 1; } });
    }
    let s = sentences.filter((_, i) => picked.has(i)).join(' ');
    if (!s) s = sentences.join(' ').slice(0, budget).replace(/\s+\S*$/, '') + '…';
    return s + (mantras.length ? ` [Mật ngôn đã dùng: ${mantras.map(m => `"${m}"`).join('; ')}]` : '');
  }
  function buildPriorFeedbackContext(userId, reportDate) {
    const rows = db.all(
      `SELECT report_date, day_number, ai_feedback, feedback_by FROM program377_reports
       WHERE user_id = ? AND report_date < ? AND ai_feedback IS NOT NULL AND ai_feedback <> ''
       ORDER BY report_date DESC LIMIT 3`, [userId, reportDate]);
    if (!rows.length) return '';
    const items = rows.map(r => `- ${r.report_date.split('-').reverse().join('/')}${r.day_number ? ` (ngày ${r.day_number})` : ''} — ${r.feedback_by === 'admin' ? 'Ban tổ chức' : 'An Nhiên'} đã nhận xét: ${condenseFeedback(r.ai_feedback)}`);
    return '[NHẬN XÉT CÁC NGÀY TRƯỚC — chỉ để nối tiếp, KHÔNG chép lại]\n'
      + 'BẮT BUỘC: ngay sau lời chào, viết 1 câu nối tiếp lời dặn GẦN NHẤT ở trên — đối chiếu với báo cáo hôm nay xem khách đã làm theo chưa: '
      + 'làm rồi thì khen cụ thể (vd "Hôm trước An Nhiên gợi ý thay cá chiên bằng hạt hạnh nhân, hôm nay anh đã…"), chưa làm thì nhắc nhẹ, động viên. '
      + 'Ngoài ra: (1) ghi nhận / hỏi lại việc đã dặn khách hôm trước (khách đã làm chưa, kết quả thế nào); '
      + '(2) KHÔNG lặp lại lời khuyên hay câu mật ngôn đã dùng — nếu khách chưa làm theo thì nhắc lại ngắn gọn bằng cách nói khác; '
      + '(3) nếu cùng một vấn đề xuất hiện từ 3 ngày trở lên, nói rõ là đang kéo dài và gợi ý đặt lịch Coach 1-1 hoặc hỏi Ban tổ chức. '
      + 'Nếu Ban tổ chức đã nhận xét, nối tiếp đúng tinh thần lời dặn của Ban tổ chức.\n'
      + items.join('\n') + '\n\n';
  }

  async function runProgram377Coaching(userId, reportId, reportDate) {
    try {
      const todayReport = db.get('SELECT * FROM program377_reports WHERE id = ?', [reportId]);
      if (!todayReport) return { ok: false, error: 'Không tìm thấy báo cáo.' };
      if (todayReport.feedback_by === 'admin') return { ok: false, error: 'Ban tổ chức đã tự nhận xét báo cáo này.' };
      db.run("UPDATE program377_reports SET ai_attempts = COALESCE(CAST(ai_attempts AS INTEGER), 0) + 1, ai_last_try = datetime('now','localtime') WHERE id = ?", [reportId]);
      const recentReports = db.all(
        'SELECT report_date, meal_colors, meal_tastes, urine_amount, urine_color, exercise_type, weight_kg, stool_shape, stool_color, sweat_amount, sweat_taste, feeling_note FROM program377_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT 7',
        [userId]
      );
      const summary = buildProgram377ReportSummary(todayReport, recentReports);
      const context = buildCustomerContext(userId);
      const history = buildPriorFeedbackContext(userId, todayReport.report_date);
      const input = `${context ? context + '\n' : ''}${history}[BÁO CÁO NGÀY THỨ ${todayReport.day_number || '?'}/377]\n${summary}`;
      const result = await callGoclawAgent2(input);
      if (!result.ok) {
        console.error('  [Agent 2 · 377 ngày] lỗi gọi GoClaw:', result.error);
        db.run('UPDATE program377_reports SET ai_error = ? WHERE id = ?', [String(result.error || '').slice(0, 300), reportId]);
        return { ok: false, error: result.error };
      }
      const { flagLevel, flaggedReason, feedback } = parseAgent2Response(result.text);
      if (!feedback) {
        db.run('UPDATE program377_reports SET ai_error = ? WHERE id = ?', ['An Nhiên trả về nội dung trống', reportId]);
        return { ok: false, error: 'An Nhiên trả về nội dung trống.' };
      }
      db.run(
        "UPDATE program377_reports SET ai_feedback=?, flag_level=?, flagged_reason=?, ai_error=NULL, feedback_by='annhien' WHERE id=?",
        [feedback, flagLevel, flaggedReason || null, reportId]
      );
      // Ngày báo cáo qua 377 ngày cũng được ghi đè sang meal_logs (cùng ngày) để dùng chung
      // streak/XP — đồng bộ luôn nhận xét AI vào đó, tránh trang Nhật ký ăn uống hiển thị mãi
      // "đang xem nhật ký..." vì meal_logs.ai_feedback không bao giờ được điền.
      db.run(
        'UPDATE meal_logs SET ai_feedback=?, flag_level=?, flagged_reason=? WHERE user_id=? AND log_date=?',
        [feedback, flagLevel, flaggedReason || null, userId, reportDate]
      );

      const user = db.get('SELECT first_name, telegram_chat_id FROM users WHERE id = ?', [userId]);
      if (user && user.telegram_chat_id && feedback) {
        const sendResult = await sendTelegramMessage(user.telegram_chat_id, feedback);
        if (sendResult.ok) {
          db.run("UPDATE program377_reports SET agent2_notified_at = datetime('now','localtime') WHERE id = ?", [reportId]);
        } else {
          console.error('  [Agent 2 · 377 ngày] gửi Telegram cho khách thất bại:', sendResult.error || sendResult);
        }
      }

      if (flagLevel === 'warning' || flagLevel === 'urgent') {
        const admins = db.all("SELECT telegram_chat_id FROM users WHERE (is_admin = 1 OR agent2_alert_recipient = 1) AND COALESCE(agent2_notify_off, 0) = 0 AND status = 'active' AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''");
        const icon = flagLevel === 'urgent' ? '🚨' : '⚠️';
        const alertText = `${icon} <b>Cảnh báo ${flagLevel.toUpperCase()} — 377 ngày</b>\nKhách: ${user ? user.first_name : 'user #' + userId}\nNgày: ${reportDate}\nLý do: ${flaggedReason || '(không nêu rõ)'}\n\n${feedback}`;
        for (const a of admins) await sendTelegramMessage(a.telegram_chat_id, alertText);
      }
      return { ok: true, feedback, flagLevel, flaggedReason };
    } catch (err) {
      console.error('  [Agent 2 · 377 ngày] lỗi xử lý coaching:', err.message);
      try { db.run('UPDATE program377_reports SET ai_error = ? WHERE id = ?', [String(err.message || '').slice(0, 300), reportId]); } catch {}
      return { ok: false, error: err.message };
    }
  }

  // Tự thử lại báo cáo chưa có nhận xét (An Nhiên quá giờ / lỗi): báo cáo 3 ngày gần nhất, lần thử trước cách
  // ≥ 15 phút, tối đa 4 lần; hết lượt → báo admin qua Telegram 1 lần để Ban tổ chức tự nhận xét. Mỗi lượt 1 báo cáo.
  const P377_AI_MAX_TRIES = 4;
  let p377RetryBusy = false;
  async function retryProgram377Coaching() {
    if (p377RetryBusy) return;
    p377RetryBusy = true;
    try {
      const r = db.get(`SELECT id, user_id, report_date FROM program377_reports
        WHERE (ai_feedback IS NULL OR ai_feedback = '') AND COALESCE(feedback_by, '') <> 'admin'
          AND report_date >= date('now','localtime','-2 days')
          AND COALESCE(CAST(ai_attempts AS INTEGER), 0) < ?
          AND (ai_last_try IS NULL OR ai_last_try < datetime('now','localtime','-15 minutes'))
          AND COALESCE(updated_at, created_at) < datetime('now','localtime','-3 minutes')
        ORDER BY id LIMIT 1`, [P377_AI_MAX_TRIES]);
      if (r) {
        const out = await runProgram377Coaching(r.user_id, r.id, r.report_date);
        console.log(`  [Agent 2 · 377 ngày] thử lại báo cáo #${r.id}: ${out?.ok ? 'đã có nhận xét' : 'chưa được — ' + (out?.error || '')}`);
      }
      // Hết lượt thử → báo admin 1 lần
      const dead = db.all(`SELECT r.id, r.report_date, r.ai_error, u.first_name, u.last_name FROM program377_reports r JOIN users u ON u.id = r.user_id
        WHERE (r.ai_feedback IS NULL OR r.ai_feedback = '') AND COALESCE(r.feedback_by, '') <> 'admin'
          AND COALESCE(CAST(r.ai_attempts AS INTEGER), 0) >= ? AND r.ai_fail_notified IS NULL AND r.report_date >= date('now','localtime','-3 days')`, [P377_AI_MAX_TRIES]);
      if (dead.length) {
        const admins = db.all("SELECT telegram_chat_id FROM users WHERE (is_admin = 1 OR agent2_alert_recipient = 1) AND COALESCE(agent2_notify_off, 0) = 0 AND status = 'active' AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''");
        const esc = t => String(t || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
        const text = `🌻 <b>An Nhiên chưa nhận xét được ${dead.length} báo cáo 377 ngày</b> (đã thử ${P377_AI_MAX_TRIES} lần):\n`
          + dead.map(d => `• ${esc(`${d.first_name || ''} ${d.last_name || ''}`.trim())} — ${d.report_date.split('-').reverse().join('/')}`).join('\n')
          + `\n\nVào Admin → 377 Ngày → Báo cáo hằng ngày → Xem để bấm "Nhờ An Nhiên nhận xét lại" hoặc Ban tổ chức tự nhận xét.\n${SITE_URL}/admin.html`;
        for (const a of admins) await sendTelegramMessage(a.telegram_chat_id, text);
        dead.forEach(d => db.run("UPDATE program377_reports SET ai_fail_notified = datetime('now','localtime') WHERE id = ?", [d.id]));
      }
    } catch (e) { console.error('  [Agent 2 · 377 ngày] thử lại:', e.message); }
    finally { p377RetryBusy = false; }
  }
  setInterval(retryProgram377Coaching, 5 * 60e3).unref?.();

  // Admin: báo cáo 30 ngày gần nhất chưa có nhận xét (khung trên bảng Báo cáo hằng ngày)
  app.get('/api/admin/program377/reports/pending-feedback', requireAdmin, (_req, res) => {
    const reports = db.all(`SELECT r.*, u.first_name, u.last_name, u.email FROM program377_reports r JOIN users u ON u.id = r.user_id
      WHERE (r.ai_feedback IS NULL OR r.ai_feedback = '') AND r.report_date >= date('now','localtime','-30 days')
      ORDER BY r.report_date DESC, r.id DESC LIMIT 100`)
      .map(r => ({ ...r, meal_colors: JSON.parse(r.meal_colors || '[]'), meal_tastes: JSON.parse(r.meal_tastes || '[]') }));
    res.json({ reports });
  });

  // Admin: nhờ An Nhiên nhận xét lại 1 báo cáo (chờ kết quả, tối đa ~90 giây)
  app.post('/api/admin/program377/reports/:id/coach', requireAdmin, async (req, res) => {
    const r = db.get('SELECT id, user_id, report_date, feedback_by FROM program377_reports WHERE id = ?', [Number(req.params.id) || 0]);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy báo cáo.' });
    if (r.feedback_by === 'admin') db.run("UPDATE program377_reports SET feedback_by = NULL WHERE id = ?", [r.id]);
    const out = await runProgram377Coaching(r.user_id, r.id, r.report_date);
    const row = db.get('SELECT ai_feedback, flag_level, flagged_reason, ai_attempts, ai_error, ai_last_try, feedback_by FROM program377_reports WHERE id = ?', [r.id]);
    if (!out?.ok) return res.status(409).json({ error: `An Nhiên chưa trả lời được: ${out?.error || 'lỗi không rõ'}. Bạn thử lại sau ít phút, hoặc tự nhận xét.`, report: row });
    res.json({ ok: true, report: row });
  });
  // Admin (Ban tổ chức) tự viết nhận xét: lưu vào báo cáo + nhật ký ăn uống, báo khách (chuông, điện thoại, Telegram)
  app.post('/api/admin/program377/reports/:id/feedback', requireAdmin, async (req, res) => {
    const r = db.get('SELECT id, user_id, report_date FROM program377_reports WHERE id = ?', [Number(req.params.id) || 0]);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy báo cáo.' });
    const text = String(req.body?.feedback || '').trim().slice(0, 4000);
    if (text.length < 5) return res.status(400).json({ error: 'Vui lòng viết nhận xét.' });
    db.run("UPDATE program377_reports SET ai_feedback = ?, flag_level = 'none', flagged_reason = NULL, ai_error = NULL, feedback_by = 'admin' WHERE id = ?", [text, r.id]);
    db.run("UPDATE meal_logs SET ai_feedback = ?, flag_level = 'none', flagged_reason = NULL WHERE user_id = ? AND log_date = ?", [text, r.user_id, r.report_date]);
    const title = '💬 Ban tổ chức đã nhận xét báo cáo của bạn';
    const body = `Báo cáo ngày ${r.report_date.split('-').reverse().join('/')} — bấm để xem nhận xét.`;
    try {
      db.run('INSERT INTO notifications (user_id, type, title, content, link) VALUES (?,?,?,?,?)', [r.user_id, 'system', title, body, 'program377.html#bao-cao']);
      pushNotify(r.user_id, { title, body, link: 'program377.html#bao-cao' });
      const u = db.get('SELECT telegram_chat_id FROM users WHERE id = ?', [r.user_id]);
      if (u?.telegram_chat_id) {
        const sent = await sendTelegramMessage(u.telegram_chat_id, `💬 <b>Ban tổ chức nhận xét báo cáo ngày ${r.report_date.split('-').reverse().join('/')}</b>\n\n${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}`);
        if (sent.ok) db.run("UPDATE program377_reports SET agent2_notified_at = datetime('now','localtime') WHERE id = ?", [r.id]);
      }
    } catch (e) { console.error('[377 admin feedback]', e.message); }
    res.json({ ok: true, report: db.get('SELECT ai_feedback, flag_level, flagged_reason, ai_attempts, ai_error, ai_last_try, feedback_by FROM program377_reports WHERE id = ?', [r.id]) });
  });

  app.post('/api/meal-logs', (req, res) => {
    const { user_id, log_date, breakfast, lunch, dinner, colors, tastes, note } = req.body;
    if (!user_id || !log_date || !/^\d{4}-\d{2}-\d{2}$/.test(log_date))
      return res.status(400).json({ error: 'Thiếu user_id hoặc ngày không hợp lệ.' });
    const colorsJson = JSON.stringify(Array.isArray(colors) ? colors : []);
    const tastesJson = JSON.stringify(Array.isArray(tastes) ? tastes : []);
    const existing = db.get('SELECT id FROM meal_logs WHERE user_id = ? AND log_date = ?', [user_id, log_date]);
    let logId;
    if (existing) {
      db.run(
        'UPDATE meal_logs SET breakfast=?, lunch=?, dinner=?, colors=?, tastes=?, note=? WHERE id=?',
        [breakfast || null, lunch || null, dinner || null, colorsJson, tastesJson, note || null, existing.id]
      );
      logId = existing.id;
    } else {
      db.run(
        'INSERT INTO meal_logs (user_id, log_date, breakfast, lunch, dinner, colors, tastes, note) VALUES (?,?,?,?,?,?,?,?)',
        [user_id, log_date, breakfast || null, lunch || null, dinner || null, colorsJson, tastesJson, note || null]
      );
      addXP(user_id, 3, 'meal_log', `Ghi nhật ký ăn uống ${log_date}`);
      logId = db.get('SELECT id FROM meal_logs WHERE user_id = ? AND log_date = ?', [user_id, log_date]).id;
    }
    const streak = recomputeStreak(user_id);
    res.json({ success: true, streak, new_entry: !existing });

    // Fire-and-forget: don't make the customer wait on the AI/Telegram round-trip.
    runAgent2Coaching(user_id, logId, log_date);
  });

  // ── Admin: Nhật ký ăn uống (view/moderate every member's meal logs) ──
  app.get('/api/admin/meal-logs', requireAdmin, (req, res) => {
    const { search = '', from = '', to = '', user_id = '', limit = 50, offset = 0 } = req.query;
    const like = `%${search}%`;
    let sql = `SELECT m.*, u.first_name, u.last_name, u.email
               FROM meal_logs m JOIN users u ON u.id = m.user_id
               WHERE (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)`;
    const params = [like, like, like];
    if (user_id) { sql += ' AND m.user_id = ?'; params.push(user_id); }
    if (from) { sql += ' AND m.log_date >= ?'; params.push(from); }
    if (to)   { sql += ' AND m.log_date <= ?'; params.push(to); }
    sql += ' ORDER BY m.log_date DESC, m.id DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const logs = db.all(sql, params).map(l => ({
      ...l,
      colors: JSON.parse(l.colors || '[]'),
      tastes: JSON.parse(l.tastes || '[]'),
    }));

    let cntSql = `SELECT COUNT(*) AS n FROM meal_logs m JOIN users u ON u.id = m.user_id
                  WHERE (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)`;
    const cntP = [like, like, like];
    if (user_id) { cntSql += ' AND m.user_id = ?'; cntP.push(user_id); }
    if (from) { cntSql += ' AND m.log_date >= ?'; cntP.push(from); }
    if (to)   { cntSql += ' AND m.log_date <= ?'; cntP.push(to); }
    const total = db.get(cntSql, cntP).n;

    res.json({ logs, total });
  });
  app.delete('/api/admin/meal-logs/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM meal_logs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Minigame công khai: Kiểm tra cơ thể Hàn - Nhiệt (thu lead) ──────
  // Nội dung lấy từ "bang-kiem-tra-han-nhiet.md" — 6 nhóm biểu hiện, mỗi nhóm
  // có các mục thuộc phe Hàn hoặc Nhiệt xen kẽ (không gắn nhãn khi hiển thị
  // cho khách, tránh gợi ý câu trả lời). Đây là bản rút gọn công khai, tính
  // điểm bằng công thức cố định — khác với khảo sát 29 câu + AI phân tích
  // (ttm_roadmaps) dành cho khách đã đăng ký.
  const HAN_NHIET_CATEGORIES = [
    {
      id: 'bieu_hien_ngoai', label: 'Biểu hiện ngoài thể chất',
      items: [
        { id: 'bh_h1', side: 'han', text: 'Tay lạnh, chân lạnh' },
        { id: 'bh_n1', side: 'nhiet', text: 'Môi khô' },
        { id: 'bh_h2', side: 'han', text: 'Da nhợt, nhạt màu' },
        { id: 'bh_n2', side: 'nhiet', text: 'Tay chân ấm, hoặc nóng rát' },
        { id: 'bh_h3', side: 'han', text: 'Mồ hôi lạnh, dính' },
        { id: 'bh_n3', side: 'nhiet', text: 'Mồ hôi ít, nóng' },
        { id: 'bh_h4', side: 'han', text: 'Phân lỏng, không thành khuôn' },
        { id: 'bh_n4', side: 'nhiet', text: 'Đại tiện táo, khô' },
      ],
    },
    {
      id: 'tieu_hoa', label: 'Hệ tiêu hóa & Ăn uống',
      items: [
        { id: 'th_h1', side: 'han', text: 'Ăn ít, ăn chậm' },
        { id: 'th_n1', side: 'nhiet', text: 'Ăn nhiều vẫn nhanh đói' },
        { id: 'th_h2', side: 'han', text: 'Khó tiêu, đầy bụng' },
        { id: 'th_n2', side: 'nhiet', text: 'Cảm giác nóng ruột, cồn cào' },
        { id: 'th_h3', side: 'han', text: 'Ăn đồ lạnh dễ tiêu chảy' },
        { id: 'th_n3', side: 'nhiet', text: 'Thích ăn đồ mát' },
      ],
    },
    {
      id: 'nhiet_do', label: 'Nhiệt độ thân thể',
      items: [
        { id: 'nd_h1', side: 'han', text: 'Thường xuyên cảm thấy lạnh' },
        { id: 'nd_n1', side: 'nhiet', text: 'Dễ bức bối, khó chịu' },
        { id: 'nd_h2', side: 'han', text: 'Sợ gió, sợ lạnh' },
        { id: 'nd_n2', side: 'nhiet', text: 'Ghét nóng, thích nơi mát' },
        { id: 'nd_h3', side: 'han', text: 'Thích nơi ấm, thích đắp chăn' },
        { id: 'nd_n3', side: 'nhiet', text: 'Cơ thể nóng bất thường' },
      ],
    },
    {
      id: 'da_di_ung', label: 'Vấn đề về da & Dị ứng',
      items: [
        { id: 'dd_h1', side: 'han', text: 'Mẩn ngứa âm ỉ' },
        { id: 'dd_n1', side: 'nhiet', text: 'Mụn viêm sưng đỏ' },
        { id: 'dd_h2', side: 'han', text: 'Mụn nước lạnh, mụn Herpes' },
        { id: 'dd_n2', side: 'nhiet', text: 'Viêm da, mẩn ngứa phát nóng' },
        { id: 'dd_h3', side: 'han', text: 'Lạnh dễ bị viêm xoang' },
        { id: 'dd_n3', side: 'nhiet', text: 'Dị ứng với thời tiết khô nóng' },
      ],
    },
    {
      id: 'thoi_diem', label: 'Thời điểm triệu chứng nặng hơn',
      items: [
        { id: 'td_h1', side: 'han', text: 'Lúc sáng sớm hoặc chiều tối' },
        { id: 'td_n1', side: 'nhiet', text: 'Giữa trưa hoặc chiều tối oi ả' },
        { id: 'td_h2', side: 'han', text: 'Khi bắt gặp gió lạnh' },
        { id: 'td_n2', side: 'nhiet', text: 'Khi thời tiết oi bức' },
      ],
    },
    {
      id: 'dau_hieu_dac_biet', label: 'Dấu hiệu đặc biệt cần lưu ý',
      items: [
        { id: 'db_h1', side: 'han', text: 'Rất dễ uể oải, mệt mỏi' },
        { id: 'db_n1', side: 'nhiet', text: 'Khó ngủ, dễ mất ngủ' },
        { id: 'db_h2', side: 'han', text: 'Cực kỳ sợ lạnh vào mùa đông' },
        { id: 'db_n2', side: 'nhiet', text: 'Dễ bị nhiệt miệng, nhiệt đầu' },
      ],
    },
  ];

  const HAN_NHIET_RESULT_INFO = {
    'Hàn': 'Năng lượng lạnh đang lấn át cơ thể bạn — cần ưu tiên ôn ấm, tăng vận động và ăn uống theo hướng ấm nóng.',
    'Nhiệt': 'Cơ thể bạn đang dư thừa sức nóng — cần thanh nhiệt, làm mát và điều chỉnh ăn uống theo hướng mát dịu.',
    'Hàn giả nhiệt': 'Bề ngoài có vẻ nóng bức nhưng gốc rễ cơ thể lại đang bị nhiễm lạnh sâu — cần được đánh giá kỹ để ôn ấm đúng chỗ, tránh làm mát nhầm hướng.',
    'Nhiệt giả hàn': 'Tay chân có thể lạnh nhưng bên trong đang bốc hỏa, bức bối — cần được đánh giá kỹ để thanh nhiệt đúng chỗ, tránh làm ấm nhầm hướng.',
  };

  // Công thức cố định (không AI) — dùng cho minigame công khai. hanRatio >=70%
  // hoặc <=30% thì kết luận rõ ràng; ở giữa (mix cả 2 phe) thì xếp vào 1 trong
  // 2 loại "giả" theo bên nào nổi trội hơn, đúng tinh thần "GIẢI MÃ CƠ THỂ"
  // trong tài liệu gốc. Không chọn khi 0 lựa chọn nào — trả về null, để client
  // nhắc khách chọn ít nhất vài mục cho kết quả có ý nghĩa.
  function classifyHanNhiet(hanCount, nhietCount) {
    const total = hanCount + nhietCount;
    if (total === 0) return null;
    const hanRatio = hanCount / total;
    if (hanRatio >= 0.7) return 'Hàn';
    if (hanRatio <= 0.3) return 'Nhiệt';
    return hanCount >= nhietCount ? 'Hàn giả nhiệt' : 'Nhiệt giả hàn';
  }

  // ── Quà tặng thu lead (lead magnet): trang công khai, khách để lại Họ tên + Email + SĐT để nhận nội dung ──
  // Nội dung lấy từ Thư viện công thức (admin sửa công thức → trang + email tự cập nhật).
  db.exec(`CREATE TABLE IF NOT EXISTS lead_magnet_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, magnet TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
    source TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), last_at TEXT
  )`);
  const LEAD_MAGNETS = {};
  const leadMagnetRecipe = m => db.get('SELECT * FROM recipes WHERE title = ?', [m.recipeTitle])
    || db.get('SELECT * FROM recipes WHERE LOWER(title) LIKE ? ORDER BY id DESC LIMIT 1', [m.recipeLike]);
  const lmCols = db.all('PRAGMA table_info(lead_magnet_signups)').map(c => c.name);
  if (!lmCols.includes('email_status')) db.run('ALTER TABLE lead_magnet_signups ADD COLUMN email_status TEXT');
  if (!lmCols.includes('email_at')) db.run('ALTER TABLE lead_magnet_signups ADD COLUMN email_at TEXT');

  // ── Email gửi công thức (CRM → Lead quà tặng: bật/tắt, sửa tiêu đề, xem trước, gửi thử) ──
  const lmSetting = (k, def) => db.get('SELECT value FROM site_settings WHERE key = ?', [k])?.value ?? def;
  const lmSetSetting = (k, v) => {
    if (db.get('SELECT key FROM site_settings WHERE key = ?', [k])) db.run('UPDATE site_settings SET value = ? WHERE key = ?', [v, k]);
    else db.run('INSERT INTO site_settings (key, value) VALUES (?,?)', [k, v]);
  };
  const magnetEmailOn = k => lmSetting('lead_magnet_email:' + k, '1') !== '0';
  const magnetSubjectDefault = m => `${m.emoji || '🍶'} {{first_name}} ơi, đây là công thức ${m.recipeTitle} của bạn`;
  const magnetSubject = k => lmSetting('lead_magnet_subject:' + k, '') || magnetSubjectDefault(LEAD_MAGNETS[k]);
  const emEsc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const emLines = t => String(t || '').split('\n')
    .map(l => l.replace(/^\s*(\d)️?⃣\s*/, '$1. ').replace(/^[\s✅✔☑️•·\-*>]+/u, '').trim()).filter(Boolean);
  // "Tên: chi tiết" → in đậm phần tên
  const emItem = l => {
    const i = l.indexOf(':');
    return i > 0 && i <= 70 && l.slice(i + 1).trim() ? `<b style="color:#0f172a;">${emEsc(l.slice(0, i))}:</b> ${emEsc(l.slice(i + 1).trim())}` : emEsc(l);
  };
  function emSection(icon, title, text, headRe) {
    const ls = emLines(text); if (!ls.length) return '';
    // Dòng đầu chỉ là tiêu đề (VD "Điểm then chốt trong Dưỡng Hóa 💗") → làm tiêu đề phần
    if (ls.length > 1 && !ls[0].includes(':') && headRe.test(ls[0])) title = ls.shift();
    const STEP = /^(bước\s*\d+)\s*[:.\-–]?\s*/i;
    let out = '', list = [];
    const flush = () => {
      if (list.length) out += `<ul style="margin:0 0 10px;padding-left:20px;color:#475569;line-height:1.65;">${list.map(x => `<li style="margin:5px 0;">${x}</li>`).join('')}</ul>`;
      list = [];
    };
    ls.forEach(l => {
      const s = l.match(STEP);
      if (s) { flush(); const rest = l.slice(s[0].length); out += `<p style="margin:14px 0 4px;font-weight:700;color:#14532d;">${emEsc(s[1].charAt(0).toUpperCase() + s[1].slice(1))}${rest ? ' — ' + emEsc(rest) : ''}</p>`; }
      else list.push(emItem(l));
    });
    flush();
    return `<h3 style="color:#14532d;font-size:17px;margin:26px 0 8px;padding-bottom:6px;border-bottom:2px solid #dcfce7;">${icon} ${emEsc(title)}</h3>${out}`;
  }
  function buildMagnetEmail(key, recipe, fullName) {
    const m = LEAD_MAGNETS[key];
    const first = String(fullName || '').trim().split(/\s+/).pop() || 'bạn';
    const join = `${SITE_URL}/register.html?src=email`;
    const html = `<p>Chào ${emEsc(first)},</p>
      <p>Cảm ơn bạn đã quan tâm. Đây là trọn công thức <b>${emEsc(recipe.title)}</b> từ AI AGENTS CC — bạn lưu email này lại để làm theo nhé.</p>
      ${recipe.summary ? `<p style="background:#fefce8;border-left:3px solid #eab308;padding:12px 16px;border-radius:0 8px 8px 0;">${emEsc(recipe.summary)}</p>` : ''}
      ${emSection('🧺', 'Nguyên liệu & dụng cụ', recipe.ingredients, /nguyên liệu|dụng cụ|chuẩn bị/i)}
      ${emSection('🥄', 'Cách làm', recipe.steps, /cách làm|quy trình/i)}
      ${emSection('⏳', m.dungKhiLabel || 'Khi nào dùng được', recipe.dung_khi, /khi nào|sử dụng|cách dùng/i)}
      ${emSection('🔑', 'Điểm then chốt', recipe.note, /then chốt|lưu ý|bí quyết/i)}
      <div style="margin-top:30px;padding:20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
        <p style="margin:0 0 6px;color:#14532d;font-size:17px;font-weight:700;">🏡 Chào mừng bạn đến AI Agents CC</p>
        <p style="margin:0 0 10px;">AI AGENTS CC là cộng đồng cùng nhau học ăn uống theo Ngũ Hành, thanh lọc cơ thể và sống thuận tự nhiên — có người hướng dẫn, có bạn đồng hành, có lộ trình rõ ràng.</p>
        <p style="margin:0 0 6px;">Cửa vào là <b>Workshop 3 buổi miễn phí qua Zoom</b>:</p>
        <ul style="margin:0 0 10px;padding-left:20px;color:#475569;line-height:1.6;">
          <li><b>Buổi 1 — Nhìn nhận sự thật:</b> nguyên tắc 5Đ và bài test cơ địa Hàn – Nhiệt của riêng bạn.</li>
          <li><b>Buổi 2 — Đánh thức cơ thể:</b> vì sao bệnh hay tái phát, thực hành Tác động Cột sống.</li>
          <li><b>Buổi 3 — Tái sinh toàn diện:</b> sức mạnh tâm thái, quy luật 4 mùa — và <b>${emEsc(m.hook || 'hướng dẫn mật ngôn')}</b>.</li>
        </ul>
        <p style="text-align:center;margin:16px 0 4px;"><a href="${join}" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Vào AI Agents CC miễn phí →</a></p>
      </div>
      <p style="margin-top:20px;">Ban tổ chức AI AGENTS CC</p>`;
    const subject = magnetSubject(key).replace(/\{\{\s*(first_name|name)\s*\}\}/g, first);
    return { subject, html: emailWrap(emEsc(recipe.title), html) };
  }
  const sendMagnetEmail = (key, recipe, to, fullName) => {
    const { subject, html } = buildMagnetEmail(key, recipe, fullName);
    return sendEmail({ to, subject, html });
  };
  const magnetRecipeObj = r => ({ title: r.title, summary: r.summary || '', dung_khi: r.dung_khi || '', ingredients: r.ingredients || '', steps: r.steps || '', note: r.note || '' });

  Object.values(LEAD_MAGNETS).forEach(m => {
    if (!m.seed || leadMagnetRecipe(m)) return;
    const [title, tags, buoi, summary, ingredients, steps, dung_khi, note] = m.seed;
    db.run('INSERT INTO recipes (title, element_tags, buoi, summary, ingredients, steps, dung_khi, note, order_num) VALUES (?,?,?,?,?,?,?,?,?)',
      [title, tags, buoi, summary, ingredients, steps, dung_khi, note, (db.get('SELECT MAX(order_num) AS n FROM recipes').n || 0) + 1]);
  });
  app.post('/api/lead-magnet/:key/signup', async (req, res) => {
    const m = LEAD_MAGNETS[req.params.key];
    if (!m) return res.status(404).json({ error: 'Không tìm thấy quà tặng.' });
    const b = req.body || {};
    const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    const source = String(b.src || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'web';
    if (name.length < 2) return res.status(400).json({ error: 'Vui lòng nhập họ tên.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Email chưa đúng, vui lòng kiểm tra lại.' });
    if (!validPhone(b.phone)) return res.status(400).json({ error: 'Số điện thoại chưa đúng hoặc thiếu số. Số Việt Nam phải đủ 10 số (VD: 0912345678).' });
    const phone = normPhone(b.phone).slice(0, 20);
    const r = leadMagnetRecipe(m);
    if (!r) return res.status(503).json({ error: 'Nội dung đang được cập nhật, bạn quay lại sau ít phút nhé.' });
    const user = db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email])
      || db.all("SELECT id, phone FROM users WHERE phone IS NOT NULL AND phone <> ''").find(u => normPhone(u.phone) === phone);
    const old = db.get('SELECT id, email, email_status FROM lead_magnet_signups WHERE magnet = ? AND (email = ? OR phone = ?)', [req.params.key, email, phone]);
    if (old) db.run("UPDATE lead_magnet_signups SET name = ?, email = ?, phone = ?, user_id = ?, last_at = datetime('now','localtime') WHERE id = ?", [name, email, phone, user?.id || null, old.id]);
    else db.run('INSERT INTO lead_magnet_signups (magnet, name, email, phone, source, user_id) VALUES (?,?,?,?,?,?)', [req.params.key, name, email, phone, source, user?.id || null]);
    const recipe = { title: r.title, summary: r.summary || '', dung_khi: r.dung_khi || '', ingredients: r.ingredients || '', steps: r.steps || '', note: r.note || '' };
    res.json({ ok: true, recipe, member: !!user });
    // Gửi công thức vào email (nếu Admin không tắt ở CRM → Lead quà tặng) + giới thiệu AI Agents CC.
    // Người cũ nhận lại: chỉ gửi khi chưa từng gửi thành công hoặc đổi sang email khác — không gửi lặp.
    if (magnetEmailOn(req.params.key) && (!old || old.email_status !== 'sent' || old.email !== email)) {
      const id = old ? old.id : db.get('SELECT id FROM lead_magnet_signups WHERE magnet = ? AND email = ? ORDER BY id DESC LIMIT 1', [req.params.key, email])?.id;
      sendMagnetEmail(req.params.key, recipe, email, name)
        .then(r => { if (id) db.run("UPDATE lead_magnet_signups SET email_status = ?, email_at = datetime('now','localtime') WHERE id = ?", [r.ok ? 'sent' : 'failed', id]); })
        .catch(() => {});
    }
  });
  // Công tắc form của từng quà tặng (Admin → Lead quà tặng). Tắt = công thức hiện thẳng, không cần để lại thông tin.
  const magnetFormOn = k => (db.get('SELECT value FROM site_settings WHERE key = ?', ['lead_magnet_form:' + k])?.value ?? '1') !== '0';
  const magnetCount = k => db.get('SELECT COUNT(*) AS n FROM lead_magnet_signups WHERE magnet = ?', [k]).n;
  app.get('/api/lead-magnet/:key/preview', (req, res) => {
    const m = LEAD_MAGNETS[req.params.key];
    if (!m) return res.status(404).json({ error: 'Không tìm thấy.' });
    const r = leadMagnetRecipe(m), form = magnetFormOn(req.params.key);
    const out = { title: r?.title || m.recipeTitle, summary: r?.summary || '', count: magnetCount(req.params.key), form };
    if (!form && r) out.recipe = { title: r.title, summary: r.summary || '', dung_khi: r.dung_khi || '', ingredients: r.ingredients || '', steps: r.steps || '', note: r.note || '' };
    res.json(out);
  });
  app.get('/api/admin/lead-magnets', requireAdmin, (_req, res) => {
    res.json({ magnets: Object.entries(LEAD_MAGNETS).map(([k, m]) => ({
      key: k, label: m.label, page: m.page, form_on: magnetFormOn(k), count: magnetCount(k),
      email_on: magnetEmailOn(k), email_subject: magnetSubject(k), email_subject_default: magnetSubjectDefault(m),
      emailed: db.get("SELECT COUNT(*) AS n FROM lead_magnet_signups WHERE magnet = ? AND email_status = 'sent'", [k]).n,
      email_failed: db.get("SELECT COUNT(*) AS n FROM lead_magnet_signups WHERE magnet = ? AND email_status = 'failed'", [k]).n,
      recipe_title: leadMagnetRecipe(m)?.title || '',
      last_at: db.get('SELECT MAX(COALESCE(last_at, created_at)) AS t FROM lead_magnet_signups WHERE magnet = ?', [k]).t || '',
    })) });
  });
  app.patch('/api/admin/lead-magnets/:key', requireAdmin, (req, res) => {
    if (!LEAD_MAGNETS[req.params.key]) return res.status(404).json({ error: 'Không tìm thấy quà tặng.' });
    const b = req.body || {}, k = req.params.key;
    if (b.form_on !== undefined) lmSetSetting('lead_magnet_form:' + k, b.form_on ? '1' : '0');
    if (b.email_on !== undefined) lmSetSetting('lead_magnet_email:' + k, b.email_on ? '1' : '0');
    if (b.email_subject !== undefined) lmSetSetting('lead_magnet_subject:' + k, String(b.email_subject || '').trim().slice(0, 200));
    res.json({ success: true, form_on: magnetFormOn(k), email_on: magnetEmailOn(k), email_subject: magnetSubject(k) });
  });
  // Xem trước email (dùng công thức thật trong Thư viện) + gửi thử tới 1 địa chỉ
  app.get('/api/admin/lead-magnets/:key/email-preview', requireAdmin, (req, res) => {
    const m = LEAD_MAGNETS[req.params.key];
    if (!m) return res.status(404).json({ error: 'Không tìm thấy quà tặng.' });
    const r = leadMagnetRecipe(m);
    if (!r) return res.status(404).json({ error: 'Chưa có công thức trong Thư viện công thức.' });
    res.json(buildMagnetEmail(req.params.key, magnetRecipeObj(r), String(req.query.name || 'Nguyễn Thị Lan')));
  });
  app.post('/api/admin/lead-magnets/:key/test-email', requireAdmin, async (req, res) => {
    const m = LEAD_MAGNETS[req.params.key];
    if (!m) return res.status(404).json({ error: 'Không tìm thấy quà tặng.' });
    const to = String(req.body?.to || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return res.status(400).json({ error: 'Địa chỉ email không hợp lệ.' });
    const r = leadMagnetRecipe(m);
    if (!r) return res.status(404).json({ error: 'Chưa có công thức trong Thư viện công thức.' });
    const out = await sendMagnetEmail(req.params.key, magnetRecipeObj(r), to, String(req.body?.name || ''));
    if (!out.ok) return res.status(502).json({ error: 'Gửi thất bại: ' + (out.error || 'lỗi không rõ') });
    res.json({ ok: true });
  });
  app.get('/api/admin/lead-magnets/:key/signups', requireAdmin, (req, res) => {
    if (!LEAD_MAGNETS[req.params.key]) return res.status(404).json({ error: 'Không tìm thấy quà tặng.' });
    const q = '%' + String(req.query.search || '').trim().toLowerCase() + '%';
    res.json({ signups: db.all(`SELECT l.id, l.name, l.email, l.phone, l.source, l.created_at, l.last_at, l.email_status, l.email_at,
        COALESCE(l.user_id, (SELECT u.id FROM users u WHERE LOWER(u.email) = l.email LIMIT 1)) AS user_id
      FROM lead_magnet_signups l WHERE l.magnet = ? AND (LOWER(l.name) LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)
      ORDER BY l.id DESC LIMIT 1000`, [req.params.key, q, q, q]) });
  });
  app.delete('/api/admin/lead-magnets/:key/signups/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM lead_magnet_signups WHERE id = ? AND magnet = ?', [req.params.id, req.params.key]);
    res.json({ success: true });
  });

  app.get('/api/han-nhiet-quiz/questions', (_req, res) => {
    res.json({ categories: HAN_NHIET_CATEGORIES.map(c => ({ id: c.id, label: c.label, items: c.items.map(i => ({ id: i.id, text: i.text })) })) });
  });

  app.post('/api/han-nhiet-quiz/submit', (req, res) => {
    const { name, phone, selectedItemIds } = req.body;
    if (!name?.trim() || !phone?.trim()) return res.status(400).json({ error: 'Vui lòng nhập tên và số điện thoại.' });
    const selectedSet = new Set(Array.isArray(selectedItemIds) ? selectedItemIds : []);
    let hanCount = 0, nhietCount = 0;
    HAN_NHIET_CATEGORIES.forEach(c => c.items.forEach(it => {
      if (selectedSet.has(it.id)) { if (it.side === 'han') hanCount++; else nhietCount++; }
    }));
    const resultType = classifyHanNhiet(hanCount, nhietCount) || 'Hàn giả nhiệt';
    db.run(
      'INSERT INTO han_nhiet_quiz_results (name, phone, han_count, nhiet_count, result_type, answers_json) VALUES (?,?,?,?,?,?)',
      [name.trim(), phone.trim(), hanCount, nhietCount, resultType, JSON.stringify([...selectedSet])]
    );
    res.json({ ok: true, hanCount, nhietCount, resultType, description: HAN_NHIET_RESULT_INFO[resultType] });
  });

  app.get('/api/admin/han-nhiet-quiz/results', requireAdmin, (req, res) => {
    const { search = '', limit = 50, offset = 0 } = req.query;
    const like = `%${search}%`;
    let sql = 'SELECT * FROM han_nhiet_quiz_results WHERE (name LIKE ? OR phone LIKE ?)';
    const params = [like, like];
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const results = db.all(sql, params);
    const total = db.get('SELECT COUNT(*) AS n FROM han_nhiet_quiz_results WHERE (name LIKE ? OR phone LIKE ?)', [like, like]).n;
    res.json({ results, total });
  });

  // ── Địa điểm tác động cột sống / hỗ trợ mua sản phẩm ──────────────
  const LOCATION_IMG_DIR = path.join(__dirname, 'uploads', 'locations');
  fs.mkdirSync(LOCATION_IMG_DIR, { recursive: true });
  const locationImageUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, LOCATION_IMG_DIR),
      filename: (req, file, cb) => {
        const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.(jpe?g|png|webp|gif)$/) || ['.jpg'])[0];
        cb(null, `loc${req.params.id}-${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
      cb(ok ? null : new Error('Chỉ nhận ảnh JPG, PNG, WEBP hoặc GIF.'), ok);
    },
  });
  const LOCATION_STATUSES = ['pending', 'approved', 'rejected', 'hidden'];
  const cleanText = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
  const cleanUrl = v => { const s = cleanText(v, 500); return /^https?:\/\//i.test(s) ? s : ''; };
  const cleanTime = v => { const s = cleanText(v, 5); return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null; };
  function removeLocationImage(url) {
    if (!url || !url.startsWith('/uploads/locations/')) return;
    fs.unlink(path.join(LOCATION_IMG_DIR, path.basename(url)), () => {});
  }

  // Công khai: chỉ địa điểm đã duyệt, không trả email / ghi chú admin
  app.get('/api/locations', (_req, res) => {
    const locations = db.all(`SELECT id, full_name, phone, place_name, address, description, map_url, image_url,
      open_time, close_time, do_spine, do_supply, certified FROM locations WHERE status = 'approved'
      ORDER BY sort_order ASC, approved_at DESC, id DESC`);
    res.json({ locations });
  });

  app.post('/api/locations/register', (req, res) => {
    const b = req.body || {};
    const full_name = cleanText(b.full_name, 120);
    const phone = cleanText(b.phone, 30);
    const email = cleanText(b.email, 160).toLowerCase();
    const doSpine = b.do_spine ? 1 : 0;
    const doSupply = b.do_supply ? 1 : 0;
    const certified = b.certified ? 1 : 0;
    if (!full_name) return res.status(400).json({ error: 'Vui lòng nhập họ và tên.' });
    if (!/^[0-9+().\s-]{8,20}$/.test(phone)) return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ.' });
    if (!doSpine && !doSupply) return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 hạng mục đăng ký.' });
    if (doSpine && !certified) return res.status(400).json({ error: 'Đăng ký làm tác động cột sống cần xác nhận đã có chứng chỉ do Y học bản địa Việt Nam cấp.' });
    const dup = db.get("SELECT id FROM locations WHERE phone = ? AND status = 'pending'", [phone]);
    if (dup) return res.status(409).json({ error: 'Số điện thoại này đã có đơn đăng ký đang chờ duyệt.' });
    const userId = Number(b.user_id) || null;
    const user = userId ? db.get('SELECT id FROM users WHERE id = ?', [userId]) : null;
    db.run(`INSERT INTO locations (user_id, full_name, phone, email, place_name, address, open_time, close_time,
      do_spine, do_supply, certified, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending')`,
      [user ? user.id : null, full_name, phone, email || null, cleanText(b.place_name, 160) || null,
       cleanText(b.address, 300) || null, cleanTime(b.open_time), cleanTime(b.close_time), doSpine, doSupply, certified]);
    res.json({ ok: true });
  });

  app.get('/api/admin/locations', requireAdmin, (req, res) => {
    const { status = '' } = req.query;
    const locations = LOCATION_STATUSES.includes(status)
      ? db.all('SELECT * FROM locations WHERE status = ? ORDER BY sort_order ASC, id DESC', [status])
      : db.all('SELECT * FROM locations ORDER BY sort_order ASC, id DESC');
    const counts = {};
    db.all('SELECT status, COUNT(*) AS n FROM locations GROUP BY status').forEach(r => { counts[r.status] = r.n; });
    res.json({ locations, counts });
  });

  function readLocationBody(b) {
    return {
      full_name: cleanText(b.full_name, 120),
      phone: cleanText(b.phone, 30),
      email: cleanText(b.email, 160).toLowerCase() || null,
      place_name: cleanText(b.place_name, 160) || null,
      address: cleanText(b.address, 300) || null,
      description: cleanText(b.description, 1000) || null,
      map_url: cleanUrl(b.map_url) || null,
      open_time: cleanTime(b.open_time),
      close_time: cleanTime(b.close_time),
      do_spine: b.do_spine ? 1 : 0,
      do_supply: b.do_supply ? 1 : 0,
      certified: b.certified ? 1 : 0,
      status: LOCATION_STATUSES.includes(b.status) ? b.status : 'approved',
      sort_order: Number.isFinite(Number(b.sort_order)) ? Math.trunc(Number(b.sort_order)) : 0,
      admin_note: cleanText(b.admin_note, 500) || null,
    };
  }

  app.post('/api/admin/locations', requireAdmin, (req, res) => {
    const l = readLocationBody(req.body || {});
    if (!l.full_name || !l.phone) return res.status(400).json({ error: 'Cần có họ tên và số điện thoại.' });
    const r = db.run(`INSERT INTO locations (full_name, phone, email, place_name, address, description, map_url,
      open_time, close_time, do_spine, do_supply, certified, status, sort_order, admin_note, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CASE WHEN ? = 'approved' THEN datetime('now','localtime') END)`,
      [l.full_name, l.phone, l.email, l.place_name, l.address, l.description, l.map_url,
       l.open_time, l.close_time, l.do_spine, l.do_supply, l.certified, l.status, l.sort_order, l.admin_note, l.status]);
    res.json({ ok: true, id: r.lastInsertRowid });
  });

  app.put('/api/admin/locations/:id', requireAdmin, (req, res) => {
    const cur = db.get('SELECT * FROM locations WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy địa điểm.' });
    const l = readLocationBody({ status: cur.status, ...req.body });
    if (!l.full_name || !l.phone) return res.status(400).json({ error: 'Cần có họ tên và số điện thoại.' });
    db.run(`UPDATE locations SET full_name=?, phone=?, email=?, place_name=?, address=?, description=?, map_url=?,
      open_time=?, close_time=?, do_spine=?, do_supply=?, certified=?, status=?, sort_order=?, admin_note=?,
      approved_at = CASE WHEN ? = 'approved' AND approved_at IS NULL THEN datetime('now','localtime') ELSE approved_at END,
      updated_at = datetime('now','localtime') WHERE id = ?`,
      [l.full_name, l.phone, l.email, l.place_name, l.address, l.description, l.map_url,
       l.open_time, l.close_time, l.do_spine, l.do_supply, l.certified, l.status, l.sort_order, l.admin_note, l.status, cur.id]);
    res.json({ ok: true });
  });

  app.patch('/api/admin/locations/:id/status', requireAdmin, (req, res) => {
    const { status } = req.body || {};
    if (!LOCATION_STATUSES.includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    const cur = db.get('SELECT id FROM locations WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy địa điểm.' });
    db.run(`UPDATE locations SET status = ?,
      approved_at = CASE WHEN ? = 'approved' AND approved_at IS NULL THEN datetime('now','localtime') ELSE approved_at END,
      updated_at = datetime('now','localtime') WHERE id = ?`, [status, status, cur.id]);
    res.json({ ok: true });
  });

  app.delete('/api/admin/locations/:id', requireAdmin, (req, res) => {
    const cur = db.get('SELECT id, image_url FROM locations WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy địa điểm.' });
    db.run('DELETE FROM locations WHERE id = ?', [cur.id]);
    removeLocationImage(cur.image_url);
    res.json({ ok: true });
  });

  app.post('/api/admin/locations/:id/image', requireAdmin, (req, res) => {
    const cur = db.get('SELECT id, image_url FROM locations WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy địa điểm.' });
    locationImageUpload.single('image')(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Ảnh tối đa 8MB.' : err.message });
      if (!req.file) return res.status(400).json({ error: 'Chưa chọn ảnh.' });
      const url = `/uploads/locations/${req.file.filename}`;
      db.run("UPDATE locations SET image_url = ?, updated_at = datetime('now','localtime') WHERE id = ?", [url, cur.id]);
      removeLocationImage(cur.image_url);
      res.json({ ok: true, image_url: url });
    });
  });

  app.delete('/api/admin/locations/:id/image', requireAdmin, (req, res) => {
    const cur = db.get('SELECT id, image_url FROM locations WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy địa điểm.' });
    db.run("UPDATE locations SET image_url = NULL, updated_at = datetime('now','localtime') WHERE id = ?", [cur.id]);
    removeLocationImage(cur.image_url);
    res.json({ ok: true });
  });

  // ── Form "Liên hệ Ban tổ chức" (lien-he.html) ──────────────────────
  const CONTACT_DEPARTMENTS = ['center', 'consult', 'payment', 'community'];
  const CONTACT_MSG_STATUSES = ['new', 'handled'];

  app.post('/api/contact-messages', (req, res) => {
    const b = req.body || {};
    const full_name = cleanText(b.full_name, 120);
    const phone = cleanText(b.phone, 30);
    const email = cleanText(b.email, 160).toLowerCase();
    const message = cleanText(b.message, 3000);
    if (!full_name) return res.status(400).json({ error: 'Vui lòng nhập họ và tên.' });
    if (!phone && !email) return res.status(400).json({ error: 'Vui lòng nhập số điện thoại hoặc email để BTC liên hệ lại.' });
    if (phone && !/^[0-9+().\s-]{8,20}$/.test(phone)) return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ.' });
    if (!CONTACT_DEPARTMENTS.includes(b.department)) return res.status(400).json({ error: 'Vui lòng chọn bộ phận muốn gửi.' });
    if (message.length < 5) return res.status(400).json({ error: 'Vui lòng nhập nội dung liên hệ.' });
    const userId = Number(b.user_id) || null;
    const user = userId ? db.get('SELECT id FROM users WHERE id = ?', [userId]) : null;
    db.run('INSERT INTO contact_messages (user_id, full_name, phone, email, department, message) VALUES (?,?,?,?,?,?)',
      [user ? user.id : null, full_name, phone || null, email || null, b.department, message]);
    res.json({ ok: true });
  });

  app.get('/api/admin/contact-messages', requireAdmin, (req, res) => {
    const { status = '', department = '' } = req.query;
    const where = [], params = [];
    if (CONTACT_MSG_STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
    if (CONTACT_DEPARTMENTS.includes(department)) { where.push('department = ?'); params.push(department); }
    const messages = db.all(`SELECT * FROM contact_messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY id DESC LIMIT 500`, params);
    const counts = {};
    db.all('SELECT status, COUNT(*) AS n FROM contact_messages GROUP BY status').forEach(r => { counts[r.status] = r.n; });
    res.json({ messages, counts });
  });

  app.patch('/api/admin/contact-messages/:id', requireAdmin, (req, res) => {
    const cur = db.get('SELECT id, status FROM contact_messages WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy tin nhắn.' });
    const b = req.body || {};
    const status = CONTACT_MSG_STATUSES.includes(b.status) ? b.status : cur.status;
    db.run(`UPDATE contact_messages SET status = ?,
      handled_at = CASE WHEN ? = 'handled' THEN COALESCE(handled_at, datetime('now','localtime')) ELSE NULL END
      ${b.admin_note !== undefined ? ', admin_note = ?' : ''} WHERE id = ?`,
      b.admin_note !== undefined ? [status, status, cleanText(b.admin_note, 1000) || null, cur.id] : [status, status, cur.id]);
    res.json({ ok: true });
  });

  app.delete('/api/admin/contact-messages/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM contact_messages WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  // ── Chương trình 377 ngày ──────────────────────────────────────────
  const PROGRAM377_TOPICS = [
    { key: 'dinh_duong_ngu_hanh',     label: 'Dinh dưỡng ngũ hành theo cơ địa Hàn/Nhiệt' },
    { key: 'chuyen_hoa_suc_khoe_goc', label: 'Chuyển hóa sức khỏe gốc — Lục phủ Ngũ tạng' },
    { key: 'khai_thong_kinh_lac',     label: 'Khai thông kinh lạc — Tác động cột sống' },
    { key: 'chu_ky_sinh_hoc',         label: 'Chu kỳ sinh học & tái tạo tế bào' },
    { key: 'phong_thuy_nha_o',        label: 'Điều hòa phong thủy nhà ở' },
    { key: 'phong_thuy_tai_chinh',    label: 'Phong thủy tài chính cá nhân & gia đình' },
    { key: 'chuyen_hoa_moi_quan_he',  label: 'Chuyển hóa mối quan hệ — Năm vòng tròn lỗi đạo' },
    { key: 'tu_duy_tam_thuc',         label: 'Làm chủ tư duy — Năm vòng tròn kiểm soát' },
    { key: 'lap_trinh_van_menh',      label: 'Lập trình vận mệnh' },
    { key: 'kinh_dich_than_tam',      label: 'Ứng dụng Kinh Dịch — cân bằng Thân-Tâm' },
  ];

  // "Ngày thứ mấy" của user tính theo lịch thật (date('now','localtime')) kể từ start_date —
  // mở khóa đúng lúc qua 0h, không lệch theo giờ họ bấm tham gia (khác cơ chế thử thách 21 ngày).
  // ── Admin: "Việc cần xử lý" — gom mọi thứ đang chờ admin vào 1 chỗ ─────────
  app.get('/api/admin/inbox', requireAdmin, (_req, res) => {
    const name = r => `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email || '—';
    const section = (key, countSql, listSql, map) => {
      try {
        return { key, count: db.get(countSql).n, items: db.all(listSql).map(map) };
      } catch (e) { return { key, count: 0, items: [] }; } // bảng chưa có (DB cũ) → bỏ qua
    };
    const sections = [
      section('health',
        "SELECT COUNT(*) AS n FROM health_visits WHERE status = 'submitted' AND user_id IN (SELECT id FROM users)",
        `SELECT v.submitted_at AS t, v.visit_date, u.first_name, u.last_name, u.email FROM health_visits v JOIN users u ON u.id = v.user_id
         WHERE v.status = 'submitted' ORDER BY v.submitted_at ASC LIMIT 5`,
        r => ({ title: name(r), sub: 'Lần khám ' + String(r.visit_date || '').split('-').reverse().join('/'), t: r.t })),
      section('roadmaps',
        "SELECT COUNT(*) AS n FROM ttm_roadmaps WHERE status = 'pending_approval' AND user_id IN (SELECT id FROM users)",
        `SELECT r.created_at AS t, u.first_name, u.last_name, u.email FROM ttm_roadmaps r JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending_approval' ORDER BY r.created_at DESC LIMIT 5`,
        r => ({ title: name(r), sub: 'Lộ trình Thân Tâm Mệnh chờ duyệt', t: r.t })),
      section('workshop8',
        "SELECT COUNT(*) AS n FROM workshop8_enrollments WHERE status = 'pending' AND user_id IN (SELECT id FROM users)",
        `SELECT e.enrolled_at AS t, u.first_name, u.last_name, u.email FROM workshop8_enrollments e JOIN users u ON u.id = e.user_id
         WHERE e.status = 'pending' ORDER BY e.enrolled_at DESC LIMIT 5`,
        r => ({ title: name(r), sub: r.email, t: r.t })),
      section('program377',
        "SELECT COUNT(*) AS n FROM program377_enrollments WHERE status = 'pending' AND user_id IN (SELECT id FROM users)",
        `SELECT e.enrolled_at AS t, u.first_name, u.last_name, u.email FROM program377_enrollments e JOIN users u ON u.id = e.user_id
         WHERE e.status = 'pending' ORDER BY e.enrolled_at DESC LIMIT 5`,
        r => ({ title: name(r), sub: r.email, t: r.t })),
      section('courses',
        "SELECT COUNT(*) AS n FROM course_enrollments WHERE status = 'pending' AND user_id IN (SELECT id FROM users)",
        `SELECT ce.created_at AS t, c.title AS course, u.first_name, u.last_name, u.email FROM course_enrollments ce
         JOIN users u ON u.id = ce.user_id JOIN courses c ON c.id = ce.course_id
         WHERE ce.status = 'pending' ORDER BY ce.created_at DESC LIMIT 5`,
        r => ({ title: name(r), sub: r.course, t: r.t })),
      section('coaching',
        "SELECT COUNT(*) AS n FROM coaching_bookings WHERE status = 'pending' AND user_id IN (SELECT id FROM users)",
        `SELECT b.created_at AS t, b.preferred_date, u.first_name, u.last_name, u.email FROM coaching_bookings b JOIN users u ON u.id = b.user_id
         WHERE b.status = 'pending' ORDER BY b.created_at DESC LIMIT 5`,
        r => ({ title: name(r), sub: r.preferred_date ? `Muốn hẹn: ${r.preferred_date}` : 'Đặt qua Google Calendar', t: r.t })),
      section('orders',
        "SELECT COUNT(*) AS n FROM orders WHERE status = 'pending' AND buyer_id IN (SELECT id FROM users)",
        `SELECT o.created_at AS t, p.title AS product, u.first_name, u.last_name, u.email FROM orders o
         JOIN users u ON u.id = o.buyer_id LEFT JOIN products p ON p.id = o.product_id
         WHERE o.status = 'pending' ORDER BY o.created_at DESC LIMIT 5`,
        r => ({ title: name(r), sub: r.product || 'Đơn hàng', t: r.t })),
      section('contact',
        "SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'",
        "SELECT created_at AS t, full_name, message FROM contact_messages WHERE status = 'new' ORDER BY id DESC LIMIT 5",
        r => ({ title: r.full_name, sub: String(r.message || '').slice(0, 80), t: r.t })),
      section('locations',
        "SELECT COUNT(*) AS n FROM locations WHERE status = 'pending'",
        "SELECT created_at AS t, full_name, place_name, address FROM locations WHERE status = 'pending' ORDER BY id DESC LIMIT 5",
        r => ({ title: r.place_name || r.full_name, sub: r.address || r.full_name, t: r.t })),
      section('challenge_enrollments',
        "SELECT COUNT(*) AS n FROM challenge_enrollments WHERE status = 'pending' AND user_id IN (SELECT id FROM users)",
        `SELECT e.enrolled_at AS t, c.title AS challenge, u.first_name, u.last_name, u.email FROM challenge_enrollments e
         JOIN users u ON u.id = e.user_id LEFT JOIN challenges c ON c.id = e.challenge_id
         WHERE e.status = 'pending' ORDER BY e.enrolled_at DESC LIMIT 5`,
        r => ({ title: name(r), sub: r.challenge || 'Thử thách', t: r.t })),
      section('submissions',
        "SELECT COUNT(*) AS n FROM challenge_submissions WHERE status = 'pending' AND user_id IN (SELECT id FROM users)",
        `SELECT s.submitted_at AS t, u.first_name, u.last_name, u.email FROM challenge_submissions s JOIN users u ON u.id = s.user_id
         WHERE s.status = 'pending' ORDER BY s.submitted_at DESC LIMIT 5`,
        r => ({ title: name(r), sub: 'Bài nộp thử thách', t: r.t })),
    ];
    res.json({ total: sections.reduce((s, x) => s + x.count, 0), sections });
  });

  // ── Admin: tiến độ 377 ngày của từng thành viên đã được duyệt ──────────
  // days: chuỗi 377 ký tự — r = đã báo cáo, m = bỏ lỡ (ngày đã qua chưa báo cáo),
  //       t = hôm nay chưa báo cáo, f = chưa tới.
  app.get('/api/admin/program377/progress', requireAdmin, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const rows = db.all(`
      SELECT e.user_id, e.start_date, e.approved_at, u.first_name, u.last_name, u.email
      FROM program377_enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.status = 'approved' ORDER BY e.start_date ASC, e.id ASC`);
    const TOTAL = 377;
    const members = rows
      .filter(r => !search || `${r.first_name} ${r.last_name || ''} ${r.email}`.toLowerCase().includes(search))
      .map(r => {
        const today = program377DayNumberToday(r.start_date); // 0 = chưa tới ngày bắt đầu
        const reported = new Set(db.all(
          `SELECT DISTINCT COALESCE(day_number, CAST(julianday(report_date) - julianday(?) AS INTEGER) + 1) AS d
           FROM program377_reports WHERE user_id = ?`, [r.start_date, r.user_id]
        ).map(x => Number(x.d)).filter(d => d >= 1 && d <= TOTAL));
        let days = '', missed = 0;
        for (let d = 1; d <= TOTAL; d++) {
          if (reported.has(d)) days += 'r';
          else if (d < today) { days += 'm'; missed++; }
          else if (d === today) days += 't';
          else days += 'f';
        }
        const elapsed = Math.min(Math.max(today, 0), TOTAL);           // số ngày đã tới (kể cả hôm nay)
        const due = Math.max(elapsed - (days[elapsed - 1] === 't' ? 1 : 0), 0); // ngày phải nộp tính tới hôm qua
        const lastReport = db.get('SELECT MAX(report_date) AS d FROM program377_reports WHERE user_id = ?', [r.user_id])?.d || null;
        return {
          user_id: r.user_id,
          name: `${r.first_name} ${r.last_name || ''}`.trim(),
          email: r.email,
          start_date: r.start_date,
          day_today: today,
          reported: reported.size,
          missed,
          remaining: TOTAL - elapsed,
          rate: due ? Math.round(Math.min(reported.size, due) / due * 100) : (reported.size ? 100 : 0),
          progress: Math.round(reported.size / TOTAL * 100),
          finished: today > TOTAL,
          last_report: lastReport,
          days,
        };
      });
    const active = members.filter(m => m.day_today >= 1 && !m.finished);
    res.json({
      total_days: TOTAL,
      summary: {
        members: members.length,
        active: active.length,
        finished: members.filter(m => m.finished).length,
        not_started: members.filter(m => m.day_today < 1).length,
        avg_rate: active.length ? Math.round(active.reduce((s, m) => s + m.rate, 0) / active.length) : 0,
      },
      members,
    });
  });

  // ── Admin: BÁO CÁO TỔNG HỢP 377 ngày (in PDF cho người hướng dẫn) ──────────
  // Trong 1 kỳ (from–to): tổng quan, ai nộp báo cáo đều mỗi ngày, ai cần chú ý (cảnh báo sức khoẻ của
  // An Nhiên, triệu chứng học viên tự ghi, bỏ báo cáo nhiều ngày) + chi tiết sức khoẻ từng người.
  const P377_SYMPTOMS = [
    // [nhãn, các cách viết (có dấu, hoặc cụm không dấu đủ rõ nghĩa)]
    ['Đau đầu', ['đau đầu', 'nhức đầu', 'dau dau', 'nhuc dau']], ['Chóng mặt', ['chóng mặt', 'hoa mắt', 'choáng', 'chong mat', 'hoa mat']],
    ['Mệt mỏi', ['mệt', 'kiệt sức', 'uể oải', 'met moi', 'kiet suc']], ['Mất ngủ', ['mất ngủ', 'khó ngủ', 'ngủ không ngon', 'mat ngu', 'kho ngu']],
    ['Táo bón', ['táo bón', 'tao bon', 'khó đi ngoài', 'phân cứng', 'phân khô']], ['Tiêu chảy', ['tiêu chảy', 'đi lỏng', 'phân lỏng', 'tieu chay', 'di long']],
    ['Đầy bụng / trào ngược', ['đầy bụng', 'chướng bụng', 'ợ chua', 'trào ngược', 'đầy hơi', 'day bung', 'trao nguoc']],
    ['Đau bụng', ['đau bụng', 'dau bung']], ['Buồn nôn', ['buồn nôn', 'nôn mửa', 'bị nôn', 'nôn ói', 'buon non']],
    ['Khó thở / tức ngực', ['khó thở', 'tức ngực', 'đau ngực', 'kho tho', 'tuc nguc']], ['Tim đập nhanh', ['hồi hộp', 'tim đập nhanh', 'đánh trống ngực']],
    ['Sốt / cảm', ['bị sốt', 'sốt cao', 'sốt nhẹ', 'cảm cúm', 'ho nhiều', 'sổ mũi', 'đau họng']], ['Ngứa / dị ứng', ['ngứa', 'nổi mẩn', 'dị ứng', 'mề đay', 'phát ban']],
    ['Phù / sưng', ['bị phù', 'phù nề', 'phù chân', 'phù mặt', 'sưng phù', 'bị sưng', 'sưng chân', 'sưng tay']], ['Tê / chuột rút', ['tê bì', 'tê tay', 'tê chân', 'chuột rút', 'vọp bẻ']],
    ['Đau nhức cơ khớp', ['đau lưng', 'đau khớp', 'đau vai', 'đau gối', 'nhức mỏi', 'đau cổ']],
    ['Căng thẳng / lo âu', ['căng thẳng', 'lo âu', 'stress', 'buồn bực', 'cáu gắt', 'trầm cảm']],
    ['Có máu', ['ra máu', 'có máu', 'lẫn máu', 'chảy máu']],
  ];
  const P377_URINE_WARN = /(vàng đậm|vang dam|nâu|nau dam|đỏ|hồng|đục|máu|sủi bọt|bọt nhiều)/i;
  const P377_STOOL_WARN = /(đen|đỏ|máu|trắng|xám|bạc màu)/i;
  function p377FindSymptoms(text) {
    const t = ' ' + String(text || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
    return P377_SYMPTOMS.filter(([, words]) => words.some(w => t.includes(' ' + w + ' '))).map(([label]) => label);
  }
  app.get('/api/admin/program377/summary-report', requireAdmin, (req, res) => {
    const today = tbToday();
    let to = tbValidDate(req.query.to) ? req.query.to : today;
    let from = tbValidDate(req.query.from) ? req.query.from : tbAddDays(to, -6);
    if (from > to) [from, to] = [to, from];
    if (from < tbAddDays(to, -61)) from = tbAddDays(to, -61);   // tối đa 62 ngày / báo cáo
    const dates = [];
    for (let d = from; d <= to; d = tbAddDays(d, 1)) dates.push(d);
    const TOTAL = 377;
    const rows = db.all(`SELECT e.user_id, e.start_date, u.first_name, u.last_name, u.email, u.phone,
        (SELECT the_trang FROM ttm_roadmaps r WHERE r.user_id = u.id AND r.the_trang IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS the_trang
      FROM program377_enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.status = 'approved' ORDER BY u.first_name, u.last_name`);
    const count = (arr) => { const m = {}; arr.filter(Boolean).forEach(v => { const k = String(v).trim(); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n })); };
    const members = rows.map(r => {
      const start = tbValidDate(r.start_date) ? r.start_date : null;
      const end = start ? tbAddDays(start, TOTAL - 1) : null;
      const dayToday = start ? Math.max(0, Math.round((Date.parse(today) - Date.parse(start)) / 864e5) + 1) : 0;
      const allDates = new Set(db.all('SELECT report_date FROM program377_reports WHERE user_id = ?', [r.user_id]).map(x => x.report_date));
      const reps = db.all(`SELECT * FROM program377_reports WHERE user_id = ? AND report_date BETWEEN ? AND ? ORDER BY report_date`, [r.user_id, from, to]);
      const byDate = Object.fromEntries(reps.map(x => [x.report_date, x]));
      // Ô từng ngày: n = chưa trong chương trình, f = chưa tới, r = đã nộp, l = nộp trễ, t = hôm nay chưa nộp, m = bỏ lỡ
      let due = 0, done = 0;
      const cells = dates.map(d => {
        const x = byDate[d];
        let c;
        if (!start || d < start || d > end) c = x ? (x.is_late ? 'l' : 'r') : 'n';
        else if (d > today) c = 'f';
        else if (x) c = Number(x.is_late) ? 'l' : 'r';
        else c = d === today ? 't' : 'm';
        if (start && d >= start && d <= end && d <= today && c !== 't') { due++; if (x) done++; }
        return { c, flag: x && ['warning', 'urgent'].includes(x.flag_level) ? x.flag_level : '' };
      });
      // Chuỗi nộp liên tiếp (tính tới hôm nay / hôm qua) và số ngày bỏ liên tiếp gần nhất
      let streak = 0, missRun = 0;
      if (start && dayToday >= 1) {
        let d = allDates.has(today) ? today : tbAddDays(today, -1);
        while (d >= start && allDates.has(d)) { streak++; d = tbAddDays(d, -1); }
        d = tbAddDays(today, -1);
        while (d >= start && d <= end && !allDates.has(d)) { missRun++; d = tbAddDays(d, -1); }
      }
      const flags = reps.filter(x => ['warning', 'urgent'].includes(x.flag_level))
        .map(x => ({ date: x.report_date, level: x.flag_level, reason: String(x.flagged_reason || '').slice(0, 300) }));
      // Triệu chứng học viên tự ghi (cảm nhận, vận động, mồ hôi…) + màu nước tiểu / phân bất thường
      const sym = {};
      const addSym = (label, d) => { (sym[label] = sym[label] || new Set()).add(d); };
      reps.forEach(x => {
        p377FindSymptoms([x.feeling_note, x.exercise_type, x.sweat_taste, x.sweat_amount, x.stool_shape, x.urine_amount].join(' . ')).forEach(l => addSym(l, x.report_date));
        if (P377_URINE_WARN.test(String(x.urine_color || ''))) addSym(`Nước tiểu: ${String(x.urine_color).trim().slice(0, 40)}`, x.report_date);
        if (P377_STOOL_WARN.test(String(x.stool_color || ''))) addSym(`Màu phân: ${String(x.stool_color).trim().slice(0, 40)}`, x.report_date);
      });
      const symptoms = Object.entries(sym).map(([label, set]) => ({ label, days: set.size, dates: [...set].sort() })).sort((a, b) => b.days - a.days);
      const exMins = reps.map(x => Number(x.exercise_minutes) || 0).filter(n => n > 0);
      const wts = reps.filter(x => Number(x.weight_kg) > 0);
      const weight = wts.length ? { first: wts[0].weight_kg, first_date: wts[0].report_date, last: wts[wts.length - 1].weight_kg,
        last_date: wts[wts.length - 1].report_date, change: Math.round((wts[wts.length - 1].weight_kg - wts[0].weight_kg) * 10) / 10, count: wts.length } : null;
      const lastNote = [...reps].reverse().find(x => String(x.feeling_note || '').trim());
      const lastAi = [...reps].reverse().find(x => String(x.ai_feedback || '').trim());
      const rate = due ? Math.round(done / due * 100) : null;
      const urgent = flags.some(f => f.level === 'urgent');
      const issues = [];
      if (urgent) issues.push('Có cảnh báo KHẨN từ An Nhiên');
      else if (flags.length) issues.push(`${flags.length} báo cáo có cảnh báo sức khoẻ`);
      if (missRun >= 3) issues.push(`Đã ${missRun} ngày liên tiếp không báo cáo`);
      if (rate !== null && due >= 3 && rate < 60) issues.push(`Tỉ lệ nộp báo cáo trong kỳ thấp (${rate}%)`);
      const strongSym = symptoms.filter(x => x.days >= 2 || /máu|Khó thở|Nước tiểu|Màu phân|Tim/.test(x.label));
      if (strongSym.length) issues.push('Triệu chứng lặp lại: ' + strongSym.slice(0, 4).map(x => `${x.label} (${x.days} ngày)`).join(', '));
      const level = urgent ? 'urgent' : (flags.length || missRun >= 3 || strongSym.length || (rate !== null && due >= 3 && rate < 60)) ? 'warning' : 'ok';
      const advice = [];
      if (urgent) advice.push('Gọi điện ngay trong hôm nay, hỏi tình trạng hiện tại; khuyên đi khám nếu dấu hiệu nặng.');
      if (!urgent && flags.length) advice.push('Đọc lại các báo cáo bị cảnh báo, nhắn hỏi thăm và điều chỉnh thực đơn / vận động.');
      if (strongSym.length) advice.push('Xem lại chế độ ăn, nước uống, vận động theo thể trạng; theo dõi thêm vài ngày.');
      if (missRun >= 3 || (rate !== null && due >= 3 && rate < 60)) advice.push('Nhắn Zalo hỏi lý do ngắt quãng, động viên quay lại nộp báo cáo mỗi ngày.');
      return {
        user_id: r.user_id, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), email: r.email, phone: r.phone || '',
        the_trang: r.the_trang || '', start_date: start, day_today: dayToday, finished: start ? dayToday > TOTAL : false,
        not_started: !start || dayToday < 1, reported_total: allDates.size, today_reported: allDates.has(today),
        due, done, rate, streak, miss_run: missRun, late: reps.filter(x => Number(x.is_late)).length, cells,
        flags, symptoms, level, issues, advice,
        exercise: { days: exMins.length, avg: exMins.length ? Math.round(exMins.reduce((a, b) => a + b, 0) / exMins.length) : 0, types: count(reps.map(x => x.exercise_type)).slice(0, 3) },
        weight,
        urine: count(reps.map(x => [x.urine_amount, x.urine_color].filter(Boolean).join(' — '))).slice(0, 3),
        stool: count(reps.map(x => [x.stool_shape, x.stool_color].filter(Boolean).join(' — '))).slice(0, 3),
        sweat: count(reps.map(x => [x.sweat_amount, x.sweat_taste].filter(Boolean).join(' — '))).slice(0, 3),
        last_note: lastNote ? { date: lastNote.report_date, text: String(lastNote.feeling_note).slice(0, 500) } : null,
        last_ai: lastAi ? { date: lastAi.report_date, text: String(lastAi.ai_feedback).slice(0, 600) } : null,
      };
    });
    const active = members.filter(m => !m.not_started && !m.finished);
    const rated = active.filter(m => m.rate !== null);
    // Mỗi ngày trong kỳ: bao nhiêu học viên phải nộp / đã nộp
    const daily = dates.map((d, i) => {
      let need = 0, got = 0;
      members.forEach(m => { const c = m.cells[i].c; if ('rlmt'.includes(c)) { need++; if ('rl'.includes(c)) got++; } });
      return { date: d, need, got, flags: members.filter(m => m.cells[i].flag).length };
    });
    res.json({
      from, to, today, dates, total_days: TOTAL, generated_at: calNowVN(),
      summary: {
        members: members.length, active: active.length, finished: members.filter(m => m.finished).length,
        not_started: members.filter(m => m.not_started).length,
        avg_rate: rated.length ? Math.round(rated.reduce((s, m) => s + m.rate, 0) / rated.length) : null,
        reports: members.reduce((s, m) => s + m.done, 0),
        full: rated.filter(m => m.rate === 100).length,
        urgent: members.filter(m => m.level === 'urgent').length, warning: members.filter(m => m.level === 'warning').length,
        flags: members.reduce((s, m) => s + m.flags.length, 0),
        today_reported: active.filter(m => m.today_reported).length,
      },
      daily, members,
    });
  });

  function program377DayNumberToday(startDate) {
    if (!startDate) return 0;
    const row = db.get(
      "SELECT CAST(julianday(date('now','localtime')) - julianday(?) AS INTEGER) + 1 AS n",
      [startDate]
    );
    return row ? Math.max(row.n, 0) : 0;
  }

  // Ngày dương lịch thực tế ứng với "ngày thứ N" của 1 user cụ thể — vì mỗi
  // người có start_date khác nhau, ngày thứ N của người này có thể rơi vào mùa
  // khác với người kia, nên không thể gán cứng mùa theo day_number.
  function program377CalendarDate(startDate, dayNumber) {
    const row = db.get("SELECT date(?, ?) AS d", [startDate, `+${dayNumber - 1} days`]);
    return row ? row.d : startDate;
  }

  // Thể trạng + bản đồ ưu tiên từ lộ trình Thân-Tâm-Mệnh đã duyệt gần nhất —
  // dùng để lắp ghép nội dung 377 ngày đúng theo từng người (tái dùng cùng
  // nguồn dữ liệu với buildCustomerContext, nhưng trả object thay vì text).
  function getUserTtmProfile(userId) {
    const roadmap = db.get(
      `SELECT the_trang, priority_map_json FROM ttm_roadmaps
       WHERE user_id = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1`,
      [userId]
    );
    if (!roadmap) return { theTrang: null, priorityMap: null };
    let priorityMap = null;
    try { priorityMap = JSON.parse(roadmap.priority_map_json || 'null'); } catch (e) { priorityMap = null; }
    return { theTrang: roadmap.the_trang || null, priorityMap };
  }

  // Chọn 1 khối nội dung đã xuất bản cho 1 category, khớp giảm dần: đúng cả
  // mùa lẫn thể trạng → đúng mùa (thể trạng 'all') → đúng thể trạng (mùa 'all')
  // → khối chung ('all'/'all'). Luôn trả về khối nào đó nếu có ít nhất 1 khối
  // published cho category này — không bao giờ để trống 1 mục trong ngày.
  function pickProgram377Block(category, season, theTrang) {
    const candidates = [
      [season, theTrang || 'all'],
      [season, 'all'],
      ['all', theTrang || 'all'],
      ['all', 'all'],
    ];
    for (const [s, t] of candidates) {
      const row = db.get(
        `SELECT * FROM program377_content_blocks
         WHERE category = ? AND season = ? AND the_trang = ? AND status = 'published'
         ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
        [category, s, t]
      );
      if (row) return row;
    }
    return null;
  }

  // Lắp ghép nội dung đầy đủ của 1 ngày cho 1 user cụ thể: 6 mục cố định (chọn
  // đúng khối theo mùa thực tế + thể trạng của người này, trừ khi admin đã ghim
  // cứng 1 khối cụ thể cho mục đó qua blockOverrides) + dòng cá nhân hoá rút từ
  // bản đồ ưu tiên + bài học liên kết (nếu có).
  function resolveProgram377DayContent(userId, dayNumber, startDate, blockOverrides) {
    const calendarDate = program377CalendarDate(startDate, dayNumber);
    const season = seasonForDate(calendarDate);
    const { theTrang, priorityMap } = getUserTtmProfile(userId);

    const blocks = PROGRAM377_BLOCK_CATEGORIES.map((category) => {
      const overrideId = blockOverrides && blockOverrides[category];
      // Khối ghim cứng phải còn tồn tại và đã xuất bản, nếu không thì rơi về
      // tự động chọn theo mùa/thể trạng như bình thường — không bao giờ để
      // trống 1 mục chỉ vì khối được ghim đã bị xoá/chuyển về nháp.
      const block = (overrideId && db.get(
        `SELECT * FROM program377_content_blocks WHERE id = ? AND category = ? AND status = 'published'`,
        [overrideId, category]
      )) || pickProgram377Block(category, season, theTrang);
      return {
        category,
        title: block ? block.title : null,
        bodyHtml: block ? block.body_html : null,
      };
    });

    let personalizedNote = null;
    if (Array.isArray(priorityMap)) {
      const topPriority = priorityMap.find(p => p && p.priority === 'Cao');
      if (topPriority) personalizedNote = `Ưu tiên của bạn hôm nay: ${topPriority.area}${topPriority.status ? ` — ${topPriority.status}` : ''}`;
    }

    return { calendarDate, season, theTrang, blocks, personalizedNote };
  }

  app.get('/api/program377/status', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'Thiếu user_id' });
    const enrollment = db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [userId]);
    if (!enrollment) return res.json({ enrollment: null });
    const dayNumberToday = enrollment.status === 'approved'
      ? Math.min(program377DayNumberToday(enrollment.start_date), 377)
      : 0;
    const todayStr = db.get("SELECT date('now','localtime') AS d").d;
    const todayReport = db.get('SELECT * FROM program377_reports WHERE user_id = ? AND report_date = ?', [userId, todayStr]);
    res.json({
      enrollment: { status: enrollment.status, startDate: enrollment.start_date, adminNote: enrollment.admin_note },
      dayNumberToday,
      totalDays: 377,
      todayReport: todayReport
        ? { ...todayReport, meal_colors: JSON.parse(todayReport.meal_colors || '[]'), meal_tastes: JSON.parse(todayReport.meal_tastes || '[]') }
        : null,
    });
  });

  app.post('/api/program377/enroll', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id' });
    const existing = db.get('SELECT id, status FROM program377_enrollments WHERE user_id = ?', [user_id]);
    if (existing && existing.status !== 'rejected') return res.status(409).json({ error: 'Bạn đã đăng ký chương trình này rồi.' });
    // Đã bị từ chối trước đó → cho đăng ký lại: đơn cũ quay về "chờ duyệt" như đơn mới
    const eid = existing
      ? (db.run(`UPDATE program377_enrollments SET status = 'pending', enrolled_at = datetime('now','localtime'), approved_at = NULL, approved_by = NULL, admin_note = NULL
          WHERE id = ?`, [existing.id]), existing.id)
      : db.run('INSERT INTO program377_enrollments (user_id, status) VALUES (?, ?)', [user_id, 'pending']).lastInsertRowid;
    res.status(201).json({ ok: true });
    notifyEnrollRequested(user_id, '377 ngày thực hành', 'program377.html');
    antamNotify('p377', eid, `🗓️ <b>Đăng ký 377 ngày thực hành</b> — chờ duyệt\n\n${antamWho(user_id)}\n\nDuyệt ngay bên dưới hoặc trong admin: ${SITE_URL}/admin.html`);
  });

  // ── 8 Buổi Chuyên Sâu — đăng ký chờ duyệt thủ công (như 377 ngày, không
  // qua đơn hàng/marketplace vì thanh toán xử lý ngoài hệ thống) ───────
  app.get('/api/workshop8/status', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'Thiếu user_id' });
    let enrollment = db.get('SELECT * FROM workshop8_enrollments WHERE user_id = ?', [userId]);
    // Gói 377 ngày bao gồm 8 Buổi Chuyên Sâu → học viên 377 đã duyệt xem trang 8 buổi như đã được duyệt
    if ((!enrollment || enrollment.status !== 'approved') && db.get("SELECT 1 AS x FROM program377_enrollments WHERE user_id = ? AND status = 'approved'", [userId]))
      enrollment = { ...(enrollment || {}), user_id: Number(userId), status: 'approved', via: 'program377' };
    res.json({ enrollment: enrollment || null });
  });

  app.post('/api/workshop8/enroll', (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id' });
    const existing = db.get('SELECT id, status FROM workshop8_enrollments WHERE user_id = ?', [user_id]);
    if (existing && existing.status !== 'rejected') return res.status(409).json({ error: 'Bạn đã đăng ký chương trình này rồi.' });
    // Đã bị từ chối trước đó → cho đăng ký lại: đơn cũ quay về "chờ duyệt" như đơn mới
    const eid = existing
      ? (db.run(`UPDATE workshop8_enrollments SET status = 'pending', enrolled_at = datetime('now','localtime'), approved_at = NULL, approved_by = NULL, admin_note = NULL
          WHERE id = ?`, [existing.id]), existing.id)
      : db.run('INSERT INTO workshop8_enrollments (user_id, status) VALUES (?, ?)', [user_id, 'pending']).lastInsertRowid;
    res.status(201).json({ ok: true });
    notifyEnrollRequested(user_id, '8 Buổi Chuyên Sâu', 'workshop8.html');
    antamNotify('w8', eid, `💎 <b>Đăng ký 8 Buổi Chuyên Sâu</b> — chờ duyệt\n\n${antamWho(user_id)}\n\nDuyệt ngay bên dưới hoặc trong admin: ${SITE_URL}/admin.html`);
  });

  app.get('/api/program377/days', (req, res) => {
    const userId = req.query.user_id;
    const enrollment = userId ? db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [userId]) : null;
    const dayNumberToday = enrollment && enrollment.status === 'approved'
      ? Math.min(program377DayNumberToday(enrollment.start_date), 377)
      : 0;
    // Danh sách luôn đủ 1..377 — không chỉ những ngày admin đã tạo riêng. Vì
    // hệ thống khối nội dung tự động lắp ghép theo mùa/thể trạng, một ngày
    // không cần admin tạo riêng vẫn có thể có đủ nội dung để hiển thị, nên
    // không được để những ngày chưa tạo "biến mất" khỏi danh sách.
    const existingDays = db.all('SELECT id, day_number, topic_key, title, xp_reward FROM program377_days ORDER BY day_number ASC');
    const byDayNumber = new Map(existingDays.map(d => [d.day_number, d]));
    const days = [];
    for (let n = 1; n <= 377; n++) {
      const unlocked = n <= dayNumberToday;
      const d = byDayNumber.get(n);
      if (!unlocked) {
        // Ngày chưa mở khóa: không trả tiêu đề/chủ đề thật, tránh lộ nội dung trước khi tới ngày.
        days.push({ id: d ? d.id : null, day_number: n, topic_key: null, title: null, xp_reward: d ? d.xp_reward : 0, unlocked });
        continue;
      }
      days.push(d
        ? { ...d, unlocked }
        : { id: null, day_number: n, topic_key: null, title: `Ngày ${n}`, xp_reward: 0, unlocked });
    }
    res.json({ days, dayNumberToday });
  });

  app.get('/api/program377/day/:dayNumber', (req, res) => {
    const userId = req.query.user_id;
    const dayNumber = Number(req.params.dayNumber);
    const enrollment = userId ? db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [userId]) : null;
    if (!enrollment || enrollment.status !== 'approved')
      return res.status(403).json({ error: 'Bạn chưa được duyệt tham gia chương trình.' });
    const dayNumberToday = Math.min(program377DayNumberToday(enrollment.start_date), 377);
    if (!dayNumber || dayNumber > dayNumberToday)
      return res.status(403).json({ error: 'Ngày này chưa được mở khóa.' });
    // Ngày admin chưa tạo riêng vẫn phải hiển thị được — nội dung 6 mục cố định
    // đến từ khối tự động lắp ghép theo mùa/thể trạng (resolveProgram377DayContent),
    // không phụ thuộc việc có row program377_days hay không. Chỉ khi admin muốn
    // thêm tiêu đề/video/bài học riêng cho 1 ngày cụ thể thì mới cần tạo row.
    const day = db.get('SELECT * FROM program377_days WHERE day_number = ?', [dayNumber]) || {
      id: null, day_number: dayNumber, topic_key: null, title: `Ngày ${dayNumber}`,
      body_html: null, video_url: null, exercise_title: null, exercise_body: null,
      xp_reward: 0, linked_lesson_id: null, linked_assignment_id: null, block_overrides_json: null,
    };
    let blockOverrides = null;
    try { blockOverrides = JSON.parse(day.block_overrides_json || 'null'); } catch (e) { blockOverrides = null; }
    const resolved = resolveProgram377DayContent(userId, dayNumber, enrollment.start_date, blockOverrides);
    // Bản đồ hành trình: mở nội dung 1 ngày = ghé "Học tập 377"
    try { db.run('INSERT OR IGNORE INTO journey_visits (user_id, room, day) VALUES (?,?,?)', [Number(userId), 'p377_hoc', tbToday()]); } catch (e) { /* bảng chưa có */ }
    const linkedLesson = day.linked_lesson_id
      ? db.get('SELECT id, title, course_id FROM course_lessons WHERE id = ?', [day.linked_lesson_id])
      : null;
    const linkedAssignment = day.linked_assignment_id
      ? db.get('SELECT id, title, instructions, link_url, display_mode FROM assignments WHERE id = ?', [day.linked_assignment_id])
      : null;
    res.json({ day: { ...day, ...resolved, linkedLesson, linkedAssignment } });
  });

  app.get('/api/program377/reports', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'Thiếu user_id' });
    const limit = Number(req.query.limit) || 30;
    const reports = db.all(
      'SELECT * FROM program377_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT ?',
      [userId, limit]
    ).map(r => ({ ...r, meal_colors: JSON.parse(r.meal_colors || '[]'), meal_tastes: JSON.parse(r.meal_tastes || '[]') }));
    res.json({ reports });
  });

  // ── Video cảm nhận (báo cáo 377 ngày) ─────────────────────────
  // Nhận video (quay ngay trên trang hoặc video có sẵn) → hàng đợi chuyển đổi bằng ffmpeg sang
  // MP4 H.264 480p, 24fps, CRF 30, âm thanh AAC mono 64kbps, tối đa 5 phút → đẩy lên Drive.
  // Chạy LẦN LƯỢT từng video, mức ưu tiên thấp (nice 19) và 2 luồng để không làm chậm GoClaw/web.
  // Client nhận job id rồi hỏi trạng thái mỗi vài giây (upload xong mới chuyển đổi, có thể mất 1–3 phút).
  const P377_VIDEO_TMP_DIR = path.join(__dirname, 'uploads', 'p377-video-tmp');
  fs.mkdirSync(P377_VIDEO_TMP_DIR, { recursive: true });
  const p377VideoUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, P377_VIDEO_TMP_DIR),
      filename: (req, file, cb) => cb(null, `v-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`),
    }),
    limits: { fileSize: 600 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = /^video\//.test(file.mimetype || '') || /\.(mp4|mov|m4v|webm|3gp|mkv)$/i.test(file.originalname || '');
      cb(ok ? null : new Error('Chỉ nhận file video.'), ok);
    },
  });
  const p377VideoParts = new Map();  // upload_id → { userId, path, next, size, total, at } (video gửi theo phần)
  setInterval(() => { // dọn phần video bỏ dở > 2 giờ
    const cutoff = Date.now() - 2 * 3600e3;
    for (const [k, st] of p377VideoParts) if (st.at < cutoff) { fs.unlink(st.path, () => {}); p377VideoParts.delete(k); }
  }, 30 * 60e3).unref?.();
  const p377VideoJobs = new Map();   // jobId → { userId, status, url, error, createdAt }
  const p377VideoQueue = [];
  let p377VideoBusy = false;
  const { spawn } = require('child_process');
  const runProc = (cmd, args) => new Promise((resolve) => {
    const pr = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    pr.stdout.on('data', d => { out += d; });
    pr.stderr.on('data', d => { err = (err + d).slice(-4000); });
    pr.on('error', e => resolve({ code: -1, out, err: e.message }));
    pr.on('close', code => resolve({ code, out, err }));
  });
  async function processP377VideoQueue() {
    if (p377VideoBusy) return;
    const job = p377VideoQueue.shift();
    if (!job) return;
    p377VideoBusy = true;
    const outPath = job.inPath + '.mp4';
    try {
      job.status = 'converting';
      const ff = process.platform === 'win32' ? ['ffmpeg', []] : ['nice', ['-n', '19', 'ffmpeg']];   // Windows (máy thử) không có nice
      const conv = await runProc(ff[0], [...ff[1], '-y', '-hide_banner', '-loglevel', 'error', '-i', job.inPath,
        '-t', '300', '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', "scale='if(gt(iw,ih),-2,min(480,iw))':'if(gt(iw,ih),min(480,ih),-2)',fps=24",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '44100', '-movflags', '+faststart', '-threads', '2', outPath]);
      if (conv.code !== 0) throw new Error('Không chuyển đổi được video (file hỏng hoặc định dạng lạ).' + (conv.err ? ' ' + conv.err.split('\n').filter(Boolean).pop() : ''));
      job.status = 'uploading';
      const folderId = (db.get("SELECT value FROM site_settings WHERE key = 'p377_video_drive_folder_id'")?.value || '').trim();
      if (!folderId) throw new Error('Chưa cấu hình thư mục Drive lưu video.');
      const drive = getDriveClient();
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const created = await drive.files.create({
        requestBody: { name: `cam-nhan-u${job.userId}-${stamp}.mp4`, parents: [folderId] },
        media: { mimeType: 'video/mp4', body: fs.createReadStream(outPath) },
        fields: 'id',
      });
      await drive.permissions.create({ fileId: created.data.id, requestBody: { role: 'reader', type: 'anyone' } });
      job.url = `https://drive.google.com/file/d/${created.data.id}/preview`;
      job.sizeMB = Math.round(fs.statSync(outPath).size / 1048576 * 10) / 10;
      job.status = 'done';
      console.log(`[P377 VIDEO] user ${job.userId}: ${job.inMB}MB → ${job.sizeMB}MB, đã lưu Drive`);
    } catch (e) {
      job.status = 'error';
      job.error = e.message || 'Xử lý video thất bại.';
      console.error('[P377 VIDEO]', job.error);
    } finally {
      fs.unlink(job.inPath, () => {});
      fs.unlink(outPath, () => {});
      p377VideoBusy = false;
      setImmediate(processP377VideoQueue);
    }
  }
  // Dọn job cũ (> 6 giờ) để Map không phình
  setInterval(() => {
    const cutoff = Date.now() - 6 * 3600e3;
    for (const [id, j] of p377VideoJobs) if (j.createdAt < cutoff && j.status !== 'queued' && j.status !== 'converting') p377VideoJobs.delete(id);
  }, 3600e3).unref?.();

  app.post('/api/program377/upload-video', (req, res) => {
    p377VideoUpload.single('video')(req, res, (err) => {
      const cleanup = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
      if (err) { cleanup(); return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Video quá lớn (tối đa 600MB).' : (err.message || 'Tải video thất bại.') }); }
      if (!req.file) return res.status(400).json({ error: 'Chưa chọn video.' });
      const userId = Number(req.body.user_id);
      const enr = userId && db.get("SELECT e.status FROM program377_enrollments e JOIN users u ON u.id = e.user_id WHERE e.user_id = ? AND u.status = 'active'", [userId]);
      if (!enr || enr.status !== 'approved') { cleanup(); return res.status(403).json({ error: 'Bạn chưa được duyệt tham gia chương trình 377 ngày.' }); }
      const mine = [...p377VideoJobs.values()].filter(j => j.userId === userId && ['queued', 'converting', 'uploading'].includes(j.status));
      if (mine.length) { cleanup(); return res.status(429).json({ error: 'Video trước của bạn đang được xử lý, vui lòng đợi xong.' }); }
      // Video lớn gửi theo từng phần (~50MB / phần) vì Cloudflare chặn mỗi lần gửi > 100MB:
      // ?upload_id=&index=&total= — các phần nối dần vào 1 file, phần cuối mới tạo việc nén như bình thường.
      let inPath = req.file.path, inSize = req.file.size;
      if (req.query.upload_id) {
        const uid = String(req.query.upload_id).replace(/[^a-z0-9]/gi, '').slice(0, 32);
        const index = parseInt(req.query.index, 10), total = parseInt(req.query.total, 10);
        if (!uid || !(index >= 0) || !(total >= 1 && total <= 20) || index >= total) { cleanup(); return res.status(400).json({ error: 'Phần video không hợp lệ.' }); }
        let st = p377VideoParts.get(uid);
        if (index === 0) {
          if (st) fs.unlink(st.path, () => {});
          st = { userId, path: path.join(P377_VIDEO_TMP_DIR, `part-${uid}`), next: 0, size: 0, total, at: Date.now() };
          p377VideoParts.set(uid, st);
        }
        if (!st || st.userId !== userId || st.total !== total || st.next !== index) {
          cleanup(); return res.status(409).json({ error: 'Tải video bị gián đoạn, vui lòng chọn lại video và tải lại.' });
        }
        try { fs.appendFileSync(st.path, fs.readFileSync(req.file.path)); } catch (e) { cleanup(); return res.status(500).json({ error: 'Không ghép được video, vui lòng thử lại.' }); }
        cleanup();
        st.next++; st.size += req.file.size; st.at = Date.now();
        if (st.size > 600 * 1024 * 1024) { fs.unlink(st.path, () => {}); p377VideoParts.delete(uid); return res.status(413).json({ error: 'Video quá lớn (tối đa 600MB).' }); }
        if (index < total - 1) return res.json({ ok: true, part: index + 1, total });
        p377VideoParts.delete(uid);
        inPath = st.path; inSize = st.size;
      }
      const jobId = crypto.randomBytes(8).toString('hex');
      const job = { userId, status: 'queued', inPath, inMB: Math.round(inSize / 1048576 * 10) / 10, createdAt: Date.now() };
      p377VideoJobs.set(jobId, job);
      p377VideoQueue.push(job);
      processP377VideoQueue();
      res.json({ ok: true, job_id: jobId, position: p377VideoQueue.length });
    });
  });

  app.get('/api/program377/video-job/:id', (req, res) => {
    const j = p377VideoJobs.get(req.params.id);
    if (!j || j.userId !== Number(req.query.user_id)) return res.status(404).json({ error: 'Không tìm thấy video đang xử lý (có thể máy chủ vừa khởi động lại) — vui lòng tải lại video.' });
    res.json({ status: j.status, url: j.url || null, error: j.error || null, position: j.status === 'queued' ? p377VideoQueue.indexOf(j) + 1 : 0 });
  });

  app.post('/api/program377/reports', (req, res) => {
    const {
      user_id, report_date,
      meal_breakfast, meal_lunch, meal_dinner, meal_colors, meal_tastes,
      urine_amount, urine_color, stool_shape, stool_color,
      exercise_type, exercise_minutes, sweat_amount, sweat_taste, feeling_note,
      gratitude_1, gratitude_2, gratitude_3,
      meal_breakfast_img, meal_lunch_img, meal_dinner_img, feeling_video_url,
    } = req.body;
    if (!user_id || !report_date || !/^\d{4}-\d{2}-\d{2}$/.test(report_date))
      return res.status(400).json({ error: 'Thiếu user_id hoặc ngày không hợp lệ.' });

    const enrollment = db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [user_id]);
    if (!enrollment || enrollment.status !== 'approved')
      return res.status(403).json({ error: 'Bạn chưa được duyệt tham gia chương trình.' });

    const dayToday = program377DayNumberToday(enrollment.start_date);
    if (dayToday < 1) return res.status(403).json({ error: 'Chương trình của bạn chưa bắt đầu.' });

    const todayStr = db.get("SELECT date('now','localtime') AS d").d;
    const yesterdayStr = db.get("SELECT date('now','localtime','-1 day') AS d").d;
    if (report_date !== todayStr && report_date !== yesterdayStr)
      return res.status(400).json({ error: 'Chỉ được báo cáo cho hôm nay hoặc hôm qua.' });

    const nowHour = Number(db.get("SELECT strftime('%H','now','localtime') AS h").h);
    const isLate = (report_date < todayStr) || (report_date === todayStr && nowHour >= 23) ? 1 : 0;
    const dayNumber = report_date === todayStr ? dayToday : dayToday - 1;

    const colorsJson = JSON.stringify(Array.isArray(meal_colors) ? meal_colors : []);
    const tastesJson = JSON.stringify(Array.isArray(meal_tastes) ? meal_tastes : []);

    const existing = db.get('SELECT id FROM program377_reports WHERE user_id = ? AND report_date = ?', [user_id, report_date]);
    const fields = [
      meal_breakfast || null, meal_lunch || null, meal_dinner || null, colorsJson, tastesJson,
      urine_amount || null, urine_color || null, stool_shape || null, stool_color || null,
      exercise_type || null, exercise_minutes ? Number(exercise_minutes) : null,
      sweat_amount || null, sweat_taste || null, feeling_note || null, isLate, dayNumber,
      gratitude_1 || null, gratitude_2 || null, gratitude_3 || null,
    ];
    let reportId;
    if (existing) {
      db.run(
        `UPDATE program377_reports SET
           meal_breakfast=?, meal_lunch=?, meal_dinner=?, meal_colors=?, meal_tastes=?,
           urine_amount=?, urine_color=?, stool_shape=?, stool_color=?,
           exercise_type=?, exercise_minutes=?, sweat_amount=?, sweat_taste=?, feeling_note=?,
           is_late=?, day_number=?, gratitude_1=?, gratitude_2=?, gratitude_3=?, updated_at = datetime('now','localtime'), ai_attempts = 0, ai_fail_notified = NULL
         WHERE id = ?`,
        [...fields, existing.id]
      );
      reportId = existing.id;
    } else {
      db.run(
        `INSERT INTO program377_reports (
           user_id, report_date, meal_breakfast, meal_lunch, meal_dinner, meal_colors, meal_tastes,
           urine_amount, urine_color, stool_shape, stool_color,
           exercise_type, exercise_minutes, sweat_amount, sweat_taste, feeling_note, is_late, day_number,
           gratitude_1, gratitude_2, gratitude_3
         ) VALUES (?, ?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?)`,
        [user_id, report_date, ...fields]
      );
      reportId = db.get('SELECT id FROM program377_reports WHERE user_id = ? AND report_date = ?', [user_id, report_date]).id;
    }
    // Ảnh từng bữa (link Drive do /api/posts/upload-image trả về) — chỉ nhận link https.
    const imgUrl = v => (typeof v === 'string' && /^https:\/\/\S+$/.test(v.trim()) ? v.trim().slice(0, 500) : null);
    db.run('UPDATE program377_reports SET meal_breakfast_img=?, meal_lunch_img=?, meal_dinner_img=?, feeling_video_url=? WHERE id=?',
      [imgUrl(meal_breakfast_img), imgUrl(meal_lunch_img), imgUrl(meal_dinner_img), imgUrl(feeling_video_url), reportId]);
    // Cân nặng: nhận "65,4" hoặc "65.4"; ngoài 20–300 kg coi như không ghi
    if (req.body.weight_kg !== undefined) {
      const w = parseFloat(String(req.body.weight_kg ?? '').replace(',', '.'));
      db.run('UPDATE program377_reports SET weight_kg = ? WHERE id = ?', [Number.isFinite(w) && w >= 20 && w <= 300 ? Math.round(w * 10) / 10 : null, reportId]);
    }

    // Ghi đè trực tiếp sang meal_logs để dùng chung streak/XP/leaderboard — gọi thẳng DB, không
    // qua route /api/meal-logs (tránh gọi AI/Telegram của meal_logs 2 lần cho cùng 1 lần báo cáo).
    const mealExisting = db.get('SELECT id FROM meal_logs WHERE user_id = ? AND log_date = ?', [user_id, report_date]);
    if (mealExisting) {
      db.run(
        'UPDATE meal_logs SET breakfast=?, lunch=?, dinner=?, colors=?, tastes=? WHERE id=?',
        [meal_breakfast || null, meal_lunch || null, meal_dinner || null, colorsJson, tastesJson, mealExisting.id]
      );
    } else {
      db.run(
        'INSERT INTO meal_logs (user_id, log_date, breakfast, lunch, dinner, colors, tastes) VALUES (?,?,?,?,?,?,?)',
        [user_id, report_date, meal_breakfast || null, meal_lunch || null, meal_dinner || null, colorsJson, tastesJson]
      );
      addXP(user_id, 3, 'meal_log', `Ghi nhật ký ăn uống ${report_date}`);
    }
    recomputeStreak(user_id);

    res.json({ ok: true, reportId, isLate: !!isLate });

    // Fire-and-forget: không bắt khách chờ vòng gọi AI/Telegram.
    runProgram377Coaching(user_id, reportId, report_date);
  });

  app.get('/api/program377/sessions', (req, res) => {
    let sql = 'SELECT * FROM program377_sessions';
    if (req.query.upcoming) sql += " WHERE session_date >= date('now','localtime')";
    sql += ' ORDER BY session_date ASC';
    res.json({ sessions: db.all(sql) });
  });

  // ── Admin: Chương trình 377 ngày ────────────────────────────────
  app.get('/api/admin/program377/topics', requireAdmin, (_req, res) => {
    res.json({ topics: PROGRAM377_TOPICS });
  });

  app.get('/api/admin/program377/days', requireAdmin, (_req, res) => {
    res.json({ days: db.all('SELECT * FROM program377_days ORDER BY day_number ASC') });
  });

  // Trang khách nhúng video_url thẳng vào <iframe>, nên URL phải là dạng embed được — chuẩn hóa
  // các dạng YouTube phổ biến (watch?v=, youtu.be/, /live/, /shorts/) admin hay dán nhầm, tránh
  // bị chặn nhúng (X-Frame-Options) như link watch/live gốc.
  function normalizeEmbedVideoUrl(raw) {
    if (!raw) return null;
    const srcMatch = String(raw).match(/\bsrc=["']([^"']+)["']/i);
    const url = (srcMatch ? srcMatch[1] : String(raw).trim());
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.pathname.startsWith('/embed/')) return u.toString();
      if (u.hostname === 'youtu.be') return `https://www.youtube-nocookie.com/embed${u.pathname}`;
      const pathMatch = u.pathname.match(/^\/(live|shorts)\/([^/]+)/);
      if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && pathMatch) {
        return `https://www.youtube-nocookie.com/embed/${pathMatch[2]}`;
      }
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
      // Google Drive: …/file/d/ID/view (bị chặn nhúng) → …/file/d/ID/preview
      if (u.hostname === 'drive.google.com' || u.hostname === 'docs.google.com') {
        const id = (u.pathname.match(/\/d\/([\w-]{15,})/) || [])[1] || u.searchParams.get('id');
        if (id) return `https://drive.google.com/file/d/${id}/preview`;
      }
      return url;
    } catch { return url; }
  }

  // { [category]: blockId, ... } → JSON string, bỏ qua category lạ/giá trị rỗng.
  // Trả null nếu không ghim khối nào — để mọi mục tự động chọn theo mùa/thể trạng.
  function sanitizeBlockOverrides(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const result = {};
    PROGRAM377_BLOCK_CATEGORIES.forEach((cat) => {
      if (obj[cat]) result[cat] = Number(obj[cat]);
    });
    return Object.keys(result).length ? JSON.stringify(result) : null;
  }

  app.post('/api/admin/program377/days', requireAdmin, (req, res) => {
    const { day_number, topic_key, title, body_html, video_url, exercise_title, exercise_body, xp_reward, linked_lesson_id, linked_assignment_id, block_overrides } = req.body;
    if (!day_number || !title?.trim()) return res.status(400).json({ error: 'Thiếu số ngày hoặc tiêu đề.' });
    const existing = db.get('SELECT id FROM program377_days WHERE day_number = ?', [day_number]);
    if (existing) return res.status(409).json({ error: `Ngày ${day_number} đã có nội dung — vui lòng sửa thay vì thêm mới.` });
    const r = db.run(
      'INSERT INTO program377_days (day_number, topic_key, title, body_html, video_url, exercise_title, exercise_body, xp_reward, linked_lesson_id, linked_assignment_id, block_overrides_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [Number(day_number), topic_key || null, title.trim(), body_html || '', normalizeEmbedVideoUrl(video_url), exercise_title || null, exercise_body || null, Number(xp_reward) || 0, linked_lesson_id ? Number(linked_lesson_id) : null, linked_assignment_id ? Number(linked_assignment_id) : null, sanitizeBlockOverrides(block_overrides)]
    );
    res.status(201).json({ ok: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/program377/days/:id', requireAdmin, (req, res) => {
    const { day_number, topic_key, title, body_html, video_url, exercise_title, exercise_body, xp_reward, linked_lesson_id, linked_assignment_id, block_overrides } = req.body;
    if (!day_number || !title?.trim()) return res.status(400).json({ error: 'Thiếu số ngày hoặc tiêu đề.' });
    db.run(
      'UPDATE program377_days SET day_number=?, topic_key=?, title=?, body_html=?, video_url=?, exercise_title=?, exercise_body=?, xp_reward=?, linked_lesson_id=?, linked_assignment_id=?, block_overrides_json=? WHERE id=?',
      [Number(day_number), topic_key || null, title.trim(), body_html || '', normalizeEmbedVideoUrl(video_url), exercise_title || null, exercise_body || null, Number(xp_reward) || 0, linked_lesson_id ? Number(linked_lesson_id) : null, linked_assignment_id ? Number(linked_assignment_id) : null, sanitizeBlockOverrides(block_overrides), req.params.id]
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/program377/days/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM program377_days WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  // Xem trước nội dung 1 ngày sẽ hiển thị cho 1 tổ hợp mùa/thể trạng mẫu — giúp
  // admin biết còn thiếu khối nào trước khi khách thật gặp phải (không cần user
  // thật, không đụng tới enrollment/start_date).
  app.get('/api/admin/program377/days/:dayNumber/preview', requireAdmin, (req, res) => {
    const dayNumber = Number(req.params.dayNumber);
    const season = PROGRAM377_SEASONS.includes(req.query.season) ? req.query.season : 'xuan';
    const theTrang = THE_TRANG_VALUES.includes(req.query.the_trang) ? req.query.the_trang : null;
    const blocks = PROGRAM377_BLOCK_CATEGORIES.map((category) => {
      const block = pickProgram377Block(category, season, theTrang);
      return { category, title: block ? block.title : null, bodyHtml: block ? block.body_html : null, missing: !block };
    });
    res.json({ season, theTrang, blocks });
  });

  // ── Admin: khối nội dung 377 ngày (an_uong, tap_luyen, ...) theo mùa/thể trạng ──
  app.get('/api/admin/program377/content-blocks', requireAdmin, (req, res) => {
    const { category = '', season = '', the_trang = '', status = '' } = req.query;
    let sql = 'SELECT * FROM program377_content_blocks WHERE 1=1';
    const params = [];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (season) { sql += ' AND season = ?'; params.push(season); }
    if (the_trang) { sql += ' AND the_trang = ?'; params.push(the_trang); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY category ASC, season ASC, the_trang ASC';
    res.json({ blocks: db.all(sql, params), categories: PROGRAM377_BLOCK_CATEGORIES, seasons: PROGRAM377_SEASONS, theTrangValues: THE_TRANG_VALUES });
  });

  app.post('/api/admin/program377/content-blocks', requireAdmin, (req, res) => {
    const { category, season, the_trang, title, body_html } = req.body;
    if (!PROGRAM377_BLOCK_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Category không hợp lệ.' });
    const seasonVal = season === 'all' || PROGRAM377_SEASONS.includes(season) ? season : 'all';
    const theTrangVal = the_trang === 'all' || THE_TRANG_VALUES.includes(the_trang) ? the_trang : 'all';
    if (!body_html?.trim()) return res.status(400).json({ error: 'Thiếu nội dung.' });
    const r = db.run(
      'INSERT INTO program377_content_blocks (category, season, the_trang, title, body_html, status, ai_generated, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [category, seasonVal, theTrangVal, title || null, body_html, 'draft', req.body.ai_generated ? 1 : 0, req.adminUserId || null]
    );
    res.status(201).json({ ok: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/program377/content-blocks/:id', requireAdmin, (req, res) => {
    const existing = db.get('SELECT id FROM program377_content_blocks WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy khối nội dung.' });
    const { category, season, the_trang, title, body_html, status } = req.body;
    const seasonVal = season === 'all' || PROGRAM377_SEASONS.includes(season) ? season : 'all';
    const theTrangVal = the_trang === 'all' || THE_TRANG_VALUES.includes(the_trang) ? the_trang : 'all';
    const statusVal = ['draft', 'published'].includes(status) ? status : 'draft';
    db.run(
      "UPDATE program377_content_blocks SET category=?, season=?, the_trang=?, title=?, body_html=?, status=?, updated_at = datetime('now','localtime') WHERE id=?",
      [PROGRAM377_BLOCK_CATEGORIES.includes(category) ? category : existing.category, seasonVal, theTrangVal, title || null, body_html || '', statusVal, req.params.id]
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/program377/content-blocks/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM program377_content_blocks WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  // Soạn nháp 1 khối nội dung bằng AI (GoClaw) — admin chủ động bấm và chờ (mode
  // sync), không phải request khách hàng nên không cần fire-and-forget như Agent 1.
  app.post('/api/admin/program377/content-blocks/ai-draft', requireAdmin, async (req, res) => {
    const { category, season, the_trang } = req.body;
    if (!PROGRAM377_BLOCK_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Category không hợp lệ.' });
    const prompt = buildProgram377BlockPrompt(category, season || 'all', the_trang || 'all');
    const result = await callGoclawWebhook(prompt);
    if (!result.ok) return res.status(502).json({ error: result.error || 'GoClaw không phản hồi.' });
    res.json({ ok: true, draft: result.text });
  });

  app.get('/api/admin/program377/enrollments', requireAdmin, (req, res) => {
    const status = req.query.status || 'pending';
    const rows = db.all(
      `SELECT e.*, u.first_name, u.last_name, u.email
       FROM program377_enrollments e JOIN users u ON u.id = e.user_id
       WHERE e.status = ? ORDER BY e.enrolled_at DESC`,
      [status]
    );
    res.json({ enrollments: rows });
  });

  // Báo cho thành viên khi đăng ký 8 Buổi Chuyên Sâu / 377 ngày được duyệt: thông báo trong app + email.
  // Chưa làm khảo sát Thân-Tâm-Mệnh → nhắc làm ngay (trang chương trình yêu cầu khảo sát trước khi mở nội dung).
  // ── Quyền truy cập tự động khi được duyệt 8 Buổi Chuyên Sâu / 377 ngày thực hành ──
  // site_settings.program_access = { workshop8: { courses: [id], spaces: [id] }, program377: {...} }
  const PROGRAM_KEYS = ['workshop8', 'program377'];
  const PROGRAM_ENROLL_TABLE = { workshop8: 'workshop8_enrollments', program377: 'program377_enrollments' };
  function getProgramAccess() {
    let cfg = {};
    try { cfg = JSON.parse(db.get("SELECT value FROM site_settings WHERE key = 'program_access'")?.value || '{}') || {}; } catch (e) { cfg = {}; }
    PROGRAM_KEYS.forEach(k => {
      cfg[k] = cfg[k] || {};
      cfg[k].courses = (Array.isArray(cfg[k].courses) ? cfg[k].courses : []).map(Number).filter(Boolean);
      cfg[k].spaces = (Array.isArray(cfg[k].spaces) ? cfg[k].spaces : []).map(Number).filter(Boolean);
    });
    return cfg;
  }
  // Cấp quyền xem các khoá học + Space đã thiết lập cho chương trình (idempotent)
  function grantProgramAccess(program, userId) {
    const cfg = getProgramAccess()[program];
    if (!cfg || !userId) return;
    cfg.courses.forEach(cid => { if (db.get('SELECT id FROM courses WHERE id = ?', [cid])) approveCourseEnrollment(cid, userId); });
    cfg.spaces.forEach(sid => {
      if (!db.get('SELECT id FROM spaces WHERE id = ?', [sid])) return;
      const m = db.get('SELECT id, status FROM space_members WHERE space_id = ? AND user_id = ?', [sid, userId]);
      if (m) { if (m.status !== 'approved') db.run("UPDATE space_members SET status = 'approved' WHERE id = ?", [m.id]); }
      else db.run("INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,'approved')", [sid, userId]);
    });
  }
  function grantProgramAccessToApproved(program) {
    const rows = db.all(`SELECT user_id FROM ${PROGRAM_ENROLL_TABLE[program]} WHERE status = 'approved'`);
    rows.forEach(r => grantProgramAccess(program, r.user_id));
    return rows.length;
  }
  // Mặc định: cả 2 chương trình được xem khoá "Hành trình Khai Nguyên" + "Tái tạo cơ thể cấp tế bào".
  // Lần đầu: áp dụng luôn cho các học viên đã được duyệt trước đó.
  if (!db.get("SELECT value FROM site_settings WHERE key = 'program_access'")) {
    const ids = db.all("SELECT id, title FROM courses").filter(c => /hành trình khai nguyên|tái tạo cơ thể cấp tế bào/i.test(c.title)).map(c => c.id);
    const def = { workshop8: { courses: ids, spaces: [] }, program377: { courses: ids, spaces: [] } };
    db.run("INSERT INTO site_settings (key, value) VALUES ('program_access', ?)", [JSON.stringify(def)]);
    const n = PROGRAM_KEYS.reduce((sum, k) => sum + grantProgramAccessToApproved(k), 0);
    console.log(`  Program access: mặc định khoá [${ids.join(', ')}] cho 8 buổi & 377 ngày (áp dụng ${n} học viên đã duyệt).`);
  }
  // Khoá "Tổng hợp 8 buổi chuyên sâu" → 8 buổi + 377 ngày; "Tổng hợp chương trình 377 ngày" → 377 ngày (chạy 1 lần)
  if (!db.get("SELECT value FROM site_settings WHERE key = 'program_access_summary_v1'")) {
    const find = re => db.all('SELECT id, title FROM courses').find(c => re.test(c.title))?.id;
    const c8 = find(/tổng hợp 8 buổi chuyên sâu/i), c377 = find(/tổng hợp chương trình 377 ngày/i);
    const cfg = getProgramAccess();
    const add = (k, id) => { if (id && !cfg[k].courses.includes(id)) cfg[k].courses.push(id); };
    add('workshop8', c8); add('program377', c8); add('program377', c377);
    db.run("INSERT INTO site_settings (key, value) VALUES ('program_access', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(cfg)]);
    const n = PROGRAM_KEYS.reduce((sum, k) => sum + grantProgramAccessToApproved(k), 0);
    db.run("INSERT INTO site_settings (key, value) VALUES ('program_access_summary_v1', datetime('now','localtime'))");
    console.log(`  Program access: thêm khoá tổng hợp 8 buổi [${c8}] / 377 ngày [${c377}] (áp dụng ${n} lượt học viên đã duyệt).`);
  }

  app.get('/api/admin/program-access', requireAdmin, (_req, res) => {
    res.json({
      config: getProgramAccess(),
      courses: db.all('SELECT id, title, visibility, price, status FROM courses ORDER BY order_num ASC, id ASC'),
      spaces: db.all('SELECT id, name, icon, visibility FROM spaces ORDER BY id ASC'),
    });
  });

  app.put('/api/admin/program-access', requireAdmin, (req, res) => {
    const { program, courses, spaces, apply_existing } = req.body || {};
    if (!PROGRAM_KEYS.includes(program)) return res.status(400).json({ error: 'Chương trình không hợp lệ.' });
    const cfg = getProgramAccess();
    cfg[program] = {
      courses: (Array.isArray(courses) ? courses : []).map(Number).filter(Boolean),
      spaces: (Array.isArray(spaces) ? spaces : []).map(Number).filter(Boolean),
    };
    db.run("INSERT INTO site_settings (key, value) VALUES ('program_access', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(cfg)]);
    const applied = apply_existing ? grantProgramAccessToApproved(program) : 0;
    res.json({ ok: true, applied });
  });

  // ── Khung giới thiệu 8 buổi / 377 ngày trên Feed (phễu bán hàng) ──
  // Người chưa tham gia thấy con số, hoạt động, buổi Zoom tiếp theo và bài giới thiệu bị khoá 1/2.
  // Bài giới thiệu = bài admin đánh dấu (posts.showcase); chưa có thì lấy bài của admin trong Space chương trình —
  // KHÔNG lấy bài của học viên (có thể chứa thông tin sức khoẻ riêng tư).
  const SHOWCASE_PROGRAMS = {
    workshop8: { label: '8 Buổi Chuyên Sâu', page: 'workshop8.html', spaceKey: 'workshop8_space_url', table: 'workshop8_enrollments' },
    program377: { label: '377 Ngày Thực Hành', page: 'program377.html', spaceKey: 'program377_space_url', table: 'program377_enrollments' },
  };
  const scSetting = k => db.get('SELECT value FROM site_settings WHERE key = ?', [k])?.value || '';
  function showcaseSpaceIds(program) {
    const ids = new Set(getProgramAccess()[program].spaces);
    const fromUrl = Number((scSetting(SHOWCASE_PROGRAMS[program].spaceKey).match(/[?&]id=(\d+)/) || [])[1]);
    if (fromUrl) ids.add(fromUrl);
    return [...ids].filter(id => db.get('SELECT id FROM spaces WHERE id = ?', [id]));
  }
  // Buổi Zoom sắp tới (từ hôm nay) — chỉ tên + ngày giờ, không bao giờ trả link
  function showcaseNextSession(program) {
    const today = tbToday();
    if (program === 'program377') {
      const x = db.get(`SELECT title, session_date, session_time FROM program377_sessions
        WHERE session_date >= ? ORDER BY session_date ASC, session_time ASC LIMIT 1`, [today]);
      return x ? { title: x.title, date: x.session_date, time: x.session_time || '' } : null;
    }
    let list = [];
    try { list = JSON.parse(scSetting(`${program}_sessions`) || '[]'); } catch {}
    const note = scSetting(`${program}_time_note`);
    const next = (Array.isArray(list) ? list : []).map(x => ({ title: x.title, date: String(x.date || '').slice(0, 10), time: x.time || note }))
      .filter(x => tbValidDate(x.date) && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    return next || null;
  }
  // Nửa đầu nội dung (chữ thuần) — phần còn lại không bao giờ gửi về trình duyệt người chưa tham gia
  function showcaseHalf(text) {
    const plain = String(text || '').replace(/<[^>]*>/g, ' ').replace(/[#*_>`~|]+/g, '').replace(/\s+/g, ' ').trim();
    const cut = Math.min(Math.ceil(plain.length / 2), 320);
    let half = plain.slice(0, cut);
    const sp = half.lastIndexOf(' ');
    if (cut < plain.length && sp > cut * 0.6) half = half.slice(0, sp);
    return half;
  }
  function showcaseViewer(userId) {
    const u = userId ? db.get('SELECT id, is_admin FROM users WHERE id = ?', [userId]) : null;
    if (!u) return { w3: false, workshop8: 'none', program377: 'none', is_admin: false };
    const st = t => db.get(`SELECT status FROM ${t} WHERE user_id = ?`, [u.id])?.status || 'none';
    const { sid, cid } = rosterW3Ids();
    const w3 = !!(db.get("SELECT 1 AS x FROM space_members WHERE space_id = ? AND user_id = ? AND status = 'approved'", [sid, u.id])
      || db.get("SELECT 1 AS x FROM course_enrollments WHERE course_id = ? AND user_id = ? AND status = 'approved'", [cid, u.id]));
    const p377 = st('program377_enrollments');
    return { w3, workshop8: p377 === 'approved' ? 'approved' : st('workshop8_enrollments'), program377: p377, is_admin: !!u.is_admin };
  }
  // used: id bài đã hiện ở thẻ trước → 2 thẻ không trùng bài khi 2 chương trình dùng chung Space
  function showcaseProgram(program, viewer, used = new Set()) {
    const P = SHOWCASE_PROGRAMS[program];
    const spaces = showcaseSpaceIds(program);
    // Space "nhóm thảo luận" riêng của chương trình (nút ở trang 8 buổi / 377) — bài ở đây được ưu tiên
    const ownSpace = Number((scSetting(P.spaceKey).match(/[?&]id=(\d+)/) || [])[1]) || 0;
    const courses = getProgramAccess()[program].courses.filter(id => db.get('SELECT id FROM courses WHERE id = ?', [id]));
    const inList = arr => arr.length ? arr.map(Number).join(',') : '0';
    const n = (sql, params = []) => db.get(sql, params)?.n || 0;
    const postWhere = `p.space_id IN (${inList(spaces)}) AND COALESCE(p.hidden, 0) = 0`;
    const weekAgo = tbAddDays(tbToday(), -7) + ' 00:00:00';
    const lessonWhere = `course_id IN (${inList(courses)}) AND COALESCE(status, 'published') = 'published'`;
    const latestLesson = db.get(`SELECT title, created_at FROM course_lessons WHERE ${lessonWhere} ORDER BY created_at DESC, id DESC LIMIT 1`);
    const unlocked = viewer.is_admin || viewer[program] === 'approved';
    const notUsed = used.size ? ` AND p.id NOT IN (${[...used].map(Number).join(',')})` : '';
    const teaserCols = `p.id, p.title, p.content, p.created_at, p.likes_count, p.comments_count, u.first_name, u.last_name`;
    let teasers = db.all(`SELECT ${teaserCols}, p.image_url FROM posts p JOIN users u ON u.id = p.user_id
      WHERE ${postWhere} AND p.showcase = 1${notUsed} ORDER BY (p.space_id = ?) DESC, p.created_at DESC LIMIT 3`, [ownSpace]);
    const chosen = teasers.length > 0;
    // Chưa chọn bài: bài của admin có tiêu đề và đủ dài (bỏ bài ngắn kiểu "Bữa trưa hôm nay")
    if (!chosen) teasers = db.all(`SELECT ${teaserCols}, NULL AS image_url FROM posts p JOIN users u ON u.id = p.user_id
      WHERE ${postWhere} AND u.is_admin = 1 AND TRIM(COALESCE(p.title, '')) != '' AND LENGTH(p.content) >= 150${notUsed}
      ORDER BY (p.space_id = ?) DESC, p.created_at DESC LIMIT 2`, [ownSpace]);
    teasers = teasers.slice(0, 1);   // thẻ chỉ hiện 1 bài
    teasers.forEach(t => used.add(t.id));
    // Hoạt động gần đây trong nhóm chương trình (14 ngày): bài mới, bình luận, lượt thích, báo cáo 377.
    // Học viên / admin thấy tên gọi + tiêu đề bài; người chưa tham gia chỉ thấy "Một học viên" (nhóm riêng tư).
    const since = tbAddDays(tbToday(), -13) + ' 00:00:00';
    const who = r => unlocked ? (String(r.last_name || r.first_name || '').trim().split(/\s+/).pop() || 'Một học viên') : 'Một học viên';
    const act = [];
    const q = (kind, sql, params) => { try { db.all(sql, params).forEach(r => act.push({ kind, at: r.at, who: who(r), title: unlocked ? String(r.title || '').slice(0, 60) : '' })); } catch (e) { /* bỏ qua */ } };
    q('post', `SELECT p.title, p.created_at AS at, u.first_name, u.last_name FROM posts p JOIN users u ON u.id = p.user_id
      WHERE ${postWhere} AND p.created_at >= ? ORDER BY p.created_at DESC LIMIT 15`, [since]);
    q('comment', `SELECT p.title, c.created_at AS at, u.first_name, u.last_name FROM comments c JOIN posts p ON p.id = c.post_id JOIN users u ON u.id = c.user_id
      WHERE ${postWhere} AND c.created_at >= ? ORDER BY c.created_at DESC LIMIT 15`, [since]);
    q('like', `SELECT p.title, l.created_at AS at, u.first_name, u.last_name FROM post_likes l JOIN posts p ON p.id = l.post_id JOIN users u ON u.id = l.user_id
      WHERE ${postWhere} AND l.created_at >= ? ORDER BY l.created_at DESC LIMIT 15`, [since]);
    if (program === 'program377') q('report', `SELECT r.created_at AS at, u.first_name, u.last_name, '' AS title FROM program377_reports r JOIN users u ON u.id = r.user_id
      WHERE r.created_at >= ? ORDER BY r.created_at DESC LIMIT 15`, [since]);
    const activity = act.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20);
    return {
      activity, now: db.get("SELECT datetime('now','localtime') AS t").t,
      key: program, label: P.label, page: P.page, viewer_status: viewer[program], unlocked,
      members: n(`SELECT COUNT(*) AS n FROM ${P.table} e JOIN users u ON u.id = e.user_id WHERE e.status = 'approved'`),
      posts_total: n(`SELECT COUNT(*) AS n FROM posts p WHERE ${postWhere}`),
      posts_week: n(`SELECT COUNT(*) AS n FROM posts p WHERE ${postWhere} AND p.created_at >= ?`, [weekAgo]),
      latest_post_at: db.get(`SELECT MAX(p.created_at) AS t FROM posts p WHERE ${postWhere}`)?.t || null,
      courses: courses.length,
      lessons: n(`SELECT COUNT(*) AS n FROM course_lessons WHERE ${lessonWhere}`),
      latest_lesson: latestLesson ? { title: latestLesson.title, created_at: latestLesson.created_at } : null,
      reports_today: program === 'program377' ? n('SELECT COUNT(*) AS n FROM program377_reports WHERE report_date = ?', [tbToday()]) : 0,
      story: showcaseStory(program),
      price_regular: program === 'workshop8' ? scSetting('workshop8_price_regular') : '',
      price_offer: program === 'workshop8' ? scSetting('workshop8_price_offer') : '',
      stories: showcaseStoryList(program),
      next_session: showcaseNextSession(program),
      teasers: teasers.map(t => ({
        id: unlocked ? t.id : null, ref: t.id, title: t.title || '', author: `${t.first_name || ''} ${t.last_name || ''}`.trim(),
        excerpt: showcaseHalf(t.content), image_url: chosen && /^https?:\/\//i.test(t.image_url || '') ? t.image_url : null,
        created_at: t.created_at, likes: t.likes_count || 0, comments: t.comments_count || 0,
      })),
    };
  }
  app.get('/api/showcase', (req, res) => {
    if (scSetting('feed_showcase_enabled') === '0') return res.json({ enabled: false });
    const userId = userFromSession(req)?.id || Number(req.query.user_id) || 0;
    const viewer = showcaseViewer(userId);
    const w3Next = showcaseNextSession('workshop3');
    res.json({
      enabled: true, viewer,
      workshop3: { page: 'workshop3.html', next_session: w3Next },
      programs: (used => ['workshop8', 'program377'].map(k => showcaseProgram(k, viewer, used)))(new Set()),
    });
  });
  // ── Đợt 2: đo phễu + khách quan tâm + câu chuyện kết quả ──
  // showcase_events: view (thấy thẻ, 1 lần/ngày), teaser (mở bài bị khoá), detail (bấm xem chi tiết), consult, w3 (bấm 3 buổi miễn phí)
  db.exec(`CREATE TABLE IF NOT EXISTS showcase_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, program TEXT NOT NULL, kind TEXT NOT NULL, post_id INTEGER,
    day TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_showcase_events ON showcase_events(program, kind, day)');
  // Khách quan tâm trên Feed (chưa chắc đã vào Zoom) → hiện trong Kanban khách hàng cùng người điểm danh Zoom (khoá = SĐT)
  db.exec(`CREATE TABLE IF NOT EXISTS care_leads (
    phone TEXT PRIMARY KEY, user_id INTEGER, name TEXT, email TEXT, programs TEXT DEFAULT '', opens INTEGER DEFAULT 0,
    consults INTEGER DEFAULT 0, alerted TEXT DEFAULT '', first_at TEXT DEFAULT (datetime('now','localtime')), last_at TEXT
  )`);
  const SHOWCASE_KINDS = ['view', 'teaser', 'detail', 'consult', 'w3'];
  const SHOWCASE_HOT_OPENS = 2;   // mở bài bị khoá từ lần thứ 2 → khách "nóng"
  function showcaseLog(userId, program, kind, postId) {
    if (!userId || !SHOWCASE_KINDS.includes(kind) || !(SHOWCASE_PROGRAMS[program] || program === 'workshop3')) return false;
    const day = tbToday();
    if (kind === 'view' && db.get('SELECT 1 AS x FROM showcase_events WHERE user_id = ? AND program = ? AND kind = ? AND day = ?', [userId, program, kind, day])) return false;
    db.run('INSERT INTO showcase_events (user_id, program, kind, post_id, day) VALUES (?,?,?,?,?)', [userId, program, kind, Number(postId) || null, day]);
    return true;
  }
  // Ghi / cập nhật khách quan tâm + báo An Tâm 1 lần / chương trình khi khách "nóng" (mở bài khoá ≥ 2 lần). Bấm tư vấn đã có tin riêng.
  function showcaseLead(userId, program, reason) {
    const u = db.get('SELECT id, first_name, last_name, email, phone, is_admin FROM users WHERE id = ?', [userId]);
    if (!u || u.is_admin) return;
    const P = SHOWCASE_PROGRAMS[program];
    if (db.get(`SELECT 1 AS x FROM ${P.table} WHERE user_id = ?`, [u.id])) return;   // đã đăng ký chương trình này
    const opens = db.get("SELECT COUNT(*) AS n FROM showcase_events WHERE user_id = ? AND program = ? AND kind = 'teaser'", [u.id, program]).n;
    if (reason !== 'consult' && opens < SHOWCASE_HOT_OPENS) return;
    const phone = zoomPhone(u.phone);
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
    let firstAlert = true;
    if (phone && phone.length >= 9) {
      const cur = db.get('SELECT * FROM care_leads WHERE phone = ?', [phone]);
      const progs = new Set(String(cur?.programs || '').split(',').filter(Boolean)); progs.add(program);
      const alerted = new Set(String(cur?.alerted || '').split(',').filter(Boolean));
      firstAlert = !alerted.has(program); alerted.add(program);
      const allOpens = db.get("SELECT COUNT(*) AS n FROM showcase_events WHERE user_id = ? AND kind = 'teaser'", [u.id]).n;
      const consults = db.get("SELECT COUNT(*) AS n FROM showcase_events WHERE user_id = ? AND kind = 'consult'", [u.id]).n;
      db.run(`INSERT INTO care_leads (phone, user_id, name, email, programs, opens, consults, alerted, last_at) VALUES (?,?,?,?,?,?,?,?,datetime('now','localtime'))
        ON CONFLICT(phone) DO UPDATE SET user_id = excluded.user_id, name = excluded.name, email = excluded.email, programs = excluded.programs,
          opens = excluded.opens, consults = excluded.consults, alerted = excluded.alerted, last_at = excluded.last_at`,
        [phone, u.id, name, u.email || '', [...progs].join(','), allOpens, consults, [...alerted].join(',')]);
    }
    if (reason !== 'consult' && firstAlert) {
      antamNotify('lead', `${u.id}:${program}`, `🔥 <b>Khách quan tâm ${antamEsc(P.label)}</b> — đã mở ${opens} bài bị khoá trên Feed\n\n${antamWho(u.id)}\n\n${phone ? 'Đã đưa vào Kanban khách hàng (cột Chưa liên hệ, 🔥 Nóng)' : 'Khách chưa có SĐT trong hồ sơ'}: ${SITE_URL}/kanban-khach-hang.html`, false);
    }
  }
  app.post('/api/showcase/track', (req, res) => {
    const userId = userFromSession(req)?.id || Number(req.body?.user_id) || 0;
    if (!userId) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    const { program, kind, post_id } = req.body || {};
    if (getUserFlags(userId).isAdmin) return res.json({ ok: true, skipped: 'admin' });   // không tính admin vào số liệu
    const logged = showcaseLog(userId, program, kind, post_id);
    res.json({ ok: true, logged });
    if (logged && kind === 'teaser' && SHOWCASE_PROGRAMS[program]) {
      try { showcaseLead(userId, program, 'teaser'); } catch (e) { console.error('[showcase lead]', e.message); }
    }
  });
  // Câu chuyện kết quả (admin nhập tay — chỉ đăng khi học viên đã đồng ý): site_settings.showcase_stories
  function showcaseStories() {
    try { const v = JSON.parse(scSetting('showcase_stories') || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  function showcaseStoryList(program) {
    return showcaseStories().filter(x => x && x.enabled !== false && (x.program === program || x.program === 'all') && String(x.result || '').trim())
      .slice(0, 6).map(x => ({ who: String(x.who || '').slice(0, 120), result: String(x.result || '').slice(0, 200), detail: String(x.detail || '').slice(0, 600),
        image_url: /^https?:\/\//i.test(x.image_url || '') ? driveImageUrl(x.image_url) : null }));
  }
  function showcaseStory(program) {
    const list = showcaseStories().filter(x => x && x.enabled !== false && (x.program === program || x.program === 'all') && String(x.result || '').trim());
    if (!list.length) return null;
    const x = list[Math.floor(Math.random() * list.length)];
    return { who: String(x.who || '').slice(0, 120), result: String(x.result || '').slice(0, 200), detail: String(x.detail || '').slice(0, 600),
      image_url: /^https?:\/\//i.test(x.image_url || '') ? driveImageUrl(x.image_url) : null };
  }
  app.get('/api/admin/showcase', requireAdmin, (req, res) => {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
    const since = tbAddDays(tbToday(), -(days - 1));
    const uniq = (program, kind) => db.get('SELECT COUNT(DISTINCT user_id) AS n FROM showcase_events WHERE program = ? AND kind = ? AND day >= ?', [program, kind, since]).n;
    const programs = Object.entries(SHOWCASE_PROGRAMS).map(([k, P]) => {
      // Đăng ký / được duyệt trong kỳ của những người đã thấy khung trước khi đăng ký
      const reg = db.get(`SELECT COUNT(*) AS n, SUM(CASE WHEN e.status = 'approved' THEN 1 ELSE 0 END) AS ok FROM ${P.table} e
        WHERE date(e.enrolled_at) >= ? AND EXISTS (SELECT 1 FROM showcase_events s WHERE s.user_id = e.user_id AND s.program = ? AND s.created_at <= e.enrolled_at)`, [since, k]);
      return {
        key: k, label: P.label, viewers: uniq(k, 'view'), teaser: uniq(k, 'teaser'), detail: uniq(k, 'detail'), consult: uniq(k, 'consult'),
        registered: reg?.n || 0, approved: reg?.ok || 0,
        top_posts: db.all(`SELECT s.post_id, p.title, COUNT(*) AS opens, COUNT(DISTINCT s.user_id) AS people FROM showcase_events s
          LEFT JOIN posts p ON p.id = s.post_id WHERE s.program = ? AND s.kind = 'teaser' AND s.day >= ? AND s.post_id IS NOT NULL
          GROUP BY s.post_id ORDER BY people DESC, opens DESC LIMIT 5`, [k, since]),
      };
    });
    const leads = db.all(`SELECT l.*, c.status AS care_status, c.owner FROM care_leads l LEFT JOIN zoom_care c ON c.phone = l.phone
      ORDER BY l.last_at DESC LIMIT 50`);
    res.json({ days, since, enabled: scSetting('feed_showcase_enabled') !== '0', w3_clicks: uniq('workshop3', 'w3'),
      programs, leads, statuses: ZC_STATUSES, stories: showcaseStories() });
  });
  app.put('/api/admin/showcase/stories', requireAdmin, (req, res) => {
    const list = (Array.isArray(req.body?.stories) ? req.body.stories : []).slice(0, 30).map((x, i) => ({
      id: String(x.id || 's' + Date.now().toString(36) + i).slice(0, 30),
      program: ['workshop8', 'program377', 'all'].includes(x.program) ? x.program : 'all',
      who: String(x.who || '').trim().slice(0, 120), result: String(x.result || '').trim().slice(0, 200),
      detail: String(x.detail || '').trim().slice(0, 600), image_url: /^https?:\/\//i.test(String(x.image_url || '').trim()) ? String(x.image_url).trim().slice(0, 500) : '',
      enabled: x.enabled !== false,
    })).filter(x => x.result);
    db.run("INSERT INTO site_settings (key, value) VALUES ('showcase_stories', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(list)]);
    res.json({ ok: true, stories: list });
  });

  // ── Bản đồ hành trình khách hàng (ban-do-hanh-trinh.html, chỉ admin) ──
  // Mỗi người: nguồn kênh (users.source), các "phòng" đã ghé + lần gần nhất. Vị trí hiện tại tính ở trình duyệt
  // (phòng xa nhất trên đường đi). Phòng lấy từ dữ liệu sẵn có + lượt mở trang (journey_visits, 1 dòng/người/phòng/ngày).
  {
    const uc = db.all('PRAGMA table_info(users)').map(c => c.name);
    if (!uc.includes('source')) db.exec('ALTER TABLE users ADD COLUMN source TEXT');
    if (!uc.includes('source_at')) db.exec('ALTER TABLE users ADD COLUMN source_at TEXT');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS journey_visits (
    user_id INTEGER NOT NULL, room TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (user_id, room, day)
  )`);
  const JOURNEY_SOURCES = { facebook: 'facebook', fb: 'facebook', canhan: 'facebook', 'ca-nhan': 'facebook', fanpage: 'fanpage', page: 'fanpage',
    zalo: 'zalo', zl: 'zalo', tiktok: 'tiktok', tt: 'tiktok', youtube: 'youtube', yt: 'youtube', other: 'other', khac: 'other' };
  const JOURNEY_PAGE_ROOMS = {
    'noi-quy': 'noi_quy', 'lo-trinh': 'ho_so', 'nhat-ky': 'nhat_ky', 'members': 'ho_so', 'leaderboard': 'ho_so', 'intake': 'ho_so', 'intake-than-tam-menh': 'ho_so',
    'workshop3': 'w3', 'tro-ly': 'tro_ly', 'cam-nang-suc-khoe': 'tai_lieu', 'tai-lieu': 'tai_lieu',
    'thuc-pham': 'tra_cuu', 'quy-trinh': 'tra_cuu', 'cong-thuc': 'tra_cuu', 'spaces': 'thao_luan', 'qa': 'thao_luan', 'signal': 'thao_luan', 'cot': 'thao_luan', 'courses': 'khoa_free',
    'thuc-don-7-ngay': 'cam_nang',
    'kiem-tra-han-nhiet': 'cam_nang', 'coach-1-1': 'mot_mot', 'lien-he': 'ho_tro', 'huong-dan': 'ho_tro', 'dia-diem': 'ho_tro', 'about': 'gioi_thieu', 'cuoc-doi-ngo-lam': 'gioi_thieu', 'marketplace': 'cho', 'checkout': 'cho',
  };
  const journeyOwnSpace = key => Number((scSetting(key).match(/[?&]id=(\d+)/) || [])[1]) || 0;
  // Space → phòng: Space 3 buổi, nhóm 8 buổi, nhóm 377, Space riêng của chương trình, còn lại = thảo luận cộng đồng
  function journeySpaceRooms() {
    const acc = getProgramAccess();
    const map = {};
    acc.workshop8.spaces.forEach(id => { map[id] = 'w8_thao_luan'; });
    acc.program377.spaces.forEach(id => { if (!map[id]) map[id] = 'p377_thao_luan'; });
    const w8 = journeyOwnSpace('workshop8_space_url'), p377 = journeyOwnSpace('program377_space_url');
    if (w8) map[w8] = 'w8_thao_luan';
    if (p377) map[p377] = 'p377_thao_luan';
    map[rosterW3Ids().sid] = 'w3';
    return map;
  }
  const journeyApproved = (table, uid) => !!db.get(`SELECT 1 AS x FROM ${table} WHERE user_id = ? AND status = 'approved'`, [uid]);
  // Trang đang mở → phòng (trang bán hàng 8 buổi / 377 của người chưa học = "đứng ngắm ở cổng vườn")
  function journeyRoomForPage(uid, page, id) {
    if (JOURNEY_PAGE_ROOMS[page]) return JOURNEY_PAGE_ROOMS[page];
    const p377 = journeyApproved('program377_enrollments', uid);
    if (page === 'workshop8' || page === 'workshop8-thu-ngo') return p377 || journeyApproved('workshop8_enrollments', uid) ? 'w8' : 'ngam';
    if (page === 'program377' || page === 'program377-thu-ngo') return p377 ? 'p377' : 'ngam';
    if (page === 'space' && id) return journeySpaceRooms()[id] || 'thao_luan';
    if (page === 'course-view' && id) {
      const c = db.get('SELECT id, visibility FROM courses WHERE id = ?', [id]);
      if (!c) return null;
      if (c.id === rosterW3Ids().cid) return 'w3';
      if (c.visibility !== 'private') return 'khoa_free';
      return db.get("SELECT 1 AS x FROM course_enrollments WHERE course_id = ? AND user_id = ? AND status = 'approved'", [c.id, uid]) ? 'khoa_rieng' : 'ngam';
    }
    return null;
  }
  app.post('/api/journey/ping', (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.json({ ok: false });
    const page = String(req.body?.page || '').replace(/\.html$/, '').slice(0, 40);
    const room = journeyRoomForPage(u.id, page, Number(req.body?.id) || 0);
    if (room) db.run('INSERT OR IGNORE INTO journey_visits (user_id, room, day) VALUES (?,?,?)', [u.id, room, tbToday()]);
    res.json({ ok: true, room });
  });
  // Nguồn kênh lần đầu (link ?src=… hoặc trình duyệt trong app Facebook/Zalo/TikTok/YouTube) — chỉ ghi cho tài khoản mới (≤ 14 ngày), 1 lần
  app.post('/api/journey/source', (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.json({ ok: false });
    const src = JOURNEY_SOURCES[String(req.body?.source || '').toLowerCase()];
    if (!src) return res.json({ ok: false });
    const fresh = db.get(`SELECT id FROM users WHERE id = ? AND COALESCE(source, '') = '' AND created_at >= datetime('now','localtime','-14 days')`, [u.id]);
    if (fresh) db.run("UPDATE users SET source = ?, source_at = datetime('now','localtime') WHERE id = ?", [src, u.id]);
    res.json({ ok: true, saved: !!fresh });
  });
  const journeyAdmin = (req, res) => {
    const me = tbMe(req);
    if (!me) { res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản cộng đồng.', code: 'session_required' }); return null; }
    if (!me.is_admin) { res.status(403).json({ error: 'Chỉ admin xem được bản đồ hành trình.' }); return null; }
    return me;
  };
  // onlyId: chỉ tính cho 1 người (trang "Hành trình của tôi"); không truyền = mọi thành viên trừ admin
  function journeyPeople(onlyId) {
    const people = new Map();
    db.all(`SELECT id, first_name, last_name, email, phone, source, created_at, last_active_at, rules_accepted_version, rules_accepted_at,
        intake_done_at, ttm_intake_done_at FROM users WHERE ${onlyId ? 'id = ?' : 'COALESCE(is_admin, 0) = 0'}`, onlyId ? [onlyId] : []).forEach(u => {
      people.set(u.id, { id: u.id, n: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email, ph: u.phone || '', em: u.email || '',
        src: u.source || '', c: u.created_at || '', l: u.last_active_at || u.created_at || '', r: {} });
      const p = people.get(u.id);
      if (u.rules_accepted_version > 0) p.r.noi_quy = u.rules_accepted_at || u.created_at;
      const prof = [u.ttm_intake_done_at, u.intake_done_at].filter(Boolean).sort().pop() || (String(u.phone || '').trim() ? u.created_at : '');
      if (prof) p.r.ho_so = prof;
    });
    const hit = (uid, room, at) => {
      const p = people.get(Number(uid));
      if (!p || !at) return;
      at = String(at);
      if (!p.r[room] || p.r[room] < at) p.r[room] = at;
      if (at > p.l) p.l = at;
    };
    const q = (sql, params, fn) => { try { db.all(sql, params || []).forEach(fn); } catch (e) { console.error('[journey]', e.message); } };
    const byPhone = new Map();
    people.forEach(p => { const k = zoomPhone(p.ph); if (k && k.length >= 9) byPhone.set(k, p.id); });
    const { sid, cid } = rosterW3Ids();
    const spaceRoom = journeySpaceRooms();
    // 3 buổi workshop: Space / khoá 3 buổi, điểm danh Zoom 3 buổi
    q("SELECT user_id, created_at AS at FROM space_members WHERE space_id = ? AND status = 'approved'", [sid], r => hit(r.user_id, 'w3', r.at));
    q("SELECT user_id, created_at AS at FROM course_enrollments WHERE course_id = ? AND status = 'approved'", [cid], r => hit(r.user_id, 'w3', r.at));
    q("SELECT user_id, phone, MAX(created_at) AS at FROM zoom_checkins WHERE program = 'workshop3' GROUP BY user_id, phone", [],
      r => hit(r.user_id || byPhone.get(zoomPhone(r.phone)), 'w3', r.at));
    // Bài viết + bình luận: theo Space của bài
    q('SELECT user_id, space_id, MAX(created_at) AS at FROM posts GROUP BY user_id, space_id', [], r => hit(r.user_id, spaceRoom[r.space_id] || 'thao_luan', r.at));
    q('SELECT c.user_id, p.space_id, MAX(c.created_at) AS at FROM comments c JOIN posts p ON p.id = c.post_id GROUP BY c.user_id, p.space_id', [],
      r => hit(r.user_id, spaceRoom[r.space_id] || 'thao_luan', r.at));
    // Khoá học đã được mở (khoá công khai = miễn phí, riêng tư = khoá học riêng)
    q(`SELECT e.user_id, e.course_id, c.visibility, MAX(e.created_at) AS at FROM course_enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.status = 'approved' AND e.course_id <> ? GROUP BY e.user_id, e.course_id`, [cid],
      r => hit(r.user_id, r.visibility === 'private' ? 'khoa_rieng' : 'khoa_free', r.at));
    // Cẩm nang: trắc nghiệm Hàn – Nhiệt (theo SĐT)
    q('SELECT phone, MAX(created_at) AS at FROM han_nhiet_quiz_results GROUP BY phone', [], r => hit(byPhone.get(zoomPhone(r.phone)), 'cam_nang', r.at));
    // Khu cẩm nang: hỏi Trợ lý Ngũ Hành; Nhật ký ăn uống: đã ghi nhật ký
    q('SELECT user_id, MAX(created_at) AS at FROM assistant_logs GROUP BY user_id', [], r => hit(r.user_id, 'tro_ly', r.at));
    q('SELECT user_id, MAX(created_at) AS at FROM meal_logs GROUP BY user_id', [], r => hit(r.user_id, 'nhat_ky', r.at));
    // Nói chuyện 1-1: đặt lịch tư vấn, gửi tin cho Ban tổ chức
    q('SELECT user_id, MAX(created_at) AS at FROM coaching_bookings GROUP BY user_id', [], r => hit(r.user_id, 'mot_mot', r.at));
    q('SELECT user_id, MAX(created_at) AS at FROM contact_messages WHERE user_id IS NOT NULL GROUP BY user_id', [], r => hit(r.user_id, 'mot_mot', r.at));
    // Chợ: đơn hàng
    q('SELECT buyer_id, MAX(created_at) AS at FROM orders GROUP BY buyer_id', [], r => hit(r.buyer_id, 'cho', r.at));
    // Cổng vườn riêng tư: xem khung giới thiệu kỹ (mở bài khoá / chi tiết / tư vấn), đơn chờ duyệt hoặc bị từ chối
    q("SELECT user_id, MAX(created_at) AS at FROM showcase_events WHERE kind IN ('teaser','detail','consult') GROUP BY user_id", [], r => hit(r.user_id, 'ngam', r.at));
    ['workshop8_enrollments', 'program377_enrollments'].forEach(t => {
      const room = t === 'workshop8_enrollments' ? 'w8' : 'p377';
      q(`SELECT user_id, status, enrolled_at, approved_at FROM ${t}`, [], r => {
        if (r.status === 'approved') hit(r.user_id, room, r.approved_at || r.enrolled_at);
        else hit(r.user_id, 'ngam', r.enrolled_at);
      });
    });
    q('SELECT user_id, MAX(created_at) AS at FROM program377_reports GROUP BY user_id', [], r => hit(r.user_id, 'p377_bao_cao', r.at));
    // Học tập 377: bài tập 377 đã đánh dấu xong (+ lượt mở nội dung từng ngày trong journey_visits)
    q("SELECT user_id, MAX(done_at) AS at FROM homework_done WHERE prog = 'p377' GROUP BY user_id", [], r => hit(r.user_id, 'p377_hoc', r.at));
    // Lượt mở trang
    q('SELECT user_id, room, MAX(day) AS at FROM journey_visits GROUP BY user_id, room', [], r => hit(r.user_id, r.room, r.at));
    // Ghé bất kỳ phòng nào trong Khu cẩm nang = đã qua Phòng cẩm nang (cổng vào khu)
    people.forEach(p => {
      const last = ['tro_ly', 'tai_lieu', 'tra_cuu', 'nhat_ky'].map(k => p.r[k]).filter(Boolean).sort().pop();
      if (last && (!p.r.cam_nang || p.r.cam_nang < last)) p.r.cam_nang = last;
    });
    // Ai đang chờ / bị từ chối (hiện chú thích trong danh sách)
    q('SELECT user_id, status FROM workshop8_enrollments', [], r => { const p = people.get(r.user_id); if (p && r.status !== 'approved') p.w8 = r.status; });
    q('SELECT user_id, status FROM program377_enrollments', [], r => { const p = people.get(r.user_id); if (p && r.status !== 'approved') p.p377 = r.status; });
    q('SELECT phone, status FROM zoom_care', [], r => { const id = byPhone.get(r.phone); if (id) people.get(id).care = r.status; });
    q('SELECT phone FROM care_leads', [], r => { const id = byPhone.get(r.phone); if (id) people.get(id).lead = 1; });
    return [...people.values()];
  }
  // Hoạt động gần đây (14 ngày) để bản đồ "bay lên" từ đúng ngôi nhà: bài mới, bình luận, lượt thích, thành viên mới, báo cáo 377.
  // full = admin (họ tên + tiêu đề bài). Thành viên: chỉ tên gọi; bài trong Space riêng tư không lộ tiêu đề / tên người.
  function journeyActivity(full) {
    const since = tbAddDays(tbToday(), -13) + ' 00:00:00';
    const spaceRoom = journeySpaceRooms();
    const pub = {};
    db.all('SELECT id, visibility FROM spaces').forEach(x => { pub[x.id] = x.visibility === 'public'; });
    const nm = r => full ? `${r.first_name || ''} ${r.last_name || ''}`.trim() : (String(r.last_name || r.first_name || '').trim().split(/\s+/).pop() || 'Một thành viên');
    const out = [];
    const push = (kind, r, room, title, isPublic) => out.push({ kind, room, at: r.at,
      who: full || isPublic ? nm(r) : 'Một học viên', title: (full || isPublic) && title ? String(title).slice(0, 60) : '' });
    const postRoom = sid => spaceRoom[sid] || 'thao_luan';
    const isPub = sid => !sid || !!pub[sid];
    db.all(`SELECT p.title, p.space_id, p.created_at AS at, u.first_name, u.last_name FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.created_at >= ? AND COALESCE(p.hidden, 0) = 0 ORDER BY p.created_at DESC LIMIT 40`, [since])
      .forEach(r => push('post', r, postRoom(r.space_id), r.title, isPub(r.space_id)));
    db.all(`SELECT p.title, p.space_id, c.created_at AS at, u.first_name, u.last_name FROM comments c JOIN posts p ON p.id = c.post_id JOIN users u ON u.id = c.user_id
      WHERE c.created_at >= ? AND COALESCE(p.hidden, 0) = 0 ORDER BY c.created_at DESC LIMIT 40`, [since])
      .forEach(r => push('comment', r, postRoom(r.space_id), r.title, isPub(r.space_id)));
    db.all(`SELECT p.title, p.space_id, l.created_at AS at, u.first_name, u.last_name FROM post_likes l JOIN posts p ON p.id = l.post_id JOIN users u ON u.id = l.user_id
      WHERE l.created_at >= ? AND COALESCE(p.hidden, 0) = 0 ORDER BY l.created_at DESC LIMIT 40`, [since])
      .forEach(r => push('like', r, postRoom(r.space_id), r.title, isPub(r.space_id)));
    db.all(`SELECT created_at AS at, first_name, last_name FROM users WHERE created_at >= ? AND COALESCE(is_admin, 0) = 0 ORDER BY created_at DESC LIMIT 30`, [since])
      .forEach(r => push('member', r, 'noi_quy', '', true));
    db.all(`SELECT r.created_at AS at, u.first_name, u.last_name FROM program377_reports r JOIN users u ON u.id = r.user_id
      WHERE r.created_at >= ? ORDER BY r.created_at DESC LIMIT 30`, [since])
      .forEach(r => push('report', r, 'p377_bao_cao', '', false));
    return out.sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 80);
  }
  app.get('/api/journey/activity', (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.status(401).json({ error: 'Vui lòng đăng nhập.', code: 'session_required' });
    res.json({ now: db.get("SELECT datetime('now','localtime') AS t").t, events: journeyActivity(!!u.is_admin && req.query.full === '1') });
  });
  const journeyExitDays = () => Math.max(7, Math.min(365, parseInt(scSetting('journey_exit_days'), 10) || 30));
  // Số người đang ở / đã ghé từng phòng (cùng cách tính với bản đồ admin) — chỉ con số, cho bản đồ thành viên; lưu tạm 5 phút
  const JOURNEY_RANK = { noi_quy: 1, ho_so: 1, ho_tro: 1, gioi_thieu: 1, w3: 2, tro_ly: 2, tai_lieu: 2, tra_cuu: 2, nhat_ky: 2, thao_luan: 2, cam_nang: 2, mot_mot: 2, khoa_free: 2, cho: 2, ngam: 3,
    w8: 4, w8_thao_luan: 4, khoa_rieng: 4, p377: 5, p377_thao_luan: 5, p377_bao_cao: 5, p377_hoc: 5 };
  let journeyCountsCache = null;
  function journeyCounts() {
    if (journeyCountsCache && Date.now() - journeyCountsCache.t < 5 * 60e3) return journeyCountsCache.v;
    const cutoff = tbAddDays(tbToday(), -journeyExitDays());
    const here = {}, visited = {};
    journeyPeople().forEach(p => {
      let best = null;
      Object.entries(p.r).forEach(([k, at]) => {
        const rk = JOURNEY_RANK[k]; if (rk == null) return;
        visited[k] = (visited[k] || 0) + 1;
        if (!best || rk > JOURNEY_RANK[best[0]] || (rk === JOURNEY_RANK[best[0]] && at > best[1])) best = [k, at];
      });
      if (best && String(p.l).slice(0, 10) >= cutoff) here[best[0]] = (here[best[0]] || 0) + 1;
    });
    journeyCountsCache = { t: Date.now(), v: { here, visited } };
    return journeyCountsCache.v;
  }
  // Hành trình của chính thành viên (hanh-trinh.html): phòng đã ghé + trạng thái chương trình — không có dữ liệu người khác
  app.get('/api/journey/me', (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.status(401).json({ error: 'Vui lòng đăng nhập.', code: 'session_required' });
    const me = journeyPeople(u.id)[0];
    if (!me) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    const st = t => db.get(`SELECT status FROM ${t} WHERE user_id = ?`, [u.id])?.status || 'none';
    const p377 = st('program377_enrollments');
    res.json({ today: tbToday(), name: me.n, src: me.src, rooms: me.r, is_admin: !!u.is_admin, counts: journeyCounts(),
      w8: p377 === 'approved' ? 'approved' : st('workshop8_enrollments'), p377,
      reported_today: !!db.get('SELECT 1 AS x FROM program377_reports WHERE user_id = ? AND report_date = ?', [u.id, tbToday()]),
      links: { w8_space: scSetting('workshop8_space_url'), p377_space: scSetting('program377_space_url') } });
  });
  app.get('/api/admin/journey-map', (req, res) => {
    if (!journeyAdmin(req, res)) return;
    res.json({ today: tbToday(), exit_days: journeyExitDays(), statuses: ZC_STATUSES, people: journeyPeople() });
  });
  // Đưa 1 khách từ bản đồ vào Kanban khách hàng (cột Chưa liên hệ)
  app.post('/api/admin/journey-map/lead', (req, res) => {
    if (!journeyAdmin(req, res)) return;
    const u = db.get('SELECT id, first_name, last_name, email, phone FROM users WHERE id = ?', [Number(req.body?.user_id) || 0]);
    if (!u) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });
    const phone = zoomPhone(u.phone);
    if (!phone || phone.length < 9) return res.status(400).json({ error: 'Thành viên chưa có số điện thoại hợp lệ.' });
    const cur = db.get('SELECT programs FROM care_leads WHERE phone = ?', [phone]);
    const progs = new Set(String(cur?.programs || '').split(',').filter(Boolean)); progs.add('journey');
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
    db.run(`INSERT INTO care_leads (phone, user_id, name, email, programs, last_at) VALUES (?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(phone) DO UPDATE SET user_id = excluded.user_id, name = excluded.name, email = excluded.email, programs = excluded.programs, last_at = excluded.last_at`,
      [phone, u.id, name, u.email || '', [...progs].join(',')]);
    res.json({ ok: true });
  });
  app.put('/api/admin/journey-map/settings', (req, res) => {
    if (!journeyAdmin(req, res)) return;
    const d = Math.max(7, Math.min(365, parseInt(req.body?.exit_days, 10) || 30));
    db.run("INSERT INTO site_settings (key, value) VALUES ('journey_exit_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(d)]);
    res.json({ ok: true, exit_days: d });
  });

  // ── Bảng giá trị (value stack) của 8 buổi cho thư ngỏ dài: mục cố định + khoá học được cấp khi duyệt + quà tặng ──
  const W8_COURSE_VALUE_PRIVATE = 1500000;   // giá trị mặc định khoá riêng tư khi admin chưa nhập
  const scMoney = v => Number(String(v == null ? '' : v).replace(/[^\d]/g, '')) || 0;
  function w8CourseValues() { try { return JSON.parse(scSetting('workshop8_course_values') || '{}') || {}; } catch { return {}; } }
  function w8OfferCourses() {
    const vals = w8CourseValues();
    return getProgramAccess().workshop8.courses
      .map(id => db.get("SELECT id, title, visibility, price, status FROM courses WHERE id = ? AND status = 'published'", [id])).filter(Boolean)
      .map(c => {
        const own = vals[c.id] !== undefined && String(vals[c.id]).trim() !== '';
        const value = own ? scMoney(vals[c.id]) : (c.price > 0 ? c.price : (c.visibility === 'private' ? W8_COURSE_VALUE_PRIVATE : 0));
        return { id: c.id, title: c.title, private: c.visibility === 'private', value, value_set: own,
          lessons: db.get("SELECT COUNT(*) AS n FROM course_lessons WHERE course_id = ? AND COALESCE(status,'published') = 'published'", [c.id]).n };
      });
  }
  app.get('/api/workshop8/offer', (_req, res) => {
    const tro = scSetting('assistant_limit_w8') || '7';
    const items = scSetting('workshop8_value_stack').split('\n').map(x => x.trim()).filter(Boolean).map(line => {
      const [label, desc, value] = line.split('|').map(y => (y || '').trim());
      return { label: label.replace(/\{tro_ly\}/g, tro), desc: (desc || '').replace(/\{tro_ly\}/g, tro), value: scMoney(value) };
    }).filter(x => x.label);
    const gifts = scSetting('workshop8_bonuses').split('\n').map(x => x.trim()).filter(Boolean).map(line => {
      const parts = line.split('|').map(y => (y || '').trim());
      const link = parts.slice(1).find(p => /^(https?:\/\/|[a-z0-9-]+\.html)/i.test(p)) || '';
      const val = parts.slice(1).find(p => p !== link && /\d/.test(p)) || '';
      return { name: parts[0], link, value: scMoney(val) };
    }).filter(x => x.name);
    const courses = w8OfferCourses();
    const p377Saving = Math.max(0, scMoney(scSetting('p377_price_regular')) - scMoney(scSetting('p377_price_w8')));
    const total = items.reduce((n, x) => n + x.value, 0) + courses.reduce((n, c) => n + c.value, 0) + gifts.reduce((n, g) => n + g.value, 0) + p377Saving;
    res.json({ items, courses, gifts, p377: p377Saving ? { saving: p377Saving, regular: scSetting('p377_price_regular'), w8: scSetting('p377_price_w8') } : null,
      total, price_regular: scSetting('workshop8_price_regular'), price_offer: scSetting('workshop8_price_offer') });
  });

  // ── Bảng giá trị gói 377 ngày: mục 377 + trọn bộ 8 buổi (giá trị = các mục chương trình chính của 8 buổi) + toàn bộ khoá học + quà ──
  function offerLines(key) {
    return scSetting(key).split('\n').map(x => x.trim()).filter(Boolean).map(line => {
      const [label, desc, value] = line.split('|').map(y => (y || '').trim());
      const tro = scSetting('assistant_limit_w8') || '7';
      return { label: label.replace(/\{tro_ly\}/g, tro), desc: (desc || '').replace(/\{tro_ly\}/g, tro), value: scMoney(value) };
    }).filter(x => x.label);
  }
  function offerGifts(key) {
    return scSetting(key).split('\n').map(x => x.trim()).filter(Boolean).map(line => {
      const parts = line.split('|').map(y => (y || '').trim());
      const link = parts.slice(1).find(p => /^(https?:\/\/|[a-z0-9-]+\.html)/i.test(p)) || '';
      const val = parts.slice(1).find(p => p !== link && /\d/.test(p)) || '';
      return { name: parts[0], link, value: scMoney(val) };
    }).filter(x => x.name);
  }
  function offerCourses(program) {
    const vals = w8CourseValues();
    return getProgramAccess()[program].courses
      .map(id => db.get("SELECT id, title, visibility, price, status FROM courses WHERE id = ? AND status = 'published'", [id])).filter(Boolean)
      .map(c => {
        const own = vals[c.id] !== undefined && String(vals[c.id]).trim() !== '';
        const value = own ? scMoney(vals[c.id]) : (c.price > 0 ? c.price : (c.visibility === 'private' ? W8_COURSE_VALUE_PRIVATE : 0));
        return { id: c.id, title: c.title, private: c.visibility === 'private', value, value_set: own,
          lessons: db.get("SELECT COUNT(*) AS n FROM course_lessons WHERE course_id = ? AND COALESCE(status,'published') = 'published'", [c.id]).n };
      });
  }
  app.get('/api/program377/offer', (_req, res) => {
    const items = offerLines('p377_value_stack');
    const w8Items = offerLines('workshop8_value_stack');
    let sessions = [];
    try { sessions = JSON.parse(scSetting('workshop8_sessions') || '[]'); } catch {}
    const w8 = { value: w8Items.reduce((n, x) => n + x.value, 0), items: w8Items.map(x => x.label),
      sessions: (Array.isArray(sessions) ? sessions : []).filter(x => x && x.title).map(x => ({ title: x.title, content_html: x.content_html || '' })) };
    const courses = offerCourses('program377');
    const gifts = offerGifts('p377_bonuses');
    const total = items.reduce((n, x) => n + x.value, 0) + w8.value + courses.reduce((n, c) => n + c.value, 0) + gifts.reduce((n, g) => n + g.value, 0);
    res.json({ items, w8, courses, gifts, total,
      price_list: scSetting('p377_price_list'), price: scSetting('p377_price_regular'), price_w8: scSetting('p377_price_w8') });
  });

  // Admin đánh dấu / bỏ đánh dấu bài giới thiệu
  app.post('/api/posts/:id/showcase', (req, res) => {
    if (!getUserFlags(req.body?.user_id).isAdmin) return res.status(403).json({ error: 'Chỉ admin mới chọn được bài giới thiệu.' });
    const post = db.get('SELECT id, showcase FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng.' });
    const val = post.showcase ? 0 : 1;
    db.run('UPDATE posts SET showcase = ? WHERE id = ?', [val, post.id]);
    res.json({ ok: true, showcase: val });
  });
  // "Nhận tư vấn" từ khung giới thiệu → tin Liên lạc (bộ phận Tư vấn) + báo Ban tổ chức qua An Tâm. Mỗi chương trình 1 lần / 24 giờ.
  app.post('/api/showcase/consult', (req, res) => {
    const userId = userFromSession(req)?.id || Number(req.body?.user_id) || 0;
    const program = req.body?.program;
    const P = SHOWCASE_PROGRAMS[program] || (program === 'workshop3' ? { label: '3 Buổi Workshop miễn phí' } : null);
    if (!P) return res.status(400).json({ error: 'Chương trình không hợp lệ.' });
    const u = userId && db.get('SELECT id, first_name, last_name, email, phone FROM users WHERE id = ?', [userId]);
    if (!u) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    const tag = `[showcase:${program}]`;
    const dup = db.get(`SELECT id FROM contact_messages WHERE user_id = ? AND department = 'consult' AND message LIKE ?
      AND created_at >= datetime('now','localtime','-1 day')`, [u.id, `%${tag}%`]);
    if (dup) return res.json({ ok: true, duplicate: true });
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
    const postTitle = cleanText(req.body?.post_title, 200);
    const msg = `Muốn được tư vấn chương trình ${P.label} (bấm "Nhận tư vấn" ở khung giới thiệu trên Feed${postTitle ? `, khi xem bài "${postTitle}"` : ''}). ${tag}`;
    const id = db.run('INSERT INTO contact_messages (user_id, full_name, phone, email, department, message) VALUES (?,?,?,?,?,?)',
      [u.id, name, u.phone || null, u.email || null, 'consult', msg]).lastInsertRowid;
    res.json({ ok: true });
    showcaseLog(u.id, program, 'consult');
    if (SHOWCASE_PROGRAMS[program]) showcaseLead(u.id, program, 'consult');
    antamNotify('consult', id, `📞 <b>Khách muốn tư vấn ${antamEsc(P.label)}</b>\n\n${antamWho(u.id)}${postTitle ? `\n\nĐang xem bài: ${antamEsc(postTitle)}` : ''}\n\nXem trong admin → Liên lạc: ${SITE_URL}/admin.html`, false);
  });

  function notifyEnrollmentApproved(userId, programName, page, intakeRedirect) {
    const u = db.get('SELECT email, first_name, ttm_intake_done_at FROM users WHERE id = ?', [userId]);
    if (!u) return;
    const trigger = db.get("SELECT value FROM site_settings WHERE key = 'ttm_intake_trigger'")?.value || 'none';
    // "Khi đăng ký 377 Ngày": chỉ 377 ngày cần khảo sát; "Khi đăng ký 8 Buổi": cả 8 buổi và 377 ngày
    const needIntake = !u.ttm_intake_done_at && (trigger === 'signup' || trigger === 'workshop8' || (trigger === 'program377' && intakeRedirect === '377'));
    const title = `Đăng ký ${programName} đã được duyệt 🎉`;
    const content = needIntake
      ? 'Bước tiếp theo: hoàn thành phiếu khảo sát Thân – Tâm – Mệnh để Ban tổ chức cá nhân hoá lộ trình cho bạn.'
      : 'Bạn đã có thể bắt đầu chương trình ngay bây giờ.';
    const link = needIntake ? `intake-than-tam-menh.html?redirect=${intakeRedirect}` : page;
    db.run('INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)',
      [userId, 'course', title, content, link]);
    pushNotify(userId, { title, body: content, link });
    if (!u.email) return;
    const name = String(u.first_name || '').replace(/[<>&"]/g, '');
    sendEmail({
      to: u.email,
      subject: `✅ ${title}`,
      html: emailWrap(title, `
        <p>Chào ${name || 'bạn'},</p>
        <p>Ban tổ chức ${communityName()} đã duyệt đăng ký tham gia chương trình <strong>${programName}</strong> của bạn.</p>
        <p>${content}</p>
        <a class="btn" href="${SITE_URL}/${link}">${needIntake ? 'Làm khảo sát Thân – Tâm – Mệnh' : 'Vào chương trình'}</a>
        <p>📖 Cách tham gia Zoom, nộp báo cáo hằng ngày và bật thông báo: xem <a href="${SITE_URL}/huong-dan.html#muc-9">Hướng dẫn sử dụng</a>.</p>
      `),
    }).catch(err => console.error('[enroll-approved email]', err.message));
  }

  // Duyệt / từ chối dùng chung cho admin.html và nút trên Telegram (An Tâm)
  function approveProgram377Enrollment(id, byUserId, startDateIn) {
    const enrollment = db.get('SELECT id, user_id, status FROM program377_enrollments WHERE id = ?', [id]);
    if (!enrollment) return { ok: false, error: 'Không tìm thấy đăng ký.' };
    const todayStr = db.get("SELECT date('now','localtime') AS d").d;
    const startDate = startDateIn && /^\d{4}-\d{2}-\d{2}$/.test(startDateIn) ? startDateIn : todayStr;
    db.run(
      "UPDATE program377_enrollments SET status = 'approved', start_date = ?, approved_at = datetime('now','localtime'), approved_by = ? WHERE id = ?",
      [startDate, byUserId || null, id]
    );
    grantProgramAccess('program377', enrollment.user_id);
    notifyEnrollmentApproved(enrollment.user_id, '377 ngày thực hành', 'program377.html', '377');
    antamResolve('p377', id, 'approved', byUserId);
    return { ok: true };
  }
  function rejectProgram377Enrollment(id, note, byUserId) {
    const e = db.get('SELECT user_id, status FROM program377_enrollments WHERE id = ?', [id]);
    db.run("UPDATE program377_enrollments SET status = 'rejected', admin_note = ? WHERE id = ?", [note || null, id]);
    if (e && e.status !== 'rejected') notifyEnrollRejected(e.user_id, '377 ngày thực hành', note);
    antamResolve('p377', id, 'rejected', byUserId);
  }

  app.post('/api/admin/program377/enrollments/:id/approve', requireAdmin, (req, res) => {
    const r = approveProgram377Enrollment(req.params.id, req.adminUserId, req.body.start_date);
    if (!r.ok) return res.status(404).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post('/api/admin/program377/enrollments/:id/reject', requireAdmin, (req, res) => {
    rejectProgram377Enrollment(req.params.id, req.body.admin_note, req.adminUserId);
    res.json({ ok: true });
  });

  app.get('/api/admin/workshop8/enrollments', requireAdmin, (req, res) => {
    const status = req.query.status || 'pending';
    const rows = db.all(
      `SELECT e.*, u.first_name, u.last_name, u.email
       FROM workshop8_enrollments e JOIN users u ON u.id = e.user_id
       WHERE e.status = ? ORDER BY e.enrolled_at DESC`,
      [status]
    );
    res.json({ enrollments: rows });
  });

  function approveWorkshop8Enrollment(id, byUserId) {
    const enrollment = db.get('SELECT id, user_id FROM workshop8_enrollments WHERE id = ?', [id]);
    if (!enrollment) return { ok: false, error: 'Không tìm thấy đăng ký.' };
    db.run(
      "UPDATE workshop8_enrollments SET status = 'approved', approved_at = datetime('now','localtime'), approved_by = ? WHERE id = ?",
      [byUserId || null, id]
    );
    grantProgramAccess('workshop8', enrollment.user_id);
    notifyEnrollmentApproved(enrollment.user_id, '8 Buổi Chuyên Sâu', 'workshop8.html', 'workshop8');
    antamResolve('w8', id, 'approved', byUserId);
    return { ok: true };
  }
  function rejectWorkshop8Enrollment(id, note, byUserId) {
    const e = db.get('SELECT user_id, status FROM workshop8_enrollments WHERE id = ?', [id]);
    db.run("UPDATE workshop8_enrollments SET status = 'rejected', admin_note = ? WHERE id = ?", [note || null, id]);
    if (e && e.status !== 'rejected') notifyEnrollRejected(e.user_id, '8 Buổi Chuyên Sâu', note);
    antamResolve('w8', id, 'rejected', byUserId);
  }

  app.post('/api/admin/workshop8/enrollments/:id/approve', requireAdmin, (req, res) => {
    const r = approveWorkshop8Enrollment(req.params.id, req.adminUserId);
    if (!r.ok) return res.status(404).json({ error: r.error });
    res.json({ ok: true });
  });

  app.post('/api/admin/workshop8/enrollments/:id/reject', requireAdmin, (req, res) => {
    rejectWorkshop8Enrollment(req.params.id, req.body.admin_note, req.adminUserId);
    res.json({ ok: true });
  });

  app.get('/api/admin/program377/reports', requireAdmin, (req, res) => {
    const { user_id = '', from = '', to = '', limit = 50, offset = 0 } = req.query;
    let sql = `SELECT r.*, u.first_name, u.last_name, u.email
               FROM program377_reports r JOIN users u ON u.id = r.user_id WHERE 1=1`;
    const params = [];
    if (user_id) { sql += ' AND r.user_id = ?'; params.push(user_id); }
    if (from) { sql += ' AND r.report_date >= ?'; params.push(from); }
    if (to)   { sql += ' AND r.report_date <= ?'; params.push(to); }
    sql += ' ORDER BY r.report_date DESC, r.id DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const reports = db.all(sql, params).map(r => ({ ...r, meal_colors: JSON.parse(r.meal_colors || '[]'), meal_tastes: JSON.parse(r.meal_tastes || '[]') }));
    res.json({ reports });
  });

  app.get('/api/admin/program377/sessions', requireAdmin, (_req, res) => {
    res.json({ sessions: db.all('SELECT * FROM program377_sessions ORDER BY session_date ASC') });
  });

  app.post('/api/admin/program377/sessions', requireAdmin, (req, res) => {
    const { session_date, session_time, title, session_type, link_url, description, content_html } = req.body;
    if (!session_date || !title?.trim()) return res.status(400).json({ error: 'Thiếu ngày hoặc tiêu đề.' });
    const r = db.run(
      'INSERT INTO program377_sessions (session_date, session_time, title, session_type, link_url, description, content_html, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [session_date, session_time?.trim() || null, title.trim(), session_type || 'zoom', link_url || null, description || null, content_html || null, req.adminUserId || null]
    );
    p377SetHomework(r.lastInsertRowid, req.body);
    res.status(201).json({ ok: true, id: r.lastInsertRowid });
  });
  // Chỉ cập nhật bài tập khi có gửi lên (khung "Sửa buổi" cũ không gửi → giữ nguyên)
  const hwIds = v => JSON.stringify((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 20));
  function p377SetHomework(id, b) {
    if (b.hw_note !== undefined) db.run('UPDATE program377_sessions SET hw_note = ? WHERE id = ?', [String(b.hw_note || '').slice(0, 3000) || null, id]);
    if (b.hw_ids !== undefined) db.run('UPDATE program377_sessions SET hw_ids = ? WHERE id = ?', [hwIds(b.hw_ids), id]);
  }

  app.patch('/api/admin/program377/sessions/:id', requireAdmin, (req, res) => {
    const { session_date, session_time, title, session_type, link_url, description, content_html } = req.body;
    db.run(
      'UPDATE program377_sessions SET session_date=?, session_time=?, title=?, session_type=?, link_url=?, description=?, content_html=? WHERE id=?',
      [session_date, session_time?.trim() || null, title?.trim(), session_type || 'zoom', link_url || null, description || null, content_html || null, req.params.id]
    );
    p377SetHomework(req.params.id, req.body);
    res.json({ ok: true });
  });

  app.delete('/api/admin/program377/sessions/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM program377_sessions WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  // ── Admin: tổng quan Agent An Lộ (Cài đặt → Kỹ thuật → Agent An Lộ) ──
  // An Lộ đọc bản tổng kết khảo sát Thân-Tâm-Mệnh → xác định thể trạng + soạn bản nháp lộ trình chờ admin duyệt.
  app.get('/api/admin/agent1/overview', requireAdmin, (_req, res) => {
    const DRAFT_STATE = `(CASE WHEN r.draft_content LIKE '⏳%' THEN 'generating'
                              WHEN r.draft_content LIKE '[Lỗi tạo bản nháp%' THEN 'error' ELSE 'ok' END)`;
    const byStatus = {};
    db.all('SELECT status, COUNT(*) AS n FROM ttm_roadmaps GROUP BY status').forEach(r => { byStatus[r.status] = r.n; });
    const drafts = {};
    db.all(`SELECT ${DRAFT_STATE} AS s, COUNT(*) AS n FROM ttm_roadmaps r GROUP BY s`).forEach(r => { drafts[r.s] = r.n; });
    // Thể trạng theo lộ trình mới nhất của mỗi thành viên
    const theTrang = db.all(
      `SELECT COALESCE(r.the_trang, 'Chưa xác định') AS the_trang, COUNT(*) AS n
       FROM ttm_roadmaps r
       WHERE r.id = (SELECT MAX(id) FROM ttm_roadmaps r2 WHERE r2.user_id = r.user_id)
       GROUP BY COALESCE(r.the_trang, 'Chưa xác định') ORDER BY n DESC`);
    const recent = db.all(
      `SELECT r.id, r.user_id, r.status, r.the_trang, r.created_at, r.reviewed_at, ${DRAFT_STATE} AS draft_state,
              u.first_name, u.last_name, u.email
       FROM ttm_roadmaps r JOIN users u ON u.id = r.user_id
       ORDER BY r.id DESC LIMIT 20`);
    let host = '';
    try { host = new URL(GOCLAW_BASE_URL).host; } catch (e) {}
    // Ai nhận thông báo "An Lộ soạn xong" + được vào trang duyệt: admin và người được cấp quyền
    const reviewers = db.all(
      `SELECT id, first_name, last_name, email, is_admin, agent1_reviewer, status, COALESCE(agent1_notify_off, 0) AS notify_off,
              (CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END) AS has_password,
              (CASE WHEN telegram_chat_id IS NOT NULL AND telegram_chat_id != '' THEN 1 ELSE 0 END) AS telegram_linked,
              (CASE WHEN antam_chat_id IS NOT NULL AND antam_chat_id != '' THEN 1 ELSE 0 END) AS antam_linked
       FROM users WHERE is_admin = 1 OR agent1_reviewer = 1
       ORDER BY is_admin DESC, first_name`);
    res.json({
      config: { goclaw: !!GOCLAW_WEBHOOK_SECRET, host, telegram: !!TELEGRAM_BOT_TOKEN, antam: !!antamToken() },
      reviewers,
      stats: {
        intakes: db.get('SELECT COUNT(*) AS n FROM ttm_intake_responses')?.n || 0,
        roadmaps: Object.values(byStatus).reduce((a, b) => a + b, 0),
        by_status: byStatus,
        drafts,
      },
      the_trang: theTrang,
      recent,
    });
  });

  // ── Admin: tổng quan Agent An Nhiên (Cài đặt → Kỹ thuật → Agent An Nhiên) ──
  // Trạng thái cấu hình (chỉ có/không, không lộ khoá), ai đã kết nối Telegram, ai nhận cảnh báo,
  // và các cảnh báo gần đây. Không trả telegram_chat_id ra ngoài.
  app.get('/api/admin/agent2/overview', requireAdmin, (_req, res) => {
    const linked = db.all(
      `SELECT id, first_name, last_name, email, is_admin, status, agent2_alert_recipient, COALESCE(agent2_notify_off, 0) AS notify_off,
              (CASE WHEN telegram_chat_id IS NOT NULL AND telegram_chat_id != '' THEN 1 ELSE 0 END) AS telegram_linked
       FROM users
       WHERE (telegram_chat_id IS NOT NULL AND telegram_chat_id != '') OR agent2_alert_recipient = 1 OR is_admin = 1
       ORDER BY is_admin DESC, agent2_alert_recipient DESC, first_name`);
    const count = (sql) => db.get(sql)?.n || 0;
    const warnRows = [
      ...db.all(`SELECT m.user_id, m.log_date AS d, m.flag_level, m.flagged_reason, u.first_name, u.last_name, 'Nhật ký ăn uống' AS source
                 FROM meal_logs m JOIN users u ON u.id = m.user_id
                 WHERE m.flag_level IN ('warning','urgent') ORDER BY m.log_date DESC LIMIT 30`),
      ...db.all(`SELECT r.user_id, r.report_date AS d, r.flag_level, r.flagged_reason, u.first_name, u.last_name, 'Báo cáo 377 ngày' AS source
                 FROM program377_reports r JOIN users u ON u.id = r.user_id
                 WHERE r.flag_level IN ('warning','urgent') ORDER BY r.report_date DESC LIMIT 30`),
    ];
    // Báo cáo 377 ngày cũng được chép sang meal_logs → bỏ trùng theo (người, ngày, lý do)
    const seen = new Set();
    const warnings = warnRows
      .sort((a, b) => String(b.d).localeCompare(String(a.d)) || (a.source === 'Báo cáo 377 ngày' ? -1 : 1))
      .filter(w => { const k = `${w.user_id}|${w.d}|${w.flagged_reason || ''}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 20);
    res.json({
      config: {
        goclaw: !!GOCLAW_AGENT2_WEBHOOK_SECRET,
        telegram: !!TELEGRAM_BOT_TOKEN,
        bot_username: TELEGRAM_BOT_USERNAME || null,
      },
      linked,
      stats: {
        meal_feedback: count("SELECT COUNT(*) AS n FROM meal_logs WHERE ai_feedback IS NOT NULL AND ai_feedback != ''"),
        p377_feedback: count("SELECT COUNT(*) AS n FROM program377_reports WHERE ai_feedback IS NOT NULL AND ai_feedback != ''"),
        warnings_total: warnings.length,
      },
      warnings,
    });
  });

  // ══ Agent An Tâm — bot Telegram vận hành (đăng ký, đặt lịch, tài chính) ═══════════
  // Bot RIÊNG (token trong admin_secrets 'antam_bot_token', nhập ở Cài đặt → Agent An Tâm), không
  // qua GoClaw. Báo sự kiện cho admin + người được thêm; nút Duyệt/Từ chối ngay trên Telegram
  // (callback_query → /api/antam/webhook, có secret_token). Duyệt trên web cũng tự cập nhật tin Telegram.
  const ANTAM_KINDS = {
    w8:     { ok: '✅ Duyệt', no: '❌ Từ chối', done: ['✅ Đã duyệt', '❌ Đã từ chối'] },
    p377:   { ok: '✅ Duyệt', no: '❌ Từ chối', done: ['✅ Đã duyệt', '❌ Đã từ chối'] },
    course: { ok: '✅ Duyệt', no: '❌ Từ chối', done: ['✅ Đã duyệt', '❌ Đã từ chối'] },
    coach:  { ok: '✅ Xác nhận lịch', no: '❌ Huỷ lịch', done: ['✅ Đã xác nhận lịch', '❌ Đã huỷ lịch'] },
    order:  { ok: '✅ Đã nhận tiền', no: '❌ Huỷ đơn', done: ['✅ Đã xác nhận nhận tiền', '❌ Đã huỷ đơn'] },
    roadmap: { ok: '✅ Duyệt nguyên bản nháp', no: '↩️ Trả lại', done: ['✅ Đã duyệt lộ trình', '↩️ Đã trả lại'] },
  };
  const antamEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let antamVia = 'web';   // 'telegram' | 'sepay' trong lúc xử lý đồng bộ từ các nguồn đó

  function antamToken() { return getSecret('antam_bot_token'); }

  async function antamApi(method, payload, tokenOverride) {
    const token = tokenOverride || antamToken();
    if (!token) return { ok: false, description: 'Chưa kết nối bot An Tâm' };
    try {
      // TELEGRAM_API_BASE chỉ dùng khi thử nghiệm cục bộ (Telegram giả); mặc định là Telegram thật
      const base = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
      const r = await fetch(`${base}/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(15000),
      });
      const out = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
      // Ghi lại khi Telegram từ chối (trước đây lỗi bị nuốt, khó tìm nguyên nhân). answerCallbackQuery hết hạn thì bỏ qua.
      if (!out.ok && method !== 'answerCallbackQuery') console.error(`[An Tâm] ${method} thất bại:`, out.description || out.error_code || '');
      return out;
    } catch (e) { console.error(`[An Tâm] ${method} lỗi:`, e.message); return { ok: false, description: e.message }; }
  }

  // Người nhận: còn hoạt động, đã kết nối bot An Tâm, chưa tắt tin, và là admin hoặc được thêm
  function antamRecipients() {
    return db.all(
      `SELECT id, is_admin, antam_chat_id, COALESCE(antam_can_approve, 0) AS can_approve
       FROM users
       WHERE status = 'active' AND antam_chat_id IS NOT NULL AND antam_chat_id != ''
         AND COALESCE(antam_notify_off, 0) = 0 AND (is_admin = 1 OR antam_recipient = 1)`);
  }

  // Dòng mô tả thành viên trong tin nhắn
  function antamWho(userId) {
    const u = db.get('SELECT first_name, last_name, email, phone FROM users WHERE id = ?', [userId]) || {};
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || `Thành viên #${userId}`;
    return `👤 <b>${antamEsc(name)}</b>${u.phone ? ` · ${antamEsc(u.phone)}` : ''}${u.email ? `\n✉️ ${antamEsc(u.email)}` : ''}`;
  }

  // Gửi 1 sự kiện tới mọi người nhận. withButtons=false → chỉ báo tin (không có nút duyệt).
  // opts.recipients: [{ antam_chat_id, canApprove }] thay cho danh sách mặc định (vd người duyệt lộ trình)
  // opts.linkButton: { text, url } — thêm 1 nút mở link (hàng riêng) cho mọi người nhận
  // Gửi tin An Tâm có thử lại: lỗi mạng ("fetch failed", quá giờ), Telegram bận (5xx) hoặc giới hạn (429)
  // → thử lại tối đa 3 lần (chờ 2s, 5s hoặc theo retry_after). Lỗi do người nhận (chặn bot, sai chat) thì không thử lại.
  async function antamSendRetry(payload) {
    let r;
    for (let i = 0; i < 3; i++) {
      r = await antamApi('sendMessage', payload);
      if (r.ok) return r;
      const transient = r.error_code === 429 || (r.error_code >= 500) || !r.error_code;
      if (!transient || i === 2) break;
      const wait = r.error_code === 429 ? Math.min(30, Number(r.parameters?.retry_after) || 5) * 1000 : (i === 0 ? 2000 : 5000);
      await new Promise(res => setTimeout(res, wait));
    }
    return r;
  }
  async function antamNotify(kind, refId, text, withButtons = true, opts = {}) {
    if (!antamToken()) return 0;
    let delivered = 0;
    try {
      const k = ANTAM_KINDS[kind];
      const actionRow = withButtons && k ? [
        { text: k.ok, callback_data: `at:${kind}:${refId}:ok` },
        { text: k.no, callback_data: `at:${kind}:${refId}:no` },
      ] : null;
      const linkRow = opts.linkButton ? [{ text: opts.linkButton.text, url: opts.linkButton.url }] : null;
      const recipients = opts.recipients || antamRecipients().map(u => ({ antam_chat_id: u.antam_chat_id, canApprove: !!(u.is_admin || u.can_approve) }));
      for (const u of recipients) {
        const payload = { chat_id: u.antam_chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true };
        const rows = [];
        if (actionRow && u.canApprove) rows.push(actionRow);
        if (linkRow) rows.push(linkRow);
        if (rows.length) payload.reply_markup = { inline_keyboard: rows };
        const r = await antamSendRetry(payload);
        if (r.ok) delivered++;
        if (r.ok && actionRow) {
          db.run('INSERT INTO antam_messages (kind, ref_id, chat_id, message_id, text) VALUES (?,?,?,?,?)',
            [kind, String(refId), String(u.antam_chat_id), r.result.message_id, text]);
        } else if (!r.ok) console.error('[An Tâm] gửi tin thất bại:', r.description || '');
      }
    } catch (e) { console.error('[An Tâm] notify:', e.message); }
    return delivered;
  }

  // Một việc đã được xử lý (trên web, qua Telegram hoặc SePay) → ghi nhật ký + sửa mọi tin Telegram
  // của việc đó: bỏ nút, thêm dòng "✅ Đã duyệt — Tên lúc HH:MM".
  function antamResolve(kind, refId, result, byUserId, opts = {}) {
    try {
      const via = antamVia;
      if (opts.log !== false) db.run('INSERT INTO antam_log (kind, ref_id, action, by_user_id, via) VALUES (?,?,?,?,?)',
        [kind, String(refId), result, byUserId || null, via]);
      const msgs = db.all('SELECT * FROM antam_messages WHERE kind = ? AND ref_id = ? AND resolved_at IS NULL', [kind, String(refId)]);
      if (!msgs.length) return;
      db.run("UPDATE antam_messages SET resolved_at = datetime('now','localtime') WHERE kind = ? AND ref_id = ? AND resolved_at IS NULL", [kind, String(refId)]);
      const by = byUserId ? db.get('SELECT first_name, last_name FROM users WHERE id = ?', [byUserId]) : null;
      const who = via === 'sepay' ? 'SePay tự động' : (by ? `${by.first_name || ''} ${by.last_name || ''}`.trim() : 'Admin');
      const at = db.get("SELECT strftime('%H:%M %d/%m', 'now', 'localtime') AS t").t;
      const label = (ANTAM_KINDS[kind] || { done: ['✅ Đã xử lý', '❌ Đã từ chối'] }).done[result === 'approved' ? 0 : 1];
      const stamp = `\n\n<b>${label}</b> — ${antamEsc(who)}${via === 'telegram' ? ' (qua Telegram)' : via === 'web' ? ' (trên web)' : ''} · ${at}`;
      msgs.forEach(m => antamApi('editMessageText', {
        chat_id: m.chat_id, message_id: m.message_id, text: (m.text || '') + stamp,
        parse_mode: 'HTML', disable_web_page_preview: true,
      }));
    } catch (e) { console.error('[An Tâm] resolve:', e.message); }
  }

  // Thực hiện Duyệt/Từ chối từ nút Telegram — gọi đúng logic như admin.html
  function antamPerform(kind, id, approve, byUserId) {
    const done = { ok: true, msg: approve ? 'Đã duyệt ✅' : 'Đã từ chối ❌' };
    const handled = (status) => {
      // Việc đã được xử lý trước đó (có thể trên web) → chỉ cập nhật lại tin, không làm lại
      antamResolve(kind, id, ['approved', 'confirmed', 'completed'].includes(status) ? 'approved' : 'rejected', null, { log: false });
      return { ok: false, msg: 'Việc này đã được xử lý trước đó.' };
    };
    antamVia = 'telegram';
    try {
      if (kind === 'w8' || kind === 'p377') {
        const table = kind === 'w8' ? 'workshop8_enrollments' : 'program377_enrollments';
        const row = db.get(`SELECT status FROM ${table} WHERE id = ?`, [id]);
        if (!row) return { ok: false, msg: 'Không tìm thấy đăng ký.' };
        if (row.status !== 'pending') return handled(row.status);
        if (kind === 'w8') approve ? approveWorkshop8Enrollment(id, byUserId) : rejectWorkshop8Enrollment(id, 'Từ chối qua Telegram', byUserId);
        else approve ? approveProgram377Enrollment(id, byUserId) : rejectProgram377Enrollment(id, 'Từ chối qua Telegram', byUserId);
        return done;
      }
      if (kind === 'course') {
        const row = db.get(`SELECT ce.status, ce.user_id, c.id AS course_id, c.title FROM course_enrollments ce
                            JOIN courses c ON c.id = ce.course_id WHERE ce.id = ?`, [id]);
        if (!row) return { ok: false, msg: 'Yêu cầu không còn (có thể đã bị từ chối trên web).' };
        if (row.status !== 'pending') return handled(row.status);
        if (approve) {
          db.run("UPDATE course_enrollments SET status = 'approved' WHERE id = ?", [id]);
          notifyCourseApproved(row.user_id, row.course_id, row.title);
        } else {
          db.run('DELETE FROM course_enrollments WHERE id = ?', [id]);
          notifyEnrollRejected(row.user_id, `khoá học "${row.title}"`);
        }
        antamResolve('course', id, approve ? 'approved' : 'rejected', byUserId);
        return done;
      }
      if (kind === 'coach') {
        const b = db.get('SELECT * FROM coaching_bookings WHERE id = ?', [id]);
        if (!b) return { ok: false, msg: 'Không tìm thấy lịch hẹn.' };
        if (b.status !== 'pending') return handled(b.status);
        if (approve) {
          db.run(`UPDATE coaching_bookings SET status = 'confirmed', confirmed_date = ?, confirmed_time = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
            [b.preferred_date, b.preferred_time, id]);
        } else {
          db.run(`UPDATE coaching_bookings SET status = 'cancelled', admin_note = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
            ['Huỷ qua Telegram', id]);
        }
        const title = approve ? 'Lịch coach 1-1 đã được xác nhận ✅' : 'Lịch coach 1-1 chưa sắp xếp được';
        const content = approve
          ? `Buổi coach của bạn lúc ${b.preferred_time} ngày ${String(b.preferred_date).split('-').reverse().join('/')} đã được xác nhận. Link buổi gặp sẽ được gửi sau.`
          : 'Ban tổ chức chưa sắp xếp được khung giờ bạn chọn. Vui lòng đặt lại khung giờ khác.';
        db.run('INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)',
          [b.user_id, 'course', title, content, 'coach-1-1.html']);
        pushNotify(b.user_id, { title, body: content, link: 'coach-1-1.html' });
        antamResolve('coach', id, approve ? 'approved' : 'rejected', byUserId);
        return done;
      }
      if (kind === 'roadmap') {
        const r = db.get('SELECT id, status, draft_content, the_trang FROM ttm_roadmaps WHERE id = ?', [id]);
        if (!r) return { ok: false, msg: 'Không tìm thấy lộ trình.' };
        if (r.status !== 'pending_approval') return handled(r.status);
        const draft = String(r.draft_content || '');
        if (approve && (draft.startsWith('⏳') || draft.startsWith('[Lỗi tạo bản nháp')))
          return { ok: false, msg: 'Bản nháp chưa sẵn sàng — mở trang duyệt để tạo lại.' };
        if (approve) {
          // Giống bấm "Duyệt" trên web với nội dung bản nháp giữ nguyên
          db.run(
            "UPDATE ttm_roadmaps SET status = 'approved', final_content = ?, the_trang = ?, reviewed_at = datetime('now','localtime'), reviewed_by = ? WHERE id = ?",
            [stripDraftBanner(draft) || null, r.the_trang || null, byUserId || null, id]);
          notifyRoadmapApproved(id);
        } else {
          db.run(
            "UPDATE ttm_roadmaps SET status = 'rejected', admin_note = ?, reviewed_at = datetime('now','localtime'), reviewed_by = ? WHERE id = ?",
            ['Trả lại qua Telegram', byUserId || null, id]);
        }
        antamResolve('roadmap', id, approve ? 'approved' : 'rejected', byUserId);
        return { ok: true, msg: approve ? 'Đã duyệt lộ trình ✅' : 'Đã trả lại ↩️' };
      }
      if (kind === 'order') {
        const o = db.get('SELECT status FROM orders WHERE id = ?', [id]);
        if (!o) return { ok: false, msg: 'Không tìm thấy đơn hàng.' };
        if (!['pending', 'claimed'].includes(o.status)) return handled(o.status);
        setOrderStatus(id, approve ? 'completed' : 'cancelled', byUserId);
        return { ok: true, msg: approve ? 'Đã xác nhận nhận tiền ✅' : 'Đã huỷ đơn ❌' };
      }
      return { ok: false, msg: 'Loại việc không hợp lệ.' };
    } finally { antamVia = 'web'; }
  }

  // Webhook của bot An Tâm — Telegram gửi kèm secret_token đã đặt lúc kết nối
  // ── An Tâm: "➕ Khách mới" — gửi email chào mừng cho khách để lại thông tin (quảng cáo Facebook) ──
  // Hỏi email → họ tên → tóm tắt + nút 📤 Gửi / 🔁 Đổi mẫu / ❌ Huỷ. Dùng chung sendTemplateEmail và
  // lịch sử với tab "Gửi thủ công". Quyền: users.antam_can_email (NULL → admin có, người khác không).
  const ANTAM_LEAD_KEYBOARD = { keyboard: [[{ text: '➕ Khách mới' }]], resize_keyboard: true, is_persistent: true };
  const antamLeadState = new Map();   // chatId → { step, email, name, at }
  const antamLeadPending = new Map(); // token → { chatId, userId, email, name, templateId, at }
  const LEAD_TTL = 15 * 60e3;
  function antamCanEmail(u) {
    return !!u && u.status === 'active' && (u.antam_can_email === 1 || (u.is_admin && u.antam_can_email == null));
  }
  function defaultLeadTemplateId() {
    const t = crmTemplates();
    return (t.find(x => x.name === 'Cảm ơn & mời 3 buổi workshop miễn phí') || t[0] || {}).id;
  }
  function parseLeadText(text) {
    const m = String(text || '').match(/[^\s,;<>()]+@[^\s,;<>()]+\.[^\s,;<>()]{2,}/);
    if (!m) return null;
    const name = String(text).replace(m[0], ' ').replace(/[,;|\-–]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { email: m[0].toLowerCase(), name: name.slice(0, 80) };
  }
  function leadSummary(p, note) {
    const tpl = crmTemplates().find(t => t.id === p.templateId);
    return `📧 <b>Gửi email cho khách mới?</b>\nEmail: <b>${antamEsc(p.email)}</b>\nHọ tên: <b>${antamEsc(p.name || '(không có — email sẽ chào "bạn")')}</b>${p.name ? ` · chào là "<b>${antamEsc(callName(p.name))}</b>"` : ''}\nMẫu: <b>${antamEsc(tpl ? tpl.name : '(chưa có mẫu)')}</b>${note ? '\n\n' + note : ''}`;
  }
  const leadButtons = token => ({ inline_keyboard: [
    [{ text: '📤 Gửi', callback_data: `ae:send:${token}` }, { text: '🔁 Đổi mẫu', callback_data: `ae:tpl:${token}` }, { text: '❌ Huỷ', callback_data: `ae:no:${token}` }]] });
  async function antamLeadConfirm(chatId, userId, email, name) {
    for (const [k, v] of antamLeadPending) if (Date.now() - v.at > LEAD_TTL) antamLeadPending.delete(k);
    const token = crypto.randomBytes(5).toString('hex');
    const p = { chatId, userId, email, name, templateId: defaultLeadTemplateId(), at: Date.now() };
    if (!p.templateId) return antamApi('sendMessage', { chat_id: chatId, text: '⚠️ Chưa có mẫu email nào — tạo ở Admin → Email CRM → Templates.' });
    antamLeadPending.set(token, p);
    const prev = db.get("SELECT created_at FROM manual_email_log WHERE to_email = ? AND template_id = ? AND status = 'sent' ORDER BY id DESC LIMIT 1", [email, p.templateId]);
    await antamApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: leadSummary(p, prev ? `⚠️ Địa chỉ này đã nhận mẫu này lúc ${antamEsc(prev.created_at)}.` : ''), reply_markup: leadButtons(token) });
  }
  // Trả true nếu tin nhắn đã được xử lý trong luồng "Khách mới"
  async function antamLeadMessage(me, chatId, text) {
    const st = antamLeadState.get(chatId);
    const start = /^(\/khach|\/khachmoi|➕ Khách mới|khách mới)$/i.test(text);
    const quick = !st && parseLeadText(text);
    if (!start && !st && !quick) return false;
    if (!antamCanEmail(me)) {
      await antamApi('sendMessage', { chat_id: chatId, text: 'Bạn chưa có quyền gửi email cho khách qua An Tâm. Nhờ admin bật quyền "Gửi email khách" trong Cài đặt → Agent An Tâm.' });
      return true;
    }
    if (start) {
      antamLeadState.set(chatId, { step: 'email', at: Date.now() });
      await antamApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', reply_markup: ANTAM_LEAD_KEYBOARD,
        text: '📧 <b>Khách mới</b> — nhập <b>email</b> của khách.\nCó thể gõ luôn cả họ tên trên 1 dòng, VD: <code>khach@gmail.com, Lê Ly</code>\n(gõ /huy để huỷ)' });
      return true;
    }
    if (/^\/huy$/i.test(text) || /^huỷ$|^huy$/i.test(text)) {
      antamLeadState.delete(chatId);
      await antamApi('sendMessage', { chat_id: chatId, text: 'Đã huỷ.', reply_markup: ANTAM_LEAD_KEYBOARD });
      return true;
    }
    if (quick) {   // gõ thẳng "email, họ tên" không cần bấm Khách mới
      await antamLeadConfirm(chatId, me.id, quick.email, quick.name);
      return true;
    }
    if (Date.now() - st.at > LEAD_TTL) { antamLeadState.delete(chatId); return false; }
    if (st.step === 'email') {
      const lead = parseLeadText(text);
      if (!lead) { await antamApi('sendMessage', { chat_id: chatId, text: '⚠️ Chưa thấy email hợp lệ. Nhập lại email của khách (hoặc /huy).' }); return true; }
      if (lead.name) { antamLeadState.delete(chatId); await antamLeadConfirm(chatId, me.id, lead.email, lead.name); return true; }
      antamLeadState.set(chatId, { step: 'name', email: lead.email, at: Date.now() });
      await antamApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `Họ tên khách? (VD: <code>Lê Ly</code>)\nGõ <code>-</code> nếu không có tên.` });
      return true;
    }
    if (st.step === 'name') {
      antamLeadState.delete(chatId);
      await antamLeadConfirm(chatId, me.id, st.email, text === '-' ? '' : text.slice(0, 80));
      return true;
    }
    return false;
  }
  async function antamLeadCallback(cq, answer) {
    const [, act, token, extra] = String(cq.data).split(':');
    const p = antamLeadPending.get(token);
    const chat = cq.message && cq.message.chat && cq.message.chat.id, mid = cq.message && cq.message.message_id;
    const edit = (text, markup) => antamApi('editMessageText', { chat_id: chat, message_id: mid, parse_mode: 'HTML', text, ...(markup ? { reply_markup: markup } : {}) });
    const u = db.get('SELECT id, first_name, last_name, is_admin, status, antam_can_email FROM users WHERE antam_chat_id = ?', [String(cq.from && cq.from.id)]);
    if (!antamCanEmail(u)) return answer('Bạn không có quyền gửi email cho khách.', true);
    if (!p || Date.now() - p.at > LEAD_TTL) { await edit('⌛ Yêu cầu đã hết hạn — bấm ➕ Khách mới để nhập lại.'); return answer('Đã hết hạn.'); }
    if (act === 'no') { antamLeadPending.delete(token); await edit(leadSummary(p) + '\n\n❌ <i>Đã huỷ, không gửi.</i>'); return answer('Đã huỷ.'); }
    if (act === 'tpl') {
      const list = crmTemplates().slice(0, 12);
      await edit(leadSummary(p, '<i>Chọn mẫu email:</i>'), { inline_keyboard: [
        ...list.map(t => [{ text: (t.id === p.templateId ? '✔️ ' : '') + t.name.slice(0, 50), callback_data: `ae:pick:${token}:${t.id}` }]),
        [{ text: '← Quay lại', callback_data: `ae:back:${token}` }]] });
      return answer('');
    }
    if (act === 'pick' || act === 'back') {
      if (act === 'pick' && crmTemplates().some(t => t.id === Number(extra))) p.templateId = Number(extra);
      await edit(leadSummary(p), leadButtons(token));
      return answer(act === 'pick' ? 'Đã chọn mẫu.' : '');
    }
    if (act === 'send' || act === 'force') {
      await answer('Đang gửi…');
      const r = await sendTemplateEmail({ to: p.email, fullName: p.name, templateId: p.templateId, byUserId: u.id, force: act === 'force', via: 'telegram' });
      if (r.duplicate) {
        await edit(leadSummary(p, `⚠️ ${antamEsc(r.error)}\nVẫn gửi lại?`), { inline_keyboard: [[
          { text: '📤 Vẫn gửi lại', callback_data: `ae:force:${token}` }, { text: '❌ Không gửi', callback_data: `ae:no:${token}` }]] });
        return;
      }
      antamLeadPending.delete(token);
      const at = db.get("SELECT strftime('%H:%M %d/%m', 'now', 'localtime') AS t").t;
      const who = antamEsc(`${u.first_name || ''} ${u.last_name || ''}`.trim());
      await edit(r.ok
        ? `✅ <b>Đã gửi email</b> "${antamEsc(r.subject)}"\nTới: <b>${antamEsc(p.email)}</b>${p.name ? ` (${antamEsc(p.name)})` : ''}\n— ${who} · ${at}`
        : leadSummary(p, `❌ ${antamEsc(r.error)}`), r.ok ? null : leadButtons(token));
      return;
    }
    return answer('Nút không hợp lệ.');
  }
  // Menu lệnh của bot (nút "Menu" trong Telegram)
  function antamSetCommands() {
    if (antamToken()) antamApi('setMyCommands', { commands: [{ command: 'khach', description: 'Gửi email chào mừng cho khách mới' }, { command: 'huy', description: 'Huỷ thao tác đang làm' }] }).catch(() => {});
  }
  setTimeout(antamSetCommands, 20 * 1000);

  app.post('/api/antam/webhook', async (req, res) => {
    const secret = getSecret('antam_webhook_secret');
    if (!secret || req.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return res.status(401).end();
    res.json({ ok: true });
    try {
      const msg = req.body && req.body.message;
      if (msg && msg.chat && msg.chat.type === 'private') {
        const chatId = msg.chat.id;
        const m = String(msg.text || '').trim().match(/^\/start\s+([a-f0-9]{16})$/i);
        if (m) {
          const u = db.get("SELECT id, first_name FROM users WHERE antam_link_code = ? AND antam_link_expires > datetime('now','localtime')", [m[1].toLowerCase()]);
          if (u) {
            db.run('UPDATE users SET antam_chat_id = ?, antam_link_code = NULL, antam_link_expires = NULL WHERE id = ?', [String(chatId), u.id]);
            await antamApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
              text: `✅ Đã kết nối <b>An Tâm</b> với tài khoản <b>${antamEsc(u.first_name || '')}</b>.\nBạn sẽ nhận tin đăng ký chương trình, đặt lịch coach và thanh toán tại đây.` });
          } else {
            await antamApi('sendMessage', { chat_id: chatId, text: '⚠️ Link kết nối không hợp lệ hoặc đã hết hạn. Nhờ admin tạo link mới trong Cài đặt → Agent An Tâm.' });
          }
          return;
        }
        const me = db.get('SELECT id, first_name, is_admin, status, antam_can_email FROM users WHERE antam_chat_id = ?', [String(chatId)]);
        if (me && await antamLeadMessage(me, chatId, String(msg.text || '').trim())) return;
        await antamApi('sendMessage', { chat_id: chatId, text: me
          ? `Xin chào ${me.first_name || ''} 👋 An Tâm sẽ gửi bạn tin đăng ký, đặt lịch và thanh toán để duyệt tại đây.`
          : 'Xin chào 👋 Đây là bot vận hành An Tâm của AI Agents CC. Nhờ admin gửi link kết nối để nhận thông báo.',
          ...(me && antamCanEmail(me) ? { reply_markup: ANTAM_LEAD_KEYBOARD } : {}) });
        return;
      }

      const cq = req.body && req.body.callback_query;
      if (!cq) return;
      const answer = (text, alert) => antamApi('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: !!alert });
      if (/^ae:/.test(String(cq.data || ''))) return antamLeadCallback(cq, answer);
      const m = String(cq.data || '').match(/^at:(w8|p377|course|coach|order|roadmap):(\d+):(ok|no)$/);
      if (!m) return answer('Nút không hợp lệ.');
      // Chỉ người đã kết nối và có quyền duyệt mới bấm được (kiểm tra theo Telegram ID người bấm).
      // Lộ trình: admin hoặc người được quyền "xem & duyệt lộ trình" (tab An Lộ); việc khác: theo tab An Tâm.
      const u = db.get(
        `SELECT id, is_admin, status, COALESCE(antam_recipient, 0) AS recipient, COALESCE(antam_can_approve, 0) AS can_approve,
                COALESCE(agent1_reviewer, 0) AS roadmap_reviewer
         FROM users WHERE antam_chat_id = ?`, [String(cq.from && cq.from.id)]);
      const allowed = u && u.status === 'active' && (u.is_admin ||
        (m[1] === 'roadmap' ? u.roadmap_reviewer : (u.recipient && u.can_approve)));
      if (!allowed) return answer('Bạn không có quyền duyệt việc này.', true);
      const r = antamPerform(m[1], Number(m[2]), m[3] === 'ok', u.id);
      await answer(r.msg, !r.ok);
    } catch (e) { console.error('[An Tâm] webhook:', e.message); }
  });

  // ── Admin: Cài đặt → Agent An Tâm ──
  app.get('/api/admin/antam/overview', requireAdmin, async (_req, res) => {
    const token = antamToken();
    let webhook = null;
    if (token) {
      const w = await antamApi('getWebhookInfo');
      if (w.ok) webhook = { url_ok: w.result.url === `${SITE_URL}/api/antam/webhook`, pending: w.result.pending_update_count || 0, last_error: w.result.last_error_message || null };
    }
    const recipients = db.all(
      `SELECT id, first_name, last_name, email, is_admin, status,
              COALESCE(antam_recipient, 0) AS recipient, COALESCE(antam_can_approve, 0) AS can_approve,
              COALESCE(antam_notify_off, 0) AS notify_off,
              (CASE WHEN antam_can_email = 1 OR (is_admin = 1 AND antam_can_email IS NULL) THEN 1 ELSE 0 END) AS can_email,
              (CASE WHEN antam_chat_id IS NOT NULL AND antam_chat_id != '' THEN 1 ELSE 0 END) AS linked
       FROM users WHERE is_admin = 1 OR antam_recipient = 1 OR antam_can_email = 1
       ORDER BY is_admin DESC, first_name`);
    const log = db.all(
      `SELECT l.kind, l.ref_id, l.action, l.via, l.created_at, u.first_name, u.last_name
       FROM antam_log l LEFT JOIN users u ON u.id = l.by_user_id
       ORDER BY l.id DESC LIMIT 30`);
    res.json({ connected: !!token, bot_username: getSecret('antam_bot_username') || null, webhook, recipients, log });
  });

  app.post('/api/admin/antam/connect', requireAdmin, async (req, res) => {
    const token = String(req.body.token || '').trim();
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) return res.status(400).json({ error: 'Token không đúng định dạng (dạng 123456789:ABC...).' });
    if (token === TELEGRAM_BOT_TOKEN) return res.status(400).json({ error: 'Đây là token bot An Nhiên — An Tâm cần một bot MỚI tạo riêng qua @BotFather.' });
    const me = await antamApi('getMe', {}, token);
    if (!me.ok) return res.status(400).json({ error: 'Telegram từ chối token này: ' + (me.description || 'không rõ lý do') });
    const secret = crypto.randomBytes(24).toString('hex');
    const wh = await antamApi('setWebhook', {
      url: `${SITE_URL}/api/antam/webhook`, secret_token: secret,
      allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
    }, token);
    if (!wh.ok) return res.status(400).json({ error: 'Không đặt được webhook: ' + (wh.description || '') + ` (địa chỉ ${SITE_URL} phải là https công khai)` });
    setSecret('antam_bot_token', token);
    setSecret('antam_webhook_secret', secret);
    setSecret('antam_bot_username', me.result.username || '');
    antamSetCommands();
    res.json({ ok: true, bot_username: me.result.username });
  });

  app.post('/api/admin/antam/disconnect', requireAdmin, async (_req, res) => {
    if (antamToken()) await antamApi('deleteWebhook', { drop_pending_updates: true });
    ['antam_bot_token', 'antam_webhook_secret', 'antam_bot_username'].forEach(k => setSecret(k, ''));
    res.json({ ok: true });
  });

  // Link kết nối cho 1 người (gửi họ qua Zalo) — hết hạn sau 7 ngày
  app.post('/api/admin/antam/link/:userId', requireAdmin, (req, res) => {
    const bot = getSecret('antam_bot_username');
    if (!bot) return res.status(400).json({ error: 'Chưa kết nối bot An Tâm.' });
    if (!db.get('SELECT id FROM users WHERE id = ?', [req.params.userId])) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });
    const code = crypto.randomBytes(8).toString('hex');
    db.run("UPDATE users SET antam_link_code = ?, antam_link_expires = datetime('now','localtime','+7 days') WHERE id = ?", [code, req.params.userId]);
    res.json({ link: `https://t.me/${bot}?start=${code}` });
  });

  // Bật/tắt quyền: recipient (thêm/gỡ người nhận), can_approve (được bấm duyệt), notify (nhận tin), unlink (ngắt Telegram)
  app.patch('/api/admin/antam/users/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    if (!db.get('SELECT id FROM users WHERE id = ?', [id])) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });
    const b = req.body || {};
    if ('recipient' in b) {
      db.run('UPDATE users SET antam_recipient = ? WHERE id = ?', [b.recipient ? 1 : 0, id]);
      if (b.recipient && !('can_approve' in b)) db.run('UPDATE users SET antam_can_approve = 1 WHERE id = ?', [id]);
    }
    if ('can_approve' in b) db.run('UPDATE users SET antam_can_approve = ? WHERE id = ?', [b.can_approve ? 1 : 0, id]);
    if ('can_email' in b) db.run('UPDATE users SET antam_can_email = ? WHERE id = ?', [b.can_email ? 1 : 0, id]);
    if ('notify' in b) db.run('UPDATE users SET antam_notify_off = ? WHERE id = ?', [b.notify ? 0 : 1, id]);
    if (b.unlink) db.run('UPDATE users SET antam_chat_id = NULL WHERE id = ?', [id]);
    res.json({ success: true });
  });

  app.post('/api/admin/antam/test', requireAdmin, async (_req, res) => {
    if (!antamToken()) return res.status(400).json({ error: 'Chưa kết nối bot An Tâm.' });
    const list = antamRecipients();
    let sent = 0;
    for (const u of list) {
      const r = await antamApi('sendMessage', { chat_id: u.antam_chat_id, parse_mode: 'HTML',
        text: `🛡️ <b>An Tâm</b> — tin thử nghiệm.\nBạn đang nhận thông báo đăng ký, đặt lịch và thanh toán của ${antamEsc(communityName())}.` });
      if (r.ok) sent++;
    }
    res.json({ ok: true, sent, total: list.length });
  });

  // Admin lấy link kết nối bot An Nhiên cho 1 người (tab Agent An Nhiên) — gửi qua Zalo, họ mở
  // link bấm Start là xong. Hiệu lực 7 ngày (link người dùng tự tạo ở Hồ sơ chỉ 15 phút).
  app.post('/api/admin/telegram/link/:userId', requireAdmin, (req, res) => {
    if (!TELEGRAM_BOT_USERNAME) return res.status(400).json({ error: 'Chưa cấu hình bot An Nhiên (TELEGRAM_BOT_USERNAME).' });
    const user = db.get('SELECT id, telegram_chat_id FROM users WHERE id = ?', [req.params.userId]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });
    if (user.telegram_chat_id) return res.status(400).json({ error: 'Người này đã kết nối bot An Nhiên rồi.' });
    const code = crypto.randomBytes(6).toString('hex');
    const expiresAt = db.get("SELECT datetime('now','localtime','+7 days') AS d").d;
    db.run('UPDATE users SET telegram_link_code = ?, telegram_link_code_expires_at = ? WHERE id = ?', [code, expiresAt, user.id]);
    res.json({ link: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}` });
  });

  // ── Telegram account linking (Agent 2 coaching) ──────────────
  // Generates a short-lived code the user sends to the bot as "/start <code>"
  // to link their web account to a Telegram chat_id (see the webhook below).
  app.get('/api/telegram/link-code/:userId', (req, res) => {
    const user = db.get('SELECT id, telegram_chat_id FROM users WHERE id = ?', [req.params.userId]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    if (user.telegram_chat_id) return res.json({ alreadyLinked: true, botLink: TELEGRAM_BOT_USERNAME ? `https://t.me/${TELEGRAM_BOT_USERNAME}` : null });
    if (!TELEGRAM_BOT_USERNAME) return res.status(500).json({ error: 'Chưa cấu hình TELEGRAM_BOT_USERNAME trong .env' });

    const code = crypto.randomBytes(6).toString('hex'); // 12 hex chars
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.run('UPDATE users SET telegram_link_code = ?, telegram_link_code_expires_at = ? WHERE id = ?',
      [code, expiresAt, user.id]);
    res.json({ code, deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}` });
  });

  // Inbound Telegram webhook — intentionally minimal: only handles "/start <code>"
  // for account linking. No free-chat handling (customers report via nhat-ky.html,
  // not by chatting with the bot — see plan doc for the reasoning).
  app.post('/api/telegram/webhook', async (req, res) => {
    res.json({ ok: true }); // ack Telegram immediately regardless of outcome below
    try {
      const msg = req.body && req.body.message;
      const text = msg && msg.text;
      const chatId = msg && msg.chat && msg.chat.id;
      if (!text || !chatId) return;

      const m = text.trim().match(/^\/start\s+([a-f0-9]{12})$/i);
      if (!m) {
        await sendTelegramMessage(chatId, 'Xin chào 👋 Vui lòng lấy link liên kết từ trang hồ sơ trên website để kết nối tài khoản.');
        return;
      }
      const code = m[1];
      const user = db.get(
        "SELECT id, first_name FROM users WHERE telegram_link_code = ? AND telegram_link_code_expires_at > datetime('now','localtime')",
        [code]
      );
      if (!user) {
        await sendTelegramMessage(chatId, '⚠️ Link đã hết hạn hoặc không hợp lệ. Vào lại trang hồ sơ để lấy link mới nhé.');
        return;
      }
      db.run(
        "UPDATE users SET telegram_chat_id = ?, telegram_link_code = NULL, telegram_link_code_expires_at = NULL WHERE id = ?",
        [String(chatId), user.id]
      );
      await sendTelegramMessage(chatId, `✅ Đã liên kết tài khoản thành công, ${user.first_name}! Từ giờ mình sẽ nhắc bạn ăn uống đúng giờ và nhận xét sau mỗi lần bạn ghi nhật ký nhé.`);
    } catch (err) {
      console.error('  [Telegram webhook] lỗi:', err.message);
    }
  });

  // ── Admin: space members (approve join requests / invite / remove) ──
  app.get('/api/admin/spaces/:id/members', requireAdmin, (req, res) => {
    const members = db.all(`
      SELECT sm.id, sm.status, sm.created_at, u.id AS user_id, u.first_name, u.last_name, u.email
      FROM space_members sm JOIN users u ON u.id = sm.user_id
      WHERE sm.space_id = ?
      ORDER BY sm.status ASC, sm.created_at ASC
    `, [req.params.id]);
    res.json({ members });
  });

  app.post('/api/admin/spaces/:id/members', requireAdmin, (req, res) => {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Vui lòng nhập email thành viên.' });
    const user = db.get('SELECT id FROM users WHERE email = ?', [email.trim()]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy thành viên với email này.' });
    const existing = db.get('SELECT id FROM space_members WHERE space_id = ? AND user_id = ?', [req.params.id, user.id]);
    if (existing) {
      db.run("UPDATE space_members SET status = 'approved' WHERE id = ?", [existing.id]);
    } else {
      db.run('INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,?)', [req.params.id, user.id, 'approved']);
    }
    res.status(201).json({ success: true });
  });

  app.patch('/api/admin/space-members/:id', requireAdmin, (req, res) => {
    const { status } = req.body;
    if (!['approved', 'pending'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    db.run('UPDATE space_members SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/space-members/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM space_members WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin courses ──────────────────────────────────────────
  app.get('/api/admin/courses', requireAdmin, (_req, res) => {
    const courses = db.all(`
      SELECT c.*, s.name AS space_name, g.name AS group_name, COUNT(DISTINCT cl.id) AS lesson_count,
             (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'pending') AS pending_enrollments,
             (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'approved') AS enrolled_count
      FROM courses c
      LEFT JOIN course_lessons cl ON cl.course_id = c.id
      LEFT JOIN spaces s ON s.id = c.space_id
      LEFT JOIN space_groups g ON g.id = c.group_id
      GROUP BY c.id ORDER BY c.order_num ASC, c.created_at DESC
    `);
    res.json({ courses });
  });

  // Keeps a private course's checkout in sync with a linked "product" row, so it can
  // be sold through the existing marketplace checkout/SePay pipeline. Public courses
  // don't need a checkout, so their linked product (if any) is soft-disabled instead.
  function syncCourseProduct(courseId) {
    const course = db.get('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (!course) return;
    const existingProduct = db.get('SELECT id FROM products WHERE course_id = ?', [courseId]);
    // Chỉ khoá thu phí qua checkout mới cần sản phẩm bán; khoá "admin duyệt" thì ẩn sản phẩm đi
    if (courseJoinMode(course) === 'payment') {
      if (existingProduct) {
        db.run(
          "UPDATE products SET title = ?, description = ?, price = ?, compare_price = ?, cover_color = ?, category = 'course', status = 'published' WHERE id = ?",
          [course.title, course.description || '', Number(course.price) || 0, Number(course.compare_price) || 0, course.cover_color, existingProduct.id]
        );
      } else {
        const sellerId = db.get('SELECT id FROM users ORDER BY id ASC LIMIT 1')?.id || 1;
        db.run(
          "INSERT INTO products (seller_id, title, description, price, compare_price, category, cover_color, status, course_id) VALUES (?,?,?,?,?,'course',?,'published',?)",
          [sellerId, course.title, course.description || '', Number(course.price) || 0, Number(course.compare_price) || 0, course.cover_color, courseId]
        );
      }
    } else if (existingProduct) {
      db.run("UPDATE products SET status = 'draft' WHERE id = ?", [existingProduct.id]);
    }
  }
  // Khoá riêng tư không thu phí qua checkout (0đ / admin duyệt) → ẩn sản phẩm bán cũ (idempotent)
  db.all("SELECT * FROM courses WHERE visibility = 'private'").forEach(c => {
    if (courseJoinMode(c) !== 'payment') db.run("UPDATE products SET status = 'draft' WHERE course_id = ? AND status = 'published'", [c.id]);
  });

  app.post('/api/admin/courses', requireAdmin, (req, res) => {
    const { title, description, cover_color = '#6366f1', instructor, status = 'draft', order_num = 0, space_id = null, group_id = null, visibility = 'public', price = 0, compare_price = 0, private_access = 'payment' } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Tên khóa học không được để trống.' });
    const vis = ['public', 'private'].includes(visibility) ? visibility : 'public';
    const r = db.run(
      'INSERT INTO courses (title, description, cover_color, instructor, status, order_num, space_id, group_id, visibility, price, compare_price, private_access) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [title.trim(), description || '', cover_color, instructor || '', status, Number(order_num), space_id || null, group_id || null, vis, Number(price) || 0, Number(compare_price) || 0, private_access === 'approval' ? 'approval' : 'payment']
    );
    syncCourseProduct(r.lastInsertRowid);
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/courses/:id', requireAdmin, (req, res) => {
    const { title, description, cover_color, instructor, status, order_num, space_id, group_id, visibility, price, compare_price, private_access } = req.body;
    const c = db.get('SELECT id FROM courses WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    if (title !== undefined)       db.run('UPDATE courses SET title = ? WHERE id = ?', [title, req.params.id]);
    if (description !== undefined) db.run('UPDATE courses SET description = ? WHERE id = ?', [description, req.params.id]);
    if (cover_color !== undefined) db.run('UPDATE courses SET cover_color = ? WHERE id = ?', [cover_color, req.params.id]);
    if (instructor !== undefined)  db.run('UPDATE courses SET instructor = ? WHERE id = ?', [instructor, req.params.id]);
    if (status !== undefined)      db.run('UPDATE courses SET status = ? WHERE id = ?', [status, req.params.id]);
    if (order_num !== undefined)   db.run('UPDATE courses SET order_num = ? WHERE id = ?', [Number(order_num), req.params.id]);
    if (space_id !== undefined)    db.run('UPDATE courses SET space_id = ? WHERE id = ?', [space_id || null, req.params.id]);
    if (group_id !== undefined)    db.run('UPDATE courses SET group_id = ? WHERE id = ?', [group_id || null, req.params.id]);
    if (visibility !== undefined)  db.run('UPDATE courses SET visibility = ? WHERE id = ?', [['public', 'private'].includes(visibility) ? visibility : 'public', req.params.id]);
    if (price !== undefined)       db.run('UPDATE courses SET price = ? WHERE id = ?', [Number(price) || 0, req.params.id]);
    if (compare_price !== undefined) db.run('UPDATE courses SET compare_price = ? WHERE id = ?', [Number(compare_price) || 0, req.params.id]);
    if (private_access !== undefined) db.run('UPDATE courses SET private_access = ? WHERE id = ?', [private_access === 'approval' ? 'approval' : 'payment', req.params.id]);
    syncCourseProduct(req.params.id);
    res.json({ success: true });
  });

  app.delete('/api/admin/courses/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM course_lessons WHERE course_id = ?', [req.params.id]);
    db.run('DELETE FROM course_enrollments WHERE course_id = ?', [req.params.id]);
    db.run('DELETE FROM course_email_grants WHERE course_id = ?', [req.params.id]);
    db.run("UPDATE products SET status = 'draft', course_id = NULL WHERE course_id = ?", [req.params.id]);
    db.run('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // ── Admin: course enrollments (approve enroll requests / add / remove) ──
  app.get('/api/admin/courses/:id/enrollments', requireAdmin, (req, res) => {
    const enrollments = db.all(`
      SELECT ce.id, ce.status, ce.created_at, u.id AS user_id, u.first_name, u.last_name, u.email
      FROM course_enrollments ce JOIN users u ON u.id = ce.user_id
      WHERE ce.course_id = ?
      ORDER BY ce.status ASC, ce.created_at ASC
    `, [req.params.id]);
    const grants = db.all('SELECT id, email, name, created_at FROM course_email_grants WHERE course_id = ? ORDER BY created_at DESC, email', [req.params.id]);
    res.json({ enrollments, grants });
  });

  // Nhập danh sách học viên (từ CSV): email đã có tài khoản → cấp quyền ngay;
  // chưa có → lưu course_email_grants, tự cấp khi họ đăng ký / đăng nhập.
  app.post('/api/admin/courses/:id/enrollments/bulk', requireAdmin, (req, res) => {
    const course = db.get('SELECT id FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Không tìm thấy khóa học.' });
    const rows = Array.isArray(req.body.students) ? req.body.students : [];
    let enrolled = 0, granted = 0, invalid = 0;
    const seen = new Set();
    rows.forEach(r => {
      const email = String(r?.email || '').trim().toLowerCase();
      if (seen.has(email)) return;
      if (!/^\S+@\S+\.\S+$/.test(email)) { invalid++; return; }
      seen.add(email);
      const user = db.get('SELECT id FROM users WHERE lower(email) = ?', [email]);
      if (user) {
        approveCourseEnrollment(course.id, user.id);
        enrolled++;
      } else {
        db.run('INSERT OR IGNORE INTO course_email_grants (course_id, email, name) VALUES (?,?,?)',
          [course.id, email, String(r?.name || '').trim() || null]);
        granted++;
      }
    });
    res.json({ success: true, enrolled, granted, invalid });
  });

  app.delete('/api/admin/course-email-grants/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM course_email_grants WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  app.post('/api/admin/courses/:id/enrollments', requireAdmin, (req, res) => {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Vui lòng nhập email học viên.' });
    const normEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normEmail)) return res.status(400).json({ error: 'Email không hợp lệ.' });
    const user = db.get('SELECT id FROM users WHERE lower(email) = ?', [normEmail]);
    if (!user) {
      // Chưa có tài khoản → cấp quyền chờ, tự vào học khi đăng ký / đăng nhập bằng email này
      db.run('INSERT OR IGNORE INTO course_email_grants (course_id, email) VALUES (?,?)', [req.params.id, normEmail]);
      return res.status(201).json({ success: true, granted: true });
    }
    approveCourseEnrollment(req.params.id, user.id);
    res.status(201).json({ success: true });
  });

  // Tất cả yêu cầu tham gia khoá học (mọi khoá) — tab "Khoá học" ở trang Duyệt đăng ký & lộ trình
  app.get('/api/admin/course-enrollments', requireAdmin, (req, res) => {
    const status = ['pending', 'approved'].includes(req.query.status) ? req.query.status : 'pending';
    const enrollments = db.all(`
      SELECT ce.id, ce.status, ce.created_at, ce.course_id, c.title AS course_title, c.visibility, c.price,
             u.id AS user_id, u.first_name, u.last_name, u.email
      FROM course_enrollments ce
      JOIN users u ON u.id = ce.user_id
      JOIN courses c ON c.id = ce.course_id
      WHERE ce.status = ?
      ORDER BY ce.created_at DESC LIMIT 500
    `, [status]);
    res.json({ enrollments });
  });

  app.patch('/api/admin/course-enrollments/:id', requireAdmin, (req, res) => {
    const { status } = req.body;
    if (!['approved', 'pending'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    const cur = db.get(`SELECT ce.id, ce.status, ce.user_id, c.id AS course_id, c.title
      FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id WHERE ce.id = ?`, [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy yêu cầu.' });
    db.run('UPDATE course_enrollments SET status = ? WHERE id = ?', [status, cur.id]);
    if (status === 'approved' && cur.status !== 'approved') {
      notifyCourseApproved(cur.user_id, cur.course_id, cur.title);
      antamResolve('course', cur.id, 'approved', req.adminUserId);
    }
    res.json({ success: true });
  });

  // Báo thành viên (trong app + email) khi yêu cầu tham gia khoá học được duyệt
  function notifyCourseApproved(userId, courseId, courseTitle) {
    const u = db.get('SELECT email, first_name FROM users WHERE id = ?', [userId]);
    if (!u) return;
    const title = `Yêu cầu tham gia khoá học đã được duyệt 🎉`;
    const content = `Bạn đã có thể vào học khoá "${courseTitle}" ngay bây giờ.`;
    const link = `course-view.html?id=${courseId}`;
    db.run('INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)',
      [userId, 'course', title, content, link]);
    pushNotify(userId, { title, body: content, link });
    if (!u.email) return;
    const safe = v => String(v || '').replace(/[<>&"]/g, '');
    sendEmail({
      to: u.email,
      subject: `✅ Đã duyệt: ${courseTitle}`,
      html: emailWrap(title, `
        <p>Chào ${safe(u.first_name) || 'bạn'},</p>
        <p>Ban tổ chức ${communityName()} đã duyệt yêu cầu tham gia khoá học <strong>${safe(courseTitle)}</strong> của bạn.</p>
        <a class="btn" href="${SITE_URL}/${link}">Vào học ngay</a>
      `),
    }).catch(err => console.error('[course-approved email]', err.message));
  }

  app.delete('/api/admin/course-enrollments/:id', requireAdmin, (req, res) => {
    const cur = db.get(`SELECT ce.status, ce.user_id, c.title FROM course_enrollments ce
      JOIN courses c ON c.id = ce.course_id WHERE ce.id = ?`, [req.params.id]);
    db.run('DELETE FROM course_enrollments WHERE id = ?', [req.params.id]);
    // Chỉ báo khi từ chối yêu cầu đang chờ (gỡ quyền học viên đã duyệt thì không báo)
    if (cur && cur.status === 'pending') notifyEnrollRejected(cur.user_id, `khoá học "${cur.title}"`, req.query.note);
    antamResolve('course', req.params.id, 'rejected', req.adminUserId);
    res.json({ success: true });
  });

  // Course modules — group lessons into chapters
  app.get('/api/admin/courses/:id/modules', requireAdmin, (req, res) => {
    const modules = db.all('SELECT * FROM course_modules WHERE course_id = ? ORDER BY order_num ASC, id ASC', [req.params.id]);
    res.json({ modules });
  });
  app.post('/api/admin/courses/:id/modules', requireAdmin, (req, res) => {
    const { title, order_num = 0 } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Tên module không được để trống.' });
    const course = db.get('SELECT id FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    const r = db.run('INSERT INTO course_modules (course_id, title, order_num) VALUES (?,?,?)',
      [req.params.id, title.trim(), Number(order_num) || 0]);
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });
  app.patch('/api/admin/modules/:id', requireAdmin, (req, res) => {
    const m = db.get('SELECT id FROM course_modules WHERE id = ?', [req.params.id]);
    if (!m) return res.status(404).json({ error: 'Không tìm thấy module.' });
    const { title, order_num } = req.body;
    if (title !== undefined) db.run('UPDATE course_modules SET title = ? WHERE id = ?', [title, req.params.id]);
    if (order_num !== undefined) db.run('UPDATE course_modules SET order_num = ? WHERE id = ?', [Number(order_num) || 0, req.params.id]);
    res.json({ success: true });
  });
  app.delete('/api/admin/modules/:id', requireAdmin, (req, res) => {
    db.run('UPDATE course_lessons SET module_id = NULL WHERE module_id = ?', [req.params.id]);
    db.run('DELETE FROM course_modules WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  // Course lessons
  // Danh sách phẳng mọi bài học đã xuất bản, kèm tên khoá học — dùng cho dropdown
  // "liên kết bài học" ở nơi khác (VD nội dung ngày của Chương trình 377 ngày).
  app.get('/api/admin/course-lessons/all', requireAdmin, (_req, res) => {
    const lessons = db.all(
      `SELECT cl.id, cl.title, cl.course_id, c.title AS course_title
       FROM course_lessons cl JOIN courses c ON c.id = cl.course_id
       WHERE cl.status = 'published' ORDER BY c.order_num ASC, cl.order_num ASC, cl.id ASC`
    );
    res.json({ lessons });
  });

  // ── Thư viện bài tập (không AI chấm — chỉ hướng dẫn + link) ────────
  // Dùng chung cho bài học (exercise_type='link') và nội dung 377 ngày.
  // Công khai (trang 3 buổi / 8 buổi / 377 ngày hiện "Bài tập sau buổi"): chỉ tên, hướng dẫn, link
  app.get('/api/assignments', (_req, res) => {
    res.json({ assignments: db.all('SELECT id, title, instructions, link_url, display_mode FROM assignments ORDER BY id') });
  });
  // Khách bấm "Mình đã làm xong" ở khung nhắc bài tập buổi trước (prog: w3 / w8 / p377; skey: số thứ tự buổi hoặc id buổi)
  db.exec(`CREATE TABLE IF NOT EXISTS homework_done (
    user_id INTEGER NOT NULL, prog TEXT NOT NULL, skey TEXT NOT NULL, done_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (user_id, prog, skey))`);
  const HW_PROGS = ['w3', 'w8', 'p377'];
  app.get('/api/homework/done', (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.json({ keys: [] });
    const prog = HW_PROGS.includes(req.query.prog) ? req.query.prog : '';
    res.json({ keys: db.all('SELECT skey FROM homework_done WHERE user_id = ? AND prog = ?', [u.id, prog]).map(r => r.skey) });
  });
  app.post('/api/homework/done', (req, res) => {
    const u = userFromSession(req);
    if (!u) return res.status(401).json({ error: 'Vui lòng đăng nhập lại.', code: 'session_required' });
    const prog = HW_PROGS.includes(req.body?.prog) ? req.body.prog : null;
    const skey = String(req.body?.key ?? '').slice(0, 40);
    if (!prog || !skey) return res.status(400).json({ error: 'Thiếu thông tin buổi.' });
    if (req.body.done === false) db.run('DELETE FROM homework_done WHERE user_id = ? AND prog = ? AND skey = ?', [u.id, prog, skey]);
    else db.run('INSERT OR IGNORE INTO homework_done (user_id, prog, skey) VALUES (?,?,?)', [u.id, prog, skey]);
    res.json({ ok: true });
  });
  app.get('/api/admin/assignments', requireAdmin, (_req, res) => {
    res.json({ assignments: db.all('SELECT * FROM assignments ORDER BY created_at DESC') });
  });

  app.post('/api/admin/assignments', requireAdmin, (req, res) => {
    const { title, instructions, link_url, display_mode } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Thiếu tên bài tập.' });
    const r = db.run(
      'INSERT INTO assignments (title, instructions, link_url, display_mode, created_by) VALUES (?,?,?,?,?)',
      [title.trim(), instructions || '', link_url || '', display_mode === 'embed' ? 'embed' : 'link', req.adminUserId || null]
    );
    res.status(201).json({ ok: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/assignments/:id', requireAdmin, (req, res) => {
    const existing = db.get('SELECT id FROM assignments WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy bài tập.' });
    const { title, instructions, link_url, display_mode } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Thiếu tên bài tập.' });
    db.run(
      "UPDATE assignments SET title=?, instructions=?, link_url=?, display_mode=?, updated_at=datetime('now','localtime') WHERE id=?",
      [title.trim(), instructions || '', link_url || '', display_mode === 'embed' ? 'embed' : 'link', req.params.id]
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/assignments/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM assignments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  app.get('/api/admin/courses/:id/lessons', requireAdmin, (req, res) => {
    const lessons = db.all(
      'SELECT * FROM course_lessons WHERE course_id = ? ORDER BY order_num ASC, id ASC',
      [req.params.id]
    );
    res.json({ lessons });
  });

  // exercise_type: 'text' (tự luận, AI chấm), 'quiz' (trắc nghiệm, chấm tự động),
  // 'link' (chọn từ thư viện assignments — chỉ hướng dẫn + link, không chấm điểm).
  const LESSON_EXERCISE_TYPES = ['text', 'quiz', 'link'];
  function normalizeExerciseType(t) { return LESSON_EXERCISE_TYPES.includes(t) ? t : 'text'; }

  app.post('/api/admin/courses/:id/lessons', requireAdmin, (req, res) => {
    const {
      title, content, video_url, duration_min = 0, order_num = 0, status = 'published', module_id = null,
      exercise_enabled = 0, exercise_type = 'text', exercise_prompt = '', exercise_rubric = '',
      exercise_max_score = 100, exercise_pass_score = 70, exercise_xp_reward = 0, linked_assignment_id = null,
    } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Tên bài học không được để trống.' });
    const course = db.get('SELECT id FROM courses WHERE id = ?', [req.params.id]);
    if (!course) return res.status(404).json({ error: 'Khóa học không tồn tại.' });
    const r = db.run(
      `INSERT INTO course_lessons
        (course_id, module_id, title, content, video_url, duration_min, order_num, status,
         exercise_enabled, exercise_type, exercise_prompt, exercise_rubric, exercise_max_score, exercise_pass_score, exercise_xp_reward, linked_assignment_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.params.id, module_id || null, title.trim(), content || '', video_url || '', Number(duration_min), Number(order_num), status === 'draft' ? 'draft' : 'published',
       exercise_enabled ? 1 : 0, normalizeExerciseType(exercise_type), exercise_prompt || '', exercise_rubric || '', Number(exercise_max_score) || 100, Number(exercise_pass_score) || 70, Number(exercise_xp_reward) || 0,
       linked_assignment_id ? Number(linked_assignment_id) : null]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/lessons/:id', requireAdmin, (req, res) => {
    const {
      title, content, video_url, duration_min, order_num, status, module_id,
      exercise_enabled, exercise_type, exercise_prompt, exercise_rubric, exercise_max_score, exercise_pass_score, exercise_xp_reward,
      linked_assignment_id,
    } = req.body;
    const l = db.get('SELECT id FROM course_lessons WHERE id = ?', [req.params.id]);
    if (!l) return res.status(404).json({ error: 'Bài học không tồn tại.' });
    if (title !== undefined)       db.run('UPDATE course_lessons SET title = ? WHERE id = ?', [title, req.params.id]);
    if (content !== undefined)     db.run('UPDATE course_lessons SET content = ? WHERE id = ?', [content, req.params.id]);
    if (video_url !== undefined)   db.run('UPDATE course_lessons SET video_url = ? WHERE id = ?', [video_url, req.params.id]);
    if (duration_min !== undefined) db.run('UPDATE course_lessons SET duration_min = ? WHERE id = ?', [Number(duration_min), req.params.id]);
    if (order_num !== undefined)   db.run('UPDATE course_lessons SET order_num = ? WHERE id = ?', [Number(order_num), req.params.id]);
    if (status !== undefined)      db.run('UPDATE course_lessons SET status = ? WHERE id = ?', [status === 'draft' ? 'draft' : 'published', req.params.id]);
    if (module_id !== undefined)   db.run('UPDATE course_lessons SET module_id = ? WHERE id = ?', [module_id || null, req.params.id]);
    if (exercise_enabled !== undefined)   db.run('UPDATE course_lessons SET exercise_enabled = ? WHERE id = ?', [exercise_enabled ? 1 : 0, req.params.id]);
    if (exercise_type !== undefined)      db.run('UPDATE course_lessons SET exercise_type = ? WHERE id = ?', [normalizeExerciseType(exercise_type), req.params.id]);
    if (exercise_prompt !== undefined)    db.run('UPDATE course_lessons SET exercise_prompt = ? WHERE id = ?', [exercise_prompt, req.params.id]);
    if (exercise_rubric !== undefined)    db.run('UPDATE course_lessons SET exercise_rubric = ? WHERE id = ?', [exercise_rubric, req.params.id]);
    if (exercise_max_score !== undefined) db.run('UPDATE course_lessons SET exercise_max_score = ? WHERE id = ?', [Number(exercise_max_score) || 100, req.params.id]);
    if (exercise_pass_score !== undefined) db.run('UPDATE course_lessons SET exercise_pass_score = ? WHERE id = ?', [Number(exercise_pass_score) || 70, req.params.id]);
    if (exercise_xp_reward !== undefined) db.run('UPDATE course_lessons SET exercise_xp_reward = ? WHERE id = ?', [Number(exercise_xp_reward) || 0, req.params.id]);
    if (linked_assignment_id !== undefined) db.run('UPDATE course_lessons SET linked_assignment_id = ? WHERE id = ?', [linked_assignment_id ? Number(linked_assignment_id) : null, req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/lessons/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM course_lessons WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  app.get('/api/admin/lessons/:id/questions', requireAdmin, (req, res) => {
    const questions = db.all(
      'SELECT * FROM lesson_exercise_questions WHERE lesson_id = ? ORDER BY order_num ASC, id ASC',
      [req.params.id]
    ).map(q => ({ ...q, options: JSON.parse(q.options) }));
    res.json({ questions });
  });

  app.post('/api/admin/lessons/:id/questions', requireAdmin, (req, res) => {
    const { question_text, options, correct_index, explanation = '', order_num = 0 } = req.body;
    if (!question_text?.trim()) return res.status(400).json({ error: 'Nội dung câu hỏi không được để trống.' });
    if (!Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'Cần ít nhất 2 đáp án.' });
    if (correct_index === undefined || correct_index < 0 || correct_index >= options.length)
      return res.status(400).json({ error: 'Vui lòng chọn đáp án đúng.' });
    const lesson = db.get('SELECT id FROM course_lessons WHERE id = ?', [req.params.id]);
    if (!lesson) return res.status(404).json({ error: 'Bài học không tồn tại.' });
    const r = db.run(
      'INSERT INTO lesson_exercise_questions (lesson_id, question_text, options, correct_index, explanation, order_num) VALUES (?,?,?,?,?,?)',
      [req.params.id, question_text.trim(), JSON.stringify(options.map(o => String(o).trim())), Number(correct_index), explanation || '', Number(order_num) || 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/questions/:id', requireAdmin, (req, res) => {
    const { question_text, options, correct_index, explanation, order_num } = req.body;
    const q = db.get('SELECT id FROM lesson_exercise_questions WHERE id = ?', [req.params.id]);
    if (!q) return res.status(404).json({ error: 'Câu hỏi không tồn tại.' });
    if (question_text !== undefined) db.run('UPDATE lesson_exercise_questions SET question_text = ? WHERE id = ?', [question_text, req.params.id]);
    if (options !== undefined)       db.run('UPDATE lesson_exercise_questions SET options = ? WHERE id = ?', [JSON.stringify(options.map(o => String(o).trim())), req.params.id]);
    if (correct_index !== undefined) db.run('UPDATE lesson_exercise_questions SET correct_index = ? WHERE id = ?', [Number(correct_index), req.params.id]);
    if (explanation !== undefined)   db.run('UPDATE lesson_exercise_questions SET explanation = ? WHERE id = ?', [explanation, req.params.id]);
    if (order_num !== undefined)     db.run('UPDATE lesson_exercise_questions SET order_num = ? WHERE id = ?', [Number(order_num), req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/questions/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM lesson_exercise_questions WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  app.get('/api/admin/lesson-exercise-submissions', requireAdmin, (req, res) => {
    const { course_id = '', lesson_id = '', passed = '', limit = 50, offset = 0 } = req.query;
    let sql = `
      SELECT les.id, les.answer_text, les.score, les.max_score, les.pass_score, les.passed,
             les.issues, les.hints, les.xp_awarded, les.status, les.teacher_note, les.submitted_at,
             u.id AS user_id, u.first_name, u.last_name, u.email,
             cl.id AS lesson_id, cl.title AS lesson_title, cl.exercise_rubric, cl.exercise_type,
             c.id AS course_id, c.title AS course_title
      FROM lesson_exercise_submissions les
      JOIN users u ON u.id = les.user_id
      JOIN course_lessons cl ON cl.id = les.lesson_id
      JOIN courses c ON c.id = les.course_id
      WHERE 1=1`;
    const params = [];
    if (course_id) { sql += ' AND les.course_id = ?'; params.push(Number(course_id)); }
    if (lesson_id) { sql += ' AND les.lesson_id = ?'; params.push(Number(lesson_id)); }
    if (passed !== '') { sql += ' AND les.passed = ?'; params.push(Number(passed)); }
    sql += ' ORDER BY les.submitted_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));
    const questionsCache = {};
    const submissions = db.all(sql, params).map(s => {
      const base = { ...s, issues: JSON.parse(s.issues || '[]'), hints: JSON.parse(s.hints || '[]') };
      if (s.exercise_type === 'quiz') {
        if (!questionsCache[s.lesson_id]) {
          questionsCache[s.lesson_id] = db.all(
            'SELECT * FROM lesson_exercise_questions WHERE lesson_id = ? ORDER BY order_num ASC, id ASC',
            [s.lesson_id]
          );
        }
        const answers = JSON.parse(s.answer_text || '{}');
        base.quiz_review = questionsCache[s.lesson_id].map(q => {
          const options = JSON.parse(q.options);
          const picked = answers[q.id];
          return {
            question_text: q.question_text,
            picked_option: picked !== undefined ? options[picked] : null,
            correct_option: options[q.correct_index],
            is_correct: picked === q.correct_index,
          };
        });
      }
      return base;
    });
    let cntSql = 'SELECT COUNT(*) AS n FROM lesson_exercise_submissions WHERE 1=1';
    const cntP = [];
    if (course_id) { cntSql += ' AND course_id = ?'; cntP.push(Number(course_id)); }
    if (lesson_id) { cntSql += ' AND lesson_id = ?'; cntP.push(Number(lesson_id)); }
    if (passed !== '') { cntSql += ' AND passed = ?'; cntP.push(Number(passed)); }
    const total = db.get(cntSql, cntP).n;
    res.json({ submissions, total });
  });

  // Teacher intervention on an already-graded lesson exercise submission:
  // request_resubmit unlocks one more attempt (student's next submit UPDATEs this row);
  // finalize sets a manual score/note and permanently locks the submission — no further action possible.
  app.patch('/api/admin/lesson-exercise-submissions/:id', requireAdmin, (req, res) => {
    const { action, note = '', score } = req.body;
    const sub = db.get('SELECT * FROM lesson_exercise_submissions WHERE id = ?', [req.params.id]);
    if (!sub) return res.status(404).json({ error: 'Bài nộp không tồn tại.' });
    if (sub.status === 'finalized') return res.status(400).json({ error: 'Bài tập này đã kết thúc, không thể thao tác thêm.' });

    if (action === 'request_resubmit') {
      db.run('UPDATE lesson_exercise_submissions SET status = ?, teacher_note = ? WHERE id = ?', ['needs_resubmit', note, req.params.id]);
    } else if (action === 'finalize') {
      const s = Number(score);
      if (!Number.isFinite(s) || s < 0 || s > sub.max_score) return res.status(400).json({ error: 'Điểm không hợp lệ.' });
      const passed = s >= sub.pass_score ? 1 : 0;
      const alreadyAwarded = sub.xp_awarded > 0;
      let xp_awarded = sub.xp_awarded;
      if (passed && !alreadyAwarded) {
        const lesson = db.get('SELECT title, exercise_xp_reward FROM course_lessons WHERE id = ?', [sub.lesson_id]);
        xp_awarded = lesson?.exercise_xp_reward || 0;
        if (xp_awarded > 0) addXP(sub.user_id, xp_awarded, 'lesson_exercise', `Giáo viên chấm lại: ${lesson.title}`);
      }
      db.run(
        `UPDATE lesson_exercise_submissions SET status = 'finalized', score = ?, passed = ?, teacher_note = ?, xp_awarded = ? WHERE id = ?`,
        [s, passed, note, xp_awarded, req.params.id]
      );
    } else {
      return res.status(400).json({ error: 'Hành động không hợp lệ.' });
    }

    const updated = db.get('SELECT * FROM lesson_exercise_submissions WHERE id = ?', [req.params.id]);
    res.json({
      success: true,
      submission: { ...updated, issues: JSON.parse(updated.issues || '[]'), hints: JSON.parse(updated.hints || '[]') },
    });
  });

  // ── Admin settings ────────────────────────────────────────
  app.patch('/api/admin/settings', requireAdmin, (req, res) => {
    const allowed = [
      'announcement_enabled', 'announcement_text', 'announcement_icon',
      'late_reminder_enabled',
      'calendar_embed_url', 'about_intro', 'about_media',
      'community_name',
      'challenge_hero_icon', 'challenge_hero_title', 'challenge_hero_desc',
      'mp_store_name', 'mp_store_desc',
      'mp_bank_name', 'mp_bank_account_name', 'mp_bank_account_number',
      'home_tagline', 'home_heading_line1', 'home_heading_highlight', 'home_heading_line2',
      'home_desc', 'home_stat1_value', 'home_stat1_label', 'home_stat2_value', 'home_stat2_label',
      'home_stat3_value', 'home_stat3_label', 'home_tags',
      'courses_hero_icon', 'courses_hero_title', 'courses_hero_desc',
      'assistant_enabled', 'assistant_daily_limit',
      'assistant_limit_basic', 'assistant_limit_w8', 'assistant_upsell_w8', 'assistant_upsell_p377',
      'p377_letter_html', 'p377_topics_overview', 'p377_price_regular', 'p377_price_w8', 'p377_price_list', 'p377_page_mode', 'p377_value_stack', 'p377_bonuses',
      'coaching_weekly_hours', 'coaching_slot_duration_minutes', 'coaching_slot_buffer_minutes',
      'coaching_max_advance_days', 'coaching_min_advance_hours', 'coaching_max_bookings_per_day',
      'coaching_date_overrides',
      'workshop3_video_url', 'workshop3_space_url', 'workshop3_course_url', 'workshop3_sessions',
      'workshop3_time_note',
      'workshop8_video_url', 'workshop8_letter_html', 'workshop8_time_note', 'workshop8_sessions', 'workshop8_page_mode', 'workshop8_price_regular', 'workshop8_price_offer', 'workshop8_bonuses', 'workshop8_value_stack', 'workshop8_course_values',
      'program377_video_url', 'workshop8_space_url', 'program377_space_url', 'feed_default_space_id', 'feed_showcase_enabled', 'post_image_drive_folder_id', 'p377_meal_image_drive_folder_id', 'p377_video_drive_folder_id', 'p377_video_guide', 'health_record_drive_folder_id',
      'ttm_intake_trigger',
      'contact_heading', 'contact_intro', 'contact_people',
      'contact_bank_name', 'contact_bank_account', 'contact_bank_holder', 'contact_bank_note',
      'contact_socials',
      'rules_content', 'rules_version', 'guide_content',
      'ai_guide_anlo', 'ai_guide_annhien', 'zoom_join_url',
    ];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'Không có trường hợp lệ.' });
    updates.forEach(([key, value]) => {
      db.run('INSERT INTO site_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
    });
    res.json({ success: true });
  });

  // Trợ lý Ngũ Hành — lịch sử hỏi đáp để admin đánh giá chất lượng câu trả lời
  app.get('/api/admin/assistant-logs', requireAdmin, (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const logs = db.all(`
      SELECT l.id, l.user_id, l.question, l.answer, l.created_at,
             u.first_name, u.last_name, u.email
      FROM assistant_logs l JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const total = db.get('SELECT COUNT(*) AS n FROM assistant_logs').n;
    const today = db.get("SELECT date('now','localtime') AS d").d;
    const asked_today = db.get(
      'SELECT COALESCE(SUM(count),0) AS n FROM assistant_usage WHERE usage_date = ?', [today]
    ).n;
    res.json({ logs, total, asked_today });
  });

  // AI providers — kept out of site_settings/admin/settings on purpose since
  // GET /api/settings is public and returns that whole table unfiltered.
  const AI_PROVIDER_TYPES = ['openrouter', 'google_ai_studio'];

  app.get('/api/admin/ai-providers', requireAdmin, (req, res) => {
    const rows = db.all('SELECT * FROM ai_providers ORDER BY created_at ASC');
    res.json({
      providers: rows.map(r => ({
        id: r.id, name: r.name, provider_type: r.provider_type, model: r.model,
        masked: maskKey(r.api_key), is_active: !!r.is_active, created_at: r.created_at,
      })),
    });
  });

  app.post('/api/admin/ai-providers', requireAdmin, (req, res) => {
    const { name, provider_type, api_key, model } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Vui lòng nhập tên.' });
    if (!AI_PROVIDER_TYPES.includes(provider_type)) return res.status(400).json({ error: 'Nhà cung cấp không hợp lệ.' });
    if (!api_key?.trim()) return res.status(400).json({ error: 'Vui lòng nhập API key.' });
    const isFirst = db.get('SELECT COUNT(*) AS n FROM ai_providers').n === 0;
    const r = db.run(
      'INSERT INTO ai_providers (name, provider_type, api_key, model, is_active) VALUES (?,?,?,?,?)',
      [name.trim(), provider_type, api_key.trim(), (model || '').trim() || null, isFirst ? 1 : 0]
    );
    res.status(201).json({ success: true, id: r.lastInsertRowid });
  });

  app.patch('/api/admin/ai-providers/:id', requireAdmin, (req, res) => {
    const { name, provider_type, api_key, model } = req.body;
    const t = db.get('SELECT id FROM ai_providers WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy.' });
    if (provider_type !== undefined && !AI_PROVIDER_TYPES.includes(provider_type)) return res.status(400).json({ error: 'Nhà cung cấp không hợp lệ.' });
    if (name !== undefined)          db.run('UPDATE ai_providers SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
    if (provider_type !== undefined) db.run('UPDATE ai_providers SET provider_type = ? WHERE id = ?', [provider_type, req.params.id]);
    if (model !== undefined)         db.run('UPDATE ai_providers SET model = ? WHERE id = ?', [(model || '').trim() || null, req.params.id]);
    if (api_key?.trim())             db.run('UPDATE ai_providers SET api_key = ? WHERE id = ?', [api_key.trim(), req.params.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/ai-providers/:id', requireAdmin, (req, res) => {
    const t = db.get('SELECT is_active FROM ai_providers WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy.' });
    db.run('DELETE FROM ai_providers WHERE id = ?', [req.params.id]);
    if (t.is_active) {
      const next = db.get('SELECT id FROM ai_providers ORDER BY created_at DESC LIMIT 1');
      if (next) db.run('UPDATE ai_providers SET is_active = 1 WHERE id = ?', [next.id]);
    }
    res.json({ success: true });
  });

  app.post('/api/admin/ai-providers/:id/activate', requireAdmin, (req, res) => {
    const t = db.get('SELECT id FROM ai_providers WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy.' });
    db.run('UPDATE ai_providers SET is_active = 0');
    db.run('UPDATE ai_providers SET is_active = 1 WHERE id = ?', [req.params.id]);
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
  // Loại thông báo do admin tự thêm: site_settings.notif_custom_types = [{ key, icon, label }]
  const NOTIF_BUILTIN_TYPES = ['system', 'challenge', 'course', 'feed', 'marketplace'];
  function getNotifCustomTypes() {
    try {
      const arr = JSON.parse(db.get("SELECT value FROM site_settings WHERE key = 'notif_custom_types'")?.value || '[]');
      return Array.isArray(arr) ? arr.filter(t => t && /^c_[a-z0-9]{1,24}$/.test(t.key)) : [];
    } catch { return []; }
  }
  app.get('/api/admin/notif-types', requireAdmin, (_req, res) => res.json({ types: getNotifCustomTypes() }));
  app.put('/api/admin/notif-types', requireAdmin, (req, res) => {
    const list = Array.isArray(req.body?.types) ? req.body.types : null;
    if (!list || list.length > 50) return res.status(400).json({ error: 'Danh sách loại thông báo không hợp lệ.' });
    const seen = new Set();
    const types = [];
    for (const t of list) {
      const label = String(t?.label || '').trim().slice(0, 40);
      const icon = String(t?.icon || '').trim().slice(0, 8) || '🔔';
      if (!label) return res.status(400).json({ error: 'Mỗi loại cần có tên.' });
      let key = /^c_[a-z0-9]{1,24}$/.test(t?.key || '') ? t.key : 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      while (seen.has(key)) key = 'c_' + Math.random().toString(36).slice(2, 12);
      seen.add(key);
      types.push({ key, icon, label });
    }
    db.run("INSERT INTO site_settings (key, value) VALUES ('notif_custom_types', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(types)]);
    res.json({ ok: true, types });
  });

  app.get('/api/admin/notifications', requireAdmin, (_req, res) => {
    const notifs = db.all(`
      SELECT MIN(id) AS gid, type, title, content, link, MAX(icon) AS icon, SUM(is_read) AS read_count,
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

  // Thu hồi: 1 nhóm = các thông báo admin cùng tiêu đề / nội dung / loại / link (gid = id nhỏ nhất của nhóm)
  function notifGroupWhere(gid, p = '') {
    const g = db.get('SELECT type, title, content, link FROM notifications WHERE id = ? AND sent_by_admin = 1', [gid]);
    if (!g) return null;
    return {
      sql: `${p}sent_by_admin = 1 AND ${p}type = ? AND ${p}content = ? AND ${p}title IS ? AND ${p}link IS ?`,
      params: [g.type, g.content, g.title, g.link],
    };
  }
  app.get('/api/admin/notifications/:gid/recipients', requireAdmin, (req, res) => {
    const w = notifGroupWhere(Number(req.params.gid), 'n.');
    if (!w) return res.status(404).json({ error: 'Không tìm thấy thông báo.' });
    const rows = db.all(`SELECT n.user_id, n.is_read, n.created_at, u.first_name, u.last_name, u.email
      FROM notifications n LEFT JOIN users u ON u.id = n.user_id WHERE ${w.sql}
      ORDER BY u.first_name, u.last_name`, w.params);
    res.json({ recipients: rows });
  });
  app.post('/api/admin/notifications/:gid/recall', requireAdmin, (req, res) => {
    const w = notifGroupWhere(Number(req.params.gid));
    if (!w) return res.status(404).json({ error: 'Không tìm thấy thông báo.' });
    const all = req.body?.all === true;
    const ids = (Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(Number).filter(Boolean);
    if (!all && !ids.length) return res.status(400).json({ error: 'Chưa chọn người cần thu hồi.' });
    const where = all ? w.sql : `${w.sql} AND user_id IN (${ids.map(() => '?').join(',')})`;
    const params = all ? w.params : [...w.params, ...ids];
    const removed = db.get(`SELECT COUNT(*) AS n FROM notifications WHERE ${where}`, params).n;
    db.run(`DELETE FROM notifications WHERE ${where}`, params);
    console.log(`[notif recall] admin ${req.adminUserId || '-'} thu hồi ${removed} thông báo (nhóm ${req.params.gid})`);
    res.json({ ok: true, removed });
  });

  // Danh sách người nhận có sẵn (Gửi thông báo → "Theo danh sách"): học viên các chương trình, Space, khoá học,
  // thử thách, người đã vào Zoom, đội vận hành… Chỉ tính tài khoản đang hoạt động.
  const NA_ACTIVE = "SELECT id FROM users WHERE status = 'active'";
  function notifAudiences() {
    const out = [];
    const add = (group, key, label, sql, params = []) => {
      let ids = [];
      try { ids = db.all(`SELECT DISTINCT x.uid AS id FROM (${sql}) x WHERE x.uid IN (${NA_ACTIVE})`, params).map(r => r.id); } catch (e) { return; }
      out.push({ group, key, label, count: ids.length, ids });
    };
    add('Chương trình', 'p377:approved', '🌱 Học viên 377 ngày thực hành', "SELECT user_id AS uid FROM program377_enrollments WHERE status = 'approved'");
    add('Chương trình', 'p377:pending', '⏳ Đăng ký 377 ngày — chờ duyệt', "SELECT user_id AS uid FROM program377_enrollments WHERE status = 'pending'");
    add('Chương trình', 'w8:approved', '📗 Học viên 8 buổi chuyên sâu', "SELECT user_id AS uid FROM workshop8_enrollments WHERE status = 'approved'");
    add('Chương trình', 'w8:pending', '⏳ Đăng ký 8 buổi — chờ duyệt', "SELECT user_id AS uid FROM workshop8_enrollments WHERE status = 'pending'");
    add('Chương trình', 'zoom:any', '📹 Đã vào Zoom (có tài khoản)', 'SELECT user_id AS uid FROM zoom_checkins WHERE user_id IS NOT NULL');
    add('Thành viên', 'new:7', '🆕 Mới tham gia 7 ngày qua', "SELECT id AS uid FROM users WHERE created_at >= datetime('now','localtime','-7 days')");
    add('Thành viên', 'new:30', '🆕 Mới tham gia 30 ngày qua', "SELECT id AS uid FROM users WHERE created_at >= datetime('now','localtime','-30 days')");
    add('Thành viên', 'admins', '👑 Admin', 'SELECT id AS uid FROM users WHERE is_admin = 1');
    const team = [...new Set((getTaskBoard().members || []).map(m => m.user_id).filter(Boolean))];
    if (team.length) add('Thành viên', 'team', '📋 Đội vận hành (bảng phân công)', `SELECT id AS uid FROM users WHERE id IN (${team.map(() => '?').join(',')})`, team);
    db.all('SELECT id, name, icon FROM spaces ORDER BY order_num, id').forEach(s =>
      add('Space', 'space:' + s.id, `${s.icon || '💬'} ${s.name}`, "SELECT user_id AS uid FROM space_members WHERE space_id = ? AND status = 'approved'", [s.id]));
    db.all('SELECT id, title FROM courses ORDER BY order_num, id').forEach(c =>
      add('Khoá học', 'course:' + c.id, `📚 ${c.title}`, "SELECT user_id AS uid FROM course_enrollments WHERE course_id = ? AND status = 'approved'", [c.id]));
    db.all('SELECT id, title FROM challenges ORDER BY id').forEach(c =>
      add('Thử thách', 'challenge:' + c.id, `🔥 ${c.title}`, "SELECT user_id AS uid FROM challenge_enrollments WHERE challenge_id = ? AND status IN ('approved','active','completed')", [c.id]));
    return out;
  }
  app.get('/api/admin/notifications/audiences', requireAdmin, (_req, res) => {
    res.json({ audiences: notifAudiences().filter(a => a.count) });
  });

  app.post('/api/admin/notifications', requireAdmin, (req, res) => {
    const { user_id, type, title, content, link } = req.body;
    if (!type || !title || !content) return res.status(400).json({ error: 'Thiếu type, title hoặc content.' });
    const custom = getNotifCustomTypes().find(t => t.key === type);
    if (!custom && !NOTIF_BUILTIN_TYPES.includes(type)) return res.status(400).json({ error: 'Loại thông báo không tồn tại.' });
    const icon = custom ? custom.icon : null;

    // Nhiều người cùng lúc: user_ids (chọn từng thành viên) và/hoặc lists (theo danh sách) — gộp, bỏ trùng
    if (Array.isArray(req.body.user_ids) || Array.isArray(req.body.lists)) {
      const ids = new Set((req.body.user_ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0));
      const keys = new Set((req.body.lists || []).map(String));
      if (keys.size) notifAudiences().filter(a => keys.has(a.key)).forEach(a => a.ids.forEach(id => ids.add(id)));
      const users = ids.size ? db.all(`SELECT id FROM users WHERE id IN (${[...ids].map(() => '?').join(',')})`, [...ids]) : [];
      if (!users.length) return res.status(400).json({ error: 'Chưa chọn người nhận nào.' });
      for (const u of users) {
        db.run('INSERT INTO notifications (user_id, type, title, content, link, icon, sent_by_admin) VALUES (?,?,?,?,?,?,1)',
          [u.id, type, title, content, link || null, icon]);
        pushNotify(u.id, { title, body: content, link });
      }
      return res.json({ success: true, sent: users.length });
    }

    if (user_id === 'all') {
      const users = db.all("SELECT id FROM users WHERE status = 'active'");
      for (const u of users) {
        db.run(
          'INSERT INTO notifications (user_id, type, title, content, link, icon, sent_by_admin) VALUES (?,?,?,?,?,?,1)',
          [u.id, type, title, content, link || null, icon]
        );
        pushNotify(u.id, { title, body: content, link });
      }
      res.json({ success: true, sent: users.length });
    } else {
      const uid = Number(user_id);
      if (!uid) return res.status(400).json({ error: 'user_id không hợp lệ.' });
      const user = db.get('SELECT id FROM users WHERE id = ?', [uid]);
      if (!user) return res.status(404).json({ error: 'Không tìm thấy user.' });
      db.run(
        'INSERT INTO notifications (user_id, type, title, content, link, icon, sent_by_admin) VALUES (?,?,?,?,?,?,1)',
        [uid, type, title, content, link || null, icon]
      );
      pushNotify(uid, { title, body: content, link });
      res.json({ success: true, sent: 1 });
    }
  });

  // ══════════════════════════════════════════════════════════
  // MARKETPLACE ROUTES
  // ══════════════════════════════════════════════════════════

  // List products (public)
  app.get('/api/products', (req, res) => {
    const { category, sort, q } = req.query;
    // Course-checkout products are sold from the course page, not the general marketplace.
    let where = "p.status = 'published' AND p.course_id IS NULL";
    const params = [];
    if (category && category !== 'all') { where += ' AND p.category = ?'; params.push(category); }
    if (q) { where += ' AND (p.title LIKE ? OR p.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    const orderMap = { newest: 'p.created_at DESC', popular: 'p.sales_count DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC' };
    const orderBy = orderMap[sort] || 'p.created_at DESC';
    const products = db.all(`
      SELECT p.id, p.title, p.description, p.price, p.compare_price, p.detail_url, p.is_featured,
             p.category, p.cover_color,
             p.sales_count, p.created_at,
             u.first_name, u.last_name, u.xp
      FROM products p
      JOIN users u ON u.id = p.seller_id
      WHERE ${where}
      ORDER BY ${orderBy}
    `, params);
    const total = db.get("SELECT COUNT(*) AS n FROM products WHERE status = 'published' AND course_id IS NULL").n;
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
        <a class="btn" href="${SITE_URL}/marketplace.html">Xem Marketplace</a>
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
        <a class="btn" href="${SITE_URL}/admin.html">Duyệt trong Admin Panel</a>
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
    antamNotify('order', order.id,
      `🧾 <b>Đơn hàng mới #${order.id}</b> — chờ thanh toán\n\n${antamWho(buyer_id)}\n🛍️ ${antamEsc(product.title)}\n💰 <b>${Number(product.price).toLocaleString('vi-VN')}đ</b> · ${antamEsc(payment_method || 'bank')}\n\nBấm "Đã nhận tiền" khi tiền đã vào tài khoản.`);

    // 15-min reminder email if still pending after 15 minutes
    const orderId  = order.id;
    const buyerRow = db.get('SELECT first_name, last_name, email FROM users WHERE id = ?', [buyer_id]);
    const qrUrl    = `https://qr.sepay.vn/img?bank=${encodeURIComponent(paymentBank().name)}&acc=${encodeURIComponent(paymentBank().acc)}&template=compact&amount=${product.price}&des=${SEPAY_MEMO_PREFIX}%20${product_id}%20${buyer_id}`;
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
              🏦 <strong>${paymentBank().name}</strong> — STK: <strong>${paymentBank().acc}</strong><br>
              Chủ TK: <strong>${paymentBank().owner}</strong><br>
              Số tiền: <strong>${amountFmt}</strong><br>
              Nội dung: <strong>${SEPAY_MEMO_PREFIX} ${product_id} ${buyer_id}</strong>
            </div>
            <p>Quét mã QR để thanh toán nhanh:</p>
            <p><img src="${qrUrl}" alt="QR Code" style="width:180px;border-radius:8px;border:1px solid #e2e8f0"></p>
            <a class="btn" href="${SITE_URL}/checkout.html?id=${product_id}">Xem lại đơn hàng</a>
            <p style="color:#94a3b8;font-size:13px">Đơn hàng sẽ tự động hủy nếu không nhận được thanh toán trong 48 giờ.</p>
          `)
        });
      }, 15 * 60 * 1000);
    }
  });

  // ── Coach 1-1 sức khỏe ───────────────────────────────────────────
  // Mua gói qua checkout.html như sản phẩm bình thường (coaching_sessions trên
  // products); sau khi đơn hoàn tất, autoEnrollFromProductPurchase cộng buổi
  // vào coaching_credits. Số buổi còn lại = tổng đã mua - số booking chưa hủy.
  function coachingRemainingSessions(userId) {
    const total = db.get('SELECT COALESCE(SUM(sessions), 0) AS n FROM coaching_credits WHERE user_id = ?', [userId]).n;
    const used = db.get("SELECT COUNT(*) AS n FROM coaching_bookings WHERE user_id = ? AND status != 'cancelled'", [userId]).n;
    return Math.max(0, total - used);
  }

  // Cấu hình khung giờ nhận lịch hẹn (admin sửa trong site_settings, xem
  // PATCH /api/admin/settings). Thuật toán sinh mốc giờ mô phỏng đúng cách
  // Google Calendar Appointment Schedule làm: bắt đầu từ giờ mở cửa, mỗi mốc
  // cách nhau (thời lượng + khoảng nghỉ) phút, dừng khi mốc + thời lượng vượt
  // giờ đóng cửa.
  const COACH_WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  function getCoachWeeklyHours() {
    const row = db.get("SELECT value FROM site_settings WHERE key = 'coaching_weekly_hours'");
    if (row?.value) {
      try {
        const arr = JSON.parse(row.value);
        if (Array.isArray(arr) && arr.length === 7) return arr;
      } catch {}
    }
    return COACH_WEEKDAY_LABELS.map(() => ({ enabled: false, start: '09:00', end: '18:00' }));
  }
  function getCoachSlotConfig() {
    const duration = Number(db.get("SELECT value FROM site_settings WHERE key = 'coaching_slot_duration_minutes'")?.value) || 60;
    const buffer = Number(db.get("SELECT value FROM site_settings WHERE key = 'coaching_slot_buffer_minutes'")?.value);
    return { duration, buffer: Number.isFinite(buffer) ? buffer : 30 };
  }
  // maxAdvanceDays: khách chỉ đặt được trong vòng N ngày tới. minAdvanceHours:
  // khách phải đặt trước ít nhất N giờ so với giờ hẹn. maxPerDay: giới hạn số
  // lịch hẹn (chưa hủy) mỗi ngày, 0 = không giới hạn.
  function getCoachBookingLimits() {
    const maxAdvanceDays = Number(db.get("SELECT value FROM site_settings WHERE key = 'coaching_max_advance_days'")?.value);
    const minAdvanceHours = Number(db.get("SELECT value FROM site_settings WHERE key = 'coaching_min_advance_hours'")?.value);
    const maxPerDay = Number(db.get("SELECT value FROM site_settings WHERE key = 'coaching_max_bookings_per_day'")?.value);
    return {
      maxAdvanceDays: Number.isFinite(maxAdvanceDays) && maxAdvanceDays > 0 ? maxAdvanceDays : 60,
      minAdvanceHours: Number.isFinite(minAdvanceHours) && minAdvanceHours >= 0 ? minAdvanceHours : 2,
      maxPerDay: Number.isFinite(maxPerDay) && maxPerDay > 0 ? maxPerDay : 0,
    };
  }
  // Điều chỉnh riêng cho 1 ngày cụ thể (nghỉ lễ, hoặc mở giờ khác ngày thường
  // trong tuần) — mảng { date:'YYYY-MM-DD', enabled:bool, start, end }, ưu
  // tiên cao hơn lịch tuần ở trên khi trùng ngày.
  function getCoachDateOverride(dateStr) {
    const row = db.get("SELECT value FROM site_settings WHERE key = 'coaching_date_overrides'");
    if (!row?.value) return null;
    try {
      const arr = JSON.parse(row.value);
      if (Array.isArray(arr)) return arr.find(o => o.date === dateStr) || null;
    } catch {}
    return null;
  }
  function generateDaySlots(dateStr) {
    const weekday = new Date(dateStr + 'T00:00:00Z').getUTCDay();
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const { maxAdvanceDays, minAdvanceHours, maxPerDay } = getCoachBookingLimits();
    const daysAhead = Math.round((new Date(dateStr + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);
    if (daysAhead < 0 || daysAhead > maxAdvanceDays) return { weekday, enabled: false, slots: [] };

    const override = getCoachDateOverride(dateStr);
    let cfg;
    if (override) {
      if (!override.enabled) return { weekday, enabled: false, slots: [] };
      cfg = { enabled: true, start: override.start, end: override.end };
    } else {
      cfg = getCoachWeeklyHours()[weekday];
    }
    if (!cfg?.enabled || !cfg.start || !cfg.end) return { weekday, enabled: false, slots: [] };

    const { duration, buffer } = getCoachSlotConfig();
    const [startH, startM] = cfg.start.split(':').map(Number);
    const [endH, endM] = cfg.end.split(':').map(Number);
    const startMin = startH * 60 + startM, endMin = endH * 60 + endM;
    let slots = [];
    for (let t = startMin; t + duration <= endMin; t += duration + buffer) {
      slots.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    }
    const taken = new Set(db.all(
      "SELECT preferred_time AS t FROM coaching_bookings WHERE preferred_date = ? AND status != 'cancelled'",
      [dateStr]
    ).map(r => r.t));
    slots = slots.filter(s => !taken.has(s));

    const minAdvanceMs = minAdvanceHours * 3600 * 1000;
    slots = slots.filter(s => {
      const [h, m] = s.split(':').map(Number);
      const slotDt = new Date(dateStr + 'T00:00:00');
      slotDt.setHours(h, m, 0, 0);
      return slotDt.getTime() - now.getTime() >= minAdvanceMs;
    });

    if (maxPerDay > 0) {
      const countToday = db.get(
        "SELECT COUNT(*) AS n FROM coaching_bookings WHERE preferred_date = ? AND status != 'cancelled'",
        [dateStr]
      ).n;
      if (countToday >= maxPerDay) slots = [];
    }

    return { weekday, enabled: true, slots };
  }

  app.get('/api/coaching/availability', (req, res) => {
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Ngày không hợp lệ.' });
    const result = generateDaySlots(date);
    res.json({ ...result, weekdayLabel: COACH_WEEKDAY_LABELS[result.weekday] });
  });

  app.get('/api/coaching/packages', (_req, res) => {
    const packages = db.all("SELECT id, title, description, price, compare_price, coaching_sessions FROM products WHERE coaching_sessions IS NOT NULL AND status = 'published' ORDER BY coaching_sessions ASC");
    res.json({ packages });
  });

  app.get('/api/coaching/status', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'Thiếu user_id' });
    const remaining = coachingRemainingSessions(userId);
    const bookings = db.all('SELECT * FROM coaching_bookings WHERE user_id = ? ORDER BY created_at DESC, id DESC', [userId]);
    res.json({ remaining, bookings });
  });

  app.post('/api/coaching/bookings', (req, res) => {
    const { user_id, preferred_date, preferred_time, note } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Thiếu user_id.' });
    if (!preferred_date || !preferred_time) return res.status(400).json({ error: 'Vui lòng chọn ngày và giờ hẹn.' });
    if (coachingRemainingSessions(user_id) <= 0)
      return res.status(403).json({ error: 'Bạn chưa có buổi coach nào khả dụng — vui lòng mua gói trước.' });
    const { slots } = generateDaySlots(preferred_date);
    if (!slots.includes(preferred_time))
      return res.status(409).json({ error: 'Khung giờ này vừa hết hoặc không hợp lệ, vui lòng chọn lại.' });
    const r = db.run(
      'INSERT INTO coaching_bookings (user_id, preferred_date, preferred_time, note, status) VALUES (?,?,?,?,?)',
      [user_id, preferred_date, preferred_time, note || '', 'pending']
    );
    res.status(201).json({ ok: true, id: r.lastInsertRowid });
    antamNotify('coach', r.lastInsertRowid,
      `👤 <b>Đặt lịch coach 1-1</b> — chờ xác nhận\n\n${antamWho(user_id)}\n🕐 <b>${antamEsc(preferred_time)}</b> ngày <b>${antamEsc(String(preferred_date).split('-').reverse().join('/'))}</b>${note ? `\n📝 ${antamEsc(String(note).slice(0, 300))}` : ''}`);
  });

  app.post('/api/coaching/bookings/:id/cancel', (req, res) => {
    const { user_id } = req.body;
    const booking = db.get('SELECT * FROM coaching_bookings WHERE id = ?', [req.params.id]);
    if (!booking || Number(booking.user_id) !== Number(user_id)) return res.status(404).json({ error: 'Không tìm thấy lịch hẹn.' });
    if (booking.status === 'completed') return res.status(400).json({ error: 'Buổi này đã hoàn thành, không thể hủy.' });
    db.run("UPDATE coaching_bookings SET status = 'cancelled', updated_at = datetime('now','localtime') WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  });

  app.get('/api/admin/coaching/bookings', requireAdmin, (req, res) => {
    const { status = '' } = req.query;
    let sql = `SELECT b.*, u.first_name, u.last_name, u.email, u.phone
               FROM coaching_bookings b JOIN users u ON u.id = b.user_id WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND b.status = ?'; params.push(status); }
    sql += ' ORDER BY b.created_at DESC, b.id DESC';
    res.json({ bookings: db.all(sql, params) });
  });

  // Admin đánh dấu 1 buổi đã dùng thay cho khách (VD thấy lịch hẹn thật đã
  // diễn ra trên Google Calendar) — tìm khách qua email vì admin thường không
  // nhớ user_id.
  app.post('/api/admin/coaching/mark-used', requireAdmin, (req, res) => {
    const { email, note } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Vui lòng nhập email khách hàng.' });
    const user = db.get('SELECT id FROM users WHERE email = ?', [email.trim()]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy khách hàng với email này.' });
    if (coachingRemainingSessions(user.id) <= 0)
      return res.status(400).json({ error: 'Khách hàng này không còn buổi khả dụng.' });
    db.run(
      "INSERT INTO coaching_bookings (user_id, note, status) VALUES (?,?,'completed')",
      [user.id, note || 'Admin đánh dấu đã dùng 1 buổi (đặt lịch qua Google Calendar).']
    );
    res.json({ ok: true });
  });

  app.patch('/api/admin/coaching/bookings/:id', requireAdmin, (req, res) => {
    const booking = db.get('SELECT * FROM coaching_bookings WHERE id = ?', [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy lịch hẹn.' });
    const { status, confirmed_date, confirmed_time, meeting_link, admin_note } = req.body;
    const statusVal = ['pending', 'confirmed', 'completed', 'cancelled'].includes(status) ? status : booking.status;
    db.run(
      `UPDATE coaching_bookings SET status=?, confirmed_date=?, confirmed_time=?, meeting_link=?, admin_note=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [statusVal, confirmed_date || null, confirmed_time || null, meeting_link || null, admin_note || null, req.params.id]
    );
    if (statusVal !== booking.status && (statusVal === 'confirmed' || statusVal === 'cancelled'))
      antamResolve('coach', booking.id, statusVal === 'confirmed' ? 'approved' : 'rejected', req.adminUserId);
    res.json({ ok: true });
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

  // Admin — list all products (course-checkout products are managed from the course page, not here)
  app.get('/api/admin/products', requireAdmin, (_req, res) => {
    const products = db.all(`
      SELECT p.*, u.first_name, u.last_name, u.email
      FROM products p
      JOIN users u ON u.id = p.seller_id
      WHERE p.course_id IS NULL
      ORDER BY p.created_at DESC
    `);
    res.json(products);
  });

  // Admin — create product
  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const { title, description, long_description, price, compare_price, detail_url, is_featured, category, cover_color, status, seller_id } = req.body;
    if (!title) return res.status(400).json({ error: 'Thiếu tên sản phẩm.' });
    const sid = seller_id || db.get('SELECT id FROM users ORDER BY id ASC LIMIT 1')?.id || 1;
    const result = db.run(
      'INSERT INTO products (seller_id, title, description, long_description, price, compare_price, detail_url, is_featured, category, cover_color, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [sid, title, description || '', long_description || '', Number(price) || 0, Number(compare_price) || 0,
       detail_url || null, is_featured ? 1 : 0, category || 'other', cover_color || '#0ea5e9', status || 'published']
    );
    const product = db.get('SELECT * FROM products WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ success: true, product });
  });

  // Admin — update product
  app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
    const { status, title, description, long_description, price, compare_price, detail_url, is_featured, category, cover_color } = req.body;
    const fields = []; const params = [];
    if (status !== undefined)           { fields.push('status = ?');           params.push(status); }
    if (title !== undefined)            { fields.push('title = ?');            params.push(title); }
    if (description !== undefined)      { fields.push('description = ?');      params.push(description); }
    if (long_description !== undefined) { fields.push('long_description = ?'); params.push(long_description); }
    if (price !== undefined)            { fields.push('price = ?');            params.push(Number(price)); }
    if (compare_price !== undefined)    { fields.push('compare_price = ?');    params.push(Number(compare_price) || 0); }
    if (detail_url !== undefined)       { fields.push('detail_url = ?');       params.push(detail_url || null); }
    if (is_featured !== undefined)      { fields.push('is_featured = ?');      params.push(is_featured ? 1 : 0); }
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
              <a class="btn" href="${SITE_URL}/marketplace.html">Xem trên Marketplace</a>
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
              <a class="btn" href="${SITE_URL}/marketplace.html">Về Marketplace</a>
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
    setOrderStatus(Number(req.params.id), req.body.status, req.adminUserId);
    res.json({ success: true });
  });

  // Đổi trạng thái đơn hàng + việc kèm theo (mở quyền, email). Dùng chung cho admin.html và An Tâm.
  function setOrderStatus(orderId, status, byUserId) {
    const prev = db.get('SELECT status FROM orders WHERE id = ?', [orderId]);
    db.run('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);

    if (!prev || prev.status === status) return;
    if (status === 'completed') antamResolve('order', orderId, 'approved', byUserId);
    else if (status === 'cancelled') antamResolve('order', orderId, 'rejected', byUserId);

    // Fetch full order info for email
    const info = db.get(`
      SELECT o.amount, o.buyer_id, p.title AS product_title, p.id AS product_id,
             u.first_name, u.last_name, u.email AS buyer_email
      FROM orders o
      JOIN products p ON p.id = o.product_id
      JOIN users u ON u.id = o.buyer_id
      WHERE o.id = ?
    `, [orderId]);
    if (!info) return;

    const amtFmt = Number(info.amount).toLocaleString('vi-VN') + 'đ';

    if (status === 'completed') {
      autoEnrollFromProductPurchase(info.product_id, info.buyer_id, orderId);
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
          <a class="btn" href="${SITE_URL}/marketplace.html">Xem Marketplace</a>
        `)
      });
    }
  }

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
    antamNotify('order', orderId,
      `💸 <b>Khách báo đã chuyển khoản — đơn #${orderId}</b>\n\n${antamWho(user_id)}\n🛍️ ${antamEsc(order.product_title)}\n💰 <b>${amtFmt}</b>\n\nKiểm tra tài khoản rồi bấm "Đã nhận tiền".`);
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
        <p style="color:#94a3b8;font-size:13px">Nếu có thắc mắc, hãy liên hệ qua ${communityName()}.</p>
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
        <a class="btn" href="${SITE_URL}/admin.html">Xác nhận trong Admin Panel</a>
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
          <a class="btn" href="${SITE_URL}/feed.html">Về trang cộng đồng</a>
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
          <a class="btn" href="${SITE_URL}/admin.html">Xem trong Admin Panel</a>
        `)
      });
    } catch (err) {
      console.error('[Email] sendPaymentConfirmedEmails error:', err.message);
    }
  }

  // ── SePay settings (Admin → Cài đặt → Thanh toán) ──────────
  // API key webhook lưu trong admin_secrets (không lộ qua /api/settings công khai).
  // Chưa lưu key trong DB → dùng SEPAY_KEY từ env như trước.
  function getSecret(key) {
    return db.get('SELECT value FROM admin_secrets WHERE key = ?', [key])?.value || '';
  }
  function setSecret(key, value) {
    db.run('INSERT INTO admin_secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }
  // ── Web Push (PWA): thông báo đẩy như app + số đỏ trên icon ──────────
  // Khoá VAPID tạo 1 lần, lưu trong admin_secrets (không công khai). Thông báo đi qua dịch vụ
  // push của Google/Apple/Mozilla — miễn phí. Gửi song song với thông báo trong app (chuông).
  const VAPID = (() => {
    let pub = getSecret('vapid_public_key'), priv = getSecret('vapid_private_key');
    if (!pub || !priv) {
      const k = webpush.generateVAPIDKeys();
      setSecret('vapid_public_key', k.publicKey);
      setSecret('vapid_private_key', k.privateKey);
      pub = k.publicKey; priv = k.privateKey;
      console.log('  Web Push: đã tạo khoá VAPID mới.');
    }
    return { pub, priv };
  })();
  webpush.setVapidDetails(`mailto:${ADMIN_EMAIL}`, VAPID.pub, VAPID.priv);

  function unreadNotificationCount(userId) {
    return db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [userId])?.n || 0;
  }

  // Gửi thông báo đẩy tới mọi thiết bị đã bật của thành viên (không chặn request; lỗi chỉ ghi log).
  // Thiết bị đã gỡ quyền / hết hạn (404, 410) → tự xoá khỏi danh sách.
  function pushNotify(userId, { title, body, link } = {}) {
    let subs = [];
    try { subs = db.all('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [userId]); } catch (e) { return; }
    if (!subs.length) return;
    const url = !link ? '/feed.html' : /^https?:\/\//i.test(link) ? link : '/' + String(link).replace(/^\/+/, '');
    const payload = JSON.stringify({
      title: title || communityName(),
      body: String(body || '').slice(0, 300),
      url,
      badge: unreadNotificationCount(userId),
    });
    subs.forEach(s => {
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 })
        .then(() => db.run("UPDATE push_subscriptions SET last_success_at = datetime('now','localtime') WHERE id = ?", [s.id]))
        .catch(err => {
          if (err.statusCode === 404 || err.statusCode === 410) db.run('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
          else console.error('[push]', err.statusCode || '', err.body || err.message);
        });
    });
  }

  app.get('/api/push/public-key', (_req, res) => res.json({ publicKey: VAPID.pub }));

  // Người nhận lấy từ phiên đăng nhập (x-user-token), KHÔNG tin user_id trình duyệt gửi —
  // nếu không, ai cũng gắn được điện thoại của mình vào tài khoản người khác để đọc thông báo của họ.
  app.post('/api/push/subscribe', (req, res) => {
    const me = userFromSession(req);
    if (!me) return res.status(401).json({ error: 'Vui lòng đăng nhập lại để bật thông báo.', code: 'session_required' });
    const { subscription } = req.body || {};
    const uid = me.id;
    const endpoint = String(subscription?.endpoint || '');
    const p256dh = String(subscription?.keys?.p256dh || '');
    const auth = String(subscription?.keys?.auth || '');
    if (!uid || !db.get('SELECT id FROM users WHERE id = ?', [uid])) return res.status(404).json({ error: 'Tài khoản không tồn tại.' });
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return res.status(400).json({ error: 'Thông tin đăng ký thông báo không hợp lệ.' });
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const cur = db.get('SELECT id FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    if (cur) db.run('UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ? WHERE id = ?', [uid, p256dh, auth, ua, cur.id]);
    else db.run('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?,?,?,?,?)', [uid, endpoint, p256dh, auth, ua]);
    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    const endpoint = String(req.body?.endpoint || '');
    if (endpoint) db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    res.json({ ok: true });
  });

  // Thành viên tự gửi thông báo thử tới thiết bị của mình (kiểm tra đã bật thành công)
  app.post('/api/push/test', (req, res) => {
    const me = userFromSession(req);
    if (!me) return res.status(401).json({ error: 'Vui lòng đăng nhập lại.', code: 'session_required' });
    const uid = me.id;
    const n = uid ? db.get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [uid]).n : 0;
    if (!n) return res.status(400).json({ error: 'Thiết bị này chưa bật thông báo.' });
    pushNotify(uid, { title: 'Thông báo đã được bật 🎉', body: `Bạn sẽ nhận thông báo từ ${communityName()} ngay cả khi không mở trang.`, link: 'feed.html' });
    res.json({ ok: true, devices: n });
  });

  app.get('/api/admin/push/stats', requireAdmin, (_req, res) => {
    res.json({
      devices: db.get('SELECT COUNT(*) AS n FROM push_subscriptions').n,
      members: db.get('SELECT COUNT(DISTINCT user_id) AS n FROM push_subscriptions').n,
    });
  });

  function sepayApiKey() {
    return getSecret('sepay_api_key') || SEPAY_KEY || '';
  }
  function sepayAutoConfirm() {
    return getSecret('sepay_auto_confirm') !== '0'; // mặc định bật (giữ hành vi cũ)
  }

  app.get('/api/admin/payment-settings', requireAdmin, (_req, res) => {
    const dbKey = getSecret('sepay_api_key');
    const key = sepayApiKey();
    res.json({
      auto_confirm: sepayAutoConfirm(),
      key_source: dbKey ? 'db' : (SEPAY_KEY ? 'env' : 'none'),
      key_masked: key ? '••••••••' + key.slice(-4) : '',
      webhook_url: `${SITE_URL}/api/webhook/sepay`,
      memo_prefix: SEPAY_MEMO_PREFIX,
    });
  });

  app.put('/api/admin/payment-settings', requireAdmin, (req, res) => {
    const { auto_confirm, api_key, clear_key } = req.body || {};
    if (typeof auto_confirm === 'boolean') setSecret('sepay_auto_confirm', auto_confirm ? '1' : '0');
    if (clear_key) db.run("DELETE FROM admin_secrets WHERE key = 'sepay_api_key'");
    else if (typeof api_key === 'string' && api_key.trim()) setSecret('sepay_api_key', api_key.trim());
    res.json({ success: true });
  });

  // ── SePay webhook ──────────────────────────────────────────
  app.post('/api/webhook/sepay', (req, res) => {
    // SePay gửi "Authorization: Apikey <KEY>"; giữ thêm các cách cũ (header apikey / x-api-key / body)
    const auth = String(req.headers['authorization'] || '');
    const apikey = (auth.match(/^apikey\s+(.+)$/i) || [])[1]?.trim()
      || req.headers['apikey'] || req.headers['x-api-key'] || req.body?.apikey;
    const expected = sepayApiKey();
    if (!expected || apikey !== expected) {
      console.warn('SePay webhook: unauthorized request');
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { content, transferAmount, transferType } = req.body;
    console.log(`SePay webhook received: type=${transferType} amount=${transferAmount} content="${content}"`);

    if (transferType !== 'in') return res.json({ success: true });
    if (!sepayAutoConfirm()) {
      console.log('SePay: tự động xác nhận đang tắt — bỏ qua, admin duyệt thủ công.');
      return res.json({ success: true, message: 'Auto-confirm disabled.' });
    }

    // Parse "{PREFIX} {product_id} {buyer_id}" from nội dung chuyển khoản
    const match = String(content || '').match(new RegExp(SEPAY_MEMO_PREFIX + '\\s+(\\d+)\\s+(\\d+)', 'i'));
    if (!match) {
      console.log('SePay: content không khớp định dạng memo');
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
    autoEnrollFromProductPurchase(productId, buyerId, order.id);
    console.log(`✅ SePay: Order #${order.id} completed — ${transferAmount}₫`);
    res.json({ success: true });

    // An Tâm: đóng tin "chờ thanh toán" của đơn này + báo đã nhận tiền (không có nút)
    antamVia = 'sepay';
    try { antamResolve('order', order.id, 'approved', null); } finally { antamVia = 'web'; }
    antamNotify('order', order.id,
      `💰 <b>Đã nhận thanh toán (SePay tự động) — đơn #${order.id}</b>\n\n${antamWho(buyerId)}\n💵 <b>${Number(transferAmount).toLocaleString('vi-VN')}đ</b>`, false);

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

        // Tìm pattern {PREFIX} {product_id} {buyer_id} trong bất kỳ cột nào
        const match = rowStr.match(new RegExp(SEPAY_MEMO_PREFIX + '[\\s_]+(\\d+)[\\s_]+(\\d+)', 'i'));
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
        autoEnrollFromProductPurchase(Number(productId), Number(buyerId), order.id);
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
      const qrUrl = `https://qr.sepay.vn/img?bank=${encodeURIComponent(paymentBank().name)}&acc=${encodeURIComponent(paymentBank().acc)}&template=compact&amount=${row.amount}&des=${SEPAY_MEMO_PREFIX}%20${row.product_id}%20${row.buyer_id}`;

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
                🏦 <strong>${paymentBank().name}</strong> — STK: <strong>${paymentBank().acc}</strong><br>
                Chủ TK: <strong>${paymentBank().owner}</strong><br>
                Số tiền: <strong>${amtFmt}</strong><br>
                Nội dung: <strong>${SEPAY_MEMO_PREFIX} ${row.product_id} ${row.buyer_id}</strong>
              </div>
              <p><img src="${qrUrl}" alt="QR" style="width:160px;border-radius:8px;border:1px solid #e2e8f0"></p>
              <a class="btn" href="${SITE_URL}/checkout.html?id=${row.product_id}">Hoàn tất thanh toán</a>
            `)
          });
        }
      }
    }
  }, 30 * 60 * 1000); // check every 30 min

  // ── Late submission reminder cron (every hour) ──────────────
  setInterval(async () => {
    const lrSetting = db.get("SELECT value FROM site_settings WHERE key='late_reminder_enabled'");
    if (!lrSetting || lrSetting.value !== '1') return;

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
            <a class="btn" href="${SITE_URL}/challenge-day-detail.html?challenge_id=${e.challenge_id}&day_id=${day.id}">Nộp bài ngay</a>
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

  // ── Agent 2: daily meal-log reminder (Telegram push) ─────────
  // Nudges users who've linked Telegram but haven't logged today's meals yet,
  // once the evening cutoff has passed. Mirrors the late_reminders cadence
  // pattern above but via meal_log_reminders (max 1 send/day/user).
  const MEAL_REMINDER_MESSAGES = [
    '🍽️ Hôm nay bạn đã ghi nhật ký ăn uống chưa? Đừng để bụng đói mà quên luôn nha!',
    '👋 Ghé qua ghi lại bữa ăn hôm nay nhé — vài giây thôi mà mình theo dõi sức khỏe bạn tốt hơn nhiều đó!',
    '🌿 Nhắc nhẹ: nhật ký ăn uống hôm nay vẫn đang chờ bạn ghi lại nè.',
  ];
  // Theo giờ địa phương của từng người (cột users.timezone; trống = giờ VN): từ 20:00 ngày của họ.
  setInterval(async () => {
    if (!TELEGRAM_BOT_TOKEN) return;
    const candidates = db.all(
      `SELECT id, first_name, telegram_chat_id, timezone FROM users
       WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id != '' AND status = 'active'`);
    for (const u of candidates) {
      const local = tzParts(u.timezone);
      if (local.hour < 20) continue;
      const today = local.date;
      if (db.get('SELECT 1 AS x FROM meal_logs WHERE user_id = ? AND log_date = ?', [u.id, today])) continue;
      if (db.get('SELECT id FROM meal_log_reminders WHERE user_id = ? AND reminder_date = ?', [u.id, today])) continue;
      const text = MEAL_REMINDER_MESSAGES[Math.floor(Math.random() * MEAL_REMINDER_MESSAGES.length)];
      await sendTelegramMessage(u.telegram_chat_id, text);
      db.run('INSERT INTO meal_log_reminders (user_id, reminder_date) VALUES (?,?)', [u.id, today]);
    }
  }, 10 * 60 * 1000); // kiểm tra mỗi 10 phút (múi giờ khác nhau)

  // ── 377 ngày: nhắc ghi nhật ký (chuông thông báo + đẩy lên điện thoại) ─────────
  // Từ 20:00 (giờ máy chủ = giờ VN) mỗi ngày: ai đang trong 377 ngày (đã duyệt, đã tới ngày bắt đầu,
  // chưa quá ngày 377) mà CHƯA nộp báo cáo hôm nay → 1 thông báo/ngày. Ai nộp rồi thì không nhắc.
  db.exec(`CREATE TABLE IF NOT EXISTS program377_reminders (
    user_id INTEGER NOT NULL, reminder_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')), UNIQUE(user_id, reminder_date))`);

  function remindProgram377Reports() {
    try {
      // Đang bắt buộc khảo sát Thân-Tâm-Mệnh mà chưa làm → chưa vào được nội dung, không nhắc
      const needIntake = (db.get("SELECT value FROM site_settings WHERE key = 'ttm_intake_trigger'")?.value || 'none') !== 'none';
      // "Hôm nay" và 20:00 tính theo múi giờ của từng người (khách ở nước ngoài); trống = giờ VN
      const all = db.all(
        `SELECT e.user_id, e.start_date, u.timezone
         FROM program377_enrollments e JOIN users u ON u.id = e.user_id
         WHERE e.status = 'approved' AND e.start_date IS NOT NULL AND u.status = 'active'
           ${needIntake ? 'AND u.ttm_intake_done_at IS NOT NULL' : ''}`);
      const rows = [];
      for (const r of all) {
        const local = tzParts(r.timezone);
        if (local.hour < 20 || r.start_date > local.date) continue;
        const today = local.date;
        if (db.get('SELECT 1 AS x FROM program377_reports WHERE user_id = ? AND report_date = ?', [r.user_id, today])) continue;
        if (db.get('SELECT 1 AS x FROM program377_reminders WHERE user_id = ? AND reminder_date = ?', [r.user_id, today])) continue;
        rows.push({ ...r, today, day_n: Math.round((new Date(today + 'T00:00:00Z') - new Date(r.start_date.slice(0, 10) + 'T00:00:00Z')) / 864e5) + 1 });
      }
      for (const r of rows) {
        const today = r.today;
        if (r.day_n < 1 || r.day_n > 377) continue;
        db.run('INSERT OR IGNORE INTO program377_reminders (user_id, reminder_date) VALUES (?,?)', [r.user_id, today]);
        const title = `📝 Ngày ${r.day_n}/377 — bạn chưa ghi nhật ký hôm nay`;
        const content = 'Dành 2 phút ghi lại bữa ăn, màu – vị, cơ thể và 3 điều biết ơn hôm nay để hoàn thành ngày thực hành nhé.';
        db.run('INSERT INTO notifications (user_id, type, title, content, link) VALUES (?,?,?,?,?)',
          [r.user_id, 'p377_reminder', title, content, 'program377.html']);
        pushNotify(r.user_id, { title, body: content, link: 'program377.html' });
      }
      if (rows.length) console.log(`[377] Đã nhắc ghi nhật ký cho ${rows.length} thành viên.`);
    } catch (e) { console.error('[377] Lỗi nhắc ghi nhật ký:', e.message); }
  }
  setInterval(remindProgram377Reports, 10 * 60 * 1000);   // kiểm tra mỗi 10 phút
  setTimeout(remindProgram377Reports, 30 * 1000);          // và 1 lần sau khi máy chủ khởi động

  // ── CRM ────────────────────────────────────────────────────
  // Seed default email templates on first run
  function seedEmailTemplates() {
    const existing = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    if (existing) return;
    const defaults = [
      { id:1, name:'Email chào mừng', subject:`Chào mừng đến với ${communityName()}! 🎉`, category:'welcome',
        body:`<h2>Chào mừng {{first_name}} đến với ${communityName()}! 🎉</h2>
<p>Bạn đã chính thức gia nhập cộng đồng <strong>${communityName()}</strong> — nơi mọi người cùng học cách ăn uống theo Ngũ Hành để thanh lọc và cân bằng cơ thể.</p>
<p><strong>Bắt đầu ngay:</strong></p>
<ul>
  <li>🔥 <a href="${SITE_URL}/challenge.html">Đăng ký Thử thách 28 ngày</a></li>
  <li>💬 <a href="${SITE_URL}/feed.html">Chia sẻ bài đầu tiên trên Bảng tin</a></li>
  <li>🛍️ <a href="${SITE_URL}/marketplace.html">Khám phá Chợ combo & tài liệu</a></li>
</ul>
<p>Hẹn gặp bạn trong cộng đồng!<br><strong>Ban điều hành</strong></p>`, updated_at:'2025-04-01' },
      { id:2, name:'Xác nhận đăng ký thử thách', subject:'Bạn đã đăng ký Thử thách 28 ngày! 🔥', category:'challenge',
        body:`<h2>Bạn đã đăng ký Thử thách 28 ngày! 🔥</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Chúc mừng! Bạn đã chính thức đăng ký <strong>Thử thách 28 Ngày</strong>.</p>
<p>📅 Bắt đầu: <strong>{{start_date}}</strong><br>
✅ Mỗi ngày hoàn thành 1 nhiệm vụ<br>
⭐ Nhận XP và phần thưởng khi hoàn thành</p>
<p><a href="${SITE_URL}/challenge.html">Xem chi tiết thử thách →</a></p>
<p>Chúng tôi sẽ gửi nhắc nhở mỗi ngày lúc 19:00.<br><strong>Ban điều hành</strong></p>`, updated_at:'2025-04-05' },
      { id:3, name:'Nhắc nhở hoàn thành ngày', subject:'Đừng quên nhiệm vụ hôm nay — Ngày {{day_number}} 📅', category:'reminder',
        body:`<h2>Đừng quên nhiệm vụ hôm nay! 📅</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Hôm nay là <strong>Ngày {{day_number}}</strong> trong hành trình 28 ngày của bạn.</p>
<p>🎯 Nhiệm vụ: <strong>{{task_title}}</strong></p>
<p>Hoàn thành trước nửa đêm để không mất streak!<br>Streak hiện tại: 🔥 <strong>{{streak}} ngày</strong></p>
<p><a href="${SITE_URL}/challenge.html">Hoàn thành ngay →</a></p>
<p><strong>Ban điều hành</strong></p>`, updated_at:'2025-04-10' },
      { id:4, name:'Chúc mừng hoàn thành 28 ngày', subject:'🏆 Bạn đã hoàn thành Thử thách 28 ngày!', category:'completion',
        body:`<h2>🏆 Bạn đã chinh phục 28 ngày!</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Bạn đã hoàn thành <strong>Thử thách 28 Ngày</strong>! Chỉ có <strong>{{completion_pct}}%</strong> người đăng ký đạt được điều này.</p>
<p>🌟 +{{xp_earned}} XP<br>🏆 Huy hiệu "Streak Master"<br>🎁 Giảm 20% cho khoá học nâng cao</p>
<p><a href="${SITE_URL}/leaderboard.html">Xem bảng xếp hạng →</a></p>
<p><strong>Ban điều hành</strong></p>`, updated_at:'2025-04-15' },
      { id:5, name:'Giới thiệu sản phẩm — Email 1', subject:'Khám phá combo Dưỡng Hóa 🌿', category:'sales',
        body:`<h2>Khám phá combo Dưỡng Hóa 🌿</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Bộ tài liệu <strong>{{product_name}}</strong> giúp bạn bắt đầu hành trình ăn uống cân bằng ngay hôm nay.</p>
<p><strong>Bao gồm:</strong></p>
<ul>
  <li>{{feature_1}}</li>
  <li>{{feature_2}}</li>
  <li>{{feature_3}}</li>
</ul>
<p>Giá: <strong>{{price}}</strong> — Hoàn tiền 7 ngày nếu không hài lòng.</p>
<p><a href="${SITE_URL}/marketplace.html">Xem chi tiết →</a></p>
<p><strong>Ban điều hành</strong></p>`, updated_at:'2025-05-01' },
      { id:6, name:'Bán hàng — Social Proof', subject:'Cộng đồng nói gì về sản phẩm này? 💬', category:'sales',
        body:`<h2>Cộng đồng nói gì? 💬</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Sau khi ra mắt <strong>{{product_name}}</strong>, chúng tôi nhận được rất nhiều phản hồi tích cực:</p>
<blockquote>"{{testimonial_1}}" — <strong>{{user_1}}</strong></blockquote>
<blockquote>"{{testimonial_2}}" — <strong>{{user_2}}</strong></blockquote>
<p><a href="${SITE_URL}/marketplace.html">Mua ngay →</a></p>`, updated_at:'2025-05-02' },
      { id:7, name:'Bán hàng — Last Chance', subject:'⏰ Còn 24 giờ — Ưu đãi sắp kết thúc!', category:'sales',
        body:`<h2>⏰ Còn 24 giờ!</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Chương trình ưu đãi cho <strong>{{product_name}}</strong> kết thúc lúc 23:59 ngày <strong>{{deadline}}</strong>.</p>
<p style="text-align:center;font-size:28px;font-weight:bold;color:#ef4444">{{discount_pct}}% OFF</p>
<p>Còn {{hours_left}} giờ — {{spots_left}} suất cuối cùng.</p>
<p><a href="${SITE_URL}/marketplace.html">Mua ngay →</a></p>`, updated_at:'2025-05-03' },
      { id:8, name:'Tái kích hoạt — Nhớ bạn', subject:'Chúng tôi nhớ bạn! Có nhiều điều mới 👋', category:'reengagement',
        body:`<h2>Chúng tôi nhớ bạn! 👋</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Đã {{days_inactive}} ngày kể từ lần cuối bạn ghé ${communityName()}. Cộng đồng có nhiều điều mới:</p>
<ul>
  <li>🔥 Thử thách mới: <strong>{{new_challenge}}</strong></li>
  <li>💬 {{new_posts}} bài đăng từ cộng đồng</li>
  <li>🛍️ {{new_products}} sản phẩm mới tại Chợ</li>
</ul>
<p><a href="${SITE_URL}/feed.html">Quay lại cộng đồng →</a></p>`, updated_at:'2025-05-10' },
      { id:9, name:'Tái kích hoạt — Phần thưởng', subject:'🎁 Phần thưởng đặc biệt dành riêng cho bạn', category:'reengagement',
        body:`<h2>🎁 Phần thưởng đặc biệt!</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Để chào đón bạn quay lại, chúng tôi tặng:</p>
<p style="text-align:center;font-size:32px;font-weight:bold;color:#8b5cf6">+50 XP</p>
<p>Bonus khi hoàn thành nhiệm vụ đầu tiên sau khi quay lại. Có hiệu lực trong 7 ngày.</p>
<p><a href="${SITE_URL}/challenge.html">Nhận phần thưởng →</a></p>`, updated_at:'2025-05-10' },
      { id:10, name:'Newsletter hàng tuần', subject:`Tổng hợp tuần tại ${communityName()} — {{week}}`, category:'newsletter',
        body:`<h2>📰 Tổng hợp tuần {{week}}</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p><strong>Bài nổi bật tuần này:</strong></p>
<p>📌 <strong>{{post_1_title}}</strong><br>{{post_1_excerpt}}</p>
<p>📌 <strong>{{post_2_title}}</strong><br>{{post_2_excerpt}}</p>
<p><a href="${SITE_URL}/feed.html">Xem thêm →</a></p>`, updated_at:'2025-05-20' },
      { id:11, name:'Thông báo sản phẩm mới', subject:'🚀 Ra mắt: {{product_name}} — Xem ngay!', category:'sales',
        body:`<h2>🚀 Ra mắt: {{product_name}}</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Chúng tôi vừa ra mắt <strong>{{product_name}}</strong> — được thiết kế đặc biệt cho ${communityName()}.</p>
<p style="text-align:center;font-size:28px;font-weight:bold;color:#10b981">{{launch_price}}</p>
<p><strike>{{regular_price}}</strike> — Ưu đãi kết thúc sau {{launch_hours}} giờ.</p>
<p><a href="${SITE_URL}/marketplace.html">Xem & mua ngay →</a></p>`, updated_at:'2025-05-22' },
      { id:12, name:'Nhắc nhở hoàn thiện hồ sơ', subject:'Hồ sơ chưa hoàn chỉnh — cập nhật ngay', category:'reminder',
        body:`<h2>Hồ sơ chưa hoàn chỉnh 📋</h2>
<p>Chào <strong>{{first_name}}</strong>,</p>
<p>Hồ sơ đầy đủ giúp bạn được cộng đồng tin tưởng hơn.</p>
<p><strong>Còn thiếu:</strong></p>
<ul>
  <li>📷 Ảnh đại diện</li>
  <li>📝 Bio / Giới thiệu bản thân</li>
  <li>🌐 Website / LinkedIn</li>
</ul>
<p>Chỉ mất 2 phút!</p>
<p><a href="${SITE_URL}/profile.html">Cập nhật hồ sơ →</a></p>`, updated_at:'2025-05-23' },
    ];
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_templates',?)", [JSON.stringify(defaults)]);
    console.log('✅ Seeded 12 email templates');
  }
  seedEmailTemplates();

  app.get('/api/admin/crm/stats', requireAdmin, (_req, res) => {
    const totalUsers   = db.get("SELECT COUNT(*) as n FROM users WHERE status='active'").n;
    const googleUsers  = db.get("SELECT COUNT(*) as n FROM users WHERE google_id IS NOT NULL").n;
    const emailUsers   = db.get("SELECT COUNT(*) as n FROM users WHERE password_hash IS NOT NULL").n;
    const enrolled     = db.get("SELECT COUNT(DISTINCT user_id) as n FROM challenge_enrollments WHERE status='approved'").n;
    const buyers       = db.get("SELECT COUNT(DISTINCT buyer_id) as n FROM orders WHERE status='completed'").n;
    const submitted    = db.get("SELECT COUNT(DISTINCT user_id) as n FROM challenge_submissions").n;
    const notifSent    = db.get("SELECT COUNT(*) as n FROM notifications WHERE sent_by_admin=1").n;
    const remindersSent= db.get("SELECT COUNT(*) as n FROM late_reminders").n;
    const orderMails   = db.get("SELECT COALESCE(SUM(mail_15m+mail_1d+mail_2d+mail_4d),0) as n FROM orders").n;
    const emailsSent   = notifSent + remindersSent + orderMails;

    res.json({
      active_contacts: totalUsers,
      emails_sent: emailsSent,
      lists: [
        { id:1, name:'Tất cả thành viên (active)', desc:'Toàn bộ tài khoản đang hoạt động', count:totalUsers, tag:'all' },
        { id:2, name:'Đăng nhập Google', desc:'Tài khoản liên kết Google OAuth', count:googleUsers, tag:'google' },
        { id:3, name:'Đăng nhập Email/Password', desc:'Tài khoản đăng ký bằng email', count:emailUsers, tag:'email' },
        { id:4, name:'Tham gia thử thách', desc:'Đã được duyệt tham gia ít nhất 1 thử thách', count:enrolled, tag:'challenge' },
        { id:5, name:'Đã nộp bài', desc:'Đã nộp ít nhất 1 bài trong thử thách', count:submitted, tag:'submitted' },
        { id:6, name:'Đã mua sản phẩm', desc:'Có ít nhất 1 đơn hàng hoàn thành', count:buyers, tag:'buyer' },
        ...Object.entries(LEAD_MAGNETS).map(([k, m], i) => ({ id: 7 + i, name: m.label.replace(/^\S+\s/, ''),
          desc: `Khách để lại Họ tên + Email + SĐT trên trang ${m.page}`, count: magnetCount(k), tag: 'magnet:' + k })),
      ],
      tags: [
        { name:'google-user',         count:googleUsers,   color:'#4285f4' },
        { name:'email-user',          count:emailUsers,    color:'#0ea5e9' },
        { name:'challenge-enrolled',  count:enrolled,      color:'#f59e0b' },
        { name:'submitted-work',      count:submitted,     color:'#10b981' },
        { name:'buyer',               count:buyers,        color:'#ec4899' },
        { name:'received-reminder',   count:remindersSent, color:'#8b5cf6' },
      ],
      sequences: [
        { id:1, name:'Chào mừng thành viên mới',     trigger:'Khi đăng ký tài khoản',             icon:'👋', color:'#dbeafe', emails:1, sent:totalUsers,    status:'active' },
        { id:2, name:'Xác nhận đăng ký thử thách',   trigger:'Khi đăng ký challenge được duyệt',   icon:'🔥', color:'#fef3c7', emails:1, sent:enrolled,     status:'active' },
        { id:3, name:'Nhắc nhở hoàn thành ngày',     trigger:'Mỗi giờ (scheduler)',                icon:'⏰', color:'#d1fae5', emails:1, sent:remindersSent, status: (db.get("SELECT value FROM site_settings WHERE key='late_reminder_enabled'") || {}).value === '1' ? 'active' : 'paused', toggleable: true },
        { id:4, name:'Email theo dõi đơn hàng',      trigger:'Sau mua: 15 phút / 1 ngày / 2 ngày / 4 ngày', icon:'📦', color:'#fce7f3', emails:4, sent:orderMails, status:'active' },
        ...Object.entries(LEAD_MAGNETS).map(([k, m], i) => ({ id: 10 + i, name: `Gửi công thức ${m.recipeTitle}`,
          trigger: `Khi khách để lại thông tin trên ${m.page} (lần đầu)`, icon: m.emoji || '🎁', color: '#dcfce7', emails: 1,
          sent: db.get("SELECT COUNT(*) AS n FROM lead_magnet_signups WHERE magnet = ? AND email_status = 'sent'", [k]).n,
          status: magnetEmailOn(k) ? 'active' : 'paused', magnet: k })),
        { id:5, name:'Thông báo admin (broadcast)',  trigger:'Thủ công từ admin panel',             icon:'📢', color:'#ede9fe', emails:1, sent:notifSent,     status:'active' },
      ],
    });
  });

  app.get('/api/admin/crm/templates', requireAdmin, (_req, res) => {
    const row = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    let tpls = [];
    if (row) { try { tpls = JSON.parse(row.value); } catch {} }
    res.json(tpls);
  });

  app.post('/api/admin/crm/templates', requireAdmin, (req, res) => {
    const { name, subject, category, body } = req.body;
    if (!name || !subject) return res.status(400).json({ error: 'Thiếu tên và subject.' });
    const row = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    let tpls = [];
    if (row) { try { tpls = JSON.parse(row.value); } catch {} }
    const maxId = tpls.reduce((m, t) => Math.max(m, t.id || 0), 0);
    const tpl = { id: maxId + 1, name, subject, category: category || 'other', body: body || '', updated_at: new Date().toISOString().slice(0,10) };
    tpls.push(tpl);
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_templates',?)", [JSON.stringify(tpls)]);
    res.json({ ok: true, template: tpl });
  });

  app.patch('/api/admin/crm/templates/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const { name, subject, category, body } = req.body;
    const row = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    let tpls = [];
    if (row) { try { tpls = JSON.parse(row.value); } catch {} }
    const idx = tpls.findIndex(t => t.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Template không tồn tại.' });
    tpls[idx] = { ...tpls[idx], name, subject, category, body, updated_at: new Date().toISOString().slice(0,10) };
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_templates',?)", [JSON.stringify(tpls)]);
    res.json({ ok: true, template: tpls[idx] });
  });

  // ── Gửi email thủ công (CRM → tab "Gửi thủ công") ─────────────────
  // Mỗi lần 1 địa chỉ: chọn mẫu, nhập email (+ tên nếu có) rồi gửi. {{first_name}} → tên (mặc định "bạn").
  // Cùng 1 mẫu đã gửi cho địa chỉ này rồi → hỏi lại trước khi gửi lần nữa (tránh gửi trùng lead).
  function crmTemplates() {
    try { return JSON.parse(db.get("SELECT value FROM site_settings WHERE key='email_templates'")?.value || '[]'); } catch { return []; }
  }
  const fillTpl = (str, vars) => String(str || '').replace(/\{\{\s*(first_name|name|email)\s*\}\}/g, (_, k) => vars[k === 'name' ? 'first_name' : k] || '');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  // Tên gọi trong email: "Lê Thị Ly" → "Ly" (người Việt gọi bằng tên — chữ cuối)
  const callName = full => { const w = String(full || '').trim().split(/\s+/).filter(Boolean); return w.length ? w[w.length - 1] : ''; };
  // Gửi 1 email theo mẫu — dùng chung cho tab "Gửi thủ công" (web) và An Tâm "➕ Khách mới" (Telegram).
  // Trả { ok, subject } | { duplicate, sent_at, error } | { error, status }
  async function sendTemplateEmail({ to, fullName, templateId, byUserId, force, via }) {
    to = String(to || '').trim().toLowerCase();
    const name = String(fullName || '').trim().slice(0, 80);
    if (!EMAIL_RE.test(to)) return { error: 'Địa chỉ email không hợp lệ.', status: 400 };
    const tpl = crmTemplates().find(t => t.id === Number(templateId));
    if (!tpl) return { error: 'Không tìm thấy mẫu email.', status: 404 };
    if (!force) {
      const prev = db.get("SELECT created_at FROM manual_email_log WHERE to_email = ? AND template_id = ? AND status = 'sent' ORDER BY id DESC LIMIT 1", [to, tpl.id]);
      if (prev) return { duplicate: true, sent_at: prev.created_at, status: 409, error: `Địa chỉ này đã nhận mẫu "${tpl.name}" lúc ${prev.created_at}.` };
    }
    const vars = { first_name: callName(name) || 'bạn', email: to };
    const subject = fillTpl(tpl.subject, vars);
    const html = emailWrap('', fillTpl(tpl.body, vars)).replace('<h1></h1>', '');
    const r = await sendEmail({ to, subject, html });
    db.run('INSERT INTO manual_email_log (to_email, to_name, template_id, template_name, subject, status, error, sent_by, via) VALUES (?,?,?,?,?,?,?,?,?)',
      [to, name || null, tpl.id, tpl.name, subject, r.ok ? 'sent' : 'failed', r.ok ? null : String(r.error || '').slice(0, 300), byUserId || null, via || 'web']);
    if (!r.ok) return { error: 'Gửi thất bại: ' + (r.error || 'lỗi không rõ'), status: 502 };
    return { ok: true, subject, template: tpl };
  }
  app.post('/api/admin/crm/send-manual', requireAdmin, async (req, res) => {
    const r = await sendTemplateEmail({ to: req.body?.to, fullName: req.body?.first_name, templateId: req.body?.template_id,
      byUserId: req.adminUserId, force: !!req.body?.force, via: 'web' });
    if (r.ok) return res.json({ ok: true, subject: r.subject });
    res.status(r.status || 400).json(r);
  });
  app.get('/api/admin/crm/manual-log', requireAdmin, (_req, res) => {
    res.json({ log: db.all(`SELECT l.*, u.first_name AS by_first, u.last_name AS by_last FROM manual_email_log l
      LEFT JOIN users u ON u.id = l.sent_by ORDER BY l.id DESC LIMIT 50`) });
  });
  // Thêm 1 lần mẫu "Cảm ơn & mời 3 buổi workshop miễn phí" (cho lead từ quảng cáo Facebook)
  // AI AGENTS CC: không tự thêm mẫu email mời workshop sức khỏe của template
  if (false && !db.get("SELECT value FROM site_settings WHERE key = 'email_tpl_seed_ws3'")) {
    const tpls = crmTemplates();
    if (!tpls.some(t => t.name === 'Cảm ơn & mời 3 buổi workshop miễn phí')) {
      tpls.push({ id: tpls.reduce((m, t) => Math.max(m, t.id || 0), 0) + 1, name: 'Cảm ơn & mời 3 buổi workshop miễn phí', category: 'welcome',
        subject: '{{first_name}} ơi, cảm ơn bạn — 3 buổi workshop miễn phí đang chờ bạn 🌿',
        body: `<h2>Chào {{first_name}}, cảm ơn bạn đã quan tâm! 🌿</h2>
<p>Cảm ơn bạn đã để lại thông tin cho <strong>${communityName()}</strong>. Chào mừng bạn đến với cộng đồng những người đang học cách <strong>ăn uống thuận tự nhiên theo Ngũ Hành</strong> để thanh lọc, cân bằng và tự chữa lành cơ thể.</p>
<p>Như một món quà làm quen, mời bạn tham gia <strong>3 buổi workshop MIỄN PHÍ</strong>:</p>
<ul>
  <li><strong>Buổi 1 – Nhìn nhận sự thật:</strong> nguyên tắc 5Đ ăn đúng theo tự nhiên và bài test cơ địa Hàn – Nhiệt của riêng bạn.</li>
  <li><strong>Buổi 2 – Đánh thức cơ thể:</strong> vì sao cơ thể "tắc nghẽn" độc tố và vai trò của đại tràng – "máy lọc nước" của cơ thể.</li>
  <li><strong>Buổi 3 – Tái sinh toàn diện:</strong> sống thuận quy luật 4 mùa và nâng tần số năng lượng để tự chữa lành.</li>
</ul>
<p style="text-align:center;"><a class="btn" href="${SITE_URL}">👉 Tham gia 3 buổi workshop miễn phí</a></p>
<p><strong>Chỉ 2 bước:</strong></p>
<ol>
  <li>Bấm nút phía trên, tạo tài khoản (hoặc đăng nhập nhanh bằng Google).</li>
  <li>Vào mục <strong>3 Buổi Workshop</strong> ở menu bên trái để xem lịch học và link Zoom.</li>
</ol>
<p>Cần hỗ trợ, bạn cứ nhắn tin cho Fanpage nơi bạn đã để lại thông tin nhé.</p>
<p>Hẹn gặp bạn trong buổi học!<br><strong>Ban tổ chức ${communityName()}</strong></p>`,
        updated_at: new Date().toISOString().slice(0, 10) });
      db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_templates',?)", [JSON.stringify(tpls)]);
    }
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_tpl_seed_ws3','1')");
  }

  app.delete('/api/admin/crm/templates/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const row = db.get("SELECT value FROM site_settings WHERE key='email_templates'");
    let tpls = [];
    if (row) { try { tpls = JSON.parse(row.value); } catch {} }
    tpls = tpls.filter(t => t.id !== id);
    db.run("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('email_templates',?)", [JSON.stringify(tpls)]);
    res.json({ ok: true });
  });

  // ══════════════════════════════════════════════════════════
  // TRỢ LÝ NGŨ HÀNH — hỏi đáp ăn uống dưỡng sinh
  // ══════════════════════════════════════════════════════════
  // Tính năng AI thứ 3 (cạnh chấm bài tập + chatbot intake), dùng chung callAiChat().
  // Không streaming, không RAG — kho kiến thức nhỏ, nhồi thẳng vào system prompt mỗi request.

  const ASSISTANT_SYSTEM = `Bạn là "Trợ lý Ngũ Hành" của AI AGENTS CC — đồng hành cùng thành viên trong việc ăn uống dưỡng sinh theo Âm Dương Ngũ Hành (ngũ sắc – ngũ vị – tạng phủ – mùa – khung giờ).

NHIỆM VỤ: trả lời các câu hỏi thực tế về ăn uống hằng ngày, ví dụ:
- "Vị chua thì nên ăn gì?" → gợi ý thực phẩm/món theo vị + hành + tạng, và NÊN ĂN VÀO BUỔI NÀO.
- "Sáng nay nên ăn món gì?" → dựa vào quy trình 3 buổi + thể trạng của họ.
- "Tôi có bí đỏ, nên nấu món gì và ăn khi nào?" → từ nguyên liệu họ có, gợi ý cách chế biến theo Ngũ Hành + thời điểm ăn hợp lý.

NGUYÊN TẮC BẮT BUỘC:
• Toàn bộ trả lời bằng tiếng Việt, xưng "mình/bạn", ấm áp như người bạn am hiểu — không phải bác sĩ hay cỗ máy.
• Chỉ trả lời trong phạm vi ăn uống – dưỡng sinh – Ngũ Hành. Câu hỏi ngoài phạm vi (thời tiết, chính trị, lập trình, chuyện phiếm...) → lịch sự từ chối và kéo về chủ đề ăn uống.
• Khi gợi ý món/thực phẩm, LUÔN kèm "ăn vào buổi nào / khung giờ nào" và lý do ngắn gọn theo Ngũ Hành (vị → hành → tạng).
• Ưu tiên gợi ý các thực phẩm và công thức có trong KHO bên dưới. Được phép bổ sung kiến thức Ngũ Hành phổ thông, nhưng không bịa ra công thức phức tạp thiếu căn cứ.
• Nếu có "Hồ sơ dưỡng sinh" hoặc nhật ký ăn uống của thành viên, hãy cá nhân hoá lời khuyên (thiên hàn/nhiệt, tạng cần chú ý, vị/màu đang thiếu).
• TUYỆT ĐỐI KHÔNG chẩn đoán bệnh hay kê đơn thuốc. Đây là hướng dẫn ăn uống dưỡng sinh, không thay thế việc khám chữa bệnh.
• Nếu người dùng mô tả triệu chứng nặng (đau dữ dội, chảy máu, khó thở, sụt cân nhanh, ho ra máu...) → khuyên đi khám bác sĩ ngay, không tư vấn ăn uống thay thế.
• Trả lời gọn, đi thẳng vào việc: 3–8 câu hoặc một danh sách ngắn. Không lan man.
• Khi phù hợp, kết thúc bằng 1 câu nhắc nhẹ: đây là gợi ý dưỡng sinh, hãy lắng nghe cơ thể mình.`;

  const ASSISTANT_RULES = `

═══ QUY TẮC NGŨ HÀNH CỐT LÕI ═══
NGŨ VỊ → HÀNH → TẠNG → MÙA → MÀU:
• Chua → Mộc → Gan/Mật → Xuân → Xanh
• Đắng → Hỏa → Tim/Ruột non → Hạ → Đỏ
• Ngọt (đường tốt: mật mía, mật ong, nước mía) → Thổ → Tỳ/Vị → giao mùa → Vàng
• Cay → Kim → Phổi/Đại tràng → Thu → Trắng
• Mặn (vừa đủ) → Thủy → Thận/Bàng quang → Đông → Đen
• Chát → chống oxy hoá, giữ tươi trẻ (quả sung, chuối xanh, lựu, trà, vang chát)

TƯƠNG SINH: Mộc→Hỏa→Thổ→Kim→Thủy→Mộc (mẹ nuôi con).
TƯƠNG KHẮC: Mộc khắc Thổ, Thổ khắc Thủy, Thủy khắc Hỏa, Hỏa khắc Kim, Kim khắc Mộc.
VỊ QUÁ NHIỀU HẠI TẠNG BỊ KHẮC: cay quá hại Gan, mặn quá hại Tim, chua quá hại Tỳ, đắng quá hại Phổi, ngọt quá hại Thận. Luôn cân bằng — VD dùng vị chua thì thêm chút vị ngọt tốt để không xót bao tử.

HÀN – NHIỆT:
• Thể hàn (tay chân lạnh, sợ lạnh, thích nước ấm, nhịp tim thấp) → ăn món tính ấm/nhiệt, vị cay ấm: gừng, sả, tỏi, tiêu, quế. Tránh đồ sống lạnh.
• Thể nhiệt (nóng trong, sợ nóng, hay khát, nhịp tim/huyết áp cao) → ăn món tính mát/hàn, vị đắng hàn: tim sen, rau má, khổ qua, cháo bổ âm. Hạn chế cay nóng, chiên rán.
• Cay chia 2: cay nhiệt (gừng, tỏi, tiêu, quế — làm ấm) vs cay hàn (bạc hà, húng chanh — mát).
• Đắng chia 2: đắng nhiệt (cà phê, cacao — tăng nhịp tim, hợp huyết áp thấp) vs đắng hàn (tim sen, khổ qua — hạ nhịp tim, hợp huyết áp cao).
• Nhìn màu đoán tính: rau quả màu nhạt phần nhiều hàn/mát; màu thẫm thường ấm/nóng.

NGUYÊN TẮC BỮA ĂN: đủ 5 màu + 5 vị; không đủ cả thì ưu tiên VỊ. Nhai kỹ ("ăn như uống"). Ăn theo mùa — tăng cường vị/màu của Hành ứng với mùa hiện tại.`;

  // PROTOCOL_SOP là HTML — chuyển sang text thuần cho prompt
  function protocolToText(html) {
    return html
      .replace(/<\/(tr|h3|blockquote|table|thead|tbody)>/g, '\n')
      .replace(/<\/(td|th)>/g, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }
  const ASSISTANT_PROTOCOL = `

═══ QUY TRÌNH 1 NGÀY 3 BUỔI (khung giờ chuẩn của chương trình) ═══
${protocolToText(PROTOCOL_SOP)}`;

  // Cổng truy cập: admin, hoặc đã ghi danh challenge, hoặc đã có đơn hàng hoàn tất
  function hasProgramAccess(userId) {
    if (!userId) return false;
    const u = db.get('SELECT is_admin FROM users WHERE id = ?', [userId]);
    if (!u) return false;
    if (u.is_admin) return true;
    const enr = db.get(
      "SELECT 1 FROM challenge_enrollments WHERE user_id = ? AND status IN ('approved','started') LIMIT 1",
      [userId]
    );
    if (enr) return true;
    return !!db.get("SELECT 1 FROM orders WHERE buyer_id = ? AND status = 'completed' LIMIT 1", [userId]);
  }

  // Lượt hỏi Trợ lý theo mức tham gia:
  //   chưa tham gia / mới 3 buổi → assistant_limit_basic (mặc định 5), hết lượt → mời 8 buổi
  //   đã được duyệt 8 buổi       → assistant_limit_w8 (mặc định 7),    hết lượt → mời 377 ngày
  //   đã được duyệt 377 ngày     → assistant_daily_limit (mặc định 30)
  function assistantTier(userId) {
    const setting = (key, def) => {
      const n = parseInt(db.get('SELECT value FROM site_settings WHERE key = ?', [key])?.value, 10);
      return Number.isFinite(n) && n > 0 ? n : def;
    };
    const approved = table => !!db.get(`SELECT 1 FROM ${table} WHERE user_id = ? AND status = 'approved'`, [userId]);
    if (approved('program377_enrollments')) return { tier: 'p377', limit: assistantDailyLimit(), upsell: null };
    if (approved('workshop8_enrollments')) return { tier: 'w8', limit: setting('assistant_limit_w8', 7), upsell: 'p377' };
    return { tier: 'basic', limit: setting('assistant_limit_basic', 5), upsell: 'w8' };
  }
  const ASSISTANT_UPSELL_CTA = {
    w8:   { text: '💎 Xem & đăng ký 8 Buổi Chuyên Sâu', link: 'workshop8.html' },
    p377: { text: '🗓️ Xem & đăng ký 377 ngày thực hành', link: 'program377.html' },
  };

  function assistantEnabled() {
    const row = db.get("SELECT value FROM site_settings WHERE key = 'assistant_enabled'");
    return !row || row.value !== '0';   // mặc định BẬT
  }
  function assistantDailyLimit() {
    const row = db.get("SELECT value FROM site_settings WHERE key = 'assistant_daily_limit'");
    const n = row ? parseInt(row.value, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 30;
  }
  function assistantUsageToday(userId) {
    const today = db.get("SELECT date('now','localtime') AS d").d;
    const row = db.get('SELECT count FROM assistant_usage WHERE user_id = ? AND usage_date = ?', [userId, today]);
    return row ? row.count : 0;
  }
  function bumpAssistantUsage(userId) {
    const today = db.get("SELECT date('now','localtime') AS d").d;
    db.run(
      `INSERT INTO assistant_usage (user_id, usage_date, count) VALUES (?,?,1)
       ON CONFLICT(user_id, usage_date) DO UPDATE SET count = count + 1`,
      [userId, today]
    );
  }

  // Dựng khối kiến thức nền theo từng request
  function buildAssistantContext(userId) {
    const foods = db.all('SELECT name, element, color, taste, nature, organ, note FROM foods ORDER BY element, order_num, name');
    const foodLines = foods.map(f =>
      `- ${f.name} | hành ${f.element || '?'} | màu ${f.color || '?'} | vị ${f.taste || '?'} | tính ${f.nature || '?'} | tạng ${f.organ || '?'}${f.note ? ' — ' + f.note : ''}`
    ).join('\n');

    const recipes = db.all('SELECT title, element_tags, buoi, summary, ingredients, steps, dung_khi, note FROM recipes ORDER BY order_num, id');
    const recipeBlocks = recipes.map(r =>
      `### ${r.title}\n- Hành: ${r.element_tags || '?'} · Buổi: ${r.buoi || 'cả ngày'}\n- Tóm tắt: ${r.summary || ''}\n- Nguyên liệu: ${r.ingredients || ''}\n- Cách làm: ${r.steps || ''}\n- Dùng khi: ${r.dung_khi || ''}${r.note ? '\n- Lưu ý: ' + r.note : ''}`
    ).join('\n\n');

    let personal = '';
    const u = db.get('SELECT intake_profile FROM users WHERE id = ?', [userId]);
    if (u && u.intake_profile) {
      personal += `\n\n═══ HỒ SƠ DƯỠNG SINH CỦA THÀNH VIÊN NÀY ═══\n${u.intake_profile}`;
    }
    const logs = db.all(
      'SELECT log_date, colors, tastes, breakfast, lunch, dinner FROM meal_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 7',
      [userId]
    );
    if (logs.length) {
      const logLines = logs.map(l => {
        let colors = '—', tastes = '—';
        try { colors = (JSON.parse(l.colors || '[]') || []).join(', ') || '—'; } catch {}
        try { tastes = (JSON.parse(l.tastes || '[]') || []).join(', ') || '—'; } catch {}
        return `- ${l.log_date}: màu [${colors}], vị [${tastes}]${l.breakfast ? ' · sáng: ' + l.breakfast : ''}${l.lunch ? ' · trưa: ' + l.lunch : ''}${l.dinner ? ' · tối: ' + l.dinner : ''}`;
      }).join('\n');
      personal += `\n\n═══ NHẬT KÝ ĂN UỐNG 7 NGÀY GẦN NHẤT ═══\n${logLines}`;
    }

    return `\n\n═══ KHO THỰC PHẨM NGŨ HÀNH (${foods.length} món — ưu tiên gợi ý trong danh sách này) ═══\n${foodLines}\n\n═══ THƯ VIỆN CÔNG THỨC (${recipes.length} món) ═══\n${recipeBlocks}${personal}`;
  }

  app.post('/api/assistant/chat', async (req, res) => {
    const { user_id, messages } = req.body;
    if (!user_id || !Array.isArray(messages) || !messages.length)
      return res.status(400).json({ error: 'Thiếu user_id hoặc messages.' });

    const user = db.get('SELECT id, is_admin FROM users WHERE id = ?', [user_id]);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    const isAdmin = !!user.is_admin;

    if (!assistantEnabled() && !isAdmin)
      return res.status(503).json({ error: 'Trợ lý Ngũ Hành đang tạm khoá. Quay lại sau nhé!' });

    // Mọi thành viên đều dùng được; số lượt/ngày tuỳ mức tham gia (xem assistantTier)
    const tier = isAdmin ? { tier: 'admin', limit: Infinity, upsell: null } : assistantTier(user_id);
    const limit = tier.limit;
    if (!isAdmin && assistantUsageToday(user_id) >= limit) {
      const payload = { error: `Bạn đã dùng hết ${limit} lượt hỏi hôm nay. Hẹn gặp lại ngày mai nhé!`, remaining: 0 };
      if (tier.upsell) {
        const md = db.get('SELECT value FROM site_settings WHERE key = ?', [`assistant_upsell_${tier.upsell}`])?.value || '';
        if (md.trim()) payload.upsell = { markdown: md, cta_text: ASSISTANT_UPSELL_CTA[tier.upsell].text, cta_link: ASSISTANT_UPSELL_CTA[tier.upsell].link };
      }
      return res.status(429).json(payload);
    }

    // Giữ 12 lượt gần nhất để giới hạn token; toàn bộ kiến thức nằm ở system prompt
    const convo = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
    if (!convo.length || convo[convo.length - 1].role !== 'user')
      return res.status(400).json({ error: 'Chưa có câu hỏi.' });

    const systemContent = ASSISTANT_SYSTEM + ASSISTANT_RULES + ASSISTANT_PROTOCOL + buildAssistantContext(user_id);

    try {
      const result = await callAiChat({
        messages: [{ role: 'system', content: systemContent }, ...convo],
        maxTokens: 1200,
      });
      if (!result.ok) return res.status(503).json({ error: result.error || 'Trợ lý đang bận, thử lại sau nhé.' });

      const reply = (result.text || '').trim() || 'Mình chưa rõ ý bạn lắm, bạn nói cụ thể hơn được không?';

      if (!isAdmin) bumpAssistantUsage(user_id);
      const lastQ = [...convo].reverse().find(m => m.role === 'user');
      db.run('INSERT INTO assistant_logs (user_id, question, answer) VALUES (?,?,?)',
        [user_id, (lastQ ? lastQ.content : '').slice(0, 2000), reply.slice(0, 4000)]);

      const remaining = isAdmin ? null : Math.max(0, limit - assistantUsageToday(user_id));
      res.json({ reply, remaining });
    } catch (err) {
      console.error('[Assistant] Error:', err.message);
      res.status(500).json({ error: 'Lỗi server. Thử lại sau nhé.' });
    }
  });

  // ── Intake Chat ───────────────────────────────────────────
  const INTAKE_OPENING = `Điều gì đang khiến bạn chưa hài lòng với tình trạng hiện tại? Cứ nói thật, không cần câu trả lời đẹp.`;

  const INTAKE_SYSTEM = `Bạn là người dẫn đường cho "Thử thách 21 ngày AI Agent" — chương trình thực chiến giúp người Việt xây hệ thống kinh doanh số dùng AI, không cần biết code, không cần vốn lớn. Sau 21 ngày, học viên sẽ có: website thật, chatbot bán hàng 24/7, hệ thống thanh toán tự động (Sepay), email marketing (Resend), AI Agent trên VPS, và sản phẩm số đầu tiên đã bán được.

Nhiệm vụ: Trò chuyện tự nhiên để hiểu sâu một người — họ đang ở đâu, muốn đi đâu, cái gì cản họ — rồi tổng hợp thành hồ sơ cá nhân hóa định hướng 21 ngày của họ.

═══ NGUYÊN TẮC BẮT BUỘC ═══
• Mỗi lượt CHỈ hỏi DUY NHẤT 1 câu — tuyệt đối không hỏi 2 câu cùng lúc
• Luôn phản chiếu điều họ vừa chia sẻ trước khi hỏi tiếp — đừng nhảy thẳng vào câu hỏi tiếp
• Giọng điệu: như người bạn thật sự tò mò, không phải form khảo sát hay nhân viên tư vấn
• Câu trả lời mơ hồ/ngắn → đào sâu tại chỗ, chưa chuyển chặng
• Câu trả lời rõ và đủ → gật đầu ngắn gọn + tiếp tục
• Tổng cộng 8–11 lượt hỏi, không nhiều hơn
• Toàn bộ bằng tiếng Việt, xưng "mình/bạn"
• KHÔNG hỏi tên, email, hay thông tin cá nhân

═══ 5 CHẶNG KHÁM PHÁ ═══

CHẶNG 1 — LÝ DO THẬT (1–2 lượt)
Câu mở đầu đã được gửi trước: hỏi về điều khiến họ chưa hài lòng.
Đào sâu: nếu câu trả lời chung chung ("muốn tự do", "muốn kiếm tiền") → hỏi cụ thể hơn cái đó có nghĩa gì với họ.
Mục tiêu: nghe được động lực thật, không phải câu trả lời "đúng".

CHẶNG 2 — HIỆN TẠI (1–2 lượt)
Họ đang làm gì để kiếm sống? Có gì trong tay rồi?
Mục tiêu: biết điểm xuất phát thật — đừng assume.

CHẶNG 3 — SẢN PHẨM / DỊCH VỤ (2–3 lượt)
Họ muốn bán gì / giúp ai / giải quyết vấn đề gì?
KHÔNG chấp nhận câu trả lời mơ hồ như "tôi muốn bán khóa học" — phải biết khóa học về gì, giúp ai làm được gì cụ thể.
Mục tiêu: sản phẩm/dịch vụ đủ cụ thể để ngày 2 viết được landing page thật cho chính họ.

CHẶNG 4 — KHÁCH HÀNG (1–2 lượt)
Ai là người họ muốn phục vụ? Yêu cầu tả như tả một người thật, không phải "target audience" chung chung.
Mục tiêu: chân dung khách hàng đủ sống động để sau này viết chatbot, email, bài đăng cho họ.

CHẶNG 5 — KẾT QUẢ & FIT CHECK (2–3 lượt)
a) "Sau 21 ngày, nếu bạn nói 'mình thắng rồi' — bạn đang thấy gì cụ thể?" → con số hoặc trạng thái
b) "Bạn có thứ gì có thể đóng gói thành file/link để người khác tải về dùng ngay không?" → nguyên liệu ngày 19
c) "Mỗi ngày thực tế bạn có mấy tiếng cho thử thách?" → điều chỉnh kỳ vọng tuần 3

═══ KỸ THUẬT PHẢN CHIẾU ═══
Họ nói: "Tôi muốn kiếm thêm thu nhập"
✗ SAI: hỏi ngay câu tiếp
✓ ĐÚNG: "Nghe có vẻ bạn đang có nguồn thu rồi nhưng nó chưa đủ hoặc chưa ổn định. Cái 'thêm' đó với bạn — bao nhiêu thì bạn thấy thật sự khác?"

Họ nói: "Tôi muốn tự do"
✓ ĐÚNG: "Tự do theo nghĩa gì với bạn — không phải đi làm thuê nữa, không bị ràng buộc lịch của người khác, hay điều gì khác?"

═══ KHI ĐỦ THÔNG TIN ═══
Sau khi có đủ thông tin 5 chặng:
1. Viết 2–3 câu nhận xét chân thật (không quá hoa mỹ) về người này và tiềm năng 21 ngày với họ
2. Ngay sau đó xuất markdown profile theo đúng format dưới đây, bắt đầu bằng ===PROFILE_START=== và kết thúc bằng ===PROFILE_END===

===PROFILE_START===
# Hồ Sơ Cá Nhân — Thành viên
*Tạo: [ngày/tháng/năm hôm nay]*

## Điểm xuất phát
[1–2 câu về họ đang đứng ở đâu — công việc, tình trạng, điểm mạnh mang vào]

## Sản phẩm / Dịch vụ
**Tên:** [tên cụ thể — không chung chung]
**Mô tả:** [giúp ai, giải quyết vấn đề gì, kết quả gì]
**Trạng thái:** [Chưa có / Có ý tưởng / Đang làm nhưng chưa bán / Đang bán rồi]

## Khách hàng mục tiêu
[Tả như một người thật — tuổi, nghề, vấn đề cụ thể đang gặp, điều họ muốn]

## Mục tiêu 21 ngày
**Kết quả cụ thể:** [con số hoặc trạng thái họ tự định nghĩa là "thắng"]

## Sản phẩm số ngày 19
[Tên sản phẩm số cụ thể phù hợp với kiến thức/kỹ năng của họ — ebook, template, SOP pack, prompt pack, mini guide... Đặt tên thật, gợi ý giá bằng VNĐ]

## Lộ trình cá nhân hóa
- **Ngày 2–3:** Landing page bán [sản phẩm/dịch vụ cụ thể] cho [khách hàng cụ thể]
- **Ngày 5:** Brand voice trong brain.db: [tone/phong cách cụ thể phù hợp khách hàng của họ]
- **Ngày 9:** Chatbot trả lời "[câu hỏi thật 1 của khách]", "[câu hỏi 2]", "[câu hỏi 3]"
- **Ngày 10–11:** Email sequence: [hành trình cụ thể từ lead → mua của khách họ]
- **Ngày 19:** Tạo và bán [tên sản phẩm số] — giá gợi ý: [X]đ
- **Ngày 20:** Business plan: [mô hình kinh doanh cụ thể của họ]

## Lưu ý riêng
[Điều cần chú ý dựa trên thời gian/kỹ năng/loại sản phẩm. Thẳng thắn nếu cần.]

## Câu hỏi còn mở
[Những thứ cần quyết định trước ngày 1. Nếu không có → bỏ section này]
===PROFILE_END===`;

  app.post('/api/intake/chat', async (req, res) => {
    const { messages } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    // First load — return opening message without calling AI
    if (messages.length === 0) {
      return res.json({ reply: INTAKE_OPENING, isComplete: false, profile: null });
    }

    // Prepend opening message so AI knows the full context
    const fullMessages = [
      { role: 'system', content: INTAKE_SYSTEM },
      { role: 'assistant', content: INTAKE_OPENING },
      ...messages
    ];

    // Safety net: after ~8 user turns, force the AI to wrap up and emit the profile block
    const userTurns = messages.filter(m => m.role === 'user').length;
    const alreadyHasProfile = messages.some(m => m.role === 'assistant' && String(m.content || '').includes('===PROFILE_START==='));
    const todayVi = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (userTurns >= 8 && !alreadyHasProfile) {
      fullMessages.push({
        role: 'system',
        content: `Đã đủ thông tin để tổng hợp. Ở LƯỢT NÀY: viết 2–3 câu nhận xét ngắn về tình hình và mục tiêu của họ, rồi NGAY SAU ĐÓ xuất hồ sơ đầy đủ theo đúng format, bắt đầu bằng ===PROFILE_START=== và kết thúc bằng ===PROFILE_END===. Dòng ngày tạo ghi đúng: *Tạo: ${todayVi}*. KHÔNG hỏi thêm câu nào nữa.`,
      });
    }

    try {
      const result = await callAiChat({ messages: fullMessages, maxTokens: 1500 });
      if (!result.ok) return res.status(503).json({ error: result.error });

      const raw = result.text;

      const profileStart = raw.indexOf('===PROFILE_START===');
      const profileEnd   = raw.indexOf('===PROFILE_END===');
      const isComplete   = profileStart !== -1 && profileEnd !== -1;

      let reply   = raw;
      let profile = null;

      if (isComplete) {
        reply   = raw.slice(0, profileStart).trim();
        profile = raw.slice(profileStart + '===PROFILE_START==='.length, profileEnd).trim();
        // the model doesn't know the real date — fix the "*Tạo: …*" line
        profile = profile.replace(/^\*Tạo:.*\*$/m, `*Tạo: ${todayVi}*`);
      }

      res.json({ reply, isComplete, profile });
    } catch (err) {
      console.error('[Intake] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/intake/save', (req, res) => {
    const { userId, profile } = req.body;
    if (!userId || !profile) return res.status(400).json({ error: 'userId and profile required' });

    const user = db.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    db.run(
      "UPDATE users SET intake_profile = ?, intake_done_at = datetime('now','localtime') WHERE id = ?",
      [profile.trim(), userId]
    );
    console.log(`[Intake] Saved profile for user ${userId}`);
    res.json({ ok: true });
  });

  app.get('/api/intake/profile/:userId', (req, res) => {
    const user = db.get(
      'SELECT id, first_name, last_name, intake_profile, intake_done_at FROM users WHERE id = ?',
      [req.params.userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      userId: user.id,
      name: `${user.first_name} ${user.last_name}`.trim(),
      profile: user.intake_profile || null,
      doneAt: user.intake_done_at || null
    });
  });

  // Removes the "⚠️ Bản nháp — chờ duyệt" banner (and any leading blank line
  // after it) that Agent 1 always prepends to drafts. Only meaningful during
  // admin review — must never reach the customer-facing final content, even
  // if the admin approved without manually editing the draft.
  function stripDraftBanner(text) {
    return (text || '').replace(/^\s*⚠️[^\n]*\n+/, '').trim();
  }

  // ── Thông báo Telegram cho luồng lộ trình An Lộ ─────────────────
  const tgEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // An Lộ soạn xong (hoặc lỗi) bản nháp → báo admin + người được quyền "xem & duyệt lộ trình"
  // (đã kết nối Telegram). Fire-and-forget, lỗi chỉ ghi log.
  // Chia văn bản dài thành các đoạn ≤ max ký tự, ưu tiên cắt ở chỗ xuống dòng đôi, rồi xuống dòng, rồi khoảng trắng.
  function splitTelegramText(text, max) {
    const out = [];
    let rest = String(text || '').trim();
    while (rest.length > max) {
      let cut = rest.lastIndexOf('\n\n', max);
      if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
      if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
      if (cut < max * 0.5) cut = max;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  async function notifyRoadmapDraftReady(roadmapId) {
    try {
      const r = db.get(
        `SELECT r.id, r.the_trang, r.draft_content, u.first_name, u.last_name
         FROM ttm_roadmaps r JOIN users u ON u.id = r.user_id WHERE r.id = ?`, [roadmapId]);
      if (!r) return;
      const name = tgEsc(`${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Thành viên');
      const failed = String(r.draft_content || '').startsWith('[Lỗi tạo bản nháp');
      const reviewers = db.all(
        `SELECT id, telegram_chat_id, antam_chat_id FROM users
         WHERE (is_admin = 1 OR agent1_reviewer = 1) AND COALESCE(agent1_notify_off, 0) = 0 AND status = 'active'`);

      // 1) Ai đã kết nối bot An Tâm → tin có nút Duyệt / Trả lại / Mở để sửa (duyệt ngay trên Telegram)
      const viaAntam = antamToken() ? reviewers.filter(u => u.antam_chat_id) : [];
      if (viaAntam.length) {
        // Toàn bộ bản nháp, bỏ ký hiệu Markdown cho dễ đọc. Telegram giới hạn ~4000 ký tự/tin nên chia
        // thành nhiều tin (1/N, 2/N…); tin cuối cùng mới có nút Duyệt / Trả lại để đọc hết rồi bấm.
        const plain = stripDraftBanner(r.draft_content)
          .split('\n')
          .filter(line => !/^\s*\|?[\s:|-]+\|\s*$/.test(line))            // bỏ dòng kẻ của bảng |---|---|
          .map(line => /^\s*\|.*\|\s*$/.test(line)                        // dòng bảng → "• ô1 — ô2 — ô3"
            ? '• ' + line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(Boolean).join(' — ')
            : line)
          .join('\n')
          .replace(/^#{1,6}\s*/gm, '').replace(/[*`>]/g, '').replace(/\n{3,}/g, '\n\n').trim();
        const parts = failed ? [] : splitTelegramText(plain, 3300);
        const header = `🧭 <b>An Lộ đã soạn xong lộ trình — chờ duyệt</b>\nThành viên: <b>${name}</b>\nThể trạng: <b>${tgEsc(r.the_trang || 'chưa xác định')}</b>`;
        for (const u of viaAntam) {
          for (let i = 0; i < parts.length; i++) {
            const label = parts.length > 1 ? ` (${i + 1}/${parts.length})` : '';
            const sent = await antamApi('sendMessage', {
              chat_id: u.antam_chat_id, parse_mode: 'HTML', disable_web_page_preview: true,
              text: (i === 0 ? `${header}\n\n<i>Bản nháp đầy đủ${label}:</i>\n` : `<i>Bản nháp${label}:</i>\n`) + tgEsc(parts[i]),
            });
            if (!sent.ok) { console.error(`[An Tâm] gửi bản nháp roadmap #${roadmapId} phần ${i + 1} thất bại:`, sent.description || ''); break; }
          }
        }
        const text = failed
          ? `⚠️ <b>An Lộ chưa soạn được lộ trình</b>\nThành viên: <b>${name}</b>\nMở trang duyệt và bấm "Tạo lại bản nháp".`
          : `🧭 <b>Duyệt lộ trình của ${name}?</b>\n👆 Bản nháp đầy đủ ở ${parts.length > 1 ? `${parts.length} tin` : 'tin'} phía trên. Bấm nút bên dưới để duyệt hoặc trả lại.`;
        await antamNotify('roadmap', roadmapId, text, !failed, {
          recipients: viaAntam.map(u => ({ antam_chat_id: u.antam_chat_id, canApprove: true })),
          linkButton: { text: '📝 Mở trên web để sửa', url: `${SITE_URL}/admin.html` },
        });
      }

      // 2) Ai chưa kết nối An Tâm nhưng đã kết nối bot An Nhiên → tin có link như trước
      const viaAnNhien = reviewers.filter(u => !(viaAntam.length && u.antam_chat_id) && u.telegram_chat_id);
      const linkText = failed
        ? `⚠️ <b>An Lộ chưa soạn được lộ trình</b>\nThành viên: ${name}\nVào trang duyệt và bấm "Tạo lại bản nháp".\n\n${SITE_URL}/admin.html`
        : `🧭 <b>An Lộ đã soạn xong lộ trình — chờ duyệt</b>\nThành viên: ${name}\nThể trạng: ${tgEsc(r.the_trang || 'chưa xác định')}\n\nXem &amp; duyệt: ${SITE_URL}/admin.html`;
      for (const c of viaAnNhien) {
        const sent = await sendTelegramMessage(c.telegram_chat_id, linkText);
        if (!sent.ok) console.error(`[TTM] Báo Telegram roadmap #${roadmapId} thất bại:`, sent.error || sent.description || '');
      }
      if (!viaAntam.length && !viaAnNhien.length) console.log(`[TTM] Roadmap #${roadmapId}: chưa có admin/người duyệt nào kết nối Telegram để báo.`);
    } catch (err) { console.error('[TTM] notifyRoadmapDraftReady:', err.message); }
  }

  // Lộ trình được duyệt → báo thành viên: thông báo trong app + đẩy lên điện thoại + Telegram (nếu đã kết nối)
  async function notifyRoadmapApproved(roadmapId) {
    try {
      const r = db.get(
        `SELECT r.user_id, u.first_name, u.telegram_chat_id
         FROM ttm_roadmaps r JOIN users u ON u.id = r.user_id WHERE r.id = ?`, [roadmapId]);
      if (!r) return;
      const title = 'Lộ trình của bạn đã được duyệt 🎉';
      const content = 'Ban tổ chức đã duyệt lộ trình ăn uống cá nhân của bạn. Bấm để xem lộ trình.';
      db.run('INSERT INTO notifications (user_id, type, title, content, link, sent_by_admin) VALUES (?,?,?,?,?,1)',
        [r.user_id, 'course', title, content, 'lo-trinh.html']);
      pushNotify(r.user_id, { title, body: content, link: 'lo-trinh.html' });
      if (r.telegram_chat_id) {
        const sent = await sendTelegramMessage(r.telegram_chat_id,
          `✅ <b>Lộ trình của bạn đã được duyệt!</b>\n\nChào ${tgEsc(r.first_name || 'bạn')}, Ban tổ chức ${tgEsc(communityName())} đã duyệt lộ trình ăn uống cá nhân của bạn.\n\nXem lộ trình: ${SITE_URL}/lo-trinh.html`);
        if (!sent.ok) console.error(`[TTM] Báo Telegram duyệt lộ trình #${roadmapId} thất bại:`, sent.error || sent.description || '');
      }
    } catch (err) { console.error('[TTM] notifyRoadmapApproved:', err.message); }
  }

  // ── Thân-Tâm-Mệnh intake → Agent 1 (GoClaw) → duyệt Admin ────
  app.post('/api/ttm/intake/save', async (req, res) => {
    const { userId, answers, summaryText } = req.body;
    if (!userId || !answers || !summaryText) {
      return res.status(400).json({ error: 'userId, answers, summaryText required' });
    }

    const user = db.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const intakeId = db.run(
      'INSERT INTO ttm_intake_responses (user_id, answers_json, summary_text) VALUES (?, ?, ?)',
      [userId, JSON.stringify(answers), summaryText]
    ).lastInsertRowid;

    db.run("UPDATE users SET ttm_intake_done_at = datetime('now','localtime') WHERE id = ?", [userId]);

    // GoClaw's own sync-webhook cutoff has been observed to run well past our
    // client-side timeout on long surveys (large input, comprehensive roadmap
    // output) — the agent still finishes and shows up fine in the GoClaw
    // dashboard, but our request had already aborted, so the draft was saved
    // as a permanent error placeholder instead of the real content. Respond
    // to the customer immediately (don't make them sit on the intake-submit
    // screen for 30-90s) and fill in the real draft asynchronously once
    // GoClaw actually replies, same fire-and-forget pattern as
    // runAgent2Coaching/runProgram377Coaching.
    const roadmapId = db.run(
      'INSERT INTO ttm_roadmaps (user_id, intake_id, draft_content, status, the_trang) VALUES (?, ?, ?, ?, ?)',
      [userId, intakeId, '⏳ Đang tạo bản nháp tự động, vui lòng đợi khoảng 1 phút rồi bấm "Làm mới" hoặc "Tạo lại bản nháp".', 'pending_approval', null]
    ).lastInsertRowid;

    console.log(`[TTM] Intake saved for user ${userId}, roadmap #${roadmapId} pending_approval — generating draft in background`);
    res.json({ ok: true, intakeId, roadmapId });

    callGoclawAgent1(summaryText).then((agentResult) => {
      let draftContent, theTrang = null, priorityMapJson = null;
      if (agentResult.ok) {
        const parsed = parseAgent1Response(agentResult.text);
        draftContent = parsed.content;
        theTrang = parsed.theTrang;
        priorityMapJson = parsed.priorityMap ? JSON.stringify(parsed.priorityMap) : null;
      } else {
        draftContent = `[Lỗi tạo bản nháp tự động: ${agentResult.error}]\n\nVui lòng bấm "Tạo lại bản nháp" trong Admin, hoặc soạn thủ công dựa trên bản tổng kết bên dưới.`;
        console.error(`[TTM] Agent 1 call failed for user ${userId}:`, agentResult.error);
      }
      db.run('UPDATE ttm_roadmaps SET draft_content = ?, the_trang = ?, priority_map_json = ? WHERE id = ?', [draftContent, theTrang, priorityMapJson, roadmapId]);
      notifyRoadmapDraftReady(roadmapId);
    });
  });

  // Admin: regenerate a draft (e.g. after fixing GOCLAW_WEBHOOK_* config)
  app.post('/api/admin/ttm/roadmaps/:id/regenerate', requireRoadmapReviewer, async (req, res) => {
    const roadmap = db.get('SELECT r.*, i.summary_text FROM ttm_roadmaps r JOIN ttm_intake_responses i ON i.id = r.intake_id WHERE r.id = ?', [req.params.id]);
    if (!roadmap) return res.status(404).json({ error: 'Roadmap not found' });

    const agentResult = await callGoclawAgent1(roadmap.summary_text);
    if (!agentResult.ok) return res.status(502).json({ error: agentResult.error });

    const parsed = parseAgent1Response(agentResult.text);
    const priorityMapJson = parsed.priorityMap ? JSON.stringify(parsed.priorityMap) : null;
    db.run('UPDATE ttm_roadmaps SET draft_content = ?, the_trang = ?, priority_map_json = ? WHERE id = ?', [parsed.content, parsed.theTrang, priorityMapJson, req.params.id]);
    res.json({ ok: true, theTrang: parsed.theTrang, priorityMap: parsed.priorityMap });
  });

  // Khách xem lộ trình đã được Người hướng dẫn duyệt (mới nhất)
  app.get('/api/ttm/roadmap/:userId', (req, res) => {
    const roadmap = db.get(
      `SELECT r.id, r.draft_content, r.final_content, r.status, r.reviewed_at, r.created_at, r.the_trang,
              u.first_name AS reviewer_first_name, u.last_name AS reviewer_last_name
       FROM ttm_roadmaps r LEFT JOIN users u ON u.id = r.reviewed_by
       WHERE r.user_id = ? AND r.status = 'approved'
       ORDER BY r.reviewed_at DESC LIMIT 1`,
      [req.params.userId]
    );
    if (!roadmap) return res.json({ roadmap: null });
    res.json({
      roadmap: {
        id: roadmap.id,
        content: stripDraftBanner(roadmap.final_content || roadmap.draft_content),
        reviewedAt: roadmap.reviewed_at,
        createdAt: roadmap.created_at,
        reviewedByName: roadmap.reviewer_first_name ? `${roadmap.reviewer_first_name} ${roadmap.reviewer_last_name || ''}`.trim() : null,
        theTrang: roadmap.the_trang || null,
      }
    });
  });

  // Khách xem lại hồ sơ khảo sát Thân-Tâm-Mệnh của chính mình (mới nhất)
  app.get('/api/ttm/intake/:userId', (req, res) => {
    const intake = db.get(
      `SELECT id, summary_text, submitted_at FROM ttm_intake_responses
       WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1`,
      [req.params.userId]
    );
    if (!intake) return res.json({ intake: null });
    res.json({
      intake: {
        id: intake.id,
        summaryText: intake.summary_text,
        submittedAt: intake.submitted_at,
      }
    });
  });

  // Nguồn sự thật cho cờ "đã làm intake chưa" — feed.html gọi endpoint này
  // thay vì chỉ tin vào localStorage (có thể lệch do cache cũ/nhiều tab).
  app.get('/api/ttm/intake-status/:userId', (req, res) => {
    const user = db.get('SELECT ttm_intake_done_at FROM users WHERE id = ?', [req.params.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ done: !!user.ttm_intake_done_at, doneAt: user.ttm_intake_done_at || null });
  });

  // Khách xem hồ sơ ảnh (3 ảnh dáng người + video kiểm tra ngồi-đứng) của chính mình
  app.get('/api/ttm/photos/:userId', (req, res) => {
    const row = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [req.params.userId]);
    if (!row) return res.json({ photos: null });
    res.json({ photos: photosOut(row) });
  });

  // Khách upload/thay hồ sơ ảnh — multipart/form-data, field: front/back/side/video (mỗi field optional,
  // chỉ field nào gửi lên mới được cập nhật, các field khác giữ nguyên giá trị cũ).
  // File được lưu tạm trên đĩa, đẩy lên thư mục Drive riêng của user, rồi xoá bản tạm — không giữ file
  // lâu dài trên VPS.
  app.post('/api/ttm/photos/:userId', (req, res) => {
    ttmPhotoUpload.fields([
      { name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 },
      { name: 'side', maxCount: 1 }, { name: 'video', maxCount: 1 },
    ])(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload thất bại.' });

      const userId = req.params.userId;
      const tmpFiles = ['front', 'back', 'side', 'video']
        .map(f => req.files?.[f]?.[0]).filter(Boolean);
      const cleanupTmp = () => tmpFiles.forEach(f => fs.unlink(f.path, () => {}));
      const DRIVE_FILE_NAME = { front: 'Anh-mat-truoc', back: 'Anh-mat-sau', side: 'Anh-chup-ngang', video: 'Video-ngoi-dung' };

      try {
        const user = db.get('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) { cleanupTmp(); return res.status(404).json({ error: 'User not found' }); }

        const existing = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [userId]);
        if (tmpFiles.length) {
          const drive = getDriveClient();
          const folderId = await ensureUserDriveFolder(drive, userId);

          for (const field of ['front', 'back', 'side', 'video']) {
            const file = req.files?.[field]?.[0];
            if (!file) continue;
            const ext = path.extname(file.originalname || '') || (field === 'video' ? '.mp4' : '.jpg');
            const { displayUrl } = await uploadToUserDrive(
              drive, file.path, `${DRIVE_FILE_NAME[field]}${ext}`, file.mimetype, folderId, field === 'video', false
            );
            const oldUrl = existing?.[`${field}_url`];
            if (oldUrl) deleteDriveFileByUrl(drive, oldUrl).catch(() => {});
            db.run(
              `INSERT INTO ttm_body_photos (user_id, ${field}_url) VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET ${field}_url = excluded.${field}_url, updated_at = datetime('now','localtime')`,
              [userId, displayUrl]
            );
          }
        }

        cleanupTmp();
        const row = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [userId]);
        res.json({ ok: true, photos: photosOut(row) });
      } catch (e) {
        cleanupTmp();
        console.error('[TTM] Drive upload failed:', e.message);
        res.status(502).json({ error: 'Tải lên Google Drive thất bại: ' + e.message });
      }
    });
  });

  // ── Google Drive OAuth (kết nối 1 lần qua Admin > Cài đặt > Google Drive) ──
  app.get('/api/admin/drive-oauth/status', requireAdmin, (req, res) => {
    const refreshToken = db.get("SELECT value FROM admin_secrets WHERE key = 'google_drive_refresh_token'")?.value;
    const email = db.get("SELECT value FROM admin_secrets WHERE key = 'google_drive_email'")?.value;
    const connectedAt = db.get("SELECT value FROM admin_secrets WHERE key = 'google_drive_connected_at'")?.value;
    res.json({ connected: !!refreshToken, email: email || null, connectedAt: connectedAt || null });
  });

  app.get('/api/admin/drive-oauth/start', (req, res) => {
    // Mã quản trị chung hoặc phiên đăng nhập của tài khoản admin
    const dk = String(req.query.key || ''), ds = dk && dk !== ADMIN_KEY ? adminSessionUser(dk) : null;
    if (dk !== ADMIN_KEY && !(ds && ds.is_admin && ds.status === 'active')) return res.status(401).send('Unauthorized');
    try {
      const oauth2Client = newDriveOAuthClient();
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // luôn hỏi lại để chắc chắn nhận được refresh_token (lần sau Google có thể không trả lại)
        scope: GOOGLE_DRIVE_SCOPES,
      });
      res.redirect(url);
    } catch (e) {
      res.status(500).send('Lỗi cấu hình OAuth: ' + e.message);
    }
  });

  app.get('/api/admin/drive-oauth/callback', async (req, res) => {
    try {
      if (req.query.error) throw new Error(req.query.error);
      const oauth2Client = newDriveOAuthClient();
      const { tokens } = await oauth2Client.getToken(req.query.code);
      if (!tokens.refresh_token) {
        throw new Error('Không nhận được refresh_token. Vào myaccount.google.com/permissions gỡ quyền truy cập cũ của app này rồi thử kết nối lại.');
      }
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const me = await oauth2.userinfo.get();

      const upsertSecret = (key, value) => db.run(
        `INSERT INTO admin_secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value]
      );
      upsertSecret('google_drive_refresh_token', tokens.refresh_token);
      upsertSecret('google_drive_email', me.data.email || '');
      upsertSecret('google_drive_connected_at', new Date().toISOString());

      res.send('<h2>✅ Đã kết nối Google Drive thành công!</h2><p>Tài khoản: ' + (me.data.email || '') + '</p><p>Bạn có thể đóng tab này.</p>');
    } catch (e) {
      res.status(500).send('<h3>❌ Lỗi kết nối Google Drive</h3><p>' + (e.message || 'Unknown error') + '</p>');
    }
  });

  // Admin: xem hồ sơ ảnh của 1 học viên (dùng trong modal duyệt lộ trình)
  app.get('/api/admin/ttm/photos/:userId', requireRoadmapReviewer, (req, res) => {
    const row = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [req.params.userId]);
    if (!row) return res.json({ photos: null });
    res.json({ photos: photosOut(row) });
  });

  // Admin: hồ sơ 360° của 1 thành viên — dùng cho trang "Profile thành viên"
  // (Lộ trình: khảo sát/ảnh/lộ trình · Học tập: theo space group · Nhật ký ăn uống · Cộng đồng: bài viết/bình luận)
  app.get('/api/admin/member-profile/:userId', requireAdmin, (req, res) => {
    const userId = req.params.userId;
    const user = db.get(
      `SELECT id, first_name, last_name, email, phone, avatar_url, level, xp, streak, status,
              is_admin, created_at, last_active_at, ttm_intake_done_at, agent2_alert_recipient, COALESCE(agent2_notify_off, 0) AS agent2_notify_off, timezone,
              (CASE WHEN telegram_chat_id IS NOT NULL AND telegram_chat_id != '' THEN 1 ELSE 0 END) AS telegram_linked
       FROM users WHERE id = ?`, [userId]
    );
    if (!user) return res.status(404).json({ error: 'Không tìm thấy thành viên.' });

    const intake = db.get(
      'SELECT summary_text, submitted_at FROM ttm_intake_responses WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
      [userId]
    );
    const photoRow = db.get('SELECT * FROM ttm_body_photos WHERE user_id = ?', [userId]);
    const roadmapRow = db.get(
      `SELECT r.*, u.first_name AS reviewer_first_name, u.last_name AS reviewer_last_name
       FROM ttm_roadmaps r LEFT JOIN users u ON u.id = r.reviewed_by
       WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 1`,
      [userId]
    );

    const groups = db.all('SELECT id, name FROM space_groups ORDER BY order_num ASC, id ASC').map(g => {
      const spaces = db.all('SELECT id, name FROM spaces WHERE group_id = ? ORDER BY id ASC', [g.id]).map(s => {
        const membership = db.get('SELECT status FROM space_members WHERE space_id = ? AND user_id = ?', [s.id, userId]);
        const courses = db.all('SELECT id, title FROM courses WHERE space_id = ? ORDER BY order_num ASC, id ASC', [s.id]).map(c => {
          const totalLessons = db.get("SELECT COUNT(*) AS n FROM course_lessons WHERE course_id = ? AND status = 'published'", [c.id]).n;
          const passedLessons = db.get(
            'SELECT COUNT(*) AS n FROM lesson_exercise_submissions WHERE course_id = ? AND user_id = ? AND passed = 1',
            [c.id, userId]
          ).n;
          const enroll = db.get('SELECT status FROM course_enrollments WHERE course_id = ? AND user_id = ?', [c.id, userId]);
          return { id: c.id, title: c.title, enrollStatus: enroll?.status || null, totalLessons, passedLessons };
        });
        return { id: s.id, name: s.name, memberStatus: membership?.status || null, courses };
      });
      return { id: g.id, name: g.name, spaces };
    });

    const posts = db.all(
      `SELECT p.id, p.title, p.content, p.pillar, p.post_type, p.likes_count, p.comments_count, p.created_at, p.space_id, sp.name AS space_name, sp.icon AS space_icon
       FROM posts p LEFT JOIN spaces sp ON sp.id = p.space_id WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 200`,
      [userId]
    );
    const comments = db.all(
      `SELECT c.id, c.content, c.created_at, c.post_id,
              p.title AS post_title, p.content AS post_content, p.pillar AS post_pillar,
              p.post_type AS post_post_type, p.likes_count AS post_likes_count,
              p.comments_count AS post_comments_count, p.created_at AS post_created_at
       FROM comments c JOIN posts p ON p.id = c.post_id
       WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 50`,
      [userId]
    );

    const aiIntakeRow = db.get('SELECT intake_profile, intake_done_at FROM users WHERE id = ?', [userId]);
    const challenges = db.all(
      `SELECT c.id, c.title, c.cover_color AS color, e.status, e.enrolled_at, e.started_at,
              (SELECT COUNT(*) FROM challenge_days d WHERE d.challenge_id = c.id) AS total_days,
              (SELECT COUNT(*) FROM challenge_submissions s WHERE s.challenge_id = c.id AND s.user_id = e.user_id AND s.status = 'approved') AS approved_days,
              (SELECT COUNT(*) FROM challenge_submissions s WHERE s.challenge_id = c.id AND s.user_id = e.user_id AND s.status = 'pending') AS pending_days,
              (SELECT COUNT(*) FROM challenge_submissions s WHERE s.challenge_id = c.id AND s.user_id = e.user_id AND s.is_late = 1) AS late_days
       FROM challenge_enrollments e JOIN challenges c ON c.id = e.challenge_id
       WHERE e.user_id = ? ORDER BY e.enrolled_at DESC`, [userId]
    ).map(c => ({
      ...c,
      submissions: db.all(
        `SELECT s.id, s.content, s.status, s.admin_note, s.submitted_at, s.is_late, d.day_number, d.title AS day_title
         FROM challenge_submissions s JOIN challenge_days d ON d.id = s.day_id
         WHERE s.challenge_id = ? AND s.user_id = ? ORDER BY d.day_number ASC`, [c.id, userId]),
    }));
    const orders = db.all(
      `SELECT o.id, o.amount, o.status, o.payment_method, o.created_at, p.title AS product_title
       FROM orders o LEFT JOIN products p ON p.id = o.product_id
       WHERE o.buyer_id = ? ORDER BY o.created_at DESC LIMIT 100`, [userId]);

    const p377Enrollment = db.get('SELECT * FROM program377_enrollments WHERE user_id = ?', [userId]);
    const p377Reports = db.all(
      'SELECT * FROM program377_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT 100',
      [userId]
    ).map(r => ({ ...r, meal_colors: JSON.parse(r.meal_colors || '[]'), meal_tastes: JSON.parse(r.meal_tastes || '[]') }));

    res.json({
      user: {
        id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email,
        phone: user.phone, avatarUrl: user.avatar_url, level: user.level, xp: user.xp, streak: user.streak,
        status: user.status, isAdmin: !!user.is_admin, createdAt: user.created_at,
        lastActiveAt: user.last_active_at, ttmIntakeDoneAt: user.ttm_intake_done_at, timezone: user.timezone || '',
        alertRecipient: !!user.agent2_alert_recipient, alertNotifyOff: !!user.agent2_notify_off, telegramLinked: !!user.telegram_linked,
      },
      ttm: {
        intake: intake ? { summaryText: intake.summary_text, submittedAt: intake.submitted_at } : null,
        photos: photosOut(photoRow),
        roadmap: roadmapRow ? {
          content: stripDraftBanner(roadmapRow.final_content || roadmapRow.draft_content),
          status: roadmapRow.status, adminNote: roadmapRow.admin_note,
          reviewedAt: roadmapRow.reviewed_at, createdAt: roadmapRow.created_at,
          reviewedByName: roadmapRow.reviewer_first_name ? `${roadmapRow.reviewer_first_name} ${roadmapRow.reviewer_last_name || ''}`.trim() : null,
          theTrang: roadmapRow.the_trang || null,
        } : null,
      },
      learning: { groups },
      community: { posts, comments },
      program377: {
        enrollment: p377Enrollment ? {
          status: p377Enrollment.status,
          startDate: p377Enrollment.start_date,
          adminNote: p377Enrollment.admin_note,
          dayNumberToday: p377Enrollment.status === 'approved'
            ? Math.min(program377DayNumberToday(p377Enrollment.start_date), 377)
            : 0,
        } : null,
        reports: p377Reports,
      },
      // AI AGENTS CC: hồ sơ khảo sát AI Agent (intake.html), thử thách và đơn hàng của thành viên
      aiIntake: aiIntakeRow && aiIntakeRow.intake_profile
        ? { profile: aiIntakeRow.intake_profile, doneAt: aiIntakeRow.intake_done_at } : null,
      challenges,
      orders,
    });
  });

  // Admin: danh sách lộ trình theo trạng thái (mặc định pending_approval)
  app.get('/api/admin/ttm/roadmaps', requireRoadmapReviewer, (req, res) => {
    const status = req.query.status || 'pending_approval';
    const rows = db.all(
      `SELECT r.id, r.user_id, r.intake_id, r.draft_content, r.status, r.admin_note,
              r.final_content, r.reviewed_at, r.created_at, r.the_trang, r.priority_map_json,
              u.first_name, u.last_name, u.email,
              i.summary_text, i.submitted_at
       FROM ttm_roadmaps r
       JOIN users u ON u.id = r.user_id
       JOIN ttm_intake_responses i ON i.id = r.intake_id
       WHERE r.status = ?
       ORDER BY r.created_at DESC`,
      [status]
    );
    res.json({
      roadmaps: rows.map(r => ({
        id: r.id,
        userId: r.user_id,
        userName: `${r.first_name} ${r.last_name}`.trim(),
        userEmail: r.email,
        draftContent: r.draft_content,
        finalContent: r.final_content,
        status: r.status,
        adminNote: r.admin_note,
        summaryText: r.summary_text,
        submittedAt: r.submitted_at,
        reviewedAt: r.reviewed_at,
        createdAt: r.created_at,
        theTrang: r.the_trang || null,
        priorityMap: (() => { try { return JSON.parse(r.priority_map_json || 'null'); } catch (e) { return null; } })(),
      })),
      pending_count: db.get(
        `SELECT COUNT(*) AS n FROM ttm_roadmaps r JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending_approval'`
      ).n,
    });
  });

  // Admin: duyệt / từ chối 1 lộ trình
  app.patch('/api/admin/ttm/roadmaps/:id', requireRoadmapReviewer, (req, res) => {
    const { action, final_content, admin_note, the_trang } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action phải là approve hoặc reject' });
    }
    const roadmap = db.get('SELECT id, status FROM ttm_roadmaps WHERE id = ?', [req.params.id]);
    if (!roadmap) return res.status(404).json({ error: 'Roadmap not found' });
    const theTrang = THE_TRANG_VALUES.includes(the_trang) ? the_trang : null;

    if (action === 'approve') {
      const cleaned = stripDraftBanner((final_content || '').trim());
      db.run(
        "UPDATE ttm_roadmaps SET status = 'approved', final_content = ?, admin_note = ?, the_trang = ?, reviewed_at = datetime('now','localtime'), reviewed_by = ? WHERE id = ?",
        [cleaned || null, admin_note || null, theTrang, req.adminUserId || null, req.params.id]
      );
      if (roadmap.status !== 'approved') notifyRoadmapApproved(req.params.id);   // sửa lại bản đã duyệt thì không báo lần nữa
      antamResolve('roadmap', req.params.id, 'approved', req.adminUserId);        // cập nhật tin Telegram An Tâm (nếu có)
    } else {
      db.run(
        "UPDATE ttm_roadmaps SET status = 'rejected', admin_note = ?, the_trang = ?, reviewed_at = datetime('now','localtime'), reviewed_by = ? WHERE id = ?",
        [admin_note || null, theTrang, req.adminUserId || null, req.params.id]
      );
      antamResolve('roadmap', req.params.id, 'rejected', req.adminUserId);
    }
    res.json({ ok: true });
  });

  // ── Start ──────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`\n✅  ${COMMUNITY_NAME} API`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`   Admin: http://localhost:${PORT}/admin.html`);
    console.log(`   Admin key : ${process.env.ADMIN_KEY ? "(đã đặt trong .env)" : "⚠️ CHƯA ĐẶT — đang dùng mã mặc định, hãy đặt ADMIN_KEY trong .env"}`);
    console.log(`\n🔔  SePay Webhook`);
    console.log(`   SePay Key : ${SEPAY_KEY ? '••••' + SEPAY_KEY.slice(-4) : '(chưa đặt)'} (env; key lưu trong Admin được ưu tiên)`);
    console.log(`   Webhook   : ${SITE_URL}/api/webhook/sepay`);
    console.log(`\n📧  Email (Resend)`);
    console.log(`   Status    : ${resendClient ? '✅ Active' : '⚠️  No RESEND_API_KEY — emails disabled'}`);
    console.log(`   From      : ${FROM_EMAIL}`);
    console.log(`   Admin     : ${ADMIN_EMAIL}\n`);
  });
})();
