# Practice Session — build instructions
> **Overridden in part (7 Oct):** `RWT_PUNCHLIST_DESIGN.md` D1 (Back returns to the completed session), D3 (failed-review band) and D10 (transcript card) replace the matching `after` details here where they conflict.

> **Status:** current as of 14 Sep 2026. Covers **Open Mic**: `before`, `during`, `after`, and `after · review failed`.
> **Changed 14 Sep — read §1 and §2 first.** The Practice Loop card moves from the rail bottom to the top of the content area, the palette drops teal for ink + signature yellow, and the review-failure state is now specified (§5b). Appendices A2–A4 were regenerated for this revision; A1 (`before`) is unchanged.
> The shell, slot map, and state machine described here are current, and Focus Points uses the same shell (its own spec is self-contained).

---

Build **one page with three states**, not three pages.

```
sessionState: 'before' | 'during' | 'after'
```

Visual reference: the full mockup markup for all three states is inlined in **Appendix A** at the end of this document — inline-styled and copy-pasteable, no external file needed. Those three panels are the target; everything below tells you how to get there.

---

## 1. The rule that governs everything

**Elements never move between states. They only change size and content.**

**The Practice Loop card is the page's subject and sits at eye level** — first thing under the header, full content width, on ink. It was previously the last card in the rail, below the fold, which is why users reported never seeing their coaching. Nothing that only resolves *after* the run may outrank it, and the transcript — which the user already read live — must not sit above it.

| Slot | before | during | after |
|---|---|---|---|
| **A** — top of content, full width | Mic card, ~150px | Recorder bar, collapsed | Mic returns, smaller + static waveform |
| **B** — below A, full width, ink | `LIVE COACHING`, one line | One live tip | **Practice Loop review** — verdict, evidence, fix, actions |
| **C** — under B, left, `flex: 1` | Transcript, empty + prompt offer | Transcript, live words | Transcript, fixed-height reference panel |
| **D** — under B, rail, 310px | Progress vs baseline | `THIS RUN` counts, live | `THIS RUN` final + retention line |

A user who looks away for ten seconds must never have to re-find anything. If a change makes an element jump columns or reorder, the change is wrong.

**Grid:** slots A and B are full-width block children. Below them, `display: flex; gap: 14px; align-items: flex-start` with C as `flex: 1; min-width: 0` and D as `width: 310px; flex-shrink: 0`. The rail does **not** stretch to match the transcript — `align-items: flex-start` is deliberate, so a long transcript never leaves the rail with a column of dead space.

**The transcript stops growing in `after`.** It is capped (`max-height`, internal scroll, `Read full transcript` link) because after the run it is *reference*, not the subject. An uncapped transcript pushes the rail's counts off screen and re-creates the original bug one level down.

---

## 2. Colour — four roles, no decoration

| Role | Hex | Owns |
|---|---|---|
| **Signature yellow** | `#ffb61f`; on white as text `#8a5510`, ground `#fdf3e2` | The only colour that means *act* or *attend*: primary CTA, card eyebrow on ink, recorded waveform, filler highlights, the live filler count |
| **Ink** | `#1c2333`; raised `#262f42`; hairline `#3a4457` | The one dark ground. The Practice Loop card and the `THIS RUN` rail in `during` |
| **Record red** | `#d92d20`; text on white `#a1261c` | The stop control and the `RECORDING` badge. Nothing else, ever |
| **Progress green** | `#146b4a`; bar `#1f9d6b` | Progress. Only ever attached to a real number |

Surfaces: page `#aeb9cd` · card `#ffffff` · card border `#c8d2e0` · body `#1f2733` · muted-on-white `#414b5c` · muted-on-ink `#9aa6bd`.

**Teal is retired from this page.** It marked primary actions, which yellow now owns; two action colours on one screen means neither reads as *the* action.

Hard rules: **yellow fills always take `#1c2333` text, never white.** **Never `#6b7688` on the `#aeb9cd` page surface** — it fails contrast; use `#232c3a` at 600. On ink, body text is `#9aa6bd` minimum.

**Disabled is a colour, not an opacity.** No control may express "disabled" by fading, lightening, or alpha-blending a brand colour — that includes `opacity: 0.6` on the mic, on primary buttons, and on the record control. A faded brand colour reads as an enabled control rendering badly, and it puts *act* or *stop* colour on something that does neither.

| Control | Disabled |
|---|---|
| Primary button | `#dbe2ec` fill, `#6b7688` text |
| Mic / record control | `#dbe2ec` fill, `#6b7688` glyph — **no red at any strength.** Red appears only when the control can actually record |
| Text link | `#9aa3b2`, no underline |

`cursor: not-allowed`, `aria-disabled`, and no hover transition. Opacity remains legitimate for dimming a whole inert *region*, never for a single control.

**Why the coaching card is ink.** In `after` the page holds four cards of comparable size, and on an all-white page they carried equal weight — the reported "everything blends, important windows get missed". One dark ground with one yellow accent creates hierarchy without moving or enlarging anything.

---

## 3. STATE: before

### 3.0 The slot map is not a suggestion — and this build ignored it

The 17 Sep build placed slot A (mic) in the **left column at half width**, put `LIVE COACHING` in the **right rail on white**, and started the two-column split at the top of the page. All three contradict §1, and the consequence is not cosmetic:

**A page built this way cannot transition.** The slot map exists so that nothing moves between `before`, `during` and `after`. If the two-column split starts at the top, there is no full-width slot for the Practice Loop review to occupy in `after` — so it lands in the rail, below the progress card, out of eye level. **That is the original reported bug, rebuilt.** The redesign's whole purpose was to get coaching above the fold; a half-width mic card is what forces it back down.

Build the page as **two full-width blocks stacked on top of a two-column row**, in that order:

```
┌─────────────────────────────────────────────┐  A  full width
├─────────────────────────────────────────────┤  B  full width, INK
├───────────────────────────┬─────────────────┤
│ C  flex: 1, min-width: 0  │ D  310px        │
└───────────────────────────┴─────────────────┘
```

Verify this before adding any content: render the four slots as empty boxes and confirm A and B span the full content width. If they do not, nothing built on top of them will be fixable later.

### 3.1 Slot B is ink in every state, including this one

**The coaching card is `#1c2333` from the first paint.** In the shipped build every surface is a white card on the `#aeb9cd` page, which is the *"everything blends, important windows will be missed"* complaint the palette change was made to fix. Five white cards of equal weight have no hierarchy — the ink band is what creates it, and it must be there in `before` or the page visibly reorganises itself when the user starts speaking.

`before` is the *only* state where slot B is short: one line of ink, ~64px tall. It grows into the verdict in `after`. It does not appear, change colour, or change column.

### 3.2 Say nothing that explains the interface

The shipped coaching card reads *"Your first tip appears here about 20 seconds in, based on what you actually say."* That is the interface describing its own mechanics, and it occupies the page's highest-value slot to do it.

Slot B in `before` carries **one short line of intent**, not instructions: yellow `LIVE COACHING` eyebrow and, beside it, `Tips appear as you speak.` — 15px/600 `#9aa6bd`. Four words. If the tip's arrival needs explaining, the tip is the thing to fix.

Same rule on the mic card: **one instruction, not two.** `Start recording` plus `Space bar works too · aim for 60 seconds` is a keyboard hint and a duration target stacked under a button the user already understands. Keep `Space bar works too`; drop the target — pace guidance belongs to Focus Points, where the user set a pace.

