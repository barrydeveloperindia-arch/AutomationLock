const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'd:/SMART DOOR LOCK/backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function fix() {
    console.log("🛠️ Attempting to update Foreign Key constraints to ON UPDATE CASCADE...");
    
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

            -- Fix rfid_tags
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfid_tags_employee_id_fkey') THEN
                ALTER TABLE rfid_tags DROP CONSTRAINT rfid_tags_employee_id_fkey;
            END IF;
            ALTER TABLE rfid_tags 
            ADD CONSTRAINT rfid_tags_employee_id_fkey 
            FOREIGN KEY (employee_id) 
            REFERENCES employees(employee_id) 
            ON UPDATE CASCADE 
            ON DELETE SET NULL;

            -- Fix fingerprints
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fingerprints_employee_id_fkey') THEN
                ALTER TABLE fingerprints DROP CONSTRAINT fingerprints_employee_id_fkey;
            END IF;
            ALTER TABLE fingerprints 
            ADD CONSTRAINT fingerprints_employee_id_fkey 
            FOREIGN KEY (employee_id) 
            REFERENCES employees(employee_id) 
            ON UPDATE CASCADE 
            ON DELETE SET NULL;
        END $$;
    `;

    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
        console.error("❌ SQL Error:", error.message);
        console.log("\n💡 Manual Fix Required: Please run the following SQL in your Supabase SQL Editor:\n");
        console.log(sql);
    } else {
        console.log("✅ FK Constraints updated to CASCADE successfully.");
    }
}

fix();
