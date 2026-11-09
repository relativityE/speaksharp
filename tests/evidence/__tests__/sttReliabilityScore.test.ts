// @vitest-environment node
/**
 * Work point 2: controls for the frozen STT reliability scorer, required by the release review before any
 * scoring. Each control states the rule it pins.
 */
import { describe, expect, it } from 'vitest';
import {
    STT_RELIABILITY_SCORING, alignTokens, findRepetitionLoops, scoreReliabilityCorpus,
    type ClipOutcome, type PlannedClip,
} from '../sttReliabilityScore';
import { normalizeOfficialTrackA } from '../normalization/officialNormalizer';

const tok = (text: string) => normalizeOfficialTrackA(text);
const audio = (seed: string, sampleCount = 16_000) => ({ pcmSha256: seed.repeat(64).slice(0, 64), sampleRateHz: 16_000, sampleCount });
const speech = (id: string, reference: string, seed = 'a'): PlannedClip => ({ id, kind: 'speech', reference, audio: audio(seed) });
const saved = (clip: PlannedClip, transcript: string): ClipOutcome =>
    ({ status: 'saved', transcript, playedPcmSha256: clip.audio.pcmSha256, playedSampleCount: clip.audio.sampleCount });

describe('Q4 repetition-loop rule (frozen in STT_RELIABILITY_SCORING.loop)', () => {
    it('is the declared rule: n-grams 1–40, at least 2 excess repeats over the reference, at least 6 excess tokens', () => {
        expect(STT_RELIABILITY_SCORING.loop).toEqual({ minN: 1, maxN: 40, minExcessRepeats: 2, minExcessSpanTokens: 6 });
    });
    it('does not flag normal recognition errors (substitutions and deletions)', () => {
        expect(findRepetitionLoops(tok('the quick brown fox jumps over the lazy dog'), tok('the quick brown box jumped over lazy dog'))).toEqual([]);
    });
    it('does not flag a common short doubled phrase', () => {
        expect(findRepetitionLoops(tok('well you know it was fine'), tok('well you know you know it was fine'))).toEqual([]);
    });
    it('does not flag legitimate repeated speech the reference also contains', () => {
        const ref = tok('no no no no no no I said no and we went home home home home home');
        expect(findRepetitionLoops(ref, ref)).toEqual([]);
        expect(findRepetitionLoops(tok('very very very good'), tok('very very very good'))).toEqual([]);
    });
    it('flags a looped phrase the speaker did not repeat', () => {
        const loops = findRepetitionLoops(tok('thank you for listening'),
            tok('thank you for listening thank you for listening thank you for listening thank you for listening'));
        expect(loops.some(l => l.ngram === 'thank you for listening' && l.hypothesisRepeats === 4 && l.referenceRepeats === 1)).toBe(true);
    });
    it('flags a looped single word only when the excess span reaches 6 tokens', () => {
        expect(findRepetitionLoops(tok('okay'), tok('okay okay okay okay okay'))).toEqual([]);
        expect(findRepetitionLoops(tok('okay'), tok('okay okay okay okay okay okay okay')).map(l => l.ngram)).toContain('okay');
    });
    it('flags a loop that exceeds the repeats the reference legitimately contains', () => {
        const loops = findRepetitionLoops(tok('go go go'), tok('go go go go go go go go go go'));
        expect(loops.find(l => l.ngram === 'go')).toMatchObject({ hypothesisRepeats: 10, referenceRepeats: 3, excessSpanTokens: 7 });
    });
});

