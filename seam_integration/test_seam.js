const { Seam } = require('seam');

async function testSeamAPI() {
    const SEAM_API_KEY = "seam_testekHg_8L1JUH1zcyTVpD7Th6ZGV3sz";
    console.log("🔌 Initializing Seam Workspace...");
    const seam = new Seam(SEAM_API_KEY);

    try {
        console.log("🛠️ Testing API Access...");
        const locks = await seam.locks.list();
        console.log(`✅ Successfully authenticated. Workspace contains ${locks.length} locks.`);

        if (locks.length === 0) {
            console.log("⚠️ Since this is an empty test workspace, I cannot trigger a virtual unlock.");
            console.log("✅ HOWEVER - The API Key is PERFECT. You are fully authenticated to Seam.");
            console.log("➡️ NEXT STEP: Create a 'Device Provider' (like Augusta or TTLock Sandbox) in your Seam Console UI, and run this script again.");
            return;
        }

    } catch (error) {
        console.error("\n❌ API Error:");
        console.error(error);
    }
}

testSeamAPI();
