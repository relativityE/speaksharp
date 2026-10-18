# SpeakSharp financial model — review record (price sensitivity refresh)

**Status:** Unvalidated financial-planning artifact  
**As of:** 2026-10-12  
**Workbook:** `SpeakSharp_Updated_Financial_Model_2026-10-12.xlsx`  
**SHA-256:** `0be91eb36743ff3260b651fe03fff039b01c4cff140618ce5b9ad3ba89e17575`
**Supersedes:** `FINANCIAL_MODEL_REVIEW_2026-09-05.md` and its workbook, which are kept unchanged
as the prior point-in-time record.

This workbook is an unvalidated planning forecast, not retained evidence, a product promise,
release-status authority, or authorization to change price, activate billing, or set a tester
cohort size. The $7 and $5 columns are sensitivity cases, not proposed prices. Trial volume,
conversion, paid lifetime, usage, CAC, willingness to pay, and revenue remain unmeasured
hypotheses.

## What changed from 2026-09-05

1. **Vendor prices re-checked on 2026-10-12.** Supabase Pro ($25), Vercel Pro ($20 platform fee
   with $20 usage credit), Sentry (Developer $0; Team $26/month billed annually), PostHog (free
   allowances), Stripe (2.9% + $0.30; Billing 0.7%), GitHub (repository still public), and Gemini
   pricing all match the prior review. The software stack stays $45/month lean and $71/month
   monitored. `Sources` dates each row; rows still dated 2026-09-05 were not re-checked.
   - $45 and $71 are list base-fee assumptions, not invoices or total-spend guarantees.
   - $71 uses the annual-billing monthly equivalent of Sentry Team ($312/year), not a proven
     monthly cash payment.
   - Private STT runs on the device, so there is no hosted per-audio inference charge. Model
     download, storage and CDN overages are excluded.
2. **AI coding tools added as a fixed cost (Product Owner direction).** `Assumptions!B43:F51` records
   the pre-launch spend of Codex Pro ($100) + Claude Max 5x ($100) and the post-launch options of
   one $20 plan or two ($40).
   - The PO stated that the $200 applies before launch only and drops to $20–$40 at launch. The
     forecast therefore uses the **$20 base** and treats $40 as a sensitivity. The $200 is shown
     for reference and is not in the forecast.
   - A dropdown in `B50` selects the level, `B51` holds the result, and `Selected fixed OpEx`
     (`B28`) is the selected stack plus `B51`, giving $65/month all-in in the base case.
   - Stack-only figures (`Unit Economics` break-even, the Summary history table) are kept for
     like-for-like comparison with earlier models.
3. **New `Launch Cap Plan` sheet (Product Owner direction).**
   - At most **100 active users (trial + paid) for months 1–3**, then a gradual linear rise to
     **250 by month 12**.
   - Free slots under the cap are filled with 30-day trials. Trial users who do not convert leave
     the active count. Conversion, lifetime, usage and fixed OpEx come from `Assumptions`.
   - It also states how many paying users, and what conversion, the cap needs in order to break
     even.
   - `Forecast 12M` and `Price Sensitivity` remain the uncapped 500-trials/month case.
4. **New `Key` sheet** explaining each term in plain English next to its live number: price,
   trial, user cap, Stripe fee, contribution, contribution margin, break-even, LTV, CAC, the 3:1
   CAC ceiling, payback, timing, and the main assumptions and exclusions.
