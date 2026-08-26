const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const multer = require('multer');
const sharp = require('sharp');

const PUBLIC = path.join(__dirname, '..', 'public');
const GAL_DIR = path.join(PUBLIC, 'gallery');
const VID_DIR = path.join(PUBLIC, 'videos');
const TMP_DIR = path.join(VID_DIR, '_tmp');
[GAL_DIR, VID_DIR, TMP_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

let FFMPEG_OK = null;
function ffmpegAvailable() {
  if (FFMPEG_OK === null) {
    try { FFMPEG_OK = !spawnSync('ffmpeg', ['-version']).error; } catch (e) { FFMPEG_OK = false; }
  }
  return FFMPEG_OK;
}

// ---------- Galeri foto (kompres ke WebP + thumbnail) ----------
const galleryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (r, f, cb) => {
    const okType = /^image\//.test(f.mimetype);
    const okExt = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.originalname || '');
    return okType || okExt ? cb(null, true) : cb(new Error('File harus berupa gambar'));
  },
});
async function processGalleryImage(buffer) {
  const id = crypto.randomBytes(8).toString('hex');
  const full = id + '.webp', thumb = id + '_thumb.webp';
  await sharp(buffer).rotate().resize({ width: 1400, height: 1750, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(GAL_DIR, full));
  await sharp(buffer).rotate().resize({ width: 600, height: 750, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toFile(path.join(GAL_DIR, thumb));
  return { imageUrl: '/gallery/' + full, thumbUrl: '/gallery/' + thumb };
}

// ---------- Video (upload ke disk lalu transcode) ----------
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (r, f, cb) => cb(null, TMP_DIR),
    filename: (r, f, cb) => cb(null, crypto.randomBytes(8).toString('hex') + (path.extname(f.originalname || '') || '.mp4')),
  }),
  limits: { fileSize: 400 * 1024 * 1024 },
  fileFilter: (r, f, cb) => {
    const okType = /^video\//.test(f.mimetype);
    const okExt = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(f.originalname || '');
    return okType || okExt ? cb(null, true) : cb(new Error('File harus berupa video'));
  },
});

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg exit ' + c + ' ' + err.slice(-200)))));
  });
}

// Transcode file tmp -> /videos/<id>.mp4 (H.264 720p) + poster. Mengembalikan {videoUrl, posterUrl}.
async function transcodeVideo(tmpPath, id) {
  const outName = id + '.mp4', posterName = id + '.jpg';
  const outPath = path.join(VID_DIR, outName), posterPath = path.join(VID_DIR, posterName);
  if (ffmpegAvailable()) {
    await run('ffmpeg', ['-y', '-i', tmpPath,
      '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outPath]);
    try { await run('ffmpeg', ['-y', '-ss', '1.5', '-i', outPath, '-frames:v', '1', '-q:v', '3', posterPath]); } catch (e) {}
    fs.promises.unlink(tmpPath).catch(() => {});
    return { videoUrl: '/videos/' + outName, posterUrl: fs.existsSync(posterPath) ? '/videos/' + posterName : null };
  }
  // Tanpa ffmpeg: pakai file apa adanya (mungkin besar / HEVC — beri tahu admin agar pasang ffmpeg di server).
  const ext = path.extname(tmpPath) || '.mp4';
  const rawName = id + ext, rawPath = path.join(VID_DIR, rawName);
  await fs.promises.rename(tmpPath, rawPath);
  return { videoUrl: '/videos/' + rawName, posterUrl: null };
}

function deleteFiles(...urls) {
  urls.forEach((u) => { if (!u) return; fs.promises.unlink(path.join(PUBLIC, u.replace(/^\//, ''))).catch(() => {}); });
}

module.exports = { galleryUpload, processGalleryImage, videoUpload, transcodeVideo, deleteFiles, ffmpegAvailable };
