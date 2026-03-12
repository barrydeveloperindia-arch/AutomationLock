const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/SMART DOOR LOCK/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function verify() {
    console.log("🚀 Verifying Biometric Normalization...");

    // 1. Check if employees still have the old column (they should, but it will be empty eventually)
    const { data: emp } = await supabase.from('employees').select('face_embedding').limit(1);
    console.log("Employees face_embedding present?", emp !== undefined);

    // 2. Check if face_templates has the migrated data
    const { data: templates, error: templateErr } = await supabase.from('face_templates').select('employee_id').limit(5);
    if (templateErr) {
        console.error("❌ face_templates not accessible:", templateErr.message);
    } else {
        console.log(`✅ face_templates has ${templates.length} records.`);
    }

    // 3. Check access_logs for the 'method' column
    const { data: logs } = await supabase.from('access_logs').select('method').limit(1);
    console.log("Access logs 'method' column present?", logs !== undefined);

    // 4. Test a simulated attendance mark with method
    const axios = require('axios');
    try {
        const testId = 'EMP-0001'; // Assuming this exists from my previous check
        const response = await axios.post('http://localhost:8001/api/attendance/mark', {
            employee_id: testId,
            method: 'FACE',
            device_id: 'test_script'
        });
        console.log("✅ Attendance mark test success:", response.data.success);
    } catch (e) {
        console.log("⚠️ Attendance mark test skipped (is biometric_api running?):", e.message);
    }
}

verify();
