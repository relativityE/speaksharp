/**
 * Adapted from IBM Granite Speech Streaming WebGPU granite-engine.js.
 * Source revision b347f5c68221aaef9cc4b6b8f85f71b8b61cc1e1.
 * Original SHA256 b7b4554b881d1b74f4bfe688fd6b4cb97561cea135a6b49bf65c6d5784a417ca.
 * Apache-2.0 as declared by that Space README; see LICENSE and PROVENANCE.md.
 * SpeakSharp modifications: module/runtime injection; verified-buffer-only assets;
 * explicit model/backend; no fallback; strict warmup; session/tensor cleanup.
 * Streaming policy/UI omitted. Frontend and tokenizer algorithms retained.
 */
/*
 * The CTC frontend/tokenizer/engine/streaming modules concatenated into one
 * classic script, plus a DOM-free `window.GraniteEngine` API tail. A private
 * Space's cross-site iframe does not authenticate the module fetches issued
 * while the page is parsing (they 401, and the module map then caches that
 * failure), whereas classic scripts always carry the cookie -- that's why
 * this is one script rather than four ES modules plus an import of this file.
 *
 * The module logic (everything above the "app.js" section) originally came
 * from ctc-frontend.js, ctc-tokenizer.js, ctc-engine.js, and ctc-streaming.js
 * via a build script; that pipeline is gone, so this file is now hand-edited
 * directly.
 */