### 3.3 Decisions before speaking: one, maximum

The shipped `before` state asks for four: pick a practice focus from five chips, get a prompt, read a sample, or just start. **The page's only job in `before` is to get the user talking.**

- **Remove the `PRACTICE FOCUS · optional` chips.** Five choices marked *optional* is five things to read and dismiss. The product's premise is that it tells the user what to work on *after* listening — asking them to declare it up front inverts that, and a user who could name their focus accurately would not need the coaching.
- Keep the prompt offer inside the transcript's empty state: `Give me a prompt` (yellow fill) and one secondary. That is the one legitimate decision, and it lives where the words will appear.
- **Remove the bottom `Tracking common hesitation sounds` strip.** A full-width card for a settings link is the page's fifth card and its least important. Move `Add your filler words` into the transcript panel's header as a text link, or into `How Open Mic works`.
- **Remove the `✕` on the transcript panel.** The transcript is the product; it is not dismissible.

### 3.4 `COMPARABLE PROGRESS / No universal score` — cut it

The rail's most valuable slot currently states a non-feature: it tells the user what the product does *not* give them, before they have done anything. It also reads as a hedge.

Slot D in `before` is **the clarity change against the previous comparable session, per §6** — both scores and an arrow (`82% → 88%`), or a no-number line. It is **always a white card** with the eyebrow `CLARITY VS LAST SESSION`; it never renders a heading alone and never renders `—`. Which of the five Progress outcomes maps to which body is §6.1. **Never a card whose content is a disclaimer.**

### 3.5 Remaining details

**Header.** Title `Practice Session` (30px/800) with the subtitle beneath at 15px/600 `#232c3a`: `Session {n} · vs {date}` when slot D shows a number, `Session {n}` alone otherwise. *(Changed 19 Sep with Option A; `baseline set {date}` is retired and must appear nowhere.)* Both strings come from the same resolved progress object, so they cannot disagree. `▶ How Open Mic works` button on the right, baseline-aligned with the subtitle.

**Slot A — mic card.** Sizes to content, roughly 150px. Two rows:
1. `● Mic ready on this device` (green dot, 13px/800 `#146b4a`) and the device selector both sit **right** of the record control, not above it. *(Changed 19 Sep.)* Left-aligned the status reads as a label for the button and puts a device state ahead of the action in the reading path. Below 768px it wraps beneath the control rather than overlapping it.
2. Horizontal: a **76px orange circle containing a real microphone glyph** — an SVG capsule body, arc, stand and base. Never a dot, never `⏺`, never an emoji. Beside it: "Press to start speaking" (17px/800) over "Space bar works too · aim for 60 seconds" (13px `#414b5c`).

**Slot B — Live Transcript with the prompt offer inside it.**

The offer is an **overlay on the transcript's empty state. It is not its own card.** No second white box, no border of its own, no shadow. It borrows dead space; it never claims new space. This is the single most important instruction on this page — the previous design read as a wall of boxes and cost the user real decoding effort on arrival.

Card header: orange tick + `Live Transcript`, with a `✕` on the far right. Inside the dashed empty frame, centred:

- "Not sure what to say?" — 18px/800
- one sentence: *Take a prompt — it stays right here while you speak. Nothing on this panel is saved or scored.*
- the two buttons
- a quiet line: *Or just press the mic — your words appear here.*

`✕` dismisses to the plain empty state and persists per user. Leave a small `Need a prompt?` text link in the card header so it is recoverable.

**Buttons — a matched pair, equal weight.** `Give me a prompt` = signature yellow fill (`#ffb61f`), `#1c2333` text. `Read a sample` = `#f5f0ff` fill, `#ddd0fa` border, `#5b21b6` text. Never one button and one link: these are two branches of the same choice and must look like it.

**Clicking either replaces the empty-state content in place** — same card, same frame, 200ms slide from the top edge. The prompt stays visible through recording (the user is reading it) and clears on stop. Offer a `↻` to re-roll.

**Slot C — Progress vs baseline.** See §6.

**Slot D.** Purple `◎ LIVE COACHING` label and one line: *Your first tip appears here about 20 seconds in, based on what you actually say.* Nothing more.

Nothing animates. Nothing pulses. The page is quiet so the mic is the only thing asking for a decision.

---

## 4. STATE: during

**Trigger on the first audio frame, not on the click.** A click that fails mic permission must not change the layout — show the permission error inside the mic card and stay in `before`.

**Slot A — collapse to a bar.** Full width, 200ms height transition. Left to right: the **stop control** (52px, leading — it is the only thing the user might need to hit mid-run, so it sits where the mic was), then a single right-hand column holding `● RECORDING` (dot `#d92d20`, text `#a1261c`, 12px/800, `letter-spacing: 0.07em`) and the timer (16px/800 `tabular-nums` `#2b3446`) on one baseline, with the waveform filling the row beneath them.

**The timer is small here, not 30px.** During the run the number the user cares about is the waveform telling them they are being heard; a 30px clock invites clock-watching mid-sentence.

**One control, one position, three states.** The mic is the brand and the resting state: it is the button in `before`, it **becomes** the red stop while recording, and it **returns** when the run ends. Never introduce a second round button beside it, and never leave the mic off screen in `after` — the run is over, so the mic is once again what it always was: the way to start. **There is no playback control anywhere, in any state.** Audio is never stored, so there is nothing to play — see §5.

**The stop control — a red circle with a white square.** 58px `#d92d20` circle containing a 19px white square at `border-radius: 3px`, with `box-shadow: 0 6px 18px -6px rgba(217,45,32,0.7)`. The mic button **becomes** this control on record; it is not a second button appearing beside it. **Never a black or dark-fill `■ Stop` button** — black reads as disabled in this palette, and red-circle-white-square is the one recording control users already know from every device they own. The circle also carries the recording state, so the `● RECORDING` badge becomes confirmation rather than the only signal.

**Copy in the recorder bar: none.** No "tap to stop", no device name, no hint text. A red square and a waveform need no caption, and the run is the one moment the user should be looking away from the screen.

**Waveform rules (this bar, and the static shape kept in `after`).** This is the element most likely to read as fake, so the rules are exact.

**Geometry — hairlines, not bars.** Each line is `width: 2px; flex-shrink: 0`, `border-radius: 1px`, and the track is `display: flex; justify-content: space-between` so the leftover space becomes gap. **Do not use `flex: 1` on the lines.** `flex: 1; min-width: 2px` was the previous rule and it is wrong: `min-width` is a floor, not a width, so the lines grow to fill and you get ~5px blocks with 2px gaps — bars wider than their gaps, which is the "looks fake" render.

**Density carries the fineness.** Sample count is `floor(trackWidth / 4)`, recomputed on resize (`ResizeObserver`, debounced ~100ms). **Never hardcode a count.** A fixed count fails the same way `flex: 1` does: the rendered line-to-gap ratio becomes a function of container width, so a value tuned in one track produces lines wider than their gaps in every narrower one. The appendix markup ships a static run only because the mockup runtime cannot execute scripts — in the app, generate it.

**Centre-aligned, always.** `align-items: center` on the track, so lines are mirrored around a centre axis. Audio oscillates either side of zero; a waveform sitting on a baseline is a bar chart. This one property does more for authenticity than any other.

