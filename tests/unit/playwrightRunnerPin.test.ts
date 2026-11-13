// @vitest-environment node
/**
 * `ubuntu-latest` began resolving to ubuntu-26.04, where the pinned Playwright (1.57) has no Chromium build:
 *   - AHT-01 run 43413270234: rc-gates `setup-environment` failed before any gate ran;
 *   - main CI 43413866919: ci.yml `deps-prep` got no `install-deps --dry-run` list and every apt-bundle consumer failed;
 *   - #1839's own run 43418320824: the #1047 U3 cross-page workflow's own `deps-prep` failed the same way;
 *   - canary run 43428299133: canary-check's Setup Environment failed before any lane ran.
 * Until the Playwright upgrade (#1840), every job that sets up the environment runs on ubuntu-24.04. The one deliberate exception is
 * ci.yml `full-evidence`, which needs the system Chrome >=156 that only the ubuntu-26.04 images ship (nativeTestExecutionEvidence).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { uses?: string; with?: Record<string, unknown> };
type Job = { 'runs-on': string; steps?: Step[] };
const ROOT = resolve(__dirname, '../..');
const load = (file: string) => parse(readFileSync(resolve(ROOT, file), 'utf8')) as { jobs: Record<string, Job> };
const setsUpEnvironment = (job: Job) => (job.steps ?? []).some((s) => s.uses === './.github/actions/setup-environment');
const installsPlaywright = (job: Job) =>
    (job.steps ?? []).some((s) => s.uses === './.github/actions/setup-environment' && String(s.with?.['install-playwright']) === 'true');
const EXCEPTIONS: Record<string, string> = { 'full-evidence': 'ubuntu-26.04' };
const offPin = (jobs: Record<string, Job>, select: (job: Job) => boolean) =>
    Object.entries(jobs).filter(([name, job]) => select(job) && job['runs-on'] !== (EXCEPTIONS[name] ?? 'ubuntu-24.04')).map(([name]) => name);

describe('Playwright-dependent jobs run on a runner image the pinned Playwright supports', () => {
    it('rc-gates: the three Playwright-installing gates are exactly the pinned ones', () => {
        const { jobs } = load('.github/workflows/rc-gates.yml');
        expect(Object.keys(jobs).filter((name) => installsPlaywright(jobs[name])).sort()).toEqual(['gate-1-product', 'gate-3-dast', 'gate-5-ux']);
        expect(offPin(jobs, installsPlaywright)).toEqual([]);
    });

    it('ci.yml: every environment-setup job is on ubuntu-24.04, except full-evidence on ubuntu-26.04', () => {
        const { jobs } = load('.github/workflows/ci.yml');
        expect(Object.keys(jobs).filter((name) => setsUpEnvironment(jobs[name])).sort()).toEqual(
            ['build', 'deps-prep', 'draft-checks', 'e2e', 'edge-tests', 'full-evidence', 'lighthouse-advisory', 'unit-coverage-merge', 'unit-shard']);
        expect(offPin(jobs, setsUpEnvironment)).toEqual([]);
    });

    it('#1047 U3 cross-page evidence: both jobs (apt-bundle producer and Playwright consumer) are on ubuntu-24.04', () => {
        const { jobs } = load('.github/workflows/1047-u3-cross-page.yml');
        expect(Object.keys(jobs).filter((name) => setsUpEnvironment(jobs[name])).sort()).toEqual(['cross-page-evidence', 'deps-prep']);
        expect(offPin(jobs, setsUpEnvironment)).toEqual([]);
    });

    it('canary: canary-check, the only job that installs Playwright, is on ubuntu-24.04', () => {
        const { jobs } = load('.github/workflows/canary.yml');
        expect(Object.keys(jobs).filter((name) => installsPlaywright(jobs[name])).sort()).toEqual(['canary-check']);
        expect(offPin(jobs, installsPlaywright)).toEqual([]);
    });

    it('negative controls: a job moved back to a floating or unsupported label is reported', () => {
        for (const [file, job, select] of [['.github/workflows/rc-gates.yml', 'gate-3-dast', installsPlaywright], ['.github/workflows/ci.yml', 'deps-prep', setsUpEnvironment], ['.github/workflows/1047-u3-cross-page.yml', 'cross-page-evidence', setsUpEnvironment], ['.github/workflows/canary.yml', 'canary-check', installsPlaywright]] as const) {
            for (const label of ['ubuntu-latest', 'ubuntu-26.04']) {
                const { jobs } = load(file);
                jobs[job]['runs-on'] = label;
                expect(offPin(jobs, select)).toEqual([job]);
            }
        }
        const { jobs } = load('.github/workflows/ci.yml');
        jobs['full-evidence']['runs-on'] = 'ubuntu-latest';
        expect(offPin(jobs, setsUpEnvironment)).toEqual(['full-evidence']);
    });
});
