# AI Agent Challenge 21 Day — Nội Dung Chi Tiết Từng Ngày

> Trích xuất từ `ai-agent-challenge-21-day.html` (taip.io)  
> Challenge: **52,670,000đ** · Leader: Dương Trọng Nghĩa · 160 thành viên · Difficulty: Normal

---

## Tổng quan 3 tuần

| Tuần | Chủ đề | Kết quả cuối tuần |
|---|---|---|
| 1 (Ngày 1–7) | Build hệ thống bán hàng cơ bản | Website thật + lead + bộ não thứ 2 |
| 2 (Ngày 8–12) | Tự động hóa toàn bộ funnel | Chatbot + CRM + Sepay + Email sequence |
| 3 (Ngày 13–21) | AI Agent thực sự | Agent trên VPS, MCP, tự Telegram, content, video |

---

## TUẦN 1 — Build Hệ Thống Bán Hàng

---

### Ngày 1 — Kick Off: Tham Gia Meeting & Cài Công Cụ

**Trạng thái (user này):** ✓ Đã duyệt (1 tuần trước)

**Mục tiêu:** Nắm tổng quan thử thách, cài đặt đủ 3 công cụ cần thiết.

**Công cụ cần cài:**
1. **VS Code** — editor viết code
2. **Claude Desktop** — AI local, kết nối được MCP
3. **Antigravity** — AI coding agent (thay thế Cursor trong thử thách này)

**Yêu cầu:**
- Xem recording buổi kick-off (YouTube embed trong trang)
- Tham gia nhóm Telegram cộng đồng

**Nộp bài:**
- Ảnh chụp màn hình đã xem video kick-off
- Ảnh đã cài VS Code
- Ảnh đăng ký tài khoản Claude.ai
- Ảnh đã cài Claude Desktop
- Ảnh đã cài Antigravity

**✅ Được duyệt khi:** Có đủ 5 ảnh chứng minh đã cài xong 3 công cụ.

---

### Ngày 2 — Làm Landing Page Đơn Giản Bằng AI

**Trạng thái (user này):** ✓ Đã duyệt (5 ngày trước)

**Mục tiêu:** Dùng Antigravity (AI coding agent) tạo landing page HTML hoàn chỉnh từ 0, không cần biết code.

**Cách làm:**
- Mở Antigravity → tạo thư mục dự án mới
- Ra lệnh cho AI viết landing page HTML hoàn chỉnh (giới thiệu sản phẩm/dịch vụ của bạn)
- Deploy lên Netlify hoặc Vercel (miễn phí, không cần server)

**Nộp bài:**
- Ảnh chụp màn hình landing page
- Link truy cập được (ví dụ: `thuthach21ngay.netlify.app`)

**Lưu ý từ user thực tế:**
> "Thử thách 21 ngày: Làm chủ AI Agent – Làm chủ tương lai. Mục tiêu: Giúp bạn chuyển từ việc 'chơi đùa' với AI sang thực sự 'ứng dụng'..."
> — Từ Chí Nguyện (user đang học đã triển khai lại chính thử thách này)

**✅ Được duyệt khi:** Landing page mở được, có nội dung thật về sản phẩm/dịch vụ bạn muốn bán.

---

### Ngày 3 — Deploy Website Thật + Thu Lead Thật

**Trạng thái (user này):** ✓ Đã duyệt (4 ngày trước)

**Mục tiêu:** Đưa website lên domain thật, gắn form thu thập lead → dữ liệu tự chảy vào Google Sheet.

**Các bước:**
1. Đăng ký domain thật tại **123host.vn** (hoặc tương tự)
2. Trỏ domain vào Netlify/Vercel (thay đổi DNS)
3. Gắn form thu lead bằng **Google Forms** hoặc **Formspree**
4. Kết nối form → Google Sheet để lưu tự động

**Nộp bài:**
- Link website thật (domain, không phải netlify.app)
- Link trang đăng ký/form
- Link Google Sheet đang nhận data (reviewer phải xem được)
- Ảnh chứng minh từng bước

**Ví dụ user thực tế:**
- Website: `thuthach21ngay.tuchinguyen.com`
- Form: `thuthach21ngay.tuchinguyen.com/dang-ky.html`
- Google Sheet nhận lead: link public

**✅ Được duyệt khi:** Vào domain thật thấy website, điền form → data xuất hiện trong Google Sheet.

---

### Ngày 4 — Traffic – Lead – Money

**Trạng thái (user này):** ✓ Đã duyệt (3 ngày trước)

**Mục tiêu:** Chạy traffic thật vào website, kiểm tra toàn bộ luồng hoạt động từ đầu đến cuối.

**Các bước:**
1. Đăng bài lên ít nhất **3 kênh mạng xã hội** (Facebook, Instagram, Threads, TikTok...)
2. Gửi email thủ công cho 1 lead đầu tiên (từ Google Sheet ngày 3)
3. Kiểm tra Google Sheet có lead thật chưa

**Nộp bài:**
- Link website (đang chạy và nhận lead)
- Link bài đăng Facebook (link public)
- Link ảnh bài đăng (Google Drive)
- Link Google Sheet lưu lead
- Link email đã gửi cho lead (screenshot)

**Ví dụ user thực tế:**
- Website: `contentagent.tuchinguyen.com`
- Đã gửi email nhắc chuyển khoản + email xác nhận cho lead

**✅ Được duyệt khi:** Có lead thật trong Google Sheet, có ít nhất 1 bài đăng public.

---

### Ngày 5 — Build Bộ Não Thứ 2 (SQLite brain.db + Brand Voice)

**Trạng thái (user này):** ✓ Đã duyệt (3 ngày trước)

**Mục tiêu:** Tạo "bộ não kỹ thuật số" — database SQLite lưu brand voice và kiến thức của bạn. Từ đây, mọi bài AI viết sẽ đúng giọng bạn.

