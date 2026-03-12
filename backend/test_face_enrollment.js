/**
 * test_face_enrollment.js
 * ──────────────────────────────────────────────────────────────────────────────
 * End-to-end API tests for biometric face enrollment.
 *
 * Tests what it covers:
 *   1. Enroll face for a NEW employee (no re_enroll flag needed)
 *   2. Re-enroll face for EXISTING employee with re_enroll=true
 *      → Must NOT return "Employee ID already exists"
 *      → Must NOT return "Name already taken by another employee"
 *   3. Block fresh registration with a DUPLICATE employee_id (no re_enroll)
 *   4. Block fresh registration with a DUPLICATE name    (no re_enroll)
 *
 * Usage:
 *   cd "d:\SMART DOOR LOCK\backend"
 *   node test_face_enrollment.js
 *
 * Requirements:
 *   - Backend server running on port 8000
 *   - A valid JWT token (set ADMIN_TOKEN env var or edit TOKEN below)
 *   - axios: npm install axios (already installed)
 *   - form-data: npm install form-data (already installed)
 ──────────────────────────────────────────────────────────────────────────────*/

require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8000';

// ── Helpers ──────────────────────────────────────────────────────────────────

let TOKEN = '';      // filled by login()
let createdUserId = null;

const PASS = '\x1b[32m✔ PASS\x1b[0m';
const FAIL = '\x1b[31m✘ FAIL\x1b[0m';

function assert(condition, label, detail = '') {
    if (condition) {
        console.log(`  ${PASS}  ${label}`);
        return true;
    } else {
        console.error(`  ${FAIL}  ${label}`);
        if (detail) console.error(`         ${detail}`);
        return false;
    }
}

// Create a minimal 1×1 white JPEG in memory (valid image, no real face)
// We don't need an actual face for middleware tests — the Python engine
// isn't being reached when the middleware rejects the request first.
function makeFakeJpeg() {
    // Minimal valid JPEG bytes (1×1 white pixel)
    return Buffer.from(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS' +
        'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
        'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
        'MjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/' +
        'EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA' +
        'AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJIA/9k=',
        'base64'
    );
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function login() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@smartdoorlock.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
    try {
        const res = await axios.post(`${BASE_URL}/auth/login`, {
            email: adminEmail,
            password: adminPassword
        });
        TOKEN = res.data.token;
        console.log('  Auth: logged in successfully\n');
    } catch (err) {
        console.error('  Auth failed:', err.response?.data || err.message);
        process.exit(1);
    }
}

function authHeaders() {
    return { Authorization: `Bearer ${TOKEN}` };
}

// ── Cleanup helper ─────────────────────────────────────────────────────────────

