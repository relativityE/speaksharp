/**
 * #1258 saved Focus identity oracle.
 * Bind the rail's ordered labels/statuses to the saved brief points, evidence rows, and the visible Analytics ordinals.
 * Pure and content-free: callers keep labels and IDs local; diagnostics return only affected ordinal numbers.
 */
export type FocusRailStatus = 'pending' | 'partial' | 'covered' | 'missing' | 'unavailable' | null;
export type SavedEvidenceVerdict = 'detected' | 'not_detected' | 'unavailable' | 'pending' | string;
export type VisibleEvidenceStatus = 'detected' | 'not_detected' | 'unavailable';

export interface ExpectedFocusPoint {
    label: string;
    railStatus: FocusRailStatus;
}

export interface SavedFocusPointIdentity {
    id: string;
    brief_id: string;
    sort_order: number;
    label: string;
}

export interface SavedFocusEvidenceRow {
    brief_point_id: string;
    verdict: SavedEvidenceVerdict;
}

export interface SavedFocusIdentityObservation {
    expectedBriefId: string;
    savedBriefId: string;
    expected: readonly ExpectedFocusPoint[];
    savedPoints: readonly SavedFocusPointIdentity[];
    evidence: readonly SavedFocusEvidenceRow[];
    visibleEvidence: readonly string[];
}

export interface SavedFocusIdentityResult {
    verdict: 'PASS' | 'FAIL';
    mismatchedOrdinals: number[];
    errors: string[];
}

export interface ParsedVisibleFocusEvidence {
    points: ReadonlyMap<number, VisibleEvidenceStatus>;
    errors: string[];
}

const expectedVerdict = (status: FocusRailStatus): 'detected' | 'not_detected' | null =>
    status === 'covered' || status === 'partial' ? 'detected' : status === 'missing' ? 'not_detected' : null;

/**
 * Parse the existing `focusPointsEvidence` text, e.g. "Detected: point 1 at 0:21, point 2."
 * Duplicate, missing-shape, unknown, malformed, and out-of-range ordinals are left for the caller to reject.
 */
export function parseVisibleFocusEvidence(lines: readonly string[]): ParsedVisibleFocusEvidence {
    const points = new Map<number, VisibleEvidenceStatus>();
    const errors: string[] = [];
    let pointLines = 0;
    let durationLines = 0;
    const normalizedLines = lines.flatMap((line) => line.split(/\r?\n/)).map((line) => line.trim()).filter(Boolean);

    for (const line of normalizedLines) {
        if (/^From this session$/i.test(line)) continue;
        if (/^Recorded for \d+:\d{2}\.$/.test(line)) {
            const duration = /^Recorded for (\d+):(\d{2})\.$/.exec(line);
            if (!duration || Number(duration[2]) > 59 || durationLines > 0) errors.push('malformed or duplicate duration line');
            durationLines += 1;
            continue;
        }
        const group = /^(Detected|Not detected|Not checked): (.+)\.$/i.exec(line);
        if (!group) {
            errors.push('unrecognized visible evidence line');
            continue;
        }
        pointLines += 1;
        const label = group[1].toLowerCase();
        const status: VisibleEvidenceStatus = label === 'detected' ? 'detected' : label === 'not detected' ? 'not_detected' : 'unavailable';
        const tokens = group[2].split(', ');
        if (tokens.length === 0 || tokens.some((token) => token.trim() === '')) {
            errors.push('malformed point list');
            continue;
        }
        for (const token of tokens) {
            const match = /^point ([1-9]\d*)(?: at (\d+):(\d{2}))?$/.exec(token);
            if (!match) {
                errors.push('malformed visible point ordinal');
                continue;
            }
            if (status !== 'detected' && match[2] !== undefined) errors.push('non-detected point carries a detection time');
            if (match[2] !== undefined && Number(match[3]) > 59) errors.push('malformed detection time');
            const ordinal = Number(match[1]);
            if (points.has(ordinal)) errors.push(`duplicate visible ordinal ${ordinal}`);
            else points.set(ordinal, status);
        }
    }
    if (pointLines === 0) errors.push('no visible point evidence');
    return { points, errors };
}

