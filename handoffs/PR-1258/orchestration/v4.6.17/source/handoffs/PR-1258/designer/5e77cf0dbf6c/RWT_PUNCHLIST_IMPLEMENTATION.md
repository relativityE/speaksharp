# RWT punch list — implementation guide (#1258)

> **Standalone.** This is the build companion to `RWT_PUNCHLIST_DESIGN.md` (the *what* and *why*, D1–D11). This file is the *how*: every file to change, the exact edit, the copy, the tokens, the tests, and reference markup for every screen in **Appendix A**. Read against `relativityE/speaksharp@main` at `18a601dc` (7 Oct 2026). Line numbers are approximate; find by the quoted strings.
> **If this file and the design file ever disagree, stop and ask.** Do not pick one.
> **Never invent copy.** Every user-visible string is quoted here. If a string you need isn't here, ask.

---

## 0. Ground rules for the whole change

### 0.1 Tokens (use these names; never raw hex in components)

| Role | Tailwind / CSS token in the repo | Hex (reference only) |
|---|---|---|
| Ink ground | `bg-ink` / `text-ink` | `#1c2333` |
| Ink raised panel | whatever `SavedPracticeLoopReview` / `AISuggestions` already use for the `WHAT WENT WELL` panel | `#262f42` |
| Ink text / muted | as used inside the existing review band | `#eef1f7` / `#9aa6bd` |
| Signature yellow | `bg-signature`, `var(--brand-signature)` | `#ffb61f` |
| Signature text / ground / border | `text-signature-text`, `bg-signature-ground`, `border-signature-border` | `#8a5510` / `#fdf3e2` / `#f0dcb8` |
| Success text (green) | `text-status` | `#146b4a` |
| Neutral heading / body / secondary / muted | `text-neutral-heading`, `text-neutral-body`, `text-neutral-secondary`, `text-neutral-muted` | `#1c2333` / `#1f2733` / `#414b5c` / `#6b7688` |
| Borders | `border-neutral-border-strong`, `border-neutral-border`, `border-neutral-border-soft` | `#c8d2e0` / — / `#e6ebf2` |
| Neutral band ground | `bg-neutral-band` | `#f5f7fa` |
| Focus Points purple | the existing Focus Points token family | `#6d28d9` / `#f5f0ff` / `#e6dcfb` |
| Metric colours | **`TrendChart.tsx` `metricConfig` only**: pace + pause `var(--brand-ink-hairline)`, clarity `var(--brand-metric-clarity)`, fillers `var(--brand-signature)` | — |

If a hex in Appendix A has no token, **add the token to the token file first** (the palette ratchet forbids raw hex in components), then use it. Do not substitute a "close" token silently.

### 0.2 Shared formatters — add once, use everywhere

New file `frontend/src/lib/displayFormat.ts`:

```ts
const MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const MONTH_Y = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "7 Oct" (current year) or "7 Oct 2025". Local time. */
export function shortDate(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (d.getFullYear() === new Date().getFullYear() ? MONTH : MONTH_Y).format(d);
}
/** "6:12 pm". Local time; am/pm lowercased where the locale uses it. */
export function shortTime(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return TIME.format(d).replace(/\b(AM|PM)\b/g, (m) => m.toLowerCase());
}
/** "0:46", "3:24". */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function times(n: number): string { return n === 1 ? '1 time' : `${n} times`; }
export function plural(n: number, one: string, many: string): string { return `${n} ${n === 1 ? one : many}`; }

export const PRODUCT_LABEL = { open_mic: 'Open Mic', focus_points: 'Focus Points' } as const;
export type ProductId = keyof typeof PRODUCT_LABEL;
```

Unit tests: `shortDate` with this year and a past year; `shortTime` returns lowercase am/pm in `en-US`; `times(1)` → `1 time`.

**Product of a saved session.** Use the field the save path already writes when it calls `recordSavedSessionFor(..., { product })` (the same decision that sets `'open_mic' | 'focus_points'` there). If the session row doesn't carry it, add one helper `productOf(session): ProductId` beside `getSessionAnalysisMetrics`, using the same rule, and use it everywhere below. **Never** infer it from the title.

### 0.3 Work order (one PR each, in this order)

| PR | Items | Why this order |
|---|---|---|
| 1 | §1 Copy + nav (D2, the banner part of D10, the `Practice again?` label) | Strings only. Unblocks test updates early |
| 2 | §2 Failed review band (D3) | One component |
| 3 | §3 Transcript card (D10) + highlight contract (D4) | Session page `after` |
| 4 | §4 Back returns to the session (D1) | Routing; depends on PR 3's `after` rendering |
| 5 | §5 Progress page (D5, D6, D7, D8, D9, D11) | The largest change; one PR so the page is never half-themed |

Each PR: update or replace every test that asserts an old string, and add the new tests listed. Attach before/after screenshots at 1280px and 375px.

---

## 1. PR 1 — Copy and navigation (D2)

### 1.1 `frontend/src/config/navSections.ts`
- `analytics` entry: `label: 'Analytics'` → `label: 'Progress'`. Keep `id`, `path`, `matchPaths`, `icon`, `testId` **unchanged** (tests and routes depend on them).
- Delete the comment block "Labels are intentionally unchanged in this PR…". The condition it waited for is now met.

### 1.2 `frontend/src/components/Navigation.tsx` — order Home · Products · Progress
The desktop bar maps `NAV_SECTIONS` and then renders the Products dropdown, which gives Home · Analytics · Products. Render in this order instead:

```tsx
const home = NAV_SECTIONS.find((s) => s.id === 'home')!;
const progress = NAV_SECTIONS.find((s) => s.id === 'analytics')!;
// …inside <nav aria-label="Primary">:
{renderNavLink(home)}
<DropdownMenu …>{/* existing Products dropdown, unchanged */}</DropdownMenu>
{renderNavLink(progress)}
```

`renderNavLink` is the existing `<Link …>` JSX from the current `.map`, extracted unchanged (same `data-testid`, `aria-current`, `navItemClassName`).

**Mobile bottom bar** (`MobileNav`): order **Home · Open Mic · Focus Points · Progress**. Move the Progress item after the two product buttons. Same extraction.

### 1.3 Post-save banner — `StatusNotificationBar.tsx` and its caller
- Link text `Analytics` → `Progress` (keep `to="/analytics"`, `data-testid="post-save-review-session-link"`, the cue logic and the arrow).
- The caller (search for `Session saved · Your transcript is ready.`, in `SessionPage` / the controller) emits `Session saved.` instead.
- Update `StatusNotificationBar.test.tsx` fixtures.

### 1.4 Practice action label
- `frontend/src/components/session/SessionVerdict.tsx`: `Practice this again` → `Practice again?` (the visible text and any `aria-label`).
- Grep `Practice this again` / `Practise this again` across `frontend/src` and `tests/`; update every assertion. Tests to update include `SessionOverhaulView.test.tsx` and `SessionOverhaulView.practiceLoopPlacement.test.tsx`.

