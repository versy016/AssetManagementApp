/**
 * PM2 Ecosystem Config — GearOps Inventory API
 *
 * Usage on the EC2 server:
 *   pm2 delete all
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup   ← run the printed command to survive reboots
 *
 * All secrets (DATABASE_URL, AWS keys, BoldSign keys) stay in the
 * server's .env file — NOT here. Only non-secret runtime config lives
 * in this file so it can be safely committed to git.
 */
'use strict';

module.exports = {
  apps: [
    {
      name: 'gearops-api',
      script: 'server.js',
      cwd: '/home/ec2-user/deploy/AssetManagementApp/inventory-api',

      // ── Cluster mode: one worker per CPU core for better throughput
      instances: 'max',
      exec_mode: 'cluster',

      // ── Environment: lock in production mode regardless of what .env says
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Path to Firebase service account JSON on this server
        GOOGLE_APPLICATION_CREDENTIALS: '/home/ec2-user/deploy/AssetManagementApp/firebase-admin.json',
      },

      // ── Restart policy
      max_memory_restart: '512M',   // restart if worker leaks past 512 MB
      restart_delay: 2000,          // wait 2 s before restarting after crash
      max_restarts: 10,             // stop trying after 10 rapid crashes
      min_uptime: '10s',            // must stay up 10 s to count as successful start

      // ── Logging
      out_file: '/home/ec2-user/logs/gearops-api-out.log',
      error_file: '/home/ec2-user/logs/gearops-api-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // ── Watch (off in production — use pm2 reload after deploys instead)
      watch: false,
    },
  ],
};
