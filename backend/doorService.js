const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PYTHON_ENGINE_URL = 'http://localhost:8001';
const BLE_MAC = process.env.ESP32_BLE_MAC;

/**
 * Sends a command to the Biometric Engine's door control API.
 */
async function runBleCommand(endpoint) {
    try {
        const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const response = await axios.post(`${PYTHON_ENGINE_URL}${url}`, {}, { timeout: 15000 });
        return response.data;
    } catch (error) {
        console.error(`❌ Door Engine Error (${endpoint}):`, error.message);
        return { success: false, message: error.message };
    }
}

/**
 * Connect/Disconnect logic (Logical state)
 */
async function connectBle() {
    console.log(`🔗 Connecting to ${BLE_MAC}...`);
    const status = await checkStatus();
    if (status.online) {
        isConnected = true;
        return { success: true, message: 'Device connected successfully' };
    }
    return { success: false, message: 'Device not found or unreachable' };
}

async function disconnectBle() {
    console.log(`🔌 Disconnecting from ${BLE_MAC}...`);
    isConnected = false;
    return { success: true, message: 'Device disconnected' };
}

/**
 * Sends a BLE command to the ESP32 to unlock the door.
 */
async function unlockDoor() {
    console.log(`🔓 Forwarding unlock request to Biometric Engine...`);
    return await runBleCommand('/api/door/unlock');
}

/**
 * Sends a BLE command to the ESP32 to lock the door.
 */
async function lockDoor() {
    console.log(`🔒 Forwarding lock request to Biometric Engine...`);
    return await runBleCommand('/api/door/lock');
}

/**
 * Checks if the ESP32 is online via Biometric Engine.
 */
async function checkStatus() {
    try {
        const response = await axios.get(`${PYTHON_ENGINE_URL}/api/door/status`, { timeout: 5000 });
        return {
            ...response.data,
            // Ensure consistency between layers
            isConnected: response.data.isConnected || response.data.online,
            isLocked: response.data.isLocked,
            method: 'BLE',
            name: process.env.ESP32_DEVICE_NAME || response.data.name || 'BLE Door Lock'
        };
    } catch (error) {
        return { online: false, isConnected: false, isLocked: true, message: error.message };
    }
}

/**
 * Returns device configuration information.
 */
function getDeviceInfo() {
    return {
        name: process.env.ESP32_DEVICE_NAME || 'BLE Door Lock',
        mac: BLE_MAC,
        method: 'BLE'
    };
}

module.exports = {
    unlockDoor,
    lockDoor,
    checkStatus,
    getDeviceInfo,
    runBleCommand,
    connectBle,
    disconnectBle
};
