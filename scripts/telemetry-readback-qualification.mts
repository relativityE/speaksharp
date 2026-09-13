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
import { resolveQualifyingIdentity } from '../frontend/src/services/telemetry/qualifyingIdentity';
import { QUALIFICATION_STAGES, evaluateQualificationStage } from '../frontend/src/services/telemetry/completenessGate';
import {
    bootScopedReceiptFamilies,
    buildReadbackQuery,
    resolveBootAuthority,
    stageEvidenceRows,
} from '../frontend/src/services/telemetry/bootScopedReceipts';

/**
 * The only traffic classes that may qualify controlled Production evidence.
 *
 * `user` is real customer activity — never our evidence. `internal` marks a build Production users never
 * receive, so it cannot describe the canonical deployment. Declared as a subset of `TRAFFIC_TYPES` so a
 * rename in the product vocabulary breaks this at compile time rather than silently widening the gate.
 */
const CONTROLLED_EVIDENCE_TRAFFIC: readonly (typeof TRAFFIC_TYPES[number])[] = ['canary', 'internal_test'];
import { GOVERNED_EVENTS } from '../frontend/src/services/telemetryAllowlist';

type Evidence = {
    gate: 'TELEMETRY-READBACK-COMPLETENESS';
    release_sha: string | null;
    journey_id: string | null;
    /**
     * #1421 P1 — WHICH BOOT THE EVIDENCE CAME FROM.
     *
     * Published, unlike `distinct_id`: this is an ephemeral random value minted per page bootstrap,
     * tied to no account, session or user-authored content, and it is the fact a reader needs to check
     * that both receipt families and the journey came from the SAME boot. A qualification that claims
     * boot binding without naming the boot cannot be audited.
     */
    boot_id: string | null;
    traffic_type: string | null;
    /** The UI stages this run declared it exercised, and any stage evidence it could not produce. */
    stages_declared?: string[];
    stage_reasons?: string[];
    identity_bound?: boolean;
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
        // A refusal can happen before the boot authority is resolved — an honest null, never a guess.
        boot_id: null,
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
    /**
     * CONTROLLED CLASSES ONLY — not merely "a class the product emits".
     *
     * Validating against every runtime classification accepted `user`, which is real customer activity.
     * A copied journey id would then have certified release telemetry from someone's actual session:
     * evidence we did not produce, cannot reproduce, and must never gate a release on. `internal` is
     * excluded for the opposite reason — it marks a build Production users never receive, so it can never
     * describe the canonical deployment this gate qualifies.
     *
     * That leaves the two classes a controlled Production run genuinely carries: the automated
     * qualification canary, and a human dogfood session.
     */
    if (!(CONTROLLED_EVIDENCE_TRAFFIC as readonly string[]).includes(trafficType)) {
        hold(`--traffic-type ${trafficType} is not a controlled evidence class; only ${CONTROLLED_EVIDENCE_TRAFFIC.join(' or ')} may qualify a release`);
    }
    if (!Number.isFinite(windowHours) || windowHours <= 0) hold(`--window-hours ${windowHours} is not a positive number`);

    const projectId = process.env.POSTHOG_PROJECT_ID;
    const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
    const apiHost = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
    // Named, never printed. A missing credential is a HOLD, not a skip.
    if (!projectId) hold('POSTHOG_PROJECT_ID is not set — the readback could not be attempted');
    if (!personalApiKey) hold('POSTHOG_PERSONAL_API_KEY is not set — the readback could not be attempted');

    /**
     * ONE transport for every query this gate makes, so each of them fails closed identically.
     *
     * The identity lookup and the family readback are two separate questions, and a transport error on
     * EITHER must HOLD. Duplicating the fetch would have meant duplicating five refusal paths, and the
     * second copy is where one of them goes missing.
     */
    async function runQuery(hogql: string, label: string): Promise<unknown[]> {
        let response: Response;
        try {
            response = await fetch(`${apiHost}/api/projects/${encodeURIComponent(projectId!)}/query/`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${personalApiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
            });
        } catch (err) {
            hold(`${label} request failed: ${(err as Error).name}`);
        }
        if (!response.ok) hold(`${label} returned HTTP ${response.status}`);

        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            hold(`${label} response was not JSON`);
        }

        const rows = (payload as { results?: unknown }).results;
        // Not an array means the API shape changed under us. Treating an unreadable answer as an empty
        // one would report "nothing was emitted" for what is really "we cannot read the answer".
        if (!Array.isArray(rows)) hold(`${label} response had no results array — the shape is not what we decode`);
        return rows;
    }

    // Governed vocabulary only, bound to this release. `event` is the family name; no property is
    // selected, so nothing user-authored can reach this process.
    // Every governed family name is a compile-time constant from the allowlist, but each is escaped
    // anyway: a vocabulary is a thing people edit, and the escaping must not depend on nobody ever
    // adding a name with a quote in it.
    const sql = (value: string) => `'${value.replace(/'/g, "''")}'`;
    // TWO SCOPES, because the required families do not all live in one journey.
    //
    // The identity receipts are emitted at sign-in, under the pre-product journey; the product journey is
    // minted on entry, before recording. Asking for both inside one `journey_id` can only ever return one
    // set, so an ordinary complete run could never qualify. They are still required and still pinned to
    // this release and traffic class — they are simply not journey-scoped, because they were never in it.

    /**
     * THE PRE-JOURNEY RECEIPTS MUST BELONG TO THE SAME PERSON AS THE JOURNEY.
     *
     * Splitting them out of the journey scope was right — they are emitted at sign-in, before the product
     * journey exists — but leaving them scoped only by release and traffic class re-opened the union the
     * journey filter was added to close. Any other run in the window carrying the same release and class
     * would satisfy them, so the selected journey could be missing BOTH its own identity receipts and
     * still qualify on somebody else's.
     *
     * The qualifying identity is derived FROM the journey rows rather than supplied, so it cannot be
     * asserted independently of the run being judged: whoever produced the journey is who the identity
     * receipts must belong to. If the journey produced no rows there is no identity to bind, and the
     * readback holds rather than falling back to an unbound match.
     */
    const identityQuery = `
        SELECT DISTINCT distinct_id
        FROM events
        WHERE timestamp > now() - INTERVAL ${Math.floor(windowHours)} HOUR
          AND properties.release_sha = ${sql(releaseSha)}
          AND properties.traffic_type = ${sql(trafficType)}
          AND properties.journey_id = ${sql(journeyId)}
    `;
    const identityRows = await runQuery(identityQuery, 'the qualifying identity lookup');

    // #1421 P2 — the reading lives in a checked, testable module; the policy stays here. A malformed
    // row is a HOLD, not something to filter away before counting what is left.
    const identity = resolveQualifyingIdentity(identityRows);
    if (!identity.ok) hold(`journey ${journeyId}: ${identity.reason}`);
    const qualifyingIdentity = identity.distinctId;

    /**
     * #1421 P1 — TIMESTAMP AND JOURNEY COME BACK TOO, so the pre-journey receipts can be bound to the
     * boot that produced THIS journey.
     *
     * `SELECT DISTINCT event` discarded exactly the two columns needed to tell one boot from another.
     * With only event names, a receipt emitted by a different boot of the same account, in the same
     * release, traffic class and 24-hour window, was indistinguishable from this journey's own — so a
     * selected journey missing BOTH its identity receipts qualified on somebody else's boot.
     *
     * The binding itself is applied in `bootScopedReceipts`, not in this query string: the refusal is
     * the point, and a rule expressed only in SQL cannot be driven by a casualty.
     */
    const query = buildReadbackQuery({
        windowHours, releaseSha, trafficType, qualifyingIdentity,
        governedEvents: GOVERNED_EVENTS,
        quote: sql,
    });

    const rows = await runQuery(query, 'the readback');

    // Deliberately unsanitised: the evaluator's own contract is that it receives whatever the readback
    // saw, junk included, because a decoder that tidies its input cannot report that the input was wrong.
    const readback = rows.map((row) => {
        const cells = Array.isArray(row) ? row : [row];
        return {
            event: cells[0] as string,
            timestamp: cells[1] as string,
            journeyId: (cells[2] ?? null) as string | null,
            bootId: (cells[3] ?? null) as string | null,
            properties: {
                outcome: cells[4] ?? null,
                to_state: cells[5] ?? null,
                acquired_candidate_id: cells[6] ?? null,
                expected_candidate_id: cells[7] ?? null,
                candidate_id: cells[8] ?? null,
                engine: cells[9] ?? null,
                runtime_version: cells[10] ?? null,
                attempt_id: cells[11] ?? null,
                attempt_seq: cells[12] ?? null,
                subject_boot_id: cells[13] ?? null,
                subject_journey_id: cells[14] ?? null,
                subject_attempt_id: cells[15] ?? null,
                subject_attempt_seq: cells[16] ?? null,
                attribution_status: cells[17] ?? null,
                stage: cells[18] ?? null,
                transcript_visibly_present: cells[19] ?? null,
                digests_match: cells[20] ?? null,
            },
        };
    });

    const boot = resolveBootAuthority(readback, journeyId);
    if (!boot.ok) hold(`journey ${journeyId}: ${boot.reason}`);

    // Journey-scoped families are already bound by the query. The two pre-journey families are bound
    // here, to the boot that produced this journey — a receipt from any other boot is not evidence
    // about this run.
    const journeyFamilies = readback
        .filter((row) => row.journeyId === journeyId)
        .map((row) => row.event);
    const bootFamilies = bootScopedReceiptFamilies(readback, boot.bootId, PRE_JOURNEY_EVENT_FAMILIES);
    const observed = [...new Set([...journeyFamilies, ...bootFamilies])] as string[];

    /**
     * #1421 P1 — THE UI STAGES THIS RUN CLAIMS TO HAVE EXERCISED, DECLARED NOT GUESSED.
     *
     * An Open Mic run legitimately produces no Focus Points coverage, so requiring every stage of
     * every run would hold on honest evidence. Inferring the stage from what ARRIVED is worse: it
     * would let a run that silently produced nothing for a stage qualify by appearing not to have
     * exercised it — the exact absence this gate exists to catch.
     *
     * The operator declares the stages; the gate then proves them. An undeclared or unknown stage is a
     * HOLD, so the declaration cannot be skipped or misspelled into a pass.
     */
    const declared = (process.env.QUALIFICATION_STAGES ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (declared.length === 0) {
        hold('QUALIFICATION_STAGES is not set: a run must declare which UI stages it exercised');
    }
    const stageReasons: string[] = [];
    for (const name of declared) {
        const stage = QUALIFICATION_STAGES.find((candidate) => candidate.stage === name);
        if (!stage) {
            stageReasons.push(`unknown qualification stage '${name}'`);
            continue;
        }
        // Stage evidence is scoped to THIS journey plus this boot's receipts — the same rows the
        // family check uses, never the whole readback — plus any attribution receipt whose SUBJECT is this
        // journey, wherever it was emitted (#1421 P1 `3984043475`).
        const scoped = stageEvidenceRows(readback, journeyId, PRE_JOURNEY_EVENT_FAMILIES);
        stageReasons.push(...evaluateQualificationStage(stage, scoped));
    }

    const result = evaluateTelemetryCompleteness(observed);
    const evidence: Evidence = {
        gate: 'TELEMETRY-READBACK-COMPLETENESS',
        release_sha: releaseSha,
        journey_id: journeyId,
        boot_id: boot.bootId,
        traffic_type: trafficType,
        // Bound, never printed: a distinct_id identifies a person. Recording that the binding happened is
        // the auditable fact; the value itself is not ours to publish in release evidence.
        identity_bound: true,
        window_hours: windowHours,
        observed_families: observed.filter((n) => typeof n === 'string'),
        required_families: [...REQUIRED_EVENT_FAMILIES],
        stages_declared: declared,
        stage_reasons: stageReasons,
        verdict: stageReasons.length > 0 ? 'HOLD' : result.verdict,
        missing: result.missing,
        unrecognised: result.unrecognised,
        reasons: result.reasons,
    };
    console.log(`TELEMETRY_READBACK_QUALIFICATION_EVIDENCE ${JSON.stringify(evidence)}`);

    if (result.verdict !== 'QUALIFIED' || stageReasons.length > 0) {
        console.error(`HOLD — ${[...result.reasons, ...stageReasons].join('; ')}`);
        process.exit(1);
    }
    console.log(`QUALIFIED — every required governed family was INGESTED for journey ${journeyId} on ${releaseSha}.`);
}

await main();
