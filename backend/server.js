require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');
const upload = multer({ storage: multer.memoryStorage() });
const validateIdentity = require('./middleware/validateIdentity');
const validateDevice = require('./middleware/validateDevice');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit-table');
const doorService = require('./doorService');

const app = express();
const PORT = process.env.PORT || 8000;
// --- Configuration & Initialization ---
// ── Service Discovery ──
let PYTHON_ENGINE_URL = process.env.PYTHON_ENGINE_URL || 'http://localhost:8001';

console.log('🧬 [Biometrics] Target Engine:', PYTHON_ENGINE_URL);

console.log('🚀 [Config] ADMIN_EMAIL:', process.env.ADMIN_EMAIL);
console.log('🚀 [Config] ADMIN_PASSWORD:', process.env.ADMIN_PASSWORD ? 'SET' : 'MISSING');
console.log('🚀 [Config] JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'MISSING');
console.log('🚀 [Config] SUPABASE_URL:', process.env.SUPABASE_URL);

// --- Security: Rate Limiters ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login attempts per window
    message: { message: 'Too many login attempts, please try again after 15 minutes.' }
});

const biometricLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // Limit each IP to 60 face verification scans per minute
    message: { error: 'Too many scans, please wait a minute.' }
});

// --- Security: Brute-Force Tracker ---
const loginFailures = new Map(); // In-memory tracker
const logRateLimiter = new Map(); // Rate limiter for Access Logs (3s)
const LOG_THROTTLE_MS = 3000;

// --- Supabase Connection ---
const supabaseUrl = process.env.SUPABASE_URL || "https://wdtizlzfsijikcejerwq.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors({
    origin: '*', // Allow connections from ANY origin (including Wi-Fi IP and arbitrary phones)
    // credentials: true (Must be removed if origin is '*')
}));

app.use(express.json());

// --- Static File Serving (Admin Dashboard) ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
// doorRoute removed (declared at line 263 with authentication)

/*
app.get('/', (req, res) => {
    ...
});
*/

app.get('/api/diag', async (req, res) => {
    const dns = require('dns').promises;
    const results = {
        env: {},
        lookups: {}
    };

    // 1. Filtered Env
    Object.keys(process.env).forEach(k => {
        if (!k.includes('KEY') && !k.includes('SECRET') && !k.includes('PASSWORD')) {
            results.env[k] = process.env[k];
        }
    });

    // 2. DNS Lookups
    const hosts = [
        'smart-door-edge',
        'smart-door-edge-957b',
        'localhost',
        '127.0.0.1'
    ];

    for (const host of hosts) {
        try {
            const lookup = await dns.lookup(host);
            results.lookups[host] = { address: lookup.address, family: lookup.family, health: {} };
            
            const axios = require('axios');
            const ports = [8001, 10000, 8000, 80];
            
            for (const port of ports) {
                try {
                    const testUrl = `http://${lookup.address}:${port}/health`;
                    const start = Date.now();
                    const resp = await axios.get(testUrl, { timeout: 1200 });
                    results.lookups[host].health[port] = { 
                        status: 'OK', 
                        latency: Date.now() - start,
                        data: resp.data 
                    };
                } catch (err) {
                    results.lookups[host].health[port] = { error: err.message };
                }
            }
        } catch (e) {
            results.lookups[host] = { error: e.message };
        }
    }

    res.json(results);
});

