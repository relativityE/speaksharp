/**
 * RWT acceptance (PO 2026-09-25) — pure, dependency-free, shared by the live suites (which WRITE the receipt and the
 * human-check worksheet) and `scripts/rwt-finalize-receipt.mts` (which CONSUMES the completed worksheet after the run).
 *
 * A finished receipt cannot change itself. Its `acceptance` is INCOMPLETE while any named human observation is
 * pending; the ONLY way to a final PASS/FAIL is `finalizeReceipt`, which binds the completed worksheet to the same
 * suite, deployed SHA, journey ids and observation set, requires a PASS/FAIL and an observer for every observation,
 * and recomputes acceptance over ALL rows. Content-free throughout: ids, verdicts, SHAs and observer names only.
 */
import { coherentCoachingResult } from '../../../frontend/src/services/telemetry/coachingDiagnosticReceipt';
import { SAVE_RETRY_SUITE } from './rwtSaveRetry';
import { ABANDON_SUITE, TWO_TAB_SUITE } from './rwtAbandonTakeover';

/** #1532 Codex P1 r4119969323 — one journey and the qualification stages IT exercised. */
/** `firstDownload`: this binding carries the run's first actual model download, so its readback requires the cold-download receipt. */
/** `attemptIds`: the recording attempts this binding must show exactly one start and one save for (judged per attempt). */
export interface ReadbackBinding { journeyId: string; stages: string[]; firstDownload?: boolean; attemptIds?: string[] }

/** In-memory action-time identity captured before feedback/PDF event serialization; never written into the receipt. */
export type ReadbackActionStage = 'share_feedback' | 'session_pdf_export';
export interface ReadbackActionBinding {
    stage: ReadbackActionStage;
    journeyId: string;
    bootId: string;
    releaseSha: string;
    trafficType: string;
    runId: string;
    runAttempt: string;
    /**
     * How the journey was observed (#1570 Codex P1 r4212726964, hard reload): `route_change` — the boot's latest decoded route
     * transition into Analytics; `boot_load` — the boot loaded directly onto Analytics (a reload emits no route_change), so
     * its journey is the one its own positive control carries.
     */
    entry: 'route_change' | 'boot_load';
    /** Node-side capture time, so the oracle re-checks "latest boot / latest route" as of the action, not as of readback. */
    capturedAt: number;
}

/** Every canary journey the run observed — bound (qualified) or reported only. Worksheet and finalizer bind to this set. */
export function runJourneyIds(plan: { journeys: readonly ReadbackBinding[]; reportedJourneyIds: readonly string[] }): string[] {
    return [...new Set([...plan.journeys.map((j) => j.journeyId), ...plan.reportedJourneyIds])];
}

/**
 * `HUMAN`: a named human RWT observation — a runbook check no automation can judge. Never a permanent HOLD: it names
 * the question and pass criterion, and becomes PASS/FAIL only through the finalization step.
 */
/**
 * `EXTERNAL` (PO 2026-10-14, PM 6171519534): the coaching provider was PROVABLY unavailable (request-bound provider 5xx
 * or provider timeout) AND the app independently degraded gracefully. Never PASS and never FAIL: it does not block
 * progress, but successful-coaching coverage stays outstanding, so acceptance stays INCOMPLETE. Set only by
 * `coachingExternal.ts`; a suite cannot otherwise declare it.
 */
export type Verdict = 'PASS' | 'FAIL' | 'HOLD' | 'HUMAN' | 'EXTERNAL';
export interface ReceiptRow { step: string; verdict: Verdict; detail: string; evidence?: Record<string, string | number | boolean | null> }
export type Acceptance = 'PASS' | 'FAIL' | 'INCOMPLETE';

export interface HumanObservationState { id: string; runbookRow: string; result: 'pending' | 'PASS' | 'FAIL' | 'not_exercised' }

/**
 * #1258 (Codex P2 r4274573846, PM 6175763509 §4) — the human checks that judge the QUALITY of a coaching answer, each
 * with the coaching row that produced (or failed to produce) that answer. When that parent is a proved EXTERNAL outage
 * there is no answer to judge: the reviewer may record NOT_EXERCISED (or leave it blank) instead of inventing PASS/FAIL.
 * Only for these ids, only under their own EXTERNAL parent; PASS is refused (absent coaching is never quality PASS), and a
 * recorded FAIL still stands. Every other human check is unchanged.
 */
export const COACHING_QUALITY_OBSERVATIONS: Readonly<Record<string, string>> = Object.freeze({
    open_mic_coaching_relevant: 'coaching rendered',
    focus_coaching_covers_points: 'Focus coaching rendered',
});
export const NOT_EXERCISED = 'NOT_EXERCISED';
const externalParentOf = (rows: readonly ReceiptRow[], observationId: string): boolean => {
    const parent = COACHING_QUALITY_OBSERVATIONS[observationId];
    return parent !== undefined && rows.some((r) => r.step === parent && r.verdict === 'EXTERNAL');
};

const isHumanObservation = (r: ReceiptRow): boolean => Boolean(r.evidence && typeof r.evidence.observationId === 'string');

/**
 * The Analytics rows that can only be measured when the take HAS a saved coaching pair. Under a proved EXTERNAL outage
 * they are written as "not exercised" (Codex P1 r4274573837, PM 6175763509 §2), so a complete receipt carries every
 * required row instead of silently omitting them. The navigation rows before them are always judged on their own.
 */
export const COACHING_DEPENDENT_ANALYTICS_ROWS = Object.freeze([
    'analytics detail shows both AI suggestions', 'saved review is the first block', '"From this session" evidence', 'one practice action',
] as const);

/**
 * #1258 (Codex P1 r4275387520) — EXTERNAL is a CLOSED claim. Per suite, exactly one coaching PARENT row may be EXTERNAL,
 * and only with its own recorded proof; only that suite's success-dependent rows may follow it, and only under a proved
 * parent. Anywhere else EXTERNAL is a validation error — it can never turn an observed FAIL into a non-blocking
 * INCOMPLETE or report a provider outage the run did not prove.
 */
/** The "visible = saved" rows: EXTERNAL needs confirmed saved AND visible absence (Codex P1 r4277621600). */
const VISIBLE_ABSENCE_ROWS: ReadonlySet<string> = new Set(['coaching visible = saved', 'Focus coaching visible = saved']);

interface ExternalScope {
    parent: string;
    binding: string;
    /** App-owned rows that are EXTERNAL only with a confirmed read of NO saved coaching for this take. */
    absence: readonly string[];
    /** The app-owned telemetry row, EXTERNAL only when this request's failure report is bound to it. */
    telemetry: string;
    dependents: readonly string[];
}
const FOCUS_EXTERNAL_SCOPE: ExternalScope = Object.freeze({
    parent: 'Focus coaching rendered',
    binding: 'Focus coaching request bound to this take',
    absence: Object.freeze(['Focus coaching provenance', 'Focus coaching visible = saved']),
    telemetry: 'Focus coaching telemetry sent',
    dependents: Object.freeze([
        'Focus coaching length', 'Focus coaching distinct', 'Focus coaching makes no omission claim', 'Focus coaching server receipt',
        'Focus coaching provenance', 'Focus coaching visible = saved', 'Focus coaching telemetry sent', ...COACHING_DEPENDENT_ANALYTICS_ROWS,
    ]),
});
const EXTERNAL_SCOPES: Readonly<Record<string, ExternalScope>> = Object.freeze({
    'open-mic-first-session': Object.freeze({
        parent: 'coaching rendered',
        binding: 'coaching request bound to this take',
        absence: Object.freeze(['coaching visible = saved']),
        telemetry: 'coaching telemetry sent',
        dependents: Object.freeze([
            'coaching length', 'coaching phrases distinct', 'coaching visible = saved', 'coaching server receipt', 'coaching telemetry sent',
            ...COACHING_DEPENDENT_ANALYTICS_ROWS,
        ]),
    }),
    'focus-points-session': FOCUS_EXTERNAL_SCOPE,
    'focus-points-partial': FOCUS_EXTERNAL_SCOPE,
});

