require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // ---- Pengaturan / konten publik (placeholder, silakan edit di panel admin) ----
  const existing = await prisma.setting.findFirst();
  const settingData = {
    boothName: 'Sayunk Photobooth',
    tagline: 'capture every vibe.',
    logoUrl: '/img/logo.png',
    heroSubtitle: 'Self-studio photobooth berkualitas tinggi. Ambil antrian digitalmu & nikmati momen seru tanpa perlu berdiri mengantre.',
    avgSessionMinutes: 8,
    instagramUrl: 'https://www.instagram.com/sayunk_photobooth',
    tiktokUrl: 'https://www.tiktok.com/@sayunk_photobooth',
    whatsappNumber: '6281234567890',
    address: 'Jl. Contoh Alamat No. 123, Kota Kamu',
    openingHours: 'Setiap hari 10.00 - 22.00 WIB',
    mapsUrl: '',
    howToUse: [
      'Scan QR di meja kasir untuk ambil nomor antrian.',
      'Pilih paket & tema frame favoritmu sambil menunggu.',
      'Tunggu nomormu dipanggil — HP-mu akan bergetar & berbunyi.',
      'Masuk booth, ikuti aba-aba di layar, dan bergaya sebebasnya!',
      'Hasil foto dikirim ke WhatsApp / bisa diambil langsung.',
    ].join('\n'),
    boothRules: [
      'Maksimal sesuai kapasitas booth demi kenyamanan bersama.',
      'Durasi 1 sesi kurang lebih 8 menit.',
      'Jaga kebersihan & properti booth ya, Sayunk!',
      'Dilarang membawa makanan/minuman ke dalam booth.',
      'Datang 5 menit sebelum dipanggil agar tidak terlewat.',
    ].join('\n'),
    whatsappTemplate: 'Halo Kak [Nama], terima kasih sudah foto di Sayunk Photobooth! 📸\n\nIni link hasil fotomu: [Link]',
    callTemplate: 'Halo Kak [Nama Pelanggan]! 📸\n\nNomor antrianmu [Nomor Antrian] — sekarang GILIRANMU! Silakan menuju booth foto Sayunk ya. Ditunggu! 🎉',
    dailyReportHour: 23,
  };
  if (existing) await prisma.setting.update({ where: { id: existing.id }, data: settingData });
  else await prisma.setting.create({ data: { id: 1, ...settingData } });

  // ---- Paket & harga contoh ----
  const pkgCount = await prisma.package.count();
  if (pkgCount === 0) {
    await prisma.package.createMany({
      data: [
        {
          name: 'Paket Basic',
          description: 'Pas untuk foto singkat bareng teman.',
          price: 35000,
          features: '10 menit sesi foto\n2 lembar cetak\n1 frame pilihan\nSoftcopy semua foto',
          sortOrder: 1,
        },
        {
          name: 'Paket Couple',
          description: 'Favorit! Cocok untuk berdua atau pasangan.',
          price: 55000,
          oldPrice: 65000,
          features: '15 menit sesi foto\n4 lembar cetak\nPilih 2 frame\nSoftcopy + boomerang\nProperti lucu gratis',
          isPopular: true,
          sortOrder: 2,
        },
        {
          name: 'Paket Grup',
          description: 'Rame-rame lebih seru & hemat.',
          price: 90000,
          features: '20 menit sesi foto\n6 lembar cetak\nSemua frame boleh\nSoftcopy + boomerang\nProperti lengkap',
          sortOrder: 3,
        },
      ],
    });
  }

  // ---- Kategori template contoh ----
  const catCount = await prisma.templateCategory.count();
  if (catCount === 0) {
    await prisma.templateCategory.createMany({
      data: [
        { name: 'Classic', sortOrder: 1 },
        { name: 'Cute & Pastel', sortOrder: 2 },
        { name: 'Birthday', sortOrder: 3 },
      ],
    });
  }

  // ---- Event aktif contoh ----
  const evCount = await prisma.event.count();
  if (evCount === 0) {
    const crypto = require('crypto');
    await prisma.event.create({
      data: {
        name: 'Booth Utama',
        prefix: 'A',
        qrSecret: crypto.randomBytes(8).toString('hex').toUpperCase(),
        isActive: true,
      },
    });
  }

  console.log('✅ Seed selesai: pengaturan, paket, kategori, & event contoh siap.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
