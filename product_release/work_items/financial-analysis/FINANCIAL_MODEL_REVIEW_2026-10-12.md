# SpeakSharp financial model — review record (price sensitivity refresh)

**Status:** Unvalidated financial-planning artifact  
**As of:** 2026-10-12  
**Workbook:** `SpeakSharp_Updated_Financial_Model_2026-10-12.xlsx`  
**SHA-256:** `880fe2baedee82b54c6e83850e05ebdc255896aeddf2bd55b07d5aa84f3ff8a7`  
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
   pricing all match the prior review. The software stack stays $45/month lean and $71/month
   monitored. `Sources` dates each row; rows still dated 2026-09-05 were not re-checked.
   - $45 and $71 are list base-fee assumptions, not invoices or total-spend guarantees.
   - $71 uses the annual-billing monthly equivalent of Sentry Team ($312/year), not a proven
     monthly cash payment.
   - Private STT runs on the device, so there is no hosted per-audio inference charge. Model
     download, storage and CDN overages are excluded.
2. **AI coding tools added as a fixed cost.** The prior model left out the founder's development
   subscriptions. `Assumptions!B43:F51` adds Codex Pro ($100) and Claude Max 5x ($100), as
   reported by the Product Owner, with reduced options of two $20 plans ($40) or one ($20).
   - A dropdown in `B50` selects the level, and `B51` holds the result.
   - `Selected fixed OpEx` (`B28`) is now the selected stack plus `B51`, so the forecast and all
     "all-in" figures include it.
   - The base case is the current $200, making all-in fixed OpEx $245/month.
   - Stack-only figures (`Unit Economics` break-even, the Summary history table) are kept for
     like-for-like comparison with earlier models.
3. **New `Key` sheet** explaining each term in plain English next to its live number: price,
   trial, Stripe fee, contribution, contribution margin, break-even, LTV, CAC, the 3:1 CAC
   ceiling, payback, timing, and the main assumptions and exclusions.