**Cấu trúc thư mục:**
```
my-brain/
  brain.db           ← SQLite database
  brain_score.md     ← Tracking điểm mỗi ngày
```

**Bảng `brand_voice` trong brain.db:**

| Cột | Nội dung |
|---|---|
| `tone` | Cách nói chuyện: gần gũi, chuyên nghiệp, hài hước... |
| `words_to_use` | Từ hay dùng, đặc trưng |
| `words_to_avoid` | Từ không dùng (cứng nhắc, sáo rỗng...) |
| `target_audience` | Đối tượng mục tiêu |
| `writing_example` | Ít nhất 1 bài viết thật của bạn |

**Prompt mẫu giao cho Antigravity:**
```
Tạo thư mục my-brain với file brain.db SQLite.
Tạo bảng brand_voice gồm các cột: id, tone, words_to_use,
words_to_avoid, target_audience, writing_example.
Insert 1 row dữ liệu mẫu cho tôi xem cấu trúc.
Tạo file brain_score.md để track điểm hàng ngày với
các cột: ngày, số bài đăng, số lead mới, ghi chú.
```

**Sau khi AI tạo xong:**
- Điền brand voice thật của bạn (không dùng data mẫu)
- Nhờ AI đọc brain.db → viết 1 bài theo giọng bạn → lưu vào `post.txt`
- Nhận xét: bài có nghe giống giọng bạn không? Cần bổ sung gì vào brand_voice?

**Nộp bài:**
1. Screenshot thư mục `my-brain` có `brain.db` bên trong (hoặc agent đang đọc database thành công)
2. Screenshot bảng brand_voice đã điền đầy đủ (tone, words_to_use, words_to_avoid, đối tượng, ≥ 1 ví dụ thật)
3. Nội dung file `post.txt` + nhận xét: có đúng giọng không, sẽ bổ sung gì

**✅ Được duyệt khi:** brain.db chạy được, brand_voice có data thật (không phải mẫu), AI đã viết được bài từ database.

---

### Ngày 6 — Mở Danh Sách Chờ + Bắt Đầu 7 Ngày Đăng Bài Liên Tục

**Trạng thái (user này):** ✓ Đã duyệt (1 ngày trước)

**Mục tiêu:** Ra mắt trang waitlist + lên kế hoạch content 7 ngày + đăng bài ngày đầu tiên.

> ⚠️ **Chuỗi 7 ngày này chạy song song từ Ngày 6 đến Ngày 12.** Mỗi ngày phải đăng ≥ 3 bài, cập nhật brain_score.md tối nay.

**SOP Ngày 6:**

**Bước 1 — Tạo trang waitlist**

Mở Antigravity → thư mục website → paste prompt:
```
Tạo trang /dang-ky.html — form thu thập: tên, email, số điện thoại.
Khi submit → lưu vào file waitlist.json (append, không ghi đè).
Hiển thị thông báo cảm ơn sau khi gửi. Màu sắc đồng bộ website.
```

**Bước 2 — Lên kế hoạch content 7 ngày với bộ não thứ 2**

Mở Antigravity → thư mục `my-brain` → paste prompt:
```
Đọc brand voice trong brain.db. Tôi cần đăng 3 bài/ngày
trong 7 ngày liên tiếp để kéo người vào danh sách chờ tại
[link waitlist]. Tạo kế hoạch content 7 ngày trong file plan.md:
mỗi ngày có 3 ý tưởng bài đăng khác nhau (không trùng lặp),
format: Ngày X | Ý tưởng | Hook gợi ý | CTA.
Đúng giọng của tôi từ brand_voice.
```

**Bước 3 — Đăng bài ngày 1 của chuỗi**

Prompt viết bài ngày 1:
```
Đọc plan.md và brand voice trong brain.db.
Viết bài đăng ngày 1 theo ý tưởng trong plan.md.
Lưu vào file day1.txt.
```

Chỉnh tối đa 5 phút → đăng lên ít nhất 3 kênh.

**Nộp bài:**
- Link trang waitlist (`/dang-ky.html`) — reviewer phải điền được
- Link bài đăng ngày 1 (≥ 3 kênh, link public)
- Screenshot form khảo sát
- Screenshot file `plan.md` đã tạo
- Screenshot `brain_score.md` đã cập nhật ngày 1

**Ví dụ user thực tế:**
- Website: `contentagent.tuchinguyen.com`
- Waitlist + survey: `contentagent.tuchinguyen.com/cindy-survey.html`
- Đăng bài trên Facebook, Instagram, Threads

**✅ Được duyệt khi:** Trang waitlist mở được + form submit được + plan.md có 7 ngày × 3 ý tưởng + link bài đăng public.

---

### Ngày 7 — Week 1 Review Meeting

**Trạng thái (user này):** ✓ Đã duyệt (23 giờ trước)  
**Meeting:** 19:30 ngày 07/04 (2–2.5 giờ)

**Mục tiêu:** Review tuần 1 cùng toàn bộ thành viên. Học cách dùng agent đọc thư mục và tự quản lý công việc.

**Bài tập thực hành TRONG meeting (7 hạng mục):**

1. Dùng Agent tạo toàn bộ cấu trúc thư mục dự án bằng 1 câu lệnh duy nhất
2. Dùng Agent điền nội dung vào `README.md`
3. Dùng Agent tạo danh sách task trong `tasks/`
4. Ra lệnh cho Agent đọc toàn bộ thư mục và phân tích
5. Ra lệnh cho Agent lên lịch tuần tự động
6. Ra lệnh cho Agent cập nhật task khi xong việc
7. Chia sẻ 3 câu hỏi cốt lõi trong meeting:
   - Use case là gì?
   - Agent làm được gì?
   - Tiết kiệm bao nhiêu thời gian?

**Nộp bài (7 hạng mục):** Screenshot từng bước + link recording nếu không tham gia live.

