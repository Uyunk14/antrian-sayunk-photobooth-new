require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const {
  generateTOTP,
  isTrue,
  normalizeWA,
  wibDayRange,
  rupiah,
} = require('./lib/helpers');
const { signToken, requireAuth, requireSuperAdmin } = require('./lib/auth');
const { memoryUpload, processImage, deleteImageFiles } = require('./lib/upload');
const { galleryUpload, processGalleryImage, videoUpload, transcodeVideo, deleteFiles, ffmpegAvailable } = require('./lib/media');
const {
  sendTelegramMessage,
  buildDailyReport,
  scheduleDailyReport,
} = require('./lib/telegram');

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.SERVER_PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// File statis. Cache panjang khusus folder uploads (gambar bernama unik).
app.use(
  '/uploads',
  express.static(path.join(__dirname, 'public', 'uploads'), {
    maxAge: '30d',
    immutable: true,
  })
);
app.use(express.static(path.join(__dirname, 'public')));

const ok = (res, data = {}, extra = {}) => res.json({ status: 'success', data, ...extra });
const fail = (res, code, message) => res.status(code).json({ status: 'error', message });
// Bungkus middleware upload (multer) agar errornya balas JSON, bukan halaman HTML.
const uploadMW = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (err) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file terlalu besar' : (err.message || 'Upload gagal');
    return fail(res, 400, msg);
  }
  next();
});

// =====================================================================
// SOCKET.IO
// =====================================================================
io.on('connection', (socket) => {
  socket.on('join_event_room', (eventId) => {
    if (eventId) socket.join(eventId);
  });
});

// =====================================================================
// SETUP AWAL: Super Admin + Setting default
// =====================================================================
async function initSuperAdmin() {
  const username = process.env.SUPERADMIN_USERNAME || 'uyung';
  const rawPass = process.env.SUPERADMIN_PASSWORD || 'sayunkmaster123';
  const existing = await prisma.admin.findUnique({ where: { username } });
  if (!existing) {
    await prisma.admin.create({
      data: {
        username,
        password: await bcrypt.hash(rawPass, 10),
        role: 'SUPERADMIN',
        isActive: true,
      },
    });
    console.log(`👑 Super Admin "${username}" dibuat.`);
  }
}

async function initSetting() {
  const s = await prisma.setting.findFirst();
  if (!s) {
    await prisma.setting.create({ data: { id: 1 } });
    console.log('⚙️  Setting default dibuat.');
  }
}

// Migrasi: masukkan video yang sudah ada (1.mp4, 2.mp4) ke sistem media baru.
async function initMedia() {
  const fs = require('fs');
  if ((await prisma.video.count()) > 0) return;
  const seed = [
    { file: 'public/videos/1.mp4', poster: '/videos/1.jpg', caption: 'Suasana Booth', order: 1 },
    { file: 'public/videos/2.mp4', poster: '/videos/2.jpg', caption: 'Wedding Setup', order: 2 },
  ];
  for (const v of seed) {
    if (!fs.existsSync(path.join(__dirname, v.file))) continue;
    await prisma.video.create({
      data: { videoUrl: '/' + v.file.replace('public/', ''), posterUrl: v.poster, caption: v.caption, status: 'READY', sortOrder: v.order },
    });
  }
  console.log('🎬 Video awal dimigrasikan ke panel admin.');
}

// =====================================================================
// AUTENTIKASI
// =====================================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await prisma.admin.findUnique({ where: { username: username || '' } });
    if (!admin) return fail(res, 401, 'Username atau password salah!');

    const match = await bcrypt.compare(password || '', admin.password);
    if (!match) return fail(res, 401, 'Username atau password salah!');
    if (!isTrue(admin.isActive)) return fail(res, 403, 'Akun dinonaktifkan oleh Super Admin!');

    const token = signToken(admin);
    ok(res, { token, username: admin.username, role: admin.role, id: admin.id });
  } catch (e) {
    fail(res, 500, 'Terjadi kesalahan server');
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => ok(res, req.admin));

// =====================================================================
// MANAJEMEN ADMIN (khusus Super Admin)
// =====================================================================
app.get('/api/admins', requireSuperAdmin, async (req, res) => {
  const admins = await prisma.admin.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, username: true, role: true, isActive: true, createdAt: true },
  });
  ok(res, admins);
});

