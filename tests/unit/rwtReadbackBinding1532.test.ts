// @vitest-environment node
/**
 * #1532 Codex P1 r4119969323 (PM RETURN 5866220417) — EACH READBACK STAGE SET IS BOUND TO THE JOURNEY THAT EXERCISED IT.
 *
 * A page reload mints a new journey id (journeyIdentity keeps it in memory). The full RWT suites record and save in
 * journey A, reload the Analytics detail (journey B), and share feedback there. Qualifying every observed journey against
 * the union of stages HOLDs every good run. The recording stages bind to the journey that emitted the saved take, and
 * `share_feedback` to the journey that emitted `feedback_submit`; any other journey is reported, never qualified.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { bindReadbackJourneys, runJourneyIds, takeStartedAfter } from '../live/helpers/rwtOracles';
import { exactlyOnceFamiliesForStages, requiredFamiliesForStages, REQUIRED_EVENT_FAMILIES } from '../../frontend/src/services/telemetry/completenessGate';
import { evaluateAttemptScopedDelivery } from '../../frontend/src/services/telemetry/deliveryReceiptGate';

const ev = (event: string, at: number, journeyId: string, trafficType = 'canary') => ({ event, at, journeyId, trafficType });
const RECORDING = ['session_during', 'session_after_open_mic'];
const REPEAT = ['session_during', 'session_after_open_mic'];

describe('bindReadbackJourneys', () => {
    it('#1258 (#1563): practice_again binds to the journey of the first canary press — and is not imposed when declared off or never pressed', () => {
        const events = [ev('session_saved', 1, 'A'), ev('saved_review_practice_action', 2, 'B'), ev('saved_review_practice_arrived', 3, 'B'), ev('feedback_submit', 4, 'B')];
        const on = bindReadbackJourneys(events, { recording: RECORDING, feedback: true, practiceAgain: true });
        expect(on.journeys.find((j) => j.journeyId === 'B')!.stages).toEqual(['share_feedback', 'practice_again']);
        expect(bindReadbackJourneys(events, { recording: RECORDING, feedback: true }).journeys.find((j) => j.journeyId === 'B')!.stages).toEqual(['share_feedback']);
        expect(bindReadbackJourneys([ev('session_saved', 1, 'A')], { recording: RECORDING, feedback: false, practiceAgain: true }).missingBindings).toEqual(['practice_again']);
    });

    it('CASUALTY: recording in journey A and feedback after a reload in journey B are bound separately', () => {
        const events = [
            ev('session_started', 1, 'A'), ev('session_saved', 2, 'A'),
            ev('saved_review_revisited', 3, 'B'), ev('feedback_submit', 4, 'B'),
        ];
        expect(bindReadbackJourneys(events, { recording: RECORDING, feedback: true })).toEqual({
            journeys: [{ journeyId: 'A', stages: RECORDING, firstDownload: true }, { journeyId: 'B', stages: ['share_feedback'] }],
            reportedJourneyIds: [], missingBindings: [],
        });
    });

    it('CONTROL: one journey that saved and shared feedback carries both stage sets', () => {
        const events = [ev('session_saved', 1, 'A'), ev('feedback_submit', 2, 'A')];
        expect(bindReadbackJourneys(events, { recording: RECORDING, feedback: true }).journeys)
            .toEqual([{ journeyId: 'A', stages: [...RECORDING, 'share_feedback'], firstDownload: true }]);
    });

    it('other canary journeys (Practice again, analytics only) are reported, never qualified; user traffic is ignored', () => {
        const events = [
            ev('journey_step', 0, 'U', 'user'),
            ev('session_saved', 1, 'A'), ev('feedback_submit', 2, 'B'),
            ev('session_saved', 3, 'C'), ev('journey_step', 4, 'D'),
        ];
        const r = bindReadbackJourneys(events, { recording: RECORDING, feedback: true });
        expect(r.journeys.map((j) => j.journeyId)).toEqual(['A', 'B']);
        expect(r.reportedJourneyIds).toEqual(['C', 'D']);
        expect(runJourneyIds(r)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('the recording binding is the FIRST saved take (the one the suite verifies), not a later Practice-again take', () => {
        const events = [ev('session_saved', 9, 'LATER'), ev('session_saved', 1, 'FIRST')];
        expect(bindReadbackJourneys(events, { recording: RECORDING, feedback: false }).journeys)
            .toEqual([{ journeyId: 'FIRST', stages: RECORDING, firstDownload: true }]);
    });

    it('#1258 successor: the recording journey carries its declared product into received coaching readback', () => {
        const take = { attemptId: 'attempt-a', journeyId: 'A' };
        expect(bindReadbackJourneys([ev('session_saved', 1, 'A')], {
            recording: RECORDING, feedback: false, takes: { first: take }, product: 'open_mic',
        }).journeys).toEqual([{ journeyId: 'A', stages: RECORDING, firstDownload: true, attemptIds: ['attempt-a'], product: 'open_mic' }]);
    });

    it('CASUALTY: a required binding with no anchor event is reported missing (fail closed), never silently dropped', () => {
        const r = bindReadbackJourneys([ev('session_saved', 1, 'A')], { recording: RECORDING, feedback: true });
        expect(r.missingBindings).toEqual(['share_feedback']);
        expect(r.journeys).toEqual([{ journeyId: 'A', stages: RECORDING, firstDownload: true }]);
        expect(bindReadbackJourneys([], { recording: RECORDING, feedback: false }).missingBindings).toEqual(['recording']);
    });

    it('a suite that declares no stages binds nothing and reports every canary journey', () => {
        const r = bindReadbackJourneys([ev('journey_step', 1, 'A'), ev('journey_step', 2, 'B')], { recording: [], feedback: false });
        expect(r).toEqual({ journeys: [], reportedJourneyIds: ['A', 'B'], missingBindings: [] });
    });
});

/**
 * Workflow contract: the ACTUAL `rc-gates.yml` readback step, executed with `pnpm` and `sleep` stubbed, must pass each
 * bound journey only its own stages and fail closed on a missing binding.
 */
