// @vitest-environment node
// AHT-15 (fifteen-case front-run review, 2026-11-10): history-preserved and no-recording-or-session-write compare session ROW
// identities and content-free facts, not counts; return-entry-mic-off is an explicit read at the entry; and the deep-linked
// detail must render that session's own saved transcript (digests only). Every verdict fails closed.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    RENDERED_DETAIL_ROW, deepLinkTarget, historyPreservedVerdict, listedOwnTarget, renderedOwnDetailRow, renderedOwnDetailVerdict,
    returnEntryMicVerdict, sessionFactsFromRows, sessionWritesVerdict, type MicStateRead, type RenderedDetailRead, type SessionRowFacts,
} from '../live/helpers/rwtNavigationRows';
import { runDeepLinkReturn, type DeepLinkReturnPorts, type SignInAttemptOutcome } from '../live/helpers/returningSignInAttempt';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const TEXT_A = '  So today I want to talk about the launch.  ';
const TEXT_B = 'A different saved transcript.';
type Raw = { id: string; status?: string | null; transcript_state?: string | null; transcript?: string | null; idempotency_key?: string | null; created_at?: string };
const raw = (id: string, over: Partial<Raw> = {}): Raw => ({
    id, status: 'completed', transcript_state: 'available', transcript: TEXT_B, idempotency_key: `k-${id}`, created_at: `2026-11-0${id.length}T00:00:00Z`, ...over,
});
const facts = (rows: Raw[]): SessionRowFacts[] => {
    const f = sessionFactsFromRows(rows);
    expect(f).not.toBeNull();
    return f!;
};
const BASE = [raw('s1'), raw('s2', { transcript: TEXT_A }), raw('s3', { status: 'active', transcript_state: null, transcript: null })];

describe('sessionFactsFromRows — content-free facts, fail closed', () => {
    it('keeps ids, states, lengths and a digest of the TRIMMED transcript; never the text', () => {
        const f = facts(BASE);
        expect(f.map((r) => r.id)).toEqual(['s1', 's2', 's3']);
        expect(f[1]).toMatchObject({ status: 'completed', transcriptState: 'available', transcriptLength: TEXT_A.length, transcriptDigest: sha(TEXT_A.trim()), hasIdempotencyKey: true });
        expect(f[2]).toMatchObject({ transcriptLength: 0, transcriptDigest: null });
        expect(JSON.stringify(f)).not.toContain('launch');
        expect(JSON.stringify(f)).not.toContain('different');
    });
    it('a whitespace-only transcript has no digest', () => {
        expect(facts([raw('s1', { transcript: '   ' })])[0].transcriptDigest).toBeNull();
    });
    it.each([
        ['not a list', { rows: [] }],
        ['a row without an id', [{ status: 'completed' }]],
        ['an empty id', [raw('')]],
        ['a duplicated id', [raw('s1'), raw('s1')]],
        ['a non-object row', ['s1']],
    ])('%s → null (an unread history is never an empty one)', (_l, data) => {
        expect(sessionFactsFromRows(data)).toBeNull();
    });
    it('an empty list is a readable empty history', () => expect(sessionFactsFromRows([])).toEqual([]));
});

describe('sessionWritesVerdict — navigation writes nothing, by identity', () => {
    const before = facts(BASE);
    it('the same rows with the same facts → PASS', () => {
        const v = sessionWritesVerdict(before, facts(BASE));
        expect(v.verdict).toBe('PASS');
        expect(v.evidence).toMatchObject({ rowsBefore: 3, rowsAfter: 3, added: 0, removed: 0, changed: 0 });
    });
    it('a status flip keeps the count and still FAILS (a count comparison would PASS)', () => {
        const after = facts([BASE[0], BASE[1], { ...BASE[2], status: 'completed' }]);
        const v = sessionWritesVerdict(before, after);
        expect(v.verdict).toBe('FAIL');
        expect(v.evidence).toMatchObject({ added: 0, removed: 0, changed: 1 });
    });
    it('a write followed by a delete (same count, another id) FAILS', () => {
        const v = sessionWritesVerdict(before, facts([BASE[0], BASE[1], raw('s9')]));
        expect(v.verdict).toBe('FAIL');
        expect(v.evidence).toMatchObject({ rowsBefore: 3, rowsAfter: 3, added: 1, removed: 1 });
    });
    it.each([
        ['transcript content (same length)', { transcript: TEXT_B.replace('A', 'B') }],
        ['transcript_state', { transcript_state: 'expired' }],
        ['idempotency key presence', { idempotency_key: null }],
        ['created_at', { created_at: '2030-01-01T00:00:00Z' }],
    ])('a changed %s FAILS', (_l, over) => {
        expect(sessionWritesVerdict(before, facts([{ ...BASE[0], ...over }, BASE[1], BASE[2]])).verdict).toBe('FAIL');
    });
    it('a new row FAILS', () => expect(sessionWritesVerdict(before, facts([...BASE, raw('s4')])).verdict).toBe('FAIL'));
    it('either read missing → HOLD, never PASS', () => {
        expect(sessionWritesVerdict(null, before).verdict).toBe('HOLD');
        expect(sessionWritesVerdict(before, null).verdict).toBe('HOLD');
    });
    it('evidence is counts only (no id, no digest)', () => {
        const v = sessionWritesVerdict(before, facts([BASE[0], BASE[1], raw('s9')]));
        expect(JSON.stringify(v.evidence)).not.toMatch(/s1|s9|[0-9a-f]{64}/);
    });
});