app.post('/api/admins', requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return fail(res, 400, 'Username & password wajib diisi');
    const exist = await prisma.admin.findUnique({ where: { username } });
    if (exist) return fail(res, 400, 'Username sudah dipakai!');
    await prisma.admin.create({
      data: {
        username,
        password: await bcrypt.hash(password, 10),
        role: role === 'SUPERADMIN' ? 'SUPERADMIN' : 'ADMIN',
        isActive: true,
      },
    });
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal membuat admin');
  }
});

app.patch('/api/admins/:id', requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = {};
    if (req.body.isActive !== undefined) data.isActive = isTrue(req.body.isActive);
    if (req.body.password) data.password = await bcrypt.hash(req.body.password, 10);
    await prisma.admin.update({ where: { id }, data });
    if (data.isActive === false) io.emit('force_logout', id);
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal memperbarui admin');
  }
});

app.delete('/api/admins/:id', requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (id === req.admin.id) return fail(res, 400, 'Tidak bisa menghapus akun sendiri');
    await prisma.admin.delete({ where: { id } });
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menghapus admin');
  }
});

// =====================================================================
// KONTEN PUBLIK (dilihat pelanggan) — tanpa login
// =====================================================================
app.get('/api/public/config', async (req, res) => {
  try {
    const s = (await prisma.setting.findFirst()) || {};
    const packages = await prisma.package.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
    });
    ok(res, {
      boothName: s.boothName,
      tagline: s.tagline,
      logoUrl: s.logoUrl,
      heroSubtitle: s.heroSubtitle,
      avgSessionMinutes: s.avgSessionMinutes,
      instagramUrl: s.instagramUrl,
      tiktokUrl: s.tiktokUrl,
      whatsappNumber: s.whatsappNumber,
      address: s.address,
      openingHours: s.openingHours,
      mapsUrl: s.mapsUrl,
      howToUse: s.howToUse,
      boothRules: s.boothRules,
      packages,
    });
  } catch (e) {
    fail(res, 500, 'Gagal memuat konfigurasi');
  }
});

// Template aktif untuk pelanggan (hanya kirim path gambar, ringan!)
app.get('/api/templates', async (req, res) => {
  try {
    const cats = await prisma.templateCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        templates: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, imageUrl: true, thumbUrl: true },
        },
      },
    });
    const data = cats
      .filter((c) => c.templates.length > 0)
      .map((c) => ({ id: c.id, name: c.name, templates: c.templates }));
    ok(res, data);
  } catch (e) {
    fail(res, 500, 'Gagal memuat katalog');
  }
});

// =====================================================================
// PENGATURAN & KONTEN (admin)
// =====================================================================
app.get('/api/settings', requireAuth, async (req, res) => {
  let setting = await prisma.setting.findFirst();
  if (!setting) setting = await prisma.setting.create({ data: { id: 1 } });
  ok(res, setting);
});

app.post('/api/settings', requireAuth, async (req, res) => {
  try {
    const allowed = [
      'boothName', 'tagline', 'logoUrl', 'heroSubtitle', 'avgSessionMinutes',
      'instagramUrl', 'tiktokUrl', 'whatsappNumber', 'address', 'openingHours',
      'mapsUrl', 'howToUse', 'boothRules', 'whatsappTemplate',
      'telegramToken', 'telegramChatId', 'dailyReportHour', 'maxDeviceLimit',
    ];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      if (['avgSessionMinutes', 'dailyReportHour', 'maxDeviceLimit'].includes(key)) {
        data[key] = parseInt(req.body[key]) || 0;
      } else {
        data[key] = req.body[key];
      }
    }
    const existing = await prisma.setting.findFirst();
    await prisma.setting.update({ where: { id: existing.id }, data });
    if (data.dailyReportHour !== undefined) {
      currentReportHour = data.dailyReportHour;
      if (reportScheduler) reportScheduler.reschedule();
    }
    io.emit('content_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menyimpan pengaturan');
  }
});

// =====================================================================
// PAKET & HARGA (admin write, publik baca lewat /api/public/config)
// =====================================================================
app.get('/api/packages', requireAuth, async (req, res) => {
  const data = await prisma.package.findMany({ orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }] });
  ok(res, data);
});

