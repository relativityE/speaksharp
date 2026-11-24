// @vitest-environment node
/**
 * J1.f / J7.d disposable deletion grant (tests/billing/user-journey/accountDeletionLocalStack.mjs): the grant the billing local stack
 * seeds is accepted by the REAL runtime bindings on the CLI stack target, refused anywhere else, and its seed matches the
 * attestation RPC's closed shape and the bindings' scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CLOSURE_SCHEMA_SHA256, COMPLETION_SCHEMA_SHA256, GRANT_WINDOW_MS, LOCAL_TARGET, buildDeletionGrant, closurePhaseSql, coverageSql, envFileLines, localDbUrl }
    from '../billing/user-journey/accountDeletionLocalStack.mjs';
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256, verifyAccountClosureRuntimeBinding }
    from '../../backend/supabase/functions/_shared/accountClosureRuntimeBinding';
import { ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256, readAccountClosureCompletionRuntimeBinding }
    from '../../backend/supabase/functions/_shared/accountClosureCompletionRuntimeBinding';

const PROJECT = 'billing-local-stack-45355779902-1';
const COMMIT = 'f'.repeat(40);
const NOW = Date.parse('2026-11-24T08:00:00Z');
const grant = () => buildDeletionGrant({ projectId: PROJECT, candidateSha: COMMIT, now: NOW,
    ids: { attestationId: '11111111-2222-4333-8444-555555555555', worker: 'w1' } });
const envFor = (g: ReturnType<typeof grant>, target = LOCAL_TARGET) => (k: string) => (k === 'SUPABASE_URL' ? target : g.env[k as keyof typeof g.env]);
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('disposable deletion grant for the billing local stack', () => {
    it('pins the same schema digests as the two runtime bindings', () => {
        expect(CLOSURE_SCHEMA_SHA256).toBe(ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256);
        expect(COMPLETION_SCHEMA_SHA256).toBe(ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256);
    });
    it('the closure binding accepts it on http://kong:8000, as disposable, for exactly this attestation', () => {
        const g = grant();
        const bound = verifyAccountClosureRuntimeBinding(g.env.ACCOUNT_CLOSURE_RUNTIME_BINDING, LOCAL_TARGET, g.env.DENO_DEPLOYMENT_ID);
        expect(bound.target).toEqual({ projectId: PROJECT, environment: 'disposable', url: LOCAL_TARGET });
        expect(bound.scope).toMatchObject({ attestationId: g.attestationId, generation: '0', bindingDigest: g.record.bindingDigest,
            context: { candidateSha: COMMIT, configDigest: g.record.configDigest, migrationDigest: g.record.migrationDigest, projectId: PROJECT, environment: 'disposable' } });
    });
    it('the completion binding accepts it on http://kong:8000 with the scope digest the seed enables', async () => {
        const g = grant();
        expect(await readAccountClosureCompletionRuntimeBinding(envFor(g))).toEqual({ projectId: PROJECT, environment: 'disposable',
            url: LOCAL_TARGET, scopeDigest: g.completionScopeDigest });
        expect(g.seedSql).toContain(`scope_digest='${g.completionScopeDigest}'`);
    });
    it('neither binding accepts it on the real hosted project, another local port, or under another worker', async () => {
        const g = grant();
        // The real project's hosted URL (its ref is never the disposable stack's name), another port, and loopback it was not built for.
        for (const target of ['https://abcdefghijklmnopqrst.supabase.co', 'http://kong:8001']) {
            expect(() => verifyAccountClosureRuntimeBinding(g.env.ACCOUNT_CLOSURE_RUNTIME_BINDING, target, g.env.DENO_DEPLOYMENT_ID)).toThrow();
        }
        for (const target of ['https://abcdefghijklmnopqrst.supabase.co', `https://${PROJECT}.supabase.co`, 'http://kong:8001', 'http://127.0.0.1:54321']) {
            await expect(readAccountClosureCompletionRuntimeBinding(envFor(g, target))).rejects.toThrow();
        }
        expect(() => verifyAccountClosureRuntimeBinding(g.env.ACCOUNT_CLOSURE_RUNTIME_BINDING, LOCAL_TARGET, `${PROJECT}_other`)).toThrow();
    });
    it('the seed matches the attestation RPC: 15-key record, 6-key OFFLINE_VALID validation, payments off, within its 15-minute window', () => {
        const g = grant();
        const rpc = readFileSync('backend/supabase/migrations/20261016090000_account_closure_drain_persistence.sql', 'utf8');
        const recordKeys = /p_record \?& ARRAY\[([^\]]+)\]/.exec(rpc)![1].replace(/\s+/g, '').split(',').map((k) => k.replace(/'/g, '')).sort();
        expect(Object.keys(g.record).sort()).toEqual(recordKeys);
        const validationKeys = /p_validation \?& ARRAY\[([^\]]+)\]/.exec(rpc)![1].replace(/\s+/g, '').split(',').map((k) => k.replace(/'/g, '')).sort();
        expect(Object.keys(g.validation).sort()).toEqual(validationKeys);
        expect(g.validation).toMatchObject({ validation: 'OFFLINE_VALID', activationAuthorized: false, bindingDigest: g.record.bindingDigest,
            evidenceDigest: g.record.evidenceDigest });
        expect(g.record.payments).toEqual({ frontendEnabled: false, backendEnabled: false });
        expect(Date.parse(g.record.expiresAt) - Date.parse(g.record.createdAt)).toBeLessThan(15 * 60_000);
        expect(Date.parse(g.record.expiresAt)).toBe(NOW + GRANT_WINDOW_MS);
    });
    it('the seed records, then drains against, then enables exactly this grant, in one transaction', () => {
        const g = grant(); const sql = g.seedSql;
        const order = ['BEGIN;', `record_account_closure_drain_attestation('${g.attestationId}'::uuid, 0,`,
            `evidence_reference='${g.attestationId}'::uuid`, `scope_digest='${g.completionScopeDigest}'`, 'COMMIT;'].map((s) => sql.indexOf(s));
        expect(order.every((i) => i >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(sql.startsWith('\\set ON_ERROR_STOP on')).toBe(true);
    });
    it('env-file lines carry the two bindings and the worker id, single-line, and nothing the CLI reserves', () => {
        const lines = envFileLines(grant().env);
        expect(lines.map((l) => l.split('=')[0])).toEqual(['ACCOUNT_CLOSURE_RUNTIME_BINDING', 'ACCOUNT_COMPLETION_RUNTIME_BINDING', 'DENO_DEPLOYMENT_ID']);
        expect(lines.some((l) => l.startsWith('SUPABASE_'))).toBe(false);
    });
    it('refuses a malformed project or commit', () => {
        expect(() => buildDeletionGrant({ projectId: 'Prod_Project', candidateSha: COMMIT })).toThrow();
        expect(() => buildDeletionGrant({ projectId: PROJECT, candidateSha: 'abc' })).toThrow();
    });
    it('the coverage seed binds one uuid user\'s pending attempt, pending fence and enabled scope, over a loopback database only', () => {
        const sql = coverageSql('d0110000-0000-4000-8000-000000000001');
        for (const bound of ["a.user_id='d0110000-0000-4000-8000-000000000001'::uuid", "a.phase='pending'", "f.phase='pending'", 'f.request_id=a.request_id', 'cfg.enabled'])
            expect(sql).toContain(bound);
        expect(() => coverageSql("x' OR true --")).toThrow('uuid');
        expect(localDbUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toContain('127.0.0.1:54322');
        expect(() => localDbUrl('postgresql://postgres:postgres@db.example.supabase.co:5432/postgres')).toThrow('loopback');
    });
    it('the closure-phase read is one uuid user\'s attempt over the stack database, and the journey never reads it as service_role', () => {
        expect(closurePhaseSql('d0110000-0000-4000-8000-000000000001'))
            .toBe("SELECT phase FROM public.account_closure_attempts WHERE user_id='d0110000-0000-4000-8000-000000000001'::uuid;");
        expect(() => closurePhaseSql("x' OR true --")).toThrow('uuid');
        const spec = readFileSync('tests/billing/user-journey/account-deletion.billing.spec.ts', 'utf8');
        // Run 45407419238: service_role has no grant on account_closure_attempts, so this read returned `unread`.
        expect(spec).not.toMatch(/admin\.from\('account_closure_attempts'\)/);
        expect(spec).toContain('facts.closurePhase = readClosurePhase(account.uid);');
    });
});
