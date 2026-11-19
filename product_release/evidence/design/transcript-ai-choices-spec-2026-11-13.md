# Transcript storage & AI coaching choices: design recommendation

**Status:** Design and recommendation only. Nothing here is approved. Every default, every legal term and every deletion behaviour is a **recommendation for Akin to decide**.
**Standalone:** this document is complete by itself. Layout, tokens, copy, states and acceptance criteria are all here (§5a gives the screen layouts). The companion board `Transcript AI Choices.dc.html` is an illustration only. If the two ever differ, this document wins.
**Sources read on `main` (dad87d7, 13 Nov 2026):** `reviewCopy.ts`, `LegalPage.tsx` (Privacy, Terms), `AuthPage.tsx`, `FeaturesSection.tsx`, `PrivateRepeatSection.tsx`, `landingOffer.ts`, `offerDisclosure.ts`, `USER_GUIDE.md`, `README.md`, `get-ai-suggestions/index.ts`, `StatusNotificationBar` test strings, `guided-waitlist` (consent-record pattern).
**PR descriptions (pasted by PM, 13 Nov):**
- **#1820 (merged, disclosure only):** audio stays on the device. A saved transcript is stored in the account and sent to an AI service, and coaching currently starts automatically after save. Customer copy says "AI service", and the Privacy Policy names Google Gemini and the inputs (transcript up to 8,000 characters, measurements, Focus Points topic, points and results). Newest-one retention keeps text only on the newest transcript-bearing session. **Removed text stays in a server-side recovery copy that the app doesn't show.** No deletion timetable and no provider training or retention terms are promised. No consent controls or behaviour change.
- **#1835 (draft requirements, not implemented):** separate transcript-storage and AI-coaching boundaries across saving, automatic UI invocation and the server coaching handler. It covers settings, revocation vs deletion, account isolation and in-flight races. Open: defaults, existing users, placement, wording, declined-storage behaviour, retention, provider terms. Remaining work: the two choices, server + UI enforcement, **non-saving completion**, settings and revocation surfaces, and tests of isolation, races and negative network/database paths.

