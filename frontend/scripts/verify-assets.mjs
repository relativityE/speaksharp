import http from 'http';

const CRITICAL_ASSETS = [
    '/whisper-turbo/session.worker.js',
    '/whisper-turbo/whisper-wasm_bg.wasm',
    '/models/tokenizer.json',
    '/models/tiny-q8g16.bin',
    '/models/whisper-tiny.en/config.json',
    '/models/whisper-tiny.en/tokenizer.json',
    '/models/whisper-tiny.en/preprocessor_config.json',
    '/models/whisper-tiny.en/generation_config.json',
    '/models/whisper-tiny.en/onnx/encoder_model_quantized.onnx',
    '/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx'
];

async function verifyAsset(url) {
    return new Promise((resolve) => {
        const assetUrl = new URL(url, 'http://localhost:5173');
        const req = http.request(assetUrl, { method: 'HEAD' }, (res) => {
            console.log(`${res.statusCode === 200 ? '✅' : '❌'} ${url} - ${res.statusCode} (${res.headers['content-length'] ?? 'unknown'} bytes)`);
            resolve(res.statusCode === 200);
            res.resume();
        });

        req.on('error', (e) => {
            console.log(`❌ ${url} - UNREACHABLE (${e.message || e.code || 'unknown error'})`);
            resolve(false);
        });

        req.end();
    });
}

async function main() {
    console.log('🔍 Verifying Private STT assets on localhost:5173...\n');

    const results = await Promise.all(CRITICAL_ASSETS.map(verifyAsset));

    if (results.every(Boolean)) {
        console.log('\n✅ All critical assets verified');
    } else {
        console.log('\n❌ Some assets are missing - ensure pnpm dev is running');
        process.exit(1);
    }
}

main().catch(console.error);
