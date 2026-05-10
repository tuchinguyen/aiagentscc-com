# AI Agent Command Center

Nền tảng cộng đồng học AI Agent cho người Việt — từ prompt engineering đến deploy agent thực tế.

## Stack

- **Hiện tại:** HTML/CSS/JS + Node.js (Express) + SQLite (brain.db)
- **Target:** Laravel 11 + Livewire 3 + Tailwind CSS + MySQL

## Backend (Node.js)

```
server.js         # Express API server — chạy: node server.js (port 3000)
brain.db          # SQLite database (tự tạo khi chạy server)
package.json      # Dependencies: express, sql.js, bcryptjs, cors
```

### API endpoints

| Method | URL | Mô tả |
|---|---|---|
| POST | `/api/auth/register` | Đăng ký tài khoản |
| POST | `/api/auth/login` | Đăng nhập |
| POST | `/api/admin/verify` | Xác thực admin key |
| GET | `/api/admin/stats` | Thống kê dashboard |
| GET | `/api/admin/users` | Danh sách thành viên |
| PATCH | `/api/admin/users/:id/status` | Cập nhật trạng thái user |
| DELETE | `/api/admin/users/:id` | Xoá user |
| GET | `/api/admin/posts` | Danh sách bài đăng |
| DELETE | `/api/admin/posts/:id` | Xoá bài đăng |
| GET | `/api/admin/xp-log` | Lịch sử XP |

Admin key mặc định: `aiagent-admin-2025` (đặt qua env var `ADMIN_KEY`)

### Database tables (brain.db)

| Bảng | Mô tả |
|---|---|
| `users` | Tài khoản, level, XP, streak, status |
| `posts` | Bài đăng cộng đồng (5 pillar types) |
| `comments` | Bình luận bài đăng |
| `challenge_days` | Định nghĩa 21 ngày (tự seed khi khởi động) |
| `user_challenge_progress` | Tiến độ challenge từng user |
| `xp_log` | Audit trail toàn bộ XP transactions |
| `notifications` | Thông báo in-app |

## Cấu trúc file

```
saas/
├── index.html          # Trang login (entry point)
├── register.html       # Đăng ký tài khoản
├── feed.html           # Bảng tin cộng đồng (main app)
├── challenge.html      # Thử thách 21 ngày
├── leaderboard.html    # Bảng xếp hạng (7-day, 30-day, all-time)
└── assets/
    ├── css/
    │   ├── base.css        # CSS variables + reset + typography
    │   ├── components.css  # Buttons, cards, badges, inputs, tabs
    │   └── layout.css      # App shell, sidebar, topbar, responsive
    └── js/
        └── app.js          # Sidebar toggle, mobile nav, tab switching
```

## Design System

### Màu sắc
```css
--color-primary:    #0ea5e9   /* sky-500 — CTA, links, active states */
--bg-app:           #f8fafc   /* slate-50 — app background */
--bg-card:          #ffffff   /* cards, sidebar */
--bg-hover:         #f1f5f9   /* slate-100 */
--bg-active:        #e0f2fe   /* sky-100 */
--text:             #0f172a   /* slate-900 */
--text-muted:       #64748b   /* slate-500 */
--border:           #e2e8f0   /* slate-200 */
--accent-green:     #10b981   /* emerald-500 — XP, streak */
--accent-purple:    #8b5cf6   /* violet-500 — level badges */
```

### Pillar colors
```
offer:       #f59e0b (amber-500)
traffic:     #3b82f6 (blue-500)
conversion:  #8b5cf6 (violet-500)
delivery:    #10b981 (emerald-500)
continuity:  #ec4899 (pink-500)
```

### Typography
```css
--font-body:    'Inter', sans-serif
--font-heading: 'Plus Jakarta Sans', sans-serif
--fs-xs:   11px
--fs-sm:   13px
--fs-base: 15px
--fs-md:   16px
```

### Layout
```css
--sidebar-w:  240px
--rp-w:       260px
--topbar-h:   56px
--mob-nav-h:  60px
```

## Conventions

- **UI language:** Tiếng Việt
- **Code language:** Tiếng Anh (class names, IDs, variables)
- **HTML:** Semantic, accessible (aria-label, role)
- **CSS:** BEM-lite naming, CSS custom properties
- **JS:** Vanilla ES6+, no frameworks (mockup phase)

## Pages

| File | Mục đích |
|---|---|
| `index.html` | Login — entry point khi chưa đăng nhập |
| `register.html` | Đăng ký tài khoản mới |
| `feed.html` | Bảng tin chính — hiện bài đăng cộng đồng |
| `challenge.html` | Thử thách 21 ngày AI Agent |
| `challenge-detail.html` | Chi tiết thử thách — danh sách 21 ngày, URL: `challenge-detail.html?id=X` |
| `challenge-day-detail.html` | Chi tiết ngày thử thách — SOP, hướng dẫn nộp bài, form nộp, URL: `challenge-day-detail.html?challenge_id=X&day_id=Y` |
| `leaderboard.html` | Bảng xếp hạng cộng đồng — 7-day, 30-day, all-time + level grid |
| `profile.html` | Trang hồ sơ thành viên — URL: `profile.html?id=X`, xem hoạt động + bài viết + bình luận |
| `marketplace.html` | Chợ sản phẩm số — đăng bán, tìm kiếm, lọc theo danh mục, xem chi tiết, mua |
| `checkout.html` | Thanh toán — URL: `checkout.html?id=X`, chọn phương thức (bank/VNPay/Momo), xác nhận đơn |
| `admin.html` | Admin panel — quản lý users, posts, XP log, khóa học, marketplace, cài đặt |

## Laravel Migration Notes

Khi migrate sang Laravel:
- HTML files → `resources/views/` Blade templates
- `assets/css/` → `resources/css/` + Vite
- `assets/js/app.js` → `resources/js/app.js`
- Livewire components: `PostCard`, `Feed`, `NotificationBell`, `SidebarChallenge`
