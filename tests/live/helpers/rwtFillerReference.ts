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

const tokenize = (text: string): string[] =>
    text.toLowerCase().replace(/[^a-z'\s]+/g, ' ').split(/\s+/).filter((t) => t.length > 0);

interface Unit { key: ReferenceKey; start: number; length: number }

/** Every hesitation unit in the token stream, longest variant first so "you know" is one unit. */
const hesitationUnits = (tokens: readonly string[]): Unit[] => {
    const variants = REFERENCE_KEYS.flatMap((key) => REFERENCE_VARIANTS[key].map((v) => ({ key, parts: v.split(' ') })))
        .sort((a, b) => b.parts.length - a.parts.length);
    const units: Unit[] = [];
    for (let i = 0; i < tokens.length;) {
        const hit = variants.find(({ parts }) => parts.every((p, j) => tokens[i + j] === p));
        if (hit) { units.push({ key: hit.key, start: i, length: hit.parts.length }); i += hit.parts.length; } else i += 1;
    }
    return units;
};

/** The reference count of one key in `text`, independent of the product counter. */
export const referenceCount = (text: string, key: ReferenceKey): number =>
    hesitationUnits(tokenize(text)).filter((u) => u.key === key).length;

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
 * Aligns each annotation one-to-one: the anchor must occur exactly once (else ANCHOR_MISSING / AMBIGUOUS), and a
 * hesitation unit attaches to at most one anchor. When two or more annotations reach the same unit, EVERY involved
 * annotation is CONTESTED, whatever its order or word (Sam RETURN 1792983339.704229), so no claimant can still pass.
 * Unattached units are INSERTED.
 */
export const alignFillers = (transcript: string, annotations: readonly FillerAnnotation[]): Alignment => {
    const tokens = tokenize(transcript);
    const units = hesitationUnits(tokens);
    const unitEndingAt = new Map(units.map((u) => [u.start + u.length, u]));
    const reached = annotations.map(({ anchor }) => {
        const starts = anchorStarts(tokens, anchor);
        return { starts, unit: starts.length === 1 ? unitEndingAt.get(starts[0]) : undefined };
    });
    const claims = new Map<Unit, number>();
    for (const { unit } of reached) if (unit) claims.set(unit, (claims.get(unit) ?? 0) + 1);
    const instances = annotations.map(({ word, anchor }, i): InstanceResult => {
        const { starts, unit } = reached[i];
        if (starts.length === 0) return { word, anchor, class: 'ANCHOR_MISSING', observed: null };
        if (starts.length > 1) return { word, anchor, class: 'AMBIGUOUS', observed: null };
        if (!unit) return { word, anchor, class: 'OMITTED', observed: null };
        if ((claims.get(unit) ?? 0) > 1) return { word, anchor, class: 'CONTESTED', observed: unit.key };
        return { word, anchor, class: unit.key === referenceKeyFor(word) ? 'MATCH' : 'SUBSTITUTED', observed: unit.key };
    });
    const inserted = Object.fromEntries(REFERENCE_KEYS.map((k) => [k, 0])) as Record<ReferenceKey, number>;
    for (const u of units) if (!claims.has(u)) inserted[u.key] += 1;
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
