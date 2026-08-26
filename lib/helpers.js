const crypto = require('crypto');

const WIB_TZ = 'Asia/Jakarta';

// TOTP sederhana berbasis waktu (untuk QR anti-screenshot)
function generateTOTP(secret, windowOffset = 0) {
  const timeWindow = Math.floor(Date.now() / 30000) + windowOffset;
  return crypto
    .createHmac('sha256', secret)
    .update(timeWindow.toString())
    .digest('hex')
    .substring(0, 6)
    .toUpperCase();
}

// Konversi aman ke boolean (SQLite kadang simpan 0/1/"true")
const isTrue = (val) => val === true || val === 1 || val === 'true' || val === '1';

// Normalisasi nomor WhatsApp Indonesia ke format 62xxxx
function normalizeWA(raw) {
  let wa = raw ? String(raw).replace(/\D/g, '') : '';
  if (wa.startsWith('0')) wa = '62' + wa.substring(1);
  else if (wa.startsWith('8')) wa = '62' + wa;
  return wa;
}

// Format rupiah
const rupiah = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');

// ==== Helper tanggal berbasis zona waktu WIB (Asia/Jakarta) ====
// Mengembalikan {y, m, d} untuk "sekarang" menurut zona WIB.
function wibParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: WIB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(date).split('-').map(Number);
  return { y, m, d };
}

// WIB adalah UTC+7 (tanpa DST), jadi awal hari WIB = 00:00 WIB = 17:00 UTC hari sebelumnya.
function wibStartOfDayUTC({ y, m, d }) {
  // 00:00:00 di WIB == (hari itu) 00:00 - 7 jam dalam UTC
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 7 * 60 * 60 * 1000);
}

// Rentang [start, end) untuk sebuah hari WIB, dengan offset hari (0 = hari ini, -1 = kemarin).
function wibDayRange(dayOffset = 0, base = new Date()) {
  const p = wibParts(base);
  const start = wibStartOfDayUTC(p);
  start.setUTCDate(start.getUTCDate() + dayOffset);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// Label tanggal Indonesia untuk sebuah Date (dalam WIB)
function formatTanggalWIB(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

module.exports = {
  WIB_TZ,
  generateTOTP,
  isTrue,
  normalizeWA,
  rupiah,
  wibParts,
  wibDayRange,
  formatTanggalWIB,
};