**Ví dụ chia sẻ của user trong meeting:**
> - Use case: Dùng Agent quản lý hệ điều hành kinh doanh đa nhiệm (thương hiệu mỹ phẩm Dori, hệ sinh thái Diên Viên Đường, khóa đào tạo AI Agent)
> - Agent làm được: đọc `/context` → viết content đúng tone từng thương hiệu, phân loại task theo Ma trận Eisenhower, tóm tắt buổi học → tạo SOP
> - Tiết kiệm: **70–80% thời gian** (từ 2–3 tiếng/ngày xuống 15–20 phút)

**✅ Được duyệt khi:** Có đủ 7 screenshot + hoặc chứng minh đã tham gia/xem recording.

---

## TUẦN 2 — Tự Động Hóa Toàn Bộ Funnel

---

### Ngày 8 — Relax Day (Nghỉ Lễ 30/4–1/5)

**Trạng thái (user này):** Chờ duyệt

Không có task bắt buộc. Nghỉ ngơi, tái nạp năng lượng.

*(Submission của user: "Nghỉ chơi, chữa lành. Nghiên cứu thêm về hệ thống AI agents thử thách 21 ngày.")*

---

### Ngày 9 — Build Chatbot Bán Hàng 24/7

**Mục tiêu:** Gắn chatbot có kịch bản bán hàng thật vào website. Khách vào là chatbot chào và tư vấn — bạn không cần làm gì.

> 💡 **Chatbot này dùng kịch bản cố định** (không dùng AI thật bên trong). Nhưng vì kịch bản được viết từ data thật và brand voice thật, nó nghe tự nhiên hơn bất kỳ chatbot template nào.

**SOP 7 bước:**

**Bước 1 — Tạo kho dữ liệu cho chatbot**

Mở Antigravity → File → Open Folder → thư mục website từ Ngày 2 → paste prompt:
```
Tạo các thư mục con: (1) /data/products — thông tin chi tiết từng sản phẩm,
(2) /data/faq — câu hỏi khách hay hỏi và câu trả lời,
(3) /data/customers — feedback và câu chuyện khách hàng thật,
(4) /data/objections — lý do khách hay từ chối và cách xử lý.
Sau đó đọc toàn bộ file trong thư mục và gợi ý nội dung mẫu
phù hợp cho từng thư mục dựa trên sản phẩm trên website.
Lưu gợi ý vào từng file tương ứng.
```

Sau khi AI tạo → **tự điền data thật** vào từng file:
- `/data/products` → giá thật, ưu đãi thật
- `/data/faq` → câu hỏi khách thật đã hỏi ngoài đời
- `/data/customers` → feedback thật, lời khen thật
- `/data/objections` → lý do từ chối thật và cách bạn đã xử lý

> **Công thức:** thư mục = bộ nhớ của agent. Bạn nhớ gì, agent biết đó.

**Bước 2 — Copy brain.db vào thư mục website**
```
Copy file brain.db từ thư mục my-brain vào thư mục website này.
```

**Bước 3 — Nhờ AI viết kịch bản bán hàng**
```
Đọc toàn bộ file trong /data và brand voice trong brain.db.
Viết kịch bản chatbot bán hàng gồm:
(1) Câu chào khách,
(2) 10 câu hỏi khách hay hỏi nhất và câu trả lời,
(3) Câu chốt đơn khi khách có vẻ quan tâm,
(4) Câu hướng khách điền form khi chưa sẵn sàng mua ngay.
Đúng giọng của tôi, không dùng từ cứng nhắc. Lưu vào sales_script.md.
```

Đọc lại `sales_script.md` → chỗ nào chưa đúng giọng thì nói AI chỉnh, **không tự sửa tay**.

**Bước 4 — Gắn chatbot vào website**
```
Thêm vào website một chatbot nhỏ ở góc dưới phải màn hình.
Chatbot dùng kịch bản trong sales_script.md.
Khi khách bấm vào: hiện cửa sổ chat — chatbot tự chào và trả lời theo kịch bản.
Khi khách muốn mua: hiện nút dẫn đến form danh sách chờ.
Màu sắc đồng bộ website hiện tại.
```

**Bước 5 — Test kỹ trước khi mở cửa**

Tự đóng vai khách, chat thử 3 tình huống:
- Hỏi giá
- Hỏi sản phẩm có phù hợp với mình không
- Nói "để tôi nghĩ thêm"

**Bước 6 — Đăng bài thông báo**
```
(Mở thư mục my-brain) Đọc brand voice trong brain.db.
Viết 1 bài đăng thông báo website vừa có nhân viên tư vấn tự động 24/7.
Tone vui, gần gũi. Có link website. Lưu vào day9.txt.
```

Đăng lên ≥ 2 kênh. Cập nhật `brain_score.md` tối nay.

**Bước 7 — Nộp bài**

| Hạng mục | Yêu cầu |
|---|---|
| Link website có chatbot | Reviewer vào và chat thử trực tiếp |
| Link bài đăng | ≥ 2 kênh, link public (không phải ảnh) |
| Screenshot 4 thư mục /data | Phải có data thật bên trong |
| Screenshot brain_score.md | Đã cập nhật hôm nay |

**✅ Được duyệt khi:**
- Chatbot hiện ra, trả lời được ≥ 3 câu hỏi cơ bản
- Có câu chốt đơn trong kịch bản
- Link public mở được
- 4 thư mục /data có data thật (không chỉ data mẫu)

**❌ Chưa đạt khi:**
- Chỉ nộp ảnh, không có link
- Chatbot không chạy hoặc chỉ có câu chào
- Link bài đăng bị private
- /data còn trống hoặc chỉ có data mẫu AI tạo

> ⚠️ **Chuỗi 7 ngày vẫn đang chạy:** Hôm nay vẫn đăng ≥ 3 bài ngoài bài thông báo chatbot.

