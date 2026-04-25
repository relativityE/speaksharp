import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { pipeline, env } from '@xenova/transformers';
import { FILLER_SENTENCES } from '../tests/fixtures/stt-isomorphic/filler-sentences.js';
import { countFillerWords } from '../frontend/src/utils/fillerWordUtils.js';

dotenv.config();

env.allowLocalModels = false;
env.useBrowserCache = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.resolve(__dirname, '../tests/fixtures/stt-isomorphic/audio');
const BENCHMARK_FILE = path.resolve(__dirname, '../tests/STT_BENCHMARKS.json');

async function runBenchmark() {
    console.log('🚀 Starting Acoustic Filler Word Benchmark...');

    (env as any).remoteModels = true;
    (env as any).allowLocalModels = false;

    console.log('Loading Whisper-tiny.en model...');
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    console.log('✅ Model loaded.');

    let expectedTotalFillers = 0;
    let successfullyDetectedFillers = 0;

    for (const sentence of FILLER_SENTENCES) {
        const filePath = path.join(AUDIO_DIR, sentence.audio);
        
        try {
            await fs.access(filePath);
            console.log(`\nProcessing ${sentence.id}...`);

            const result = await transcriber(filePath, {
                chunk_length_s: 30,
                stride_length_s: 5,
            });
            const predicted = typeof result === 'string' ? result : (result as any).text || '';

            console.log(`   Ref Transcript: ${sentence.transcript}`);
            console.log(`   Hyp Transcript: ${predicted.trim()}`);

            // Pass empty array for user mapping, we are strictly testing universal baseline fillers
            const fillerDetects = countFillerWords(predicted, []);
            
            console.log(`   Expected Fillers:`, sentence.expectedFillers);
            const actualDetects: Record<string, number> = {};

            // Calculate matches against Expected
            for (const [fillerWord, expectedCount] of Object.entries(sentence.expectedFillers)) {
                expectedTotalFillers += expectedCount;
                
                const detectedCount = fillerDetects[fillerWord]?.count || 0;
                actualDetects[fillerWord] = detectedCount;
                
                // We cap success at expected (no extra credit for hallucinations)
                successfullyDetectedFillers += Math.min(detectedCount, expectedCount);
            }

             console.log(`   Detected Fillers:`, actualDetects);

        } catch (err) {
            console.error(`❌ Failed processing ${sentence.id}:`, err);
        }
    }

    if (expectedTotalFillers === 0) {
        console.error('No sentences processed successfully.');
        return;
    }

    const accuracy = (successfullyDetectedFillers / expectedTotalFillers) * 100;

    console.log('\n📊 Acoustic Filler Word Detection Benchmark Results');
    console.log(`Extraction Accuracy: ${accuracy.toFixed(2)}% (${successfullyDetectedFillers}/${expectedTotalFillers})`);

    // Update STT_BENCHMARKS.json
    const benchmarkData = JSON.parse(await fs.readFile(BENCHMARK_FILE, 'utf-8'));
    
    // Inject the new metric into the Private engine node
    if (!benchmarkData.engines.Private.cpu.fillerDetectionAccuracy) {
        benchmarkData.engines.Private.cpu.fillerDetectionAccuracy = parseFloat(accuracy.toFixed(2));
    } else {
        benchmarkData.engines.Private.cpu.fillerDetectionAccuracy = parseFloat(accuracy.toFixed(2));
    }

    await fs.writeFile(BENCHMARK_FILE, JSON.stringify(benchmarkData, null, 2), 'utf-8');
    console.log('✅ Updated STT_BENCHMARKS.json with Semantic Filler constraints');
}

runBenchmark();
