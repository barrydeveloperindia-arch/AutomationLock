import axios from 'axios';

const api = axios.create({
    baseURL: '/', // Use Vite Proxy
    headers: { 'Content-Type': 'application/json' }
});

// Request interceptor to add auth token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
    (response) => response.data,
    (error) => {
        if (error.response?.status === 401) {
            // Handle unauthorized
        }
        return Promise.reject(error.response?.data || error.message);
    }
);

export const apiService = {
    // Dashboard Stats
    getDashboardStats: () => api.get('/api/stats'),

    // Logs
    getLogs: (params) => api.get('/api/logs', { params }),

    // Users
    getUsers: () => api.get('/api/users'),
    createUser: (userData) => api.post('/api/users', userData),
    deleteUser: (id) => api.delete(`/api/users/${id}`),

    // Devices
    getDevices: () => api.get('/api/devices'),
    unlockDevice: (deviceId) => api.post(`/api/devices/${deviceId}/unlock`),

    // Biometrics
    registerFace: (imageBlob, employeeId, email, name) => {
        const formData = new FormData();
        formData.append('file', imageBlob, 'capture.jpg');
        formData.append('employeeId', employeeId);
        formData.append('email', email);
        if (name) formData.append('name', name);

        console.log(`📤 Sending face registration to /api/biometrics...`);
        return api.post('/api/biometrics/face/register', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },
    enrollFingerprint: () => api.post('/api/biometrics/fingerprint/enroll'),

    // Terminal / Verification
    verifyFace: (imageBlob) => {
        const formData = new FormData();
        formData.append('file', imageBlob, 'verify.jpg');

        console.log("🔍 Sending face verification to /api/biometrics...");
        return api.post('/api/biometrics/face/verify', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },

    // Attendance
    recordPhoneAttendance: () => api.post('/api/attendance/phone-verify'),
};
