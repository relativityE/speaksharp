# RWT punch list: design decisions D1–D11 (#1258) · Rev 2, 7 Oct 2026

> **Rev 2 supersedes Rev 1 in full.** Changes are listed in `RWT_PUNCHLIST_CHANGES_REV2.md`.

> **Standalone.** Answers the PO walkthrough of integrated build `integ/1258-rwt-copy @ e856f208` (7 Oct 2026). Component names were checked against `relativityE/speaksharp@main` (`18a601dc`). The integration branch wasn't readable. Everything Dev needs is in this file. It refers to no mockup, walkthrough or other spec; where a rule from elsewhere applies, it's restated here in full (see **Shared rules**).
> **Build companion:** `RWT_PUNCHLIST_IMPLEMENTATION.md` (files, code, tests, reference markup). The two are delivered together.
> **Status legend:** **Decided** = build to this. **Sign-off** = already built, approved with the conditions stated. **OPEN** = needs PM before build.
> **Scope:** RWT only. Nothing here adds cross-session tool attribution or a new feature.

| # | Item | Status |
|---|---|---|
| D1 | Back returns to the completed session | Decided |
| D2 | Header: Home · Products · Progress | Decided |
| D3 | Failed-review retry is a real button | Decided |
| D4 | A highlight means a counted filler | Decided (design rule for the Dev fix) |
| D5 | AI review and the 6-session rule card, clearly separated | Decided |
| D6 | Collapsed trend headers | Sign-off, with one condition |
| D7 | Filler words: one card, counts not rates | Decided |
| D8 | Trend chart rules | Decided |
| D9 | Recent sessions rows | Decided, one label OPEN |
| D10 | Session page `after`: transcript card | Decided |
| D11 | Progress page header and colour direction | Decided |

## Shared rules (restated so this file stands alone)

**S1. This login's sessions.** "Sessions saved during this login" means sessions whose save was **confirmed by the server** after the user's current sign-in. Keep them in a small store, `sessionStorage['speaksharp.loginSessions']`: `{ ownerId, loginStartedAt, entries: [{ key: <session id>, n: <1-based save order>, product: 'open_mic' | 'focus_points', savedAt: <epoch ms> }] }`.
- Record one entry at the single save-success point (never on Start, Stop, or a failed or discarded save). Ignore a duplicate `key`.
- On read, if `ownerId` or `loginStartedAt` doesn't match the current auth session, delete the key and return an empty list.
- `AuthProvider` clears it on sign-out and account change.
- If `sessionStorage` is unavailable, keep the list in memory for the tab's life. Never invent entries after a reload.
- If an equivalent store has already shipped, reuse it rather than adding a second one.

**S2. The saved AI review.** After Stop, `get-ai-suggestions` generates `{ version: 'gemini_coaching_v1', what_worked, what_to_try_next }` (each ≤6 words) once, and saves it on `sessions.ai_suggestions`. Every other surface **reads** that saved value and shows it verbatim. It's parsed fail-closed: exact key set, correct version, both halves non-blank, else treated as absent. **No surface other than the Session page's post-Stop review may call `get-ai-suggestions`.**

**S3. The shared review band.** Ink band `#1c2333`, radius 13px, `padding: 20px 22px 22px`:
- `WHAT WENT WELL` panel: `#262f42`, radius 12px, `padding: 12px 15px`. Eyebrow 11px/800 `#9aa6bd`, sentence 15px/600 `#eef1f7`.
- `TRY THIS NEXT RUN` block: `#ffb61f`, radius 12px, `padding: 18px 20px`. Eyebrow 11px/800 `#1c2333`, sentence 20px/800 `#1c2333`.
- One action inside the yellow block: `Practice again?` (`#1c2333` fill, white 15px/800 text, 44px, radius 10px). It opens the same product as the session (Open Mic → `/session`; Focus Points → the same point set).
- An optional evidence line above the action, headed `FROM THIS SESSION` (11px/800), one sentence 14px/700, built in code from the session's stored measurements. Never labelled `Because` or `Why`.

**S4. Significant change.** A clarity change counts as improved or declined only at **3 points or more** (scores are 0–100). Below that, it's shown neutrally.

**S5. Metric colours.** Each metric keeps one colour on every chart, dot and legend. It's defined once in `TrendChart.tsx`'s metric palette; read it from there and never redefine it.

**S6. Filler label.** The session page's full filler label is `Detected filler words`. It's deliberate, because the detector is a lower bound. Compact surfaces may shorten it to `Fillers`.

Format rules, used everywhere below:

