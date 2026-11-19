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
    ADVERSE_SUITE, MIC_BLOCKED_COPY, MODEL_FAILED_STATES, NO_TAKE_SAVED_ROW, downloadFailureVerdict, micDeniedVerdict, recoveredTakeVerdict,
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
        expect(micDeniedVerdict({ deniedAtAcquisition: true, blockedCopyShown: true, tab: idle }).status).toBe('PASS');
    });
    it('the browser never applied the denial → HOLD, not PASS', () => {
        expect(micDeniedVerdict({ deniedAtAcquisition: false, blockedCopyShown: true, tab: idle }).status).toBe('HOLD');
    });
    it('not stated, a recording shown, or a live track → FAIL', () => {
        expect(micDeniedVerdict({ deniedAtAcquisition: true, blockedCopyShown: false, tab: idle }).status).toBe('FAIL');
        expect(micDeniedVerdict({ deniedAtAcquisition: true, blockedCopyShown: true, tab: { ...idle, recorderVisible: true } }).status).toBe('FAIL');
        expect(micDeniedVerdict({ deniedAtAcquisition: true, blockedCopyShown: true, tab: { ...idle, liveTracks: 1 } }).status).toBe('FAIL');
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
    // #1593 cases 9–11: the journey lives in helpers/rwtAdverseJourney.ts and the variants in two spec files (mic denied needs
    // its own file-level `=deny` launch options). Every assertion below reads their union, so none is relaxed.
    const spec = ['tests/live/rwt-adverse-mic-model.live.spec.ts', 'tests/live/rwt-adverse-mic-denied.live.spec.ts',
        'tests/live/helpers/rwtAdverseJourney.ts'].map(src).join('\n');
    const written = `${spec}\n${src('tests/live/helpers/rwtDisposableAccount.ts')}`;

    it('the blocked copy and failed model states are the product\'s own', () => {
        // The live journey matches the blocked copy's opening; the product's copy keeps it verbatim and adds the how-to.
        expect(src('frontend/src/lib/micAccessErrors.ts')).toContain(`'${MIC_BLOCKED_COPY} `);
        expect(src('frontend/src/hooks/useSessionLifecycle.ts')).toContain('MIC_BLOCKED_MESSAGE');
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
                // J7.a: the no-take row is written through its shared constant (rwtAdverse.ts), so the acceptance and the journey share one name.
                const viaConstant = step === NO_TAKE_SAVED_ROW && spec.includes('receipt.row(NO_TAKE_SAVED_ROW,');
                expect({ suite, step, written: written.includes(`'${step}'`) || viaConstant || step === 'coaching request budget' }).toEqual({ suite, step, written: true });
            }
        }
        expect(spec).toContain('new RwtReceipt(`${ADVERSE_SUITE}-${variant}`)');
    });

    it('only the model assets or the network are altered, and each fault is removed before recovery', () => {
        // Sam's ACCEPT of PM 731eb5c0: each injection's own outcome is retained (it is awaited as `injected`).
        expect(spec).toContain("injected = await context.route(MODEL_ASSETS, (route) => route.abort('failed')).then(() => true, () => false);");
        // Sam, 2026-11-15 (#1868): going offline runs inside `runOfflineFault`, and its own outcome is retained there too.
        expect(spec).toContain('setOffline: (offline) => context.setOffline(offline).then(() => true, () => false),');
        expect(spec).toContain("if (variant === 'download-fails') await context.unroute(MODEL_ASSETS);");
        expect(spec).toContain('else await context.setOffline(false);');
        // #1593 (live case 12 + local probe): the denial is a real NotAllowedError (`=deny`). J7.a (PO and Sam, 2026-11-19):
        // nothing ever allows the microphone, in this browser or another one.
        expect(spec).toContain("a === '--use-fake-ui-for-media-stream' ? '--use-fake-ui-for-media-stream=deny' : a");
        const journey = src('tests/live/helpers/rwtAdverseJourney.ts');
        const deniedFrom = journey.indexOf("if (variant === 'mic-denied') {");
        const deniedBranch = journey.slice(deniedFrom, journey.indexOf('receipt.meta.samePageRecoveryReason', deniedFrom));
        expect(deniedFrom).toBeGreaterThan(0);
        for (const text of [src('tests/live/rwt-adverse-mic-denied.live.spec.ts'), deniedBranch]) {
            expect(text).not.toMatch(/chromium\.launch|grantPermissions\(|permissions: \['microphone'\]|signInOn\(|allowedPage/);
        }
        // The only site-permission call blocks the microphone, and nothing in the journey can set it to allowed.
        expect(journey).toContain("permission: { name: 'microphone' }, setting: 'denied',");
        expect(journey).not.toMatch(/setting: 'granted'|'granted' \| 'denied'|'denied' \| 'granted'/);
        expect(spec).not.toMatch(/route\.fulfill|addInitScript/);
    });
});
