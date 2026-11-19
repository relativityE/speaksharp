// @vitest-environment node
/**
 * #1258 B1 (Browser PM 6097765962) — interrupted-run recovery: ownership is the FULL synthetic identity at the exact run-owned
 * domain (#1580 P1 4237980478); recovery runs only from default-branch bytes with a delete acknowledgement bound to the exact
 * dispatched commit, checked before any credential (#1580 P1 4237980480); selection refuses fresh / non-owned / malformed /
 * ambiguous (across the whole listing) accounts; the listing is bounded and fails closed; no ack = detect-and-HOLD; deletion
 * goes only through the existing fail-closed cleanup; a second run is a no-op; the report never carries an id or email.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MIN_AGE_MS, PROTECTED_DEFAULT_BRANCH, RECOVERY_DELETE_ACK_PREFIX, RWT_JOURNEY_LABELS, deletionDomain, listAuthUsersBounded, ownedPrefixOf, recoverInterruptedRuns,
    recoveryAuthority, recoveryDeleteAck, recoveryReportLine, runOwnedDomain, selectInterruptedRunAccounts,
    type AdminLike, type AuthUserLike,
} from '../live/helpers/rwtInterruptedRunRecovery';
import { runAttemptsTerminal } from '../live/helpers/runOwnedCleanup';

const NOW = Date.parse('2026-10-10T13:00:00Z');
const old = new Date(NOW - MIN_AGE_MS - 60_000).toISOString();
const fresh = new Date(NOW - 10 * 60_000).toISOString();
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const ACK = recoveryDeleteAck(SHA);
const D = 'rwt.example.org'; // an explicitly configured run-owned domain
const uuid = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-${String(n).padStart(12, '0')}`;
const user = (n: number, email: string, created_at: string): AuthUserLike => ({ id: uuid(n), email, created_at });
/** Addresses exactly as the generators mint them. */
const journey = (n: number, label = 'open-mic', domain = D) => `rwt-journey-${label}-${1760000000000 + n}-${38000000000 + n}@${domain}`;
const proof = (prefix: 'private-proof-' | 'retention-proof-', n: number, run = String(38000000000 + n)) => `${prefix}${1760000000000 + n}-${run}@${D}`;

/** A fake admin whose users disappear when the injected cleanup "deletes" them (models the real proof). */
const fakeAdmin = (initial: AuthUserLike[], perPageLimit = Number.POSITIVE_INFINITY) => {
    const users = [...initial];
    const listUsers = vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => {
        const size = Math.min(perPage, perPageLimit);
        return { data: { users: users.slice((page - 1) * size, page * size) }, error: null };
    });
    const admin = { auth: { admin: { listUsers } } } as unknown as AdminLike;
    const cleanup = vi.fn(async ({ capturedUid }: { capturedUid: string }) => {
        const i = users.findIndex((u) => u.id === capturedUid);
        users.splice(i, 1);
        return capturedUid;
    });
    return { admin, cleanup, listUsers };
};
const recover = (p: Partial<Parameters<typeof recoverInterruptedRuns>[0]> & { admin: AdminLike }) =>
    recoverInterruptedRuns({ nowMs: NOW, ack: ACK, sha: SHA, domain: D, ...p });

