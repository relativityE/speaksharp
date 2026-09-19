import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * #1501 — CI MUST RUN, AND MUST MEAN SOMETHING, FOR A MERGE-QUEUE CANDIDATE.
 *
 * GitHub's merge queue tests the exact tree about to become `main` by firing `merge_group`. If `ci.yml`
 * does not listen for it, queued PRs wait forever; if the queue's required check can pass without the full
 * lane, the queue merges untested trees. `main` currently requires NO status checks, so enabling the queue
 * (a separate, PO-authorized repository setting) must also make `report` required — this file pins what
 * that setting will rely on.
 */
type Job = { name?: string; needs?: string[] | string; if?: string; steps?: Array<{ env?: Record<string, string>; run?: string }> };
const ci = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8')) as { on: Record<string, unknown>; jobs: Record<string, Job> };

describe('#1501 — merge-queue CI support', () => {
    it('ci.yml runs on the merge queue event', () => {
        const trigger = ci.on.merge_group as { types?: string[] } | undefined;
        expect(trigger, 'merge_group trigger').toBeTruthy();
        expect(trigger?.types).toEqual(['checks_requested']);
    });

    it('the scope step resolves a base for a queue candidate, which carries no pull_request object', () => {
        const classify = ci.jobs.scope.steps?.find((step) => step.env && 'BASE_SHA' in step.env);
        expect(classify?.env?.BASE_SHA).toBe('${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}');
        expect(classify?.env?.EVENT_NAME).toBe('${{ github.event_name }}');
    });

    it('`report` — the check the queue will require — cannot pass without every full-lane job', () => {
        const report = ci.jobs.report;
        expect(report.name).toBe('report');
        expect(report.if).toBe('always() && !cancelled()');
        const needs = Array.isArray(report.needs) ? report.needs : [report.needs];
        for (const job of ['scope', 'unit-coverage-merge', 'edge-tests', 'build', 'health-check', 'e2e', 'full-evidence']) {
            expect(needs, `report needs ${job}`).toContain(job);
        }
        const run = report.steps?.map((step) => step.run ?? '').join('\n') ?? '';
        // Fail closed on a failed classification, and require success from each full-lane result.
        expect(run).toMatch(/SCOPE_RESULT" != "success"[\s\S]*exit 1/);
        expect(run).toMatch(/for r in "\$UNIT_RESULT" "\$EDGE_RESULT" "\$BUILD_RESULT" "\$HEALTH_RESULT" "\$E2E_RESULT" "\$EVIDENCE_RESULT"/);
    });
});
