async function Jr({ backend: t = "webgpu", wasmPaths: e, numThreads: n } = {}) {
  let a;
  try {
    const o = await Promise.resolve().then(() => vs);
    a = o.default || o, a.env || o.ort && (a = o.ort);
  } catch {
    throw new Error("Failed to load ONNX Runtime Web. Please check your network connection.");
  }
  if (!a || !a.env)
    throw new Error("ONNX Runtime Web loaded but env is not available. This might be a bundling issue.");
  if (!a.env.wasm.wasmPaths) {
    const i = a.env.versions?.common || "1.24.1";
    a.env.versions?.common, a.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${i}/dist/`;
  }
  return (t === "wasm" || t === "webgpu") && (typeof SharedArrayBuffer < "u" ? (a.env.wasm.numThreads = n || navigator.hardwareConcurrency || 4, a.env.wasm.simd = !0) : a.env.wasm.numThreads = 1, a.env.wasm.proxy = !1), t === "webgpu" && ("gpu" in navigator || (t = "wasm")), typeof globalThis < "u" && (globalThis.ort = a), a;
}
async function Ca(t) {
  const e = await fetch(t);
  if (!e.ok) throw new Error(`Failed to fetch ${t}: ${e.status}`);
  return e.text();
}
class en {
  /**
   * @param {string[]} id2token Array where index=id and value=token string
   */
  constructor(e) {
    this.id2token = e, this.blankToken = "<blk>", this.blankId = e.findIndex((n) => n === "<blk>"), this.blankId === -1 && (this.blankId = 1024), this.sanitizedTokens = this.id2token.map((n) => n && n.replace(/\u2581/g, " "));
  }
  /**
   * Create a tokenizer from a `vocab.txt` or `tokens.txt` URL.
   * @param {string} tokensUrl - URL to tokenizer vocabulary file.
   * @returns {Promise<ParakeetTokenizer>} Loaded tokenizer instance.
   */
  static async fromUrl(e) {
    const a = (await Ca(e)).split(/\r?\n/).filter(Boolean), o = [];
    for (const i of a) {
      const [c, d] = i.split(/\s+/), f = parseInt(d, 10);
      isNaN(f) || !c || (o[f] = c);
    }
    return new en(o);
  }
  /**
   * Decode an array of token IDs into a human readable string.
   * Implements the SentencePiece rule where leading `▁` marks a space.
   * Matches the Python reference regex pattern: r"\A\s|\s\B|(\s)\b"
   * @param {number[]} ids - Token IDs from decoder output.
   * @returns {string} Decoded transcript text.
   */
  decode(e) {
    const n = [];
    for (const o of e) {
      if (o === this.blankId) continue;
      const i = this.sanitizedTokens[o];
      i !== void 0 && n.push(i);
    }
    let a = n.join("");
    return a = a.replace(/^\s+/, ""), a = a.replace(/\s+(?=[^\w\s])/g, ""), a = a.replace(/\s+/g, " "), a.trim();
  }
}
class Ia {
  /**
   * @param {string} modelUrl URL to the preprocessor onnx file (e.g. nemo128.onnx)
   * @param {Object} [opts]
   * @param {('webgpu'|'wasm')} [opts.backend]
   */
  constructor(e, n = {}) {
    this.modelUrl = e, this.opts = n, this.opts.enableGraphCapture === void 0 && (this.opts.enableGraphCapture = this.opts.backend === "wasm"), this.session = null, this.ort = null, this._sessionPromise = null;
  }
  /**
   * Lazily create and cache the ONNX Runtime session.
   * @returns {Promise<void>}
   */
  async _ensureSession() {
    if (!this.session) {
      if (this._sessionPromise) {
        await this._sessionPromise;
        return;
      }
      this._sessionPromise = (async () => {
        this.ort = await Jr(this.opts);
        const e = this.opts.enableGraphCapture ? {
          enableProfiling: this.opts.enableProfiling || !1,
          enableGraphCapture: !0
        } : {
          enableProfiling: this.opts.enableProfiling || !1
        }, n = async () => {
          try {
            return await this.ort.InferenceSession.create(this.modelUrl, e);
          } catch (a) {
            const o = (a.message || "") + "";
            if (e.enableGraphCapture && o.includes("graph capture"))
              return await this.ort.InferenceSession.create(this.modelUrl, { ...e, enableGraphCapture: !1 });
            throw a;
          }
        };
        this.session = await n();
      })();
      try {
        await this._sessionPromise;
      } catch (e) {
        throw this._sessionPromise = null, e;
      } finally {
        this.session && (this._sessionPromise = null);
      }
    }
  }
  /**
   * Convert PCM audio Float32Array into log-mel features recognised by Parakeet.
   * @param {Float32Array} audio Normalised mono PCM [-1,1] at 16 kHz.
   * @returns {Promise<{features: Float32Array, length: number}>}
   */
  async process(e) {
    await this._ensureSession();
    let n;
    e instanceof Float32Array ? n = e.byteOffset === 0 && e.buffer.byteLength === e.byteLength ? e : new Float32Array(e) : n = new Float32Array(e);
    const a = new this.ort.Tensor("float32", n, [1, n.length]), o = new BigInt64Array([BigInt(n.length)]), i = new this.ort.Tensor("int64", o, [1]), c = { waveforms: a, waveforms_lens: i }, d = await this.session.run(c), f = d.features, p = d.features_lens, m = new Float32Array(f.data), w = Number(p.data[0]);
    return a.dispose?.(), i.dispose?.(), f.dispose?.(), p.dispose?.(), {
      features: m,
      length: w
    };
  }
}
const Ra = 16e3, ze = 512, Fr = 400, _t = 160, La = 0.97, Ua = 2 ** -24, Ge = (ze >> 1) + 1, sr = Math.SQRT1_2, qn = /* @__PURE__ */ new Map(), Kn = /* @__PURE__ */ new Map();
let Pr = null;
const tn = 200 / 3, dr = 1e3, qr = dr / tn, Eo = Math.log(6.4) / 27;
function Xn(t) {
  return t >= dr ? qr + Math.log(t / dr) / Eo : t / tn;
}
function Na(t) {
  return t >= qr ? dr * Math.exp(Eo * (t - qr)) : t * tn;
}
function Da(t) {
  const n = Ra / 2, a = new Float64Array(Ge);
  for (let m = 0; m < Ge; m++)
    a[m] = n * m / (Ge - 1);
  const o = Xn(0), i = Xn(n), c = t + 2, d = new Float64Array(c);
  for (let m = 0; m < c; m++)
    d[m] = Na(o + (i - o) * m / (c - 1));
  const f = new Float64Array(c - 1);
  for (let m = 0; m < c - 1; m++)
    f[m] = d[m + 1] - d[m];
  const p = new Float32Array(t * Ge);
  for (let m = 0; m < t; m++) {
    const w = 2 / (d[m + 2] - d[m]), b = m * Ge;
    for (let _ = 0; _ < Ge; _++) {
      const v = (a[_] - d[m]) / f[m], S = (d[m + 2] - a[_]) / f[m + 1];
      p[b + _] = Math.max(0, Math.min(v, S)) * w;
    }
  }
  return p;
}
function $a(t) {
  let e = qn.get(t);
  return e || (e = Da(t), qn.set(t, e)), e;
}
function Ba() {
  const t = new Float64Array(ze), e = ze - Fr >> 1;
  for (let n = 0; n < Fr; n++)
    t[e + n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / (Fr - 1)));
  return t;
}
function Wa() {
  return Pr || (Pr = Ba()), Pr;
}
function Qn(t) {
  const e = Kn.get(t);
  if (e) return e;
  const n = Math.log2(t);
  if (1 << n !== t)
    throw new Error(`FFT size must be power-of-two. Received: ${t}`);
  const a = t >> 1, o = new Float64Array(a), i = new Float64Array(a);
  for (let f = 0; f < a; f++) {
    const p = -2 * Math.PI * f / t;
    o[f] = Math.cos(p), i[f] = Math.sin(p);
  }
  const c = new Uint32Array(t);
  for (let f = 0; f < t; f++) {
    let p = f, m = 0;
    for (let w = 0; w < n; w++)
      m = m << 1 | p & 1, p >>= 1;
    c[f] = m;
  }
  const d = { cos: o, sin: i, bitrev: c };
  return Kn.set(t, d), d;
}
function ja(t, e, n, a) {
  if (a.bitrev && a.bitrev.length === n) {
    const o = a.bitrev;
    for (let i = 0; i < n; i++) {
      const c = o[i];
      if (i < c) {
        let d = t[i];
        t[i] = t[c], t[c] = d, d = e[i], e[i] = e[c], e[c] = d;
      }
    }
  } else {
    let o = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < o) {
        let d = t[i];
        t[i] = t[o], t[o] = d, d = e[i], e[i] = e[o], e[o] = d;
      }
      let c = n >> 1;
      for (; c <= o; )
        o -= c, c >>= 1;
      o += c;
    }
  }
  for (let o = 0; o < n; o += 2) {
    const i = o, c = o + 1, d = t[c], f = e[c];
    t[c] = t[i] - d, e[c] = e[i] - f, t[i] += d, e[i] += f;
  }
  for (let o = 0; o < n; o += 4) {
    const i = o, c = o + 2, d = t[c], f = e[c];
    t[c] = t[i] - d, e[c] = e[i] - f, t[i] += d, e[i] += f;
    const p = o + 1, m = o + 3, w = e[m], b = -t[m];
    t[m] = t[p] - w, e[m] = e[p] - b, t[p] += w, e[p] += b;
  }
  for (let o = 0; o < n; o += 8) {
    {
      const i = o, c = o + 4, d = t[c], f = e[c];
      t[c] = t[i] - d, e[c] = e[i] - f, t[i] += d, e[i] += f;
    }
    {
      const i = sr, c = -sr, d = o + 1, f = d + 4, p = t[f] * i - e[f] * c, m = t[f] * c + e[f] * i;
      t[f] = t[d] - p, e[f] = e[d] - m, t[d] += p, e[d] += m;
    }
    {
      const i = o + 2, c = i + 4, d = e[c], f = -t[c];
      t[c] = t[i] - d, e[c] = e[i] - f, t[i] += d, e[i] += f;
    }
    {
      const i = -sr, c = -sr, d = o + 3, f = d + 4, p = t[f] * i - e[f] * c, m = t[f] * c + e[f] * i;
      t[f] = t[d] - p, e[f] = e[d] - m, t[d] += p, e[d] += m;
    }
  }
  for (let o = 16; o <= n; o <<= 1) {
    const i = o >> 1, c = n / o;
    for (let d = 0; d < n; d += o)
      for (let f = 0; f < i; f++) {
        const p = f * c, m = a.cos[p], w = a.sin[p], b = d + f, _ = b + i, v = t[_] * m - e[_] * w, S = t[_] * w + e[_] * m;
        t[_] = t[b] - v, e[_] = e[b] - S, t[b] += v, e[b] += S;
      }
  }
}
class Pt {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.nMels=128] Number of mel bins (80 or 128)
   */
  constructor(e = {}) {
    this.nMels = e.nMels || 128, this.melFilterbank = $a(this.nMels), this.hannWindow = Wa(), this.twiddles = Qn(ze), this.twiddlesHalf = Qn(ze >> 1), this._fftRe = new Float64Array(ze >> 1), this._fftIm = new Float64Array(ze >> 1), this._powerBuf = new Float32Array(Ge), this._paddedBuffer = null, this.fbBounds = new Int32Array(this.nMels * 2);
    for (let n = 0; n < this.nMels; n++) {
      const a = n * Ge;
      let o = -1, i = -1;
      for (let c = 0; c < Ge; c++)
        this.melFilterbank[a + c] > 0 && (o === -1 && (o = c), i = c);
      o === -1 && (o = 0, i = -1), this.fbBounds[n * 2] = o, this.fbBounds[n * 2 + 1] = i + 1;
    }
  }
  /**
   * Convert PCM audio to normalized log-mel spectrogram features.
   * Drop-in replacement for OnnxPreprocessor.process().
   *
   * @param {Float32Array} audio - Mono PCM [-1,1] at 16kHz
   * @returns {{features: Float32Array, length: number}}
   */
  process(e) {
    const { rawMel: n, nFrames: a, featuresLen: o } = this.computeRawMel(e);
    return o === 0 ? { features: new Float32Array(0), length: 0 } : {
      features: this.normalizeFeatures(n, a, o),
      length: o
    };
  }
  /**
   * Compute raw (pre-normalization) mel features for a given audio segment.
   * Used for incremental mel computation in streaming mode.
   *
   * @param {Float32Array} audio - Mono PCM [-1,1] at 16kHz
   * @param {number} [startFrame=0] - Frame index to start computation from (0 to nFrames-1). Frames before this are left as zero.
   * @param {Float32Array} [outBuffer=null] - Optional buffer to reuse for rawMel output. If too small, a new buffer is allocated.
   * @returns {{rawMel: Float32Array, nFrames: number, featuresLen: number}}
   */
  computeRawMel(e, n = 0, a = null) {
    const o = e.length;
    if (o === 0)
      return { rawMel: a ? a.subarray(0, 0) : new Float32Array(0), nFrames: 0, featuresLen: 0 };
    const i = ze >> 1, c = o + 2 * i;
    let d = !1;
    if (!this._paddedBuffer || this._paddedBuffer.length < c) {
      const L = Math.ceil(c * 1.2);
      this._paddedBuffer = new Float64Array(L), d = !0;
    }
    const f = this._paddedBuffer;
    f[i] = Math.fround(e[0]);
    for (let L = 1; L < o; L++)
      f[i + L] = Math.fround(e[L] - La * e[L - 1]);
    d || f.fill(0, i + o, c);
    const p = Math.floor((c - ze) / _t) + 1, m = Math.floor(o / _t);
    if (m === 0)
      return { rawMel: new Float32Array(0), nFrames: 0, featuresLen: 0 };
    const w = this.nMels * p;
    let b;
    if (a && a.length >= w) {
      if (b = a.subarray(0, w), n > 0)
        for (let L = 0; L < this.nMels; L++)
          b.fill(0, L * p, L * p + n);
    } else
      b = new Float32Array(w);
    const _ = this._fftRe, v = this._fftIm, S = this._powerBuf, P = this.hannWindow, x = this.melFilterbank, k = this.nMels, A = this.twiddles, R = this.twiddlesHalf, C = this.fbBounds, y = ze >> 1, V = y >> 1;
    for (let L = n; L < p; L++) {
      const Q = L * _t;
      for (let E = 0; E < y; E++) {
        const I = E << 1;
        _[E] = f[Q + I] * P[I], v[E] = f[Q + I + 1] * P[I + 1];
      }
      ja(_, v, y, R);
      const oe = _[0], M = v[0];
      S[0] = (oe + M) * (oe + M), S[y] = (oe - M) * (oe - M);
      for (let E = 1; E < V; E++) {
        const I = _[E], pe = v[E], he = _[y - E], fe = v[y - E], H = 0.5 * (I + he), se = 0.5 * (pe - fe), ye = 0.5 * (pe + fe), te = -0.5 * (I - he), ae = A.cos[E], ie = A.sin[E], Y = ye * ae - te * ie, re = ye * ie + te * ae, _e = H + Y, J = se + re;
        S[E] = _e * _e + J * J;
        const K = H - Y, B = se - re;
        S[y - E] = K * K + B * B;
      }
      const U = _[V], le = v[V];
      S[V] = U * U + le * le;
      for (let E = 0; E < k; E++) {
        let I = 0;
        const pe = E * Ge, he = C[E * 2], fe = C[E * 2 + 1];
        for (let H = he; H < fe; H++)
          I += S[H] * x[pe + H];
        b[E * p + L] = Math.log(I + Ua);
      }
    }
    return { rawMel: b, nFrames: p, featuresLen: m };
  }
  /**
   * Apply per-feature normalization to raw mel features.
   * Separated from computation to enable incremental workflows.
   *
   * @param {Float32Array} rawMel - Pre-normalization features [nMels, nFrames]
   * @param {number} nFrames - Total number of frames in rawMel
   * @param {number} featuresLen - Number of valid frames to normalize over
   * @param {Float32Array} [outBuffer=null] - Optional buffer to reuse for features output.
   * @returns {Float32Array} Normalized features
   */
  normalizeFeatures(e, n, a, o = null) {
    const i = this.nMels, c = i * a;
    let d;
    o && o.length >= c ? d = o.subarray(0, c) : d = new Float32Array(c);
    for (let f = 0; f < i; f++) {
      const p = f * n, m = f * a;
      let w = 0;
      for (let S = 0; S < a; S++)
        w += e[p + S];
      const b = w / a;
      let _ = 0;
      for (let S = 0; S < a; S++) {
        const P = e[p + S] - b;
        _ += P * P;
      }
      const v = a > 1 ? 1 / (Math.sqrt(_ / (a - 1)) + 1e-5) : 0;
      for (let S = 0; S < a; S++)
        d[m + S] = (e[p + S] - b) * v;
    }
    return d;
  }
}
class Zn {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.nMels=128] Number of mel bins
   * @param {number} [opts.boundaryFrames=3] Extra frames to recompute at boundary
   */
  constructor(e = {}) {
    this.preprocessor = new Pt({ nMels: e.nMels || 128 }), this.nMels = this.preprocessor.nMels, this.boundaryFrames = e.boundaryFrames || 3, this._cachedRawMel = null, this._cachedNFrames = 0, this._cachedAudioLen = 0, this._cachedFeaturesLen = 0, this._rawBuffers = [null, null], this._bufIdx = 0, this._featuresBuffer = null;
  }
  /**
   * Reset the incremental cache. Call when starting a new utterance or recording session.
   * @returns {void}
   */
  reset() {
    this._cachedRawMel = null, this._cachedNFrames = 0, this._cachedAudioLen = 0, this._cachedFeaturesLen = 0, this._bufIdx = 0;
  }
  /**
   * Process audio with incremental mel computation.
   * If the prefix of the audio matches the cached audio, reuse cached frames.
   *
   * @param {Float32Array} audio - Full audio window (mono PCM [-1,1] at 16kHz)
   * @param {number} [prefixSamples=0] - Number of leading samples identical to previous call
   * @returns {{features: Float32Array, length: number, cached: boolean, cachedFrames: number, newFrames: number}}
   */
  process(e, n = 0) {
    const a = e.length;
    if (a === 0)
      return {
        features: new Float32Array(0),
        length: 0,
        cached: !1,
        cachedFrames: 0,
        newFrames: 0
      };
    const o = n > 0 && this._cachedRawMel !== null && n <= this._cachedAudioLen, i = Math.floor(a / _t) + 1, c = this.nMels * i;
    let d = this._rawBuffers[this._bufIdx];
    if (!d || d.length < c) {
      const P = Math.ceil(c * 1.2);
      d = new Float32Array(P), this._rawBuffers[this._bufIdx] = d;
    }
    const f = Math.floor(a / _t), p = this.nMels * f;
    if (!this._featuresBuffer || this._featuresBuffer.length < p) {
      const P = Math.ceil(p * 1.2);
      this._featuresBuffer = new Float32Array(P);
    }
    if (!o) {
      const { rawMel: P, nFrames: x, featuresLen: k } = this.preprocessor.computeRawMel(e, 0, d), A = this.preprocessor.normalizeFeatures(
        P,
        x,
        k,
        this._featuresBuffer
      );
      return this._cachedRawMel = P, this._cachedNFrames = x, this._cachedAudioLen = a, this._cachedFeaturesLen = k, this._bufIdx ^= 1, {
        features: new Float32Array(A),
        length: k,
        cached: !1,
        cachedFrames: 0,
        newFrames: k
      };
    }
    const m = Math.floor(n / _t), w = Math.max(
      0,
      Math.min(m - this.boundaryFrames, this._cachedFeaturesLen)
    ), { rawMel: b, nFrames: _, featuresLen: v } = this.preprocessor.computeRawMel(e, w, d);
    if (w > 0 && this._cachedRawMel)
      for (let P = 0; P < this.nMels; P++) {
        const x = P * this._cachedNFrames, k = P * _;
        b.set(this._cachedRawMel.subarray(x, x + w), k);
      }
    const S = this.preprocessor.normalizeFeatures(
      b,
      _,
      v,
      this._featuresBuffer
    );
    return this._cachedRawMel = b, this._cachedNFrames = _, this._cachedAudioLen = a, this._cachedFeaturesLen = v, this._bufIdx ^= 1, {
      features: new Float32Array(S),
      length: v,
      cached: !0,
      cachedFrames: w,
      newFrames: v - w
    };
  }
  /**
   * Clear the cache (e.g., on recording restart).
   * @returns {void}
   */
  clear() {
    this.reset();
  }
}
const za = {
  HOP_LENGTH: _t
}, Ga = 180, Va = 20, Ha = 180, qa = 90, Ka = 10, it = 1e-6, Xa = 0.15, Yn = 1, Qa = 0.2, Jn = 0.5;
function Za(t) {
  if (!(t instanceof Float32Array || t instanceof Float64Array))
    throw new TypeError("ParakeetModel.transcribeLongAudio expected audio to be Float32Array or Float64Array.");
  for (let e = 0; e < t.length; ++e)
    if (!Number.isFinite(t[e]))
      throw new Error(`ParakeetModel.transcribeLongAudio expected finite audio samples; found ${t[e]} at index ${e}.`);
}
function Ya(t) {
  const e = Number(t);
  return !Number.isFinite(e) || e <= 0 ? 0 : Math.max(Va, Math.min(Ha, e));
}
function Ja(t) {
  return {
    audioDurationS: t,
    preprocess_ms: 0,
    encode_ms: 0,
    decode_ms: 0,
    tokenize_ms: 0,
    total_ms: 0,
    cached_frames: 0,
    new_frames: 0,
    hasMetrics: !1,
    hasMelCache: !1
  };
}
function pt(t, e, n) {
  typeof n == "number" && Number.isFinite(n) && (t[e] += n);
}
function eo(t, e) {
  !e || typeof e != "object" || (t.hasMetrics = !0, pt(t, "preprocess_ms", e.preprocess_ms), pt(t, "encode_ms", e.encode_ms), pt(t, "decode_ms", e.decode_ms), pt(t, "tokenize_ms", e.tokenize_ms), pt(t, "total_ms", e.total_ms), e.mel_cache && typeof e.mel_cache == "object" && (t.hasMelCache = !0, pt(t, "cached_frames", e.mel_cache.cached_frames), pt(t, "new_frames", e.mel_cache.new_frames)));
}
function Or(t) {
  if (!t?.hasMetrics)
    return null;
  const e = t.total_ms > 0 ? t.total_ms : t.preprocess_ms + t.encode_ms + t.decode_ms + t.tokenize_ms, n = {
    preprocess_ms: t.preprocess_ms,
    encode_ms: t.encode_ms,
    decode_ms: t.decode_ms,
    tokenize_ms: t.tokenize_ms,
    total_ms: e,
    rtf: e > 0 ? t.audioDurationS / (e / 1e3) : 0
  };
  return t.hasMelCache && (n.mel_cache = {
    cached_frames: t.cached_frames,
    new_frames: t.new_frames
  }), n;
}
function Kr(t) {
  let e = "";
  for (const n of t) {
    const a = n?.text ?? "";
    a && (e ? /^[,.;:!?)}\]]+$/.test(a) ? e += a : e += ` ${a}` : e = a);
  }
  return e;
}
function to(t) {
  return t.map((e) => ({
    text: e.text,
    timestamp: [e.start_time, e.end_time]
  }));
}
function ro(t) {
  return String(t ?? "").normalize("NFKC").toLowerCase().replace(/^[("'“‘\[{]+/g, "").replace(/[.,!?;:)"'”’\]}]+$/g, "").trim();
}
function no(t) {
  return String(t ?? "").normalize("NFKC").toLowerCase().trim();
}
function yt(t) {
  const e = [];
  for (const n of t) {
    const a = e.at(-1), o = ro(a?.text), i = ro(n?.text);
    if (a && o === i && (o.length > 0 || no(a.text) === no(n.text)) && n.start_time < a.end_time) {
      const c = a.end_time - a.start_time;
      n.end_time - n.start_time > c && (e[e.length - 1] = n);
      continue;
    }
    e.push(n);
  }
  return e;
}
const ei = /[!?…](?:["')\]]+)?$/u, ti = /\.(?:["')\]]+)?$/u, ri = /["')\]]+$/gu, ni = /^[("'“‘\[{]+/u, oi = /^(?:[A-Z]\.){2,}$/, si = /^[A-Z]\.$/, ai = /^(?:[IVXLCDM]+)\.$/i, ii = /^\d+\.$/, ci = 3, li = /* @__PURE__ */ new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "sr.",
  "jr.",
  "vs.",
  "etc.",
  "e.g.",
  "i.e."
]);
function ui(t) {
  return String(t ?? "").replace(ri, "");
}
function fi(t) {
  const e = String(t ?? "").replace(ni, "");
  return /^[A-Z]/.test(e);
}
function di(t, e, n = 0) {
  if (!e) return !1;
  if (n >= ci) return !0;
  const a = String(t?.text ?? "");
  if (!a) return !1;
  if (ei.test(a)) return !0;
  if (!ti.test(a)) return !1;
  const o = ui(a), i = o.toLowerCase();
  return li.has(i) || oi.test(o) || si.test(o) || ai.test(o) || ii.test(o) ? !1 : fi(e.text);
}
function So(t) {
  if (!Array.isArray(t) || t.length === 0)
    return [];
  const e = [];
  let n = [];
  for (let a = 0; a < t.length; ++a) {
    const o = t[a];
    n.push(o);
    const i = t[a + 1] ?? null, c = i ? Math.max(0, i.start_time - o.end_time) : 0;
    di(o, i, c) && (e.push({
      words: n,
      text: Kr(n),
      timestamp: [n[0].start_time, n[n.length - 1].end_time]
    }), n = []);
  }
  return n.length > 0 && e.push({
    words: n,
    text: Kr(n),
    timestamp: [n[0].start_time, n[n.length - 1].end_time]
  }), e;
}
function xo(t, e = "") {
  return !Array.isArray(t) || t.length === 0 ? e ? [{ text: e, timestamp: [0, 0] }] : [] : So(t).map((n) => ({
    text: n.text,
    timestamp: n.timestamp
  }));
}
function hi(t) {
  return t.flatMap((e) => e.words);
}
function pi(t, e) {
  const n = Array.isArray(t) ? t : [], a = Array.isArray(e) ? e : [];
  if (n.length === 0)
    return yt(a);
  if (a.length === 0)
    return yt(n);
  const o = n[0].start_time;
  return a[0].start_time <= o + it ? yt(a) : yt([...n, ...a]);
}
function oo(t) {
  return String(t ?? "").normalize("NFKC").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}
function mi(t, e) {
  const n = oo(e.text);
  return n ? t.some(
    (a) => oo(a.text) === n && Math.abs(a.timestamp[1] - e.timestamp[1]) < Xa
  ) : !1;
}
function so(t, e) {
  mi(t, e) || t.push(e);
}
function wi(t, e) {
  let n = t, a = Jn + 1;
  for (let o = 0; o < e.length - 1; ++o) {
    const i = e[o], c = e[o + 1], d = i.end_time, f = c.start_time;
    if (!(f - d < Qa))
      for (const m of [d, f]) {
        if (m + it < t) continue;
        const w = m - t;
        w <= Jn && w < a && (n = m, a = w);
      }
  }
  return n;
}
async function gi({
  audio: t,
  samplingRate: e,
  chunkLengthS: n,
  baseTimeOffset: a,
  transcribeWindow: o
}) {
  const i = t.length / e, c = Math.min(Ka, Math.max(0, n - 1)), d = Math.max(1, n - c), f = Math.max(
    4,
    Math.ceil(Math.max(0, i - n) / Yn) + 2
  ), p = [];
  let m = [], w = "", b = 0, _ = !1;
  for (let x = 0; x < f && b < i - it; ++x) {
    const k = Math.min(i, b + n), A = Math.max(0, Math.min(t.length - 1, Math.floor(b * e))), R = Math.max(A + 1, Math.min(t.length, Math.ceil(k * e))), C = t.subarray(A, R), y = k >= i - it, V = await o(C, a + b);
    w = V.text ?? w;
    const L = Array.isArray(V.words) ? V.words : [], Q = _ ? pi(m, L) : yt(L), oe = So(Q);
    if (y) {
      for (const U of oe)
        so(p, U);
      m = [];
      break;
    }
    if (oe.length > 1) {
      const U = oe[oe.length - 1], le = U.timestamp[0], E = Math.max(0, le - a);
      if (E >= b + Yn - it) {
        const I = oe.slice(0, -1);
        for (const he of I)
          so(p, he);
        m = yt(U.words);
        const pe = Math.min(
          i,
          Math.max(0, wi(le, Q) - a)
        );
        if (_ = pe > E + it, pe > b + it) {
          b = pe;
          continue;
        }
      }
    }
    m = Q, _ = !0;
    const M = Math.min(i, b + d);
    if (M <= b + it)
      break;
    b = M;
  }
  const v = yt([...hi(p), ...m]), S = v.length > 0 ? Kr(v) : String(w ?? "").trim(), P = xo(v, S);
  return { text: S, words: v, chunks: P };
}
async function bi(t, e, n = 16e3, a = {}) {
  if (Za(e), typeof n != "number" || !Number.isFinite(n) || n <= 0)
    throw new Error("ParakeetModel.transcribeLongAudio expected `sampleRate` to be a positive finite number.");
  const {
    returnTimestamps: o = !1,
    chunkLengthS: i = 0,
    timeOffset: c = 0,
    ...d
  } = a;
  if (typeof c != "number" || !Number.isFinite(c) || c < 0)
    throw new Error("ParakeetModel.transcribeLongAudio expected `timeOffset` to be a finite non-negative number.");
  const f = o === "word", p = o === !0 || f, m = Ya(i), w = e.length / n, b = m <= 0 && w > Ga, _ = m > 0 ? m : b ? qa : 0, v = Ja(w), S = async (A, R) => {
    const C = await t.transcribe(A, n, {
      ...d,
      _skipAudioValidation: !0,
      returnTimestamps: !0,
      timeOffset: R
    });
    return eo(v, C.metrics), {
      text: C.utterance_text ?? "",
      words: Array.isArray(C.words) ? C.words : []
    };
  };
  if (_ > 0) {
    const A = await gi({
      audio: e,
      samplingRate: n,
      chunkLengthS: _,
      baseTimeOffset: c,
      transcribeWindow: S
    }), R = { text: A.text, metrics: Or(v) };
    return p && (R.words = A.words, R.chunks = f ? to(A.words) : A.chunks), R;
  }
  const P = await t.transcribe(e, n, {
    ...d,
    _skipAudioValidation: !0,
    returnTimestamps: p,
    timeOffset: c
  });
  eo(v, P.metrics);
  const x = P.utterance_text ?? "";
  if (!p)
    return { text: x, metrics: Or(v) };
  const k = Array.isArray(P.words) ? P.words : [];
  return {
    text: x,
    words: k,
    chunks: f ? to(k) : xo(k, x),
    metrics: Or(v)
  };
}
function yi(t, e) {
  if (!(t instanceof Float32Array || t instanceof Float64Array))
    return t;
  let n = null, a = 0;
  for (let o = 0; o < t.length; ++o)
    Number.isFinite(t[o]) || (n || (n = t.slice()), n[o] = 0, a += 1);
  return n || t;
}
function _i(t, e) {
  return Number.isFinite(t) ? t : 0;
}
class Mo {
  /**
   * Create a Parakeet model wrapper with initialized runtime sessions.
   * @param {Object} cfg - Model dependencies and runtime options.
   * @param {ParakeetTokenizer} cfg.tokenizer - Loaded tokenizer instance.
   * @param {Object} cfg.encoderSession - ONNX Runtime encoder session.
   * @param {Object} cfg.joinerSession - ONNX Runtime decoder/joiner session.
   * @param {Object} cfg.preprocessor - Active preprocessor instance (JS or ONNX).
   * @param {Object} cfg.ort - ONNX Runtime Web namespace/object.
   * @param {number} [cfg.subsampling=8] - Encoder subsampling factor in frames.
   * @param {number} [cfg.windowStride=0.01] - Feature frame stride in seconds (10 ms).
   * @param {(text: string) => string} [cfg.normalizer] - Text normalizer applied to decoded output.
   * @param {OnnxPreprocessor|null} [cfg.onnxPreprocessor=null] - Optional ONNX preprocessor instance for backend switching.
   * @param {number} [cfg.nMels] - Number of mel bins (for example 80 or 128).
   * @param {number} [cfg.maxIncrementalCacheSize=50] - Max decoder-state cache entries for incremental decoding.
   */
  constructor({ tokenizer: e, encoderSession: n, joinerSession: a, preprocessor: o, ort: i, subsampling: c = 8, windowStride: d = 0.01, normalizer: f = (b) => b, onnxPreprocessor: p = null, nMels: m, maxIncrementalCacheSize: w = 50 }) {
    this.tokenizer = e, this.encoderSession = n, this.joinerSession = a, this.preprocessor = o, this.ort = i, this._onnxPreprocessor = p, this._jsPreprocessor = o instanceof Pt ? o : null, this._incrementalMel = o instanceof Pt ? new Zn({ nMels: o.nMels }) : null, this.blankId = e.blankId, this.predHidden = 640, this.predLayers = 2, this.maxTokensPerStep = 10;
    const b = this.predLayers, _ = this.predHidden, v = b * 1 * _, S = new Float32Array(v);
    this._combState1 = new i.Tensor("float32", S, [b, 1, _]), this._combState2 = new i.Tensor("float32", S.slice(), [b, 1, _]), this._normalizer = f, this.subsampling = c, this.windowStride = d, this._nMels = m || 128, this._targetIdArray = new Int32Array(1), this._targetTensor = new i.Tensor("int32", this._targetIdArray, [1, 1]), this._targetLenArray = new Int32Array([1]), this._targetLenTensor = new i.Tensor("int32", this._targetLenArray, [1]), this._encoderFrameBuffer = null, this._encoderFrameTensor = null, this._incrementalCache = /* @__PURE__ */ new Map(), this.maxIncrementalCacheSize = w, this._warnedMissingDecoderStates = !1, this._warnedMissingDurationLogits = !1;
  }
  /**
   * Create ParakeetModel by downloading all required assets.
   * @param {Object} cfg
   * @param {string} cfg.encoderUrl URL to encoder-model.onnx
   * @param {string} cfg.decoderUrl URL to decoder_joint-model.onnx
   * @param {string} cfg.tokenizerUrl URL to vocab.txt or tokens.txt
   * @param {string} [cfg.preprocessorUrl] URL to nemo80/128.onnx (not needed if preprocessorBackend='js')
   * @param {('webgpu'|'webgpu-hybrid'|'webgpu-strict'|'wasm')} [cfg.backend='webgpu-hybrid'] Backend mode (`webgpu` alias is accepted for compatibility)
   * @param {('onnx'|'js')} [cfg.preprocessorBackend='js'] Preprocessor backend: 'js' (default) uses pure JS mel computation (faster, no ONNX overhead, enables incremental streaming), 'onnx' uses nemo*.onnx via WASM
   * @param {number} [cfg.nMels] Number of mel bins (auto-detected from model config, or 128)
   * @returns {Promise<ParakeetModel>} Initialized model instance.
   */
  static async fromUrls(e) {
    const {
      encoderUrl: n,
      decoderUrl: a,
      tokenizerUrl: o,
      preprocessorUrl: i,
      encoderDataUrl: c,
      decoderDataUrl: d,
      filenames: f,
      backend: p = "webgpu-hybrid",
      wasmPaths: m,
      subsampling: w = 8,
      windowStride: b = 0.01,
      verbose: _ = !1,
      enableProfiling: v = !1,
      enableGraphCapture: S,
      cpuThreads: P = void 0,
      preprocessorBackend: x = "js",
      nMels: k
    } = e, A = x === "js";
    if (!n || !a || !o || !i && !A)
      throw new Error('fromUrls requires encoderUrl, decoderUrl, tokenizerUrl and preprocessorUrl (preprocessorUrl not needed if preprocessorBackend="js")');
    let R = p;
    p.startsWith("webgpu") && (R = "webgpu");
    const C = await Jr({ backend: R, wasmPaths: m, numThreads: P }), V = {
      executionProviders: [],
      graphOptimizationLevel: "all",
      executionMode: "parallel",
      enableCpuMemArena: !0,
      enableMemPattern: !0,
      enableProfiling: v,
      enableGraphCapture: !!S && p === "webgpu-strict",
      logSeverityLevel: _ ? 0 : 2
    };
    p === "webgpu-hybrid" ? V.executionProviders = [
      {
        name: "webgpu",
        deviceType: "gpu",
        powerPreference: "high-performance"
      },
      "wasm"
    ] : p === "webgpu-strict" ? V.executionProviders = [
      {
        name: "webgpu",
        deviceType: "gpu",
        powerPreference: "high-performance"
      }
    ] : p === "wasm" && (V.executionProviders = ["wasm"]);
    const L = { ...V };
    c && f?.encoder && (L.externalData = [{
      data: c,
      path: f.encoder + ".data"
    }]);
    const Q = { ...V };
    d && f?.decoder && (Q.externalData = [{
      data: d,
      path: f.decoder + ".data"
    }]), p.startsWith("webgpu") && (Q.executionProviders = ["wasm"]);
    async function oe(te, ae) {
      try {
        return await C.InferenceSession.create(te, ae);
      } catch (ie) {
        const Y = (ie.message || "") + "";
        if (ae.enableGraphCapture && Y.includes("graph capture")) {
          const re = { ...ae, enableGraphCapture: !1 };
          return await C.InferenceSession.create(te, re);
        }
        throw ie;
      }
    }
    const M = en.fromUrl(o), U = k || 128, le = new Pt({ nMels: U });
    let E = null;
    !A && i && (E = new Ia(i, {
      backend: "wasm",
      wasmPaths: m,
      enableProfiling: v,
      enableGraphCapture: !1,
      numThreads: P
    }));
    const I = A ? le : E || le, pe = Promise.resolve(I), he = I === le ? "js" : "onnx";
    let fe, H;
    p === "webgpu-hybrid" ? (fe = await oe(n, L), H = await oe(a, Q)) : [fe, H] = await Promise.all([
      oe(n, L),
      oe(a, Q)
    ]);
    const [se, ye] = await Promise.all([M, pe]);
    try {
      const te = new Float32Array(1600);
      await ye.process(te);
    } catch {
    }
    return new Mo({
      tokenizer: se,
      encoderSession: fe,
      joinerSession: H,
      preprocessor: ye,
      ort: C,
      subsampling: w,
      windowStride: b,
      onnxPreprocessor: E !== ye ? E : null,
      nMels: U
    });
  }
  /**
   * Run one decoder+joiner step for a single encoder frame.
   * @param {Object} encTensor - Encoder frame tensor shaped [1, D, 1].
   * @param {number} token - Previous token ID (uses blank when not numeric).
   * @param {{state1: Object, state2: Object}|null} [currentState=null] - Decoder LSTM state tensors.
   * @returns {Promise<{tokenLogits: Float32Array, step: number, newState: {state1: Object, state2: Object}, _logitsTensor: Object}>}
   */
  async _runCombinedStep(e, n, a = null) {
    const o = typeof n == "number" ? n : this.blankId;
    this._targetIdArray[0] = o;
    const i = a?.state1 || this._combState1, c = a?.state2 || this._combState2, d = {
      encoder_outputs: e,
      targets: this._targetTensor,
      target_length: this._targetLenTensor,
      input_states_1: i,
      input_states_2: c
    }, f = await this.joinerSession.run(d), p = f.outputs, m = f.output_states_1, w = f.output_states_2, b = /* @__PURE__ */ new Set();
    for (const C of Object.values(f))
      !C || typeof C.dispose != "function" || b.has(C) || (b.add(C), !(C === p || C === m || C === w) && C.dispose());
    const _ = this.tokenizer.id2token.length, v = (C) => {
      p?.dispose?.();
      const y = /* @__PURE__ */ new Set(), V = (L) => {
        if (L)
          for (const Q of [L.state1, L.state2])
            !Q || Q === this._combState1 || Q === this._combState2 || y.has(Q) || (y.add(Q), Q.dispose?.());
      };
      throw V({ state1: m, state2: w }), V(a), new Error(C);
    };
    (!p || !p.data || typeof p.data.subarray != "function") && v("ParakeetModel decoder output did not include a valid `outputs` tensor.");
    const S = p.data;
    S.length < _ && v(`ParakeetModel decoder output is too small (${S.length}) for vocab size ${_}.`);
    const P = S.length, x = S.subarray(0, _), k = S.subarray(_, P);
    (!m || !w) && !this._warnedMissingDecoderStates && (this._warnedMissingDecoderStates = !0), k.length === 0 && !this._warnedMissingDurationLogits && (this._warnedMissingDurationLogits = !0);
    let A = 0;
    if (k.length) {
      let C = -1 / 0;
      for (let y = 0; y < k.length; ++y) k[y] > C && (C = k[y], A = y);
    }
    return { tokenLogits: x, step: A, newState: {
      state1: m || i,
      state2: w || c
    }, _logitsTensor: p };
  }
  /**
   * Copy decoder state tensors into plain typed arrays for transport/storage.
   * @param {{state1: Object, state2: Object}|null} state - Decoder state to snapshot.
   * @returns {{s1: Float32Array, s2: Float32Array, dims1: number[], dims2: number[]}|null}
   */
  _snapshotDecoderState(e) {
    if (!e) return null;
    const n = e.state1, a = e.state2;
    return {
      s1: new Float32Array(n.data),
      s2: new Float32Array(a.data),
      dims1: n.dims.slice(),
      dims2: a.dims.slice()
    };
  }
  /**
   * Restore decoder state tensors from a serialized snapshot.
   * @param {{s1: Float32Array, s2: Float32Array, dims1: number[], dims2: number[]}|null} snap - Snapshot from `_snapshotDecoderState`.
   * @returns {{state1: Object, state2: Object}|null}
   */
  _restoreDecoderState(e) {
    if (!e) return null;
    const n = new this.ort.Tensor("float32", new Float32Array(e.s1), e.dims1), a = new this.ort.Tensor("float32", new Float32Array(e.s2), e.dims2);
    return { state1: n, state2: a };
  }
  /**
   * Compute mel spectrogram features from audio.
   * Supports incremental caching when using JS preprocessor in streaming mode.
   *
   * @param {Float32Array} audio - 16 kHz mono PCM
   * @param {number} [sampleRate=16000] - Sample rate
   * @param {Object} [opts] - Optional feature extraction options
   * @param {number} [opts.prefixSamples=0] - Number of leading samples identical to previous call
   *   (enables incremental mel caching — only new frames are computed, ~60-70% savings for typical streaming overlap)
   * @returns {{features: Float32Array, T: number, melBins: number, cached?: boolean, cachedFrames?: number, newFrames?: number}}
   */
  async computeFeatures(e, n = 16e3, a = {}) {
    const { prefixSamples: o = 0, _skipAudioValidation: i = !1 } = a, c = i ? e : yi(e, "ParakeetModel.computeFeatures");
    if (this._incrementalMel && o > 0) {
      const m = this._incrementalMel.process(c, o), w = m.length;
      return {
        features: m.features,
        T: w,
        melBins: this._nMels,
        cached: m.cached,
        cachedFrames: m.cachedFrames,
        newFrames: m.newFrames
      };
    }
    const { features: d, length: f } = await this.preprocessor.process(c), p = d.length / this._nMels;
    return { features: d, T: p, melBins: this._nMels, validLength: f };
  }
  /**
   * Switch preprocessor backend at runtime.
   * @param {('js'|'onnx')} backend - 'js' for pure JS mel (default, faster, enables caching), 'onnx' for ONNX WASM
   * @throws {Error} If ONNX backend requested but no ONNX preprocessor was loaded
   */
  setPreprocessorBackend(e) {
    if (e === "onnx") {
      if (!this._onnxPreprocessor)
        throw new Error("ONNX preprocessor not available. Load model with preprocessorUrl to enable ONNX backend.");
      this.preprocessor = this._onnxPreprocessor, this._incrementalMel = null;
    } else if (e === "js")
      this._jsPreprocessor || (this._jsPreprocessor = new Pt({ nMels: 128 })), this.preprocessor = this._jsPreprocessor, this._incrementalMel = new Zn({ nMels: this._jsPreprocessor.nMels });
    else
      throw new Error(`Unknown preprocessor backend: ${e}. Use 'js' or 'onnx'.`);
  }
  /**
   * Get the current preprocessor backend type.
   * @returns {('js'|'onnx')} Current preprocessor backend
   */
  getPreprocessorBackend() {
    return this.preprocessor instanceof Pt ? "js" : "onnx";
  }
  /**
   * Reset the incremental mel cache. Call this when starting a new utterance
   * or when the audio context changes (e.g., new recording session).
   */
  resetMelCache() {
    this._incrementalMel && this._incrementalMel.reset();
  }
  /**
   * Clear the incremental decoder state cache.
   * This releases memory used by cached decoder states.
   */
  clearIncrementalCache() {
    this._incrementalCache.clear();
  }
  /**
   * Dispose ORT tensors inside a decoder state object.
   * Safely skips null states, pre-allocated initial states, and tensors
   * shared with a `keepState` (to avoid double-dispose when the joiner
   * falls back to reusing its input state).
   * @param {object|null} state  - The state whose tensors should be freed.
   * @param {object|null} [keepState] - A state whose tensors must NOT be freed.
   */
  _disposeDecoderState(e, n = null) {
    e && (e.state1 && e.state1 !== this._combState1 && e.state1 !== n?.state1 && e.state1.dispose?.(), e.state2 && e.state2 !== this._combState2 && e.state2 !== n?.state2 && e.state2.dispose?.());
  }
  /**
   * Get the time stride per encoder frame in seconds.
   * This is useful for converting frame indices to timestamps.
   * @returns {number} Time stride in seconds (typically 0.08s for 8x subsampling @ 10ms)
   */
  getFrameTimeStride() {
    return this.subsampling * this.windowStride;
  }
  /**
   * Convert a frame index to absolute time in seconds.
   * @param {number} frameIndex - Encoder frame index
   * @param {number} timeOffset - Optional offset to add (default 0)
   * @returns {number} Time in seconds
   */
  frameToTime(e, n = 0) {
    return n + e * this.getFrameTimeStride();
  }
  /**
   * Get streaming constants for external use.
   * @returns {Object} Constants for streaming calculations
   */
  getStreamingConstants() {
    return {
      subsampling: this.subsampling,
      windowStride: this.windowStride,
      frameTimeStride: this.getFrameTimeStride(),
      melBins: this._nMels,
      // Dynamic based on initialized config
      blankId: this.blankId,
      maxTokensPerStep: this.maxTokensPerStep
    };
  }
  /**
   * Transcribe 16-kHz mono PCM. Returns full rich output (timestamps/confidences opt-in).
   * 
   * Streaming Mode:
   * Pass `previousDecoderState` from a prior call to continue decoding from that state.
   * Set `returnDecoderState: true` to receive the decoder state for the next chunk.
   * Use `timeOffset` to adjust all timestamps by a fixed offset (for absolute timeline).
   * 
   * Frame-Aligned Streaming (for advanced merging):
   * Use `returnFrameIndices`, `returnLogProbs`, and `returnTdtSteps` to get detailed
   * per-token information for precise alignment when merging overlapping transcriptions.
   * 
   * @param {Float32Array} audio - 16-kHz mono PCM audio samples
   * @param {number} sampleRate - Sample rate (default 16000)
   * @param {Object} opts - Transcription options
   * @param {boolean} opts.returnTimestamps - Include word/token timestamps
   * @param {boolean} opts.returnConfidences - Include confidence scores
   * @param {number} opts.temperature - Decoding temperature (default 1.0 for greedy)
   * @param {Object} opts.previousDecoderState - Decoder state from previous chunk (for streaming)
   * @param {boolean} opts.returnDecoderState - Return decoder state for next chunk
   * @param {number} opts.timeOffset - Add this offset to all timestamps (seconds)
   * @param {boolean} opts.returnTokenIds - Include raw token IDs in output
   * @param {boolean} opts.returnFrameIndices - Include encoder frame index per token (for alignment)
   * @param {boolean} opts.returnLogProbs - Include raw log probability per token
   * @param {boolean} opts.returnTdtSteps - Include TDT duration prediction per token
   * @param {number} opts.prefixSamples - Number of leading audio samples identical to previous call
   *   (enables incremental mel caching — ~60-70% preprocessing savings for typical streaming overlap)
   * @param {Object} opts.precomputedFeatures - Pre-computed mel features (bypasses preprocessor entirely)
   * @param {Float32Array} opts.precomputedFeatures.features - Normalized mel features [melBins, T]
   * @param {number} opts.precomputedFeatures.T - Number of time frames
   * @param {number} opts.precomputedFeatures.melBins - Number of mel frequency bins
   * @returns {Promise<Object>} Transcription result containing text, token/word details, optional metrics, and optional streaming state.
   */
  async transcribe(e, n = 16e3, a = {}) {
    const {
      returnTimestamps: o = !1,
      returnConfidences: i = !1,
      temperature: c = 1,
      // Greedy decoding (1.0) is better for ASR than sampling (1.2)
      debug: d = !1,
      enableProfiling: f = !0,
      skipCMVN: p = !1,
      frameStride: m = 1,
      // NEW: Streaming options
      previousDecoderState: w = null,
      // Accept state from previous chunk
      returnDecoderState: b = !1,
      // Return state for next chunk
      timeOffset: _ = 0,
      // Offset to add to all timestamps
      returnTokenIds: v = !1,
      // Include raw token IDs
      // NEW: Frame-aligned streaming options (for advanced merging)
      returnFrameIndices: S = !1,
      // Include encoder frame index per token
      returnLogProbs: P = !1,
      // Include raw log probabilities per token
      returnTdtSteps: x = !1,
      // Include TDT duration predictions per token
      // Incremental mel caching for streaming
      prefixSamples: k = 0,
      // Number of leading samples identical to previous call
      // Pre-computed mel features (bypass preprocessor entirely)
      precomputedFeatures: A = null,
      // { features: Float32Array, T: number, melBins: number }
      _skipAudioValidation: R = !1
      // Internal: long-audio helpers can skip re-validating already checked windows
    } = a, C = _i(_, "ParakeetModel.transcribe"), y = d || f;
    let V, L = 0, Q = 0, oe = 0, M = 0;
    y && (V = performance.now());
    let U, le, E, I, pe, he = A ? "mel-worker" : this.getPreprocessorBackend();
    if (A)
      U = A.features, le = A.T, E = A.melBins, I = {};
    else if (y) {
      const F = performance.now();
      ({ features: U, T: le, melBins: E, validLength: pe, ...I } = await this.computeFeatures(e, n, { prefixSamples: k, _skipAudioValidation: R })), L = performance.now() - F;
      const X = I?.cached ? ` (cached: ${I.cachedFrames} frames, new: ${I.newFrames} frames)` : "";
    } else
      ({ features: U, T: le, melBins: E, validLength: pe, ...I } = await this.computeFeatures(e, n, { prefixSamples: k, _skipAudioValidation: R }));
    if (!U || !U.length || le <= 0 || E <= 0)
      return {
        utterance_text: "",
        words: [],
        tokens: [],
        confidence_scores: { overall_log_prob: null, frame: null, frame_avg: null },
        metrics: y ? {
          preprocess_ms: +L.toFixed(1),
          encode_ms: 0,
          decode_ms: 0,
          tokenize_ms: 0,
          total_ms: +(performance.now() - V).toFixed(1),
          rtf: 0
        } : null,
        is_final: !a?.incremental
      };
    const fe = e ? e.length / n : le * za.HOP_LENGTH / n, H = new this.ort.Tensor("float32", U, [1, E, le]), se = pe ?? le, ye = new this.ort.Tensor("int64", BigInt64Array.from([BigInt(se)]), [1]);
    let te;
    try {
      if (y) {
        const F = performance.now(), X = await this.encoderSession.run({ audio_signal: H, length: ye });
        Q = performance.now() - F, te = X.outputs ?? Object.values(X)[0];
      } else {
        const F = await this.encoderSession.run({ audio_signal: H, length: ye });
        te = F.outputs ?? Object.values(F)[0];
      }
    } finally {
      H.dispose?.(), ye.dispose?.();
    }
    const [, ae, ie] = te.dims;
    let Y;
    if (te.dims.length === 3 && te.dims[0] === 1 && te.dims[1] === ae && te.dims[2] === ie) {
      Y = new Float32Array(ie * ae);
      const F = te.data;
      for (let X = 0; X < ie; X++) {
        const de = X * ae;
        let N = 0;
        for (; N <= ae - 8; N += 8) {
          const me = N * ie + X;
          Y[de + N] = F[me], Y[de + N + 1] = F[me + ie], Y[de + N + 2] = F[me + 2 * ie], Y[de + N + 3] = F[me + 3 * ie], Y[de + N + 4] = F[me + 4 * ie], Y[de + N + 5] = F[me + 5 * ie], Y[de + N + 6] = F[me + 6 * ie], Y[de + N + 7] = F[me + 7 * ie];
        }
        for (; N < ae; N++)
          Y[de + N] = F[N * ie + X];
      }
    } else
      Y = new Float32Array(te.data);
    te.dispose?.(), (!this._encoderFrameBuffer || this._encoderFrameBuffer.length !== ae) && (this._encoderFrameBuffer = new Float32Array(ae), this._encoderFrameTensor = new this.ort.Tensor("float32", this._encoderFrameBuffer, [1, ae, 1]));
    const re = [], _e = [], J = [], K = /* @__PURE__ */ new Map();
    let B = 0;
    const Ve = [], Qe = [], ct = [], Ee = this.subsampling * this.windowStride;
    let He = 0, St = C, ge = null;
    w && (ge = this._restoreDecoderState(w));
    let Ne = 0;
    const Te = a.incremental;
    if (Te && Te.cacheKey) {
      Ne = Math.max(0, Math.min(ie, Math.floor(((Te.prefixSeconds || 0) + 1e-6) / Ee)));
      const F = this._incrementalCache.get(Te.cacheKey);
      F && F.prefixFrames === Ne && F.D === ae && (He = Ne, St = C + Ne * Ee, ge = this._restoreDecoderState(F.state), this._incrementalCache.delete(Te.cacheKey), this._incrementalCache.set(Te.cacheKey, F));
    }
    let lt = 0;
    const Yt = y ? performance.now() : 0;
    let Pe = He > 0 || Ne === 0;
    for (let F = He; F < ie; ) {
      const X = F * ae;
      this._encoderFrameBuffer.set(Y.subarray(X, X + ae));
      const de = re.length ? re[re.length - 1] : this.blankId, { tokenLogits: N, step: me, newState: Ie, _logitsTensor: Ye } = await this._runCombinedStep(this._encoderFrameTensor, de, ge);
      let G = -1 / 0, ke = 0;
      const ut = N.length;
      let ee = 0;
      for (; ee < ut % 8; ee++)
        N[ee] > G && (G = N[ee], ke = ee);
      for (; ee < ut; ee += 8) {
        const we = N[ee], Me = N[ee + 1], We = N[ee + 2], je = N[ee + 3], et = N[ee + 4], tt = N[ee + 5], rt = N[ee + 6], nt = N[ee + 7];
        we > G && (G = we, ke = ee), Me > G && (G = Me, ke = ee + 1), We > G && (G = We, ke = ee + 2), je > G && (G = je, ke = ee + 3), et > G && (G = et, ke = ee + 4), tt > G && (G = tt, ke = ee + 5), rt > G && (G = rt, ke = ee + 6), nt > G && (G = nt, ke = ee + 7);
      }
      let xt = G;
      c !== 1 && (xt = G / c);
      let Je = 1, Ut = 0;
      if (i || P) {
        const we = 1 / c;
        let Me = 0, We = 0, je = 0, et = 0, tt = 0, rt = 0, nt = 0, Nt = 0, Ae = 0;
        const Dt = N.length;
        for (; Ae <= Dt - 8; Ae += 8) {
          const ft = (N[Ae] - G) * we, Bt = (N[Ae + 1] - G) * we, gr = (N[Ae + 2] - G) * we, Wt = (N[Ae + 3] - G) * we, Mt = (N[Ae + 4] - G) * we, br = (N[Ae + 5] - G) * we, jt = (N[Ae + 6] - G) * we, yr = (N[Ae + 7] - G) * we;
          Me += Math.exp(ft), We += Math.exp(Bt), je += Math.exp(gr), et += Math.exp(Wt), tt += Math.exp(Mt), rt += Math.exp(br), nt += Math.exp(jt), Nt += Math.exp(yr);
        }
        let $t = Me + We + je + et + tt + rt + nt + Nt;
        for (; Ae < Dt; Ae++)
          $t += Math.exp((N[Ae] - G) * we);
        if (Je = 1 / $t, Ut = G * we - xt - Math.log($t), i) {
          const ft = K.get(F);
          ft ? (ft.sum += Je, ft.count += 1) : K.set(F, { sum: Je, count: 1 }), B += Math.log(Je);
        }
      }
      if (Ye?.dispose?.(), ke !== this.blankId) {
        if (this._disposeDecoderState(ge, Ie), ge = Ie, re.push(ke), S && Ve.push(F), P && Qe.push(Ut), x && ct.push(me), o) {
          const we = me > 0 ? me : 1, Me = Math.min(ie, F + Math.max(1, we)), We = St + F * Ee, je = St + Me * Ee;
          _e.push([We, je]);
        }
        i && J.push(Je), lt += 1;
      } else
        this._disposeDecoderState(Ie, ge);
      if (me > 0 ? (F += me, lt = 0) : (ke === this.blankId || lt >= this.maxTokensPerStep) && (F += m, lt = 0), Te && Te.cacheKey && !Pe && F >= Ne) {
        const we = this._snapshotDecoderState(ge);
        if (!this._incrementalCache.has(Te.cacheKey) && this._incrementalCache.size >= this.maxIncrementalCacheSize) {
          const Me = this._incrementalCache.keys().next().value;
          this._incrementalCache.delete(Me);
        }
        this._incrementalCache.has(Te.cacheKey) && this._incrementalCache.delete(Te.cacheKey), this._incrementalCache.set(Te.cacheKey, { state: we, prefixFrames: Ne, D: ae }), Pe = !0;
      }
    }
    y && (oe = performance.now() - Yt);
    let Rt;
    y && (Rt = performance.now());
    const D = this._normalizer(this.tokenizer.decode(re));
    if (y && (M = performance.now() - Rt), !o && !i) {
      if (y) {
        const de = performance.now() - V, N = fe / (de / 1e3);
      }
      const F = y ? {
        preprocess_ms: +L.toFixed(1),
        encode_ms: +Q.toFixed(1),
        decode_ms: +oe.toFixed(1),
        tokenize_ms: +M.toFixed(1),
        total_ms: +(performance.now() - V).toFixed(1),
        rtf: +(fe / ((performance.now() - V) / 1e3)).toFixed(2),
        preprocessor_backend: he,
        mel_cache: I?.cached ? {
          cached_frames: I.cachedFrames,
          new_frames: I.newFrames
        } : null
      } : null, X = { utterance_text: D, words: [], metrics: F, is_final: !w };
      return b && (X.decoderState = this._snapshotDecoderState(ge)), v && (X.tokenIds = re.slice()), S && (X.frameIndices = Ve.slice()), P && (X.logProbs = Qe.slice()), x && (X.tdtSteps = ct.slice()), this._disposeDecoderState(ge, w), X;
    }
    const qe = [], De = [];
    let Oe = "", Lt = 0, Ce = 0, $e = [];
    if (re.forEach((F, X) => {
      const de = this.tokenizer.id2token[F];
      if (de === this.tokenizer.blankToken) return;
      const N = de.startsWith("▁"), me = N ? de.slice(1) : de, Ie = _e[X] || [null, null], Ye = J[X], G = { token: me, raw_token: de, is_word_start: N };
      if (o && (G.start_time = +Ie[0].toFixed(3), G.end_time = +Ie[1].toFixed(3)), i && (G.confidence = +Ye.toFixed(4)), De.push(G), N) {
        if (Oe) {
          const ke = $e.length ? $e.reduce((ut, ee) => ut + ee, 0) / $e.length : 0;
          qe.push({ text: Oe, start_time: +Lt.toFixed(3), end_time: +Ce.toFixed(3), confidence: +ke.toFixed(4) });
        }
        Oe = me, o && (Lt = Ie[0], Ce = Ie[1]), $e = i ? [Ye] : [];
      } else
        Oe += me, o && (Ce = Ie[1]), i && $e.push(Ye);
    }), Oe) {
      const F = $e.length ? $e.reduce((X, de) => X + de, 0) / $e.length : 0;
      qe.push({ text: Oe, start_time: +Lt.toFixed(3), end_time: +Ce.toFixed(3), confidence: +F.toFixed(4) });
    }
    const Jt = qe.length && i ? qe.reduce((F, X) => F + X.confidence, 0) / qe.length : null, er = De.length && i ? De.reduce((F, X) => F + (X.confidence || 0), 0) / De.length : null;
    if (y) {
      const F = performance.now() - V, X = fe / (F / 1e3);
    }
    const Ze = Array.from(K.entries()).sort((F, X) => F[0] - X[0]).map(([, F]) => F.sum / F.count), Be = {
      utterance_text: D,
      words: qe,
      tokens: De,
      confidence_scores: i ? {
        token: J.map((F) => +F.toFixed(4)),
        token_avg: +er?.toFixed(4),
        word: qe.map((F) => F.confidence),
        word_avg: +Jt?.toFixed(4),
        frame: Ze.map((F) => +F.toFixed(4)),
        frame_avg: Ze.length ? +(Ze.reduce((F, X) => F + X, 0) / Ze.length).toFixed(4) : null,
        overall_log_prob: +B.toFixed(6)
      } : { overall_log_prob: null, frame: null, frame_avg: null },
      metrics: y ? {
        preprocess_ms: +L.toFixed(1),
        encode_ms: +Q.toFixed(1),
        decode_ms: +oe.toFixed(1),
        tokenize_ms: +M.toFixed(1),
        total_ms: +(performance.now() - V).toFixed(1),
        rtf: +(fe / ((performance.now() - V) / 1e3)).toFixed(2),
        preprocessor_backend: he,
        mel_cache: I?.cached ? {
          cached_frames: I.cachedFrames,
          new_frames: I.newFrames
        } : null
      } : null,
      is_final: !Te && !w
      // mark non-final when incremental or streaming mode
    };
    return b && (Be.decoderState = this._snapshotDecoderState(ge)), v && (Be.tokenIds = re.slice()), S && (Be.frameIndices = Ve.slice()), P && (Be.logProbs = Qe.map((F) => +F.toFixed(6))), x && (Be.tdtSteps = ct.slice()), this._disposeDecoderState(ge, w), Be;
  }
  /**
   * Create a stateful streaming transcriber for this model.
   * This provides a convenient API for processing sequential audio chunks
   * without manually wiring decoder-state handoff between calls.
   * For overlapping windows that require dedupe/stitching, use
   * app-side merge logic suited to your overlap strategy.
   * 
   * @param {Object} opts - Streaming options
   * @param {number} opts.chunkDuration - Expected chunk duration in seconds (for timestamp calculation)
   * @param {boolean} opts.returnTimestamps - Include timestamps in output
   * @param {boolean} opts.returnConfidences - Include confidence scores
   * @returns {StatefulStreamingTranscriber}
   */
  createStreamingTranscriber(e = {}) {
    return new vi(this, e);
  }
  /**
   * Transcribe long-form audio with sentence-aware windowing and chunk assembly.
   * This is intended for full recordings where a single `transcribe()` call is
   * less convenient than a built-in windowing helper.
   *
   * @param {Float32Array|Float64Array} audio - Full audio buffer.
   * @param {number} sampleRate - Sample rate (default 16000).
   * @param {Object} opts - Long-audio transcription options.
   * @returns {Promise<{ text: string, words?: Array<{ text: string, start_time: number, end_time: number, confidence?: number }>, chunks?: Array<{ text: string, timestamp: [number, number] }> }>}
   */
  async transcribeLongAudio(e, n = 16e3, a = {}) {
    return bi(this, e, n, a);
  }
  /**
   * Stop ORT profiling (if enabled) for all sessions and print a quick summary
   * of time spent on GPU (WebGPU) vs CPU (WASM) kernels. Returns the parsed
   * summary object for further inspection.
   * @returns {Object<string, {gpu_us: number, cpu_us: number, total_us: number}>|null} Parsed profile summary keyed by profile filename.
   */
  endProfiling() {
    try {
      this.encoderSession?.endProfiling();
    } catch {
    }
    try {
      this.joinerSession?.endProfiling();
    } catch {
    }
    const e = this.ort?.env?.wasm?.FS;
    if (!e)
      return null;
    const n = e.readdir("/tmp").filter((o) => o.startsWith("profile_") && o.endsWith(".json"));
    if (!n.length)
      return null;
    const a = {};
    for (const o of n)
      try {
        const i = e.readFile("/tmp/" + o, { encoding: "utf8" }), c = JSON.parse(i);
        let d = 0, f = 0;
        for (const p of c)
          if (p.cat === "Node") {
            const m = p.args?.provider;
            m === "webgpu" ? d += p.dur : m && (f += p.dur);
          }
        a[o] = { gpu_us: d, cpu_us: f, total_us: d + f };
      } catch {
      }
    return a;
  }
}
class vi {
  /**
   * Create a streaming transcriber.
   * @param {ParakeetModel} model - The Parakeet model to use
   * @param {Object} opts - Options
   * @param {boolean} opts.returnTimestamps - Include timestamps (default: true)
   * @param {boolean} opts.returnConfidences - Include confidence scores (default: false)
   * @param {boolean} opts.returnTokenIds - Include raw token IDs (default: false)
   * @param {number} opts.sampleRate - Audio sample rate (default: 16000)
   * @param {boolean} opts.debug - Enable debug logging (default: false)
   */
  constructor(e, n = {}) {
    this.model = e, this.opts = {
      returnTimestamps: n.returnTimestamps ?? !0,
      returnConfidences: n.returnConfidences ?? !1,
      returnTokenIds: n.returnTokenIds ?? !1,
      sampleRate: n.sampleRate ?? 16e3,
      debug: n.debug ?? !1
    }, this._decoderState = null, this._currentOffset = 0, this._totalWords = [], this._totalTokenIds = [], this._chunkCount = 0, this._isFinalized = !1, this._metrics = {
      preprocess_ms: 0,
      encode_ms: 0,
      decode_ms: 0,
      tokenize_ms: 0,
      total_ms: 0,
      cached_frames: 0,
      new_frames: 0
    }, this._hasMetrics = !1, this._hasMelCacheMetrics = !1;
  }
  _accumulateMetrics(e) {
    if (!(!e || typeof e != "object")) {
      this._hasMetrics = !0;
      for (const n of ["preprocess_ms", "encode_ms", "decode_ms", "tokenize_ms", "total_ms"])
        typeof e[n] == "number" && Number.isFinite(e[n]) && (this._metrics[n] += e[n]);
      e.mel_cache && typeof e.mel_cache == "object" && (this._hasMelCacheMetrics = !0, typeof e.mel_cache.cached_frames == "number" && Number.isFinite(e.mel_cache.cached_frames) && (this._metrics.cached_frames += e.mel_cache.cached_frames), typeof e.mel_cache.new_frames == "number" && Number.isFinite(e.mel_cache.new_frames) && (this._metrics.new_frames += e.mel_cache.new_frames));
    }
  }
  _getCumulativeMetrics() {
    if (!this._hasMetrics)
      return null;
    const e = this._metrics.total_ms > 0 ? this._metrics.total_ms : this._metrics.preprocess_ms + this._metrics.encode_ms + this._metrics.decode_ms + this._metrics.tokenize_ms, n = {
      preprocess_ms: this._metrics.preprocess_ms,
      encode_ms: this._metrics.encode_ms,
      decode_ms: this._metrics.decode_ms,
      tokenize_ms: this._metrics.tokenize_ms,
      total_ms: e,
      rtf: e > 0 ? this._currentOffset / (e / 1e3) : 0
    };
    return this._hasMelCacheMetrics && (n.mel_cache = {
      cached_frames: this._metrics.cached_frames,
      new_frames: this._metrics.new_frames
    }), n;
  }
  /**
   * Process an audio chunk and return the cumulative transcription.
   * 
   * @param {Float32Array} audio - Audio samples (16kHz mono PCM)
   * @returns {Promise<Object>} Transcription result with cumulative text and words
   */
  async processChunk(e) {
    if (this._isFinalized)
      throw new Error("Streamer is finalized. Create a new instance to process more audio.");
    const n = e.length / this.opts.sampleRate, a = await this.model.transcribe(e, this.opts.sampleRate, {
      returnTimestamps: this.opts.returnTimestamps,
      returnConfidences: this.opts.returnConfidences,
      returnTokenIds: this.opts.returnTokenIds,
      previousDecoderState: this._decoderState,
      returnDecoderState: !0,
      timeOffset: this._currentOffset
    });
    return this._decoderState = a.decoderState, this._currentOffset += n, this._chunkCount++, this._accumulateMetrics(a.metrics), a.words && a.words.length > 0 && this._totalWords.push(...a.words), this.opts.returnTokenIds && a.tokenIds && this._totalTokenIds.push(...a.tokenIds), this.opts.debug, {
      // Current chunk text
      chunkText: a.utterance_text,
      chunkWords: a.words || [],
      // Cumulative transcript (NO MERGING - just concatenation!)
      text: this._totalWords.map((o) => o.text).join(" "),
      words: this._totalWords.slice(),
      // Metadata
      totalDuration: this._currentOffset,
      chunkCount: this._chunkCount,
      is_final: !1,
      // Optional data
      ...this.opts.returnTokenIds ? { tokenIds: this._totalTokenIds.slice() } : {},
      ...this.opts.returnConfidences && a.confidence_scores ? { confidence_scores: a.confidence_scores } : {},
      metrics: this._getCumulativeMetrics()
    };
  }
  /**
   * Finalize the streaming session and return the complete transcript.
   * After calling finalize(), no more chunks can be processed.
   * 
   * @returns {Object} Final transcription result
   */
  finalize() {
    return this._isFinalized = !0, {
      text: this._totalWords.map((e) => e.text).join(" "),
      words: this._totalWords.slice(),
      totalDuration: this._currentOffset,
      chunkCount: this._chunkCount,
      is_final: !0,
      ...this.opts.returnTokenIds ? { tokenIds: this._totalTokenIds.slice() } : {},
      metrics: this._getCumulativeMetrics()
    };
  }
  /**
   * Reset the streamer to process a new audio stream.
   * @returns {void}
   */
  reset() {
    this._decoderState = null, this._currentOffset = 0, this._totalWords = [], this._totalTokenIds = [], this._chunkCount = 0, this._isFinalized = !1, this._metrics = {
      preprocess_ms: 0,
      encode_ms: 0,
      decode_ms: 0,
      tokenize_ms: 0,
      total_ms: 0,
      cached_frames: 0,
      new_frames: 0
    }, this._hasMetrics = !1, this._hasMelCacheMetrics = !1;
  }
  /**
   * Get current state for inspection/debugging.
   * @returns {{hasDecoderState: boolean, currentOffset: number, wordCount: number, chunkCount: number, isFinalized: boolean}}
   */
  getState() {
    return {
      hasDecoderState: this._decoderState !== null,
      currentOffset: this._currentOffset,
      wordCount: this._totalWords.length,
      chunkCount: this._chunkCount,
      isFinalized: this._isFinalized
    };
  }
}
var rn = Object.defineProperty, Ti = Object.getOwnPropertyDescriptor, ki = Object.getOwnPropertyNames, Ai = Object.prototype.hasOwnProperty, Ei = ((t) => typeof require < "u" ? require : typeof Proxy < "u" ? new Proxy(t, { get: (e, n) => (typeof require < "u" ? require : e)[n] }) : t)(function(t) {
  if (typeof require < "u") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + t + '" is not supported');
}), Z = (t, e) => () => (t && (e = t(t = 0)), e), wr = (t, e) => {
  for (var n in e) rn(t, n, { get: e[n], enumerable: !0 });
}, Si = (t, e, n, a) => {
  if (e && typeof e == "object" || typeof e == "function") for (let o of ki(e)) !Ai.call(t, o) && o !== n && rn(t, o, { get: () => e[o], enumerable: !(a = Ti(e, o)) || a.enumerable });
  return t;
}, Xr = (t) => Si(rn({}, "__esModule", { value: !0 }), t), Vt, st, Zt, ao, Fo, Po = Z(() => {
  Vt = /* @__PURE__ */ new Map(), st = [], Zt = (t, e, n) => {
    if (e && typeof e.init == "function" && typeof e.createInferenceSessionHandler == "function") {
      let a = Vt.get(t);
      if (a === void 0) Vt.set(t, { backend: e, priority: n });
      else {
        if (a.priority > n) return;
        if (a.priority === n && a.backend !== e) throw new Error(`cannot register backend "${t}" using priority ${n}`);
      }
      if (n >= 0) {
        let o = st.indexOf(t);
        o !== -1 && st.splice(o, 1);
        for (let i = 0; i < st.length; i++) if (Vt.get(st[i]).priority <= n) {
          st.splice(i, 0, t);
          return;
        }
        st.push(t);
      }
      return;
    }
    throw new TypeError("not a valid backend");
  }, ao = async (t) => {
    let e = Vt.get(t);
    if (!e) return "backend not found.";
    if (e.initialized) return e.backend;
    if (e.aborted) return e.error;
    {
      let n = !!e.initPromise;
      try {
        return n || (e.initPromise = e.backend.init(t)), await e.initPromise, e.initialized = !0, e.backend;
      } catch (a) {
        return n || (e.error = `${a}`, e.aborted = !0), e.error;
      } finally {
        delete e.initPromise;
      }
    }
  }, Fo = async (t) => {
    let e = t.executionProviders || [], n = e.map((f) => typeof f == "string" ? f : f.name), a = n.length === 0 ? st : n, o, i = [], c = /* @__PURE__ */ new Set();
    for (let f of a) {
      let p = await ao(f);
      typeof p == "string" ? i.push({ name: f, err: p }) : (o || (o = p), o === p && c.add(f));
    }
    if (!o) throw new Error(`no available backend found. ERR: ${i.map((f) => `[${f.name}] ${f.err}`).join(", ")}`);
    for (let { name: f, err: p } of i) n.includes(f);
    let d = e.filter((f) => c.has(typeof f == "string" ? f : f.name));
    return [o, new Proxy(t, { get: (f, p) => p === "executionProviders" ? d : Reflect.get(f, p) })];
  };
}), xi = Z(() => {
  Po();
}), Oo, Mi = Z(() => {
  Oo = "1.24.1";
}), Cr, be, Co = Z(() => {
  Mi(), Cr = "warning", be = { wasm: {}, webgl: {}, webgpu: {}, versions: { common: Oo }, set logLevel(t) {
    if (t !== void 0) {
      if (typeof t != "string" || ["verbose", "info", "warning", "error", "fatal"].indexOf(t) === -1) throw new Error(`Unsupported logging level: ${t}`);
      Cr = t;
    }
  }, get logLevel() {
    return Cr;
  } }, Object.defineProperty(be, "logLevel", { enumerable: !0 });
}), ue, Fi = Z(() => {
  Co(), ue = be;
}), Io, Ro, Pi = Z(() => {
  Io = (t, e) => {
    let n = typeof document < "u" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
    n.width = t.dims[3], n.height = t.dims[2];
    let a = n.getContext("2d");
    if (a != null) {
      let o, i;
      e?.tensorLayout !== void 0 && e.tensorLayout === "NHWC" ? (o = t.dims[2], i = t.dims[3]) : (o = t.dims[3], i = t.dims[2]);
      let c = e?.format !== void 0 ? e.format : "RGB", d = e?.norm, f, p;
      d === void 0 || d.mean === void 0 ? f = [255, 255, 255, 255] : typeof d.mean == "number" ? f = [d.mean, d.mean, d.mean, d.mean] : (f = [d.mean[0], d.mean[1], d.mean[2], 0], d.mean[3] !== void 0 && (f[3] = d.mean[3])), d === void 0 || d.bias === void 0 ? p = [0, 0, 0, 0] : typeof d.bias == "number" ? p = [d.bias, d.bias, d.bias, d.bias] : (p = [d.bias[0], d.bias[1], d.bias[2], 0], d.bias[3] !== void 0 && (p[3] = d.bias[3]));
      let m = i * o, w = 0, b = m, _ = m * 2, v = -1;
      c === "RGBA" ? (w = 0, b = m, _ = m * 2, v = m * 3) : c === "RGB" ? (w = 0, b = m, _ = m * 2) : c === "RBG" && (w = 0, _ = m, b = m * 2);
      for (let S = 0; S < i; S++) for (let P = 0; P < o; P++) {
        let x = (t.data[w++] - p[0]) * f[0], k = (t.data[b++] - p[1]) * f[1], A = (t.data[_++] - p[2]) * f[2], R = v === -1 ? 255 : (t.data[v++] - p[3]) * f[3];
        a.fillStyle = "rgba(" + x + "," + k + "," + A + "," + R + ")", a.fillRect(P, S, 1, 1);
      }
      if ("toDataURL" in n) return n.toDataURL();
      throw new Error("toDataURL is not supported");
    } else throw new Error("Can not access image data");
  }, Ro = (t, e) => {
    let n = typeof document < "u" ? document.createElement("canvas").getContext("2d") : new OffscreenCanvas(1, 1).getContext("2d"), a;
    if (n != null) {
      let o, i, c;
      e?.tensorLayout !== void 0 && e.tensorLayout === "NHWC" ? (o = t.dims[2], i = t.dims[1], c = t.dims[3]) : (o = t.dims[3], i = t.dims[2], c = t.dims[1]);
      let d = e !== void 0 && e.format !== void 0 ? e.format : "RGB", f = e?.norm, p, m;
      f === void 0 || f.mean === void 0 ? p = [255, 255, 255, 255] : typeof f.mean == "number" ? p = [f.mean, f.mean, f.mean, f.mean] : (p = [f.mean[0], f.mean[1], f.mean[2], 255], f.mean[3] !== void 0 && (p[3] = f.mean[3])), f === void 0 || f.bias === void 0 ? m = [0, 0, 0, 0] : typeof f.bias == "number" ? m = [f.bias, f.bias, f.bias, f.bias] : (m = [f.bias[0], f.bias[1], f.bias[2], 0], f.bias[3] !== void 0 && (m[3] = f.bias[3]));
      let w = i * o;
      if (e !== void 0 && (e.format !== void 0 && c === 4 && e.format !== "RGBA" || c === 3 && e.format !== "RGB" && e.format !== "BGR")) throw new Error("Tensor format doesn't match input tensor dims");
      let b = 4, _ = 0, v = 1, S = 2, P = 3, x = 0, k = w, A = w * 2, R = -1;
      d === "RGBA" ? (x = 0, k = w, A = w * 2, R = w * 3) : d === "RGB" ? (x = 0, k = w, A = w * 2) : d === "RBG" && (x = 0, A = w, k = w * 2), a = n.createImageData(o, i);
      for (let C = 0; C < i * o; _ += b, v += b, S += b, P += b, C++) a.data[_] = (t.data[x++] - m[0]) * p[0], a.data[v] = (t.data[k++] - m[1]) * p[1], a.data[S] = (t.data[A++] - m[2]) * p[2], a.data[P] = R === -1 ? 255 : (t.data[R++] - m[3]) * p[3];
    } else throw new Error("Can not access image data");
    return a;
  };
}), ar, Lo, Uo, No, Do, $o, Oi = Z(() => {
  nn(), ar = (t, e) => {
    if (t === void 0) throw new Error("Image buffer must be defined");
    if (e.height === void 0 || e.width === void 0) throw new Error("Image height and width must be defined");
    if (e.tensorLayout === "NHWC") throw new Error("NHWC Tensor layout is not supported yet");
    let { height: n, width: a } = e, o = e.norm ?? { mean: 255, bias: 0 }, i, c;
    typeof o.mean == "number" ? i = [o.mean, o.mean, o.mean, o.mean] : i = [o.mean[0], o.mean[1], o.mean[2], o.mean[3] ?? 255], typeof o.bias == "number" ? c = [o.bias, o.bias, o.bias, o.bias] : c = [o.bias[0], o.bias[1], o.bias[2], o.bias[3] ?? 0];
    let d = e.format !== void 0 ? e.format : "RGBA", f = e.tensorFormat !== void 0 && e.tensorFormat !== void 0 ? e.tensorFormat : "RGB", p = n * a, m = f === "RGBA" ? new Float32Array(p * 4) : new Float32Array(p * 3), w = 4, b = 0, _ = 1, v = 2, S = 3, P = 0, x = p, k = p * 2, A = -1;
    d === "RGB" && (w = 3, b = 0, _ = 1, v = 2, S = -1), f === "RGBA" ? A = p * 3 : f === "RBG" ? (P = 0, k = p, x = p * 2) : f === "BGR" && (k = 0, x = p, P = p * 2);
    for (let R = 0; R < p; R++, b += w, v += w, _ += w, S += w) m[P++] = (t[b] + c[0]) / i[0], m[x++] = (t[_] + c[1]) / i[1], m[k++] = (t[v] + c[2]) / i[2], A !== -1 && S !== -1 && (m[A++] = (t[S] + c[3]) / i[3]);
    return f === "RGBA" ? new xe("float32", m, [1, 4, n, a]) : new xe("float32", m, [1, 3, n, a]);
  }, Lo = async (t, e) => {
    let n = typeof HTMLImageElement < "u" && t instanceof HTMLImageElement, a = typeof ImageData < "u" && t instanceof ImageData, o = typeof ImageBitmap < "u" && t instanceof ImageBitmap, i = typeof t == "string", c, d = e ?? {}, f = () => {
      if (typeof document < "u") return document.createElement("canvas");
      if (typeof OffscreenCanvas < "u") return new OffscreenCanvas(1, 1);
      throw new Error("Canvas is not supported");
    }, p = (m) => typeof HTMLCanvasElement < "u" && m instanceof HTMLCanvasElement || m instanceof OffscreenCanvas ? m.getContext("2d") : null;
    if (n) {
      let m = f();
      m.width = t.width, m.height = t.height;
      let w = p(m);
      if (w != null) {
        let b = t.height, _ = t.width;
        if (e !== void 0 && e.resizedHeight !== void 0 && e.resizedWidth !== void 0 && (b = e.resizedHeight, _ = e.resizedWidth), e !== void 0) {
          if (d = e, e.tensorFormat !== void 0) throw new Error("Image input config format must be RGBA for HTMLImageElement");
          d.tensorFormat = "RGBA", d.height = b, d.width = _;
        } else d.tensorFormat = "RGBA", d.height = b, d.width = _;
        w.drawImage(t, 0, 0), c = w.getImageData(0, 0, _, b).data;
      } else throw new Error("Can not access image data");
    } else if (a) {
      let m, w;
      if (e !== void 0 && e.resizedWidth !== void 0 && e.resizedHeight !== void 0 ? (m = e.resizedHeight, w = e.resizedWidth) : (m = t.height, w = t.width), e !== void 0 && (d = e), d.format = "RGBA", d.height = m, d.width = w, e !== void 0) {
        let b = f();
        b.width = w, b.height = m;
        let _ = p(b);
        if (_ != null) _.putImageData(t, 0, 0), c = _.getImageData(0, 0, w, m).data;
        else throw new Error("Can not access image data");
      } else c = t.data;
    } else if (o) {
      if (e === void 0) throw new Error("Please provide image config with format for Imagebitmap");
      let m = f();
      m.width = t.width, m.height = t.height;
      let w = p(m);
      if (w != null) {
        let b = t.height, _ = t.width;
        return w.drawImage(t, 0, 0, _, b), c = w.getImageData(0, 0, _, b).data, d.height = b, d.width = _, ar(c, d);
      } else throw new Error("Can not access image data");
    } else {
      if (i) return new Promise((m, w) => {
        let b = f(), _ = p(b);
        if (!t || !_) return w();
        let v = new Image();
        v.crossOrigin = "Anonymous", v.src = t, v.onload = () => {
          b.width = v.width, b.height = v.height, _.drawImage(v, 0, 0, b.width, b.height);
          let S = _.getImageData(0, 0, b.width, b.height);
          d.height = b.height, d.width = b.width, m(ar(S.data, d));
        };
      });
      throw new Error("Input data provided is not supported - aborted tensor creation");
    }
    if (c !== void 0) return ar(c, d);
    throw new Error("Input data provided is not supported - aborted tensor creation");
  }, Uo = (t, e) => {
    let { width: n, height: a, download: o, dispose: i } = e, c = [1, a, n, 4];
    return new xe({ location: "texture", type: "float32", texture: t, dims: c, download: o, dispose: i });
  }, No = (t, e) => {
    let { dataType: n, dims: a, download: o, dispose: i } = e;
    return new xe({ location: "gpu-buffer", type: n ?? "float32", gpuBuffer: t, dims: a, download: o, dispose: i });
  }, Do = (t, e) => {
    let { dataType: n, dims: a, download: o, dispose: i } = e;
    return new xe({ location: "ml-tensor", type: n ?? "float32", mlTensor: t, dims: a, download: o, dispose: i });
  }, $o = (t, e, n) => new xe({ location: "cpu-pinned", type: t, data: e, dims: n ?? [e.length] });
}), bt, Qt, Ir, Bo, Ci = Z(() => {
  bt = /* @__PURE__ */ new Map([["float32", Float32Array], ["uint8", Uint8Array], ["int8", Int8Array], ["uint16", Uint16Array], ["int16", Int16Array], ["int32", Int32Array], ["bool", Uint8Array], ["float64", Float64Array], ["uint32", Uint32Array], ["int4", Uint8Array], ["uint4", Uint8Array]]), Qt = /* @__PURE__ */ new Map([[Float32Array, "float32"], [Uint8Array, "uint8"], [Int8Array, "int8"], [Uint16Array, "uint16"], [Int16Array, "int16"], [Int32Array, "int32"], [Float64Array, "float64"], [Uint32Array, "uint32"]]), Ir = !1, Bo = () => {
    if (!Ir) {
      Ir = !0;
      let t = typeof BigInt64Array < "u" && BigInt64Array.from, e = typeof BigUint64Array < "u" && BigUint64Array.from, n = globalThis.Float16Array, a = typeof n < "u" && n.from;
      t && (bt.set("int64", BigInt64Array), Qt.set(BigInt64Array, "int64")), e && (bt.set("uint64", BigUint64Array), Qt.set(BigUint64Array, "uint64")), a ? (bt.set("float16", n), Qt.set(n, "float16")) : bt.set("float16", Uint16Array);
    }
  };
}), Wo, jo, Ii = Z(() => {
  nn(), Wo = (t) => {
    let e = 1;
    for (let n = 0; n < t.length; n++) {
      let a = t[n];
      if (typeof a != "number" || !Number.isSafeInteger(a)) throw new TypeError(`dims[${n}] must be an integer, got: ${a}`);
      if (a < 0) throw new RangeError(`dims[${n}] must be a non-negative integer, got: ${a}`);
      e *= a;
    }
    return e;
  }, jo = (t, e) => {
    switch (t.location) {
      case "cpu":
        return new xe(t.type, t.data, e);
      case "cpu-pinned":
        return new xe({ location: "cpu-pinned", data: t.data, type: t.type, dims: e });
      case "texture":
        return new xe({ location: "texture", texture: t.texture, type: t.type, dims: e });
      case "gpu-buffer":
        return new xe({ location: "gpu-buffer", gpuBuffer: t.gpuBuffer, type: t.type, dims: e });
      case "ml-tensor":
        return new xe({ location: "ml-tensor", mlTensor: t.mlTensor, type: t.type, dims: e });
      default:
        throw new Error(`tensorReshape: tensor location ${t.location} is not supported`);
    }
  };
}), xe, nn = Z(() => {
  Pi(), Oi(), Ci(), Ii(), xe = class {
    constructor(t, e, n) {
      Bo();
      let a, o;
      if (typeof t == "object" && "location" in t) switch (this.dataLocation = t.location, a = t.type, o = t.dims, t.location) {
        case "cpu-pinned": {
          let c = bt.get(a);
          if (!c) throw new TypeError(`unsupported type "${a}" to create tensor from pinned buffer`);
          if (!(t.data instanceof c)) throw new TypeError(`buffer should be of type ${c.name}`);
          this.cpuData = t.data;
          break;
        }
        case "texture": {
          if (a !== "float32") throw new TypeError(`unsupported type "${a}" to create tensor from texture`);
          this.gpuTextureData = t.texture, this.downloader = t.download, this.disposer = t.dispose;
          break;
        }
        case "gpu-buffer": {
          if (a !== "float32" && a !== "float16" && a !== "int32" && a !== "int64" && a !== "uint32" && a !== "uint8" && a !== "bool" && a !== "uint4" && a !== "int4") throw new TypeError(`unsupported type "${a}" to create tensor from gpu buffer`);
          this.gpuBufferData = t.gpuBuffer, this.downloader = t.download, this.disposer = t.dispose;
          break;
        }
        case "ml-tensor": {
          if (a !== "float32" && a !== "float16" && a !== "int32" && a !== "int64" && a !== "uint32" && a !== "uint64" && a !== "int8" && a !== "uint8" && a !== "bool" && a !== "uint4" && a !== "int4") throw new TypeError(`unsupported type "${a}" to create tensor from MLTensor`);
          this.mlTensorData = t.mlTensor, this.downloader = t.download, this.disposer = t.dispose;
          break;
        }
        default:
          throw new Error(`Tensor constructor: unsupported location '${this.dataLocation}'`);
      }
      else {
        let c, d;
        if (typeof t == "string") if (a = t, d = n, t === "string") {
          if (!Array.isArray(e)) throw new TypeError("A string tensor's data must be a string array.");
          c = e;
        } else {
          let f = bt.get(t);
          if (f === void 0) throw new TypeError(`Unsupported tensor type: ${t}.`);
          if (Array.isArray(e)) {
            if (t === "float16" && f === Uint16Array || t === "uint4" || t === "int4") throw new TypeError(`Creating a ${t} tensor from number array is not supported. Please use ${f.name} as data.`);
            t === "uint64" || t === "int64" ? c = f.from(e, BigInt) : c = f.from(e);
          } else if (e instanceof f) c = e;
          else if (e instanceof Uint8ClampedArray) if (t === "uint8") c = Uint8Array.from(e);
          else throw new TypeError("A Uint8ClampedArray tensor's data must be type of uint8");
          else if (t === "float16" && e instanceof Uint16Array && f !== Uint16Array) c = new globalThis.Float16Array(e.buffer, e.byteOffset, e.length);
          else throw new TypeError(`A ${a} tensor's data must be type of ${f}`);
        }
        else if (d = e, Array.isArray(t)) {
          if (t.length === 0) throw new TypeError("Tensor type cannot be inferred from an empty array.");
          let f = typeof t[0];
          if (f === "string") a = "string", c = t;
          else if (f === "boolean") a = "bool", c = Uint8Array.from(t);
          else throw new TypeError(`Invalid element type of data array: ${f}.`);
        } else if (t instanceof Uint8ClampedArray) a = "uint8", c = Uint8Array.from(t);
        else {
          let f = Qt.get(t.constructor);
          if (f === void 0) throw new TypeError(`Unsupported type for tensor data: ${t.constructor}.`);
          a = f, c = t;
        }
        if (d === void 0) d = [c.length];
        else if (!Array.isArray(d)) throw new TypeError("A tensor's dims must be a number array");
        o = d, this.cpuData = c, this.dataLocation = "cpu";
      }
      let i = Wo(o);
      if (this.cpuData && i !== this.cpuData.length && !((a === "uint4" || a === "int4") && Math.ceil(i / 2) === this.cpuData.length)) throw new Error(`Tensor's size(${i}) does not match data length(${this.cpuData.length}).`);
      this.type = a, this.dims = o, this.size = i;
    }
    static async fromImage(t, e) {
      return Lo(t, e);
    }
    static fromTexture(t, e) {
      return Uo(t, e);
    }
    static fromGpuBuffer(t, e) {
      return No(t, e);
    }
    static fromMLTensor(t, e) {
      return Do(t, e);
    }
    static fromPinnedBuffer(t, e, n) {
      return $o(t, e, n);
    }
    toDataURL(t) {
      return Io(this, t);
    }
    toImageData(t) {
      return Ro(this, t);
    }
    get data() {
      if (this.ensureValid(), !this.cpuData) throw new Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");
      return this.cpuData;
    }
    get location() {
      return this.dataLocation;
    }
    get texture() {
      if (this.ensureValid(), !this.gpuTextureData) throw new Error("The data is not stored as a WebGL texture.");
      return this.gpuTextureData;
    }
    get gpuBuffer() {
      if (this.ensureValid(), !this.gpuBufferData) throw new Error("The data is not stored as a WebGPU buffer.");
      return this.gpuBufferData;
    }
    get mlTensor() {
      if (this.ensureValid(), !this.mlTensorData) throw new Error("The data is not stored as a WebNN MLTensor.");
      return this.mlTensorData;
    }
    async getData(t) {
      switch (this.ensureValid(), this.dataLocation) {
        case "cpu":
        case "cpu-pinned":
          return this.data;
        case "texture":
        case "gpu-buffer":
        case "ml-tensor": {
          if (!this.downloader) throw new Error("The current tensor is not created with a specified data downloader.");
          if (this.isDownloading) throw new Error("The current tensor is being downloaded.");
          try {
            this.isDownloading = !0;
            let e = await this.downloader();
            return this.downloader = void 0, this.dataLocation = "cpu", this.cpuData = e, t && this.disposer && (this.disposer(), this.disposer = void 0), e;
          } finally {
            this.isDownloading = !1;
          }
        }
        default:
          throw new Error(`cannot get data from location: ${this.dataLocation}`);
      }
    }
    dispose() {
      if (this.isDownloading) throw new Error("The current tensor is being downloaded.");
      this.disposer && (this.disposer(), this.disposer = void 0), this.cpuData = void 0, this.gpuTextureData = void 0, this.gpuBufferData = void 0, this.mlTensorData = void 0, this.downloader = void 0, this.isDownloading = void 0, this.dataLocation = "none";
    }
    ensureValid() {
      if (this.dataLocation === "none") throw new Error("The tensor is disposed.");
    }
    reshape(t) {
      if (this.ensureValid(), this.downloader || this.disposer) throw new Error("Cannot reshape a tensor that owns GPU resource.");
      return jo(this, t);
    }
  };
}), Ue, zo = Z(() => {
  nn(), Ue = xe;
}), hr, Rr, vt, Tt, kt, At, Go = Z(() => {
  Co(), hr = (t, e) => {
    typeof be.trace > "u" ? be.wasm.trace : be.trace;
  }, Rr = (t, e) => {
    let n = new Error().stack?.split(/\r\n|\r|\n/g) || [], a = !1;
    for (let o = 0; o < n.length; o++) {
      if (a && !n[o].includes("TRACE_FUNC")) {
        let i = `FUNC_${t}::${n[o].trim().split(" ")[1]}`;
        e && (i += `::${e}`), hr("CPU", i);
        return;
      }
      n[o].includes("TRACE_FUNC") && (a = !0);
    }
  }, vt = (t) => {
    (typeof be.trace > "u" ? !be.wasm.trace : !be.trace) || Rr("BEGIN", t);
  }, Tt = (t) => {
    (typeof be.trace > "u" ? !be.wasm.trace : !be.trace) || Rr("END", t);
  }, kt = (t) => {
    typeof be.trace > "u" ? be.wasm.trace : be.trace;
  }, At = (t) => {
    typeof be.trace > "u" ? be.wasm.trace : be.trace;
  };
}), Vo, Ri = Z(() => {
  Po(), zo(), Go(), Vo = class Ho {
    constructor(e) {
      this.handler = e;
    }
    async run(e, n, a) {
      vt(), kt("InferenceSession.run");
      let o = {}, i = {};
      if (typeof e != "object" || e === null || e instanceof Ue || Array.isArray(e)) throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");
      let c = !0;
      if (typeof n == "object") {
        if (n === null) throw new TypeError("Unexpected argument[1]: cannot be null.");
        if (n instanceof Ue) throw new TypeError("'fetches' cannot be a Tensor");
        if (Array.isArray(n)) {
          if (n.length === 0) throw new TypeError("'fetches' cannot be an empty array.");
          c = !1;
          for (let p of n) {
            if (typeof p != "string") throw new TypeError("'fetches' must be a string array or an object.");
            if (this.outputNames.indexOf(p) === -1) throw new RangeError(`'fetches' contains invalid output name: ${p}.`);
            o[p] = null;
          }
          if (typeof a == "object" && a !== null) i = a;
          else if (typeof a < "u") throw new TypeError("'options' must be an object.");
        } else {
          let p = !1, m = Object.getOwnPropertyNames(n);
          for (let w of this.outputNames) if (m.indexOf(w) !== -1) {
            let b = n[w];
            (b === null || b instanceof Ue) && (p = !0, c = !1, o[w] = b);
          }
          if (p) {
            if (typeof a == "object" && a !== null) i = a;
            else if (typeof a < "u") throw new TypeError("'options' must be an object.");
          } else i = n;
        }
      } else if (typeof n < "u") throw new TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");
      for (let p of this.inputNames) if (typeof e[p] > "u") throw new Error(`input '${p}' is missing in 'feeds'.`);
      if (c) for (let p of this.outputNames) o[p] = null;
      let d = await this.handler.run(e, o, i), f = {};
      for (let p in d) if (Object.hasOwnProperty.call(d, p)) {
        let m = d[p];
        m instanceof Ue ? f[p] = m : f[p] = new Ue(m.type, m.data, m.dims);
      }
      return At("InferenceSession.run"), Tt(), f;
    }
    async release() {
      return this.handler.dispose();
    }
    static async create(e, n, a, o) {
      vt(), kt("InferenceSession.create");
      let i, c = {};
      if (typeof e == "string") {
        if (i = e, typeof n == "object" && n !== null) c = n;
        else if (typeof n < "u") throw new TypeError("'options' must be an object.");
      } else if (e instanceof Uint8Array) {
        if (i = e, typeof n == "object" && n !== null) c = n;
        else if (typeof n < "u") throw new TypeError("'options' must be an object.");
      } else if (e instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && e instanceof SharedArrayBuffer) {
        let m = e, w = 0, b = e.byteLength;
        if (typeof n == "object" && n !== null) c = n;
        else if (typeof n == "number") {
          if (w = n, !Number.isSafeInteger(w)) throw new RangeError("'byteOffset' must be an integer.");
          if (w < 0 || w >= m.byteLength) throw new RangeError(`'byteOffset' is out of range [0, ${m.byteLength}).`);
          if (b = e.byteLength - w, typeof a == "number") {
            if (b = a, !Number.isSafeInteger(b)) throw new RangeError("'byteLength' must be an integer.");
            if (b <= 0 || w + b > m.byteLength) throw new RangeError(`'byteLength' is out of range (0, ${m.byteLength - w}].`);
            if (typeof o == "object" && o !== null) c = o;
            else if (typeof o < "u") throw new TypeError("'options' must be an object.");
          } else if (typeof a < "u") throw new TypeError("'byteLength' must be a number.");
        } else if (typeof n < "u") throw new TypeError("'options' must be an object.");
        i = new Uint8Array(m, w, b);
      } else throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");
      let [d, f] = await Fo(c), p = await d.createInferenceSessionHandler(i, f);
      return At("InferenceSession.create"), Tt(), new Ho(p);
    }
    startProfiling() {
      this.handler.startProfiling();
    }
    endProfiling() {
      this.handler.endProfiling();
    }
    get inputNames() {
      return this.handler.inputNames;
    }
    get outputNames() {
      return this.handler.outputNames;
    }
    get inputMetadata() {
      return this.handler.inputMetadata;
    }
    get outputMetadata() {
      return this.handler.outputMetadata;
    }
  };
}), on, Li = Z(() => {
  Ri(), on = Vo;
}), Ui = Z(() => {
}), Ni = Z(() => {
}), Di = Z(() => {
}), $i = Z(() => {
}), qo = {};
wr(qo, { InferenceSession: () => on, TRACE: () => hr, TRACE_EVENT_BEGIN: () => kt, TRACE_EVENT_END: () => At, TRACE_FUNC_BEGIN: () => vt, TRACE_FUNC_END: () => Tt, Tensor: () => Ue, env: () => ue, registerBackend: () => Zt });
var Et = Z(() => {
  xi(), Fi(), Li(), zo(), Ui(), Ni(), Go(), Di(), $i();
}), sn = Z(() => {
}), Ko = {};
wr(Ko, { default: () => Xo });
var Lr, Ur, Xo, Bi = Z(() => {
  cs(), It(), an(), Lr = "ort-wasm-proxy-worker", Ur = globalThis.self?.name === Lr, Ur && (self.onmessage = (t) => {
    let { type: e, in: n } = t.data;
    try {
      switch (e) {
        case "init-wasm":
          cn(n.wasm).then(() => {
            hn(n).then(() => {
              postMessage({ type: e });
            }, (a) => {
              postMessage({ type: e, err: a });
            });
          }, (a) => {
            postMessage({ type: e, err: a });
          });
          break;
        case "init-ep": {
          let { epName: a, env: o } = n;
          pn(o, a).then(() => {
            postMessage({ type: e });
          }, (i) => {
            postMessage({ type: e, err: i });
          });
          break;
        }
        case "copy-from": {
          let { buffer: a } = n, o = mr(a);
          postMessage({ type: e, out: o });
          break;
        }
        case "create": {
          let { model: a, options: o } = n;
          mn(a, o).then((i) => {
            postMessage({ type: e, out: i });
          }, (i) => {
            postMessage({ type: e, err: i });
          });
          break;
        }
        case "release":
          wn(n), postMessage({ type: e });
          break;
        case "run": {
          let { sessionId: a, inputIndices: o, inputs: i, outputIndices: c, options: d } = n;
          gn(a, o, i, c, new Array(c.length).fill(null), d).then((f) => {
            f.some((p) => p[3] !== "cpu") ? postMessage({ type: e, err: "Proxy does not support non-cpu tensor location." }) : postMessage({ type: e, out: f }, yn([...i, ...f]));
          }, (f) => {
            postMessage({ type: e, err: f });
          });
          break;
        }
        case "end-profiling":
          bn(n), postMessage({ type: e });
          break;
        default:
      }
    } catch (a) {
      postMessage({ type: e, err: a });
    }
  }), Xo = Ur ? null : (t) => new Worker(t ?? Se, { type: "module", name: Lr });
}), Qo = {};
wr(Qo, { default: () => Zo });
async function io(t = {}) {
  var e = t, n = !!globalThis.window, a = !!globalThis.WorkerGlobalScope, o = a && self.name?.startsWith("em-pthread");
  e.mountExternalData = (r, s) => {
    r.startsWith("./") && (r = r.substring(2)), (e.Sb || (e.Sb = /* @__PURE__ */ new Map())).set(r, s);
  }, e.unmountExternalData = () => {
    delete e.Sb;
  }, globalThis.SharedArrayBuffer ?? new WebAssembly.Memory({ initial: 0, maximum: 0, kc: !0 }).buffer.constructor;
  var i, c, d = (r, s) => {
    throw s;
  }, f = import.meta.url, p = "";
  if (n || a) {
    try {
      p = new URL(".", f).href;
    } catch {
    }
    a && (c = (r) => {
      var s = new XMLHttpRequest();
      return s.open("GET", r, !1), s.responseType = "arraybuffer", s.send(null), new Uint8Array(s.response);
    }), i = async (r) => {
      if (C(r)) return new Promise((u, l) => {
        var h = new XMLHttpRequest();
        h.open("GET", r, !0), h.responseType = "arraybuffer", h.onload = () => {
          h.status == 200 || h.status == 0 && h.response ? u(h.response) : l(h.status);
        }, h.onerror = l, h.send(null);
      });
      var s = await fetch(r, { credentials: "same-origin" });
      if (s.ok) return s.arrayBuffer();
      throw Error(s.status + " : " + s.url);
    };
  }
  var m, w, b, _, v, S, P = (() => {
  }).bind(console), x = (() => {
  }).bind(console), k = P, A = x, R = !1, C = (r) => r.startsWith("file://");
  function y() {
    Pe.buffer != L.buffer && fe();
  }
  if (o) {
    let r = function(s) {
      try {
        var u = s.data, l = u.Qb;
        if (l === "load") {
          let h = [];
          self.onmessage = (g) => h.push(g), S = () => {
            postMessage({ Qb: "loaded" });
            for (let g of h) r(g);
            self.onmessage = r;
          };
          for (let g of u.$b) e[g] && !e[g].proxy || (e[g] = (...T) => {
            postMessage({ Qb: "callHandler", Zb: g, args: T });
          }, g == "print" && (k = e[g]), g == "printErr" && (A = e[g]));
          Pe = u.ec, fe(), w = u.fc, te(), or();
        } else if (l === "run") {
          (function(h) {
            var g = (y(), U)[h + 52 >>> 2 >>> 0];
            h = (y(), U)[h + 56 >>> 2 >>> 0], Wn(g, g - h), $(g);
          })(u.Pb), Ar(u.Pb, 0, 0, 1, 0, 0), Te(), Wt(u.Pb), V ||= !0;
          try {
            qe(u.cc, u.Ub);
          } catch (h) {
            if (h != "unwind") throw h;
          }
        } else u.target !== "setimmediate" && (l === "checkMailbox" ? V && Mt() : l && (A(`worker: received unknown command ${l}`), A(u)));
      } catch (h) {
        throw Un(), h;
      }
    };
    var V = !1;
    self.onunhandledrejection = (s) => {
      throw s.reason || s;
    }, self.onmessage = r;
  }
  var L, Q, oe, M, U, le, E, I, pe, he = !1;
  function fe() {
    var r = Pe.buffer;
    e.HEAP8 = L = new Int8Array(r), oe = new Int16Array(r), e.HEAPU8 = Q = new Uint8Array(r), e.HEAP32 = M = new Int32Array(r), e.HEAPU32 = U = new Uint32Array(r), le = new Float32Array(r), E = new Float64Array(r), I = new BigInt64Array(r), new BigUint64Array(r);
  }
  function H() {
    he = !0, o ? S() : ot.Ua();
  }
  function se(r) {
    throw A(r = "Aborted(" + r + ")"), R = !0, r = new WebAssembly.RuntimeError(r + ". Build with -sASSERTIONS for more info."), v?.(r), r;
  }
  function ye() {
    return { a: { S: Gs, f: Lt, w: $e, e: F, j: X, g: de, T: N, b: me, G: Ie, ua: G, k: ke, K: Je, Ka: Ut, qa: we, sa: Me, La: We, Ia: je, Ba: et, Ha: tt, Z: rt, ra: nt, oa: Nt, Ja: Ae, pa: Dt, Qa: $t, Ea: ft, ma: br, va: yr, ja: Ts, U: ks, Da: Wt, Na: As, ya: Es, za: Ss, Aa: xs, wa: kn, xa: An, ka: En, Sa: Fs, Pa: Os, W: Cs, V: Is, Oa: Ps, F: Rs, Ma: Ls, na: Us, u: Ms, H: Ns, R: rr, la: $s, da: Ds, Ta: Bs, Fa: Mn, Ga: Fn, ta: ct, L: Pn, Y: On, Ca: Cn, X: In, $: xa, M: _a, aa: Sa, N: ya, v: ua, c: Ks, m: Hs, n: Vs, r: oa, ea: wa, x: ia, o: Qs, O: ga, D: va, I: ma, ba: Ea, ca: Aa, Q: fa, P: pa, fa: da, z: ca, E: ba, d: Xs, q: Zs, i: qs, _: Ma, l: Js, p: ea, s: Ys, t: ta, y: sa, ga: la, B: Ta, J: aa, C: ka, ha: na, ia: ra, A: ha, h: js, a: Pe, Ra: Ve } };
  }
  async function te() {
    function r(l, h) {
      return ot = l.exports, ot = (function() {
        var g = ot, T = (z) => () => z() >>> 0, O = (z) => (q) => z(q) >>> 0;
        return (g = Object.assign({}, g)).tb = T(g.tb), g.vb = O(g.vb), g.Jb = O(g.Jb), g.Kb = T(g.Kb), g.Ob = O(g.Ob), g;
      })(), St.push(ot.wb), l = ot, e._OrtInit = l.Va, e._OrtGetLastError = l.Wa, e._OrtCreateSessionOptions = l.Xa, e._OrtAppendExecutionProvider = l.Ya, e._OrtAddFreeDimensionOverride = l.Za, e._OrtAddSessionConfigEntry = l._a, e._OrtReleaseSessionOptions = l.$a, e._OrtCreateSession = l.ab, e._OrtReleaseSession = l.bb, e._OrtGetInputOutputCount = l.cb, e._OrtGetInputOutputMetadata = l.db, e._OrtFree = l.eb, e._OrtCreateTensor = l.fb, e._OrtGetTensorData = l.gb, e._OrtReleaseTensor = l.hb, e._OrtCreateRunOptions = l.ib, e._OrtAddRunConfigEntry = l.jb, e._OrtReleaseRunOptions = l.kb, e._OrtCreateBinding = l.lb, e._OrtBindInput = l.mb, e._OrtBindOutput = l.nb, e._OrtClearBoundOutputs = l.ob, e._OrtReleaseBinding = l.pb, e._OrtRunWithBinding = l.qb, e._OrtRun = l.rb, e._OrtEndProfiling = l.sb, nr = l.tb, Rn = e._free = l.ub, Ln = e._malloc = l.vb, Ar = l.yb, Un = l.zb, Nn = l.Ab, Dn = l.Bb, Er = l.Cb, $n = l.Db, Bn = l.Eb, j = l.Fb, Gt = l.Gb, Wn = l.Hb, $ = l.Ib, Sr = l.Jb, W = l.Kb, jn = l.Lb, xr = l.Mb, zn = l.Nb, Gn = l.Ob, Vn = l.xb, w = h, ot;
    }
    var s, u = ye();
    return e.instantiateWasm ? new Promise((l) => {
      e.instantiateWasm(u, (h, g) => {
        l(r(h, g));
      });
    }) : o ? r(new WebAssembly.Instance(w, ye()), w) : (pe ??= e.locateFile ? e.locateFile ? e.locateFile("ort-wasm-simd-threaded.wasm", p) : p + "ort-wasm-simd-threaded.wasm" : new URL("ort-wasm-simd-threaded.wasm", import.meta.url).href, s = await (async function(l) {
      var h = pe;
      if (!m && !C(h)) try {
        var g = fetch(h, { credentials: "same-origin" });
        return await WebAssembly.instantiateStreaming(g, l);
      } catch (T) {
        A(`wasm streaming compile failed: ${T}`), A("falling back to ArrayBuffer instantiation");
      }
      return (async function(T, O) {
        try {
          var z = await (async function(q) {
            if (!m) try {
              var ve = await i(q);
              return new Uint8Array(ve);
            } catch {
            }
            if (q == pe && m) q = new Uint8Array(m);
            else {
              if (!c) throw "both async and sync fetching of the wasm failed";
              q = c(q);
            }
            return q;
          })(T);
          return await WebAssembly.instantiate(z, O);
        } catch (q) {
          A(`failed to asynchronously prepare wasm: ${q}`), se(q);
        }
      })(h, l);
    })(u), r(s.instance, s.module));
  }
  class ae {
    name = "ExitStatus";
    constructor(s) {
      this.message = `Program terminated with exit(${s})`, this.status = s;
    }
  }
  var ie = (r) => {
    r.terminate(), r.onmessage = () => {
    };
  }, Y = [], re = 0, _e = null, J = (r) => {
    Ee.length == 0 && (Yt(), lt(Ee[0]));
    var s = Ee.pop();
    if (!s) return 6;
    He.push(s), ge[r.Pb] = s, s.Pb = r.Pb;
    var u = { Qb: "run", cc: r.bc, Ub: r.Ub, Pb: r.Pb };
    return s.postMessage(u, r.Yb), 0;
  }, K = 0, B = (r, s, ...u) => {
    var l, h = 16 * u.length, g = W(), T = Sr(h), O = T >>> 3;
    for (l of u) typeof l == "bigint" ? ((y(), I)[O++ >>> 0] = 1n, (y(), I)[O++ >>> 0] = l) : ((y(), I)[O++ >>> 0] = 0n, (y(), E)[O++ >>> 0] = l);
    return r = Nn(r, 0, h, T, s), $(g), r;
  };
  function Ve(r) {
    if (o) return B(0, 1, r);
    if (b = r, !(0 < K)) {
      for (var s of He) ie(s);
      for (s of Ee) ie(s);
      Ee = [], He = [], ge = {}, R = !0;
    }
    d(0, new ae(r));
  }
  function Qe(r) {
    if (o) return B(1, 0, r);
    ct(r);
  }
  var ct = (r) => {
    if (b = r, o) throw Qe(r), "unwind";
    Ve(r);
  }, Ee = [], He = [], St = [], ge = {}, Ne = (r) => {
    var s = r.Pb;
    delete ge[s], Ee.push(r), He.splice(He.indexOf(r), 1), r.Pb = 0, Dn(s);
  };
  function Te() {
    St.forEach((r) => r());
  }
  var lt = (r) => new Promise((s) => {
    r.onmessage = (h) => {
      var g = h.data;
      if (h = g.Qb, g.Tb && g.Tb != nr()) {
        var T = ge[g.Tb];
        T ? T.postMessage(g, g.Yb) : A(`Internal error! Worker sent a message "${h}" to target pthread ${g.Tb}, but that thread no longer exists!`);
      } else h === "checkMailbox" ? Mt() : h === "spawnThread" ? J(g) : h === "cleanupThread" ? Bt(() => {
        Ne(ge[g.dc]);
      }) : h === "loaded" ? (r.loaded = !0, s(r)) : g.target === "setimmediate" ? r.postMessage(g) : h === "uncaughtException" ? r.onerror(g.error) : h === "callHandler" ? e[g.Zb](...g.args) : h && A(`worker sent an unknown command ${h}`);
    }, r.onerror = (h) => {
      throw A(`worker sent an error! ${h.filename}:${h.lineno}: ${h.message}`), h;
    };
    var u, l = [];
    for (u of []) e.propertyIsEnumerable(u) && l.push(u);
    r.postMessage({ Qb: "load", $b: l, ec: Pe, fc: w });
  });
  function Yt() {
    var r = new Worker((() => {
      let s = URL;
      return import.meta.url > "file:" && import.meta.url < "file;" ? new s("ort.wasm.bundle.min.mjs", import.meta.url) : new URL(import.meta.url);
    })(), { type: "module", workerData: "em-pthread", name: "em-pthread" });
    Ee.push(r);
  }
  var Pe, Rt = [], D = (r) => {
    var s = Rt[r];
    return s || (Rt[r] = s = Vn.get(r)), s;
  }, qe = (r, s) => {
    K = 0, r = D(r)(s), 0 < K ? b = r : Er(r);
  }, De = [], Oe = 0;
  function Lt(r) {
    var s = new Ze(r >>>= 0);
    return (y(), L)[s.Rb + 12 >>> 0] == 0 && (Jt(s, !0), Oe--), er(s, !1), De.push(s), Gn(r);
  }
  var Ce = 0, $e = () => {
    j(0, 0);
    var r = De.pop();
    jn(r.Vb), Ce = 0;
  };
  function Jt(r, s) {
    s = s ? 1 : 0, (y(), L)[r.Rb + 12 >>> 0] = s;
  }
  function er(r, s) {
    s = s ? 1 : 0, (y(), L)[r.Rb + 13 >>> 0] = s;
  }
  class Ze {
    constructor(s) {
      this.Vb = s, this.Rb = s - 24;
    }
  }
  var Be = (r) => {
    var s = Ce;
    if (!s) return Gt(0), 0;
    var u = new Ze(s);
    (y(), U)[u.Rb + 16 >>> 2 >>> 0] = s;
    var l = (y(), U)[u.Rb + 4 >>> 2 >>> 0];
    if (!l) return Gt(0), s;
    for (var h of r) {
      if (h === 0 || h === l) break;
      if (zn(h, l, u.Rb + 16)) return Gt(h), s;
    }
    return Gt(l), s;
  };
  function F() {
    return Be([]);
  }
  function X(r) {
    return Be([r >>> 0]);
  }
  function de(r, s, u, l) {
    return Be([r >>> 0, s >>> 0, u >>> 0, l >>> 0]);
  }
  var N = () => {
    var r = De.pop();
    r || se("no exception to throw");
    var s = r.Vb;
    throw (y(), L)[r.Rb + 13 >>> 0] == 0 && (De.push(r), er(r, !0), Jt(r, !1), Oe++), xr(s), Ce = s;
  };
  function me(r, s, u) {
    var l = new Ze(r >>>= 0);
    throw s >>>= 0, u >>>= 0, (y(), U)[l.Rb + 16 >>> 2 >>> 0] = 0, (y(), U)[l.Rb + 4 >>> 2 >>> 0] = s, (y(), U)[l.Rb + 8 >>> 2 >>> 0] = u, xr(r), Oe++, Ce = r;
  }
  var Ie = () => Oe;
  function Ye(r, s, u, l) {
    return o ? B(2, 1, r, s, u, l) : G(r, s, u, l);
  }
  function G(r, s, u, l) {
    if (r >>>= 0, s >>>= 0, u >>>= 0, l >>>= 0, !globalThis.SharedArrayBuffer) return 6;
    var h = [];
    return o && h.length === 0 ? Ye(r, s, u, l) : (r = { bc: u, Pb: r, Ub: l, Yb: h }, o ? (r.Qb = "spawnThread", postMessage(r, h), 0) : J(r));
  }
  function ke(r) {
    throw Ce ||= r >>> 0, Ce;
  }
  var ut = globalThis.TextDecoder && new TextDecoder(), ee = (r, s = 0, u, l) => {
    var h = s >>>= 0;
    if (u = h + u, l) l = u;
    else {
      for (; r[h] && !(h >= u); ) ++h;
      l = h;
    }
    if (16 < l - s && r.buffer && ut) return ut.decode(r.buffer instanceof ArrayBuffer ? r.subarray(s, l) : r.slice(s, l));
    for (h = ""; s < l; ) if (128 & (u = r[s++])) {
      var g = 63 & r[s++];
      if ((224 & u) == 192) h += String.fromCharCode((31 & u) << 6 | g);
      else {
        var T = 63 & r[s++];
        65536 > (u = (240 & u) == 224 ? (15 & u) << 12 | g << 6 | T : (7 & u) << 18 | g << 12 | T << 6 | 63 & r[s++]) ? h += String.fromCharCode(u) : (u -= 65536, h += String.fromCharCode(55296 | u >> 10, 56320 | 1023 & u));
      }
    } else h += String.fromCharCode(u);
    return h;
  }, xt = (r, s, u) => (r >>>= 0) ? ee((y(), Q), r, s, u) : "";
  function Je(r, s, u) {
    return o ? B(3, 1, r, s, u) : 0;
  }
  function Ut(r, s) {
    if (o) return B(4, 1, r, s);
  }
  function we(r, s) {
    if (o) return B(5, 1, r, s);
  }
  function Me(r, s, u) {
    if (o) return B(6, 1, r, s, u);
  }
  function We(r, s, u) {
    return o ? B(7, 1, r, s, u) : 0;
  }
  function je(r, s) {
    if (o) return B(8, 1, r, s);
  }
  function et(r, s, u) {
    if (o) return B(9, 1, r, s, u);
  }
  function tt(r, s, u, l) {
    if (o) return B(10, 1, r, s, u, l);
  }
  function rt(r, s, u, l) {
    if (o) return B(11, 1, r, s, u, l);
  }
  function nt(r, s, u, l) {
    if (o) return B(12, 1, r, s, u, l);
  }
  function Nt(r) {
    if (o) return B(13, 1, r);
  }
  function Ae(r, s) {
    if (o) return B(14, 1, r, s);
  }
  function Dt(r, s, u) {
    if (o) return B(15, 1, r, s, u);
  }
  var $t = () => se("");
  function ft(r) {
    Ar(r >>> 0, !a, 1, !n, 131072, !1), Te();
  }
  var Bt = (r) => {
    if (!R) try {
      if (r(), !(0 < K)) try {
        o ? nr() && Er(b) : ct(b);
      } catch (s) {
        s instanceof ae || s == "unwind" || d(0, s);
      }
    } catch (s) {
      s instanceof ae || s == "unwind" || d(0, s);
    }
  }, gr = !Atomics.waitAsync || globalThis.navigator?.userAgent && 91 > Number((navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./) || [])[2]);
  function Wt(r) {
    r >>>= 0, gr || (Atomics.waitAsync((y(), M), r >>> 2, r).value.then(Mt), r += 128, Atomics.store((y(), M), r >>> 2, 1));
  }
  var Mt = () => Bt(() => {
    var r = nr();
    r && (Wt(r), Bn());
  });
  function br(r, s) {
    (r >>>= 0) == s >>> 0 ? setTimeout(Mt) : o ? postMessage({ Tb: r, Qb: "checkMailbox" }) : (r = ge[r]) && r.postMessage({ Qb: "checkMailbox" });
  }
  var jt = [];
  function yr(r, s, u, l, h) {
    for (s >>>= 0, h >>>= 0, jt.length = 0, u = h >>> 3, l = h + l >>> 3; u < l; ) {
      var g;
      g = (y(), I)[u++ >>> 0] ? (y(), I)[u++ >>> 0] : (y(), E)[u++ >>> 0], jt.push(g);
    }
    return (s ? Hn[s] : zs[r])(...jt);
  }
  var Ts = () => {
    K = 0;
  };
  function ks(r) {
    r >>>= 0, o ? postMessage({ Qb: "cleanupThread", dc: r }) : Ne(ge[r]);
  }
  function As(r) {
  }
  function Es(r, s) {
    r = -9007199254740992 > r || 9007199254740992 < r ? NaN : Number(r), s >>>= 0, r = new Date(1e3 * r), (y(), M)[s >>> 2 >>> 0] = r.getUTCSeconds(), (y(), M)[s + 4 >>> 2 >>> 0] = r.getUTCMinutes(), (y(), M)[s + 8 >>> 2 >>> 0] = r.getUTCHours(), (y(), M)[s + 12 >>> 2 >>> 0] = r.getUTCDate(), (y(), M)[s + 16 >>> 2 >>> 0] = r.getUTCMonth(), (y(), M)[s + 20 >>> 2 >>> 0] = r.getUTCFullYear() - 1900, (y(), M)[s + 24 >>> 2 >>> 0] = r.getUTCDay(), r = (r.getTime() - Date.UTC(r.getUTCFullYear(), 0, 1, 0, 0, 0, 0)) / 864e5 | 0, (y(), M)[s + 28 >>> 2 >>> 0] = r;
  }
  var _n = (r) => r % 4 == 0 && (r % 100 != 0 || r % 400 == 0), vn = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], Tn = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  function Ss(r, s) {
    r = -9007199254740992 > r || 9007199254740992 < r ? NaN : Number(r), s >>>= 0, r = new Date(1e3 * r), (y(), M)[s >>> 2 >>> 0] = r.getSeconds(), (y(), M)[s + 4 >>> 2 >>> 0] = r.getMinutes(), (y(), M)[s + 8 >>> 2 >>> 0] = r.getHours(), (y(), M)[s + 12 >>> 2 >>> 0] = r.getDate(), (y(), M)[s + 16 >>> 2 >>> 0] = r.getMonth(), (y(), M)[s + 20 >>> 2 >>> 0] = r.getFullYear() - 1900, (y(), M)[s + 24 >>> 2 >>> 0] = r.getDay();
    var u = (_n(r.getFullYear()) ? vn : Tn)[r.getMonth()] + r.getDate() - 1 | 0;
    (y(), M)[s + 28 >>> 2 >>> 0] = u, (y(), M)[s + 36 >>> 2 >>> 0] = -60 * r.getTimezoneOffset(), u = new Date(r.getFullYear(), 6, 1).getTimezoneOffset();
    var l = new Date(r.getFullYear(), 0, 1).getTimezoneOffset();
    r = 0 | (u != l && r.getTimezoneOffset() == Math.min(l, u)), (y(), M)[s + 32 >>> 2 >>> 0] = r;
  }
  function xs(r) {
    r >>>= 0;
    var s = new Date((y(), M)[r + 20 >>> 2 >>> 0] + 1900, (y(), M)[r + 16 >>> 2 >>> 0], (y(), M)[r + 12 >>> 2 >>> 0], (y(), M)[r + 8 >>> 2 >>> 0], (y(), M)[r + 4 >>> 2 >>> 0], (y(), M)[r >>> 2 >>> 0], 0), u = (y(), M)[r + 32 >>> 2 >>> 0], l = s.getTimezoneOffset(), h = new Date(s.getFullYear(), 6, 1).getTimezoneOffset(), g = new Date(s.getFullYear(), 0, 1).getTimezoneOffset(), T = Math.min(g, h);
    return 0 > u ? (y(), M)[r + 32 >>> 2 >>> 0] = +(h != g && T == l) : 0 < u != (T == l) && (h = Math.max(g, h), s.setTime(s.getTime() + 6e4 * ((0 < u ? T : h) - l))), (y(), M)[r + 24 >>> 2 >>> 0] = s.getDay(), u = (_n(s.getFullYear()) ? vn : Tn)[s.getMonth()] + s.getDate() - 1 | 0, (y(), M)[r + 28 >>> 2 >>> 0] = u, (y(), M)[r >>> 2 >>> 0] = s.getSeconds(), (y(), M)[r + 4 >>> 2 >>> 0] = s.getMinutes(), (y(), M)[r + 8 >>> 2 >>> 0] = s.getHours(), (y(), M)[r + 12 >>> 2 >>> 0] = s.getDate(), (y(), M)[r + 16 >>> 2 >>> 0] = s.getMonth(), (y(), M)[r + 20 >>> 2 >>> 0] = s.getYear(), r = s.getTime(), BigInt(isNaN(r) ? -1 : r / 1e3);
  }
  function kn(r, s, u, l, h, g, T) {
    return o ? B(16, 1, r, s, u, l, h, g, T) : -52;
  }
  function An(r, s, u, l, h, g) {
    if (o) return B(17, 1, r, s, u, l, h, g);
  }
  var zt = {}, Ms = () => performance.timeOrigin + performance.now();
  function En(r, s) {
    if (o) return B(18, 1, r, s);
    if (zt[r] && (clearTimeout(zt[r].id), delete zt[r]), !s) return 0;
    var u = setTimeout(() => {
      delete zt[r], Bt(() => $n(r, performance.timeOrigin + performance.now()));
    }, s);
    return zt[r] = { id: u, lc: s }, 0;
  }
  var dt = (r, s, u) => {
    var l = (y(), Q);
    if (s >>>= 0, 0 < u) {
      var h = s;
      u = s + u - 1;
      for (var g = 0; g < r.length; ++g) {
        var T = r.codePointAt(g);
        if (127 >= T) {
          if (s >= u) break;
          l[s++ >>> 0] = T;
        } else if (2047 >= T) {
          if (s + 1 >= u) break;
          l[s++ >>> 0] = 192 | T >> 6, l[s++ >>> 0] = 128 | 63 & T;
        } else if (65535 >= T) {
          if (s + 2 >= u) break;
          l[s++ >>> 0] = 224 | T >> 12, l[s++ >>> 0] = 128 | T >> 6 & 63, l[s++ >>> 0] = 128 | 63 & T;
        } else {
          if (s + 3 >= u) break;
          l[s++ >>> 0] = 240 | T >> 18, l[s++ >>> 0] = 128 | T >> 12 & 63, l[s++ >>> 0] = 128 | T >> 6 & 63, l[s++ >>> 0] = 128 | 63 & T, g++;
        }
      }
      l[s >>> 0] = 0, r = s - h;
    } else r = 0;
    return r;
  };
  function Fs(r, s, u, l) {
    r >>>= 0, s >>>= 0, u >>>= 0, l >>>= 0;
    var h = (/* @__PURE__ */ new Date()).getFullYear(), g = new Date(h, 0, 1).getTimezoneOffset();
    h = new Date(h, 6, 1).getTimezoneOffset();
    var T = Math.max(g, h);
    (y(), U)[r >>> 2 >>> 0] = 60 * T, (y(), M)[s >>> 2 >>> 0] = +(g != h), r = (s = (O) => {
      var z = Math.abs(O);
      return `UTC${0 <= O ? "-" : "+"}${String(Math.floor(z / 60)).padStart(2, "0")}${String(z % 60).padStart(2, "0")}`;
    })(g), s = s(h), h < g ? (dt(r, u, 17), dt(s, l, 17)) : (dt(r, l, 17), dt(s, u, 17));
  }
  var Ps = () => Date.now();
  function Os(r, s, u) {
    return u >>>= 0, 0 <= r && 3 >= r ? (r === 0 ? r = Date.now() : r = performance.timeOrigin + performance.now(), r = Math.round(1e6 * r), (y(), I)[u >>> 3 >>> 0] = BigInt(r), 0) : 28;
  }
  var _r = [];
  function Cs(r, s, u) {
    r >>>= 0, s >>>= 0, u >>>= 0, _r.length = 0;
    for (var l; l = (y(), Q)[s++ >>> 0]; ) {
      var h = l != 105;
      u += (h &= l != 112) && u % 8 ? 4 : 0, _r.push(l == 112 ? (y(), U)[u >>> 2 >>> 0] : l == 106 ? (y(), I)[u >>> 3 >>> 0] : l == 105 ? (y(), M)[u >>> 2 >>> 0] : (y(), E)[u >>> 3 >>> 0]), u += h ? 8 : 4;
    }
    return Hn[r](..._r);
  }
  var Is = () => {
  };
  function Rs(r, s) {
    return A(xt(r >>> 0, s >>> 0));
  }
  var Ls = () => {
    throw K += 1, "unwind";
  };
  function Us() {
    return 4294901760;
  }
  var Ns = () => navigator.hardwareConcurrency, ht = {}, vr = (r) => {
    for (var s = 0, u = 0; u < r.length; ++u) {
      var l = r.charCodeAt(u);
      127 >= l ? s++ : 2047 >= l ? s += 2 : 55296 <= l && 57343 >= l ? (s += 4, ++u) : s += 3;
    }
    return s;
  }, tr = (r) => {
    var s;
    return (s = /\bwasm-function\[\d+\]:(0x[0-9a-f]+)/.exec(r)) ? +s[1] : (s = /:(\d+):\d+(?:\)|$)/.exec(r)) ? 2147483648 | +s[1] : 0;
  }, Sn = (r) => {
    for (var s of r) (r = tr(s)) && (ht[r] = s);
  };
  function Ds() {
    var r = Error().stack.toString().split(`
`);
    return r[0] == "Error" && r.shift(), Sn(r), ht.Wb = tr(r[3]), ht.ac = r, ht.Wb;
  }
  function rr(r) {
    if (!(r = ht[r >>> 0])) return 0;
    var s;
    if (s = /^\s+at .*\.wasm\.(.*) \(.*\)$/.exec(r)) r = s[1];
    else if (s = /^\s+at (.*) \(.*\)$/.exec(r)) r = s[1];
    else {
      if (!(s = /^(.+?)@/.exec(r))) return 0;
      r = s[1];
    }
    Rn(rr.Xb ?? 0), s = vr(r) + 1;
    var u = Ln(s);
    return u && dt(r, u, s), rr.Xb = u, rr.Xb;
  }
  function $s(r) {
    r >>>= 0;
    var s = (y(), Q).length;
    if (r <= s || 4294901760 < r) return !1;
    for (var u = 1; 4 >= u; u *= 2) {
      var l = s * (1 + 0.2 / u);
      l = Math.min(l, r + 100663296);
      e: {
        l = (Math.min(4294901760, 65536 * Math.ceil(Math.max(r, l) / 65536)) - Pe.buffer.byteLength + 65535) / 65536 | 0;
        try {
          Pe.grow(l), fe();
          var h = 1;
          break e;
        } catch {
        }
        h = void 0;
      }
      if (h) return !0;
    }
    return !1;
  }
  function Bs(r, s, u) {
    if (r >>>= 0, s >>>= 0, ht.Wb == r) var l = ht.ac;
    else (l = Error().stack.toString().split(`
`))[0] == "Error" && l.shift(), Sn(l);
    for (var h = 3; l[h] && tr(l[h]) != r; ) ++h;
    for (r = 0; r < u && l[r + h]; ++r) (y(), M)[s + 4 * r >>> 2 >>> 0] = tr(l[r + h]);
    return r;
  }
  var Tr, kr = {}, xn = () => {
    if (!Tr) {
      var r, s = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: (globalThis.navigator?.language ?? "C").replace("-", "_") + ".UTF-8", _: "./this.program" };
      for (r in kr) kr[r] === void 0 ? delete s[r] : s[r] = kr[r];
      var u = [];
      for (r in s) u.push(`${r}=${s[r]}`);
      Tr = u;
    }
    return Tr;
  };
  function Mn(r, s) {
    if (o) return B(19, 1, r, s);
    r >>>= 0, s >>>= 0;
    var u, l = 0, h = 0;
    for (u of xn()) {
      var g = s + l;
      (y(), U)[r + h >>> 2 >>> 0] = g, l += dt(u, g, 1 / 0) + 1, h += 4;
    }
    return 0;
  }
  function Fn(r, s) {
    if (o) return B(20, 1, r, s);
    r >>>= 0, s >>>= 0;
    var u = xn();
    for (var l of ((y(), U)[r >>> 2 >>> 0] = u.length, r = 0, u)) r += vr(l) + 1;
    return (y(), U)[s >>> 2 >>> 0] = r, 0;
  }
  function Pn(r) {
    return o ? B(21, 1, r) : 52;
  }
  function On(r, s, u, l) {
    return o ? B(22, 1, r, s, u, l) : 52;
  }
  function Cn(r, s, u, l) {
    return o ? B(23, 1, r, s, u, l) : 70;
  }
  var Ws = [null, [], []];
  function In(r, s, u, l) {
    if (o) return B(24, 1, r, s, u, l);
    s >>>= 0, u >>>= 0, l >>>= 0;
    for (var h = 0, g = 0; g < u; g++) {
      var T = (y(), U)[s >>> 2 >>> 0], O = (y(), U)[s + 4 >>> 2 >>> 0];
      s += 8;
      for (var z = 0; z < O; z++) {
        var q = r, ve = (y(), Q)[T + z >>> 0], Re = Ws[q];
        ve === 0 || ve === 10 ? ((q === 1 ? k : A)(ee(Re)), Re.length = 0) : Re.push(ve);
      }
      h += O;
    }
    return (y(), U)[l >>> 2 >>> 0] = h, 0;
  }
  function js(r) {
    return r >>> 0;
  }
  o || (function() {
    for (var r = e.numThreads - 1; r--; ) Yt();
    Y.push(async () => {
      var s = (async function() {
        if (!o) return Promise.all(Ee.map(lt));
      })();
      re++, await s, --re == 0 && _e && (s = _e, _e = null, s());
    });
  })(), o || (Pe = new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: !0 }), fe()), e.wasmBinary && (m = e.wasmBinary), e.stackSave = () => W(), e.stackRestore = (r) => $(r), e.stackAlloc = (r) => Sr(r), e.setValue = function(r, s, u = "i8") {
    switch (u.endsWith("*") && (u = "*"), u) {
      case "i1":
      case "i8":
        (y(), L)[r >>> 0] = s;
        break;
      case "i16":
        (y(), oe)[r >>> 1 >>> 0] = s;
        break;
      case "i32":
        (y(), M)[r >>> 2 >>> 0] = s;
        break;
      case "i64":
        (y(), I)[r >>> 3 >>> 0] = BigInt(s);
        break;
      case "float":
        (y(), le)[r >>> 2 >>> 0] = s;
        break;
      case "double":
        (y(), E)[r >>> 3 >>> 0] = s;
        break;
      case "*":
        (y(), U)[r >>> 2 >>> 0] = s;
        break;
      default:
        se(`invalid type for setValue: ${u}`);
    }
  }, e.getValue = function(r, s = "i8") {
    switch (s.endsWith("*") && (s = "*"), s) {
      case "i1":
      case "i8":
        return (y(), L)[r >>> 0];
      case "i16":
        return (y(), oe)[r >>> 1 >>> 0];
      case "i32":
        return (y(), M)[r >>> 2 >>> 0];
      case "i64":
        return (y(), I)[r >>> 3 >>> 0];
      case "float":
        return (y(), le)[r >>> 2 >>> 0];
      case "double":
        return (y(), E)[r >>> 3 >>> 0];
      case "*":
        return (y(), U)[r >>> 2 >>> 0];
      default:
        se(`invalid type for getValue: ${s}`);
    }
  }, e.UTF8ToString = xt, e.stringToUTF8 = dt, e.lengthBytesUTF8 = vr;
  var nr, Rn, Ln, Ar, Un, Nn, Dn, Er, $n, Bn, j, Gt, Wn, $, Sr, W, jn, xr, zn, Gn, Vn, ot, zs = [Ve, Qe, Ye, Je, Ut, we, Me, We, je, et, tt, rt, nt, Nt, Ae, Dt, kn, An, En, Mn, Fn, Pn, On, Cn, In], Hn = { 885788: (r, s, u, l, h) => {
    if (e === void 0 || !e.Sb) return 1;
    if ((r = xt(Number(r >>> 0))).startsWith("./") && (r = r.substring(2)), !(r = e.Sb.get(r))) return 2;
    if (s = Number(s >>> 0), u = Number(u >>> 0), l = Number(l >>> 0), s + u > r.byteLength) return 3;
    try {
      let g = r.subarray(s, s + u);
      switch (h) {
        case 0:
          (y(), Q).set(g, l >>> 0);
          break;
        case 1:
          e.hc ? e.hc(l, g) : e.jc(l, g);
          break;
        default:
          return 4;
      }
      return 0;
    } catch {
      return 4;
    }
  }, 886612: () => typeof wasmOffsetConverter < "u" };
  function Gs() {
    return typeof wasmOffsetConverter < "u";
  }
  function Vs(r, s, u, l) {
    var h = W();
    try {
      return D(r)(s, u, l);
    } catch (g) {
      if ($(h), g !== g + 0) throw g;
      j(1, 0);
    }
  }
  function Hs(r, s, u) {
    var l = W();
    try {
      return D(r)(s, u);
    } catch (h) {
      if ($(l), h !== h + 0) throw h;
      j(1, 0);
    }
  }
  function qs(r, s, u) {
    var l = W();
    try {
      D(r)(s, u);
    } catch (h) {
      if ($(l), h !== h + 0) throw h;
      j(1, 0);
    }
  }
  function Ks(r, s) {
    var u = W();
    try {
      return D(r)(s);
    } catch (l) {
      if ($(u), l !== l + 0) throw l;
      j(1, 0);
    }
  }
  function Xs(r) {
    var s = W();
    try {
      D(r)();
    } catch (u) {
      if ($(s), u !== u + 0) throw u;
      j(1, 0);
    }
  }
  function Qs(r, s, u, l, h, g, T) {
    var O = W();
    try {
      return D(r)(s, u, l, h, g, T);
    } catch (z) {
      if ($(O), z !== z + 0) throw z;
      j(1, 0);
    }
  }
  function Zs(r, s) {
    var u = W();
    try {
      D(r)(s);
    } catch (l) {
      if ($(u), l !== l + 0) throw l;
      j(1, 0);
    }
  }
  function Ys(r, s, u, l, h, g) {
    var T = W();
    try {
      D(r)(s, u, l, h, g);
    } catch (O) {
      if ($(T), O !== O + 0) throw O;
      j(1, 0);
    }
  }
  function Js(r, s, u, l) {
    var h = W();
    try {
      D(r)(s, u, l);
    } catch (g) {
      if ($(h), g !== g + 0) throw g;
      j(1, 0);
    }
  }
  function ea(r, s, u, l, h) {
    var g = W();
    try {
      D(r)(s, u, l, h);
    } catch (T) {
      if ($(g), T !== T + 0) throw T;
      j(1, 0);
    }
  }
  function ta(r, s, u, l, h, g, T) {
    var O = W();
    try {
      D(r)(s, u, l, h, g, T);
    } catch (z) {
      if ($(O), z !== z + 0) throw z;
      j(1, 0);
    }
  }
  function ra(r, s, u, l, h, g, T) {
    var O = W();
    try {
      D(r)(s, u, l, h, g, T);
    } catch (z) {
      if ($(O), z !== z + 0) throw z;
      j(1, 0);
    }
  }
  function na(r, s, u, l, h, g, T, O) {
    var z = W();
    try {
      D(r)(s, u, l, h, g, T, O);
    } catch (q) {
      if ($(z), q !== q + 0) throw q;
      j(1, 0);
    }
  }
  function oa(r, s, u, l, h) {
    var g = W();
    try {
      return D(r)(s, u, l, h);
    } catch (T) {
      if ($(g), T !== T + 0) throw T;
      j(1, 0);
    }
  }
  function sa(r, s, u, l, h, g, T, O) {
    var z = W();
    try {
      D(r)(s, u, l, h, g, T, O);
    } catch (q) {
      if ($(z), q !== q + 0) throw q;
      j(1, 0);
    }
  }
  function aa(r, s, u, l, h, g, T, O, z, q, ve, Re) {
    var Ke = W();
    try {
      D(r)(s, u, l, h, g, T, O, z, q, ve, Re);
    } catch (Xe) {
      if ($(Ke), Xe !== Xe + 0) throw Xe;
      j(1, 0);
    }
  }
  function ia(r, s, u, l, h, g) {
    var T = W();
    try {
      return D(r)(s, u, l, h, g);
    } catch (O) {
      if ($(T), O !== O + 0) throw O;
      j(1, 0);
    }
  }
  function ca(r, s, u) {
    var l = W();
    try {
      return D(r)(s, u);
    } catch (h) {
      if ($(l), h !== h + 0) throw h;
      return j(1, 0), 0n;
    }
  }
  function la(r, s, u, l, h, g, T, O, z) {
    var q = W();
    try {
      D(r)(s, u, l, h, g, T, O, z);
    } catch (ve) {
      if ($(q), ve !== ve + 0) throw ve;
      j(1, 0);
    }
  }
  function ua(r) {
    var s = W();
    try {
      return D(r)();
    } catch (u) {
      if ($(s), u !== u + 0) throw u;
      j(1, 0);
    }
  }
  function fa(r, s, u) {
    var l = W();
    try {
      return D(r)(s, u);
    } catch (h) {
      if ($(l), h !== h + 0) throw h;
      j(1, 0);
    }
  }
  function da(r, s) {
    var u = W();
    try {
      return D(r)(s);
    } catch (l) {
      if ($(u), l !== l + 0) throw l;
      return j(1, 0), 0n;
    }
  }
  function ha(r, s, u, l, h) {
    var g = W();
    try {
      D(r)(s, u, l, h);
    } catch (T) {
      if ($(g), T !== T + 0) throw T;
      j(1, 0);
    }
  }
  function pa(r) {
    var s = W();
    try {
      return D(r)();
    } catch (u) {
      if ($(s), u !== u + 0) throw u;
      return j(1, 0), 0n;
    }
  }
  function ma(r, s, u, l, h, g) {
    var T = W();
    try {
      return D(r)(s, u, l, h, g);
    } catch (O) {
      if ($(T), O !== O + 0) throw O;
      j(1, 0);
    }
  }
  function wa(r, s, u, l, h, g) {
    var T = W();
    try {
      return D(r)(s, u, l, h, g);
    } catch (O) {
      if ($(T), O !== O + 0) throw O;
      j(1, 0);
    }
  }
  function ga(r, s, u, l, h, g, T, O) {
    var z = W();
    try {
      return D(r)(s, u, l, h, g, T, O);
    } catch (q) {
      if ($(z), q !== q + 0) throw q;
      j(1, 0);
    }
  }
  function ba(r, s, u, l, h) {
    var g = W();
    try {
      return D(r)(s, u, l, h);
    } catch (T) {
      if ($(g), T !== T + 0) throw T;
      return j(1, 0), 0n;
    }
  }
  function ya(r, s, u, l) {
    var h = W();
    try {
      return D(r)(s, u, l);
    } catch (g) {
      if ($(h), g !== g + 0) throw g;
      j(1, 0);
    }
  }
  function _a(r, s, u, l) {
    var h = W();
    try {
      return D(r)(s, u, l);
    } catch (g) {
      if ($(h), g !== g + 0) throw g;
      j(1, 0);
    }
  }
  function va(r, s, u, l, h, g, T, O, z, q, ve, Re) {
    var Ke = W();
    try {
      return D(r)(s, u, l, h, g, T, O, z, q, ve, Re);
    } catch (Xe) {
      if ($(Ke), Xe !== Xe + 0) throw Xe;
      j(1, 0);
    }
  }
  function Ta(r, s, u, l, h, g, T, O, z, q, ve) {
    var Re = W();
    try {
      D(r)(s, u, l, h, g, T, O, z, q, ve);
    } catch (Ke) {
      if ($(Re), Ke !== Ke + 0) throw Ke;
      j(1, 0);
    }
  }
  function ka(r, s, u, l, h, g, T, O, z, q, ve, Re, Ke, Xe, Fa, Pa) {
    var Oa = W();
    try {
      D(r)(s, u, l, h, g, T, O, z, q, ve, Re, Ke, Xe, Fa, Pa);
    } catch (Mr) {
      if ($(Oa), Mr !== Mr + 0) throw Mr;
      j(1, 0);
    }
  }
  function Aa(r, s, u, l) {
    var h = W();
    try {
      return D(r)(s, u, l);
    } catch (g) {
      if ($(h), g !== g + 0) throw g;
      j(1, 0);
    }
  }
  function Ea(r, s, u, l, h) {
    var g = W();
    try {
      return D(r)(s, u, l, h);
    } catch (T) {
      if ($(g), T !== T + 0) throw T;
      j(1, 0);
    }
  }
  function Sa(r, s, u) {
    var l = W();
    try {
      return D(r)(s, u);
    } catch (h) {
      if ($(l), h !== h + 0) throw h;
      j(1, 0);
    }
  }
  function xa(r, s, u) {
    var l = W();
    try {
      return D(r)(s, u);
    } catch (h) {
      if ($(l), h !== h + 0) throw h;
      j(1, 0);
    }
  }
  function Ma(r, s, u, l) {
    var h = W();
    try {
      D(r)(s, u, l);
    } catch (g) {
      if ($(h), g !== g + 0) throw g;
      j(1, 0);
    }
  }
  function or() {
    if (0 < re) _e = or;
    else if (o) _?.(e), H();
    else {
      for (var r = Y; 0 < r.length; ) r.shift()(e);
      0 < re ? _e = or : (e.calledRun = !0, R || (H(), _?.(e)));
    }
  }
  return o || (ot = await te(), or()), e.PTR_SIZE = 4, he ? e : new Promise((r, s) => {
    _ = r, v = s;
  });
}
var Zo, co, Wi = Z(() => {
  Zo = io, co = globalThis.self?.name?.startsWith("em-pthread"), co && io();
}), Nr, Qr, lo, Se, Yo, ir, uo, fo, Dr, ho, $r, Jo, Br, es, an = Z(() => {
  sn(), Nr = typeof location > "u" ? void 0 : location.origin, Qr = import.meta.url > "file:" && import.meta.url < "file;", lo = () => {
    {
      if (Qr) {
        let t = URL;
        return new URL(new t("ort.wasm.bundle.min.mjs", import.meta.url).href, Nr).href;
      }
      return import.meta.url;
    }
  }, Se = lo(), Yo = () => {
    if (Se && !Se.startsWith("blob:")) return Se.substring(0, Se.lastIndexOf("/") + 1);
  }, ir = (t, e) => {
    try {
      let n = e ?? Se;
      return (n ? new URL(t, n) : new URL(t)).origin === Nr;
    } catch {
      return !1;
    }
  }, uo = (t, e) => {
    let n = e ?? Se;
    try {
      return (n ? new URL(t, n) : new URL(t)).href;
    } catch {
      return;
    }
  }, fo = (t, e) => `${e ?? "./"}${t}`, Dr = async (t) => {
    let e = await (await fetch(t, { credentials: "same-origin" })).blob();
    return URL.createObjectURL(e);
  }, ho = async (t) => (await import(
    /*webpackIgnore:true*/
    /*@vite-ignore*/
    t
  )).default, $r = (Bi(), Xr(Ko)).default, Jo = async () => {
    if (!Se) throw new Error("Failed to load proxy worker: cannot determine the script source URL.");
    if (ir(Se)) return [void 0, $r()];
    let t = await Dr(Se);
    return [t, $r(t)];
  }, Br = (Wi(), Xr(Qo)).default, es = async (t, e, n, a) => {
    let o = Br && !(t || e);
    if (o) if (Se) o = ir(Se);
    else if (a && !n) o = !0;
    else throw new Error("cannot determine the script source URL.");
    if (o) return [void 0, Br];
    {
      let i = "ort-wasm-simd-threaded.mjs", c = t ?? uo(i, e), d = n && c && !ir(c, e), f = d ? await Dr(c) : c ?? fo(i, e);
      return [d ? f : void 0, await ho(f)];
    }
  };
}), Wr, cr, Ht, jr, po, mo, wo, cn, ce, It = Z(() => {
  an(), cr = !1, Ht = !1, jr = !1, po = () => {
    if (typeof SharedArrayBuffer > "u") return !1;
    try {
      return typeof MessageChannel < "u" && new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)), WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11]));
    } catch {
      return !1;
    }
  }, mo = () => {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11]));
    } catch {
      return !1;
    }
  }, wo = () => {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 19, 1, 17, 0, 65, 1, 253, 15, 65, 2, 253, 15, 65, 3, 253, 15, 253, 147, 2, 11]));
    } catch {
      return !1;
    }
  }, cn = async (t) => {
    if (cr) return Promise.resolve();
    if (Ht) throw new Error("multiple calls to 'initializeWebAssembly()' detected.");
    if (jr) throw new Error("previous call to 'initializeWebAssembly()' failed.");
    Ht = !0;
    let e = t.initTimeout, n = t.numThreads;
    if (t.simd !== !1) {
      if (t.simd === "relaxed") {
        if (!wo()) throw new Error("Relaxed WebAssembly SIMD is not supported in the current environment.");
      } else if (!mo()) throw new Error("WebAssembly SIMD is not supported in the current environment.");
    }
    let a = po();
    n > 1 && !a && (typeof self < "u" && self.crossOriginIsolated, t.numThreads = n = 1);
    let o = t.wasmPaths, i = typeof o == "string" ? o : void 0, c = o?.mjs, d = c?.href ?? c, f = o?.wasm, p = f?.href ?? f, m = t.wasmBinary, [w, b] = await es(d, i, n > 1, !!m || !!p), _ = !1, v = [];
    if (e > 0 && v.push(new Promise((S) => {
      setTimeout(() => {
        _ = !0, S();
      }, e);
    })), v.push(new Promise((S, P) => {
      let x = { numThreads: n };
      if (m) x.wasmBinary = m;
      else if (p || i) x.locateFile = (k) => p ?? i + k;
      else if (d && d.indexOf("blob:") !== 0) x.locateFile = (k) => new URL(k, d).href;
      else if (w) {
        let k = Yo();
        k && (x.locateFile = (A) => k + A);
      }
      b(x).then((k) => {
        Ht = !1, cr = !0, Wr = k, S(), w && URL.revokeObjectURL(w);
      }, (k) => {
        Ht = !1, jr = !0, P(k);
      });
    })), await Promise.race(v), _) throw new Error(`WebAssembly backend initializing failed due to timeout: ${e}ms`);
  }, ce = () => {
    if (cr && Wr) return Wr;
    throw new Error("WebAssembly is not initialized yet.");
  };
}), Le, pr, ne, ln = Z(() => {
  It(), Le = (t, e) => {
    let n = ce(), a = n.lengthBytesUTF8(t) + 1, o = n._malloc(a);
    return n.stringToUTF8(t, o, a), e.push(o), o;
  }, pr = (t, e, n, a) => {
    if (typeof t == "object" && t !== null) {
      if (n.has(t)) throw new Error("Circular reference in options");
      n.add(t);
    }
    Object.entries(t).forEach(([o, i]) => {
      let c = e ? e + o : o;
      if (typeof i == "object") pr(i, c + ".", n, a);
      else if (typeof i == "string" || typeof i == "number") a(c, i.toString());
      else if (typeof i == "boolean") a(c, i ? "1" : "0");
      else throw new Error(`Can't handle extra config type: ${typeof i}`);
    });
  }, ne = (t) => {
    let e = ce(), n = e.stackSave();
    try {
      let a = e.PTR_SIZE, o = e.stackAlloc(2 * a);
      e._OrtGetLastError(o, o + a);
      let i = Number(e.getValue(o, a === 4 ? "i32" : "i64")), c = e.getValue(o + a, "*"), d = c ? e.UTF8ToString(c) : "";
      throw new Error(`${t} ERROR_CODE: ${i}, ERROR_MESSAGE: ${d}`);
    } finally {
      e.stackRestore(n);
    }
  };
}), ts, ji = Z(() => {
  It(), ln(), ts = (t) => {
    let e = ce(), n = 0, a = [], o = t || {};
    try {
      if (t?.logSeverityLevel === void 0) o.logSeverityLevel = 2;
      else if (typeof t.logSeverityLevel != "number" || !Number.isInteger(t.logSeverityLevel) || t.logSeverityLevel < 0 || t.logSeverityLevel > 4) throw new Error(`log severity level is not valid: ${t.logSeverityLevel}`);
      if (t?.logVerbosityLevel === void 0) o.logVerbosityLevel = 0;
      else if (typeof t.logVerbosityLevel != "number" || !Number.isInteger(t.logVerbosityLevel)) throw new Error(`log verbosity level is not valid: ${t.logVerbosityLevel}`);
      t?.terminate === void 0 && (o.terminate = !1);
      let i = 0;
      return t?.tag !== void 0 && (i = Le(t.tag, a)), n = e._OrtCreateRunOptions(o.logSeverityLevel, o.logVerbosityLevel, !!o.terminate, i), n === 0 && ne("Can't create run options."), t?.extra !== void 0 && pr(t.extra, "", /* @__PURE__ */ new WeakSet(), (c, d) => {
        let f = Le(c, a), p = Le(d, a);
        e._OrtAddRunConfigEntry(n, f, p) !== 0 && ne(`Can't set a run config entry: ${c} - ${d}.`);
      }), [n, a];
    } catch (i) {
      throw n !== 0 && e._OrtReleaseRunOptions(n), a.forEach((c) => e._free(c)), i;
    }
  };
}), go, bo, yo, qt, _o, rs, zi = Z(() => {
  It(), ln(), go = (t) => {
    switch (t) {
      case "disabled":
        return 0;
      case "basic":
        return 1;
      case "extended":
        return 2;
      case "layout":
        return 3;
      case "all":
        return 99;
      default:
        throw new Error(`unsupported graph optimization level: ${t}`);
    }
  }, bo = (t) => {
    switch (t) {
      case "sequential":
        return 0;
      case "parallel":
        return 1;
      default:
        throw new Error(`unsupported execution mode: ${t}`);
    }
  }, yo = (t) => {
    t.extra || (t.extra = {}), t.extra.session || (t.extra.session = {});
    let e = t.extra.session;
    e.use_ort_model_bytes_directly || (e.use_ort_model_bytes_directly = "1"), t.executionProviders && t.executionProviders.some((n) => (typeof n == "string" ? n : n.name) === "webgpu") && (t.enableMemPattern = !1);
  }, qt = (t, e, n, a) => {
    let o = Le(e, a), i = Le(n, a);
    ce()._OrtAddSessionConfigEntry(t, o, i) !== 0 && ne(`Can't set a session config entry: ${e} - ${n}.`);
  }, _o = async (t, e, n) => {
    let a = e.executionProviders;
    for (let o of a) {
      let i = typeof o == "string" ? o : o.name, c = [];
      switch (i) {
        case "webnn":
          if (i = "WEBNN", typeof o != "string") {
            let w = o?.deviceType;
            w && qt(t, "deviceType", w, n);
          }
          break;
        case "webgpu":
          if (i = "JS", typeof o != "string") {
            let w = o;
            if (w?.preferredLayout) {
              if (w.preferredLayout !== "NCHW" && w.preferredLayout !== "NHWC") throw new Error(`preferredLayout must be either 'NCHW' or 'NHWC': ${w.preferredLayout}`);
              qt(t, "preferredLayout", w.preferredLayout, n);
            }
          }
          break;
        case "wasm":
        case "cpu":
          continue;
        default:
          throw new Error(`not supported execution provider: ${i}`);
      }
      let d = Le(i, n), f = c.length, p = 0, m = 0;
      if (f > 0) {
        p = ce()._malloc(f * ce().PTR_SIZE), n.push(p), m = ce()._malloc(f * ce().PTR_SIZE), n.push(m);
        for (let w = 0; w < f; w++) ce().setValue(p + w * ce().PTR_SIZE, c[w][0], "*"), ce().setValue(m + w * ce().PTR_SIZE, c[w][1], "*");
      }
      await ce()._OrtAppendExecutionProvider(t, d, p, m, f) !== 0 && ne(`Can't append execution provider: ${i}.`);
    }
  }, rs = async (t) => {
    let e = ce(), n = 0, a = [], o = t || {};
    yo(o);
    try {
      let i = go(o.graphOptimizationLevel ?? "all"), c = bo(o.executionMode ?? "sequential"), d = typeof o.logId == "string" ? Le(o.logId, a) : 0, f = o.logSeverityLevel ?? 2;
      if (!Number.isInteger(f) || f < 0 || f > 4) throw new Error(`log severity level is not valid: ${f}`);
      let p = o.logVerbosityLevel ?? 0;
      if (!Number.isInteger(p) || p < 0 || p > 4) throw new Error(`log verbosity level is not valid: ${p}`);
      let m = typeof o.optimizedModelFilePath == "string" ? Le(o.optimizedModelFilePath, a) : 0;
      if (n = e._OrtCreateSessionOptions(i, !!o.enableCpuMemArena, !!o.enableMemPattern, c, !!o.enableProfiling, 0, d, f, p, m), n === 0 && ne("Can't create session options."), o.executionProviders && await _o(n, o, a), o.enableGraphCapture !== void 0) {
        if (typeof o.enableGraphCapture != "boolean") throw new Error(`enableGraphCapture must be a boolean value: ${o.enableGraphCapture}`);
        qt(n, "enableGraphCapture", o.enableGraphCapture.toString(), a);
      }
      if (o.freeDimensionOverrides) for (let [w, b] of Object.entries(o.freeDimensionOverrides)) {
        if (typeof w != "string") throw new Error(`free dimension override name must be a string: ${w}`);
        if (typeof b != "number" || !Number.isInteger(b) || b < 0) throw new Error(`free dimension override value must be a non-negative integer: ${b}`);
        let _ = Le(w, a);
        e._OrtAddFreeDimensionOverride(n, _, b) !== 0 && ne(`Can't set a free dimension override: ${w} - ${b}.`);
      }
      return o.extra !== void 0 && pr(o.extra, "", /* @__PURE__ */ new WeakSet(), (w, b) => {
        qt(n, w, b, a);
      }), [n, a];
    } catch (i) {
      throw n !== 0 && e._OrtReleaseSessionOptions(n) !== 0 && ne("Can't release session options."), a.forEach((c) => e._free(c)), i;
    }
  };
}), Ot, fr, Ct, ns, os, un, fn, ss, as = Z(() => {
  Ot = (t) => {
    switch (t) {
      case "int8":
        return 3;
      case "uint8":
        return 2;
      case "bool":
        return 9;
      case "int16":
        return 5;
      case "uint16":
        return 4;
      case "int32":
        return 6;
      case "uint32":
        return 12;
      case "float16":
        return 10;
      case "float32":
        return 1;
      case "float64":
        return 11;
      case "string":
        return 8;
      case "int64":
        return 7;
      case "uint64":
        return 13;
      case "int4":
        return 22;
      case "uint4":
        return 21;
      default:
        throw new Error(`unsupported data type: ${t}`);
    }
  }, fr = (t) => {
    switch (t) {
      case 3:
        return "int8";
      case 2:
        return "uint8";
      case 9:
        return "bool";
      case 5:
        return "int16";
      case 4:
        return "uint16";
      case 6:
        return "int32";
      case 12:
        return "uint32";
      case 10:
        return "float16";
      case 1:
        return "float32";
      case 11:
        return "float64";
      case 8:
        return "string";
      case 7:
        return "int64";
      case 13:
        return "uint64";
      case 22:
        return "int4";
      case 21:
        return "uint4";
      default:
        throw new Error(`unsupported data type: ${t}`);
    }
  }, Ct = (t, e) => {
    let n = [-1, 4, 1, 1, 2, 2, 4, 8, -1, 1, 2, 8, 4, 8, -1, -1, -1, -1, -1, -1, -1, 0.5, 0.5][t], a = typeof e == "number" ? e : e.reduce((o, i) => o * i, 1);
    return n > 0 ? Math.ceil(a * n) : void 0;
  }, ns = (t) => {
    switch (t) {
      case "float16":
        return typeof Float16Array < "u" && Float16Array.from ? Float16Array : Uint16Array;
      case "float32":
        return Float32Array;
      case "uint8":
        return Uint8Array;
      case "int8":
        return Int8Array;
      case "uint16":
        return Uint16Array;
      case "int16":
        return Int16Array;
      case "int32":
        return Int32Array;
      case "bool":
        return Uint8Array;
      case "float64":
        return Float64Array;
      case "uint32":
        return Uint32Array;
      case "int64":
        return BigInt64Array;
      case "uint64":
        return BigUint64Array;
      default:
        throw new Error(`unsupported type: ${t}`);
    }
  }, os = (t) => {
    switch (t) {
      case "verbose":
        return 0;
      case "info":
        return 1;
      case "warning":
        return 2;
      case "error":
        return 3;
      case "fatal":
        return 4;
      default:
        throw new Error(`unsupported logging level: ${t}`);
    }
  }, un = (t) => t === "float32" || t === "float16" || t === "int32" || t === "int64" || t === "uint32" || t === "uint8" || t === "bool" || t === "uint4" || t === "int4", fn = (t) => t === "float32" || t === "float16" || t === "int32" || t === "int64" || t === "uint32" || t === "uint64" || t === "int8" || t === "uint8" || t === "bool" || t === "uint4" || t === "int4", ss = (t) => {
    switch (t) {
      case "none":
        return 0;
      case "cpu":
        return 1;
      case "cpu-pinned":
        return 2;
      case "texture":
        return 3;
      case "gpu-buffer":
        return 4;
      case "ml-tensor":
        return 5;
      default:
        throw new Error(`unsupported data location: ${t}`);
    }
  };
}), dn, is = Z(() => {
  sn(), dn = async (t) => {
    if (typeof t == "string") {
      let e = await fetch(t);
      if (!e.ok) throw new Error(`failed to load external data file: ${t}`);
      let n = e.headers.get("Content-Length"), a = n ? parseInt(n, 10) : 0;
      if (a < 1073741824) return new Uint8Array(await e.arrayBuffer());
      {
        if (!e.body) throw new Error(`failed to load external data file: ${t}, no response body.`);
        let o = e.body.getReader(), i;
        try {
          i = new ArrayBuffer(a);
        } catch (d) {
          if (d instanceof RangeError) {
            let f = Math.ceil(a / 65536);
            i = new WebAssembly.Memory({ initial: f, maximum: f }).buffer;
          } else throw d;
        }
        let c = 0;
        for (; ; ) {
          let { done: d, value: f } = await o.read();
          if (d) break;
          let p = f.byteLength;
          new Uint8Array(i, c, p).set(f), c += p;
        }
        return new Uint8Array(i, 0, a);
      }
    } else return t instanceof Blob ? new Uint8Array(await t.arrayBuffer()) : t instanceof Uint8Array ? t : new Uint8Array(t);
  };
}), vo, hn, pn, mt, To, zr, mr, mn, wn, Gr, gn, bn, yn, cs = Z(() => {
  Et(), ji(), zi(), as(), It(), ln(), is(), vo = (t, e) => {
    ce()._OrtInit(t, e) !== 0 && ne("Can't initialize onnxruntime.");
  }, hn = async (t) => {
    vo(t.wasm.numThreads, os(t.logLevel));
  }, pn = async (t, e) => {
    ce().asyncInit?.();
    let n = t.webgpu.adapter;
    if (e === "webgpu") {
      if (typeof navigator > "u" || !navigator.gpu) throw new Error("WebGPU is not supported in current environment");
      if (n) {
        if (typeof n.limits != "object" || typeof n.features != "object" || typeof n.requestDevice != "function") throw new Error("Invalid GPU adapter set in `env.webgpu.adapter`. It must be a GPUAdapter object.");
      } else {
        let a = t.webgpu.powerPreference;
        if (a !== void 0 && a !== "low-power" && a !== "high-performance") throw new Error(`Invalid powerPreference setting: "${a}"`);
        let o = t.webgpu.forceFallbackAdapter;
        if (o !== void 0 && typeof o != "boolean") throw new Error(`Invalid forceFallbackAdapter setting: "${o}"`);
        if (n = await navigator.gpu.requestAdapter({ powerPreference: a, forceFallbackAdapter: o }), !n) throw new Error('Failed to get GPU adapter. You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.');
      }
    }
    if (e === "webnn" && (typeof navigator > "u" || !navigator.ml)) throw new Error("WebNN is not supported in current environment");
  }, mt = /* @__PURE__ */ new Map(), To = (t) => {
    let e = ce(), n = e.stackSave();
    try {
      let a = e.PTR_SIZE, o = e.stackAlloc(2 * a);
      e._OrtGetInputOutputCount(t, o, o + a) !== 0 && ne("Can't get session input/output count.");
      let i = a === 4 ? "i32" : "i64";
      return [Number(e.getValue(o, i)), Number(e.getValue(o + a, i))];
    } finally {
      e.stackRestore(n);
    }
  }, zr = (t, e) => {
    let n = ce(), a = n.stackSave(), o = 0;
    try {
      let i = n.PTR_SIZE, c = n.stackAlloc(2 * i);
      n._OrtGetInputOutputMetadata(t, e, c, c + i) !== 0 && ne("Can't get session input/output metadata.");
      let d = Number(n.getValue(c, "*"));
      o = Number(n.getValue(c + i, "*"));
      let f = n.HEAP32[o / 4];
      if (f === 0) return [d, 0];
      let p = n.HEAPU32[o / 4 + 1], m = [];
      for (let w = 0; w < p; w++) {
        let b = Number(n.getValue(o + 8 + w * i, "*"));
        m.push(b !== 0 ? n.UTF8ToString(b) : Number(n.getValue(o + 8 + (w + p) * i, "*")));
      }
      return [d, f, m];
    } finally {
      n.stackRestore(a), o !== 0 && n._OrtFree(o);
    }
  }, mr = (t) => {
    let e = ce(), n = e._malloc(t.byteLength);
    if (n === 0) throw new Error(`Can't create a session. failed to allocate a buffer of size ${t.byteLength}.`);
    return e.HEAPU8.set(t, n), [n, t.byteLength];
  }, mn = async (t, e) => {
    let n, a, o = ce();
    Array.isArray(t) ? [n, a] = t : t.buffer === o.HEAPU8.buffer ? [n, a] = [t.byteOffset, t.byteLength] : [n, a] = mr(t);
    let i = 0, c = 0, d = [], f = [], p = [];
    try {
      if ([c, d] = await rs(e), e?.externalData && o.mountExternalData) {
        let k = [];
        for (let A of e.externalData) {
          let R = typeof A == "string" ? A : A.path;
          k.push(dn(typeof A == "string" ? A : A.data).then((C) => {
            o.mountExternalData(R, C);
          }));
        }
        await Promise.all(k);
      }
      for (let k of e?.executionProviders ?? []) if ((typeof k == "string" ? k : k.name) === "webnn") {
        if (o.shouldTransferToMLTensor = !1, typeof k != "string") {
          let A = k, R = A?.context, C = A?.gpuDevice, y = A?.deviceType, V = A?.powerPreference;
          R ? o.currentContext = R : C ? o.currentContext = await o.webnnCreateMLContext(C) : o.currentContext = await o.webnnCreateMLContext({ deviceType: y, powerPreference: V });
        } else o.currentContext = await o.webnnCreateMLContext();
        break;
      }
      i = await o._OrtCreateSession(n, a, c), o.webgpuOnCreateSession?.(i), i === 0 && ne("Can't create a session."), o.jsepOnCreateSession?.(), o.currentContext && (o.webnnRegisterMLContext(i, o.currentContext), o.currentContext = void 0, o.shouldTransferToMLTensor = !0);
      let [m, w] = To(i), b = !!e?.enableGraphCapture, _ = [], v = [], S = [], P = [], x = [];
      for (let k = 0; k < m; k++) {
        let [A, R, C] = zr(i, k);
        A === 0 && ne("Can't get an input name."), f.push(A);
        let y = o.UTF8ToString(A);
        _.push(y), S.push(R === 0 ? { name: y, isTensor: !1 } : { name: y, isTensor: !0, type: fr(R), shape: C });
      }
      for (let k = 0; k < w; k++) {
        let [A, R, C] = zr(i, k + m);
        A === 0 && ne("Can't get an output name."), p.push(A);
        let y = o.UTF8ToString(A);
        v.push(y), P.push(R === 0 ? { name: y, isTensor: !1 } : { name: y, isTensor: !0, type: fr(R), shape: C });
      }
      return mt.set(i, [i, f, p, null, b, !1]), [i, _, v, S, P];
    } catch (m) {
      throw f.forEach((w) => o._OrtFree(w)), p.forEach((w) => o._OrtFree(w)), i !== 0 && o._OrtReleaseSession(i) !== 0 && ne("Can't release session."), m;
    } finally {
      o._free(n), c !== 0 && o._OrtReleaseSessionOptions(c) !== 0 && ne("Can't release session options."), d.forEach((m) => o._free(m)), o.unmountExternalData?.();
    }
  }, wn = (t) => {
    let e = ce(), n = mt.get(t);
    if (!n) throw new Error(`cannot release session. invalid session id: ${t}`);
    let [a, o, i, c, d] = n;
    c && (d && e._OrtClearBoundOutputs(c.handle) !== 0 && ne("Can't clear bound outputs."), e._OrtReleaseBinding(c.handle) !== 0 && ne("Can't release IO binding.")), e.jsepOnReleaseSession?.(t), e.webnnOnReleaseSession?.(t), e.webgpuOnReleaseSession?.(t), o.forEach((f) => e._OrtFree(f)), i.forEach((f) => e._OrtFree(f)), e._OrtReleaseSession(a) !== 0 && ne("Can't release session."), mt.delete(t);
  }, Gr = async (t, e, n, a, o, i, c = !1) => {
    if (!t) {
      e.push(0);
      return;
    }
    let d = ce(), f = d.PTR_SIZE, p = t[0], m = t[1], w = t[3], b = w, _, v;
    if (p === "string" && (w === "gpu-buffer" || w === "ml-tensor")) throw new Error("String tensor is not supported on GPU.");
    if (c && w !== "gpu-buffer") throw new Error(`External buffer must be provided for input/output index ${i} when enableGraphCapture is true.`);
    if (w === "gpu-buffer") {
      let x = t[2].gpuBuffer;
      v = Ct(Ot(p), m);
      {
        let k = d.jsepRegisterBuffer;
        if (!k) throw new Error('Tensor location "gpu-buffer" is not supported without using WebGPU.');
        _ = k(a, i, x, v);
      }
    } else if (w === "ml-tensor") {
      let x = t[2].mlTensor;
      v = Ct(Ot(p), m);
      let k = d.webnnRegisterMLTensor;
      if (!k) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
      _ = k(a, x, Ot(p), m);
    } else {
      let x = t[2];
      if (Array.isArray(x)) {
        v = f * x.length, _ = d._malloc(v), n.push(_);
        for (let k = 0; k < x.length; k++) {
          if (typeof x[k] != "string") throw new TypeError(`tensor data at index ${k} is not a string`);
          d.setValue(_ + k * f, Le(x[k], n), "*");
        }
      } else {
        let k = d.webnnIsGraphInput, A = d.webnnIsGraphOutput;
        if (p !== "string" && k && A) {
          let R = d.UTF8ToString(o);
          if (k(a, R) || A(a, R)) {
            let C = Ot(p);
            v = Ct(C, m), b = "ml-tensor";
            let y = d.webnnCreateTemporaryTensor, V = d.webnnUploadTensor;
            if (!y || !V) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
            let L = await y(a, C, m);
            V(L, new Uint8Array(x.buffer, x.byteOffset, x.byteLength)), _ = L;
          } else v = x.byteLength, _ = d._malloc(v), n.push(_), d.HEAPU8.set(new Uint8Array(x.buffer, x.byteOffset, v), _);
        } else v = x.byteLength, _ = d._malloc(v), n.push(_), d.HEAPU8.set(new Uint8Array(x.buffer, x.byteOffset, v), _);
      }
    }
    let S = d.stackSave(), P = d.stackAlloc(4 * m.length);
    try {
      m.forEach((k, A) => d.setValue(P + A * f, k, f === 4 ? "i32" : "i64"));
      let x = d._OrtCreateTensor(Ot(p), _, v, P, m.length, ss(b));
      x === 0 && ne(`Can't create tensor for input/output. session=${a}, index=${i}.`), e.push(x);
    } finally {
      d.stackRestore(S);
    }
  }, gn = async (t, e, n, a, o, i) => {
    let c = ce(), d = c.PTR_SIZE, f = mt.get(t);
    if (!f) throw new Error(`cannot run inference. invalid session id: ${t}`);
    let p = f[0], m = f[1], w = f[2], b = f[3], _ = f[4];
    f[5];
    let v = e.length, S = a.length, P = 0, x = [], k = [], A = [], R = [], C = [], y = c.stackSave(), V = c.stackAlloc(v * d), L = c.stackAlloc(v * d), Q = c.stackAlloc(S * d), oe = c.stackAlloc(S * d);
    try {
      [P, x] = ts(i), kt("wasm prepareInputOutputTensor");
      for (let E = 0; E < v; E++) await Gr(n[E], k, R, t, m[e[E]], e[E], _);
      for (let E = 0; E < S; E++) await Gr(o[E], A, R, t, w[a[E]], v + a[E], _);
      At("wasm prepareInputOutputTensor");
      for (let E = 0; E < v; E++) c.setValue(V + E * d, k[E], "*"), c.setValue(L + E * d, m[e[E]], "*");
      for (let E = 0; E < S; E++) c.setValue(Q + E * d, A[E], "*"), c.setValue(oe + E * d, w[a[E]], "*");
      c.jsepOnRunStart?.(p), c.webnnOnRunStart?.(p);
      let M;
      M = await c._OrtRun(p, L, V, v, oe, S, Q, P), M !== 0 && ne("failed to call OrtRun().");
      let U = [], le = [];
      kt("wasm ProcessOutputTensor");
      for (let E = 0; E < S; E++) {
        let I = Number(c.getValue(Q + E * d, "*"));
        if (I === A[E] || C.includes(A[E])) {
          U.push(o[E]), I !== A[E] && c._OrtReleaseTensor(I) !== 0 && ne("Can't release tensor.");
          continue;
        }
        let pe = c.stackSave(), he = c.stackAlloc(4 * d), fe = !1, H, se = 0;
        try {
          c._OrtGetTensorData(I, he, he + d, he + 2 * d, he + 3 * d) !== 0 && ne(`Can't access output tensor data on index ${E}.`);
          let ye = d === 4 ? "i32" : "i64", te = Number(c.getValue(he, ye));
          se = c.getValue(he + d, "*");
          let ae = c.getValue(he + d * 2, "*"), ie = Number(c.getValue(he + d * 3, ye)), Y = [];
          for (let J = 0; J < ie; J++) Y.push(Number(c.getValue(ae + J * d, ye)));
          c._OrtFree(ae) !== 0 && ne("Can't free memory for tensor dims.");
          let re = Y.reduce((J, K) => J * K, 1);
          H = fr(te);
          let _e = b?.outputPreferredLocations[a[E]];
          if (H === "string") {
            if (_e === "gpu-buffer" || _e === "ml-tensor") throw new Error("String tensor is not supported on GPU.");
            let J = [];
            for (let K = 0; K < re; K++) {
              let B = c.getValue(se + K * d, "*"), Ve = c.getValue(se + (K + 1) * d, "*"), Qe = K === re - 1 ? void 0 : Ve - B;
              J.push(c.UTF8ToString(B, Qe));
            }
            U.push([H, Y, J, "cpu"]);
          } else if (_e === "gpu-buffer" && re > 0) {
            let J = c.jsepGetBuffer;
            if (!J) throw new Error('preferredLocation "gpu-buffer" is not supported without using WebGPU.');
            let K = J(se), B = Ct(te, re);
            if (B === void 0 || !un(H)) throw new Error(`Unsupported data type: ${H}`);
            fe = !0, U.push([H, Y, { gpuBuffer: K, download: c.jsepCreateDownloader(K, B, H), dispose: () => {
              c._OrtReleaseTensor(I) !== 0 && ne("Can't release tensor.");
            } }, "gpu-buffer"]);
          } else if (_e === "ml-tensor" && re > 0) {
            let J = c.webnnEnsureTensor, K = c.webnnIsGraphInputOutputTypeSupported;
            if (!J || !K) throw new Error('preferredLocation "ml-tensor" is not supported without using WebNN.');
            if (Ct(te, re) === void 0 || !fn(H)) throw new Error(`Unsupported data type: ${H}`);
            if (!K(t, H, !1)) throw new Error(`preferredLocation "ml-tensor" for ${H} output is not supported by current WebNN Context.`);
            let B = await J(t, se, te, Y, !1);
            fe = !0, U.push([H, Y, { mlTensor: B, download: c.webnnCreateMLTensorDownloader(se, H), dispose: () => {
              c.webnnReleaseTensorId(se), c._OrtReleaseTensor(I);
            } }, "ml-tensor"]);
          } else if (_e === "ml-tensor-cpu-output" && re > 0) {
            let J = c.webnnCreateMLTensorDownloader(se, H)(), K = U.length;
            fe = !0, le.push((async () => {
              let B = [K, await J];
              return c.webnnReleaseTensorId(se), c._OrtReleaseTensor(I), B;
            })()), U.push([H, Y, [], "cpu"]);
          } else {
            let J = ns(H), K = new J(re);
            new Uint8Array(K.buffer, K.byteOffset, K.byteLength).set(c.HEAPU8.subarray(se, se + K.byteLength)), U.push([H, Y, K, "cpu"]);
          }
        } finally {
          c.stackRestore(pe), H === "string" && se && c._free(se), fe || c._OrtReleaseTensor(I);
        }
      }
      b && !_ && (c._OrtClearBoundOutputs(b.handle) !== 0 && ne("Can't clear bound outputs."), mt.set(t, [p, m, w, b, _, !1]));
      for (let [E, I] of await Promise.all(le)) U[E][2] = I;
      return At("wasm ProcessOutputTensor"), U;
    } finally {
      c.webnnOnRunEnd?.(p), c.stackRestore(y), k.forEach((M) => c._OrtReleaseTensor(M)), A.forEach((M) => c._OrtReleaseTensor(M)), R.forEach((M) => c._free(M)), P !== 0 && c._OrtReleaseRunOptions(P), x.forEach((M) => c._free(M));
    }
  }, bn = (t) => {
    let e = ce(), n = mt.get(t);
    if (!n) throw new Error("invalid session id");
    let a = n[0], o = e._OrtEndProfiling(a);
    o === 0 && ne("Can't get an profile file name."), e._OrtFree(o);
  }, yn = (t) => {
    let e = [];
    for (let n of t) {
      let a = n[2];
      !Array.isArray(a) && "buffer" in a && e.push(a.buffer);
    }
    return e;
  };
}), at, Fe, Ft, Kt, Xt, lr, Vr, ur, wt, gt, ko, ls, us, fs, ds, hs, ps, ms, ws = Z(() => {
  Et(), cs(), It(), an(), at = () => !!ue.wasm.proxy && typeof document < "u", Ft = !1, Kt = !1, Xt = !1, ur = /* @__PURE__ */ new Map(), wt = (t, e) => {
    let n = ur.get(t);
    n ? n.push(e) : ur.set(t, [e]);
  }, gt = () => {
    if (Ft || !Kt || Xt || !Fe) throw new Error("worker not ready");
  }, ko = (t) => {
    switch (t.data.type) {
      case "init-wasm":
        Ft = !1, t.data.err ? (Xt = !0, Vr[1](t.data.err)) : (Kt = !0, Vr[0]()), lr && (URL.revokeObjectURL(lr), lr = void 0);
        break;
      case "init-ep":
      case "copy-from":
      case "create":
      case "release":
      case "run":
      case "end-profiling": {
        let e = ur.get(t.data.type);
        t.data.err ? e.shift()[1](t.data.err) : e.shift()[0](t.data.out);
        break;
      }
    }
  }, ls = async () => {
    if (!Kt) {
      if (Ft) throw new Error("multiple calls to 'initWasm()' detected.");
      if (Xt) throw new Error("previous call to 'initWasm()' failed.");
      if (Ft = !0, at()) return new Promise((t, e) => {
        Fe?.terminate(), Jo().then(([n, a]) => {
          try {
            Fe = a, Fe.onerror = (i) => e(i), Fe.onmessage = ko, Vr = [t, e];
            let o = { type: "init-wasm", in: ue };
            !o.in.wasm.wasmPaths && (n || Qr) && (o.in.wasm.wasmPaths = { wasm: new URL("ort-wasm-simd-threaded.wasm", import.meta.url).href }), Fe.postMessage(o), lr = n;
          } catch (o) {
            e(o);
          }
        }, e);
      });
      try {
        await cn(ue.wasm), await hn(ue), Kt = !0;
      } catch (t) {
        throw Xt = !0, t;
      } finally {
        Ft = !1;
      }
    }
  }, us = async (t) => {
    if (at()) return gt(), new Promise((e, n) => {
      wt("init-ep", [e, n]);
      let a = { type: "init-ep", in: { epName: t, env: ue } };
      Fe.postMessage(a);
    });
    await pn(ue, t);
  }, fs = async (t) => at() ? (gt(), new Promise((e, n) => {
    wt("copy-from", [e, n]);
    let a = { type: "copy-from", in: { buffer: t } };
    Fe.postMessage(a, [t.buffer]);
  })) : mr(t), ds = async (t, e) => {
    if (at()) {
      if (e?.preferredOutputLocation) throw new Error('session option "preferredOutputLocation" is not supported for proxy.');
      return gt(), new Promise((n, a) => {
        wt("create", [n, a]);
        let o = { type: "create", in: { model: t, options: { ...e } } }, i = [];
        t instanceof Uint8Array && i.push(t.buffer), Fe.postMessage(o, i);
      });
    } else return mn(t, e);
  }, hs = async (t) => {
    if (at()) return gt(), new Promise((e, n) => {
      wt("release", [e, n]);
      let a = { type: "release", in: t };
      Fe.postMessage(a);
    });
    wn(t);
  }, ps = async (t, e, n, a, o, i) => {
    if (at()) {
      if (n.some((c) => c[3] !== "cpu")) throw new Error("input tensor on GPU is not supported for proxy.");
      if (o.some((c) => c)) throw new Error("pre-allocated output tensor is not supported for proxy.");
      return gt(), new Promise((c, d) => {
        wt("run", [c, d]);
        let f = n, p = { type: "run", in: { sessionId: t, inputIndices: e, inputs: f, outputIndices: a, options: i } };
        Fe.postMessage(p, yn(f));
      });
    } else return gn(t, e, n, a, o, i);
  }, ms = async (t) => {
    if (at()) return gt(), new Promise((e, n) => {
      wt("end-profiling", [e, n]);
      let a = { type: "end-profiling", in: t };
      Fe.postMessage(a);
    });
    bn(t);
  };
}), Hr, Ao, gs, Gi = Z(() => {
  Et(), ws(), as(), sn(), is(), Hr = (t, e) => {
    switch (t.location) {
      case "cpu":
        return [t.type, t.dims, t.data, "cpu"];
      case "gpu-buffer":
        return [t.type, t.dims, { gpuBuffer: t.gpuBuffer }, "gpu-buffer"];
      case "ml-tensor":
        return [t.type, t.dims, { mlTensor: t.mlTensor }, "ml-tensor"];
      default:
        throw new Error(`invalid data location: ${t.location} for ${e()}`);
    }
  }, Ao = (t) => {
    switch (t[3]) {
      case "cpu":
        return new Ue(t[0], t[2], t[1]);
      case "gpu-buffer": {
        let e = t[0];
        if (!un(e)) throw new Error(`not supported data type: ${e} for deserializing GPU tensor`);
        let { gpuBuffer: n, download: a, dispose: o } = t[2];
        return Ue.fromGpuBuffer(n, { dataType: e, dims: t[1], download: a, dispose: o });
      }
      case "ml-tensor": {
        let e = t[0];
        if (!fn(e)) throw new Error(`not supported data type: ${e} for deserializing MLTensor tensor`);
        let { mlTensor: n, download: a, dispose: o } = t[2];
        return Ue.fromMLTensor(n, { dataType: e, dims: t[1], download: a, dispose: o });
      }
      default:
        throw new Error(`invalid data location: ${t[3]}`);
    }
  }, gs = class {
    async fetchModelAndCopyToWasmMemory(t) {
      return fs(await dn(t));
    }
    async loadModel(t, e) {
      vt();
      let n;
      typeof t == "string" ? n = await this.fetchModelAndCopyToWasmMemory(t) : n = t, [this.sessionId, this.inputNames, this.outputNames, this.inputMetadata, this.outputMetadata] = await ds(n, e), Tt();
    }
    async dispose() {
      return hs(this.sessionId);
    }
    async run(t, e, n) {
      vt();
      let a = [], o = [];
      Object.entries(t).forEach((w) => {
        let b = w[0], _ = w[1], v = this.inputNames.indexOf(b);
        if (v === -1) throw new Error(`invalid input '${b}'`);
        a.push(_), o.push(v);
      });
      let i = [], c = [];
      Object.entries(e).forEach((w) => {
        let b = w[0], _ = w[1], v = this.outputNames.indexOf(b);
        if (v === -1) throw new Error(`invalid output '${b}'`);
        i.push(_), c.push(v);
      });
      let d = a.map((w, b) => Hr(w, () => `input "${this.inputNames[o[b]]}"`)), f = i.map((w, b) => w ? Hr(w, () => `output "${this.outputNames[c[b]]}"`) : null), p = await ps(this.sessionId, o, d, c, f, n), m = {};
      for (let w = 0; w < p.length; w++) m[this.outputNames[c[w]]] = i[w] ?? Ao(p[w]);
      return Tt(), m;
    }
    startProfiling() {
    }
    endProfiling() {
      ms(this.sessionId);
    }
  };
}), bs = {};
wr(bs, { OnnxruntimeWebAssemblyBackend: () => Yr, initializeFlags: () => Zr, wasmBackend: () => ys });
var Zr, Yr, ys, Vi = Z(() => {
  Et(), ws(), Gi(), Zr = () => {
    (typeof ue.wasm.initTimeout != "number" || ue.wasm.initTimeout < 0) && (ue.wasm.initTimeout = 0);
    let t = ue.wasm.simd;
    if (typeof t != "boolean" && t !== void 0 && t !== "fixed" && t !== "relaxed" && (ue.wasm.simd = !1), typeof ue.wasm.proxy != "boolean" && (ue.wasm.proxy = !1), typeof ue.wasm.trace != "boolean" && (ue.wasm.trace = !1), typeof ue.wasm.numThreads != "number" || !Number.isInteger(ue.wasm.numThreads) || ue.wasm.numThreads <= 0) if (typeof self < "u" && !self.crossOriginIsolated) ue.wasm.numThreads = 1;
    else {
      let e = typeof navigator > "u" ? Ei("node:os").cpus().length : navigator.hardwareConcurrency;
      ue.wasm.numThreads = Math.min(4, Math.ceil((e || 1) / 2));
    }
  }, Yr = class {
    async init(t) {
      Zr(), await ls(), await us(t);
    }
    async createInferenceSessionHandler(t, e) {
      let n = new gs();
      return await n.loadModel(t, e), n;
    }
  }, ys = new Yr();
});
Et();
Et();
Et();
var Hi = "1.24.1", _s = qo;
{
  let t = (Vi(), Xr(bs)).wasmBackend;
  Zt("cpu", t, 10), Zt("wasm", t, 10);
}
Object.defineProperty(ue.versions, "web", { value: Hi, enumerable: !0 });
const vs = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  get InferenceSession() {
    return on;
  },
  get TRACE() {
    return hr;
  },
  get TRACE_EVENT_BEGIN() {
    return kt;
  },
  get TRACE_EVENT_END() {
    return At;
  },
  get TRACE_FUNC_BEGIN() {
    return vt;
  },
  get TRACE_FUNC_END() {
    return Tt;
  },
  get Tensor() {
    return Ue;
  },
  default: _s,
  get env() {
    return ue;
  },
  get registerBackend() {
    return Zt;
  }
}, Symbol.toStringTag, { value: "Module" })), qi = await Jr({ backend: "wasm", numThreads: 1 });
if (qi !== (_s || vs)) throw new Error("Runtime singleton mismatch");
const Ki = Object.freeze({ package: "parakeet.js", version: "1.4.4", ortVersion: "1.24.1" });
export {
  Mo as ParakeetModel,
  Ki as bindingIdentity,
  qi as ort
};