describe('ownership (#1580 P1 4237980478): the full synthetic identity at the exact domain', () => {
    it('accepts exactly what the generators mint', () => {
        expect(ownedPrefixOf(journey(1), D)).toBe('rwt-journey-');
        expect(ownedPrefixOf(journey(2, 'focus-points'), D)).toBe('rwt-journey-');
        expect(ownedPrefixOf(proof('private-proof-', 3), D)).toBe('private-proof-');
        expect(ownedPrefixOf(proof('retention-proof-', 4, 'local'), D)).toBe('retention-proof-');
    });
    it('CASUALTY: a prefix-only address (a person who chose a run-owned prefix) is never owned', () => {
        for (const email of [
            'rwt-journey-alice', 'rwt-journey-open-mic', 'private-proof-me', 'retention-proof-2024',
            'rwt-journey-open-mic-176000000000-1', // 12-digit ms
            'rwt-journey-other-label-1760000000001-1', 'private-proof-1760000000001-1-x', 'rwt-journey-open-mic-1760000000001-1+tag',
        ].map((local) => `${local}@${D}`)) expect({ email, owned: ownedPrefixOf(email, D) }).toEqual({ email, owned: null });
    });
    it('CASUALTY: the full grammar at a wrong domain is never owned', () => {
        for (const email of [journey(1, 'open-mic', 'gmail.com'), journey(1, 'open-mic', `${D}.evil.io`), journey(1, 'open-mic', `sub.${D}`), journey(1, 'open-mic', 'example.com')]) {
            expect({ email, owned: ownedPrefixOf(email, D) }).toEqual({ email, owned: null });
        }
    });
    it('selection HOLDs prefix-only / wrong-domain rows as ownership_unproven, and they are never deleted even with the exact ack', async () => {
        const rows = [
            user(1, journey(1), old),                                  // owned, eligible
            user(2, 'rwt-journey-alice@example.com', old),             // prefix only
            user(3, journey(3, 'open-mic', 'gmail.com'), old),         // wrong domain
            user(4, 'person@example.com', old),                        // non-owned
        ];
        const { eligible, counts } = selectInterruptedRunAccounts(rows, NOW, D);
        expect(eligible.map((c) => c.id)).toEqual([uuid(1)]);
        expect([counts.nonOwned, counts.ownershipUnproven, counts.runOwned]).toEqual([1, 2, 1]);
        const { admin, cleanup } = fakeAdmin(rows);
        const r = await recover({ admin, cleanup });
        expect([r.status, r.deleted, cleanup.mock.calls.map(([p]) => p.capturedUid)]).toEqual(['RECOVERED', 1, [uuid(1)]]);
    });
    it('every newDisposableEmail label in tests/live is in RWT_JOURNEY_LABELS, and the generators still mint this grammar', () => {
        const live = resolve(__dirname, '../live');
        const sources = [...readdirSync(live), ...readdirSync(resolve(live, 'helpers')).map((f) => `helpers/${f}`)]
            .filter((f) => f.endsWith('.ts')).map((f) => readFileSync(resolve(live, f), 'utf8')).join('\n');
        const labels = [...sources.matchAll(/newDisposableEmail\('([a-z0-9-]+)'\)/g)].map((m) => m[1]);
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) expect(RWT_JOURNEY_LABELS).toContain(label);
        expect(sources).toContain("const unique = `${label}-${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;");
        expect(sources).toContain("return `${RWT_ACCOUNT_PREFIX}${unique}@${process.env.LIVE_TEST_EMAIL_DOMAIN || 'example.com'}`;");
        expect(sources).toContain('createdEmail = `private-proof-${unique}@${TEST_EMAIL_DOMAIN}`;');
        expect(sources).toContain('createdEmail = `${RUN_OWNED_PREFIX}${unique}@${TEST_EMAIL_DOMAIN}`;');
        expect(sources.match(/const unique = `\$\{Date\.now\(\)\}-\$\{process\.env\.GITHUB_RUN_ID \?\? 'local'\}`;/g)?.length).toBe(2);
    });
    it('Browser PM 6100450864 (option B): only an explicit, valid LIVE_TEST_EMAIL_DOMAIN can authorize deletion; no generator fallback', () => {
        expect(runOwnedDomain({})).toBeNull();
        expect(runOwnedDomain({ LIVE_TEST_EMAIL_DOMAIN: '' })).toBeNull();
        expect(runOwnedDomain({ LIVE_TEST_EMAIL_DOMAIN: '   ' })).toBeNull();
        expect(runOwnedDomain({ LIVE_TEST_EMAIL_DOMAIN: 'Test.Example.org' })).toBe('test.example.org');
        for (const bad of ['not a domain', '@example.com', 'example', 'exa_mple.com']) expect(runOwnedDomain({ LIVE_TEST_EMAIL_DOMAIN: bad })).toBeNull();
    });
    it('CASUALTY: with no explicit domain recovery still DETECTS (legacy example.com items reported) but deletes nothing, even with the exact ack', async () => {
        const rows = [user(1, journey(1, 'open-mic', 'example.com'), old), user(2, proof('private-proof-', 2).replace(`@${D}`, '@example.com'), old), user(3, 'rwt-journey-alice@example.com', old)];
        const { admin, cleanup, listUsers } = fakeAdmin(rows);
        const r = await recover({ admin, cleanup, domain: null });
        expect([r.status, listUsers.mock.calls.length, cleanup.mock.calls.length, r.eligible, r.legacyUnqualified, r.ownershipUnproven])
            .toEqual(['HOLD_NO_DOMAIN', 1, 0, 0, 2, 1]);
        expect(recoveryReportLine(r)).toMatch(/status=HOLD_NO_DOMAIN .*legacy_unqualified=2 /);
    });
    it('CASUALTY (Browser PM 6100809177): an EXPLICIT example.com (any case / whitespace) never authorizes deletion — env path and direct parameter', async () => {
        for (const raw of ['example.com', 'EXAMPLE.com', '  Example.COM  ']) {
            expect({ raw, env: runOwnedDomain({ LIVE_TEST_EMAIL_DOMAIN: raw }), direct: deletionDomain(raw) }).toEqual({ raw, env: null, direct: null });
            const legacy = [user(1, journey(1, 'open-mic', 'example.com'), old), user(2, journey(2, 'focus-points', 'EXAMPLE.COM'), old)];
            const { admin, cleanup } = fakeAdmin(legacy);
            // The exact SHA-bound ack, the legacy domain passed DIRECTLY: still no deletion.
            const r = await recover({ admin, cleanup, ack: ACK, domain: raw });
            expect([r.status, r.eligible, r.legacyUnqualified, r.deleted, cleanup.mock.calls.length]).toEqual(['HOLD_NO_DOMAIN', 0, 2, 0, 0]);
            // Selection called directly with the legacy domain classifies the rows as legacy, never eligible.
            const s = selectInterruptedRunAccounts(legacy, NOW, raw);
            expect([s.eligible.length, s.counts.legacyUnqualified, s.counts.runOwned]).toEqual([0, 2, 0]);
        }
    });
    it('CASUALTY (Browser PM 6100809177): a mixed legacy + valid explicit-domain listing deletes only the valid account; legacy cleanup calls stay 0', async () => {
        const rows = [user(1, journey(1, 'open-mic', 'example.com'), old), user(2, journey(2), old), user(3, proof('retention-proof-', 3).replace(`@${D}`, '@Example.com'), old)];
        const { admin, cleanup } = fakeAdmin(rows);
        const r = await recover({ admin, cleanup, ack: ACK });
        expect([r.status, r.deleted, r.legacyUnqualified, cleanup.mock.calls.map(([p]) => p.capturedUid)]).toEqual(['RECOVERED', 1, 2, [uuid(2)]]);
        expect(cleanup.mock.calls.some(([p]) => p.createdEmail.endsWith('@example.com'))).toBe(false);
    });
    it('CASUALTY: with an explicit domain, full-grammar example.com accounts stay unqualified legacy items and are never deleted', async () => {
        const { admin, cleanup } = fakeAdmin([user(1, journey(1), old), user(2, journey(2, 'focus-points', 'example.com'), old)]);
        const r = await recover({ admin, cleanup });
        expect([r.status, r.deleted, r.legacyUnqualified, cleanup.mock.calls.map(([p]) => p.capturedUid)]).toEqual(['RECOVERED', 1, 1, [uuid(1)]]);
    });
});