app.post('/api/packages', requireAuth, async (req, res) => {
  try {
    const b = req.body;
    await prisma.package.create({
      data: {
        name: b.name || 'Paket Baru',
        description: b.description || null,
        price: parseInt(b.price) || 0,
        oldPrice: b.oldPrice ? parseInt(b.oldPrice) : null,
        features: b.features || null,
        isPopular: isTrue(b.isPopular),
        isActive: b.isActive === undefined ? true : isTrue(b.isActive),
        sortOrder: parseInt(b.sortOrder) || 0,
      },
    });
    io.emit('content_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menambah paket');
  }
});

app.patch('/api/packages/:id', requireAuth, async (req, res) => {
  try {
    const b = req.body;
    const data = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.description !== undefined) data.description = b.description;
    if (b.price !== undefined) data.price = parseInt(b.price) || 0;
    if (b.oldPrice !== undefined) data.oldPrice = b.oldPrice ? parseInt(b.oldPrice) : null;
    if (b.features !== undefined) data.features = b.features;
    if (b.isPopular !== undefined) data.isPopular = isTrue(b.isPopular);
    if (b.isActive !== undefined) data.isActive = isTrue(b.isActive);
    if (b.sortOrder !== undefined) data.sortOrder = parseInt(b.sortOrder) || 0;
    await prisma.package.update({ where: { id: req.params.id }, data });
    io.emit('content_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal memperbarui paket');
  }
});

app.delete('/api/packages/:id', requireAuth, async (req, res) => {
  try {
    await prisma.package.delete({ where: { id: req.params.id } });
    io.emit('content_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menghapus paket');
  }
});

// =====================================================================
// MEDIA: GALERI FOTO & VIDEO
// =====================================================================
// Publik: konten media untuk halaman pelanggan
app.get('/api/public/media', async (req, res) => {
  try {
    const gallery = await prisma.galleryPhoto.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const videos = await prisma.video.findMany({ where: { isActive: true, status: 'READY' }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    ok(res, {
      gallery: gallery.map((g) => ({ src: g.imageUrl, thumb: g.thumbUrl, caption: g.caption })),
      videos: videos.map((v) => ({ src: v.videoUrl, poster: v.posterUrl, caption: v.caption })),
    });
  } catch (e) { fail(res, 500, 'Gagal memuat media'); }
});

// ---- Galeri (admin) ----
app.get('/api/gallery', requireAuth, async (req, res) => {
  ok(res, await prisma.galleryPhoto.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }));
});
app.post('/api/gallery/upload', requireAuth, uploadMW(galleryUpload.array('images', 20)), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return fail(res, 400, 'Tidak ada gambar diunggah');
    const created = [];
    for (const f of req.files) {
      const { imageUrl, thumbUrl } = await processGalleryImage(f.buffer);
      created.push(await prisma.galleryPhoto.create({ data: { imageUrl, thumbUrl, isActive: true } }));
    }
    io.emit('media_updated');
    ok(res, created);
  } catch (e) { fail(res, 500, e.message || 'Gagal mengunggah foto'); }
});
app.patch('/api/gallery/:id', requireAuth, async (req, res) => {
  try {
    const data = {};
    if (req.body.caption !== undefined) data.caption = req.body.caption;
    if (req.body.isActive !== undefined) data.isActive = isTrue(req.body.isActive);
    if (req.body.sortOrder !== undefined) data.sortOrder = parseInt(req.body.sortOrder) || 0;
    await prisma.galleryPhoto.update({ where: { id: req.params.id }, data });
    io.emit('media_updated');
    ok(res);
  } catch (e) { fail(res, 500, 'Gagal memperbarui foto'); }
});
app.delete('/api/gallery/:id', requireAuth, async (req, res) => {
  try {
    const g = await prisma.galleryPhoto.findUnique({ where: { id: req.params.id } });
    if (g) deleteFiles(g.imageUrl, g.thumbUrl);
    await prisma.galleryPhoto.delete({ where: { id: req.params.id } });
    io.emit('media_updated');
    ok(res);
  } catch (e) { fail(res, 500, 'Gagal menghapus foto'); }
});

