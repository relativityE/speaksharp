# RWT punch list — changes in Rev 2 (#1258)

> **Standalone.** Every change made to the RWT punch-list design and implementation since Rev 1 (7 Oct 2026, earlier the same day), with the exact before → after and where it lands in code. You don't need Rev 1 to apply this. If you haven't started on Rev 1, ignore this file and build from `RWT_PUNCHLIST_IMPLEMENTATION.md` Rev 2, which already contains all of it.
> Repo: `relativityE/speaksharp@main` `18a601dc`. All colours are existing `--brand-*` roles in `frontend/src/index.css`; **no new tokens.**

| # | Change | Decided by |
|---|---|---|
| C1 | Metric label is **`Clear delivery`** everywhere (not `Clarity`) | PM |
| C2 | Units go in the label, and the number stands alone | PO |
| C3 | Numbers line up in columns (tabular, right-aligned, same size) | PO |
| C4 | Recent sessions buttons: **ink `Open`**, **signature-yellow `PDF`** | PO |
| C5 | Per-word filler counts: field, keys and labels confirmed | Dev |
| C6 | Pause rhythm: no-data sessions are excluded, never plotted as 0 | Dev |
| C7 | Tint surfaces use the theme's signature-ground tokens | Design |
| C8 | Progress greeting uses the user's **first name**: new optional field, set at sign-up, on `/account`, or inline on Progress | PO |

---

## C1. `Clear delivery`, not `Clarity`

Every user-visible label for the clarity score reads **`Clear delivery`** (sentence case; uppercase only where an eyebrow is uppercase by style).

| Surface | Rev 1 | Rev 2 |
|---|---|---|
| Stat card label (`STAT_CARD_OPTIONS`, id `clarity_score`) | `Clarity` | `Clear delivery` |
| Trends row title (`clarity_trend`) | `Clarity` | `Clear delivery` |
| Recent sessions metric | `Clarity 100%` | `Clear delivery (%) 100` (see C2) |
| Rule card sentence | `Your clarity averaged {n}%.` | `Your clear delivery averaged {n}%.` |
| Rule card chip / button | `Focus: clarity` / `Practise clarity` | `Focus: clear delivery` / `Practise clear delivery` |

Code identifiers stay unchanged (`clarity_score`, `metric="clarity"`, `--brand-metric-clarity`).

Test: no visible text on Progress matches `/\bClarity\b/` (case-sensitive), except inside code-only attributes.

---

## C2. Unit in the label, number alone

Wherever a metric is a label–value pair, the unit goes in parentheses after the label, and the value is the bare number. Counts have no unit.

| Rev 1 | Rev 2 |
|---|---|
| `Pace` … `95 wpm` | `Pace (wpm)` … `95` |
| `Clear delivery` … `100%` | `Clear delivery (%)` … `100` |
| `Fillers` … `0 · 0.0/min` | `Fillers` … `0` |
| `Words` … `73` | unchanged |

**Where:**

- **`frontend/src/components/session/ThisRunCard.tsx`** (`THIS RUN`, session page `after`): labels `Fillers`, `Pace (wpm)`, `Words`. Remove the `wpm` suffix span after the pace value and the `· {n}/min` after the filler count. Keep `Counted on device from the transcript.` and the `—` null handling.
- **Recent sessions rows** (`SessionHistoryItem` in `AnalyticsDashboard.tsx`): `Pace (wpm)`, `Fillers`, `Clear delivery (%)`.

Tests:
- `ThisRunCard.test.tsx`: `getByText('Pace (wpm)')`; the pace value's text is exactly the number; no text in the card matches `/\d\s*wpm|\/min/`.
- Recent sessions: no row text matches `/\d\s*wpm|\d%/`.

---

## C3. Numbers line up

Label–value lists use two columns: labels on the left, values right-aligned in one column, `font-variant-numeric: tabular-nums`. Every value in a list uses the same size.

**`ThisRunCard`:**

```tsx
<div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-3 text-[15px] font-bold text-neutral-secondary tabular-nums">
  <span>Fillers</span>    <span className="text-right text-[24px] font-extrabold text-signature-text">{fillers ?? '—'}</span>
  <span>Pace (wpm)</span> <span className="text-right text-[24px] font-extrabold text-neutral-heading">{wpm ?? '—'}</span>
  <span>Words</span>      <span className="text-right text-[24px] font-extrabold text-neutral-heading">{words ?? '—'}</span>
</div>
```

**Recent sessions, metrics line:** replace the inline ` · `-separated line with a fixed 3-column grid, so each metric's numbers align row to row:

