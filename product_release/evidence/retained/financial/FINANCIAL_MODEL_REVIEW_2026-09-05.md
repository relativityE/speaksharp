# SpeakSharp financial model — review record

**Status:** Retained financial-planning evidence  
**As of:** 2026-09-05  
**Workbook:** `SpeakSharp_Updated_Financial_Model_2026-09-05.xlsx`  
**SHA-256:** `a2963f8124be722aabc8d710b63afe0760cf872b5fc633400d1062f20f765674`

This workbook is a forecast, not a product promise, release-status authority, or
authorization to activate billing. Product requirements and current release posture remain
in their canonical files.

## Current source inputs checked

- Product price and trial: `product_release/PRODUCT_REQUIREMENTS.md` — complete product
  free for 30 days, then $10/month.
- Current coaching model:
  `backend/supabase/functions/get-ai-suggestions/index.ts` —
  `gemini-3-flash-preview`.
- Current checked-in Private STT candidate:
  `frontend/src/config/private-stt.config.json` — `v2:base.en`.
- Vendor prices: the official URLs retained on the workbook's `Sources` sheet,
  accessed 2026-09-05.
- Historical $7.99/$14.99 pricing, conversion, lifetime, and ramp assumptions are
  comparison inputs from the archived planning sources named in the workbook. They are
  not treated as current product facts.

## Base-case outputs

| Output | Value |
| --- | ---: |
| Lean fixed software OpEx | $45/month |
| Monitored fixed software OpEx | $71/month |
| Contribution per paid user | $9.2875/month |
| Contribution margin | 92.875% |
| Lean break-even paid users | 5 |
| Monitored break-even paid users | 8 |
| Six-month contribution LTV | $55.725 |
| 3:1 CAC ceiling | $18.575 |
| Organic monthly profit begins | Month 2 |
| Organic cumulative cash turns positive | Month 2 |
| Paid-CAC monthly profit begins | Month 4 |
| Paid-CAC cumulative cash turns positive | Month 6 |

Taxes, founder compensation, and one-time legal/accounting costs are excluded. The model
starts incremental cash at zero and is not a runway model unless starting cash is supplied.

## Independent review corrections

The recovered workbook contained one misleading comparison formula:
`Assumptions!E41` displayed Gemini cost ($0.0525) under
`Contribution / paid user`. It now references `Unit Economics!B11` and displays
$9.2875.

The review also:

- replaced five scratch-machine absolute source paths with repository-relative paths;
- added a `Checks` assertion tying the current comparison contribution to the
  authoritative unit-economics calculation;
- confirmed all workbook checks report `OK` and `MODEL STATUS: PASS`;
- scanned the workbook for common formula errors with no matches;
- visually reviewed all nine worksheets after the correction;
- reconciled representative forecast, LTV, CAC, break-even, and historical-comparison
  outputs to their stated assumptions.

## Closure evidence

Before merge:

1. independently inspect this review record and the workbook;
2. confirm the exact workbook SHA-256 shown above;
3. confirm the PR changes only this retained financial-analysis package;
4. complete exact-head repository CI; and
5. reconcile the independent Codex review.
