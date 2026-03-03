require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const upload = multer({ storage: multer.memoryStorage() });
const validateIdentity = require('./middleware/validateIdentity');

const app = express();
const PORT = 8000;

// --- Security: Rate Limiters ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login attempts per window
    message: { error: 'Too many login attempts, please try again after 15 minutes.' }
});

const biometricLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 15, // Limit each IP to 15 face verification scans per minute
    message: { error: 'Too many scans, please wait a minute.' }
});

// --- Security: Brute-Force Tracker ---
const loginFailures = new Map(); // In-memory tracker

// --- Supabase Connection ---
const supabaseUrl = process.env.SUPABASE_URL || "https://wdtizlzfsijikcejerwq.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors({
    origin: ['http://localhost:5180', 'http://localhost:5181'],
    credentials: true
}));

app.use(express.json());

// Root Route for Health Check
app.get('/', (req, res) => {
    res.json({
        status: 'Online',
        service: 'Smart Door Lock API',
        endpoints: ['/api/stats', '/api/logs', '/api/users', '/auth/login']
    });
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

        // --- Security Check: Account Status ---
        if (user.role !== 'admin') {
            const { data: dbUser } = await supabase.from('employees').select('status').eq('email', user.email).single();
            if (dbUser && dbUser.status !== 'Active') {
                return res.status(403).json({ error: "Access Denied", message: "Account is disabled or deleted" });
            }
        }

        console.log("🔓 Authenticated User:", user.email);
        req.user = user;
        next();
    });
};

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: "Access Denied", message: "Admin privileges required" });
    }
};

// --- IoT Utilities ---
/**
 * Triggers the door unlock on ESP32
 */
const unlockDoor = async () => {
    const esp32Ip = process.env.ESP32_IP;
    const secret = process.env.ESP32_SECRET;

    if (!esp32Ip || !secret) {
        console.warn("⚠️ [IoT] ESP32 configuration missing. Skipping unlock.");
        return;
    }

    try {
        const timestamp = Math.floor(Date.now() / 1000);
        const payload = JSON.stringify({ timestamp });

        // --- Security: HMAC-SHA256 Signing ---
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(payload);
        const signature = hmac.digest('hex');

        console.log(`🔓 [IoT] Sending HMAC-signed unlock command to ${esp32Ip}...`);

        await axios.post(`http://${esp32Ip}/unlock`, {
            timestamp: timestamp,
            signature: signature
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });

        console.log("✅ [IoT] Door unlocked successfully!");
    } catch (error) {
        console.error("❌ [IoT] Unlock command failed:", error.response?.data || error.message);
    }
};

