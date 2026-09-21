// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PAYLOAD_TRIPWIRE } from '../../scripts/human-test/payloadTripwire.mjs';
import {
    canaryPathContainsEncodedAudio,
    canaryQueryContainsEncodedAudio,
    judgeCanaryEgress,
    type CanaryEgressPolicy,
    type EgressObservation,
} from '../../tests/canary/canaryRuntimeContract';

/**
 * #1258 / #1488 — THREE VERIFIED P1 EVASIONS OF THE CANARY ORACLE.
 *
 * These are RED. They are written to fail on `ab73b033`, which is the point: each states a
 * requirement the oracle does not yet meet, so the fix has a target that existed before it.
 *
 * Every one describes the same outcome — **the canary reports PASS after Private audio has left the
 * browser** — which is the exact claim this PR exists to make false. Codex raised all three; I traced
 * each in source and the Consultant independently confirmed them.
 *
 * The two findings Codex raised that are NOT here are the ones later commits already fixed (JSON
 * property names in bodies, and in URL envelopes). Those threads should resolve as fixed, not carry
 * a test.
 *
 * WHERE THE REAL FUNCTIONS ARE USED, THEY ARE USED. Every `queryContainsEncodedAudio` and
 * `pathContainsEncodedAudio` below is computed by the shipped classifier rather than asserted by
 * hand, because a hand-written `false` would make these tests agree with my reading of the code
 * instead of with the code. Only the fields the browser observer takes directly from the request —
 * origin, byte count, route verdict — are stated literally.
 */

const APP = 'https://speaksharp-public.vercel.app';
const SUPABASE = 'https://abcproject.supabase.co';

const POLICY: CanaryEgressPolicy = {
    firstParty: [APP, SUPABASE],
    governedTelemetry: ['https://eu.posthog.com'],
    modelAssets: ['https://huggingface.co'],
};

/**
 * Build the observation the smoke spec's `page.on('request')` handler would push for this request.
 *
 * This mirrors that handler field for field: it redacts to the origin, records the body's byte
 * length, and computes the two shape verdicts from the URL with the shipped classifiers. Headers are
 * absent because `EgressObservation` HAS NO FIELD FOR THEM — which is the first finding below, and
 * the reason this helper cannot express one even deliberately.
 */
const observe = (url: string, bodyBytes: number, over: Partial<EgressObservation> = {}): EgressObservation => {
    const origin = new URL(url).origin;
    return {
        redacted: origin,
        origin,
        bodyBytes,
        resourceType: 'fetch',
        hasQuery: new URL(url).search.length > 0,
        queryContainsEncodedAudio: canaryQueryContainsEncodedAudio(url, APP),
        pathContainsEncodedAudio: canaryPathContainsEncodedAudio(url, APP),
        routeAllowed: true,
        bodyClassAllowed: true,
        ...over,
    };
};

/** 128 base64 characters — deliberately HALF the 256-character threshold every classifier uses. */
const HALF = 'A'.repeat(128);

