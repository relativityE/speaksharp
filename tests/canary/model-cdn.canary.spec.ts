import { test, expect } from '@playwright/test';

/**
 * 🚨 MODEL CDN CANARY TEST 🚨
 * 
 * This test verifies that the external origins for Whisper models and tokenizers
 * are reachable. This ensures that the "Private STT" fallback mechanism works.
 */
test.describe('Model CDN Health Check @canary', () => {
    const MODELS = ['tiny', 'base', 'small'];
    const ORIGIN = 'https://rmbl.us/whisper-turbo';
    const TOKENIZER_URL = 'https://huggingface.co/openai/whisper-large-v2/raw/main/tokenizer.json';

    for (const model of MODELS) {
        test(`should reach ${model} model endpoint`, async ({ request }) => {
            const url = `${ORIGIN}/${model}-q8g16.bin`;
            const response = await request.head(url);

            if (!response.ok()) {
                console.error(`❌ Model ${model} is UNREACHABLE at ${url} (Status: ${response.status()})`);
            }

            expect(response.ok(), `Model ${model} should be reachable at ${url}`).toBe(true);
            expect(parseInt(response.headers()['content-length'] || '0')).toBeGreaterThan(1000000); // Models are >1MB
        });
    }

    test('should reach tokenizer endpoint on HuggingFace', async ({ request }) => {
        const response = await request.head(TOKENIZER_URL);

        if (!response.ok()) {
            console.error(`❌ Tokenizer is UNREACHABLE at ${TOKENIZER_URL} (Status: ${response.status()})`);
        }

        expect(response.ok(), `Tokenizer should be reachable at ${TOKENIZER_URL}`).toBe(true);
        expect(parseInt(response.headers()['content-length'] || '0')).toBeGreaterThan(1000); // Tokenizer is >1KB
    });
});