- **Numbers line up.** Label–value lists use two columns: labels left, values right-aligned in one column, with `font-variant-numeric: tabular-nums` (`tabular-nums`). Every value in a list uses the same size, so digits align. Across repeated rows (Recent sessions), each metric sits in a fixed-width column so the same metric's numbers align row to row.
- **Unit in the label, number alone (PO, 7 Oct).** Wherever a metric is shown as a label–value pair, the unit goes in parentheses after the label and the value is the bare number: `Pace (wpm)  95`, `Clear delivery (%)  100`. Never `Pace  95 wpm`. Counts need no unit (`Fillers  2`, `Words  73`).

- **Date:** `7 Oct`. Add the year only when it isn't the current year (`7 Oct 2025`). Never `08/19/2026`, never `Aug 19`.
- **Time:** `6:12 pm`, using `Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })`.
- **Counts:** `1 time` and `{n} times`. `1 filler` and `{n} fillers`. Never `1 times`.
- **No raw identifiers in UI:** no ISO timestamps, UUIDs or snake/underscore keys (`I_mean`) in any visible string.

---

## D1. Back from Progress returns to the completed session

### Decision

The completed session is a **place you can go back to**, not a temporary screen state.

1. **When the save is confirmed** (after Stop, once the server has returned the saved row), the Session page replaces its current history entry:
   `history.replaceState(state, '', '/session?review=<sessionId>')`.
   That's `replaceState`, not `pushState`, so it doesn't add an extra Back step.
2. **`/session?review=<id>` renders the `after` state from the saved row:** review pair, transcript, counts, Focus Points results, Retry. It's read-only and **never asks the AI for a new review** (**S2**). If the saved review is missing, it shows the failed-review state from D3, and the user can retry from there.
3. **Browser Back from Progress** therefore lands on `/session?review=<id>` and shows the completed session. **The header link** behaves the same way (see the entry point below).
4. **Ownership:** if `<id>` isn't the signed-in user's session or doesn't exist, use `replaceState` to go to `/session` and show the fresh `before` state. Show no error, because a stale link isn't the user's fault.

### Visible entry point: "Back to your last session"

On a **fresh** `/session` (the `before` state), when this login has at least one saved session, show one band **above** the recorder card:

```
┌─────────────────────────────────────────────────────────────┐
│ Your last session · Open Mic · 6:12 pm     [ View review ]  │
└─────────────────────────────────────────────────────────────┘
```

- White card, `1px solid #c8d2e0`, radius 12px, `padding: 12px 16px`, flex row, `gap: 12px`, wraps below 480px.
- Text: `Your last session` 14px/800 `#1c2333`, then ` · {Product} · {time}` 14px/600 `#6b7688`.
- Action: `View review`, `Button variant="outline"`, 40px, linking to `/session?review=<newestId>`.
- Source: the newest entry in this login's session list (**S1**). Show no band if the list is empty.

### After a new take starts

- Pressing **Start** hides the band at once. The new take becomes the subject of the page.
- When the new take's save is confirmed, it becomes `/session?review=<newId>`. Back from Progress now returns to the **new** take.
- The earlier session is still reachable from Progress → Recent sessions → its row (`/analytics/<id>`). There's no second "last session" band and no session history on the Session page.
- If the new take is **discarded or fails to save**, the URL stays `/session`, and the band reappears pointing to the previous saved session.

### Acceptance

| # | Check |
|---|---|
| D1-1 | Finish a take, open Progress, press browser Back: the completed review, transcript, counts and Retry render. No `Start recording` button and no `0 words` |
| D1-2 | The URL after the save is `/session?review=<id>`, and history length didn't grow from the save |
| D1-3 | Reloading `/session?review=<id>` renders the same completed state, with no `get-ai-suggestions` request |
| D1-4 | On a fresh `/session` with at least one saved session this login, the band shows the newest session. Pressing Start hides it |
| D1-5 | Another user's or a non-existent `<id>` shows the fresh `before` state with no error |

---

## D2. Header: Home · Products · Progress

| | Before | After |
|---|---|---|
| Order and labels | Home · Analytics · Products | **Home · Products · Progress** |
| Progress route | `/analytics`, `/analytics/:id` | **Unchanged routes.** Only the label changes. Optionally add a `/progress` → `/analytics` redirect so the URL can be typed. Don't move the routes for RWT, because tests and links depend on them |
| Page header on `/analytics` | `Your Analytics` / `Track your speaking progress and improvements` | **See D11**: `Your progress` with a personal line, on an ink band |
| Document title | — | `Your progress · SpeakSharp`. On a saved session: `{Product} · {d Mon} · Progress · SpeakSharp` |
| Active item | — | **Home**: `/`. **Products**: `/session`, `/session?review=…`, Focus Points routes. **Progress**: `/analytics` and `/analytics/:id` |