export function createGraniteCtcModule(ort, files) {
'use strict';
// Only caller-supplied, already verified buffers are reachable. No network/cache fallback.
const asset = (url) => {
    const name = url.split('/').pop();
    if (!Object.hasOwn(files, name)) throw new Error(`Missing verified Granite asset: ${name}`);
    return files[name];
};
const fetch = async (url) => new Response(asset(url));
// Stands in for the module namespace: each module destructures what it
// imports off this and assigns its exports back onto it.
const __M = {};

// ==== ctc-frontend.js ===================================================
(() => {
/**
 * Audio front-end for the FastConformer CTC model.
 *
 * A port of the model's `CtcConformerProcessor._frontend` (log-mel + deltas +
 * frame stacking) plus the sidecar's `_agc`. The mel filterbank and the STFT
 * window are NOT recomputed here -- they are loaded from `mel_filters.bin` /
 * `stft_window.bin`, dumped by export_ctc_onnx.py straight out of the torchaudio
 * objects the Python path uses. Reimplementing torchaudio's htk mel scale
 * (norm=None) and torch.stft's window centring in JS is the most likely place for
 * a silent mismatch, and a front-end that is subtly wrong degrades WER without
 * ever raising an error.
 *
 * Verified bit-for-bit against the Python features by test-frontend.mjs.
 */

const EPS = 1e-10;

/** In-place iterative radix-2 complex FFT (Cooley-Tukey, decimation in time). */
class FFT {
    constructor(size) {
        this.size = size;
        this.levels = Math.log2(size) | 0;
        if (2 ** this.levels !== size) throw new Error(`FFT size ${size} is not a power of two`);

        // Bit-reversal permutation and twiddle tables, precomputed once: the
        // front-end runs this transform ~100 times per second of audio.
        this.rev = new Uint32Array(size);
        for (let i = 0; i < size; i++) {
            let r = 0;
            for (let b = 0; b < this.levels; b++) r |= ((i >> b) & 1) << (this.levels - 1 - b);
            this.rev[i] = r;
        }
        this.cos = new Float32Array(size / 2);
        this.sin = new Float32Array(size / 2);
        for (let i = 0; i < size / 2; i++) {
            this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
            this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
        }
    }

    /** Transform `re`/`im` in place (both length `size`). */
    run(re, im) {
        const { size, rev, cos, sin } = this;
        for (let i = 0; i < size; i++) {
            const j = rev[i];
            if (j > i) {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (let len = 2; len <= size; len <<= 1) {
            const half = len >> 1;
            const step = size / len;
            for (let i = 0; i < size; i += len) {
                for (let j = 0, k = 0; j < half; j++, k += step) {
                    const c = cos[k], s = sin[k];
                    const a = i + j, b = a + half;
                    const tre = re[b] * c - im[b] * s;
                    const tim = re[b] * s + im[b] * c;
                    re[b] = re[a] - tre; im[b] = im[a] - tim;
                    re[a] += tre; im[a] += tim;
                }
            }
        }
    }
}

/**
 * Centred moving average, cumsum-based (O(n)).
 *
 * Mirrors the sidecar's `_moving_avg`, including its edge handling: the valid
 * region is padded by replicating the first/last valid value, with the extra
 * sample going on the right when the window is even.
 */
function movingAvg(v, win) {
    const n = v.length;
    win = Math.max(1, win | 0);
    if (win <= 1 || n <= 1) return v;
    win = Math.min(win, n);

    // float64 accumulator: a float32 cumsum over ~10 s of samples loses enough
    // precision to shift the gain envelope (the Python side uses float64 too).
    const csum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) csum[i + 1] = csum[i] + v[i];

    const valid = n - win + 1;
    const padL = (win - 1) >> 1;
    const out = new Float32Array(n);
    const first = (csum[win] - csum[0]) / win;
    const last = (csum[n] - csum[n - win]) / win;
    for (let i = 0; i < n; i++) {
        const k = i - padL;
        out[i] = k < 0 ? first : k >= valid ? last : (csum[k + win] - csum[k]) / win;
    }
    return out;
}

/**
 * Automatic gain control -- port of the sidecar's `_agc`.
 *
 * Not cosmetic: the CTC front-end normalizes log-mel against the clip's *global
 * peak*, so a quiet tail 20-40 dB below a loud head gets floored and silently
 * dropped. A smoothed moving-RMS gain toward `target` equalizes the levels.
 */
function agc(x, { sampleRate = 16000, target = 0.12, winMs = 150, maxGain = 20 } = {}) {
    const n = x.length;
    if (n === 0) return x;
    const win = Math.max(1, Math.round((sampleRate * winMs) / 1000));

    const sq = new Float32Array(n);
    for (let i = 0; i < n; i++) sq[i] = x[i] * x[i];
    const ms = movingAvg(sq, win);

    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const env = Math.sqrt(ms[i] + 1e-9);
        g[i] = Math.min(Math.max(target / Math.max(env, 1e-4), 0), maxGain);
    }
    const gs = movingAvg(g, win); // smooth the gain to avoid pumping

    const y = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
        y[i] = x[i] * gs[i];
        const a = Math.abs(y[i]);
        if (a > peak) peak = a;
    }
    if (peak > 0.97) {
        const k = 0.97 / peak;
        for (let i = 0; i < n; i++) y[i] *= k;
    }
    return y;
}

class CtcFrontend {
    constructor(config, melFilters, window) {
        this.config = config;
        this.melFilters = melFilters; // [n_mels][n_freqs], mel-major
        this.window = window;         // n_fft, already centred by the exporter
        this.fft = new FFT(config.n_fft);
        this.nFreqs = config.n_fft / 2 + 1;
    }

    static async load(baseUrl = './onnx-ctc/') {
        const get = async (name, as) => {
            const r = await fetch(baseUrl + name);
            if (!r.ok) throw new Error(`front-end asset ${name}: HTTP ${r.status}`);
            return as === 'json' ? r.json() : new Float32Array(await r.arrayBuffer());
        };
        const [config, melFilters, window] = await Promise.all([
            get('frontend_config.json', 'json'),
            get('mel_filters.bin'),
            get('stft_window.bin'),
        ]);
        return new CtcFrontend(config, melFilters, window);
    }

    /** Feature frames a clip of `nSamples` produces (before padding to pad_multiple). */
    frameCount(nSamples) {
        const s = this.config.stack_factor;
        const melFrames = Math.floor(nSamples / this.config.hop_length);
        return s * Math.ceil(melFrames / s);
    }

    /**
     * waveform (Float32Array, 16 kHz mono) -> stacked log-mel(+delta) features.
     *
     * Returns `{ data, frames, dim }` where `data` is [frames, dim] row-major,
     * ready to become the model's `input_features` tensor.
     */
    compute(wav) {
        const { hop_length: hop, n_fft: nFft, n_mels: nMels, stack_factor: stack,
                logmel_floor_db: floorDb, deltas: useDeltas } = this.config;
        const nFrames = this.frameCount(wav.length);
        if (nFrames === 0) return { data: new Float32Array(0), frames: 0, dim: this.config.input_dim };

        // The processor right-pads the waveform so the trailing partial stack
        // group is filled rather than dropped, then slices to exactly nFrames.
        const need = (nFrames - 1) * hop + 1;
        let x = wav;
        if (x.length < need) {
            x = new Float32Array(need);
            x.set(wav);
        }

        // torch.stft(center=True, pad_mode='reflect'): reflect-pad by n_fft/2 so
        // frame i is centred on sample i*hop.
        const half = nFft >> 1;
        const padded = new Float32Array(x.length + nFft);
        padded.set(x, half);
        for (let i = 0; i < half; i++) {
            padded[half - 1 - i] = x[Math.min(i + 1, x.length - 1)];
            padded[half + x.length + i] = x[Math.max(x.length - 2 - i, 0)];
        }

        // Mel spectrogram, mel-major ([nMels][nFrames]) because deltas run along time.
        const mel = new Float32Array(nMels * nFrames);
        const re = new Float32Array(nFft);
        const im = new Float32Array(nFft);
        const power = new Float32Array(this.nFreqs);
        for (let t = 0; t < nFrames; t++) {
            const off = t * hop;
            for (let i = 0; i < nFft; i++) {
                re[i] = padded[off + i] * this.window[i];
                im[i] = 0;
            }
            this.fft.run(re, im);
            for (let k = 0; k < this.nFreqs; k++) power[k] = re[k] * re[k] + im[k] * im[k];
            for (let m = 0; m < nMels; m++) {
                const fb = m * this.nFreqs;
                let acc = 0;
                for (let k = 0; k < this.nFreqs; k++) acc += this.melFilters[fb + k] * power[k];
                mel[m * nFrames + t] = acc;
            }
        }

        // log10 with a floor relative to the clip's global peak, then the /4 +1
        // scaling the model was trained with.
        let mx = -Infinity;
        for (let i = 0; i < mel.length; i++) {
            const v = Math.log10(Math.max(mel[i], EPS));
            mel[i] = v;
            if (v > mx) mx = v;
        }
        const floor = mx - floorDb;
        for (let i = 0; i < mel.length; i++) mel[i] = Math.max(mel[i], floor) / 4 + 1;

        // Deltas: torchaudio.functional.compute_deltas(win_length=3) is
        // (x[t+1] - x[t-1]) / 2 with replicate edge padding.
        const nCh = useDeltas ? nMels * 2 : nMels;
        const chans = new Float32Array(nCh * nFrames);
        chans.set(mel);
        if (useDeltas) {
            for (let m = 0; m < nMels; m++) {
                const src = m * nFrames;
                const dst = (nMels + m) * nFrames;
                for (let t = 0; t < nFrames; t++) {
                    const prev = mel[src + Math.max(t - 1, 0)];
                    const next = mel[src + Math.min(t + 1, nFrames - 1)];
                    chans[dst + t] = (next - prev) / 2;
                }
            }
        }

        // Stack: (nCh, nFrames) -> (nFrames/stack, stack*nCh), i.e. row j is the
        // channels of frame stack*j followed by those of frame stack*j+1.
        const outFrames = nFrames / stack;
        const dim = stack * nCh;
        const data = new Float32Array(outFrames * dim);
        for (let j = 0; j < outFrames; j++) {
            for (let k = 0; k < stack; k++) {
                const t = j * stack + k;
                const base = j * dim + k * nCh;
                for (let c = 0; c < nCh; c++) data[base + c] = chans[c * nFrames + t];
            }
        }
        return { data, frames: outFrames, dim };
    }
}

Object.assign(__M, { agc, CtcFrontend });
})();