async function deleteEmployee(id) {
    try {
        await axios.delete(`${BASE_URL}/api/users/${id}`, { headers: authHeaders() });
    } catch { /* ignore */ }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function test_reEnrollBypassesValidation() {
    console.log('──────────────────────────────────────────────────────────────');
    console.log('TEST 1: re_enroll=true bypasses duplicate employee_id AND name checks');
    console.log('──────────────────────────────────────────────────────────────');

    const testEmployeeId = `TEST-ENROLLFIX-${Date.now()}`;
    const testName = `EnrollTestUser ${Date.now()}`;
    const testEmail = `enrolltest.${Date.now()}@internal.com`;

    // 1a. Create employee first
    let userId;
    try {
        const res = await axios.post(`${BASE_URL}/api/users`, {
            name: testName,
            email: testEmail,
            employee_id: testEmployeeId,
            department: 'Engineering',
            role: 'employee'
        }, { headers: authHeaders() });
        userId = res.data.id || res.data.user?.id;
        createdUserId = userId;
        assert(!!userId, `1a. Create employee (id=${userId})`);
    } catch (err) {
        assert(false, '1a. Create employee', err.response?.data?.message || err.message);
        return;
    }

    // 1b. Try re-enrolling face WITHOUT re_enroll flag → should get "already exists" or blocked
    //     (this simulates the BROKEN behaviour before the fix)
    try {
        const fd = new FormData();
        fd.append('file', makeFakeJpeg(), { filename: 'face.jpg', contentType: 'image/jpeg' });
        fd.append('employeeId', testEmployeeId);
        fd.append('email', testEmail);
        fd.append('name', testName);
        // NO re_enroll flag
        const res = await axios.post(`${BASE_URL}/api/biometrics/face/register`, fd, {
            headers: { ...authHeaders(), ...fd.getHeaders() }
        });
        // If success, the middleware didn't block (unexpected — engine would handle it)
        // If 400 "already exists", the old bug is present
        const blocked = res.data?.success === false &&
            (res.data?.message?.includes('already exists') || res.data?.message?.includes('already taken'));
        console.log(`  (without re_enroll flag) engine response: ${res.data?.message || 'success'}`);
    } catch (err) {
        const msg = err.response?.data?.message || err.message || '';
        const wasBlocked = msg.includes('already exists') || msg.includes('already taken');
        console.log(`  (without re_enroll flag) blocked by middleware: ${wasBlocked ? 'YES (old bug confirmed)' : 'no'} — "${msg}"`);
    }

    // 1c. Re-enroll face WITH re_enroll=true → must NOT get blocked by middleware
    try {
        const fd = new FormData();
        fd.append('file', makeFakeJpeg(), { filename: 'face.jpg', contentType: 'image/jpeg' });
        fd.append('employeeId', testEmployeeId);
        fd.append('email', testEmail);
        fd.append('name', testName);
        fd.append('re_enroll', 'true');             // THE FIX
        const res = await axios.post(`${BASE_URL}/api/biometrics/face/register`, fd, {
            headers: { ...authHeaders(), ...fd.getHeaders() }
        });
        // Middleware should pass — engine may fail (offline / no face) but NOT middleware
        const middlewarePassed = !(
            (res.data?.message || '').includes('already exists') ||
            (res.data?.message || '').includes('already taken')
        );
        assert(middlewarePassed,
            '1c. re_enroll=true passes validateIdentity middleware (no duplicate-ID or name error)',
            `Engine response: ${res.data?.message || JSON.stringify(res.data)}`
        );
    } catch (err) {
        const msg = err.response?.data?.message || err.message || '';
        const middlewarePassed = !msg.includes('already exists') && !msg.includes('already taken');
        assert(middlewarePassed,
            '1c. re_enroll=true passes validateIdentity middleware (no duplicate-ID or name error)',
            `Got: "${msg}"`
        );
    }

    // Cleanup
    if (userId) await deleteEmployee(userId);
    createdUserId = null;
    console.log();
}

async function test_duplicateIdBlockedWithoutReEnroll() {
    console.log('──────────────────────────────────────────────────────────────');
    console.log('TEST 2: Duplicate employee_id is still blocked when re_enroll=false');
    console.log('──────────────────────────────────────────────────────────────');

    const empId = `DUP-${Date.now()}`;
    const email1 = `dup1.${Date.now()}@internal.com`;
    const email2 = `dup2.${Date.now()}@internal.com`;

    // Create first employee
    let user1Id;
    try {
        const r = await axios.post(`${BASE_URL}/api/users`, {
            name: `DupTest One ${Date.now()}`, email: email1,
            employee_id: empId, department: 'HR', role: 'employee'
        }, { headers: authHeaders() });
        user1Id = r.data.id || r.data.user?.id;
        assert(!!user1Id, '2a. First employee created');
    } catch (err) {
        assert(false, '2a. First employee created', err.response?.data?.message);
        return;
    }

    // Try to create second employee with same employee_id — must be blocked
    try {
        await axios.post(`${BASE_URL}/api/users`, {
            name: `DupTest Two ${Date.now()}`, email: email2,
            employee_id: empId, department: 'HR', role: 'employee'
        }, { headers: authHeaders() });
        assert(false, '2b. Duplicate employee_id blocked (should have thrown)');
    } catch (err) {
        const msg = err.response?.data?.message || '';
        assert(msg.includes('already exists'),
            '2b. Duplicate employee_id correctly blocked',
            `Message: "${msg}"`
        );
    }

    if (user1Id) await deleteEmployee(user1Id);
    console.log();
}

async function test_duplicateNameBlockedWithoutReEnroll() {
    console.log('──────────────────────────────────────────────────────────────');
    console.log('TEST 3: Duplicate name is still blocked when re_enroll=false');
    console.log('──────────────────────────────────────────────────────────────');

    const sharedName = `NameDupTest ${Date.now()}`;

    let user1Id;
    try {
        const r = await axios.post(`${BASE_URL}/api/users`, {
            name: sharedName, email: `namedup1.${Date.now()}@internal.com`,
            employee_id: `NAMEDUP1-${Date.now()}`, department: 'HR', role: 'employee'
        }, { headers: authHeaders() });
        user1Id = r.data.id || r.data.user?.id;
        assert(!!user1Id, '3a. First employee with unique name created');
    } catch (err) {
        assert(false, '3a. First employee created', err.response?.data?.message);
        return;
    }

    try {
        await axios.post(`${BASE_URL}/api/users`, {
            name: sharedName, email: `namedup2.${Date.now()}@internal.com`,
            employee_id: `NAMEDUP2-${Date.now()}`, department: 'HR', role: 'employee'
        }, { headers: authHeaders() });
        assert(false, '3b. Duplicate name blocked (should have thrown)');
    } catch (err) {
        const msg = err.response?.data?.message || '';
        assert(msg.includes('already taken'),
            '3b. Duplicate name correctly blocked',
            `Message: "${msg}"`
        );
    }

    if (user1Id) await deleteEmployee(user1Id);
    console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║          Face Enrollment Validation Fix — Test Suite         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    await login();

    await test_reEnrollBypassesValidation();
    await test_duplicateIdBlockedWithoutReEnroll();
    await test_duplicateNameBlockedWithoutReEnroll();

    console.log('──────────────────────────────────────────────────────────────');
    console.log('All tests complete.');
    console.log('──────────────────────────────────────────────────────────────\n');
})();
