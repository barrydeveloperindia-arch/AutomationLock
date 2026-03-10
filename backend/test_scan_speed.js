const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = 'http://localhost:8000';

function makeFakeJpeg() {
    return Buffer.from(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS' +
        'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
        'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
        'MjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/' +
        'EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA' +
        'AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJIA/9k=',
        'base64'
    );
}

async function testScanSpeed() {
    console.log("⏱️ Testing AuraLock Face Verification Scanning Speed...");

    const fd = new FormData();
    fd.append('file', makeFakeJpeg(), { filename: 'test_face.jpg', contentType: 'image/jpeg' });

    const startTime = Date.now();

    try {
        const response = await axios.post(`${BASE_URL}/api/biometrics/face/verify`, fd, {
            headers: fd.getHeaders()
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(`\n📊 Scan Result received in: ${duration}ms`);
        console.log(`    Response status: ${response.data.success ? 'Success' : 'Failed (Expected for empty face)'}`);
        console.log(`    Message: ${response.data.message}`);

        if (duration < 3000) {
            console.log("\n✅ PERFORMANCE PASSED: Verification processing is well under 3 seconds!");
        } else {
            console.log(`\n⚠️ PERFORMANCE WARNING: Verification took longer than 3 seconds (${duration}ms)`);
        }
    } catch (error) {
        console.error("❌ Request failed:", error.response?.data?.message || error.message);
    }
}

testScanSpeed();