**Amplitude must contain silence.** Downsample the buffer to N buckets and take the **peak** of each bucket, never the mean — the mean flattens everything to mid-height mush. A speech envelope has: syllable bursts of 5–13 samples that rise and fall, 2–4 near-silent samples at word boundaries, and two or three genuine phrase pauses at ~4% amplitude. **Never render a track where every line has height** — uniform independent random heights read as static, not speech. Floor at 2px so silence is still visible as a line.

**Colour is a separate lookup from height.** `during`: index < recordedCount → `#ffb61f`, else `#c8d2e0` on white (`#3a4457` on ink). `after`: the whole shape goes flat `#c8d2e0`, with filler positions overriding both height (full) and colour (`#ffb61f`).

**There is one inactive-waveform grey: `#c8d2e0`** — the same token as the chart's baseline/past-runs series. It covers both the not-yet-recorded tail in `during` and the whole finished shape in `after`, because both mean *not live*. Earlier drafts used `#cfd8e4` and `#dfe5ee` in different places; those were palette drift, four points apart and semantically identical. **The recorded/unrecorded boundary is carried by yellow-against-grey, never by grey-against-grey** — if you find yourself needing a second grey to make that edge visible, the yellow is wrong. **No played/unplayed split in `after`** — there is no playhead, because there is no playback.

**Slot B — the transcript takes the screen.** `min-height: 420px`, text 19px/1.75. Header carries live counts: `{n} words · {x} fillers/min`. Fillers highlight the instant they land: background `#fdf3e2`, 2px `#d98a1f` bottom border, 3px radius. A 2px orange caret marks the live insertion point.

**Slot C — Progress, live.** Same slot, same position, recomputing against the baseline rate as the user speaks. **The number does not move on screen; only its value changes.** That continuity is the entire point of keeping the module in one place. Beneath it: `Baseline 3.4/min` and `Now 2.6/min`.

**Slot D — the `THIS RUN` rail, on ink.** 310px, `#1c2333`. Yellow `THIS RUN` eyebrow, then the live filler count at 40px/800 in **yellow** beside pace at 40px/800 in white — the filler count is the one number the user is trying to move, and it is the only number that gets the accent.

Beneath the numbers, **one live tip, and only one**: 13px/700, on a `#262f42` strip, phrased as the next action rather than a scolding — *"Two self-corrections in a row — finish the thought, then fix it."* **A tip holds for a minimum of 8 seconds** before it can be replaced, or it is unreadable while speaking. Never a stack.

**Slot C — the live transcript stays on white.** It is the one thing the user may actually read mid-run, so it keeps the highest-contrast surface. Header: `LIVE TRANSCRIPT` + `{n} words`. Fillers highlight the instant they land — `#fdf3e2` ground, `#8a5510` text at 800 — and a 2px `#ffb61f` caret marks the live insertion point.

Nothing is scored until Stop.

---

## 5. STATE: after

Not a new page. The same layout resolving.

**Slot A — the mic returns, in place, smaller.** The red square reverts to the mic in signature yellow: the run is over, so the button is once again the way to start another. The mic is the product's logo and may never be absent from a state. Beside it the run's waveform stays as a **static shape** — flat `#c8d2e0` with filler positions in full-height `#ffb61f` — plus the final duration and a `▮ filler` legend at 12px/700.

**No play button, no scrubber, no playhead, no seek, no download.** The waveform in `after` is a picture of the run, not a transport. This is not an omission to be helpfully filled in later: **audio is never written to disk and never leaves the tab**, which is the product's privacy position and the reason there is nothing to play. Any control implying otherwise is a promise the product does not keep.

**Slot B — the Practice Loop review.** Ink, full width, directly under the recorder. Yellow `PRACTICE LOOP REVIEW` eyebrow left, `Session {n} · Open Mic` right.

> **Phasing, settled 17 Sep. Read before building.**
>
> **The verdict and quotes (items 1–2) require a coaching contract that does not exist yet.** The persisted contract carries only `what_worked` and `what_to_try_next` — no verdict sentence, no quote references. Items 1–2 ship with `gemini_coaching_v2`; **items 3–4 and the ink ground ship now.**
>
> **Phase 1 — now.** Ink slot B, eyebrow, the shipped **one strength + one improvement** pair, then items 3–4. Delete the `Review unavailable` alert (§5b). This is a strict improvement on what is live and removes nothing.
>
> **Phase 2 — with v2.** The verdict and its quotes are inserted **above** the strength/improvement pair. **Build slot B to grow:** the pair is not the card's headline element, so a 24–26px verdict can be added above it without re-laying out the card. If the pair is built as the headline, phase 2 becomes a rebuild.
>
> **The guard binds `verdict ⇒ quotes`, not `quotes ⇒ card`.** An earlier draft scoped it to quotes, which would have blanked the working pair in every session until v2 landed. **A verdict may not render without evidence** — a synthesised claim about the user's speech needs their words attached. The strength/improvement pair is a different kind of statement: qualitative, per-session, asserting no pattern, so it needs no quote-level proof. With no verdict the guard is vacuously satisfied; it begins binding the moment v2 introduces one.
>
> **v2's quote references must be character offsets into the persisted transcript** — not phrases re-matched at render time. String-matching fails silently on a repeated phrase and will occasionally highlight the wrong instance of the right words, which is unrecoverable in the one card that has to be believed.

Four things, in this order:

1. **The verdict — one sentence, 24–26px/800, white, `max-width: 720px`.** Written as an observation with its consequence, not a grade: *"You corrected yourself three times in ninety seconds. Each one cost you the sentence you were building."* Never a paragraph, never a score out of 100.
2. **Evidence — two quotes, lifted verbatim from the transcript, with timestamps.** Each on a `#262f42` row, the filler inside the quote highlighted, the timestamp right-aligned in `tabular-nums`. **Quotes are mandatory, not decorative.** A verdict without the user's own words is an assertion they cannot check, and this is the one card that has to be believed.
3. **One fix**, in a `TRY THIS NEXT RUN` block: a single imperative sentence naming what to do differently. Same shape on the Analytics page so the lesson is recognisable in both places.
4. **Two actions** — `Practice again?` (yellow fill, `#1c2333` text, 16px/800) and `See all sessions` (text link, `#9aa6bd`). `Practice again?` is the loop closing; it is the page's primary action and reuses the same prompt.

**Slot C — the transcript becomes a reference panel.** Capped height with internal scroll, a `Read full transcript` link and the word count, and one retention line beneath: *"Your latest run only — the next session replaces it."* State retention as a consequence of the product working, not as a policy. **Never "we only keep 1 session"** — the metrics history is intact; only the readable transcript is replaced. Fillers keep their highlight; highlights are **not clickable**, because there is no audio to seek to.

**Slot D — `THIS RUN`, final.** White card, 310px. Three labelled rows — Fillers (count + `/min`), Pace (`wpm`), Words — then `Counted on device from the transcript.` with a `Count look wrong?` link. That link is the correction path for the product's weakest claim (missed fillers); it is not optional.

**No confetti. No score out of 100.** The number is a delta against the user's own past; that is the more honest motivator and the only one that survives a bad session.

---

## 5a. STATE: after · not eligible for coaching

