/**
 * Decision rules of the Focus Points meaning matcher, with a FAKE model. The fake answers by rule
 * (premise pattern + hypothesis pattern → entailment), so each test states exactly what the "model" believes and
 * the assertion is about what the RULES do with it.
 */
import { describe, expect, it } from 'vitest';
import {
    computeMeaningCoverage,
    ENTAIL_THRESHOLD,
    toHypothesis,
    WEAK_THRESHOLD,
    type NliFn,
} from '../meaningCoverage';
import { splitClaims } from '../meaningClaims';
import type { TalkingPointCoverage, TranscriptSegment } from '@/services/rehearsal/outcomeScorecard';

type Rule = { premise: RegExp; hypothesis?: RegExp; entail: number; contradict?: number };

function fakeNli(rules: Rule[], calls: Array<[string, string]> = []): NliFn {
    return async (premise, hypothesis) => {
        calls.push([premise, hypothesis]);
        const hit = rules.find((r) => r.premise.test(premise) && (!r.hypothesis || r.hypothesis.test(hypothesis)));
        return { entail: hit?.entail ?? 0.01, contradict: hit?.contradict ?? 0.01 };
    };
}

const seg = (startSec: number, text: string): TranscriptSegment => ({ startSec, text });

async function one(point: string, segments: TranscriptSegment[], rules: Rule[]): Promise<TalkingPointCoverage> {
    const [result] = await computeMeaningCoverage([point], segments, fakeNli(rules));
    return result;
}

/** Contract inherited from the keyword matcher: no result without a verbatim local quote + its segment time. */
function expectAttributed(result: TalkingPointCoverage, segments: TranscriptSegment[]): void {
    if (result.status === 'missing') {
        expect(result.evidence).toBeUndefined();
        return;
    }
    expect(result.evidence).toBeDefined();
    const { quote, timestampSec } = result.evidence!;
    expect(quote.length).toBeGreaterThan(0);
    // The quote is built only from whole transcript segments, in order.
    const texts = segments.map((s) => s.text.trim());
    const covered = texts.filter((t) => quote.includes(t));
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.join(' ')).toBe(quote);
    expect(segments.map((s) => s.startSec)).toContain(timestampSec);
}

describe('meaning matcher — hypotheses and claims', () => {
    it('reads an imperative claim as "We will …"', () => {
        expect(toHypothesis('Hire two engineers in March')).toBe('We will hire two engineers in March.');
        expect(toHypothesis('Customers want faster checkout.')).toBe('Customers want faster checkout.');
    });

    it('splits a two-part point into two claims', () => {
        expect(splitClaims('Keep the pilot under $50k and launch in June')).toEqual(['Keep the pilot under $50k', 'launch in June']);
    });

    it('uses the measured thresholds', () => {
        expect(ENTAIL_THRESHOLD).toBe(0.7);
        expect(WEAK_THRESHOLD).toBe(0.3);
    });
});

