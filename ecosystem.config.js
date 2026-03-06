/**
 * ecosystem.config.js — PM2 Process Manager Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages two persistent processes:
 *   1. auralock-backend  — Node.js API server  (port 8000)
 *   2. auralock-engine   — Python biometric API (port 8001)
 *
 * Start all:        pm2 start ecosystem.config.js
 * Stop all:         pm2 stop all
 * Restart all:      pm2 restart all
 * View status:      pm2 status
 * View logs:        pm2 logs
 * Delete all:       pm2 delete all
 *
 * Windows auto-start on boot:
 *   npm install -g pm2-windows-startup
 *   pm2-startup install
 *   pm2 save
 * ─────────────────────────────────────────────────────────────────────────────
 */
module.exports = {
    apps: [
        // ── 1. Node.js Backend API ─────────────────────────────────────────
        {
            name: 'auralock-backend',
            script: 'server.js',
            cwd: 'D:\\SMART DOOR LOCK\\backend',
            watch: false,          // don't restart on file changes in prod
            autorestart: true,           // restart if the process crashes
            max_restarts: 20,             // stop trying after 20 consecutive crashes
            min_uptime: '10s',          // must stay up 10s to count as successful start
            restart_delay: 3000,           // wait 3s between restarts
            max_memory_restart: '300M',       // restart if RAM usage exceeds 300MB
            env: {
                NODE_ENV: 'production',
                PORT: 8000
            },
            log_file: 'D:\\SMART DOOR LOCK\\logs\\backend-combined.log',
            out_file: 'D:\\SMART DOOR LOCK\\logs\\backend-out.log',
            error_file: 'D:\\SMART DOOR LOCK\\logs\\backend-err.log',
            time: true            // timestamp every log line
        },

        // ── 2. Python Biometric Engine ─────────────────────────────────────
        {
            name: 'auralock-engine',
            script: 'biometric_api.py',
            interpreter: 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
            cwd: 'D:\\SMART DOOR LOCK\\edge',
            watch: false,
            autorestart: true,
            max_restarts: 20,
            min_uptime: '15s',          // python engine needs longer to start (model load)
            restart_delay: 5000,
            max_memory_restart: '500M',       // face recognition uses more RAM
            env: {
                PYTHONUNBUFFERED: '1'         // ensures python logs appear in real time
            },
            log_file: 'D:\\SMART DOOR LOCK\\logs\\engine-combined.log',
            out_file: 'D:\\SMART DOOR LOCK\\logs\\engine-out.log',
            error_file: 'D:\\SMART DOOR LOCK\\logs\\engine-err.log',
            time: true
        }
    ]
};