describe('authority (#1580 P1 4237980480): default branch, HEAD = dispatch SHA, ack bound to that SHA', () => {
    const base = { ref: 'refs/heads/main', sha: SHA, head: SHA, defaultBranch: 'main', ack: '', attempt: '1' };
    it('default branch with no ack = detect only; with the SHA-bound ack = delete authorized', () => {
        expect(recoveryAuthority(base)).toEqual({ ok: true, deleteAuthorized: false });
        expect(recoveryAuthority({ ...base, ack: 'RWT-DISPOSABLE-ACCOUNT-WRITES' })).toEqual({ ok: true, deleteAuthorized: false });
        expect(recoveryAuthority({ ...base, ack: ACK })).toEqual({ ok: true, deleteAuthorized: true });
    });
    it('CASUALTY (Code P1 4238920090): a workflow re-run (or a missing / malformed attempt) is refused even with the exact SHA ack', () => {
        for (const attempt of ['2', '3', '', '0', '01', ' 1', '1 ', 'one']) {
            expect({ attempt, r: recoveryAuthority({ ...base, ack: ACK, attempt }) }).toEqual({ attempt, r: { ok: false, reason: 'workflow_rerun_attempt_refused' } });
            expect({ attempt, r: recoveryAuthority({ ...base, attempt }) }).toEqual({ attempt, r: { ok: false, reason: 'workflow_rerun_attempt_refused' } });
        }
        // Attempt 1 stays valid: detect-only without the ack, delete-authorized with it.
        expect(recoveryAuthority({ ...base, attempt: '1' })).toEqual({ ok: true, deleteAuthorized: false });
        expect(recoveryAuthority({ ...base, attempt: '1', ack: ACK })).toEqual({ ok: true, deleteAuthorized: true });
    });
    it('CASUALTY: a feature-ref dispatch, an unknown default branch, a bad SHA or a HEAD mismatch is refused', () => {
        expect(recoveryAuthority({ ...base, ref: 'refs/heads/fix/1258-rwt-interrupted-run-recovery', ack: ACK })).toEqual({ ok: false, reason: 'not_default_branch' });
        expect(recoveryAuthority({ ...base, ref: 'refs/pull/1580/merge' })).toEqual({ ok: false, reason: 'not_default_branch' });
        expect(recoveryAuthority({ ...base, defaultBranch: '' })).toEqual({ ok: false, reason: 'default_branch_unknown' });
        expect(recoveryAuthority({ ...base, sha: 'abc', head: 'abc' })).toEqual({ ok: false, reason: 'dispatch_sha_invalid' });
        expect(recoveryAuthority({ ...base, head: OTHER_SHA })).toEqual({ ok: false, reason: 'checkout_head_is_not_dispatch_sha' });
    });
    it('CASUALTY: a recovery ack that is unbound or bound to another commit is refused, not downgraded', () => {
        for (const ack of [RECOVERY_DELETE_ACK_PREFIX, recoveryDeleteAck(OTHER_SHA), `${ACK} `, `${ACK}x`]) {
            expect({ ack, r: recoveryAuthority({ ...base, ack }) }).toEqual({ ack, r: { ok: false, reason: 'delete_ack_not_bound_to_this_sha' } });
        }
    });
    it('recovery itself deletes only with the ack bound to its own sha', async () => {
        for (const [ack, sha] of [[recoveryDeleteAck(OTHER_SHA), SHA], [RECOVERY_DELETE_ACK_PREFIX, SHA], [ACK, 'not-a-sha']] as const) {
            const { admin, cleanup } = fakeAdmin([user(1, journey(1), old)]);
            const r = await recover({ admin, cleanup, ack, sha });
            expect([r.status, cleanup.mock.calls.length]).toEqual(['HOLD_NO_ACK', 0]);
        }
    });
    it('the spec checks authority BEFORE creating the service-role client; the workflow checks it in a credential-free step first', () => {
        const spec = readFileSync(resolve(__dirname, '../live/interrupted-run-recovery.live.spec.ts'), 'utf8');
        const check = spec.indexOf('const authority = recoveryAuthority({');
        expect(check).toBeGreaterThan(-1);
        expect(check).toBeLessThan(spec.indexOf('createClient(SUPABASE_URL, SERVICE_ROLE'));
        expect(spec.indexOf("if (!authority.ok) throw new Error(")).toBeLessThan(spec.indexOf('createClient(SUPABASE_URL, SERVICE_ROLE'));
        // The rerun refusal is part of that pre-credential check (Code P1 4238920090).
        const attemptAt = spec.indexOf("attempt: process.env.GITHUB_RUN_ATTEMPT ?? '',");
        expect(attemptAt).toBeGreaterThan(check);
        expect(attemptAt).toBeLessThan(spec.indexOf("if (!authority.ok) throw new Error("));
        expect(spec).toContain("ack: authority.deleteAuthorized ? ACK : ''");
        expect(spec).toContain("execFileSync('git', ['rev-parse', 'HEAD']");
        const wf = readFileSync(resolve(__dirname, '../../.github/workflows/rc-gates.yml'), 'utf8');
        const guardAt = wf.indexOf('      - name: Interrupted-run recovery authority (default branch, exact SHA; credential-free)');
        const dastAt = wf.indexOf('      - name: Run DAST Live Gate (DIAGNOSTIC single spec — NOT a Gate 3 pass)');
        expect(guardAt).toBeGreaterThan(-1);
        expect(guardAt).toBeLessThan(dastAt);
        const guard = wf.slice(guardAt, dastAt);
        expect(guard).toContain("if: ${{ github.event.inputs.diagnostic_dast_spec == 'tests/live/interrupted-run-recovery.live.spec.ts' }}");
        expect(guard).not.toMatch(/secrets\.|SERVICE_ROLE|SUPABASE_URL/);
        expect(guard).toContain('[ "$GITHUB_REF" != "refs/heads/main" ]');
        // Code P1 4238920090: the guard refuses any re-run first, before the ref / HEAD / ack checks.
        const attemptCheck = guard.indexOf('if [ "${GITHUB_RUN_ATTEMPT:-}" != "1" ]; then');
        expect(attemptCheck).toBeGreaterThan(-1);
        expect(attemptCheck).toBeLessThan(guard.indexOf('[ "$GITHUB_REF" != "refs/heads/main" ]'));
        expect(PROTECTED_DEFAULT_BRANCH).toBe('main');
        expect(spec).toContain('defaultBranch: PROTECTED_DEFAULT_BRANCH');
        expect(guard).toContain('[ "$(git rev-parse HEAD)" != "$GITHUB_SHA" ]');
        expect(guard).toContain('[ "$RECOVERY_ACK" != "RWT-INTERRUPTED-RUN-RECOVERY-DELETE@$GITHUB_SHA" ]');
        // Inputs reach the shell only through env, never interpolated into the script.
        expect(guard.slice(guard.indexOf('run: |'))).not.toMatch(/\$\{\{/);
    });
});

describe('selection', () => {
    it('only an old, well-formed, unambiguous owned account is eligible', () => {
        const { eligible, counts } = selectInterruptedRunAccounts([
            user(1, journey(1), old),                                          // eligible
            user(2, journey(2), fresh),                                        // fresh
            user(3, 'person@example.com', old),                                // non-owned
            { id: 'not-a-uuid', email: journey(4), created_at: old },          // malformed id
            user(5, journey(5), 'yesterday'),                                  // malformed date
            user(6, journey(6), new Date(NOW + 60_000).toISOString()),         // created in the future
            user(7, proof('retention-proof-', 7), old), user(8, proof('retention-proof-', 7), old), // ambiguous
        ], NOW, D);
        expect(eligible.map((c) => c.id)).toEqual([uuid(1)]);
        expect(eligible[0].prefix).toBe('rwt-journey-');
        expect(counts).toEqual({ scanned: 8, nonOwned: 1, ownershipUnproven: 0, legacyUnqualified: 0, runOwned: 7, fresh: 1, malformed: 3, ambiguous: 2, eligible: 1 });
    });
    it('CASUALTY (CLI PM 6098304364 #1): a fresh / non-owned / malformed row sharing an old account\'s id or email makes it ambiguous', () => {
        const oldA = user(1, journey(1), old);
        const cases: Array<[string, AuthUserLike]> = [
            ['fresh duplicate email', user(2, journey(1), fresh)],
            ['non-owned duplicate id', user(1, 'person@example.com', old)],
            ['malformed duplicate email', { id: 'not-a-uuid', email: journey(1).toUpperCase(), created_at: old }],
            ['malformed-date duplicate id (upper-case)', { id: uuid(1).toUpperCase(), email: journey(9), created_at: 'yesterday' }],
        ];
        for (const [label, dup] of cases) {
            const { eligible, counts } = selectInterruptedRunAccounts([oldA, dup], NOW, D);
            expect({ label, eligible: eligible.length, ambiguous: counts.ambiguous }).toEqual({ label, eligible: 0, ambiguous: 1 });
        }
        // Control: the same old account beside an unrelated row stays eligible.
        expect(selectInterruptedRunAccounts([oldA, user(9, journey(9), fresh)], NOW, D).eligible.map((c) => c.id)).toEqual([uuid(1)]);
    });
    it('the age floor is the gate-3 job timeout plus a safety margin (105 + 30 = 135 min; coupled to rc-gates.yml)', () => {
        expect(MIN_AGE_MS).toBe(135 * 60_000);
        const justYoung = new Date(NOW - MIN_AGE_MS + 1_000).toISOString();
        expect(selectInterruptedRunAccounts([user(1, journey(1), justYoung)], NOW, D).counts.fresh).toBe(1);
    });
});

describe('listing', () => {
    it('pages until a short page; an API error fails closed', async () => {
        const users = Array.from({ length: 5 }, (_, i) => user(i + 1, `x${i}@example.com`, old));
        const { admin, listUsers } = fakeAdmin(users, 2);
        expect((await listAuthUsersBounded(admin, 2, 10)).users).toHaveLength(5);
        expect(listUsers).toHaveBeenCalledTimes(3);
        const broken = { auth: { admin: { listUsers: async () => ({ data: null, error: { code: 'boom' } }) } } } as unknown as AdminLike;
        await expect(listAuthUsersBounded(broken)).rejects.toThrow(/fail closed/);
    });
    it('CASUALTY (CLI PM 6098304364 #2): a null / missing / non-array users payload or a non-object row is malformed, never an empty page', async () => {
        const payloads: unknown[] = [null, {}, { users: null }, { users: 'x' }, { users: {} }, { users: [null] }, { users: ['row'] }, { users: [[]] }];
        for (const data of payloads) {
            const admin = { auth: { admin: { listUsers: async () => ({ data, error: null }) } } } as unknown as AdminLike;
            await expect(listAuthUsersBounded(admin)).rejects.toThrow(/malformed page \(fail closed\)/);
            const cleanup = vi.fn();
            await expect(recover({ admin, cleanup })).rejects.toThrow(/malformed page/);
            expect(cleanup).not.toHaveBeenCalled();
        }
    });
    it('CASUALTY: a malformed page AFTER a valid full page still refuses the whole listing; no cleanup runs', async () => {
        const first = [user(1, journey(1), old), user(2, journey(2), old)];
        const listUsers = vi.fn(async ({ page }: { page: number }) => (page === 1 ? { data: { users: first }, error: null } : { data: null, error: null }));
        const admin = { auth: { admin: { listUsers } } } as unknown as AdminLike;
        const cleanup = vi.fn();
        await expect(recover({ admin, cleanup, perPage: 2 })).rejects.toThrow(/malformed page/);
        expect([listUsers.mock.calls.length, cleanup.mock.calls.length]).toEqual([2, 0]);
    });
    it('CASUALTY: hitting the page cap with a full page is INCOMPLETE → HOLD, nothing deleted', async () => {
        const users = Array.from({ length: 4 }, (_, i) => user(i + 1, journey(i + 1), old));
        const { admin, cleanup } = fakeAdmin(users, 2);
        const r = await recover({ admin, cleanup, perPage: 2, maxPages: 2 });
        expect([r.status, cleanup.mock.calls.length]).toEqual(['HOLD_INCOMPLETE_LISTING', 0]);
    });
});

describe('recovery', () => {
    const accounts = () => [user(1, journey(1), old), user(2, proof('private-proof-', 2), old), user(3, journey(3), fresh)];

    it('no ack (or the journeys\' ack) detects and HOLDs: the cleanup is never called', async () => {
        for (const ack of ['', 'RWT-DISPOSABLE-ACCOUNT-WRITES']) {
            const { admin, cleanup } = fakeAdmin(accounts());
            const r = await recover({ admin, cleanup, ack });
            expect([r.status, r.eligible, r.deleted, cleanup.mock.calls.length]).toEqual(['HOLD_NO_ACK', 2, 0, 0]);
        }
    });
    it('with the SHA-bound ack, each eligible account goes through the cleanup proof with its own prefix; a second run is a no-op', async () => {
        const { admin, cleanup } = fakeAdmin(accounts());
        const first = await recover({ admin, cleanup });
        expect([first.status, first.deleted]).toEqual(['RECOVERED', 2]);
        expect(cleanup.mock.calls.map(([p]) => p.runOwnedPrefix)).toEqual(['rwt-journey-', 'private-proof-']);
        const second = await recover({ admin, cleanup });
        expect([second.status, second.deleted, cleanup.mock.calls.length]).toEqual(['NOTHING_TO_RECOVER', 0, 2]);
    });
    it('CASUALTY: a cleanup that cannot prove deletion stops the run (fail closed) and reports what was proven', async () => {
        const { admin } = fakeAdmin(accounts());
        const cleanup = vi.fn().mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('residue in sessions'));
        const r = await recover({ admin, cleanup });
        expect([r.status, r.deleted, cleanup.mock.calls.length]).toEqual(['FAILED', 1, 2]);
    });
    it('the report line is content-safe (no id, no email) and counts unproven ownership', async () => {
        const { admin, cleanup } = fakeAdmin([...accounts(), user(4, 'rwt-journey-alice@example.com', old)]);
        const line = recoveryReportLine(await recover({ admin, cleanup, ack: '' }));
        expect(line).toMatch(/^RWT_INTERRUPTED_RUN_RECOVERY status=HOLD_NO_ACK .*ownership_unproven=1 /);
        expect(line).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    });
    it('deletion uses the existing fail-closed cleanup by default, and the ack rides the existing rwt_writes_ack input as a distinct value', () => {
        const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtInterruptedRunRecovery.ts'), 'utf8');
        expect(helper).toMatch(/const cleanup = params\.cleanup \?\? cleanupRunOwnedAccount;/);
        const wf = readFileSync(resolve(__dirname, '../../.github/workflows/rc-gates.yml'), 'utf8');
        // No new dispatch input (rc-gates is capped at 10); the existing input documents both values and the refusal.
        expect(wf).not.toMatch(/rwt_recovery_ack|RWT_RECOVERY_ACK/);
        expect(wf).toMatch(/rwt_writes_ack:\n\s+description: "[^"]*RWT-INTERRUPTED-RUN-RECOVERY-DELETE@<the exact 40-hex commit this run executes>[^"]*The journeys refuse that value/);
        const spec = readFileSync(resolve(__dirname, '../live/interrupted-run-recovery.live.spec.ts'), 'utf8');
        expect(spec).toContain("const ACK = process.env.RWT_WRITES_ACK ?? '';");
        // CASUALTY: the journeys' exact-match gate can never accept the recovery value, so one dispatch never authorizes both.
        const journeySrc = readFileSync(resolve(__dirname, '../live/helpers/rwtJourney.ts'), 'utf8');
        expect(journeySrc).toMatch(/process\.env\.RWT_WRITES_ACK !== RWT_WRITES_ACK_VALUE/);
        expect(journeySrc.match(/RWT_WRITES_ACK_VALUE = '([^']+)'/)?.[1]?.startsWith(RECOVERY_DELETE_ACK_PREFIX)).toBe(false);
    });
    it('the recovery spec is not an rwt-* journey spec (no RWT fixture, identity or per-journey telemetry readback)', () => {
        expect(existsSync(resolve(__dirname, '../live/rwt-interrupted-run-recovery.live.spec.ts'))).toBe(false);
        expect(existsSync(resolve(__dirname, '../live/interrupted-run-recovery.live.spec.ts'))).toBe(true);
    });
});


afterEach(() => vi.unstubAllEnvs());
describe('#1811 feedback fences: found by the database, cleaned only after the run attempt is verified terminal', () => {
    const repository = 'relativityE/speaksharp';
    const workflow = `${repository}/.github/workflows/rc-gates.yml@refs/heads/main`;
    const binding = { repository, workflow, runId: '38000000001', runAttempt: '1', role: 'rwt-journey' as const };
    const stubRun = () => {
        for (const [k, v] of Object.entries({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository,
            GITHUB_WORKFLOW_REF: workflow, GITHUB_RUN_ID: '39000000001', GITHUB_RUN_ATTEMPT: '1' })) vi.stubEnv(k, v);
    };
    type Listed = { run_key: string; state: string; binding: unknown };
    /** A listed fence per entry; clean returns `outcome`; verify mirrors it. Records every RPC in order. */
    const withFences = (f: ReturnType<typeof fakeAdmin>, listed: Listed[], outcome = { deleted: 1, residue: 0, foreign: 0 }, listError: { code: string } | null = null) => {
        const calls: string[] = [];
        const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
            calls.push(`${fn}:${String(args.p_run_key ?? args.p_min_age_seconds)}`);
            if (fn === 'list_unresolved_rwt_feedback_fences_v1') return listError ? { data: null, error: listError } : { data: listed, error: null };
            const state = outcome.residue || outcome.foreign ? 'closed' : 'cleaned';
            if (fn === 'close_rwt_feedback_fence_v1') return { data: { state: 'closed', reports: outcome.deleted + outcome.residue, keys: 1 }, error: null };
            if (fn === 'clean_rwt_feedback_fence_v1') return { data: { ...outcome, state }, error: null };
            return { data: { exists: true, state, owner: uuid(1), case: 'AHT-08', recorded: 1, keys: 1, remaining: outcome.residue, foreign: outcome.foreign }, error: null };
        });
        Object.assign(f.admin as object, { rpc });
        return { rpc, calls };
    };
    const fence = (over: Partial<Listed> = {}): Listed => ({ run_key: '38000000001-1-AHT-08', state: 'closed', binding, ...over });
    const terminal = vi.fn(async () => 'terminal' as const);

    it('the post-deletion window: a fence whose account is GONE is still found by listing, verified terminal, closed, cleaned and read back to zero', async () => {
        stubRun();
        const f = fakeAdmin([]); // no run-owned account left to list
        const fences = withFences(f, [fence()]);
        const r = await recover({ ...f, runState: terminal });
        expect(r).toMatchObject({ status: 'RECOVERED', eligible: 0, feedback: { listed: 1, fences: 1, deleted: 1, residue: 0, foreign: 0, held: 0, unproven: 0 } });
        expect(terminal).toHaveBeenCalledWith(binding);
        expect(fences.calls.map((c) => c.split(':')[0])).toEqual(['list_unresolved_rwt_feedback_fences_v1', 'close_rwt_feedback_fence_v1',
            'clean_rwt_feedback_fence_v1', 'verify_rwt_feedback_fence_v1']);
        expect(recoveryReportLine(r)).toContain('feedback_listed=1 feedback_fences=1 feedback_deleted=1 feedback_residue=0 feedback_foreign=0 feedback_held=0 feedback_unproven=0');
    });
    it.each(['active', 'unverifiable'] as const)('a %s run attempt: nothing is closed or cleaned, its account is kept, and the result is HOLD_ACTIVE_RUN', async (state) => {
        stubRun();
        const f = fakeAdmin([{ ...user(1, journey(1), old), app_metadata: { ct_run: binding } }]);
        const fences = withFences(f, [fence({ state: 'open' })]);
        const r = await recover({ ...f, runState: vi.fn(async () => state) });
        expect(r).toMatchObject({ status: 'HOLD_ACTIVE_RUN', deleted: 0, feedback: { listed: 1, fences: 0, held: 1 } });
        expect(fences.calls.map((c) => c.split(':')[0])).toEqual(['list_unresolved_rwt_feedback_fences_v1']);
        expect(f.cleanup).not.toHaveBeenCalled();
    });
    it('a fence that cannot read back to zero, records another account\'s report, or errors stops recovery before any account delete', async () => {
        stubRun();
        for (const outcome of [{ deleted: 0, residue: 1, foreign: 0 }, { deleted: 0, residue: 0, foreign: 1 }]) {
            const f = fakeAdmin([{ ...user(1, journey(1), old), app_metadata: { ct_run: binding } }]);
            withFences(f, [fence()], outcome);
            expect(await recover({ ...f, runState: terminal })).toMatchObject({ status: 'FAILED', deleted: 0 });
            expect(f.cleanup).not.toHaveBeenCalled();
        }
        const listFails = fakeAdmin([]);
        withFences(listFails, [], undefined, { code: '42501' });
        expect(await recover({ ...listFails, runState: terminal })).toMatchObject({ status: 'FAILED' });
    });
    it('a fence of another repository, another workflow, the CURRENT run, or a key not derived from its binding is never touched', async () => {
        stubRun();
        const f = fakeAdmin([]);
        const fences = withFences(f, [
            fence({ binding: { ...binding, repository: 'someone/else' } }),
            fence({ binding: { ...binding, workflow: `${repository}/.github/workflows/other.yml@refs/heads/main` } }),
            fence({ run_key: '39000000001-1-AHT-08', binding: { ...binding, runId: '39000000001' } }),
            fence({ run_key: '38000000001-1-AHT-03' }),
        ]);
        const r = await recover({ ...f, runState: terminal });
        expect(r.feedback).toMatchObject({ listed: 4, fences: 0, unproven: 4 });
        expect(terminal).not.toHaveBeenCalled();
        expect(fences.calls.map((c) => c.split(':')[0])).toEqual(['list_unresolved_rwt_feedback_fences_v1']);
    });
    it('no delete acknowledgement: fences are listed and reported, nothing is touched', async () => {
        stubRun();
        const f = fakeAdmin([]);
        const fences = withFences(f, [fence()]);
        expect(await recover({ ...f, ack: '', runState: terminal })).toMatchObject({ status: 'HOLD_NO_ACK', feedback: { listed: 1, fences: 0 } });
        expect(fences.calls.map((c) => c.split(':')[0])).toEqual(['list_unresolved_rwt_feedback_fences_v1']);
    });
    it('a deployment without the fence migration (function absent) recovers accounts exactly as before', async () => {
        stubRun();
        const f = fakeAdmin([{ ...user(1, journey(1), old), app_metadata: { ct_run: binding } }]);
        withFences(f, [], undefined, { code: 'PGRST202' });
        expect(await recover({ ...f, runState: terminal })).toMatchObject({ status: 'RECOVERED', deleted: 1, feedback: { listed: 0, fences: 0 } });
    });
});

