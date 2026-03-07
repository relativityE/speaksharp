import { AssemblyAI } from 'assemblyai';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences.js';
import { calculateWordErrorRate } from '../frontend/src/lib/wer.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.resolve(__dirname, '../tests/fixtures/stt-isomorphic/audio');
const BENCHMARK_FILE = path.resolve(__dirname, '../docs/STT_BENCHMARKS.json');

const apiKey = process.env.ASSEMBLYAI_API_KEY;
if (!apiKey) {
    console.error('❌ ASSEMBLYAI_API_KEY is not set in environment or .env');
    console.error('👉 TIP: This key is managed as a GitHub Secret.');
    console.error('👉 TIP: Run `gh secret list` to verify, and check docs/TEST_PLAYBOOK.md for testing setup.');
    process.exit(1);
}

const client = new AssemblyAI({ apiKey });

async function runBenchmark() {
    console.log('🚀 Starting AssemblyAI WER Benchmark...');
    let totalWer = 0;
    let successCount = 0;

    for (const sentence of HARVARD_SENTENCES) {
        const filePath = path.join(AUDIO_DIR, `${sentence.id}.wav`);

        try {
            // Check if file exists
            await fs.access(filePath);

            console.log(`Processing ${sentence.id}...`);
            const transcript = await client.transcripts.transcribe({
                audio: filePath,
            });

            if (transcript.status === 'error') {
                throw new Error(transcript.error);
            }

            const predicted = transcript.text || '';
            const wer = calculateWordErrorRate(sentence.transcript, predicted);

            console.log(`✅ ${sentence.id}: WER = ${(wer * 100).toFixed(2)}%`);
            console.log(`   Ref: ${sentence.transcript}`);
            console.log(`   Hyp: ${predicted}`);

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

    console.log('\n📊 AssemblyAI Benchmark Results');
    console.log(`Average Accuracy: ${averageAccuracy.toFixed(2)}%`);

    // Load existing benchmarks for regression check
    const benchmarkData = JSON.parse(await fs.readFile(BENCHMARK_FILE, 'utf-8'));
    const previousAccuracy = benchmarkData.engines.Cloud.expectedAccuracy;
    const REGRESSION_TOLERANCE = 2.0; // 2% 

    if (averageAccuracy < previousAccuracy - REGRESSION_TOLERANCE) {
        console.error(`\n❌ REGRESSION DETECTED!`);
        console.error(`   Previous: ${previousAccuracy.toFixed(2)}%`);
        console.error(`   New:      ${averageAccuracy.toFixed(2)}%`);
        process.exit(1);
    }

    // Update STT_BENCHMARKS.json
    benchmarkData.engines.Cloud.expectedAccuracy = parseFloat(averageAccuracy.toFixed(2));
    benchmarkData.engines.Cloud.history = benchmarkData.engines.Cloud.history || [];
    benchmarkData.engines.Cloud.history.push({
        timestamp: new Date().toISOString(),
        model: 'AssemblyAI (Cloud)',
        corpus: 'harvard-list-1',
        ceiling_wer: parseFloat(averageWer.toFixed(4)),
        ceiling_accuracy_pct: parseFloat(averageAccuracy.toFixed(2)),
        environment: 'node-ci',
    });

    await fs.writeFile(BENCHMARK_FILE, JSON.stringify(benchmarkData, null, 2), 'utf-8');
    console.log('✅ Updated STT_BENCHMARKS.json');
}

runBenchmark();
