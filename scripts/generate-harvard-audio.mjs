import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences.js'; // Ensure .js for Node ES modules
import fs from 'fs/promises';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, '../tests/fixtures/stt-isomorphic/audio');

async function generateAudio() {
    await fs.mkdir(outputDir, { recursive: true });
    console.log(`Generating 16kHz mono PCM audio for ${HARVARD_SENTENCES.length} Harvard Sentences...`);

    for (const sentence of HARVARD_SENTENCES) {
        const filename = path.join(outputDir, `${sentence.id}.wav`);
        // Use macOS 'say' with explicit data format: 16-bit LE Integer, 16000 Hz, mono
        // Alex is a standard embedded US English voice
        const cmd = `say -v Alex -o "${filename}" --data-format=LEI16@16000 "${sentence.transcript}"`;
        try {
            await execAsync(cmd);
            console.log(`✅ Generated ${sentence.id}.wav`);
        } catch (err) {
            console.error(`❌ Failed to generate ${sentence.id}.wav:`, err);
        }
    }
}

generateAudio().catch(console.error);
