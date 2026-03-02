const axios = require('axios');
const crypto = require('crypto');

const API_URL = 'http://localhost:8000';
const ESP32_SECRET = 'door_secret_pass_123';

/**
 * 1. Simulate Low Battery Alert
 */
const testLowBatteryAlert = async () => {
    console.log("🔋 Testing Low Battery Alert simulation...");
    const timestamp = Math.floor(Date.now() / 1000);
    const logPayload = {
        method: "POWER_EVENT",
        id: 0,
        status: "LOW_BATTERY",
        message: "Battery below 11.1V. Please charge.",
        timestamp: timestamp
    };

    const hmac = crypto.createHmac('sha256', ESP32_SECRET);
    hmac.update(JSON.stringify(logPayload));
    const signature = hmac.digest('hex');

    try {
        const res = await axios.post(`${API_URL}/api/logs/iot`, {
            ...logPayload,
            signature
        });
        if (res.data.success) console.log("✅ Low Battery Alert recorded successfully.");
    } catch (err) {
        console.error("❌ Low Battery Alert failed:", err.response?.data || err.message);
    }
};

/**
 * 2. Simulate Manual Override Event
 */
const testManualOverride = async () => {
    console.log("🔘 Testing Manual Override simulation...");
    const timestamp = Math.floor(Date.now() / 1000);
    const logPayload = {
        method: "Manual Override",
        id: 999,
        status: "success",
        message: "Unlocked via Manual Override",
        timestamp: timestamp
    };

    const hmac = crypto.createHmac('sha256', ESP32_SECRET);
    hmac.update(JSON.stringify(logPayload));
    const signature = hmac.digest('hex');

    try {
        const res = await axios.post(`${API_URL}/api/logs/iot`, {
            ...logPayload,
            signature
        });
        if (res.data.success) console.log("✅ Manual Override event recorded successfully.");
    } catch (err) {
        console.error("❌ Manual Override event failed:", err.response?.data || err.message);
    }
};

const runTests = async () => {
    console.log("🚀 Starting Power Management Verification...");
    await testLowBatteryAlert();
    await testManualOverride();
    console.log("\n✨ Verification Complete.");
};

runTests();