**A session may only make a claim about the user's speech when all five eligibility gates hold** — completed, ≥30s, ≥75 words, transcript present, attribution verified. `coachingIneligibilityReason()` is the single predicate; **the same call decides whether this card shows a verdict and whether the home page's resume band may quote one.** If those two ever disagree, the session page tells the user what to fix and the home page refuses to repeat it.

**This is not the failure state.** §5b is a network failure on an eligible session — the review is coming. This is an ineligible session: **there is no review, and there never will be for this run.** Conflating them produces a permanent `RETRYING` chip on a four-second take.

Slot B keeps its position, ground and size. What changes:

- Eyebrow unchanged: `PRACTICE LOOP REVIEW`. **No status chip** — nothing is pending.
- **Headline names the shortfall as a fact, not a failure**, and is specific about the one gate that missed:
  - too short → *"That was a 12-second run — too brief to read a pattern from."*
  - too few words → *"Not enough words this time to say anything useful about your pace."*
  - no transcript → *"No transcript came through, so there's nothing to review this run."*
- One line, `#9aa6bd`: **the unlock condition, stated as a threshold the user can clear** — *"Runs over 30 seconds get a full review."* Never a scolding, never an apology.
- **The on-device counts still render** on the `#262f42` strip, exactly as §5b. They were computed from the transcript and are true regardless of eligibility — a 12-second run genuinely had two fillers.
- Action: **`Practice again?` stays primary and enabled.** A short run is the case where the user most obviously wants another go.
- **No `Retry review now`.** There is nothing to retry. Offering it manufactures a failure the user would then blame on the product.

**Never** a spinner, an error tone, a `0` where a verdict goes, or the word "failed". The run happened and was counted; it was simply too small to draw a conclusion from — and saying so plainly is more trustworthy than inventing a lesson, which is the bug this state exists to prevent.

---

## 5b. STATE: after · review failed

The review is a network call. The counts are not — they are computed on device from the transcript — so **a failed review must never blank the card.**

**The card keeps its position, its ground, its approximate height and its CTA.** Only the content changes. Nothing below it may move when the review arrives, or the user loses their place on a page they are already reading.

- Eyebrow unchanged: `PRACTICE LOOP REVIEW`. Status chip on the right: `● RETRYING` in yellow, replacing `Session {n} · Open Mic`.
- **Headline states what the user does have**, not what failed: *"Coaching is still coming. Here's what we counted on your device in the meantime."*
- One reassurance line, `#9aa6bd`: *"Nothing is lost — your session is saved and the review will appear here when it lands."*
- **The on-device counts fill the space the quotes would occupy** — fillers (yellow), words/min, self-corrections, on a `#262f42` strip at 30px/800. This is the whole idea: the slot is never empty, because the data that never depended on the network goes there.
- Actions: `Practice again?` stays primary and stays enabled — **the user can run the loop again without the review**. `Retry review now` is the secondary text link.

**What this replaces:** a card reading *"Review unavailable"* over an empty box with a Retry button, at the bottom of the page — a dead end that made a recoverable network blip look like a lost session.

**Never** show a spinner where the verdict goes, an error code, or a disabled `Practice again?`. Retry silently with backoff; the chip is the only progress indicator the user needs.

---

## 6. Progress vs baseline — data contract

> **Changed 19 Sep — Option A shipped in #1506. This replaces the fillers-per-minute contract.** Fillers per minute is no longer the progress metric, there is no rolling trend, and `BASELINE SET` is no longer a card label. Anything still reading a fpm baseline is stale.
> **Changed 20 Sep — presentation revised to "show the move". PM-approved for this card.** The card states **both scores and an arrow** (`82% → 88%`), not a lone delta. The eyebrow is `YOUR PROGRESS`. Anything still rendering `+6 clarity` or the eyebrow `CLARITY VS LAST SESSION` is stale. The underlying metric, threshold and eligibility gates are unchanged.
>
> **Scope of that approval: the session card only.** Three other surfaces state the same comparison and are **not** settled by this section — see §6.2. Do not change them from this doc.

- Metric is the **clarity-score change versus the previous comparable session** — not versus a fixed first run, and not fillers per minute.
- **The first qualifying session is the baseline.** It shows no delta. Qualification is the §5a eligibility set; a session that fails any gate is neither a baseline nor a comparison point.
- **Every later qualifying session** headlines **the move**: the previous qualifying session's clarity score, an arrow, and this session's score. Two values and a direction. No trend row, no sparkline, no third data point in this card.
- **Colour applies to the second number only, and every value is an existing token.** The previous score is `neutral-heading` (`#1c2333`); the arrow is `neutral-muted` (`#6b7688`); the hairline is `border-soft` (`#e6ebf2`). The current score is `#146b4a` only when the change clears the threshold as an improvement, `#8a5510` when it clears it as a regression, and `neutral-heading` when it does not clear it — report a regression, never scold. **No new tokens are introduced by this card.** Earlier drafts of this section quoted `#2b3446`, `#9aa3b2` and `#eef1f6`; those were unowned values, they are withdrawn, and the tokens above are the contract.
- **If the arrow competes with the scores optically,** reduce its size — it is a connector, not a third value. Do not add a lighter neutral to the palette for it.
- **No number is a first-class state, not an error.** With no comparable session — first qualifying run, no qualifying predecessor, or a failed read — the card renders its no-number body per the `before` delta. It never renders a heading alone and never renders `—`.
- **The card's eyebrow is `YOUR PROGRESS`** — 12px/800, `letter-spacing: 0.09em`, `#414b5c`. Not `CLARITY VS LAST SESSION` (names the composite instead of the outcome, and reads as abstract before the user has met the metric), and not `PROGRESS VS BASELINE` (names a comparison the contract no longer makes).
- **Scores render as percentages, matching every other clarity surface.** Session rows, the analytics table and the export already print clarity as `96%`. The card therefore prints `82% → 88%`. `font-variant-numeric: tabular-nums`, 34px/800, `letter-spacing: -0.035em`; the arrow is 22px/700 in `neutral-muted`.
- **The delta is never displayed.** No `+6`, no `+7.3%`. Both scores are on the card, so the difference is available without printing it; a delta beside the move states the same fact twice. Points remain the unit of the **rule** (§6.1) and never appear in the UI.
- **Why not percent-of-previous.** `+7.3%` is a ratio of the previous score, while the rows print `96%` as a score out of 100. Two different percents for one metric on adjacent surfaces. Rejected.
- **Window line names the session by date, and makes no claim about adjacency:** `Clearer than your {date} session.` / `Less clear than your {date} session.` / `Holding steady since {date}.` — 13px/600 `neutral-muted`, never a rolling window.
- **Why not `your last session`.** Eligibility (§5a) skips runs that fail a gate, so the session compared against is the last *qualifying* one and may not be the user's literal previous run. `your last session` would then be false. `your last comparable session` is true but adds a word the user must decode, which is the problem this revision exists to remove. Naming the date is true in every case, needs no decode, and is checkable against the session list. **Do not reintroduce `last`, `previous`, or `comparable` into this line.**
- **Composition line:** `Fillers, errors, pace` — 12px/600 `#6b7688`, above a `1px solid #eef1f6` hairline at the card's foot. It states what the score is made of, once, without defining it. Numeric bodies only.
- **`Clarity` is not renamed.** It remains the metric's name in session rows, the analytics table, the chart legend and the export. This delta demotes it from the headline to the composition line; renaming is a data-vocabulary change and is out of scope here.