describe('alignment-based checks (Q2 opening, Q3 trailing, Q5 invented prefix)', () => {
    it('aligns with the same edit costs as werMetric', () => {
        expect(alignTokens(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual(['match', 'sub', 'match', 'ins']);
    });
    it('reports kept and lost boundary words and an invented prefix', () => {
        const clip = speech('c1', 'after early nightfall the yellow lamps would light up');
        const ok = scoreReliabilityCorpus([clip], { c1: saved(clip, 'after early nightfall the yellow lamps would light up') }).clips[0];
        expect(ok).toMatchObject({ openingWordKept: true, trailingWordKept: true, inventedPrefixTokens: 0, wer: 0 });
        const cut = scoreReliabilityCorpus([clip], { c1: saved(clip, 'thank you so early nightfall the yellow lamps would light') }).clips[0];
        expect(cut.openingWordKept).toBe(false);
        expect(cut.trailingWordKept).toBe(false);
        // "thank you so" for "after" is ambiguous (a substitution plus insertions), so it is not counted as an
        // invented prefix under the most favourable lowest-cost alignment. The lost opening word still fails the gate.
        expect(cut.inventedPrefixTokens).toBeLessThan(STT_RELIABILITY_SCORING.inventedPrefixMinTokens);
    });
    it('scores the saved transcript as saved: a loop raises WER through insertions, nothing is trimmed', () => {
        const clip = speech('c1', 'thank you for listening');
        const looped = 'thank you for listening thank you for listening thank you for listening';
        const row = scoreReliabilityCorpus([clip], { c1: saved(clip, looped) }).clips[0];
        expect(row.insertions).toBe(8);
        expect(row.wer).toBe(2);
        expect(row.loops.length).toBeGreaterThan(0);
    });
});

describe('frozen counting rules', () => {
    const a = speech('a', 'apple pear plum fig lime kiwi date peach grape melon', 'a');
    const b = speech('b', 'alpha beta gamma delta epsilon zeta eta theta iota kappa', 'b');
    const silence: PlannedClip = { id: 's', kind: 'silence', reference: '', audio: audio('c') };

    it('reports both pooled figures when every clip saved, pooled as Σ errors / Σ reference words', () => {
        const report = scoreReliabilityCorpus([a, b, silence], {
            a: saved(a, 'apple pear plum fig lime kiwi date peach grape melon'),
            b: saved(b, 'alpha beta gamma delta epsilon zeta eta theta iota'),
            s: saved(silence, ''),
        });
        expect(report.inputInvalid).toBeNull();
        expect(report.strictPooledWer).toBeCloseTo(1 / 20);
        expect(report.diagnosticFailureInclusiveWer).toBeCloseTo(1 / 20);
        // b lost its last word, so the gate fails on Q3 even though pooled WER meets the target.
        expect(report.qualityGate).toEqual({ status: 'FAIL', reasons: ['b:trailing_word_lost'] });
        expect(report.clips.find(c => c.id === 's')).toMatchObject({ werEligible: false, silenceClean: true });
    });
    it('passes the gate only when every clip saved, meets Q2–Q6, and strict pooled WER is below the target', () => {
        const report = scoreReliabilityCorpus([a, b, silence], {
            a: saved(a, 'apple pear plum fig lime kiwi date peach grape melon'),
            b: saved(b, 'alpha beta gamma delta epsilon zeta eta theta iota kappa'),
            s: saved(silence, ''),
        });
        expect(report.qualityGate).toEqual({ status: 'PASS', reasons: [] });
    });
    it('a failed required clip makes strict WER unavailable and FAILS the gate; the failure-inclusive figure is diagnostic', () => {
        const report = scoreReliabilityCorpus([a, b], {
            a: saved(a, 'apple pear plum fig lime kiwi date peach grape melon'),
            b: { status: 'finalize_failed' },
        });
        expect(report.strictPooledWer).toBeNull();
        expect(report.qualityGate.status).toBe('FAIL');
        expect(report.qualityGate.reasons).toEqual(['b:finalize_failed', 'strict_pooled_wer_unavailable']);
        expect(report.diagnosticFailureInclusiveWer).toBeCloseTo(10 / 20);
        expect(report.reliability).toEqual({ saved: 1, failures: { finalize_failed: 1, save_failed: 0, not_run: 0, empty_transcript: 0 } });
        expect(report.clips.map(c => c.id)).toEqual(['a', 'b']);
    });
    it('counts empty output, a save failure and a missing outcome as named reliability failures', () => {
        const report = scoreReliabilityCorpus([a, b, speech('c', 'x y z', 'd')], { a: saved(a, '   '), b: { status: 'save_failed' } });
        expect(report.reliability.failures).toEqual({ finalize_failed: 0, save_failed: 1, not_run: 1, empty_transcript: 1 });
        expect(report.strictPooledWer).toBeNull();
        expect(report.diagnosticFailureInclusiveWer).toBe(1);
        expect(report.qualityGate.status).toBe('FAIL');
    });
    it('the failure-inclusive figure is NOT monotone, so it is never a gate input', () => {
        // A loops to WER 2.0. Adding a failed clip (counted as 100%) LOWERS the failure-inclusive figure.
        const loopy = saved(a, 'apple pear plum fig lime kiwi date peach grape melon '.repeat(3));
        const alone = scoreReliabilityCorpus([a], { a: loopy });
        const withFailure = scoreReliabilityCorpus([a, b], { a: loopy, b: { status: 'save_failed' } });
        expect(alone.diagnosticFailureInclusiveWer).toBe(2);
        expect(withFailure.diagnosticFailureInclusiveWer).toBe(1.5);
        expect(withFailure.qualityGate.status).toBe('FAIL');
        expect(alone.qualityGate.status).toBe('FAIL');
    });
    it('reports invented text on a silence clip, outside WER', () => {
        const report = scoreReliabilityCorpus([a, silence], { a: saved(a, 'apple pear plum fig lime kiwi date peach grape melon'), s: saved(silence, 'Thank you.') });
        expect(report.clips.find(c => c.id === 's')).toMatchObject({ silenceClean: false, werEligible: false });
        expect(report.strictPooledWer).toBe(0);
        expect(report.qualityGate.reasons).toEqual(['s:text_on_silence']);
    });
    it.each([
        ['an empty plan', [], {}, 'empty_plan'],
        ['a speech clip with no reference', [speech('a', '')], {}, 'missing_reference'],
        ['a silence clip carrying a reference', [{ ...silence, reference: 'hello' }], {}, 'reference_on_silence_clip'],
        ['an invalid audio binding', [{ ...a, audio: { pcmSha256: 'x', sampleRateHz: 16_000, sampleCount: 1 } }], {}, 'invalid_audio_binding'],
        ['a duplicate clip id', [a, { ...b, id: 'a' }], {}, 'duplicate_clip_id'],
        ['an outcome for an unplanned clip', [a], { z: saved(a, 'x') }, 'unplanned_outcome'],
        ['an unrecognised clip kind', [{ ...a, kind: 'Speech' }], {}, 'invalid_clip_kind'],
        ['a malformed outcome object', [a], { a: {} }, 'invalid_outcome'],
        ['an outcome with an unknown status', [a], { a: { status: 'timeout' } }, 'invalid_outcome'],
        ['a saved outcome with no transcript', [a], { a: { status: 'saved', playedPcmSha256: a.audio.pcmSha256, playedSampleCount: 16_000 } }, 'invalid_outcome'],
        ['played audio that is not the planned audio', [a], { a: { ...saved(a, 'apple'), playedSampleCount: 15_999 } }, 'played_audio_mismatch'],
    ] as const)('refuses %s with no numbers at all', (_label, plan, outcomes, reason) => {
        const report = scoreReliabilityCorpus(plan as unknown as PlannedClip[], outcomes as unknown as Record<string, ClipOutcome>);
        expect(report.inputInvalid?.reason).toBe(reason);
        expect(report.strictPooledWer).toBeNull();
        expect(report.diagnosticFailureInclusiveWer).toBeNull();
        expect(report.qualityGate.status).toBe('NOT_EVALUATED');
        expect(report.clips).toEqual([]);
    });
});

describe('filler-preserving checks: filler-stripped WER alone cannot show these', () => {
    const clip = speech('f', 'after early nightfall the yellow lamps would light up');
    const score = (text: string) => scoreReliabilityCorpus([clip], { f: saved(clip, text) });

    it('an invented filler prefix is invisible to Track A WER but caught by Q5', () => {
        const report = score('um uh after early nightfall the yellow lamps would light up');
        expect(report.clips[0].wer).toBe(0);
        expect(report.clips[0].inventedPrefixTokens).toBe(2);
        expect(report.qualityGate.reasons).toContain('f:invented_prefix');
    });
    it('a looped filler is invisible to Track A WER but caught by Q4', () => {
        const report = score('after early nightfall the yellow lamps would light up uh uh uh uh uh uh uh uh');
        expect(report.clips[0].wer).toBe(0);
        expect(report.clips[0].loops.map(l => l.ngram)).toContain('uh');
        expect(report.qualityGate.reasons).toContain('f:repetition_loop');
    });
    it('an opening or trailing filler the speaker DID say must be kept: invisible to Track A WER, caught by Q2/Q3', () => {
        const withFillers = speech('g', 'um so we start here and stop there uh');
        const report = scoreReliabilityCorpus([withFillers], { g: saved(withFillers, 'so we start here and stop there') });
        expect(report.clips[0].wer).toBe(0);
        expect(report.clips[0]).toMatchObject({ openingWordKept: false, trailingWordKept: false });
        expect(report.qualityGate.reasons).toEqual(['g:opening_word_lost', 'g:trailing_word_lost']);
    });
    it('a filler on a silence clip is text on silence', () => {
        const silence: PlannedClip = { id: 's', kind: 'silence', reference: '', audio: audio('c') };
        const report = scoreReliabilityCorpus([silence], { s: saved(silence, 'um') });
        expect(report.clips[0].silenceClean).toBe(false);
    });
});

describe('independent review of the first scorer draft', () => {
    it('sees a sentence-length loop (12 words repeated 5 times), which an 8-token limit could not', () => {
        const sentence = 'the quick brown fox jumps over the lazy dog near the river';
        const loops = findRepetitionLoops(tok(sentence), tok(Array(5).fill(sentence).join(' ')));
        expect(loops.some(l => l.n === 12 && l.hypothesisRepeats === 5)).toBe(true);
    });
    it('a doubled opening phrase is not an invented prefix, and a doubled opening word does not count as lost', () => {
        const doubled = speech('d', 'hello there my friends we begin');
        const r1 = scoreReliabilityCorpus([doubled], { d: saved(doubled, 'hello there hello there my friends we begin') });
        expect(r1.clips[0].inventedPrefixTokens).toBe(0);
        expect(r1.qualityGate.reasons).not.toContain('d:invented_prefix');
        const go = speech('g', 'go go we said');
        const r2 = scoreReliabilityCorpus([go], { g: saved(go, 'go we said') });
        expect(r2.clips[0].openingWordKept).toBe(true);
    });
    it('a real invented prefix is still caught', () => {
        const clip = speech('p', 'we begin the reading now');
        const r = scoreReliabilityCorpus([clip], { p: saved(clip, 'thank you we begin the reading now') });
        expect(r.clips[0].inventedPrefixTokens).toBe(2);
    });
});
