import { describe, expect, it, vi } from 'vitest';
import { readDeployedCoachingModel } from '../../scripts/lib/coaching-model-readback.mjs';

const projectRef = 'abcdefghijklmnopqrst';
const url = 'https://' + projectRef + '.supabase.co';
const mockArgs = { url, projectRef, serviceKey: 'synthetic-not-a-key' };
describe('deployed coaching model readback', () => {
  it('reads the deployed selection once without running a generation request', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ model: 'gemini-3.5-flash-lite', readiness: 'verified' }));
    expect(await readDeployedCoachingModel({ ...mockArgs, fetchImpl })).toEqual({ model: 'gemini-3.5-flash-lite', readiness: 'verified' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(url + '/functions/v1/get-ai-suggestions',
      expect.objectContaining({ redirect: 'error', body: '{"operation":"active_model_readback"}' }));
  });
  it('preserves the selected production model and backoff status without a provider probe', async () => {
    const model = 'gemini-4-hydrogen';
    const fetchImpl = vi.fn(async () => Response.json({ model, readiness: 'backoff' }));
    expect(await readDeployedCoachingModel({ ...mockArgs, fetchImpl })).toEqual({ model, readiness: 'backoff' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('never sends the service key to a mismatched host and never invents a selection', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ model: 'gemini-do-not-show=untrusted', readiness: 'verified' }));
    expect(await readDeployedCoachingModel({ ...mockArgs, fetchImpl, url: 'https://elsewhere.example' })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readDeployedCoachingModel({ ...mockArgs, fetchImpl })).toBeNull();
  });
});
