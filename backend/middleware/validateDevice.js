/**
 * Approved Device Validation Middleware
 * Ensures attendance is only recorded from authorized terminals.
 */
const APPROVED_DEVICES = ['office_terminal', 'terminal_01', 'mobile_app', 'remote_terminal'];

const validateDevice = (req, res, next) => {
    const { device_id } = req.body;

    if (!device_id) {
        return res.status(400).json({
            success: false,
            message: "Missing device_id. Authentication rejected."
        });
    }

    if (!APPROVED_DEVICES.includes(device_id)) {
        console.warn(`🚨 [Security] Unauthorized device access attempt: ${device_id}`);
        return res.status(403).json({
            success: false,
            message: "This device is not authorized to record attendance."
        });
    }

    next();
};

module.exports = validateDevice;
