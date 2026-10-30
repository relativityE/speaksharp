// Exact selected declarations; presentationSelected.provenance.json.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseClock = exports.AVERAGE_TOLERANCE_SECONDS = exports.GUIDE_SECONDS = exports.samePhrase = exports.NEXT_HEADINGS = exports.WELL_HEADINGS = exports.COACHING_WORD_TARGET_MIN = exports.COACHING_WORD_TARGET = exports.PACE_GUIDE_DEFAULT_SECONDS = exports.normalisePhraseText = exports.countWords = void 0;
exports.parsePaceGuideSeconds = parsePaceGuideSeconds;
const countWords = (value) => value.trim().split(/\s+/).filter(Boolean).length;
exports.countWords = countWords;
/** Case, spacing and sentence-final punctuation do not change a phrase. */
const normalisePhraseText = (t) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+(\s|$)/g, '$1').trim();
exports.normalisePhraseText = normalisePhraseText;
/** PO 2026-10-02: about 8-10 words per phrase is a SOFT target (the Edge contract's `wordTarget`), measured — never a failure. */
const COACHING_WORD_TARGET = 10;
exports.COACHING_WORD_TARGET = COACHING_WORD_TARGET;
/** #1258 (Codex r4188372867): ABOUT 8-10 words — a shorter phrase is not within the target. */
const COACHING_WORD_TARGET_MIN = 8;
exports.COACHING_WORD_TARGET_MIN = COACHING_WORD_TARGET_MIN;
/** Accepted headings (runbook (3) row 5: Akin also accepts "What to try next"). */
const WELL_HEADINGS = ['What went well'];
exports.WELL_HEADINGS = WELL_HEADINGS;
const NEXT_HEADINGS = ['Try this next run', 'What to try next'];
exports.NEXT_HEADINGS = NEXT_HEADINGS;
/** Same phrase, ignoring case, spacing and trailing punctuation. */
const samePhrase = (a, b) => (0, exports.normalisePhraseText)(a) !== '' && (0, exports.normalisePhraseText)(a) === (0, exports.normalisePhraseText)(b);
exports.samePhrase = samePhrase;
/** The pace guide the script sets (1:00 per point). The measured average must NOT simply echo it. */
const GUIDE_SECONDS = 60;
exports.GUIDE_SECONDS = GUIDE_SECONDS;
/** Tolerance on elapsed ÷ detected: the take's wall clock vs the product's own duration, in seconds. */
const AVERAGE_TOLERANCE_SECONDS = 4;
exports.AVERAGE_TOLERANCE_SECONDS = AVERAGE_TOLERANCE_SECONDS;
const parseClock = (text) => {
    const match = /(\d+):(\d{2})/.exec(text);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
exports.parseClock = parseClock;
/**
 * #1258 (R5, PM 6134474736; PO 2026-10-12: the guide reads "1 min") — the Focus Points pace guide in SEMANTIC seconds.
 *
 * The setup form shows minutes per point in half-minute steps (`ObjectiveSetupForm`: "1 min", "1.5 min", 0.5–3) and
 * persists seconds. The journey parsed it as an m:ss clock, so "1 min" read as null and runs 38304068207 / 38308997906
 * failed `pace guide` on the shipped default. The guide is compared as seconds; m:ss stays the parser for the measured
 * clocks (coverage average, timings), which really are clocks.
 */
exports.PACE_GUIDE_DEFAULT_SECONDS = 60;
/** "1 min" → 60, "0.5 min" → 30, "1.5 min" → 90. Anything that is not a minutes value is null — never a guess. */
function parsePaceGuideSeconds(text) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*min\s*$/i.exec(text ?? '');
    if (!match)
        return null;
    const seconds = Math.round(Number(match[1]) * 60);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
