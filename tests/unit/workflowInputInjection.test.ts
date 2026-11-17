// @vitest-environment node
/**
 * Codex security review on #1891: two workflow_dispatch inputs were interpolated straight into shell scripts, so a value containing
 * `$(...)` or a backtick ran as code:
 *   - review-evidence.yml: the free-form `spec` input, in a step that also holds AGENT_SECRET (which authorizes create-user);
 *   - rc-gates.yml gate-3-dast: `diagnostic_dast_spec` / `diagnostic_dast_grep`, echoed inside double quotes in the diagnostic notice.
 * Both now pass the value as data through env; review-evidence also holds it to an existing tests/e2e/*.e2e.spec.ts path.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { name?: string; run?: string; env?: Record<string, string> };
type Workflow = { on: { workflow_dispatch: { inputs: Record<string, { required?: boolean; default?: string }> } }; jobs: Record<string, { steps?: Step[] }> };
const ROOT = resolve(__dirname, '../..');
const load = (file: string) => parse(readFileSync(resolve(ROOT, file), 'utf8')) as Workflow;
const INTERPOLATED_INPUT = /\$\{\{\s*(github\.event\.)?inputs\./;
const scriptsWithInputs = (wf: Workflow) =>
    Object.entries(wf.jobs).flatMap(([job, j]) => (j.steps ?? []).filter((s) => INTERPOLATED_INPUT.test(String(s.run ?? ''))).map((s) => `${job}:${s.name}`));

describe('workflow inputs are data, never script text', () => {
    it('review-evidence: spec is required, passed through env, and allowlisted before the secret-bearing run', () => {
        const wf = load('.github/workflows/review-evidence.yml');
        expect(scriptsWithInputs(wf)).toEqual([]);
        const spec = wf.on.workflow_dispatch.inputs.spec;
        expect(spec.required).toBe(true);
        expect(spec.default).toBeUndefined(); // the former default named a spec that does not exist in the repo
        const step = wf.jobs['review-evidence'].steps!.find((s) => s.name === 'Run evidence spec')!;
        expect(step.env?.EVIDENCE_SPEC).toBe('${{ github.event.inputs.spec }}');
        expect(step.env?.AGENT_SECRET).toBeDefined(); // why this step matters
        const script = String(step.run);
        const dots = script.indexOf('*..*');
        const allow = script.indexOf('^tests/e2e/[A-Za-z0-9._/-]+\\.e2e\\.spec\\.ts$');
        const exists = script.indexOf('[ -f "$EVIDENCE_SPEC" ]');
        const run = script.indexOf('npx playwright test "$EVIDENCE_SPEC"');
        expect(dots).toBeGreaterThanOrEqual(0);
        expect(allow).toBeGreaterThan(dots);
        expect(exists).toBeGreaterThan(allow);
        expect(run).toBeGreaterThan(exists);
    });

    it('rc-gates: the diagnostic notice prints spec and grep from env, verbatim', () => {
        const wf = load('.github/workflows/rc-gates.yml');
        expect(scriptsWithInputs(wf)).toEqual([]);
        const step = wf.jobs['gate-3-dast'].steps!.find((s) => String(s.name).startsWith('Diagnostic single-spec notice'))!;
        expect(step.env).toEqual({ NOTICE_SPEC: '${{ github.event.inputs.diagnostic_dast_spec }}', NOTICE_GREP: '${{ github.event.inputs.diagnostic_dast_grep }}' });
        expect(String(step.run)).toContain(`printf -- '- spec: \`%s\`\\n' "$NOTICE_SPEC"`);
        expect(String(step.run)).toContain(`printf -- '- grep: \`%s\`\\n' "$NOTICE_GREP"`);
    });

    it('negative control: an input written back into a script is reported', () => {
        const wf = load('.github/workflows/review-evidence.yml');
        const step = wf.jobs['review-evidence'].steps!.find((s) => s.name === 'Run evidence spec')!;
        step.run = 'npx playwright test "${{ github.event.inputs.spec }}"';
        expect(scriptsWithInputs(wf)).toEqual(['review-evidence:Run evidence spec']);
    });
});
