/**
 * APP-G1h (Sam 1792982426.848739): an INDEPENDENT reference for the Open Mic `filler "<word>" vs corpus` rows.
 *
 * L1 (run 40071973428 on fb30674e) failed `filler "um" vs corpus` with corpus 4 vs transcript 5, while every
 * transcript/display/saved row agreed. An exact per-word count cannot tell an inserted or omitted filler from one hesitation
 * recognised as another, so this module aligns each SCRIPTED hesitation to the transcript through its unique following
 * anchor phrase and classifies it. The annotations come from the TTS input script, not from the realised audio, so a
 * substitution is recognition/fixture ambiguity (FIXTURE_LIMITED on synthetic audio), never proof the fixture alone caused it.
 *
 * Independence: the variant table below is declared here on purpose, NOT imported from `fillerWordUtils`, so a defect in the
 * product counter cannot pass both sides. It copies the variant contract as specified at eb030b95; `crossCheckCounts` turns
 * any later disagreement between the product counter and this table into a FAIL (counter drift).
 *
 * Nothing here returns or logs transcript text: results carry classes and counts only.
 */

export type ReferenceKey = 'um' | 'uh' | 'ah' | 'you_know';
export type Verdict = 'PASS' | 'FAIL' | 'HOLD' | 'FIXTURE_LIMITED';
export type InstanceClass = 'MATCH' | 'SUBSTITUTED' | 'OMITTED' | 'ANCHOR_MISSING' | 'AMBIGUOUS' | 'CONTESTED';

/** One scripted hesitation: the filler as written in the TTS script and the unique phrase that follows it. */
export interface FillerAnnotation { word: string; anchor: string }

export const REFERENCE_VARIANTS: Readonly<Record<ReferenceKey, readonly string[]>> = {
    um: ['um', 'umm', 'ummm', 'uhm'],
    uh: ['uh', 'uhh', 'uhhh', 'er', 'err', 'erh'],
    ah: ['ah', 'ahm', 'ahhh'],
    you_know: ['you know', "y'know", 'ya know'],
};

const REFERENCE_KEYS = Object.keys(REFERENCE_VARIANTS) as ReferenceKey[];

/** The manifest's `fillerAnnotations.items` for a fixture entry; [] when the entry carries none or the shape is wrong. */
export const fillerAnnotationsOf = (entry: unknown): FillerAnnotation[] => {
    const items = (entry as { fillerAnnotations?: { items?: unknown } } | null)?.fillerAnnotations?.items;
    if (!Array.isArray(items)) return [];
    return items.filter((i): i is FillerAnnotation =>
        typeof (i as FillerAnnotation)?.word === 'string' && typeof (i as FillerAnnotation)?.anchor === 'string');
};

/** The corpus spells "you know" with a space; every other word is its own key. */
export const referenceKeyFor = (word: string): ReferenceKey | null => {
    const key = word.trim().toLowerCase().replace(/\s+/g, '_');
    return (REFERENCE_KEYS as string[]).includes(key) ? (key as ReferenceKey) : null;
};

/**
 * Word tokens split at every non-word character, the same boundaries as the product's `\b` patterns: letters, digits and
 * "_" stay joined, so "um2" or "um_x" is never "um" (Sam 1792983480.096009), while "um-hmm" and "um's" still contain "um".
 */
interface Token { word: string; sep: string }

/**
 * Word tokens, each with the exact raw text separating it from the next word ('' after the last). A multi-part variant
 * matches only with its own literal internal separators: "y'know" needs "'", "you know" one space, so "y know", "y-know"
 * or "you  know" are not declared variants (Sam 1792984173.303649).
 */
const tokenizeWithSeparators = (text: string): Token[] => {
    const lower = text.toLowerCase();
    const words = [...lower.matchAll(/[a-z0-9_]+/g)];
    return words.map((m, i) => ({
        word: m[0],
        sep: i + 1 < words.length ? lower.slice(m.index! + m[0].length, words[i + 1].index) : '',
    }));
};

const tokenize = (text: string): string[] => tokenizeWithSeparators(text).map((t) => t.word);

interface Unit { key: ReferenceKey; start: number; length: number }

const VARIANT_TOKENS = REFERENCE_KEYS
    .flatMap((key) => REFERENCE_VARIANTS[key].map((v) => ({ key, parts: tokenizeWithSeparators(v) })))
    .sort((a, b) => b.parts.length - a.parts.length);

/** Every hesitation unit in the token stream, longest variant first so "you know" is one unit. */
const hesitationUnits = (tokens: readonly Token[]): Unit[] => {
    const units: Unit[] = [];
    for (let i = 0; i < tokens.length;) {
        const hit = VARIANT_TOKENS.find(({ parts }) => parts.every((p, j) =>
            tokens[i + j]?.word === p.word && (j === parts.length - 1 || tokens[i + j].sep === p.sep)));
        if (hit) { units.push({ key: hit.key, start: i, length: hit.parts.length }); i += hit.parts.length; } else i += 1;
    }
    return units;
};