### 1.5 Document titles
- `/analytics` → `Your progress · SpeakSharp`.
- `/analytics/:id` → `{Product} · {shortDate} · Progress · SpeakSharp`.
Set them where the page sets its title today, or with a `useEffect` in `AnalyticsPage`.

### 1.6 Tests
- `Navigation.component.test.tsx`: assert the desktop order by reading the `<nav aria-label="Primary">` children's text: `['Home', 'Products', 'Progress']`. Mobile order: `['Home', 'Open Mic', 'Focus Points', 'Progress']`.
- Grep e2e/live specs for `getByRole('link', { name: 'Analytics' })`, `text=Analytics`, `'Analytics'`. Switch them to the `TEST_IDS.NAV_ANALYTICS_LINK` test id, not the new label.

---

## 2. PR 2 — Failed review band (D3)

File: `frontend/src/components/session/AISuggestions.tsx` (failed/terminal render, around the `UNAVAILABLE_MESSAGE` constant and `Retry review now`).

### 2.1 Strings
| Constant / location | Before | After |
|---|---|---|
| `UNAVAILABLE_MESSAGE` | `The review is unavailable right now. Your session is saved, and you can try again.` | `The review didn't load. Your session is saved.` |
| Service-setup terminal message | `The review is unavailable because of a service setup problem on our side. Your session is saved, and you can check again later.` | `Review isn't available for this session. Your session is saved.` |
| Sub-line under the headline | `Your session is saved, and these counts came from your device — they never needed the review.` | **Delete** |
| Retry button | `Retry review now` | `Try again`; while a retry is in flight or scheduled: `Trying again…` (disabled) |
| Disclosure | `OPEN_MIC_DISCLOSURE` / the Focus Points disclosure | **Unchanged strings**, moved directly under the button |

### 2.2 Structure (failed, retryable)

```tsx
<section aria-labelledby="review-eyebrow" className="rounded-[13px] bg-ink px-[22px] pb-[22px] pt-5">
  <h3 id="review-eyebrow" className="text-[12px] font-extrabold uppercase tracking-[0.09em] text-signature">Practice Loop review</h3>
  <p className="mt-3 text-[17px] font-bold text-[ink-text token]">{message}</p>
  <button type="button" onClick={retry} disabled={retrying}
    className="mt-3.5 inline-flex h-10 items-center rounded-lg border border-[ink-muted token] px-4 text-[14px] font-extrabold text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2 focus-visible:ring-offset-ink">
    {retrying ? 'Trying again…' : 'Try again'}
  </button>
  <p className="mt-2 text-[12px] font-semibold text-[ink-muted token]">{disclosure}</p>
  {/* then the existing verdict actions, separated: */}
  <div className="mt-[18px] border-t border-[ink-hairline token] pt-[18px]">{verdictActions}</div>
</section>
```

- The eyebrow stays exactly as the band renders it today (its existing icon and text). Only the body below it changes.
- **Remove the counts panel** (`0 fillers · 95 words/min`) from the band in every state. The `THIS RUN` card (`ThisRunCard.tsx`) already shows them.
- `verdictActions`: the existing `SessionVerdict` actions, `Practice again?` (yellow, primary) and `See all sessions` (text link), unchanged except the label from PR 1.
- **Terminal** (service setup, daily limit, ineligible): `message` = the terminal string. **No** button and **no** disclosure. `verdictActions` stay.
- Don't change the retry scheduling logic, back-off or telemetry. Only the presentation changes.

### 2.3 Tests (`AISuggestions.component.test.tsx`)
- Replace `/retry review now/i` with `/^try again$/i` (lines ~420, ~666, ~919). While scheduled, assert `/trying again…/i` and that it's disabled.
- Replace `/review is unavailable right now/i` with `/the review didn't load/i` (~722).
- New: in the failed state, the band contains no element with text matching `/\bfillers\b|words ?\/ ?min/i`.
- New: the terminal state renders no `button` named `/try again/i` and no disclosure text.

---

## 3. PR 3 — Transcript card after Stop (D10) and the highlight contract (D4)

### 3.1 `frontend/src/components/session/TranscriptCard.tsx`
Add a prop:

```ts
/** D10 — the take has ended (after state): title "Transcript", no tick, card height fits content. */
ended?: boolean;
```

- **Header when `ended`:** `<h2 className="text-[16px] font-extrabold text-neutral-heading">Transcript</h2>`, then `headerMeta` rendered as `<span className="text-[14px] font-semibold text-neutral-muted">· {n} words</span>`. **No `OrangeTick`.** The caller passes `headerMeta={plural(wordCount, 'word', 'words')}`; the component adds the `· `.
- **Height when `ended`:** the root drops `h-full` (keeping `flex flex-col`), and the content wrapper drops `flex-1`. This removes the empty space under short transcripts. During recording, keep `h-full` and `flex-1` as they are today.
- `Read full transcript`: keep the existing overflow-measured logic (it already shows only when the cap clips). With `h-full` gone, a short transcript no longer overflows. Keep the 280px cap.
- `footer`: unchanged API, but see 3.2.

### 3.2 Caller (`SessionOverhaulView.tsx` / `SessionAfterState`)
- In `after`, pass `ended` and **stop passing `footer`** (the `0 fillers · 73 words` / `No filler words detected this session.` strip). Keep the during-state footer if one exists.
- `during` / `before` are unchanged.

### 3.3 D4 — one filler list
Find where the after state builds (a) the transcript highlight spans, (b) the timeline marks, and (c) `fillers` for `ThisRunCard` and the saved row. They must all read **one** array, the session's counted filler tokens:

```ts
// e.g. in the after-state view model
const counted = getCountedFillerTokens(session);      // single source; the detector's output
const fillerCount = counted.length;
const highlights = counted.map(t => t.span);           // transcript
const marks = counted.map(t => t.atSec);               // timeline
```

- If two detectors exist today (one for highlights, one for counts), **delete the second** and derive both from the first. Don't reconcile them by adjusting numbers.
- The saved session row's filler count (`metrics.fillerCount` on Progress) must equal `fillerCount`. If the save path recounts, make it persist `counted.length`.
- No "possible filler" style.

### 3.4 Tests
- `SessionAfterState.test.tsx`: with a 73-word transcript, assert the heading text is `Transcript` (not `Live Transcript`), no `[data-testid="read-full-transcript"]`, and no `[data-testid="transcript-footer"]`.
- New regression: given a transcript with "So" and "You know" as detected fillers, assert `highlights.length === marks.length === ThisRunCard fillers === 2`.
- `TranscriptCard` unit: `ended` removes `h-full` from the root's class list.

---

## 4. PR 4 — Back returns to the completed session (D1)

### 4.1 URL on save
At the confirmed-save point (the same boundary that calls `recordSavedSessionFor`), after the save resolves with the saved row `id`:

