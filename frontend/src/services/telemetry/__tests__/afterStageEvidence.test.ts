/**
 * #1421 P1s `3984043479` + `3984043486` — an After stage qualifies only on the evidence it claims.
 *
 * `3984043479`: any `transcript_authority` row satisfied the After stages, including `finalize` / `save` /
 * `teardown` rows or a `review_rendered` receipt reporting a blank or different transcript.
 * `3984043486`: any `stage_latency` row satisfied them, including pre-Stop stages, so an After run that lost
 * the whole post-Stop chain still qualified. PM decision `5638627982` fixes the chains: Focus Points includes
 * `evaluation_complete`, Open Mic does not.
 *
 * Each casualty changes one thing in an otherwise qualifying journey and asserts the stage HOLDs for it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    FOCUS_POINTS_POST_STOP_CHAIN,
    OPEN_MIC_POST_STOP_CHAIN,
    QUALIFICATION_STAGES,
    evaluateQualificationStage,
    type DecodedTelemetryRow,
} from '../completenessGate';
import { buildReadbackQuery } from '../bootScopedReceipts';

const stage = (name: string) => QUALIFICATION_STAGES.find((s) => s.stage === name)!;
const OPEN_MIC = stage('session_after_open_mic');
const FOCUS_POINTS = stage('session_after_focus_points');

const row = (event: string, properties: Record<string, unknown> = {}, extra: Partial<DecodedTelemetryRow> = {}): DecodedTelemetryRow =>
    ({ event, properties, ...extra });
const chainRows = (chain: readonly string[], start = 1_000, attemptId: string | null = 'attempt-1') =>
    chain.map((name, i) => row('stage_latency',
        { stage: name, duration_ms: 10, ...(attemptId === null ? {} : { attempt_id: attemptId }) },
        { timestamp: start + i }));
const reviewReceipt = (over: Record<string, unknown> = {}) =>
    row('transcript_authority', { stage: 'review_rendered', transcript_visibly_present: true, digests_match: true, ...over });

/** Everything an After stage needs besides the two families under test. */
const base = (s: typeof OPEN_MIC): DecodedTelemetryRow[] => [
    row('session_saved', { attempt_id: 'attempt-1', attempt_seq: 1 }, { journeyId: 'journey-1', bootId: 'boot-1' }),
    row('model_attribution_receipt', {
        subject_boot_id: 'boot-1', subject_journey_id: 'journey-1', subject_attempt_id: 'attempt-1',
        subject_attempt_seq: 1, attribution_status: 'verified',
    }, { journeyId: 'journey-1', bootId: 'boot-1' }),
    ...s.requiredFamilies
        .filter((f) => !['session_saved', 'model_attribution_receipt', 'transcript_authority', 'stage_latency'].includes(f))
        .map((f) => row(f)),
];
const journey = (s: typeof OPEN_MIC, chain: readonly string[], review: DecodedTelemetryRow[] = [reviewReceipt()]) =>
    [...base(s), ...review, ...chainRows(chain)];