**Theme:** every colour below is a `--brand-*` role from `frontend/src/index.css` (#1480 theme authority). Use the role, never a copied hex. Values are listed for reference.

| Role | Value | Used here for |
|---|---|---|
| `ink` | `#1c2333` | Selected option fill, Continue, switch "on" track, dialog primary button, review band ground |
| `ink-raised` | `#262f42` | Question panels inside an ink band (1b) |
| `ink-hairline` | `#3a4457` | Dividers and outlined buttons on ink |
| `ink-text` / `ink-muted` | `#eef1f7` / `#9aa6bd` | Text on ink |
| `signature` | `#ffb61f` | **Fill only on practice actions:** Start recording, Practise again. Never filled on a consent control |
| `signature-ground` / `signature-border` / `signature-text` | `#fdf3e2` / `#f0dcb8` / `#8a5510` | Selected-option tint and ✓, plus the active nav pill (existing) |
| `money-on-ink` | `#c4b5fd` | Clear-delivery number on ink (existing metric colour) |
| `neutral-page` | `#ffffff` | Card ground |
| `neutral-band` | `#f7f9fc` | Inline reason and info panels |
| `neutral-border` / `-soft` / `-strong` | `#dbe2ec` / `#e6ebf2` / `#c8d2e0` | Card border / row dividers / unselected option border |
| `neutral-heading` / `-body` / `-secondary` / `-muted` | `#1c2333` / `#1f2733` / `#414b5c` / `#6b7688` | Titles / body / help text / unavailable option text |
| `surface-session` | `#aeb9cd` | Session page and Account page ground |
| `error` / `-ground` / `-border` | `#b42318` / `#fef3f2` / `#fda29b` | Internal blocker tags only. Never on user-facing consent UI |

Destructive actions use the existing outline `Button` variant (like `Manage billing`). They are never red and never yellow, matching the plain `Delete account` link (#1643). Font is the app's Inter stack. Radius: cards 12px, buttons and options 10px.

---

## 1. Recommendations at a glance

| Decision | Recommendation | Main alternative |
|---|---|---|
| Where the choices first appear | **Two options, 1a and 1b (§5a). Leaning 1a, before the first recording. 1b is at the first Stop.** | — |
| Default: save transcripts | **Nothing preselected.** The user picks. | On, with notice |
| Default: AI coaching | **Nothing preselected.** The user picks. | Off |
| Dependency (AI needs saving) | **Keep it for v1.** It matches today's server contract (`409 requires an available saved transcript`). | Coach without storing (§4.3) |
| Existing users (choice unknown) | **Ask at next session start.** Auto-coaching is paused server-side until they answer. Past data is untouched. | One-time banner, current behaviour continues |
| Revoking while a review is generating | **Stop it and discard the result.** Say plainly that text already sent can't be recalled. | Let this one finish, stop future ones |
| Settings home | **Account page (`AccountPage.tsx`) → new "Privacy & data" Card between Membership and the `Delete account` link.** It uses the same Card shell, so all data actions sit together. | Separate `/account/privacy` page if the Account page gains more cards |
| Stop vs delete | **Two separate controls.** A switch stops future use. A button deletes what's already saved. Turning a switch off never deletes anything. (S7's optional "Also delete" checkbox is hidden while Q5 is open.) | — |

---

## 2. What #1820 put on `main`

| # | Surface | File | Current copy |
|---|---|---|---|
| D1 | Landing feature card | `landing/FeaturesSection.tsx:55` | "Every customer recording uses on-device Private transcription, and the audio is never uploaded. Saved transcripts are stored in your account and sent to an AI service for coaching. …" |
| D2 | Landing privacy band | `landing/PrivateRepeatSection.tsx:26` | "Your speech is transcribed on your device, and the audio is never uploaded or saved. Saved transcripts are stored in your account and sent to an AI service for coaching." |
| D3 | Landing chip | `landing/landingOffer.ts:89` | "Saved transcripts are sent to an AI service for coaching" |
| D4 | Pricing chip | `pricing/offerDisclosure.ts:8` | same as D3 |
| D5 | Review card (Open Mic) | `session/reviewCopy.ts` `OPEN_MIC_DISCLOSURE` | "Your transcript is sent to an AI service for coaching. Your filler counts and pace go with it; audio is never sent." + link "Who provides it" → `/privacy#service-providers` |
| D6 | Review card (Focus Points) | `reviewCopy.ts` `FOCUS_POINTS_DISCLOSURE` | "… Your Focus Points topic, points and results and relevant speaking measurements go with it; audio is never sent." |
| D7 | Privacy: How Data Is Used | `LegalPage.tsx` | "When a session is saved, its transcript text, measurements, and coaching results are stored with the session in your account. Retention duration and deletion timing are still being finalized…" |
| D8 | Privacy: Service Providers | `LegalPage.tsx` | names Google Gemini, "up to 8,000 characters", "Coaching currently starts automatically after a session is saved." |
| D9 | Privacy: Control | `LegalPage.tsx` | "You can choose whether to practice and use Share Feedback for … data questions." |
| D10 | User guide | `USER_GUIDE.md` Privacy + "What is processed…" | auto-coaching, newest-transcript retention, **"SpeakSharp keeps a server-side copy of removed text that the app does not show."** |
| D11 | Mic-ready status | `StatusNotificationBar` | "Private ready. Audio stays on this device; your transcript is saved with the session." |
| — | **Signup** | `AuthPage.tsx` | **No transcript or AI disclosure found.** It mentions on-device transcription only. If #1820 meant to cover signup, it didn't land on `main`. |

### Conflicts found
1. **Server-side recovery copy (BLOCKER for deletion):** #1820 and D10 confirm removed transcript text stays in a recovery copy. **Do not promise complete deletion or a deletion timetable** until the actual behaviour of the recovery copy, logs, backups and provider is verified. Until then, S8 says only "removed from your account", and the S7 "Also delete" checkbox is left out.
2. **Retention:** D7 says retention is "still being finalized". D10 says only the newest transcript stays visible. Our G15 spec says "We keep one transcript." **The consent surfaces in this doc make no retention claim** until this is settled.
3. **Coaching outlives the transcript:** `get-ai-suggestions` returns stored coaching after the transcript expires. Coaching reviews are derived content and may quote speech. Whether "delete" covers them is an Akin decision (Q6).

---

## 3. Flow

```
NEW USER
Sign up (one heads-up line) ─► Practice ─► [1a Choice card, slot A, before Start]
                                         or [1b Choice band, slot B, at first Stop]
                          │
         ┌────────────────┼──────────────────────────┐
   Save ✓ · AI ✓     Save ✓ · AI ✗              Save ✗ (AI unavailable)
   today's flow:     session saved,             measurements saved, transcript
   auto-coaching     review = measured only     page-only ─► S4
   after save        ─► S5

EXISTING USER (choice unknown)
Next Practice visit ─► [S2 Choice card, "until now…"] ─► same three branches
Server: unknown = no AI call, ever.

ANY TIME
Account ─► Privacy & data [S6]
   ├─ Save transcripts off ─► [S7 confirm] ─► AI also turns off; optional "also delete"
   ├─ AI coaching off ─► if a review is generating ─► [S3 confirm] ─► stop + discard
   └─ Delete saved transcripts ─► [S8 confirm]   (BLOCKED on Q5 recovery copy)
```

---

## 4. Defaults, dependency and existing users

### 4.1 Where the choice appears
Both options are specified in §5a (1a, 1b). **Leaning 1a: before the first recording,** so the user knows what will happen before they speak. It's one card in slot A of the session page, in the same place the one-time model setup already appears. Start stays disabled until both questions are answered.

- **For:** the choice is known before any transcript exists, so nothing is ever saved or sent on an assumption. The user isn't holding a just-finished take hostage to a form. Slot A already hosts one-time setup, so nothing moves.
- **Against:** it's one more step before the first take, and the user is choosing in the abstract before they've seen a transcript.
- **Alternative (first Stop):** more in context, but it interrupts the most rewarding moment. Unsaved work would also sit waiting on the answer, and if the tab closes, the session is lost.
- **Not at signup:** buried among account fields and agreed in bulk, it reads as consent by bundling.

### 4.2 Defaults
**Recommended: neither question preselected.** Two explicit choices, each with two equal-weight buttons. No toggle starts in an "on" position.

- Saving changes what's stored on our servers. AI coaching sends text to a third party. Both deserve an affirmative act.
- **Cost:** some users will decline AI coaching, which is the product's main value. Mitigation: the S5 "AI coaching is off" band shows what they're missing and links straight to the setting. It doesn't nag; it appears once per session view.
- **If Akin prefers "Save on, with notice":** keep AI unselected anyway. The third-party transfer is the higher-stakes choice.
- **Declined, saving:** measurements (pace, filler words, clarity, pauses) are still saved, because they power Progress. The transcript is shown on the session page only and is gone when the user leaves or starts a new take. *Confirm with Akin that measurements are outside choice #1 (Q2).*
- **Declined, AI:** sessions save as normal. The review band shows measured results only. Nothing is sent to the AI service.

### 4.3 Dependency: AI coaching needs saving
**Recommended: keep it for v1.** The server already refuses coaching without a stored transcript, so the UI simply tells the truth.

Concerns to flag:
- It locks out a reasonable user: "coach me, but don't keep my words." That's the most privacy-conscious user who still wants the product's value.
- It makes turning saving off a two-for-one. S7 must say that AI turns off too.
- **Copy rule:** no surface may suggest that coaching without storage already works.
- **#1835 "non-saving completion"** is what S4 shows: the session completes, measurements save, the transcript doesn't.
- **Alternative: coach without storing.** The transcript is sent once from the session page, the review is stored and the transcript text isn't. This needs a new server path, because today's contract reads the stored transcript. The review would still hold derived text, so it overlaps with Q6. Engineering cost; recommend as v2.

### 4.4 Existing users
**Recommended:** treat everyone with no recorded choice as **unknown**.
- At their next Practice visit, show S2 (same card, different intro). Start is disabled until they answer.
- The **server treats unknown as AI off** from the day the control ships, so a stale client or another tab can't trigger coaching.
- Past saved transcripts and reviews are **not changed** by the answer. S2 says so and points to Privacy & data.
- **Alternative:** keep auto-coaching for unknown users and show a one-time banner. It's lower friction, but it continues a transfer the user never actively chose. Not recommended.

### 4.5 Revoking while coaching is in progress
**Recommended:** turning AI off (directly, or by turning saving off) while a review is generating shows S3. Confirming:
1. stops the client waiting
2. the server **refuses to persist** any result that arrives after revocation
3. the session shows "Coaching stopped. No review was saved for this session."

The copy must say that text already sent for this review can't be recalled. We can't call back a request the provider has already received, and we don't promise what the provider does with it (no retention or training claims until verified).

---

## 5. States (what the user sees)

| ID | State | Where | User sees |
|---|---|---|---|
| S1 (1a) | First use, choice not made | Session page slot A | Choice card. Start disabled, and Continue shows the visible reason "Choose both options to continue." |
| S1 (1b) | First use, alternative | Session page slot B after first Stop | Choice band on ink, transcript labelled `NOT SAVED YET`, `Save session` |
| S1b | First use, "Don't save" picked | Same | The AI question is disabled, with the reason inline. Continue is enabled. |
| S2 | Returning user, choice unknown | Same | Choice card with the "Until now…" intro and an **"Already in your account"** panel (real counts) saying the choices don't change or delete existing data. Coaching paused. |
| S3 | AI revoked while a review is generating | Privacy & data → dialog; then session | Confirm dialog, then the band reads "Coaching stopped. No review was saved for this session." |
| S4 | Unsaved session | Session after-state | "NOT SAVED" label on the transcript, page-only note, measured results, AI-off line |
| S5 | Saved session, AI off | Session after-state + saved review | "AI coaching is off." Measured results, link to turn it on |
| S6 | Settings | Account → Privacy & data | Two switches (future use), divider, delete actions (past data) |
| S7 | Turning saving off | Dialog | Explains AI also turns off and the saved transcript stays. Optional unticked "Also delete my saved transcript" **only after Q5 is resolved.** |
| S8 | Delete saved transcripts | Dialog | Irreversible; measurements stay; doesn't reach text already sent for coaching |

---

## 5a. Screen layouts

Shared building blocks, used everywhere below:

| Block | Spec |
|---|---|
| **Card** | Same as the Membership `Card` on `/account`: `neutral-page` ground, 1px `neutral-border`, radius 12px, padding 24–26px, `--shadow-card` |
| **Question** | `fieldset`. Legend 16px/800 `neutral-heading`. Help 14px/500 `neutral-secondary`, line-height 1.5. Then a row of two **options**, `display:flex; gap:10px`, each `flex:1` |
| **Option, unselected** | An option tile: min-height 66px, padding 12px 14px, 1.5px `neutral-border-strong`, radius 10px. Title 15px/800 `neutral-heading`, then a consequence line 13px/500 `neutral-secondary`, left-aligned. The consequence is shown before the choice, so users know what each answer does |
| **Option, selected** | `signature-ground` fill, 2px `signature-text` border, `neutral-heading` label 15px/800, preceded by a `signature-text` `✓`. This is the same warm tint as the active nav pill: it marks a selection, not an action. State is shown by the tint **and** the tick, never colour alone. On ink (1b): `ink-text` fill with an `ink` label and ✓ |
| **Option, unavailable** | 1.5px **dashed** `neutral-border-strong`, label `neutral-muted`, `aria-disabled="true"`, still focusable |
| **Reason panel** | `neutral-band` ground, 1px `neutral-border-soft`, radius 8px, padding 10–12px, 14px/600 `neutral-body` |
| **Primary (non-practice)** | min-height 46px, padding 0 26px, radius 10px. Enabled: `ink` fill, `ink-text` 16px/800. Disabled: `neutral-border-soft` fill, `neutral-secondary` text, with the visible reason 12px/600 directly below |
| **Switch row** | Label 16px/700 + description 14px `neutral-secondary` on the left. On the right, a text state (`On`/`Off`, 13px/700) and a 46×28 track: on = `ink` with a white knob on the right, off = `neutral-border-strong` with the knob on the left. Row padding 16px 0, divider `neutral-border-soft` |
| **Dialog** | Scrim `ink` at 55%. Card radius 12px, padding 24px. Title 19px/800, body 15px/1.55 `neutral-body`, secondary note 14px `neutral-secondary`. Buttons right-aligned, gap 10px: secondary (`Cancel`/`Keep it on`) 2px `ink` outline, primary `ink` fill. **Never red** |
| **Ink band** | The existing review band in slot B: `ink`, radius 13px, padding 22–24px. Eyebrow 12px/800, letter-spacing 0.1em, `ink-muted`. Numbers 28px/800 tabular, `ink-text` (clarity in `money-on-ink`). Footer divided by 1px `ink-hairline` |

### 1a. First use: before the first recording (leaning)
Ground: `surface-session`. Placed in **slot A** of the session page (where the one-time model setup appears), above the Start control.
```
┌ Card ─────────────────────────────────────────────────────┐
│ Two choices before you start                       21px/800 │
│ Your audio is transcribed on this device…           15px     │
├─ divider ──────────────────────────────────────────────────────┤
│ Save transcripts to your account?                          │
│ Saved transcripts let you reread…                          │
│ [   Save transcripts   ] [      Don't save       ]          │
├─ divider ──────────────────────────────────────────────────────┤
│ Get AI coaching?                                           │
│ After each saved session… Audio is never sent. Who provides it
│ [   Get AI coaching    ] [      No coaching      ]          │
├─ divider ──────────────────────────────────────────────────────┤
│ You can change either choice… 13px       [ Continue ]       │
│                                 Choose both options to continue.
└──────────────────────────────────────────────────────────┘
( ● ) Start recording — disabled until Continue
```
- Nothing preselected. **Continue is `ink`, not yellow.** Yellow appears only on Start recording once it enables.
- "Who provides it" is a text link to `/privacy#service-providers`.
- When the card clears, slot A returns to the mic card and nothing else moves.
- **For:** no transcript exists before a choice. **Against:** one more step before the first take, and the choice is made before the user has seen a transcript.

### 1b. First use: at the first Stop (alternative)
Replaces the Practice Loop review in **slot B** for the first take only. On ink.
```
┌ Ink band ────────────────────────────────────────────────────┐
│ BEFORE WE SAVE THIS TAKE                (eyebrow, ink-muted)│
│ What should happen to this transcript?       20px ink-text │
│ ┌ ink-raised ────────────────────────────────────────────────┐ │
│ │ Save transcripts…?  [Save transcripts] [Don't save]    │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌ ink-raised ────────────────────────────────────────────────┐ │
│ │ Get AI coaching?  help…  [Get AI coaching] [No coaching] │ │
│ └────────────────────────────────────────────────────┘ │
│ Your measurements are ready below.        [ Save session ] │
└─────────────────────────────────────────────────────────┘
┌ Card: TRANSCRIPT  [NOT SAVED YET]  (first lines, capped) ┐
```
- Options on ink: 1px `ink-hairline` outline, `ink-text` label. Selected: `ink-text` fill with `ink` label and ✓.
- `Save session` uses an `ink-text` fill with an `ink` label, so it's high contrast but not yellow.
- The take is held only on the page until the user answers. If the tab closes, nothing is saved, and the existing recovery banner applies (measurements only, #1306).
- **For:** asked in context with the real transcript. **Against:** it interrupts the most rewarding moment and can lose the take.

### S1b. "Don't save" picked
Same card as 1a. `Don't save` is shown selected. Both AI options switch to **unavailable**, and a **reason panel** appears directly under them: "AI coaching needs a saved transcript. Choose Save transcripts to use it." Continue enables (`ink`).

### S2. Existing user, choice unknown
Same position and card as 1a, with three changes:
1. Title and intro change to the S2 copy (§7).
2. Between the intro and the first question, an **"Already in your account" panel** (reason-panel style). Eyebrow 13px/800, then 14px body with real counts: "1 saved transcript (Today, 5:43 AM) and coaching reviews on 12 sessions. Your choices below don't change or delete them. Manage in Privacy & data". Hidden when nothing is saved.
3. The footer line changes to the S2 footer.

### S4. Unsaved session (saving off)
Session after-state on `surface-session`.
```
┌ Ink band ────────────────────────────────────────────────────┐
│ MEASURED RESULTS                                            │
│ 118 words per minute   4 filler words   88% clear delivery  │
├─ ink-hairline ─────────────────────────────────────────────────┤
│ AI coaching is off because transcripts aren't being saved.  │
│ Change in Privacy & data (link, ink-text)                   │
└─────────────────────────────────────────────────────────┘
┌ Card ──────────────────────────────────────────────────────────┐
│ TRANSCRIPT  [NOT SAVED]                                    │
│ This transcript is only on this page. It's gone when you…  │
│ (transcript text, capped height, internal scroll)          │
└──────────────────────────────────────────────────────────┘
```
`NOT SAVED` is a text tag: 12px/800, letter-spacing 0.06em, 1.5px `ink` outline, radius 6px, `ink` text.

### S5. Saved session, AI coaching off
Same as S4, except:
- The band footer reads "**AI coaching is off.** Your session and transcript are saved." with a right-aligned `Turn on AI coaching` button (1px `ink-hairline` outline, `ink-text`, min-height 44px). It opens Privacy & data.
- The transcript card has no tag or note.
- The #1820 disclosure line never renders.

### S6. Account → Privacy & data
On `/account` (`AccountPage.tsx`, `max-w-3xl`, `surface-session` ground). Order: `YOUR ACCOUNT` eyebrow + `Account` h1 → Membership Card (unchanged) → **new Privacy & data Card** → `Delete account` link (unchanged).
```
┌ Card ──────────────────────────────────────────────────────────┐
│ Privacy & data                         (CardTitle 18px/700) │
│ Audio is transcribed on this device and never uploaded.    │
├────────────────────────────────────────────────────────────┤
│ Save transcripts                             On  [●──●]   │
│ New sessions keep their transcript in your account.        │
├────────────────────────────────────────────────────────────┤
│ AI coaching                                  On  [●──●]   │
│ After each saved session… Who provides it                  │
│ Writing a review for Today, 5:43 AM…   (only while running) │
╒══ 2px ink rule ════════════════════════════════════════════════════════╡
│ ALREADY SAVED                                  13px/800    │
│ Turning a setting off stops future use. It doesn't delete… │
├────────────────────────────────────────────────────────────┤
│ Saved transcript                 [ Delete saved transcripts ]
│ Today, 5:43 AM · Open Mic                                  │
├────────────────────────────────────────────────────────────┤
│ Coaching reviews (proposed, Q6)          [ Delete reviews ] │
│ On 12 sessions                                             │
└──────────────────────────────────────────────────────────┘
Delete account   (existing plain link)
```
- The 2px `ink` rule plus the `ALREADY SAVED` heading is what separates future use from past data. Don't drop either one.
- Delete buttons use the outline `Button` variant (as `Manage billing`). They stay outlined when focused or hovered.
- With saving off, the AI switch shows `Off`, is `aria-disabled`, and its description is replaced by "Needs Save transcripts to be on."
- Empty state for the transcript row: "No saved transcripts." (no button).
- Below 640px: each row stacks, and buttons go full width under their label.

### S3 / S7 / S8. Dialogs
All use the **Dialog** block. Copy is in §7.
- **S3** opens when AI is turned off (directly, or via S7) while a review is generating. Focus starts on `Keep it on`. After confirming, the session's ink band footer reads "**Coaching stopped.** No review was saved for this session."
- **S7** opens when Save transcripts is switched off. The "Also delete my saved transcript" checkbox (22px box, 2px `ink` border, starts unticked, 44px row) is **left out until Q5 is resolved**.
- **S8** opens from `Delete saved transcripts`. **Blocked (Q5).** The copy says "removed from your account" only, with no timetable and no "everywhere". When done, the row shows the empty state and a polite live region announces "Saved transcripts deleted."

---

## 6. Stopping vs deleting

| User action | Stops future | Deletes past | Copy that carries it |
|---|---|---|---|
| Save transcripts → off | New transcripts not stored | **Nothing** (unless "Also delete" ticked) | "Your saved transcript stays until you delete it." |
| AI coaching → off | No new AI requests | **Nothing.** Past reviews stay | "Reviews already written stay on their sessions." |
| Delete saved transcripts | — | Transcript text in account (+ hidden copy, **pending Q5**) | "This can't be undone. Your measurements and progress stay." |
| Delete coaching reviews | — | Stored AI reviews (**pending Q6**) | proposed row in S6 |
| Delete account | everything | everything | existing G21 flow; unchanged |

Rule: **a switch never deletes, and a delete button never changes a switch.**

---

## 7. Copy by surface

All strings are proposals. Locked PO strings (D5/D6) need PO approval before any change.

### S1 First-use card
- Status line (above title): ● Audio stays on this device — `progress-bar` dot + `status` text, the same pattern as "Mic ready on this device"
- Title: **Two choices before you start**
- Intro: Your audio is transcribed here and never uploaded. You decide what happens to the transcript.
- Q1 legend: **Save transcripts to your account?**
  - Help: Your measurements (pace, filler words, clarity) are saved either way.
  - Options (title / consequence line):
    - `Save transcripts`: Reread it and download a report later.
    - `Don't save`: See it now. It's gone when you leave.
- Q2 legend: **Get AI coaching?**
  - Help: After each saved session, your transcript and speaking measurements are sent to an AI service, which writes your review. Audio is never sent. `Who provides it`
  - Options:
    - `Get AI coaching`: A written review after each session.
    - `No coaching`: Measured results only. Nothing goes to the AI service.
  - Disabled reason (Q1 = Don't save): AI coaching needs a saved transcript. Choose Save transcripts to use it.
- Footer: You can change either choice any time in Account → Privacy & data.
- Primary: `Continue` · disabled reason: Choose both options to continue.

### S2 Existing user card
- Title: **Choose how your transcripts are used**
- Intro: Until now, each saved session was stored in your account and sent for AI coaching automatically. Coaching is paused until you choose.
- Questions: as S1.
- Footer: This applies to new sessions. Anything already saved stays as it is; manage it in Account → Privacy & data.

### S3 Revoke while coaching
- Dialog title: **Turn off AI coaching?**
- Body: A review is being written for your session from {time}. If you turn coaching off now, we'll stop and won't save that review. Text already sent for it can't be recalled.
- Buttons: `Turn off coaching` · `Keep it on`
- Session band after: **Coaching stopped.** No review was saved for this session.

### S4 Unsaved session
- Transcript label: `NOT SAVED`
- Note: This transcript is only on this page. It's gone when you leave or start a new take.
- Review band: **Measured results.** AI coaching is off because transcripts aren't being saved. `Change in Privacy & data`

### S5 Saved, AI off
- Review band: **AI coaching is off.** Your session and transcript are saved. `Turn on AI coaching`
- (Proposed, Q8: per-session `Get coaching for this session`.)

### S6 Privacy & data
- Section title: **Privacy & data**
- Lead: Audio is transcribed on this device and never uploaded.
- Switch: **Save transcripts**: On: New sessions keep their transcript in your account. · Off: New transcripts stay on the session page and aren't saved.
- Switch: **AI coaching**: After each saved session, your transcript and speaking measurements are sent to an AI service to write your review. Audio is never sent. `Who provides it`
  - Disabled: Needs Save transcripts to be on.
  - Status while generating: Writing a review for {time}…
- Group label: **Already saved**
- Note: Turning a setting off stops future use. It doesn't delete anything already saved.
- Row: **Saved transcript** · Today, 5:43 AM · `Delete saved transcripts`
- Row (proposed): **Coaching reviews** · On {n} sessions · `Delete reviews`
- Empty: No saved transcripts.

### S7 Turn off saving
- Title: **Stop saving transcripts?**
- Body: New sessions won't keep their transcript. AI coaching will turn off too, because it needs a saved transcript. Your saved transcript from {date} stays until you delete it.
- Checkbox (unticked; **omitted until Q5 is resolved**): Also delete my saved transcript
- Buttons: `Stop saving` · `Cancel`

### S8 Delete saved transcripts
- Title: **Delete saved transcripts?**
- Body: Transcript text is removed from your account. Your measurements and progress stay. This can't be undone.
- Second line: This doesn't affect text already sent to the AI service for coaching.
- Buttons: `Delete transcripts` · `Cancel`
- Done (live region): Saved transcripts deleted.

### Signup (new; replaces nothing)
- Under the sign-up form: You'll choose whether transcripts are saved and whether AI coaching is used before your first session.

---

## 8. #1820 mapping: what changes once controls exist

| # | Current claim | Still true with controls? | Proposed |
|---|---|---|---|
| D1 | "Saved transcripts are stored in your account and sent to an AI service for coaching." | **No.** Reads as unconditional | "…the audio is never uploaded. You choose whether transcripts are saved to your account and whether they're sent to an AI service for coaching." |
| D2 | same | **No** | "Your speech is transcribed on your device, and the audio is never uploaded or saved. You choose whether transcripts are saved and whether they're used for AI coaching." |
| D3/D4 | "Saved transcripts are sent to an AI service for coaching" | **No** | "AI coaching only if you turn it on" *(only valid if the no-preselect default is approved; otherwise "You can turn off AI coaching")*. Update `LandingG12.contract.test.tsx` FACTUAL_CHIPS. |
| D5/D6 | "Your transcript is sent to an AI service…" | **Yes.** Shown only when AI is on | Keep the wording (PO-locked). Add a `Change` link to Privacy & data beside `Who provides it`. Never render when AI is off. |
| D7 | "When a session is saved, its transcript text… are stored" | Partly | "When a session is saved, its measurements are stored in your account. If transcript saving is on, its transcript text is too, and if AI coaching is on, so is the review." Keep "still being finalized" until retention is decided. |
| D8 | "Coaching currently starts automatically after a session is saved." | **No** | "If you turn on AI coaching, it starts automatically after each saved session. You can turn it off in Account → Privacy & data." Provider name stays here only. |
| D9 | "You can choose whether to practice…" | Incomplete | "In Account → Privacy & data you can choose whether transcripts are saved and whether AI coaching is used, and delete saved transcripts. Turning a setting off stops future use; it doesn't delete what's already saved." |
| D10 | auto-coaching; hidden server copy | **No** | Rewrite to match D7–D9. **Hidden-copy sentence must be resolved, not reworded** (Q5). |
| D11 | "your transcript is saved with the session." | **No when off** | On: unchanged. Off: "Private ready. Audio stays on this device; this transcript won't be saved." |
| Signup | none | — | Add the signup line in §7. |

**Never promised anywhere:** provider retention periods, "not used for training", or deletion at the provider. Verify these with the provider's current terms first.

---

## 9. Acceptance criteria

### 9.1 What the user sees

| ID | Check |
|---|---|
| U-1 | A new user can't start a first recording until both questions are answered. Start shows the visible reason. |
| U-2 | Choosing `Don't save` disables the AI question with its reason inline, and Continue enables. |
| U-3 | An existing user with no recorded choice sees S2 on the next Practice visit, and no AI request runs before they answer. |
| U-4 | AI on: the D5/D6 disclosure renders in every review card. AI off: it never renders, and S5 shows instead. |
| U-5 | Saving off: the transcript shows the `NOT SAVED` label and page-only note. After reload or a new take, it's gone. |
| U-6 | Turning AI off during generation shows S3. On confirm, no review appears for that session, even if the response arrives later. |
| U-7 | Turning saving off also turns AI off. S7 says so before confirming. |
| U-8 | No switch deletes data. Data is deleted only by an explicit delete action (S8, the proposed reviews row, or the S7 checkbox once enabled). |
| U-9 | After S8, the saved transcript row shows the empty state. Session pages show "Transcript not saved", and measurements still appear in Progress. |
| U-10 | No consent surface states a retention period or provider training/retention practice. |

### 9.2 Accessibility

| ID | Check |
|---|---|
| A-1 | Each S1/S2 question is a `fieldset` + `legend` with two `radio` inputs styled as buttons. Arrow keys move within the group, and nothing is preselected. |
| A-2 | A disabled control (the AI question, Start, Continue) stays focusable via `aria-disabled="true"`, with `aria-describedby` pointing at its visible reason text. No title-only reasons. |
| A-3 | Settings switches are `button role="switch"` with `aria-checked`, the label as accessible name and the description linked via `aria-describedby`. |
| A-4 | Dialogs (S3, S7, S8) trap focus, start on the non-destructive button, close on Esc as Cancel, and return focus to the triggering control. |
| A-5 | State changes ("Coaching stopped…", "Saved transcripts deleted.", "Writing a review…") are announced in a polite live region. |
| A-6 | State is never shown by colour alone. `NOT SAVED`, `On`/`Off` and disabled reasons are text. |
| A-7 | Targets ≥44×44px with ≥8px between adjacent targets. Text contrast ≥4.5:1, including disabled-reason text. |
| A-8 | The "Who provides it" link opens `/privacy#service-providers` in the same tab, and the target heading receives focus. |
| A-9 | At 320px the choice options stack vertically and nothing scrolls horizontally. |

### 9.3 Server enforcement (hiding a control is not enough)

| ID | Rule |
|---|---|
| E-1 | **Consent record:** store `transcript_save` and `ai_coaching` per user as `granted / declined / unknown`, plus `consent_version`, `changed_at` and `source` (`first_use`, `existing_prompt`, `settings`). The `guided_waitlist` consent columns are the in-repo pattern. |
| E-2 | **`get-ai-suggestions` checks consent at request time.** Unless `ai_coaching = granted` and `transcript_save = granted`, it refuses with a typed code (e.g. `consent_required`), makes **no provider call**, and the client renders S5. Unknown = refuse. |
| E-3 | **Re-check before persisting.** After the provider responds, re-read consent. If revoked in the meantime, discard the result and write nothing (S3). |
| E-4 | **The save path refuses transcript text** when `transcript_save ≠ granted`, even if a client sends it. Measurements still save (pending Q2). |
| E-5 | **Unknown is fail-closed for AI.** For transcript save under unknown, recommend fail-closed too (Q3). |
| E-6 | **Delete actually deletes:** S8 removes the transcript text from every server location, **including the copy described in D10** (pending Q5), and returns success only after it's done. |
| E-7 | Revocation affects only future and in-flight work. It never deletes stored rows unless the delete action is invoked. |
| E-8 | Telemetry records consent changes as events (`transcript_save_changed`, `ai_coaching_changed`) with no transcript text or speech-derived values. |
| E-9 | Old clients: a cached app that still auto-requests coaching gets `consent_required` and must not show a coaching error as a failure. Map it to S5. |

---

## 10. Questions for Akin

1. **Defaults:** approve "nothing preselected" for both, or "Save on, AI asked"?
2. **Scope of choice #1:** are measurements outside it (always saved), as today?
3. **Unknown users and saving:** before they answer S2, does a save store the transcript (current behaviour) or not (fail-closed)? Recommend not, but S2 blocks Start, so this only matters for stale clients.
4. **Dependency:** keep "AI needs saving" for v1? Is "coach without storing" wanted for v2?
5. **Hidden server copy (BLOCKER):** USER_GUIDE says removed text is kept server-side. Does "Delete saved transcripts" remove it? If it isn't removed, the button can't ship as worded.
6. **Coaching reviews:** they can quote speech and they outlive the transcript. Are they deleted with the transcript, deletable separately (proposed row), or kept?
7. **In-flight revoke:** approve stop-and-discard, or let the current review finish?
8. **Per-session coaching:** with AI off, offer `Get coaching for this session` as a one-off? (Not in v1 screens.)
9. **Retention line:** which claim is true today (one transcript vs newest-visible plus hidden copy)? Consent surfaces stay silent on retention until this is answered.
10. **Provider terms:** who verifies provider retention and training practice, and does Legal want any of it stated in the product?
11. **Signup:** confirm no consent at signup, just the one-line heads-up.
12. **#1835:** reconciled against the PR description PM pasted on 13 Nov. Confirm nothing in the full draft contradicts §1.

---

## 11. Blockers before build
- Q5 hidden server copy → blocks S8 and the D10 rewrite.
- Q9 retention → blocks any retention sentence on these surfaces (and G15 §4).
- E-1/E-2 consent record + server check → must land before any UI ships. A client-only control would show a choice the server doesn't honour.