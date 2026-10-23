// @vitest-environment node
/** #1593: retention cannot erase a positive witness or invent one for an interrupted take. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../fixtures/rwt/rwt-fixtures.manifest.json';
import type { CoachingExchange, CoachingSuggestionPair } from '../live/helpers/coachingGenerationTap';
import {
    captureCoachingTake, capturedTakesDifferVerdict, coachingEvidenceOutcome, createCoachingTakeCapture,
    readSavedPromptObservation, type AuthorityReadback, type SavedPromptInputs, type TakeIdentity,
} from '../live/helpers/rwtCoachingCollector';
import { canonicalSuggestionSha256, coachingContract, coachingSessionBindingSha256, recomputeCoachingPromptSha256 } from '../live/helpers/rwtCoachingEvidence';

const RELEASE = 'c'.repeat(40);
const USER = '20000000-0000-4000-8000-000000000001';
const pair = (n = 1): CoachingSuggestionPair => ({ version: 'gemini_coaching_v1', what_worked: `Synthetic opening ${n} was clear.`, what_to_try_next: `Pause before synthetic example ${n}.` });
const identity = (n: number): TakeIdentity => ({ runId: 'retention-run', suiteId: 'open-mic-first-session', product: 'open_mic',
    fixtureName: 'open_mic_tts', fixtureSha256: manifest.fixtures.open_mic_tts.sha256,
    sessionId: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, userId: USER });
const saved = (): SavedPromptInputs => ({ transcript: 'Synthetic um opening and one example.',
    metrics: { wpm: 115, filler_counts: { um: 1 }, filler_words: null, next_action_signal: null },
    promptContext: { transcriptState: 'available', focusContext: { kind: 'none' } } });
const fixture = (n: number, words = 100, p = pair(n)) => {
    const id = identity(n);
    const inputs = saved();
    const requestId = `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const attemptId = `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const exchange: CoachingExchange = { sent: { sessionId: id.sessionId, product: 'open_mic', requestId, attemptId, clientAttempt: 1, clientReleaseId: RELEASE },
        status: 200, clientMs: 1000, at: 1, suggestions: p, diagnostics: {
            request_id: requestId, attempt_id: attemptId, client_attempt: 1, status: 200, outcome: 'success', reason: 'none', provider: 'google_gemini',
            configured_model: coachingContract.model, observed_model: `${coachingContract.model}-001`, source: 'fresh', provider_attempts: 1,
            retry_count: 0, provider_duration_ms: 600, total_duration_ms: 900, product: 'open_mic', has_session: true, client_release_id: RELEASE,
            prompt_sha256: recomputeCoachingPromptSha256({ sessionId: id.sessionId, userId: USER, product: 'open_mic', ...inputs } as never),
            session_binding_sha256: coachingSessionBindingSha256(USER, id.sessionId),
        } };
    const authority: AuthorityReadback = { session_id: id.sessionId, user_id: USER, ai_suggestions: p, provider: 'google_gemini',
        model: `${coachingContract.model}-001`, provider_request_made: true, cache_read_count: 0,
        receipt_suggestion_sha256: canonicalSuggestionSha256(p), current_suggestion_sha256: canonicalSuggestionSha256(p) };
    const row: Record<string, unknown> = { id: id.sessionId, user_id: USER, product: 'open_mic', transcript: inputs.transcript,
        transcript_state: 'available', total_words: words, ...inputs.metrics };
    return { id, inputs, exchange, authority, row, rendered: p, words };
};
type Fixture = ReturnType<typeof fixture>;
const capture = (f: Fixture, totalWords: number | null = f.words) => captureCoachingTake({ identity: f.id, exchanges: [f.exchange],
    observed: { state: 'available', saved: f.inputs, totalWords }, authority: f.authority, rendered: f.rendered });

function database(fixtures: Fixture[]) {
    const rows = new Map(fixtures.map((f) => [f.id.sessionId, f.row]));
    const authorities = new Map(fixtures.map((f) => [f.id.sessionId, f.authority]));
    const read = vi.fn(async (id: string) => ({ data: rows.get(id) ?? null, error: null as { code: string } | null }));
    const admin = { from: () => {
        let id = '';
        const query = { select: () => query, eq: (key: string, value: string) => { if (key === 'id') id = value; return query; },
            maybeSingle: () => read(id) };
        return query;
    }, rpc: vi.fn(async (_fn: string, args: { p_session_ids: string[] }) => ({ data: args.p_session_ids.flatMap((id) => authorities.get(id) ?? []), error: null })) };
    return { rows, authorities, read, admin };
}
const observer = (db: ReturnType<typeof database>, fixtures: Fixture[], readRendered = vi.fn(async () => null as { sessionId: string; pair: CoachingSuggestionPair } | null)) => createCoachingTakeCapture({
    page: {} as never, admin: db.admin as never, tap: { exchanges: fixtures.map((f) => f.exchange), inFlight: () => [] },
    fixture: { key: 'open_mic_tts', kind: 'synthetic', sha256: manifest.fixtures.open_mic_tts.sha256 }, suiteId: 'open-mic-first-session',
    product: 'open_mic', userId: USER, readRendered,
});
const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('saved coaching witnesses survive lawful retention, never absence', () => {
    it('positive independent A/B witnesses remain usable after both rows expire', async () => {
        const a = fixture(1, 100); const b = fixture(2, 30); const db = database([a, b]); const c = observer(db, [a, b]);
        await c.sample(a.id.sessionId, a.rendered); await c.sample(b.id.sessionId, b.rendered);
        for (const f of [a, b]) { db.rows.set(f.id.sessionId, { ...f.row, transcript_state: 'expired', transcript: null }); db.authorities.delete(f.id.sessionId); }
        await c.sample(a.id.sessionId); await c.sample(b.id.sessionId);
        expect(capturedTakesDifferVerdict(c.get(a.id.sessionId), c.get(b.id.sessionId), RELEASE).status).toBe('PASS');
        await c.dispose();
    });
    it('expiry without prior observation and a successful HTTP answer without saved authority both HOLD', async () => {
        const a = fixture(1); const b = fixture(2, 30); const db = database([a, b]); const c = observer(db, [a, b]);
        db.rows.set(a.id.sessionId, { ...a.row, transcript_state: 'expired', transcript: null }); db.authorities.delete(b.id.sessionId);
        await c.sample(a.id.sessionId, a.rendered); await c.sample(b.id.sessionId, b.rendered);
        expect(c.get(a.id.sessionId)).toEqual({ hold: 'saved_inputs_expired' });
        expect(c.get(b.id.sessionId)).toEqual({ hold: 'server_authority_readback_unavailable' });
        expect(capturedTakesDifferVerdict(c.get(a.id.sessionId), c.get(b.id.sessionId), RELEASE).status).toBe('HOLD');
        await c.dispose();
    });
    it.each(['id', 'user_id', 'product'])('a witnessed take with later changed %s FAILs rather than hiding corruption', async (key) => {
        const a = fixture(1); const b = fixture(2, 30); const db = database([a, b]); const c = observer(db, [a, b]);
        await c.sample(a.id.sessionId, a.rendered); await c.sample(b.id.sessionId, b.rendered);
        db.rows.set(a.id.sessionId, { ...a.row, [key]: 'corrupt-identity' });
        await c.sample(a.id.sessionId);
        expect(c.get(a.id.sessionId)).toEqual({ fail: 'saved_identity_mismatch' });
        expect(capturedTakesDifferVerdict(c.get(a.id.sessionId), c.get(b.id.sessionId), RELEASE).status).toBe('FAIL');
        await c.dispose();
    });
    it.each(['transcript', 'pair'])('a witnessed take with later changed %s FAILs, even if a valid old snapshot exists', async (field) => {
        const a = fixture(1); const db = database([a]); const c = observer(db, [a]);
        await c.sample(a.id.sessionId, a.rendered);
        if (field === 'transcript') db.rows.set(a.id.sessionId, { ...a.row, transcript: 'different synthetic content' });
        else db.authorities.set(a.id.sessionId, { ...a.authority, ai_suggestions: pair(9) });
        await c.sample(a.id.sessionId);
        expect(c.get(a.id.sessionId)).toEqual({ fail: 'saved_evidence_changed' });
        // A later lawful-looking expiry cannot clear a previously observed corruption.
        db.rows.set(a.id.sessionId, { ...a.row, transcript: null, transcript_state: 'expired' });
        await c.sample(a.id.sessionId);
        expect(c.get(a.id.sessionId)).toEqual({ fail: 'saved_evidence_changed' });
        await c.dispose();
    });
    it.each(['missing', 'query_error'])('later %s evidence HOLDs instead of passing from a stale witness', async (state) => {
        const a = fixture(1); const b = fixture(2, 30); const db = database([a, b]); const c = observer(db, [a, b]);
        await c.sample(a.id.sessionId, a.rendered); await c.sample(b.id.sessionId, b.rendered);
        db.read.mockResolvedValueOnce({ data: null, error: state === 'query_error' ? { code: 'unreadable' } : null });
        await c.sample(a.id.sessionId);
        expect(c.get(a.id.sessionId)).toEqual({ hold: `saved_inputs_${state}` });
        expect(capturedTakesDifferVerdict(c.get(a.id.sessionId), c.get(b.id.sessionId), RELEASE).status).toBe('HOLD');
        await c.dispose();
    });
    it('non-synthetic capture performs no DB or DOM reads', async () => {
        vi.useFakeTimers(); const a = fixture(1); const db = database([a]); const rendered = vi.fn(async () => null);
        const c = createCoachingTakeCapture({ page: {} as never, admin: db.admin as never,
            tap: { exchanges: [a.exchange], inFlight: () => [] }, fixture: { key: 'untrusted-recording', kind: 'human' },
            suiteId: 'open-mic-first-session', product: 'open_mic', userId: USER, readRendered: rendered });
        c.start(); await c.sample(a.id.sessionId); await vi.advanceTimersByTimeAsync(1000);
        expect(c.get(a.id.sessionId)).toEqual({ hold: 'collector_synthetic_only' });
        expect(db.read).not.toHaveBeenCalled(); expect(db.admin.rpc).not.toHaveBeenCalled(); expect(rendered).not.toHaveBeenCalled();
        await c.dispose();
    });
    it.each([
        ['missing', null, null], ['query_error', null, { code: 'unreadable' }],
        ['malformed', { transcript_state: 'available', transcript: '' }, null],
        ['malformed', { transcript_state: 'expired', transcript: 'text contradicts expiry' }, null],
        ['malformed', { transcript_state: 'unknown' }, null],
        ['identity_mismatch', { user_id: 'wrong-owner' }, null],
        ['identity_mismatch', { id: 'wrong-session' }, null],
        ['identity_mismatch', { product: 'focus_points' }, null],
    ])('saved read distinguishes %s (%j)', async (state, override, error) => {
        const a = fixture(1); const db = database([a]);
        db.read.mockResolvedValue({ data: override === null ? null : { ...a.row, ...override }, error });
        expect(await readSavedPromptObservation(db.admin as never, USER, a.id.sessionId, 'open_mic')).toEqual({ state });
    });
    it('saved total_words is retained separately and never enters the provider prompt metrics', async () => {
        const a = fixture(1, 123); const db = database([a]);
        const observed = await readSavedPromptObservation(db.admin as never, USER, a.id.sessionId, 'open_mic');
        expect(observed).toMatchObject({ state: 'available', totalWords: 123 });
        if (observed.state !== 'available') throw new Error('expected available fixture');
        expect(observed.saved.metrics).not.toHaveProperty('total_words');
    });
    it('identical pairs with different saved word counts FAIL; same or unknown counts HOLD', () => {
        const a = fixture(1, 100, pair()); const b = fixture(2, 30, pair());
        expect(capturedTakesDifferVerdict(capture(a), capture(b), RELEASE).status).toBe('FAIL');
        expect(capturedTakesDifferVerdict(capture(a), capture(b, 100), RELEASE).status).toBe('HOLD');
        expect(capturedTakesDifferVerdict(capture(a), capture(b, null), RELEASE).status).toBe('HOLD');
    });
    it.each(['request_id', 'attempt_id', 'client_attempt', 'session_binding_sha256', 'product', 'client_release_id', 'configured_model', 'observed_model'])('wrong %s binding FAILs through existing validators', (key) => {
        const a = fixture(1); const b = fixture(2, 30);
        b.exchange.diagnostics![key] = key === 'client_attempt' ? 2 : key === 'session_binding_sha256' ? 'b'.repeat(64) : 'wrong-binding';
        expect(capturedTakesDifferVerdict(capture(a), capture(b), RELEASE).status).toBe('FAIL');
    });
    it.each(['session_id', 'user_id'])('wrong saved authority %s FAILs', (key) => {
        const a = fixture(1); const b = fixture(2, 30); b.authority[key as 'session_id' | 'user_id'] = identity(9).sessionId;
        expect(capturedTakesDifferVerdict(capture(a), capture(b), RELEASE).status).toBe('FAIL');
    });
    it('saved identity mismatch FAILs, and a mismatching visible pair FAILs rather than becoming a witness PASS', () => {
        const a = fixture(1); const b = fixture(2, 30); b.rendered = pair(9);
        expect(capturedTakesDifferVerdict(capture(a), capture(b), RELEASE).status).toBe('FAIL');
        const bad = captureCoachingTake({ identity: b.id, exchanges: [b.exchange], observed: { state: 'identity_mismatch' }, authority: b.authority, rendered: b.rendered });
        expect(capturedTakesDifferVerdict(capture(a), bad, RELEASE).status).toBe('FAIL');
    });
    it('C cannot substitute for interrupted B, even when C is visible during the B read', async () => {
        const b = fixture(2, 30); const c = fixture(3, 20); const db = database([b, c]);
        const captures = observer(db, [b, c], vi.fn(async () => ({ sessionId: c.id.sessionId, pair: c.rendered })));
        await captures.sample(b.id.sessionId); await captures.sample(c.id.sessionId);
        expect(captures.get(b.id.sessionId)).toEqual({ hold: 'rendered_pair_unavailable' });
        expect(captures.get(c.id.sessionId)).toHaveProperty('take.sessionId', c.id.sessionId);
        expect(captures.get(identity(4).sessionId)).toEqual({ hold: 'saved_take_not_witnessed' });
        await captures.dispose();
    });
    it('deep snapshots own their data and cannot be mutated through the source or returned witness', () => {
        const a = fixture(1); const captured = capture(a);
        if (!('take' in captured)) throw new Error('expected positive witness');
        const before = JSON.stringify(captured);
        a.inputs.metrics.filler_counts = { um: 999 }; a.inputs.promptContext.transcriptState = 'expired';
        a.authority.ai_suggestions!.what_worked = 'source mutation'; a.exchange.diagnostics!.request_id = 'source mutation';
        expect(JSON.stringify(captured)).toBe(before);
        expect(Object.isFrozen(captured.take.savedInputReadback.metrics)).toBe(true);
        expect(Object.isFrozen(captured.take.authorityReceipt.ai_suggestions)).toBe(true);
        expect(() => { captured.take.renderedSuggestions.what_worked = 'illegal mutation'; }).toThrow(TypeError);
    });
    it('disposal stops timers and prevents pending DB reads from repopulating content', async () => {
        vi.useFakeTimers();
        const a = fixture(1); const db = database([a]);
        let resolveRead!: (result: { data: Record<string, unknown>; error: null }) => void;
        db.read.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
        const c = observer(db, [a], vi.fn(async () => ({ sessionId: a.id.sessionId, pair: a.rendered })));
        c.start(); const disposing = c.dispose(); resolveRead({ data: a.row, error: null }); await disposing;
        const reads = db.read.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5_000);
        expect(db.read).toHaveBeenCalledTimes(reads); expect(c.get(a.id.sessionId)).toEqual({ hold: 'capture_disposed' });
        c.start(); await c.sample(a.id.sessionId); expect(db.read).toHaveBeenCalledTimes(reads);
    });
    it('public outcomes expose no raw transcript, pair, owner or session identifiers', () => {
        const a = fixture(1); const b = fixture(2, 30); const first = capture(a); const second = capture(b);
        if (!('take' in first) || !('take' in second)) throw new Error('expected positive witnesses');
        const dir = mkdtempSync(path.join(tmpdir(), 'rwt-retention-evidence-')); dirs.push(dir);
        const out = coachingEvidenceOutcome({ releaseSha: RELEASE, destination: { dir }, firstTake: first, repeatTake: second });
        expect(out.verdict).toBe('PASS');
        for (const raw of [a.inputs.transcript, a.rendered.what_worked, b.rendered.what_to_try_next, USER, a.id.sessionId, b.id.sessionId]) {
            expect(JSON.stringify(out)).not.toContain(raw);
        }
    });
});