/**
 * Strictly compare one saved Focus take against the exact in-memory rail observation and visible saved-review ordinals.
 * `sort_order` is zero-based. Covered/partial both persist as `detected`; missing persists as `not_detected`.
 */
export function savedFocusIdentityVerdict(input: SavedFocusIdentityObservation): SavedFocusIdentityResult {
    const errors: string[] = [];
    const mismatched = new Set<number>();
    const failAt = (ordinal: number, reason: string) => {
        mismatched.add(ordinal + 1);
        errors.push(`${reason} at point ${ordinal + 1}`);
    };
    const expectedCount = input.expected.length;
    if (!input.expectedBriefId || input.savedBriefId !== input.expectedBriefId) errors.push('saved brief identity mismatch');
    if (expectedCount === 0) errors.push('no expected Focus points');
    if (input.savedPoints.length !== expectedCount) errors.push('saved point count mismatch');

    const ordered = [...input.savedPoints].sort((a, b) => a.sort_order - b.sort_order);
    const ids = new Set<string>();
    ordered.forEach((point, index) => {
        if (!point.id || ids.has(point.id)) failAt(index, 'missing or duplicate saved point id');
        ids.add(point.id);
        if (point.brief_id !== input.expectedBriefId) failAt(index, 'point belongs to another brief');
        if (!Number.isInteger(point.sort_order) || point.sort_order !== index) failAt(index, 'saved point order is not contiguous');
        if (point.label !== input.expected[index]?.label) failAt(index, 'saved point label/order differs from expected');
    });

    const pointIndex = new Map(ordered.map((point, index) => [point.id, index] as const));
    const evidenceById = new Map<string, SavedFocusEvidenceRow[]>();
    for (const row of input.evidence) {
        const index = pointIndex.get(row.brief_point_id);
        if (index === undefined) {
            errors.push('evidence references an out-of-brief point');
            continue;
        }
        const rows = evidenceById.get(row.brief_point_id) ?? [];
        rows.push(row);
        evidenceById.set(row.brief_point_id, rows);
    }
    for (let index = 0; index < expectedCount; index += 1) {
        const point = ordered[index];
        const rows = evidenceById.get(point?.id ?? '') ?? [];
        const wanted = expectedVerdict(input.expected[index]?.railStatus ?? null);
        if (wanted === null) {
            failAt(index, 'rail status is pending or unavailable');
            continue;
        }
        if (rows.length !== 1) {
            failAt(index, rows.length === 0 ? 'missing saved verdict' : 'duplicate saved verdict');
            continue;
        }
        if (rows[0].verdict !== wanted) failAt(index, 'saved verdict differs from rail status');
    }
    if (input.evidence.length === 0) errors.push('no saved evidence rows');

    const visible = parseVisibleFocusEvidence(input.visibleEvidence);
    errors.push(...visible.errors);
    for (let index = 0; index < expectedCount; index += 1) {
        const ordinal = index + 1;
        const want = expectedVerdict(input.expected[index]?.railStatus ?? null);
        const shown = visible.points.get(ordinal);
        if (want === null) {
            failAt(index, 'rail status is pending or unavailable');
        } else if (shown === undefined) {
            failAt(index, 'visible evidence ordinal is missing');
        } else if (shown === 'unavailable' || shown !== want) {
            failAt(index, 'visible evidence verdict differs from rail status');
        }
    }
    for (const ordinal of visible.points.keys()) {
        if (ordinal > expectedCount) errors.push(`out-of-range visible ordinal ${ordinal}`);
    }
    return { verdict: errors.length === 0 ? 'PASS' : 'FAIL', mismatchedOrdinals: [...mismatched].sort((a, b) => a - b), errors };
}
