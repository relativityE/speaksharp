/**
 * #1382 — THE REFUSALS, RUN FOR REAL.
 *
 * The readback's whole value is that it HOLDs rather than passing on absent or uncontrolled evidence.
 * Until now nothing executed it, so those refusals were promises made in comments. Each case below runs
 * the actual script in a child process and asserts on what it EMITS — the sanitized evidence line and a
 * non-zero exit — never on log text that merely resembles the script's own source.
 *
 * WHAT IS NOT COVERED HERE, AND WHY. The script checks declared stages AFTER the PostHog query returns,
 * so with no credentials it never reaches that check, and with an empty stubbed response it HOLDs earlier
 * on "no events for this release and traffic class". Reaching the stage check offline would mean
 * fabricating a readback payload complete enough to satisfy ten event families — a fake elaborate enough
 * to certify itself, which is how a harness ends up proving the fake instead of the product (#1306). The
 * missing-stage refusal is therefore enforced one layer out, in the dispatch workflow, which validates
 * `stages` against the shipped gate BEFORE spending an API call; see
 * `telemetryReadbackDispatchContract.test.js`. Flagged for PM rather than papered over.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repo = resolve(__dirname, '..', '..');
const SCRIPT = resolve(repo, 'scripts/telemetry-readback-qualification.mts');
const SHA = 'a'.repeat(40);
const JOURNEY = 'jrn_contract_12345678';

/** Run the real script with a clean environment plus only what the case supplies. */
function runReadback(args, env = {}) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
        cwd: repo,
        encoding: 'utf8',
        timeout: 120000,
        env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_OPTIONS: '',
            ...env,
        },
    });
    const line = `${result.stdout}`
        .split('\n')
        .filter((l) => l.includes('TELEMETRY_READBACK_QUALIFICATION_EVIDENCE'))
        .pop();
    return {
        status: result.status,
        stderr: `${result.stderr}`,
        evidence: line ? JSON.parse(line.replace('TELEMETRY_READBACK_QUALIFICATION_EVIDENCE ', '')) : null,
    };
}

const CREDS = { POSTHOG_PERSONAL_API_KEY: 'test-key-never-used', POSTHOG_PROJECT_ID: '1' };

describe('#1382 readback refusals — executed, not promised', () => {
    it('CASUALTY: traffic class `user` cannot qualify a release', () => {
        // Real customer activity. A copied journey id would otherwise certify a release on a session we
        // did not produce and cannot reproduce.
        const run = runReadback(['--release-sha', SHA, '--journey-id', JOURNEY, '--traffic-type', 'user']);

        expect(run.status, 'a refusal must exit non-zero').not.toBe(0);
        expect(run.evidence?.verdict).toBe('HOLD');
        expect(run.evidence?.traffic_type).toBe('user');
        expect(run.evidence?.reasons?.join(' ')).toMatch(/not a controlled evidence class/);
    });

    it('CASUALTY: `internal` cannot qualify either — it marks a build Production never receives', () => {
        const run = runReadback(['--release-sha', SHA, '--journey-id', JOURNEY, '--traffic-type', 'internal']);

        expect(run.status).not.toBe(0);
        expect(run.evidence?.verdict).toBe('HOLD');
        expect(run.evidence?.reasons?.join(' ')).toMatch(/not a controlled evidence class/);
    });

    it('CASUALTY: a missing PostHog credential HOLDs instead of skipping', () => {
        // The dangerous alternative is a silent skip: a gate that reports nothing looks like a gate that
        // found nothing wrong.
        const run = runReadback(['--release-sha', SHA, '--journey-id', JOURNEY, '--traffic-type', 'canary']);

        expect(run.status).not.toBe(0);
        expect(run.evidence?.verdict).toBe('HOLD');
        expect(run.evidence?.traffic_type).toBe('canary');
        expect(run.evidence?.reasons?.join(' ')).toMatch(/POSTHOG/i);
    });

    it('CASUALTY: no release SHA — a readback not pinned to a release proves nothing', () => {
        const run = runReadback(['--journey-id', JOURNEY, '--traffic-type', 'canary'], CREDS);

        expect(run.status).not.toBe(0);
        expect(run.evidence?.verdict).toBe('HOLD');
        expect(run.evidence?.release_sha).toBeNull();
        expect(run.evidence?.reasons?.join(' ')).toMatch(/release-sha/);
    });

    it('CASUALTY: no journey id — completeness is a property of ONE journey, not a time window', () => {
        const run = runReadback(['--release-sha', SHA, '--traffic-type', 'canary'], CREDS);

        expect(run.status).not.toBe(0);
        expect(run.evidence?.verdict).toBe('HOLD');
        expect(run.evidence?.journey_id).toBeNull();
        expect(run.evidence?.reasons?.join(' ')).toMatch(/journey-id/);
    });

    it('every refusal emits the sanitized evidence line, and it carries no content', () => {
        const run = runReadback(['--release-sha', SHA, '--journey-id', JOURNEY, '--traffic-type', 'user']);

        expect(run.evidence).not.toBeNull();
        // #1374's content-free schema: family names, ids the contract owns, a verdict and reasons. The
        // serialized line is what a CI summary publishes, so it is the thing that must be clean.
        //
        // NOT a keyword denylist. `transcript_authority` is a required event FAMILY, so the word
        // "transcript" appearing here is a schema name, not content — a denylist would fail on the
        // correct payload and teach the next reader to weaken the test. What actually distinguishes
        // content is SHAPE: the family arrays may only hold snake_case identifiers, and nothing in the
        // line may look like an account.
        const serialized = JSON.stringify(run.evidence);
        expect(serialized, 'no address-shaped value may appear').not.toContain('@');
        expect(serialized.toLowerCase()).not.toMatch(/password|api[_-]?key|bearer /);
        for (const field of ['observed_families', 'required_families', 'missing', 'unrecognised']) {
            for (const name of run.evidence[field] ?? []) {
                expect(name, `${field} must hold schema identifiers only`).toMatch(/^[a-z0-9_]+$/);
            }
        }
        expect(Object.keys(run.evidence).sort()).toEqual([
            'boot_id', 'gate', 'journey_id', 'missing', 'observed_families',
            'reasons', 'release_sha', 'required_families', 'traffic_type', 'unrecognised', 'verdict',
            'window_hours',
        ].sort());
    });
});