- Active style: keep the existing active treatment, and set `aria-current="page"` on the active link.
- Mobile menu: same three items, same order.
- **Dev:** update every automated journey and test that clicks or queries `Analytics` by its label, and grep for the string in e2e and unit tests. The `/analytics` routes keep working, so URL-based tests don't change.
- Inside the app's copy, rename user-facing "Analytics" to "Progress" (the header, the page title, "Open Analytics" links). Code identifiers stay.

---

## D3. Failed review: one message, a real retry button

Current state (PO walkthrough, 7 Oct): a 24px headline `The review is unavailable right now. Your session is saved, and you can try again.`, a sub-line that repeats "your session is saved", a counts panel (`0 fillers · 95 words/min`) inside the band, then `Retry review now` as plain text, the Gemini privacy line, `Practice again?` (yellow) and `See all sessions`.

**Prescribed band, top to bottom:**

```
PRACTICE LOOP REVIEW
The review didn't load. Your session is saved.            ← 17px/700 #eef1f7
[ Try again ]                                              ← outline on ink, 40px
Sends this session's transcript to Google Gemini. Audio is never sent.   ← 12px/600 #9aa6bd
──────────────────────────────────────────────
[ Practice again? ]   See all sessions
```

- **One message, said once.** Remove the 24px headline and the sub-line (`…these counts came from your device — they never needed the review`).
- **Remove the counts panel from the band.** The counts already show in the `THIS RUN` rail card. Showing them twice, in two styles, is what made the band look like a results card.
- `Try again`: a `<button>`, `border: 1px solid #9aa6bd`, text `#ffffff`, 14px/800, height 40px, radius 8px, `padding: 0 16px`, `margin-top: 14px`. **Not yellow.**
- Privacy line directly under the button (`margin-top: 8px`), because it describes what the button does.
- A hairline (`1px solid #2f3a50`, `margin-top: 18px; padding-top: 18px`), then the existing `Practice again?` (yellow, the band's one primary action) and `See all sessions` (text link, 14px/700 `#ffffff`).
- **Retrying:** the button reads `Trying again…` and is `disabled`. The message stays.
- **Retry fails again:** the same state returns, with the button enabled. There's no attempt counter.
- **Terminal** (daily limit reached or not eligible): `Review isn't available for this session. Your session is saved.` There's no `Try again` and no privacy line. `Practice again?` stays.
- Label: `Practice again?` product-wide (PO, 7 Oct). It replaces both `Practice again?` and `Practice again?`.

| # | Check |
|---|---|
| D3-1 | Failed state: one message line, `Try again` is a bordered `<button>` at least 40px tall, and the privacy line sits directly beneath it |
| D3-2 | No fillers/wpm figures inside the review band in any state |
| D3-3 | While retrying it is disabled and reads `Trying again…` |
| D3-4 | The terminal state renders no retry control and no privacy line |

---

## D4. What a highlight means

**Rule: a highlight is a counted filler, exactly.** Nothing is highlighted unless it's counted, and nothing is counted unless it's highlighted.

- The transcript highlight set, the timeline marks and every filler count on the page come from **one** list: the session's counted filler tokens.
  `count === highlights.length === timelineMarks.length`, always.
- The same count appears for that session on Recent sessions, the saved-session view and the session page.
- **No "possible filler" treatment for RWT.** Ambiguous words (`so`, `like`, `you know` used literally) are either counted by the detector or not shown. A second highlight style would ask users to learn a distinction the counts don't reflect.
- Highlight style (unchanged if it already exists): `signature-ground` background, `signature-text` text, radius 4px. Count of 0 → no highlights and no marks.

| # | Check |
|---|---|
| D4-1 | For any saved session: transcript highlights = timeline marks = the session page count = the Recent sessions count |
| D4-2 | A session with 0 counted fillers renders no highlight and no timeline mark |

---

## D5. The AI review and the 6-session rule card are clearly different things

Today the `◎ Do this next` card on Progress is a fixed rule over the last 6 sessions' averages. The PO read it as the AI review and looked there for "What went well".

### Decision: two blocks, two looks, two labels

**Block 1: `Your latest review` (new on the Progress overview, at the top).**
The saved AI review (**S2**) of the **latest** saved session, rendered as the shared review band (**S3**):

- Ink band (`#1c2333`, radius 13px, `padding: 20px 22px 22px`).
- Header: `YOUR LATEST REVIEW` 12px/800 `letter-spacing: 0.09em` `#ffb61f`, with `{Product} · {d Mon}, {time}` on the right, 12px/700 `#9aa6bd`.
- `WHAT WENT WELL` panel, then the yellow `TRY THIS NEXT RUN` block, showing the saved phrases **verbatim**.
- Footer link, inside the band, 14px/700 `#ffffff` underlined: `Open this session` → `/analytics/<id>`.
- The `Practice again?` action and the evidence line are exactly as in **S3**. For Open Mic, the evidence is one delivery line (e.g. `{v} words a minute, under the 130–150 target.`). For Focus Points, it's coverage and timing (`Detected: point 1 at 0:21.` / `Not detected: point 3.` / `3:24 against your 3:00 guide.`). Show no evidence when nothing measured applies.
- **Read-only. No AI request from Progress.**
- If the latest session has **no saved review**: don't render the block, and don't fall back to an older session's review. That would present old advice as current.

**Block 2: the rule card, retitled and visually demoted.**

| | Before | After |
|---|---|---|
| Eyebrow | `◎ Do this next` | `FROM YOUR LAST 6 SESSIONS` (12px/800 `#414b5c`, no icon) |
| Sentence | Imperative instruction | **A data statement**, e.g. `Your pace averaged 100 words a minute, under the 130–150 target.` 17px/800 `#1c2333` |
| Explanatory paragraph | "We compare each delivery signal…" | **Removed.** The eyebrow says where it comes from |
| `WHAT TO TRY` list (3 numbered tips) | Beside the sentence | **Removed.** Numbered tips are coaching, and coaching belongs only to the AI review. Keeping them here is the main reason the card read as AI |
| `How we worked this out` | Yellow text link | Keep it as a plain text link, 14px/700 `#414b5c`, underlined |
| `Practise this now` | Yellow button | **Outline** button `Practise pace` (the matching metric). The yellow fill stays with the AI review's `Try this next run` |
| Top accent | 3px yellow top border | **Removed** |
| Surface | — | White card, `1px solid #c8d2e0`, radius 14px, `padding: 18px 20px`. **No yellow fill, no ink** |
| Fewer than 6 sessions | — | Eyebrow becomes `FROM YOUR LAST {n} SESSIONS`. With fewer than 2 sessions, the card doesn't render |

**Why:** only the AI review uses the ink band and the yellow block, everywhere in the product. A white card with a source eyebrow can't be mistaken for it. And the rule card states a fact rather than giving coaching, so the two never compete as "the next thing to do".

| # | Check |
|---|---|
| D5-1 | The Progress overview shows `Your latest review` first when the latest session has a saved review, with the saved strings verbatim |
| D5-2 | Progress makes no `get-ai-suggestions` request |
| D5-3 | The rule card has no yellow fill, no ink background, no `Do this next` text and no ◎ |
| D5-4 | The rule card's eyebrow states the actual number of sessions used |
| D5-5 | When the latest session has no saved review, no review block renders, and no older review is shown |

---

## D6. Every trend starts collapsed, including Clear delivery and Filler words

**Built for Speaking pace and Pause rhythm. Extend it to Clear delivery** (the 7 Oct build still shows `Clarity Trend` open with its full chart). **Filler words is a fourth collapsed row** in the same card (PO, 7 Oct): its open content is the D7 card body. Four rows, all collapsed.

**Section:** the heading `Sound Confident Tools` / `Each chart answers part of the same coaching question.` becomes `Trends` (20px/800), with no sub-line. The page title already names the focus.

**All four start collapsed, every visit.** Don't remember open state for RWT.

```
┌───────────────────────────────────────────────────────────┐
│ Speaking pace                         Avg 100 wpm     +   │
├───────────────────────────────────────────────────────────┤
│ Pause rhythm                After 2 more sessions     +   │
├───────────────────────────────────────────────────────────┤
│ Clear delivery                      Steady at 98–100% +   │
├───────────────────────────────────────────────────────────┤
│ Filler words                 2 in your latest session +   │
└───────────────────────────────────────────────────────────┘
```

- **One card** (white, `1px solid #c8d2e0`, radius 14px) holding four rows separated by `1px solid #e6ebf2` hairlines. Don't use separate cards, because stacked collapsed cards waste the space the collapse is meant to save.
- Each row is one `<button>`: full width, `min-height: 56px`, `padding: 0 20px`, with `aria-expanded` and `aria-controls`.
  - Left: the title, 16px/800 `#1c2333`, sentence case. **Remove** the sub-lines (`Track your words per minute over time`, etc.).
  - Right: a summary value (14px/700 `#414b5c`), then the indicator.
  - Indicator: `+` when collapsed and `−` when open, 20px/700 `#414b5c`, in a 24px box. (The PO asked for **+**, so keep `+/−`.)
- Open: the chart renders under its row, inside the same card, `padding: 4px 20px 20px`, height 240px. The other rows stay where they are.
- **Summary values** come from the same data as the chart (D8):

| Trend | Summary |
|---|---|
| Speaking pace | `Avg {n} wpm` over the sessions charted |
| Pause rhythm | `After {k} more sessions` until the D8 minimum is met, then `Avg {n.n} / min` |
| Clear delivery | `Steady at {min}–{max}%` when the spread is under 3 points, otherwise `Avg {n}%` |
| Filler words | `{n} in your latest session` (`No filler words detected` when 0 in both sessions) |

| # | Check |
|---|---|
| D6-1 | On load, all four rows are collapsed and no chart is in the DOM, or it's hidden from AT |
| D6-2 | Each header is a button with `aria-expanded`. Pressing Enter or Space toggles it |
| D6-3 | Every collapsed row shows a summary value matching its chart's data |

---

## D7. Filler words: one card, counts not rates

**Remove** the `Filler Words` chart, `Top Filler Words` and `Filler Word Trends` (`TopFillerWords.tsx`, `FillerWordTable.tsx`) from the Progress overview. **Replace** them with the content below, shown when the D6 `Filler words` row is opened. Layout is provisional: the PO is reviewing filler words with Design directly, so treat D7's **data rules** (counts, two real sessions, human labels, no zero rows) as decided and its **layout** as subject to change.

**Why the old table showed `0.38` and `0.19`:** `Filler Word Trends` showed **fillers per minute**, averaged over groups of recent sessions, under columns labelled `Latest session` / `Previous session`. So `0.38` was `So` per minute across a pooled group, not a count for one session. Words said once in a short session become fractions like `0.19`. The labels promised single sessions and the numbers weren't counts, so neither could be checked against anything else on screen.

### Counts, not rates

Users see counts on the session page (`4 fillers`). Per-minute rates pooled over groups of sessions (`0.38`) can't be checked against anything the user has seen, and they were labelled as if they were single sessions. **The card shows counts, for two real sessions: the latest and the one before it.**

### Open content of the `Filler words` row

```
FILLER WORDS
4 in your latest session          ← 22px/800
6 in the one before (5 Oct)       ← 14px/600 #6b7688

So          3 times      2 times
Um          1 time       3 times
You know    —            1 time
            Latest       5 Oct      ← column heads, 12px/800 #414b5c
```

- Rendered inside the D6 card under its row, `padding: 4px 20px 20px`. There's no separate card or eyebrow; the row title is the heading.
- **The unit leads; it isn't buried.** The old table hid what its numbers were in small grey column heads (`LATEST SESSION` / `PREVIOUS SESSION`) while the cells were pooled per-minute rates. Here the table opens with a header band that says what is being counted:
  - Band: `#fdf3e2` ground, `1px solid #f0dcb8`, radius 10px, `padding: 10px 14px`. `Times each word was said` 14px/800 `#1c2333`, then `· counted, not per minute` 13px/700 `#8a5510`.
  - Column heads under it: `Word` · `7 Oct (latest)` · `14 Sep`, 13px/800 `#1c2333` (not grey). They name the actual sessions.
  - Cells: `{n}` in 15px/800 `#1c2333` with ` times` in 13px/600 `#414b5c`.
- Headline `{n} in your latest session` (or `1 in…`), and the comparison line `{m} in the one before ({d Mon})`.
- Table (a real `<table>` with `<th scope="col">`): word | latest | previous. Rows are sorted by latest count, descending, then by previous count.
- **Only words with a count above 0 in either session.** Words at zero in both are not listed.
- A zero cell shows `—`.
- **Human labels** for the 13 approved keys (`sessions.filler_counts`): `Um`, `Uh`, `Ah`, `Oh`, `Like`, `So`, `Actually`, `Basically`, `Literally`, `You know`, `I mean`, `Kind of`, `Sort of`. Never display the key.
- **Not measured ≠ zero:** `filler_counts` absent or `null` means not measured, and that session is skipped. `{}` means measured, zero fillers.
- Pluralise correctly: `1 time` and `{n} times`.
- **Only one session:** headline only. No comparison line, no second column.
- **No fillers in either session:** `No filler words detected in your last two sessions.` 15px/700, with no table.
- **No chart in this card for RWT.** A per-word chart adds little; the headline and the table answer the question.

| # | Check |
|---|---|
| D7-1 | `Filler words` is a collapsed D6 row. `Top Filler Words`, `Filler Word Trends` and the filler chart are absent |
| D7-2 | The latest count equals that session's count everywhere else (D4) |
| D7-3 | No row has 0 in both columns. No visible underscore. No `1 times` |
| D7-4 | Column heads name real sessions (`{d Mon} (latest)`, `{d Mon}`), and the values are counts for those two sessions only |
| D7-5 | The table opens with the `Times each word was said · counted, not per minute` band at heading weight |

---

## D8. Trend chart rules (Speaking pace, Pause rhythm, Clear delivery)

| Rule | Spec |
|---|---|
| Points | One point per saved session, in order. Index-based x-axis, not time-scaled |
| X-axis labels | Date `7 Oct`, shown **once per day**, under that day's first session. Later sessions that day get a tick and no label. The same format in every chart |
| Tooltip | `{Product} · {d Mon}, {time}` on line 1, then the value with its unit and label (`100 words a minute`). Never `pauses : 0` |
| Minimum data | The chart draws only with **at least 3 sessions that have a valid value for that metric**. Below that, the card body shows `Appears after {k} more sessions`, using the same `k` as the collapsed-header summary and any summary card. **One source, so "Need 2 more" and a drawn 0 line can't both appear** |
| Pause rhythm | A session without measured pause data (fails `hasValidPauseEvidence(session.pause_metrics)`) has **no value**, not 0. It is left out of the chart, the summary and the minimum. Never draw a flat 0 line from missing data |
| Clear delivery y-axis | Domain `[floor((min − 5) / 10) × 10, 100]`, minimum span 20 points. So values of 96–100 show on an 80–100 axis, not 0–100 |
| Clear delivery, all within 3 points | Still draw, but the collapsed summary reads `Steady at {min}–{max}%` |
| Pace | Shade the 130–150 target band (`neutral-ground`), taken from the same constant as the stat card |

| # | Check |
|---|---|
| D8-1 | No chart repeats a date label on the x-axis. Every chart uses the `7 Oct` format |
| D8-2 | Pause rhythm with fewer than 3 valid sessions shows `Appears after {k} more sessions` and no line. `k` matches every other place it's shown |
| D8-3 | The Clear delivery axis minimum is above 0 whenever all values are above 25 |

---

## D9. Recent sessions rows

Current (PO walkthrough, 7 Oct): title `Session 2026-10-07T18…` (a truncated ISO timestamp), `⏱ 0:46 duration •`, a second full date line `Wednesday, October 7, 2026 at 2:00 PM`, three stacked metric blocks with uppercase two-line labels (`DETECTED FILLER WORDS`, `CLEAR DELIVERY`), an unlabelled circle at the left edge, and `Open` (outline) + `PDF` (**yellow**) buttons.

**Prescribed row:**

```
Open Mic · 7 Oct, 6:12 pm                                     0:46     [ Open ]  [ PDF ]
Pace (wpm) 95   ·   Fillers 1   ·   Clear delivery (%) 100
```

- **The whole card is one white panel** (`1px solid #c8d2e0`, radius 14px). Rows are separated by `1px solid #e6ebf2` hairlines, `padding: 16px 20px`. **No card per row, no tinted row background.**
- **Line 1 (flex, `gap: 12px`, `align-items: baseline`):**
  - Title `{Product} · {d Mon}, {time}`, 15px/800 `#1c2333`. **Never** an ISO timestamp, UUID or `Session 2026-…`. Not truncated; it wraps.
  - Duration `m:ss`, 14px/700 `#414b5c`, `margin-left: auto`. No clock icon, no word `duration`, **nothing after it** (no `•`).
  - Actions (PO, 7 Oct: the list needed colour):
    - `Open`: **ink fill** `#1c2333`, white 14px/800 text, 36px, radius 8px, `padding: 0 16px`. It's the row's main action.
    - `PDF`: theme **signature yellow**: `--brand-signature` `#ffb61f` fill, `--brand-ink` 14px/800 text and `↓` icon, 36px, radius 8px, no border. This is the same yellow as the app's PDF button today (`bg-signature text-ink`). (PO, 7 Oct)
    - **There is no blue in the theme** (`index.css` `--brand-*`). The blue-grey seen around the app is `--brand-surface-session` `#aeb9cd`, the page ground, and isn't used for buttons. "Blue" here is ink `--brand-ink`, the navy of the `Your latest review` band (PO confirmed, 7 Oct).
- **Line 2:** metrics in a 3-column grid (`repeat(3, minmax(0, 190px))`, `column-gap: 28px`, `tabular-nums`), 14px/600 `#414b5c`. Each cell is label left, value right, so a metric's numbers align down the list. No ` · ` separators. Cells: `Pace (wpm) {n}`, `Fillers {n}`, `Clear delivery (%) {n}`. Values are 14px/800 `#1c2333`. **No colour on values** (the brown `100%` goes). These are records, not verdicts.
- **Remove the second date line.** The title already has the date and time. Also note the two disagreed in the 7 Oct build (`T18…` vs `2:00 PM`), so the title's time must be **local** time.
- **Comparison selection:** the comparison dialog exists in the code, so it ships. Render it as a real checkbox on the right, before `Open`, with the visible label `Compare` and the accessible name `Compare Open Mic, 7 Oct, 6:12 pm`.
- **Below 640px:** the actions wrap under line 2, aligned left. The duration stays on line 1.
- **Row link:** the title is the link (`/analytics/<id>`), and `Open` goes to the same place. Don't make the whole row clickable, because it contains two buttons.

**Metric label (PM, 7 Oct): `Clear delivery`**, product-wide. Rows, stat cards, the trend row and the rule card all say `Clear delivery` (sentence case; `CLEAR DELIVERY` only where an eyebrow is uppercase by style).

| # | Check |
|---|---|
| D9-1 | No row title contains `20xx-`, a `T`-separated timestamp or a UUID |
| D9-2 | Nothing follows the duration. No second date line |
| D9-3 | `Open` is ink-filled (`bg-ink`), and `PDF` is signature-yellow (`bg-signature text-ink`) |
| D9-4 | No unlabelled control in a row |
| D9-5 | The `Fillers` value equals the session's D4 count. The title time is local |

---

## D10. Session page `after`: the transcript card

Current (PO walkthrough, 7 Oct): `✓ Live Transcript 73 words`. The full text fits, but the card holds ~200px of empty space, then `Read full transcript`, then a footer `0 fillers · 73 words` and `No filler words detected this session.`, while `So` and `You know` are highlighted above it and the timeline shows two marks.

**Prescribed:**

- **Title after Stop:** `Transcript` (16px/800), then ` · {n} words` (14px/600 `#6b7688`). Drop `Live` and the ✓ once the take has ended. It isn't live any more.
- **Height fits the content.** No `min-height` after Stop. The card ends 20px below the last line.
- **`Read full transcript` only when the text is clamped.** Clamp at 12 lines. Show the link only if the text overflows the clamp. For 73 words, there's no link.
- **Remove the footer** (`0 fillers · 73 words` and `No filler words detected this session.`). The word count is in the title and the fillers are in `THIS RUN`. Three places stating the same counts is how they came to disagree.
- **Highlights follow D4.** Highlighted tokens = timeline marks = the `THIS RUN` fillers count = the Recent sessions `Fillers` value.
- **`THIS RUN` card** (`ThisRunCard.tsx`): rows read `Fillers  2`, `Pace (wpm)  95`, `Words  73`. The label carries the unit and the value is the bare number, right-aligned. The `wpm` suffix after the value and the `· 0.0/min` after the filler count are removed.
- **Saved banner:** `Session saved · Your transcript is ready.` with `Analytics →` becomes `Session saved.` with `Progress →` (D2). `Your transcript is ready` is redundant, because the transcript is right there.

| # | Check |
|---|---|
| D10-1 | After Stop: title `Transcript · {n} words`, no `Live` |
| D10-2 | A short transcript has no empty space below it and no `Read full transcript` link |
| D10-3 | No filler or word-count footer in the transcript card |
| D10-5 | `THIS RUN` shows `Pace (wpm)` with a bare number; no unit follows any value in the card |
| D10-4 | Highlight count = timeline marks = the `THIS RUN` fillers count |

---

## D11. Progress page: personal header, colour that directs

The 7 Oct Progress page is white cards on the slate ground with a generic header (`Your Analytics` / `Track your speaking progress and improvements`). It reads like a report about someone else. It also doesn't share the Session page's look: the ink review band, the yellow action and the purple Focus Points.

### D11.1 Page header: an ink band

Replace the `h1` + subtitle and the `WORKING ON / Sound Confident` card's top position with one ink band at the top of the page:

```
┌ ink #1c2333 ──────────────────────────────────────────────────────────┐
│ YOUR PROGRESS                                         [ Choose focus ▾ ] │
│ Maya, you've done 10 sessions since 10 Aug.                          │
│ Latest: Open Mic, 7 Oct · Working on Sound Confident                 │
└───────────────────────────────────────────────────────────────────────┘
```

- Band: `#1c2333`, radius 16px, `padding: 26px 28px`, full content width.
- Eyebrow `YOUR PROGRESS`: 12px/800, `letter-spacing: 0.09em`, `#ffb61f`. This is the page's `h1` (visually an eyebrow, semantically `<h1>Your progress</h1>`).
- Personal line: 28px/800, `letter-spacing: -0.03em`, `#ffffff`:
  - Name known: `{First name}, you've done {n} sessions since {d Mon}.`
  - No name: `You've done {n} sessions since {d Mon}.`, plus an `Add your first name` text button on the band (see D11.1a).
  - 1 session: `{First name}, your first session is in.`
  - {n} = all saved sessions for this user. {d Mon} = the first session's date (add the year if it isn't this year).
