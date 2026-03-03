const axios = require('axios');
require('dotenv').config();

const API_URL = 'http://localhost:8000';
const ADMIN_LOGIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };

async function verifyResilientDelete() {
    console.log("🚀 Verifying Resilient Hard-Delete...");

    try {
        // 1. Login
        const loginRes = await axios.post(`${API_URL}/auth/login`, ADMIN_LOGIN);
        const token = loginRes.data.token;
        const config = { headers: { Authorization: `Bearer ${token}` } };

        // 2. Create User
        const empId = "RESILIENT-FIX-3";
        console.log(`👤 Creating user ${empId}...`);
        await axios.post(`${API_URL}/api/users`, {
            employeeId: empId,
            name: "Resilient V4",
            email: "resilient@example.com",
            role: "employee"
        }, config);

        // 3. Manually add an access log to trigger the constraint
        console.log("📝 Adding dummy access log to trigger constraint...");
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
        await supabase.from('access_logs').insert({
            employee_id: empId,
            status: 'success',
            device_id: 'test-device'
        });

        // 4. Attempt Deletion via API (should now work due to manual cleanup)
        console.log("🗑️ Attempting deletion via resilient backend route...");
        const deleteRes = await axios.delete(`${API_URL}/api/users/${empId}`, config);
        console.log("✅ API Response:", deleteRes.data.message);

        // 5. Final check
        const { data: emp } = await supabase.from('employees').select('id').eq('employee_id', empId).single();
        if (!emp) {
            console.log("🎉 SUCCESS: User with logs was successfully purged!");
        } else {
            console.error("❌ FAIL: User still exists in database.");
        }

    } catch (err) {
        console.error("💥 Verification Failed:", err.response?.data || err.message);
    }
}

verifyResilientDelete();
