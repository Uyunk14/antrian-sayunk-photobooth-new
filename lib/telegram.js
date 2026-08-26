const cron = require('node-cron');
const { WIB_TZ, wibDayRange, formatTanggalWIB, rupiah } = require('./helpers');

// Kirim pesan ke Telegram. Mengembalikan {ok, error}.
async function sendTelegramMessage(token, chatId, text) {
  if (!token || !chatId) return { ok: false, error: 'Token/Chat ID belum diisi' };
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      return { ok: false, error: body.description || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Bangun teks laporan untuk rentang hari tertentu (default: KEMARIN, offset -1).
// Ini memperbaiki bug lama: dulu laporan jam 00:00 menghitung "hari ini" yang
// baru mulai (0 transaksi). Sekarang kita hitung hari yang sudah berakhir, WIB.
async function buildDailyReport(prisma, dayOffset = -1) {
  const { start, end } = wibDayRange(dayOffset);

  const done = await prisma.queue.findMany({
    where: {
      status: 'DONE',
      createdAt: { gte: start, lt: end },
    },
    include: { event: true },
  });

  const totalOmzet = done.reduce((sum, q) => sum + (q.finalPrice || q.basePrice || 0), 0);
  const totalPelanggan = done.length;
  const potensiWedding = done.filter((q) => q.isPotentialWedding).length;

  // Tanggal yang dilaporkan = tengah rentang, aman dari efek zona waktu
  const labelDate = formatTanggalWIB(new Date(start.getTime() + 12 * 60 * 60 * 1000));

  let pesan = `📊 *REKAP HARIAN SAYUNK*\n`;
  pesan += `🗓️ ${labelDate}\n\n`;
  pesan += `👥 Total Pelanggan: *${totalPelanggan}*\n`;
  pesan += `💰 Omzet: *${rupiah(totalOmzet)}*\n`;
  if (potensiWedding > 0) pesan += `💍 Potensi Wedding: *${potensiWedding}*\n`;

  if (totalPelanggan === 0) {
    pesan += `\n_Belum ada transaksi selesai pada tanggal ini._`;
  }

  return { pesan, totalPelanggan, totalOmzet };
}

// Jadwalkan laporan harian pada jam tertentu (WIB). Mengembalikan task cron
// agar bisa di-stop / dijadwal ulang saat pengaturan berubah.
function scheduleDailyReport(prisma, getHour) {
  let task = null;

  const start = () => {
    if (task) task.stop();
    const hour = Math.min(23, Math.max(0, Number(getHour()) || 23));
    // Jalan setiap hari jam {hour}:00 waktu Asia/Jakarta, laporkan HARI INI yang
    // baru saja berakhir (offset 0 karena kita jalan sore/malam, bukan tengah malam).
    task = cron.schedule(
      `0 ${hour} * * *`,
      async () => {
        try {
          const setting = await prisma.setting.findFirst();
          if (!setting || !setting.telegramToken || !setting.telegramChatId) return;
          const { pesan } = await buildDailyReport(prisma, 0); // hari ini (yang hampir berakhir)
          await sendTelegramMessage(setting.telegramToken, setting.telegramChatId, pesan);
        } catch (e) {
          console.error('Auto-report error:', e.message);
        }
      },
      { timezone: WIB_TZ }
    );
  };

  start();
  return { reschedule: start };
}

module.exports = { sendTelegramMessage, buildDailyReport, scheduleDailyReport };