describe('rc-gates RWT readback step', () => {
    const workflow = parse(readFileSync(resolve(__dirname, '../../.github/workflows/rc-gates.yml'), 'utf8'));
    const step = Object.values(workflow.jobs as Record<string, { steps?: Array<{ name?: string; run?: string }> }>)
        .flatMap((job) => job.steps ?? []).find((s) => s.name === 'RWT telemetry readback (PostHog, per journey)');

    const runStep = (readback: unknown, hold = '', fail = '') => {
        const dir = mkdtempSync(join(tmpdir(), 'rwt-readback-'));
        const bin = join(dir, 'bin');
        mkdirSync(join(dir, 'test-results', 'rwt'), { recursive: true });
        mkdirSync(bin);
        writeFileSync(join(dir, 'test-results', 'rwt', 'suite.receipt.json'), JSON.stringify({ suite: 'suite', readback }));
        writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/env bash\nj=""; t=""; while [ $# -gt 0 ]; do case "$1" in --journey-id) j="$2"; shift;; --traffic-type) t="$2"; shift;; esac; shift; done\necho "$t|$j|${QUALIFICATION_STAGES:-}" >> "$STUB_LOG"\necho "$j|${TELEMETRY_READBACK_ACQUISITION_RECEIPT:-}|${QUALIFICATION_ATTEMPT_IDS:-}" >> "$STUB_LOG.acq"\necho "$j|${QUALIFICATION_PRODUCT:-}|${QUALIFICATION_ATTEMPT_IDS:-}" >> "$STUB_LOG.coach"\ncase " ${STUB_FAIL:-} " in *" $j "*) exit 3;; esac\ncase " ${STUB_HOLD:-} " in *" $j "*) exit 1;; esac\n');
        writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
        chmodSync(join(bin, 'pnpm'), 0o755); chmodSync(join(bin, 'sleep'), 0o755);
        const log = join(dir, 'calls.log');
        writeFileSync(log, '');
        let exit = 0;
        try {
            execFileSync('bash', ['-c', step!.run!], { cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, STUB_HOLD: hold, STUB_FAIL: fail, RELEASE_SHA: 'a'.repeat(40) }, stdio: 'pipe' });
        } catch (e) { exit = (e as { status?: number }).status ?? 1; }
        const verdictPath = join(dir, 'test-results', 'rwt', 'suite.readback-verdicts.json');
        let verdicts: unknown = null;
        try { verdicts = JSON.parse(readFileSync(verdictPath, 'utf8')); } catch { verdicts = null; }
        let acquisition: string[] = [];
        try { acquisition = readFileSync(`${log}.acq`, 'utf8').trim().split('\n').filter(Boolean); } catch { acquisition = []; }
        let coaching: string[] = [];
        try { coaching = readFileSync(`${log}.coach`, 'utf8').trim().split('\n').filter(Boolean); } catch { coaching = []; }
        return { calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean), exit, verdicts, acquisition, coaching };
    };

    it('the step exists', () => { expect(step?.run).toBeTruthy(); });

    it('CASUALTY (P1 r4124290575): each binding passes its own expected attempts to the qualifier', () => {
        const { exit, acquisition } = runStep({
            journeys: [
                { journeyId: 'A', stages: RECORDING, firstDownload: true, attemptIds: ['att-1'] },
                { journeyId: 'B', stages: [...REPEAT, 'share_feedback'], attemptIds: ['att-2'] },
            ],
            reportedJourneyIds: [], missingBindings: [], userStageJourneyIds: [],
        });
        expect(exit).toBe(0);
        expect(acquisition).toEqual(['A|1|att-1', 'B|0|att-2']);
    });

    it('CASUALTY (P1 r4124290575): the first-download receipt is required PER BINDING — only of the one marked firstDownload', () => {
        const { calls, exit, acquisition } = runStep({
            journeys: [
                { journeyId: 'A', stages: RECORDING, firstDownload: true },
                { journeyId: 'B', stages: [...REPEAT, 'share_feedback'] },
            ],
            reportedJourneyIds: [], missingBindings: [], userStageJourneyIds: [],
        });
        expect(exit).toBe(0);
        expect(calls).toEqual([`canary|A|${RECORDING.join(',')}`, `canary|B|${[...REPEAT, 'share_feedback'].join(',')}`]);
        expect(acquisition).toEqual(['A|1|', 'B|0|']);
    });

    it('#1258 successor: the RWT product and saved attempt are passed to received coaching qualification', () => {
        const { exit, coaching } = runStep({
            journeys: [{ journeyId: 'A', stages: RECORDING, product: 'focus_points', attemptIds: ['att-focus-1'] }],
            reportedJourneyIds: [], missingBindings: [], userStageJourneyIds: [],
        });
        expect(exit).toBe(0);
        expect(coaching).toEqual(['A|focus_points|att-focus-1']);
    });

    it('CASUALTY: each bound journey is qualified against ONLY its own stages; reported journeys are never qualified', () => {
        const { calls, exit } = runStep({
            journeys: [{ journeyId: 'A', stages: RECORDING }, { journeyId: 'B', stages: ['share_feedback'] }],
            reportedJourneyIds: ['C'], missingBindings: [], userStageJourneyIds: ['U'],
        });
        expect(exit).toBe(0);
        expect(calls).toEqual(['user|U|', `canary|A|${RECORDING.join(',')}`, 'canary|B|share_feedback']);
    });

    it('CASUALTY: a missing binding fails the step closed', () => {
        const { exit } = runStep({ journeys: [{ journeyId: 'A', stages: RECORDING }], reportedJourneyIds: [], missingBindings: ['share_feedback'], userStageJourneyIds: [] });
        expect(exit).not.toBe(0);
    });

    it('CASUALTY: an unreadable receipt, or one without readback.journeys, is a HOLD — never silently "not applicable"', () => {
        expect(runStep({ journeyIds: ['A'], stages: ['session_during'] }).exit).not.toBe(0);
        expect(runStep(undefined).exit).not.toBe(0);
    });

    it('#1532 loop 4: writes the per-journey readback verdicts that rwt:finalize merges (QUALIFIED / HOLD, same release)', () => {
        const { exit, verdicts } = runStep({
            suite: 'suite', journeys: [{ journeyId: 'A', stages: RECORDING }, { journeyId: 'B', stages: ['share_feedback'] }],
            reportedJourneyIds: [], missingBindings: [], userStageJourneyIds: [],
        }, 'B');
        expect(exit).not.toBe(0);
        expect(verdicts).toEqual({
            suite: 'suite', release: 'a'.repeat(40), missingBindings: [],
            journeys: [{ journeyId: 'A', stages: RECORDING, verdict: 'QUALIFIED' }, { journeyId: 'B', stages: ['share_feedback'], verdict: 'HOLD' }],
        });
    });

    // #1258 (#1563, Codex r4197007854): the qualifier exits 3 for an OBSERVED received failure. The step records FAIL at
    // once — no retry (received rows do not un-happen) — while a HOLD is still retried three times.
    it('CASUALTY r4197007854: an observed failure (exit 3) is recorded as FAIL, not retried, and fails the step', () => {
        const { calls, exit, verdicts } = runStep({
            suite: 'suite', journeys: [{ journeyId: 'A', stages: RECORDING }, { journeyId: 'B', stages: ['share_feedback'] }, { journeyId: 'C', stages: ['practice_again'] }],
            reportedJourneyIds: [], missingBindings: [], userStageJourneyIds: [],
        }, 'C', 'B');
        expect(exit).not.toBe(0);
        expect(calls.filter((c) => c.startsWith('canary|B|'))).toHaveLength(1);
        expect(calls.filter((c) => c.startsWith('canary|C|'))).toHaveLength(3);
        expect(verdicts).toEqual({
            suite: 'suite', release: 'a'.repeat(40), missingBindings: [],
            journeys: [
                { journeyId: 'A', stages: RECORDING, verdict: 'QUALIFIED' },
                { journeyId: 'B', stages: ['share_feedback'], verdict: 'FAIL' },
                { journeyId: 'C', stages: ['practice_again'], verdict: 'HOLD' },
            ],
        });
    });

    it('a receipt with no bindings and none missing is not applicable (the navigation suite)', () => {
        const { calls, exit } = runStep({ journeys: [], reportedJourneyIds: ['A'], missingBindings: [], userStageJourneyIds: [] });
        expect(exit).toBe(0);
        expect(calls.filter((c) => c.startsWith('canary|'))).toEqual([]);
    });
});

