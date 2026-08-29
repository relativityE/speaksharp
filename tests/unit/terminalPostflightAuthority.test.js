import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertTerminalOutcome, TARGET_POSTFLIGHT_GATES } from '../../scripts/lib/exactMigrationGate.mjs';

/**
 * #1306 — the TERMINAL exact-operation authority must include the applicable postflight.
 *
 * THE DEFECT. The workflow passed `postflight_1314` as a trailing positional argument that the CLI never
 * forwarded, and never passed `postflight_1306` at all. So the terminal step could report
 * "exact-operation success" while the reviewed operation was unverified. An earlier step going red is not a
 * substitute: the terminal result is what the summary and the run conclusion report.
 */
const V1306 = '20260829120000_retire_complete_session_v1_1306.sql';
const V1314 = '20260819120000_complete_session_v2_atomic_retention_1314.sql';
const ok = { apply: 'success', verify: 'success', lint: 'success' };

describe('terminal authority — the applicable postflight is REQUIRED', () => {
    it.each(['failure', 'cancelled', 'skipped', '', undefined])(
        'Stage B target with postflight_1306=%s does NOT report terminal success', (outcome) => {
            expect(() => assertTerminalOutcome({
                ...ok, targetFile: V1306,
                postflights: { postflight_1314: 'skipped', ...(outcome === undefined ? {} : { postflight_1306: outcome }) },
            })).toThrow(/postflight_1306/);
        });

    it('SKIPPED-WHEN-APPLICABLE is a failure, not a pass', () => {
        // The subtlest casualty: the gate never ran, so nothing was verified, yet 'skipped' reads benign.
        expect(() => assertTerminalOutcome({
            ...ok, targetFile: V1306, postflights: { postflight_1306: 'skipped' },
        })).toThrow(/must be success/);
    });

    it('POSITIVE CONTROL: Stage B with a successful postflight reports which gate was enforced', () => {
        expect(assertTerminalOutcome({
            ...ok, targetFile: V1306, postflights: { postflight_1306: 'success', postflight_1314: 'skipped' },
        })).toEqual({ terminal: 'success', enforcedPostflights: ['postflight_1306'] });
    });

    it('the #1314 target still enforces its own gate, unchanged', () => {
        expect(() => assertTerminalOutcome({
            ...ok, targetFile: V1314, postflights: { postflight_1314: 'failure' },
        })).toThrow(/postflight_1314/);
        expect(assertTerminalOutcome({
            ...ok, targetFile: V1314, postflights: { postflight_1314: 'success', postflight_1306: 'skipped' },
        })).toEqual({ terminal: 'success', enforcedPostflights: ['postflight_1314'] });
    });
});

describe('terminal authority — fails closed rather than assuming', () => {
    it('refuses without the target filename — applicability cannot be guessed', () => {
        // Defaulting to "nothing applies" would make every postflight optional: the exact hole being closed.
        expect(() => assertTerminalOutcome({ ...ok, postflights: {} })).toThrow(/requires the applied target filename/);
        expect(() => assertTerminalOutcome({ ...ok, targetFile: '   ', postflights: {} })).toThrow(/target filename/);
    });

    it('refuses a target with no registered postflight instead of passing it through', () => {
        expect(() => assertTerminalOutcome({
            ...ok, targetFile: '20260812042000_commercial_activation.sql', postflights: {},
        })).toThrow(/no target-specific postflight is registered/);
    });

    it('rejects an UNKNOWN gate id rather than silently ignoring it', () => {
        // Silent tolerance of an unrecognised key is how the original argument got dropped.
        expect(() => assertTerminalOutcome({
            ...ok, targetFile: V1306, postflights: { postflight_1306: 'success', postflight_9999: 'failure' },
        })).toThrow(/unknown postflight gate/);
    });

    it('rejects a gate that RAN for a target it does not verify', () => {
        expect(() => assertTerminalOutcome({
            ...ok, targetFile: V1306, postflights: { postflight_1306: 'success', postflight_1314: 'success' },
        })).toThrow(/does not verify/);
    });

    it.each([['apply'], ['verify'], ['lint']])('still fails when %s did not succeed', (field) => {
        expect(() => assertTerminalOutcome({
            ...ok, [field]: 'failure', targetFile: V1306, postflights: { postflight_1306: 'success' },
        })).toThrow();
    });
});

describe('the WORKFLOW actually passes both outcomes by name', () => {
    const wf = readFileSync(resolve(__dirname, '../../.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');

    it('the terminal step forwards the target file and BOTH named postflight outcomes', () => {
        const line = wf.slice(wf.indexOf('exact-migration-gate.mjs final'));
        expect(line).toContain('steps.contract.outputs.target_file');
        expect(line).toContain('postflight_1314=');
        expect(line).toContain('postflight_1306=');
    });

    it('every registered gate id corresponds to a real step id in the workflow', () => {
        for (const gate of TARGET_POSTFLIGHT_GATES) expect(wf).toContain(`id: ${gate.id}`);
    });

    it('the published summary reports both postflight outcomes, not just the terminal one', () => {
        expect(wf).toContain('steps.postflight_1306.outcome');
        expect(wf).toContain('steps.postflight_1314.outcome');
    });
});

describe('the CLI no longer drops arguments', () => {
    const CLI = resolve(__dirname, '../../scripts/exact-migration-gate.mjs');
    const run = (args) => {
        try {
            return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8' }) };
        } catch (e) { return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
    };

    it('a FAILED applicable postflight makes the CLI exit nonzero', () => {
        const r = run(['final', 'success', 'success', 'success', V1306, 'postflight_1306=failure']);
        expect(r.code).not.toBe(0);
        expect(r.out).toMatch(/postflight_1306/);
    });

    it('POSITIVE CONTROL: the success path exits zero and names the enforced gate', () => {
        const r = run(['final', 'success', 'success', 'success', V1306,
            'postflight_1314=skipped', 'postflight_1306=success']);
        expect(r.code).toBe(0);
        expect(JSON.parse(r.out).enforcedPostflights).toEqual(['postflight_1306']);
    });

    it('rejects a malformed postflight argument instead of ignoring it', () => {
        expect(run(['final', 'success', 'success', 'success', V1306, 'postflight_1306']).code).toBe(2);
    });
});