```tsx
<div className="grid grid-cols-[repeat(3,minmax(0,190px))] gap-x-7 text-[14px] font-semibold text-neutral-secondary tabular-nums max-[479px]:grid-cols-1">
  <Metric k="Pace (wpm)" v={typeof wpm === 'number' ? wpm : '—'} />
  <Metric k="Fillers" v={totalFillers ?? '—'} />
  <Metric k="Clear delivery (%)" v={typeof clarity === 'number' ? clarity.toFixed(0) : '—'} />
</div>

const Metric = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <span className="flex justify-between gap-2.5 whitespace-nowrap">
    <span>{k}</span><strong className="text-right font-extrabold text-neutral-heading">{v}</strong>
  </span>
);
```

There are no dot separators. Below 480px, each metric is its own full-width row.

Test: in a 2-row Recent sessions render, the right edges of the two `Pace (wpm)` values are equal (`getBoundingClientRect().right`, within 1px), and the same for `Fillers` and `Clear delivery (%)`.

---

## C4. Recent sessions buttons: ink `Open`, yellow `PDF`

Rev 1 had both as white outline buttons. Rev 2:

| Button | Classes | Notes |
|---|---|---|
| `Open` | `inline-flex h-9 items-center rounded-lg bg-ink px-4 text-[14px] font-extrabold text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2` | `--brand-ink` `#1c2333`, the navy of the `Your latest review` band. It's the row's main action |
| `PDF` | `inline-flex h-9 items-center gap-1.5 rounded-lg bg-signature px-3.5 text-[14px] font-extrabold text-ink hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` | `--brand-signature` `#ffb61f`, the same yellow as the app's PDF button today. Icon: `<Download className="h-4 w-4" aria-hidden />` before the text |

- `Open` stays a `NavLink` to `/analytics/${session.id}` with `data-testid={`open-session-detail-${session.id}`}`.
- `PDF` stays a `<button>` calling the existing `downloadSessionPdf('history_list', …)` with `data-testid={`download-pdf-btn-${session.id}`}`.
- **The yellow rule, updated:** solid `#ffb61f` appears on Progress only on `Try this next run`, `Practice again?` and the Recent sessions `PDF` buttons.
- **The theme has no blue.** The blue-grey around the app is `--brand-surface-session` `#aeb9cd`, a page ground that isn't used on buttons. "Blue" in this design means ink.

Test: `open-session-detail-*` has `bg-ink`; `download-pdf-btn-*` has `bg-signature`.

---

## C5. Per-word filler counts (confirmed by Dev)

Replaces Rev 1's "Dev: confirm the field".

- **Field:** `sessions.filler_counts` (`PersistedFillerCounts`, `frontend/src/contracts/fillerCounts.ts`). A flat map of approved keys to whole numbers, e.g. `{ "so": 2, "you_know": 1 }`.
- **Read it in UI code via** `getSessionAnalysisMetrics(session).fillerData` → `{ [word]: { count } }`. Don't read the raw column.
- **Measured vs not measured:** `{}` = measured, zero fillers. Absent or `null` = not measured: skip that session, never show 0, and never pick it as `latest` or `previous`.
- **Labels for the 13 approved keys** (an unknown key is not rendered):

```ts
const FILLER_LABEL: Record<string, string> = {
  um: 'Um', uh: 'Uh', ah: 'Ah', oh: 'Oh', like: 'Like', so: 'So',
  actually: 'Actually', basically: 'Basically', literally: 'Literally',
  you_know: 'You know', i_mean: 'I mean', kind_of: 'Kind of', sort_of: 'Sort of',
};
```

- A key missing from one session's map counts as 0 for that session, shown as `—`, because both sessions were measured.
- Filler words stat card: `mean(fillerCount)` over measured sessions only.

Tests:
- `{ so: 2, you_know: 1 }` vs `{ so: 1 }` renders exactly two rows: `So 2 times | 1 time` and `You know 1 time | —`.
- A session with `filler_counts: null` is never `latest`/`previous`.
- No rendered text contains `_`.

---

## C6. Pause rhythm: exclude no-data sessions (confirmed by Dev)

Replaces Rev 1's "Dev confirms how `getSessionPauseCount` signals not measured".

- **Test:** `hasValidPauseEvidence(session.pause_metrics)` (`frontend/src/utils/metricValidity.ts`). It's true only when `silencePercentage`, `transitionPauses` and `extendedPauses` are all finite numbers.
- In `AnalyticsDashboard`'s `trendData`:

```ts
pauses: hasValidPauseEvidence(s.pause_metrics)
    ? Number(calculateRatePerMinute(getSessionPauseCount(s), s.duration || 0, 1))
    : null,
```

- Change `TrendDataPoint.pauses` to `number | null`.
- A failing session is left out of the Pause rhythm chart, its collapsed summary, its `Appears after {k} more sessions` count and the Pause rhythm stat card. **Never plotted as 0.** This is the cause of the flat 0/min line in the PO walkthrough.

Tests (`TrendChart.nullpoints.test.tsx`):
- (a) every session fails → `Appears after 3 more sessions`, no line;
- (b) 4 sessions, 2 valid → `Appears after 1 more session`, and the summary uses only those 2.

