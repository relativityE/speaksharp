// @vitest-environment node
/**
 * #1427 — the U3 eligible fixture must satisfy the PRODUCTION completeness gate.
 *
 * The U3 evidence matrix was red because `hasCompleteEligibleProgressEvidence` requires an integer
 * `errorMarkerCount >= 0` and the fixture had no `error_marker_count`. `toEvaluation()` produced
 * `undefined`, the gate refused the row, and the journey resolved `unavailable` long before reaching
 * the progress-direction and next-action assertions it exists to make.
 *
 * The E2E shard could only report that the journey ended `unavailable`; it could not say why, and it
 * cost a full CI cycle to find out. This runs the real predicate over the real fixture in
 * milliseconds, so the next time the gate gains a required field the fixture fails here first.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { hasCompleteEligibleProgressEvidence } from '@/services/progress/buildProgressEvaluation';
import { eligibleProgressTruth, eligibleRepeatProgress } from '../e2e/helpers/progressFixtures';

/** Mirrors `toEvaluation()` in loadSessionProgress.ts — the readback mapping the gate is applied to. */
const toEvaluation = (row: {
    eligible: boolean; word_count: number; clarity_raw: number;
    filler_count: number; error_marker_count?: number; wpm: number;
}) => ({
    eligible: row.eligible,
    wordCount: row.word_count,
    clarityRaw: row.clarity_raw,
    fillerCount: row.filler_count,
    errorMarkerCount: row.error_marker_count,
    wpm: row.wpm,
});

const FIXTURE = eligibleProgressTruth('session-4', 'session-3');
const PRACTICE_FIXTURE = eligibleRepeatProgress('practice-2', 'practice-1');

function incompleteEligibleObjectLines(text: string, file: string): string[] {
    const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const missing: string[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isObjectLiteralExpression(node)) {
            const eligible = node.properties.some((property) =>
                ts.isPropertyAssignment(property)
                && property.name.getText(source) === 'eligible'
                && property.initializer.kind === ts.SyntaxKind.TrueKeyword);
            const hasErrorMarker = node.properties.some((property) =>
                ts.isPropertyAssignment(property)
                && property.name.getText(source) === 'error_marker_count');
            if (eligible && !hasErrorMarker) {
                const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
                missing.push(`${file}:${line + 1}`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return missing;
}

describe('#1427 — the U3 eligible progress fixture passes the production completeness gate', () => {
    it('every evaluation row in each real E2E fixture is accepted', () => {
        for (const fixture of [FIXTURE, PRACTICE_FIXTURE]) {
            expect(fixture.evaluations.length).toBeGreaterThan(1);
            for (const row of fixture.evaluations) {
                expect(hasCompleteEligibleProgressEvidence(toEvaluation(row)), `row ${row.session_id} rejected`).toBe(true);
            }
        }
    });

    it('CASUALTY: dropping error_marker_count is exactly what made the journey unavailable', () => {
        for (const row of FIXTURE.evaluations) {
            const withoutField: Record<string, unknown> = { ...row };
            delete withoutField.error_marker_count;
            expect(
                hasCompleteEligibleProgressEvidence(toEvaluation(withoutField as unknown as typeof row)),
                `row ${row.session_id} must be REFUSED without error-marker evidence`,
            ).toBe(false);
        }
    });

    it.each([
        ['null', null],
        ['a non-integer', 1.5],
        ['a negative count', -1],
        ['a string', '0'],
    ])('CASUALTY: %s error-marker value is refused, not coerced', (_label, value) => {
        const row = { ...FIXTURE.evaluations[0], error_marker_count: value as unknown as number };
        expect(hasCompleteEligibleProgressEvidence(toEvaluation(row))).toBe(false);
    });

    it('the fixture declares the field literally, so the E2E payload really carries it', () => {
        // The gate could be satisfied by a default applied in the mapper rather than by the fixture.
        // Asserting the literal presence keeps the E2E payload honest about what the server returned.
        for (const row of FIXTURE.evaluations) {
            expect(Object.prototype.hasOwnProperty.call(row, 'error_marker_count')).toBe(true);
            expect(Number.isInteger(row.error_marker_count)).toBe(true);
        }
    });

    /**
     * The same omission was live in a SECOND spec, and only surfaced because its journey happened to
     * assert on a control that Progress renders. A fixture whose journey never reaches an
     * availability-dependent assertion would carry the defect indefinitely and silently.
     *
     * This scans the E2E tree structurally: any fixture object that claims `eligible: true` must also
     * carry `error_marker_count`. It is a wiring check, deliberately cheap, and it does not replace
     * the semantic assertions above.
     */
    it('every eligible progress object in the E2E tree carries its own error-marker evidence', async () => {
        const { readdirSync, statSync, readFileSync } = await import('node:fs');
        const { join } = await import('node:path');

        const files: string[] = [];
        const walk = (dir: string) => {
            let entries: string[];
            try { entries = readdirSync(dir); } catch { return; }
            for (const entry of entries) {
                const abs = join(dir, entry);
                let st;
                try { st = statSync(abs); } catch { continue; }
                if (st.isDirectory()) walk(abs);
                else if (/\.(ts|tsx)$/.test(entry)) files.push(abs);
            }
        };
        walk('tests/e2e');
        walk('tests/live');

        expect(files.length, 'the walk found no specs — it would pass trivially').toBeGreaterThan(5);

        const offenders = files.flatMap((file) => {
            const text = readFileSync(file, 'utf8');
            return incompleteEligibleObjectLines(text, file);
        });
        expect(offenders, `eligible progress fixtures missing error-marker evidence:\n${offenders.join('\n')}`)
            .toEqual([]);
    });

    it('CASUALTY: one complete object or a comment cannot mask an incomplete sibling object', () => {
        const source = `
                // error_marker_count in a comment is not evidence.
                const complete = { eligible: true, error_marker_count: 0 };
                const incomplete = { eligible: true, filler_count: 2 };
            `;
        expect(incompleteEligibleObjectLines(source, 'casualty.ts')).toEqual(['casualty.ts:4']);
    });
});
