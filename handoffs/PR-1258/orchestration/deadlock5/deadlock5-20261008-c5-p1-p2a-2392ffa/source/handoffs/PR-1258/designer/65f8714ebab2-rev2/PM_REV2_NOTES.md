# PM instructions for Rev 2 — 7 October 2026

The four Designer files in this packet are preserved unchanged from the PO's uploaded Rev 2 ZIP. Build from Rev 2, not a mixture of Rev 1 and Rev 2. Read these notes first where an original document conflicts with the current PO instruction or implementation contract.

## Seven UI changes approved for implementation

Use `Clear delivery` as the visible sentence-case label (uppercase only for styled eyebrows). Units go in labels, e.g. `Pace (wpm) 95`; numbers align right in columns. Open is navy; PDF is yellow. Use the confirmed persisted filler contract and 13 human-readable labels. Exclude unmeasured pause records instead of showing zero. Tint surfaces use theme colours. Keep R2-1 through R2-7 as explicit acceptance checks.

## First-name proposal is pending, not part of the seven-change batch

The uploaded README and C8/R2-8 sections propose a new `user_profiles.first_name` column, `set_first_name` RPC and three editing surfaces. This conflicts with the PO's accompanying instruction: the profile-name question is still open and the greeting stays unnamed meanwhile. Therefore use the unnamed factual greeting now; never infer a name from email. Do not implement UI that calls a nonexistent RPC. Record the first-name proposal as a separate scope/migration decision rather than blocking these five UI concerns. No Production migration is authorized by this handoff. If approved later, review authentication, narrow update authority, EXECUTE grants and signup/session ordering separately.

## Coaching contract remains current

S2's `each <=6 words` is stale. Answer the defined coaching questions using transcript evidence and relevant measured signals. Request around 10 words per phrase as a prompt target, never a word-count rejection or truncation rule. Preserve current product-specific payload versions and validated shapes; do not force all products into the old `gemini_coaching_v1` example. Saved reviews show persisted text verbatim; a revisit does not generate new coaching automatically. Explicit retry stays distinct from read-only saved-review display.

## Preserve the measured-data contracts

Use `getSessionAnalysisMetrics(session)` for UI adaptation and the validated `filler_counts` contract beneath it. Valid `{}` means measured zero; missing, malformed or null means unmeasured. Counts remain integers, not converted per-minute averages. Compare the two newest usable filler measurements and show their actual dates.

Call the existing `hasValidPauseEvidence` helper rather than copying a simplified validator from prose. At the inspected source it requires four finite fields: `silencePercentage`, `transitionPauses`, `extendedPauses` and `longestPause`. The Rev 2 prose lists only three. A valid all-zero measurement is retained; missing evidence is excluded from chart, summary and sample count. The three-sample threshold is a chart rule, not a change to core Progress eligibility.

Product comes from persisted `session.product`, never its title. Keep the Compare feature with its visible label. Do not treat the layout redesign as proof that recognition, filler consistency, provider failure or real-engine teardown is fixed.

## Execution and evidence

Keep the Designer's five concerns: (1) copy/navigation, (2) failed-review band, (3) transcript/count presentation, (4) saved-session return, (5) Progress. Continue any existing concern in its own worktree; inspect the changes document if Rev 1 work already started. Preserve approved fixes and test IDs rather than discarding working code because its original guide was Rev 1.

For each concern, report exact head/base/tree, changed files, relevant regression results and outstanding deployed proof. Returning must restore an owned saved session, survive recorder reset and remain separate from starting a fresh take. It must not silently start a recording or regenerate coaching. Test deleted/unowned sessions and product switches too.

An attachment's publication does not prove receipt: Dev should ACK this exact Rev 2 source and identify the active concern. CLI PM should reconcile the handoff and assign any independent concern to the other Dev without overlapping worktrees or local test runs.