```ts
navigate({ pathname: '/session', search: `?review=${id}` }, { replace: true });
```

`replace: true` is required: the save must not add a history entry.

### 4.2 `SessionPage` reads `?review=`
- `const reviewId = searchParams.get('review')`.
- **If `reviewId` is set and the in-memory store already holds that just-saved session:** render the existing `after` state as today. Nothing changes.
- **If `reviewId` is set and the store doesn't hold it** (Back from Progress after a remount, or a reload): load it with `getSessionById(reviewId)` (the same single-session read Analytics uses), then render the **same `after` components** read-only from the loaded row:
  - review band: `SavedPracticeLoopReview sessionId={reviewId}` (read-only; it never calls `get-ai-suggestions`). If there's no saved review, render the §2 failed band with `Try again` wired to the existing retry for that session id.
  - transcript: `TranscriptCard ended` with the stored transcript, if one is retained. If none is retained, show the card with `Transcript` and the existing "no transcript stored" copy for expired sessions.
  - `ThisRunCard` from the row's stored metrics.
  - `Practice again?` / `See all sessions` as normal.
- **If the load fails or the row isn't the user's:** `navigate('/session', { replace: true })` and render `before`. No toast and no error.
- Starting a new take (Start) while on `?review=` clears the param with `replace: true` before recording begins.

### 4.3 "Your last session" band (`before` state only)
New component `frontend/src/components/session/LastSessionBand.tsx`, rendered above the recorder card in `before`:

```tsx
const login = currentLogin();
const entries = readLoginSessions(login?.ownerId ?? null, login?.loginStartedAt ?? null);
const last = entries[entries.length - 1];
if (!last) return null;
return (
  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-border-strong bg-white px-4 py-3" data-testid="last-session-band">
    <p className="text-[14px]">
      <span className="font-extrabold text-neutral-heading">Your last session</span>
      <span className="font-semibold text-neutral-muted"> · {PRODUCT_LABEL[last.product]} · {shortTime(last.savedAt)}</span>
    </p>
    <Button asChild variant="outline" className="ml-auto h-10">
      <Link to={`/session?review=${last.key}`}>View review</Link>
    </Button>
  </div>
);
```

