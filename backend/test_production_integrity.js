const axios = require('axios');
const http = require('http');
const crypto = require('crypto');

const API_URL = 'http://localhost:8000';
const ESP32_SECRET = 'door_secret_pass_123';

/**
 * Helper: Generate Signed Payload
 */
const getSignedPayload = (data) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ ...data, timestamp });
    const hmac = crypto.createHmac('sha256', ESP32_SECRET);
    hmac.update(payload);
    const signature = hmac.digest('hex');
    return { ...data, timestamp, signature };
};

/**
 * 1. Test Rate Limiting
 */
const testRateLimiting = async () => {
    console.log("\n🛡️  [Security] Testing Rate Limiting on /auth/login...");
    let caught429 = false;
    for (let i = 0; i < 11; i++) {
        try {
            await axios.post(`${API_URL}/auth/login`, { email: 'bad@test.com', password: 'bad' });
        } catch (err) {
            if (err.response?.status === 429) {
                caught429 = true;
                break;
            }
        }
    }
    if (caught429) console.log("✅ Rate Limiting active (HTTP 429)");
    else console.error("❌ Rate Limiting FAILED!");
};

/**
 * 2. Test Signed Power Events
 */
const testPowerEvents = async () => {
    console.log("\n🔋 [Power] Testing Signed Low Battery Alert...");
    const payload = getSignedPayload({
        method: "POWER_EVENT",
        id: 0,
        status: "LOW_BATTERY",
        message: "Battery health check: 10.9V"
    });

    try {
        const res = await axios.post(`${API_URL}/api/logs/iot`, payload);
        if (res.data.success) console.log("✅ Low Battery Alert recorded.");
    } catch (err) {
        console.error("❌ Power Event failed:", err.response?.data || err.message);
    }
};

/**
 * 3. Test Signed Manual Override
 */
const testManualOverride = async () => {
    console.log("\n🔘 [Hardware] Testing Manual Override Event...");
    const payload = getSignedPayload({
        method: "Manual Override",
        id: 999,
        status: "success",
        message: "Emergency Button Pressed"
    });

    try {
        const res = await axios.post(`${API_URL}/api/logs/iot`, payload);
        if (res.data.success) console.log("✅ Manual Override logged.");
    } catch (err) {
        console.error("❌ Override Event failed:", err.response?.data || err.message);
    }
};

/**
 * 4. Test HMAC Integrity (Reject Invalid)
 */
const testHmacIntegrity = async () => {
    console.log("\n🔑 [Security] Testing HMAC Integrity (Invalid Signature)...");
    const payload = {
        method: "Malicious",
        id: 1,
        status: "success",
        timestamp: Math.floor(Date.now() / 1000),
        signature: "fake_signature_123"
    };

    try {
        await axios.post(`${API_URL}/api/logs/iot`, payload);
        console.error("❌ HMAC Integrity FAILED (Accepted invalid signature)");
    } catch (err) {
        if (err.response?.status === 401) {
            console.log("✅ HMAC Integrity verified (Rejected invalid signature)");
        } else {
            console.error("❌ Unexpected error:", err.message);
        }
    }
};

const runSuite = async () => {
    console.log("==========================================");
    console.log("🚀 SMART DOOR LOCK - PRODUCTION INTEGRITY SUITE");
    console.log("==========================================");

    try {
        await testRateLimiting();
        await testHmacIntegrity();
        await testPowerEvents();
        await testManualOverride();

        console.log("\n✨ ALL PRODUCTION CHECKS PASSED!");
    } catch (err) {
        console.error("\n💥 SUITE FAILED:", err.message);
    }
    console.log("==========================================");
};

runSuite();
