// @vitest-environment node
/**
 * #1258 R3 (row 17) — the adverse microphone/model live spec's verdicts, each with the failing controls a real run could
 * produce, and the guards that keep the spec, the acceptance map and the product copy in step.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    ADVERSE_SUITE, MIC_BLOCKED_COPY, MODEL_FAILED_STATES, downloadFailureVerdict, micDeniedVerdict, recoveredTakeVerdict,
} from '../live/helpers/rwtAdverse';
import type { TabState } from '../live/helpers/rwtAbandonTakeover';
import {
    ADVERSE_DOWNLOAD_FAILS_SUITE, ADVERSE_MIC_DENIED_SUITE, ADVERSE_OFFLINE_SUITE, requiredAutomatedRows, requiredHumanObservations,
} from '../live/helpers/rwtAcceptance';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const idle: TabState = { runtimeState: 'READY', recorderVisible: false, liveTracks: 0 };

describe('micDeniedVerdict — a blocked microphone is stated, and nothing records', () => {
    it('denial applied, stated, nothing recording → PASS', () => {
        expect(micDeniedVerdict({ denialApplied: true, blockedCopyShown: true, tab: idle }).status).toBe('PASS');
    });
    it('the browser never applied the denial → HOLD, not PASS', () => {
        expect(micDeniedVerdict({ denialApplied: false, blockedCopyShown: true, tab: idle }).status).toBe('HOLD');
    });
    it('not stated, a recording shown, or a live track → FAIL', () => {
        expect(micDeniedVerdict({ denialApplied: true, blockedCopyShown: false, tab: idle }).status).toBe('FAIL');
        expect(micDeniedVerdict({ denialApplied: true, blockedCopyShown: true, tab: { ...idle, recorderVisible: true } }).status).toBe('FAIL');
        expect(micDeniedVerdict({ denialApplied: true, blockedCopyShown: true, tab: { ...idle, liveTracks: 1 } }).status).toBe('FAIL');
    });
});

describe('downloadFailureVerdict — failed, never ready, Retry, still Private', () => {
    const ok = { exercised: true, statuses: ['download-required', 'loading', 'error'], finalStatus: 'error', retryOffered: true, mode: 'private' };
    it('the honest failure → PASS (error and init-failed alike)', () => {
        expect(downloadFailureVerdict(ok).status).toBe('PASS');
        expect(downloadFailureVerdict({ ...ok, finalStatus: 'init-failed' }).status).toBe('PASS');
    });
    it('the fault never reached the download → HOLD', () => {
        expect(downloadFailureVerdict({ ...ok, exercised: false }).status).toBe('HOLD');
    });
    it('a false ready, a non-failed end state, no Retry, or a switch away from Private → FAIL', () => {
        expect(downloadFailureVerdict({ ...ok, statuses: ['loading', 'ready', 'error'] }).detail).toMatch(/claimed the model was ready/);
        expect(downloadFailureVerdict({ ...ok, finalStatus: 'loading' }).status).toBe('FAIL');
        expect(downloadFailureVerdict({ ...ok, retryOffered: false }).status).toBe('FAIL');
        expect(downloadFailureVerdict({ ...ok, mode: 'cloud' }).detail).toMatch(/left Private/);
    });
});

describe('recoveredTakeVerdict — removing the cause recovers by the person\'s own action', () => {
    it('recorded and saved one completed session → PASS', () => {
        expect(recoveredTakeVerdict({ recorded: true, savedId: 's1', savedStatus: 'completed' }).status).toBe('PASS');
    });
    it('no recording, no bound save, or not completed → FAIL', () => {
        expect(recoveredTakeVerdict({ recorded: false, savedId: null, savedStatus: null }).status).toBe('FAIL');
        expect(recoveredTakeVerdict({ recorded: true, savedId: null, savedStatus: null }).status).toBe('FAIL');
        expect(recoveredTakeVerdict({ recorded: true, savedId: 's1', savedStatus: 'failed' }).status).toBe('FAIL');
    });
});

describe('guards — the spec, the acceptance map and the product stay in step', () => {
    const spec = src('tests/live/rwt-adverse-mic-model.live.spec.ts');
    const written = `${spec}\n${src('tests/live/helpers/rwtDisposableAccount.ts')}`;

    it('the blocked copy and failed model states are the product\'s own', () => {
        expect(src('frontend/src/hooks/useSessionLifecycle.ts')).toContain(`'${MIC_BLOCKED_COPY}'`);
        const card = src('frontend/src/components/session/MicCard.tsx');
        for (const state of MODEL_FAILED_STATES) expect(card).toContain(`privateModelStatus === '${state}'`);
        expect(card).toContain("modelError ? 'mic-retry'");
    });

    it('every suite is known, fully automated, and requires each row the spec writes plus its own cleanup', () => {
        for (const suite of [ADVERSE_MIC_DENIED_SUITE, ADVERSE_DOWNLOAD_FAILS_SUITE, ADVERSE_OFFLINE_SUITE]) {
            expect(suite.startsWith(`${ADVERSE_SUITE}-`)).toBe(true);
            expect(requiredHumanObservations({ suite } as never)).toEqual([]);
            const inv = requiredAutomatedRows(suite)!;
            expect(inv.required).toContain('run-owned cleanup');
            for (const step of inv.product) {
                expect({ suite, step, written: written.includes(`'${step}'`) || step === 'coaching request budget' }).toEqual({ suite, step, written: true });
            }
        }
        expect(spec).toContain('new RwtReceipt(`${ADVERSE_SUITE}-${variant}`)');
    });

    it('only the model assets or the network are altered, and each fault is removed before recovery', () => {
        expect(spec).toContain("await context.route(MODEL_ASSETS, (route) => route.abort('failed'));");
        expect(spec).toContain('await context.setOffline(true);');
        expect(spec).toContain("if (variant === 'download-fails') await context.unroute(MODEL_ASSETS);");
        expect(spec).toContain('else await context.setOffline(false);');
        expect(spec).toContain("await setSiteMicrophone(page, browser, 'granted');");
        expect(spec).not.toMatch(/route\.fulfill|addInitScript/);
    });
});
