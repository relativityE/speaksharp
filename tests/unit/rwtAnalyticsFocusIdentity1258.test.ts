// @vitest-environment node
/**
 * #1258 (Browser PM 6093772463 item 3) — the Focus Analytics row proves point-level detail from the CURRENT visible saved
 * review evidence, bound to saved point identity through CLI Dev's pinned `savedFocusIdentityVerdict`, never the stale
 * recording-rail / count check. The oracle itself is CLI Dev's and is tested in rwtSavedFocusIdentity1258.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { focusPointsEvidence } from '../../frontend/src/services/review/sessionEvidence';
import { focusIdentityObservation } from '../live/helpers/rwtOracles';
import { savedFocusIdentityVerdict } from '../live/helpers/rwtSavedFocusIdentity';
import manifest from '../fixtures/rwt/rwt-fixtures.manifest.json';

type Entry = { points: string[]; expectedFinal: string[]; speechSeconds: number };
const fixture = (key: string): Entry => {
    const find = (o: unknown): Entry | undefined => {
        if (!o || typeof o !== 'object') return undefined;
        const rec = o as Record<string, unknown>;
        if (rec[key]) return rec[key] as Entry;
        for (const v of Object.values(rec)) { const r = find(v); if (r) return r; }
        return undefined;
    };
    return find(manifest)!;
};
/** One take as the deployed product would save and show it, with the production evidence formatter. */
const take = (key: string, swap = false) => {
    const f = fixture(key);
    const verdictOf = (s: string) => (s === 'covered' || s === 'partial' ? 'detected' : 'not_detected');
    const savedPoints = f.points.map((label, i) => ({ id: `p${i}`, brief_id: 'brief-1', sort_order: i, label }));
    let verdicts = f.expectedFinal.map(verdictOf);
    // Swapped identity: two points with different outcomes trade saved verdicts (equal counts, wrong points).
    if (swap) {
        const a = verdicts.indexOf('detected');
        const b = verdicts.indexOf('not_detected');
        verdicts = verdicts.map((v, i) => (i === a ? 'not_detected' : i === b ? 'detected' : v));
    }
    const visibleEvidence = focusPointsEvidence(
        f.expectedFinal.map((s, i) => ({ label: f.points[i], status: verdictOf(s) as 'detected' | 'not_detected', detectedAtSeconds: verdictOf(s) === 'detected' ? 3 + i * 9 : null })),
        Math.round(f.speechSeconds),
    );
    return savedFocusIdentityVerdict(focusIdentityObservation({
        expectedBriefId: 'brief-1', savedBriefId: 'brief-1', labels: f.points, railStatuses: f.expectedFinal as never,
        savedPoints, evidence: savedPoints.map((p, i) => ({ brief_point_id: p.id, verdict: verdicts[i] })), visibleEvidence,
    }));
};

const helper = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
const row = helper.slice(helper.indexOf('#1258 (Browser PM 6093772463 item 3): point-level proof'), helper.lastIndexOf("receipt.row('analytics point detail'"));

describe('Focus Analytics point detail is bound to saved identity', () => {
    it('uses the pinned identity oracle on the visible saved-review evidence, never the old rail / count check', () => {
        expect(helper).toContain("import { savedFocusIdentityVerdict } from './rwtSavedFocusIdentity';");
        expect(row).toMatch(/savedFocusIdentityVerdict\(focusIdentityObservation\(\{/);
        expect(row).toMatch(/getByTestId\('review-evidence'\)/);
        expect(helper).not.toMatch(/\[data-testid\^="focus-point-"\]\[data-status="covered"\]/);
        expect(helper).not.toMatch(/shownCovered === detected/);
    });
    it('binds to the setup brief read before any take, and to the first take\'s rail in point order', () => {
        const setup = helper.slice(helper.indexOf("test.step('row 9"), helper.indexOf("await entitlementRow(receipt, entitlement, 120);"));
        expect(setup).toMatch(/from\('objective_brief'\)\.select\('id'\)\.eq\('user_id', owner\.uid\)/);
        expect(setup).toMatch(/expectedBriefId = /);
        expect(helper).toMatch(/firstTakeRail = final;/);
        expect(row).toMatch(/focusIdentityObservation\(\{\s*expectedBriefId, savedBriefId: [^,]+, labels: points, railStatuses: firstTakeRail,/);
    });
    // Browser PM 6096833549: exercise both real fixtures and the swapped-identity negative control through the wiring.
    it('full fixture (all points covered) and partial fixture (some not detected) PASS with the production evidence text', () => {
        expect([take('focus_points_tts').verdict, take('focus_points_partial_tts').verdict]).toEqual(['PASS', 'PASS']);
    });
    it('CASUALTY: swapped saved verdicts (equal counts, wrong points) FAIL and name the ordinals', () => {
        const swapped = take('focus_points_partial_tts', true);
        expect([swapped.verdict, swapped.mismatchedOrdinals.length >= 2]).toEqual(['FAIL', true]);
    });
    it('CASUALTY: a take saved under a different brief than the setup created FAILS', () => {
        const f = fixture('focus_points_tts');
        const r = savedFocusIdentityVerdict(focusIdentityObservation({
            expectedBriefId: 'brief-setup', savedBriefId: 'brief-other', labels: f.points, railStatuses: f.expectedFinal as never,
            savedPoints: f.points.map((label, i) => ({ id: `p${i}`, brief_id: 'brief-other', sort_order: i, label })),
            evidence: f.points.map((_, i) => ({ brief_point_id: `p${i}`, verdict: 'detected' })), visibleEvidence: ['Detected: point 1, point 2, point 3, point 4.'],
        }));
        expect(r.verdict).toBe('FAIL');
    });
    it('every saved read fails closed; no saved coaching (no visible evidence) is a HOLD, never PASS', () => {
        const reads = row.match(/admin!\.from\(/g)?.length ?? 0;
        expect([reads, row.match(/\(fail closed\)/g)?.length ?? 0]).toEqual([3, 3]);
        expect(row).toMatch(/if \(!savedCoaching\) \{\s*receipt\.row\('analytics point detail', 'HOLD'/);
    });
});
