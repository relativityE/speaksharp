/**
 * #1304 — faithful port of upstream `EnglishNumberNormalizer`.
 *
 * PINNED ORACLE: openai/whisper @ 5f86d1d86363843179951550570367b37c5d6f78,
 * `whisper/normalizers/english.py`. This is a direct translation of `preprocess` → `process_words` →
 * `postprocess`, table for table and branch for branch. It is NOT a reimplementation: the earlier
 * approximation reproduced 56 of 68 oracle vectors, and the twelve it missed were ordinals, suffixed
 * decades, nominal digit runs, fractions and currency placement — all constructs LibriSpeech contains,
 * any of which could move a model ranking.
 *
 * ONE STATED PLATFORM LIMIT: upstream carries multipliers to decillion (1e33). JavaScript integers are
 * exact only to 2^53, so arms above quintillion lose precision here. That is a language limit, not a
 * behavioural choice, and it is outside every generated vector; it is recorded rather than hidden.
 */

const ZEROS = new Set(['o', 'oh', 'zero']);

const ONES: Record<string, number> = {};
['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
].forEach((name, i) => { ONES[name] = i + 1; });

/** `six` -> `sixes`, everything else -> `+s`. */
const ONES_PLURAL: Record<string, [number, string]> = {};
for (const [name, value] of Object.entries(ONES)) {
    ONES_PLURAL[name === 'six' ? 'sixes' : `${name}s`] = [value, 's'];
}

const ONES_ORDINAL: Record<string, [number, string]> = {
    zeroth: [0, 'th'], first: [1, 'st'], second: [2, 'nd'], third: [3, 'rd'],
    fifth: [5, 'th'], twelfth: [12, 'th'],
};
for (const [name, value] of Object.entries(ONES)) {
    if (value > 3 && value !== 5 && value !== 12) {
        ONES_ORDINAL[name + (name.endsWith('t') ? 'h' : 'th')] = [value, 'th'];
    }
}
const ONES_SUFFIXED: Record<string, [number, string]> = { ...ONES_PLURAL, ...ONES_ORDINAL };

const TENS: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const TENS_SUFFIXED: Record<string, [number, string]> = {};
for (const [name, value] of Object.entries(TENS)) {
    TENS_SUFFIXED[name.replace('y', 'ies')] = [value, 's'];
    TENS_SUFFIXED[name.replace('y', 'ieth')] = [value, 'th'];
}

const MULTIPLIERS: Record<string, number> = {
    hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
    trillion: 1_000_000_000_000, quadrillion: 1e15, quintillion: 1e18, sextillion: 1e21,
    septillion: 1e24, octillion: 1e27, nonillion: 1e30, decillion: 1e33,
};
const MULTIPLIERS_SUFFIXED: Record<string, [number, string]> = {};
for (const [name, value] of Object.entries(MULTIPLIERS)) {
    MULTIPLIERS_SUFFIXED[`${name}s`] = [value, 's'];
    MULTIPLIERS_SUFFIXED[`${name}th`] = [value, 'th'];
}

const DECIMALS = new Set([...Object.keys(ONES), ...Object.keys(TENS), ...ZEROS]);

const PRECEDING_PREFIXERS: Record<string, string> = {
    minus: '-', negative: '-', plus: '+', positive: '+',
};
const FOLLOWING_PREFIXERS: Record<string, string> = {
    pound: '£', pounds: '£', euro: '€', euros: '€',
    dollar: '$', dollars: '$', cent: '¢', cents: '¢',
};
const PREFIXES = new Set([...Object.values(PRECEDING_PREFIXERS), ...Object.values(FOLLOWING_PREFIXERS)]);

const SUFFIXERS: Record<string, string | Record<string, string>> = { per: { cent: '%' }, percent: '%' };
const SPECIALS = new Set(['and', 'double', 'triple', 'point']);

const WORDS = new Set<string>([
    ...ZEROS, ...Object.keys(ONES), ...Object.keys(ONES_SUFFIXED), ...Object.keys(TENS),
    ...Object.keys(TENS_SUFFIXED), ...Object.keys(MULTIPLIERS), ...Object.keys(MULTIPLIERS_SUFFIXED),
    ...Object.keys(PRECEDING_PREFIXERS), ...Object.keys(FOLLOWING_PREFIXERS),
    ...Object.keys(SUFFIXERS), ...SPECIALS,
]);

const NUMERIC = /^\d+(\.\d+)?$/;