/**
 * The parent's own recorded proof, mirroring `coachingParentVerdict`: the Edge 502 carried a provider 5xx (with its
 * integer status) or a provider timeout, from this take's unique exchange; the take was saved; the card settled on
 * `error` with the unavailable headline and an enabled Try again. Returns what is missing (empty = proved).
 */
export function externalParentProofGaps(row: ReceiptRow): string[] {
    const e = row.evidence ?? {};
    const gaps: string[] = [];
    if (e.httpStatus !== 502) gaps.push('httpStatus is not 502');
    if (e.externalOutcome === 'provider_5xx') {
        const ps = e.providerStatus;
        if (e.failureReason !== 'provider_http_5xx') gaps.push('failureReason is not provider_http_5xx');
        if (typeof ps !== 'number' || !Number.isInteger(ps) || ps < 500 || ps > 599) gaps.push('providerStatus is not an integer 500–599');
    } else if (e.externalOutcome === 'provider_timeout') {
        if (e.failureReason !== 'provider_timeout') gaps.push('failureReason is not provider_timeout');
    } else {
        gaps.push('externalOutcome is not provider_5xx or provider_timeout');
    }
    if (e.takeExchangeUnique !== true) gaps.push('the take exchange is not unique');
    if (e.savedTakeProven !== true) gaps.push('the saved take is not proven');
    if (e.reviewState !== 'error') gaps.push('the review card did not settle on error');
    if (e.unavailableShown !== true) gaps.push('the unavailable message was not shown');
    if (e.retryEnabled !== true) gaps.push('Try again was not enabled');
    return gaps;
}

/** Every EXTERNAL row in an INPUT receipt must sit inside its suite's closed scope (see `EXTERNAL_SCOPES`). */
function externalScopeErrors(suite: string, rows: readonly ReceiptRow[]): string[] {
    const externalRows = rows.filter((r) => r.verdict === 'EXTERNAL');
    if (externalRows.length === 0) return [];
    const scope = EXTERNAL_SCOPES[suite];
    if (!scope) return externalRows.map((r) => `row "${r.step}" is EXTERNAL, which the ${suite} suite never writes`);
    const errors: string[] = [];
    const parent = rows.find((r) => r.step === scope.parent && !isHumanObservation(r));
    const parentExternal = parent?.verdict === 'EXTERNAL';
    if (parentExternal) {
        const gaps = externalParentProofGaps(parent);
        if (gaps.length > 0) errors.push(`row "${scope.parent}" is EXTERNAL without its proof: ${gaps.join('; ')}`);
        const binding = rows.find((r) => r.step === scope.binding && !isHumanObservation(r));
        if (binding?.verdict !== 'PASS') errors.push(`row "${scope.parent}" is EXTERNAL but "${scope.binding}" is not PASS`);
    }
    // Codex P1 r4276518654: an APP-OWNED dependent is EXTERNAL only with its own proof — the parent alone never
    // excuses what the app did. The success-only rows (length, distinct, omission claim, server receipt) are never
    // written FAIL under a proved parent, so for them the parent is the whole claim.
    // Codex P1 r4277621600: a "visible = saved" row also needs a confirmed VISIBLE absence (closed scalar, true only).
    const absenceProved = (row: ReceiptRow | undefined) => row?.verdict === 'EXTERNAL' && row.evidence?.savedCoachingAbsent === true
        && (!VISIBLE_ABSENCE_ROWS.has(row.step) || row.evidence?.visibleCoachingAbsent === true);
    const absenceRows = scope.absence.map((step) => rows.find((x) => x.step === step && !isHumanObservation(x)));
    for (const r of externalRows) {
        if (r === parent) continue;
        if (isHumanObservation(r)) { errors.push(`human observation "${r.step}" arrived as EXTERNAL; only finalization may record not exercised`); continue; }
        if (!scope.dependents.includes(r.step)) { errors.push(`row "${r.step}" is EXTERNAL, but EXTERNAL is allowed only on the coaching rows of ${suite}`); continue; }
        if (!parentExternal) { errors.push(`row "${r.step}" is EXTERNAL without an EXTERNAL "${scope.parent}" parent`); continue; }
        if (scope.absence.includes(r.step) && !absenceProved(r)) {
            errors.push(VISIBLE_ABSENCE_ROWS.has(r.step) && r.evidence?.savedCoachingAbsent === true
                ? `row "${r.step}" is EXTERNAL without a confirmed visible absence of coaching (visibleCoachingAbsent)`
                : `row "${r.step}" is EXTERNAL without a confirmed read of no saved coaching (savedCoachingAbsent)`);
        } else if (r.step === scope.telemetry && r.evidence?.boundFailureOutcome !== 'bound') {
            errors.push(`row "${r.step}" is EXTERNAL without this request's bound failure report (boundFailureOutcome)`);
        } else if (r.step === scope.telemetry && (r.evidence?.firstTakeRequestProof !== 'PASS' || r.evidence?.firstTakeRequestCount !== 1)) {
            // Codex P1 r4277621594: the first take's review request must be proved exactly once (normalized keys, both suites).
            errors.push(`row "${r.step}" is EXTERNAL without the first take's proved review request (firstTakeRequestProof / firstTakeRequestCount)`);
        } else if ((COACHING_DEPENDENT_ANALYTICS_ROWS as readonly string[]).includes(r.step) && !absenceRows.every(absenceProved)) {
            errors.push(`row "${r.step}" is EXTERNAL but the take's saved-coaching absence is not proved (${scope.absence.join(', ')})`);
        }
    }
    return errors;
}

/** Acceptance over ALL rows, the automated part alone, and the named human observations' state. */
/**
 * #1532 Codex P1 r4121232394 — PO disposition 2026-09-28 (full loop 4): the ONLY rows whose HOLD does not gate acceptance.
 * They stay in the receipt and worksheet, named, with the PO's reason. A FAIL on them still gates; any other HOLD still
 * makes the run INCOMPLETE. The list is closed: a suite cannot declare its own exemption.
 */
export const NON_GATING_ROWS: Readonly<Record<string, string>> = Object.freeze({
    'signup-stage telemetry received': 'PO 2026-09-28: pre-claim user-class traffic is report-only and never qualifies',
    'base_q4 primary': 'PO 2026-09-28: v4 base_q4 activation is sequenced after RWT; the pre-v4 RWT may pass without it',
});
const exempt = (r: ReceiptRow) => r.verdict === 'HOLD' && Object.prototype.hasOwnProperty.call(NON_GATING_ROWS, r.step);

export function receiptAcceptance(rows: readonly ReceiptRow[]): {
    acceptance: Acceptance;
    automatedRowsAllPass: boolean;
    humanObservations: HumanObservationState[];
    nonGating: { step: string; verdict: string; reason: string }[];
    /** Rows that recorded a proved external provider outcome — non-blocking, named, and never counted as a pass. */
    external: { step: string; detail: string }[];
    /** True whenever any row is EXTERNAL: a non-blocking provider outage is not proof that coaching works. */
    successfulCoachingOutstanding: boolean;
} {
    const gating = rows.filter((r) => !exempt(r));
    const external = rows.filter((r) => r.verdict === 'EXTERNAL').map((r) => ({ step: r.step, detail: r.detail }));
    return {
        // FAIL dominates; an EXTERNAL row (like a HOLD) leaves the run INCOMPLETE, never PASS.
        acceptance: gating.some((r) => r.verdict === 'FAIL') ? 'FAIL'
            : gating.some((r) => r.verdict === 'HOLD' || r.verdict === 'HUMAN' || r.verdict === 'EXTERNAL') ? 'INCOMPLETE' : 'PASS',
        external,
        successfulCoachingOutstanding: external.length > 0,
        // #1532 Codex P2 r4126745144: every GATING automated row must be PASS; a gating HOLD is not "all pass". Rows in
        // NON_GATING_ROWS are already excluded from `gating`, and human observations are never automated.
        automatedRowsAllPass: gating.filter((r) => !isHumanObservation(r)).every((r) => r.verdict === 'PASS'),
        nonGating: rows.filter(exempt).map((r) => ({ step: r.step, verdict: r.verdict, reason: NON_GATING_ROWS[r.step] })),
        humanObservations: rows.filter(isHumanObservation).map((r) => ({
            id: String(r.evidence!.observationId),
            runbookRow: String(r.evidence!.runbookRow ?? ''),
            result: r.verdict === 'PASS' || r.verdict === 'FAIL' ? r.verdict : r.verdict === 'EXTERNAL' ? 'not_exercised' : 'pending',
        })),
    };
}

