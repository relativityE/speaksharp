// @vitest-environment node
/**
 * #1897 Codex P2 (9b288e9): on a #1835 build the Focus journey HOLDs `mode_unset` unless RWT_PRACTICE_CONSENT names the
 * run's consent mode, and the documented live route (rc-gates.yml, diagnostic single-spec step) had no way to set it.
 * The workflow now offers exactly the three modes plus an explicit `unset`, passes the choice as data through env, and the
 * journey reads it only through consentModeFrom, so `unset` (or anything else) is still a HOLD before any take.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CONSENT_MODES, consentModeFrom } from '../live/helpers/rwtPracticeConsent';

type Input = { required?: boolean; default?: string; type?: string; options?: string[] };
type Step = { name?: string; run?: string; env?: Record<string, string> };
type Workflow = { on: { workflow_dispatch: { inputs: Record<string, Input> } }; jobs: Record<string, { steps?: Step[] }> };

const ROOT = resolve(__dirname, '../..');
const wf = parse(readFileSync(resolve(ROOT, '.github/workflows/rc-gates.yml'), 'utf8')) as Workflow;
const diagnosticStep = () => wf.jobs['gate-3-dast'].steps!.find((s) => String(s.name).startsWith('Run DAST Live Gate (DIAGNOSTIC single spec'));

describe('#1897 rc-gates: the run\'s Practice consent mode reaches the RWT diagnostic', () => {
    it('offers exactly unset and the three consent modes, defaulting to unset', () => {
        const input = wf.on.workflow_dispatch.inputs.rwt_practice_consent;
        expect(input).toBeDefined();
        expect(input.type).toBe('choice');
        expect(input.required).toBe(false);
        expect(input.default).toBe('unset');
        expect(input.options).toEqual(['unset', ...Object.keys(CONSENT_MODES)]);
    });

    it('the diagnostic single-spec step passes the choice through env, never into the script', () => {
        const step = diagnosticStep();
        expect(step).toBeDefined();
        expect(step!.env?.RWT_PRACTICE_CONSENT).toBe('${{ github.event.inputs.rwt_practice_consent }}');
        expect(String(step!.run)).not.toMatch(/rwt_practice_consent|RWT_PRACTICE_CONSENT/);
    });

    it('each offered mode resolves to itself; unset (and anything else) resolves to no mode, so the journey HOLDs', () => {
        for (const option of wf.on.workflow_dispatch.inputs.rwt_practice_consent.options!) {
            expect(consentModeFrom(option)).toBe(option === 'unset' ? null : option);
        }
        for (const bad of ['', 'SAVE_ON', 'save_on ', 'constructor', '__proto__', undefined]) expect(consentModeFrom(bad)).toBeNull();
    });
});