/** Minimal exact rational, standing in for Python's `Fraction` on decimal strings. */
interface Frac { n: number; d: number }
function toFraction(s: string | number): Frac | null {
    const text = String(s);
    if (!NUMERIC.test(text)) return null;
    const dot = text.indexOf('.');
    if (dot < 0) return { n: Number(text), d: 1 };
    const decimals = text.length - dot - 1;
    return reduce({ n: Number(text.replace('.', '')), d: 10 ** decimals });
}
function reduce(f: Frac): Frac {
    const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
    const k = g(Math.abs(f.n), Math.abs(f.d)) || 1;
    return { n: f.n / k, d: f.d / k };
}

/** `process_words` — the upstream generator, as an array-returning loop. */
function processWords(words: string[]): string[] {
    const out: string[] = [];
    let prefix: string | null = null;
    let value: string | number | null = null;
    let skip = false;

    const emit = (result: string | number): void => {
        let r = String(result);
        if (prefix !== null) r = prefix + r;
        value = null;
        prefix = null;
        out.push(r);
    };

    if (words.length === 0) return out;

    const padded: (string | null)[] = [null, ...words, null];
    for (let idx = 0; idx + 2 < padded.length + 1 && idx < words.length; idx++) {
        const prev = padded[idx];
        const current = padded[idx + 1] as string;
        const next = padded[idx + 2] ?? null;

        if (skip) { skip = false; continue; }

        const nextIsNumeric = next !== null && NUMERIC.test(next);
        const hasPrefix = PREFIXES.has(current[0]);
        const currentWithoutPrefix = hasPrefix ? current.slice(1) : current;

        if (NUMERIC.test(currentWithoutPrefix)) {
            const f = toFraction(currentWithoutPrefix);
            if (f === null) throw new Error(`unparseable numeric: ${current}`);
            if (value !== null) {
                if (typeof value === 'string' && value.endsWith('.')) {
                    value = String(value) + String(current);
                    continue;
                }
                emit(value);
            }
            if (hasPrefix) prefix = current[0];
            value = f.d === 1 ? f.n : currentWithoutPrefix;
        } else if (!WORDS.has(current)) {
            if (value !== null) emit(value);
            emit(current);
        } else if (ZEROS.has(current)) {
            value = String(value ?? '') + '0';
        } else if (current in ONES) {
            const ones = ONES[current];
            if (value === null) {
                value = ones;
            } else if (typeof value === 'string' || (prev !== null && prev in ONES)) {
                if (prev !== null && prev in TENS && ones < 10) {
                    value = String(value).slice(0, -1) + String(ones);
                } else {
                    value = String(value) + String(ones);
                }
            } else if (ones < 10) {
                value = value % 10 === 0 ? value + ones : String(value) + String(ones);
            } else {
                value = value % 100 === 0 ? value + ones : String(value) + String(ones);
            }
        } else if (current in ONES_SUFFIXED) {
            const [ones, suffix] = ONES_SUFFIXED[current];
            if (value === null) {
                emit(String(ones) + suffix);
            } else if (typeof value === 'string' || (prev !== null && prev in ONES)) {
                if (prev !== null && prev in TENS && ones < 10) {
                    emit(String(value).slice(0, -1) + String(ones) + suffix);
                } else {
                    emit(String(value) + String(ones) + suffix);
                }
            } else if (ones < 10) {
                emit(value % 10 === 0 ? String(value + ones) + suffix : String(value) + String(ones) + suffix);
            } else {
                emit(value % 100 === 0 ? String(value + ones) + suffix : String(value) + String(ones) + suffix);
            }
            value = null;
        } else if (current in TENS) {
            const tens = TENS[current];
            if (value === null) value = tens;
            else if (typeof value === 'string') value = String(value) + String(tens);
            else value = value % 100 === 0 ? value + tens : String(value) + String(tens);
        } else if (current in TENS_SUFFIXED) {
            const [tens, suffix] = TENS_SUFFIXED[current];
            if (value === null) emit(String(tens) + suffix);
            else if (typeof value === 'string') emit(String(value) + String(tens) + suffix);
            else emit(value % 100 === 0 ? String(value + tens) + suffix : String(value) + String(tens) + suffix);
        } else if (current in MULTIPLIERS) {
            const multiplier = MULTIPLIERS[current];
            if (value === null) {
                value = multiplier;
            } else if (typeof value === 'string' || value === 0) {
                const f = toFraction(value);
                const p = f === null ? null : reduce({ n: f.n * multiplier, d: f.d });
                if (p !== null && p.d === 1) {
                    value = p.n;
                } else {
                    emit(value);
                    value = multiplier;
                }
            } else {
                const asNumber: number = value;
                const before = Math.trunc(asNumber / 1000) * 1000;
                const residual = asNumber % 1000;
                value = before + residual * multiplier;
            }
        } else if (current in MULTIPLIERS_SUFFIXED) {
            const [multiplier, suffix] = MULTIPLIERS_SUFFIXED[current];
            if (value === null) {
                emit(String(multiplier) + suffix);
            } else if (typeof value === 'string') {
                const f = toFraction(value);
                const p = f === null ? null : reduce({ n: f.n * multiplier, d: f.d });
                if (p !== null && p.d === 1) {
                    emit(String(p.n) + suffix);
                } else {
                    emit(value);
                    emit(String(multiplier) + suffix);
                }
            } else {
                const asNumber: number = value;
                const before = Math.trunc(asNumber / 1000) * 1000;
                const residual = asNumber % 1000;
                const scaled = before + residual * multiplier;
                value = scaled;
                emit(String(scaled) + suffix);
            }
            value = null;
        } else if (current in PRECEDING_PREFIXERS) {
            if (value !== null) emit(value);
            if ((next !== null && WORDS.has(next)) || nextIsNumeric) prefix = PRECEDING_PREFIXERS[current];
            else emit(current);
        } else if (current in FOLLOWING_PREFIXERS) {
            if (value !== null) {
                prefix = FOLLOWING_PREFIXERS[current];
                emit(value);
            } else {
                emit(current);
            }
        } else if (current in SUFFIXERS) {
            if (value !== null) {
                const suffix = SUFFIXERS[current];
                if (typeof suffix === 'object') {
                    if (next !== null && next in suffix) {
                        emit(String(value) + suffix[next]);
                        skip = true;
                    } else {
                        emit(value);
                        emit(current);
                    }
                } else {
                    emit(String(value) + suffix);
                }
            } else {
                emit(current);
            }
        } else if (SPECIALS.has(current)) {
            if (!(next !== null && WORDS.has(next)) && !nextIsNumeric) {
                if (value !== null) emit(value);
                emit(current);
            } else if (current === 'and') {
                if (!(prev !== null && prev in MULTIPLIERS)) {
                    if (value !== null) emit(value);
                    emit(current);
                }
            } else if (current === 'double' || current === 'triple') {
                if (next !== null && (next in ONES || ZEROS.has(next))) {
                    const repeats = current === 'double' ? 2 : 3;
                    const ones = ONES[next] ?? 0;
                    value = String(value ?? '') + String(ones).repeat(repeats);
                    skip = true;
                } else {
                    if (value !== null) emit(value);
                    emit(current);
                }
            } else if (current === 'point') {
                if ((next !== null && DECIMALS.has(next)) || nextIsNumeric) {
                    value = String(value ?? '') + '.';
                }
            } else {
                throw new Error(`Unexpected token: ${current}`);
            }
        } else {
            throw new Error(`Unexpected token: ${current}`);
        }
    }
    if (value !== null) emit(value);
    return out;
}

