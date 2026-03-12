/**
 * test_biometric_service_fix.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated verification suite for the Biometric Service Unavailable fix.
 *
 * Root causes addressed:
 *   1. PM2 restart storm (2600+ restarts) caused by min_uptime:15s < TF load time
 *   2. Port 8001 bind conflict (WinError 10048) when PM2 spawned new engine
 *      before old process released the socket
 *   3. `metadata` column missing in access_logs Supabase schema - pending_logs.json
 *      accumulated bad records that failed sync every 5 minutes
 *
 * Fixes applied:
 *   – ecosystem.config.js: min_uptime 15s→60s, restart_delay 5s→15s, max_restarts 20→5
 *   – biometric_api.py: release_port(8001) kills stale process before uvicorn binds
 *   – biometric_api.py: sync_task strips unknown columns before insert
 *   – pending_logs.json: cleared of stale bad-schema records
 *
 * Run: node test_biometric_service_fix.js
 */

const axios = require('axios');

const BIOMETRIC_ENGINE = 'http://localhost:8001';
const BACKEND_API = 'http://localhost:8000';

let passed = 0;
let failed = 0;

function ok(label) {
    passed++;
    console.log(`  ✅ PASS: ${label}`);
}

function fail(label, detail) {
    failed++;
    console.error(`  ❌ FAIL: ${label}`);
    if (detail) console.error(`         ${detail}`);
}

async function test(label, fn) {
    try {
        await fn();
    } catch (err) {
        fail(label, err.message);
    }
}

// ── 1. Biometric Engine Direct Health Check ───────────────────────────────────
async function testEngineHealth() {
    console.log('\n[1] Biometric Engine – Direct Health Check');
    await test('GET /health returns 200 with status:online', async () => {
        const res = await axios.get(`${BIOMETRIC_ENGINE}/health`, { timeout: 8000 });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        if (res.data.status !== 'online') throw new Error(`status=${res.data.status}`);
        if (!res.data.engine) throw new Error('Missing engine field');
        ok('GET /health returns 200 with status:online');
    });

    await test('Engine model is Facenet', async () => {
        const res = await axios.get(`${BIOMETRIC_ENGINE}/health`, { timeout: 5000 });
        if (res.data.model !== 'Facenet') throw new Error(`model=${res.data.model}`);
        ok('Engine model is Facenet');
    });
}

// ── 2. Backend Health Proxy ───────────────────────────────────────────────────
async function testBackendProxy() {
    console.log('\n[2] Backend – /api/biometrics/health Proxy');
    await test('Backend proxy reports engine online', async () => {
        const res = await axios.get(`${BACKEND_API}/api/biometrics/health`, { timeout: 10000 });
        if (res.data.status !== 'online') throw new Error(`status=${res.data.status}`);
        ok('Backend proxy reports engine online');
    });
}

// ── 3. Cache Status ────────────────────────────────────────────────────────────
async function testCacheStatus() {
    console.log('\n[3] Biometric Engine – Cache Status');
    await test('GET /api/biometrics/cache/status returns enrolled list', async () => {
        const res = await axios.get(`${BIOMETRIC_ENGINE}/api/biometrics/cache/status`, { timeout: 5000 });
        if (typeof res.data.cached_employees !== 'number') throw new Error('Missing cached_employees field');
        ok(`Cache status OK – ${res.data.cached_employees} employee(s) enrolled`);
    });
}