- Context line: 15px/600 `#9aa6bd`: `Latest: {Product}, {d Mon} · Working on {Focus}`. `{Focus}` is the current focus (e.g. `Sound Confident`). This replaces the white `WORKING ON` card, and its `Shows whether your pace…` sentence is removed.
- `Choose focus`: moves into the band, top right. Outline on ink (`border: 1px solid #9aa6bd`, text `#ffffff`, 40px, radius 8px). It wraps under the text below 640px.
- **Factual, never a verdict.** No "Great job", no streaks, no emoji. Warmth comes from the name and from the user's own history.
- **Remove** `What that's based on / Across your last 6 sessions`. The rule card's eyebrow already says it (D5).

### D11.1a First name: capture it, then greet by it (PO, 7 Oct)

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

### D11.2 Colour roles: each colour has one job, the same as on the Session page

| Colour | Job on Progress | Where | Never |
|---|---|---|---|
| **Ink** `#1c2333` | "This is about you" / "this is the lesson" / the main action in a row | Page header band (D11.1). `Your latest review` band (D5). `Open` buttons in Recent sessions (D9) | Data card backgrounds, the rule card |
| **Yellow** `#ffb61f` | **The one thing to do** | `Try this next run` block and its `Practice again?` button. The header eyebrow | `Open`, the rule card, chart lines, status chips. Exception: `PDF` in Recent sessions uses this fill (PO, 7 Oct) |
| **Purple** `#6d28d9` | Focus Points | The product tag on Focus Points rows in Recent sessions | Open Mic, any metric |
| **Metric colours** (**S5**) | Which metric | A 10px dot before each D6 row title, matching that chart's line. The same dot before the metric's value in the rule card | Status or verdicts |
| **Amber** `#8a5510` on `#fdf3e2` | The metric to work on | One small chip in the rule card: `Focus: pace`. Fillers on the session page (unchanged) | More than one place per page |
| **Green** `#146b4a` | Improved by at least 3 points (**S4**) | The second number in a `82% → 88%` move | Static values, `On track` labels |
| **White on slate** `#ffffff` on `#aeb9cd` | Supporting data | Trends, Recent sessions, stat cards | — |