// ---- Video (admin) ----
app.get('/api/videos', requireAuth, async (req, res) => {
  ok(res, await prisma.video.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }));
});
app.post('/api/videos/upload', requireAuth, uploadMW(videoUpload.single('video')), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, 'Tidak ada video diunggah');
    const v = await prisma.video.create({ data: { status: 'PROCESSING', caption: req.body.caption || null } });
    io.emit('media_updated');
    ok(res, v); // balas cepat, transcode jalan di belakang
    transcodeVideo(req.file.path, v.id)
      .then(async (r) => {
        await prisma.video.update({ where: { id: v.id }, data: { videoUrl: r.videoUrl, posterUrl: r.posterUrl, status: 'READY' } });
        io.emit('media_updated');
      })
      .catch(async (e) => {
        console.error('Transcode error:', e.message);
        await prisma.video.update({ where: { id: v.id }, data: { status: 'FAILED' } }).catch(() => {});
        io.emit('media_updated');
      });
  } catch (e) { fail(res, 500, 'Gagal mengunggah video'); }
});
app.patch('/api/videos/:id', requireAuth, async (req, res) => {
  try {
    const data = {};
    if (req.body.caption !== undefined) data.caption = req.body.caption;
    if (req.body.isActive !== undefined) data.isActive = isTrue(req.body.isActive);
    if (req.body.sortOrder !== undefined) data.sortOrder = parseInt(req.body.sortOrder) || 0;
    await prisma.video.update({ where: { id: req.params.id }, data });
    io.emit('media_updated');
    ok(res);
  } catch (e) { fail(res, 500, 'Gagal memperbarui video'); }
});
app.delete('/api/videos/:id', requireAuth, async (req, res) => {
  try {
    const v = await prisma.video.findUnique({ where: { id: req.params.id } });
    if (v) deleteFiles(v.videoUrl, v.posterUrl);
    await prisma.video.delete({ where: { id: req.params.id } });
    io.emit('media_updated');
    ok(res);
  } catch (e) { fail(res, 500, 'Gagal menghapus video'); }
});

// =====================================================================
// KATEGORI TEMPLATE (admin)
// =====================================================================
app.get('/api/categories', requireAuth, async (req, res) => {
  const cats = await prisma.templateCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  ok(res, cats);
});

app.post('/api/categories', requireAuth, async (req, res) => {
  try {
    await prisma.templateCategory.create({
      data: { name: req.body.name || 'Kategori Baru', sortOrder: parseInt(req.body.sortOrder) || 0 },
    });
    io.emit('template_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menambah kategori');
  }
});

app.patch('/api/categories/:id', requireAuth, async (req, res) => {
  try {
    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.isActive !== undefined) data.isActive = isTrue(req.body.isActive);
    if (req.body.sortOrder !== undefined) data.sortOrder = parseInt(req.body.sortOrder) || 0;
    await prisma.templateCategory.update({ where: { id: req.params.id }, data });
    io.emit('template_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal memperbarui kategori');
  }
});

app.delete('/api/categories/:id', requireAuth, async (req, res) => {
  try {
    const templates = await prisma.template.findMany({ where: { categoryId: req.params.id } });
    templates.forEach((t) => deleteImageFiles(t.imageUrl, t.thumbUrl));
    await prisma.template.deleteMany({ where: { categoryId: req.params.id } });
    await prisma.templateCategory.delete({ where: { id: req.params.id } });
    io.emit('template_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menghapus kategori');
  }
});

// =====================================================================
// TEMPLATE (admin) — upload sebagai FILE (anti-lemot)
// =====================================================================
app.get('/api/admin/templates', requireAuth, async (req, res) => {
  const templates = await prisma.template.findMany({
    include: { category: true },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, templates);
});

// Upload 1+ gambar sekaligus. Field form: "images" (file), "categoryId" (text).
app.post('/api/templates/upload', requireAuth, uploadMW(memoryUpload.array('images', 20)), async (req, res) => {
  try {
    const { categoryId } = req.body;
    if (!categoryId) return fail(res, 400, 'Kategori wajib dipilih');
    if (!req.files || req.files.length === 0) return fail(res, 400, 'Tidak ada gambar diunggah');

    const created = [];
    for (const file of req.files) {
      const { imageUrl, thumbUrl } = await processImage(file.buffer);
      const name = (file.originalname || 'frame').replace(/\.[^.]+$/, '').slice(0, 40);
      const t = await prisma.template.create({
        data: { categoryId, name, imageUrl, thumbUrl, isActive: true },
      });
      created.push(t);
    }
    io.emit('template_updated');
    ok(res, created);
  } catch (e) {
    fail(res, 500, e.message || 'Gagal mengunggah template');
  }
});

app.patch('/api/templates/:id', requireAuth, async (req, res) => {
  try {
    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.isActive !== undefined) data.isActive = isTrue(req.body.isActive);
    if (req.body.categoryId !== undefined) data.categoryId = req.body.categoryId;
    if (req.body.sortOrder !== undefined) data.sortOrder = parseInt(req.body.sortOrder) || 0;
    await prisma.template.update({ where: { id: req.params.id }, data });
    io.emit('template_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal memperbarui template');
  }
});