// Request Logger Middleware
app.use((req, res, next) => {
    console.log(`📡 [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    if (req.method === 'POST') {
        const logBody = { ...req.body };
        if (logBody.faceEncoding) logBody.faceEncoding = "[ENCODING_DATA]";
        console.log('📦 Body:', JSON.stringify(logBody, null, 2));
    }
    next();
});

// --- Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
        if (err) {
            console.error("❌ Token Verification Failed:", err.message);
            return res.status(403).json({ error: "Forbidden", message: "Invalid or expired token" });
        }

        try {
            // --- Security Check: Account Status ---
            if (user.role !== 'admin') {
                const { data: dbUser, error: dbError } = await supabase.from('employees').select('status').eq('email', user.email).single();

                if (dbError) {
                    console.error("❌ Database Status Check Error:", dbError.message);
                    // If user not found, that's fine, but other errors should be logged
                }

                if (dbUser && dbUser.status !== 'Active') {
                    return res.status(403).json({ error: "Access Denied", message: "Account is disabled or deleted" });
                }
            }

            console.log("🔓 Authenticated User:", user.email);
            req.user = user;
            next();
        } catch (statusError) {
            console.error("❌ Critical Auth Middleware Error:", statusError.message);
            // Don't crash the server, but deny access if we can't verify status
            return res.status(500).json({ error: "Internal Server Error", message: "Authentication validation failed" });
        }
    });
};

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: "Access Denied", message: "Admin privileges required" });
    }
};

// --- Attendance Logic ---
/**
 * Records check-in or check-out for an employee.
 * Returns an object with status message and attendance detail.
 */
const recordAttendance = async (employeeId, method, deviceId = 'server') => {
    try {
        // Map common synonyms to DB-allowed values
        let mappedMethod = method;
        const normalizedMethod = (method || 'face').toLowerCase();
        if (['facial_recognition', 'face_recognition', 'face'].includes(normalizedMethod)) mappedMethod = 'face';
        else if (['phone_fingerprint', 'mobile_biometric', 'fingerprint'].includes(normalizedMethod)) mappedMethod = 'fingerprint';
        else mappedMethod = 'face';

        const today = new Date().toISOString().split('T')[0];
        console.log(`🕒 [Attendance Debug] Checking for ${employeeId} on ${today} with method: ${mappedMethod}`);

        // Check for existing record for today
        const { data: existing, error: fetchError } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('date', today)
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
            console.error("❌ Attendance Fetch Error:", fetchError.message, fetchError.code);
            throw new Error(`Database error fetching attendance: ${fetchError.message}`);
        }

        if (!existing) {
            // ── Check-in ──
            console.log(`🕒 [Attendance] Checking IN employee: ${employeeId}`);
            const checkInTime = new Date();
            const checkInIso = checkInTime.toISOString();

            // Late arrival detection (IST)
            const OFFICE_START_HOUR = 9;
            const GRACE_PERIOD_MINUTES = 15;
            const lateThresholdMins = OFFICE_START_HOUR * 60 + GRACE_PERIOD_MINUTES;

            const checkInIST = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
            const [h, m] = checkInIST.split(':').map(Number);
            const checkInMins = h * 60 + m;

            const arrivalStatus = checkInMins > lateThresholdMins ? 'LATE' : 'ON_TIME';
            console.log(`🕒 [Attendance] Arrival status: ${arrivalStatus} (check-in at ${checkInIST})`);

            const { error: insError } = await supabase.from('attendance').insert({
                employee_id: employeeId,
                date: today,
                check_in: checkInIso,
                method: mappedMethod,
                device_id: deviceId,
                status: arrivalStatus
            });
            if (insError) {
                console.error("❌ Attendance Insert Error:", insError.message);
                throw new Error(`Insert failed: ${insError.message}`);
            }
            return {
                message: "Check-in recorded",
                check_in: checkInIso,
                check_out: null,
                working_hours: null,
                status: arrivalStatus
            };

        } else {
            // Security: Throttle duplicate scans (2-minute guard)
            const lastActivity = new Date(existing.check_out || existing.check_in);
            const diffSeconds = (new Date() - lastActivity) / 1000;

            if (diffSeconds < 120) {
                console.log(`🕒 [Attendance] Ignoring duplicate scan for ${employeeId} (${Math.round(diffSeconds)}s since last activity)`);
                return {
                    message: "Duplicate scan ignored",
                    check_in: existing.check_in,
                    check_out: existing.check_out,
                    working_hours: existing.working_hours || null,
                    status: existing.status || null
                };
            }

            // ── Rolling Check-out (Update every time) ──
            console.log(`🕒 [Attendance] Updating check-out for employee: ${employeeId}`);
            const checkOutTime = new Date();
            const workingHours = parseFloat(
                ((checkOutTime - new Date(existing.check_in)) / (1000 * 60 * 60)).toFixed(2)
            );

            const { error: updError } = await supabase.from('attendance').update({
                check_out: checkOutTime.toISOString(),
                working_hours: workingHours,
                method: mappedMethod, // update method if different
                device_id: deviceId    // update device if different
            }).eq('id', existing.id);

            if (updError) {
                console.error("❌ Attendance Update Error:", updError.message);
                throw new Error(`Update failed: ${updError.message}`);
            }
            return {
                message: "Check-out updated",
                check_in: existing.check_in,
                check_out: checkOutTime.toISOString(),
                working_hours: workingHours,
                status: existing.status || null
            };
        }
    } catch (error) {
        console.error("❌ Critical Attendance Error:", error.message);
        throw error;
    }
};

// Dedicated Attendance Marking Endpoint
// Handles both internal and external (biometric engine) calls
app.post(['/api/attendance/mark', '/attendance/mark'], async (req, res) => {
    try {
        const { employee_id, id, method, device_id } = req.body;
        const targetId = employee_id || id;

        if (!targetId) {
            return res.status(400).json({ error: "Missing employee identifier (employee_id or id)" });
        }

        console.log(`🎯 [Attendance Mark] Processing mark request for: ${targetId}`);

        // 1. Resolve to UUID if it looks like a custom employee_id string
        let finalUuid = targetId;
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

        if (!uuidRegex.test(targetId)) {
            const { data: emp, error: empErr } = await supabase
                .from('employees')
                .select('id')
                .eq('employee_id', targetId)
                .single();

            if (empErr || !emp) {
                console.error(`❌ [Attendance Mark] Could not resolve ID: ${targetId}`);
                return res.status(404).json({ error: "Employee not found or ID invalid" });
            }
            finalUuid = emp.id;
        }

        // 2. Record Attendance
        const attendanceResult = await recordAttendance(finalUuid, method || 'face', device_id || 'api_call');

        res.json(attendanceResult);
    } catch (error) {
        console.error("❌ [Attendance Mark] Critical Error:", error.message);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
});


// --- IoT Utilities ---
/**
 * Safely triggers the door unlock without breaking the main flow
 */
const safeTriggerDoorUnlock = async () => {
    try {
        console.log("🔓 [Trigger] Calling door unlock service...");
        const result = await doorService.unlockDoor();
        if (!result.success) {
            console.warn(`⚠️ [Trigger] Door unlock service reported failure: ${result.message}`);
        } else {
            console.log("✅ [Trigger] Door unlock service successful");
        }
    } catch (error) {
        console.error("❌ [Trigger] Critical error calling door unlock service:", error.message);
    }
};

// --- Routes ---
const bleRoutes = require('./ble_route');
const doorRoute = require('./door_route');
app.use('/api/ble', authenticateToken, bleRoutes);
app.use('/api/door', authenticateToken, doorRoute);

// Login Endpoint
app.post('/auth/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const ip = req.ip;

    // --- Security: Brute-Force Check ---
    const failures = loginFailures.get(ip) || { count: 0, lastTry: 0 };
    if (failures.count >= 5 && (Date.now() - failures.lastTry < 300000)) { // 5 min lockout
        return res.status(429).json({ message: 'IP temporarily locked out. Try later.' });
    }

    try {
        console.log(`🔐 [Login Attempt] Email: "${email}", Expected: "${process.env.ADMIN_EMAIL}"`);
        console.log(`🔑 [Login Attempt] Pass Match: ${password === process.env.ADMIN_PASSWORD}`);

        if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
            console.log("✅ Admin credentials verified");
            loginFailures.delete(ip); // Reset on success
            const user = { name: 'Super Admin', email: email, role: 'admin' };
            const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '24h' });
            return res.json({ token: accessToken, user });
        }

        console.warn("❌ Invalid credentials attempt");
        // Track failures
        failures.count++;
        failures.lastTry = Date.now();
        loginFailures.set(ip, failures);

        return res.status(401).json({ message: 'Invalid credentials' });
    } catch (error) {
        console.error("❌ Login error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Dashboard Stats Endpoint
app.get('/api/stats', async (req, res) => {
    try {
        // ── Timezone-correct "today" date string ─────────────────────────────
        // CRITICAL: Node runs in UTC. toISOString().split('T')[0] gives the UTC
        // date which is 5h30m behind IST. After IST midnight, setHours(0,0,0,0)
        // + toISOString() = YESTERDAY in UTC → query misses today's records.
        // Fix: use Intl.DateTimeFormat to get the IST calendar date directly.
        const todayIST = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata'
        }).format(new Date()); // → "2026-03-06"

        // IST midnight as a UTC moment (for access_logs timestamp comparisons)
        // IST = UTC+5:30, so IST midnight = UTC 18:30 of previous day
        const istMidnightUTC = new Date(`${todayIST}T00:00:00+05:30`).toISOString();

        // ── Parallel DB queries ───────────────────────────────────────────────
        const [
            { count: activeEmployeeCount },
            { count: faceCount },
            { count: fingerCount },
            { count: rfidCount },
            { count: todayGranted },
            { data: attendanceToday },
            { count: scansToday }
        ] = await Promise.all([
            // Total active employees
            supabase.from('employees')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'Active'),

            // Face-enrolled employees
            supabase.from('employees')
                .select('*', { count: 'exact', head: true })
                .not('face_embedding', 'is', null)
                .eq('status', 'Active'),

            // Fingerprint records
            supabase.from('fingerprints')
                .select('*', { count: 'exact', head: true }),

            // RFID tags
            supabase.from('rfid_tags')
                .select('*', { count: 'exact', head: true }),

            // Successful access grants today
            supabase.from('access_logs')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'success')
                .gte('created_at', istMidnightUTC),

            // Today's attendance records (IST date column is a plain DATE string)
            supabase.from('attendance')
                .select('employee_id, check_in, status')
                .eq('date', todayIST)
                .not('check_in', 'is', null),

            // Total scans (all statuses) today
            supabase.from('access_logs')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', istMidnightUTC)
        ]);

        const totalEmployees = activeEmployeeCount || 0;
        const presentToday = attendanceToday?.length || 0;
        const absentToday = Math.max(0, totalEmployees - presentToday);

        // ── Late arrivals: check_in IST time > 09:15 ─────────────────────────
        // check_in is stored as a UTC ISO timestamp; convert to IST before comparing.
        const LATE_HOUR = 9, LATE_MIN = 15; // 09:15 IST
        const lateToday = (attendanceToday || []).filter(a => {
            if (!a.check_in) return false;
            const checkInIST = new Date(a.check_in).toLocaleTimeString('en-US', {
                timeZone: 'Asia/Kolkata',
                hour12: false,
                hour: '2-digit',
                minute: '2-digit'
            }); // → "09:22"
            const [h, m] = checkInIST.split(':').map(Number);
            return (h * 60 + m) > (LATE_HOUR * 60 + LATE_MIN);
        }).length;

        console.log(`📊 [Stats] todayIST=${todayIST} | employees=${totalEmployees} | present=${presentToday} | late=${lateToday} | scans=${scansToday}`);

        res.json({
            // ── Primary KPI fields (snake_case)
            total_employees: totalEmployees,
            present_today: presentToday,
            absent_today: absentToday,
            late_today: lateToday,
            total_scans_today: scansToday || 0,
            // ── Legacy camelCase aliases (backwards compat)
            totalUsers: totalEmployees,
            faceProfiles: faceCount || 0,
            fingerprints: fingerCount || 0,
            rfidCards: rfidCount || 0,
            todayEntries: todayGranted || 0,
            failedAttempts: 0,
            isPresent: presentToday,
            absentToday,
            lateToday: lateToday,
            trends: {
                users: '+2', faces: '+1', fingerprints: '0', rfid: '+1',
                entries: '+12%', failures: '-5%'
            }
        });
    } catch (error) {
        console.error("❌ Stats error:", error.message || error);
        res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
});

// ─── Employee Attendance History Endpoint ───────────────────────────────────
app.get('/api/attendance/employee/:employee_id', authenticateToken, async (req, res) => {
    try {
        const { employee_id } = req.params;
        const { startDate, endDate, page = 1, limit = 10 } = req.query;

        const pgLimit = parseInt(limit, 10) || 10;
        const offset = (parseInt(page, 10) - 1) * pgLimit;

        // 1. Resolve UUID
        let finalUuid = employee_id;
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

        let employeeData;
        if (!uuidRegex.test(employee_id)) {
            const { data: emp, error: empErr } = await supabase
                .from('employees')
                .select('id, name, department, employee_id')
                .eq('employee_id', employee_id)
                .single();

            if (empErr || !emp) return res.status(404).json({ error: "Employee not found" });
            finalUuid = emp.id;
            employeeData = emp;
        } else {
            const { data: emp, error: empErr } = await supabase
                .from('employees')
                .select('id, name, department, employee_id')
                .eq('id', employee_id)
                .single();
            if (empErr || !emp) return res.status(404).json({ error: "Employee not found" });
            employeeData = emp;
        }

        // 2. Query attendance
        let q = supabase
            .from('attendance')
            .select('*, employees(name, employee_id, department)', { count: 'exact' })
            .eq('employee_id', finalUuid)
            .order('date', { ascending: false });

        if (startDate) q = q.gte('date', startDate);
        if (endDate) q = q.lte('date', endDate);

        const { data, count, error } = await q.range(offset, offset + pgLimit - 1);
        if (error) throw error;

        res.json({
            employee: employeeData,
            data: data || [],
            total: count || 0,
            page: parseInt(page, 10),
            limit: pgLimit
        });
    } catch (error) {
        console.error('❌ Get employee attendance error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ─── Employee Attendance Summary Endpoint ───────────────────────────────────
app.get('/api/attendance/employee/:employee_id/summary', authenticateToken, async (req, res) => {
    try {
        const { employee_id } = req.params;
        const { startDate, endDate } = req.query;

        // Resolve UUID
        let finalUuid = employee_id;
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        if (!uuidRegex.test(employee_id)) {
            const { data: emp } = await supabase.from('employees').select('id').eq('employee_id', employee_id).single();
            if (!emp) return res.status(404).json({ error: "Employee not found" });
            finalUuid = emp.id;
        }

        let q = supabase.from('attendance').select('status, working_hours, check_in').eq('employee_id', finalUuid);
        if (startDate) q = q.gte('date', startDate);
        if (endDate) q = q.lte('date', endDate);

        const { data, error } = await q;
        if (error) throw error;

        const summary = {
            total_days: data.length,
            present_days: data.filter(r => r.check_in).length,
            late_days: data.filter(r => r.status === 'LATE').length,
            total_work_hours: parseFloat(data.reduce((sum, r) => sum + (r.working_hours || 0), 0).toFixed(2))
        };

        res.json(summary);
    } catch (error) {
        console.error('❌ Get attendance summary error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ─── Attendance Listing Endpoint ────────────────────────────────────────────
// Supports: date range, employee_id, department, name search, pagination, sorting
app.get('/api/attendance', authenticateToken, async (req, res) => {
    try {
        const {
            startDate: sd,
            endDate: ed,
            date,
            employee_id,
            department,
            search,
            page = 1,
            pageSize = 10,
            sortBy = 'date',
            sortDir = 'desc',
        } = req.query;

        const today = new Date().toISOString().split('T')[0];
        const fromDate = sd || date || today;
        const toDate = ed || date || today;
        const limit = parseInt(pageSize, 10) || 10;
        const offset = (parseInt(page, 10) - 1) * limit;

        // Whitelist sort columns
        const allowedCols = ['date', 'check_in', 'check_out', 'working_hours', 'status'];
        const col = allowedCols.includes(sortBy) ? sortBy : 'date';
        const asc = sortDir === 'asc';

        // Build base query
        const buildQuery = (head = false) => {
            let q = supabase
                .from('attendance')
                .select('*, employees!inner(name, employee_id, image_url, department)', head ? { count: 'exact', head: true } : { count: 'exact' })
                .gte('date', fromDate)
                .lte('date', toDate);

            if (employee_id) q = q.eq('employee_id', employee_id);
            if (department) q = q.eq('employees.department', department);
            if (search) q = q.ilike('employees.name', `%${search}%`);
            return q;
        };

        // Count + data in parallel
        const [{ count }, { data, error }] = await Promise.all([
            buildQuery(true),
            buildQuery(false).order(col, { ascending: asc }).range(offset, offset + limit - 1),
        ]);

        if (error) throw error;

        res.json({ data: data || [], total: count || 0 });
    } catch (error) {
        console.error('❌ Get attendance error:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.get('/api/attendance/export/excel/:employee_id', authenticateToken, async (req, res) => {
    const resolved = await resolveEmployeeUuid(req.params.employee_id);
    if (!resolved) return res.status(404).json({ error: "Employee not found" });
    req.query.employee_id = resolved;
    return handleExcelExport(req, res);
});

// ─── Employee PDF Export ────────────────────────────────────────────────────
app.get('/api/attendance/export/pdf/:employee_id', authenticateToken, async (req, res) => {
    const resolved = await resolveEmployeeUuid(req.params.employee_id);
    if (!resolved) return res.status(404).json({ error: "Employee not found" });
    req.query.employee_id = resolved;
    return handlePdfExport(req, res);
});

// Helper to resolve employee UUID for exports
async function resolveEmployeeUuid(idOrEid) {
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (uuidRegex.test(idOrEid)) return idOrEid;
    const { data } = await supabase.from('employees').select('id').eq('employee_id', idOrEid).single();
    return data ? data.id : null;
}

// Helper to resolve human-readable employee_id (e.g. EMP-0001)
async function resolveEmployeeEid(idOrEid) {
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(idOrEid)) return idOrEid;
    const { data } = await supabase.from('employees').select('employee_id').eq('id', idOrEid).single();
    return data ? data.employee_id : null;
}

// Helper to handle Excel Export (Extracted for reuse)
async function handleExcelExport(req, res) {
    try {
        const { month, year, employee_id, department, startDate: sd, endDate: ed } = req.query;
        const now = new Date();

        // ── Resolve date range ──
        let fromDate, toDate;
        if (month && year) {
            fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
            toDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        } else {
            fromDate = sd || now.toISOString().split('T')[0];
            toDate = ed || now.toISOString().split('T')[0];
        }

        // ── Fetch data ──
        let q = supabase
            .from('attendance')
            .select('*, employees!inner(name, employee_id, department, image_url)')
            .gte('date', fromDate)
            .lte('date', toDate)
            .order('date', { ascending: false });

        if (employee_id) q = q.eq('employee_id', employee_id);
        if (department) q = q.eq('employees.department', department);

        const { data: records, error } = await q;
        if (error) throw error;

        // ── Build workbook ──
        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        wb.creator = 'AuraLock Admin';
        wb.lastModifiedBy = 'AuraLock';
        wb.created = now;
        wb.modified = now;

        const ws = wb.addWorksheet('Attendance Registry', {
            pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
        });

        // Title row
        ws.mergeCells('A1:H1');
        const titleCell = ws.getCell('A1');
        titleCell.value = `Attendance Registry  |  ${fromDate}  →  ${toDate}`;
        titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 32;

        // Subtitle row
        ws.mergeCells('A2:H2');
        const sub = ws.getCell('A2');
        sub.value = `Generated: ${now.toLocaleString('en-IN')}  |  Department: ${department || 'All'}`;
        sub.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
        sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        sub.alignment = { horizontal: 'center' };
        ws.getRow(2).height = 18;

        // Blank spacer
        ws.getRow(3).height = 6;

        // ── Header row (row 4) ──
        const HEADERS = [
            { header: 'Employee Name', key: 'name', width: 24 },
            { header: 'Department', key: 'department', width: 16 },
            { header: 'Date', key: 'date', width: 14 },
            { header: 'Check In', key: 'check_in', width: 14 },
            { header: 'Check Out', key: 'check_out', width: 14 },
            { header: 'Working Hours', key: 'working_hours', width: 16 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Method', key: 'method', width: 14 },
        ];

        ws.columns = HEADERS.map(h => ({ key: h.key, width: h.width }));

        const headerRow = ws.getRow(4);
        HEADERS.forEach((h, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = h.header;
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
            cell.border = {
                bottom: { style: 'medium', color: { argb: 'FF3B82F6' } },
            };
        });
        headerRow.height = 22;

        // ── Helper: format timestamp ──
        const fmtTs = (iso) => {
            if (!iso) return '—';
            const d = new Date(iso);
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
        };

        const fmtWH = (rec) => {
            if (rec.working_hours != null) {
                const h = Math.floor(rec.working_hours);
                const m = Math.round((rec.working_hours - h) * 60);
                return `${h}h ${String(m).padStart(2, '0')}m`;
            }
            if (!rec.check_in || !rec.check_out) return '—';
            const mins = Math.round((new Date(rec.check_out) - new Date(rec.check_in)) / 60000);
            return `${Math.floor(mins / 60)}h ${mins % 60}m`;
        };

        // ── Data rows ──
        (records || []).forEach((rec, idx) => {
            const rowNum = 5 + idx;
            const row = ws.getRow(rowNum);
            const isEven = idx % 2 === 0;

            const values = [
                rec.employees?.name || '—',
                rec.employees?.department || 'General',
                rec.date || '—',
                fmtTs(rec.check_in),
                fmtTs(rec.check_out),
                fmtWH(rec),
                rec.status || '—',
                (rec.method || '—').toUpperCase(),
            ];

            // Row background: LATE = amber tint, ON_TIME = green tint, else alternating
            let rowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';
            if (rec.status === 'LATE') rowBg = 'FFFFF7ED'; // amber-50
            if (rec.status === 'ON_TIME') rowBg = 'FFF0FDF4'; // green-50

            values.forEach((val, ci) => {
                const cell = row.getCell(ci + 1);
                cell.value = val;
                cell.font = { name: 'Calibri', size: 10 };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
                cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'left' : 'center' };

                // Status cell colour override
                if (ci === 6) {
                    if (val === 'LATE') { cell.font = { ...cell.font, bold: true, color: { argb: 'FFD97706' } }; }
                    if (val === 'ON_TIME') { cell.font = { ...cell.font, bold: true, color: { argb: 'FF059669' } }; }
                }
            });

            row.height = 18;
        });

        // ── Summary footer ──
        const footerRow = ws.getRow(5 + (records || []).length);
        const totalLate = (records || []).filter(r => r.status === 'LATE').length;
        const totalOnTime = (records || []).filter(r => r.status === 'ON_TIME').length;
        ws.mergeCells(`A${footerRow.number}:H${footerRow.number}`);
        const footerCell = footerRow.getCell(1);
        footerCell.value = `Total: ${(records || []).length} records  •  On Time: ${totalOnTime}  •  Late: ${totalLate}`;
        footerCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } };
        footerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        footerCell.alignment = { horizontal: 'center' };
        footerRow.height = 16;

        // ── Stream response ──
        const filename = `attendance_${fromDate}_to_${toDate}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await wb.xlsx.write(res).then(() => res.end());

    } catch (error) {
        console.error('❌ Excel Export Error:', error);
        res.status(500).json({ error: 'Export failed' });
    }
}

app.get('/api/attendance/export/excel', authenticateToken, handleExcelExport);

// ─── PDF Export Helper & Endpoint ───────────────────────────────────────────
async function handlePdfExport(req, res) {
    try {
        const { month, year, employee_id, department, startDate: sd, endDate: ed } = req.query;
        const now = new Date();

        // ── Date range ──
        let fromDate, toDate;
        if (month && year) {
            fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
            toDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        } else {
            fromDate = sd || now.toISOString().split('T')[0];
            toDate = ed || now.toISOString().split('T')[0];
        }

        // ── Fetch records ──
        let q = supabase
            .from('attendance')
            .select('*, employees!inner(name, employee_id, department)')
            .gte('date', fromDate)
            .lte('date', toDate)
            .order('date', { ascending: false });

        if (employee_id) q = q.eq('employee_id', employee_id);
        if (department) q = q.eq('employees.department', department);

        const { data: records, error } = await q;
        if (error) throw error;

        // ── Colour helpers (PDFKit uses RGB 0-255) ──
        const C = {
            navy: [15, 23, 42],
            slate: [30, 41, 59],
            mid: [71, 85, 105],
            muted: [148, 163, 184],
            white: [255, 255, 255],
            blue: [59, 130, 246],
            emerald: [16, 185, 129],
            amber: [245, 158, 11],
            rowEven: [248, 250, 252],
            rowOdd: [255, 255, 255],
            rowLate: [255, 251, 235],
            rowOT: [240, 253, 244],
        };

        // ── Time formatters ──
        const fmtTs = iso => {
            if (!iso) return '—';
            const d = new Date(iso);
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        };

        const fmtWH = rec => {
            if (rec.working_hours != null) {
                const h = Math.floor(rec.working_hours);
                const m = Math.round((rec.working_hours - h) * 60);
                return `${h}h ${String(m).padStart(2, '0')}m`;
            }
            if (!rec.check_in || !rec.check_out) return '—';
            const mins = Math.round((new Date(rec.check_out) - new Date(rec.check_in)) / 60000);
            return `${Math.floor(mins / 60)}h ${mins % 60}m`;
        };

        // ── Build PDF ──
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, autoFirstPage: true });

        // Stream straight to response
        const filename = `attendance_${fromDate}_to_${toDate}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        const PAGE_W = doc.page.width - 72;  // usable width
        const PAGE_H = doc.page.height;
        const L = 36;                     // left margin

        // ── HEADER BANNER ──────────────────────────────────────────────────
        doc.rect(0, 0, doc.page.width, 72).fill(C.navy);

        // Company name
        doc.fillColor(C.white).font('Helvetica-Bold').fontSize(20)
            .text('AuraLock', L, 16);
        doc.fillColor(C.blue).font('Helvetica').fontSize(9)
            .text('SMART BIOMETRIC ACCESS CONTROL', L, 40);

        // Report title (right-aligned)
        doc.fillColor(C.white).font('Helvetica-Bold').fontSize(14)
            .text('ATTENDANCE REPORT', 0, 22, { align: 'right', width: doc.page.width - L });

        // ── SUBHEADER ─────────────────────────────────────────────────────
        doc.rect(0, 72, doc.page.width, 24).fill(C.slate);
        doc.fillColor(C.muted).font('Helvetica').fontSize(8)
            .text(`Period: ${fromDate}  →  ${toDate}   |   Department: ${department || 'All'}   |   Generated: ${now.toLocaleString('en-IN')}`,
                L, 80, { width: PAGE_W });

        doc.moveDown(0);

        // ── SUMMARY PILLS ─────────────────────────────────────────────────
        const totalRecs = records.length;
        const lateCount = records.filter(r => r.status === 'LATE').length;
        const onTimeCount = records.filter(r => r.status === 'ON_TIME').length;
        const totalMinutes = records.reduce((sum, r) => {
            if (r.working_hours) return sum + r.working_hours * 60;
            if (r.check_in && r.check_out)
                return sum + (new Date(r.check_out) - new Date(r.check_in)) / 60000;
            return sum;
        }, 0);
        const totalHrs = `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`;

        const pills = [
            { label: 'TOTAL RECORDS', val: totalRecs, color: C.blue },
            { label: 'ON TIME', val: onTimeCount, color: C.emerald },
            { label: 'LATE', val: lateCount, color: C.amber },
            { label: 'TOTAL WORK HRS', val: totalHrs, color: C.blue },
        ];
        const pillW = 120, pillH = 36, pillY = 108, pillGap = 16;
        let pillX = L;
        pills.forEach(p => {
            doc.roundedRect(pillX, pillY, pillW, pillH, 6).fill([...p.color.map(v => v / 255 * 20 + 235)].map(Math.round));
            doc.fillColor(p.color).font('Helvetica-Bold').fontSize(14).text(String(p.val), pillX + 8, pillY + 4, { width: pillW - 16, align: 'center' });
            doc.fillColor(C.mid).font('Helvetica').fontSize(7).text(p.label, pillX + 4, pillY + 22, { width: pillW - 8, align: 'center' });
            pillX += pillW + pillGap;
        });

        // ── TABLE HEADER ──────────────────────────────────────────────────
        const tableY = pillY + pillH + 14;
        const COLS = [
            { label: 'Employee', w: 130 },
            { label: 'Dept', w: 72 },
            { label: 'Date', w: 68 },
            { label: 'In', w: 42 },
            { label: 'Out', w: 42 },
            { label: 'Work Hrs', w: 54 },
            { label: 'Status', w: 52 },
            { label: 'Method', w: 50 },
        ];

        let cx = L;
        doc.rect(L, tableY, PAGE_W, 18).fill(C.slate);
        COLS.forEach(col => {
            doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7.5)
                .text(col.label, cx + 4, tableY + 5, { width: col.w - 6 });
            cx += col.w;
        });

        // ── TABLE ROWS ────────────────────────────────────────────────────
        const ROW_H = 17;
        let curY = tableY + 18;
        let pageN = 1;

        const drawRowSeparator = () => {
            doc.moveTo(L, curY).lineTo(L + PAGE_W, curY).strokeColor(C.muted).lineWidth(0.3).stroke();
        };

        const checkPageBreak = () => {
            if (curY + ROW_H > PAGE_H - 50) {
                doc.addPage();
                // Repeat mini-header on new page
                doc.rect(0, 0, doc.page.width, 22).fill(C.navy);
                doc.fillColor(C.white).font('Helvetica').fontSize(8)
                    .text(`AuraLock Attendance Report • ${fromDate} → ${toDate}  (continued)`, L, 7);
                cx = L;
                doc.rect(L, 28, PAGE_W, 16).fill(C.slate);
                COLS.forEach(col => {
                    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7)
                        .text(col.label, cx + 4, 32, { width: col.w - 6 });
                    cx += col.w;
                });
                curY = 44;
                pageN++;
            }
        };

        records.forEach((rec, idx) => {
            checkPageBreak();

            // Row background
            let bg = idx % 2 === 0 ? C.rowEven : C.rowOdd;
            if (rec.status === 'LATE') bg = C.rowLate;
            if (rec.status === 'ON_TIME') bg = C.rowOT;
            doc.rect(L, curY, PAGE_W, ROW_H).fill(bg);

            const rowVals = [
                rec.employees?.name || '—',
                rec.employees?.department || '—',
                rec.date || '—',
                fmtTs(rec.check_in),
                fmtTs(rec.check_out),
                fmtWH(rec),
                rec.status === 'LATE' ? 'LATE' : rec.status === 'ON_TIME' ? 'ON TIME' : '—',
                (rec.method || '—').toUpperCase(),
            ];

            cx = L;
            rowVals.forEach((val, ci) => {
                let textColor = C.slate;
                if (ci === 6 && rec.status === 'LATE') textColor = [180, 83, 9];   // amber-700
                if (ci === 6 && rec.status === 'ON_TIME') textColor = [4, 120, 87];  // emerald-700

                const font = (ci === 6 && rec.status) ? 'Helvetica-Bold' : 'Helvetica';
                doc.fillColor(textColor).font(font).fontSize(7.5)
                    .text(val, cx + 4, curY + 4, { width: COLS[ci].w - 6, ellipsis: true, lineBreak: false });
                cx += COLS[ci].w;
            });

            curY += ROW_H;
            drawRowSeparator();
        });

        // ── DEPARTMENT SUMMARY ────────────────────────────────────────────
        checkPageBreak();
        curY += 12;
        doc.rect(L, curY, PAGE_W, 18).fill(C.navy);
        doc.fillColor(C.white).font('Helvetica-Bold').fontSize(8).text('DEPARTMENT WORKING HOURS SUMMARY', L + 4, curY + 5);
        curY += 18;

        const deptMap = {};
        records.forEach(r => {
            const dept = r.employees?.department || 'General';
            if (!deptMap[dept]) deptMap[dept] = { count: 0, totalMins: 0, late: 0 };
            deptMap[dept].count++;
            if (r.working_hours) deptMap[dept].totalMins += r.working_hours * 60;
            else if (r.check_in && r.check_out)
                deptMap[dept].totalMins += (new Date(r.check_out) - new Date(r.check_in)) / 60000;
            if (r.status === 'LATE') deptMap[dept].late++;
        });

        // dept summary header
        const DS = [{ label: 'Department', w: 160 }, { label: 'Records', w: 70 }, { label: 'Late', w: 60 }, { label: 'Total Hrs', w: 90 }, { label: 'Avg Hrs/Day', w: 90 }];
        cx = L;
        doc.rect(L, curY, PAGE_W, 15).fill(C.slate);
        DS.forEach(c => {
            doc.fillColor(C.white).font('Helvetica-Bold').fontSize(7).text(c.label, cx + 4, curY + 4, { width: c.w - 6 });
            cx += c.w;
        });
        curY += 15;

        Object.entries(deptMap).forEach(([dept, s], idx) => {
            checkPageBreak();
            doc.rect(L, curY, PAGE_W, 15).fill(idx % 2 === 0 ? C.rowEven : C.rowOdd);
            const totalH = Math.floor(s.totalMins / 60);
            const totalM = Math.round(s.totalMins % 60);
            const avgMins = s.count ? s.totalMins / s.count : 0;
            const row = [dept, s.count, s.late, `${totalH}h ${totalM}m`, `${Math.floor(avgMins / 60)}h ${Math.round(avgMins % 60)}m`];
            cx = L;
            row.forEach((v, ci) => {
                doc.fillColor(C.slate).font('Helvetica').fontSize(7.5)
                    .text(String(v), cx + 4, curY + 3, { width: DS[ci].w - 6 });
                cx += DS[ci].w;
            });
            curY += 15;
        });

        // ── FOOTER ────────────────────────────────────────────────────────
        const pageRange = doc.bufferedPageRange();
        for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
            doc.switchToPage(i);
            doc.rect(0, PAGE_H - 22, doc.page.width, 22).fill(C.navy);
            doc.fillColor(C.muted).font('Helvetica').fontSize(7)
                .text(`AuraLock Smart Door Lock System  •  Confidential  •  Page ${i - pageRange.start + 1} of ${pageRange.count}`,
                    L, PAGE_H - 14, { align: 'center', width: PAGE_W });
        }

        doc.end();

    } catch (error) {
        console.error('❌ PDF export error:', error);
        if (!res.headersSent)
            res.status(500).json({ error: 'PDF export failed', details: error.message });
    }
}

app.get('/api/attendance/export/pdf', authenticateToken, handlePdfExport);

// Attendance Report Endpoint (Last 7 Days)
app.get('/api/attendance/report', async (req, res) => {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);

        const { data: reportData, error } = await supabase
            .from('attendance')
            .select('date, check_in')
            .gte('date', startDate.toISOString().split('T')[0])
            .lte('date', endDate.toISOString().split('T')[0]);

        if (error) throw error;

        // Group by date
        const countsByDate = {};
        const LATE_THRESHOLD = "09:00:00";

        for (let i = 0; i < 7; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            countsByDate[dateStr] = { date: dateStr, present: 0, late: 0 };
        }

        if (reportData) {
            reportData.forEach(row => {
                if (countsByDate[row.date]) {
                    countsByDate[row.date].present++;
                    if (row.check_in) {
                        const checkInTime = new Date(row.check_in).toTimeString().split(' ')[0];
                        if (checkInTime > LATE_THRESHOLD) {
                            countsByDate[row.date].late++;
                        }
                    }
                }
            });
        }

        res.json(Object.values(countsByDate));
    } catch (error) {
        console.error("❌ Report error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Monthly Attendance Report Endpoint
app.get('/api/attendance/monthly-report', authenticateToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) {
            return res.status(400).json({ error: "Month and Year are required" });
        }

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0); // Last day of month
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        // 1. Fetch all active employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('id, name, employee_id, department')
            .neq('status', 'Deleted');

        if (empError) throw empError;

        // 2. Fetch all attendance for the month
        const { data: attendanceData, error: attError } = await supabase
            .from('attendance')
            .select('employee_id, date, check_in, check_out')
            .gte('date', startDateStr)
            .lte('date', endDateStr);

        if (attError) throw attError;

        // 3. Calculate working days (exclude weekends)
        let workingDaysCount = 0;
        const tempDate = new Date(startDate);
        while (tempDate <= endDate) {
            const day = tempDate.getDay();
            if (day !== 0 && day !== 6) { // Not Sunday or Saturday
                workingDaysCount++;
            }
            tempDate.setDate(tempDate.getDate() + 1);
        }

        // 4. Aggregate data
        const LATE_THRESHOLD = "09:00:00";
        const report = employees.map(emp => {
            const empAtt = attendanceData.filter(a => a.employee_id === emp.id);
            const presentDays = new Set(empAtt.map(a => a.date)).size;
            const absentDays = Math.max(0, workingDaysCount - presentDays);

            let lateDays = 0;
            let totalMins = 0;

            empAtt.forEach(a => {
                if (a.check_in) {
                    const checkInTime = new Date(a.check_in).toTimeString().split(' ')[0];
                    if (checkInTime > LATE_THRESHOLD) lateDays++;

                    if (a.check_out) {
                        const mins = (new Date(a.check_out) - new Date(a.check_in)) / (1000 * 60);
                        if (mins > 0) totalMins += mins;
                    }
                }
            });

            return {
                id: emp.id,
                name: emp.name,
                employee_id: emp.employee_id,
                department: emp.department || 'General',
                presentDays,
                absentDays,
                lateDays,
                totalWorkHours: (totalMins / 60).toFixed(1)
            };
        });

        res.json({
            month: parseInt(month),
            year: parseInt(year),
            workingDaysInMonth: workingDaysCount,
            data: report
        });
    } catch (error) {
        console.error("❌ Monthly report error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Attendance Analytics Endpoint
app.get('/api/stats/attendance-analytics', authenticateToken, async (req, res) => {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const LATE_THRESHOLD = '09:00:00';

        // --- Daily Trend: last 15 days ---
        const fifteenDaysAgo = new Date(now);
        fifteenDaysAgo.setDate(now.getDate() - 14);
        const dailyStart = fifteenDaysAgo.toISOString().split('T')[0];

        // --- Monthly ranges ---
        const currMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
        const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

        // Run all three queries in parallel for minimal latency
        const [
            { data: dailyAtt, error: dailyErr },
            { data: currMonAtt, error: currMonErr },
            { data: prevMonAtt, error: prevMonErr },
            { data: employees, error: empErr },
            { data: sixMonthAtt, error: sixMonErr },
        ] = await Promise.all([
            supabase.from('attendance')
                .select('date, check_in, employee_id')
                .gte('date', dailyStart).lte('date', today),
            supabase.from('attendance')
                .select('employee_id')
                .gte('date', currMonthStart).lte('date', today),
            supabase.from('attendance')
                .select('employee_id')
                .gte('date', prevMonthStart).lte('date', prevMonthEnd),
            supabase.from('employees')
                .select('id, department')
                .neq('status', 'Deleted'),
            // Last 6 months for monthly rate chart
            supabase.from('attendance')
                .select('date, employee_id')
                .gte('date', new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().split('T')[0])
                .lte('date', today),
        ]);

        if (dailyErr) throw dailyErr;
        if (currMonErr) throw currMonErr;
        if (prevMonErr) throw prevMonErr;
        if (empErr) throw empErr;
        if (sixMonErr) throw sixMonErr;

        // 1. Build daily trend (last 15 days)
        const dailyMap = {};
        for (let i = 14; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            const key = d.toISOString().split('T')[0];
            dailyMap[key] = { date: key, present: 0, late: 0 };
        }
        (dailyAtt || []).forEach(a => {
            if (!dailyMap[a.date]) return;
            // Count unique employees per day as present (deduplicated inside the map)
            dailyMap[a.date].present++;
            if (a.check_in) {
                const t = new Date(a.check_in).toTimeString().split(' ')[0];
                if (t > LATE_THRESHOLD) dailyMap[a.date].late++;
            }
        });
        const dailyTrend = Object.values(dailyMap);

        // 2. Monthly comparison
        const currMonthPresent = new Set((currMonAtt || []).map(a => a.employee_id)).size;
        const prevMonthPresent = new Set((prevMonAtt || []).map(a => a.employee_id)).size;
        const monthlyGrowth = prevMonthPresent === 0
            ? 0
            : Math.round(((currMonthPresent - prevMonthPresent) / prevMonthPresent) * 100);

        // 3. Department breakdown
        const deptHeadcountMap = {};
        (employees || []).forEach(emp => {
            const dept = emp.department || 'General';
            deptHeadcountMap[dept] = (deptHeadcountMap[dept] || 0) + 1;
        });

        const todayAttEmpIds = new Set(
            (dailyAtt || []).filter(a => a.date === today).map(a => a.employee_id)
        );
        const deptPresentMap = {};
        (employees || []).forEach(emp => {
            const dept = emp.department || 'General';
            if (todayAttEmpIds.has(emp.id)) {
                deptPresentMap[dept] = (deptPresentMap[dept] || 0) + 1;
            }
        });

        const departmentComparison = Object.entries(deptHeadcountMap).map(([dept, total]) => ({
            department: dept,
            total,
            present: deptPresentMap[dept] || 0,
            absent: total - (deptPresentMap[dept] || 0),
        }));

        // 4. Monthly attendance rate (last 6 months)
        const totalEmployees = (employees || []).length || 1; // avoid division by zero
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthlyRateMap = {};
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyRateMap[key] = { month: monthNames[d.getMonth()], unique: new Set(), rate: 0 };
        }
        (sixMonthAtt || []).forEach(a => {
            const key = a.date?.slice(0, 7); // YYYY-MM
            if (monthlyRateMap[key]) monthlyRateMap[key].unique.add(a.employee_id);
        });
        const monthlyRate = Object.values(monthlyRateMap).map(m => ({
            month: m.month,
            rate: Math.min(100, Math.round((m.unique.size / totalEmployees) * 100)),
            count: m.unique.size,
        }));

        res.json({
            dailyTrend,
            monthly: {
                current: currMonthPresent,
                previous: prevMonthPresent,
                growthPercent: monthlyGrowth,
            },
            monthlyRate,
            departmentComparison,
        });
    } catch (error) {
        console.error('❌ Attendance Analytics Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Activity Trend Endpoint (24h)
app.get('/api/stats/activity', async (req, res) => {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const { data: logs, error } = await supabase
            .from('access_logs')
            .select('created_at, status, confidence')
            .gte('created_at', twentyFourHoursAgo.toISOString())
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Initialize 24 empty hourly buckets
        const history = [];
        for (let i = 23; i >= 0; i--) {
            const time = new Date(Date.now() - i * 60 * 60 * 1000);
            time.setMinutes(0, 0, 0);
            history.push({
                time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                timestamp: time.getTime(),
                Face: 0,
                Fingerprint: 0,
                RFID: 0,
                Denied: 0
            });
        }

        // Aggregate logs into buckets
        logs.forEach(log => {
            const logTime = new Date(log.created_at);
            logTime.setMinutes(0, 0, 0);
            const bucket = history.find(b => Math.abs(b.timestamp - logTime.getTime()) < 30 * 60 * 1000);

            if (bucket) {
                if (log.status === 'success') {
                    // Inference logic if 'method' column is missing or null
                    const method = (log.confidence && log.confidence > 0) ? 'Face' : 'RFID';
                    bucket[method]++;
                } else {
                    bucket.Denied++;
                }
            }
        });

        res.json(history);
    } catch (error) {
        console.error("❌ Activity stats error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ─── Security Logs Endpoint ───────────────────────────────────────────────────
// Filters: status, method, device_id, startDate, endDate, search (employee name)
// ─── Simplified Access Logs Endpoint ─────────────────────────────────────────
app.get('/api/access-logs', authenticateToken, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            startDate,
            endDate,
            employee_name,
            device,
            result,
        } = req.query;

        const pgLimit = Math.min(parseInt(limit, 10) || 20, 100);
        const from = (parseInt(page, 10) - 1) * pgLimit;
        const to = from + pgLimit - 1;

        let q = supabase
            .from('access_logs')
            .select('*, employees(name, employee_id, department, image_url)', { count: 'exact' })
            .order('created_at', { ascending: false });

        if (result) q = q.eq('status', result);
        if (device) q = q.eq('device_id', device);
        if (startDate) q = q.gte('created_at', `${startDate}T00:00:00.000Z`);
        if (endDate) q = q.lte('created_at', `${endDate}T23:59:59.999Z`);
        if (employee_name || req.query.search) {
            const pattern = `%${employee_name || req.query.search}%`;
            q = q.ilike('employees.name', pattern);
        }

        const { data: logs, count, error } = await q.range(from, to);
        if (error) throw error;

        res.json({
            logs: logs || [],
            total: count || 0,
            pagination: {
                total: count || 0,
                page: parseInt(page, 10),
                limit: pgLimit
            }
        });
    } catch (error) {
        console.error('❌ Access logs error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ─── Employee Access History Endpoint ─────────────────────────────────────────
app.get('/api/access-logs/employee/:employee_id', authenticateToken, async (req, res) => {
    try {
        const { employee_id } = req.params;
        const { startDate, endDate, page = 1, limit = 20 } = req.query;

        const resolved = await resolveEmployeeEid(employee_id);
        if (!resolved) return res.status(404).json({ error: "Employee not found" });

        const pgLimit = Math.min(parseInt(limit, 10) || 20, 100);
        const from = (parseInt(page, 10) - 1) * pgLimit;
        const to = from + pgLimit - 1;

        let q = supabase
            .from('access_logs')
            .select('*, employees(name, employee_id, department, image_url)', { count: 'exact' })
            .eq('employee_id', resolved)
            .order('created_at', { ascending: false });

        if (startDate) q = q.gte('created_at', `${startDate}T00:00:00.000Z`);
        if (endDate) q = q.lte('created_at', `${endDate}T23:59:59.999Z`);

        const { data: logs, count, error } = await q.range(from, to);
        if (error) throw error;

        res.json({ logs: logs || [], total: count || 0 });
    } catch (error) {
        console.error('❌ Employee access logs error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ─── Employee Access Summary Endpoint ─────────────────────────────────────────
app.get('/api/access-logs/employee/:employee_id/summary', authenticateToken, async (req, res) => {
    try {
        const { employee_id } = req.params;
        const resolved = await resolveEmployeeEid(employee_id);
        if (!resolved) return res.status(404).json({ error: "Employee not found" });

        const istOffset = 5.5 * 60 * 60 * 1000;
        const nowIST = new Date(Date.now() + istOffset);
        const todayStr = nowIST.toISOString().split('T')[0];
        const istMidnightUTC = new Date(new Date(todayStr).getTime() - istOffset).toISOString();

        const startOfMonthIST = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
        const istMonthStartUTC = new Date(startOfMonthIST.getTime() - istOffset).toISOString();

        const [
            { count: totalScans },
            { count: todayScans },
            { count: thisMonthScans },
            { data: lastScanArr }
        ] = await Promise.all([
            supabase.from('access_logs').select('*', { count: 'exact', head: true }).eq('employee_id', resolved),
            supabase.from('access_logs').select('*', { count: 'exact', head: true }).eq('employee_id', resolved).gte('created_at', istMidnightUTC),
            supabase.from('access_logs').select('*', { count: 'exact', head: true }).eq('employee_id', resolved).gte('created_at', istMonthStartUTC),
            supabase.from('access_logs').select('created_at').eq('employee_id', resolved).order('created_at', { ascending: false }).limit(1)
        ]);

        res.json({
            total_scans: totalScans || 0,
            today_scans: todayScans || 0,
            this_month_scans: thisMonthScans || 0,
            last_scan: lastScanArr?.[0]?.created_at || null
        });
    } catch (error) {
        console.error('❌ Access summary error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ─── Access Logs Export Handlers ──────────────────────────────────────────────

async function handleAccessExcelExport(req, res) {
    try {
        const { startDate, endDate, employee_id, device, result, month, year } = req.query;
        const now = new Date();

        let fromDate, toDate;
        if (month && year) {
            fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
            toDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        } else {
            fromDate = startDate || now.toISOString().split('T')[0];
            toDate = endDate || now.toISOString().split('T')[0];
        }

        let q = supabase
            .from('access_logs')
            .select('*, employees(name, employee_id, department)')
            .gte('created_at', `${fromDate}T00:00:00.000Z`)
            .lte('created_at', `${toDate}T23:59:59.999Z`)
            .order('created_at', { ascending: false });

        if (employee_id) q = q.eq('employee_id', employee_id);
        if (device) q = q.eq('device_id', device);
        if (result) q = q.eq('status', result);

        const { data: records, error } = await q;
        if (error) throw error;

        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Access Logs');

        ws.columns = [
            { header: 'Employee', key: 'name', width: 25 },
            { header: 'ID', key: 'eid', width: 15 },
            { header: 'Method', key: 'method', width: 12 },
            { header: 'Timestamp', key: 'ts', width: 22 },
            { header: 'Confidence', key: 'conf', width: 12 },
            { header: 'Device', key: 'device', width: 15 },
            { header: 'Result', key: 'result', width: 12 }
        ];

        records.forEach(r => {
            ws.addRow({
                name: r.employees?.name || 'Unknown',
                eid: r.employees?.employee_id || '—',
                method: (r.method || 'face').toUpperCase(),
                ts: new Date(r.created_at).toLocaleString('en-IN'),
                conf: r.confidence ? `${Math.round(r.confidence * 100)}%` : '—',
                device: r.device_id || '—',
                result: (r.status || 'failed').toUpperCase()
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="access_logs_${fromDate}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('❌ Access Excel Export Error:', error);
        res.status(500).json({ error: 'Export failed' });
    }
}

async function handleAccessPdfExport(req, res) {
    try {
        const { startDate, endDate, employee_id, device, result, month, year } = req.query;
        const now = new Date();

        let fromDate, toDate;
        if (month && year) {
            fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
            toDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        } else {
            fromDate = startDate || now.toISOString().split('T')[0];
            toDate = endDate || now.toISOString().split('T')[0];
        }

        let q = supabase
            .from('access_logs')
            .select('*, employees(name, employee_id, department)')
            .gte('created_at', `${fromDate}T00:00:00.000Z`)
            .lte('created_at', `${toDate}T23:59:59.999Z`)
            .order('created_at', { ascending: false });

        if (employee_id) q = q.eq('employee_id', employee_id);
        if (device) q = q.eq('device_id', device);
        if (result) q = q.eq('status', result);

        const { data: records, error } = await q;
        if (error) throw error;

        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: 'A4', margin: 30 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="access_logs_${fromDate}.pdf"`);
        doc.pipe(res);

        // Header
        doc.fontSize(20).text('AuraLock Access Audit Log', { align: 'center' });
        doc.fontSize(10).text(`Period: ${fromDate} to ${toDate}`, { align: 'center' });
        doc.moveDown();

        // Table
        const startY = doc.y;
        const colWidths = [120, 80, 100, 80, 70, 70];
        const headers = ['Employee', 'Method', 'Timestamp', 'Confidence', 'Device', 'Status'];

        let cx = 30;
        doc.font('Helvetica-Bold').fontSize(10);
        headers.forEach((h, i) => {
            doc.text(h, cx, startY);
            cx += colWidths[i];
        });
        doc.moveTo(30, startY + 15).lineTo(565, startY + 15).stroke();

        let curY = startY + 25;
        doc.font('Helvetica').fontSize(9);
        records.slice(0, 100).forEach(r => {
            if (curY > 750) { doc.addPage(); curY = 30; }
            cx = 30;
            const row = [
                r.employees?.name || 'Unknown',
                (r.method || 'face').toUpperCase(),
                new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }),
                r.confidence ? `${Math.round(r.confidence * 100)}%` : '—',
                r.device_id || '—',
                (r.status || 'failed').toUpperCase()
            ];
            row.forEach((v, i) => {
                doc.text(String(v), cx, curY, { width: colWidths[i] - 5, ellipsis: true });
                cx += colWidths[i];
            });
            curY += 20;
        });

        doc.end();
    } catch (error) {
        console.error('❌ Access PDF Export Error:', error);
        res.status(500).json({ error: 'Export failed' });
    }
}

