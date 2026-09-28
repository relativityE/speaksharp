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
import { bindReadbackJourneys, runJourneyIds } from '../live/helpers/rwtOracles';

const ev = (event: string, at: number, journeyId: string, trafficType = 'canary') => ({ event, at, journeyId, trafficType });
const RECORDING = ['session_during', 'session_after_open_mic'];

describe('bindReadbackJourneys', () => {
    it('CASUALTY: recording in journey A and feedback after a reload in journey B are bound separately', () => {
        const events = [
            ev('session_started', 1, 'A'), ev('session_saved', 2, 'A'),
            ev('saved_review_revisited', 3, 'B'), ev('feedback_submit', 4, 'B'),
        ];
        expect(bindReadbackJourneys(events, { recording: RECORDING, feedback: true })).toEqual({
            journeys: [{ journeyId: 'A', stages: RECORDING }, { journeyId: 'B', stages: ['share_feedback'] }],
            reportedJourneyIds: [], missingBindings: [],
        });
    });

    it('CONTROL: one journey that saved and shared feedback carries both stage sets', () => {
        const events = [ev('session_saved', 1, 'A'), ev('feedback_submit', 2, 'A')];
        expect(bindReadbackJourneys(events, { recording: RECORDING, feedback: true }).journeys)
            .toEqual([{ journeyId: 'A', stages: [...RECORDING, 'share_feedback'] }]);
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
            .toEqual([{ journeyId: 'FIRST', stages: RECORDING }]);
    });

    it('CASUALTY: a required binding with no anchor event is reported missing (fail closed), never silently dropped', () => {
        const r = bindReadbackJourneys([ev('session_saved', 1, 'A')], { recording: RECORDING, feedback: true });
        expect(r.missingBindings).toEqual(['share_feedback']);
        expect(r.journeys).toEqual([{ journeyId: 'A', stages: RECORDING }]);
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

    const runStep = (readback: unknown) => {
        const dir = mkdtempSync(join(tmpdir(), 'rwt-readback-'));
        const bin = join(dir, 'bin');
        mkdirSync(join(dir, 'test-results', 'rwt'), { recursive: true });
        mkdirSync(bin);
        writeFileSync(join(dir, 'test-results', 'rwt', 'suite.receipt.json'), JSON.stringify({ suite: 'suite', readback }));
        writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/env bash\nj=""; t=""; while [ $# -gt 0 ]; do case "$1" in --journey-id) j="$2"; shift;; --traffic-type) t="$2"; shift;; esac; shift; done\necho "$t|$j|${QUALIFICATION_STAGES:-}" >> "$STUB_LOG"\n');
        writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
        chmodSync(join(bin, 'pnpm'), 0o755); chmodSync(join(bin, 'sleep'), 0o755);
        const log = join(dir, 'calls.log');
        writeFileSync(log, '');
        let exit = 0;
        try {
            execFileSync('bash', ['-c', step!.run!], { cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, RELEASE_SHA: 'a'.repeat(40) }, stdio: 'pipe' });
        } catch (e) { exit = (e as { status?: number }).status ?? 1; }
        return { calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean), exit };
    };

    it('the step exists', () => { expect(step?.run).toBeTruthy(); });

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

    it('a receipt with no bindings and none missing is not applicable (the navigation suite)', () => {
        const { calls, exit } = runStep({ journeys: [], reportedJourneyIds: ['A'], missingBindings: [], userStageJourneyIds: [] });
        expect(exit).toBe(0);
        expect(calls.filter((c) => c.startsWith('canary|'))).toEqual([]);
    });
});