describe('historyPreservedVerdict', () => {
    const before = facts(BASE);
    it('unchanged rows and the own target listed → PASS', () => expect(historyPreservedVerdict(before, facts(BASE), true).verdict).toBe('PASS'));
    it('unchanged rows with no listable target → PASS (listing not judged)', () => {
        const v = historyPreservedVerdict(before, facts(BASE), null);
        expect(v.verdict).toBe('PASS');
        expect(v.evidence.ownTargetListed).toBeNull();
    });
    it('the own target expected on the list but missing → FAIL', () => expect(historyPreservedVerdict(before, facts(BASE), false).verdict).toBe('FAIL'));
    it('a changed row → FAIL', () => {
        expect(historyPreservedVerdict(before, facts([{ ...BASE[0], status: 'error' }, BASE[1], BASE[2]]), true).verdict).toBe('FAIL');
    });
    it('no completed history at sign-in → HOLD', () => {
        const none = facts([BASE[2]]);
        expect(historyPreservedVerdict(none, none, null).verdict).toBe('HOLD');
    });
    it('an unread baseline or Progress read → HOLD', () => {
        expect(historyPreservedVerdict(null, before, true).verdict).toBe('HOLD');
        expect(historyPreservedVerdict(before, null, true).verdict).toBe('HOLD');
    });
});

describe('deepLinkTarget / listedOwnTarget', () => {
    it('the newest completed session with an available, non-empty transcript, with its digest', () => {
        const rows = facts([raw('s1', { transcript: TEXT_A }), raw('s2', { transcript_state: 'expired', transcript: null }), raw('s3', { status: 'active' })]);
        expect(deepLinkTarget(rows)).toEqual({ id: 's1', expectedDigest: sha(TEXT_A.trim()) });
    });
    it('no available transcript → the newest completed session, for routing only (no digest)', () => {
        const rows = facts([raw('s1', { transcript_state: 'expired', transcript: null }), raw('s2', { transcript: '  ' })]);
        expect(deepLinkTarget(rows)).toEqual({ id: 's2', expectedDigest: null });
    });
    it('no completed session → null', () => expect(deepLinkTarget(facts([raw('s1', { status: 'active' })]))).toBeNull());
    it('the target is required on Progress only when it is among the two newest listed rows', () => {
        expect(listedOwnTarget(facts([raw('s1'), raw('s2'), raw('s3')]))).toBe('s3');
        // s1 is the only readable one, but two newer completed rows fill the recent list.
        const older = facts([raw('s1'), raw('s2', { transcript_state: 'expired', transcript: null }), raw('s3', { transcript_state: 'expired', transcript: null })]);
        expect(deepLinkTarget(older)?.id).toBe('s1');
        expect(listedOwnTarget(older)).toBeNull();
        expect(listedOwnTarget(facts([raw('s1', { transcript_state: 'expired', transcript: null })]))).toBeNull();
    });
});

describe('returnEntryMicVerdict — explicit read at the return entry', () => {
    const off: MicStateRead = { counterInstalled: true, acquisitions: 0, liveTracks: 0, tracksWellFormed: true, recorderVisible: false, runtimeState: 'IDLE', document: 1 };
    it('no acquisition, no live track, no recorder, not recording → PASS', () => expect(returnEntryMicVerdict(off).verdict).toBe('PASS'));
    it.each([
        ['an acquisition', { acquisitions: 1 }],
        ['a live track', { liveTracks: 1 }],
        ['a visible recorder', { recorderVisible: true }],
        ['RECORDING state', { runtimeState: 'RECORDING' }],
    ])('%s → FAIL', (_l, over) => expect(returnEntryMicVerdict({ ...off, ...over }).verdict).toBe('FAIL'));
    it.each([
        ['an unreadable page', null],
        ['no counter', { ...off, counterInstalled: false }],
        ['an unexpected track state', { ...off, tracksWellFormed: false }],
        ['a malformed count', { ...off, acquisitions: -1 }],
    ])('%s → HOLD, never PASS', (_l, read) => expect(returnEntryMicVerdict(read as MicStateRead | null).verdict).toBe('HOLD'));
});