> 🔥 **Mẹo của Nghĩa:** Không muốn đọc SOP? Copy toàn bộ SOP này, paste vào agent và nói: *"Đây là SOP tôi cần làm. Hướng dẫn tôi từng bước một — mỗi lần chỉ 1 bước, chờ tôi làm xong báo lại rồi mới đưa bước tiếp. Bị lỗi thì fix luôn. Bắt đầu đi."*

---

### Ngày 10 — Nhận Tiền Tự Động + CRM + Admin Panel

**Mục tiêu:** Hoàn thiện hệ thống bán hàng — nhận tiền qua QR tự động, quản lý đơn hàng và khách hàng trong 1 chỗ.

> Nhìn lại những gì đã có: website + chatbot + waitlist + bộ não thứ 2 + 7 ngày đăng bài. Hôm nay thêm 3 mảnh cuối: nhận tiền tự động + quản lý đơn hàng + admin panel.

> 🔥 **Mẹo của Nghĩa:** Ngày nặng — nhưng bạn không cần đọc hết SOP. Copy toàn bộ SOP, paste vào agent: *"Hướng dẫn tôi từng bước một — mỗi lần chỉ 1 bước, chờ tôi làm xong báo lại rồi mới tiếp. Bắt đầu đi."*

**Trước khi bắt đầu — bạn thuộc nhóm nào?**
- **Đã có sản phẩm đang bán:** Kết nối Sepay + dùng CRM quản lý đơn hàng
- **Chưa có sản phẩm:** Kết nối Sepay trước → tạo sản phẩm số đơn giản nhất trong hôm nay (ebook, template, checklist) → gắn vào CRM

**SOP 8 bước:**

**Bước 1 — Đăng ký Sepay (miễn phí)**
- Vào `sepay.vn?gcid=8` → đăng ký → điền thông tin → xác minh số điện thoại → kết nối ngân hàng (5–10 phút)

**Bước 2 — Để AI kết nối Sepay vào website**
```
Tôi muốn kết nối Sepay vào website để nhận thanh toán tự động.
Hãy đọc tài liệu tại https://docs.sepay.vn/ và hướng dẫn tôi
từng bước một — mỗi lần chỉ 1 bước, chờ tôi làm xong báo lại rồi mới tiếp.
Bắt đầu từ bước đơn giản nhất, không cần backend phức tạp.
```

**Bước 3 — Build database CRM**
```
Thêm 3 bảng mới vào file brain.db:
(1) bảng products — tên sản phẩm, giá, mô tả, số lượng còn lại.
(2) bảng customers — tên, sđt, Zalo, ngày đăng ký — import toàn bộ
    data từ waitlist.json vào đây, tránh trùng lặp.
(3) bảng orders — khách nào mua gì, số tiền, trạng thái đơn, ngày mua.
Chạy luôn cho tôi.
```

**Bước 4 — Build Admin Panel**
```
Tạo trang admin panel tại /admin — giao diện web đơn giản có 3 tab:
Sản phẩm, Khách hàng, Đơn hàng.
Mỗi tab hiển thị data từ brain.db, có nút thêm mới/chỉnh sửa/xóa.
Không cần đăng nhập.
Khi admin thêm đơn mới thì tự động trừ số lượng sản phẩm còn lại.
```

Sau khi AI làm xong → mở `yourdomain.com/admin` → test 3 tab.

**Bước 5 — Tạo sản phẩm số (nếu chưa có)**
```
(Mở thư mục my-brain) Đọc brand voice và thông tin business trong brain.db.
Gợi ý 3 sản phẩm số đơn giản nhất tôi có thể tạo trong hôm nay.
Mỗi sản phẩm: tên, mô tả ngắn, giá bán gợi ý, mất bao lâu để tạo.
```

Chọn 1 → paste tiếp:
```
Tạo cho tôi sản phẩm số [tên sản phẩm] — viết đầy đủ nội dung,
xuất ra file PDF. Đúng giọng của tôi.
```

**Bước 6 — Test nhận tiền thật**

Tự chuyển **2.000đ** cho chính mình để test toàn bộ luồng:
1. Vào trang thanh toán → submit thông tin
2. Ở `/admin` tab Đơn hàng: thấy đơn mới ở trạng thái `pending`
3. Quay lại trang checkout → quét QR → chuyển 2.000đ đúng nội dung
4. Kiểm tra tài khoản ngân hàng có tiền vào không
5. `/admin` → Đơn hàng → trạng thái chuyển sang `success` chưa
6. Màn hình checkout hiển thị thông báo "cảm ơn" chưa

> **Lưu ý quan trọng:** Admin panel **phải có** nút kích hoạt thanh toán thành công bằng tay — trường hợp khách chuyển khoản nhưng nội dung không khớp tự động.

**Bước 7 — Tổng kết bộ não thứ 2 + Đăng bài**
```
(Mở thư mục my-brain) Đọc toàn bộ brain_score.md và brand voice trong brain.db.
Làm 2 việc:
(1) Viết tổng kết bộ não thứ 2 sau 7 ngày — đã học được gì, điểm mạnh,
    cần bổ sung gì — lưu vào brain_review.md.
(2) Viết 1 bài đăng thông báo hôm nay vừa có hệ thống bán hàng hoàn chỉnh.
    Tone hào hứng, gần gũi. Có link website. Lưu vào day10.txt.
```

**Bước 8 — Nộp bài**

| Hạng mục | Yêu cầu |
|---|---|
| Link trang thanh toán | Reviewer vào thấy QR, quét được bằng điện thoại |
| Link trang /admin | Reviewer vào thấy đủ 3 tab có data thật |
| Screenshot nhận tiền 2.000đ | Chứng minh đã test thật |
| Link bài đăng | ≥ 2 kênh, public |
| Screenshot brain_review.md | Tổng kết 7 ngày |

**✅ Được duyệt khi:**
- Trang thanh toán kết nối được Sepay thật
- Đơn hàng tự tạo `pending` → chuyển `success` sau khi quét QR
- `/admin` có đủ 3 tab, mỗi tab có data thật
- Có bằng chứng nhận được 2.000đ test