// ==== ctc-tokenizer.js ==================================================
(() => {
/**
 * Decoder for the model's 16384-entry SentencePiece BPE vocabulary.
 *
 * Only decoding is needed (the model never encodes text), so export_ctc_onnx.py
 * dumps the id->piece slice that can reach the decoder as vocab.json (~160 KB)
 * instead of shipping the whole tokenizer.json.
 *
 * granite-speech-5.0-470m-turboctc uses a SentencePiece-style tokenizer whose
 * `tokenizers` decoder is Sequence[Replace(U+2581 -> space), ByteFallback, Fuse,
 * Strip(1 leading space)]. Pieces are ordinary text with `▁` marking a word
 * start, except the 256 byte-fallback pieces `<0x00>`..`<0xFF>`, which spell out
 * characters outside the vocabulary one UTF-8 byte at a time. A run of
 * consecutive byte pieces is UTF-8 decoded *together* -- one character can span
 * several of them -- and a run that is not valid UTF-8 becomes one U+FFFD per
 * byte, exactly as `tokenizers`' ByteFallback does.
 *
 * (The 4.2 build used a GPT-2 ByteLevel tokenizer instead. That is a different
 * algorithm and would silently produce mojibake here, so the exporter asserts the
 * tokenizer's decoder chain matches this implementation.)
 */

const BYTE_PIECE = /^<0x([0-9A-Fa-f]{2})>$/;

class CtcDecoder {
    constructor(pieces, numSpecialTokens) {
        this.numSpecialTokens = numSpecialTokens;
        // Pre-resolve every piece, so decoding a frame of ids does no per-call
        // regex or replace work: a byte piece becomes its byte value (number),
        // any other piece its text with `▁` already turned into a space.
        this.pieces = pieces.map((piece) => {
            const m = BYTE_PIECE.exec(piece);
            return m ? parseInt(m[1], 16) : piece.replaceAll('\u2581', ' ');
        });
        this.utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    }

    static async load(baseUrl = './onnx-ctc/') {
        const [vocab, config] = await Promise.all([
            fetch(baseUrl + 'vocab.json').then((r) => {
                if (!r.ok) throw new Error(`vocab.json: HTTP ${r.status}`);
                return r.json();
            }),
            fetch(baseUrl + 'frontend_config.json').then((r) => {
                if (!r.ok) throw new Error(`frontend_config.json: HTTP ${r.status}`);
                return r.json();
            }),
        ]);
        return new CtcDecoder(vocab, config.num_special_tokens);
    }

    /** Decode content ids (all >= numSpecialTokens) to text. */
    decode(ids) {
        let out = '';
        let bytes = [];
        const flushBytes = () => {
            if (bytes.length === 0) return;
            try {
                out += this.utf8Decoder.decode(new Uint8Array(bytes));
            } catch {
                out += '\uFFFD'.repeat(bytes.length);
            }
            bytes = [];
        };
        for (const id of ids) {
            const piece = this.pieces[id - this.numSpecialTokens];
            if (piece === undefined) continue; // out-of-range id: skip rather than poison the string
            if (typeof piece === 'number') {
                bytes.push(piece);
            } else {
                flushBytes();
                out += piece;
            }
        }
        flushBytes();
        return out.startsWith(' ') ? out.slice(1) : out;
    }
}

/**
 * Greedy CTC collapse: drop repeats, then the blank, then any remaining
 * below-content ids.
 *
 * Order matters and matches the Python path: repeats are collapsed against the
 * *raw* previous id (blanks included), which is what lets a blank between two
 * identical tokens preserve both. For this model `numSpecialTokens` is 255 --
 * the CTC blank (`<unk>`) at id 0 and the special/task tokens above it carry no
 * text, and everything from 255 up is a tokenizer id as-is.
 */
function ctcCollapse(ids, { blankId = 0, numSpecialTokens = 255 } = {}) {
    const out = [];
    let prev = -1;
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (id !== prev && id !== blankId && id >= numSpecialTokens) out.push(id);
        prev = id;
    }
    return out;
}

Object.assign(__M, { CtcDecoder, ctcCollapse });
})();

