# SpeakSharp financial model — review record (price sensitivity refresh)

**Status:** Unvalidated financial-planning artifact  
**As of:** 2026-10-12  
**Workbook:** `SpeakSharp_Updated_Financial_Model_2026-10-12.xlsx`  
**SHA-256:** `c01c43c4c33daab58469711c198e1d7314c779d43d838beb51289bece2cc5272`  
**Supersedes:** `FINANCIAL_MODEL_REVIEW_2026-09-05.md` and its workbook, which are kept unchanged
as the prior point-in-time record.

This workbook is an unvalidated planning forecast, not retained evidence, a product promise,
release-status authority, or authorization to change price or activate billing. The $7 and $5
columns are sensitivity cases, not proposed prices. Trial volume, conversion, paid lifetime,
usage, CAC, willingness to pay, and revenue remain unmeasured hypotheses.

## What changed from 2026-09-05

1. **Vendor prices re-checked on 2026-10-12.** Supabase Pro ($25), Vercel Pro ($20 platform fee
   with $20 usage credit), Sentry (Developer $0; Team $26/month billed annually), PostHog (free
   allowances), Stripe (2.9% + $0.30; Billing 0.7%), GitHub (repository still public), and Gemini
   pricing all match the prior review. Lean fixed OpEx stays $45/month and monitored stays
   $71/month. `Sources` dates each row; rows still dated 2026-09-05 were not re-checked.
2. **Coaching model relabeled to Gemini 3.8 Flash.** `contract.json` on `main` names
   `gemini-3.8-flash` (#1586, merged 2026-10-11). Its published price is identical to the
   Gemini 3.6 Flash schedule the prior model already used ($0.75/$3.75 per 1M tokens through
   2026-12-31, then $1.50/$7.50), so no cost output changes.
3. **New `Price Sensitivity` sheet** comparing $10 with $7 and $5 under the same ramp.
4. **New assumptions** `Assumptions!B32` (coaching cap: 10 uncached calls per user per UTC day,
   from `contract.json`) and `Assumptions!B33` (thinking tokens per call, an illustrative 1,000;
   unmeasured).
5. **Forecast month-index repair.** Every `Forecast 12M` formula depends on row 3 (`Month #`
   1–12), but that row sat inside the subtitle merge `A2:M3`. Opening and saving the 2026-09-05
   workbook with a merge-respecting writer (reproduced with openpyxl) dropped the row and
   recalculated active paid users to 0 in every month. Row 3 is now visible and unmerged, and a
   new check (`Checks!F24`) fails if it is missing.
6. **Checks row 20 completed.** The 2026 variable-cost tie had no difference or status because
   those cells sat inside the `D18:G20` note merge. The note now spans `D18:G19`, and row 20
   reports its status. `MODEL STATUS` now covers `F20:F30`.

## Price sensitivity outputs

Contribution uses the higher 2027 Gemini price. "+ trial coaching" adds the $26.25/month coaching
cost of 500 active trials, which pay nothing.

| Output | $10 | $7 | $5 |
| --- | ---: | ---: | ---: |
| Stripe Payments + Billing per charge | $0.66 (6.6%) | $0.552 (7.9%) | $0.48 (9.6%) |
| Contribution per paid user | $9.2875 | $6.3955 | $4.4675 |
| Break-even paid users — lean only | 5 | 8 | 11 |
| Break-even paid users — lean + trial coaching | 8 | 12 | 16 |
| Break-even paid users — monitored + trial coaching | 11 | 16 | 22 |
| Steady-state monthly profit (60 paid, lean) | $486.00 | $312.48 | $196.80 |
| Paid users needed to match $10 profit | 60 | 87.1 | 124.7 |
| Trial-to-paid conversion needed for that | 2.00% | 2.90% | 4.16% |
| 3:1 CAC ceiling | $18.58 | $12.79 | $8.94 |
| Organic: first profitable month / cumulative cash ≥ $0 | 2 / 3 | 2 / 3 | 3 / 4 |
| Paid CAC at own ceiling: first profitable month / cumulative ≥ $0 | 4 / 7 | 4 / 7 | 5 / 9 |
| Thinking tokens per call where a user at the daily cap turns negative | 3,451 | 2,166 | 1,309 |

Break-even price at a given paid base (lean + trial coaching): $7.76 at 10 paid users, $4.06 at
20, $2.83 at 30, and $1.60 at 60.

## Open risk recorded, not resolved

The coaching function sets no `thinking_level`, so Gemini 3.8 Flash uses its default (`medium`),
and thinking tokens are billed at the output rate. No code path records `usageMetadata` or
`thoughtsTokenCount`, so the real cost per coaching call is unmeasured. At the modeled 10 calls
per month the exposure is small. For a user at the 10-per-day cap (300 calls per month), it
decides whether that user is contribution-positive at lower prices. Measuring it is a successor
item, not part of this artifact.

## Verification performed

- The $10 column reproduces the 2026-09-05 outputs exactly. Checks `F25:F30` tie it to
  `Unit Economics` and to `Forecast 12M` rows 26, 41, and 44.
- LibreOffice recalculation: 1,092 formulas, 0 errors; all checks `OK`; `MODEL STATUS: PASS`.
- Negative control: setting one `Forecast 12M` month index to 0 turns `Checks!F24` and
  `MODEL STATUS` to `FAIL`.
- Round-trip control: opening and re-saving the new workbook with openpyxl, then
  recalculating, preserves the forecast (`Active paid users` 0, 10, 20 … 60).
- The $7 and $5 outputs match an independent script recomputation of the same formulas.

Taxes, refunds, founder compensation, one-time legal/accounting costs, and usage overages beyond
vendor allowances remain excluded. The forecast start date (2026-09-01) is unchanged. Month
numbers count from the forecast start, whose first month is the trial month; they are not
calendar dates.
