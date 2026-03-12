require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function migrate() {
    console.log("🚀 Starting migration...");

    // Check if column exists by trying to select it
    const { error: checkError } = await supabase.from('access_logs').select('method').limit(1);

    if (checkError && checkError.message.includes('column "method" does not exist')) {
        console.log("📝 Adding 'method' column to access_logs...");

        // Use a RPC if available, or we might have to use another trick.
        // Since I don't know if 'execute_sql' RPC exists, I'll try to use a common pattern 
        // if the user has provided one in the knowledge base.
        // If not, I'll try to use the 'rest' api to 'simulate' a schema change if possible (rare).

        console.warn("⚠️ Warning: Direct SQL execution via RPC might not be enabled.");
        console.log("Attempting SQL execution via RPC 'execute_sql'...");

        const { error: sqlError } = await supabase.rpc('execute_sql', {
            query: "ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS method TEXT DEFAULT 'Face';"
        });

        if (sqlError) {
            console.error("❌ SQL Migration Failed:", sqlError.message);
            console.log("💡 Tip: Please run this SQL in your Supabase SQL Editor: ALTER TABLE access_logs ADD COLUMN method TEXT DEFAULT 'Face';");
        } else {
            console.log("✅ Column 'method' added successfully.");
        }
    } else if (!checkError) {
        console.log("✨ Column 'method' already exists.");
    } else {
        console.error("❌ Unexpected error checking schema:", checkError.message);
    }
}

migrate();