/** The reference count of one key in `text`, independent of the product counter. */
export const referenceCount = (text: string, key: ReferenceKey): number =>
    hesitationUnits(tokenizeWithSeparators(text)).filter((u) => u.key === key).length;

const anchorStarts = (tokens: readonly string[], anchor: string): number[] => {
    const parts = tokenize(anchor);
    const starts: number[] = [];
    for (let i = 0; i + parts.length <= tokens.length; i += 1) {
        if (parts.every((p, j) => tokens[i + j] === p)) starts.push(i);
    }
    return starts;
};

export interface InstanceResult { word: string; anchor: string; class: InstanceClass; observed: ReferenceKey | null }
export interface Alignment { instances: InstanceResult[]; inserted: Record<ReferenceKey, number> }

/**
 * Aligns each annotation one-to-one. Ownership is validated before, and independently of, any hesitation token
 * (Sam 1792983339.704229, 1792983480.096009), and every involved annotation is held, whatever its order or word:
 * - the same normalised anchor declared twice → AMBIGUOUS for all of them;
 * - an anchor found zero times → ANCHOR_MISSING; more than once → AMBIGUOUS;
 * - anchors resolving to the same or overlapping transcript span → CONTESTED for all of them.
 * Only then is the hesitation directly before the anchor classified (MATCH / SUBSTITUTED / OMITTED). Unattached units are
 * INSERTED.
 */
export const alignFillers = (transcript: string, annotations: readonly FillerAnnotation[]): Alignment => {
    const withSeparators = tokenizeWithSeparators(transcript);
    const tokens = withSeparators.map((t) => t.word);
    const units = hesitationUnits(withSeparators);
    const unitEndingAt = new Map(units.map((u) => [u.start + u.length, u]));
    const anchorKey = (anchor: string) => tokenize(anchor).join(' ');
    const declared = new Map<string, number>();
    for (const { anchor } of annotations) declared.set(anchorKey(anchor), (declared.get(anchorKey(anchor)) ?? 0) + 1);
    const resolved = annotations.map(({ anchor }) => {
        const starts = anchorStarts(tokens, anchor);
        return { starts, span: starts.length === 1 ? [starts[0], starts[0] + tokenize(anchor).length] as const : null };
    });
    const overlaps = (i: number) => resolved.some((other, j) => j !== i && other.span !== null && resolved[i].span !== null
        && other.span[0] < resolved[i].span![1] && resolved[i].span![0] < other.span[1]);
    const instances = annotations.map(({ word, anchor }, i): InstanceResult => {
        const { starts, span } = resolved[i];
        const unit = span ? unitEndingAt.get(span[0]) : undefined;
        if ((declared.get(anchorKey(anchor)) ?? 0) > 1) return { word, anchor, class: 'AMBIGUOUS', observed: null };
        if (starts.length === 0) return { word, anchor, class: 'ANCHOR_MISSING', observed: null };
        if (starts.length > 1) return { word, anchor, class: 'AMBIGUOUS', observed: null };
        if (overlaps(i)) return { word, anchor, class: 'CONTESTED', observed: unit?.key ?? null };
        if (!unit) return { word, anchor, class: 'OMITTED', observed: null };
        return { word, anchor, class: unit.key === referenceKeyFor(word) ? 'MATCH' : 'SUBSTITUTED', observed: unit.key };
    });
    // Every unit directly before a uniquely resolved anchor is spoken for, even when that anchor is held: a contested
    // hesitation is never also counted as inserted.
    const attached = new Set<Unit>();
    for (const { span } of resolved) { const u = span ? unitEndingAt.get(span[0]) : undefined; if (u) attached.add(u); }
    const inserted = Object.fromEntries(REFERENCE_KEYS.map((k) => [k, 0])) as Record<ReferenceKey, number>;
    for (const u of units) if (!attached.has(u)) inserted[u.key] += 1;
    return { instances, inserted };
};

const HOLD_CLASSES: readonly InstanceClass[] = ['ANCHOR_MISSING', 'AMBIGUOUS', 'CONTESTED'];

export interface WordVerdict { verdict: Verdict; detail: string; evidence: Record<string, number> }

/**
 * The `filler "<word>" vs corpus` verdict. The exact expectation stays: PASS needs the reference count to equal the corpus
 * count with every instance matched and nothing inserted. A hold anywhere in the word's alignment is HOLD; an omission or an
 * insertion is FAIL even when the total is conserved; a substitution is FIXTURE_LIMITED on synthetic audio and FAIL on human
 * audio. FIXTURE_LIMITED is unverified, never a pass.
 */
