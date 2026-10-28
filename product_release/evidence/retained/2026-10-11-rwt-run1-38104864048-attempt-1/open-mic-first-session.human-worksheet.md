# RWT human-check worksheet — open-mic-first-session

Suite: `open-mic-first-session`
Deployed SHA: `cc8e30b4710bf271d765d4bc549a0e534dedf53c`
Journey ids: `6b29d535-c093-4969-a149-2018e6dafd74`, `14bcb70c-b6f3-4ca8-8020-59a810217ac4`, `ec94dd84-5bf7-4dc0-8f09-abbb3daed07e`, `ccf00555-1644-44c6-ac66-4d22755ddf77`, `14d748b4-a941-46d0-ab33-3cf7235870ee`
Receipt: `open-mic-first-session.receipt.json`

An automated PASS is not a human check. Fill in Result (PASS or FAIL) and Observer for every row, then run
`pnpm rwt:finalize -- --receipt open-mic-first-session.receipt.json --worksheet open-mic-first-session.human-worksheet.md`. Until that step
passes, this run is INCOMPLETE.

| Observation id | Runbook row | Question | Observation needed to decide (pass criterion) | Result (PASS/FAIL) | Observer · date |
|---|---|---|---|---|---|
| `open_mic_coaching_relevant` | Product 1 row 5 | coaching is about this speech | each phrase relates to what was said in this take — not generic advice |  |  |
| `open_mic_uh_detected` | Product 1 row 4 | spoken "uh" detected and saved (human speech) | every spoken "uh" (3) is marked live and saved |  |  |