// ==== ctc-engine.js =====================================================
(() => {
const { CtcFrontend, agc, CtcDecoder, ctcCollapse } = __M;
/**
 * FastConformer CTC inference engine (onnxruntime-web, WebGPU).
 *
 * The model is a custom `ctc_conformer` architecture with no transformers.js
 * support, so this drives an ONNX session directly: features -> one forward pass
 * -> greedy CTC collapse. There is no autoregressive loop, no KV cache and no
 * chat template; a window is one `session.run`.
 *
 * Two contracts come from export_ctc_onnx.py and must hold here:
 *
 *  - **Frames are padded to `pad_multiple`.** The encoder chunks attention into
 *    context_size (128) blocks at every layer and subsamples time by 4, so a
 *    frame count with no partial block anywhere is a multiple of 512 (10.24 s).
 *    The exported graph therefore has no tail-block path, and short windows are
 *    padded up with `padding_mask` marking the pad. Measured cost of the masked
 *    padding on granite-speech-4.2-470m-turboctc: none -- all 14 fixture clips
 *    decode identically to the unpadded path, with zero per-frame argmax flips.
 *    (Its encoder masks inside the conv module specifically so a padded frame
 *    cannot leak through the stride-2 kernel into the last valid frames.)
 *
 *  - **The graph returns ids, not logits.** `[1, T/4, 16384]` float32 logits
 *    would be an ~8 MB device-to-host copy per window; argmax and the
 *    log-softmax max happen inside the graph instead, so a window costs ~1 KB of
 *    output. `top_logprob` is the confidence signal the streaming gate uses.
 */



// Asset verification belongs to the shared acquisition boundary, before this module is called.
async function cachedFetch(url, onProgress) {
    const bytes = asset(url);
    onProgress?.({ url, loaded: bytes.byteLength, total: bytes.byteLength });
    return bytes;
}

class CtcEngine {
    constructor({ session, frontend, decoder, config, device }) {
        this.session = session;
        this.frontend = frontend;
        this.decoder = decoder;
        this.config = config;
        this.device = device;
        this.closed = false;
    }

    /**
     * Create the session and load the front-end assets.
     *
     * SpeakSharp requires an explicit backend and rejects fallback.
     */
    static async load({
        baseUrl = './onnx-ctc/',
        modelFile,
        device,
        onProgress = null,
        allowFallback = false,
    } = {}) {
        if (!modelFile || !Object.hasOwn(files, modelFile) || !Object.hasOwn(files, `${modelFile}.data`)) {
            throw new Error('Explicit pinned Granite model and external data are required');
        }
        if (allowFallback || !['webgpu', 'wasm'].includes(device)) {
            throw new Error('Granite requires one explicit backend without fallback');
        }
        const [frontend, decoder] = await Promise.all([
            CtcFrontend.load(baseUrl),
            CtcDecoder.load(baseUrl),
        ]);
        if (frontend.config.sample_rate !== 16000) throw new Error('Granite requires 16 kHz assets');

        const modelUrl = baseUrl + modelFile;
        // The exporter writes weights to `<model>.onnx.data` and records that
        // basename inside the graph, so the session's externalData path must
        // match it exactly.
        const dataName = `${modelFile}.data`;
        const [modelBuffer, dataBuffer] = await Promise.all([
            cachedFetch(modelUrl, onProgress),
            cachedFetch(baseUrl + dataName, onProgress),
        ]);

        const options = {
            executionProviders: [device],
            externalData: [{ path: dataName, data: dataBuffer }],
            graphOptimizationLevel: 'all',
        };
        const session = await ort.InferenceSession.create(modelBuffer, options);
        const engine = new CtcEngine({ session, frontend, decoder, config: frontend.config, device });
        const warmupError = await engine.warmup();
        if (warmupError) {
            await engine.close();
            throw new Error(`Granite ${device} warmup failed: ${warmupError}`);
        }
        engine.fallbackError = null;
        return engine;
    }

    /**
     * Run one throwaway pass so shader compilation doesn't land on the user's
     * first spoken window (measured on WebGPU: 1271 ms first call vs 295 ms
     * steady state). Every window is padded to the same frame count, so a single
     * warmup covers the shapes the streaming loop will use.
     */
    async close() {
        if (this.closed) return;
        this.closed = true;
        await this.session.release();
    }

    async run(features, mask) {
        try {
            if (this.closed) throw new Error('Granite engine is closed');
            return await this.session.run({ input_features: features, padding_mask: mask });
        } finally {
            features.dispose();
            mask.dispose();
        }
    }

    async warmup() {
        try {
            const frames = this.config.pad_multiple;
            const outputs = await this.run(
                new ort.Tensor('float32', new Float32Array(frames * this.config.input_dim), [1, frames, this.config.input_dim]),
                new ort.Tensor('float32', new Float32Array(frames), [1, frames]),
            );
            for (const tensor of Object.values(outputs)) tensor.dispose();
            return null;
        } catch (e) {
            return String(e?.message || e);
        }
    }

    /** Encoder output frames covering `frames` of real audio (both subsample blocks floor-halve). */
    static realOutFrames(frames) {
        return Math.floor(Math.floor(frames / 2) / 2);
    }

    /**
     * Transcribe a waveform (Float32Array, 16 kHz mono).
     *
     * `applyAgc` mirrors the sidecar: the log-mel front-end normalizes against
     * the clip's global peak, so without it a quiet tail after a loud passage is
     * floored away and its words are silently dropped.
     */
    async transcribe(wav, { applyAgc = true } = {}) {
        if (this.closed) throw new Error('Granite engine is closed');
        const t0 = performance.now();
        const audio = applyAgc ? agc(wav, { sampleRate: this.config.sample_rate }) : wav;
        const { data, frames, dim } = this.frontend.compute(audio);
        if (frames === 0) return { text: '', words: [], avgLogprob: null, frames: 0, ms: 0 };

        const multiple = this.config.pad_multiple;
        const padded = Math.ceil(frames / multiple) * multiple;
        const features = new Float32Array(padded * dim);
        features.set(data);
        const mask = new Float32Array(padded).fill(1);
        mask.fill(0, 0, frames);

        const outputs = await this.run(
            new ort.Tensor('float32', features, [1, padded, dim]),
            new ort.Tensor('float32', mask, [1, padded]),
        );
        try {

        // The graph emits padded/4 frames; only those covering real audio may
        // contribute tokens, so trim before collapsing.
        const nOut = CtcEngine.realOutFrames(frames);
        const ids = outputs.ids.data.subarray(0, nOut);
        const logp = outputs.top_logprob.data.subarray(0, nOut);

        const content = ctcCollapse(ids, {
            blankId: this.config.blank_id,
            numSpecialTokens: this.config.num_special_tokens,
        });
        const text = this.decoder.decode(content).trim();

        // Confidence: mean top log-probability over non-blank frames. The CTC
        // analogue of a mean per-token logprob -- clean speech sits near -0.03,
        // silence/noise confabulation near -1.85 and below.
        let sum = 0, n = 0;
        for (let i = 0; i < nOut; i++) {
            if (ids[i] !== this.config.blank_id) { sum += logp[i]; n++; }
        }
        return {
            text,
            words: text.length ? text.split(/\s+/) : [],
            avgLogprob: n ? sum / n : null,
            frames,
            paddedFrames: padded,
            ms: performance.now() - t0,
        };
        } finally {
            for (const tensor of Object.values(outputs)) tensor.dispose();
        }
    }
}

Object.assign(__M, { CtcEngine });
})();


return __M;
}
