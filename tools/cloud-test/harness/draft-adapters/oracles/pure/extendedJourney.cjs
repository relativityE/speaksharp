// Exact-source declarations from main70e; see extendedJourney.provenance.json.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPEAT_START_CEILING_MS = void 0;
exports.newSetSourcePoints = newSetSourcePoints;
exports.newSetEditVerdicts = newSetEditVerdicts;
exports.setupIsBlank = setupIsBlank;
exports.labelHeardIn = labelHeardIn;
exports.switchIsolationVerdict = switchIsolationVerdict;
exports.focusBackReloadVerdict = focusBackReloadVerdict;
exports.sameOrderedPendingSet = sameOrderedPendingSet;
exports.repeatStartVerdict = repeatStartVerdict;
/**
 * #1258 (Browser PM 6087216991, option B) — Focus "Start a new set" and "Edit" on the deployed engine. The new set keeps two
 * points the fixture SPEAKS and starts with one it never says; Edit replaces that one with a third spoken point. Scored on the
 * edited set every point is detected (3/3); on the unedited new set the unspoken point would be missed, and on the old set the
 * total would differ. Returns the three fixture indices, or null when the fixture expects fewer than three covered points.
 */
function newSetSourcePoints(expectedFinal) {
    const covered = expectedFinal.flatMap((e, i) => (e === 'covered' ? [i] : []));
    return covered.length >= 3 ? [covered[0], covered[1], covered[2]] : null;
}
function newSetEditVerdicts(o) {
    const sameA = o.takeAVerdictsBefore.length > 0 && o.takeAVerdictsBefore.join(',') === o.takeAVerdictsAfter.join(',');
    const newSetOk = o.newSetBlank && o.takeBId !== null && o.takeBId !== o.takeAId && o.briefB !== null && o.briefB !== o.briefA && sameA;
    const newSet = newSetOk
        ? { verdict: 'PASS', detail: 'Start a new set opened blank; the next take saved under a new set, and the earlier take kept its saved verdicts' }
        : { verdict: 'FAIL', detail: !o.newSetBlank ? 'Start a new set did not open a blank setup'
                : o.takeBId === null || o.takeBId === o.takeAId ? 'the take after the new set did not save as its own session'
                    : o.briefB === null || o.briefB === o.briefA ? 'the take after the new set was not saved under a new set'
                        : 'the earlier take\'s saved verdicts changed' };
    // Browser PM 6093772463: bound per point — the edited label, its rail status and its saved verdict at the SAME position.
    const n = o.editedLabels.length;
    const scored = n === 3 && o.railOrdered.length === n && o.takeBSavedOrdered.length === n
        && o.editedLabels.every((label, i) => o.railOrdered[i].label.includes(label) && o.railOrdered[i].status === 'covered'
            && o.takeBSavedOrdered[i].label === label && o.takeBSavedOrdered[i].verdict === 'detected');
    const editOk = o.editSeeded && o.railLabelsMatchEdit && scored;
    const edit = editOk
        ? { verdict: 'PASS', detail: 'Edit opened seeded with the set; the edited point replaced the unspoken one and the next take was scored 3/3 on the edited set' }
        : { verdict: 'FAIL', detail: !o.editSeeded ? 'Edit did not open seeded with the current set'
                : !o.railLabelsMatchEdit ? 'the rail does not show the edited set'
                    : 'the next take was not scored and saved 3/3 on the edited set' };
    return { newSet, edit };
}
/**
 * #1258 (Browser PM 6089313104) — "Start a new set" opened BLANK: the goal is unchosen, the topic (rendered only for a custom
 * goal; null when absent) is empty, at least one point input is rendered and EVERY rendered point input is empty, and no
 * value carries an old-set label. Point 0 alone is not enough: a stale goal, topic or second point must never pass.
 */
