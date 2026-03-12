const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const sql = `
-- Drop existing constraint to update it
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_method_check;

-- Add updated constraint with more flexible methods
ALTER TABLE public.attendance ADD CONSTRAINT attendance_method_check 
CHECK (method IN ('face', 'fingerprint', 'facial_recognition', 'phone_fingerprint', 'rfid', 'manual'));
`;

async function run() {
    console.log("🚀 Updating Attendance Method Constraint...");
    try {
        const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
        if (error) {
            console.error("❌ Update failed via RPC:", error.message);
            console.log("\n⚠️ Please run the following SQL in your Supabase SQL Editor manually:\n");
            console.log(sql);
        } else {
            console.log("✅ Update successful!");
        }
    } catch (err) {
        console.error("❌ Error executing update:", err.message);
        console.log("\n⚠️ Please run the following SQL in your Supabase SQL Editor manually:\n");
        console.log(sql);
    }
}

run();