// Access Export Routes
app.get('/api/access-logs/export/excel', authenticateToken, handleAccessExcelExport);
app.get('/api/access-logs/export/pdf', authenticateToken, handleAccessPdfExport);

app.get('/api/access-logs/export/excel/:employee_id', authenticateToken, async (req, res) => {
    const resolved = await resolveEmployeeEid(req.params.employee_id);
    if (!resolved) return res.status(404).json({ error: "Employee not found" });
    req.query.employee_id = resolved;
    return handleAccessExcelExport(req, res);
});

app.get('/api/access-logs/export/pdf/:employee_id', authenticateToken, async (req, res) => {
    const resolved = await resolveEmployeeEid(req.params.employee_id);
    if (!resolved) return res.status(404).json({ error: "Employee not found" });
    req.query.employee_id = resolved;
    return handleAccessPdfExport(req, res);
});

// IoT Activity Log Endpoint (Internal)
app.post('/api/logs/iot', async (req, res) => {
    const { method, id, status, message, signature, timestamp } = req.body;
    const secret = process.env.ESP32_SECRET;

    // --- Security: HMAC Verification for Device logs ---
    if (signature === 'internal_request') {
        console.log("⚡ [IoT Log] Accepting internal request from unified app.");
    } else {
        if (!signature || !timestamp) return res.sendStatus(401);

        // Check drift (60 sec)
        if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 60) {
            console.warn("⚠️ [IoT Security] Stale log timestamp rejected.");
            return res.status(403).json({ error: "Stale timestamp" });
        }

        const payload = JSON.stringify({ method, id, status, message, timestamp });
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(payload);
        const expectedSignature = hmac.digest('hex');

        if (signature !== expectedSignature) {
            console.error("❌ [IoT Security] Invalid signature from device!");
            return res.status(401).json({ error: "Invalid integrity signature" });
        }
    }

    try {
        if (status === 'LOW_BATTERY' || status === 'CRITICAL_BATTERY') {
            console.warn(`🔋 [POWER ALERT] ${status}: ${message}`);
        } else {
            console.log(`🔔 [IoT Event] ${method} unlock by ID #${id}: ${status}`);
        }

        // Rate limiting for failed/unknown biometric events
        if (status !== 'success') {
            const key = `iot_${id || 'unknown'}_${method}`;
            const lastLog = logRateLimiter.get(key);
            if (lastLog && (Date.now() - lastLog) < LOG_THROTTLE_MS) {
                return res.json({ success: true, throttled: true });
            }
            logRateLimiter.set(key, Date.now());
        }

        // Record in access_logs
        await supabase.from('access_logs').insert({
            employee_id: id === 0 ? null : (id || null),
            status: (status === 'LOW_BATTERY' || status === 'CRITICAL_BATTERY') ? 'warning' : (status || 'success'),
            confidence: 1.0,
            device_id: 'esp32_hardware',
            method: (method === 'fingerprint' ? 'FINGERPRINT' : (method || 'FACE')),
            metadata: {
                method,
                message,
                status,
                unlock_source: 'BIOMETRIC'
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error("❌ IoT Log error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Users Endpoints

// Public Terminal Fetch (Unauthenticated - safe for kiosk)
app.get('/api/terminal/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('employees')
            .select('id, employee_id, name, email, department, image_url, status')
            .eq('status', 'Active')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("❌ Terminal fetch error:", error);
            return res.status(500).json({ message: "Failed to load users" });
        }
        res.json(users || []);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "System error" });
    }
});

app.get('/api/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { includeDeleted = 'false' } = req.query;

        // Select only real DB columns and join with biometric status
        let query = supabase.from('employees').select(`
            id, employee_id, name, email, role, department, status,
            image_url, created_at, updated_at, is_deleted,
            face_templates(id),
            fingerprint_templates(id)
        `);

        if (includeDeleted !== 'true') {
            query = query.neq('status', 'Deleted');
        }

        const { data: users, error } = await query;

        if (error) {
            console.error("❌ Get users Supabase error:", error.message, error.code, error.details);
            throw error;
        }

        // Transform results to include simple booleans for the frontend
        const transformedUsers = (users || []).map(u => ({
            ...u,
            face_registered: !!(u.face_templates?.length > 0),
            fingerprint_registered: !!(u.fingerprint_templates?.length > 0),
            // Strip the internal objects to keep frontend data clean
            face_templates: undefined,
            fingerprint_templates: undefined,
            face_embedding: undefined // Ensure legacy field is not leaked
        }));

        res.json(transformedUsers);
    } catch (error) {
        console.error("❌ Get users error:", error.message || error);
        res.status(500).json({
            error: "Internal Server Error",
            message: error.message || "Failed to fetch employees",
            hint: "Check backend logs and Supabase connectivity"
        });
    }
});

