const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:8000';
const IMG_PATH = path.join(__dirname, 'bharat.jpg');

async function enrollBharat() {
    try {
        console.log("0. Authenticating...");
        const loginRes = await axios.post(`${API_BASE}/auth/login`, {
            email: 'admin@auralock.com',
            password: 'admin123'
        });
        const token = loginRes.data.token;
        const config = { headers: { Authorization: `Bearer ${token}` } };

        console.log("1. Checking Employee Profile...");
        const usersListRes = await axios.get(`${API_BASE}/api/users`, config);
        let employee = usersListRes.data.find(u => u.email === "bharat@auralock.com");

        if (!employee) {
            console.log("Creating new profile...");
            const userRes = await axios.post(`${API_BASE}/api/users`, {
                name: "Bharat Anand",
                email: "bharat@auralock.com",
                employee_id: "EMP-004",
                department: "Engineering",
                role: "employee"
            }, config);
            employee = userRes.data;
        }
        const employeeId = employee.employee_id || employee.id || "EMP-004";
        console.log(`✅ Employee Profile Created: ${employee.name}`);

        console.log("2. Uploading Biometric Data...");
        const form = new FormData();
        form.append('file', fs.createReadStream(IMG_PATH), 'bharat.png');
        form.append('employeeId', employeeId);
        form.append('email', employee.email);
        form.append('name', employee.name);
        form.append('re_enroll', 'true');

        const faceRes = await axios.post(`${API_BASE}/api/biometrics/face/register`, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${token}`
            }
        });

        console.log("✅ Biometric Enrollment Successful!");
        console.log(faceRes.data);

    } catch (e) {
        console.error("❌ Error:");
        if (e.response && e.response.data) {
            console.error(e.response.data);
        } else {
            console.error(e.message);
        }
    }
}

enrollBharat();
