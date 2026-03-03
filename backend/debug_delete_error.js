const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function debugDelete() {
    // Try to delete 'Ratnesh' (EMP-465156) or 'Shiv Kumar' (EMP-864896) who likely have logs
    const targetId = 'EMP-465156';
    console.log(`🔍 Attempting to delete employee_id: ${targetId}`);

    const { data, error } = await supabase
        .from('employees')
        .delete()
        .eq('employee_id', targetId)
        .select();

    if (error) {
        console.error("❌ SUPABASE ERROR DETECTED:");
        console.error("Code:", error.code);
        console.error("Message:", error.message);
        console.error("Details:", error.details);
        console.error("Hint:", error.hint);
    } else {
        console.log("✅ Success? Data:", data);
    }
}

debugDelete();
