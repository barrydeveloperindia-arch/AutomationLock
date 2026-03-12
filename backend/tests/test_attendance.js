const axios = require('axios');
require('dotenv').config();

const API_URL = `http://localhost:${process.env.PORT || 8000}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function test() {
    console.log("🧪 Starting Attendance System Tests...");

    let token;
    try {
        console.log("🔐 Logging in as Admin...");
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });
        token = loginRes.data.token;
        console.log("✅ Admin Login Successful");
    } catch (err) {
        console.error("❌ Login failed. Is the server running?");
        return;
    }

    const headers = { Authorization: `Bearer ${token}` };

    try {
        // 1. Check Stats
        console.log("📊 Checking Dashboard Stats...");
        const statsRes = await axios.get(`${API_URL}/api/stats`, { headers });
        console.log("✅ Stats retrieved:", JSON.stringify(statsRes.data, null, 2));
        if (statsRes.data.isPresent === undefined) {
            console.error("❌ 'isPresent' metric missing from stats!");
        }

        // 2. Test Dedicated /attendance/mark Endpoint
        console.log("🎯 Testing Dedicated /attendance/mark (Check-in)...");
        // Fetch users to get a valid email/id
        const usersRes = await axios.get(`${API_URL}/api/users`, { headers });
        const testUser = usersRes.data.find(u => u.status === 'Active');

        if (testUser) {
            console.log(`👤 Using test user: ${testUser.name} (${testUser.employee_id})`);

            const markRes = await axios.post(`${API_URL}/attendance/mark`, {
                employee_id: testUser.employee_id,
                method: 'facial_recognition',
                device_id: 'front_door'
            });
            console.log(`✅ Response 1: "${markRes.data}"`);

            console.log("🎯 Testing Dedicated /attendance/mark (Check-out)...");
            const markRes2 = await axios.post(`${API_URL}/attendance/mark`, {
                employee_id: testUser.employee_id,
                method: 'facial_recognition',
                device_id: 'front_door'
            });
            console.log(`✅ Response 2: "${markRes2.data}"`);

            console.log("🎯 Testing Dedicated /attendance/mark (Duplicate)...");
            const markRes3 = await axios.post(`${API_URL}/attendance/mark`, {
                employee_id: testUser.employee_id,
                method: 'facial_recognition',
                device_id: 'front_door'
            });
            console.log(`✅ Response 3: "${markRes3.data}"`);
        } else {
            console.warn("⚠️ No active users found for testing.");
        }

        // 3. Check Attendance Registry
        console.log("📋 Checking Attendance Registry...");
        const registryRes = await axios.get(`${API_URL}/api/attendance`, { headers });
        console.log(`✅ Registry retrieved. Found ${registryRes.data.length} records.`);
        if (registryRes.data.length > 0) {
            console.log("📄 Latest record:", JSON.stringify(registryRes.data[0], null, 2));
        }

    } catch (err) {
        console.error("❌ Test failed:", err.response?.data || err.message);
    }
}

test();