// --- Routes ---

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
        if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
            loginFailures.delete(ip); // Reset on success
            const user = { name: 'Super Admin', email: email, role: 'admin' };
            const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '24h' });
            return res.json({ token: accessToken, user });
        }

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
        const { count: userCount } = await supabase.from('employees').select('*', { count: 'exact', head: true });
        const { count: grantedCount } = await supabase.from('access_logs').select('*', { count: 'exact', head: true }).eq('status', 'success');
        const { count: deniedCount } = await supabase.from('access_logs').select('*', { count: 'exact', head: true }).eq('status', 'failed');

        res.json({
            totalUsers: userCount || 0,
            activeDevices: 1,
            todayEntries: grantedCount || 0,
            failedAttempts: deniedCount || 0
        });
    } catch (error) {
        console.error("❌ Stats error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Logs Endpoint
app.get('/api/logs', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data: logs, count, error } = await supabase
            .from('access_logs')
            .select(`*, employees(name, email)`, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) throw error;

        res.json({
            logs,
            pagination: {
                total: count,
                page: Number(page),
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error("❌ Logs error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// IoT Activity Log Endpoint (Internal)
app.post('/api/logs/iot', async (req, res) => {
    const { method, id, status, message, signature, timestamp } = req.body;
    const secret = process.env.ESP32_SECRET;

    // --- Security: HMAC Verification for Device logs ---
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

    try {
        if (status === 'LOW_BATTERY' || status === 'CRITICAL_BATTERY') {
            console.warn(`🔋 [POWER ALERT] ${status}: ${message}`);
        } else {
            console.log(`🔔 [IoT Event] ${method} unlock by ID #${id}: ${status}`);
        }

        // Record in access_logs
        await supabase.from('access_logs').insert({
            employee_id: id === 0 ? null : (id || 'IOT_DEVICE'),
            status: (status === 'LOW_BATTERY' || status === 'CRITICAL_BATTERY') ? 'warning' : (status || 'success'),
            confidence: 1.0,
            device_id: 'esp32_hardware',
            metadata: { method, message, status }
        });

        res.json({ success: true });
    } catch (error) {
        console.error("❌ IoT Log error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Users Endpoints
app.get('/api/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { includeDeleted = 'false' } = req.query;
        let query = supabase.from('employees').select('*');

        if (includeDeleted !== 'true') {
            query = query.neq('status', 'Deleted');
        }

        const { data: users, error } = await query;
        if (error) throw error;

        res.json(users || []);
    } catch (error) {
        console.error("❌ Get users error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.patch('/api/users/:id', authenticateToken, isAdmin, validateIdentity, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const { data: updatedUser, error } = await supabase
            .from('employees')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json(updatedUser);
    } catch (error) {
        console.error("❌ Update user error:", error);
        res.status(500).json({ error: "Internal Server Error" });
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
    try {
        const { id } = req.params;
        console.log(`🗑️ Starting resilient hard-delete for subject: ${id}`);

        // 1. Resolve Employee ID (needed for linked tables)
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        const isUUID = uuidRegex.test(id);
        let employee_id = id;
        if (isUUID) {
            const { data: emp } = await supabase.from('employees').select('employee_id').eq('id', id).single();
            if (emp) employee_id = emp.employee_id;
        }

        console.log(`📡 Cleaning up records for identifier: ${employee_id}`);

        // 2. Multi-table Cleanup (Manual cascade for resilience)
        const tablesToClean = ['access_logs', 'face_encodings', 'fingerprints', 'rfid_tags', 'security_alerts'];
        for (const table of tablesToClean) {
            await supabase.from(table).delete().eq('employee_id', employee_id);
        }

        // 3. Final deletion of the employee
        const { data, error } = await supabase
            .from('employees')
            .delete()
            .match(isUUID ? { id: id } : { employee_id: id })
            .select()
            .single();

        if (error) {
            console.error("❌ Delete operation failed:", error.message);
            return res.status(500).json({
                error: "Database deletion failed",
                details: error.message,
                hint: "There might be a custom table or constraint still referencing this user."
            });
        }

        if (!data) {
            return res.status(404).json({ error: "Subject not found in primary cluster." });
        }

        console.log("✅ Subject permanently purged from all subsystems:", data.employee_id);
        res.json({ success: true, message: "User and all biometric data permanently removed.", target: data.employee_id });
    } catch (error) {
        console.error("❌ Critical Delete Error:", error);
        res.status(500).json({ error: "Internal Gateway Error", message: error.message });
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

        // --- Hybrid Registration Flow ---
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

                console.log("📡 Forwarding to Biometric Engine (Port 8001)...");
                const response = await axios.post('http://localhost:8001/api/biometrics/face/register', form, {
                    headers: form.getHeaders(),
                    timeout: 8000 // A bit longer for processing/uploading
                });

                if (response.data.success) {
                    console.log(`✅ Face successfully registered by AI Engine`);
                    return res.json({
                        success: true,
                        message: response.data.message,
                        encoding: response.data.encoding,
                        image_url: response.data.image_url,
                        employeeId: employeeId // Return the ID so frontend is in sync
                    });
                } else {
                    throw new Error(response.data.message || "Engine rejected registration");
                }
            } else {
                throw new Error("No image file provided");
            }
        } catch (engineError) {
            console.warn("⚠️ Biometric Engine offline or failed. Falling back to Mock Mode...");
            const errorDetails = engineError.response?.data || engineError.message;
            console.error(errorDetails);

            // Check if engine is actually offline vs a network error
            if (engineError.code === 'ECONNREFUSED') {
                console.info("💡 Tip: The Biometric Engine (Python) appears to be stopped. Start it via 'edge/start_biometric_api.bat'");
            }
        }

        // Optional: Upload image to Supabase if file exists (Mock mode only)
        if (req.file) {
            const fileName = `faces/${employeeId}_${Date.now()}.jpg`;
            const { data, error: uploadError } = await supabase.storage
                .from('biometrics')
                .upload(fileName, req.file.buffer, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (!uploadError) {
                const { data: { publicUrl } } = supabase.storage
                    .from('biometrics')
                    .getPublicUrl(fileName);
                imageUrl = publicUrl;
                console.log(`✅ Image uploaded to Supabase: ${imageUrl}`);
            } else {
                console.warn("⚠️ Supabase image upload failed:", uploadError.message);
            }
        }

        // Generate a 128-dimension mock encoding (random for development)
        const mockEncoding = Array.from({ length: 128 }, () => (Math.random() * 0.2) - 0.1);

        console.log("💾 [Mock Mode] Saving metadata to 'employees' table...");
        const { data: mockUser, error: dbError } = await supabase
            .from('employees')
            .upsert({
                employee_id: employeeId,
                name: name || employeeId,
                email: email || `${employeeId}@internal.com`,
                role: 'employee',
                face_embedding: mockEncoding,
                image_url: imageUrl
            }, { on_conflict: 'employee_id' })
            .select()
            .single();

        if (dbError) {
            console.error("❌ Mock database error:", dbError.message);
            throw dbError;
        }

        res.json({
            success: true,
            message: "Face registered (Development Mock Mode)",
            encoding: mockEncoding,
            image_url: imageUrl,
            employeeId: employeeId
        });
    } catch (error) {
        console.error("❌ Biometric fallback/registration error:", error);

        // Detect HTML error pages (like Cloudflare 5xx)
        if (typeof error.message === 'string' && error.message.includes('<!DOCTYPE html>')) {
            return res.status(503).json({
                success: false,
                message: "Database connection intermittent. Cloudflare reported an SSL Handshake error (525). Registration might have partial success - please check the logs."
            });
        }

        res.status(500).json({ success: false, message: error.message });
    }
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
            const response = await axios.post('http://localhost:8001/api/biometrics/face/verify', form, {
                headers: form.getHeaders(),
                timeout: 3000 // Fast timeout
            });

            if (response.data.success) {
                const employeeId = response.data.employee_id;
                console.log(`✅ Face Verified: ${employeeId}`);

                // Log success
                await supabase.from('access_logs').insert({
                    employee_id: employeeId,
                    status: 'success',
                    confidence: response.data.confidence,
                    device_id: 'terminal_01',
                    metadata: { method: 'face', confidence: response.data.confidence }
                });

                // --- TRIGGER DOOR UNLOCK ---
                await unlockDoor();

                return res.json({
                    success: true,
                    message: `Authorized: Welcome ${employeeId}`,
                    employeeId: employeeId
                });
            } else if (response.data.error_code === 'AMBIGUOUS_MATCH') {
                console.warn(`⚠️ Ambiguous Match for hint: ${response.data.id_hint}. Requesting Fingerprint fallback.`);

                await supabase.from('access_logs').insert({
                    employee_id: response.data.id_hint,
                    status: 'ambiguous',
                    device_id: 'terminal_01',
                    metadata: { method: 'face', error: 'AMBIGUOUS_MATCH' }
                });

                return res.status(403).json({
                    success: false,
                    error_code: "MFA_REQUIRED",
                    message: "Ambiguous matching. Please use Fingerprint sensor for secondary verification.",
                    id_hint: response.data.id_hint
                });
            } else {
                console.log(`🚫 Engine Rejection: ${response.data.message}`);
                return res.status(401).json({
                    success: false,
                    message: response.data.message || "Access Denied."
                });
            }
        } catch (engineError) {
            console.error("❌ Biometric Engine error/offline:", engineError.message);
            return res.status(503).json({
                success: false,
                message: "Biometric Service Unavailable. Please use manual override or contact admin."
            });
        }

    } catch (error) {
        console.error("❌ Verification error:", error);
        res.status(500).json({ success: false, error: "Internal Verification Error" });
    }
});

// 404 Catch-all (to ensure port 8000 ONLY shows JSON)
app.use((req, res) => {
    res.status(404).json({
        error: "Not Found",
        message: `Route ${req.url} does not exist on this API gateway.`
    });
});

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
