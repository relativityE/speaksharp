/**
 * R5 diagnostic only. Opt-in captures canonical Float32LE hashes and ordered source
 * spans, never audio/text in its public receipt. Normal sessions allocate no ledger.
 * Hashing is asynchronous and never awaited by capture or inference. Stream hashes
 * use fixed one-second chunks; decoder hashes cover each complete submitted buffer.
 * A missing span, dropped frame, overflow or digest failure makes proof incomplete.
 */
export type PcmOperation = 'worklet' | 'replay' | 'listener-copy' | 'speech-confirm'
  | 'preroll' | 'preonset' | 'live-concat' | 'retry-concat' | 'live-cap'
  | 'utterance-copy' | 'utterance-concat' | 'utterance-cap' | 'utterance-trim' | 'retry-tail';
export type PcmDomain = 'worklet_output' | 'listener_delivery' | 'live_decode_input' | 'final_decode_input';
interface Span { captureId: string | null; start: number | null; samples: number; operations: PcmOperation[] }
interface Lineage { spans: Span[]; complete: boolean }
interface Receipt {
  domain: PcmDomain; ordinal: number; samples: number; bytes: number; atMs: number;
  sha256: string | null; status: 'pending' | 'hashed' | 'unavailable'; spans: Span[]; lineageComplete: boolean;
}
interface StreamBuffer { bytes: Uint8Array; samples: number; spans: Span[]; complete: boolean; atMs: number }
const lineage = new WeakMap<Float32Array, Lineage>();
const captures: PcmBoundaryCapture[] = [];
const MAX_RECEIPTS = 2048, MAX_SPANS = 256, MAX_OPERATIONS = 32, MAX_PENDING_BYTES = 32 * 1024 * 1024;
const OPERATIONS = new Set<PcmOperation>(['worklet', 'replay', 'listener-copy', 'speech-confirm', 'preroll', 'preonset', 'live-concat',
  'retry-concat', 'live-cap', 'utterance-copy', 'utterance-concat', 'utterance-cap', 'utterance-trim', 'retry-tail']);
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
declare global {
  interface Window {
    __PRIVATE_PCM_RECEIPTS_ENABLED__?: boolean;
    __PRIVATE_PCM_RECEIPTS__?: { read: () => Promise<unknown[]> };
  }
}
const cloneSpans = (spans: Span[]) => spans.map(s => ({ ...s, operations: [...s.operations] }));
function appendSpan(out: Span[], span: Span): void {
  const last = out[out.length - 1];
  if (last && span.captureId === last.captureId && span.start !== null && last.start !== null
    && last.start + last.samples === span.start && JSON.stringify(last.operations) === JSON.stringify(span.operations)) {
    last.samples += span.samples;
  } else out.push({ ...span, operations: [...span.operations] });
}
function slicedSpans(meta: Lineage, start: number, end: number, operation?: PcmOperation): Lineage {
  let offset = 0; const spans: Span[] = []; let complete = meta.complete;
  for (const source of meta.spans) {
    const left = Math.max(start, offset), right = Math.min(end, offset + source.samples);
    if (right > left) {
      const operations = operation ? [...source.operations, operation] : [...source.operations];
      if (operations.length > MAX_OPERATIONS) complete = false;
      appendSpan(spans, { captureId: source.captureId, start: source.start === null ? null : source.start + left - offset,
        samples: right - left, operations: operations.slice(0, MAX_OPERATIONS) });
    }
    offset += source.samples;
  }
  if (offset < end || spans.reduce((n, s) => n + s.samples, 0) !== end - start) complete = false;
  return { spans, complete };
}
/** Preserve exact slice/subarray semantics; this helper only annotates the result. */
export function inheritPcmSlice(source: Float32Array, target: Float32Array, start: number, operation: PcmOperation): Float32Array {
  const meta = lineage.get(source);
  if (meta) {
    if (!OPERATIONS.has(operation)) { lineage.set(target, { spans: [], complete: false }); return target; }
    const from = start < 0 ? Math.max(0, source.length + start) : Math.min(source.length, start);
    lineage.set(target, slicedSpans(meta, from, from + target.length, operation));
  }
  return target;
}
export function inheritPcmConcat(target: Float32Array, sources: Float32Array[], operation: PcmOperation): Float32Array {
  if (!sources.some(s => lineage.has(s))) return target;
  if (!OPERATIONS.has(operation)) { lineage.set(target, { spans: [], complete: false }); return target; }
  const spans: Span[] = []; let complete = true;
  for (const source of sources) {
    const meta = lineage.get(source);
    if (!meta) { complete = false; appendSpan(spans, { captureId: null, start: null, samples: source.length, operations: [] }); }
    else {
      const transformed = slicedSpans(meta, 0, source.length, operation); complete &&= transformed.complete;
      for (const span of transformed.spans) {
        if (spans.length >= MAX_SPANS) { complete = false; break; }
        appendSpan(spans, span);
      }
    }
  }
  complete &&= spans.reduce((n, s) => n + s.samples, 0) === target.length;
  lineage.set(target, { spans, complete });
  return target;
}
function canonicalBytes(audio: Float32Array): Uint8Array {
  const bytes = new Uint8Array(audio.length * 4), view = new DataView(bytes.buffer);
  const source = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  // Preserve exact -0/NaN payload bits as well as normal samples; don't re-encode numeric values.
  for (let i = 0; i < audio.length; i++) view.setUint32(i * 4, source.getUint32(i * 4, LITTLE_ENDIAN), true);
  return bytes;
}
export class PcmBoundaryCapture {
  private readonly createdAtMs = performance.now();
  private receipts: Receipt[] = [];
  private pending = new Set<Promise<void>>();
  private pendingBytes = 0;
  private problems = new Set<string>();
  private sequence = 0;
  private sourceSamples = 0;
  private workletClosed = false;
  private listenerClosed = false;
  private streams: Record<'worklet_output' | 'listener_delivery', StreamBuffer>;
  constructor(readonly captureId: string, readonly sampleRate: number) {
    if (!UUID.test(captureId) || !Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('PCM_RECEIPT_IDENTITY_INVALID');
    const empty = (): StreamBuffer => ({ bytes: new Uint8Array(sampleRate * 4), samples: 0, spans: [], complete: true, atMs: 0 });
    this.streams = { worklet_output: empty(), listener_delivery: empty() };
  }
  incomplete(reason: 'worklet-gap' | 'worklet-metadata' | 'late-frame' | 'capture-changed' | 'overflow' | 'missing-lineage' | 'hash-unavailable'): void {
    this.problems.add(reason);
  }
  worklet(frame: Float32Array, sequence: number, start: number): void {
    if (this.workletClosed) this.incomplete('late-frame');
    if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(start + frame.length)) {
      this.incomplete('worklet-metadata'); return;
    }
    if (sequence !== this.sequence || start !== this.sourceSamples) this.incomplete('worklet-gap');
    this.sequence = sequence + 1; this.sourceSamples = start + frame.length;
    lineage.set(frame, { complete: true, spans: [{ captureId: this.captureId, start, samples: frame.length, operations: ['worklet'] }] });
    this.stream('worklet_output', frame);
  }
  listener(frame: Float32Array): void {
    if (this.listenerClosed) this.incomplete('late-frame');
    this.stream('listener_delivery', frame);
  }
  private metadata(frame: Float32Array): Lineage {
    const meta = lineage.get(frame);
    if (!meta || !meta.complete || meta.spans.some(s => s.captureId !== this.captureId)) this.incomplete('missing-lineage');
    return meta ?? { complete: false, spans: [{ captureId: null, start: null, samples: frame.length, operations: [] }] };
  }
  private stream(domain: 'worklet_output' | 'listener_delivery', frame: Float32Array): void {
    const state = this.streams[domain], meta = this.metadata(frame); let at = 0;
    while (at < frame.length) {
      const count = Math.min(frame.length - at, this.sampleRate - state.samples);
      const bytes = canonicalBytes(frame.subarray(at, at + count)); state.bytes.set(bytes, state.samples * 4);
      const part = slicedSpans(meta, at, at + count); state.complete &&= part.complete;
      for (const span of part.spans) appendSpan(state.spans, span);
      state.samples += count; state.atMs = performance.now(); at += count;
      if (state.samples === this.sampleRate) this.flush(domain);
    }
  }
  private hash(domain: PcmDomain, bytes: Uint8Array, samples: number, meta: Lineage, atMs: number): void {
    if (this.problems.has('hash-unavailable') || this.problems.has('overflow')) return;
    if (this.receipts.length >= MAX_RECEIPTS || this.pendingBytes + bytes.length > MAX_PENDING_BYTES || meta.spans.length > MAX_SPANS) {
      this.incomplete('overflow'); return;
    }
    const row: Receipt = { domain, ordinal: this.receipts.length, samples, bytes: bytes.length, atMs,
      sha256: null, status: 'pending', spans: cloneSpans(meta.spans), lineageComplete: meta.complete };
    this.receipts.push(row); this.pendingBytes += bytes.length;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PCM_HASH_TIMEOUT')), 5000); });
    const job = Promise.race([Promise.resolve().then(() => crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)), deadline])
      .then(value => { row.sha256 = Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join(''); row.status = 'hashed'; })
      .catch(() => { row.status = 'unavailable'; this.incomplete('hash-unavailable'); })
      .finally(() => { clearTimeout(timer); this.pendingBytes -= bytes.length; this.pending.delete(job); });
    this.pending.add(job);
  }
  private flush(domain: 'worklet_output' | 'listener_delivery'): void {
    const state = this.streams[domain];
    if (state.samples) this.hash(domain, state.bytes.slice(0, state.samples * 4), state.samples,
      { complete: state.complete, spans: state.spans }, state.atMs);
    state.bytes.fill(0); state.samples = 0; state.spans = []; state.complete = true;
  }
  decode(frame: Float32Array, final: boolean): void {
    const meta = this.metadata(frame);
    if (this.problems.has('hash-unavailable') || this.problems.has('overflow')) return;
    if (this.pendingBytes + frame.byteLength > MAX_PENDING_BYTES) { this.incomplete('overflow'); return; }
    this.hash(final ? 'final_decode_input' : 'live_decode_input', canonicalBytes(frame), frame.length, meta, performance.now());
  }
  closeWorklet(frameCount?: number, sampleCount?: number): void {
    if (!this.workletClosed) {
      if (!Number.isSafeInteger(frameCount) || !Number.isSafeInteger(sampleCount)
        || frameCount !== this.sequence || sampleCount !== this.sourceSamples) this.incomplete('worklet-metadata');
      this.workletClosed = true; this.flush('worklet_output');
    }
  }
  closeListener(): void { if (!this.listenerClosed) { this.listenerClosed = true; this.flush('listener_delivery'); } }
  async read(): Promise<unknown> {
    await Promise.all([...this.pending]);
    // Active/in-flight captures are explicitly incomplete, never a complete receipt.
    const domains: PcmDomain[] = ['worklet_output', 'listener_delivery', 'live_decode_input', 'final_decode_input'];
    const complete = this.workletClosed && this.listenerClosed && this.pending.size === 0 && this.problems.size === 0
      && domains.every(domain => this.receipts.some(r => r.domain === domain && r.samples > 0))
      && this.receipts.every(r => r.status === 'hashed' && r.lineageComplete);
    return { schema: 'speaksharp.pcm-boundaries.v1', captureId: this.captureId, sampleRateHz: this.sampleRate,
      createdAtMs: this.createdAtMs,
      format: 'Float32LE', streamDigestConstruction: 'ordered-one-second-chunk-SHA256-with-final-short-chunk',
      decodeDigestConstruction: 'SHA256-of-each-complete-submitted-Float32LE-buffer',
      meaning: 'observed-boundary-inputs-not-proof-of-recognizer-output-or-accepted-focus-points',
      complete, workletClosed: this.workletClosed, listenerClosed: this.listenerClosed,
      pendingHashes: this.pending.size, problems: [...this.problems].sort(), receipts: this.receipts.map(r => ({ ...r, spans: cloneSpans(r.spans) })) };
  }
}
export function beginPcmBoundaryCapture(sampleRate: number): PcmBoundaryCapture | undefined {
  if (typeof window === 'undefined' || window.__PRIVATE_PCM_RECEIPTS_ENABLED__ !== true) return undefined;
  if (typeof crypto.randomUUID !== 'function') return undefined;
  const capture = new PcmBoundaryCapture(crypto.randomUUID(), sampleRate);
  captures.push(capture);
  while (captures.length > 2) { const old = captures.shift(); old?.closeWorklet(); old?.closeListener(); }
  window.__PRIVATE_PCM_RECEIPTS__ = { read: () => Promise.all(captures.map(c => c.read())) };
  return capture;
}
export function captureForPcm(frame: Float32Array): PcmBoundaryCapture | undefined {
  const ids = new Set(lineage.get(frame)?.spans.map(s => s.captureId));
  if (ids.size !== 1) return undefined;
  return captures.find(c => ids.has(c.captureId));
}
