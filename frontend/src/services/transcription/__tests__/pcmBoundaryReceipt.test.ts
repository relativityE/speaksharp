import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { URL as NodeURL } from 'node:url';
import { PcmBoundaryCapture, beginPcmBoundaryCapture, inheritPcmSlice, inheritPcmConcat, type PcmOperation } from '../pcmBoundaryReceipt';
import { concatenateFloat32Arrays } from '../utils/AudioProcessor';

const ID = '11111111-1111-4111-8111-111111111111';
interface Snapshot {
  complete: boolean; problems: string[]; pendingHashes: number;
  receipts: Array<{ domain: string; samples: number; sha256: string | null; status: string;
    spans: Array<{ captureId: string | null; start: number | null; samples: number; operations: string[] }> }>;
}
const snapshot = async (c: PcmBoundaryCapture) => await c.read() as Snapshot;
function fourDomains(frame = new Float32Array([1, -0, 0.5, -2])) {
  const c = new PcmBoundaryCapture(ID, 8000);
  c.worklet(frame, 0, 0); c.listener(frame); c.decode(frame, false); c.decode(frame, true);
  c.closeWorklet(1, frame.length); c.closeListener(); return c;
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals();
  delete window.__PRIVATE_PCM_RECEIPTS_ENABLED__; delete window.__PRIVATE_PCM_RECEIPTS__;
});