/**
 * PM 5881740741 (rehearsal 1, run 36506361220): a journey that HOLDs at its pre-write surface preflight never exercised
 * the product, so its later rows are not observations. Zero events from an aborted journey must not read as product
 * FAILs, and a PASS is equally unobserved. Every row recorded after the halt becomes HOLD "not reached", without its
 * evidence (zero counts are not evidence), so acceptance is INCOMPLETE. The list of rows that stay valid is closed:
 * only the receipt's own leak check, which judges the receipt itself rather than the product.
 */
export const ROWS_VALID_AFTER_HALT: ReadonlySet<string> = new Set(['receipt content-free']);

export function rowAfterHalt(row: ReceiptRow, haltedAt: string | null): ReceiptRow {
    if (haltedAt === null || ROWS_VALID_AFTER_HALT.has(row.step)) return row;
    // Cleanup judges Production state, not the product: a cleanup that failed or found residue stays a FAIL. Only "no
    // account to delete" is expected after a pre-write halt (none was created), so it is "not reached", not a FAIL.
    if (row.step === RUN_OWNED_CLEANUP_ROW && row.evidence?.cleanupOutcome !== 'none_found') return row;
    return { step: row.step, verdict: 'HOLD', detail: `not reached: the journey stopped at ${haltedAt}` };
}

const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '/');

/**
 * The human-check worksheet for ONE run. The header binds it to its receipt (suite, deployed SHA, journey ids); one row
 * per named human observation, with blank Result and Observer cells for the PO/PM.
 */
export function humanWorksheet(suite: string, release: string, journeyIds: readonly string[], rows: readonly ReceiptRow[]): string {
    const human = rows.filter(isHumanObservation);
    const prefilled = human.some((r) => r.verdict === 'HUMAN' && externalParentOf(rows, String(r.evidence!.observationId)));
    const lines = [
        `# RWT human-check worksheet — ${suite}`,
        '',
        `Suite: \`${suite}\``,
        `Deployed SHA: \`${release || '(unset)'}\``,
        `Journey ids: ${journeyIds.length > 0 ? journeyIds.map((j) => `\`${j}\``).join(', ') : '(none)'}`,
        `Receipt: \`${suite}.receipt.json\``,
        '',
        'An automated PASS is not a human check. Fill in Result (PASS or FAIL) and Observer for every row, then run',
        `\`pnpm rwt:finalize -- --receipt ${suite}.receipt.json --worksheet ${suite}.human-worksheet.md\`. Until that step`,
        'passes, this run is INCOMPLETE.',
        ...(prefilled ? [
            '',
            `A Result prefilled \`${NOT_EXERCISED}\` is a coaching-quality check whose coaching was never produced: the provider was`,
            'proved unavailable (EXTERNAL). Leave it as it is and sign the Observer cell. PASS is refused for it (there is no',
            'coaching to approve); write FAIL only if you observed a coaching problem anyway. No other row accepts it.',
        ] : []),
        '',
        `| Observation id | Runbook row | Question | Observation needed to decide (pass criterion) | ${prefilled ? `Result (PASS/FAIL, or prefilled ${NOT_EXERCISED})` : 'Result (PASS/FAIL)'} | Observer · date |`,
        '|---|---|---|---|---|---|',
        ...human.map((r) => `| \`${cell(r.evidence!.observationId)}\` | ${cell(r.evidence!.runbookRow)} | ${cell(r.step.replace(/^human: /, ''))} | ${cell(r.evidence!.passCriterion)} | ${r.verdict === 'HUMAN' ? (externalParentOf(rows, String(r.evidence!.observationId)) ? NOT_EXERCISED : '') : r.verdict} |  |`),
    ];
    if (human.length === 0) lines.push('', '_No human observations in this run._');
    return `${lines.join('\n')}\n`;
}

export interface ParsedWorksheet {
    suite: string | null;
    release: string | null;
    journeyIds: string[];
    receipt: string | null;
    entries: Array<{ id: string; result: string; observer: string }>;
}

const headerValue = (md: string, label: string): string | null => {
    const m = new RegExp(`^${label}: (.*)$`, 'm').exec(md);
    return m ? m[1].trim() : null;
};
const unquote = (v: string | null) => (v === null ? null : v.replace(/^`|`$/g, ''));

/** Reads a completed worksheet. Tolerant of whitespace; strict about structure. */
export function parseHumanWorksheet(md: string): ParsedWorksheet {
    const journeys = headerValue(md, 'Journey ids');
    const entries = md.split('\n')
        .filter((line) => /^\|\s*`[^`]+`\s*\|/.test(line))
        .map((line) => {
            const cells = line.split('|').slice(1, -1).map((c) => c.trim());
            return { id: cells[0].replace(/`/g, ''), result: (cells[4] ?? '').toUpperCase(), observer: cells[5] ?? '' };
        });
    return {
        suite: unquote(headerValue(md, 'Suite')),
        release: unquote(headerValue(md, 'Deployed SHA')),
        journeyIds: journeys && journeys !== '(none)' ? [...journeys.matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [],
        receipt: unquote(headerValue(md, 'Receipt')),
        entries,
    };
}

export interface ReceiptForFinalization {
    suite: string;
    release: string;
    rows: ReceiptRow[];
    meta?: Record<string, unknown>;
    readback?: { journeys?: ReadbackBinding[]; reportedJourneyIds?: string[]; missingBindings?: string[] };
}

const VERDICTS: ReadonlySet<string> = new Set(['PASS', 'FAIL', 'HOLD', 'HUMAN', 'EXTERNAL']);

/**
 * PM RETURN 2026-09-26 — the human observations each RWT suite MUST carry. A receipt missing one of them cannot be
 * finalized: an empty or truncated receipt would otherwise have nothing to fail and read PASS.
 */
export function requiredHumanObservations(receipt: ReceiptForFinalization): string[] | null {
    switch (receipt.suite) {
        case 'open-mic-first-session':
            // Synthetic audio cannot prove "uh"; a human recording's transcript row can (automated).
            return ['open_mic_coaching_relevant', ...(receipt.meta?.fixtureKind === 'synthetic' ? ['open_mic_uh_detected'] : [])];
        case 'focus-points-session':
        case 'focus-points-partial':
            return ['focus_coaching_covers_points'];
        case 'returning-user-navigation':
            // #1532 Codex P1 r4127572196: the two release-level device checks this suite always emits.
            return ['real_microphone_permission_prompt', 'mobile_stop_confirmation_visible'];
        // #1594 (PM 6120326867): the supplemental boundary scenarios are fully automated; they carry no human check.
        case FEEDBACK_OLDER_TAKE_SUITE:
        case FEEDBACK_NO_SESSION_SUITE:
        case PENDING_START_SUITE:
        case SAVE_RETRY_REQUEST_LOST_SUITE:
        case SAVE_RETRY_RESPONSE_LOST_SUITE:
        case ABANDON_NAVIGATE_SUITE:
        case ABANDON_CLOSE_TAB_SUITE:
        case TWO_TAB_SUITE:
            return [];
        default:
            return null; // not an RWT suite this finalizer knows
    }
}

/**
 * #1532 Codex P1 r4126400982 (PM RETURN 5877389745) — the AUTOMATED rows each RWT suite MUST carry, exactly once. They
 * are the rows every suite writes on every path into `RwtReceipt.write()` (its `finally`: `telemetryClassRows` and the
 * content-free check), so a correct receipt always has them. Without this inventory a receipt that lost
 * `journey telemetry received` would finalize PASS with no received-telemetry assertion (`applyReadback` only updates a
 * row that exists). The returning-user suite qualifies no journey by design and must carry neither readback row.
 */
const ALWAYS_AUTOMATED_ROWS = Object.freeze([
    'telemetry decodable', 'signup-stage telemetry (user class)', 'signup-stage telemetry received', 'receipt content-free',
]);
const JOURNEY_READBACK_ROWS = Object.freeze(['journey telemetry (canary class)', 'journey telemetry received']);
export const RUN_OWNED_CLEANUP_ROW = 'run-owned cleanup';

