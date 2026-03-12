import axios from 'axios';

async function verifyStats() {
    try {
        const res = await axios.get('http://localhost:8000/api/stats');
        console.log("📊 Stats Verification:");
        console.log(JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.log("❌ Stats verification failed:", err.message);
    }
}

async function verifyReport() {
    try {
        const res = await axios.get('http://localhost:8000/api/attendance/report');
        console.log("\n📈 Report Verification:");
        console.log(JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.log("❌ Report verification failed:", err.message);
    }
}

async function main() {
    await verifyStats();
    await verifyReport();
}

main();
