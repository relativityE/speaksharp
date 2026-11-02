"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILLER_ADVICE = exports.COACHING_CHARACTER_CEILING = void 0;
exports.characterCeilingVerdict = characterCeilingVerdict;
exports.fillerAdviceVerdict = fillerAdviceVerdict;
exports.takesDifferVerdict = takesDifferVerdict;
exports.openPointReferenceVerdict = openPointReferenceVerdict;
exports.readTwoTakesCoaching = readTwoTakesCoaching;
const contract = require('./coaching-contract.json');
/** The provider schema's own ceiling, the same number the Edge function enforces (COACHING_CHARACTER_CEILING). */
exports.COACHING_CHARACTER_CEILING = Object.freeze({
    what_worked: contract.generationConfig.responseSchema.properties.what_worked.maxLength,
    what_to_try_next: contract.generationConfig.responseSchema.properties.what_to_try_next.maxLength,
});
/** Advice to cut fillers: names fillers, or the "um"/"uh" sounds themselves. */
exports.FILLER_ADVICE = /\b(filler(s| words?)?|ums?|uhs?|u+m+|u+h+)\b/i;
const STOPWORDS = new Set(['your', 'with', 'that', 'this', 'from', 'have', 'what', 'when', 'will', 'about', 'they', 'them', 'into', 'than']);
const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
function characterCeilingVerdict(well, next) {
    if (well === '' && next === '')
        return { status: 'HOLD', detail: 'no phrases to measure' };
    const over = [
        well.length > exports.COACHING_CHARACTER_CEILING.what_worked ? 'What worked' : null,
        next.length > exports.COACHING_CHARACTER_CEILING.what_to_try_next ? 'What to try next' : null,
    ].filter(Boolean);
    return over.length === 0
        ? { status: 'PASS', detail: 'both phrases are within the character ceiling' }
        : { status: 'FAIL', detail: `${over.join(' and ')} exceeds the character ceiling` };
}
/** No advice to cut fillers when the saved take has none. */
function fillerAdviceVerdict(o) {
    if (o.next === '')
        return { status: 'HOLD', detail: 'no What to try next phrase to check' };
    if (o.savedFillerTotal === null)
        return { status: 'HOLD', detail: 'the saved filler count is unreadable' };
    if (o.savedFillerTotal === 0 && exports.FILLER_ADVICE.test(o.next)) {
        return { status: 'FAIL', detail: 'the advice is to cut fillers, but the saved take has none' };
    }
    return { status: 'PASS', detail: o.savedFillerTotal === 0 ? 'no filler advice for a take with no fillers' : 'filler advice is consistent with the saved count' };
}
/** Two takes whose saved evidence differs must not receive the identical pair. */
function takesDifferVerdict(first, second, evidenceDiffers) {
    if (!first || !second)
        return { status: 'HOLD', detail: 'two saved coaching pairs are needed to compare' };
    if (evidenceDiffers !== true)
        return { status: 'HOLD', detail: 'the two takes\' saved evidence did not differ, so identical advice proves nothing' };
    const identical = norm(first.well) === norm(second.well) && norm(first.next) === norm(second.next);
    return identical
        ? { status: 'FAIL', detail: 'two takes with different saved evidence received the identical coaching pair' }
        : { status: 'PASS', detail: 'the two takes received different coaching' };
}
/**
 * Focus: when a point is still open (partial or not detected), PASS when the advice evidently refers to one of those
 * points by its own words. It never FAILs on wording: the advice must not claim a point was missed (the matcher cannot
 * know), so an advice that names no open point is HOLD and the human check decides.
 */
function openPointReferenceVerdict(o) {
    // PM 6207105255: missing evidence never invents "all covered". The rail must be readable, complete and terminal.
    if (o.labels.length === 0 || o.statuses.length !== o.labels.length || o.labels.some((l) => l.trim() === '')) {
        return { status: 'HOLD', detail: 'the rail evidence is missing or does not match the set, so open points are unknown' };
    }
    if (o.statuses.some((s) => s !== 'covered' && s !== 'partial' && s !== 'missing')) {
        return { status: 'HOLD', detail: 'a point\'s final status is unreadable or not yet settled, so open points are unknown' };
    }
    const open = o.labels.filter((_, i) => o.statuses[i] === 'partial' || o.statuses[i] === 'missing');
    if (open.length === 0)
        return { status: 'PASS', detail: 'every point was explicitly covered; there is no open point to name' };
    if (o.well === '' && o.next === '')
        return { status: 'HOLD', detail: 'no phrases to check' };
    const text = norm(`${o.well} ${o.next}`);
    const words = (label) => norm(label).split(/[^a-z0-9']+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
    const referenced = open.some((label) => words(label).some((w) => new RegExp(`\\b${w}`).test(text)));
    return referenced
        ? { status: 'PASS', detail: 'the advice refers to a point that is still open' }
        : { status: 'HOLD', detail: 'the advice names no open point by its words; the human check decides' };
}
/**
 * Both takes' saved pairs and word counts, read after the second take's coaching has had time to save (bounded). A pair
 * that never saved reads null, so the comparison HOLDs rather than passing on absence.
 */
async function readTwoTakesCoaching(admin, uid, firstId, secondId, boundMs = 180_000) {
    const pair = (raw) => {
        const v = raw;
        return typeof v?.what_worked === 'string' && typeof v?.what_to_try_next === 'string' && v.what_worked.trim() && v.what_to_try_next.trim()
            ? { well: v.what_worked.trim(), next: v.what_to_try_next.trim() } : null;
    };
    const deadline = Date.now() + boundMs;
    for (;;) {
        const { data, error } = await admin.from('sessions').select('id,ai_suggestions,total_words').eq('user_id', uid).in('id', [firstId, secondId]);
        if (error)
            throw new Error(`saved coaching read failed (fail closed): ${error.code ?? 'unknown'}`);
        const rows = (data ?? []);
        const a = rows.find((r) => r.id === firstId);
        const b = rows.find((r) => r.id === secondId);
        const first = pair(a?.ai_suggestions ?? null);
        const second = pair(b?.ai_suggestions ?? null);
        if ((first && second) || Date.now() >= deadline) {
            const wa = typeof a?.total_words === 'number' ? a.total_words : null;
            const wb = typeof b?.total_words === 'number' ? b.total_words : null;
            return { first, second, evidenceDiffers: wa === null || wb === null ? null : wa !== wb };
        }
        await new Promise((r) => setTimeout(r, 5_000));
    }
}