**❌ Chưa đạt khi:**
- Chỉ nộp ảnh, không có link
- `/admin` không mở được hoặc thiếu tab
- Chưa test nhận tiền thật
- Thiếu `brain_review.md`

> ⚠️ **Ngày cuối chuỗi 7 ngày:** Đăng ≥ 3 bài hôm nay, nhiều hơn bình thường nếu có thể.

---

### Ngày 11 — Email Marketing Tự Động (Resend.com)

**Mục tiêu:** Biến danh sách khách hàng trong CRM thành cỗ máy chăm sóc tự động — khách điền form → tự nhận 3 email theo lịch → có đơn hàng → tự nhận email xác nhận.

> **Resend là gì?** Website không tự gửi email được — cần một "bưu điện" để nhờ gửi hộ. Resend chính là cái bưu điện đó. Website gọi Resend qua API Key → Resend gửi email ngay — bạn không cần làm gì.

> 💡 **Mẹo thao tác nền tảng mới:** Chụp màn hình giao diện Resend → ném vào Claude/ChatGPT → hỏi: *"Tôi cần tạo API Key, chỉ tôi phải bấm vào đâu."* Áp dụng được cho bất kỳ nền tảng nào.

**SOP 8 bước:**

**Bước 1 — Thêm trường email vào form và CRM**
```
Kiểm tra form waitlist trên website có trường email chưa.
Nếu chưa thì thêm email vào form, thêm cột email vào bảng customers
trong brain.db, và cập nhật trang /admin để hiển thị cột email.
```

**Bước 2 — Đăng ký Resend.com**
- Vào `resend.com` → đăng ký miễn phí → xác minh email
- Tạo API Key → lưu vào file `resend_config.txt`
- Dùng email mặc định của Resend trước (không cần verify domain)

**Bước 3 — Để AI kết nối Resend vào website**
```
Tôi muốn kết nối Resend vào website để gửi email tự động.
Hãy đọc tài liệu tại https://resend.com/docs và hướng dẫn tôi
từng bước — mỗi lần chỉ 1 bước. API Key đã lưu trong resend_config.txt.
```

**Bước 4 — Nhờ AI viết 3 email tự động**
```
(Mở thư mục my-brain) Đọc brand voice trong brain.db và thông tin
sản phẩm trong bảng products. Viết 3 email đúng giọng của tôi:

Email 1 — Chào mừng: gửi ngay khi khách điền form.
          Ngắn, ấm, giới thiệu bạn là ai và vì sao họ nên chờ đón.

Email 2 — Nurture: gửi 2 ngày sau Email 1.
          Chia sẻ 1 insight có giá trị — không bán hàng, chỉ cho đi.

Email 3 — Chốt: gửi 1 ngày sau Email 2.
          Giới thiệu sản phẩm, lợi ích thật, CTA rõ ràng dẫn đến thanh toán.

Lưu vào email_sequence.md.
```

**Bước 5 — Gắn email sequence vào website + chế độ test**
```
Đọc email_sequence.md. Làm 3 việc:
(1) Khách mới điền form → gửi Email 1 ngay qua Resend.
(2) 2 ngày sau → tự động gửi Email 2.
(3) 1 ngày sau → tự động gửi Email 3 kèm link trang thanh toán.
Dùng API Key trong resend_config.txt.

Thêm chế độ test: nếu email có chứa '+test' (ví dụ: ten+test@gmail.com)
→ gửi cả 3 email ngay lập tức thay vì chờ theo lịch.
```

Test bằng cách điền form với `tenminh+test@gmail.com`.

**Bước 6 — Thêm email xác nhận đơn hàng**
```
Đọc brand voice trong email_sequence.md và thông tin sản phẩm trong brain.db.
Viết thêm 1 email xác nhận đơn hàng — gửi tự động khi admin thêm đơn mới.
Email phải có: tên sản phẩm, số tiền, hướng dẫn nhận hàng, lời cảm ơn đúng giọng.
Kết nối Resend và gắn vào luồng tạo đơn trong /admin.
```

**Bước 7 — Đăng bài**
```
Viết 1 bài đăng chia sẻ từ hôm nay khách hàng sẽ nhận email chăm sóc tự động
sau khi đăng ký — không phải email spam mà là email có giá trị thật.
Tone gần gũi, có chút tự hào. Có link website. Lưu vào day11.txt.
```

**Bước 8 — Nộp bài**

| Hạng mục | Yêu cầu |
|---|---|
| Screenshot hộp thư | Cả 3 email sau khi test bằng `+test` |
| Screenshot email xác nhận đơn | Sau khi test thêm đơn trong `/admin` |
| Screenshot `email_sequence.md` | Đủ 3 email đúng giọng |
| Link bài đăng | ≥ 2 kênh, public |

**✅ Được duyệt khi:**
- Nhận được cả 3 email trong hộp thư thật sau khi test `+test`
- Nhận được email xác nhận đơn hàng sau khi test thêm đơn
- `email_sequence.md` có đủ 3 email đúng brand voice
- Link bài đăng mở được

**❌ Chưa đạt khi:**
- Chỉ nhận được Email 1, Email 2 và 3 chưa chạy
- Email xác nhận đơn hàng chưa hoạt động
- `email_sequence.md` còn trống hoặc chỉ có template mẫu

---

### Ngày 12 — Week 2 Review + Chuẩn Bị Deploy

**Mục tiêu:** Nhìn lại 2 tuần, viết thật, chuẩn bị sẵn sàng để đưa project lên server thật vào ngày mai.

> **Ngày hôm nay không build thêm gì** — đây là ngày nhìn lại, viết thật, và chuẩn bị.

