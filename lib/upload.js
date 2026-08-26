const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'templates');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Terima file di memori dulu, lalu kita proses dengan sharp.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // maksimal 15MB per gambar mentah
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('File harus berupa gambar'));
  },
});

// Ubah 1 buffer gambar menjadi: file penuh (webp, lebar maks 1200px) + thumbnail
// (webp, lebar maks 500px). INI kunci anti-lemot: DB cuma simpan path, bukan base64.
async function processImage(buffer) {
  const id = crypto.randomBytes(8).toString('hex');
  const fullName = `${id}.webp`;
  const thumbName = `${id}_thumb.webp`;

  await sharp(buffer)
    .rotate() // hormati orientasi EXIF
    .resize({ width: 1200, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(UPLOAD_DIR, fullName));

  await sharp(buffer)
    .rotate()
    .resize({ width: 500, height: 700, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toFile(path.join(UPLOAD_DIR, thumbName));

  return {
    imageUrl: `/uploads/templates/${fullName}`,
    thumbUrl: `/uploads/templates/${thumbName}`,
  };
}

// Hapus file gambar dari disk (dipakai saat template dihapus)
function deleteImageFiles(...urls) {
  for (const url of urls) {
    if (!url) continue;
    const file = path.join(__dirname, '..', 'public', url.replace(/^\//, ''));
    fs.promises.unlink(file).catch(() => {});
  }
}

module.exports = { memoryUpload, processImage, deleteImageFiles, UPLOAD_DIR };
