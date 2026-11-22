// Offline decoding experiment: does a Whisper text prompt (or beam search) change how a sentence-initial filler is read?
// transformers.js 2.17.2 has no prompt_ids option, so the prompt is forced through decoder_start <|startofprev|> + the prompt
// tokens + <|startoftranscript|> <|notimestamps|>. The "none" arm reproduces the pipeline output exactly (method check).
// Local only: remote model loading is disabled.
//
// Usage (from the repository root): node tools/stt-filler-probe/prompt.mjs . <wav...>
//   BEAMS=5 to use beam search (default greedy)
import fs from 'node:fs';
import path from 'node:path';

const [repo, ...files] = process.argv.slice(2);
if (!repo || files.length === 0) {
    console.error('usage: node tools/stt-filler-probe/prompt.mjs <repoRoot> <wav...>');
    process.exit(2);
}
const T = await import(path.join(path.resolve(repo), 'node_modules/@xenova/transformers/src/transformers.js'));
T.env.allowLocalModels = true;
T.env.allowRemoteModels = false;
T.env.localModelPath = process.env.MODEL_DIR ?? path.join(path.resolve(repo), 'frontend/public/models/');
const asr = await T.pipeline('automatic-speech-recognition', process.env.MODEL_ID ?? 'whisper-base.en', { quantized: true });
const { model, tokenizer, processor } = asr;

function readWav(file) {
    const b = fs.readFileSync(file);
    let o = 12;
    let data;
    while (o < b.length) {
        const id = b.toString('ascii', o, o + 4);
        const n = b.readUInt32LE(o + 4);
        if (id === 'data') data = b.subarray(o + 8, o + 8 + n);
        o += 8 + n + (n & 1);
    }
    const a = new Float32Array(data.length / 2);
    for (let i = 0; i < a.length; i++) a[i] = data.readInt16LE(i * 2) / 32768;
    return a;
}

/** The prompts tried on 2026-11-11. `context` is a real sentence from the fixture script. */
const PROMPTS = {
    none: null,
    disfluent: 'Um, uh, so, ah, I think, uh, we should, um, start.',
    uhonly: 'Uh, okay. Uh, so.',
    context: 'Deadlines live in different places, which makes updates easy to miss.',
};
// whisper-base.en (English-only) special tokens.
const SOT = 50257, NOTS = 50362, PREV = 50360, EOT = 50256;

async function decode(audio, prompt) {
    const { input_features } = await processor(audio);
    let start = SOT;
    let forced = [[1, NOTS]];
    if (prompt) {
        const ids = tokenizer.encode(' ' + prompt.trim(), null, { add_special_tokens: false });
        start = PREV;
        forced = [...ids.map((t, i) => [i + 1, t]), [ids.length + 1, SOT], [ids.length + 2, NOTS]];
    }
    const out = await model.generate(input_features, {
        decoder_start_token_id: start, forced_decoder_ids: forced, max_new_tokens: 200, num_beams: Number(process.env.BEAMS ?? 1),
    });
    const seq = Array.from(out[0] ?? out.sequences?.[0] ?? [], Number);
    const after = seq.slice(seq.indexOf(NOTS) + 1).filter((t) => t !== EOT && t < 50257);
    return tokenizer.decode(after, { skip_special_tokens: true }).trim();
}

for (const f of files) {
    const audio = readWav(f).slice(0, 16000 * 30);
    const row = [];
    for (const [k, p] of Object.entries(PROMPTS)) row.push(`${k}: ${await decode(audio, p)}`);
    console.log(`== ${path.basename(f)}\n   ` + row.join('\n   '));
}