- Hide it while recording (it's only rendered in `before`).
- Uses the existing `loginSessionLog` store. **Do not add a second store.**

### 4.4 Tests (live / e2e)
1. Record and stop a take. Wait for the save. Assert the URL matches `/session?review=<uuid>` and that `history.length` is the same as before the save.
2. Click Progress, then `page.goBack()`. Assert the review band (or the failed band), `Transcript`, the `THIS RUN` counts and `Practice again?`. Assert **no** `Start recording` and no `0 words`.
3. Reload on `?review=<id>`. Same assertions, and assert no network request to `/functions/v1/get-ai-suggestions`.
4. Open `/session` fresh: `last-session-band` is visible. Click Start: it disappears.
5. Open `/session?review=<random-uuid>`: the `before` state renders, with no error UI.

---

## 5. PR 5 — Progress page (D5, D6, D7, D8, D9, D11)

### 5.1 `frontend/src/pages/AnalyticsPage.tsx`
- **Overview (`!isSessionView`):** don't render the `h1` / subtitle block (`Your Analytics` / `Track your speaking progress and improvements`). The dashboard renders `ProgressHeader` (5.2) as its first child and owns the `h1`.
- Session view: keep `Session Analysis` as today. It's out of scope.
- Keep `data-testid="dashboard-heading"` on the new `h1` (5.2) so existing tests find it. Update `AnalyticsPage.component.test.tsx` lines ~128–129 to expect `Your progress`, and assert the subtitle is absent.

### 5.2 New `frontend/src/components/analytics/ProgressHeader.tsx`

```tsx
interface Props { firstName: string | null; sessionCount: number; firstSessionAt: string | null;
  latest: { product: ProductId; createdAt: string } | null; focusLabel: string; focusControl: React.ReactNode; }

export const ProgressHeader: React.FC<Props> = ({ firstName, sessionCount, firstSessionAt, latest, focusLabel, focusControl }) => {
  const line = sessionCount <= 0 ? null
    : sessionCount === 1 ? `${firstName ? `${firstName}, your` : 'Your'} first session is in.`
    : `${firstName ? `${firstName}, you've` : "You've"} done ${sessionCount} sessions since ${shortDate(firstSessionAt!)}.`;
  return (
    <section className="flex flex-wrap items-start gap-4 rounded-2xl bg-ink px-7 py-[26px]" data-testid="progress-header">
      <div className="min-w-0 flex-[1_1_320px]">
        <h1 data-testid="dashboard-heading" className="text-[12px] font-extrabold uppercase tracking-[0.09em] text-signature">Your progress</h1>
        {line && <p className="mt-2.5 text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-white">{line}</p>}
        {latest && <p className="mt-2 text-[15px] font-semibold text-[ink-muted token]">
          Latest: {PRODUCT_LABEL[latest.product]}, {shortDate(latest.createdAt)} · Working on {focusLabel}</p>}
      </div>
      {focusControl}
    </section>
  );
};
```

- `firstName`: from the profile's name field, if the profile has one. **Never derive it from the email.** If there's no name field, pass `null`.
- `sessionCount`: `overallStats.totalSessions`. `firstSessionAt`: the oldest session's `created_at` (it must come from the same source as `totalSessions`; if `sessionHistory` is paged, add the oldest date to `overallStats` rather than read a page).
- `focusControl`: the **existing** `Choose focus` dropdown, moved here and restyled as an outline on ink: `h-10 rounded-lg border border-[ink-muted token] px-3.5 text-[14px] font-bold text-white`. Its menu content is unchanged.
- **Delete** the white `WORKING ON / {focusLabel} / {focusPurpose}` card, and the `What that's based on` / `Across your last 6 sessions` heading (around line 1001).

### 5.3 Page order on the overview (top to bottom)
1. `ProgressHeader`
2. `Your latest review` (5.4). Rendered only when it has a saved review.
3. Rule card (5.5)
4. Stat cards row (5.6)
5. `Trends` card (5.7)
6. `Recent sessions` (5.9)
7. Everything else that renders today below Recent sessions, unchanged

Vertical gap between blocks: the existing `space-y-6`.

### 5.4 `Your latest review`
- Reuse `SavedPracticeLoopReview` with `sessionId={sessionHistory[0].id}` (the newest session).
- Add two optional props to `SavedPracticeLoopReview`, and don't change its defaults:
  - `eyebrow?: string`, which the overview passes as `Your latest review` (it renders uppercase via the existing class);
  - `footerLink?: { to: string; label: string }`, which the overview passes as `{ to: \`/analytics/\${id}\`, label: 'Open this session' }`. It renders inside the band, below the yellow block: `mt-3.5 text-[14px] font-bold text-white underline underline-offset-[3px]`.
- The session label on the right is `{Product} · {shortDate}, {shortTime}`.
- **No saved review → the component renders `null`** on the overview. Don't show "No coaching was saved…" here, and never fall back to an older session.
- No `get-ai-suggestions` call (it's already read-only; keep it that way).

### 5.5 Rule card (was `◎ Do this next`, around line 1036)
Replace the hero's markup; keep its data source (the 6-session decode / `getNarrativeSummary`).

| Element | New |
|---|---|
| Container | `rounded-[14px] border border-neutral-border-strong bg-white px-5 py-[18px]`. **No** top border accent, **no** yellow |
| Eyebrow row | `FROM YOUR LAST {n} SESSIONS` (`text-[12px] font-extrabold uppercase tracking-[0.09em] text-neutral-secondary`), then a chip `Focus: {metric}` (`rounded-full border border-signature-border bg-signature-ground px-[9px] py-[3px] text-[12px] font-extrabold text-signature-text`) |
| Sentence | One data statement, `mt-2 text-[17px] font-extrabold leading-snug text-neutral-heading`. Templates below |
| Actions | `Button variant="outline"` `Practise {metric}` (h-10), then the existing `How we worked this out` as `text-[14px] font-bold text-neutral-secondary underline underline-offset-[3px]` |
| Removed | `◎`, `Do this next`, the imperative headline (`Pick up the pace on familiar points.`), the paragraph `We compare each delivery signal…`, the whole `WHAT TO TRY` numbered list, and the yellow `Practise this now` |

`{n}` is the actual number of sessions used (`≤ 6`). With fewer than 2 sessions, the card isn't rendered.

Sentence templates (`{metric}` chip value in brackets):

| Worked-on metric | Sentence | Chip |
|---|---|---|
| Pace, slow | `Your pace averaged {wpm} words a minute, under the 130–150 target.` | `Focus: pace` |
| Pace, fast | `Your pace averaged {wpm} words a minute, over the 130–150 target.` | `Focus: pace` |
| Fillers | `You averaged {n.n} filler words per session.` | `Focus: fillers` |
| Clarity | `Your clarity averaged {n}%.` | `Focus: clarity` |
| Pause rhythm | `You averaged {n.n} long pauses a minute.` | `Focus: pauses` |
| Nothing to work on | `Pace, fillers and clarity are all on target.` | no chip |

The button label matches the chip: `Practise pace`, `Practise fillers`, `Practise clarity`, `Practise pauses`. **Note the spelling:** this is the British verb form used by this card's existing button (`Practise this now`); the session's action is `Practice again?` per PO. Don't "fix" either one.

Take 130 and 150 from `ANALYTICS_THRESHOLDS.TARGET_WPM_MIN/MAX`.

### 5.6 Stat cards (`StatCard` interpretation branch)
- `G4_NUM_COLOR`: every status → `text-neutral-heading`. Values are no longer coloured.
- **Remove the chip** (`FIX THIS` / `ON TRACK` / `NEED 2 MORE`) and `G4_CHIP`. For no-data, keep `—` and the sentence `A couple more sessions and we can read this.`
- Sentence: drop the verdicts `— leave this alone.` and `— {microcopy}`. Show `{interpretation.label}` only (e.g. `Slow — Target 130–150` becomes `Slow · target 130–150` for pace; others show the label alone).
- **Metric dot** before the label: `<span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: metricConfig[metric].color }} />`. Export `metricConfig` from `TrendChart.tsx` and import it. Don't copy the colours.
- `filler_words_per_min` card: label `Filler words`, value = **average count per session** to one decimal place, unit ` per session`. Compute it from the same sessions as the other cards (`mean(fillerCount)` over sessions with `fillerCount !== null`). The per-minute value leaves the overview.
- `clarity_score` card label: `Clarity` (PM open item; it's one constant, so change it back if PM says `Clear delivery`).

### 5.7 `Trends` card — new `frontend/src/components/analytics/TrendsCard.tsx`
Replace the stacked section (heading `Sound Confident Tools` / `Each chart answers part of the same coaching question.`, around lines 1120–1210) with:

```tsx
<section aria-labelledby="trends-h" className="space-y-3">
  <h2 id="trends-h" className="text-[20px] font-extrabold text-neutral-heading">Trends</h2>
  <div className="overflow-hidden rounded-[14px] border border-neutral-border-strong bg-white">
    {rows.map((row, i) => (
      <div key={row.id} className={i ? 'border-t border-neutral-border-soft' : ''}>
        <button type="button" aria-expanded={open[row.id]} aria-controls={`trend-${row.id}`}
          onClick={() => toggle(row.id)} data-testid={`trend-row-${row.id}`}
          className="flex min-h-14 w-full items-center gap-3 px-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
          <span className="text-[16px] font-extrabold text-neutral-heading">{row.title}</span>
          <span className="ml-auto text-[14px] font-bold text-neutral-secondary">{row.summary}</span>
          <span aria-hidden className="w-6 text-center text-[20px] font-bold text-neutral-secondary">{open[row.id] ? '−' : '+'}</span>
        </button>
        <div id={`trend-${row.id}`} hidden={!open[row.id]} className="px-5 pb-5 pt-1">{open[row.id] && row.body}</div>
      </div>
    ))}
  </div>
</section>
```

- `open` is `useState` with **every row `false`** on mount. Don't persist it.
- Body is mounted only when open (`open[row.id] && row.body`), so closed charts cost nothing.
- `rows` comes from `displayedAnalysisSlides` (respects the selected focus), mapped:

| slide id | title | colour | summary | body |
|---|---|---|---|---|
| `pace_trend` | `Speaking pace` | pace | `Avg {n} wpm` | `<TrendChart metric="wpm" bare />` |
| `pause_trend` | `Pause rhythm` | pause | `After {k} more sessions` or `Avg {n.n} / min` | `<TrendChart metric="pauses" bare />` |
| `clarity_trend` | `Clarity` | clarity | `Steady at {min}–{max}%` (spread < 3) or `Avg {n}%` | `<TrendChart metric="clarity" bare />` |
| `filler_words` | `Filler words` | fillers | `{n} in your latest session`, or `No filler words detected` | `<FillerWordsBreakdown />` (5.8) |
| `weekly_activity` | `Weekly activity` | neutral (`text-neutral-muted` dot) | `{n} sessions this week` | existing `WeeklyActivityChart` |

- `summary` and `k` come from the **same** filtered points the chart draws (5.7.1). Compute them in one helper, `trendSummary(metric, points)`, and use it for both.
- Add a `bare?: boolean` prop to `TrendChart`: when true, render without the `Card` wrapper, title or description (the row is the title).

#### 5.7.1 `TrendChart.tsx` changes (D8)
- **Minimum:** `insufficient = nonNullPoints < 3` (was 2). The insufficient message is one line, `text-[14px] font-semibold text-neutral-secondary`: `Appears after {k} more sessions` (`k = 3 − nonNullPoints`, using `plural` for `1 more session`). Delete `Not enough data yet` / `Complete at least 2 sessions…`.
- **Pause nulls:** in `AnalyticsDashboard`'s `trendData`, `pauses` is `null` when the session has no measured pause data (not `0`). Type: `pauses: number | null`. Dev confirms how `getSessionPauseCount` signals "not measured" and maps that to `null`.
- **X-axis, once per day:** `trendData` items gain `i` (index) and `dayLabel`: `shortDate(created_at)` for the first session of each calendar day, `''` for the rest. Use `<XAxis dataKey="i" tickFormatter={(i) => data[i]?.dayLabel ?? ''} interval={0} />`, and delete `shortenTrendDate`.
- **Tooltip:** a custom `content` that renders `{Product} · {shortDate}, {shortTime}` on line 1 (`text-[12px] font-bold`) and the value on line 2: `{n} words a minute` / `{n}%` / `{n.n} pauses a minute`. Never `pauses : 0`. `trendData` items carry `createdAt` and `product` for this.
- **Clarity domain:** `<YAxis domain={metric === 'clarity' ? [clarityMin, 100] : undefined} />` with `clarityMin = Math.max(0, Math.min(100 - 20, Math.floor((min - 5) / 10) * 10))`.
- Pace target band: unchanged.

### 5.8 `FillerWordsBreakdown` — new `frontend/src/components/analytics/FillerWordsBreakdown.tsx`
Replaces `FillerWordsTrendChart` (in `AnalyticsDashboard.tsx`), `TopFillerWords` and `FillerWordTable` on the overview. **Delete their usage there.** Delete the two components and their tests only if nothing else imports them (grep first).

Data: the two newest sessions with `fillerCount !== null`, `latest` and `previous`. Per-word counts come from the same per-session field `getSessionAnalysisMetrics` reads for `fillerCount` (Dev: confirm the field; it's the per-word map the detector writes). **Counts, never per-minute.** `useAnalytics().fillerWordTrends` (the pooled per-minute data) is **not used** here.

```tsx
const LABEL: Record<string, string> = { i_mean: 'I mean', kind_of: 'kind of', sort_of: 'sort of', you_know: 'you know' };
const human = (k: string) => { const s = LABEL[k.toLowerCase()] ?? k.replace(/_/g, ' ').toLowerCase(); return s[0].toUpperCase() + s.slice(1); };
```

Render (inside the Trends row body):

```tsx
<div>
  <p className="text-[22px] font-extrabold text-neutral-heading">{latest.count} in your latest session</p>
  {previous && <p className="mt-0.5 text-[14px] font-semibold text-neutral-muted">{previous.count} in the one before ({shortDate(previous.createdAt)})</p>}
  {rows.length > 0 && <>
    <div className="mt-3.5 flex flex-wrap items-baseline gap-1.5 rounded-[10px] border border-signature-border bg-signature-ground px-3.5 py-2.5">
      <span className="text-[14px] font-extrabold text-neutral-heading">Times each word was said</span>
      <span className="text-[13px] font-bold text-signature-text">· counted, not per minute</span>
    </div>
    <table className="mt-2 w-full border-collapse text-[14px] text-neutral-body">
      <thead><tr>
        <th scope="col" className="py-2 text-left text-[13px] font-extrabold text-neutral-heading">Word</th>
        <th scope="col" className="py-2 text-right text-[13px] font-extrabold text-neutral-heading">{shortDate(latest.createdAt)} (latest)</th>
        {previous && <th scope="col" className="py-2 text-right text-[13px] font-extrabold text-neutral-heading">{shortDate(previous.createdAt)}</th>}
      </tr></thead>
      <tbody>{rows.map(r => (
        <tr key={r.key} className="border-t border-neutral-border-soft">
          <th scope="row" className="py-2.5 text-left font-bold">{human(r.key)}</th>
          <Cell n={r.latest} />{previous && <Cell n={r.previous} />}
        </tr>))}</tbody>
    </table>
  </>}
</div>
```

`Cell`: `n > 0` → `<strong className="text-[15px] font-extrabold text-neutral-heading">{n}</strong><span className="text-[13px] font-semibold text-neutral-secondary"> {n === 1 ? 'time' : 'times'}</span>`; `n === 0` → `<span className="text-neutral-muted">—</span>`. Right-aligned.

- `rows`: the union of keys with a count above 0 in either session, sorted by latest descending, then previous descending.
- Both counts 0: render only `No filler words detected in your last two sessions.` (`text-[15px] font-bold`).
- Only one session: no comparison line, no second column.
- **The palette note:** the band uses the signature family (`bg-signature-ground` / `border-signature-border`). If the repo has a lighter yellow token for `#fff4d6` / `#f2d27a` (the `PRO` badge family), use that instead, because it's the exact match. Otherwise `signature-ground` / `signature-border` is approved.

### 5.9 Recent sessions — rewrite `SessionHistoryItem`
Keep: the `NavLink` targets, `downloadSessionPdf(...)` calls, `onToggleSelect`, and every existing `data-testid`.

The section container: change from one card per row to **one** white card, `rounded-[14px] border border-neutral-border-strong bg-white`, with rows separated by `border-t border-neutral-border-soft`.

Row:

```tsx
<div className="flex flex-col gap-1.5 px-5 py-4 hover:bg-neutral-band" data-testid={`${TEST_IDS.SESSION_HISTORY_ITEM}-${session.id}`}>
  <div className="flex flex-wrap items-center gap-3">
    <ProductTag product={productOf(session)} />
    <NavLink to={`/analytics/${session.id}`} data-testid={`session-detail-link-${session.id}`}
      className="text-[15px] font-extrabold text-neutral-heading underline decoration-neutral-border-strong underline-offset-[3px]">
      {shortDate(session.created_at)}, {shortTime(session.created_at)}
    </NavLink>
    <span className="ml-auto text-[14px] font-bold text-neutral-secondary">{mmss(session.duration)}</span>
    <label className="inline-flex min-h-11 items-center gap-2 text-[13px] font-bold text-neutral-secondary">
      Compare
      <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(session.id)}
        aria-label={`Compare ${PRODUCT_LABEL[productOf(session)]}, ${shortDate(session.created_at)}, ${shortTime(session.created_at)}`} />
    </label>
    <Button asChild variant="outline" className="h-9"><NavLink to={`/analytics/${session.id}`} data-testid={`open-session-detail-${session.id}`}>Open</NavLink></Button>
    <Button variant="outline" className="h-9" data-testid={`download-pdf-btn-${session.id}`} onClick={…existing}>PDF</Button>
  </div>
  <div className="flex flex-wrap gap-2 text-[14px] font-semibold text-neutral-secondary">
    <Metric k="Pace" v={typeof wpm === 'number' ? `${wpm} wpm` : '—'} /><Dot />
    <Metric k="Fillers" v={totalFillers ?? '—'} /><Dot />
    <Metric k="Clarity" v={typeof clarity === 'number' ? `${clarity.toFixed(0)}%` : '—'} />
  </div>
</div>
```

- `Metric`: `<span className="whitespace-nowrap">{k} <strong className="font-extrabold text-neutral-heading">{v}</strong></span>`. `Dot`: `<span aria-hidden className="text-neutral-muted">·</span>`.
- `ProductTag`: `rounded-full px-[9px] py-[3px] text-[11px] font-extrabold uppercase tracking-[0.06em]`. Open Mic: the `PRO`-badge yellow family (`bg-signature-ground text-ink border border-signature-border`). Focus Points: the purple family (text `#6d28d9`, ground `#f5f0ff`, border `#e6dcfb` via its tokens).
- **Removed:** the `Mic` icon tile; `session.title` (the timestamp title); the clock icon and the word `duration`; the `•` and `formatDateTime` second line; the three stacked uppercase metric blocks; **all colour on values** (`text-success`, `text-signature-text`); the **yellow** PDF fill (`bg-signature`); the separate mobile block. One responsive row replaces both: below `sm`, the actions wrap under the title line because of `flex-wrap`.
- If PM confirms comparison **doesn't** ship for RWT, delete the `<label>…Compare…</label>` element. Nothing else changes.

### 5.10 Tests for PR 5
- `AnalyticsDashboard.component.test.tsx`: update `Detected filler words` / `Clear Delivery` row assertions to the `Fillers` / `Clarity` row text. Remove the mocks of `TopFillerWords` / `FillerWordTable` if those are deleted. Add:
  - `progress-header` exists, and its `h1` reads `Your progress`;
  - the four trend rows (Sound Confident) render with `aria-expanded="false"`, and no `.recharts-wrapper` is in the DOM until one is clicked;
  - clicking `trend-row-filler_words` shows `Times each word was said` and a table with no row whose cells are all `—`;
  - no element inside `[data-testid^="session-history-item"]` has a `bg-signature` class;
  - no row title text matches `/\d{4}-\d{2}-\d{2}T/`.
- `TrendChart.nullpoints.test.tsx`: update the minimum from 2 to 3 and the new message, and add a test that the pause series with all-null renders `Appears after 3 more sessions`.
- `TopFillerWords.component.test.tsx`: delete it with the component, if deleted.
- Visual check at 1280px and 375px against **Appendix A**.

---

## 6. Definition of done (all PRs)

| # | Check |
|---|---|
| 1 | Header reads Home · Products · Progress (desktop) and Home · Open Mic · Focus Points · Progress (mobile) |
| 2 | Back from Progress after a take shows the completed session, never `Start recording` / `0 words` |
| 3 | Failed review: one message, a bordered `Try again` button with the Gemini line under it, and no counts in the band |
| 4 | Transcript after Stop: `Transcript · {n} words`, no empty space, no footer, and highlights = marks = count |
| 5 | Progress opens with the ink `Your progress` header and a personal line |
| 6 | Yellow fill on Progress appears only on `Try this next run` and its button |
| 7 | All trend rows start collapsed, with + and a summary value; Clarity and Filler words included |
| 8 | Filler words show counts for two named sessions, the unit band leads, and there are no zero rows or underscores |
| 9 | Charts: one date label per day, a human tooltip, a minimum of 3 points, a pause chart with no fabricated 0 line, and a clarity axis that isn't 0–100 when values are high |
| 10 | Recent sessions: date and time titles, product tag, nothing after the duration, outline PDF, uncoloured values |
| 11 | No visible string contains an ISO timestamp, a UUID, an underscore key or `1 times` |
| 12 | Every screen matches Appendix A at 1280px; 375px has no horizontal scroll |

---

# Appendix A — reference markup

Inline-styled, framework-free, copy-exact. **Lift sizes, weights, spacing, colours and copy from here.** Where this markup and §1–§5 differ, §1–§5 win, and report the difference. Coaching phrases (`What went well`, `Try this next run`) are **illustrative**: the product shows the saved phrases. Names, dates and counts are sample data. Font in the product is the repo's Inter.

## A1 — Session page `after`, review failed (D2 banner, D3, D10)

```html
<div style="font-family: Inter, system-ui, sans-serif; background: #aeb9cd; padding: 18px; display: flex; flex-direction: column; gap: 8px; max-width: 900px;">
<div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 12px; height: 56px; display: flex; align-items: center; gap: 22px; padding: 0 18px;">
          <span style="font-size: 16px; font-weight: 800; color: #1c2333;">SpeakSharp</span>
          <span style="font-size: 14px; font-weight: 700; color: #414b5c;">Home</span>
          <span style="font-size: 14px; font-weight: 800; color: #1c2333; background: #fdf3e2; border-radius: 8px; padding: 6px 10px;">Products ▾</span>
          <span style="font-size: 14px; font-weight: 700; color: #414b5c;">Progress</span>
        </div>
        <div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 14px; font-weight: 700; color: #146b4a;">✓</span><span style="font-size: 14px; font-weight: 700; color: #1c2333;">Session saved.</span>
          <span style="margin-left: auto;"><span style="height: 36px; padding: 0 14px; border: 1px solid #c8d2e0; border-radius: 8px; display: inline-flex; align-items: center; font-size: 14px; font-weight: 700; color: #1c2333; background: #ffffff; white-space: nowrap;">Progress →</span></span>
        </div>
        <div style="background: #1c2333; border-radius: 13px; padding: 20px 22px 22px;">
          <div style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #ffb61f; margin-bottom: 12px;">PRACTICE LOOP REVIEW</div>
          <div style="font-size: 17px; font-weight: 700; color: #eef1f7;">The review didn't load. Your session is saved.</div>
          <div style="margin-top: 14px;"><span style="height: 40px; padding: 0 16px; border: 1px solid #9aa6bd; border-radius: 8px; display: inline-flex; align-items: center; font-size: 14px; font-weight: 800; color: #ffffff;">Try again</span></div>
          <div style="margin-top: 8px; font-size: 12px; font-weight: 600; color: #9aa6bd;">Sends this session's transcript to Google Gemini. Audio is never sent.</div>
          <div style="margin-top: 18px; padding-top: 18px; border-top: 1px solid #2f3a50; display: flex; align-items: center; gap: 18px;">
            <span style="height: 44px; padding: 0 20px; background: #ffb61f; color: #1c2333; border-radius: 10px; display: inline-flex; align-items: center; font-size: 15px; font-weight: 800;">Practice again?</span>
            <span style="font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: underline; text-underline-offset: 3px;">See all sessions</span>
          </div>
        </div>
        <div style="display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap;">
          <div style="flex: 1 1 480px; min-width: 0; background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px; padding: 18px 20px 20px;">
            <div style="display: flex; align-items: baseline; gap: 6px;"><span style="font-size: 16px; font-weight: 800; color: #1c2333;">Transcript</span><span style="font-size: 14px; font-weight: 600; color: #6b7688;">· 73 words</span></div>
            <p style="margin: 12px 0 0; font-size: 17px; line-height: 1.65; color: #1f2733; text-wrap: pretty;">Good morning everyone. Today I want to share a quick update on the garden project. Last month we planted 12 tomato plants and eight rows of beans. The beans are growing well, but the tomatoes need more sun. <span style="background: #fdf3e2; color: #8a5510; border-radius: 4px; padding: 0 2px;">So</span> next week we will move four plants to the south fence. <span style="background: #fdf3e2; color: #8a5510; border-radius: 4px; padding: 0 2px;">You know</span>, the soil there is also better. If anyone can help on Saturday morning, please let me know. Thank you for listening.</p>
          </div>
          <div style="flex: 0 0 300px; background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px; padding: 18px 20px;">
            <div style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #414b5c; margin-bottom: 12px;">THIS RUN</div>
            <div style="display: flex; flex-direction: column; gap: 12px; font-size: 15px; font-weight: 700; color: #414b5c;">
              <div style="display: flex; justify-content: space-between; align-items: baseline;"><span>Fillers</span><span style="font-size: 24px; font-weight: 800; color: #8a5510;">2</span></div>
              <div style="display: flex; justify-content: space-between; align-items: baseline;"><span>Pace</span><span style="font-size: 24px; font-weight: 800; color: #1c2333;">95 <span style="font-size: 13px; font-weight: 700; color: #6b7688;">wpm</span></span></div>
              <div style="display: flex; justify-content: space-between; align-items: baseline;"><span>Words</span><span style="font-size: 24px; font-weight: 800; color: #1c2333;">73</span></div>
            </div>
          </div>
        </div>
</div>
```

## A2 — Progress, top of page (D5, D11)

```html
<div style="font-family: Inter, system-ui, sans-serif; background: #aeb9cd; padding: 18px; display: flex; flex-direction: column; gap: 8px; max-width: 900px;">
<div style="background: #1c2333; border-radius: 16px; padding: 26px 28px; display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
          <div style="flex: 1 1 320px; min-width: 0;">
            <div style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #ffb61f;">YOUR PROGRESS</div>
            <div style="margin-top: 10px; font-size: 28px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.2; color: #ffffff; text-wrap: pretty;">Maya, you've done 10 sessions since 10 Aug.</div>
            <div style="margin-top: 8px; font-size: 15px; font-weight: 600; color: #9aa6bd;">Latest: Open Mic, 7 Oct · Working on Sound Confident</div>
          </div>
          <span style="height: 40px; padding: 0 14px; border: 1px solid #9aa6bd; border-radius: 8px; display: inline-flex; align-items: center; font-size: 14px; font-weight: 700; color: #ffffff; white-space: nowrap;">Choose focus ▾</span>
        </div>
        <div style="background: #1c2333; border-radius: 13px; padding: 20px 22px 22px;">
          <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 14px;"><span style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #ffb61f;">YOUR LATEST REVIEW</span><span style="font-size: 12px; font-weight: 700; color: #9aa6bd;">Open Mic · 7 Oct, 6:12 pm</span></div>
          <div style="background: #262f42; border-radius: 12px; padding: 12px 15px;"><div style="font-size: 11px; font-weight: 800; letter-spacing: 0.1em; color: #9aa6bd;">WHAT WENT WELL</div><div style="margin-top: 6px; font-size: 15px; font-weight: 600; color: #eef1f7;">Clear, concrete update for the team.</div></div>
          <div style="margin-top: 12px; background: #ffb61f; border-radius: 12px; padding: 18px 20px;"><div style="font-size: 11px; font-weight: 800; letter-spacing: 0.1em; color: #1c2333;">TRY THIS NEXT RUN</div><div style="margin-top: 6px; font-size: 20px; font-weight: 800; letter-spacing: -0.015em; color: #1c2333;">Pick up the pace slightly.</div></div>
          <div style="margin-top: 14px; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: underline; text-underline-offset: 3px;">Open this session</div>
        </div>
        <div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px; padding: 18px 20px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;"><span style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #414b5c;">FROM YOUR LAST 6 SESSIONS</span><span style="font-size: 12px; font-weight: 800; color: #8a5510; background: #fdf3e2; border: 1px solid #f0dcb8; border-radius: 999px; padding: 3px 9px;">Focus: pace</span></div>
          <div style="margin-top: 8px; font-size: 17px; font-weight: 800; line-height: 1.4; color: #1c2333; text-wrap: pretty;">Your pace averaged 100 words a minute, under the 130–150 target.</div>
          <div style="margin-top: 14px; display: flex; align-items: center; gap: 16px;"><span style="height: 40px; padding: 0 14px; border: 1px solid #c8d2e0; border-radius: 8px; display: inline-flex; align-items: center; font-size: 14px; font-weight: 700; color: #1c2333; background: #ffffff; white-space: nowrap;">Practise pace</span><span style="font-size: 14px; font-weight: 700; color: #414b5c; text-decoration: underline; text-underline-offset: 3px;">How we worked this out</span></div>
        </div>
</div>
```

## A3 — Trends card collapsed, and Filler words opened (D6, D7)

```html
<div style="font-family: Inter, system-ui, sans-serif; background: #aeb9cd; padding: 18px; display: flex; flex-direction: column; gap: 8px; max-width: 900px;">
<div style="font-size: 20px; font-weight: 800; color: #1c2333;">Trends</div>
        <div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px; overflow: hidden;">
          <div style="min-height: 56px; padding: 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #e6ebf2;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #2b3446; flex-shrink: 0;"></span><span style="font-size: 16px; font-weight: 800; color: #1c2333;">Speaking pace</span><span style="margin-left: auto; font-size: 14px; font-weight: 700; color: #414b5c;">Avg 100 wpm</span><span style="width: 24px; text-align: center; font-size: 20px; font-weight: 700; color: #414b5c;">+</span></div>
          <div style="min-height: 56px; padding: 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #e6ebf2;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #9aa3b2; flex-shrink: 0;"></span><span style="font-size: 16px; font-weight: 800; color: #1c2333;">Pause rhythm</span><span style="margin-left: auto; font-size: 14px; font-weight: 700; color: #414b5c;">After 2 more sessions</span><span style="width: 24px; text-align: center; font-size: 20px; font-weight: 700; color: #414b5c;">+</span></div>
          <div style="min-height: 56px; padding: 0 20px; display: flex; align-items: center; gap: 12px; "><span style="width: 10px; height: 10px; border-radius: 50%; background: #6d28d9; flex-shrink: 0;"></span><span style="font-size: 16px; font-weight: 800; color: #1c2333;">Clarity</span><span style="margin-left: auto; font-size: 14px; font-weight: 700; color: #414b5c;">Steady at 98–100%</span><span style="width: 24px; text-align: center; font-size: 20px; font-weight: 700; color: #414b5c;">+</span></div><div style="min-height: 56px; padding: 0 20px; display: flex; align-items: center; gap: 12px; border-top: 1px solid #e6ebf2;"><span style="width: 10px; height: 10px; border-radius: 50%; background: #ffb61f; flex-shrink: 0;"></span><span style="font-size: 16px; font-weight: 800; color: #1c2333;">Filler words</span><span style="margin-left: auto; font-size: 14px; font-weight: 700; color: #414b5c;">2 in your latest session</span><span style="width: 24px; text-align: center; font-size: 20px; font-weight: 700; color: #414b5c;">+</span></div>
        </div>

        <div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px; padding: 20px 22px;">
          <div style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #414b5c;">FILLER WORDS</div>
          <div style="margin-top: 8px; font-size: 22px; font-weight: 800; color: #1c2333;">2 in your latest session</div>
          <div style="margin-top: 2px; font-size: 14px; font-weight: 600; color: #6b7688;">1 in the one before (14 Sep)</div>
          <div style="margin-top: 14px; background: #fff4d6; border: 1px solid #f2d27a; border-radius: 10px; padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline;"><span style="font-size: 14px; font-weight: 800; color: #1c2333;">Times each word was said</span><span style="font-size: 13px; font-weight: 700; color: #8a5510;">· counted, not per minute</span></div>
          <table style="margin-top: 8px; width: 100%; border-collapse: collapse; font-size: 14px; color: #1f2733;">
            <thead><tr style="text-align: left;"><th style="padding: 8px 0; font-size: 13px; font-weight: 800; color: #1c2333;">Word</th><th style="padding: 8px 0; font-size: 13px; font-weight: 800; color: #1c2333; text-align: right;">7 Oct (latest)</th><th style="padding: 8px 0; font-size: 13px; font-weight: 800; color: #1c2333; text-align: right;">14 Sep</th></tr></thead>
            <tbody>
              <tr style="border-top: 1px solid #e6ebf2;"><td style="padding: 10px 0; font-weight: 700;">So</td><td style="text-align: right;"><strong style="font-size: 15px; font-weight: 800; color: #1c2333;">1</strong><span style="font-size: 13px; font-weight: 600; color: #414b5c;"> time</span></td><td style="text-align: right;"><strong style="font-size: 15px; font-weight: 800; color: #1c2333;">1</strong><span style="font-size: 13px; font-weight: 600; color: #414b5c;"> time</span></td></tr>
              <tr style="border-top: 1px solid #e6ebf2;"><td style="padding: 10px 0; font-weight: 700;">You know</td><td style="text-align: right;"><strong style="font-size: 15px; font-weight: 800; color: #1c2333;">1</strong><span style="font-size: 13px; font-weight: 600; color: #414b5c;"> time</span></td><td style="text-align: right; color: #6b7688;">—</td></tr>
            </tbody>
          </table>
        </div>
</div>
```

## A4 — Recent sessions (D9, D11.3)

```html
<div style="font-family: Inter, system-ui, sans-serif; background: #aeb9cd; padding: 18px; display: flex; flex-direction: column; gap: 8px; max-width: 900px;">
<div style="font-size: 20px; font-weight: 800; color: #1c2333;">Recent sessions</div>
        <div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px;">
          <div style="padding: 16px 20px; border-bottom: 1px solid #e6ebf2; display: flex; flex-direction: column; gap: 6px;">
  <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;"><span style="font-size: 11px; font-weight: 800; letter-spacing: 0.06em; color: #1c2333; background: #fff4d6; border: 1px solid #f2d27a; border-radius: 999px; padding: 3px 9px;">OPEN MIC</span><span style="font-size: 15px; font-weight: 800; color: #1c2333; text-decoration: underline; text-decoration-color: #c8d2e0; text-underline-offset: 3px;">7 Oct, 6:12 pm</span><span style="margin-left: auto; font-size: 14px; font-weight: 700; color: #414b5c;">0:46</span><span style="height: 36px; padding: 0 14px; border: 1px solid #c8d2e0; border-radius: 8px; display: inline-flex; align-items: center; font-size: 14px; font-weight: 700; color: #1c2333; background: #ffffff; white-space: nowrap;">Open</span><span style="height: 36px; padding: 0 14px; border: 1px solid #c8d2e0; border-radius: 8px; display: inline-flex; align-items: center; font-size: 14px; font-weight: 700; color: #1c2333; background: #ffffff; white-space: nowrap;">PDF</span></div>
  <div style="display: flex; gap: 8px; flex-wrap: wrap; font-size: 14px; font-weight: 600; color: #414b5c;"><span style="white-space: nowrap;">Pace <strong style="font-weight: 800; color: #1c2333;">95 wpm</strong></span><span style="color: #9aa3b2;">·</span><span style="white-space: nowrap;">Fillers <strong style="font-weight: 800; color: #1c2333;">2</strong></span><span style="color: #9aa3b2;">·</span><span style="white-space: nowrap;">Clarity <strong style="font-weight: 800; color: #1c2333;">100%</strong></span></div>
</div>
          <div style="padding: 16px 20px;  display: flex; flex-direction: column; gap: 6px;">
  <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;"><span style="font-size: 11px; font-weight: 800; letter-spacing: 0.06em; color: #6d28d9; background: #f5f0ff; border: 1px solid #e6dcfb; border-radius: 999px; padding: 3px 9px;">FOCUS POINTS</span><span style="font-size: 15px; font-weight: 800; color: #1c2333; text-decoration: underline; text-decoration-color: #c8d2e0; text-underline-offset: 3px;">14 Sep, 8:11 pm</span><span style="margin-left: auto; font-size: 14px; font-weight: 700; color: #414b5c;">1:21</span><span style="height: 36px; padding: 0 14px; border: 1px solid #c8d2e0; border-radius: 8px; display: inline-flex; align-items: center; font-size: 14px; font-weight: 700; color: #1c2333; background: #ffffff; white-space: nowrap;">Open</span><span style="height: 36px; padding: 0 14px; border: 1px solid #c8d2e0; border-radius: 8px; display: inline-flex; align-items: center; font-size: 14px; font-weight: 700; color: #1c2333; background: #ffffff; white-space: nowrap;">PDF</span></div>
  <div style="display: flex; gap: 8px; flex-wrap: wrap; font-size: 14px; font-weight: 600; color: #414b5c;"><span style="white-space: nowrap;">Pace <strong style="font-weight: 800; color: #1c2333;">107 wpm</strong></span><span style="color: #9aa3b2;">·</span><span style="white-space: nowrap;">Fillers <strong style="font-weight: 800; color: #1c2333;">1</strong></span><span style="color: #9aa3b2;">·</span><span style="white-space: nowrap;">Clarity <strong style="font-weight: 800; color: #1c2333;">99%</strong></span></div>
</div>
        </div>
      </div>

    </div>
</div>
```
