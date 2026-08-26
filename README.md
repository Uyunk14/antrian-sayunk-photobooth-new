# 📸 Sayunk Photobooth — Web Antrian v2

Web antrian digital + papan informasi untuk pelanggan Sayunk Photobooth.
Pelanggan **scan QR** di booth, ambil nomor antrian dari HP masing-masing, dan
melihat info penting (paket & harga, pilihan template, cara pakai, aturan, kontak)
sambil menunggu — **real-time**.

Dibangun sebagai penyempurnaan versi lama, dengan **3 masalah utama sudah diperbaiki**.

---

## ✅ Apa yang diperbaiki dari versi lama

| Masalah lama | Penyebab | Perbaikan di v2 |
|---|---|---|
| **Template lemot saat pertama buka** | Gambar disimpan sebagai **base64 di database** → DB membengkak jadi **64 MB**, semua terunduh sekaligus | Gambar disimpan sebagai **file WebP terkompres** (full + thumbnail). DB tinggal path (KB). Grid pakai **thumbnail + lazy-load** → load instan |
| **Laporan Telegram sering "Rp 0"** | Cron jam `00:00` menghitung "hari ini" yang **baru mulai** (0 transaksi) + salah zona waktu | Laporan menghitung hari yang **benar dalam zona WIB** (`Asia/Jakarta`), dijadwalkan jam yang bisa diatur (default 23:00) |
| **Keamanan & fitur belum update** | Password admin **teks polos**, super-admin di-hardcode | Password **di-hash bcrypt**, login pakai **JWT**, semua endpoint admin dilindungi |

Fitur tambahan: estimasi waktu tunggu, papan info lengkap yang bisa diedit dari
panel admin (paket, cara pakai, aturan, sosial media), manajemen paket & harga,
kelola multi-admin, export Excel, panggilan suara + getar di HP pelanggan.

---

## 🚀 Menjalankan di Lokal (Windows)

```bash
# 1. Install dependency
npm install

# 2. Siapkan konfigurasi
copy .env.example .env      # lalu edit .env (WAJIB ganti JWT_SECRET & SUPERADMIN_PASSWORD)

# 3. Siapkan database + isi contoh data
npm run setup               # = prisma generate + db push + seed

# 4. Jalankan
npm run dev                 # mode development (auto-reload)
# atau
npm start                   # mode biasa
```

Buka:
- **Pelanggan:** http://localhost:3000
- **Admin:** http://localhost:3000/admin

Login admin pertama pakai `SUPERADMIN_USERNAME` & `SUPERADMIN_PASSWORD` dari `.env`.

> ⚠️ **Segera ganti password default** setelah login pertama (menu Admin), dan
> pastikan `JWT_SECRET` di `.env` sudah diganti dengan teks acak yang panjang.

---

## ☁️ Deploy ke VPS (CloudPanel)

CloudPanel cocok karena mendukung Node.js persisten + WebSocket + penyimpanan file.

1. **Buat site Node.js** di CloudPanel (pilih Node 18/20/22), catat domain-nya.
2. **Upload / clone** folder proyek ini ke direktori site (mis. lewat SFTP atau Git).
3. Di terminal SSH, masuk ke folder site lalu:
   ```bash
   npm install --omit=dev
   cp .env.example .env
   nano .env         # isi JWT_SECRET, SUPERADMIN_PASSWORD, PUBLIC_URL=https://domainmu
   npm run setup     # buat database + data contoh (jalankan SEKALI saja)
   ```
4. **Jalankan dengan PM2** (biar tetap hidup & auto-restart):
   ```bash
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup       # ikuti instruksi agar auto-jalan saat server reboot
   ```
5. **Reverse proxy** di CloudPanel: arahkan domain ke `http://127.0.0.1:3000`.
   Pastikan **WebSocket diaktifkan** (untuk real-time & socket.io). CloudPanel
   Vhost umumnya sudah mem-forward `Upgrade`/`Connection` header; jika belum,
   tambahkan di konfigurasi Nginx site.
6. Aktifkan **SSL/HTTPS** lewat CloudPanel (Let's Encrypt) — penting agar
   kamera/suara/QR jalan mulus di HP.

### Yang harus dijaga saat deploy
- **Jangan hapus** `prisma/sayunk.db` (berisi semua data) & folder
  `public/uploads/` (berisi gambar template). Backup keduanya secara berkala.
- Set `TZ="Asia/Jakarta"` di `.env` (sudah default) agar laporan harian akurat.
- Set `PUBLIC_URL` ke domain HTTPS-mu supaya QR code menghasilkan link yang benar.

---

## 🗂️ Struktur Proyek

```
server.js              → server utama (Express + Socket.io + semua API)
lib/
  helpers.js           → util: TOTP, format, tanggal WIB
  auth.js              → JWT & middleware login admin
  telegram.js          → kirim pesan + laporan harian (sudah diperbaiki)
  upload.js            → kompres gambar (sharp) → file WebP + thumbnail
prisma/
  schema.prisma        → struktur database
  seed.js              → data contoh (paket, kategori, event, konten)
public/
  index.html           → halaman pelanggan (scan QR)
  admin.html           → panel admin
  uploads/             → gambar template (dibuat otomatis)
ecosystem.config.js    → konfigurasi PM2
```

---

## 🔧 Cara Pakai Singkat (Operator)

1. Buka **/admin**, login.
2. Tab **Event & QR** → pastikan ada event **Aktif**, klik **QR** → cetak/tampilkan
   QR di meja kasir.
3. Tab **Template** → buat kategori, upload frame (otomatis dikompres).
4. Tab **Paket** & **Konten** → sesuaikan harga, sosmed, alamat, cara pakai, aturan.
5. Tab **Laporan** → isi token Bot Telegram + Chat ID, tes koneksi, atur jam laporan.
6. Saat operasional: pelanggan scan QR & ambil nomor. Di tab **Antrian**, klik
   **📢 Panggil** saat giliran tiba (HP pelanggan bergetar + suara), lalu **Selesai**
   (isi paket & harga) agar masuk laporan omzet.
