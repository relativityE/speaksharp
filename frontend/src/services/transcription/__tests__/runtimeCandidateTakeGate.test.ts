// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearRuntimeCandidateOverride,
    registerSwitchExecutor,
    runtimeCandidateOverride,
    switchCandidate,
} from '../runtimeCandidateSwitch';
import { evaluateRuntimeCandidateTakeGate } from '../runtimeCandidateTakeGate';
import { clearResolvedEngine, recordResolvedEngine } from '@/services/telemetry/runtimeAttribution';

const armComparison = async (candidate: 'v2:base.en' | 'v4:distil:q4' | 'moonshine:streaming-medium') => {
    registerSwitchExecutor({
        currentState: () => 'READY',
        teardown: async () => {},
        initialize: async () => {},
        observedCandidate: () => runtimeCandidateOverride(),
    });
    expect(await switchCandidate(candidate)).toEqual({ ok: true, candidate });
};

describe('#1426 take-boundary three-way identity gate', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
    });

    it('does not change ordinary configured-model starts', () => {
        recordResolvedEngine({ candidateId: 'v2:base.en' } as never);
        expect(evaluateRuntimeCandidateTakeGate()).toEqual({ enabled: false, allowed: true });
    });

    it('CASUALTY: a switched arm with no observed engine is refused', async () => {
        await armComparison('moonshine:streaming-medium');
        expect(evaluateRuntimeCandidateTakeGate()).toEqual({
            enabled: true,
            allowed: false,
            expected: 'moonshine:streaming-medium',
            requested: 'moonshine:streaming-medium',
            observed: null,
            refusal: 'observed_missing',
        });
    });

    it('CASUALTY: a forced requested/observed mismatch is refused', async () => {
        await armComparison('moonshine:streaming-medium');
        recordResolvedEngine({ candidateId: 'v2:base.en' } as never);
        expect(evaluateRuntimeCandidateTakeGate()).toMatchObject({
            enabled: true,
            allowed: false,
            expected: 'moonshine:streaming-medium',
            requested: 'moonshine:streaming-medium',
            observed: 'v2:base.en',
            refusal: 'observed_mismatch',
        });
    });

    it('POSITIVE CONTROL: all three terms agreeing admits the take', async () => {
        await armComparison('v4:distil:q4');
        recordResolvedEngine({ candidateId: 'v4:distil:q4' } as never);
        expect(evaluateRuntimeCandidateTakeGate()).toEqual({
            enabled: true,
            allowed: true,
            expected: 'v4:distil:q4',
            requested: 'v4:distil:q4',
            observed: 'v4:distil:q4',
            refusal: null,
        });
    });
});
