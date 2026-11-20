'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RPC, decidePrivacyTerminal } = require('./j4a-privacy-terminal-review.cjs');
function fixture() {
    const id = { owner: '11111111-1111-4111-8111-111111111111', binding: 'a'.repeat(64), runId: 'offline-privacy-fixture' };
    const attempt = 'b'.repeat(64);
    return [
        { ...id, attempt }, { ...id, newlyRunOwned: true, exactOwnerConfirmed: true },
        { ...id, independent: true, ownerScoped: true, rows: [], ordinal: 1 },
        { ...id, allRelevantWritersObserved: true, armedBeforeAnyWriter: true, closedOrdinal: 3, writers: [
            { ...id, attempt, path: RPC, method: 'POST', admitted: true, forwarded: true, ordinal: 2,
                payload: { p_expected_revision: null, p_transcript_save: true, p_ai_coaching: false } },
        ] },
        { ...id, independent: true, ownerScoped: true, ordinal: 4,
            rows: [{ user_id: id.owner, choice_revision: 1, consent_version: 1, transcript_save: true, ai_coaching: false }] },
    ];
}
const negative = (title, change, reason) => test(title, () => {
    const f = fixture();
    change(...f);
    assert.deepEqual(decidePrivacyTerminal(...f), { verdict: 'HOLD', reason });
});
test('one exact first-choice RPC with a complete writer observation attributes the exact independent row offline', () => {
    assert.deepEqual(decidePrivacyTerminal(...fixture()), { verdict: 'TERMINAL_ROW_ATTRIBUTED', reason: null });
});
negative('maintained owner is not eligible', (_, a) => { a.newlyRunOwned = false; }, 'owner-not-proven');
negative('existing consent lacks attribution to this attempt', (_, a, b) => { b.rows.push({ choice_revision: 1 }); }, 'baseline-not-absent');
negative('incomplete observation never proves a single writer', (_, a, b, g) => { g.allRelevantWritersObserved = false; }, 'writer-coverage');
negative('direct authenticated table write can create the same first choice row', (_, a, b, g) => { g.writers[0].path = '/rest/v1/practice_privacy_choices'; }, 'not-exact-first-choice-rpc');
negative('second direct writer invalidates matching row even if denied', (_, a, b, g) => { g.writers.push({ path: '/rest/v1/practice_privacy_choices', admitted: false }); }, 'ambiguous-writers');
negative('second identical RPC is ambiguous even if row stays revision one', (_, a, b, g) => { g.writers.push({ ...g.writers[0] }); }, 'ambiguous-writers');
negative('expected revision not null is not a first choice', (_, a, b, g) => { g.writers[0].payload.p_expected_revision = 1; }, 'not-exact-first-choice-rpc');
negative('differing consent payload is not the expected first choice', (_, a, b, g) => { g.writers[0].payload.p_ai_coaching = true; }, 'not-exact-first-choice-rpc');
negative('cross-run observation refused', (_, a, b, g, r) => { r.runId = 'other'; }, 'identity');
negative('a zero read after forwarding is unresolved, not refusal', (_, a, b, g, r) => { r.rows = []; }, 'forwarded-outcome-unresolved');
negative('read while writer observation still open is unresolved', (_, a, b, g, r) => { r.ordinal = 3; }, 'forwarded-outcome-unresolved');
negative('only independent owner readback can attribute a choice', (_, a, b, g, r) => { r.independent = false; }, 'forwarded-outcome-unresolved');
for (const [k,v] of Object.entries({user_id:'wrong-owner',choice_revision:2,consent_version:2,transcript_save:false,ai_coaching:true})) {
    negative('wrong row field ' + k, (_, a, b, g, r) => { r.rows[0][k] = v; }, 'forwarded-outcome-unresolved');
}
