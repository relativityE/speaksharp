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
const BENCHMARK_FILE = path.resolve(__dirname, '../tests/STT_BENCHMARKS.json');

async function runBenchmark() {
    console.log('🚀 Starting Whisper (Transformers.js) WER Benchmark...');

    // Experts: Transformers.js sometimes tries to load 'sharp' even for audio-only pipelines.
    // We set these env flags to disable image processing features we don't need.
    (env as any).remoteModels = true;
    (env as any).allowLocalModels = false;

    console.log('Loading Whisper-tiny.en model...');
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    console.log('✅ Model loaded.');

    let totalWer = 0;
    let successCount = 0;

    // Use the 10 isomorphic Harvard Sentence WAV files
    for (const sentence of HARVARD_SENTENCES) {
        const filePath = path.join(AUDIO_DIR, `h1_${sentence.id.split('_')[1]}.wav`);
        
        try {
            await fs.access(filePath);
            console.log(`Processing ${sentence.id}...`);

            const result = await transcriber(filePath, {
                chunk_length_s: 30,
                stride_length_s: 5,
            });
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
    benchmarkData.engines.Private.cpu.expectedAccuracy = parseFloat(averageAccuracy.toFixed(2));

    await fs.writeFile(BENCHMARK_FILE, JSON.stringify(benchmarkData, null, 2), 'utf-8');
    console.log('✅ Updated STT_BENCHMARKS.json Private (CPU) ceiling');
}

runBenchmark();
