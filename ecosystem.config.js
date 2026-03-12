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
            min_uptime: '20s',          // must stay up 20s to count as successful start
            restart_delay: 5000,           // wait 5s between restarts
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
            max_restarts: 10,
            min_uptime: '5s',
            restart_delay: 3000, 
            kill_timeout: 5000,
            max_memory_restart: '1G',
            env: {
                PYTHONUNBUFFERED: '1'
            },
            log_file: 'D:\\SMART DOOR LOCK\\logs\\engine-combined.log',
            out_file: 'D:\\SMART DOOR LOCK\\logs\\engine-out.log',
            error_file: 'D:\\SMART DOOR LOCK\\logs\\engine-err.log',
            time: true
        },

        // ── 3. Frontend Portal (Vite) ──────────────────────────────────────
        {
            name: 'auralock-frontend',
            script: 'node_modules/vite/bin/vite.js',
            cwd: 'D:\\SMART DOOR LOCK\\frontend',
            watch: false,
            autorestart: true,
            env: {
                NODE_ENV: 'development'
            },
            log_file: 'D:\\SMART DOOR LOCK\\logs\\frontend-combined.log',
            time: true
        },

        // ── 4. Admin Dashboard (Vite) ──────────────────────────────────────
        {
            name: 'auralock-admin',
            script: 'node_modules/vite/bin/vite.js',
            cwd: 'D:\\SMART DOOR LOCK\\admin-panel',
            watch: false,
            autorestart: true,
            env: {
                NODE_ENV: 'development'
            },
            log_file: 'D:\\SMART DOOR LOCK\\logs\\admin-combined.log',
            time: true
        },

        // ── 5. Terminal App (Vite) ─────────────────────────────────────────
        {
            name: 'auralock-terminal',
            script: 'node_modules/vite/bin/vite.js',
            cwd: 'D:\\SMART DOOR LOCK\\terminal-app',
            watch: false,
            autorestart: true,
            env: {
                NODE_ENV: 'development'
            },
            log_file: 'D:\\SMART DOOR LOCK\\logs\\terminal-combined.log',
            time: true
        }
    ]
};
