// The offline control adapter is the evaluator command's deterministic seam (modelEvaluatorCommand.test.ts loads it in a spawned
// CLI). This drives the same factory in-process: initialize, decode, finalize and dispose, and each injected failure.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createAdapter } from '../fixtures/model-evaluator/offline-control-adapter';

const expected = { engine: 'control', modelId: 'offline', revision: null, assetDigest: 'a'.repeat(64), runtime: 'none', backend: 'wasm' };
const context = (options: Record<string, unknown> = {}) =>
  ({ baseUrl: 'http://127.0.0.1:5173', expected, repositoryRoot: '/nonexistent', options, headless: true, expectedGpuVendor: null,
    source: null }) as unknown as Parameters<typeof createAdapter>[0];

describe('offline control adapter', () => {
  it('initializes to the expected identity, hashes exactly the decoded PCM and refuses finalize without input', async () => {
    const adapter = createAdapter(context({ observedBackend: 'webgpu' }));
    expect(await adapter.initialize()).toEqual({ ...expected, backend: 'webgpu' });
    await expect(adapter.finalize()).rejects.toThrow('no_control_input');
    const pcm = new Float32Array([0.25, -0.5, 1]);
    await adapter.decode(pcm);
    const result = await adapter.finalize();
    expect(result.transcript).toBe('hello world');
    expect(result.inputSha256).toBe(createHash('sha256').update(Buffer.from(pcm.buffer)).digest('hex'));
    await adapter.dispose();
    await expect(adapter.finalize()).rejects.toThrow('no_control_input');
  });
  it('each injected failure surfaces as its own code', async () => {
    await expect(createAdapter(context({ initFailure: true })).initialize()).rejects.toThrow('offline_init_failure');
    await expect(createAdapter(context({ decodeFailure: true })).decode(new Float32Array(1))).rejects.toThrow('offline_decode_failure');
    await expect(createAdapter(context({ disposeFailure: true })).dispose()).rejects.toThrow('offline_dispose_failure');
  });
});
