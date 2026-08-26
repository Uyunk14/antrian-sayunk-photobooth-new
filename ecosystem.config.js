// Konfigurasi PM2 untuk menjalankan app di VPS (CloudPanel).
// Jalankan: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'sayunk-antrian',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
