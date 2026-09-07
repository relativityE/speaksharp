#!/usr/bin/env tsx
/**
 * #1259 — THE PRODUCTION READBACK THAT ACTUALLY DECIDES.
 *
 * `evaluateTelemetryCompleteness()` existed with no production caller. A repository-wide search found
 * only the module and its unit tests, so the HOLD it promised could never fire however well its
 * branches were exercised. A requirement that is captured but not wired is not implemented — and it is
 * indistinguishable, from the outside, from one that is. This is the caller.
 *
 * WHAT IT DOES. Reads back, from PostHog, the GOVERNED event families actually ingested for ONE
 * CONTROLLED JOURNEY on one release SHA, and hands those names — unfiltered, junk included — to the
 * evaluator. The evaluator decides. This script only collects and reports, so the decision stays in
 * one falsifiable place rather than being re-implemented here in a slightly different form.
 *
 * WHY ONE JOURNEY AND NOT A TIME WINDOW. A window unions everything that happened in it: several
 * users, several tabs, several attempts. Ten different people each producing a different third of the
 * required families would union to a complete set, and the gate would report QUALIFIED for a run in
 * which nobody's session was actually complete. Completeness is a property of ONE pass through the
 * product, so the readback is scoped to one `journey_id` and one traffic classification, and both are
 * required rather than defaulted.
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
    PRE_JOURNEY_EVENT_FAMILIES,
    type CompletenessResult,
} from '../frontend/src/services/telemetry/completenessGate';
import { TRAFFIC_TYPES } from '../frontend/src/services/telemetry/trafficType';
import { GOVERNED_EVENTS } from '../frontend/src/services/telemetryAllowlist';

type Evidence = {
    gate: 'TELEMETRY-READBACK-COMPLETENESS';
    release_sha: string | null;
    journey_id: string | null;
    traffic_type: string;
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
const journeyId = arg('--journey-id') ?? process.env.TELEMETRY_QUALIFICATION_JOURNEY_ID ?? null;
/**
 * The traffic classification the controlled run actually carries.
 *
 * NOT defaulted to `internal`. `resolveTrafficType()` reserves `internal` for a `VITE_INTERNAL_BUILD`
 * that Production users never receive, and emits `canary` for the automated qualification account and
 * `internal_test` for a human dogfood session on canonical Production. Hard-coding `internal` therefore
 * matched nothing on the deployment this gate is meant to qualify: the readback returned no rows and
 * HELD even when the intended journey had been ingested perfectly — a gate that always fails is as
 * useless as one that always passes, and more expensive.
 *
 * There is no safe default, so there is none: the caller names the class, and an unrecognised one HOLDs
 * rather than being sent to the query as a value that can only ever match zero rows.
 */
const trafficType = arg('--traffic-type') ?? process.env.TELEMETRY_QUALIFICATION_TRAFFIC_TYPE ?? null;
const windowHours = Number(arg('--window-hours') ?? 24);

/** Every refusal lands here, so a missing precondition cannot become a pass by another route. */
function hold(reason: string, observed: string[] = []): never {
    const result = evaluateTelemetryCompleteness(observed);
    const evidence: Evidence = {
        gate: 'TELEMETRY-READBACK-COMPLETENESS',
        release_sha: releaseSha,
        journey_id: journeyId,
        traffic_type: trafficType,
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
    // Required, not defaulted. Without it this would union unrelated users, tabs and attempts into one
    // apparently-complete set — the false pass this gate exists to prevent.
    if (!journeyId) hold('no --journey-id supplied; completeness is a property of ONE journey, never of a time window');
    if (!trafficType) hold('no --traffic-type supplied; there is no safe default — name the controlled run\'s class');
    if (!(TRAFFIC_TYPES as readonly string[]).includes(trafficType)) {
        hold(`--traffic-type ${trafficType} is not one of the classifications the product emits (${TRAFFIC_TYPES.join(', ')})`);
    }
    if (!Number.isFinite(windowHours) || windowHours <= 0) hold(`--window-hours ${windowHours} is not a positive number`);

    const projectId = process.env.POSTHOG_PROJECT_ID;
    const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
    const apiHost = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
    // Named, never printed. A missing credential is a HOLD, not a skip.
    if (!projectId) hold('POSTHOG_PROJECT_ID is not set — the readback could not be attempted');
    if (!personalApiKey) hold('POSTHOG_PERSONAL_API_KEY is not set — the readback could not be attempted');

    // Governed vocabulary only, bound to this release. `event` is the family name; no property is
    // selected, so nothing user-authored can reach this process.
    // Every governed family name is a compile-time constant from the allowlist, but each is escaped
    // anyway: a vocabulary is a thing people edit, and the escaping must not depend on nobody ever
    // adding a name with a quote in it.
    const sql = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const governedList = GOVERNED_EVENTS.map(sql).join(', ');
    // TWO SCOPES, because the required families do not all live in one journey.
    //
    // The identity receipts are emitted at sign-in, under the pre-product journey; the product journey is
    // minted on entry, before recording. Asking for both inside one `journey_id` can only ever return one
    // set, so an ordinary complete run could never qualify. They are still required and still pinned to
    // this release and traffic class — they are simply not journey-scoped, because they were never in it.
    const preJourneyList = PRE_JOURNEY_EVENT_FAMILIES.map(sql).join(', ');
    const query = `
        SELECT DISTINCT event
        FROM events
        WHERE timestamp > now() - INTERVAL ${Math.floor(windowHours)} HOUR
          AND properties.release_sha = ${sql(releaseSha)}
          AND properties.traffic_type = ${sql(trafficType)}
          AND event IN (${governedList})
          AND (
            properties.journey_id = ${sql(journeyId)}
            OR event IN (${preJourneyList})
          )
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
        journey_id: journeyId,
        traffic_type: trafficType,
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
    console.log(`QUALIFIED — every required governed family was INGESTED for journey ${journeyId} on ${releaseSha}.`);
}

await main();