/**
 * #1532 Codex P1 r4126745141 (PM RETURN 5878021743) — a suite whose receipt must carry its own cleanup evidence runs the
 * cleanup BEFORE writing the receipt and records exactly one content-free row. PASS only when the cleanup returned the
 * deleted account's UID (it throws on any unproven deletion or non-zero residue); a throw, or no account to delete, is
 * FAIL. The thrown message is never recorded. Returns whether the account was verifiably deleted.
 */
export async function recordRunOwnedCleanup(
    row: (step: string, verdict: Verdict, detail: string, evidence?: ReceiptRow['evidence']) => void,
    cleanup: () => Promise<string>,
): Promise<boolean> {
    let uid = '';
    let failed = false;
    try { uid = await cleanup(); } catch { failed = true; }
    if (!failed && uid) {
        row(RUN_OWNED_CLEANUP_ROW, 'PASS', 'the run-owned account was deleted and zero residue was verified before this receipt was written');
        return true;
    }
    row(RUN_OWNED_CLEANUP_ROW, 'FAIL', failed
        ? 'the run-owned account cleanup failed or could not prove zero residue; Production state may remain'
        : 'no run-owned account was found to delete, so deletion was not verified', { cleanupOutcome: failed ? 'failed' : 'none_found' });
    return false;
}

/**
 * #1532 Codex P1 r4127338275 (PM RETURN 5879422189, loop 2/2) — the PRODUCT-OUTCOME rows each suite writes on its success
 * path. A genuine all-PASS run always writes every one (a branch that fails writes the same step as FAIL/HOLD, or the run
 * throws and its receipt then lacks the row — which must never finalize PASS). Excluded by construction: per-word rows with
 * dynamic names (`filler "…"`), failure-only placeholders (`fillers` / `analytics` HOLD when nothing saved), and rows that
 * differ between valid configurations (Focus full-only feedback rows; partial-only cleanup). Required PRESENT; the
 * telemetry/cleanup singletons above stay exactly-once. Source: the suite files and the rwtJourney helpers they call.
 */
const OPEN_MIC_PRODUCT_ROWS = Object.freeze([
    'base_q4 primary', 'signup', 'sign-in', 'session bears canary claim', 'Products → Open Mic', 'no mic on navigation',
    'model identity', 'new-account entitlement', 'live filler highlighting', 'session saved', 'saved exactly once',
    'coaching rendered', 'coaching length', 'coaching phrases distinct', 'coaching visible = saved', 'coaching server receipt',
    // #1258 (Codex P2 r4274573839, PM 6175763509 §3): request provenance is mandatory evidence on every path.
    'coaching request bound to this take',
    'filler display matches saved (all words)', 'coachable filler headline', 'Products menu opened in the session',
    'Back from Progress restores the session', 'restored review', 'Back requests no coaching',
    'Analytics action', 'analytics session detail', 'reopen after reload', 'analytics detail shows both AI suggestions',
    'saved review is the first block', '"From this session" evidence', 'one practice action', 'session PDF',
    'Analytics generates no coaching', 'feedback', 'Progress evaluation', 'Progress debt',
    'Analytics Practice again opens the product', 'review Practice again starts after the gate clears', 'repeated take stopped, microphone off',
    'saved product marker', 'next Start', 'next take stopped, microphone off', 'telemetry sent', 'coaching telemetry sent',
    'inventory events sent', 'revisit is not a generation', 'model download vs setup timing', 'feedback retention',
    'Practice again press → arrival (sent)', 'feedback outcome (sent)',
    // #1258 (PM 6114590729): the report → exact coaching request chain, and real coaching provenance (prompt binding).
    'feedback diagnostic chain', 'coaching prompt binding',
]);
const FOCUS_PRODUCT_ROWS = Object.freeze([
    'base_q4 primary', 'session bears canary claim', 'Products → Focus Points', 'no mic on navigation', 'new-account entitlement',
    'pace guide', 'Head to session', 'rail legend', 'pending points labelled', 'rail before speaking', 'model identity',
    'live marker changes', 'next point marked', 'marker timing vs audio', 'no red before Stop', 'session saved',
    'final point verdicts', 'not-detected explained', 'coverage count', 'average per point', 'final rail colours and words',
    'persisted verdicts', 'Focus coaching rendered', 'Focus coaching request marked focus_points', 'Focus coaching request bound to this take',
    'Focus coaching length',
    'Focus coaching distinct', 'Focus coaching makes no omission claim', 'Focus coaching provenance',
    'Focus coaching visible = saved', 'Focus coaching server receipt', 'Products menu opened in the session',
    'Focus Back from Progress and reload keep the saved session',
    'Analytics action', 'analytics session detail', 'reopen after reload', 'analytics detail shows both AI suggestions',
    'saved review is the first block', '"From this session" evidence', 'one practice action', 'Analytics generates no coaching',
    'analytics point detail', 'Analytics Practice again opens the product', 'review Practice again starts after the gate clears',
    'repeated take stopped, microphone off', 'saved product marker', 'next Start', 'next take stopped, microphone off',
    'coverage_evaluation sent', 'Focus coaching telemetry sent', 'revisit is not a generation', 'inventory events sent',
    'model download vs setup timing', 'Practice again press → arrival (sent)',
    // #1258 (PM 6114590729): real coaching provenance (prompt binding), full and partial alike.
    'coaching prompt binding',
]);
const FOCUS_FULL_ONLY_PRODUCT_ROWS = Object.freeze(['feedback', 'feedback retention', 'feedback outcome (sent)', 'Focus New Set', 'Focus Edit', 'take after switching products is clean',
    'feedback diagnostic chain']);
/**
 * #1594 (PM 6120326867) — the supplemental boundary scenarios (`rwt-feedback-association-boundaries`,
 * `rwt-pending-start-navigation`). Each list is what that suite writes on its success path; a receipt missing any of them
 * can never finalize PASS. Rows a scenario must NEVER carry are listed as absent, so it cannot borrow evidence it has no
 * basis for:
 *  - older take: the selected OLDER take's own request, proven by the #1590 contract and settled only by the received
 *    coaching-diagnostic readback (`feedback diagnostic chain`); the newer take is named as current so a borrowed link FAILs;
 *  - no session: no take and no coaching result exist, so no coaching chain or prompt-binding row may appear;
 *  - pending Start: a navigation/abandonment check that saves nothing and qualifies no journey (like returning-user), so it
 *    carries no journey readback rows and no recording stages are ever guessed for it; its own cleanup row is required.
 * Every scenario ends with the whole-scenario `coaching request budget`.
 */
export const FEEDBACK_OLDER_TAKE_SUITE = 'feedback-association-boundaries-older-take';
export const FEEDBACK_NO_SESSION_SUITE = 'feedback-association-boundaries-no-session';
export const PENDING_START_SUITE = 'pending-start-navigation';
const SUPPLEMENTAL_ACCOUNT_ROWS = Object.freeze(['run-owned signup', 'canary claim in fresh login']);
const FEEDBACK_OLDER_TAKE_PRODUCT_ROWS = Object.freeze([
    ...SUPPLEMENTAL_ACCOUNT_ROWS, 'two saved takes', 'older take coaching request observed', 'older-take report stored once',
    'older-take association', 'older-take diagnostic binding', 'feedback diagnostic chain', 'coaching request budget', 'feedback retention',
]);
const FEEDBACK_NO_SESSION_PRODUCT_ROWS = Object.freeze([
    ...SUPPLEMENTAL_ACCOUNT_ROWS, 'no-session report stored once', 'no-session association', 'no-session diagnostic binding',
    'coaching request budget', 'feedback retention',
]);
const PENDING_START_PRODUCT_ROWS = Object.freeze([
    ...SUPPLEMENTAL_ACCOUNT_ROWS, 'cold Start is pending', 'Start transition observed', 'abandoned Start settles after leaving',
    'leaving pending Start releases microphone', 'leaving pending Start creates no session',
    'return to Open Mic exposes truthful Start state', 'return does not resume abandoned recording', 'coaching request budget',
]);
const NO_COACHING_RESULT_ROWS = Object.freeze(['feedback diagnostic chain', 'coaching prompt binding']);
/**
 * #1258 R1 (row 15) — `rwt-save-retry-recovery`, one receipt per variant. Like pending Start it qualifies no journey
 * readback (its fault is injected on the page's own request), so it carries no journey readback rows; its own cleanup
 * row is required. Fully automated: no human check.
 */
