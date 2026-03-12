const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/SMART DOOR LOCK/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function fix() {
    console.log("🛠️ Attempting to update Foreign Key constraints via 'execute_sql'...");
    
    const sql = `
        DO $$ 
        BEGIN
            -- Fix access_logs
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_logs_employee_id_fkey') THEN
                ALTER TABLE access_logs DROP CONSTRAINT access_logs_employee_id_fkey;
            END IF;
            ALTER TABLE access_logs 
            ADD CONSTRAINT access_logs_employee_id_fkey 
            FOREIGN KEY (employee_id) 
            REFERENCES employees(employee_id) 
            ON UPDATE CASCADE 
            ON DELETE SET NULL;
        END $$;
    `;

    const { data, error } = await supabase.rpc('execute_sql', { query: sql });
    
    if (error) {
        console.error("❌ SQL Error:", error.message);
    } else {
        console.log("✅ FK Constraints updated successfully.");
    }
}

fix();
