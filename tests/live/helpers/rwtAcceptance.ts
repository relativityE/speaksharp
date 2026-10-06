/**
 * RWT acceptance (PO 2026-09-25) — pure, dependency-free, shared by the live suites (which WRITE the receipt and the
 * human-check worksheet) and `scripts/rwt-finalize-receipt.mts` (which CONSUMES the completed worksheet after the run).
 *
 * A finished receipt cannot change itself. Its `acceptance` is INCOMPLETE while any named human observation is
 * pending; the ONLY way to a final PASS/FAIL is `finalizeReceipt`, which binds the completed worksheet to the same
 * suite, deployed SHA, journey ids and observation set, requires a PASS/FAIL and an observer for every observation,
 * and recomputes acceptance over ALL rows. Content-free throughout: ids, verdicts, SHAs and observer names only.
 */

/** #1532 Codex P1 r4119969323 — one journey and the qualification stages IT exercised. */
/** `firstDownload`: this binding carries the run's first actual model download, so its readback requires the cold-download receipt. */
/** `attemptIds`: the recording attempts this binding must show exactly one start and one save for (judged per attempt). */
export interface ReadbackBinding { journeyId: string; stages: string[]; firstDownload?: boolean; attemptIds?: string[] }

/** Every canary journey the run observed — bound (qualified) or reported only. Worksheet and finalizer bind to this set. */
export function runJourneyIds(plan: { journeys: readonly ReadbackBinding[]; reportedJourneyIds: readonly string[] }): string[] {
    return [...new Set([...plan.journeys.map((j) => j.journeyId), ...plan.reportedJourneyIds])];
}

/**
 * `HUMAN`: a named human RWT observation — a runbook check no automation can judge. Never a permanent HOLD: it names
 * the question and pass criterion, and becomes PASS/FAIL only through the finalization step.
 */
export type Verdict = 'PASS' | 'FAIL' | 'HOLD' | 'HUMAN';
export interface ReceiptRow { step: string; verdict: Verdict; detail: string; evidence?: Record<string, string | number | boolean | null> }
export type Acceptance = 'PASS' | 'FAIL' | 'INCOMPLETE';

export interface HumanObservationState { id: string; runbookRow: string; result: 'pending' | 'PASS' | 'FAIL' }

