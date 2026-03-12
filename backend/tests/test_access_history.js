const axios = require('axios');
require('dotenv').config({ path: '../.env' });
const jwt = require('jsonwebtoken');

const API_URL = 'http://localhost:8000/api';
const SECRET = process.env.JWT_SECRET || 'supersecretkey12345';
const TEST_TOKEN = jwt.sign({ id: 'admin-id', role: 'admin', email: 'admin@auralock.com' }, SECRET);

async function testAccessHistory() {
    console.log('🚀 Starting Access History API Tests...\n');

    try {
        // 1. Test GET /api/access-logs
        console.log('Testing GET /api/access-logs...');
        const logsRes = await axios.get(`${API_URL}/access-logs`, {
            headers: { Authorization: `Bearer ${TEST_TOKEN}` }
        });
        console.log('✅ Access Logs count:', logsRes.data.logs.length);
        console.log('✅ Total logs reported:', logsRes.data.total);

        if (logsRes.data.logs.length > 0) {
            const sample = logsRes.data.logs[0];
            const empId = sample.employee_id;
            
            if (empId) {
                // 2. Test GET /api/access-logs/employee/:id
                console.log(`\nTesting GET /api/access-logs/employee/${empId}...`);
                const empLogsRes = await axios.get(`${API_URL}/access-logs/employee/${empId}`, {
                    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
                });
                console.log('✅ Employee logs count:', empLogsRes.data.logs.length);

                // 3. Test GET /api/access-logs/employee/:id/summary
                console.log(`\nTesting GET /api/access-logs/employee/${empId}/summary...`);
                const summaryRes = await axios.get(`${API_URL}/access-logs/employee/${empId}/summary`, {
                    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
                });
                console.log('✅ Employee Summary:', summaryRes.data);
                
                const s = summaryRes.data;
                if ('total_scans' in s && 'today_scans' in s && 'this_month_scans' in s) {
                    console.log('✅ Summary fields verified.');
                } else {
                    throw new Error('Summary fields missing!');
                }
            }
        }

        // 4. Test Exports (Ping only)
        console.log('\nTesting Export Endpoints (Ping)...');
        const excelRes = await axios.get(`${API_URL}/access-logs/export/excel`, {
            headers: { Authorization: `Bearer ${TEST_TOKEN}` },
            responseType: 'stream'
        });
        console.log('✅ Excel Export: 200 OK');

        const pdfRes = await axios.get(`${API_URL}/access-logs/export/pdf`, {
            headers: { Authorization: `Bearer ${TEST_TOKEN}` },
            responseType: 'stream'
        });
        console.log('✅ PDF Export: 200 OK');

        console.log('\n🎉 All Access History API tests passed!');
    } catch (err) {
        console.error('\n❌ Test failed:', err.response ? err.response.data : err.message);
        process.exit(1);
    }
}

testAccessHistory();
