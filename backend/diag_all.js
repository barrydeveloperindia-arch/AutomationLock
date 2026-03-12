const jwt = require('jsonwebtoken');
require('dotenv').config();
const axios = require('axios');

const payload = { email: '5089shivkumar@gmail.com', role: 'admin' };
const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const headers = { 'Authorization': `Bearer ${token}` };

async function diag() {
    const endpoints = [
        '/api/stats',
        '/api/stats/activity',
        '/api/users',
        '/api/logs'
    ];

    for (const ep of endpoints) {
        console.log(`📡 Testing ${ep}...`);
        try {
            const res = await axios.get(`http://localhost:8000${ep}`, { headers, timeout: 5000 });
            console.log(`✅ ${ep}: ${res.status} OK (${Array.isArray(res.data) ? res.data.length : 'Object'} items)`);
        } catch (err) {
            console.error(`❌ ${ep}: FAILED`);
            if (err.response) {
                console.error(`Status: ${err.response.status}`);
                console.error(`Data:`, JSON.stringify(err.response.data, null, 2));
            } else {
                console.error(`Message: ${err.message}`);
            }
        }
    }
}

diag();
