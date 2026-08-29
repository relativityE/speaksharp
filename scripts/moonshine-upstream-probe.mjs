/**
 * #1304 — upstream-runtime comparison for the Moonshine empty-hypothesis cells.
 *
 * Runs the SAME audio bytes through the SAME pinned weights and revision, but in Node via
 * @huggingface/transformers + onnxruntime-node, instead of the browser's ORT-Web. Everything that can
 * be held equal is held equal; the runtime backend is the variable under test.
 *
 * PARITY DIFFERENCES, stated rather than hidden:
 *  - Audio reaches the browser through decodeAudioData and Node through ffmpeg -> f32le PCM. Both are
 *    16 kHz mono and the source FLAC is already 16 kHz, so neither path resamples.
 *  - onnxruntime-node is NOT a backend the product ships. This probe answers "is it the model or the
 *    browser runtime", never "how would this perform for a user".
 *
 * Evidence-first: the artifact is written after every cell, before anything is printed.
 */
import { writeFileSync, renameSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

const arg = (n, d = '') => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const outPath = arg('out'); if (!outPath) { console.error('--out required'); process.exit(2); }

const CELLS = [
    { id: '2414-128291-0008', path: 'bench-corpus/LibriSpeech/test-other/2414/128291/2414-128291-0008.flac', ref: 'THOU ALSO THOU ALSO', role: 'failing' },
    { id: '1089-134686-0002', path: 'bench-corpus/LibriSpeech/test-clean/1089/134686/1089-134686-0002.flac', ref: 'AFTER EARLY NIGHTFALL...', role: 'control' },
];
const MODELS = [
    { arm: 'moonshine:tiny', modelId: 'onnx-community/moonshine-tiny-ONNX', revision: 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95' },
    { arm: 'moonshine:base', modelId: 'onnx-community/moonshine-base-ONNX', revision: 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad' },
];

/** Decode FLAC to mono f32 16 kHz without resampling (the source is already 16 kHz). */
function pcm(path) {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'],
        { maxBuffer: 1 << 28 });
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

const results = [];
const persist = (complete) => {
    mkdirSync(dirname(outPath), { recursive: true });
    const tmp = `${outPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({
        kind: 'upstream_runtime_comparison', complete,
        runtime: 'node:@huggingface/transformers + onnxruntime-node',
        note: 'onnxruntime-node is NOT a shipped product backend; this isolates model vs browser runtime only',
        results,
    }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2)}\n`);
    renameSync(tmp, outPath);
};
persist(false);

const { pipeline } = await import('@huggingface/transformers');

for (const m of MODELS) {
    let asr = null, loadError = null;
    try {
        asr = await pipeline('automatic-speech-recognition', m.modelId, { revision: m.revision, dtype: 'fp32' });
    } catch (e) { loadError = e instanceof Error ? e.message.slice(0, 300) : String(e); }

    for (const c of CELLS) {
        const cell = { arm: m.arm, modelId: m.modelId, revision: m.revision, utteranceId: c.id, role: c.role, reference: c.ref };
        if (!asr) { cell.error = `model load failed: ${loadError}`; results.push(cell); persist(false); continue; }
        try {
            const audio = pcm(c.path);
            const seconds = audio.length / 16000;
            const maxNewTokens = Math.min(512, Math.max(1, Math.ceil(seconds * 6)));
            cell.audioSeconds = Number(seconds.toFixed(3));
            cell.pcmSamples = audio.length;
            cell.rms = Math.sqrt(audio.reduce((a, v) => a + v * v, 0) / audio.length);
            cell.maxNewTokens = maxNewTokens;

            const out = await asr(audio, { max_new_tokens: maxNewTokens });
            cell.pipelineText = out?.text ?? null;

            const feats = await asr.processor(audio);
            const gen = await asr.model.generate({ ...feats, max_new_tokens: maxNewTokens });
            const ids = (gen?.tolist ? gen.tolist()[0] : Array.from(gen?.data ?? [])).map(Number);
            const eosId = asr.tokenizer?.eos_token_id ?? asr.model?.config?.eos_token_id ?? null;
            cell.tokenIds = ids.slice(0, 128);
            cell.generatedCount = ids.length;
            cell.firstToken = ids[0] ?? null;
            cell.eosTokenId = eosId;
            cell.eosPosition = eosId === null ? null : ids.indexOf(eosId);
            cell.decoderStartTokenId = asr.model?.config?.decoder_start_token_id ?? null;
            cell.rawDecoded = asr.tokenizer?.decode ? asr.tokenizer.decode(ids, { skip_special_tokens: false }) : null;
            cell.terminationReason = eosId !== null && ids.includes(eosId) ? 'eos'
                : ids.length >= maxNewTokens ? 'max_new_tokens' : 'unknown';
        } catch (e) {
            cell.error = e instanceof Error ? `${e.name}: ${e.message.slice(0, 300)}` : String(e);
        }
        results.push(cell);
        persist(false);                       // durable BEFORE printing
        console.log(`  ${cell.arm} x ${cell.utteranceId} (${cell.role}) -> `
            + (cell.error ? `ERROR ${cell.error}` : `text=${JSON.stringify(cell.pipelineText)} tokens=${cell.generatedCount} termination=${cell.terminationReason}`));
    }
}
persist(true);
console.log(`\nwrote ${outPath}`);
