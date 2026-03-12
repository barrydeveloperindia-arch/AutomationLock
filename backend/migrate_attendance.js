const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const sql = `
-- Attendance Table
CREATE TABLE IF NOT EXISTS public.attendance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    date date NOT NULL DEFAULT CURRENT_DATE,
    check_in timestamptz,
    check_out timestamptz,
    method text CHECK (method IN ('face', 'fingerprint')),
    device_id text,
    created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON public.attendance (employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance (date);

-- Row Level Security
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

-- Basic Policies
DROP POLICY IF EXISTS "Allow read access to attendance" ON public.attendance;
CREATE POLICY "Allow read access to attendance" ON public.attendance FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert access to attendance" ON public.attendance;
CREATE POLICY "Allow insert access to attendance" ON public.attendance FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update access to attendance" ON public.attendance;
CREATE POLICY "Allow update access to attendance" ON public.attendance FOR UPDATE USING (true);
`;

async function run() {
    console.log("🚀 Applying Attendance Schema Migration...");

    // Check if we can run SQL via RPC. 
    // If not, we'll have to ask the user to run it manually since we don't have direct DB access.
    try {
        const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
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
