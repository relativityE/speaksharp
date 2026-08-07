## Product Owner — Customer Value & Promise

**The "What and Why"**
Guided Rehearsal (G2) is the intentional, goal-oriented evolution of the SpeakSharp Practice Loop. While Freestyle Practice is open-ended ("speak freely and improve clarity"), Guided Rehearsal answers the user's need to prepare for specific stakes: "Did I hit my key points during my delivery?"

**The Minimum Honest MVP**
The MVP is a recording session where the user explicitly declares upfront focus points (an agenda or "brief"). SpeakSharp records their delivery strictly using Private STT (ensuring absolute privacy for sensitive rehearsal content) and evaluates the final transcript against those points. The result is a combined outcome: did they cover their points, and was their delivery clear?

**In/Out of Scope**
*   **In Scope:** User-supplied focus points (text input before recording); strict enforcement of Private STT (on-device); truthful evaluation parity (Clarity scores + Guided coverage); seamless continuity across Practice Home, Analytics, and PDF exports.
*   **Out of Scope:** "Magic" AI generation of focus points (users must supply their own); Cloud STT processing; any promotion of Browser STT as an equivalent to Private for Guided.

**The Truthfulness Bar**
SpeakSharp never over-claims. The attribution record is client-declared and server-recorded; it is an *honest declaration*, not cryptographic proof. If Private STT fails or falls back to Browser STT, Guided Rehearsal must fail gracefully (e.g., "Guided evaluation unavailable due to fallback") rather than silently faking success using a non-private engine. Browser is secondary and cannot masquerade as Private.
