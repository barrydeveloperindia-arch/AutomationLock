const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkSchema() {
    console.log("🔍 Checking 'employees' table schema...");
    const { data, error } = await supabase.from('employees').select('*').limit(1);
    if (error) {
        console.error("❌ Schema Check Failed:", error.message);
    } else if (data && data[0]) {
        const columns = Object.keys(data[0]);
        console.log("📋 Found Columns:", columns.join(', '));
        if (columns.includes('status')) {
            console.log("✅ 'status' column exists.");
        } else {
            console.log("❌ 'status' column is MISSING! Please apply migration_v2.sql in Supabase.");
        }
    } else {
        console.log("⚠️ No employees found to check schema.");
    }
}

checkSchema();