**Nhìn lại tuần 2 đã build:**
- ✅ Ngày 5: Bộ não thứ 2 — database + brand voice
- ✅ Ngày 6–12: 7 ngày đăng bài liên tục + danh sách chờ
- ✅ Ngày 9: Chatbot bán hàng 24/7
- ✅ Ngày 10: Sepay + CRM + Admin panel
- ✅ Ngày 11: Email marketing tự động

**SOP 5 bước:**

**Bước 1 — Tự viết review (KHÔNG nhờ AI viết thay)**
```
(Mở thư mục my-brain) Tạo file week2_review.md với 5 câu hỏi,
để trống chỗ trả lời cho tôi điền tay:
(1) Tôi đã build được gì sau 12 ngày?
(2) Số liệu thật: bao nhiêu người trong danh sách chờ,
    bao nhiêu bài đã đăng, đã có đơn hàng chưa?
(3) Điều gì khó nhất tôi đã vượt qua?
(4) Điều gì tôi thấy mình làm chưa tốt?
(5) Nếu bắt đầu lại từ ngày 1, tôi sẽ làm khác gì?
```

Mở `week2_review.md` → **tự điền câu trả lời thật** — không nhờ AI, không viết cho đẹp, viết thật là được.

**Bước 2 — AI biến review thành bài đăng**
```
Đọc file week2_review.md — đây là những gì tôi tự viết thật lòng.
Dựa trên đúng những gì tôi viết, biến nó thành 1 bài đăng mạng xã hội
chân thật — không tô hồng, không giảm nhẹ, giữ đúng giọng từ brain.db.
Lưu vào week2_post.md.
```

**Bước 3 — Kiểm tra dự án sẵn sàng deploy**
```
(Mở thư mục website) Tôi chuẩn bị deploy dự án lên VPS Linux ngày mai.
Kiểm tra toàn bộ thư mục và cho tôi biết:
(1) Dự án đang dùng ngôn ngữ/framework gì?
(2) Có file nào cần tạo thêm để deploy không?
(3) Có API Key nào đang nằm lộ trong code không?
(4) Danh sách đầy đủ những thứ cần chuẩn bị.
Lưu kết quả vào deploy_checklist.md.
```

**Bước 4 — AI fix những thứ còn thiếu**
```
Đọc deploy_checklist.md. Những thứ còn thiếu — tạo và fix luôn cho tôi.
Đảm bảo dự án sạch sẽ, không có thông tin bí mật nằm lộ trong code,
và có file README.md hướng dẫn deploy cơ bản.
```

**Bước 5 — Đăng bài (ngày cuối chuỗi 7 ngày)**

Đăng ≥ 3 bài hôm nay:
- Bài 1: bài cảm nhận 2 tuần từ `week2_post.md` (bài quan trọng nhất)
- Bài 2 + 3: content kéo người vào danh sách chờ từ `plan.md`

**Nộp bài:**
- Link bài cảm nhận 2 tuần (≥ 2 kênh, public)
- Screenshot `week2_review.md` — 5 câu trả lời thật tự viết
- Screenshot `deploy_checklist.md` đã tick đủ
- Screenshot `brain_review.md` (tạo ở ngày 10)

**✅ Được duyệt khi:**
- Bài cảm nhận có tiếng nói thật của bạn (không phải AI viết hoàn toàn)
- `week2_review.md` có đủ 5 câu trả lời thật
- `deploy_checklist.md` đã fix xong
- Đã đăng ≥ 3 bài hôm nay

---

## TUẦN 3 — AI Agent Thực Sự

---

### Ngày 13 — Build AI Agent (Goclaw) trên VPS

**Meeting:** 19:30 ngày 21/04 (2–2.5 giờ)  
**Recording:** Google Drive link (sau meeting)

**Mục tiêu:** Thiết lập một AI Agent hoàn chỉnh để hỗ trợ công việc + hỗ trợ mọi người trong group Telegram — giống như con **Lửng Mật** (CINDY).

**Tool:** `goclaw` — open source AI agent framework  
**Repo:** `github.com/nextlevelbuilder/goclaw`

**SOP mẫu (paste vào AI coding agent):**
```
Tôi đang muốn clone repo goclaw từ https://github.com/nextlevelbuilder/goclaw
về và chạy trên VPS của tôi.
GitHub để deploy bằng GitHub Actions là: [LINK GITHUB CỦA BẠN]

Đọc repo goclaw chi tiết và lên kế hoạch cài đặt trên VPS theo thông tin
bên dưới. Domain [TÊN DOMAIN] đã được trỏ tới IP VPS rồi.
Đảm bảo phân tích sâu để tôi chỉ cần vào domain là dùng được goclaw.

THÔNG TIN VPS:
[Điền thông tin VPS theo mẫu trong video — IP, OS, RAM, CPU...]
```

**Bài nộp sau meeting:** Theo hướng dẫn + link recording.

---

### Ngày 14 — Website Lên VPS + Trao Cánh Tay Cho Agent (MCP)

*(Hướng dẫn chi tiết: `taip.io/day14-vps-mcp.html` — chỉ cho thành viên, không share)*

> ⚠️ Đừng share link hướng dẫn ra nhóm hay cho người ngoài thử thách.

**Mục tiêu:** Deploy website lên VPS Linux thật + trang bị cho AI Agent khả năng thao tác server qua **MCP (Model Context Protocol)** — biến chatbot thành "cánh tay" thực sự.

**MCP là gì?** Model Context Protocol cho phép AI agent không chỉ trả lời — mà còn thực sự thao tác được với hệ thống: đọc/ghi file, SSH vào server, chạy commands, gọi API...

**Kết quả:** Agent của bạn từ "biết nói" trở thành "biết làm".

---

### Ngày 15 — Agent Trở Thành Cộng Sự Tức Thì

*(Hướng dẫn: `taip.io/day15-agent-brain.html` — chỉ cho thành viên)*

**Mục tiêu:** Cho agent việc cụ thể, giọng riêng, và thói quen chủ động.

> Lần đầu agent **không đợi bạn nhắn** — nó tự Telegram khi có đơn mới, form mới, hay mỗi sáng tổng kết đêm trước.