### 6.1 The five Progress outcomes, mapped to the card's two bodies

The card has **two bodies**: one when a comparison exists, one when it does not. What varies *inside* the comparison body is the colour of the second score and the wording of the window line. There is no third body.

| Progress outcome | Body | Headline | Window line | Current-score colour |
|---|---|---|---|---|
| Improved (3+ points) | comparison | `82% → 88%` | `Clearer than your 14 Sep session.` | `#146b4a` |
| Declined (3+ points) | comparison | `88% → 83%` | `Less clear than your 14 Sep session.` | `#8a5510` |
| No meaningful change (under 3 points) | comparison | `88% → 89%` | `Holding steady since 14 Sep.` | `neutral-heading` |
| Baseline (first qualifying session) | no-number | `First session — this run becomes your baseline.` | `Comparisons start after your next full session.` | `neutral-heading` |
| Not eligible / comparison restarted / read failed | no-number | `No comparable run yet.` | `Comparisons start after your next full session.` | `neutral-heading` |

**The under-threshold case displays a number it does not celebrate, and this is deliberate.** `88% → 89%` shows a one-point move while the window line calls it holding steady. That is not an inconsistency to be fixed: the significance threshold is 3 points, so a one-point move is real arithmetic and not a real result. The old treatment hid this by printing `Held steady` in place of the figures, which left the user unable to tell a 1-point move from a 0-point one, or to see why one session was called out and another was not. Showing both scores makes the rule checkable by looking. **Do not suppress, round away, or recolour the second score to conceal a sub-threshold move,** and do not add a "not significant" annotation — the window line is the whole explanation.

**Why the under-threshold case is not a no-number state.** A comparison did happen; `No comparable run yet.` would be false. It renders the same two scores in the same slot, in neutral ink — not green, not amber, because it is neither.

**Why `comparison restarted` is a no-number state.** When the setup changes there is, by this contract's definition, no comparable session. `No comparable run yet.` is exactly that. **Do not explain the restart on this card** — it is a pre-session surface and the user has not spoken yet; the standing second line (`Comparisons start after your next full session.`) is already true and sufficient.

- The card renders all five outcomes from one component. Do not fork it per outcome.

### 6.2 Other surfaces stating the same comparison — settled 20 Sep

Clarity is rendered as a percent in the analytics dashboard, the trend chart (`unit: '%'`) and the session comparison dialog. That is the evidence this card's percent formatting rests on, and those surfaces already agree with it.

Three surfaces stated the *change* in **percent-of-previous**, which this section rejects. **PM decided on 20 Sep that all three move to the two-value form**, matching the card:

| Surface | Was | Now |
|---|---|---|
| Progress panel | `Clear delivery improved 7.3% vs your previous comparable session` | The two-value form, per §6 and §6.1 |
| PDF export | Same string as the Progress panel | The two-value form; the shared string changes once |
| FAQ | Answer describing the comparison as a percentage | Reworded to the two-value form |

**Percent-of-previous is now retired product-wide.** No surface states a change in clarity as a ratio of the previous score. `7.3%` appearing anywhere is stale.

The four surfaces ship in one change, so no two ever state the same comparison in different units.

---

## 7. Build order

1. **`before`, static** — mic card, coaching strip, transcript, rail. Verify no card has dead space at 1280 / 1440 / 1024px.
2. **Practice Loop card as slot B, full width, at the top.** Build this before the transcript; if it is built last it ends up last on the page again.
3. **Progress card** as one data-driven component against §6; render it in all three states.
4. **Prompt overlay** inside the transcript empty state, with dismissal persistence and the recovery link.
5. **`during` transition** — bar collapse, live counters, live tip with the 8-second hold. Ship against a fake stream before wiring real audio.
6. **Waveform per §4** — generated at `floor(trackWidth / 4)`, peak-per-bucket, centre-mirrored. Do not ship a hardcoded line set.
7. **`after`** — mic returns in yellow, static waveform with filler markers, review card with verbatim quotes, transcript capped. **No playback control.**
8. **`after · review failed` per §5b** — build it in the same component as `after`, switching content only. If it is a separate component it will drift.
9. **Regression pass** — all four slots hold position across all four states at all three widths; both waveforms render 2px hairlines with gaps wider than the lines; no view offers playback, seek, or download.

## Acceptance checks

| Check | Pass condition |
|---|---|
| Slot geometry | In **all** states, slots A and B each span the full content width (`getBoundingClientRect().width` equal to the content column). The two-column row starts below B |
| Slot B is ink | Slot B computes to `rgb(28, 35, 51)` in `before`, `during` and `after` — not white in any state |
| Coaching at eye level | The Practice Loop card's top edge is above the fold at 1280×800 in `after`, with no scrolling |
| One decision in `before` | No practice-focus chips, no dismissible panels; the only choice offered is the prompt pair inside the transcript empty state |
| No self-description | No copy explaining when or how the UI will update ("appears here about 20 seconds in"); slot B in `before` is ≤6 words |
| No disclaimer cards | No card whose body states an absent feature ("No universal score"). Slot D shows a real number or one plain line |
| Card count in `before` | Four slots, four surfaces. No fifth full-width card for settings links |
| Slot stability | Every slot's `getBoundingClientRect().top` is unchanged between `after` and `after · review failed` |
| Never a dead end | With the review endpoint forced to fail, the card still shows its counts and an enabled `Practice again?` |
| Eligibility is one predicate | The verdict card and the home resume band call the same `coachingIneligibilityReason()`. Gates-fail ⇒ no verdict on either surface, counts on both |
| Ineligible ≠ failed | A 12-second run shows §5a (no chip, no retry, unlock condition), never §5b's `RETRYING` |
| No invented lesson | With any gate failing, no verdict, quote or fix string renders anywhere in the app for that session |
| Verdict implies evidence | No code path renders a verdict sentence without at least one quote. With no verdict present the check passes trivially |
| Pair survives phase 1 | Every eligible session shows exactly one strength and one improvement, on the ink ground, before v2 exists |
| Slot B can grow | A verdict can be inserted above the pair without changing the pair's own styling or the card's action row |
| String gone | `Review unavailable` appears nowhere in the codebase |
| Quotes are real | Every review quote appears verbatim in the transcript, with a timestamp |
| Waveform density | Line count `=== floor(trackWidth / 4)` in **every** track; rendered gap wider than the 2px line |
| Waveform silence | ≥25% of lines at ≤4px; track is centre-mirrored |
| Mic present | A microphone glyph in signature yellow is visible in `before` and `after`; the stop control is the same element, recoloured |
| No transport | No play, pause, scrub, seek or download control in any state |
| Transcript capped | In `after` the transcript cannot push the rail's counts below the viewport |
| Retention copy | Says latest-run-only as a consequence; no string says "two most recent" or "we only keep 1 session" |
| Colour discipline | No teal anywhere; red only on the stop control and `RECORDING`; yellow on exactly one action per state |
| Contrast | Every text node ≥4.5:1 (3:1 at headline scale); no `#6b7688` on `#aeb9cd`

---

# Appendix A — mockup markup

Reference rendering for all three states, inline-styled and framework-free. Font is Manrope 400–800; the page sits on `#8d9ab3`. Lift colours, sizes and spacing directly; **where this markup and the prose disagree, the prose wins.**

