const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/SMART DOOR LOCK/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkTypes() {
    console.log("🔍 Checking Column Types...");

    const tables = ['employees', 'access_logs', 'attendance', 'rfid_tags', 'fingerprints'];
    
    // We can't use SQL easily, so we'll inspect the first object's types in JS
    for (const table of tables) {
        try {
            const { data, error } = await supabase.from(table).select('*').limit(1).single();
            if (error) {
                console.log(`Table ${table}: ${error.message}`);
                continue;
            }
            console.log(`\n--- Table: ${table} ---`);
            for (const [key, value] of Object.entries(data)) {
                if (key.includes('id')) {
                    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
                    console.log(`${key}: ${typeof value} (Value: ${value}) ${isUUID ? '[UUID]' : '[TEXT/INT]'}`);
                }
            }
        } catch (e) {
            console.log(`Table ${table} check failed.`);
        }
    }
}

checkTypes();