5. **Coaching model relabeled to Gemini 3.8 Flash.** `contract.json` on `main` names
   `gemini-3.8-flash` (#1586, merged 2026-10-11). Its published price is identical to the
   Gemini 3.6 Flash schedule the prior model already used ($0.75/$3.75 per 1M tokens through
   2026-12-31, then $1.50/$7.50), so no cost output changes.
6. **New `Price Sensitivity` sheet** comparing $10 with $7 and $5 under the uncapped ramp,
   including a break-even table by AI-tools spend.
7. **New assumptions:**
   - `Assumptions!B32`: coaching cap of 10 uncached **generations** per user per UTC day, from
     `contract.json`.
   - `Assumptions!B33`: thinking tokens per call, an illustrative 1,000; unmeasured.
   - `Assumptions!B55:B57`: days in the longest month (31, so 310 generations), base billed provider
     attempts per generation (1), and the retry worst case (2).
   - A generation is not a provider call. `index.ts` consumes quota once and allows
     `AI_PROVIDER_ATTEMPTS = 2`, with a second attempt only after a transport error, timeout or
     provider 5xx. Whether failed attempts are billed is unknown, so retries are a separate
     sensitivity and are not in the headline results.
8. **Forecast month-index repair.** Every `Forecast 12M` formula depends on row 3 (`Month #`
   1–12), but that row sat inside the subtitle merge `A2:M3`. Opening and saving the 2026-09-05
   workbook with a merge-respecting writer (reproduced with openpyxl) dropped the row and
   recalculated active paid users to 0 in every month. Row 3 is now visible and unmerged.
   `Checks!F24` requires the row to be exactly 1–12 in order, so a missing, duplicated or
   permuted month fails even when the sum stays 78.
9. **Checks completed and hardened.**
   - Row 20 had no status because its cells sat inside the `D18:G20` note merge; the note now spans
     `D18:G19`.
   - Summary timing cells show "none in 12" instead of `#N/A`.
   - `Checks!F33:F35` cover the cap plan: it never exceeds the active-user cap, the one-month
     trial its slot logic assumes, and a month-1 tie.
   - `MODEL STATUS` covers `F20:F35`.
10. **Thinking companion rows (PM correction, #1599).** Headline results exclude Gemini thinking
    tokens and provider retries, and are labelled that way. `Price Sensitivity` rows 65–76 apply
    the illustrative 1,000 thinking tokens to paid **and** trial users together. In the uncapped
    case this adds $37.50/month of trial coaching cost alone.

## Results

Contribution uses the higher 2027 Gemini price. "All-in" means stack + AI coding tools + coaching
for trial users. Unless a row says "with thinking", results **exclude Gemini thinking tokens and
provider retries**. Thinking rows are scenarios at an illustrative 1,000 tokens per call, not
measured profitability.

### Launch Cap Plan (100 active users for 3 months, linear rise to 250 by month 12; AI tools $20)

| Output | $10 | $7 | $5 |
| --- | ---: | ---: | ---: |
| Paying users at month 12 (2% conversion) | 21.2 | 21.2 | 21.2 |
| Operating profit in month 12 | $119.63 | $58.40 | $17.58 |
| 12-month cumulative cash | $365.75 | −$17.33 | −$272.71 |
| First profitable month / cumulative cash ≥ $0 | 5 / 9 | 7 / none in 12 | 10 / none in 12 |
| Same, with AI tools at $40 | 6 / 11 | 9 / none | none / none |
| Paying users needed to break even at the 100-user cap | 7.5 (7.5%) | 10.9 (10.9%) | 15.5 (15.5%) |
| Conversion needed to hold that at the 100-user cap (steady state) | 1.36% | 2.04% | 3.07% |
| Paying users needed to break even at the 250-user cap | 8.4 (3.3%) | 12.1 (4.8%) | 17.3 (6.9%) |

At 2% conversion the 100-user cap settles at about 10.7 paying users and the 250-user cap at about
26.8, but only if the cap is held long enough; the 12-month ramp does not get there.

### Uncapped case (500 trials/month; AI tools $20)

| Output | $10 | $7 | $5 |
| --- | ---: | ---: | ---: |
| Stripe Payments + Billing per charge | $0.66 (6.6%) | $0.552 (7.9%) | $0.48 (9.6%) |
| Contribution per paid user | $9.2875 | $6.3955 | $4.4675 |
| Break-even paid users — lean + trial coaching (no AI tools) | 8 | 12 | 16 |
| **Break-even paid users — all-in, AI tools $20** | **10** | **15** | **21** |
| Break-even paid users — all-in, AI tools $40 | 12 | 18 | 25 |
| Break-even paid users — lean + trial coaching, with thinking | 12 | 18 | 25 |
| Break-even paid users — all-in, AI tools $20, with thinking | 14 | 21 | 30 |
| Monthly profit at 60 paid — all-in, AI tools $20 | $466.00 | $292.48 | $176.80 |
| Monthly profit at 60 paid — lean only, no thinking / with thinking | $486.00 / $444.00 | $312.48 / $270.48 | $196.80 / $154.80 |
| Monthly profit at 60 paid — all-in, AI tools $20, with thinking | $424.00 | $250.48 | $134.80 |
| Organic: first profitable month / cumulative cash ≥ $0 | 2 / 3 | 3 / 4 | 3 / 5 |
| Paid CAC at own ceiling: first profitable month / cumulative ≥ $0 | 4 / 7 | 5 / 8 | 6 / 11 |
| Trial-to-paid conversion needed to match $10 profit (no thinking) | 2.00% | 2.90% | 4.16% |
| 3:1 CAC ceiling | $18.58 | $12.79 | $8.94 |
| Thinking tokens per call where a paid user at the cap (310 generations) turns negative | 3,317 | 2,073 | 1,244 |
| Same, if both provider attempts are billed for every generation (retry worst case) | 1,309 | 687 | 272 |

For reference, the $200 pre-launch tool spend would make uncapped all-in break-even 30 / 43 / 61
paid users.

## Open risk recorded, not resolved

The coaching function sets no `thinking_level`, so Gemini 3.8 Flash uses its default (`medium`),
and thinking tokens are billed at the output rate. No code path records `usageMetadata` or
`thoughtsTokenCount`, so the real cost per coaching call is unmeasured.
- At the modeled 10 calls per month the per-user amount is small.
- Across trial users it adds up: $37.50/month at 500 trials.
- For a paid user at the cap (310 generations in a 31-day month), it decides whether that user is
  contribution-positive at lower prices.

The thinking cost is unknown and is not treated as negligible. Measurement is deferred under
#1259/#1491. No pricing, cohort-size or `thinking_level` change is assigned.

## Verification performed

### Status-control correction — 18 October 2026

Sam's bounded review at #1599 comment6251940867 reproduced text in `Assumptions!B33`
causing calculation errors while the model status still said PASS. `Checks!A18` now
requires all 27 expected checks to say `OK`. Its existing link to `Key!C62` is unchanged.
Only that formula changed; assumptions, pricing scenarios, layout and every other
workbook package entry are preserved from source `764890c3` (prior workbook hash
`3c08c02b1820a4678eb894a358bf874fed69737e8f1ff7f5a7f323c1ab83f582`).

Native LibreOffice verification: 16 controls PASS across 20 recalculations. Default
results retain 1,517 formulas, zero errors and PASS. Text B33 reproduces the original
false PASS and changes both corrected status locations to FAIL. Blank, error,
unrecognized and FAIL check statuses cannot pass. Swapped/equal-sum duplicate/blank
months, cap below the paying base and a two-month trial remain FAIL. The $20, $40
and Exclude tool selections preserve every calculated output; an openpyxl
save/recalculate round-trip preserves the same results. Native recalculation is
LibreOffice evidence; Microsoft Excel was not independently exercised.

Artifact Tool authored the formula. Its full export normalizes unrelated style
metadata, so the authored formula was transferred into the original package to
preserve all unrelated content and native features. Changed status views were rendered
before and after the correction. Executable local controls are preserved under
`local-packets/1599-model-status-control/`. This correction does not change pricing,
billing or release policy.

### Prior workbook validation at source 764890c3

- LibreOffice recalculation: 1,517 formulas, 0 errors; all checks `OK`; `MODEL STATUS: PASS`.
- Price Sensitivity ties to `Forecast 12M` and `Unit Economics` (`Checks!F25:F30`).
  - `Checks!F31` ties the forecast's fixed cost to stack + AI tools.
  - `Checks!F32` ties the companion added trial thinking cost.
- Launch Cap Plan:
  - Its profit rows, timing, and $40 sensitivity match an independent script recomputation of
    the same cohort logic.
  - Lowering the year-end cap below the paying base turns `Checks!F33` and `MODEL STATUS` to
    `FAIL`.
  - Setting a two-month trial turns `Checks!F34` to `FAIL`.
- With AI tools excluded, the outputs equal the stack-only figures, which reproduce the
  2026-09-05 model.
- Negative controls on the month index all turn `Checks!F24` and `MODEL STATUS` to `FAIL`:
  - swapping months 1 and 2 (sum stays 78);
  - duplicating one month and dropping another (sum stays 78);
  - blanking one month.
- The companion rows reproduce PM's independent figures: 12/18/25 users, $444.00/$270.48/$154.80,
  and $37.50.
- Round-trip control: opening and re-saving the workbook with openpyxl, then recalculating,
  preserves both forecasts.

Taxes, refunds, founder compensation, one-time legal/accounting costs, and usage overages beyond
vendor allowances remain excluded. The forecast start date (2026-09-01) is unchanged. Month
numbers count from the forecast start, which is treated as launch; its first month is the trial
month. They are not calendar dates.
