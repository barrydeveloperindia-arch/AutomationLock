const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const sql = `
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS department text;
UPDATE public.employees SET department = 'Engineering' WHERE department IS NULL;
`;

async function run() {
    console.log("🚀 Adding 'department' column to 'employees'...");
    try {
        const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
        if (error) {
            console.error("❌ Migration failed via RPC:", error.message);
            console.log("\n⚠️ Please run the following SQL in your Supabase SQL Editor manually:\n");
            console.log(sql);
        } else {
            console.log("✅ Migration successful!");
        }
    } catch (err) {
        console.error("❌ Error executing migration:", err.message);
        console.log("\n⚠️ Please run the following SQL in your Supabase SQL Editor manually:\n");
        console.log(sql);
    }
}

run();