4. **Coaching model relabeled to Gemini 3.8 Flash.** `contract.json` on `main` names
   `gemini-3.8-flash` (#1586, merged 2026-10-11). Its published price is identical to the
   Gemini 3.6 Flash schedule the prior model already used ($0.75/$3.75 per 1M tokens through
   2026-12-31, then $1.50/$7.50), so no cost output changes.
5. **New `Price Sensitivity` sheet** comparing $10 with $7 and $5 under the same ramp, including a
   break-even table by AI-tools spend.
6. **New assumptions:**
   - `Assumptions!B32`: coaching cap of 10 uncached **generations** per user per UTC day, from
     `contract.json`.
   - `Assumptions!B33`: thinking tokens per call, an illustrative 1,000; unmeasured.
   - `Assumptions!B55:B57`: days in the longest month (31, so 310 generations), base billed provider
     attempts per generation (1), and the retry worst case (2).
   - A generation is not a provider call. `index.ts` consumes quota once and allows
     `AI_PROVIDER_ATTEMPTS = 2`, with a second attempt only after a transport error, timeout or
     provider 5xx. Whether failed attempts are billed is unknown, so retries are a separate
     sensitivity and are not in the headline results.
7. **Forecast month-index repair.** Every `Forecast 12M` formula depends on row 3 (`Month #`
   1–12), but that row sat inside the subtitle merge `A2:M3`. Opening and saving the 2026-09-05
   workbook with a merge-respecting writer (reproduced with openpyxl) dropped the row and
   recalculated active paid users to 0 in every month. Row 3 is now visible and unmerged.
   `Checks!F24` requires the row to be exactly 1–12 in order, so a missing, duplicated or
   permuted month fails even when the sum stays 78.
8. **Checks completed and hardened.**
   - Row 20 had no status because its cells sat inside the `D18:G20` note merge; the note now spans
     `D18:G19`.
   - Summary timing cells now show "none in 12" instead of `#N/A` when a scenario never turns
     positive within the year.
   - `MODEL STATUS` covers `F20:F32`.
9. **Thinking companion rows (PM correction, #1599).** The headline results exclude Gemini
   thinking tokens and provider retries, and are labelled that way. `Price Sensitivity` rows 65–76
   apply the illustrative 1,000 thinking tokens to paid **and** trial users together. This adds
   $37.50/month of trial coaching cost alone, which is material next to the $45 stack.

## Results

Contribution uses the higher 2027 Gemini price. "Trial coaching" is the $26.25/month coaching cost
of 500 trial users, who pay nothing. "All-in" means stack + AI coding tools + trial coaching.
Unless a row says "with thinking", results **exclude Gemini thinking tokens and provider retries**.
Thinking rows are scenarios at an illustrative 1,000 tokens per call, not measured profitability.

| Output | $10 | $7 | $5 |
| --- | ---: | ---: | ---: |
| Stripe Payments + Billing per charge | $0.66 (6.6%) | $0.552 (7.9%) | $0.48 (9.6%) |
| Contribution per paid user | $9.2875 | $6.3955 | $4.4675 |
| Break-even paid users — lean stack + trial coaching (no AI tools) | 8 | 12 | 16 |
| **Break-even paid users — all-in, AI tools $200** | **30** | **43** | **61** |
| Break-even paid users — all-in, AI tools $40 | 12 | 18 | 25 |
| Break-even paid users — all-in, AI tools $20 | 10 | 15 | 21 |
| **Steady-state monthly profit, 60 paid, AI tools $200** | **$286.00** | **$112.48** | **−$3.20** |
| Steady-state monthly profit, 60 paid, AI tools $40 | $446.00 | $272.48 | $156.80 |
| Steady-state monthly profit, 60 paid, AI tools $20 | $466.00 | $292.48 | $176.80 |
| Break-even paid users — lean + trial coaching, **with illustrative thinking** | 12 | 18 | 25 |
| Break-even paid users — all-in, AI tools $200, **with illustrative thinking** | 34 | 49 | 71 |
| Monthly profit at 60 paid — lean stack only, no thinking / **with thinking** | $486.00 / $444.00 | $312.48 / $270.48 | $196.80 / $154.80 |
| Monthly profit at 60 paid — all-in, AI tools $200, with thinking | $244.00 | $70.48 | −$45.20 |
| Trial-to-paid conversion needed to match $10 profit (no thinking, any tool level) | 2.00% | 2.90% | 4.16% |
| 3:1 CAC ceiling | $18.58 | $12.79 | $8.94 |
| Organic, AI tools $200: first profitable month / cumulative cash ≥ $0 | 4 / 7 | 6 / 12 | none in 12 |
| Paid CAC at own ceiling, AI tools $200: first profitable month / cumulative ≥ $0 | 6 / none in 12 | none / none | none / none |
| Thinking tokens per call where a paid user at the cap (310 generations) turns negative | 3,317 | 2,073 | 1,244 |
| Same, if both provider attempts are billed for every generation (retry worst case) | 1,309 | 687 | 272 |

All-in break-even price with AI tools at $200: $28.50 at 10 paid users, $14.43 at 20, $9.74 at
30, and $5.06 at 60. Under these assumptions, $5 does not cover current costs even at the full
60-user steady state. $5 becomes profitable once AI tools drop to $40 or less.

## Open risk recorded, not resolved

The coaching function sets no `thinking_level`, so Gemini 3.8 Flash uses its default (`medium`),
and thinking tokens are billed at the output rate. No code path records `usageMetadata` or
`thoughtsTokenCount`, so the real cost per coaching call is unmeasured. At the modeled 10 calls
per month the per-user amount is small. Across 500 trial users, though, it adds $37.50/month,
and for a paid user at the cap (310 generations in a 31-day month) it decides whether that user is
contribution-positive at lower prices. The thinking cost is unknown and is not treated as
negligible. Measurement is deferred under #1259/#1491. No pricing or `thinking_level` change is
assigned.

## Verification performed

- LibreOffice recalculation: 1,210 formulas, 0 errors; all checks `OK`; `MODEL STATUS: PASS`.
- Price Sensitivity ties to `Forecast 12M` (organic and paid-CAC profit rows, steady-state
  profit, paid-CAC cash month) and to `Unit Economics` (`Checks!F25:F30`). `Checks!F32` ties the
  companion added trial thinking cost to trials × calls × thinking tokens × output price.
  - `Checks!F31` ties the forecast's fixed cost to stack + AI tools.
  - With AI tools excluded, the outputs equal the stack-only figures, which reproduce the
    2026-09-05 model.
- All $10/$7/$5 outputs at each AI-tools level match an independent script recomputation.
- Input propagation: changing Codex Pro to $150 moves all-in fixed OpEx to $295 and $10 all-in
  break-even to 35, with `MODEL STATUS: PASS`.
- Negative controls on the month index all turn `Checks!F24` and `MODEL STATUS` to `FAIL`:
  - swapping months 1 and 2 (sum stays 78);
  - duplicating one month and dropping another (sum stays 78);
  - blanking one month.
- The companion rows reproduce PM's independent figures: 12/18/25 users, $444.00/$270.48/$154.80,
  and $37.50.
- Round-trip control: opening and re-saving the workbook with openpyxl, then recalculating,
  preserves the forecast (`Active paid users` 0, 10, 20 … 60).

Taxes, refunds, founder compensation, one-time legal/accounting costs, and usage overages beyond
vendor allowances remain excluded. The forecast start date (2026-09-01) is unchanged. Month
numbers count from the forecast start, whose first month is the trial month; they are not
calendar dates.