/**
 * #1532 Codex P2 r4120338762 (PM RETURN 5866867380): `pnpm rwt:finalize` needs the run-bound, content-free human
 * worksheet, so it travels with the receipts — and the artifact stays a narrow glob list (never test-results/ as a whole,
 * which could hold a downloaded PDF or a page snapshot).
 */
describe('rc-gates RWT receipt artifact', () => {
    const workflow = parse(readFileSync(resolve(__dirname, '../../.github/workflows/rc-gates.yml'), 'utf8'));
    const upload = Object.values(workflow.jobs as Record<string, { steps?: Array<{ name?: string; with?: { path?: string } }> }>)
        .flatMap((job) => job.steps ?? []).find((s) => s.name === 'Upload RWT receipts (content-free)');

    it('uploads exactly the receipts, readback logs, human worksheets and readback verdicts — nothing broader', () => {
        const globs = String(upload?.with?.path ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
        expect(globs).toEqual([
            'test-results/rwt/*.receipt.json',
            'test-results/rwt/*.readback.log',
            'test-results/rwt/*.human-worksheet.md',
            'test-results/rwt/*.readback-verdicts.json',
        ]);
    });
});

/**
 * PM RETURN 5870036039 (PO correction, 2026-09-28): the automated journeys follow the PO's MANUAL v12 order — Analytics
 * (saved session, review, reload; the Open Mic PDF after the reload) BEFORE Share feedback. The reload mints a new journey,
 * so feedback and the PDF are bound to the journey they actually land in and qualified for their own stages; the recording
 * journey keeps the take, the Products menu and the first saved-review revisit. Never one journey claimed for two.
 */
describe('v12 manual order: each stage set binds to the journey it lands in', () => {
    const OM_RECORDING = ['session_during', 'session_after_open_mic', 'analytics_inventory'];

    it('CASUALTY: recording in A; PDF and feedback after the reload in B — bound as two journeys, each with only its own stages', () => {
        const events = [
            ev('session_started', 1, 'A'), ev('session_saved', 2, 'A'), ev('products_menu_opened', 3, 'A'), ev('saved_review_revisited', 4, 'A'),
            ev('saved_review_revisited', 5, 'B'), ev('session_pdf_downloaded', 6, 'B'), ev('feedback_submit', 7, 'B'),
        ];
        expect(bindReadbackJourneys(events, { recording: OM_RECORDING, feedback: true, pdfExport: true })).toEqual({
            journeys: [{ journeyId: 'A', stages: OM_RECORDING, firstDownload: true }, { journeyId: 'B', stages: ['share_feedback', 'session_pdf_export'] }],
            reportedJourneyIds: [], missingBindings: [],
        });
    });

    it('CASUALTY: a PDF that never left the page is a named missing binding (HOLD), never claimed for another journey', () => {
        const r = bindReadbackJourneys([ev('session_saved', 1, 'A'), ev('feedback_submit', 2, 'B')], { recording: OM_RECORDING, feedback: true, pdfExport: true });
        expect(r.missingBindings).toEqual(['session_pdf_export']);
        expect(r.journeys).toEqual([{ journeyId: 'A', stages: OM_RECORDING, firstDownload: true }, { journeyId: 'B', stages: ['share_feedback'] }]);
    });

    it('CONTROL: without pdfExport no PDF stage is declared anywhere (Focus suites)', () => {
        const r = bindReadbackJourneys([ev('session_saved', 1, 'A'), ev('session_pdf_downloaded', 2, 'B'), ev('feedback_submit', 3, 'B')], { recording: RECORDING, feedback: true });
        expect(r.journeys.flatMap((j) => j.stages)).not.toContain('session_pdf_export');
    });

    const source = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');
    const stepIndex = (file: string, title: RegExp) => {
        const m = title.exec(source(file));
        return m ? m.index : -1;
    };

    it('CASUALTY: both full suites run Analytics BEFORE Share feedback (v12 rows 6 → 7), and no suite requires one shared journey', () => {
        const om = 'live/rwt-open-mic-first-session.live.spec.ts';
        const an = stepIndex(om, /test\.step\('row 6 — Analytics action, PDF, session detail and reload'/);
        const fb = stepIndex(om, /test\.step\('row 7 — share feedback'/);
        expect(an).toBeGreaterThan(0);
        expect(an).toBeLessThan(fb);
        const fp = 'live/helpers/rwtFocusPointsJourney.ts';
        const fan = stepIndex(fp, /test\.step\('row 12 — the saved session in Analytics'/);
        const ffb = stepIndex(fp, /test\.step\('share feedback'/);
        expect(fan).toBeGreaterThan(0);
        expect(fan).toBeLessThan(ffb);
        for (const file of [om, fp, 'live/helpers/rwtOracles.ts']) expect(source(file)).not.toMatch(/sameJourney|recording_feedback_split/);
    });

    it('Open Mic binds the PDF where it lands; the recording journey no longer claims session_pdf_export', () => {
        const om = source('live/rwt-open-mic-first-session.live.spec.ts');
        expect(om).toMatch(/recording: \['session_during', 'session_after_open_mic', 'analytics_inventory'\], repeatRecording: \['session_during', 'session_after_open_mic'\],[\s\S]{0,400}feedback: true, pdfExport: true,/);
        expect(om).not.toMatch(/recording: \[[^\]]*session_pdf_export/);
    });
});

/**
 * #1532 Codex P1 r4124290575 (PM RETURNs 5873754861 / 5874333083): `/analytics` → `/session` stays inside the journey the
 * Analytics reload minted. In the REAL J2 order that journey holds feedback/PDF, the save-producing Practice-again take,
 * the completed review's repeat Start/Stop (no save) and next-Start Start/Stop (no save). The saved take is identified by
 * the Start the page sent in its own window — never by its save — and its start/save are judged per attempt.
 */
describe('repeat recording in the post-reload journey (P1 r4124290575)', () => {
    const OM_FIRST = ['session_during', 'session_after_open_mic', 'analytics_inventory'];
    const OM_REPEAT = ['session_during', 'session_after_open_mic'];
    type Sent = { event: string; at: number; journeyId: string; attemptId?: string; trafficType: string };
    const sent = (event: string, at: number, journeyId: string, attemptId?: string): Sent => ({ event, at, journeyId, attemptId, trafficType: 'canary' });

    /** The real sent stream, with the suite's windows: [0, repeatFrom) the first take; [repeatFrom, repeatTo) Practice again's SAVE take (closed at its Stop). */
    const realStream = (opts: { dropRepeatStart?: boolean; dropRepeatSave?: boolean } = {}) => {
        const events: Sent[] = [
            sent('session_started', 1, 'J1', 'a1'), sent('session_saved', 2, 'J1', 'a1'),
            sent('session_pdf_downloaded', 3, 'J2'), sent('feedback_submit', 4, 'J2'),
        ];
        const repeatFrom = events.length;
        if (!opts.dropRepeatStart) events.push(sent('session_started', 5, 'J2', 'a2'));      // save-producing Practice-again take
        const repeatTo = events.length;                                                       // onSaveTakeStopped: the save take's Stop
        if (!opts.dropRepeatSave) events.push(sent('session_saved', 6, 'J2', 'a2'));           // the save lands after the Stop
        events.push(sent('session_started', 7, 'J2', 'a3'));                                  // review repeat Start/Stop — no save
        events.push(sent('session_started', 8, 'J2', 'a4'));                                  // next Start/Stop — no save
        return { events, repeatFrom, repeatTo };
    };
    const plan = (s: ReturnType<typeof realStream>) => ({
        recording: OM_FIRST, repeatRecording: OM_REPEAT, feedback: true, pdfExport: true,
        takes: { first: takeStartedAfter(s.events, 0, s.repeatFrom), repeat: takeStartedAfter(s.events, s.repeatFrom, s.repeatTo) },
    });

    it('the saved take is identified by the Start sent in ITS window — not by its save, and never the later unsaved Starts', () => {
        const s = realStream();
        expect(takeStartedAfter(s.events, s.repeatFrom, s.repeatTo)).toEqual({ attemptId: 'a2', journeyId: 'J2' });
        // Missing save: identity survives (the start was sent).
        const noSave = realStream({ dropRepeatSave: true });
        expect(takeStartedAfter(noSave.events, noSave.repeatFrom, noSave.repeatTo)).toEqual({ attemptId: 'a2', journeyId: 'J2' });
    });

    it('binding: J1 = first take (a1, firstDownload); J2 = repeat recording + feedback + PDF, naming ONLY the saved attempt a2', () => {
        const s = realStream();
        expect(bindReadbackJourneys(s.events, plan(s))).toEqual({
            journeys: [
                { journeyId: 'J1', stages: OM_FIRST, firstDownload: true, attemptIds: ['a1'] },
                { journeyId: 'J2', stages: [...OM_REPEAT, 'share_feedback', 'session_pdf_export'], attemptIds: ['a2'] },
            ],
            reportedJourneyIds: [], missingBindings: [],
        });
    });

    it('CASUALTY: a missing saved-take save no longer disappears — J2 is still bound to the recording stages for a2', () => {
        const s = realStream({ dropRepeatSave: true });
        const r = bindReadbackJourneys(s.events, plan(s));
        expect(r.journeys.find((j) => j.journeyId === 'J2')).toMatchObject({ stages: expect.arrayContaining(OM_REPEAT), attemptIds: ['a2'] });
    });

    it('CASUALTY: a saved take whose Start was never sent is a NAMED missing binding (HOLD), not a borrowed later Start', () => {
        const s = realStream({ dropRepeatStart: true });
        const r = bindReadbackJourneys(s.events, plan(s));
        expect(r.missingBindings).toEqual(['repeat_recording']);
        expect(JSON.stringify(r.journeys)).not.toMatch(/"a3"|"a4"/);
    });

    it('both full suites identify their takes by sent-Start windows', () => {
        const om = readFileSync(resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const fp = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        for (const src of [om, fp]) {
            expect(src).toMatch(/repeat: repeatWindow \? takeStartedAfter\(tap\.events, repeatWindow\[0\], repeatWindow\[1\]\) : null/);
            expect(src).toMatch(/repeatWindow = \[repeatFrom, saveTakeEnd >= 0 \? saveTakeEnd : tap\.events\.length\];/);
        }
        expect(om).toMatch(/repeatRecording: \['session_during', 'session_after_open_mic'\]/);
        expect(fp).toMatch(/repeatRecording: \['session_during', 'session_after_focus_points'\]/);
    });

    describe('the gate on the real J2 received rows, judged per expected attempt', () => {
        const J2 = [...OM_REPEAT, 'share_feedback', 'session_pdf_export'];
        const r = (event: string, attempt?: string) => ({ event, properties: attempt ? { attempt_id: attempt } : {} });
        /** Received J2 in order: its boot control, feedback/PDF, saved take a2, then unsaved a3 and a4. */
        const j2 = (o: { noStart?: boolean; noSave?: boolean; dupStart?: boolean; dupSave?: boolean } = {}) => [
            r('telemetry_positive_control'), r('session_pdf_downloaded'), r('feedback_submit'),
            ...(o.noStart ? [] : [r('session_started', 'a2')]), ...(o.dupStart ? [r('session_started', 'a2')] : []),
            ...(o.noSave ? [] : [r('session_saved', 'a2')]), ...(o.dupSave ? [r('session_saved', 'a2')] : []),
            r('session_started', 'a3'), r('session_started', 'a4'),
        ];
        const judge = (rows: ReturnType<typeof j2>) => evaluateAttemptScopedDelivery(rows, exactlyOnceFamiliesForStages(J2), ['a2']);

        it('the full recording spine is required of J2', () => {
            expect([...requiredFamiliesForStages(J2)]).toEqual([...REQUIRED_EVENT_FAMILIES]);
        });

        it('CONTROL (the false HOLD the PM found): a complete real J2 with three starts QUALIFIES when judged per attempt', () => {
            expect(judge(j2()).verdict).toBe('QUALIFIED');
            // …and the journey-wide rule WOULD have held it: that is the defect being avoided, shown explicitly.
            expect(evaluateAttemptScopedDelivery(j2(), exactlyOnceFamiliesForStages(J2), []).duplicateFamilies).toContain('session_started');
        });

        it.each([
            ['missing saved-attempt start', { noStart: true }, 'missingFamilies', 'session_started@a2'],
            ['missing saved-attempt save', { noSave: true }, 'missingFamilies', 'session_saved@a2'],
            ['duplicate saved-attempt start', { dupStart: true }, 'duplicateFamilies', 'session_started@a2'],
            ['duplicate saved-attempt save', { dupSave: true }, 'duplicateFamilies', 'session_saved@a2'],
        ] as const)('CASUALTY: %s HOLDs', (_label, opts, field, family) => {
            const result = judge(j2(opts));
            expect(result.verdict).toBe('HOLD');
            expect(result[field]).toContain(family);
        });
    });
});
