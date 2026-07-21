# v4 UX Release Dispositions — #75 (customer-safe copy) & BL-3 (recording meter)

Reviewer / release-owner dispositions for the two v4 UX items. Both **close without code** for this
release. "Closed" here means **reviewer disposition** (#75) and **deferred non-blocking** (BL-3) —
not every feature requires implementation to be release-closed.

---

## #75 — v4 customer-safe UX copy → **CLOSED BY REVIEWER DISPOSITION (no code)**

**Decision:** v4 stays **invisible** to users. The customer-facing concept remains **"Private
transcription,"** not `v4` / `base_q4` / `distil` / "enhanced." **No new copy is required** because
the existing copy stays truthful with v4 underneath:
- on-device processing
- audio not uploaded
- model-download size is **already dynamic** (resolved per selected model)
- setup may be required again if site storage is cleared

**Do NOT add** v4 labels, enhanced/beta badges, internal model names, or WebGPU/GPU copy for this
release.

**Rationale:** a code scan confirms **no** `v4` / `base_q4` / `distil` string reaches the UI today;
v4 does not change the user-facing **privacy posture** (still on-device, still Private). Surfacing it
would only create support/expectation problems ("am I on v2? did I get downgraded? what is base_q4?")
— internal implementation leaking into the product, not a UX improvement.

**Required Test validation (mark #75 closed once these pass):**
1. Existing Private setup/download copy still renders correctly for the **v4** model.
2. Model-size copy remains **dynamic + accurate** for the selected model.
3. v4→v2 fallback shows **no extra copy** (both are Private/on-device — no privacy change).
4. Private→Browser/Cloud fallback **still shows** the existing privacy-relevant fallback/trust
   messaging (this crosses a privacy boundary and must remain visible).

---

## BL-3 — real RMS recording meter → **DEFERRED (post-release, non-blocking)**

**Decision:** not required for this release; **do not change the indicator** now.

**Rationale (key):** a **genuine** mic-level meter **already exists** — `LiveTranscriptPanel`'s
`WaveformMeter` is driven by real `micLevel` from `useVocalAnalysis` (true RMS `√(mean(x²))×8`,
EMA-smoothed). Users already get real "is it hearing me?" feedback on the **primary** transcript
surface. The `LiveRecordingCard` bars are a **secondary decorative activity cue**: a uniform
**opacity** pulse (`animate-pulse`) over **static** deterministic heights — it does **not** animate
bar heights to fake amplitude. So it reads as "recording active," not "live mic level," and the real
feedback lives elsewhere → **no trust gap**.

**Not-misleading determination:** secondary placement + uniform opacity pulse (not height animation)
+ a real meter present on the primary surface ⇒ acceptable for release as a decorative indicator.

**Post-release enhancement (BL-3):** wire `LiveRecordingCard`'s bars to the existing `micLevel` feed
via `requestAnimationFrame` + a ref (small — the feed already exists; not new audio plumbing). If the
reviewer instead prefers zero ambiguity now, the minimal alternative is to flatten the bars to
equal-height/pulse (a generic recording cue) — a tiny, safe change — but this is **not** required.

---

_Disposition recorded 2026-06-12. #75 closes on Test validation of the four surfaces above; BL-3 is
tracked as a post-release enhancement._