describe('#1421 P1 `3984043479` — the After stages require a successful review_rendered transcript receipt', () => {
    it('CONTROL: a visibly present, matching review receipt qualifies both products', () => {
        expect(evaluateQualificationStage(OPEN_MIC, journey(OPEN_MIC, OPEN_MIC_POST_STOP_CHAIN))).toEqual([]);
        expect(evaluateQualificationStage(FOCUS_POINTS, journey(FOCUS_POINTS, FOCUS_POINTS_POST_STOP_CHAIN))).toEqual([]);
    });

    it('CONTROL: the readback\'s string booleans are read as the booleans they encode', () => {
        const rows = journey(OPEN_MIC, OPEN_MIC_POST_STOP_CHAIN, [reviewReceipt({ transcript_visibly_present: 'true', digests_match: 'true' })]);
        expect(evaluateQualificationStage(OPEN_MIC, rows)).toEqual([]);
    });

    it('CASUALTY: finalize, save and teardown receipts alone do not evidence the review', () => {
        const rows = journey(OPEN_MIC, OPEN_MIC_POST_STOP_CHAIN, ['finalize', 'save', 'teardown']
            .map((s) => reviewReceipt({ stage: s })));
        expect(evaluateQualificationStage(OPEN_MIC, rows).join(' | ')).toMatch(/no review_rendered transcript receipt/);
    });

    it('CASUALTY: a review receipt reporting a blank, different or unknown transcript HOLDs', () => {
        for (const over of [
            { transcript_visibly_present: false },
            { digests_match: false },
            { digests_match: null },
            { transcript_visibly_present: 'false' },
        ]) {
            const rows = journey(FOCUS_POINTS, FOCUS_POINTS_POST_STOP_CHAIN, [reviewReceipt(over)]);
            expect({ over, held: evaluateQualificationStage(FOCUS_POINTS, rows).join(' | ') })
                .toEqual({ over, held: expect.stringMatching(/did not show the saved transcript/) });
        }
    });

    it('CASUALTY: one successful receipt does not excuse another that was wrong on screen', () => {
        const rows = journey(OPEN_MIC, OPEN_MIC_POST_STOP_CHAIN, [reviewReceipt(), reviewReceipt({ transcript_visibly_present: false })]);
        expect(evaluateQualificationStage(OPEN_MIC, rows).join(' | ')).toMatch(/did not show the saved transcript/);
    });
});