describe('meaning matcher — covered / partial / missing', () => {
    const POINT = 'Keep the pilot under $50k and launch in June';
    const rules: Rule[] = [
        { premise: /pilot under 50k/i, hypothesis: /pilot/i, entail: 0.92 },
        { premise: /launch in June/i, hypothesis: /launch in June/i, entail: 0.9 },
    ];

    it('COVERED when every claim is supported; landed = the moment the LAST claim is first supported', async () => {
        const segments = [
            seg(2, 'We will keep the pilot under 50k.'),
            seg(8, 'Thanks for the questions so far.'),
            seg(12, 'We launch in June.'),
            seg(20, 'Again, we launch in June.'),
        ];
        const r = await one(POINT, segments, rules);
        expect(r.status).toBe('covered');
        expect(r.evidence).toEqual({ quote: 'We launch in June.', timestampSec: 12 });
        expect(r.matchRatio).toBe(1);
        expectAttributed(r, segments);
    });

    it('takes the EARLIEST supporting window, not the strongest', async () => {
        const segments = [seg(3, 'We keep the pilot under 50k and launch in June.'), seg(30, 'We keep the pilot under 50k and launch in June!')];
        const r = await one(POINT, segments, [
            { premise: /June\.$/, entail: 0.75 },
            { premise: /June!$/, entail: 0.99 },
        ]);
        expect(r.status).toBe('covered');
        expect(r.evidence?.timestampSec).toBe(3);
    });

    it('PARTIAL when only some claims are supported; landed = the first supported claim', async () => {
        const segments = [seg(1, 'Hello everyone.'), seg(5, 'We will keep the pilot under 50k.')];
        const r = await one(POINT, segments, rules);
        expect(r.status).toBe('partial');
        expect(r.evidence).toEqual({ quote: 'We will keep the pilot under 50k.', timestampSec: 5 });
        expect(r.matchRatio).toBe(0.5);
        expectAttributed(r, segments);
    });

    it('PARTIAL when the best entailment is only WEAK (0.3 ≤ p < 0.7)', async () => {
        const segments = [seg(4, 'Customer onboarding is something we keep looking at.')];
        const r = await one('Onboarding keeps customers longer', segments, [{ premise: /onboarding/i, entail: 0.45 }]);
        expect(r.status).toBe('partial');
        expect(r.evidence?.timestampSec).toBe(4);
        expectAttributed(r, segments);
    });

    it('MISSING when nothing reaches the weak threshold', async () => {
        const segments = [seg(2, 'Thanks for joining.'), seg(6, 'Let us talk about hiring.')];
        const r = await one(POINT, segments, [{ premise: /hiring/i, entail: 0.29 }]);
        expect(r).toEqual({ point: POINT, status: 'missing', matchRatio: 0 });
    });

    it('credits a claim spread over two adjacent clauses, stamped where the second clause starts', async () => {
        const segments = [seg(3, 'We will hire two engineers.'), seg(9, 'That happens in March.')];
        const r = await one('Hire two engineers in March', segments, [
            { premise: /^We will hire two engineers\. That happens in March\.$/, entail: 0.88 },
        ]);
        expect(r.status).toBe('covered');
        expect(r.evidence).toEqual({ quote: 'We will hire two engineers. That happens in March.', timestampSec: 9 });
        expectAttributed(r, segments);
    });

    it('judges each clause of a contrast on its own ("…; we do not")', async () => {
        const calls: Array<[string, string]> = [];
        const segments = [seg(5, 'Other companies review security before every launch; we do not.')];
        const [r] = await computeMeaningCoverage(['We review security before every launch'], segments, fakeNli([
            { premise: /^Other companies review security before every launch$/, entail: 0.97 },
        ], calls));
        expect(calls.map(([p]) => p)).toContain('Other companies review security before every launch');
        expect(calls.map(([p]) => p)).toContain('we do not.');
        expect(r.status).toBe('missing');
    });

    it('preserves point order and scores every point', async () => {
        const segments = [seg(2, 'We launch in June.')];
        const results = await computeMeaningCoverage(['Launch in June', 'Hire two engineers'], segments, fakeNli([
            { premise: /launch in June/i, hypothesis: /launch in June/i, entail: 0.9 },
        ]));
        expect(results.map((r) => [r.point, r.status])).toEqual([['Launch in June', 'covered'], ['Hire two engineers', 'missing']]);
    });

    it('rejects when the model cannot answer (the caller owns the keyword fallback)', async () => {
        const failing: NliFn = async () => { throw new Error('MEANING_MODEL_NOT_READY'); };
        await expect(computeMeaningCoverage(['Launch in June'], [seg(1, 'We launch in June.')], failing)).rejects.toThrow('MEANING_MODEL_NOT_READY');
    });
});

describe('meaning matcher — negation and contradiction', () => {
    it('a negated statement the model reads as contradiction is not credited', async () => {
        const segments = [seg(4, 'We will not launch in June.')];
        const r = await one('Launch in June', segments, [{ premise: /not launch/i, entail: 0.02, contradict: 0.97 }]);
        expect(r.status).toBe('missing');
    });

    it('the deterministic veto overrides a model that wrongly entails a NEGATED quantity claim', async () => {
        const segments = [seg(4, 'We will not keep the pilot under 50k.')];
        const r = await one('Keep the pilot under $50k', segments, [{ premise: /pilot/i, entail: 0.95 }]);
        expect(r.status).toBe('missing');
    });
});

describe('meaning matcher — number / month guard', () => {
    const POINT = 'Retention reached 30% this quarter';
    const believesEverything: Rule[] = [{ premise: /retention/i, entail: 0.93 }];

    it('vetoes support when the spoken number contradicts the claim ("we hit 18%" vs 30%)', async () => {
        const r = await one(POINT, [seg(6, 'We hit 18% retention this quarter.')], believesEverything);
        expect(r.status).toBe('missing');
    });

    it('control: the same model answer with the RIGHT number is covered', async () => {
        const segments = [seg(6, 'We hit 30% retention this quarter.')];
        const r = await one(POINT, segments, believesEverything);
        expect(r.status).toBe('covered');
        expectAttributed(r, segments);
    });

    it('vetoes a different month', async () => {
        const r = await one('Launch in June', [seg(3, 'We launch in July.')], [{ premise: /launch/i, entail: 0.9 }]);
        expect(r.status).toBe('missing');
    });

    it('accepts a quantity inside the claimed bound ("$45k" supports "under $50k")', async () => {
        const segments = [seg(3, 'We will keep the pilot at $45k.')];
        const r = await one('Keep the pilot under $50k', segments, [{ premise: /pilot/i, entail: 0.9 }]);
        expect(r.status).toBe('covered');
    });
});

