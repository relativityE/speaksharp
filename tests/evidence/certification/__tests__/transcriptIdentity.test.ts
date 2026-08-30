import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { alignTokens, buildInsertionProfile, FILLER_LIKE_TOKENS } from '../insertionProfile';
import { normalizeOfficialTrackA, normalizeOfficialTrackB } from '../../normalization/officialNormalizer';

/**
 * #1304 — a transcript digest must be a digest OF TRANSCRIPTS.
 *
 * What shipped as `transcriptDigest` hashed `[id, S, D, I]` — an error profile. It could never have
 * detected the thing its name promised, and the artifact retained no hypothesis, so no question about
 * WHAT a model produced was answerable from evidence.
 */
const profileDigest = (rows: Array<{ id: string; substitutions: number; deletions: number; insertions: number }>) =>
    createHash('sha256').update(JSON.stringify(rows.map((u) => [u.id, u.substitutions, u.deletions, u.insertions]))).digest('hex').slice(0, 16);
const transcriptDigest = (rows: Array<{ id: string; normalizedHypothesis: string | null }>) =>
    createHash('sha256').update(JSON.stringify(rows.map((u) => [u.id, u.normalizedHypothesis]))).digest('hex').slice(0, 16);

describe('the two digests are two different facts', () => {
    // Same counts, completely different words — the collision the old name hid.
    const a = [{ id: 'u1', substitutions: 1, deletions: 0, insertions: 0, normalizedHypothesis: 'the cat sat' }];
    const b = [{ id: 'u1', substitutions: 1, deletions: 0, insertions: 0, normalizedHypothesis: 'a dog ran' }];

    it('CASUALTY: identical S/D/I with DIFFERENT hypotheses must not share transcript identity', () => {
        expect(profileDigest(a)).toBe(profileDigest(b));          // the old digest cannot tell them apart
        expect(transcriptDigest(a)).not.toBe(transcriptDigest(b)); // the real one must
    });

    it('POSITIVE CONTROL: identical transcripts share transcript identity', () => {
        expect(transcriptDigest(a)).toBe(transcriptDigest([{ ...a[0] }]));
    });

    it('the runner emits BOTH, and the legacy consumer reads the error profile under either name', () => {
        const runner = readFileSync(resolve(__dirname, '../../../../scripts/run-browser-matrix.mts'), 'utf8');
        expect(runner).toContain('scoreProfileDigest');
        expect(runner).toContain('u.normalizedHypothesis');
        const rec = readFileSync(resolve(__dirname, '../../../../scripts/reconcile-contaminated-arms.mts'), 'utf8');
        expect(rec).toContain('r.scoreProfileDigest ?? r.transcriptDigest');
    });
});

describe('inserted-token profile — WHICH words, not how many', () => {
    it('recovers the inserted tokens, not just a count', () => {
        const al = alignTokens(['the', 'cat', 'sat'], ['the', 'um', 'cat', 'sat', 'uh']);
        expect(al.insertions).toBe(2);
        expect(al.insertedTokens).toEqual(['um', 'uh']);
        expect(al.deletedTokens).toEqual([]);
    });

    it('MATCHED NEGATIVE: a clean transcript manufactures no fillers', () => {
        const clean = buildInsertionProfile([
            { id: 'u1', reference: ['the', 'cat', 'sat'], hypothesis: ['the', 'cat', 'sat'] },
        ]);
        expect(clean.totalInsertions).toBe(0);
        expect(clean.fillerLikeTotal).toBe(0);
        expect(clean.fillerLikeUtterances).toEqual([]);
    });

    it('CASUALTY: manufactured fillers ARE detected and attributed', () => {
        const dirty = buildInsertionProfile([
            { id: 'u1', reference: ['the', 'cat', 'sat'], hypothesis: ['the', 'um', 'cat', 'uh', 'sat'] },
            { id: 'u2', reference: ['a', 'dog'], hypothesis: ['a', 'dog'] },
        ]);
        expect(dirty.fillerLikeTotal).toBe(2);
        expect(dirty.fillerLikeInsertions.map((e) => e.token).sort()).toEqual(['uh', 'um']);
        expect(dirty.fillerLikeUtterances).toEqual(['u1']);   // attributed to the right clip
    });

    it('WHY Track B: Track A deletes the very tokens the question is about', () => {
        // This is the correction that matters. A Track-A insertion count cannot answer "does this model
        // invent fillers?" because the normalizer removes them from both sides first.
        const withFillers = 'the um cat uh sat';
        expect(normalizeOfficialTrackA(withFillers)).not.toContain('um');
        expect(normalizeOfficialTrackB(withFillers)).toContain('um');
        // So the same text yields a filler insertion under Track B and none under Track A.
        const trackA = buildInsertionProfile([{ id: 'u1', reference: normalizeOfficialTrackA('the cat sat'), hypothesis: normalizeOfficialTrackA(withFillers) }]);
        const trackB = buildInsertionProfile([{ id: 'u1', reference: normalizeOfficialTrackB('the cat sat'), hypothesis: normalizeOfficialTrackB(withFillers) }]);
        expect(trackA.fillerLikeTotal).toBe(0);
        expect(trackB.fillerLikeTotal).toBeGreaterThan(0);
    });

    it('the filler vocabulary covers the tokens Track A strips', () => {
        for (const t of ['um', 'uh', 'hmm', 'mm', 'mhm', 'mmm']) expect(FILLER_LIKE_TOKENS).toContain(t);
    });
});