/** `preprocess` — "<number> and a half" -> "<number> point five", plus digit/letter spacing. */
function preprocess(s: string): string {
    const results: string[] = [];
    const segments = s.split(/\band\s+a\s+half\b/);
    segments.forEach((segment, i) => {
        if (segment.trim().length === 0) return;
        results.push(segment);
        if (i !== segments.length - 1) {
            const parts = segment.trim().split(/\s+/);
            const lastWord = parts[parts.length - 1];
            results.push(DECIMALS.has(lastWord) || lastWord in MULTIPLIERS ? 'point five' : 'and a half');
        }
    });
    let out = results.join(' ');
    out = out.replace(/([a-z])([0-9])/g, '$1 $2');
    out = out.replace(/([0-9])([a-z])/g, '$1 $2');
    out = out.replace(/([0-9])\s+(st|nd|rd|th|s)\b/g, '$1$2');
    return out;
}

/** `postprocess` — currency recombination and the `1 -> one` readability rule. */
function postprocess(s: string): string {
    let out = s.replace(/([€£$])([0-9]+) (?:and )?¢([0-9]{1,2})\b/g, (_m, currency, integer, cents) => {
        const c = Number(cents);
        return Number.isNaN(c) ? _m : `${currency}${integer}.${String(c).padStart(2, '0')}`;
    });
    out = out.replace(/[€£$]0\.([0-9]{1,2})\b/g, (_m, cents) => {
        const c = Number(cents);
        return Number.isNaN(c) ? _m : `¢${c}`;
    });
    out = out.replace(/\b1(s?)\b/g, 'one$1');
    return out;
}

/** Upstream `EnglishNumberNormalizer.__call__`. */
export function normalizeEnglishNumbers(s: string): string {
    let out = preprocess(s);
    out = processWords(out.split(/\s+/).filter((w) => w.length > 0)).join(' ');
    return postprocess(out);
}
