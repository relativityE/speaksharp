#!/usr/bin/env tsx
/**
 * #1259 — THE PRODUCTION READBACK THAT ACTUALLY DECIDES.
 *
 * `evaluateTelemetryCompleteness()` existed with no production caller. A repository-wide search found
 * only the module and its unit tests, so the HOLD it promised could never fire however well its
 * branches were exercised. A requirement that is captured but not wired is not implemented — and it is
 * indistinguishable, from the outside, from one that is. This is the caller.
 *
 * WHAT IT DOES. Reads back, from PostHog, the GOVERNED event families actually ingested for one
 * release SHA inside a bounded window, and hands those names — unfiltered, junk included — to the
 * evaluator. The evaluator decides. This script only collects and reports, so the decision stays in
 * one falsifiable place rather than being re-implemented here in a slightly different form.
 *
 * WHY IT FAILS CLOSED ON EVERYTHING MISSING. Absent credentials, an unreachable API, an HTTP error, a
 * malformed response and an empty result all produce HOLD, never a skip and never a pass. A
 * qualification step that quietly succeeds when it could not run is worse than no step: it converts
 * "we did not look" into "we looked and it was fine", which is exactly the class of false green this
 * whole gate exists to prevent.
 *
 * It reads. It never writes, never ingests, and never prints an event property — only family names,
 * which are the vocabulary itself and carry no user content.
 */
import {
    evaluateTelemetryCompleteness,
    REQUIRED_EVENT_FAMILIES,
    type CompletenessResult,
} from '../frontend/src/services/telemetry/completenessGate';
import { GOVERNED_EVENTS } from '../frontend/src/services/telemetryAllowlist';

type Evidence = {
    gate: 'TELEMETRY-READBACK-COMPLETENESS';
    release_sha: string | null;
    window_hours: number;
    observed_families: string[];
    required_families: string[];
    verdict: CompletenessResult['verdict'];
    missing: string[];
    unrecognised: string[];
    reasons: string[];
};

const arg = (flag: string): string | null => {
    const i = process.argv.indexOf(flag);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const releaseSha = arg('--release-sha') ?? process.env.RELEASE_SHA ?? null;
const windowHours = Number(arg('--window-hours') ?? 24);

/** Every refusal lands here, so a missing precondition cannot become a pass by another route. */
function hold(reason: string, observed: string[] = []): never {
    const result = evaluateTelemetryCompleteness(observed);
    const evidence: Evidence = {
        gate: 'TELEMETRY-READBACK-COMPLETENESS',
        release_sha: releaseSha,
        window_hours: windowHours,
        observed_families: observed,
        required_families: [...REQUIRED_EVENT_FAMILIES],
        verdict: 'HOLD',
        missing: result.missing,
        unrecognised: result.unrecognised,
        reasons: [reason, ...result.reasons],
    };
    console.log(`TELEMETRY_READBACK_QUALIFICATION_EVIDENCE ${JSON.stringify(evidence)}`);
    console.error(`HOLD — ${reason}`);
    process.exit(1);
}

async function main(): Promise<void> {
    if (!releaseSha) hold('no --release-sha supplied; a readback not pinned to a release proves nothing');
    if (!Number.isFinite(windowHours) || windowHours <= 0) hold(`--window-hours ${windowHours} is not a positive number`);

    const projectId = process.env.POSTHOG_PROJECT_ID;
    const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
    const apiHost = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
    // Named, never printed. A missing credential is a HOLD, not a skip.
    if (!projectId) hold('POSTHOG_PROJECT_ID is not set — the readback could not be attempted');
    if (!personalApiKey) hold('POSTHOG_PERSONAL_API_KEY is not set — the readback could not be attempted');

    // Governed vocabulary only, bound to this release. `event` is the family name; no property is
    // selected, so nothing user-authored can reach this process.
    const governedList = GOVERNED_EVENTS.map((e) => `'${e.replace(/'/g, "''")}'`).join(', ');
    const query = `
        SELECT DISTINCT event
        FROM events
        WHERE timestamp > now() - INTERVAL ${Math.floor(windowHours)} HOUR
          AND properties.release_sha = '${releaseSha.replace(/'/g, "''")}'
          AND event IN (${governedList})
    `;

    let response: Response;
    try {
        response = await fetch(`${apiHost}/api/projects/${encodeURIComponent(projectId)}/query/`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${personalApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
        });
    } catch (err) {
        hold(`the readback request failed: ${(err as Error).name}`);
    }
    if (!response.ok) hold(`the readback returned HTTP ${response.status}`);

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        hold('the readback response was not JSON');
    }

    const rows = (payload as { results?: unknown }).results;
    // Not an array means the API shape changed under us. Treating an unreadable answer as an empty one
    // would report "nothing was emitted" for what is really "we cannot read the answer".
    if (!Array.isArray(rows)) hold('the readback response had no results array — the shape is not what we decode');

    // Deliberately unsanitised: the evaluator's own contract is that it receives whatever the readback
    // saw, junk included, because a decoder that tidies its input cannot report that the input was wrong.
    const observed = rows.map((row) => (Array.isArray(row) ? row[0] : row)) as string[];

    const result = evaluateTelemetryCompleteness(observed);
    const evidence: Evidence = {
        gate: 'TELEMETRY-READBACK-COMPLETENESS',
        release_sha: releaseSha,
        window_hours: windowHours,
        observed_families: observed.filter((n) => typeof n === 'string'),
        required_families: [...REQUIRED_EVENT_FAMILIES],
        verdict: result.verdict,
        missing: result.missing,
        unrecognised: result.unrecognised,
        reasons: result.reasons,
    };
    console.log(`TELEMETRY_READBACK_QUALIFICATION_EVIDENCE ${JSON.stringify(evidence)}`);

    if (result.verdict !== 'QUALIFIED') {
        console.error(`HOLD — ${result.reasons.join('; ')}`);
        process.exit(1);
    }
    console.log('QUALIFIED — every required governed family is present in the Production readback.');
}

await main();
