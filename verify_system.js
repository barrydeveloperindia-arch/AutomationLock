const axios = require('axios');
require('dotenv').config();

const BACKEND_URL = 'http://localhost:8000';
const ENGINE_URL = 'http://localhost:8001';

async function testSystem() {
    console.log('🔍 Starting AuraLock System Diagnostic...');

    // 1. Test Backend Users API
    try {
        console.log('📡 Testing Backend /api/users...');
        const usersResp = await axios.get(`${BACKEND_URL}/api/users`, {
            headers: { 'Authorization': 'Bearer DEBUG_BYPASS' } // Assuming a bypass or valid token needed
        });
        console.log(`✅ Backend OK: Found ${usersResp.data.length} users.`);
    } catch (err) {
        console.error(`❌ Backend /api/users FAILED: ${err.message}`);
        if (err.response) {
            console.error('Response Data:', JSON.stringify(err.response.data, null, 2));
        }
    }

    // 2. Test Biometric Engine Health
    try {
        console.log('📡 Testing Biometric Engine /health...');
        const healthResp = await axios.get(`${ENGINE_URL}/health`);
        console.log(`✅ Engine OK: ${healthResp.data.status}`);
    } catch (err) {
        console.error(`❌ Biometric Engine FAILED: ${err.message}`);
    }

    // 3. Test Door Control Engine Communication
    try {
        console.log('📡 Testing Door Status via Engine...');
        const statusResp = await axios.get(`${ENGINE_URL}/api/door/status`);
        console.log(`✅ Door Status OK: Online=${statusResp.data.online}`);
    } catch (err) {
        console.error(`❌ Door Status FAILED: ${err.message}`);
    }
}

testSystem();
