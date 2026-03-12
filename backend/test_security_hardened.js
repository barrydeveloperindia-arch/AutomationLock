const axios = require('axios');

const API_URL = 'http://localhost:8000';
const TEST_EMPLOYEE_ID = 'EMP-961231'; // Shiv Kumar

async function runTest() {
    console.log("🚀 Starting Attendance Security Verification...");

    try {
        // 1. Test Device Validation (Failure)
        console.log("\n1️⃣ Testing Unauthorized Device...");
        try {
            await axios.post(`${API_URL}/api/attendance/mark`, {
                employee_id: TEST_EMPLOYEE_ID,
                method: 'face',
                device_id: 'HACKER_DEVICE'
            });
        } catch (error) {
            console.log("✅ Rejected as expected:", error.response?.data?.message || error.message);
        }

        // 2. Test Normal Check-in (Success)
        console.log("\n2️⃣ Testing Authorized Check-in...");
        const res1 = await axios.post(`${API_URL}/api/attendance/mark`, {
            employee_id: TEST_EMPLOYEE_ID,
            method: 'face',
            device_id: 'office_terminal'
        });
        console.log("✅ Response:", res1.data);

        // 3. Test Duplicate Scan (Throttled)
        console.log("\n3️⃣ Testing Duplicate Scan (within 2 mins)...");
        const res2 = await axios.post(`${API_URL}/api/attendance/mark`, {
            employee_id: TEST_EMPLOYEE_ID,
            method: 'face',
            device_id: 'office_terminal'
        });
        console.log("✅ Response:", res2.data);
        if (res2.data === "Duplicate scan ignored") {
            console.log("🏆 Throttle logic WORKS.");
        }

        console.log("\nVerification suite completed. (Note: To test strict flow rejection, you must wait 2 minutes or manually update DB record check_out)");

    } catch (error) {
        console.error("❌ Test Failed:", error.response?.data || error.message);
    }
}

runTest();