const isHumanObservation = (r: ReceiptRow): boolean => Boolean(r.evidence && typeof r.evidence.observationId === 'string');

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
} {
    const gating = rows.filter((r) => !exempt(r));
    return {
        acceptance: gating.some((r) => r.verdict === 'FAIL') ? 'FAIL'
            : gating.some((r) => r.verdict === 'HOLD' || r.verdict === 'HUMAN') ? 'INCOMPLETE' : 'PASS',
        // #1532 Codex P2 r4126745144: every GATING automated row must be PASS; a gating HOLD is not "all pass". Rows in
        // NON_GATING_ROWS are already excluded from `gating`, and human observations are never automated.
        automatedRowsAllPass: gating.filter((r) => !isHumanObservation(r)).every((r) => r.verdict === 'PASS'),
        nonGating: rows.filter(exempt).map((r) => ({ step: r.step, verdict: r.verdict, reason: NON_GATING_ROWS[r.step] })),
        humanObservations: rows.filter(isHumanObservation).map((r) => ({
            id: String(r.evidence!.observationId),
            runbookRow: String(r.evidence!.runbookRow ?? ''),
            result: r.verdict === 'PASS' || r.verdict === 'FAIL' ? r.verdict : 'pending',
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
        '',
        '| Observation id | Runbook row | Question | Observation needed to decide (pass criterion) | Result (PASS/FAIL) | Observer · date |',
        '|---|---|---|---|---|---|',
        ...human.map((r) => `| \`${cell(r.evidence!.observationId)}\` | ${cell(r.evidence!.runbookRow)} | ${cell(r.step.replace(/^human: /, ''))} | ${cell(r.evidence!.passCriterion)} | ${r.verdict === 'HUMAN' ? '' : r.verdict} |  |`),
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

const VERDICTS: ReadonlySet<string> = new Set(['PASS', 'FAIL', 'HOLD', 'HUMAN']);

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
    'filler display matches saved (all words)', 'coachable filler headline', 'Products menu opened in the session',
    'Analytics action', 'analytics session detail', 'reopen after reload', 'analytics detail shows both AI suggestions',
    'saved review is the first block', '"From this session" evidence', 'one practice action', 'session PDF',
    'Analytics generates no coaching', 'feedback', 'Progress evaluation', 'Progress debt',
    'Analytics Practice again opens the product', 'review Practice again starts, no hold', 'repeated take stopped, microphone off',
    'saved product marker', 'next Start', 'next take stopped, microphone off', 'telemetry sent', 'coaching telemetry sent',
    'inventory events sent', 'revisit is not a generation', 'model download vs setup timing', 'feedback retention',
    'Practice again press → arrival (sent)', 'feedback outcome (sent)',
]);
const FOCUS_PRODUCT_ROWS = Object.freeze([
    'base_q4 primary', 'session bears canary claim', 'Products → Focus Points', 'no mic on navigation', 'new-account entitlement',
    'pace guide', 'Head to session', 'rail legend', 'pending points labelled', 'rail before speaking', 'model identity',
    'live marker changes', 'next point marked', 'marker timing vs audio', 'no red before Stop', 'session saved',
    'final point verdicts', 'not-detected explained', 'coverage count', 'average per point', 'final rail colours and words',
    'persisted verdicts', 'Focus coaching rendered', 'Focus coaching request marked focus_points', 'Focus coaching length',
    'Focus coaching distinct', 'Focus coaching makes no omission claim', 'Focus coaching provenance',
    'Focus coaching visible = saved', 'Focus coaching server receipt', 'Products menu opened in the session',
    'Analytics action', 'analytics session detail', 'reopen after reload', 'analytics detail shows both AI suggestions',
    'saved review is the first block', '"From this session" evidence', 'one practice action', 'Analytics generates no coaching',
    'analytics point detail', 'Analytics Practice again opens the product', 'review Practice again starts, no hold',
    'repeated take stopped, microphone off', 'saved product marker', 'next Start', 'next take stopped, microphone off',
    'coverage_evaluation sent', 'Focus coaching telemetry sent', 'revisit is not a generation', 'inventory events sent',
    'model download vs setup timing',
]);
const FOCUS_FULL_ONLY_PRODUCT_ROWS = Object.freeze(['feedback', 'feedback retention']);
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
        default:
            return null;
    }
}

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
    // The suite writes `journey telemetry received` only as HOLD; the readback merge is the ONLY path to PASS/FAIL. A
    // receipt that arrives with it already settled would finalize PASS with no readback at all.
    const received = receipt.rows.find((row) => row.step === 'journey telemetry received' && !isHumanObservation(row));
    if (received && automated.required.includes(received.step) && received.verdict !== 'HOLD') {
        errors.push(`"journey telemetry received" arrived as ${received.verdict}; only the readback merge may settle it`);
    }
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
}
const RECEIVED_ROW = 'journey telemetry received';

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
    const failed = journeys.filter((j) => j.verdict === 'FAIL').length;
    const qualified = journeys.length > 0 && missing.length === 0 && journeys.every((j) => j.verdict === 'QUALIFIED');
    return receipt.rows.map((r) => (r.step !== RECEIVED_ROW ? r : {
        ...r,
        verdict: failed > 0 ? 'FAIL' : qualified ? 'PASS' : 'HOLD',
        detail: failed > 0 ? 'the PostHog readback RECEIVED an observed failure for a bound journey (merged at finalization)'
            : qualified ? 'every bound journey qualified in the PostHog readback (merged at finalization)'
                : 'the PostHog readback did not qualify every bound journey',
        evidence: { ...(r.evidence ?? {}), readbackJourneys: journeys.length, readbackQualified: journeys.filter((j) => j.verdict === 'QUALIFIED').length, readbackFailed: failed },
    }));
}

export function finalizeReceipt(raw: unknown, worksheet: ParsedWorksheet, readback?: unknown): FinalizationResult {
    const validated = validateReceipt(raw);
    if (!validated.receipt) {
        // Unusable receipt: nothing can be finalized from it — INCOMPLETE, never PASS.
        return { status: 'binding_error', finalAcceptance: 'INCOMPLETE', errors: validated.errors, rows: [], humanObservations: [], automatedRowsAllPass: false };
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
        if (entry.result !== 'PASS' && entry.result !== 'FAIL') errors.push(`observation ${id} has no PASS/FAIL result`);
        if ((entry.result === 'PASS' || entry.result === 'FAIL') && entry.observer.trim() === '') errors.push(`observation ${id} ${entry.result} has no observer`);
    }

    const readbackRows = readback === undefined ? receipt.rows : applyReadback(receipt, readback, errors);
    if (errors.length > 0) {
        const a = receiptAcceptance(receipt.rows);
        // A FAIL already present in the automated rows stays a FAIL; otherwise the run is INCOMPLETE, never PASS.
        return { status: 'binding_error', finalAcceptance: a.acceptance === 'FAIL' ? 'FAIL' : 'INCOMPLETE', errors, rows: receipt.rows,
            humanObservations: a.humanObservations, automatedRowsAllPass: a.automatedRowsAllPass };
    }
    const rows = readbackRows.map((r) => {
        if (!isHumanObservation(r)) return r;
        const entry = seen.get(String(r.evidence!.observationId))!;
        const verdict = entry.result as 'PASS' | 'FAIL';
        return { ...r, verdict, detail: `recorded by the human reviewer: ${verdict}`, evidence: { ...r.evidence!, recorded: verdict, observer: entry.observer } };
    });
    const a = receiptAcceptance(rows);
    return { status: 'final', finalAcceptance: a.acceptance, errors: [], rows, humanObservations: a.humanObservations, automatedRowsAllPass: a.automatedRowsAllPass };
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