export const SAVE_RETRY_REQUEST_LOST_SUITE = `${SAVE_RETRY_SUITE}-request-lost`;
export const SAVE_RETRY_RESPONSE_LOST_SUITE = `${SAVE_RETRY_SUITE}-response-lost`;
const SAVE_RETRY_PRODUCT_ROWS = Object.freeze([
    ...SUPPLEMENTAL_ACCOUNT_ROWS, 'completion request altered once', 'recovery banner is truthful', 'no Discard after the save resolves',
    'Retry Save leaves one saved session', 'next take saves only itself', 'coaching request budget',
]);
/**
 * #1258 R2 (row 16) — `rwt-abandon-and-two-tabs`: leaving mid-recording (navigate away; close the tab) and the same
 * account's two-tab take-over. No journey readback is qualified (like pending Start); each carries its own cleanup row.
 */
export const ABANDON_NAVIGATE_SUITE = `${ABANDON_SUITE}-navigate-away`;
export const ABANDON_CLOSE_TAB_SUITE = `${ABANDON_SUITE}-close-tab`;
export { TWO_TAB_SUITE };
const ABANDON_PRODUCT_ROWS = Object.freeze([
    ...SUPPLEMENTAL_ACCOUNT_ROWS, 'take is recording before leaving', 'leaving mid-recording releases the microphone',
    'return does not resume the abandoned take', 'recovery notice is truthful', 'return Start is truthful',
    'next take saves only itself', 'no Cloud STT request', 'coaching request budget',
]);
const TWO_TAB_PRODUCT_ROWS = Object.freeze([
    ...SUPPLEMENTAL_ACCOUNT_ROWS, 'second tab is refused truthfully', 'take-over moves the one engine',
    'both takes saved, none left active', 'no Cloud STT request', 'coaching request budget',
]);
const RETURNING_USER_PRODUCT_ROWS = Object.freeze([
    'returning-user sign-in', 'returning account state', 'Products → Open Mic', 'returning-user access', 'Products → Focus Points',
    'back to Open Mic', 'returning history', 'no mic on navigation', 'navigation writes nothing', 'journey_step sent',
]);

export function requiredAutomatedRows(suite: string): { required: readonly string[]; product: readonly string[]; absent: readonly string[] } | null {
    switch (suite) {
        case 'open-mic-first-session':
            return { required: [...ALWAYS_AUTOMATED_ROWS, ...JOURNEY_READBACK_ROWS], product: OPEN_MIC_PRODUCT_ROWS, absent: [] };
        case 'focus-points-session':
            return { required: [...ALWAYS_AUTOMATED_ROWS, ...JOURNEY_READBACK_ROWS], product: [...FOCUS_PRODUCT_ROWS, ...FOCUS_FULL_ONLY_PRODUCT_ROWS], absent: [] };
        case 'focus-points-partial':
            // #1532 Codex P1 r4126745141: the partial run deletes its account in-body, before write(), and records it.
            return { required: [...ALWAYS_AUTOMATED_ROWS, ...JOURNEY_READBACK_ROWS, RUN_OWNED_CLEANUP_ROW], product: FOCUS_PRODUCT_ROWS, absent: [] };
        case 'returning-user-navigation':
            return { required: ALWAYS_AUTOMATED_ROWS, product: RETURNING_USER_PRODUCT_ROWS, absent: JOURNEY_READBACK_ROWS };
        case FEEDBACK_OLDER_TAKE_SUITE:
            return { required: [...ALWAYS_AUTOMATED_ROWS, ...JOURNEY_READBACK_ROWS], product: FEEDBACK_OLDER_TAKE_PRODUCT_ROWS, absent: ['coaching prompt binding'] };
        case FEEDBACK_NO_SESSION_SUITE:
            return { required: [...ALWAYS_AUTOMATED_ROWS, ...JOURNEY_READBACK_ROWS], product: FEEDBACK_NO_SESSION_PRODUCT_ROWS, absent: NO_COACHING_RESULT_ROWS };
        case PENDING_START_SUITE:
            return { required: [...ALWAYS_AUTOMATED_ROWS, RUN_OWNED_CLEANUP_ROW], product: PENDING_START_PRODUCT_ROWS,
                absent: [...JOURNEY_READBACK_ROWS, ...NO_COACHING_RESULT_ROWS] };
        case SAVE_RETRY_REQUEST_LOST_SUITE:
        case SAVE_RETRY_RESPONSE_LOST_SUITE:
            return { required: [...ALWAYS_AUTOMATED_ROWS, RUN_OWNED_CLEANUP_ROW], product: SAVE_RETRY_PRODUCT_ROWS,
                absent: [...JOURNEY_READBACK_ROWS, ...NO_COACHING_RESULT_ROWS] };
        case ABANDON_NAVIGATE_SUITE:
        case ABANDON_CLOSE_TAB_SUITE:
            return { required: [...ALWAYS_AUTOMATED_ROWS, RUN_OWNED_CLEANUP_ROW], product: ABANDON_PRODUCT_ROWS,
                absent: [...JOURNEY_READBACK_ROWS, ...NO_COACHING_RESULT_ROWS] };
        case TWO_TAB_SUITE:
            return { required: [...ALWAYS_AUTOMATED_ROWS, RUN_OWNED_CLEANUP_ROW], product: TWO_TAB_PRODUCT_ROWS,
                absent: [...JOURNEY_READBACK_ROWS, ...NO_COACHING_RESULT_ROWS] };
        default:
            return null;
    }
}

/**
 * #1258 (#1570, Codex P1 r4214120116) — THE CLOSED ROW-TO-STAGE MAP for blind-HOLD settlement. The finalizer, not the
 * untrusted receipt, decides which readback stages may settle which sent row: a row is settled only from the stages
 * listed here for its suite and step. A receipt row that carries `receivedByStages` / `blindSinceStep` but is not listed,
 * or names stages other than exactly these, is a binding error — so a modified receipt cannot turn, say, `feedback
 * retention` into PASS from the `session_after_open_mic` readback. Each entry mirrors the live spec's `*ReceivedBy`
 * constant (source contract: tests/unit/rwtBlindHoldSettlement1258.test.ts).
 */
// Codex P1 4219466523: the two required CORRELATION rows settle from the stage that runs the SAME correlation rule on
// what PostHog received (`practice_again` → press_reached_its_intended_route, `share_feedback` →
// submit_resolves_to_its_received_outcome). The partial Focus run shares no feedback, so it maps only the Practice row.
const PRACTICE_SETTLEMENT = { 'Practice again press → arrival (sent)': ['practice_again'] } as const;
const FEEDBACK_SETTLEMENT = { 'feedback outcome (sent)': ['share_feedback'] } as const;
const FOCUS_SETTLEMENT: Readonly<Record<string, readonly string[]>> = {
    'coverage_evaluation sent': ['session_after_focus_points'],
    'inventory events sent': ['analytics_inventory'],
    ...PRACTICE_SETTLEMENT,
};
export const BLIND_HOLD_SETTLEMENT: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
    'open-mic-first-session': {
        'telemetry sent': ['session_after_open_mic', 'share_feedback'],
        'inventory events sent': ['analytics_inventory', 'session_pdf_export'],
        ...PRACTICE_SETTLEMENT,
        ...FEEDBACK_SETTLEMENT,
    },
    'focus-points-session': { ...FOCUS_SETTLEMENT, ...FEEDBACK_SETTLEMENT },
    'focus-points-partial': FOCUS_SETTLEMENT,
};
const settlementStagesFor = (suite: string, step: string): readonly string[] | undefined =>
    Object.prototype.hasOwnProperty.call(BLIND_HOLD_SETTLEMENT, suite) && Object.prototype.hasOwnProperty.call(BLIND_HOLD_SETTLEMENT[suite], step)
        ? BLIND_HOLD_SETTLEMENT[suite][step] : undefined;

