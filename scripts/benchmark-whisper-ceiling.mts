import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { pipeline, env } from '@xenova/transformers';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences.js';
import { calculateWordErrorRate } from '../frontend/src/lib/wer.js';

dotenv.config();

// We'll use Xenova's Transformers.js with Whisper-tiny.en to simulate our 
// Private mode Whisper-Turbo ceiling. This gives us a deterministic static 
// Node.js baseline we can run in CI without needing WebGPU.

env.allowLocalModels = false;
env.useBrowserCache = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.resolve(__dirname, '../tests/fixtures/stt-isomorphic/audio');
const BENCHMARK_FILE = path.resolve(__dirname, '../docs/STT_BENCHMARKS.json');

async function runBenchmark() {
    console.log('🚀 Starting Whisper (Transformers.js) WER Benchmark...');

    console.log('Loading Whisper-tiny.en model...');
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    console.log('✅ Model loaded.');

    let totalWer = 0;
    let successCount = 0;

    for (const sentence of HARVARD_SENTENCES) {
        const filePath = path.join(AUDIO_DIR, `${sentence.id}.wav`);

        try {
            await fs.access(filePath);
            console.log(`Processing ${sentence.id}...`);

            const audioBuffer = await fs.readFile(filePath);
            // Transformers.js expects a Float32Array containing 16kHz audio data.
            // Since it's a bit complex to decode WAV directly in raw Node without external deps,
            // we can use the AudioContext equivalent or node-wav, or pass the buffer if the pipeline supports it.
            // Alternatively, the pipeline supports URLs or file paths directly!

            const result = await transcriber(filePath);
            const predicted = typeof result === 'string' ? result : (result as any).text || '';

            const wer = calculateWordErrorRate(sentence.transcript, predicted);

            console.log(`✅ ${sentence.id}: WER = ${(wer * 100).toFixed(2)}%`);
            console.log(`   Ref: ${sentence.transcript}`);
            console.log(`   Hyp: ${predicted.trim()}`);

            totalWer += wer;
            successCount++;
        } catch (err) {
            console.error(`❌ Failed processing ${sentence.id}:`, err);
        }
    }

    if (successCount === 0) {
        console.error('No sentences processed successfully.');
        return;
    }

    const averageWer = totalWer / successCount;
    const averageAccuracy = Math.max(0, 100 - (averageWer * 100));

    console.log('\n📊 Whisper (Transformers.js) Benchmark Results');
    console.log(`Average Accuracy: ${averageAccuracy.toFixed(2)}%`);

    // Update STT_BENCHMARKS.json
    const benchmarkData = JSON.parse(await fs.readFile(BENCHMARK_FILE, 'utf-8'));
    benchmarkData.engines.Private.expectedAccuracy = parseFloat(averageAccuracy.toFixed(2));

    await fs.writeFile(BENCHMARK_FILE, JSON.stringify(benchmarkData, null, 2), 'utf-8');
    console.log('✅ Updated STT_BENCHMARKS.json Private ceiling');
}

runBenchmark();
