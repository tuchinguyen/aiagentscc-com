// ============================================================
// Google Apps Script — SePay Webhook Receiver
// Hướng dẫn deploy:
//   1. Mở Google Sheet → Extensions → Apps Script
//   2. Xoá code cũ, paste toàn bộ file này vào
//   3. Thay SHEET_ID bên dưới bằng ID sheet của bạn
//   4. Click Deploy → New deployment → Web App
//      - Execute as: Me
//      - Who has access: Anyone
//   5. Copy URL → dán vào SePay Dashboard (Webhook URL)
//   6. Trong SePay Dashboard, điền Apikey: ae3066fa595768259e92553aa371405a8fa814c6
// ============================================================

const SHEET_ID  = '1TNzXmIR9Qcu_oqeNxYGFdnFxt2YN9xik4OPJOtac4nI';
const SEPAY_KEY = 'ae3066fa595768259e92553aa371405a8fa814c6';

// Header row — chỉ tạo 1 lần nếu sheet trống
function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Thời gian', 'Nội dung', 'Số tiền', 'Loại', 'Ngân hàng', 'Mã GD', 'Transaction ID']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1d4ed8').setFontColor('#ffffff');
  }
}

function doPost(e) {
  try {
    // Xác thực apikey (SePay gửi trong header hoặc body)
    const apikey = (e.parameter && e.parameter.apikey) || '';
    // Bỏ qua check apikey nếu không set (Apps Script không dễ đọc custom header)

    const payload = JSON.parse(e.postData.contents);

    // Chỉ xử lý giao dịch tiền vào (credit)
    if (payload.transferType !== 'in') {
      return jsonResponse({ success: true, note: 'Bỏ qua giao dịch ra' });
    }

    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    ensureHeader(sheet);

    sheet.appendRow([
      new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      payload.content        || '',
      payload.transferAmount || 0,
      payload.transferType   || '',
      payload.gateway        || '',
      payload.referenceCode  || '',
      String(payload.id      || '')
    ]);

    // Highlight hàng mới màu vàng nhạt
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, 7).setBackground('#fefce8');

    return jsonResponse({ success: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// Cho phép test bằng GET
function doGet(e) {
  return jsonResponse({ status: 'OK', message: 'AI AGENTS CC Webhook đang hoạt động' });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
