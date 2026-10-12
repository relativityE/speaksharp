// @vitest-environment node
/**
 * #1258 (PM 6114451615 / 6114547673 / 6114590729): the live coaching-evidence collector assembles each take from what the
 * run observed (request-boundary exchange, saved prompt inputs, server authority readback, rendered pair), writes the
 * restricted artifact only to an explicit private destination, and publishes closed codes + the artifact SHA-256 only.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import manifest from '../fixtures/rwt/rwt-fixtures.manifest.json';
import type { CoachingExchange } from '../live/helpers/coachingGenerationTap';
import {
    REPO_ROOT, assembleTake, coachingEvidenceOutcome, forbiddenEvidenceRoots, resolvePrivateEvidenceDir,
    type AuthorityReadback, type SavedPromptInputs, type TakeIdentity,
} from '../live/helpers/rwtCoachingCollector';
import {
    canonicalSuggestionSha256, coachingContract, coachingSessionBindingSha256, recomputeCoachingPromptSha256,
} from '../live/helpers/rwtCoachingEvidence';

const RELEASE = 'c'.repeat(40);
const USER = '20000000-0000-4000-8000-000000000001';
const pair = { version: 'gemini_coaching_v1' as const, what_worked: 'You opened with a clear point.', what_to_try_next: 'Pause before your example.' };
const saved: SavedPromptInputs = {
    transcript: 'Um, I opened with a clear point and supported it with an example.',
    metrics: { wpm: 115, filler_counts: { um: 1 }, filler_words: null, next_action_signal: null },
    promptContext: { transcriptState: 'available', focusContext: { kind: 'none' } },
};
const identity = (n: string): TakeIdentity => ({
    runId: 'rwt-run-7-1', suiteId: 'open-mic-first-session', product: 'open_mic', fixtureName: 'open_mic_tts',
    fixtureSha256: manifest.fixtures.open_mic_tts.sha256, sessionId: `10000000-0000-4000-8000-${n.padStart(12, '0')}`, userId: USER,
});
const exchangeFor = (id: TakeIdentity, over: Record<string, unknown> = {}): CoachingExchange => {
    const requestId = `30000000-0000-4000-8000-${id.sessionId.slice(-12)}`;
    const attemptId = `40000000-0000-4000-8000-${id.sessionId.slice(-12)}`;
    const digest = recomputeCoachingPromptSha256({ sessionId: id.sessionId, userId: USER, product: 'open_mic', transcript: saved.transcript, metrics: saved.metrics, promptContext: saved.promptContext as never });
    return {
        sent: { sessionId: id.sessionId, product: 'open_mic', requestId, attemptId, clientAttempt: 1, clientReleaseId: RELEASE },
        status: 200,
        diagnostics: {
            schema_version: 'coaching_diagnostic_v1', request_id: requestId, attempt_id: attemptId, client_attempt: 1, phase: 'complete',
            outcome: 'success', reason: 'none', status: 200, provider_status: 200, provider: 'google_gemini',
            configured_model: coachingContract.model, observed_model: `${coachingContract.model}-001`, source: 'fresh',
            provider_attempts: 1, retry_count: 0, provider_duration_ms: 640, total_duration_ms: 920, prompt_sha256: digest,
            product: 'open_mic', has_session: true, client_release_id: RELEASE,
            session_binding_sha256: coachingSessionBindingSha256(USER, id.sessionId),
            ...over,
        },
        suggestions: pair, clientMs: 1000, at: 1,
    };
};
const authorityFor = (id: TakeIdentity): AuthorityReadback => ({
    session_id: id.sessionId, user_id: USER, ai_suggestions: pair, provider: 'google_gemini', model: `${coachingContract.model}-001`,
    provider_request_made: true, cache_read_count: 0,
    receipt_suggestion_sha256: canonicalSuggestionSha256(pair), current_suggestion_sha256: canonicalSuggestionSha256(pair),
});
const take = (n: string, exOver: Record<string, unknown> = {}) => {
    const id = identity(n);
    return assembleTake({ identity: id, exchanges: [exchangeFor(id, exOver)], saved, authority: authorityFor(id), rendered: { ...pair } });
};

const dirs: string[] = [];
const privateDir = () => { const d = mkdtempSync(path.join(tmpdir(), 'rwt-private-test-')); dirs.push(d); return path.join(d, 'evidence'); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('#1258 RWT coaching-evidence collector', () => {
    it('the private destination is never defaulted, relative, or inside the checkout/output trees', () => {
        expect(resolvePrivateEvidenceDir(undefined, [])).toEqual({ hold: 'private_evidence_destination_not_configured' });
        expect(resolvePrivateEvidenceDir('relative/dir', [])).toEqual({ hold: 'private_evidence_destination_not_absolute' });
        const roots = forbiddenEvidenceRoots(['/tmp/pw-output-x']);
        expect(resolvePrivateEvidenceDir(path.join(REPO_ROOT, 'test-results', 'private'), roots)).toEqual({ hold: 'private_evidence_destination_inside_forbidden_tree' });
        expect(resolvePrivateEvidenceDir(path.join(REPO_ROOT, '.private-evidence'), roots)).toEqual({ hold: 'private_evidence_destination_inside_forbidden_tree' });
        // A destination that CONTAINS a forbidden tree is refused too.
        expect(resolvePrivateEvidenceDir(path.dirname(REPO_ROOT), roots)).toEqual({ hold: 'private_evidence_destination_inside_forbidden_tree' });
        const ok = privateDir();
        expect(resolvePrivateEvidenceDir(ok, roots)).toEqual({ dir: expect.stringContaining('rwt-private-test-') });
    });

    it('both takes bound → PASS; the public evidence is closed codes and the artifact digest only', () => {
        const dir = privateDir();
        const out = coachingEvidenceOutcome({ releaseSha: RELEASE, destination: resolvePrivateEvidenceDir(dir, []), firstTake: take('1'), repeatTake: take('2') });
        expect(out.verdict).toBe('PASS');
        expect(out.evidence).toEqual({
            configuredModel: coachingContract.model, artifactSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            firstBinding: 'PASS', firstReason: 'recomputed_from_bound_saved_prompt_inputs',
            repeatBinding: 'PASS', repeatReason: 'recomputed_from_bound_saved_prompt_inputs',
        });
        const publicText = JSON.stringify(out);
        for (const content of [saved.transcript, pair.what_worked, pair.what_to_try_next, USER]) expect(publicText).not.toContain(content);
    });

    it('a server prompt digest that does not match the saved inputs is FAIL', () => {
        const out = coachingEvidenceOutcome({ releaseSha: RELEASE, destination: resolvePrivateEvidenceDir(privateDir(), []), firstTake: take('1', { prompt_sha256: 'b'.repeat(64) }), repeatTake: take('2') });
        expect(out).toMatchObject({ verdict: 'FAIL', evidence: { firstBinding: 'FAIL', firstReason: 'server_prompt_digest_mismatch' } });
    });

    it('a rendered pair that differs from the server-authorized saved pair is refused (FAIL), never written as PASS', () => {
        const id = identity('1');
        const first = assembleTake({ identity: id, exchanges: [exchangeFor(id)], saved, authority: authorityFor(id), rendered: { ...pair, what_worked: 'Something else.' } });
        const out = coachingEvidenceOutcome({ releaseSha: RELEASE, destination: resolvePrivateEvidenceDir(privateDir(), []), firstTake: first, repeatTake: take('2') });
        expect(out.verdict).toBe('FAIL');
        expect(String(out.evidence.refusal)).toMatch(/^firstTake: rendered suggestions differ/);
        expect(JSON.stringify(out)).not.toContain('Something else');
    });

    it.each([
        ['no successful generation', { exchanges: [] }, 'no_successful_generation_observed'],
        ['no saved inputs', { saved: null }, 'saved_prompt_inputs_unavailable'],
        ['no authority readback', { authority: null }, 'server_authority_readback_unavailable'],
        ['no rendered pair', { rendered: null }, 'rendered_pair_unavailable'],
    ])('missing evidence is HOLD, never PASS: %s', (_label, over, reason) => {
        const id = identity('1');
        const first = assembleTake({ identity: id, exchanges: [exchangeFor(id)], saved, authority: authorityFor(id), rendered: { ...pair }, ...over });
        expect(first).toEqual({ hold: reason });
        const out = coachingEvidenceOutcome({ releaseSha: RELEASE, destination: resolvePrivateEvidenceDir(privateDir(), []), firstTake: first, repeatTake: take('2') });
        expect(out).toMatchObject({ verdict: 'HOLD', evidence: { reason, take: 'first' } });
    });

    it('an unconfigured destination is HOLD and writes nothing', () => {
        const out = coachingEvidenceOutcome({ releaseSha: RELEASE, destination: resolvePrivateEvidenceDir('', []), firstTake: take('1'), repeatTake: take('2') });
        expect(out).toMatchObject({ verdict: 'HOLD', evidence: { reason: 'private_evidence_destination_not_configured' } });
    });

    it('the artifact is written create-only (0600) inside the private destination', () => {
        const dir = privateDir();
        const out = coachingEvidenceOutcome({ releaseSha: RELEASE, destination: resolvePrivateEvidenceDir(dir, []), firstTake: take('1'), repeatTake: take('2') });
        expect(out.verdict).toBe('PASS');
        const file = path.join(dir, `rwt-coaching-${RELEASE}-rwt-run-7-1.json`);
        expect(JSON.parse(readFileSync(file, 'utf8')).visibility).toBe('restricted_synthetic');
        // A second write for the same run is refused, never overwritten.
        const again = coachingEvidenceOutcome({ releaseSha: RELEASE, destination: resolvePrivateEvidenceDir(dir, []), firstTake: take('1'), repeatTake: take('2') });
        expect(again).toMatchObject({ verdict: 'FAIL', evidence: { refusal: 'artifact_write_refused' } });
    });
});