/**
 * PM RETURN 2026-09-26 — the receipt is untrusted input. Validate its structure, every row's verdict, the run identity
 * and the suite's required human observations BEFORE anything is applied; any error means no final PASS.
 */
export function validateReceipt(raw: unknown): { receipt: ReceiptForFinalization | null; errors: string[] } {
    const errors: string[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { receipt: null, errors: ['receipt is not a JSON object'] };
    const r = raw as Record<string, unknown>;
    if (typeof r.suite !== 'string' || r.suite.trim() === '') errors.push('receipt has no suite');
    if (typeof r.release !== 'string' || !/^[0-9a-f]{40}$/.test(r.release)) errors.push('receipt release is not a 40-character SHA');
    // #1532 Codex P1 r4119969323: per-journey bindings, plus the observed journeys that were reported, not qualified.
    const readback = r.readback as { journeys?: unknown; reportedJourneyIds?: unknown } | undefined;
    const bindingsOk = Array.isArray(readback?.journeys) && (readback!.journeys as unknown[]).every((b) => {
        const x = b as { journeyId?: unknown; stages?: unknown } | null;
        return !!x && typeof x.journeyId === 'string' && x.journeyId !== ''
            && Array.isArray(x.stages) && x.stages.length > 0 && x.stages.every((st) => typeof st === 'string');
    });
    const reportedOk = Array.isArray(readback?.reportedJourneyIds) && (readback!.reportedJourneyIds as unknown[]).every((j) => typeof j === 'string');
    if (!bindingsOk || !reportedOk) errors.push('receipt has no valid readback.journeys / readback.reportedJourneyIds');
    if (!Array.isArray(r.rows) || r.rows.length === 0) {
        errors.push('receipt has no rows');
    } else {
        r.rows.forEach((row, i) => {
            const x = row as Record<string, unknown> | null;
            if (!x || typeof x !== 'object' || typeof x.step !== 'string' || x.step.trim() === '' || typeof x.detail !== 'string') {
                errors.push(`row ${i} is malformed`);
            } else if (typeof x.verdict !== 'string' || !VERDICTS.has(x.verdict)) {
                errors.push(`row ${i} has an unknown verdict ${JSON.stringify(x.verdict)}`);
            } else if (x.evidence !== undefined && (typeof x.evidence !== 'object' || x.evidence === null || Array.isArray(x.evidence))) {
                errors.push(`row ${i} evidence is malformed`);
            }
        });
        const rows = r.rows as ReceiptRow[];
        if (errors.length === 0 && !rows.some((row) => !isHumanObservation(row))) errors.push('receipt has no automated rows');
    }
    if (errors.length > 0) return { receipt: null, errors };
    const receipt = r as unknown as ReceiptForFinalization;
    const required = requiredHumanObservations(receipt);
    if (required === null) return { receipt: null, errors: [`unknown RWT suite ${receipt.suite}`] };
    const present = receipt.rows.filter(isHumanObservation).map((row) => String(row.evidence!.observationId));
    for (const id of required) if (!present.includes(id)) errors.push(`receipt is missing the required human observation ${id}`);
    // Checked before any worksheet or readback is applied; nothing absent is inferred or added here.
    const automated = requiredAutomatedRows(receipt.suite)!;
    const countOf = (step: string) => receipt.rows.filter((row) => row.step === step && !isHumanObservation(row)).length;
    for (const step of automated.required) {
        const n = countOf(step);
        if (n === 0) errors.push(`receipt is missing the required automated row "${step}"`);
        else if (n > 1) errors.push(`receipt carries the automated row "${step}" ${n} times (exactly one is required)`);
    }
    for (const step of automated.product) {
        if (countOf(step) === 0) errors.push(`receipt is missing the required product row "${step}"`);
    }
    for (const step of automated.absent) {
        if (countOf(step) > 0) errors.push(`receipt carries "${step}", which the ${receipt.suite} suite never writes`);
    }
    // Codex P1 r4214120116: settlement claims must match the finalizer's closed map exactly, or nothing is finalized.
    for (const row of receipt.rows) {
        if (isHumanObservation(row)) continue;
        const ev = row.evidence ?? {};
        if (ev.receivedByStages === undefined && ev.blindSinceStep === undefined) continue;
        const allowed = settlementStagesFor(receipt.suite, row.step);
        if (!allowed) { errors.push(`row "${row.step}" claims readback settlement, which the ${receipt.suite} suite never maps`); continue; }
        if (ev.receivedByStages !== allowed.join(',') || typeof ev.blindSinceStep !== 'number' || !Number.isInteger(ev.blindSinceStep) || ev.blindSinceStep < 0) {
            errors.push(`row "${row.step}" names settlement stages other than the mapped ${allowed.join(', ')}`);
        }
    }
    // The suite writes `journey telemetry received` only as HOLD; the readback merge is the ONLY path to PASS/FAIL. A
    // receipt that arrives with it already settled would finalize PASS with no readback at all.
    const received = receipt.rows.find((row) => row.step === 'journey telemetry received' && !isHumanObservation(row));
    if (received && automated.required.includes(received.step) && received.verdict !== 'HOLD') {
        errors.push(`"journey telemetry received" arrived as ${received.verdict}; only the readback merge may settle it`);
    }
    errors.push(...externalScopeErrors(receipt.suite, receipt.rows));
    return { receipt, errors };
}

export interface FinalizationResult {
    /** `binding_error` means the worksheet cannot be applied to this receipt; the run stays INCOMPLETE. */
    status: 'final' | 'binding_error';
    finalAcceptance: Acceptance;
    errors: string[];
    rows: ReceiptRow[];
    humanObservations: HumanObservationState[];
    automatedRowsAllPass: boolean;
    /** PM 6171519534: proved external provider outcomes stay visible after finalization — never folded into PASS or FAIL. */
    external: { step: string; detail: string }[];
    successfulCoachingOutstanding: boolean;
}

/**
 * Apply a completed worksheet to its receipt. Every binding is checked before anything is applied: suite, deployed
 * SHA, journey ids and receipt name must equal the receipt's; the worksheet must list exactly the receipt's human
 * observations; every row needs Result PASS or FAIL and a named Observer (a FAIL is signed as much as a PASS). Any binding error leaves
 * the run INCOMPLETE (never a guess). Otherwise the human rows take the recorded verdicts and acceptance is
 * recomputed over ALL rows — so an automated FAIL still fails a run whose human checks all passed.
 */
/**
 * #1532 Codex P1 r4121232394 — the workflow's per-journey readback outcome, merged into `journey telemetry received`.
 * Untrusted input: it must name the SAME suite, release, bound journeys (with the same stages) and missing bindings as
 * the receipt, or it is a binding error. The row becomes PASS only when every bound journey QUALIFIED and nothing is
 * missing; otherwise it stays HOLD. No readback file leaves the row HOLD (fail closed).
 * #1258 (#1563, Codex r4197007854): a journey whose readback RECEIVED an observed failure is `FAIL`, and the row is FAIL —
 * an observed failure is never reported as missing evidence.
 */
export interface ReadbackVerdicts {
    suite: string;
    release: string;
    journeys: { journeyId: string; stages: string[]; verdict: 'QUALIFIED' | 'HOLD' | 'FAIL' }[];
    missingBindings: string[];
    /**
     * #1258 H1: the received coaching-diagnostic chain (`TELEMETRY_READBACK_COACHING_DIAGNOSTIC`), when the receipt asked for
     * it — with the exact release and binding it was computed for (PM RETURN 6115229273). A HOLD written when the readback
     * produced no result carries no binding; it can never settle the row.
     */
    coachingDiagnostic?: { verdict: 'PASS' | 'FAIL' | 'HOLD'; reasons: string[]; release?: string; expected?: Record<string, unknown> };
}
const RECEIVED_ROW = 'journey telemetry received';
/** The coaching rows whose EXTERNAL verdict explains a readback HOLD on the success chain (D1). */
const EXTERNAL_COACHING_PARENTS: ReadonlySet<string> = new Set(['coaching rendered', 'Focus coaching rendered']);
const FEEDBACK_CHAIN_ROW = 'feedback diagnostic chain';
/** The row's sent-boundary binding, in the evaluator's expectation shape (compared field by field, exactly). */
const rowBinding = (row: ReceiptRow): Record<string, unknown> | null => {
    const e = row.evidence ?? {};
    return typeof e.expectedRequestSha256 === 'string'
        ? { requestSha256: e.expectedRequestSha256, attemptSha256: e.expectedAttemptSha256, product: e.expectedProduct,
            configuredModel: e.expectedConfiguredModel, outcome: e.expectedOutcome }
        : null;
};
const EXPECTATION_KEYS = ['requestSha256', 'attemptSha256', 'product', 'configuredModel', 'outcome'];
const sameBinding = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | null): boolean =>
    !!a && !!b && typeof a === 'object' && Object.keys(a).sort().join() === [...EXPECTATION_KEYS].sort().join()
    && EXPECTATION_KEYS.every((k) => typeof a[k] === 'string' && a[k] === b[k]);

