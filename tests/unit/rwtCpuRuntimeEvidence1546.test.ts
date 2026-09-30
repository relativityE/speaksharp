// @vitest-environment node
/**
 * #1546 / #1258 — the model-identity row records the CPU engine's thread configuration as flat, content-free evidence so
 * the Open Mic rerun can be read against the thread policy that actually ran. It must not change the row's verdict.
 */
import { describe, expect, it } from 'vitest';
import { modelIdentityRow, RwtReceipt } from '../live/helpers/rwtJourney';

const identity = { engine: 'transformers-js', modelId: 'whisper-base.en', runtimeVersion: 'x', resolvedDevice: 'cpu', backend: 'wasm', fallbackOccurred: false };
const cpu = { hardwareConcurrency: 4, crossOriginIsolated: true, requestedThreads: 2, configuredThreads: 2, workerReportedThreads: null };

describe('#1546 model identity row carries CPU thread evidence', () => {
  it('adds flat cpu_* numbers and keeps the PASS verdict', () => {
    const receipt = new RwtReceipt('open-mic-first-session');
    modelIdentityRow(receipt, { mode: 'default', label: 'default' }, identity, 1234, cpu);
    const row = receipt.rows.find((r) => r.step === 'model identity');
    expect(row?.verdict).toBe('PASS');
    expect(row?.evidence).toMatchObject({
      cpu_hardwareConcurrency: 4, cpu_crossOriginIsolated: true, cpu_requestedThreads: 2, cpu_configuredThreads: 2, cpu_workerReportedThreads: null,
      modelId: 'whisper-base.en', acquisitionMs: 1234,
    });
    for (const v of Object.values(row?.evidence ?? {})) expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true);
  });

  it('without the runtime reading the row is unchanged (existing callers)', () => {
    const receipt = new RwtReceipt('open-mic-first-session');
    modelIdentityRow(receipt, { mode: 'default', label: 'default' }, identity, 1234);
    const row = receipt.rows.find((r) => r.step === 'model identity');
    expect(row?.verdict).toBe('PASS');
    expect(Object.keys(row?.evidence ?? {}).some((k) => k.startsWith('cpu_'))).toBe(false);
  });
});