describe('#1811 runAttemptsTerminal (shared with the account deletion): both the owning and the latest attempt are the same completed run', () => {
    const binding = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main',
        runId: '38000000001', runAttempt: '2', role: 'rwt-journey' as const };
    const record = { id: 38000000001, run_attempt: 2, repository: { full_name: 'relativityE/speaksharp' }, path: '.github/workflows/rc-gates.yml',
        status: 'completed', conclusion: 'failure' };
    /** First answer: the exact attempt; second: the run's latest attempt. */
    const answers = (attempt: unknown, latest: unknown = attempt, ok = true) => {
        const bodies = [attempt, latest];
        return vi.fn(async () => ({ ok, json: async () => bodies.shift() }) as unknown as Response);
    };
    it('both reads completed and identical → terminal; reads exactly the owning attempt, then the latest', async () => {
        const fetchImpl = answers(record);
        expect(await runAttemptsTerminal(binding, fetchImpl as never)).toBe(true);
        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            'https://api.github.com/repos/relativityE/speaksharp/actions/runs/38000000001/attempts/2',
            'https://api.github.com/repos/relativityE/speaksharp/actions/runs/38000000001']);
    });
    it('an active owning or latest attempt, a NEWER rerun attempt, a missing conclusion, a foreign repository or workflow, or no answer → not terminal', async () => {
        for (const fetchImpl of [
            answers({ ...record, status: 'in_progress' }),
            answers(record, { ...record, status: 'queued' }),
            answers(record, { ...record, run_attempt: 3 }),           // a rerun started after the owning attempt
            answers({ ...record, conclusion: null }),
            answers({ ...record, repository: { full_name: 'someone/else' } }),
            answers({ ...record, path: '.github/workflows/other.yml' }),
            answers(record, record, false),
            vi.fn(async () => { throw new Error('net'); }),
        ]) expect(await runAttemptsTerminal(binding, fetchImpl as never)).toBe(false);
    });
});

