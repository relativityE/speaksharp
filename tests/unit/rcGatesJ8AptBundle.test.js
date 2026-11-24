import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

// J8 run 45357745529 attempt 1 timed out in the NETWORK `playwright install-deps` (slow mirror, 300 s cap) before the test or
// any account existed. J8 now installs from the same checksum-verified apt bundle CI's e2e shards use (#1311), made by its own
// prep job in the same run. Frozen here: the wiring, the exact cache key (no restore-keys), and that the prep job is inert.
const root = process.cwd();
const rc = yaml.load(readFileSync(resolve(root, '.github/workflows/rc-gates.yml'), 'utf8'));
const ci = yaml.load(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'));
const prep = rc.jobs['j8-apt-prep'];
const runner = rc.jobs['j8-runner'];
const step = (job, pred) => job.steps.find(pred);
const setup = (job) => step(job, (s) => `${s.uses ?? ''}`.startsWith('./.github/actions/setup-environment'));

describe('J8 installs Playwright system deps from the offline apt bundle', () => {
    it('j8-runner needs its prep job and installs the playwright manifest from that job\'s artifact', () => {
        expect([runner.needs].flat()).toContain('j8-apt-prep');
        expect(setup(runner).with).toMatchObject({
            'install-playwright': 'true', 'apt-bundle': 'true', 'apt-bundle-manifest': 'playwright',
            'apt-bundle-artifact': 'j8-apt-deps-bundle',
        });
    });

    it('the prep job runs only for a J8 dispatch, on the same pinned image, and uploads that artifact', () => {
        expect(prep.if).toBe(runner.if);
        expect(prep['runs-on']).toBe('ubuntu-24.04');
        expect(prep['runs-on']).toBe(runner['runs-on']);
        const upload = step(prep, (s) => `${s.uses ?? ''}`.startsWith('actions/upload-artifact'));
        expect(upload.with).toMatchObject({ name: 'j8-apt-deps-bundle', path: 'apt-bundle', 'if-no-files-found': 'error' });
    });

    it('uses exactly CI deps-prep\'s cache key with no restore-keys, and the same prefetch script', () => {
        const cache = (job) => step(job, (s) => `${s.uses ?? ''}`.startsWith('actions/cache')).with;
        expect(cache(prep).key).toBe(cache(ci.jobs['deps-prep']).key);
        expect(cache(prep)['restore-keys']).toBeUndefined();
        const fetch = step(prep, (s) => `${s.run ?? ''}`.includes('apt-prefetch.sh'));
        expect(fetch.run.trim()).toBe('bash scripts/ci/apt-prefetch.sh apt-bundle');
        expect(fetch.if).toBe("steps.apt-bundle-cache.outputs.cache-hit != 'true'");
    });

    it('the prep job is inert: no environment, no secrets, no vars, no browser install', () => {
        expect(prep.environment).toBeUndefined();
        const text = JSON.stringify(prep);
        expect(text).not.toMatch(/secrets\.|vars\./);
        expect(setup(prep).with).toMatchObject({ 'install-playwright': 'false', 'apt-bundle': 'false' });
    });
});
