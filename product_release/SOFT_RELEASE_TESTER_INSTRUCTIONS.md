# Soft Release Tester Instructions

**Last updated:** 2026-05-29
**Release type:** Controlled soft release, not broad public launch
**Tester count:** Start with 5 testers, then expand only after the first round is clean.

## Share With Each Tester

```text
I'm running a small soft release test of SpeakSharp.

Link: https://speaksharp-public.vercel.app

Setup:
1. Create a new account with your own email and password.

Your new account starts free with Browser transcription. You also get one short Private transcription sample so you can compare local transcription before upgrading. Cloud STT is a paid Early Access feature.

What to test:
1. Start with Browser transcription first so you can feel the instant record -> transcript -> save loop.
2. Record a 1-2 minute speaking session. Please include a few deliberate filler words such as "um", "uh", and "like".
3. Stop and review your analytics.
4. Confirm the session appears in History and opens to the saved analytics/session detail.
5. Export a PDF from the saved session detail and confirm it includes the transcript and analytics summary.
6. Open Custom Words, add a word you plan to say, record a short sentence using that word, and confirm it is counted in the analytics.
7. Try the Private sample when you are ready. Click "Set Up" or "Download Private Model" if prompted. This is a one-time private model setup in your browser; it runs on your device, so first words can take about 5 seconds to appear. The Private sample is short and saves automatically when it ends.

Known limitations:
- Browser transcription uses your browser's built-in speech recognition. Chrome is recommended. Availability and accuracy vary by browser.
- Cloud STT is a paid Early Access feature.
- User-facing baseline signup is Free. Paid Basic is reserved for a future product decision and should not appear in the tester path.

Please report:
1. Did signup and Browser transcription work?
2. Did the Private setup and Start Recording flow work without getting stuck?
3. Did transcript text appear while speaking?
4. Were filler words detected accurately enough?
5. Did your custom word appear in the analytics after you added it through the UI?
6. Did analytics match what you experienced?
7. Did the session save to History and open afterward?
8. Did PDF export include the transcript and analytics summary?
9. Was Browser transcription clear that Chrome is recommended and results vary by browser?
10. Was anything confusing, slow, blocked, or surprising?
```

## Operator Checklist

- Share only the production Vercel URL with human testers: `https://speaksharp-public.vercel.app`.
- Never share `127.0.0.1:5173` with human testers. That port is mocked E2E/test mode only.
- If a local rehearsal is required, use `pnpm dev` and `127.0.0.1:5174`; do not use `pnpm dev:test`.
- Do not generate or send tester codes. Free Browser access is automatic for new accounts.
- Confirm sample fields appear on new profiles: `private_sample_limit_seconds`, `private_sample_seconds_used`, and no legacy timestamp grants paid access.
- Confirm Vercel production does not set `VITE_TEST_MODE` or other E2E/test flags.
- Keep tester instructions Browser-first with an intentional Private sample. Cloud can be tested separately through paid Pro/admin/dev accounts, but it is not part of free-account sample testing.
- Pro/admin/dev Cloud tester scope, if included, must explicitly prove Cloud recording, transcript, save/history/detail, analytics, and PDF export. Do not ask automatic-trial testers to validate Cloud.
- Free-path tester scope must explicitly prove Browser transcription, the one Private sample, and Cloud unavailable without paid entitlement. Use a known Free account with sample unused/used states when testing both sides.
- Ask every tester to check save/history/detail after stopping. A transcript without persisted history is not a successful session.
- Ask every tester who adds a custom word to say that word during recording and verify the analytics count after save.
- Ask every tester who exports a PDF to confirm the file contains the session metadata, transcript, transcription mode, and analytics summary.
- Do not claim Edge support unless an Edge-specific proof has passed start, transcript, save, history/detail, and analytics. Until then, use "Chrome recommended" wording.
- Run `.github/workflows/live-release-matrix.yml` with the first-time tester/sample suite before sending instructions. This clears browser model storage, creates a fresh account, prepares Private STT, records, stops, and verifies save/history like a first-time tester.