describe('bound interrupted account recovery', () => {
    it('carries the validated original binding to cleanup, refusing malformed/foreign/current-run identities', async () => {
        const repository = 'relativityE/speaksharp';
        const workflow = `${repository}/.github/workflows/rc-gates.yml@refs/heads/main`;
        for (const [k, v] of Object.entries({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository,
            GITHUB_WORKFLOW_REF: workflow, GITHUB_RUN_ID: '39000000001', GITHUB_RUN_ATTEMPT: '1' })) vi.stubEnv(k, v);
        const binding = { repository, workflow, runId: '38000000001', runAttempt: '1', role: 'rwt-journey' as const };
        const account = { ...user(1, journey(1), old), app_metadata: { ct_run: binding } };
        const f = fakeAdmin([account]);
        expect((await recover(f)).status).toBe('RECOVERED');
        expect(f.cleanup).toHaveBeenCalledWith(expect.objectContaining({ recovery: {
            originalBinding: binding, dispatchSha: SHA, deleteAck: ACK, minAgeMs: MIN_AGE_MS,
        } }));
        const held = fakeAdmin([account]);
        held.cleanup.mockRejectedValueOnce(new Error('cleanup_recovery_eligibility_unproven (HOLD)'));
        expect(await recover(held)).toMatchObject({ status: 'HOLD_RECOVERY_ELIGIBILITY', deleted: 0 });
        for (const ct_run of [null, {}, { ...binding, extra: 1 }, { ...binding, repository: 'foreign/repo' },
            { ...binding, workflow: workflow.replace('rc-gates', 'unrelated') }, { ...binding, runId: '38000000002' },
            { ...binding, runAttempt: '0' }, { ...binding, role: 'other' }, { ...binding, runId: '39000000001' }]) {
            const bad = fakeAdmin([{ ...account, app_metadata: { ct_run } }]);
            const result = await recover(bad);
            expect(result.ownershipUnproven).toBe(1);
            expect(bad.cleanup).not.toHaveBeenCalled();
        }
        const noAck = fakeAdmin([account]);
        expect((await recover({ ...noAck, ack: '' })).status).toBe('HOLD_NO_ACK');
        expect(noAck.cleanup).not.toHaveBeenCalled();
    });
});
