/**
 * #1402 — one immutable capability reading governs refusal, availability and runtime selection.
 *
 * The manufactured-disagreement case is the point. Two independent async probes could return different
 * answers for the same init, and the resolution was silent: the refusal gate admitted a WebGPU-only
 * candidate, the resolver fell to the v2 floor, and the switch reported success for the candidate that
 * had been requested while Whisper decoded the audio.
 */
import { describe, expect, it, vi } from 'vitest';
import { captureCapabilities } from '../capabilitySnapshot';
import { resolvePrivateRuntimePath } from '../utils/privateRuntimePath';

describe('one snapshot, taken once', () => {
    it('POSITIVE CONTROL: a detected accelerator is reported once and frozen', async () => {
        const snap = await captureCapabilities(async () => ({ supported: true }) as never);
        expect(snap.webgpuAvailable).toBe(true);
        expect(snap.reason).toBe('detected');
        expect(Object.isFrozen(snap), 'a mutable snapshot is the same bug with extra steps').toBe(true);
    });

    it('CASUALTY: a probe that THROWS fails closed rather than reading as unknown', async () => {
        // Treating an error as permission is how a WebGPU-only candidate ends up decoding on WASM.
        const snap = await captureCapabilities(async () => { throw new Error('adapter lost'); });
        expect(snap.webgpuAvailable).toBe(false);
        expect(snap.reason).toBe('probe_threw');
    });

    it('CASUALTY: the probe is consulted exactly ONCE per snapshot', async () => {
        const detect = vi.fn(async () => ({ supported: true }) as never);
        await captureCapabilities(detect);
        expect(detect).toHaveBeenCalledTimes(1);
    });

    it('CASUALTY: the resolver honours the snapshot and does NOT probe again', async () => {
        // The manufactured disagreement: the snapshot says present, the ambient probe would say absent.
        // Before, the resolver's own probe won and produced a v2 decision under a v4 request.
        const decision = await resolvePrivateRuntimePath({
            webgpuPromotionAllowed: false,
            turboModelCached: false,
            capabilities: { webgpuAvailable: true },
            v4: { enabled: true, distilEnabled: false, variant: 'distil_q4', allowWithoutWebGPU: false },
        });
        expect(decision.provider, 'a v4 request must not resolve to the v2 provider').toBe('transformers-js-v4');
        expect(decision.v4Variant).toBe('distil_q4');
        expect(decision.webgpuAvailable).toBe(true);
    });

    it('CASUALTY: a snapshot saying ABSENT keeps a WebGPU-only variant off the accelerator path', async () => {
        // Fail closed in the other direction too: the snapshot is authoritative both ways, so an absent
        // accelerator cannot be overridden by a more optimistic second opinion.
        const decision = await resolvePrivateRuntimePath({
            webgpuPromotionAllowed: false,
            turboModelCached: false,
            capabilities: { webgpuAvailable: false },
            v4: { enabled: true, distilEnabled: false, variant: 'distil_q4', allowWithoutWebGPU: false },
        });
        expect(decision.provider).toBe('transformers-js');
        expect(decision.webgpuAvailable).toBe(false);
    });
});