function setupIsBlank(o) {
    const values = [o.goal, o.topic ?? '', ...o.pointValues].map((v) => v.trim());
    const carriesOld = values.some((v) => v !== '' && o.staleLabels.some((label) => label.trim() !== '' && v.includes(label.trim())));
    return o.goal.trim() === '' && (o.topic ?? '').trim() === '' && o.pointValues.length > 0
        && o.pointValues.every((v) => v.trim() === '') && !carriesOld;
}
/** Every content word of a point label appears in the transcript (case and punctuation ignored). Compared in Node only. */
function labelHeardIn(label, transcript) {
    const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'our', 'with', 'that', 'this', 'are', 'will']);
    const words = (s) => s.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);
    const heard = new Set(words(transcript));
    const content = words(label).filter((w) => w.length >= 3 && !STOP.has(w));
    return content.length > 0 && content.every((w) => heard.has(w));
}
function switchIsolationVerdict(o) {
    const fail = (detail) => ({ verdict: 'FAIL', detail });
    const hold = (detail) => ({ verdict: 'HOLD', detail });
    if (!o.railPendingBefore)
        return fail('the Focus rail was not all-pending before the take (state carried over from Open Mic)');
    if (!o.openMicId)
        return fail('no saved Open Mic source take to switch from');
    // Missing source proof cannot mask an independently observed identity, product or carry-over failure.
    if (o.staleCoachingBeforeStart)
        return fail('the Open Mic take\'s coaching was shown on Focus Points before the new take started');
    if (!o.focusId || o.focusId === o.openMicId)
        return fail('the take after the switch did not save as its own session');
    if (o.savedProduct !== 'focus_points')
        return fail('the take after the switch was not saved as Focus Points');
    if (o.finalStatuses.length !== 4 || o.finalStatuses.some((s) => s === null))
        return fail('incomplete marker observation: the rail did not show exactly four readable point verdicts');
    if (o.finalStatuses[0] !== 'covered')
        return fail('no current-take recognition: point 1, the only point this take heard, was not detected');
    if (o.finalStatuses.slice(1).some((s) => s !== 'missing'))
        return fail('old-take carry-over: a point spoken only in the earlier Open Mic take was detected in the new take');
    for (const source of [o.openMicBefore, o.openMicAfter]) {
        if (source.state === 'malformed')
            return fail('the Open Mic source has contradictory transcript state');
        if (source.state === 'expired' && source.digest !== null)
            return fail('the expired Open Mic source still has transcript content');
        if (source.state && ((source.sessionId && source.sessionId !== o.openMicId) || (o.ownerId && source.userId && source.userId !== o.ownerId)))
            return fail('the Open Mic source identity changed');
        if (source.product !== null && source.product !== 'open_mic')
            return fail('the earlier Open Mic session changed product');
    }
    for (const source of [o.openMicBefore, o.openMicAfter]) {
        if (source.state === 'missing' || source.state === 'query_error')
            return hold('the Open Mic source row could not be read; retention and isolation are unproven');
        if (source.state && (!o.ownerId || !source.sessionId || !source.userId))
            return hold('the Open Mic source identity is incomplete');
    }
    if (o.openMicAfter.state === 'expired' && (o.openMicBefore.state !== 'available' || !o.openMicBefore.digest)) {
        return hold('expiry without a prior positive saved transcript does not prove an unchanged source take');
    }
    if (o.openMicBefore.product !== 'open_mic' || !o.openMicBefore.digest)
        return fail('no saved Open Mic source take to switch from');
    const expiredAfterWitness = o.openMicBefore.state === 'available' && o.openMicAfter.state === 'expired'
        && o.openMicAfter.digest === null && o.openMicAfter.product === 'open_mic';
    if (!expiredAfterWitness && (o.openMicBefore.product !== o.openMicAfter.product || o.openMicBefore.digest !== o.openMicAfter.digest)) {
        return fail('the earlier Open Mic session changed (product or transcript)');
    }
    if (o.markerSupport.length !== 3 || o.markerSupport.some((heard) => !heard)) {
        return { verdict: 'HOLD', detail: 'the earlier Open Mic take did not recognise every marker point, so their absence cannot prove isolation' };
    }
    return { verdict: 'PASS', detail: expiredAfterWitness
            ? 'the Focus take heard only its own audio, saved as Focus Points, and the previously witnessed Open Mic transcript lawfully expired without changing its identity'
            : 'the Focus take after Open Mic heard only its own audio (point 1 detected; the three points the Open Mic take recognised were absent), saved as Focus Points, and left the Open Mic take unchanged' };
}
function focusBackReloadVerdict(o) {
    const fail = (detail) => ({ verdict: 'FAIL', detail });
    if (!o.leftForProgress)
        return fail('the header Progress link did not open Progress');
    if (!o.restoredAfterBack)
        return fail('browser Back did not restore this saved session');
    if (o.idleRecorderShown)
        return fail('the idle recorder was shown instead of the saved session');
    if (o.liveMicTracksAfterBack !== 0)
        return fail('a microphone was live (or unreadable) right after Back');
    if (!o.restoredAfterReload || !o.sameSessionAfterReload)
        return fail('a reload did not restore the same saved session');
    if (o.liveMicTracks !== 0)
        return fail('a microphone was live on the restored session');
    if (!o.transcriptMatchesSaved)
        return fail('the restored transcript is not the saved one');
    // Browser PM RETURN on c76283d12: the rehearsal take keeps its transcript and Focus results, so with no saved coaching the
    // only correct view is Try again — after Back AND after the reload; `not_available` is never a waiver.
    const expected = o.coachingSaved ? 'saved' : 'try_again';
    if (o.reviewAfterBack !== expected)
        return fail(`after Back the review was ${o.reviewAfterBack}, expected ${expected}`);
    if (o.reviewAfterReload !== expected)
        return fail(`after the reload the review was ${o.reviewAfterReload}, expected ${expected}`);
    if (o.verdictsBefore.length === 0 || o.verdictsBefore.join(',') !== o.verdictsAfter.join(','))
        return fail('the saved point verdicts were unreadable or changed');
    if (o.coachingRequestsAfter !== o.coachingRequestsBefore)
        return fail('Progress, Back or the reload requested coaching');
    return { verdict: 'PASS', detail: 'Progress → Back and a reload restored the same saved Focus session read-only, with its saved transcript, verdicts and review, and requested nothing' };
}
/**
 * "PRACTICE AGAIN", THROUGH THE CONTROLS A PERSON PRESSES (PM 2026-09-26, after #1533).
 *
 * The fresh-session next Start (`nextStartEvidence`) never touches the two repeat actions the runbook uses, and
 * #1533 showed that is where a stale "Finishing up" could land. So, from the saved session's Analytics detail:
 *   1. press the ONE practice action (`saved-review-practice`): the same product opens — for Focus Points the same set,
 *      every point pending again (compared in memory; only booleans reach the receipt);
 *   2. record a short take that SAVES (≥ the 5 s no-persist guard), so the completed-session review appears;
 *   3. press that review's own repeat action (Open Mic "Practice this again" / Focus "Retry this set") at once — the
 *      just-saved take's own evaluation must not hold it: it is enabled, no "Finishing up" shows, recording starts;
 *   4. stop within the no-persist guard (nothing more is saved) and confirm every microphone track ended.
 * A step the page never reached is a HOLD with its reason — never a PASS. The detail is opened by URL; the list path
 * into it is proven by the reopen rows.
 */