**The page reads top to bottom: you (ink) → your lesson (ink + yellow) → the pattern (white, amber chip) → the data (white).** The eye lands on the header, then on the yellow block, and the rest is reference. That's the same order as the Session page: review first, data in the rail.

### D11.3 Recent sessions product tags

Before the title on each row, a 12px/800 `letter-spacing: 0.06em` tag, radius 999px, `padding: 3px 9px`:
- `OPEN MIC`: `--brand-ink` text on `--brand-signature-ground`, `1px solid --brand-signature-border`
- `FOCUS POINTS`: `#6d28d9` on `#f5f0ff`, `1px solid #e6dcfb`

The title then drops the product: `7 Oct, 6:12 pm`.

### D11.4 Units lead, on every data surface

Rule for all of Progress: **the unit of a number is in its heading or right next to it, at heading weight, never only in a small grey caption or column head.** `Avg 100 wpm`, `2 in your latest session`, `Times each word was said`. If a number is a rate or an average, the heading says so in words (`average per session`). The theme colour for a unit line is `#8a5510` on the yellow family ground, the same family the session page uses for fillers.

### D11.5 Stat cards (`SPEAKING PACE`, `AVG. FILLER WORDS / MIN`, `CLEAR DELIVERY`, `PAUSE RHYTHM`)

