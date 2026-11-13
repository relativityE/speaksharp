// @vitest-environment node
/**
 * AHT-01 run 43413270234: `ubuntu-latest` began resolving to ubuntu-26.04, where the pinned Playwright (1.57) has no Chromium
 * build, so `setup-environment` failed before any gate ran. Every rc-gates job that installs Playwright must run on an image
 * that Playwright supports; this pins them to ubuntu-24.04 and fails if one drifts back to a floating label.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { uses?: string; with?: Record<string, unknown> };
type Job = { 'runs-on': string; steps?: Step[] };
const ROOT = resolve(__dirname, '../..');
const load = () => parse(readFileSync(resolve(ROOT, '.github/workflows/rc-gates.yml'), 'utf8')) as { jobs: Record<string, Job> };
const installsPlaywright = (job: Job) =>
    (job.steps ?? []).some((s) => s.uses === './.github/actions/setup-environment' && String(s.with?.['install-playwright']) === 'true');
const unpinnedPlaywrightJobs = (jobs: Record<string, Job>) =>
    Object.entries(jobs).filter(([, job]) => installsPlaywright(job) && job['runs-on'] !== 'ubuntu-24.04').map(([name]) => name);

describe('rc-gates Playwright jobs run on a Playwright-supported runner image', () => {
    it('the three Playwright-installing gates are exactly the pinned ones', () => {
        const { jobs } = load();
        expect(Object.keys(jobs).filter((name) => installsPlaywright(jobs[name])).sort()).toEqual(['gate-1-product', 'gate-3-dast', 'gate-5-ux']);
        expect(unpinnedPlaywrightJobs(jobs)).toEqual([]);
    });

    it('negative control: a Playwright job moved back to ubuntu-latest (or a newer image) is reported', () => {
        for (const label of ['ubuntu-latest', 'ubuntu-26.04']) {
            const { jobs } = load();
            jobs['gate-3-dast']['runs-on'] = label;
            expect(unpinnedPlaywrightJobs(jobs)).toEqual(['gate-3-dast']);
        }
    });
});