Each fragment is static — one representative moment per state, not a working component. In the real product this is **one page** whose slots change content; do not build three pages.

## A1 — `before`

Recoloured to the §2 palette on 14 Sep; its layout predates the §1 slot move, so **take colour and component detail from here, position from §1.**

```html
<div style="display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px;">
      <h3 style="margin: 0; font-size: 17px; font-weight: 800;">Before — big mic, prompts in the rail, progress on top</h3>
    </div>
    

    <div style="background: #aeb9cd; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 50px -22px rgba(31,39,51,0.4); margin-bottom: 44px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 22px; background: #ffffff; border-bottom: 1px solid #dbe2ec;">
        <div style="display: flex; align-items: center; gap: 20px; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 9px;">
            <div style="display: flex; align-items: flex-end; gap: 2px; height: 19px;">
              <div style="width: 3px; height: 7px; background: #d98a1f; border-radius: 2px;"></div>
              <div style="width: 3px; height: 14px; background: #d98a1f; border-radius: 2px;"></div>
              <div style="width: 3px; height: 19px; background: #d98a1f; border-radius: 2px;"></div>
              <div style="width: 3px; height: 11px; background: #d98a1f; border-radius: 2px;"></div>
            </div>
            <span style="font-weight: 800; font-size: 18px; letter-spacing: -0.02em;">SpeakSharp</span>
          </div>
          <div style="display: flex; align-items: center; gap: 2px; font-size: 14px; font-weight: 700;">
            <span style="display: flex; align-items: center; gap: 7px; white-space: nowrap; color: #5a6472; padding: 9px 13px;"><span style="font-size: 14px;">⌂</span> Home</span>
            <span style="display: flex; align-items: center; gap: 7px; white-space: nowrap; background: #fdf3e2; color: #8a5510; padding: 9px 13px; border-radius: 9px;"><span style="font-size: 15px;">⏺</span> Session</span>
            <span style="display: flex; align-items: center; gap: 7px; white-space: nowrap; color: #5a6472; padding: 9px 13px;"><span style="font-size: 14px;">⊪</span> Analytics</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; flex-shrink: 0; gap: 12px; font-size: 13px; color: #414b5c;">
          <span style="display: flex; align-items: center; gap: 5px; flex-shrink: 0; white-space: nowrap; background: #fdf3e2; border: 1px solid #f0dcb8; color: #8a5510; font-size: 12px; font-weight: 800; padding: 7px 12px; border-radius: 999px; letter-spacing: 0.04em;">⚡ PRO</span>
          <span style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap;"><span style="font-size: 13px;">⌗</span> Report issue</span>
          <span style="display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; background: #fdf3e2; color: #8a5510; font-size: 12px; font-weight: 800;">K</span>
          <span style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; white-space: nowrap; font-weight: 700; color: #3d4757;"><span style="font-size: 13px;">⤶</span> Sign Out</span>
        </div>
      </div>

      <div style="padding: 30px 40px 38px; display: flex; flex-direction: column; gap: 22px;">
        <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 28px;">
          <div>
            <h1 style="margin: 0 0 6px; font-size: 30px; font-weight: 800; letter-spacing: -0.032em;">Practice Session</h1>
            <p style="margin: 0; font-size: 15px; font-weight: 600; color: #232c3a;">Session 5 · baseline set 12 Jul</p>
          </div>
          <span style="display: inline-flex; align-items: center; gap: 8px; background: #1c2333; color: #ffb61f; font-size: 14px; font-weight: 700; padding: 10px 16px; border-radius: 10px; white-space: nowrap;">▶ How <strong style="font-weight: 800;">Open Mic</strong> works</span>
        </div>

        <div style="display: grid; grid-template-columns: 1.55fr 1fr; gap: 22px; align-items: stretch;">

          <div style="display: flex; flex-direction: column; gap: 14px;">
          <div style="background: #ffffff; border: 1px solid #dbe2ec; border-radius: 16px; padding: 18px 24px 22px; display: flex; flex-direction: column;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px;">
              <span style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; color: #146b4a;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #1f9d6b;"></span> Mic ready on this device</span>
              <span style="display: flex; align-items: center; gap: 8px; border: 1px solid #dbe2ec; border-radius: 9px; padding: 7px 12px; font-size: 13px; font-weight: 700; color: #3d4757;">Browser <span style="color: #6b7688;">⌄</span></span>
            </div>
            <div style="display: flex; align-items: center; gap: 20px; padding: 18px 0 2px;">
              <div style="width: 76px; height: 76px; flex-shrink: 0; border-radius: 50%; background: #d98a1f; box-shadow: 0 0 0 8px rgba(217,138,31,0.16); display: flex; align-items: center; justify-content: center;">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#241503" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0"></path><line x1="12" y1="17" x2="12" y2="21"></line><line x1="8.5" y1="21" x2="15.5" y2="21"></line></svg>
              </div>
              <div>
                <div style="font-size: 17px; font-weight: 800; color: #1f2733; margin-bottom: 4px;">Press to start speaking</div>
                <div style="font-size: 13px; color: #414b5c;">Space bar works too · aim for 60 seconds</div>
              </div>
            </div>
          </div>

          <div style="background: #ffffff; border: 1px solid #dbe2ec; border-radius: 16px; padding: 18px 24px 20px; flex: 1; display: flex; flex-direction: column;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px;">
              <span style="display: flex; align-items: center; gap: 9px;"><span style="width: 3px; height: 15px; background: #d98a1f; border-radius: 2px;"></span><span style="font-size: 15px; font-weight: 800;">Live Transcript</span></span>
              <span style="font-size: 15px; color: #6b7688; cursor: pointer;">✕</span>
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; border: 1px dashed #d3dbe6; border-radius: 12px; padding: 30px 26px; text-align: center;">
              <div style="font-size: 18px; font-weight: 800; letter-spacing: -0.02em;">Not sure what to say?</div>
              <p style="margin: 0; max-width: 400px; font-size: 14px; line-height: 1.55; color: #414b5c;">Take a prompt — it stays right here while you speak. Nothing on this panel is saved or scored.</p>
              <div style="display: flex; align-items: center; gap: 10px; margin-top: 2px;">
                <button style="background: #ffb61f; color: #1c2333; border: none; font-family: inherit; font-size: 14px; font-weight: 700; padding: 10px 16px; border-radius: 9px; cursor: pointer;">Give me a prompt</button>
                <button style="background: #f5f0ff; color: #5b21b6; border: 1px solid #ddd0fa; font-family: inherit; font-size: 14px; font-weight: 700; padding: 10px 16px; border-radius: 9px; cursor: pointer;">Read a sample</button>
              </div>
              <div style="font-size: 13px; color: #7d8798;">Or just press the mic — your words appear here.</div>
            </div>
          </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 14px;">
            <div style="background: #ffffff; border: 1px solid #dbe2ec; border-radius: 16px; padding: 18px 22px 20px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px;">
                <span style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #414b5c;">PROGRESS VS BASELINE</span>
                <span style="font-size: 12px; font-weight: 700; color: #6b7688;">?</span>
              </div>
              <div style="display: flex; align-items: baseline; gap: 10px;">
                <span style="font-size: 40px; font-weight: 800; color: #146b4a; letter-spacing: -0.035em; line-height: 1;">+18%</span>
                <span style="font-size: 14px; font-weight: 700; color: #414b5c;">fewer fillers<br>than session 1</span>
              </div>
              <div style="display: flex; align-items: flex-end; gap: 6px; height: 46px; margin: 16px 0 8px;">
      <!-- Static hairline waveform. N = floor(trackWidth / 4) — generate, never hardcode.
           Lines: width 2px; flex-shrink: 0; border-radius: 1px. Track: align-items: center.
           Base #c8d2e0; filler positions full-height #ffb61f. No playhead, no split. -->
      <div style="width: 2px; flex-shrink: 0; height: 18px; background: #c8d2e0; border-radius: 1px;"></div>
      <div style="width: 2px; flex-shrink: 0; height: 30px; background: #ffb61f; border-radius: 1px;"></div>
      <!-- … -->
                <div style="flex: 1; height: 30px; background: #1f9d6b; border-radius: 4px;"></div>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: #6b7688;">
                <span>Baseline</span>
                <span>Last session</span>
              </div>
            </div>

            <div style="background: #ffffff; border: 1px solid #dbe2ec; border-radius: 16px; padding: 18px 22px 20px; flex: 1; display: flex; flex-direction: column;">
              <span style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #6d28d9; margin-bottom: 10px;">◎ LIVE COACHING</span>
              <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #414b5c;">Your first tip appears here about 20 seconds in, based on what you actually say.</p>
            </div>
          </div>
        </div>

        <div style="background: #ffffff; border: 1px solid #dbe2ec; border-radius: 16px; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
          <span style="font-size: 14px; font-weight: 700; color: #3d4757;">Tracking 13 filler words</span>
          <a href="#g1" style="font-size: 14px; font-weight: 700; color: #8a5510;">Add your filler words</a>
        </div>
      </div>
    </div>
```