**Cách làm (nhẹ hơn ngày 14 — ~2-3 giờ):**
1. AI coding agent viết MCP function + MD files
2. Bạn upload lên VPS
3. Bật **Heartbeat** qua Dashboard (không cần SSH, không cần sửa VPS)

**Agent sẽ tự động:**
- Telegram bạn khi có đơn hàng mới
- Telegram khi có form waitlist mới
- Mỗi sáng: tổng kết hoạt động đêm trước

---

### Ngày 16 — Tự Tay Tạo Skill Cho Claude

*(Hướng dẫn: `taip.io/day16-tu-tao-skill.html` — chỉ cho thành viên)*

**Mục tiêu:** Biến tri thức thành tài sản số có thể tái sử dụng vĩnh viễn — tự tạo Claude Skill đầu tiên.

> Hôm qua (Ngày 15) bạn dùng được skill của người khác. **Hôm nay bạn tự tạo skill đầu tiên.**

**5 cấp độ Claude Skills:**

| Cấp | Thành phần | Dùng khi nào |
|---|---|---|
| 1 | SKILL.md (hướng dẫn thuần) | Tác vụ đơn giản, không cần file phụ |
| 2 | SKILL.md + `assets/` | Cần template, file mẫu, logo... |
| 3 | SKILL.md + `scripts/` | Cần code chạy được (Python, FFmpeg...) |
| 4 | SKILL.md + `references/` | Cần kiến thức sâu (pháp lý, kỹ thuật...) |
| 5 | Đầy đủ tất cả | Tác vụ phức tạp tổng hợp |

**Quiz 10 câu (embedded trong trang, mỗi câu đúng = +2 XP):**

Quy tắc bắt buộc:
- Bấm **"Hỏi AI"** trước mỗi câu → copy prompt → paste vào agent coding → agent giải thích
- Quay lại chọn đáp án sau khi hiểu
- Chọn 1 lần duy nhất — **không retry**

Ví dụ các câu hỏi:
1. FAQ 20 câu, trả lời ngắn 2-3 dòng → Cấp mấy? → **Cấp 1**
2. Edit video tự động, cắt + caption + nhạc nền → Cấp mấy? → **Cấp 3** (cần FFmpeg/Python)
3. Soạn proposal đúng template thương hiệu → Cấp mấy? → **Cấp 2** (cần file template)
4. Code tính năng mới (frontend + backend + test + deploy) → Cấp mấy? → **Cấp 5**
5. Soạn hợp đồng đúng luật VN → Cấp mấy? → **Cấp 4** (cần references pháp lý)
6. Báo cáo doanh thu + vẽ biểu đồ + xuất slide → Cấp mấy? → **Cấp 5**
7. Viết caption Instagram Hook+Body+CTA → Cấp mấy? → **Cấp 2**
8. Phân tích đối thủ, đọc website, viết báo cáo → Cấp mấy? → **Cấp 1**
9. Tạo poster quảng cáo tự động từ thông tin sự kiện → Cấp mấy? → **Cấp 3**
10. Tư vấn đầu tư theo nguyên tắc rule of 100... → Cấp mấy? → **Cấp 4**

**Nhiệm vụ:** Làm quiz + chọn 1 ý tưởng → agent coding tạo skill → test ở 2 nơi khác nhau (~2-3 giờ)

---

### Ngày 17 — Skill Sản Xuất Content + Auto-Post Facebook

*(Hướng dẫn: `taip.io/day17-skill-creative-fb.html` — chỉ cho thành viên)*

**Mục tiêu:**
- Agent tự gen full content (ảnh đẹp + văn bản hoàn chỉnh: hook + body + CTA + hashtag)
- Tự đăng lên Facebook Page mỗi sáng 9h
- Gen được 3 bộ creative ads (ảnh + copy) để paste vào Ads Manager

> **Kết quả:** Dậy sáng thấy Facebook Page đã có 1 bài đăng đầy đủ ảnh + văn bản — bạn không làm gì.

**2 Mode của skill `tao-creative-fb`:**
- **Mode 1 — Content Free:** Agent gen ý tưởng 9h sáng → Telegram bạn để duyệt → tự đăng
- **Mode 2 — Creative Ads:** Gen 3 bộ ảnh + copy để paste vào Ads Manager khi muốn chạy quảng cáo

**14 bước trong guide:**

| Bước | Nội dung |
|---|---|
| 1 | Lấy OpenAI API key (`kp3-content-bot`) |
| 2 | Setup project Facebook Developer |
| 3 | Lấy **Permanent Page Token** ⚠ phần khó nhất |
| 4 | Test token với Token Debugger |
| 5 | Brainstorm content angle theo brand |
| 6 | Build skill Mode 1 (Content Free) |
| 7 | Build skill Mode 2 (Creative Ads) |
| 8 | Setup cron lịch hẹn 9h sáng |
| 9 | Test Run Now → nhận ý tưởng qua Telegram |
| 10 | Duyệt → preview → đăng tự động |
| 11–14 | Kiểm tra + monitoring + fallback |

**Trước đây** (bạn hoặc team): nghĩ ý tưởng + viết bài + làm ảnh + đăng = 30–60 phút/ngày  
**Sau hôm nay:** bạn ngủ, agent làm thay.

---

### Ngày 18 — Skill Sản Xuất Video AI Trên Higgsfield ⏸ TẠM DỪNG

*(Hướng dẫn: `taip.io/day18-skill-video-ai.html`)*  
*(Tạm dừng — Tiếp tục 04/05/2026. Timer đóng băng, không bị tính trễ)*

**1 tool duy nhất: Higgsfield AI** — vừa sinh ảnh (Stream 4.5) vừa animate (Kling 2.6 hoặc Kling 3.0). Không cần 4–5 tool rời.