describe('renderedOwnDetailVerdict — the deep-linked detail is that session\'s own', () => {
    const expected = sha(TEXT_A.trim());
    const routed = { verdict: 'PASS' as const, pathnameMatches: true };
    const shown: RenderedDetailRead = { reviewVisible: true, transcriptVisible: true, digest: expected };
    it('the rendered transcript digest equals the saved one → PASS', () => expect(renderedOwnDetailVerdict(expected, routed, shown).verdict).toBe('PASS'));
    it('another transcript → FAIL', () => expect(renderedOwnDetailVerdict(expected, routed, { ...shown, digest: sha(TEXT_B) }).verdict).toBe('FAIL'));
    it('review or transcript not shown → FAIL', () => {
        expect(renderedOwnDetailVerdict(expected, routed, { ...shown, transcriptVisible: false, digest: null }).verdict).toBe('FAIL');
        expect(renderedOwnDetailVerdict(expected, routed, { ...shown, reviewVisible: false }).verdict).toBe('FAIL');
    });
    it('a routing FAIL that missed the pathname → FAIL; a routing FAIL on the pathname is judged by the digest', () => {
        expect(renderedOwnDetailVerdict(expected, { verdict: 'FAIL', pathnameMatches: false }, shown).verdict).toBe('FAIL');
        expect(renderedOwnDetailVerdict(expected, { verdict: 'FAIL', pathnameMatches: true }, shown).verdict).toBe('PASS');
    });
    it.each([
        ['no available transcript to compare', null, routed, shown],
        ['an unproven routing', expected, { verdict: 'HOLD' as const, pathnameMatches: false }, shown],
        ['a return never reached', expected, null, shown],
        ['an unread page', expected, routed, null],
        ['an undigestable transcript', expected, routed, { ...shown, digest: null }],
    ])('%s → HOLD', (_l, exp, routing, read) => expect(renderedOwnDetailVerdict(exp, routing, read).verdict).toBe('HOLD'));
    it('evidence carries no digest', () => {
        expect(JSON.stringify(renderedOwnDetailVerdict(expected, routed, { ...shown, digest: sha(TEXT_B) }).evidence)).not.toMatch(/[0-9a-f]{64}/);
    });
    it('the page is read only when there is a digest to compare and the routing was proven', async () => {
        let reads = 0;
        const read = async () => { reads += 1; return shown; };
        expect((await renderedOwnDetailRow(null, routed, read)).verdict).toBe('HOLD');
        expect((await renderedOwnDetailRow(expected, { verdict: 'HOLD', pathnameMatches: false }, read)).verdict).toBe('HOLD');
        expect(reads).toBe(0);
        expect((await renderedOwnDetailRow(expected, routed, read)).verdict).toBe('PASS');
        expect((await renderedOwnDetailRow(expected, routed, async () => { throw new Error('closed'); })).verdict).toBe('HOLD');
        expect(reads).toBe(1);
    });
});

/** Minimal deterministic ports for `runDeepLinkReturn`: one scripted outcome, a page that never closes. */
function ports(over: Partial<DeepLinkReturnPorts> & { outcome?: SignInAttemptOutcome } = {}) {
    const rows: Array<{ name: string; verdict: string }> = [];
    const log: string[] = [];
    let session: string | null = null;
    let doc = 1;
    const outcome: SignInAttemptOutcome = over.outcome ?? { kind: 'token_ok', status: 200, userId: 'u' };
    const p: DeepLinkReturnPorts = {
        target: { pathname: '/progress/x', search: '?g04=1', hash: '#history' }, verifiedUserId: 'u', micBaseline: 0, micBaselineRead: { count: 0, document: 1 },
        openLegacyLink: async () => { log.push('goto'); doc = 2; },
        armObserver: () => ({ settle: async () => outcome, final: () => outcome, dispose: () => undefined }),
        submit: async () => { log.push('submit'); session = 'u'; },
        isClosed: () => false,
        sessionUserId: async () => session,
        awaitSessionUser: async (e) => session === e,
        awaitLanding: async () => undefined,
        url: () => new URL('https://app.example/progress/x?g04=1#history'),
        micAcquisitions: async () => { log.push('mic'); return { count: 0, document: doc }; },
        signOut: async () => { log.push('sign-out'); session = null; return 'direct'; },
        awaitSessionCleared: async () => session === null,
        recordWrites: async () => { log.push('writes'); },
        row: (name, verdict) => { rows.push({ name, verdict }); },
        ...over,
    };
    return { p, rows, log };
}

