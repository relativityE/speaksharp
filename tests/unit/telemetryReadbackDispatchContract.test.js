/**
 * #1382 — THE WORKFLOW THAT FINALLY INVOKES THE READBACK, AND THE CLAIMS IT MAKES.
 *
 * `tests/unit/controlledTrafficTypeGate.test.js` proves the SCRIPT's controlled-class constraint
 * compiles. This file proves the WORKFLOW that runs it cannot drift from the same contract, because a
 * workflow is the one artifact nothing typechecks: every value in it is a string until the day it runs.
 *
 * Each assertion below is derived from the shipped authority — the traffic vocabulary from
 * `trafficType.ts`, the controlled subset from the script itself, the stage names from
 * `completenessGate.ts` — never restated here. A restated list is a second copy of the contract, and the
 * drift between the two is exactly what these tests exist to catch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repo = resolve(__dirname, '..', '..');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');

const WORKFLOW_PATH = '.github/workflows/telemetry-readback-qualification.yml';
const workflow = read(WORKFLOW_PATH);
const script = read('scripts/telemetry-readback-qualification.mts');
const trafficModule = read('frontend/src/services/telemetry/trafficType.ts');
const gateModule = read('frontend/src/services/telemetry/completenessGate.ts');
const rcGates = read('.github/workflows/rc-gates.yml');

/** The product's whole traffic vocabulary, read from the shipped module. */
const vocabulary = (() => {
    const m = /export const TRAFFIC_TYPES = Object\.freeze\(\[([^\]]+)\]/.exec(trafficModule);
    return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

/** The subset the SCRIPT will accept, read from the script. */
const controlled = (() => {
    const m = /CONTROLLED_EVIDENCE_TRAFFIC[^=]*=\s*\[([^\]]+)\]/.exec(script);
    return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

/** Every qualification stage the gate knows, read from the gate. */
const qualificationStageBlock = /export const QUALIFICATION_STAGES:[\s\S]*?Object\.freeze\(\[([\s\S]*?)\n\]\);/.exec(gateModule)?.[1] ?? '';
const stages = [...qualificationStageBlock.matchAll(/\bstage:\s*'([a-z_]+)'/g)].map((m) => m[1]);
const recordingStages = (() => {
    const m = /const RECORDING_STAGES:[^=]*= new Set\(\[([^\]]+)\]\)/.exec(gateModule);
    return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((stage) => stage[1]) : [];
})();

/** The `options:` block of the traffic_type choice input. */
const workflowTrafficOptions = (() => {
    const block = /traffic_type:[\s\S]*?options:\n((?:\s+- \S+\n)+)/.exec(workflow);
    return block[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
})();

describe('#1382 telemetry readback dispatch workflow — contract', () => {
    it('the fixtures actually parsed (a silent regex miss would make every assertion vacuous)', () => {
        expect(vocabulary).toContain('user');
        expect(controlled.length).toBeGreaterThan(0);
        expect(stages.length).toBeGreaterThan(0);
        expect(recordingStages.length).toBeGreaterThan(0);
        expect(workflowTrafficOptions.length).toBeGreaterThan(0);
    });

    it('offers exactly the controlled classes the script will accept — no wider, no narrower', () => {
        expect([...workflowTrafficOptions].sort()).toEqual([...controlled].sort());
    });

    it('CASUALTY: never offers a class the script HOLDs on, and `user` in particular', () => {
        // `user` is real customer activity. Offering it in the dispatch UI invites an operator to certify
        // a release on a session we did not produce and cannot reproduce.
        const holdClasses = vocabulary.filter((t) => !controlled.includes(t));
        expect(holdClasses).toContain('user');
        for (const cls of holdClasses) {
            expect(workflowTrafficOptions, `${cls} is not a controlled evidence class`).not.toContain(cls);
        }
    });

    it('validates every stage name against the shipped gate, and no invented one', () => {
        // The validation arm is a shell `case` listing the stage names; it must match the gate exactly.
        const arm = /case "\$s" in\n\s+([a-z_]+(?:\|[a-z_]+)*)\) ;;/g.exec(workflow);
        expect(arm, 'the stage validation case arm must exist').not.toBeNull();
        const listed = arm[1].split('|').map((s) => s.trim());
        expect([...listed].sort()).toEqual([...stages].sort());
    });

    it('CASUALTY: derives inline inventory and PDF stages from the gate and accepts them in dispatch validation', () => {
        expect(stages).toContain('analytics_inventory');
        expect(stages).toContain('session_pdf_export');
        const step = /name: Validate dispatch inputs \(fail closed\)[\s\S]*?run: \|\n([\s\S]*?)\n\s{6}# Execute only the workflow/.exec(workflow);
        expect(step).not.toBeNull();
        const validation = step[1].replace(/^ {10}/gm, '');
        const run = (declaredStages) => spawnSync('bash', ['-c', validation], {
            encoding: 'utf8',
            env: { PATH: process.env.PATH, RELEASE_SHA: 'a'.repeat(40), JOURNEY_ID: 'jrn_contract_1234', TRAFFIC_TYPE: 'canary', STAGES: declaredStages, ATTEMPT_IDS: '', WINDOW_HOURS: '24' },
        });
        for (const stage of ['analytics_inventory', 'session_pdf_export']) {
            const result = run(stage);
            expect({ stage, status: result.status, output: result.stdout + result.stderr }).toMatchObject({ status: 0 });
        }
    });

    it('requires unique, valid attempt bindings for recording stages and passes them to readback', () => {
        expect(workflow).toMatch(/QUALIFICATION_ATTEMPT_IDS: \$\{\{ github\.event\.inputs\.attempt_ids \}\}/);
        expect(workflow).toMatch(/attemptIds from this journey’s matching rc-gates\.yml receipt/);
        expect(rcGates).toMatch(/\(b\.attemptIds\|\|\[\]\)\.join\(","\)/);
        expect(rcGates).toMatch(/QUALIFICATION_ATTEMPT_IDS="\$attempts"/);
        const validation = /name: Validate dispatch inputs \(fail closed\)[\s\S]*?run: \|\n([\s\S]*?)\n\s{6}# Execute only the workflow/.exec(workflow)[1].replace(/^ {10}/gm, '');
        const run = (attemptIds) => spawnSync('bash', ['-c', validation], {
            encoding: 'utf8',
            env: { PATH: process.env.PATH, RELEASE_SHA: 'a'.repeat(40), JOURNEY_ID: 'jrn_contract_1234', TRAFFIC_TYPE: 'canary', STAGES: 'session_during,session_after_open_mic', ATTEMPT_IDS: attemptIds, WINDOW_HOURS: '24' },
        });
        expect(run('').status).not.toBe(0);
        expect(run('attempt_1,attempt_2').status).toBe(0);
        expect(run('attempt_1,attempt_1').status).not.toBe(0);
        expect(run('attempt_1,bad.id').status).not.toBe(0);
        expect(run('attempt_1,').status).not.toBe(0);
        const recordingArm = /case "\$s" in\n\s+(session_during[^\n]*)\) recording_stage=1/.exec(workflow);
        expect(recordingArm).not.toBeNull();
        expect(recordingArm[1].split('|').sort()).toEqual([...recordingStages].sort());
    });

    it('is dispatch-only: no schedule, no push, no pull_request', () => {
        // A recurring run would mint a nightly HOLD for a release nobody exercised (PM direction, #1382).
        expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
        expect(workflow).not.toMatch(/^\s{2}schedule:/m);
        expect(workflow).not.toMatch(/^\s{2}push:/m);
        expect(workflow).not.toMatch(/^\s{2}pull_request:/m);
    });

    it('requires the full deployed SHA, the journey id, the class and the stages — none defaulted', () => {
        expect(workflow).toMatch(/\[0-9a-f\]\{40\}/);              // full SHA, never abbreviated
        for (const input of ['release_sha', 'journey_id', 'traffic_type', 'stages']) {
            const block = new RegExp(`${input}:\\n(?:\\s+.*\\n)*?\\s+required: true`);
            expect(workflow, `${input} must be required`).toMatch(block);
        }
        // Only the window may carry a default, and it must be bounded.
        expect(workflow).toMatch(/-ge 1 \] && \[ "\$WINDOW_HOURS" -le 168/);
    });

    it('CASUALTY: the PostHog host comes from the repository variable, as every other PostHog workflow does', () => {
        expect(workflow).toMatch(/POSTHOG_API_HOST: \$\{\{ vars\.POSTHOG_API_HOST \}\}/);
        expect(workflow).not.toMatch(/secrets\.POSTHOG_API_HOST/);
    });

    it('CASUALTY: a separator-only stage list is refused BEFORE any credentialed query', () => {
        // Execute the workflow's own validation step, not a paraphrase of it.
        const step = /name: Validate dispatch inputs \(fail closed\)[\s\S]*?run: \|\n([\s\S]*?)\n\s{6}# Execute only the workflow/.exec(workflow);
        expect(step, 'validation step must be locatable').not.toBeNull();
        const script = step[1].replace(/^ {10}/gm, '');
        const run = (stages) => spawnSync('bash', ['-c', script], {
            encoding: 'utf8',
            env: { PATH: process.env.PATH, RELEASE_SHA: 'a'.repeat(40), JOURNEY_ID: 'jrn_contract_1234', TRAFFIC_TYPE: 'canary', STAGES: stages, ATTEMPT_IDS: '', WINDOW_HOURS: '24' },
        });
        for (const empty of [',', ' ', ' , , ']) {
            const r = run(empty);
            expect(r.status, `stages=${JSON.stringify(empty)} must be refused`).not.toBe(0);
            expect(r.stdout + r.stderr).not.toContain('inputs validated');
        }
        const ok = run('analytics_inventory,session_pdf_export');
        expect({ status: ok.status, output: ok.stdout + ok.stderr }).toMatchObject({ status: 0 });
        expect(ok.stdout).toContain('inputs validated');
    });

    it('refuses a missing PostHog credential rather than skipping', () => {
        expect(workflow).toMatch(/POSTHOG_PERSONAL_API_KEY is not configured/);
        expect(workflow).toMatch(/POSTHOG_PROJECT_ID is not configured/);
    });

    it('checks out trusted main code, never code selected by the operator input', () => {
        expect(workflow).toMatch(/ref: \$\{\{ github\.sha \}\}/);
        expect(workflow).not.toMatch(/ref: \$\{\{ github\.event\.inputs\.release_sha \}\}/);
        expect(workflow).toMatch(/WORKFLOW_REF: \$\{\{ github\.ref \}\}/);
        expect(workflow).toMatch(/TRUSTED_MAIN_SHA: \$\{\{ github\.sha \}\}/);
    });

    it('rejects a release/main mismatch before setup or any credential-bearing step', () => {
        const guardIndex = workflow.indexOf('name: Verify trusted main release binding (fail closed)');
        const setupIndex = workflow.indexOf('uses: ./.github/actions/setup-environment');
        const credentialsIndex = workflow.indexOf('POSTHOG_PERSONAL_API_KEY:');
        expect(guardIndex).toBeGreaterThan(-1);
        expect(guardIndex).toBeLessThan(setupIndex);
        expect(guardIndex).toBeLessThan(credentialsIndex);

        const match = /name: Verify trusted main release binding \(fail closed\)[\s\S]*?run: \|\n([\s\S]*?)\n\s{6}- uses: \.\/\.github\/actions\/setup-environment/.exec(workflow);
        expect(match, 'trusted-main guard must be before setup').not.toBeNull();
        const script = match[1].replace(/^ {10}/gm, '');
        const mainSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
        const run = (releaseSha) => spawnSync('bash', ['-c', script], {
            cwd: repo,
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                RELEASE_SHA: releaseSha,
                WORKFLOW_REF: 'refs/heads/main',
                TRUSTED_MAIN_SHA: mainSha,
            },
        });

        const aligned = run(mainSha);
        expect(aligned.status).toBe(0);
        expect(aligned.stdout).toContain('trusted main release verified');

        const mismatch = run('b'.repeat(40));
        expect(mismatch.status).not.toBe(0);
        expect(mismatch.stdout + mismatch.stderr).toMatch(/release_sha .*does not match protected main/);
    });

    it('refuses workflow execution selected from a non-main ref', () => {
        const match = /name: Verify trusted main release binding \(fail closed\)[\s\S]*?run: \|\n([\s\S]*?)\n\s{6}- uses: \.\/\.github\/actions\/setup-environment/.exec(workflow);
        expect(match).not.toBeNull();
        const script = match[1].replace(/^ {10}/gm, '');
        const result = spawnSync('bash', ['-c', script], {
            cwd: repo,
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                RELEASE_SHA: 'a'.repeat(40),
                WORKFLOW_REF: 'refs/heads/feature/untrusted',
                TRUSTED_MAIN_SHA: 'a'.repeat(40),
            },
        });
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toMatch(/workflow must run from protected main/);
    });

    it('is read-only and cannot write to the repository', () => {
        expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
        expect(workflow).not.toMatch(/contents: write/);
    });

    it('fails when no verdict line was emitted, so a silent run cannot pass for evidence', () => {
        expect(workflow).toMatch(/no evidence line was emitted/);
    });

    it('invokes the shipped npm script rather than re-implementing the readback', () => {
        expect(workflow).toMatch(/pnpm telemetry:readback-qualification/);
        expect(read('package.json')).toMatch(/"telemetry:readback-qualification":/);
    });
});