app.patch('/api/users/:id', authenticateToken, isAdmin, validateIdentity, async (req, res) => {
    try {
        const { id } = req.params;
        const rawUpdates = req.body;

        // Fetch existing user to check for ID changes and biometric status
        const { data: existingUser, error: fetchErr } = await supabase
            .from('employees')
            .select('employee_id, face_embedding')
            .eq('id', id)
            .single();
        
        if (fetchErr || !existingUser) {
            return res.status(404).json({ error: "Employee not found" });
        }
        
        const old_eid = existingUser.employee_id;

        // Whitelist: only allow columns that actually exist in the employees table.
        // Silently drop any frontend-only fields to prevent Supabase errors.
        const ALLOWED_COLUMNS = new Set([
            'name', 'email', 'role', 'department', 'status',
            'employee_id', 'image_url', 'is_deleted', 'face_embedding'
        ]);
        
        const updates = Object.fromEntries(
            Object.entries(rawUpdates).filter(([k]) => ALLOWED_COLUMNS.has(k))
        );

        // Handle Fingerprint registration flag from frontend
        if (rawUpdates.fingerprint_registered === true) {
            const eid = rawUpdates.employee_id || old_eid;
            console.log(`📝 [Biometric] Marking fingerprint as registered for ${eid}`);
            try {
                await supabase.from('fingerprint_templates').upsert({
                    employee_id: eid,
                    template_data: 'ENROLLED_VIA_ADMIN_MOCK'
                }, { on_conflict: 'employee_id' });
            } catch (fpErr) {
                console.warn("⚠️ Fingerprint record upsert failed:", fpErr.message);
            }
        }

        // Apply employee update if there are valid fields
        let updatedUser = { ...existingUser, id };
        if (Object.keys(updates).length > 0) {
            console.log(`📝 [Update] Applying employee update for UUID ${id}...`);
            const { data, error } = await supabase
                .from('employees')
                .update(updates)
                .eq('id', id)
                .select('id, employee_id, name, email, role, department, status, image_url, created_at, updated_at, is_deleted, face_embedding')
                .single();

            if (error) {
                console.error("❌ [Update] Employee update failed:", error.message);
                throw error;
            }
            updatedUser = data;
        } else if (!rawUpdates.fingerprint_registered && !rawUpdates.face_registered) {
            return res.status(400).json({ error: "No valid fields to update.", received: Object.keys(rawUpdates) });
        } else {
            // If we only updated biometrics, re-fetch the user record for the response
            const { data } = await supabase.from('employees').select('*').eq('id', id).single();
            updatedUser = data;
        }

        // Handle Biometric Cache Eviction if ID changed
        const new_eid = updatedUser.employee_id;
        if (old_eid && new_eid !== old_eid) {
            console.log(`🔄 [Cache] Evicting old biometric cache for ID: ${old_eid}`);
            try {
                await axios.delete(
                    `${PYTHON_ENGINE_URL}/api/biometrics/face/${encodeURIComponent(old_eid)}`,
                    { timeout: 3000 }
                );
            } catch (ce) {
                console.warn(`⚠️ [Cache] Old ID eviction skipped: ${ce.message}`);
            }
        }

        // Fetch real-time biometric status for the response
        const [
            { count: faceCount },
            { count: fpCount }
        ] = await Promise.all([
            supabase.from('face_templates').select('id', { count: 'exact', head: true }).eq('employee_id', updatedUser.employee_id),
            supabase.from('fingerprint_templates').select('id', { count: 'exact', head: true }).eq('employee_id', updatedUser.employee_id)
        ]);

        res.json({
            ...updatedUser,
            face_embedding: undefined,
            face_registered: faceCount > 0 || !!updatedUser.face_embedding,
            fingerprint_registered: fpCount > 0
        });
    } catch (error) {
        console.error("❌ Update user error:", error.message || error);
        res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
});

app.post('/api/users', authenticateToken, validateIdentity, async (req, res) => {
    try {
        const { employeeId, employee_id, name, email, role, faceEncoding, image_url, rfid, fingerprint_id } = req.body;
        const finalId = employeeId || employee_id;

        const { data: newUser, error } = await supabase
            .from('employees')
            .upsert({
                employee_id: finalId,
                name,
                email,
                role: role === 'admin' ? 'admin' : 'employee',
                face_embedding: faceEncoding,
                image_url
            }, { on_conflict: 'employee_id' })
            .select()
            .single();

        if (error) {
            console.error("❌ Supabase Upsert Error:", error);
            throw error;
        }

        // --- Persist RFID if provided ---
        if (rfid) {
            await supabase.from('rfid_tags').upsert({
                tag_id: rfid,
                employee_id: finalId
            }, { on_conflict: 'tag_id' });
        }

        // --- Persist Fingerprint if provided ---
        if (fingerprint_id) {
            await supabase.from('fingerprints').upsert({
                id: fingerprint_id,
                employee_id: finalId,
                template_data: `MOCK_TEMPLATE_${fingerprint_id}` // Mock for now
            }, { on_conflict: 'id' });
        }

        console.log("✅ User created/updated in Supabase:", newUser.employee_id);
        res.status(201).json(newUser);
    } catch (error) {
        console.error("❌ Create user error:", error);

        // Detect HTML error pages (like Cloudflare 5xx)
        if (typeof error.message === 'string' && error.message.includes('<!DOCTYPE html>')) {
            return res.status(503).json({
                success: false,
                message: "Supabase service temporarily unavailable (Network/SSL Error). Please retry in a few moments."
            });
        }

        res.status(400).json({ message: error.message });
    }
});

app.delete('/api/users/:id', authenticateToken, isAdmin, async (req, res) => {
    let attempts = 0;
    const cleanedTables = new Set();
    const maxAttempts = 15;

    try {
        const { id } = req.params;
        console.log(`🗑️ Initializing recursive purge for subject: ${id}`);

        // 1. Resolve Employee ID (needed for linked tables)
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        const isUUID = uuidRegex.test(id);
        let employee_id = id;

        if (isUUID) {
            const { data: emp } = await supabase.from('employees').select('employee_id').eq('id', id).single();
            if (emp) employee_id = emp.employee_id;
        }

        // Recursive deletion helper
        const recursivePurge = async () => {
            attempts++;
            if (attempts > maxAttempts) throw new Error("Maximum purge depth reached. Possible circular reference.");

            const { data, error } = await supabase
                .from('employees')
                .delete()
                .match(isUUID ? { id: id } : { employee_id: id })
                .select()
                .single();

            if (error) {
                console.log(`🔍 Purge Attempt ${attempts} Error:`, JSON.stringify(error));
                // Check if it's Foreign Key Violation (Postgres Code 23503)
                if (error.code === '23503' || error.message?.includes('foreign key constraint')) {
                    // Extract the blockng table (usually the last "on table" in the message)
                    const matches = [...error.message.matchAll(/on table "([^"]+)"/g)];
                    const tableName = matches.length > 0 ? matches[matches.length - 1][1] : null;

                    console.log(`🔍 Extracted blocking table: ${tableName}`);
                    if (tableName && !cleanedTables.has(tableName)) {
                        console.log(`⚠️ Blocked by table [${tableName}]. Attempting manual cleanup...`);
                        cleanedTables.add(tableName);

                        // Clean up referencing records in the blocking table
                        // Coverage: employee_id, id, user_id (most common FK columns)
                        await supabase.from(tableName).delete().eq('employee_id', employee_id);
                        if (isUUID) {
                            await supabase.from(tableName).delete().eq('id', id);
                            await supabase.from(tableName).delete().eq('user_id', id);
                        }

                        // Retry deletion
                        return await recursivePurge();
                    }
                }
                throw error; // If not a fixable FK error, or if we already tried that table
            }
            return data;
        };

        const deletedUser = await recursivePurge();

        if (!deletedUser) {
            return res.status(404).json({ error: "Subject not found in primary cluster." });
        }

        // ── Biometric Cache Eviction (non-blocking) ──────────────────────────
        // Remove deleted employee's face from the Python engine's local cache
        // so the same person can re-enroll without a 'Biometric Conflict' error.
        const evictionEmployeeId = deletedUser.employee_id || employee_id;
        console.log(`🧹 Evicting biometric cache for: ${evictionEmployeeId}`);

        try {
            // 1. Evict specific entry from face_cache.json
            await axios.delete(
                `${PYTHON_ENGINE_URL}/api/biometrics/face/${encodeURIComponent(evictionEmployeeId)}`,
                { timeout: 5000 }
            );
            console.log(`✅ Biometric cache evicted for ${evictionEmployeeId}`);
        } catch (cacheErr) {
            console.warn(`⚠️ Biometric engine offline — cache will sync on next restart: ${cacheErr.message}`);
        }

        try {
            // 2. Trigger full cache rebuild to ensure consistency
            await axios.post(`${PYTHON_ENGINE_URL}/api/biometrics/cache/rebuild`, {}, { timeout: 5000 });
            console.log('✅ Biometric cache rebuilt after employee deletion');
        } catch (rebuildErr) {
            console.warn(`⚠️ Cache rebuild skipped (engine offline): ${rebuildErr.message}`);
        }

        console.log(`✅ Success: Subject ${deletedUser.employee_id} and dependencies in [${Array.from(cleanedTables).join(', ')}] purged.`);
        res.json({
            success: true,
            message: "User and all biometric data permanently removed.",
            purged_subsystems: Array.from(cleanedTables)
        });

    } catch (error) {
        console.error("❌ Recursive Purge Error:", error.message);
        res.status(500).json({
            error: "Database deletion failed",
            details: error.message,
            hint: "Please ensure all associated biometric hardware is online and syncing."
        });
    }
});
// Biometric Support (Mock Fallback when Python API is offline)
app.post('/api/biometrics/face/register', upload.single('file'), validateIdentity, async (req, res) => {
    try {
        const { employeeId, email, name } = req.body;
        console.log(`📸 Received biometric registration for: ${employeeId}`);

        if (!employeeId) {
            return res.status(400).json({ success: false, message: "Missing employeeId" });
        }

        let imageUrl = null;

        // --- Hybrid Registration Flow (Hardened) ---
        try {
            if (req.file) {
                const FormData = require('form-data');
                const form = new FormData();
                form.append('file', req.file.buffer, {
                    filename: 'register.jpg',
                    contentType: 'image/jpeg'
                });
                form.append('employeeId', employeeId);
                form.append('email', email || `${employeeId}@internal.com`);
                if (name) form.append('name', name);
                if (req.body.re_enroll) form.append('re_enroll', req.body.re_enroll);

                console.log("📡 Forwarding to Biometric Engine (Port 8001)...");
                const response = await axios.post(`${PYTHON_ENGINE_URL}/api/biometrics/face/register`, form, {
                    headers: form.getHeaders(),
                    timeout: 45000 // Increased timeout for cloud
                });

                if (response.data.success) {
                    console.log(`✅ Face successfully registered by AI Engine`);
                    return res.json({
                        success: true,
                        message: response.data.message,
                        encoding: response.data.encoding,
                        image_url: response.data.image_url,
                        employeeId: employeeId
                    });
                } else {
                    throw new Error(response.data.message || "Engine rejected registration");
                }
            } else {
                throw new Error("No image file provided");
            }
        } catch (engineError) {
            console.error("❌ Biometric Engine error:", engineError.message);

            if (engineError.code === 'ECONNREFUSED') {
                return res.status(503).json({
                    success: false,
                    message: "Biometric Engine is currently offline. Please start it via 'edge/start_biometric_api.bat' or contact systems admin."
                });
            }

            throw engineError; // Re-throw for generic catch logic
        }
    } catch (error) {
        console.error("❌ Registration error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Biometric Health Proxy with Multi-Fallback Discovery
app.get('/api/biometrics/health', async (req, res) => {
    const fallbacks = [
        PYTHON_ENGINE_URL,
        'http://smart-door-edge:8001',
        'http://localhost:8001'
    ].filter(Boolean);

    for (const url of fallbacks) {
        try {
            console.log(`🔍 [Health Check] Trying: ${url}/health`);
            await axios.get(`${url}/health`, { timeout: 3000 });
            // If success, update the global URL if it was a fallback
            if (url !== PYTHON_ENGINE_URL) {
                console.log(`✅ [Discovery] Updating PYTHON_ENGINE_URL to proven fallback: ${url}`);
                PYTHON_ENGINE_URL = url;
            }
            return res.json({ status: 'ready', engine: 'face-recognition', url });
        } catch (err) {
            console.warn(`⚠️ [Health Check] Failed for ${url}: ${err.message}`);
        }
    }

    res.status(503).json({ 
        status: "offline", 
        message: "Biometric Engine unreachable across all known internal hostnames",
        tried_urls: fallbacks
    });
});

app.post('/api/biometrics/face/verify', biometricLimiter, upload.single('file'), async (req, res) => {
    try {
        console.log("🔍 [Verification] Checking face identity...");

        // Fetch employees from Supabase
        const { data: employees, error } = await supabase
            .from('employees')
            .select('*')
            .eq('status', 'Active')
            .order('created_at', { ascending: false });

        if (error || !employees || employees.length === 0) {
            console.warn("🚫 Access Denied: No employees registered in database.");
            return res.status(401).json({
                success: false,
                message: "No registered identities found."
            });
        }

        // --- Hybrid Verification Flow ---
        try {
            const FormData = require('form-data');

            const form = new FormData();
            form.append('file', req.file.buffer, {
                filename: 'verify.jpg',
                contentType: 'image/jpeg'
            });

            console.log("📡 Attempting Biometric Engine (Port 8001)...");

            // --- WAIT FOR ENGINE READY (max 60s) ---
            let engineReady = false;
            for (let attempt = 0; attempt < 12; attempt++) {
                try {
                    await axios.get(`${PYTHON_ENGINE_URL}/health`, { timeout: 5000 });
                    engineReady = true;
                    break;
                } catch (_) {
                    console.log(`⏳ Biometric engine not ready yet, waiting... (attempt ${attempt + 1}/12)`);
                    await new Promise(r => setTimeout(r, 5000));
                }
            }

            if (!engineReady) {
                console.error("❌ Biometric engine did not become ready in time.");
                return res.status(503).json({
                    success: false,
                    message: "Biometric Service is still starting up. Please wait 30 seconds and try again."
                });
            }

            const response = await axios.post(`${PYTHON_ENGINE_URL}/api/biometrics/face/verify`, form, {
                headers: form.getHeaders(),
                timeout: 120000 // 120s — Render Free/Starter tiers can be slow on first Cold-Start
            });

            if (response.data.success) {
                const employeeId = response.data.employee_id;
                console.log(`✅ Face Verified: ${employeeId}`);

                // Log success
                try {
                    await supabase.from('access_logs').insert({
                        employee_id: employeeId,
                        status: 'success',
                        confidence: response.data.confidence,
                        device_id: 'terminal_01',
                        method: 'FACE',
                        metadata: { unlock_source: 'BIOMETRIC' }
                    });
                } catch (logError) {
                    console.error("⚠️ Failed to record access log:", logError.message);
                }

                // --- TRIGGER DOOR UNLOCK ---
                // await safeTriggerDoorUnlock(); // Handled locally by Android Tablet now!

                // --- RECORD ATTENDANCE ---
                // We need the internal UUID for the attendance table
                const { data: empRecord } = await supabase.from('employees').select('id').eq('employee_id', employeeId).single();
                if (empRecord) {
                    await recordAttendance(empRecord.id, 'face', 'terminal_01');
                }

                return res.json({
                    success: true,
                    message: `Authorized: Welcome ${response.data.name || employeeId}`,
                    employeeId: employeeId,
                    user: {
                        name: response.data.name,
                        employee_id: employeeId
                    }
                });
            } else if (response.data.error_code === 'AMBIGUOUS_MATCH') {
                console.warn(`⚠️ Ambiguous Match for hint: ${response.data.id_hint}. Requesting Fingerprint fallback.`);

                try {
                    await supabase.from('access_logs').insert({
                        employee_id: response.data.id_hint,
                        status: 'ambiguous',
                        device_id: 'terminal_01',
                        method: 'face'
                    });
                } catch (logError) {
                    console.error("⚠️ Failed to record ambiguous access log:", logError.message);
                }

                return res.status(403).json({
                    success: false,
                    error_code: "MFA_REQUIRED",
                    message: "Ambiguous matching. Please use Fingerprint sensor for secondary verification.",
                    id_hint: response.data.id_hint
                });
            } else {
                console.log(`🚫 Engine Rejection: ${response.data.message}`);
                // Log failed attempt
                try {
                    const key = `face_null_denied`;
                    const lastLog = logRateLimiter.get(key);
                    if (!lastLog || (Date.now() - lastLog) > LOG_THROTTLE_MS) {
                        await supabase.from('access_logs').insert({
                            employee_id: null,
                            status: 'failed',
                            confidence: response.data.confidence || null,
                            device_id: 'terminal_01',
                            method: 'FACE',
                            metadata: {
                                reason: response.data.message,
                                unlock_source: 'BIOMETRIC'
                            }
                        });
                        logRateLimiter.set(key, Date.now());
                    }
                } catch (le) { console.error('⚠️ Failed to log rejection:', le.message); }
                return res.status(401).json({
                    success: false,
                    message: response.data.message || "Access Denied."
                });
            }
        } catch (engineError) {
            console.error("❌ Biometric Engine error/offline:", engineError.message);
            // Log engine offline as failed
            try {
                await supabase.from('access_logs').insert({
                    employee_id: null,
                    status: 'failed',
                    device_id: 'terminal_01',
                    method: 'face',
                    metadata: { reason: 'Biometric engine offline', error: engineError.message }
                });
            } catch (le) { console.error('⚠️ Failed to log engine-offline event:', le.message); }
            return res.status(503).json({
                success: false,
                message: "Biometric Service Unavailable. Please use manual override or contact admin."
            });
        }

    } catch (error) {
        console.error("❌ Verification error:", error);
        res.status(500).json({
            success: false,
            message: "System Error: Face processing failed or timed out. Please try again.",
            error: error.message
        });
    }
})

// End of Routes


// Final fallback for SPA (Admin Dashboard)
app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.url.startsWith('/api') || req.url.startsWith('/auth')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
