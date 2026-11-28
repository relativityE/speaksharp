// Offline Private-STT probe: transcribe 16 kHz mono s16 WAV files with the product's own Whisper files and decode options.
// Local only: remote model loading is disabled, so nothing is downloaded. No product code is changed or exercised in the browser.
//
// Usage (from the repository root, after `pnpm install`):
//   node tools/stt-filler-probe/transcribe.mjs . <wav...>
// Options (environment):
//   MODEL_ID   model folder name under MODEL_DIR (default whisper-base.en, the shipped Private model)
//   MODEL_DIR  model root (default frontend/public/models/); point it at a separately downloaded model to compare
//   ANTILOOP=1 add condition_on_previous_text=false and no_repeat_ngram_size=6 (the v4 anti-loop settings)
// Decode options match frontend/src/services/transcription/engines/transformers-js.worker.ts:
//   chunk_length_s 30, stride_length_s 0, return_timestamps false, quantized.
import fs from 'node:fs';
import path from 'node:path';

const [repo, ...files] = process.argv.slice(2);
if (!repo || files.length === 0) {
    console.error('usage: node tools/stt-filler-probe/transcribe.mjs <repoRoot> <wav...>');
    process.exit(2);
}
const { pipeline, env } = await import(path.join(path.resolve(repo), 'node_modules/@xenova/transformers/src/transformers.js'));
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = process.env.MODEL_DIR ?? path.join(path.resolve(repo), 'frontend/public/models/');
const asr = await pipeline('automatic-speech-recognition', process.env.MODEL_ID ?? 'whisper-base.en', { quantized: true });

/** 16 kHz mono signed 16-bit PCM WAV -> Float32Array in [-1, 1). Anything else is refused. */
export function readWav(file) {
    const b = fs.readFileSync(file);
    let o = 12;
    let data;
    let fmt;
    while (o < b.length) {
        const id = b.toString('ascii', o, o + 4);
        const n = b.readUInt32LE(o + 4);
        if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
        if (id === 'data') data = b.subarray(o + 8, o + 8 + n);
        o += 8 + n + (n & 1);
    }
    if (!fmt || !data || fmt.ch !== 1 || fmt.sr !== 16000 || fmt.bits !== 16) throw new Error(`need 16 kHz mono s16: ${file}`);
    const a = new Float32Array(data.length / 2);
    for (let i = 0; i < a.length; i++) a[i] = data.readInt16LE(i * 2) / 32768;
    return a;
}

const antiLoop = process.env.ANTILOOP ? { condition_on_previous_text: false, no_repeat_ngram_size: 6 } : {};
for (const f of files) {
    const r = await asr(readWav(f), { chunk_length_s: 30, stride_length_s: 0, return_timestamps: false, ...antiLoop });
    console.log(path.basename(f).padEnd(28), '|', r.text.trim());
}