## A2 — `during`

> **Corrected 17 Sep.** The filler count was white at 40px with pace at 24px and the tip in yellow. Now: **filler count `#ffb61f` at 40px, pace `#ffffff` at 40px, tip body `#eef1f7`** — matching §4 and brief S-10.
>
> **Where an appendix and the prose rules disagree, the prose wins and the appendix is the bug.** The appendices are generated from a mockup; the rules are the reasoning. Report the conflict rather than building the markup.

```html
<div style="background: #aeb9cd; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 14px;">

  <div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px; padding: 16px 20px; display: flex; align-items: center; gap: 18px;">
    <button style="flex-shrink: 0; width: 52px; height: 52px; border-radius: 50%; border: none; background: #d92d20; box-shadow: 0 6px 18px -6px rgba(217,45,32,0.7); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;" aria-label="Stop recording"><span style="display: block; width: 18px; height: 18px; border-radius: 3px; background: #ffffff;"></span></button>
    <div style="flex: 1; min-width: 0;">
      <div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 9px;">
        <span style="display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 800; letter-spacing: 0.07em; color: #a1261c;"><span style="width: 7px; height: 7px; border-radius: 50%; background: #d92d20;"></span>RECORDING</span>
        <span style="font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; color: #2b3446;">1:12</span>
      </div>
      <div style="flex: 1; display: flex; align-items: center; justify-content: space-between; height: 34px; overflow: hidden;" aria-hidden="true"><!-- 180 line divs at this width; N = floor(trackWidth / 4) — generate, see §3 --><div style="width: 2px; flex-shrink: 0; height: 9px; background: #ffb61f; border-radius: 1px;"></div><!-- … --></div>
    </div>
  </div>

  <div style="display: flex; gap: 14px; align-items: flex-start;">
    <div style="flex: 1; min-width: 0; background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px; padding: 18px 20px 20px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px;">
        <span style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #414b5c;">LIVE TRANSCRIPT</span>
        <span style="font-size: 12px; font-weight: 700; color: #6b7688;">147 words</span>
      </div>
      <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #2b3446;">Yesterday I told Dr. Maya Chen that Project Noster needs 17.5% less latency, not 70% — and <mark style="background: #fdf3e2; color: #8a5510; font-weight: 800; padding: 1px 3px; border-radius: 3px;">sorry</mark>, the revised budget is 4,325. The meeting moved from Thursday to Tuesday. <mark style="background: #fdf3e2; color: #8a5510; font-weight: 800; padding: 1px 3px; border-radius: 3px;">I mean</mark> we shipped three builds, <mark style="background: #fdf3e2; color: #8a5510; font-weight: 800; padding: 1px 3px; border-radius: 3px;">sorry</mark> two builds<span style="display: inline-block; width: 2px; height: 17px; background: #ffb61f; vertical-align: -3px; margin-left: 2px;"></span></p>
    </div>

    <div style="width: 310px; flex-shrink: 0; background: #1c2333; border-radius: 14px; padding: 18px 20px 20px;">
      <div style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #ffb61f; margin-bottom: 14px;">THIS RUN</div>
      <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px;">
        <div>
          <div style="font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: -0.035em; color: #ffb61f; font-variant-numeric: tabular-nums;">3</div>
          <div style="font-size: 13px; font-weight: 700; color: #9aa6bd; margin-top: 5px;">fillers so far</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: -0.035em; color: #ffffff; font-variant-numeric: tabular-nums;">122</div>
          <div style="font-size: 13px; font-weight: 700; color: #9aa6bd; margin-top: 5px;">words / min</div>
        </div>
      </div>
      <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid #3a4457; font-size: 13px; font-weight: 700; color: #eef1f7; line-height: 1.45;">Two self-corrections in a row — finish the thought, then fix it.</div>
    </div>
  </div>
</div>
```

## A3 — `after`