/**
 * #1258 H1 (PM 6115110576) — RECEIVED EVIDENCE SETTLES THE FEEDBACK DIAGNOSTIC CHAIN, AND ONLY IT.
 *
 * Eligible only when the in-run row is HOLD for exactly `telemetry_not_received` (the rest of the chain already held in
 * the browser and the database) and carries the sent-boundary digests the readback was bound to. Then the independent
 * received verdict replaces it: PASS → PASS, FAIL → FAIL, HOLD → HOLD. An in-run FAIL, a HOLD for any other reason, or a
 * row without the binding is never rewritten — generic journey qualification can never promote it.
 */
function settleFeedbackChain(row: ReceiptRow, received: ReadbackVerdicts['coachingDiagnostic']): ReceiptRow {
    if (row.step !== FEEDBACK_CHAIN_ROW || row.verdict !== 'HOLD' || !received) return row;
    if (row.evidence?.reasons !== 'telemetry_not_received' || !rowBinding(row)) return row;
    // Only a result computed for THIS row's exact binding settles it (validated in applyReadback); an unbound HOLD cannot.
    if (!sameBinding(received.expected, rowBinding(row))) return row;
    return {
        ...row,
        verdict: received.verdict,
        detail: received.verdict === 'PASS' ? 'received: the coaching diagnostic and the feedback link arrived for the exact sent request (settled at finalization)'
            : received.verdict === 'FAIL' ? 'received evidence contradicts the run\'s sent request (settled at finalization)'
                : 'the received coaching diagnostic chain is still incomplete',
        evidence: { ...row.evidence, receivedReasons: received.reasons.join(',') || 'none', settledByReadback: true },
    };
}

/**
 * #1258 (#1570, Codex r4201644107; CLI PM option 1a, 6029321428) — RECEIVED EVIDENCE SETTLES A BLIND "SENT" HOLD.
 *
 * A sent row HOLDs when its event may have left inside a Blob beacon the browser does not expose. It becomes PASS only
 * when `BLIND_HOLD_SETTLEMENT` maps the row's suite and step to the qualification stages that receive its events (the
 * receipt's `receivedByStages` must equal that entry; it never chooses the stages) and, for EVERY mapped stage,
 * at least one bound journey declares it and every journey declaring it QUALIFIED: received implies sent. Anything less —
 * an unnamed stage, a stage no journey declared, a journey that HOLD or FAILed — leaves the row exactly as written. Rows
 * whose events no stage receives (coaching outcomes, the exact generation count) carry no stages and so stay HOLD. Only
 * a HOLD caused by a blind beacon (`blindSinceStep > 0`) is eligible; a FAIL or PASS is never rewritten.
 */
function settleBlindHold(suite: string, row: ReceiptRow, journeys: readonly { stages: readonly string[]; verdict: string }[]): ReceiptRow {
    const blind = row.evidence?.blindSinceStep;
    if (row.verdict !== 'HOLD' || isHumanObservation(row) || typeof blind !== 'number' || blind <= 0) return row;
    // The stages come from the closed map, never from the receipt (validateReceipt already rejected any disagreement).
    const stages = settlementStagesFor(suite, row.step);
    if (!stages || row.evidence?.receivedByStages !== stages.join(',')) return row;
    const settled = stages.every((stage) => {
        const declaring = journeys.filter((j) => j.stages.includes(stage));
        return declaring.length > 0 && declaring.every((j) => j.verdict === 'QUALIFIED');
    });
    if (!settled) return row;
    return {
        ...row,
        verdict: 'PASS',
        detail: `received: every bound journey declaring ${stages.join(', ')} qualified in the PostHog readback, so the events the browser could not show did arrive (settled at finalization)`,
        evidence: { ...row.evidence, settledByReadback: true },
    };
}

function applyReadback(receipt: ReceiptForFinalization, readback: unknown, errors: string[]): ReceiptRow[] {
    const rb = readback as Partial<ReadbackVerdicts> | null;
    const bad = (why: string) => { errors.push(`readback verdicts ${why}`); return receipt.rows; };
    if (!rb || typeof rb !== 'object' || Array.isArray(rb)) return bad('is not a JSON object');
    if (rb.suite !== receipt.suite) return bad(`name suite ${String(rb.suite)}, not ${receipt.suite}`);
    if (rb.release !== receipt.release) return bad('are for a different release');
    if (!Array.isArray(rb.journeys) || !Array.isArray(rb.missingBindings)) return bad('lack journeys / missingBindings');
    const journeys = rb.journeys;
    const missing = rb.missingBindings;
    const key = (j: { journeyId?: unknown; stages?: unknown }) => `${String(j.journeyId)}=${Array.isArray(j.stages) ? [...j.stages].map(String).join(',') : '?'}`;
    const expected = (receipt.readback?.journeys ?? []).map(key).sort();
    const got = journeys.map(key).sort();
    if (JSON.stringify(expected) !== JSON.stringify(got)) return bad('do not match the receipt\'s bound journeys and stages');
    if (JSON.stringify([...missing].map(String).sort()) !== JSON.stringify([...(receipt.readback?.missingBindings ?? [])].sort())) {
        return bad('do not match the receipt\'s missing bindings');
    }
    if (journeys.some((j) => j.verdict !== 'QUALIFIED' && j.verdict !== 'HOLD' && j.verdict !== 'FAIL')) return bad('carry an unknown journey verdict');
    const coaching = rb.coachingDiagnostic;
    if (coaching !== undefined) {
        if (!coaching || typeof coaching !== 'object' || Array.isArray(coaching)
            || !Object.keys(coaching).every((k) => ['verdict', 'reasons', 'release', 'expected'].includes(k))
            || !coherentCoachingResult(coaching.verdict, coaching.reasons)) {
            return bad('carry a malformed or incoherent coaching diagnostic result');
        }
        const bound = coaching.release !== undefined || coaching.expected !== undefined;
        // A PASS or FAIL is evidence about a specific request, so it must name the release and binding it was computed for.
        if (coaching.verdict !== 'HOLD' && !bound) return bad('carry a coaching diagnostic verdict with no binding');
        if (bound) {
            const chainRow = receipt.rows.find((r) => r.step === FEEDBACK_CHAIN_ROW);
            if (coaching.release !== receipt.release) return bad('carry a coaching diagnostic result for a different release');
            if (!chainRow || !sameBinding(coaching.expected, rowBinding(chainRow))) {
                return bad('carry a coaching diagnostic result bound to a different request, attempt, product, model or outcome');
            }
        }
    }
    const failed = journeys.filter((j) => j.verdict === 'FAIL').length;
    const qualified = journeys.length > 0 && missing.length === 0 && journeys.every((j) => j.verdict === 'QUALIFIED');
    // D1 (PM 6171519534): the product completeness gate still requires a rendered review in the post-Stop chain, so a run
    // whose coaching was provably unavailable cannot qualify it. That HOLD is named, never relabelled received PASS or
    // EXTERNAL; an observed FAIL still dominates.
    const externalCoaching = receipt.rows.some((r) => r.verdict === 'EXTERNAL' && EXTERNAL_COACHING_PARENTS.has(r.step));
    return receipt.rows.map((r) => (r.step === FEEDBACK_CHAIN_ROW ? settleFeedbackChain(r, coaching) : r.step !== RECEIVED_ROW ? settleBlindHold(receipt.suite, r, journeys) : {
        ...r,
        verdict: failed > 0 ? 'FAIL' : qualified ? 'PASS' : 'HOLD',
        detail: failed > 0 ? 'the PostHog readback RECEIVED an observed failure for a bound journey (merged at finalization)'
            : qualified ? 'every bound journey qualified in the PostHog readback (merged at finalization)'
                : externalCoaching
                    ? 'the PostHog readback did not qualify every bound journey; the post-Stop success chain (review_rendered) cannot complete while the coaching provider was unavailable (EXTERNAL; product gate unchanged, D1)'
                    : 'the PostHog readback did not qualify every bound journey',
        evidence: { ...(r.evidence ?? {}), readbackJourneys: journeys.length, readbackQualified: journeys.filter((j) => j.verdict === 'QUALIFIED').length, readbackFailed: failed },
    }));
}

