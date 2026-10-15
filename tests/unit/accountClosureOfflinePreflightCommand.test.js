// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ACCOUNT_CLOSURE_SHA256 } from '../../scripts/lib/accountClosureSchemaGate.mjs';
import { accountClosureBindingDigest } from '../../scripts/lib/accountClosureDrainAttestation.mjs';
import { validateAccountClosureReleasePreflight } from '../../scripts/lib/accountClosureReleasePreflight.mjs';

const command = resolve('scripts/account-closure-offline-preflight.mjs');
const owned = [];
afterEach(() => { for (const directory of owned.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const hash = (letter, length = 64) => letter.repeat(length);
const timestamp = (value) => new Date(value).toISOString();

function fixture(now = Date.now()) {
    const deployments = ['stripe-checkout', 'account-closure'].map((name) => ({ function: name, region: 'us-east-1',
        deploymentId: name, version: 'v2', sha: hash('a', 40) }));
    const legacyScopes = [{ scopeId: 'checkout-old', deploymentId: 'checkout-v1', region: 'us-east-1', sha: hash('b', 40) }];
    const context = { candidateSha: hash('a', 40), mainSha: hash('c', 40), migrationDigest: ACCOUNT_CLOSURE_SHA256,
        configDigest: hash('e'), evidenceDigest: hash('f'), target: { projectId: 'project-test', environment: 'disposable' },
        deployments, legacyScopes, now: timestamp(now) };
    const attestation = { version: 1, candidateSha: context.candidateSha, mainSha: context.mainSha,
        migrationDigest: context.migrationDigest, target: context.target, deployments, configDigest: context.configDigest,
        bindingDigest: accountClosureBindingDigest(context), evidenceDigest: context.evidenceDigest,
        payments: { frontendEnabled: false, backendEnabled: false, evidenceDigest: hash('1') }, operatorId: 'operator-test',
        createdAt: timestamp(now - 5000), expiresAt: timestamp(now + 300000),
        legacyWriters: [{ ...legacyScopes[0], executionLimitMs: 400000, backgroundLimitMs: 400000,
            lastPossibleStartAt: timestamp(now - 600000), observedThrough: timestamp(now - 10000),
            terminationVerified: true, terminationEvidenceDigest: hash('2'), lifetimeEvidenceDigest: hash('3') }],
        inventory: { completedAt: timestamp(now - 15000), pages: [{ cursor: null, nextCursor: null, evidenceDigest: hash('4') }],
            operations: [{ operationId: '11111111-1111-4111-8111-111111111111',
                userId: '22222222-2222-4222-8222-222222222222', phase: 'unknown', disposition: 'quarantined', evidenceDigest: hash('6') }] } };
    const schema = { candidateSha: context.candidateSha, mainSha: context.mainSha, migrationDigest: ACCOUNT_CLOSURE_SHA256,
        target: context.target, receipt: { mode: 'after', passed: true, stages: [
            { mode: 'after', passed: true, checks: { exact_routine_inventory: true, routine_identity_and_acl: true,
                tables_closed_and_rls: true, billing_guard_enabled: true } },
            { mode: 'disabled', passed: true, checks: { rollout_disabled: true } },
            { mode: 'rollout-after', passed: true, checks: { exact_table_definitions: true } },
        ] } };
    return structuredClone({ schema, attestation, context });
}

function inputs(input = fixture()) {
    const directory = mkdtempSync('/private/tmp/cli-dev-closure-command-'); owned.push(directory);
    const paths = Object.fromEntries(Object.entries(input).map(([name, data]) => {
        const path = join(directory, `${name}.json`); writeFileSync(path, JSON.stringify(data)); return [name, path];
    }));
    return { directory, paths, args: ['--schema', paths.schema, '--attestation', paths.attestation, '--context', paths.context] };
}
const run = (args) => spawnSync(process.execPath, [command, ...args], { encoding: 'utf8', timeout: 5000 });
const outcome = (result) => ({ error: result.error, status: result.status, stdout: result.stdout, stderr: JSON.parse(result.stderr) });
const held = (reason, status) => ({ error: undefined, status, stdout: '', stderr: { status: 'HOLD', reason, activationAuthorized: false } });

describe('account closure offline command — actual read-only process boundary', () => {
    it('checks supplied evidence, retains quarantine, reports real time and leaves all inputs unchanged', () => {
        const input = fixture(); const file = inputs(input); const before = file.args.filter((_, i) => i % 2).map((p) => readFileSync(p, 'utf8'));
        const started = Date.now(); const result = run(file.args);
        expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe('');
        const receipt = JSON.parse(result.stdout);
        expect(receipt).toEqual({ ...validateAccountClosureReleasePreflight(input.schema, input.attestation, input.context),
            checkedAt: expect.any(String) });
        expect(Date.parse(receipt.checkedAt)).toBeGreaterThanOrEqual(started);
        expect(Date.parse(receipt.checkedAt)).toBeLessThanOrEqual(Date.now());
        expect(file.args.filter((_, i) => i % 2).map((p) => readFileSync(p, 'utf8'))).toEqual(before);
        expect(result.stdout.trim().split('\n')).toHaveLength(1);
    });

    it('cannot replay expired evidence by supplying its earlier, otherwise-valid context.now', () => {
        const input = fixture(Date.now() - 3600000);
        // Positive historical consistency control; the CLI must not trust this clock.
        expect(validateAccountClosureReleasePreflight(input.schema, input.attestation, input.context).validation).toBe('OFFLINE_VALID');
        expect(outcome(run(inputs(input).args))).toEqual(held('EVIDENCE_NOT_VALID', 3));
    });

    it.each([
        ['schema success flag only', (i) => { i.schema.receipt = { passed: true }; }],
        ['disabled-state failure', (i) => { i.schema.receipt.stages[1].checks.rollout_disabled = false; }],
        ['different current release', (i) => { i.context.candidateSha = hash('d', 40); }],
        ['different current configuration', (i) => { i.context.configDigest = hash('d'); }],
        ['missing independent context', (i) => { i.context = {}; }],
        ['future attestation', (i) => { i.attestation.createdAt = timestamp(Date.now() + 60000); }],
        ['uncertain operation without quarantine', (i) => { i.attestation.inventory.operations[0].disposition = 'reset'; }],
    ])('returns no success output for %s', (_name, mutate) => {
        const input = fixture(); mutate(input);
        expect(outcome(run(inputs(input).args))).toEqual(held('EVIDENCE_NOT_VALID', 3));
    });

    it.each(['schema', 'attestation', 'context'])('rejects malformed %s without echoing contents or paths', (name) => {
        const file = inputs(); writeFileSync(file.paths[name], 'DO_NOT_ECHO_PRIVATE_INPUT');
        expect(outcome(run(file.args))).toEqual(held('INVALID_INPUT', 2));
    });

    it('rejects input larger than one MiB, directories, symlinks and missing files', () => {
        const file = inputs(); const oversized = join(file.directory, 'oversized.json');
        writeFileSync(oversized, 'x'.repeat(1024 * 1024 + 1));
        const link = join(file.directory, 'symlink.json'); symlinkSync(file.paths.schema, link);
        for (const path of [oversized, file.directory, link, join(file.directory, 'DO_NOT_ECHO_MISSING_FILE')]) {
            expect(outcome(run(['--schema', path, ...file.args.slice(2)]))).toEqual(held('INVALID_INPUT', 2));
        }
    });

    it.each([
        [], ['--help', '--activate'], ['--activate', 'true', '--schema', 'x', '--context', 'y'],
        ['--schema', 'x', '--schema', 'y', '--context', 'z'],
        ['--schema', '--context', '--attestation', 'x', '--context', 'y'],
    ])('rejects missing, duplicate or unsupported arguments: %j', (...args) => {
        expect(outcome(run(args))).toEqual(held('INVALID_ARGUMENTS', 2));
    });

    it('has an explicit non-acceptance help path without reading inputs', () => {
        const result = run(['--help']); expect(result.status).toBe(0); expect(result.stderr).toBe('');
        expect(result.stdout).toContain('Offline supplied-evidence validation only');
        expect(result.stdout).not.toContain('OFFLINE_VALID');
    });
});