export const corpusWordVerdict = (
    word: string, expected: number, transcript: string, alignment: Alignment, fixtureKind: 'synthetic' | 'human',
): WordVerdict => {
    const key = referenceKeyFor(word);
    const observed = key ? referenceCount(transcript, key) : 0;
    const own = alignment.instances.filter((i) => referenceKeyFor(i.word) === key);
    const into = alignment.instances.filter((i) => i.class === 'SUBSTITUTED' && i.observed === key);
    const count = (c: InstanceClass) => own.filter((i) => i.class === c).length;
    const evidence = {
        expected, transcript: observed, matched: count('MATCH'), substitutedOut: count('SUBSTITUTED'), substitutedIn: into.length,
        omitted: count('OMITTED'), inserted: key ? alignment.inserted[key] : 0,
        // A contested unit OF this word also holds it, even when the contesting annotations belong to other words.
        held: own.filter((i) => HOLD_CLASSES.includes(i.class)).length
            + alignment.instances.filter((i) => i.class === 'CONTESTED' && i.observed === key && referenceKeyFor(i.word) !== key).length,
    };
    if (!key) return { verdict: 'HOLD', detail: 'the corpus word has no reference definition', evidence };
    if (evidence.held > 0) return { verdict: 'HOLD', detail: 'an anchor is missing, repeated or contested', evidence };
    if (evidence.omitted > 0 || evidence.inserted > 0) {
        return { verdict: 'FAIL', detail: 'the transcript omits or inserts instances', evidence };
    }
    if (evidence.substitutedOut > 0 || evidence.substitutedIn > 0) {
        return fixtureKind === 'synthetic'
            ? { verdict: 'FIXTURE_LIMITED', detail: 'a scripted hesitation was recognised as another (synthetic audio: unverified)', evidence }
            : { verdict: 'FAIL', detail: 'a spoken hesitation was recognised as another', evidence };
    }
    return observed === expected
        ? { verdict: 'PASS', detail: 'the transcript holds every spoken instance', evidence }
        : { verdict: 'FAIL', detail: 'the count differs from the corpus without an aligned cause', evidence };
};

/**
 * Verdicts over the complete key union: every corpus word plus every declared reference key, expected 0 where the corpus
 * has none, so an unanchored "Ah." cannot hide behind a corpus with no "ah" key (Sam 1792983572.435229).
 */
export const corpusVerdicts = (
    corpus: Readonly<Record<string, number>>, transcript: string, alignment: Alignment, fixtureKind: 'synthetic' | 'human',
): Record<string, WordVerdict> => {
    const words = [...new Set([...Object.keys(corpus), ...REFERENCE_KEYS.map((k) => k.replace('_', ' '))])];
    return Object.fromEntries(words.map((w) => [w, corpusWordVerdict(w, corpus[w] ?? 0, transcript, alignment, fixtureKind)]));
};

/** Informational only: the hesitation total (um+uh+ah) against the corpus total. It never upgrades a per-word verdict. */
export const hesitationTotals = (transcript: string, corpus: Readonly<Record<string, number>>) => {
    const keys: ReferenceKey[] = ['um', 'uh', 'ah'];
    return {
        expected: keys.reduce((sum, k) => sum + (corpus[k] ?? 0), 0),
        transcript: keys.reduce((sum, k) => sum + referenceCount(transcript, k), 0),
    };
};

/**
 * The per-word `filler "<word>": transcript / display / saved` row, unchanged from the spec: the saved count equals the
 * transcript recount, and a rendered word's displayed count equals the saved count. A discourse marker (not rendered in the
 * review by design) compares transcript with saved only.
 */
export const integrityVerdict = (
    { transcript, displayed, saved, rendered }: { transcript: number; displayed: number | null; saved: number; rendered: boolean },
): { verdict: 'PASS' | 'FAIL'; detail: string } => {
    if ((!rendered || displayed === saved) && saved === transcript) {
        return {
            verdict: 'PASS',
            detail: rendered ? 'the transcript, the displayed breakdown and the saved count agree'
                : 'the transcript and the saved count agree (a discourse marker: tracked, not shown in the review by design)',
        };
    }
    return {
        verdict: 'FAIL',
        detail: rendered && displayed !== saved ? 'the count the person saw differs from the count saved (misleading display)'
            : 'the saved count differs from the words in the saved transcript',
    };
};

/** Product counter vs reference on the same transcript, per key: any disagreement is counter drift (FAIL). */
export const crossCheckCounts = (
    transcript: string, productCount: (text: string, key: string) => number,
): Record<ReferenceKey, { product: number; reference: number; verdict: 'PASS' | 'FAIL' }> =>
    Object.fromEntries(REFERENCE_KEYS.map((key) => {
        const product = productCount(transcript, key);
        const reference = referenceCount(transcript, key);
        return [key, { product, reference, verdict: product === reference ? 'PASS' : 'FAIL' }];
    })) as Record<ReferenceKey, { product: number; reference: number; verdict: 'PASS' | 'FAIL' }>;
