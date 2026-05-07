# Deploy Notes — AI Agent Command Center

## Stack
- Node.js (Express) + SQLite (sql.js, persisted to `brain.db`)
- Frontend: HTML/CSS/JS tĩnh, served bởi Express

## Port
Server lắng nghe trên `process.env.PORT || 3000`

## Biến môi trường cần set trên VPS

| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `PORT` | Không | Cổng server (mặc định: 3000) |
| `ADMIN_KEY` | Có | Mật khẩu truy cập admin panel |
| `RESEND_API_KEY` | Có | API key Resend (gửi email) |
| `FROM_EMAIL` | Không | Địa chỉ gửi email (mặc định: `AI AGENTS CC <congdong@aiagentscc.com>`) |
| `SEPAY_KEY` | Có | Secret key xác thực webhook SePay |
| `GSHEET_ID` | Có | ID Google Sheet dùng cho polling thanh toán |

## Các bước deploy trên VPS Ubuntu

### 1. Cài Node.js (nếu chưa có)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Clone repo
```bash
git clone https://github.com/tuchinguyen/aiagentscc-com.git /var/www/aiagentscc
cd /var/www/aiagentscc
```

### 3. Cài dependencies
```bash
npm install --omit=dev
```

### 4. Tạo file .env
```bash
cp .env.example .env
nano .env   # điền giá trị thật
```

### 5. Chạy với PM2 (recommended)
```bash
sudo npm install -g pm2
pm2 start server.js --name aiagentscc
pm2 save
pm2 startup    # tự khởi động khi reboot
```

### 6. Nginx reverse proxy (port 80/443 → 3000)
```nginx
server {
    listen 80;
    server_name aiagentscc.com www.aiagentscc.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 7. SSL với Certbot
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d aiagentscc.com -d www.aiagentscc.com
```

## Lệnh quản lý

```bash
pm2 status          # xem trạng thái
pm2 logs aiagentscc # xem logs
pm2 restart aiagentscc
pm2 stop aiagentscc
```

## Webhook SePay
Cần cấu hình SePay Webhook URL là:
```
https://aiagentscc.com/api/webhook/sepay
```

## Database
`brain.db` được tự tạo khi server khởi động lần đầu.
Không commit `brain.db` lên Git. Backup thủ công định kỳ.