---

## C7. Tint surfaces use theme tokens

Rev 1's mockup used a pale yellow (`#fff4d6` / `#f2d27a`) that isn't a theme role. Rev 2 uses the theme's signature-ground set on every tint surface:

| Surface | Tokens |
|---|---|
| `OPEN MIC` product tag (Recent sessions) | `bg-signature-ground border border-signature-border text-ink` |
| Filler words unit band (`Times each word was said · counted, not per minute`) | `bg-signature-ground border border-signature-border`; heading `text-neutral-heading`, note `text-signature-text` |

`--brand-signature-ground` `#fdf3e2`, `--brand-signature-border` `#f0dcb8`, `--brand-signature-text` `#8a5510`.

---

## C8. Progress greeting uses the first name

The PO wants the Progress greeting to use the user's first name. Checked 7 Oct: the app captures **no name today**. `user_profiles` has no name column, sign-up is email + password only, and nothing is read from `user_metadata`. So this adds one optional field, three places to set it, and one read.

**1. Data**
- Migration: `alter table public.user_profiles add column first_name text null;` with `check (first_name is null or char_length(first_name) between 1 and 40)`.
- **Writes go through an RPC, never a broad owner `update`.** `user_profiles` holds subscription and entitlement fields, so owners must not get a general update grant. Add `public.set_first_name(p_first_name text)`, `security definer`, `search_path = public, pg_temp`. It trims the input, stores `null` when it's empty after trimming, rejects anything over 40 characters, and updates **only** `first_name` where `id = auth.uid()`. Grant `execute` to `authenticated` only.
- Read: add `first_name` to the profile select in `useUserProfile` and to the `UserProfile` type as `first_name?: string | null`.
- **Never** take it from `user_metadata`. That field is user-writable and the codebase already treats it as untrusted.

**2. Where the user sets it**

| Place | UI | Copy |
|---|---|---|
| **Sign-up** (`/auth/signup`) | Optional text field **above** Email. `autocomplete="given-name"`, max 40 characters | Label `First name`, then `Optional` (12px/600 `neutral-muted`) beside it. No placeholder name |
| **`/account` → Account section** | A `First name` row above `Signed in as {email}`: the value (or `Not set`), with an `Edit` text button that opens an inline input and `Save` / `Cancel` | Save success: the row shows the new value. Error: `Couldn't save your name. Try again.` |
| **Progress header, when no name is set** | A single text button on the ink band, under the context line: `Add your first name` (14px/700 `#ffffff`, underlined). It opens the same inline input **in the band**: input (white, 40px, radius 8px) + `Save` (ink-on-yellow is reserved, so use the outline-on-ink style) + `Not now` | `Not now` hides the button for the rest of this login (`sessionStorage`); it comes back next login. **Never a modal, never shown during or right after a recording** |

On sign-up, call `set_first_name` right after the account is created (a failure there is non-blocking: log it and continue).

**3. The greeting**
- `firstName` = `profile.first_name` (trimmed), or `null`.
- Name set: `{First name}, you've done {n} sessions since {d Mon}.` / `{First name}, your first session is in.`
- Not set: `You've done {n} sessions since {d Mon}.` / `Your first session is in.`, plus the `Add your first name` button.
- Render the name as text (React escapes it). Don't change its case or truncate it in the header; 40 characters wraps on two lines at 320px.

**Tests**
- RPC: a user can set their own name and can't set anyone else's; `'  '` stores `null`; 41 characters is rejected; the call can't change `subscription_status` or any other column.
- `ProgressHeader`: `firstName="Maya"` renders `Maya, you've done 10 sessions since 10 Aug.`; `null` renders the no-name line and `Add your first name`.
- Header inline edit: Save calls `set_first_name`, and the line updates without a reload. `Not now` hides the button until the next login.
- Sign-up: the field is optional; submitting with it empty creates the account and stores no name.
- No rendered text ever contains the email's local part as a name.

---

## Acceptance (Rev 2 additions)

| # | Check |
|---|---|
| R2-1 | No visible `Clarity` label; `Clear delivery` on the stat card, Trends row, Recent sessions and rule card |
| R2-2 | `THIS RUN` reads `Fillers` / `Pace (wpm)` / `Words` with bare numbers, right-aligned in one column |
| R2-3 | Recent sessions metrics align in columns across rows, with no `·` separators and no unit after any number |
| R2-4 | Recent sessions `Open` is ink and `PDF` is signature yellow |
| R2-5 | Filler words: no `_` in any label; unmeasured sessions skipped; counts, never per-minute |
| R2-6 | Pause rhythm never draws a 0 for a session without valid pause evidence |
| R2-8 | With a first name set, the greeting starts `{First name}, …`; without one, it shows the no-name line and `Add your first name`. The email is never used as a name |
| R2-7 | No colour outside `index.css` `--brand-*` roles anywhere in the change |
