/**
 * #1263 — the switch must not EXIST on a build a real user receives.
 *
 * `switchCandidate` already refuses outside an internal build, but a refusing function still present on
 * `window` is a surface: it advertises the mechanism and it is one edit away from working. These prove
 * the production build never installs it at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installRuntimeCandidateSwitch } from '../installRuntimeSwitch';
import { registerSwitchExecutor, clearRuntimeCandidateOverride } from '../runtimeCandidateSwitch';
import { recordResolvedEngine, clearResolvedEngine } from '@/services/telemetry/runtimeAttribution';

interface SwitchWindow { __SS_SWITCH_CANDIDATE__?: unknown; __SS_ACTIVE_CANDIDATE__?: unknown }
const w = () => window as unknown as SwitchWindow;

describe('installing the in-page model switch', () => {
    beforeEach(() => {
        delete w().__SS_SWITCH_CANDIDATE__;
        delete w().__SS_ACTIVE_CANDIDATE__;
        clearRuntimeCandidateOverride();
        clearResolvedEngine();
        registerSwitchExecutor(null);
    });
    afterEach(() => {
        clearResolvedEngine();
        delete w().__SS_SWITCH_CANDIDATE__;
        delete w().__SS_ACTIVE_CANDIDATE__;
        registerSwitchExecutor(null);
    });

    it('CASUALTY: a PRODUCTION build installs NOTHING on window', () => {
        expect(installRuntimeCandidateSwitch({})).toBe(false);
        expect(w().__SS_SWITCH_CANDIDATE__).toBeUndefined();
        expect(w().__SS_ACTIVE_CANDIDATE__).toBeUndefined();
    });

    it('CASUALTY: a non-"true" value does not count as internal', () => {
        for (const v of ['TRUE', '1', 'yes', true as unknown as string]) {
            expect(installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: v })).toBe(false);
            expect(w().__SS_SWITCH_CANDIDATE__).toBeUndefined();
        }
    });

    type Read = () => { requested: string; observed: string | null; matches: boolean; source: string };

    it('CASUALTY: before any engine resolves, OBSERVED is null and matches is FALSE', () => {
        // The wrapper must never record a model from the request alone. Reporting the selection as
        // though it were the running engine is how a v2 recording gets labelled with another model.
        expect(installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' })).toBe(true);
        const read = w().__SS_ACTIVE_CANDIDATE__ as Read;
        expect(read()).toEqual({ requested: 'v2:base.en', observed: null, matches: false, source: 'config' });
    });

    it('CASUALTY: a MISMATCH between request and running engine is reported, not hidden', () => {
        installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' });
        // The engine resolved something other than the configured selection.
        recordResolvedEngine({ candidateId: 'v4:base:q4', modelIdentity: { engine: 'transformers-js-v4' } });
        const r = (w().__SS_ACTIVE_CANDIDATE__ as Read)();
        expect(r.requested).toBe('v2:base.en');
        expect(r.observed).toBe('v4:base:q4');
        expect(r.matches).toBe(false);
    });

    it('POSITIVE CONTROL: agreement reports matches = true', () => {
        installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' });
        recordResolvedEngine({ candidateId: 'v2:base.en', modelIdentity: { engine: 'transformers-js' } });
        const r = (w().__SS_ACTIVE_CANDIDATE__ as Read)();
        expect(r).toEqual({ requested: 'v2:base.en', observed: 'v2:base.en', matches: true, source: 'config' });
    });
});