describe('runDeepLinkReturn wiring of the rendered-detail port', () => {
    it('judged in the deep-link document, after the routing row and before the microphone read and the sign-out', async () => {
        const seen: unknown[] = [];
        const h = ports({ renderedDetail: async (routing) => { seen.push(routing); h.log.push('rendered'); return { verdict: 'PASS', detail: 'own' }; } });
        await runDeepLinkReturn(h.p);
        expect(seen).toEqual([{ verdict: 'PASS', pathnameMatches: true }]);
        expect(h.rows.map((r) => r.name).indexOf(RENDERED_DETAIL_ROW)).toBeGreaterThan(h.rows.map((r) => r.name).indexOf('signed-in deep-link return'));
        expect(h.rows.find((r) => r.name === RENDERED_DETAIL_ROW)?.verdict).toBe('PASS');
        const lastMic = h.log.lastIndexOf('mic');
        expect(h.log.indexOf('rendered')).toBeLessThan(lastMic);
        expect(lastMic).toBeLessThan(h.log.indexOf('sign-out'));
    });
    it('a failed navigation still writes the row, from a null routing', async () => {
        const seen: unknown[] = [];
        const h = ports({
            openLegacyLink: async () => { throw new Error('nav'); },
            renderedDetail: async (routing) => { seen.push(routing); return renderedOwnDetailRow('a'.repeat(64), routing, async () => null); },
        });
        await expect(runDeepLinkReturn(h.p)).rejects.toThrow(/HOLD/);
        expect(seen).toEqual([null]);
        expect(h.rows.find((r) => r.name === RENDERED_DETAIL_ROW)?.verdict).toBe('HOLD');
    });
    it('a rejecting port is that row\'s HOLD, and cleanup still runs', async () => {
        const h = ports({ renderedDetail: async () => { throw new TypeError('boom /progress/x'); } });
        await expect(runDeepLinkReturn(h.p)).rejects.toThrow(/rendered detail check failed \(TypeError\)/);
        expect(h.rows.find((r) => r.name === RENDERED_DETAIL_ROW)?.verdict).toBe('HOLD');
        expect(h.log).toContain('sign-out');
        expect(h.log).toContain('writes');
    });
    it('without the port nothing changes: no rendered row', async () => {
        const h = ports();
        await runDeepLinkReturn(h.p);
        expect(h.rows.some((r) => r.name === RENDERED_DETAIL_ROW)).toBe(false);
    });
});

describe('the AHT-15 spec wires the rows in order', () => {
    const spec = readFileSync(path.resolve(here, '../live/rwt-products-navigation.live.spec.ts'), 'utf8');
    const at = (needle: string) => {
        const i = spec.indexOf(needle);
        if (i < 0) throw new Error(`the spec lacks: ${needle}`);
        return i;
    };
    it('return-entry-mic-off is read right after the sign-in step and before the Products bridge', () => {
        const signIn = at("if (!verdict.proceed) throw new Error(`${verdict.verdict} returning-user sign-in: ${verdict.detail}`);");
        const read = at('const entryMic = await readMicState(page);');
        const row = at("receipt.row('no mic on return entry', entry.verdict, entry.detail, entry.evidence);");
        const bridge = at("await test.step('Products → Open Mic ↔ Focus Points'");
        expect(signIn).toBeLessThan(read);
        expect(read).toBeLessThan(row);
        expect(row).toBeLessThan(bridge);
    });
    it('the baseline rows are read at sign-in, before any navigation, and judged after Progress, navigation and the deep link', () => {
        const baseline = at('baselineRows = await readSessionFacts(uid);');
        const bridge = at("await test.step('Products → Open Mic ↔ Focus Points'");
        const preserved = at("receipt.row('history preserved', preserved.verdict, preserved.detail, preserved.evidence);");
        const writes = at('const writes = sessionWritesVerdict(baselineRows, await readSessionFacts(uid));');
        const deepWrites = at("receipt.row('deep-link return writes nothing', writes.verdict, writes.detail,");
        expect(baseline).toBeLessThan(bridge);
        expect(bridge).toBeLessThan(preserved);
        expect(preserved).toBeLessThan(writes);
        expect(writes).toBeLessThan(deepWrites);
        // The count-only verdict is gone from this spec.
        expect(spec).not.toMatch(/navigationWritesVerdict\(/);
    });
    it('the deep link targets the newest available transcript and passes the rendered-detail port with only its digest', () => {
        const step = spec.slice(at("test.step('a signed-out deep link returns to its exact Progress session after sign-in'"), at('// ── end G04'));
        expect(step).toMatch(/const chosen = await readSessionFacts\(uid\)\.then\(\(rows\) => \(rows \? deepLinkTarget\(rows\) : null\)\);/);
        expect(step).toMatch(/renderedDetail: \(routing\) => renderedOwnDetailRow\(expectedDigest, routing, \(\) => readRenderedDetail\(page\)\),/);
        expect(step.indexOf('receipt.forbid(targetId)')).toBeLessThan(step.indexOf('await runDeepLinkReturn({'));
        expect(step).not.toMatch(/innerText/);
    });
});
