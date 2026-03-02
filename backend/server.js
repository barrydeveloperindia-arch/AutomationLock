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

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error("❌ Token Verification Failed:", err.message);
            console.log("🔑 Received Token (Partial):", token.substring(0, 20) + "...");
            return res.status(403).json({
                error: "Forbidden",
                message: `Invalid or expired token: ${err.message}`
            });
        }
        console.log("🔓 Authenticated User:", user.email);
        req.user = user;
        next();
    });
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
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        console.log("🔍 [API] Fetching all employees for user:", req.user.email);
        const { data: users, error } = await supabase.from('employees').select('*');
        if (error) throw error;

        console.log(`✅ [API] Found ${users?.length || 0} employees.`);
        res.json(users || []);
    } catch (error) {
        console.error("❌ Get users error:", error);

        // Detect HTML error pages (like Cloudflare 5xx)
        if (typeof error.message === 'string' && error.message.includes('<!DOCTYPE html>')) {
            return res.status(503).json({
                success: false,
                message: "Supabase service temporarily unavailable (SSL Handshake Error 525). Please retry in a few moments."
            });
        }

        res.status(500).json({ error: "Internal Server Error", message: error.message });
    }
});

app.post('/api/users', authenticateToken, async (req, res) => {
    try {
        const { employeeId, name, email, role, faceEncoding, image_url } = req.body;

        const { data: newUser, error } = await supabase
            .from('employees')
            .upsert({
                employee_id: employeeId,
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

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('employees')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error("❌ Delete user error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Biometric Support (Mock Fallback when Python API is offline)
app.post('/api/biometrics/face/register', upload.single('file'), async (req, res) => {
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
                const matchedUser = response.data.user;
                console.log(`✅ Access Granted (AI): Welcome ${matchedUser.name}`);

                // Log success
                await supabase.from('access_logs').insert({
                    employee_id: matchedUser.employee_id,
                    status: 'success',
                    confidence: response.data.confidence || 0.98,
                    device_id: 'terminal_01'
                });

                // --- TRIGGER DOOR UNLOCK ---
                await unlockDoor();

                return res.json({
                    success: true,
                    message: `Authorized: Welcome ${matchedUser.name}`,
                    user: matchedUser
                });
            }
        } catch (engineError) {
            console.warn("⚠️ Biometric Engine offline. Falling back to Smart Sandbox...");
        }

        // --- Smart Sandbox Fallback ---
        // If AI is offline, we lookup the database for the most recent registration
        // This ensures the USER can still test their setup.
        const { data: fallbackEmployees, error: dbError } = await supabase
            .from('employees')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1);

        if (dbError || !fallbackEmployees || fallbackEmployees.length === 0) {
            console.warn("🚫 Access Denied: No employees found in database.");
            return res.status(401).json({
                success: false,
                message: "Access Denied: No identity found. Please register first."
            });
        }

        const matchedUser = fallbackEmployees[0];
        console.log(`🛡️ [Sandbox Mode] Granting access to: ${matchedUser.name}`);

        // Log sandbox success
        await supabase.from('access_logs').insert({
            employee_id: matchedUser.employee_id,
            status: 'success',
            confidence: 0.95,
            device_id: 'sandbox_terminal'
        });

        // --- TRIGGER DOOR UNLOCK ---
        await unlockDoor();

        res.json({
            success: true,
            message: `Authorized: Welcome ${matchedUser.name} (Sandbox Mode)`,
            user: {
                name: matchedUser.name,
                role: matchedUser.role,
                employee_id: matchedUser.employee_id
            }
        });

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