app.delete('/api/templates/:id', requireAuth, async (req, res) => {
  try {
    const t = await prisma.template.findUnique({ where: { id: req.params.id } });
    if (t) deleteImageFiles(t.imageUrl, t.thumbUrl);
    await prisma.template.delete({ where: { id: req.params.id } });
    io.emit('template_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menghapus template');
  }
});

// =====================================================================
// EVENT (admin)
// =====================================================================
app.get('/api/events', requireAuth, async (req, res) => {
  const events = await prisma.event.findMany({ orderBy: { createdAt: 'desc' } });
  ok(res, events);
});

app.post('/api/events', requireAuth, async (req, res) => {
  try {
    const secret = crypto.randomBytes(8).toString('hex').toUpperCase();
    const event = await prisma.event.create({
      data: { name: req.body.name || 'Event', prefix: req.body.prefix || 'A', qrSecret: secret, isActive: false },
    });
    ok(res, event);
  } catch (e) {
    fail(res, 500, 'Gagal membuat event');
  }
});

app.patch('/api/events/:id', requireAuth, async (req, res) => {
  try {
    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.prefix !== undefined) data.prefix = req.body.prefix;
    if (req.body.isActive !== undefined) data.isActive = isTrue(req.body.isActive);
    await prisma.event.update({ where: { id: req.params.id }, data });
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal memperbarui event');
  }
});

app.delete('/api/events/:id', requireAuth, async (req, res) => {
  try {
    await prisma.queue.deleteMany({ where: { eventId: req.params.id } });
    await prisma.event.delete({ where: { id: req.params.id } });
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menghapus event');
  }
});