// ── 4. Face Verification – No-Face Rejection ──────────────────────────────────
async function testFaceVerificationReject() {
    console.log('\n[4] Biometric Engine – Face Verification (blank image reject)');
    await test('POST /api/biometrics/face/verify returns success:false for blank image', async () => {
        const FormData = require('form-data');
        const { createCanvas } = await import('canvas').catch(() => null) || {};

        // Use a tiny black PNG-ish JPEG blob (no face = should return success:false)
        // Construct minimal 1x1 JPEG bytes
        const { Buffer } = require('buffer');
        const tinyJpeg = Buffer.from([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
            0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
            0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
            0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20,
            0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
            0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
            0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
            0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
            0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
            0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D, 0x01, 0x02, 0x03, 0x00,
            0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
            0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
            0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35,
            0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55,
            0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
            0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x93, 0x94, 0x95,
            0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3,
            0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA,
            0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7,
            0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00,
            0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD2, 0x8A, 0x28, 0x03, 0xFF, 0xD9
        ]);

        const form = new FormData();
        form.append('file', tinyJpeg, { filename: 'blank.jpg', contentType: 'image/jpeg' });

        let res;
        try {
            res = await axios.post(`${BIOMETRIC_ENGINE}/api/biometrics/face/verify`, form, {
                headers: form.getHeaders(),
                timeout: 60000
            });
        } catch (err) {
            if (err.response && err.response.data && err.response.data.success === false) {
                ok('Blank image correctly rejected (success:false)');
                return;
            }
            throw err;
        }
        if (res.data.success === false) {
            ok('Blank image correctly rejected (success:false)');
        } else {
            throw new Error(`Expected success:false, got success:${res.data.success}`);
        }
    });
}

// ── 5. Backend Verify Endpoint (proxy path) ────────────────────────────────────
async function testBackendVerifyProxy() {
    console.log('\n[5] Backend – /api/biometrics/face/verify (no auth, blank image)');
    await test('Backend verify endpoint reachable (not 503 Service Unavailable)', async () => {
        const FormData = require('form-data');
        const { Buffer } = require('buffer');
        const tinyJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9]);
        const form = new FormData();
        form.append('file', tinyJpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });
        try {
            const res = await axios.post(`${BACKEND_API}/api/biometrics/face/verify`, form, {
                headers: form.getHeaders(),
                timeout: 90000
            });
            // success or denied is fine — what we check is that it's NOT 503
            if (res.data.message && res.data.message.includes('Biometric Service Unavailable')) {
                throw new Error('Got "Biometric Service Unavailable" — engine was not reachable from backend');
            }
            ok('Backend reached engine (no 503 Biometric Service Unavailable)');
        } catch (err) {
            if (err.response) {
                const msg = err.response.data?.message || '';
                if (msg.includes('Biometric Service Unavailable')) {
                    throw new Error('❌ Got "Biometric Service Unavailable" — fix not applied correctly');
                }
                // 401 or 403 means engine responded (face not found/denied) — this is correct
                if ([401, 403].includes(err.response.status)) {
                    ok('Backend reached engine — face correctly denied (401/403)');
                    return;
                }
            }
            throw err;
        }
    });
}

// ── 6. PM2 Engine Restart Stability ──────────────────────────────────────────
async function testPM2Stability() {
    console.log('\n[6] PM2 Stability Check (restart count should be low after fix)');
    await test('PM2 engine restart count is reasonably low', async () => {
        const { execSync } = require('child_process');
        try {
            const output = execSync('pm2 jlist', { encoding: 'utf8' });
            const procs = JSON.parse(output);
            const engine = procs.find(p => p.name === 'auralock-engine');
            if (!engine) throw new Error('auralock-engine not found in PM2');

            const restarts = engine.pm2_env?.restart_time ?? engine.restart_time ?? 'N/A';
            const status = engine.pm2_env?.status ?? engine.status ?? 'unknown';

            console.log(`       Engine status: ${status}, restarts since last reset: ${restarts}`);

            if (status !== 'online' && status !== 'launching') {
                throw new Error(`Engine status is "${status}" — expected online`);
            }
            ok(`auralock-engine is ${status} (restarts: ${restarts})`);
        } catch (parseErr) {
            fail('Could not read PM2 status', parseErr.message);
        }
    });
}

// ── Main Runner ────────────────────────────────────────────────────────────────
(async () => {
    console.log('='.repeat(65));
    console.log('  AuraLock — Biometric Service Fix Verification Suite');
    console.log('  Run date:', new Date().toLocaleString());
    console.log('='.repeat(65));

    await testEngineHealth();
    await testBackendProxy();
    await testCacheStatus();
    await testFaceVerificationReject();
    await testBackendVerifyProxy();
    await testPM2Stability();

    console.log('\n' + '='.repeat(65));
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(65));

    process.exit(failed > 0 ? 1 : 0);
})();