```html
<div style="background: #aeb9cd; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 14px;">

  <div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 12px; padding: 12px 18px; display: flex; align-items: center; gap: 14px;">
    <button style="width: 40px; height: 40px; flex-shrink: 0; border-radius: 50%; border: none; background: #ffb61f; box-shadow: 0 0 0 4px rgba(217,138,31,0.16); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;" aria-label="Start recording"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#241503" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0"></path><line x1="12" y1="17" x2="12" y2="21"></line><line x1="8.5" y1="21" x2="15.5" y2="21"></line></svg></button>
    <span style="font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; color: #2b3446;">2:04</span>
    <div style="flex: 1; display: flex; align-items: center; justify-content: space-between; height: 30px; overflow: hidden;" aria-hidden="true"><!-- 160 line divs at this width; N = floor(trackWidth / 4) — generate, see §3 --><div style="width: 2px; flex-shrink: 0; height: 4px; background: #c8d2e0; border-radius: 1px;"></div><!-- … --></div>
    <span style="flex-shrink: 0; font-size: 12px; font-weight: 700; color: #6b7688;">▮ filler</span>
  </div>

  <div style="display: flex; gap: 14px; align-items: flex-start;">

    <div style="flex: 1; min-width: 0; background: #1c2333; border-radius: 16px; padding: 24px 26px 26px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 18px;">
        <span style="display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #ffb61f;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffb61f" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v4M12 17v4M4.5 12h4M15.5 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5L15 9M9 15l-2.5 2.5"></path></svg>PRACTICE LOOP REVIEW</span>
        <span style="font-size: 12px; font-weight: 700; color: #7d8aa3;">Session 6 · Open Mic</span>
      </div>

      <h4 style="margin: 0 0 16px; font-size: 26px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.25; color: #ffffff; max-width: 560px; text-wrap: pretty;">You corrected yourself three times in ninety seconds. Each one cost you the sentence you were building.</h4>

      <div style="display: flex; flex-direction: column; gap: 11px; margin-bottom: 20px;">
        <div style="background: #262f42; border-left: 3px solid #ffb61f; border-radius: 0 9px 9px 0; padding: 12px 15px;">
          <div style="font-size: 14px; line-height: 1.5; color: #e6eaf2; font-style: italic;">“We shipped three builds, <strong style="font-style: normal; font-weight: 800; color: #ffb61f;">sorry</strong> two builds and version 4.2 was the slower one.”</div>
          <div style="font-size: 12px; font-weight: 700; color: #9aa6bd; margin-top: 6px; font-variant-numeric: tabular-nums;">1:04</div>
        </div>
        <div style="background: #262f42; border-left: 3px solid #ffb61f; border-radius: 0 9px 9px 0; padding: 12px 15px;">
          <div style="font-size: 14px; line-height: 1.5; color: #e6eaf2; font-style: italic;">“I said cash, not cash — <strong style="font-style: normal; font-weight: 800; color: #ffb61f;">I mean</strong> because returning users should not download the model again.”</div>
          <div style="font-size: 12px; font-weight: 700; color: #9aa6bd; margin-top: 6px; font-variant-numeric: tabular-nums;">0:47</div>
        </div>
      </div>

      <div style="background: #ffb61f; border-radius: 12px; padding: 18px 20px;">
        <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.1em; color: #5c3c04; margin-bottom: 7px;">TRY THIS NEXT RUN</div>
        <div style="font-size: 16px; font-weight: 800; line-height: 1.48; color: #1c2333; text-wrap: pretty;">Say the number once and move on. If it was wrong, correct it at the end of the sentence — not in the middle of it.</div>
      </div>

      <div style="display: flex; align-items: center; gap: 14px; margin-top: 22px;">
        <button style="background: #ffb61f; color: #1c2333; border: none; font-family: inherit; font-size: 16px; font-weight: 800; padding: 15px 26px; border-radius: 11px; cursor: pointer;">Practice again?</button>
        <a href="#g10" style="font-size: 14px; font-weight: 700; color: #9aa6bd;">See all sessions</a>
      </div>
    </div>

    <div style="width: 310px; flex-shrink: 0; display: flex; flex-direction: column; gap: 14px;">

      <div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px; padding: 18px 20px 20px;">
        <div style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #414b5c; margin-bottom: 14px;">THIS RUN</div>
        <div style="display: flex; flex-direction: column; gap: 13px;">
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px;">
            <span style="font-size: 14px; font-weight: 700; color: #414b5c;">Fillers</span>
            <span style="font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: #8a5510;">6 <span style="font-size: 13px; font-weight: 700; color: #6b7688;">· 2.9/min</span></span>
          </div>
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px;">
            <span style="font-size: 14px; font-weight: 700; color: #414b5c;">Pace</span>
            <span style="font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: #146b4a;">122 <span style="font-size: 13px; font-weight: 700; color: #6b7688;">wpm</span></span>
          </div>
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px;">
            <span style="font-size: 14px; font-weight: 700; color: #414b5c;">Words</span>
            <span style="font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: #2b3446;">147</span>
          </div>
        </div>
        <div style="margin-top: 15px; padding-top: 13px; border-top: 1px solid #eef1f6; font-size: 12px; font-weight: 600; color: #6b7688; line-height: 1.45;">Counted on device from the transcript. <a href="#g10" style="font-weight: 700;">Count look wrong?</a></div>
      </div>

      <div style="background: #ffffff; border: 1px solid #c8d2e0; border-radius: 14px; padding: 18px 20px 20px;">
        <div style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #414b5c; margin-bottom: 8px;">TRANSCRIPT</div>
        <div style="font-size: 13px; line-height: 20px; color: #6b7688; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; position: relative;">Okay, I'm starting right away because people do not always wait for software to fill already. Yesterday I told Dr. Maya Chen that Project Noster needs 17.5% less latency, not 70% and the rest and the revised budget is 4,325…</div>
        <div style="display: flex; align-items: center; gap: 14px; margin-top: 13px;">
          <a href="#g10" style="font-size: 14px; font-weight: 800;">Read full transcript</a>
          <span style="font-size: 12px; font-weight: 700; color: #6b7688;">147 words</span>
        </div>
        <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid #eef1f6; font-size: 12px; font-weight: 600; color: #6b7688; line-height: 1.45;">Your latest run only — the next session replaces it.</div>
      </div>
    </div>
  </div>
</div>
```

## A4 — `after · review failed`

> **Corrected 17 Sep.** A third count (`3 self-corrections`) was shown. Self-corrections **are not measured**, so it is removed: **two counts, fillers in `#ffb61f` and words/min in `#ffffff`.**
>
> This state's entire credibility is that the numbers are real because they never touched the network. A stubbed third count destroys the only thing the card has. **Two honest counts beat three with one invented.**

Identical container, grid and rail to A3. Only slot B's contents differ — diff this against A3's ink card rather than treating it as a new layout.

```html
<div style="background: #aeb9cd; border-radius: 14px; padding: 18px;">
  <div style="display: flex; gap: 14px; align-items: flex-start;">
    <div style="flex: 1; min-width: 0; background: #1c2333; border-radius: 16px; padding: 24px 26px 26px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 18px;">
        <span style="font-size: 12px; font-weight: 800; letter-spacing: 0.09em; color: #ffb61f;">PRACTICE LOOP REVIEW</span>
        <span style="display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 800; color: #ffb61f;"><span style="width: 7px; height: 7px; border-radius: 50%; background: #ffb61f;"></span>RETRYING</span>
      </div>
      <h4 style="margin: 0 0 8px; font-size: 24px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.3; color: #ffffff; max-width: 560px;">Coaching is still coming. Here's what we counted on your device in the meantime.</h4>
      <p style="margin: 0 0 20px; font-size: 14px; font-weight: 600; color: #9aa6bd; line-height: 1.5; max-width: 520px;">Nothing is lost — your session is saved and the review will appear here when it lands.</p>
      <div style="background: #262f42; border-radius: 12px; padding: 18px 20px; display: flex; gap: 26px; flex-wrap: wrap;">
        <div><div style="font-size: 30px; font-weight: 800; line-height: 1; color: #ffb61f; letter-spacing: -0.03em;">6</div><div style="font-size: 13px; font-weight: 700; color: #9aa6bd; margin-top: 5px;">fillers</div></div>
        <div><div style="font-size: 30px; font-weight: 800; line-height: 1; color: #ffffff; letter-spacing: -0.03em;">122</div><div style="font-size: 13px; font-weight: 700; color: #9aa6bd; margin-top: 5px;">words / min</div></div>
        <!-- Two counts only. A third goes here ONLY when a third metric is genuinely measured on device — never stubbed. See S-15. -->
      </div>
      <div style="display: flex; align-items: center; gap: 14px; margin-top: 22px;">
        <button style="background: #ffb61f; color: #1c2333; border: none; font-family: inherit; font-size: 16px; font-weight: 800; padding: 15px 26px; border-radius: 11px; cursor: pointer;">Practice again?</button>
        <a href="#g10" style="font-size: 14px; font-weight: 700; color: #9aa6bd;">Retry review now</a>
      </div>
    </div>
  </div>
</div>
```