describe('#1421 P1 `3984043486` — the After stages require the applicable post-Stop chain, in order', () => {
    it('CASUALTY (`3993611256`): a chain SPLICED from two attempts HOLDs — no single take completed it', () => {
        // Take A produced the first two stages; the saved take produced the rest. Every stage exists and the
        // times are ordered, so before this correction the readback reported QUALIFIED for a chain nobody ran.
        const [first, second, ...rest] = OPEN_MIC_POST_STOP_CHAIN;
        const rows = [
            ...base(OPEN_MIC), reviewReceipt(),
            ...chainRows([first, second], 1_000, 'attempt-A'),
            ...chainRows(rest, 1_100, 'attempt-1'),
        ];
        expect(evaluateQualificationStage(OPEN_MIC, rows))
            .toContain(`${OPEN_MIC.stage}: the post-Stop chain has no ${first} stage for the saved take's attempt`);
    });

    it('CONTROL (`3993611256`): one complete single-attempt chain qualifies; an unattributed chain does not', () => {
        // The saved take in `base()` is `attempt-1`, and this chain is entirely its own.
        expect(evaluateQualificationStage(OPEN_MIC, journey(OPEN_MIC, OPEN_MIC_POST_STOP_CHAIN))).toEqual([]);
        // PM item 6 — no transition and no backfill: rows emitted before the attempt was carried do not qualify.
        const unattributed = [...base(OPEN_MIC), reviewReceipt(), ...chainRows(OPEN_MIC_POST_STOP_CHAIN, 1_000, null)];
        expect(evaluateQualificationStage(OPEN_MIC, unattributed))
            .toContain(`${OPEN_MIC.stage}: the post-Stop chain has no ${OPEN_MIC_POST_STOP_CHAIN[0]} stage for the saved take's attempt`);
    });

    it('CONTROL: Open Mic qualifies WITHOUT evaluation_complete; Focus Points qualifies with it', () => {
        expect(OPEN_MIC_POST_STOP_CHAIN).not.toContain('evaluation_complete');
        expect(FOCUS_POINTS_POST_STOP_CHAIN).toContain('evaluation_complete');
        expect(evaluateQualificationStage(OPEN_MIC, journey(OPEN_MIC, OPEN_MIC_POST_STOP_CHAIN))).toEqual([]);
    });

    it('CASUALTY: a pre-Stop latency row alone does not evidence the chain', () => {
        const rows = [...base(OPEN_MIC), reviewReceipt(), row('stage_latency', { stage: 'model_acquisition', duration_ms: 5 }, { timestamp: 1 })];
        expect(evaluateQualificationStage(OPEN_MIC, rows).join(' | ')).toMatch(/post-Stop chain has no recording_terminated stage/);
    });

    it('CASUALTY: dropping ANY applicable stage HOLDs and names it, for each product', () => {
        for (const [s, chain] of [[OPEN_MIC, OPEN_MIC_POST_STOP_CHAIN], [FOCUS_POINTS, FOCUS_POINTS_POST_STOP_CHAIN]] as const) {
            for (const missing of chain) {
                const rows = journey(s, chain).filter((r) => !(r.event === 'stage_latency' && r.properties?.stage === missing));
                expect(evaluateQualificationStage(s, rows).join(' | '), `${s.stage} without ${missing}`)
                    .toContain(`post-Stop chain has no ${missing} stage`);
            }
        }
    });

    it('CASUALTY: Focus Points without evaluation_complete HOLDs — the Open Mic chain is not enough there', () => {
        const rows = journey(FOCUS_POINTS, OPEN_MIC_POST_STOP_CHAIN);
        expect(evaluateQualificationStage(FOCUS_POINTS, rows).join(' | ')).toMatch(/no evaluation_complete stage/);
    });

    it('CASUALTY: an out-of-order chain HOLDs at the stage that arrived too early', () => {
        const rows = [...base(OPEN_MIC), reviewReceipt(), ...OPEN_MIC_POST_STOP_CHAIN.map((name, i) =>
            row('stage_latency', { stage: name, attempt_id: 'attempt-1' }, { timestamp: name === 'session_saved' ? 1_000 : 2_000 + i }))];
        expect(evaluateQualificationStage(OPEN_MIC, rows).join(' | ')).toMatch(/out of order at session_saved/);
    });

    it('CASUALTY: a stage row with no readable timestamp HOLDs rather than being ordered by guesswork', () => {
        const rows = journey(OPEN_MIC, OPEN_MIC_POST_STOP_CHAIN)
            .map((r) => (r.event === 'stage_latency' && r.properties?.stage === 'final_transcript' ? { ...r, timestamp: 'not-a-time' } : r));
        expect(evaluateQualificationStage(OPEN_MIC, rows).join(' | ')).toMatch(/final_transcript stage row has no readable timestamp/);
    });

    it('CONTROL: ISO readback timestamps order correctly', () => {
        const rows = [...base(OPEN_MIC), reviewReceipt(), ...OPEN_MIC_POST_STOP_CHAIN.map((name, i) =>
            row('stage_latency', { stage: name, attempt_id: 'attempt-1' }, { timestamp: `2026-09-11T18:00:0${i}Z` }))];
        expect(evaluateQualificationStage(OPEN_MIC, rows)).toEqual([]);
    });
});

describe('#1421 — the readback selects and decodes what these invariants read', () => {
    it('the query selects the row stage and the review verdicts, appended after every existing column', () => {
        const query = buildReadbackQuery({
            windowHours: 24, releaseSha: 'sha', trafficType: 'internal_test', qualifyingIdentity: 'id',
            governedEvents: ['stage_latency', 'transcript_authority'], quote: (v: string) => `'${v}'`,
        } as never);
        const columns = ['attribution_status', 'stage', 'transcript_visibly_present', 'digests_match']
            .map((c) => query.indexOf(`AS ${c}`));
        expect(columns.every((i) => i > 0)).toBe(true);
        expect([...columns].sort((a, b) => a - b)).toEqual(columns);
    });

    it('the decoder maps those columns to the properties the invariants read', () => {
        const script = readFileSync(resolve(__dirname, '../../../../../scripts/telemetry-readback-qualification.mts'), 'utf8');
        expect(script).toContain('stage: cells[18] ?? null');
        expect(script).toContain('transcript_visibly_present: cells[19] ?? null');
        expect(script).toContain('digests_match: cells[20] ?? null');
    });
});
