"use strict";
// Nightly AHT suite, J9.a `old-sessions-no-new-coaching` (#1864, 098f0ae). Opening the kept sessions after a release
// sends no coaching request (J9's budget is 0) and the stored coaching still reads. A request means the stored format
// no longer parses after the upgrade, which fails the row. Setup checks before the release that every kept session has
// stored coaching and the row is HOLD if one doesn't, so a session whose coaching never stored can't fail it falsely.
// Every count must be observed as a whole number, or the row is HOLD: a missing counter never passes it.
const isCount = (n) => Number.isInteger(n) && n >= 0;
const unobserved = (o, keys) => keys.filter((k) => !isCount(o?.[k]));
function oldSessionsNoNewCoachingVerdict(pre, seen) {
    const notChecked = unobserved(pre, ['keptSessions', 'withStoredCoaching']);
    if (notChecked.length > 0)
        return { outcome: 'HOLD', detail: `no pre-release check of the kept sessions: not observed: ${notChecked.join(', ')}` };
    if (pre.keptSessions === 0)
        return { outcome: 'HOLD', detail: 'no kept sessions were checked before the release' };
    if (pre.withStoredCoaching < pre.keptSessions) {
        return { outcome: 'HOLD', detail: `${pre.keptSessions - pre.withStoredCoaching} kept session(s) had no stored coaching before the release` };
    }
    const notSeen = unobserved(seen, ['sessionsOpened', 'coachingRequests', 'storedCoachingRendered']);
    if (notSeen.length > 0)
        return { outcome: 'HOLD', detail: `not observed after the release: ${notSeen.join(', ')}` };
    if (seen.sessionsOpened < pre.keptSessions)
        return { outcome: 'FAIL', detail: `opened ${seen.sessionsOpened} of ${pre.keptSessions} kept sessions` };
    const problems = [];
    if (seen.coachingRequests > 0)
        problems.push(`${seen.coachingRequests} coaching request(s) sent while reopening`);
    if (seen.storedCoachingRendered < seen.sessionsOpened)
        problems.push(`stored coaching read on ${seen.storedCoachingRendered} of ${seen.sessionsOpened} sessions`);
    return problems.length > 0 ? { outcome: 'FAIL', detail: problems.join('; ') } : { outcome: 'PASS', detail: 'kept sessions read their stored coaching with no new request' };
}

module.exports = { oldSessionsNoNewCoachingVerdict };