**Bạn quyết định làm video về gì — chọn 1 trong 2 hướng:**
- **A. Sản phẩm/dịch vụ đang kinh doanh** — gen video quảng bá đăng Reels/TikTok/FB Page. ROI thực tế.
- **B. Video vui tặng bạn bè** — sinh nhật, kỷ niệm, troll vui. Áp lực thấp, tập trung học workflow.

**Workflow 9 bước:**

| Bước | Nội dung | Thời gian |
|---|---|---|
| 1 | Chọn chủ đề A hoặc B | 1 phút |
| 2 | Dùng ChatGPT viết kịch bản (prompt mẫu trong guide) | 5 phút |
| 3 | Tạo ảnh với Stream 4.5 trong Higgsfield Image | 10 phút |
| 4 | Mặc đồ cho model (nếu cần) | 5 phút |
| 5 | Animate Kling 2.6 hoặc 3.0 — prompt: *"orbit nhẹ chậm giữ vai"* | 10–15 phút |
| 6 | Multishot (Kling 3.0) — nối nhiều shot tự động | — |
| 7 | Edit ghép trong CapCut | — |
| 8 | Build skill `tao-video-ai` | 5 phút |
| 9 | Tích hợp auto-post (mở rộng pipeline Day 17) | 5 phút |

**Mục tiêu cuối ngày:**
- 1 video AI 15–25 giây hoàn chỉnh
- Skill `tao-video-ai` — agent lặp lại quy trình

**Nguyên tắc làm việc với Higgsfield:**
> *"Ra ảnh ưng cái nào lụm cái đó, đừng mất công sửa hoài"* — AI có yếu tố hên xui, chấp nhận và di chuyển nhanh.

**Chi phí:** ~30–50 credit Higgsfield/video. Có thể mua share account ~100–300k/tháng qua cộng đồng nội bộ (~6.700 thành viên).

---

### Ngày 19 — Agent Logging & Monitoring

*(Nội dung đầy đủ chưa unlock)*

**Mục tiêu:** Thêm logging và monitoring cho Agent — track được usage, errors, và performance.

---

### Ngày 20 — Optimize

*(Nội dung đầy đủ chưa unlock)*

**Mục tiêu:** Tối ưu chi phí API, caching responses, xử lý concurrent requests.

---

### Ngày 21 — Demo & Tổng Kết

*(Nội dung đầy đủ chưa unlock)*

**Mục tiêu:** Trình bày Agent hoàn chỉnh của bạn — chia sẻ bài học, kết quả, kế hoạch tiếp theo.

---

## AI Agents Trong Thử Thách

### CINDY — Trợ Lý AI 24/7

- **Vai trò:** "Trợ lý AI siêu cấp đồng hành suốt hành trình"
- **Kênh:** Telegram group của challenge
- **Biệt danh:** "Lửng Mật" trong cộng đồng
- **Cách hoạt động:** Bot Telegram — học viên nhắn trong group, CINDY trả lời 24/7
- **Chức năng:** Hỗ trợ kỹ thuật, giải đáp thắc mắc, hướng dẫn thực hành

### Heartbeat — Agent Scheduler

- Bật qua Dashboard (không cần SSH)
- Cho agent tự chạy theo lịch (cron)
- Dùng ở Ngày 15+

### MCP (Model Context Protocol)

- Cho agent "cánh tay" thực sự — thao tác được server
- Dùng ở Ngày 14–15

---

## Tất Cả Công Cụ Dùng Trong 21 Ngày

| Công cụ | Vai trò | Ngày |
|---|---|---|
| **Antigravity** | AI coding agent (giống Cursor) | 1–17 |
| **Claude Desktop** | AI local + MCP | 1, 14, 15, 16 |
| **Claude.ai** | AI web (viết, phân tích) | Nhiều ngày |
| **VS Code** | Code editor | 1–21 |
| **ChatGPT** | Viết kịch bản video | 18 |
| **Goclaw** | Open source AI agent framework trên VPS | 13 |
| **CINDY** | Telegram AI support bot 24/7 | Suốt hành trình |
| **OpenAI API** | Content bot cho Facebook | 17 |
| **Higgsfield AI** | Sinh ảnh (Stream 4.5) + video (Kling 2.6/3.0) | 18 |
| **Sepay.vn** | QR payment gateway Việt Nam | 10 |
| **Resend.com** | Transactional email API | 11 |
| **123host.vn** | Domain + hosting Việt Nam | 3 |
| **Netlify / Vercel** | Static site deploy miễn phí | 2, 3 |
| **Google Forms / Formspree** | Form thu lead | 3 |
| **Google Sheets** | Lưu lead tự động | 3, 4 |
| **Telegram** | Group chat + bot channel | Suốt hành trình |
| **CapCut** | Edit video | 18 |
| **Facebook Graph API** | Auto-post lên Page | 17 |
| **MCP** | Model Context Protocol | 14, 15 |
| **VPS Linux** | Server chạy Goclaw + website | 13–21 |
| **GitHub Actions** | CI/CD deploy tự động | 13+ |

---

## Quy Trình Nộp Bài & Duyệt

```
Học viên nộp bài (text + link + screenshot)
  ↓
Trạng thái: ⧗ "Chờ duyệt" (vàng)
  ↓
Admin review trực tiếp:
  - Vào link website và test
  - Xem link bài đăng (phải public)
  - Verify data thật (không phải mẫu)
  ↓
Admin quyết định:
  ✓ "Đã duyệt" (xanh) — có "Lịch sử review" với timestamp
  ✗ "Chưa đạt" — học viên phải làm lại
```

**Nguyên tắc review:**
- Mọi link phải mở được, reviewer test trực tiếp (không chấp nhận chỉ nộp ảnh)
- Data phải thật (lead thật, tiền thật, bài đăng public thật)
- Bài nào yêu cầu tự viết thì AI không được viết thay

---

*Cập nhật từ: `ai-agent-challenge-21-day.html` (taip.io) — April 2026*
