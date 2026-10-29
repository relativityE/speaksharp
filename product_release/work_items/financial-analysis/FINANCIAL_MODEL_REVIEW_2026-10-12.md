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

## Current-source reconciliation — 28 October 2026

The forecast and cost tables below preserve the **12–21 October planning context**.
Their default-medium, missing-usage-diagnostics and two-provider-attempt assumptions
are historical estimates, not descriptions of the subsequently served source.

The retained deployed source is
[`4c85b006ac05e180521fd6e7d807f736987cafe8`](https://github.com/relativityE/speaksharp/commit/4c85b006ac05e180521fd6e7d807f736987cafe8):

- [The pinned coaching contract](https://github.com/relativityE/speaksharp/blob/4c85b006ac05e180521fd6e7d807f736987cafe8/backend/supabase/functions/get-ai-suggestions/contract.json#L11)
  explicitly requests `generationConfig.thinkingConfig.thinkingLevel = low`.
- [Provider decoding](https://github.com/relativityE/speaksharp/blob/4c85b006ac05e180521fd6e7d807f736987cafe8/backend/supabase/functions/get-ai-suggestions/providerDecode.ts#L208)
  reads numeric `usageMetadata` into prompt, output, thinking and total token fields.
  [The handler](https://github.com/relativityE/speaksharp/blob/4c85b006ac05e180521fd6e7d807f736987cafe8/backend/supabase/functions/get-ai-suggestions/index.ts#L537)
  emits nullable diagnostic usage fields. Missing values are unknown, not measured zero.
- [The retry policy](https://github.com/relativityE/speaksharp/blob/4c85b006ac05e180521fd6e7d807f736987cafe8/backend/supabase/functions/get-ai-suggestions/providerRetry.ts#L16)
  allows **at most three provider attempts** under one shared 45-second budget.
  Three is a ceiling, not an observed attempt count or proof that failed attempts are billed.

These are source facts, not measured provider cost, an invoice reconciliation or evidence
of profitability. The historical two-attempt tables have **not** been recomputed as a
three-attempt scenario. No workbook assumption, price, formula, layout, billing setting
or provider behavior changes in this documentation correction. Cost measurement remains
open; source support for diagnostics alone does not close it.
`#1259` and `#1491` remain historical measurement references; `#1674` is the current
receiving home for the release and evidence reconciliation.

The October workbook remains byte-identical at SHA-256
`0be91eb36743ff3260b651fe03fff039b01c4cff140618ce5b9ad3ba89e17575`.
Jensen's read-only package comparison against `764890c3` confirms that only
`Checks!A18` in `xl/worksheets/sheet11.xml` differs; every other package part is unchanged.
The original executable receipts remain in
[`local-packets/1599-model-status-control/`](../../../local-packets/1599-model-status-control/).

Keep the evidence populations distinct: the **18 October** retained package records
**20 LibreOffice recalculations / 16 controls**. The **21 October** section below is
Consultant's separate **15/15 author report**; its original raw receipts are unavailable
in the receiving packet. Neither count is a new recalculation by Jensen or Microsoft
Excel execution. The workbook and `native-receipts.json` remain unchanged. All six
original receipt/support files remain preserved in Git history at
`035eca75fe7c2df1417da770bf4b6fea4e7f3134`; the current README and archived source
have the portability-only edits described below.

**Archival execution boundary — 28 October 2026.** The historical verification
source formerly named `local-packets/1599-model-status-control/verify-native.test.mjs`
is now inert `local-packets/1599-model-status-control/verify-native-source.txt`.
The current README replaces its personal-machine command paths with
`SPREADSHEET_RUNTIME` and a repository-relative path; the archived source replaces
its hardcoded dependency directory with `process.env.SPREADSHEET_RUNTIME`.
These two files are no longer byte-identical to their retained originals at
`035eca75fe7c2df1417da770bf4b6fea4e7f3134`. The historical command is not a current
CI entry point, and the archived source is data for inspection, not an instruction
to execute spreadsheet tools. These portability and documentation corrections do
not rerun or recalculate the workbook, reproduce the historical counts, or establish
new native spreadsheet evidence.

## Historical changes from 2026-09-05 — recorded 12 October 2026

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
   - `MODEL STATUS` requires all 27 checks (`F5:F15` and `F20:F35`) to say `OK`. The 2026-10-12
     version passed when no check said `FAIL`; the 18 October correction below closed that gap.
10. **Thinking companion rows (PM correction, #1599).** Headline results exclude Gemini thinking
    tokens and provider retries, and are labelled that way. `Price Sensitivity` rows 65–76 apply
    the illustrative 1,000 thinking tokens to paid **and** trial users together. In the uncapped
    case this adds $37.50/month of trial coaching cost alone.

## Historical forecast results — unchanged planning assumptions

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

## Historical open-risk record — superseded source assumptions, unmeasured cost remains

The coaching function sets no `thinking_level`, so Gemini 3.8 Flash uses its default (`medium`),
and thinking tokens are billed at the output rate. No code path records `usageMetadata` or
`thoughtsTokenCount`, so the real cost per coaching call is unmeasured.
- At the modeled 10 calls per month the per-user amount is small.
- Across trial users it adds up: $37.50/month at 500 trials.
- For a paid user at the cap (310 generations in a 31-day month), it decides whether that user is
  contribution-positive at lower prices.

The thinking cost is unknown and is not treated as negligible. Measurement is deferred under
#1259/#1491. No pricing, cohort-size or `thinking_level` change is assigned.

## Historical cost sensitivities — trials, retries, evaluator runs (21 October 2026)

Every figure in this section is an **estimate**. **No coaching cost has been measured.** No code
path records Gemini `usageMetadata`, and the evaluator has produced no paid results. The workbook
is unchanged; these figures use its own assumptions:

- 2,500 input and 200 output tokens per generation (`Assumptions!B15:B16`);
- 10 generations per active user per month (`B14`);
- Gemini 3.8 Flash at $0.75 / $3.75 per 1M tokens through 2026, then $1.50 / $7.50 (`B20:B23`).

The thinking-token values (0, 1,000 and 3,000 per call) are illustrative; actual thinking use is
unknown.

**Per generation, USD**

| Thinking tokens | 2026 price | 2027 price |
| --- | ---: | ---: |
| 0 | 0.002625 | 0.00525 |
| 1,000 | 0.006375 | 0.01275 |
| 3,000 | 0.013875 | 0.02775 |

**Coaching cost per month at the 2027 price, USD**

| Population (10 generations each) | 0 thinking | 1,000 | 1,000, every generation billed twice | 3,000, billed twice |
| --- | ---: | ---: | ---: | ---: |
| Launch cap, 100 active users | 5.25 | 12.75 | 25.50 | 55.50 |
| Year-end cap, 250 active users | 13.13 | 31.88 | 63.75 | 138.75 |
| Uncapped, 500 trials | 26.25 | 63.75 | 127.50 | 277.50 |
| One paid user at the daily cap (310 generations) | 1.63 | 3.95 | 7.91 | 17.21 |

- **Ties to the workbook.** The 500-trial, 1,000-thinking cell ($63.75) equals
  `Price Sensitivity!B69`.
- **Retries.** "Billed twice" is the worst case: `AI_PROVIDER_ATTEMPTS = 2`, with every second
  attempt billed. Whether a failed attempt is billed at all is unknown.
- **Effect on contribution.** A paid user at the daily cap in the last two columns costs more than
  the $7 and $5 contributions ($6.40 and $4.47). The workbook's thinking-token break-even rows
  already show this.

**Evaluator measurement runs.** Provider cost estimates only; local compute and hosting are not
costed.

| Run | Provider calls | Estimated provider cost |
| --- | --- | ---: |
| #1565 coaching baseline, 18 declared Gemini pairs (reported by CLI; none executed) | 18 Gemini generations | $0.05–$0.50 at the 2026 price, 0 to 3,000 thinking tokens, 1–2 attempts |
| Llama 3.2 1B / SmolLM2 on-device arms | none (on device) | $0 provider |
| v2 / v4 STT evaluator, Moonshine C2 matrix | none (on device) | $0 provider |

**To replace these estimates with measurements:**

- Log `promptTokenCount`, `candidatesTokenCount` and `thoughtsTokenCount` per generation, with no
  transcript content.
- Log billed attempts per generation.
- Confirm whether a failed attempt is billed.

Until then, the headline results above exclude thinking and retries. No pricing, billing or
`thinking_level` change is implied.

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

### Independent requalification — 21 October 2026 (Consultant)

Separate harness, separate author. The workbook was not changed; the SHA-256 is the same as above.

- **Scope check.** Of all package parts, only `xl/worksheets/sheet11.xml` (Checks) differs from
  `764890c3`. Inside it, only the `Checks!A18` formula changed. All other cell and non-cell XML is
  identical.
- **Method.** Each case copies the workbook and changes one input with openpyxl. It then
  recalculates in LibreOffice and reads `Checks!A18`, `Key!C62` and all 27 statuses.
- **Results.** 15 of 15 cases matched expectations, and `Key!C62` equalled `Checks!A18` in every case.
  - **PASS, 27/27 `OK`, 0 errors in 1,517 formulas:** default, One at $20, Two at $20, Exclude and
    Pre-launch. Their outputs equal `764890c3` exactly: fixed OpEx 65 / 85 / 45 / 245; contribution
    $9.2875; profit at 60 paid users $466 / $446 / $486 / $286.
  - **FAIL:** text in `Assumptions!B33`; a blank, `=1/0`, unrecognised (`ok `) or literal `FAIL`
    check status; months 1 and 2 swapped; duplicated months with an equal sum; a blank month; a
    month-12 cap of 1, below the paying base; a two-month trial.
- **The original defect reproduces on `764890c3`.** There, text in B33 and a blank, error or
  unrecognised status all give a false `PASS`.
- **Not exercised.** Microsoft Excel was not tested, only LibreOffice.

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