describe('meaning matcher — subject and attribution guards', () => {
    const believes: Rule[] = [{ premise: /./, entail: 0.95 }];

    it('first-person claim, but a third party leads the clause → no credit', async () => {
        expect((await one('We offer offline mode', [seg(5, 'A competitor already offers offline mode.')], believes)).status).toBe('missing');
    });

    it('control: the speaker says it → covered', async () => {
        const segments = [seg(5, 'We already offer offline mode.')];
        const r = await one('We offer offline mode', segments, believes);
        expect(r.status).toBe('covered');
        expectAttributed(r, segments);
    });

    it('group claim, but a different group leads the clause → no credit', async () => {
        expect((await one('Customers want faster checkout', [seg(2, 'Managers want faster checkout.')], believes)).status).toBe('missing');
    });

    it('control: users and customers are one audience → covered', async () => {
        expect((await one('Customers want faster checkout', [seg(2, 'Our users want faster checkout.')], believes)).status).toBe('covered');
    });

    it('a bare pronoun ("They …") earns at most partial, still with its quote', async () => {
        const segments = [seg(7, 'They want faster checkout.')];
        const r = await one('Customers want faster checkout', segments, believes);
        expect(r.status).toBe('partial');
        expect(r.evidence).toEqual({ quote: 'They want faster checkout.', timestampSec: 7 });
        expectAttributed(r, segments);
    });

    it('a reported view ("X says …") → no credit', async () => {
        expect((await one('We need weekly reports', [seg(3, 'Jordan says we need weekly reports.')], believes)).status).toBe('missing');
    });

    it('control: stated by the speaker → covered', async () => {
        expect((await one('We need weekly reports', [seg(3, 'We need weekly reports.')], believes)).status).toBe('covered');
    });
});

describe('meaning matcher — evidence contract across mixed transcripts', () => {
    it('every non-missing result carries a verbatim quote and a real segment start', async () => {
        const segments = [
            seg(0.5, 'Good morning.'),
            seg(4.25, 'We keep the pilot under 50k.'),
            seg(9, 'They want faster checkout.'),
            seg(15.75, 'We launch in June.'),
        ];
        const results = await computeMeaningCoverage(
            ['Keep the pilot under $50k and launch in June', 'Customers want faster checkout', 'Hire two engineers'],
            segments,
            fakeNli([
                { premise: /pilot under 50k/i, hypothesis: /pilot/i, entail: 0.9 },
                { premise: /launch in June/i, hypothesis: /launch in June/i, entail: 0.9 },
                { premise: /faster checkout/i, hypothesis: /checkout/i, entail: 0.9 },
            ]),
        );
        expect(results.map((r) => r.status)).toEqual(['covered', 'partial', 'missing']);
        results.forEach((r) => expectAttributed(r, segments));
    });

    it('ignores empty segments and an empty transcript yields missing', async () => {
        expect(await computeMeaningCoverage(['Launch in June'], [seg(1, '   ')], fakeNli([{ premise: /./, entail: 0.99 }])))
            .toEqual([{ point: 'Launch in June', status: 'missing', matchRatio: 0 }]);
    });
});

describe('subject and attribution guards follow each claim (Codex P2s on #1995)', () => {
    it('a point with claims about two different groups is covered when both are said, each by its own group', async () => {
        const point = 'Customers want faster checkout and managers need weekly reports';
        expect(splitClaims(point).length).toBe(2);
        const segments = [seg(3, 'Customers want faster checkout.'), seg(9, 'Managers need weekly reports.')];
        const result = await one(point, segments, [
            { premise: /^Customers want faster checkout/i, hypothesis: /checkout/i, entail: 0.95 },
            { premise: /^Managers need weekly reports/i, hypothesis: /weekly reports/i, entail: 0.95 },
        ]);
        expect(result.status).toBe('covered');
        expectAttributed(result, segments);
    });

    it('CONTROL: a claim about one group credited by a DIFFERENT group is still vetoed', async () => {
        const point = 'Customers want faster checkout and managers need weekly reports';
        const segments = [seg(3, 'Customers want faster checkout.'), seg(9, 'Customers need weekly reports.')];
        const result = await one(point, segments, [
            { premise: /^Customers want faster checkout/i, hypothesis: /checkout/i, entail: 0.95 },
            { premise: /^Customers need weekly reports/i, hypothesis: /weekly reports/i, entail: 0.95 },
        ]);
        expect(result.status).not.toBe('covered');
    });

    it('a point that itself asks for a reported view is covered by that report', async () => {
        const point = 'Customers say checkout is too slow';
        const segments = [seg(4, 'Customers say checkout is too slow.')];
        const result = await one(point, segments, [{ premise: /checkout is too slow/i, hypothesis: /checkout is too slow/i, entail: 0.97 }]);
        expect(result.status).toBe('covered');
        expectAttributed(result, segments);
    });

    it('CONTROL: a reported view still never substitutes for a direct claim, and a report by another party never covers a group report', async () => {
        const direct = await one('Checkout is too slow', [seg(4, 'A competitor claims checkout is too slow.')],
            [{ premise: /checkout is too slow/i, hypothesis: /checkout is too slow/i, entail: 0.97 }]);
        expect(direct.status).toBe('missing');
        const otherParty = await one('Customers say checkout is too slow', [seg(4, 'Managers say checkout is too slow.')],
            [{ premise: /checkout is too slow/i, hypothesis: /checkout is too slow/i, entail: 0.97 }]);
        expect(otherParty.status).toBe('missing');
    });
});

