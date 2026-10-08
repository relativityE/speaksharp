# To Dev: RWT punch list, Rev 2 (#1258), 7 Oct 2026

Three files in this folder. **Build from the implementation guide.**

| File | What it is | Read it when |
|---|---|---|
| `RWT_PUNCHLIST_IMPLEMENTATION.md` (Rev 2) | **The build guide.** Five PRs in order, file by file: exact edits, copy, tokens, code, tests, a done checklist, and reference markup for every screen (Appendix A) | Always. This is the one to build from |
| `RWT_PUNCHLIST_DESIGN.md` (Rev 2) | The decisions D1–D11 and why | To understand the intent behind an edit |
| `RWT_PUNCHLIST_CHANGES_REV2.md` | What changed since Rev 1 (C1–C8), before → after | **Only if you already started on Rev 1** |

Rev 2 replaces Rev 1 in full; don't merge them. If the guide and the design file ever disagree, stop and ask. Don't invent copy: every string is in the guide.

**PR order:**
1. Copy + nav: Home · Products · Progress, `Session saved.`, `Practice again?`
2. Failed review band: one message, a `Try again` button
3. Transcript card after Stop + one filler list (highlights = marks = count) + `THIS RUN` (`Pace (wpm) 95`, numbers in one column)
4. Back from Progress returns to the completed session (`/session?review=<id>`)
5. Progress page: personal ink header with first name, latest review, rule card, collapsed Trends, Filler words counts, Recent sessions (ink `Open`, yellow `PDF`)

**Changes since Rev 1:** `Clear delivery` label · units in labels · numbers line up · ink/yellow row buttons · confirmed filler and pause fields · theme-only colours · **first name** (new optional `user_profiles.first_name` column + `set_first_name` RPC; set at sign-up, on `/account`, or inline on Progress).

**Heads-up for PM:** the first-name change adds one migration (a column plus an RPC). Everything else is front-end only.
