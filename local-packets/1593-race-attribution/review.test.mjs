// Offline independent source-bound controls. No live calls, no App implementation edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { CoachingGenerationTap } from '../../tests/live/helpers/coachingGenerationTap.ts';
import { coachingRequestBudgetRow } from '../../tests/live/helpers/rwtCoachingCollector.ts';
import { buildEnvelope } from '../../frontend/src/services/telemetry/envelope.ts';
import { beginJourney, beginRecordingAttempt } from '../../frontend/src/services/telemetry/journeyIdentity.ts';

const S = '968e67a45604cab23cb2aa5b82035471182c3ee1';
const baseline = mkdtempSync(join(tmpdir(), 'cli-tap-baseline-'));
for (const p of ['tests/live/helpers/coachingGenerationTap.ts', 'tests/live/helpers/rwtCoachingEvidence.ts',
    'tests/fixtures/rwt/rwt-fixtures.manifest.json', 'backend/supabase/functions/get-ai-suggestions/providerRetry.ts',
    'backend/supabase/functions/get-ai-suggestions/contract.json']) {
    const to = join(baseline, p); mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, execFileSync('git', ['show', `${S}:${p}`]));
}
symlinkSync(resolve('node_modules'), join(baseline, 'node_modules'), 'dir');
const { CoachingGenerationTap: BaselineTap } = await import(pathToFileURL(join(baseline, 'tests/live/helpers/coachingGenerationTap.ts')).href);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
class Page {
    handlers = new Map();
    on(name, fn) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]); }
    emit(name, value) { for (const fn of this.handlers.get(name) ?? []) fn(value); }
}
const request = (id) => ({ url: () => 'https://example.test/functions/v1/get-ai-suggestions', method: () => 'POST',
    postDataJSON: () => ({ sessionId: `session-${id}`, product: 'open_mic', diagnostic_request_id: `request-${id}`,
        diagnostic_attempt_id: `attempt-${id}`, client_attempt: 1 }) });
const answer = (r) => ({ request: () => r, status: () => 200, json: async () => ({ diagnostics: { provider_attempts: 1 } }) });
const sha = (v) => createHash('sha256').update(v).digest('hex');

for (const [label, Tap] of [['baseline', BaselineTap], ['head', CoachingGenerationTap]]) {
    test(`${label}: dynamically arriving B has age1ms at the settle deadline`, async (t) => {
        t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
        const p = new Page(); const tap = new Tap(); tap.attach(p);
        const a = request('A'); const b = request('B');
        p.emit('request', a);
        const settling = tap.settle(1000);
        t.mock.timers.tick(999); p.emit('request', b); p.emit('response', answer(a)); await flush();
        t.mock.timers.tick(1); await flush(); await settling;
        if (label === 'baseline') {
            assert.deepEqual(tap.exchanges.map((x) => [x.sent.sessionId, x.outcome]), [['session-A', 'answered'], ['session-B', 'unanswered']]);
        } else {
            assert.deepEqual(tap.exchanges.map((x) => [x.sent.sessionId, x.outcome]), [['session-A', 'answered']]);
            const open = tap.inFlight(); assert.equal(open.length, 1); assert.equal(open[0].ageMs, 1);
            const rows = []; coachingRequestBudgetRow({ row: (...args) => rows.push(args) }, tap, { maximum: 2 });
            assert.equal(rows[0][1], 'HOLD'); assert.equal(rows[0][3].inFlightAtEnd, 1);
            assert.ok(rows[0][3].inFlightTimeline.includes(sha('request-B')));
            assert.ok(rows[0][3].inFlightTimeline.includes(sha('attempt-B')));
            assert.ok(!JSON.stringify(rows).includes('request-B'));
        }
        t.mock.timers.tick(10); p.emit('response', answer(b)); await flush();
        assert.equal(tap.exchanges.find((x) => x.sent.sessionId === 'session-B').outcome, label === 'baseline' ? 'unanswered' : 'answered');
    });
}

test('head: pending body retains status/hash, then becomes one terminal exchange', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 2_000_000 });
    const p = new Page(); const tap = new CoachingGenerationTap(); tap.attach(p);
    const a = request('A'); const b = request('B'); let body;
    p.emit('request', a); const settling = tap.settle(1000);
    t.mock.timers.tick(999); p.emit('request', b);
    p.emit('response', { request: () => b, status: () => 200, json: () => new Promise((r) => { body = r; }) });
    p.emit('response', answer(a)); await flush(); t.mock.timers.tick(1); await flush(); await settling;
    assert.equal(tap.inFlight()[0].status, 200); assert.equal(tap.inFlight()[0].ageMs, 1);
    body({ diagnostics: { provider_attempts: 1 } }); await flush();
    assert.equal(tap.inFlight().length, 0); assert.equal(tap.forSession('session-B').length, 1);
});

test('baseline product seam: late A callback emitted after B starts acquires B ambient attribution', () => {
    beginJourney(); beginRecordingAttempt(); const a = buildEnvelope();
    // This is the real envelope seam used by AnalyticsBuffer.push, not a new telemetry implementation.
    const lateCallbackFromA = () => ({ diagnostic_request_id: 'synthetic-request-A', ...buildEnvelope() });
    beginJourney(); beginRecordingAttempt(); const b = buildEnvelope();
    const late = lateCallbackFromA();
    assert.notEqual(a.journey_id, b.journey_id); assert.notEqual(a.attempt_id, b.attempt_id);
    assert.equal(late.journey_id, b.journey_id); assert.equal(late.attempt_id, b.attempt_id);
    assert.equal(late.boot_id, a.boot_id);
    assert.equal(late.diagnostic_request_id, 'synthetic-request-A');
});
