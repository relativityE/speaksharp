/**
 * ONE EVENT, ONE SEAM, BOTH SETS OF FIELDS.
 *
 * T1 governs which PRODUCER fields survive. T2 adds ambient context the producer never had. The risk
 * this file guards is that they become two systems: a second capture path, or an envelope a producer
 * can override. Either would put an ungoverned or forged field on a real event.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Walk to the repo root; jsdom's Location shim breaks `new URL(..., import.meta.url)` reads. */
const REPO_ROOT = (() => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
        if (existsSync(join(dir, 'pnpm-lock.yaml'))) return dir;
        dir = dirname(dir);
    }
    throw new Error('repo root not found');
})();
const bufferSrc = () => readFileSync(join(REPO_ROOT, 'frontend/src/services/AnalyticsBuffer.ts'), 'utf8');
import { CANDIDATES, identityOf } from '../../transcription/candidateRegistry';
import { ENVELOPE_KEYS, buildEnvelope, stripEnvelopeKeys } from '../envelope';

const CANARY = 'aaaaaaaa-1111-2222-3333-444444444444';
const engineRan = (id: keyof typeof CANDIDATES) => ({ candidateId: id, modelIdentity: identityOf(CANDIDATES[id]) });

describe('the envelope carries what a launch cannot be measured without', () => {
    it('CASUALTY: every envelope key is populated for a real session', () => {
        const e = buildEnvelope({
            releaseSha: 'a19324610634b9e05a375fff8838f2bbbae3a4f1',
            engineMetadata: engineRan('v4:base:int8'),
            trafficSignals: { accountId: 'someone-real' },
        });
        expect(e.release_sha).toBe('a19324610634b9e05a375fff8838f2bbbae3a4f1');
        expect(e.candidate_id).toBe('v4:base:int8');
        expect(e.runtime_version).toBe('4.2.0');
        expect(e.asset_digest).toBeTruthy();
        expect(e.traffic_type).toBe('user');
        for (const k of ENVELOPE_KEYS) expect(e).toHaveProperty(k);
    });

    it('CASUALTY: a canary session is labelled canary, so testers are countable', () => {
        // The anti-silence gate. If canary traffic looks like a user, "few testers" stays
        // uninterpretable — the exact failure that wasted the last release.
        const e = buildEnvelope({
            engineMetadata: engineRan('v2:base.en'),
            trafficSignals: { accountId: CANARY, canaryAccountIds: [CANARY] },
        });
        expect(e.traffic_type).toBe('canary');
        expect(e.traffic_type).not.toBe('user');
    });

    it('CASUALTY: an unresolved engine yields NULL attribution, never a fabricated id', () => {
        const e = buildEnvelope({ releaseSha: 'abc', engineMetadata: null });
        expect(e.candidate_id).toBeNull();
        expect(e.asset_digest).toBeNull();
        // The release and traffic type are still known — partial honesty beats an all-or-nothing blank.
        expect(e.release_sha).toBe('abc');
        expect(e.traffic_type).toBe('user');
    });

    it('CASUALTY: a missing release marker is null, not a guess', () => {
        expect(buildEnvelope({}).release_sha).toBeNull();
    });
});

describe('a producer cannot forge or override the envelope', () => {
    it('CASUALTY: producer-supplied envelope keys are stripped before the seam applies its own', () => {
        // Without this a caller could label its own traffic `user`, or claim a model it never ran —
        // corrupting the two fields the launch is measured by.
        const forged = {
            traffic_type: 'user', candidate_id: 'moonshine:streaming-medium',
            release_sha: 'not-the-real-release', asset_digest: 'fake', engine: 'lies',
            mode: 'objective',
        };
        const kept = stripEnvelopeKeys(forged);
        expect(kept).toEqual({ mode: 'objective' });
        for (const k of ENVELOPE_KEYS) expect(kept).not.toHaveProperty(k);
    });

    it('the seam’s value WINS when both are present', () => {
        const producer = { traffic_type: 'user', candidate_id: 'v2:base.en', mode: 'freeform' };
        const envelope = buildEnvelope({
            engineMetadata: engineRan('v4:base:int8'),
            trafficSignals: { accountId: CANARY, canaryAccountIds: [CANARY] },
        });
        const final: Record<string, unknown> = { ...stripEnvelopeKeys(producer), ...envelope };
        expect(final.candidate_id).toBe('v4:base:int8');   // what ran, not what was claimed
        expect(final.traffic_type).toBe('canary');          // not the producer's 'user'
        expect(final.mode).toBe('freeform');                // ordinary producer fields survive
    });

    it('stripping tolerates absent props', () => {
        expect(stripEnvelopeKeys(undefined)).toEqual({});
    });
});

describe('the envelope EXTENDS the T1 path rather than duplicating it', () => {
    it('CASUALTY: EVERY posthog.capture carries an envelope — no path escapes it', () => {
        // There are two captures: the buffered seam, and `account_identified`, which deliberately
        // bypasses the buffer because the batch flush is too slow before post-login navigation. That
        // second path had no envelope, so a CANARY LOGIN was indistinguishable from a user login —
        // the exact signal the anti-silence gate exists to provide.
        //
        // COUNTING `buildEnvelope(` CALLS NO LONGER EXPRESSES THIS. The buffered event now snapshots its
        // envelope at push() and spreads the snapshot at send(), so calls and captures legitimately
        // differ. Each capture is inspected for an envelope spread instead — the property the count was
        // standing in for.
        const src = bufferSrc();
        const captures = [...src.matchAll(/posthog\.capture\(/g)];
        expect(captures.length).toBeGreaterThan(0);
        for (const match of captures) {
            const call = src.slice(match.index, match.index + 600);
            expect(call, 'a capture with no envelope spread').toMatch(/\.\.\.(envelope|buildEnvelope\()/);
        }
    });

    it('CASUALTY: the envelope is SNAPSHOTTED at the producer boundary, not rebuilt at send', () => {
        // Building it at send let a queued event acquire whichever engine was resolved when the queue
        // drained: a take recorded on Moonshine and flushed after a switch to v2 was filed under v2.
        const src = bufferSrc();
        const push = src.slice(src.indexOf('public push('), src.indexOf('public flush('));
        expect(push, 'push must capture the envelope while the producing state is still current')
            .toMatch(/envelope:\s*buildEnvelope\(/);

        const send = src.slice(src.indexOf('private send('));
        expect(send, 'send must prefer the snapshot over a fresh build')
            .toMatch(/event\.envelope\s*\?\?/);
    });

    it('CASUALTY: the envelope is applied after producer projection and before the capture', () => {
        // Ambient context must land after the allowlist runs, or the projection would strip it.
        const src = bufferSrc();
        const send = src.slice(src.indexOf('private send('));
        const projection = send.indexOf('projectEventProps(');
        const envelope = send.indexOf('const envelope =');
        const capture = send.indexOf('posthog.capture(');
        expect(projection).toBeGreaterThan(-1);
        expect(envelope).toBeGreaterThan(projection);
        expect(envelope).toBeLessThan(capture);
        expect(src).toMatch(/stripEnvelopeKeys\(sanitized\)/);
    });
});
