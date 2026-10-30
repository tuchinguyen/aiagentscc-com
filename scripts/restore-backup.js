#!/usr/bin/env node
// Giải mã 1 bản sao lưu (.dhbk tải từ Google Drive) thành thư mục các file gốc.
//
//   node scripts/restore-backup.js <file.dhbk> <thư-mục-ra>
//   (khoá giải mã lấy từ biến môi trường BACKUP_KEY, hoặc hỏi khi chạy)
//
// Trong thư mục ra sẽ có: brain.db (dữ liệu cộng đồng), goclaw-*.tar.gz (dữ liệu GoClaw nếu có),
// env.txt (bản sao .env), nginx-*.conf, uploads-locations.tar.gz, manifest.json.
// Cách khôi phục từng phần: xem RESTORE.md trong thư mục ra.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MAGIC = Buffer.from('DHBK1');

async function askKey() {
  if (process.env.BACKUP_KEY) return process.env.BACKUP_KEY.trim();
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question('Nhập khoá giải mã sao lưu (BACKUP_KEY): ', a => { rl.close(); r(a.trim()); }));
}

(async () => {
  const [file, outDir] = process.argv.slice(2);
  if (!file || !outDir) { console.error('Cách dùng: node scripts/restore-backup.js <file.dhbk> <thư-mục-ra>'); process.exit(1); }
  const key = Buffer.from(await askKey(), 'base64');
  if (key.length !== 32) { console.error('Khoá không đúng định dạng (cần chuỗi base64 của 32 byte).'); process.exit(1); }
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 5).equals(MAGIC)) { console.error('File không phải bản sao lưu .dhbk.'); process.exit(1); }
  const iv = buf.subarray(5, 17), tag = buf.subarray(buf.length - 16), data = buf.subarray(17, buf.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  let tgz;
  try { tgz = Buffer.concat([d.update(data), d.final()]); }
  catch { console.error('Sai khoá giải mã hoặc file bị hỏng.'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  const tarPath = path.join(outDir, '_bundle.tar.gz');
  fs.writeFileSync(tarPath, tgz);
  execFileSync('tar', ['-xzf', tarPath, '-C', outDir]);
  fs.unlinkSync(tarPath);
  console.log('✅ Đã giải mã vào', path.resolve(outDir));
  console.log(fs.readdirSync(outDir).map(f => '  - ' + f).join('\n'));
})();
