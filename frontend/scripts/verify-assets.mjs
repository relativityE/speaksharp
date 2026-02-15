import http from 'http';

const CRITICAL_ASSETS = [
    '/whisper-turbo/session.worker.js',
    '/whisper-turbo/whisper-wasm_bg.wasm',
    '/models/tokenizer.json',
    '/models/tiny-q8g16.bin'
];

async function verifyAsset(url) {
    return new Promise((resolve) => {
        http.get(`http://localhost:5173${url}`, (res) => {
            console.log(`${res.statusCode === 200 ? '✅' : '❌'} ${url} - ${res.statusCode} (${res.headers['content-length'] ?? 'unknown'} bytes)`);
            resolve(res.statusCode === 200);
        }).on('error', (e) => {
            console.log(`❌ ${url} - UNREACHABLE (${e.message})`);
            resolve(false);
        });
    });
}

async function main() {
    console.log('🔍 Verifying Whisper-Turbo assets on localhost:5173...\n');

    const results = await Promise.all(CRITICAL_ASSETS.map(verifyAsset));

    if (results.every(Boolean)) {
        console.log('\n✅ All critical assets verified');
    } else {
        console.log('\n❌ Some assets are missing - ensure pnpm dev is running');
        process.exit(1);
    }
}

main().catch(console.error);
