const { checkStatus } = require('./backend/doorService');

async function testStatus() {
    console.log("🧪 Starting Manual checkStatus Test...");
    try {
        const start = Date.now();
        const status = await checkStatus();
        const duration = (Date.now() - start) / 1000;
        console.log(`⏱️ Duration: ${duration.toFixed(2)}s`);
        console.log("📄 Status Result:", JSON.stringify(status, null, 2));
    } catch (error) {
        console.error("❌ Test Failed:", error);
    }
}

testStatus();
