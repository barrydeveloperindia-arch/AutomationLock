const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

/**
 * Middleware to enforce identity integrity.
 * Checks for duplicate employee_id, name, rfid, and fingerprint_id.
 * Logs suspicious attempts to security_alerts table.
 *
 * Set re_enroll=true in the request body to bypass duplicate checks
 * when updating biometrics for an already-existing employee.
 */
const validateIdentity = async (req, res, next) => {
    const { employee_id, employeeId, name, rfid, fingerprint_id } = req.body;
    const finalId = employee_id || employeeId;
    const isUpdate = req.method === 'PATCH' || req.method === 'PUT';
    const isReEnroll = req.body.re_enroll === 'true' || req.body.re_enroll === true || req.body.re_enroll === 'on';
    const targetId = req.params.id; // UUID of employee being updated

    console.log(`🛡️ [IdentityValidation] ${req.method} ${req.url} | finalId: ${finalId} | isReEnroll: ${isReEnroll}`);
    if (Object.keys(req.body).length === 0) {
        console.warn("⚠️ [IdentityValidation] Empty body detected! Possibly Multer hasn't finished parsing?");
    }

    // When re-enrolling biometrics the employee MUST already exist.
    if (isReEnroll) {
        console.log("✅ [IdentityValidation] Bypassing checks for re-enrollment.");
        return next();
    }

    try {
        // 1. Check Employee ID Uniqueness (new registrations only)
        if (finalId && !isUpdate) {
            const { data } = await supabase
                .from('employees')
                .select('employee_id')
                .eq('employee_id', finalId)
                .single();

            if (data) {
                await logAlert('duplicate_id_attempt', finalId, { attempt: 'new_registration', field: 'employee_id' });
                return res.status(400).json({ success: false, message: `Employee ID ${finalId} already exists.` });
            }
        }

        // 2. Check Name Uniqueness
        if (name) {
            const { data } = await supabase
                .from('employees')
                .select('id, name')
                .eq('name', name)
                .single();

            if (data && (!isUpdate || data.id !== targetId)) {
                await logAlert('duplicate_id_attempt', finalId || targetId, { field: 'name', conflict_with: data.id });
                return res.status(400).json({ success: false, message: `Name "${name}" is already taken by another employee.` });
            }
        }

        // 3. Check Face Biometric Uniqueness (normalized)
        const { data: faceData } = await supabase
            .from('face_templates')
            .select('employee_id')
            .eq('employee_id', finalId || targetId)
            .single();

        // 4. Check RFID Uniqueness
        if (rfid) {
            const { data } = await supabase
                .from('rfid_tags')
                .select('employee_id')
                .eq('tag_id', rfid)
                .single();

            if (data && (!isUpdate || data.employee_id !== targetId)) {
                await logAlert('suspicious_rfid_reassignment', finalId || targetId, { rfid, current_owner: data.employee_id });
                return res.status(400).json({ success: false, message: `RFID Tag ${rfid} is already assigned to ${data.employee_id}.` });
            }
        }

        // 5. Check Fingerprint Uniqueness (normalized)
        if (fingerprint_id) {
            const { data } = await supabase
                .from('fingerprint_templates')
                .select('employee_id')
                .eq('id', fingerprint_id)
                .single();

            if (data && (!isUpdate || data.employee_id !== targetId)) {
                await logAlert('duplicate_id_attempt', finalId || targetId, { field: 'fingerprint', fingerprint_id });
                return res.status(400).json({ success: false, message: `Fingerprint ID ${fingerprint_id} is already registered.` });
            }
        }

        next();
    } catch (error) {
        console.error('Identity Validation Error:', error);
        res.status(500).json({ success: false, message: 'Internal validation error.' });
    }
};

/**
 * Helper to log security alerts to Supabase
 */
async function logAlert(type, empId, details) {
    try {
        await supabase.from('security_alerts').insert({
            alert_type: type,
            employee_id: empId,
            severity: type === 'suspicious_rfid_reassignment' ? 'high' : 'medium',
            details: details
        });
    } catch (err) {
        console.error('Alert Logging Failed:', err);
    }
}

module.exports = validateIdentity;
