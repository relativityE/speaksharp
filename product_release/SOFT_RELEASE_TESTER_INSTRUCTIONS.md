# Soft Release Tester Instructions

**Last updated:** 2026-05-26
**Release type:** Controlled soft release, not broad public launch
**Tester count:** Start with 5 testers, then expand only after the first round is clean.

## Share With Each Tester

```text
I'm running a small soft release test of SpeakSharp.

Link: https://speaksharp-public.vercel.app

Setup:
1. Create a new account with your own email and password.

Your new account includes 1 hour of trial access automatically. The timer starts when the account is created. Cloud STT is a Pro feature (unavailable for trial). Trial access includes Private STT, so this test focuses on Private STT.

What to test:
1. Start with Private STT for your first session. Click "Download Private Model" if prompted. This is a one-time private model setup in your browser. It runs on your device, so first words can take about 5 seconds to appear.
2. Record a 1-2 minute speaking session. Please include a few deliberate filler words such as "um", "uh", and "like".
3. Stop and review your analytics.
4. Confirm the session appears in History and opens to the saved analytics/session detail.
5. Export a PDF from the saved session detail and confirm it includes the transcript and analytics summary.
6. Open Custom Words, add a word you plan to say, record a short sentence using that word, and confirm it is counted in the analytics.
7. Try a second short Browser transcription session in Chrome if you have time.

Known limitations:
- Browser transcription uses your browser's built-in speech recognition. Chrome is recommended. Availability and accuracy vary by browser.
- Cloud STT is a Pro feature.
- User-facing baseline signup is Free. Paid Basic is reserved for a future product decision and should not appear in the tester path.

Please report:
1. Did signup and trial access work?
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

- Do not generate or send tester codes. Access is automatic for new accounts.
- Confirm trial fields appear on new profiles: `trial_started_at` and `trial_expires_at`.
- Confirm Vercel production does not set `VITE_TEST_MODE` or other E2E/test flags.
- Keep tester instructions Private-first. Cloud can be tested separately through paid/admin/dev accounts, but it is not part of automatic trial testing.
- Paid/admin/dev Cloud tester scope, if included, must explicitly prove Cloud recording, transcript, save/history/detail, analytics, and PDF export. Do not ask automatic-trial testers to validate Cloud.
- Free-path tester scope must explicitly prove Browser transcription only, with Private and Cloud unavailable. Use a known Free account whose trial has expired or a freshly provisioned live Free account with expired trial fields.
- Ask every tester to check save/history/detail after stopping. A transcript without persisted history is not a successful session.
- Ask every tester who adds a custom word to say that word during recording and verify the analytics count after save.
- Ask every tester who exports a PDF to confirm the file contains the session metadata, transcript, transcription mode, and analytics summary.
- Do not claim Edge support unless an Edge-specific proof has passed start, transcript, save, history/detail, and analytics. Until then, use "Chrome recommended" wording.
- Run `.github/workflows/live-release-matrix.yml` with `suite=first-time-tester-private-trial` before sending instructions. This clears browser model storage, creates a fresh trial account, prepares Private STT, records, and stops like a first-time tester.