- **Remove** the coloured big numbers (red `100`, green `0.5`, green `93.2`) and the `FIX THIS` / `ON TRACK` chips. Values are `#1c2333`. The single "work on this" signal is the amber `Focus:` chip in the rule card (D11.2). Four verdict chips competing is what made the page feel noisy.
- `AVG. FILLER WORDS / MIN` becomes `FILLER WORDS` with an **average count per session** (`1.4 per session`), so it matches the counts everywhere else (D7). A per-minute rate stays off the overview.
- Add the metric dot (D11.2) before each card's label.

| # | Check |
|---|---|
| D11-1 | Progress opens with the ink header band. Its `h1` text is `Your progress`. `Your Analytics` and `Track your speaking progress` appear nowhere |
| D11-2 | The personal line uses the first name when known, and the counts and dates come from saved sessions |
| D11-3 | Solid `#ffb61f` fill appears only on `Try this next run`, `Practice again?` and the Recent sessions `PDF` buttons |
| D11-4 | Each trend row and stat card shows the same metric dot colour as its chart line |
| D11-5 | No stat card value is coloured, and no `FIX THIS` / `ON TRACK` chips remain |
| D11-6 | Focus Points rows carry the purple tag, and Open Mic rows the yellow-family tag |

---

## Open items

| Item | Owner |
|---|---|
| D9: does comparison selection ship for RWT? | PM |
| S1: locate the single save-success point, and reuse an existing login-sessions store if one has shipped | Dev |
| D2: `/progress` redirect, yes or no (optional) | PM |
