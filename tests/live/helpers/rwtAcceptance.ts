/**
 * RWT acceptance (PO 2026-09-25) — pure, dependency-free, shared by the live suites (which WRITE the receipt and the
 * human-check worksheet) and `scripts/rwt-finalize-receipt.mts` (which CONSUMES the completed worksheet after the run).
 *
 * A finished receipt cannot change itself. Its `acceptance` is INCOMPLETE while any named human observation is
 * pending; the ONLY way to a final PASS/FAIL is `finalizeReceipt`, which binds the completed worksheet to the same
 * suite, deployed SHA, journey ids and observation set, requires a PASS/FAIL and an observer for every observation,
 * and recomputes acceptance over ALL rows. Content-free throughout: ids, verdicts, SHAs and observer names only.
 */

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
export function receiptAcceptance(rows: readonly ReceiptRow[]): {
    acceptance: Acceptance;
    automatedRowsAllPass: boolean;
    humanObservations: HumanObservationState[];
} {
    return {
        acceptance: rows.some((r) => r.verdict === 'FAIL') ? 'FAIL'
            : rows.some((r) => r.verdict === 'HOLD' || r.verdict === 'HUMAN') ? 'INCOMPLETE' : 'PASS',
        automatedRowsAllPass: rows.filter((r) => !isHumanObservation(r) && r.verdict !== 'HOLD').every((r) => r.verdict === 'PASS'),
        humanObservations: rows.filter(isHumanObservation).map((r) => ({
            id: String(r.evidence!.observationId),
            runbookRow: String(r.evidence!.runbookRow ?? ''),
            result: r.verdict === 'PASS' || r.verdict === 'FAIL' ? r.verdict : 'pending',
        })),
    };
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
    readback?: { journeyIds?: string[] };
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
export function finalizeReceipt(receipt: ReceiptForFinalization, worksheet: ParsedWorksheet): FinalizationResult {
    const errors: string[] = [];
    const expectedJourneys = [...(receipt.readback?.journeyIds ?? [])].sort();
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

    if (errors.length > 0) {
        const a = receiptAcceptance(receipt.rows);
        // A FAIL already present in the automated rows stays a FAIL; otherwise the run is INCOMPLETE, never PASS.
        return { status: 'binding_error', finalAcceptance: a.acceptance === 'FAIL' ? 'FAIL' : 'INCOMPLETE', errors, rows: receipt.rows,
            humanObservations: a.humanObservations, automatedRowsAllPass: a.automatedRowsAllPass };
    }
    const rows = receipt.rows.map((r) => {
        if (!isHumanObservation(r)) return r;
        const entry = seen.get(String(r.evidence!.observationId))!;
        const verdict = entry.result as 'PASS' | 'FAIL';
        return { ...r, verdict, detail: `recorded by the human reviewer: ${verdict}`, evidence: { ...r.evidence!, recorded: verdict, observer: entry.observer } };
    });
    const a = receiptAcceptance(rows);
    return { status: 'final', finalAcceptance: a.acceptance, errors: [], rows, humanObservations: a.humanObservations, automatedRowsAllPass: a.automatedRowsAllPass };
}