describe('actual PCM boundary ledger', () => {
  it('allocates and exposes nothing without explicit opt-in', () => {
    expect(beginPcmBoundaryCapture(16000)).toBeUndefined();
    expect(window.__PRIVATE_PCM_RECEIPTS__).toBeUndefined();
  });
  it('rejects unvalidated caller identity without retaining its text', () => {
    expect(() => new PcmBoundaryCapture('PRIVATE-TEXT', 16000)).toThrow('PCM_RECEIPT_IDENTITY_INVALID');
  });
  it('hashes four actual byte domains in Float32LE without a WAV header', async () => {
    const c = fourDomains(), result = await snapshot(c);
    const expected = createHash('sha256').update(Buffer.from([0, 0, 128, 63, 0, 0, 0, 128, 0, 0, 0, 63, 0, 0, 0, 192])).digest('hex');
    expect(result.complete).toBe(true); expect(result.pendingHashes).toBe(0);
    expect(result.receipts.map(r => r.domain).sort()).toEqual(['final_decode_input', 'listener_delivery', 'live_decode_input', 'worklet_output']);
    for (const row of result.receipts) { expect(row.sha256).toBe(expected); expect(row.samples).toBe(4); }
    expect(Object.keys(result)).not.toContain('audio');
    for (const row of result.receipts) expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['audio', 'transcript', 'buffer']));
  });
  it('preserves exact NaN payload bits, signed zero and a nonzero view offset', async () => {
    const raw = new ArrayBuffer(16), view = new DataView(raw);
    const little = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;
    view.setUint32(4, 0x7fc01234, little); view.setUint32(8, 0x80000000, little);
    const expected = createHash('sha256').update(Buffer.from([0x34, 0x12, 0xc0, 0x7f, 0, 0, 0, 0x80])).digest('hex');
    for (const row of (await snapshot(fourDomains(new Float32Array(raw, 4, 2)))).receipts) expect(row.sha256).toBe(expected);
  });
  it('does not qualify an empty, active or missing-domain capture', async () => {
    const c = new PcmBoundaryCapture(ID, 8000);
    expect((await snapshot(c)).complete).toBe(false);
    c.worklet(new Float32Array([1]), 0, 0); c.closeWorklet(1, 1); c.closeListener();
    expect((await snapshot(c)).complete).toBe(false);
  });
  it('detects a dropped first worklet frame and a mismatched final producer watermark', async () => {
    const c = new PcmBoundaryCapture(ID, 8000), frame = new Float32Array([1]);
    c.worklet(frame, 1, 1); c.listener(frame); c.decode(frame, false); c.decode(frame, true);
    c.closeWorklet(3, 3); c.closeListener(); const result = await snapshot(c);
    expect(result.complete).toBe(false); expect(result.problems).toEqual(expect.arrayContaining(['worklet-gap', 'worklet-metadata']));
  });
  it('rejects frames after closure without retaining bytes, emitting receipts or advancing counters', async () => {
    const c = new PcmBoundaryCapture(ID, 8000), frame = new Float32Array([1]);
    c.worklet(frame, 0, 0); c.listener(frame); c.closeWorklet(1, 1); c.closeListener();
    const before = await snapshot(c);
    const counters = c as unknown as { sequence: number; sourceSamples: number };
    const beforeCounters = { sequence: counters.sequence, sourceSamples: counters.sourceSamples };

    const late = new Float32Array(8000).fill(2);
    c.worklet(late, 1, 1); c.listener(late);
    const after = await snapshot(c);

    expect(after.problems).toContain('late-frame');
    expect(after.receipts).toEqual(before.receipts);
    expect({ sequence: counters.sequence, sourceSamples: counters.sourceSamples }).toEqual(beforeCounters);
  });
  it('missing watermark cannot become proof even with all hashes', async () => {
    const c = new PcmBoundaryCapture(ID, 8000), frame = new Float32Array([1]);
    c.worklet(frame, 0, 0); c.listener(frame); c.decode(frame, false); c.decode(frame, true);
    c.closeWorklet(); c.closeListener(); expect((await snapshot(c)).complete).toBe(false);
  });
  it('retains different listener bytes instead of reusing a producer hash', async () => {
    const frame = new Float32Array([1, 2]), c = new PcmBoundaryCapture(ID, 8000);
    c.worklet(frame, 0, 0); frame[0] = 99; c.listener(frame); c.decode(frame, false); c.decode(frame, true);
    c.closeWorklet(1, 2); c.closeListener(); const result = await snapshot(c);
    expect(result.receipts.find(r => r.domain === 'worklet_output')?.sha256).not.toBe(result.receipts.find(r => r.domain === 'listener_delivery')?.sha256);
    // Complete observations can expose an audio mismatch; they are not a product PASS.
    expect(result.complete).toBe(true);
  });
  it('maps exact trimmed and repeated source ranges through copy, retry and concatenation', async () => {
    const frame = new Float32Array(Array.from({ length: 12 }, (_, i) => i)), c = new PcmBoundaryCapture(ID, 8000);
    c.worklet(frame, 0, 0); c.listener(frame);
    const trimmed = inheritPcmSlice(frame, frame.slice(4, 10), 4, 'utterance-trim');
    const tail = inheritPcmSlice(trimmed, trimmed.slice(-2), -2, 'retry-tail');
    const combined = inheritPcmConcat(concatenateFloat32Arrays([tail, trimmed]), [tail, trimmed], 'retry-concat');
    c.decode(combined, false); c.decode(trimmed, true); c.closeWorklet(1, 12); c.closeListener();
    const result = await snapshot(c), live = result.receipts.find(r => r.domain === 'live_decode_input');
    expect(result.complete).toBe(true);
    expect(live?.spans.map(s => [s.start, s.samples])).toEqual([[8, 2], [4, 6]]);
    expect(live?.spans[0].operations).toEqual(['worklet', 'utterance-trim', 'retry-tail', 'retry-concat']);
    expect(result.receipts.find(r => r.domain === 'final_decode_input')?.spans.map(s => [s.start, s.samples])).toEqual([[4, 6]]);
  });
  it('an untracked copy is incomplete rather than guessed from equal samples', async () => {
    const frame = new Float32Array([1]), c = new PcmBoundaryCapture(ID, 8000);
    c.worklet(frame, 0, 0); c.listener(frame); c.decode(frame.slice(), false); c.decode(frame, true);
    c.closeWorklet(1, 1); c.closeListener(); const result = await snapshot(c);
    expect(result.complete).toBe(false); expect(result.problems).toContain('missing-lineage');
  });
  it('does not echo arbitrary runtime operation strings', async () => {
    const frame = new Float32Array([1]), c = new PcmBoundaryCapture(ID, 8000);
    c.worklet(frame, 0, 0); c.listener(frame);
    const unknown = inheritPcmSlice(frame, frame.slice(), 0, 'PRIVATE-UNREVIEWED-STRING' as unknown as PcmOperation);
    c.decode(unknown, false); c.decode(frame, true); c.closeWorklet(1, 1); c.closeListener(); const result = await snapshot(c);
    expect(result.complete).toBe(false); expect(JSON.stringify(result)).not.toContain('PRIVATE-UNREVIEWED-STRING');
  });
  it('fixed one-second stream chunks include the exact final short span', async () => {
    const frame = new Float32Array(8005).fill(0.25), result = await snapshot(fourDomains(frame));
    const rows = result.receipts.filter(r => r.domain === 'worklet_output');
    expect(result.complete).toBe(true); expect(rows.map(r => r.samples)).toEqual([8000, 5]);
    expect(rows.map(r => r.spans.map(s => [s.start, s.samples]))).toEqual([[[0, 8000]], [[8000, 5]]]);
  });
  it('digest rejection fails closed without returning an error payload', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: () => Promise.reject(new Error('PRIVATE-HASH-FAILURE')) } });
    const result = await snapshot(fourDomains());
    expect(result.complete).toBe(false); expect(result.problems).toContain('hash-unavailable');
    expect(JSON.stringify(result)).not.toContain('PRIVATE-HASH-FAILURE');
  });
  it('hung hashing has a bounded read and cannot repeatedly queue new raw copies', async () => {
    vi.useFakeTimers(); vi.stubGlobal('crypto', { subtle: { digest: () => new Promise<ArrayBuffer>(() => {}) } });
    const c = fourDomains(); await vi.advanceTimersByTimeAsync(5001); const result = await snapshot(c);
    expect(result.complete).toBe(false); expect(result.pendingHashes).toBe(0);
    const count = result.receipts.length; c.decode(new Float32Array([2]), false);
    expect((await snapshot(c)).receipts).toHaveLength(count);
  });
  it('fails closed when queued digest bytes exceed the bounded pending-byte budget', async () => {
    vi.useFakeTimers(); vi.stubGlobal('crypto', { subtle: { digest: () => new Promise<ArrayBuffer>(() => {}) } });
    const frame = new Float32Array(262_144).fill(0.25), c = new PcmBoundaryCapture(ID, 8000);
    c.worklet(frame, 0, 0);
    // The worklet stream contributes one MiB. Repeated decode submissions remain pending;
    // the first submission beyond 32 MiB must be refused instead of retaining another copy.
    for (let i = 0; i < 33; i++) c.decode(frame, false);
    c.listener(frame); c.decode(frame, true); c.closeWorklet(1, frame.length); c.closeListener();
    await vi.advanceTimersByTimeAsync(5001); const result = await snapshot(c);
    expect(result.complete).toBe(false); expect(result.problems).toContain('overflow');
    expect(result.pendingHashes).toBe(0);
  });
  it('fails closed when lineage would require more than the bounded span count', async () => {
    const c = new PcmBoundaryCapture(ID, 8000), parts: Float32Array[] = [];
    for (let i = 0; i < 257; i++) {
      const frame = new Float32Array([i]); c.worklet(frame, i, i); c.listener(frame); parts.push(frame);
    }
    const reversed = [...parts].reverse();
    const joined = inheritPcmConcat(concatenateFloat32Arrays(reversed), reversed, 'live-concat');
    c.decode(joined, false); c.decode(parts[0], true); c.closeWorklet(257, 257); c.closeListener();
    const result = await snapshot(c);
    expect(result.complete).toBe(false); expect(result.problems).toContain('missing-lineage');
    const live = result.receipts.find(r => r.domain === 'live_decode_input');
    expect(live?.spans.length).toBeLessThanOrEqual(256);
  });
  it('keeps only the two newest successor captures and closes displaced capture state', async () => {
    window.__PRIVATE_PCM_RECEIPTS_ENABLED__ = true;
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    vi.stubGlobal('crypto', { subtle: webcrypto.subtle, randomUUID: vi.fn(() => ids.shift()!) });
    const first = beginPcmBoundaryCapture(8000), second = beginPcmBoundaryCapture(8000), third = beginPcmBoundaryCapture(8000);
    expect(first && second && third).toBeTruthy();
    const retained = await window.__PRIVATE_PCM_RECEIPTS__?.read() as Array<{ captureId: string }>;
    expect(retained.map(row => row.captureId)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    const displaced = await first?.read() as { workletClosed: boolean; listenerClosed: boolean; complete: boolean };
    expect(displaced).toMatchObject({ workletClosed: true, listenerClosed: true, complete: false });
  });
});