describe('#1488 P1 — the canary oracle must not PASS after Private audio has left the browser', () => {
    /**
     * P1 (1) — HEADERS ARE NEVER INSPECTED, AND CANNOT BE.
     *
     * The observer reads exactly one header: `request.headers()['content-type']`. Everything else is
     * discarded at the boundary, and `EgressObservation` has no field to carry it, so no later stage
     * can recover what was dropped. Audio in a CORS-permitted header such as `x-client-info` reaches
     * Supabase while the route, the body class and the origin all read clean.
     *
     * The Consultant's framing is the one to fix against: the defect is not that the tripwire reads
     * only `Content-Type`, it is that **the observation type has nowhere to put a header**. A fix
     * that only widens the read has nowhere to send the result.
     *
     * This test asserts the OUTCOME the oracle owes — a take carrying encoded audio in a header must
     * not be judged clean — without prescribing the mechanism. A bounded header inspection and a
     * strict per-route header allowlist would both satisfy it.
     */
    it('RED: audio smuggled in a CORS-permitted request header must not pass', () => {
        // A benign JSON body on an allowed route. Every field the oracle can see is clean; the audio
        // rides in `x-client-info`, which the observer discards before anything can judge it.
        const request = observe(`${SUPABASE}/functions/v1/attest-session-engine`, 120);

        // There is no way to express the header on this type. That absence IS the finding, so state
        // it structurally rather than leaving it implicit in a comment.
        expect(
            Object.keys(request),
            'EgressObservation must be able to carry header evidence for the judge to weigh',
        ).toContain('headerContainsEncodedAudio');

        const verdict = judgeCanaryEgress([request], [], POLICY);
        expect(verdict.ok, 'a take with encoded audio in an allowed header must be refused').toBe(false);
    });

    /**
     * P1 (2) — NO CROSS-REQUEST AGGREGATION.
     *
     * `canaryQueryContainsEncodedAudio` accumulates a `combinedQuery` WITHIN one URL, so a payload
     * split across parameters of a single request is caught. `judgeCanaryEgress` then iterates
     * observations independently — a single `for (const o of observations)` with no reduce, total or
     * carry — so a payload split across SUCCESSIVE requests is not.
     *
     * `isEncodedAudioScalar` requires 256 characters, so four requests of 128 each stay under the
     * threshold individually while carrying 512 characters of encoded PCM in total. Every one is
     * judged clean on its own, and nothing ever looks at the sum.
     *
     * The mechanism is a design decision — a per-take cumulative ceiling, a per-origin one, a sliding
     * window — so this test fixes the REQUIREMENT before anyone picks one.
     */
    it('RED: base64 PCM split across successive allowed requests must not pass', () => {
        const requests = Array.from({ length: 4 }, (_, i) =>
            observe(`${SUPABASE}/rest/v1/sessions?chunk=${HALF}&seq=${i}`, 0));

        // Precondition, computed by the shipped classifier rather than assumed: each request really
        // is clean on its own. If this ever fails, the finding has changed shape and this test is
        // asserting the wrong thing.
        expect(
            requests.map((r) => r.queryContainsEncodedAudio),
            'each individual request is sub-threshold — that is the premise of the evasion',
        ).toEqual([false, false, false, false]);

        const verdict = judgeCanaryEgress(requests, [], POLICY);
        expect(
            verdict.ok,
            'four sub-threshold chunks totalling 512 encoded characters must be refused in aggregate',
        ).toBe(false);
    });

    /**
     * P1 (3) — THE SAME PAYLOAD IS JUDGED TWO WAYS DEPENDING ON THE CALLER'S BODY TYPE.
     *
     * `classify`'s `URLSearchParams` branch tests `isAudioField(key) && value.trim().length > 0`, so
     * an audio-named field with any content is caught regardless of length. `inspectUrlEncodedText`,
     * which handles the STRING form of the identical body, contains no `isAudioField` call at all.
     *
     * It compounds: `inspectUrlEncodedText` does count sub-threshold candidates internally, but
     * returns `'clean'` below 256 and the count dies with the call. `classify` then recomputes from
     * the whole punctuated string via `shortEncodedAudioTextLength`, which returns 0 because
     * `audio=AAAA…` is not valid base64 — so the transport-level accumulator that exists precisely to
     * catch repeated short frames never sees a single candidate character.
     *
     * A caller writing `body: 'audio=' + pcm` instead of `body: new URLSearchParams({audio: pcm})`
     * sends identical bytes with an identical Content-Type and gets a different verdict.
     */
    it('RED: a pre-serialized form body is classified the same as its URLSearchParams twin', async () => {
        type TripwireGlobal = typeof globalThis & {
            __SS_TRIPWIRE__?: unknown[];
            __SS_TRIPWIRE_EMIT__?: (record: Record<string, unknown>) => void;
            document?: { documentElement?: { getAttribute?: (name: string) => string | null } };
        };
        const scope = globalThis as TripwireGlobal;
        const originalFetch = scope.fetch;
        const originalDocument = scope.document;
        const records: Record<string, unknown>[] = [];

        try {
            delete scope.__SS_TRIPWIRE__;
            scope.__SS_TRIPWIRE_EMIT__ = (record) => { records.push(record); };
            scope.document = { documentElement: { getAttribute: () => 'RECORDING' } };
            scope.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;

            new Function(PAYLOAD_TRIPWIRE)();

            // Identical content, identical field name, identical wire bytes — only the JS type differs.
            await scope.fetch(`${SUPABASE}/rest/v1/sessions`, { method: 'POST', body: `audio=${HALF}` });
            await scope.fetch(`${SUPABASE}/rest/v1/sessions`, {
                method: 'POST', body: new URLSearchParams({ audio: HALF }),
            });

            const [asString, asParams] = records.map((record) => record.kind);
            expect(
                asString,
                'a string form body must be classified exactly as its URLSearchParams twin',
            ).toBe(asParams);

            // And neither may be ordinary text: the field is named `audio` and carries content.
            expect(records.map((r) => r.kind)).not.toContain('text');

            // The redaction contract still holds — no payload content may enter evidence.
            expect(JSON.stringify(records)).not.toContain('AAAA');
        } finally {
            scope.fetch = originalFetch;
            if (originalDocument === undefined) delete scope.document;
            else scope.document = originalDocument;
            delete scope.__SS_TRIPWIRE__;
            delete scope.__SS_TRIPWIRE_EMIT__;
        }
    });
});