export function finalizeReceipt(raw: unknown, worksheet: ParsedWorksheet, readback?: unknown): FinalizationResult {
    const validated = validateReceipt(raw);
    if (!validated.receipt) {
        // Unusable receipt: nothing can be finalized from it — INCOMPLETE, never PASS.
        return { status: 'binding_error', finalAcceptance: 'INCOMPLETE', errors: validated.errors, rows: [], humanObservations: [], automatedRowsAllPass: false,
            external: [], successfulCoachingOutstanding: false };
    }
    const receipt = validated.receipt;
    const errors: string[] = [...validated.errors];
    const expectedJourneys = runJourneyIds({ journeys: receipt.readback?.journeys ?? [], reportedJourneyIds: receipt.readback?.reportedJourneyIds ?? [] }).sort();
    if (worksheet.suite !== receipt.suite) errors.push(`suite mismatch: worksheet ${String(worksheet.suite)} vs receipt ${receipt.suite}`);
    if (!receipt.release || worksheet.release !== receipt.release) errors.push(`deployed SHA mismatch: worksheet ${String(worksheet.release)} vs receipt ${receipt.release || '(unset)'}`);
    if (JSON.stringify([...worksheet.journeyIds].sort()) !== JSON.stringify(expectedJourneys)) errors.push('journey id mismatch between worksheet and receipt');
    if (worksheet.receipt !== `${receipt.suite}.receipt.json`) errors.push(`receipt name mismatch: worksheet names ${String(worksheet.receipt)}`);

    const expectedIds = receipt.rows.filter(isHumanObservation).map((r) => String(r.evidence!.observationId));
    const seen = new Map<string, { result: string; observer: string }>();
    for (const entry of worksheet.entries) {
        if (seen.has(entry.id)) errors.push(`observation listed twice: ${entry.id}`);
        seen.set(entry.id, entry);
    }
    for (const id of seen.keys()) if (!expectedIds.includes(id)) errors.push(`observation not in this receipt: ${id}`);
    for (const id of expectedIds) {
        const entry = seen.get(id);
        if (!entry) { errors.push(`observation missing from worksheet: ${id}`); continue; }
        const externalParent = externalParentOf(receipt.rows, id);
        if (entry.result === NOT_EXERCISED || entry.result === '') {
            // Only a coaching-quality check under its own proved EXTERNAL parent may be not exercised (blank allowed) —
            // and it is still SIGNED (Codex P2 r4275712673): an untouched prefilled row is not a reviewed one.
            if (!externalParent) errors.push(`observation ${id} has no PASS/FAIL result`);
            else if (entry.observer.trim() === '') errors.push(`observation ${id} ${NOT_EXERCISED} has no observer`);
            continue;
        }
        if (entry.result !== 'PASS' && entry.result !== 'FAIL') { errors.push(`observation ${id} has no PASS/FAIL result`); continue; }
        if (externalParent && entry.result === 'PASS') errors.push(`observation ${id} cannot PASS: its coaching was not exercised (external provider outage)`);
        if (entry.observer.trim() === '') errors.push(`observation ${id} ${entry.result} has no observer`);
    }

    const readbackRows = readback === undefined ? receipt.rows : applyReadback(receipt, readback, errors);
    if (errors.length > 0) {
        const a = receiptAcceptance(receipt.rows);
        // A FAIL already present in the automated rows stays a FAIL; otherwise the run is INCOMPLETE, never PASS.
        return { status: 'binding_error', finalAcceptance: a.acceptance === 'FAIL' ? 'FAIL' : 'INCOMPLETE', errors, rows: receipt.rows,
            humanObservations: a.humanObservations, automatedRowsAllPass: a.automatedRowsAllPass,
            external: a.external, successfulCoachingOutstanding: a.successfulCoachingOutstanding };
    }
    const rows = readbackRows.map((r) => {
        if (!isHumanObservation(r)) return r;
        const entry = seen.get(String(r.evidence!.observationId))!;
        if (entry.result === NOT_EXERCISED || entry.result === '') {
            return { ...r, verdict: 'EXTERNAL' as const, detail: 'not exercised: there was no coaching answer to judge (external provider outage)',
                evidence: { ...r.evidence!, recorded: 'not_exercised', observer: entry.observer } };
        }
        const verdict = entry.result as 'PASS' | 'FAIL';
        return { ...r, verdict, detail: `recorded by the human reviewer: ${verdict}`, evidence: { ...r.evidence!, recorded: verdict, observer: entry.observer } };
    });
    const a = receiptAcceptance(rows);
    return { status: 'final', finalAcceptance: a.acceptance, errors: [], rows, humanObservations: a.humanObservations, automatedRowsAllPass: a.automatedRowsAllPass,
        external: a.external, successfulCoachingOutstanding: a.successfulCoachingOutstanding };
}

/**
 * #1532 Codex P1 r4125567004 — WHAT A RECEIPT MAY PUBLISH. The receipt file, the worksheet and the `RWT_RECEIPT` log
 * line are public once the artifact uploads (the repository is public; GitHub masks only secret values, never emails or
 * coaching text, and never artifact contents). So the leak check runs over those three FINAL outputs, after every row
 * has been added, against every value the suite registered (plain and JSON-escaped). On any match nothing original is
 * emitted: only a minimal redacted failure receipt (suite, release, contamination, acceptance FAIL, leak COUNT) and no
 * worksheet; the caller then fails the test.
 */
export interface GuardedReceiptOutput {
    receiptText: string;
    worksheetText: string | null;
    logLine: string;
    leakCount: number;
}

export function guardReceiptOutput(args: {
    suite: string;
    release: string;
    body: unknown;
    worksheet: string;
    forbidden: Iterable<string | null | undefined>;
    testStatus: string | null;
}): GuardedReceiptOutput {
    const receiptText = `${JSON.stringify(args.body, null, 2)}\n`;
    const logLine = `RWT_RECEIPT ${JSON.stringify(args.body)}`;
    const needles = [...new Set([...args.forbidden].filter((v): v is string => typeof v === 'string' && v.length > 3))];
    const forms = (v: string) => [v, JSON.stringify(v).slice(1, -1)];
    const appearsIn = (text: string) => (v: string) => forms(v).some((f) => text.includes(f));
    const leaked = needles.filter((v) => [receiptText, args.worksheet, logLine].some((text) => appearsIn(text)(v)));
    if (leaked.length === 0) return { receiptText, worksheetText: args.worksheet, logLine, leakCount: 0 };

    let redacted: Record<string, unknown> = {
        suite: args.suite, release: args.release, contaminated: true, acceptance: 'FAIL', leakCount: leaked.length, testStatus: args.testStatus,
    };
    // Even the identifying fields are dropped if one of them is a registered value.
    if (needles.some(appearsIn(JSON.stringify(redacted)))) redacted = { contaminated: true, acceptance: 'FAIL', leakCount: leaked.length };
    return {
        receiptText: `${JSON.stringify(redacted, null, 2)}\n`,
        worksheetText: null,
        logLine: `RWT_RECEIPT ${JSON.stringify(redacted)}`,
        leakCount: leaked.length,
    };
}