describe('guards choose among candidate windows; named third parties (Codex P2s on #1995, round 2)', () => {
    it('an earlier reported statement does not hide a later direct assertion of the same claim', async () => {
        const segments = [seg(2, 'Jordan says we need weekly reports.'), seg(8, 'We need weekly reports.')];
        const result = await one('We need weekly reports', segments, [
            { premise: /^Jordan says we need weekly reports/i, entail: 0.968 },
            { premise: /^We need weekly reports/i, entail: 0.995 },
        ]);
        expect(result.status).toBe('covered');
        expect(result.evidence?.timestampSec).toBe(8);
        expectAttributed(result, segments);
    });

    it('CONTROL: only a reported statement is still never credited to the speaker', async () => {
        const result = await one('We need weekly reports', [seg(2, 'Jordan says we need weekly reports.')],
            [{ premise: /^Jordan says we need weekly reports/i, entail: 0.968 }]);
        expect(result.status).toBe('missing');
    });

    it('a point about a named third party is covered by evidence about that same party', async () => {
        const segments = [seg(5, 'Engineers need faster builds.')];
        const result = await one('Engineers need faster builds', segments, [{ premise: /^Engineers need faster builds/i, entail: 0.993 }]);
        expect(result.status).toBe('covered');
        expectAttributed(result, segments);
    });

    it('CONTROL: a named third party is not credited by a different party or by our own team', async () => {
        const other = await one('Engineers need faster builds', [seg(5, 'Investors need faster builds.')],
            [{ premise: /faster builds/i, entail: 0.99 }]);
        expect(other.status).toBe('missing');
        const ours = await one('We need faster builds', [seg(5, 'Engineers need faster builds.')],
            [{ premise: /faster builds/i, entail: 0.99 }]);
        expect(ours.status).toBe('missing');
    });
});

describe('imperatives and one-segment transcripts (Codex P2s on #1995, round 3)', () => {
    it('an imperative whose OBJECT is a third party ("Hire two engineers") is the speaker\'s own claim', async () => {
        const segments = [seg(6, 'Hire two engineers in March.')];
        const result = await one('Hire two engineers in March', segments, [{ premise: /^Hire two engineers in March/i, entail: 0.98 }]);
        expect(result.status).toBe('covered');
        expectAttributed(result, segments);
    });

    it('CONTROL: a third party as the SUBJECT still never credits the speaker\'s plan', async () => {
        const result = await one('Hire two engineers in March', [seg(6, 'The competitors hire two engineers in March.')],
            [{ premise: /hire two engineers in March/i, entail: 0.98 }]);
        expect(result.status).toBe('missing');
    });

    it('sentences inside ONE segment are separate candidates: a leading report does not hide the later direct assertion', async () => {
        const segments = [seg(3, 'Jordan says we need weekly reports. We need weekly reports.')];
        const result = await one('We need weekly reports', segments, [
            { premise: /^Jordan says we need weekly reports\.?$/i, entail: 0.97 },
            { premise: /^We need weekly reports\.?$/i, entail: 0.993 },
            { premise: /Jordan says we need weekly reports\. We need weekly reports/i, entail: 0.99 },
        ]);
        expect(result.status).toBe('covered');
        expect(result.evidence?.quote).toBe('Jordan says we need weekly reports. We need weekly reports.');
        expect(result.evidence?.timestampSec).toBe(3);
    });

    it('CONTROL: a decimal number is not a sentence boundary', async () => {
        const result = await one('Churn fell to 3.5 percent', [seg(4, 'Churn fell to 3.5 percent this quarter.')],
            [{ premise: /^Churn fell to 3\.5 percent this quarter/i, entail: 0.95 }]);
        expect(result.status).toBe('covered');
    });
});

