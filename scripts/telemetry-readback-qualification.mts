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
} from '../frontend/src/services/telemetry/completenessGate';
import { TRAFFIC_TYPES } from '../frontend/src/services/telemetry/trafficType';
import { resolveQualifyingIdentity } from '../frontend/src/services/telemetry/qualifyingIdentity';
import { QUALIFICATION_STAGES, declaresRecordingStage, evaluateQualificationStage, exactlyOnceFamiliesForStages, isObservedFailureReason, readbackVerdict, requiredFamiliesForStages, type ReadbackVerdict } from '../frontend/src/services/telemetry/completenessGate';

import { evaluateAttemptScopedDelivery } from '../frontend/src/services/telemetry/deliveryReceiptGate';
import {
    bootScopedReceiptFamilies,
    buildReadbackQuery,
    READBACK_ROW_LIMIT,
    readbackTruncated,
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
import { createHash } from 'node:crypto';
import { evaluateCoachingDiagnosticReceipt, validExpectation } from '../frontend/src/services/telemetry/coachingDiagnosticReceipt';
import { ACQUISITION_COLUMNS, COACHING_COLUMNS, IDENTITY_COLUMNS, READBACK_COLUMNS, USER_STAGE_COLUMNS, decodeByColumns, readbackRowsFromNamed, selectAliases } from '../frontend/src/services/telemetry/readbackColumns';

/** #1258 (#1563): the exit code for an OBSERVED received failure, distinct from HOLD (1). rc-gates.yml records it as FAIL. */
const READBACK_FAIL_EXIT = 3;

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
    attempts_declared?: string[];
    stage_reasons?: string[];
    /** Received-vendor cardinality and a named failure when a singleton receipt is absent. */
    received_counts?: Record<string, number>;
    duplicate_families?: string[];
    delivery_failures?: ReturnType<typeof evaluateAttemptScopedDelivery>['deliveryFailures'];
    identity_bound?: boolean;
    window_hours: number;
    observed_families: string[];
    required_families: string[];
    verdict: ReadbackVerdict;
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
    /**
     * RWT USER-STAGE RECEIPT (opt-in, report-only). A first visit signs up as ordinary `user` traffic before the
     * run-owned canary claim exists. That stage can never QUALIFY anything — the refusal above stays — but the PO
     * asked what PostHog actually RECEIVED from it. With this flag, and only for `user`, the script reports
     * per-family received counts for the one journey and exits without a verdict.
     */
    const userStageReport = process.env.TELEMETRY_READBACK_USER_STAGE_REPORT === '1' && trafficType === 'user';
    if (!userStageReport && !(CONTROLLED_EVIDENCE_TRAFFIC as readonly string[]).includes(trafficType)) {
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
    async function runQuery(hogql: string, label: string, expected: readonly string[]): Promise<Record<string, unknown>[]> {
        // The SELECT and response metadata are independently checked. A changed query must not
        // silently redefine the decoder's contract; a response reorder can still map safely by name.
        const selected = selectAliases(hogql);
        if (selected.length !== expected.length || selected.some(name => !expected.includes(name)) || new Set(selected).size !== selected.length) {
            hold(`${label} query selects [${selected.join(',')}], not the decoder's declared columns`);
        }
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

        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) hold(`${label} response was not an object`);
        const rows = (payload as { results?: unknown }).results;
        // Not an array means the API shape changed under us. Treating an unreadable answer as an empty
        // one would report "nothing was emitted" for what is really "we cannot read the answer".
        if (!Array.isArray(rows)) hold(`${label} response had no results array — the shape is not what we decode`);
        // #1258 (RWT run 37514078995, F1): the query API marks a result it cut short. A truncated answer is not an
        // absence — reading it as one reported whole journeys as "never observed" while PostHog held them.
        if ((payload as { hasMore?: unknown }).hasMore === true) hold(`${label} was truncated by the query API (hasMore) — an incomplete answer cannot prove absence`);
        const decoded = decodeByColumns(expected, (payload as { columns?: unknown }).columns, rows);
        if (!decoded.ok) hold(`${label}: ${decoded.reason}`);
        return decoded.rows;
    }

    // Governed vocabulary only, bound to this release. `event` is the family name; no property is
    // selected, so nothing user-authored can reach this process.
    // Every governed family name is a compile-time constant from the allowlist, but each is escaped
    // anyway: a vocabulary is a thing people edit, and the escaping must not depend on nobody ever
    // adding a name with a quote in it.
    const sql = (value: string) => `'${value.replace(/'/g, "''")}'`;

    if (userStageReport) {
        // Event NAMES and counts only, for governed families; never a property.
        const rows = await runQuery(`
            SELECT event, count() AS received
            FROM events
            WHERE timestamp > now() - INTERVAL ${Math.floor(windowHours)} HOUR
              AND properties.release_sha = ${sql(releaseSha)}
              AND properties.traffic_type = 'user'
              AND properties.journey_id = ${sql(journeyId)}
              AND event IN (${GOVERNED_EVENTS.map(sql).join(', ')})
            GROUP BY event
        `, 'the user-stage receipt', USER_STAGE_COLUMNS);
        const received: Record<string, number> = {};
        for (const row of rows) {
            if (typeof row.event === 'string' && typeof row.received === 'number') received[row.event] = row.received;
        }
        const state = Object.keys(received).length > 0 ? 'RECEIVED' : 'NOT_RECEIVED';
        console.log(`USER_STAGE_RECEIPT ${JSON.stringify({ release_sha: releaseSha, journey_id: journeyId, traffic_type: 'user', state, received, qualifies: false })}`);
        // Never a pass: the receipt is reported, and the run still ends as a HOLD because user traffic cannot qualify.
        hold('user-stage receipt reported above; `user` traffic is report-only and never qualifies a release');
    }
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
        SELECT DISTINCT distinct_id AS distinct_id
        FROM events
        WHERE timestamp > now() - INTERVAL ${Math.floor(windowHours)} HOUR
          AND properties.release_sha = ${sql(releaseSha)}
          AND properties.traffic_type = ${sql(trafficType)}
          AND properties.journey_id = ${sql(journeyId)}
    `;
    const identityResult = await runQuery(identityQuery, 'the qualifying identity lookup', IDENTITY_COLUMNS);
    const identityRows = identityResult.map(row => [row.distinct_id]);

    // #1421 P2 — the reading lives in a checked, testable module; the policy stays here. A malformed
    // row is a HOLD, not something to filter away before counting what is left.
    const identity = resolveQualifyingIdentity(identityRows);
    if (!identity.ok) hold(`journey ${journeyId}: ${identity.reason}`);
    const qualifyingIdentity = identity.distinctId;

    /**
     * #1258 H1 (PM 6115110576) — THE RECEIVED COACHING-DIAGNOSTIC CHAIN (opt-in, one run of this mode per receipt).
     *
     * The coaching request lands in the recording journey and Share Feedback in the post-reload journey, so this is not a
     * per-journey stage: it reads both governed events for the SAME qualifying identity (derived above from the anchor
     * journey) and release, and compares SHA-256 digests of the received ids with the digests the receipt recorded at the
     * sent boundary. Named governed fields only; ids are hashed in memory and never printed. Exit 0 PASS, 3 FAIL, 1 HOLD.
     */
    if (process.env.TELEMETRY_READBACK_COACHING_DIAGNOSTIC === '1') {
        let expected: unknown = null;
        try { expected = JSON.parse(process.env.COACHING_DIAGNOSTIC_EXPECTATION ?? 'null'); } catch { expected = null; }
        if (!validExpectation(expected)) hold('COACHING_DIAGNOSTIC_EXPECTATION is missing or malformed — the receipt named no sent request to bind');
        const coachingRows = await runQuery(`
            SELECT event, properties.diagnostic_request_id AS diagnostic_request_id, properties.diagnostic_attempt_id AS diagnostic_attempt_id,
                   properties.outcome AS outcome, properties.product AS product,
                   properties.configured_model AS configured_model, properties.observed_model AS observed_model,
                   properties.status AS status, properties.provider_status AS provider_status,
                   properties.client_release_id AS client_release_id, properties.coaching_diagnostic_id AS coaching_diagnostic_id,
                   properties.source AS source, properties.provider_attempts AS provider_attempts, uuid, properties.client_attempt AS client_attempt
            FROM events
            WHERE event IN ('ai_coaching_diagnostic', 'feedback_submit')
              AND timestamp > now() - INTERVAL ${Math.floor(windowHours)} HOUR
              AND properties.release_sha = ${sql(releaseSha)}
              AND properties.traffic_type = ${sql(trafficType)}
              AND distinct_id = ${sql(qualifyingIdentity)}
            ORDER BY timestamp ASC
            LIMIT 500
        `, 'the coaching diagnostic receipt', COACHING_COLUMNS);
        if (coachingRows.length >= 500) hold('the coaching diagnostic receipt reached its row limit — absence cannot be proven');
        const received = coachingRows.map((row) => {
            return {
                event: row.event, requestId: row.diagnostic_request_id, attemptId: row.diagnostic_attempt_id,
                outcome: row.outcome, product: row.product, configuredModel: row.configured_model,
                observedModel: row.observed_model, status: row.status, providerStatus: row.provider_status,
                clientReleaseId: row.client_release_id, coachingDiagnosticId: row.coaching_diagnostic_id,
                source: row.source, providerAttempts: row.provider_attempts,
                // Smoke item 3: identity diagnostics only — reported as counts/closed values, never as raw ids.
                uuid: row.uuid, clientAttempt: row.client_attempt,
            };
        });
        const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
        const outcome = evaluateCoachingDiagnosticReceipt(received, expected, releaseSha, sha256);
        console.log(`COACHING_DIAGNOSTIC_RECEIPT ${JSON.stringify({ release_sha: releaseSha, anchor_journey_id: journeyId, traffic_type: trafficType, ...outcome })}`);
        process.exit(outcome.verdict === 'PASS' ? 0 : outcome.verdict === 'FAIL' ? READBACK_FAIL_EXIT : 1);
    }

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

    // #1539 F1: the SELECT actually sent must name the declared current 45-column contract.
    const rows = await runQuery(query, 'the readback', READBACK_COLUMNS);
    if (readbackTruncated(rows.length)) hold(`the readback reached its explicit row limit (${READBACK_ROW_LIMIT}) — the result may be truncated, so absence cannot be proven`);

    // Deliberately unsanitised: the evaluator's own contract is that it receives whatever the readback
    // saw, junk included, because a decoder that tidies its input cannot report that the input was wrong.
    const readback = readbackRowsFromNamed(rows);

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
    // #1532 Codex P1 r4124290575: the recording attempts the run named for this binding (the saved take). #1593 (Sam
    // 16:44:51): the same declaration binds the interrupted repeat take's stage to THE declared take, never a guessed one.
    const expectedAttempts = (process.env.QUALIFICATION_ATTEMPT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
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
        stageReasons.push(...evaluateQualificationStage(stage, scoped, { expectedAttemptIds: expectedAttempts }));
    }

    // #1532 Codex P1 r4120338743: the base families follow the declared stages (a feedback-only journey never records).
    const result = evaluateTelemetryCompleteness(observed, requiredFamiliesForStages(declared));
    /**
     * THE RECEIVED-VENDOR CASUALTY.
     *
     * `observed` is intentionally a family set for completeness, but a Set cannot prove that a
     * singleton receipt arrived once: two rows collapse to the same value. Drive cardinality from the
     * decoded rows instead, after binding them to this boot and journey. Health rows from this boot are
     * included only to NAME the failure boundary; they never replace a missing receipt or turn HOLD
     * into QUALIFIED.
     */
    const deliveryRows = readback.filter((row) => row.bootId === boot.bootId && (
        row.journeyId === journeyId
        || PRE_JOURNEY_EVENT_FAMILIES.includes(row.event as typeof PRE_JOURNEY_EVENT_FAMILIES[number])
    ));
    // #1532 Codex P1 r4120724715: the singleton set follows the declared stages (a feedback-only journey never records).
    // #1532 Codex P1 r4124290575: the recording singletons are judged per EXPECTED attempt the run named (the saved take),
    // so the unsaved repeat and next-Start takes in the same journey neither count against it nor hide its absence.
    const delivery = evaluateAttemptScopedDelivery(deliveryRows, exactlyOnceFamiliesForStages(declared), expectedAttempts);
    // #1258 (#1563, Codex r4197007854): an OBSERVED failure is FAIL (exit 3, never retried into HOLD); missing is HOLD.
    const verdict: ReadbackVerdict = readbackVerdict(stageReasons, result.verdict, delivery.verdict);
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
        required_families: [...requiredFamiliesForStages(declared)],
        stages_declared: declared,
        attempts_declared: expectedAttempts,
        stage_reasons: stageReasons,
        received_counts: delivery.receivedCounts,
        duplicate_families: delivery.duplicateFamilies,
        delivery_failures: delivery.deliveryFailures,
        verdict,
        missing: [...new Set([...result.missing, ...delivery.missingFamilies])],
        unrecognised: result.unrecognised,
        reasons: [...result.reasons, ...delivery.reasons],
    };
    console.log(`TELEMETRY_READBACK_QUALIFICATION_EVIDENCE ${JSON.stringify(evidence)}`);

    /**
     * RWT FIRST-DOWNLOAD RECEIPT (opt-in; set only for first-visit RWT journeys, where it is REQUIRED evidence).
     * The PO asked for the actual first-visit model acquisition time as RECEIVED, not the event name alone. Bound to
     * the same journey, release, traffic class and qualifying identity as the readback above, and selecting only named
     * governed fields from the allowlist — never the property bag. Network download, init and total setup time stay
     * separate fields: a total setup timer is not network download time. Only a measured cold download passes; a cache
     * hit, a partial or unobservable measurement, or no receipt at all ends the run as a HOLD.
     */
    // #1532 Codex P1 r4120724726: the first-download receipt is required of the RECORDING binding only; a feedback-only
    // journey (after the Analytics reload) acquires no model. An empty/unknown declaration keeps it required (fail closed).
    const acquisitionRequired = process.env.TELEMETRY_READBACK_ACQUISITION_RECEIPT === '1' && declaresRecordingStage(declared);
    if (process.env.TELEMETRY_READBACK_ACQUISITION_RECEIPT === '1' && !acquisitionRequired) {
        console.log(`ACQUISITION_RECEIPT ${JSON.stringify({ release_sha: releaseSha, journey_id: journeyId, traffic_type: trafficType, state: 'NOT_APPLICABLE_NO_RECORDING_STAGE' })}`);
    }
    if (acquisitionRequired) {
        const acquisitionRows = await runQuery(`
            SELECT properties.model_identity AS model_identity, properties.acquired_candidate_id AS acquired_candidate_id,
                   properties.cache_result AS cache_result, properties.measurement_completeness AS measurement_completeness,
                   properties.measurement_reason_code AS measurement_reason_code, properties.network_used AS network_used,
                   properties.download_ms AS download_ms, properties.init_ms AS init_ms, properties.total_ms AS total_ms,
                   properties.network_bytes AS network_bytes, properties.partial_download_ms AS partial_download_ms
            FROM events
            WHERE event = 'private_model_acquisition_success'
              AND timestamp > now() - INTERVAL ${Math.floor(windowHours)} HOUR
              AND properties.release_sha = ${sql(releaseSha)}
              AND properties.traffic_type = ${sql(trafficType)}
              AND properties.journey_id = ${sql(journeyId)}
              AND distinct_id = ${sql(qualifyingIdentity)}
            ORDER BY timestamp ASC
        `, 'the acquisition receipt', ACQUISITION_COLUMNS);
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        const str = (v: unknown) => (typeof v === 'string' ? v : null);
        const receipts = acquisitionRows.map((row) => {
            return {
                model_identity: str(row.model_identity), acquired_candidate_id: str(row.acquired_candidate_id), cache_result: str(row.cache_result),
                measurement_completeness: str(row.measurement_completeness), measurement_reason_code: str(row.measurement_reason_code),
                network_used: typeof row.network_used === 'boolean' ? row.network_used : null,
                download_ms: num(row.download_ms), init_ms: num(row.init_ms), total_ms: num(row.total_ms), network_bytes: num(row.network_bytes),
                partial_download_ms: num(row.partial_download_ms),
            };
        });
        const first = receipts[0];
        // A FIRST download is proven only by a complete measurement of a cache MISS that used the network, with a
        // measured download_ms. A cache hit is a warm load, never first-visit download time (PM r4 review).
        const state = !first ? 'NOT_RECEIVED'
            : first.measurement_completeness === 'unobservable' ? 'UNOBSERVABLE'
                : first.measurement_completeness !== 'complete' ? 'RECEIVED_PARTIAL'
                    : first.cache_result === 'hit' ? 'RECEIVED_CACHE_HIT'
                        : first.cache_result === 'miss' && first.network_used === true && first.download_ms !== null ? 'RECEIVED_COLD_DOWNLOAD'
                            : 'RECEIVED_INCONCLUSIVE';
        console.log(`ACQUISITION_RECEIPT ${JSON.stringify({ release_sha: releaseSha, journey_id: journeyId, traffic_type: trafficType, state, received: receipts.length, first: first ?? null })}`);
        // Required evidence for a first-visit RWT journey: anything but a measured cold download is a HOLD, so a green
        // event-family qualification can never stand in for the download timing the PO asked for.
        // An observed failure is already this journey's verdict; a missing acquisition receipt cannot downgrade it to HOLD.
        if (state !== 'RECEIVED_COLD_DOWNLOAD' && verdict !== 'FAIL') {
            hold(`first-download receipt is ${state}: a measured cold network download (cache miss, network used, download_ms) was not received for journey ${journeyId}`);
        }
    }

    if (verdict === 'FAIL') {
        console.error(`FAIL — an observed failure was received: ${stageReasons.filter(isObservedFailureReason).join('; ')}`);
        process.exit(READBACK_FAIL_EXIT);
    }
    if (verdict !== 'QUALIFIED') {
        console.error(`HOLD — ${[...result.reasons, ...delivery.reasons, ...stageReasons].join('; ')}`);
        process.exit(1);
    }
    console.log(`QUALIFIED — every required governed family was INGESTED and singleton receipts arrived once for journey ${journeyId} on ${releaseSha}.`);
}

await main();
