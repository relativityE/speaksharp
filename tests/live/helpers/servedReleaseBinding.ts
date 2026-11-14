/**
 * Post-release smoke binding (review RETURN on #1815 bb4b0c3c): a smoke is evidence for a release only when the page it ran
 * against names EXACTLY the release under test. The expected release is the explicit `EXPECT_RELEASE_SHA` (the served release
 * being smoke-tested), never the dispatched source SHA, which may be ahead of production. Fails closed on anything missing.
 */
const FULL_SHA = /^[0-9a-f]{40}$/;

export type ServedReleaseVerdict =
    | { ok: true; release: string }
    | { ok: false; reason: 'expected-missing' | 'expected-malformed' | 'observed-missing' | 'observed-malformed' | 'mismatch' };

export function servedReleaseVerdict(expected: string | null | undefined, observed: unknown): ServedReleaseVerdict {
    const want = typeof expected === 'string' ? expected.trim() : '';
    if (!want) return { ok: false, reason: 'expected-missing' };
    if (!FULL_SHA.test(want)) return { ok: false, reason: 'expected-malformed' };
    if (observed === null || observed === undefined || observed === '') return { ok: false, reason: 'observed-missing' };
    if (typeof observed !== 'string' || !FULL_SHA.test(observed)) return { ok: false, reason: 'observed-malformed' };
    return observed === want ? { ok: true, release: want } : { ok: false, reason: 'mismatch' };
}

/** A deployed target needs a release binding; only a local development target may run without one. */
export function requiresReleaseBinding(baseUrl: string | null | undefined): boolean {
    if (!baseUrl) return true;
    try {
        const host = new URL(baseUrl).hostname;
        return !(host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost'));
    } catch {
        return true;
    }
}
