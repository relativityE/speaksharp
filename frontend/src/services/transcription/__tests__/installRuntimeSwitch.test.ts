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

interface SwitchWindow { __SS_SWITCH_CANDIDATE__?: unknown; __SS_ACTIVE_CANDIDATE__?: unknown }
const w = () => window as unknown as SwitchWindow;

describe('installing the in-page model switch', () => {
    beforeEach(() => {
        delete w().__SS_SWITCH_CANDIDATE__;
        delete w().__SS_ACTIVE_CANDIDATE__;
        clearRuntimeCandidateOverride();
        registerSwitchExecutor(null);
    });
    afterEach(() => {
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

    it('an INTERNAL build installs the switch and reports what is running', () => {
        expect(installRuntimeCandidateSwitch({ VITE_INTERNAL_BUILD: 'true' })).toBe(true);
        expect(typeof w().__SS_SWITCH_CANDIDATE__).toBe('function');
        const read = w().__SS_ACTIVE_CANDIDATE__ as () => { candidate: string; source: string };
        // With nothing switched, the CONFIG is what is running, and it says so.
        expect(read()).toEqual({ candidate: 'v2:base.en', source: 'config' });
    });
});
