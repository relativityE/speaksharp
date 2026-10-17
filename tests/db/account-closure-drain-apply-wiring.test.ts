// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { assertTerminalOutcome, resolveExactMigrationConfig, verifyMigrationSourceIdentity } from '../../scripts/lib/exactMigrationGate.mjs';

const version = '20261016090000';
const target = `${version}_account_closure_drain_persistence.sql`;
const gate = `postflight_${version}`;
const enforcementVersion = '20261016180000';
describe('drain persistence exact apply — no activation', () => {
    it('pins source, requires closure schema, and excludes commercial activation', () => {
        const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: version });
        expect(config.targetFile).toBe(target);
        expect(config.targetSha256).toBe('d8a5b1d153890167869b2e7d366fb1ae3dd1272a67cd26f3980e6d2cd5233145');
        expect(config.requiredAppliedVersions).toContain('20261013180000');
        expect(config.requiredAppliedVersions).not.toContain('20260812042000');
        expect(config.excludedMigrations.map((item: { version: string }) => item.version)).toContain('20260812042000');
        expect(() => verifyMigrationSourceIdentity('backend/supabase', config)).not.toThrow();
    });
    it.each([undefined, 'skipped', 'failure', 'cancelled'])('refuses terminal PASS with %s postflight', (outcome) => {
        expect(() => assertTerminalOutcome({ apply: 'success', verify: 'success', lint: 'success', targetFile: target,
            postflights: outcome ? { [gate]: outcome } : {} })).toThrow('postflight');
    });
    it('requires the exact named postflight for success', () => {
        expect(assertTerminalOutcome({ apply: 'success', verify: 'success', lint: 'success', targetFile: target,
            postflights: { [gate]: 'success' } }).enforcedPostflights).toEqual([gate]);
    });
    it('wires manual preflight, apply, postflight and terminal with one verified connection', () => {
        const workflow = parse(readFileSync('.github/workflows/apply-exact-allowlisted-migration.yml', 'utf8'));
        expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
        expect(workflow.on.workflow_dispatch.inputs.target_version.options).toContain(version);
        const steps = workflow.jobs['apply-one-allowlisted-migration'].steps;
        const before = steps.findIndex((s: { run?: string }) => s.run?.includes('account-closure-drain-gate.mjs before'));
        const apply = steps.findIndex((s: { id?: string }) => s.id === 'apply');
        const after = steps.findIndex((s: { id?: string }) => s.id === gate);
        const terminal = steps.findIndex((s: { id?: string }) => s.id === 'terminal');
        expect(before).toBeGreaterThan(-1); expect(apply).toBeGreaterThan(before);
        expect(after).toBeGreaterThan(apply); expect(terminal).toBeGreaterThan(after);
        expect(steps.find((s: { id?: string }) => s.id === 'connectivity_preflight').if).toContain(target.replace('.sql', ''));
        expect(steps[after].if).toContain("steps.apply.outcome == 'success'");
        expect(steps[after].run).toContain('account-closure-drain-gate.mjs after');
        expect(steps[terminal].run).toContain(`${gate}=\${{ steps.${gate}.outcome }}`);
        for (const index of [before, after]) {
            expect(steps[index].run).toContain('"$RUNNER_TEMP/pooler.env"');
            expect(steps[index].run).toContain('unset DB_URL');
        }
    });
});

describe('drain enforcement exact apply — separate reviewed target, no activation', () => {
    const target = `${enforcementVersion}_account_closure_drain_enforcement.sql`;
    const gate = `postflight_${enforcementVersion}`;
    it('pins enforcement bytes, requires schema/drain prerequisites, and holds commercial activation', () => {
        const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: enforcementVersion });
        expect(config.targetFile).toBe(target);
        expect(config.targetSha256).toBe('2613a3921d084d008d18e94834c59d0764c108b38385afbcb280cd01760bdce1');
        expect(config.requiredAppliedVersions).toEqual(expect.arrayContaining(['20261013180000', '20261016090000']));
        expect(config.requiredAppliedVersions).not.toContain('20260812042000');
        expect(config.excludedMigrations.map((item: { version: string }) => item.version)).toContain('20260812042000');
        expect(() => verifyMigrationSourceIdentity('backend/supabase', config)).not.toThrow();
    });
    it.each([undefined, 'skipped', 'failure', 'cancelled'])('refuses overall success with %s enforcement postflight', (outcome) => {
        expect(() => assertTerminalOutcome({ apply: 'success', verify: 'success', lint: 'success', targetFile: target,
            postflights: outcome ? { [gate]: outcome } : {} })).toThrow('postflight');
    });
    it('requires the named successful enforcement postflight', () => {
        expect(assertTerminalOutcome({ apply: 'success', verify: 'success', lint: 'success', targetFile: target,
            postflights: { [gate]: 'success' } }).enforcedPostflights).toEqual([gate]);
    });
    it('connects credential preflight, before, guarded apply, after and terminal through the same verified pooler', () => {
        const workflow = parse(readFileSync('.github/workflows/apply-exact-allowlisted-migration.yml', 'utf8'));
        expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
        expect(workflow.on.workflow_dispatch.inputs.target_version.options).toContain(enforcementVersion);
        const steps = workflow.jobs['apply-one-allowlisted-migration'].steps;
        const before = steps.findIndex((s: { run?: string }) => s.run?.includes('account-closure-enforcement-gate.mjs before'));
        const apply = steps.findIndex((s: { id?: string }) => s.id === 'apply');
        const after = steps.findIndex((s: { id?: string }) => s.id === gate);
        const terminal = steps.findIndex((s: { id?: string }) => s.id === 'terminal');
        expect(before).toBeGreaterThan(-1); expect(apply).toBeGreaterThan(before);
        expect(after).toBeGreaterThan(apply); expect(terminal).toBeGreaterThan(after);
        expect(steps.find((s: { id?: string }) => s.id === 'connectivity_preflight').if).toContain(target.replace('.sql', ''));
        expect(steps[after].if).toContain("steps.apply.outcome == 'success'");
        expect(steps[after].run).toContain('account-closure-enforcement-gate.mjs after');
        expect(steps[terminal].run).toContain(`${gate}=\${{ steps.${gate}.outcome }}`);
        for (const index of [before, after]) {
            expect(steps[index].run).toContain('"$RUNNER_TEMP/pooler.env"');
            expect(steps[index].run).toContain('unset DB_URL');
        }
    });
});