app.get('/api/events/:id/qr', requireAuth, async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) return fail(res, 404, 'Event tidak ditemukan');
    const token = generateTOTP(event.qrSecret);
    const base =
      process.env.PUBLIC_URL ||
      `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    const scanUrl = `${base}/?event=${event.id}&token=${token}`;
    const qrImage = await QRCode.toDataURL(scanUrl, { width: 400, margin: 1 });
    ok(res, {}, { qrImage, scanUrl });
  } catch (e) {
    fail(res, 500, 'Gagal membuat QR');
  }
});

// Validasi QR (publik)
app.post('/api/validate-qr', async (req, res) => {
  try {
    const { eventId, token } = req.body;
    const event = await prisma.event.findUnique({ where: { id: eventId || '' } });
    if (!event || !isTrue(event.isActive)) {
      return res.json({ status: 'success', valid: false, message: 'Event sedang ditutup atau belum dimulai.' });
    }
    const valid = token === generateTOTP(event.qrSecret) || token === generateTOTP(event.qrSecret, -1);
    if (valid) res.json({ status: 'success', valid: true, eventName: event.name, prefix: event.prefix });
    else res.json({ status: 'success', valid: false, message: 'QR Code kadaluarsa, silakan scan ulang.' });
  } catch (e) {
    res.json({ status: 'success', valid: false, message: 'Terjadi kesalahan' });
  }
});

// =====================================================================
// ANTRIAN
// =====================================================================
// Ambil antrian (publik, dari HP pelanggan)
app.post('/api/queues', async (req, res) => {
  try {
    const { eventId, customerName } = req.body;
    const event = await prisma.event.findUnique({ where: { id: eventId || '' } });
    if (!event || !isTrue(event.isActive)) return fail(res, 400, 'Event sedang ditutup.');
    if (!customerName) return fail(res, 400, 'Nama wajib diisi');

    const cleanWA = normalizeWA(req.body.whatsappNumber);
    const last = await prisma.queue.findFirst({
      where: { eventId },
      orderBy: { queueSequence: 'desc' },
    });

    const newQ = await prisma.queue.create({
      data: {
        eventId,
        queuePrefix: event.prefix,
        queueSequence: last ? last.queueSequence + 1 : 1,
        customerName,
        whatsappNumber: cleanWA,
      },
    });

    io.to(eventId).emit('queue_updated');
    ok(res, newQ);
  } catch (e) {
    fail(res, 500, 'Gagal mengambil antrian');
  }
});

// Status antrian saya (publik)
app.get('/api/queues/me/:id', async (req, res) => {
  try {
    const q = await prisma.queue.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, 'Antrian tidak ditemukan');
    // Hitung berapa orang di depan yang masih menunggu
    const ahead = await prisma.queue.count({
      where: { eventId: q.eventId, status: 'WAITING', queueSequence: { lt: q.queueSequence } },
    });
    ok(res, { ...q, aheadCount: ahead });
  } catch (e) {
    fail(res, 500, 'Gagal memuat status');
  }
});

// Daftar antrian sebuah event (publik untuk mini monitor)
app.get('/api/queues/:eventId', async (req, res) => {
  try {
    const qs = await prisma.queue.findMany({
      where: { eventId: req.params.eventId },
      orderBy: { queueSequence: 'asc' },
      select: { id: true, queuePrefix: true, queueSequence: true, status: true, customerName: true },
    });
    ok(res, qs);
  } catch (e) {
    fail(res, 500, 'Gagal memuat antrian');
  }
});

// --- Aksi kasir (admin) ---
app.post('/api/queues/call/:id', requireAuth, async (req, res) => {
  try {
    const q = await prisma.queue.update({ where: { id: req.params.id }, data: { status: 'CALLED' } });
    io.to(q.eventId).emit('call_customer', {
      queueNumber: `${q.queuePrefix}-${q.queueSequence}`,
      customerName: q.customerName,
    });
    io.to(q.eventId).emit('queue_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal memanggil');
  }
});

app.post('/api/queues/done/:id', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const data = { status: 'DONE' };
    if (b.packageName !== undefined) data.packageName = b.packageName;
    if (b.basePrice !== undefined) data.basePrice = parseInt(b.basePrice) || 0;
    if (b.discountType !== undefined) data.discountType = b.discountType;
    if (b.discountAmount !== undefined) data.discountAmount = parseInt(b.discountAmount) || 0;
    if (b.finalPrice !== undefined) data.finalPrice = parseInt(b.finalPrice) || 0;
    if (b.photoLink !== undefined) data.photoLink = b.photoLink;
    if (b.isPotentialWedding !== undefined) data.isPotentialWedding = isTrue(b.isPotentialWedding);
    const q = await prisma.queue.update({ where: { id: req.params.id }, data });
    io.to(q.eventId).emit('queue_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menyelesaikan');
  }
});

app.post('/api/queues/cancel/:id', requireAuth, async (req, res) => {
  try {
    const q = await prisma.queue.update({ where: { id: req.params.id }, data: { status: 'CANCELED' } });
    io.to(q.eventId).emit('queue_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal membatalkan');
  }
});

app.patch('/api/queues/:id/link', requireAuth, async (req, res) => {
  try {
    const q = await prisma.queue.update({ where: { id: req.params.id }, data: { photoLink: req.body.photoLink } });
    io.to(q.eventId).emit('queue_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal menyimpan link');
  }
});

// Edit nominal / paket antrian (bisa dipakai kapan saja, termasuk setelah DONE)
app.patch('/api/queues/:id/price', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const data = {};
    if (b.finalPrice !== undefined) data.finalPrice = parseInt(b.finalPrice) || 0;
    if (b.basePrice !== undefined) data.basePrice = parseInt(b.basePrice) || 0;
    if (b.packageName !== undefined) data.packageName = b.packageName;
    if (b.isPotentialWedding !== undefined) data.isPotentialWedding = isTrue(b.isPotentialWedding);
    const q = await prisma.queue.update({ where: { id: req.params.id }, data });
    io.to(q.eventId).emit('queue_updated');
    ok(res);
  } catch (e) {
    fail(res, 500, 'Gagal memperbarui nominal');
  }
});

// Daftar antrian lengkap untuk admin (termasuk WA, nominal, link)
app.get('/api/admin/queues/:eventId', requireAuth, async (req, res) => {
  try {
    const qs = await prisma.queue.findMany({
      where: { eventId: req.params.eventId },
      orderBy: { queueSequence: 'asc' },
    });
    ok(res, qs);
  } catch (e) {
    fail(res, 500, 'Gagal memuat antrian');
  }
});

// =====================================================================
// ANALITIK, EXPORT, TELEGRAM (admin)
// =====================================================================
app.get('/api/analytics', requireAuth, async (req, res) => {
  try {
    const scope = req.query.scope || 'all';
    let where = { status: 'DONE' };
    if (scope === 'today') {
      const { start, end } = wibDayRange(0);
      where.createdAt = { gte: start, lt: end };
    } else if (scope === 'yesterday') {
      const { start, end } = wibDayRange(-1);
      where.createdAt = { gte: start, lt: end };
    }
    const done = await prisma.queue.findMany({ where, include: { event: true }, orderBy: { createdAt: 'desc' } });
    const totalOmzet = done.reduce((s, q) => s + (q.finalPrice || q.basePrice || 0), 0);
    ok(res, done, { summary: { count: done.length, omzet: totalOmzet } });
  } catch (e) {
    fail(res, 500, 'Gagal memuat analitik');
  }
});

app.get('/api/export/excel', requireAuth, async (req, res) => {
  try {
    const queues = await prisma.queue.findMany({
      where: { status: 'DONE' },
      include: { event: true },
      orderBy: { createdAt: 'desc' },
    });
    const rows = queues.map((q) => ({
      Tanggal: new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short' }).format(q.createdAt),
      Event: q.event ? q.event.name : '-',
      Nomor: `${q.queuePrefix}-${q.queueSequence}`,
      Nama: q.customerName,
      WhatsApp: q.whatsappNumber,
      Paket: q.packageName || '-',
      'Harga Normal': q.basePrice || 0,
      Diskon: q.discountAmount || 0,
      'Total Bayar': q.finalPrice || 0,
      'Potensi Wedding': q.isPotentialWedding ? 'YA' : 'TIDAK',
      'Link Foto': q.photoLink || '-',
    }));
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Laporan Sayunk');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="Laporan_Sayunk.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (e) {
    fail(res, 500, 'Gagal export');
  }
});

app.post('/api/telegram/test', requireAuth, async (req, res) => {
  const { token, chatId } = req.body;
  const r = await sendTelegramMessage(token, chatId, '🤖 *Sayunk Bot* berhasil terhubung! Laporan otomatis siap dikirim.');
  if (r.ok) ok(res);
  else fail(res, 400, r.error || 'Gagal mengirim, cek token & chat ID');
});

// Kirim laporan sekarang juga (uji manual). ?day=0 hari ini, -1 kemarin
app.post('/api/telegram/report-now', requireAuth, async (req, res) => {
  try {
    const setting = await prisma.setting.findFirst();
    if (!setting || !setting.telegramToken || !setting.telegramChatId)
      return fail(res, 400, 'Token/Chat ID Telegram belum diatur');
    const dayOffset = parseInt(req.body.day);
    const { pesan } = await buildDailyReport(prisma, isNaN(dayOffset) ? 0 : dayOffset);
    const r = await sendTelegramMessage(setting.telegramToken, setting.telegramChatId, pesan);
    if (r.ok) ok(res, {}, { preview: pesan });
    else fail(res, 400, r.error);
  } catch (e) {
    fail(res, 500, 'Gagal mengirim laporan');
  }
});

// Halaman admin
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// =====================================================================
// START
// =====================================================================
let reportScheduler;
let currentReportHour = 23;
async function start() {
  await initSuperAdmin();
  await initSetting();
  await initMedia();
  const s = await prisma.setting.findFirst();
  currentReportHour = s ? s.dailyReportHour : 23;
  // getHour dibaca sinkron; nilainya diperbarui saat pengaturan disimpan.
  reportScheduler = scheduleDailyReport(prisma, () => currentReportHour);

  server.listen(PORT, () => {
    console.log('=========================================');
    console.log(`🚀 Sayunk Antrian aktif di port ${PORT}`);
    console.log(`   Pelanggan : http://localhost:${PORT}`);
    console.log(`   Admin     : http://localhost:${PORT}/admin`);
    console.log('=========================================');
  });
}

start().catch((e) => {
  console.error('Gagal start server:', e);
  process.exit(1);
});
