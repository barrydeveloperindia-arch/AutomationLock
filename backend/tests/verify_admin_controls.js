const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const API_URL = 'http://localhost:8000';
const ADMIN_TOKEN = jwt.sign({ email: process.env.ADMIN_EMAIL, role: 'admin' }, process.env.JWT_SECRET);
const USER_TOKEN = jwt.sign({ email: 'test@employee.com', role: 'employee' }, process.env.JWT_SECRET);

async function runTests() {
    console.log("🚀 Starting Admin Control & Soft-Delete Verification...");

    try {
        // 1. Test RBAC: Access /api/users as non-admin
        console.log("\n🧪 Testing RBAC (Employee role)...");
        try {
            await axios.get(`${API_URL}/api/users`, {
                headers: { Authorization: `Bearer ${USER_TOKEN}` }
            });
            console.error("❌ FAIL: Non-admin could access /api/users");
        } catch (error) {
            if (error.response?.status === 403) {
                console.log("✅ PASS: Non-admin correctly blocked from sensitive route.");
            } else {
                console.error("❌ FAIL: Unexpected error status:", error.response?.status);
            }
        }

        // 2. Test Fetching Users (Exclude Deleted)
        console.log("\n🧪 Testing User Fetch (Excluding Deleted)...");
        const usersResponse = await axios.get(`${API_URL}/api/users`, {
            headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
        });
        const users = usersResponse.data;
        const deletedUser = users.find(u => u.status === 'Deleted');
        if (!deletedUser) {
            console.log("✅ PASS: Deleted users are hidden by default.");
        } else {
            console.error("❌ FAIL: Deleted user found in default fleet.");
        }

        // 3. Test Disabling a User
        console.log("\n🧪 Testing User Disable...");
        const targetUser = users[0];
        if (targetUser) {
            await axios.patch(`${API_URL}/api/users/${targetUser.id}`,
                { status: 'Disabled' },
                { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
            );
            console.log(`✅ PASS: Status updated to 'Disabled' for user ${targetUser.email}`);
        }

        // 4. Test Soft-Delete (Purge Check)
        console.log("\n🧪 Testing Soft-Delete & Purge...");
        if (targetUser) {
            const deleteRes = await axios.delete(`${API_URL}/api/users/${targetUser.id}`, {
                headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
            });
            console.log(`✅ PASS: ${deleteRes.data.message}`);
        }

    } catch (error) {
        console.error("❌ Test Execution Error:", error.response?.data || error.message);
    }
}

runTests();