it('runs the actual worklet: default PCM unchanged, diagnostic transfer and final watermark truthful', async () => {
  const source = readFileSync(new NodeURL('../../../../public/audio/audio-processor.worklet.js', import.meta.url), 'utf8');
  const channels: MessageChannel[] = [];
  type Packet = Float32Array | { kind: string; sequence?: number; sourceStart?: number; pcm?: Float32Array; frames?: number; samples?: number };
  const make = (diagnostic: boolean) => {
    const messages: Packet[] = []; let Constructor: new (options: unknown) => {
      process: (input: Float32Array[][]) => boolean; port: { onmessage?: (event: { data: unknown }) => void }
    };
    class Base {
      port = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
        postMessage(value: Packet, transfer: ArrayBuffer[] = []) {
          const channel = new MessageChannel(); channels.push(channel);
          channel.port1.postMessage(value, transfer); messages.push(receiveMessageOnPort(channel.port2)?.message as Packet);
        } };
    }
    runInNewContext(source, { AudioWorkletProcessor: Base, Float32Array, sampleRate: 48000,
      registerProcessor: (_name: string, value: typeof Constructor) => { Constructor = value; } });
    const processor = new Constructor!({ processorOptions: { targetSampleRate: 16000, pcmReceipt: diagnostic } });
    return { processor, messages };
  };
  try {
    const normal = make(false), diagnostic = make(true), input = new Float32Array(128).fill(0.125);
    for (let i = 0; i < 3; i++) { normal.processor.process([[input]]); diagnostic.processor.process([[input]]); }
    const c = new PcmBoundaryCapture(ID, 16000); let samples = 0;
    diagnostic.messages.forEach((packet, index) => {
      if (packet instanceof Float32Array || !packet.pcm) throw new Error('missing diagnostic envelope');
      expect(packet.kind).toBe('speaksharp-pcm-frame-v1'); expect(packet.sequence).toBe(index); expect(packet.sourceStart).toBe(samples);
      expect(Array.from(packet.pcm)).toEqual(Array.from(normal.messages[index] as Float32Array));
      c.worklet(packet.pcm, packet.sequence!, packet.sourceStart!); c.listener(packet.pcm); c.decode(packet.pcm, false); c.decode(packet.pcm, true);
      samples += packet.pcm.length;
    });
    diagnostic.processor.port.onmessage?.({ data: { kind: 'speaksharp-pcm-finish-v1' } });
    const end = diagnostic.messages[diagnostic.messages.length - 1];
    if (!end || end instanceof Float32Array) throw new Error('missing producer watermark');
    expect(end).toEqual({ kind: 'speaksharp-pcm-closed-v1', frames: 3, samples });
    c.closeWorklet(end.frames, end.samples); c.closeListener(); expect((await snapshot(c)).complete).toBe(true);
    expect(diagnostic.processor.process([[input]])).toBe(false); expect(diagnostic.messages).toHaveLength(4);
    expect(normal.processor.port.onmessage).toBeUndefined();
  } finally { for (const { port1, port2 } of channels) { port1.close(); port2.close(); } }
});
