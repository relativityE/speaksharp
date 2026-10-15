# `Practice again?` start-up — mockup for PM review (C10)

SpeakSharp · #1258 RWT · 15 Oct 2026

> **Standalone.** This file is the whole proposal: the problem, what each screen looks like, the exact wording, and the decision needed. It doesn't refer to any other document, mockup file or image.

## The problem

After a take, the user presses **`Practice again?`**. Recording takes about **6 seconds** to start:
- about 5.8 s to prepare the speech engine;
- about 0.5 s to open the microphone.

Anything the user says during that time isn't recorded. If the screen looks unchanged or looks "live", users either lose their opening line or press the button again.

## The fix, in two parts (one issue)

| Part | What | Design work |
|---|---|---|
| **A. Shorter wait** | The app prepares a fresh speech engine while the user is reading their review. The target is under 1 second from press to recording. (A new engine per take is kept on purpose, because reusing one leaked the last take's words into the next transcript.) | None |
| **B. Honest wait** (this mockup) | Every second of any remaining wait is visible, and nothing claims to be recording before it is | Below |

B is still needed after A, because slow phones and laptops will still wait.

## The screens

Each frame is the recorder card. **Bold** is a button. `[ ]` is the timer and waveform area.

### 0 · Before the click (the review screen, unchanged)

```
┌──────────────────────────────────────────────┐
│ PRACTICE LOOP REVIEW                          │
│ …the session's review…                        │
│                                               │
│  ███ Practice again? ███    See all sessions  │
└──────────────────────────────────────────────┘
```
`Practice again?` is the yellow button.

### 1 · Right after the click: getting ready (0 to about 6 s)

```
┌──────────────────────────────────────────────┐
│ OPEN MIC                                      │
│                                               │
│              ◌  Getting your mic ready…       │
│                                               │
│      (no timer · no waveform · no red dot)    │
│                                               │
│            [ Starting… ]  ← greyed, disabled  │
└──────────────────────────────────────────────┘
```
- It appears **immediately** on the click. There's never a second where the button looks unpressed.
- The button stays the same size and in the same place; only its label changes.
- Nothing on the card suggests recording has begun.
- Pressing the button again does nothing (only one start can run).

### 2 · Mic opening (the last ½ s)

Looks **exactly like 1.** The user doesn't need to know whether the engine or the mic is the cause.

### 3 · Recording is live

```
┌──────────────────────────────────────────────┐
│ OPEN MIC                          ● 0:00      │
│                                               │
│                  Speak now                    │
│      ▁▃▅▂▆▃▁▄▂▅  (live waveform)              │
│                                               │
│                 ███ Stop ███                  │
└──────────────────────────────────────────────┘
```
- This appears **only when the microphone actually delivers sound**, not when the button is pressed. So "Speak now" is always true.
- The timer starts at 0:00 at the same moment.
- `Speak now` is the app's existing wording; it isn't changing.

### 4 · Still waiting after 10 seconds

```
┌──────────────────────────────────────────────┐
│ OPEN MIC                                      │
│                                               │
│              ◌  Getting your mic ready…       │
│          This is taking longer than usual.    │
│                     Try again                 │
│                                               │
│            [ Starting… ]  ← greyed, disabled  │
└──────────────────────────────────────────────┘
```
- The 10 seconds count **from the click**.
- `Try again` (an underlined text button) restarts the start-up once. It never runs two at the same time. Pressing it goes back to screen 1, and the 10 seconds start again.

### 5 · Start-up failed

The card shows the app's **existing** start-failure message (unchanged), and the button returns to an enabled **`Practice again?`** so the user can try again.

## Wording (complete list)

| Where | Text | New or existing |
|---|---|---|
| Button while starting | `Starting…` | Existing |
| Card while starting | `Getting your mic ready…` | **New** |
| Card when live | `Speak now` | Existing |
| After 10 s | `This is taking longer than usual.` | **New** |
| After 10 s, action | `Try again` | **New** (on this screen) |

## Also applies to

The first take's **`Start recording`** button uses the same screens 1–5. Only the label it returns to on failure differs.

## Accessibility

- Screen readers announce `Getting your mic ready…` and then `Speak now`, as the status changes.
- The button keeps keyboard focus while it shows `Starting…`.

## How we'll know it works

- Straight after the press, the button reads `Starting…` and the card reads `Getting your mic ready…`, with no timer or waveform.
- `Speak now` and the timer never appear before the mic delivers sound.
- Pressing the button five times quickly starts recording once.
- After 10 seconds the notice and `Try again` appear; `Try again` never starts a second recording.
- On the test device, press → recording is under 1 second once part A ships.

## Decision needed from PM

1. **Approve screens 1–5 and the two new strings** (`Getting your mic ready…`, `This is taking longer than usual.`).
2. **Confirm A and B ship together** in one issue (as two small changes), or say which goes first.
3. **Name where this goes in the spec set.** For now it's written up as change C10 in the RWT Rev 2 changes list.