/**
 * #1258 R6 (PM 6134474736) — the reopened Focus set is the SAME set, in the SAME order, every point pending again:
 * exactly as many rows as points, each row's own label equal to its point, and every status `pending`.
 */
function sameOrderedPendingSet(labels, statuses, points) {
    return labels.length === points.length && statuses.length === points.length
        && points.every((point, i) => labels[i].trim() === point.trim())
        && statuses.every((status) => status === 'pending');
}
/** Ceiling for the gate to clear after the take saved, and for recording to begin after the press. */
exports.REPEAT_START_CEILING_MS = 15_000;
/**
 * #1258 (PM ruling): an honest "Finishing up your last session" wait is allowed. The repeat action must stay fenced while
 * it shows, the gate must clear, and recording must begin after the press. FAIL when the action was enabled while the wait
 * showed, when the gate never cleared within the ceiling, or when recording did not begin within the ceiling.
 */
function repeatStartVerdict(ev) {
    if (ev.enabledWhileHolding === true) {
        return { status: 'FAIL', detail: 'the repeat action was enabled while "Finishing up your last session" was still shown' };
    }
    if (ev.afterActionEnabledMs === null || ev.afterActionEnabledMs >= exports.REPEAT_START_CEILING_MS) {
        return { status: 'FAIL', detail: 'the start gate did not clear: the repeat action was not enabled within 15 s of the review' };
    }
    if (ev.afterStartMs === null)
        return { status: 'FAIL', detail: ev.reason ?? 'recording did not begin' };
    if (ev.afterStartMs >= exports.REPEAT_START_CEILING_MS)
        return { status: 'FAIL', detail: 'recording did not begin within 15 s of the press' };
    return {
        status: 'PASS',
        detail: ev.holdSeen
            ? 'the honest "Finishing up" wait kept the action fenced, the gate cleared, and recording began'
            : 'the repeat action was offered at once and recording began',
    };
}
