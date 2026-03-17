const fs = require('fs');
const path = require('path');

const ROOT = 'c:/Users/SAM/Documents/Antigravity/LockingApp';
const EXPECTED_PROJECT_ID = 'auralock-system-2026';
const EXPECTED_REGION = 'asia-south1';

const results = {
    critical_files: [],
    warnings: [],
    errors: []
};

function checkFile(filePath, patterns) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    patterns.forEach(p => {
        if (p.regex.test(content)) {
            const match = content.match(p.regex)[0];
            const result = {
                file: path.relative(ROOT, filePath),
                match: match,
                description: p.description,
                severity: p.severity
            };
            if (p.severity === 'ERROR') results.errors.push(result);
            else results.warnings.push(result);
        }
    });
}

// 1. Check Terminal App config
checkFile(path.join(ROOT, 'terminal-app/src/App.jsx'), [
    {
        regex: /https:\/\/smart-door-backend-957b\.onrender\.com/i,
        description: 'Hardcoded legacy Render URL in App.jsx fallback',
        severity: 'WARNING'
    }
]);

checkFile(path.join(ROOT, 'terminal-app/.env.production'), [
    {
        regex: /https:\/\/smart-door-backend\.auralock-system-2026\.a\.run\.app/i,
        description: 'Legacy/Short Cloud Run URL detected (may cause SSL issues)',
        severity: 'WARNING'
    }
]);

// 2. Check Backend config
checkFile(path.join(ROOT, 'backend/server.js'), [
    {
        regex: /process\.env\.RENDER/i,
        description: 'Render-specific environment check found in server.js (should be GCP-aware)',
        severity: 'WARNING'
    },
    {
        regex: /smart-door-edge-957b/i,
        description: 'Hardcoded legacy Render service discovery suffix in server.js',
        severity: 'ERROR'
    }
]);

// 3. Check build scripts
checkFile(path.join(ROOT, 'build_apk.ps1'), [
    {
        regex: /https:\/\/smart-door-backend\.auralock-system-2026\.a\.run\.app/i,
        description: 'Production API URL in build_apk.ps1 points to potential SSL-mismatched endpoint',
        severity: 'ERROR'
    }
]);

// 4. Summarize
console.log('--- 🏗️ Architecture Validation Report ---');
if (results.errors.length > 0) {
    console.log('\n❌ CRITICAL ERRORS:');
    results.errors.forEach(e => console.log(`[${e.file}] ${e.description} (Found: ${e.match})`));
}

if (results.warnings.length > 0) {
    console.log('\n⚠️ WARNINGS:');
    results.warnings.forEach(e => console.log(`[${e.file}] ${e.description} (Found: ${e.match})`));
}

if (results.errors.length === 0 && results.warnings.length === 0) {
    console.log('\n✅ No architectural inconsistencies found!');
}

console.log('\n---------------------------------------');
