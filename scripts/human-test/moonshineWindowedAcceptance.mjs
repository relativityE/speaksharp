/**
 * A trailing partial window makes the real decoder non-byte-deterministic. Exact-string equality
 * therefore measures decoder determinism, not the accumulating cross-session state E2 is meant to
 * detect. This ceiling is deliberately narrow: one changed word in the pinned 38-word fixture is
 * 2.6%, while a repeated/compounded window is materially larger.
 */
export const MAX_REPEATABILITY_WORD_DRIFT = 0.05;

const words = (text) => text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function wordEdits(left, right) {
    const a = words(left);
    const b = words(right);
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const diagonal = previous;
            previous = row[j];
            row[j] = Math.min(
                row[j] + 1,
                row[j - 1] + 1,
                diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
    }
    return {
        edits: row[b.length],
        drift: row[b.length] / Math.max(1, a.length, b.length),
    };
}

export function evaluateMoonshineWindowedRepeatability(sessionA, sessionB, sessionC) {
    const sameInstance = wordEdits(sessionA, sessionB);
    const freshFromA = wordEdits(sessionA, sessionC);
    const freshFromB = wordEdits(sessionB, sessionC);
    // A and C are independent first sessions. B is the reused session under test, so it must not be
    // allowed to inflate its own baseline through B↔C divergence.
    const freshInstanceDrift = freshFromA.drift;
    const maximumPairwiseDrift = Math.max(sameInstance.drift, freshFromA.drift, freshFromB.drift);
    return {
        sameInstanceWordEdits: sameInstance.edits,
        sameInstanceDrift: sameInstance.drift,
        freshInstanceWordEdits: freshFromA.edits,
        freshInstanceDrift,
        maximumPairwiseDrift,
        ceiling: MAX_REPEATABILITY_WORD_DRIFT,
        // Reusing an engine may vary, but it must not vary MORE than a fresh engine already does.
        sameInstanceWithinFreshVariation: sameInstance.drift <= freshInstanceDrift,
        allRunsWithinCeiling: maximumPairwiseDrift <= MAX_REPEATABILITY_WORD_DRIFT,
    };
}
