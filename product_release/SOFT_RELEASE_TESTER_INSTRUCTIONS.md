# Soft Release Tester Instructions

**Last updated:** 2026-05-22
**Release type:** Controlled soft release, not broad public launch
**Tester count:** Start with 5 testers, then expand only after the first round is clean.

## Share With Each Tester

```text
I'm running a small soft release test of SpeakSharp today.

Link: https://speaksharp-public.vercel.app

Setup:
1. Create a new account with your own email and password.

Your new account includes 1 hour of trial access automatically. The timer starts when the account is created. Cloud STT is reserved for paid Pro accounts, so this test focuses on Private STT.

What to test:
1. Start with Private STT for your first session. This may do a one-time private model setup in your browser.
2. Record a 1-2 minute speaking session. Please include a few deliberate filler words such as "um", "uh", and "like".
3. Stop and review your analytics.
4. Confirm the session appears in History and opens to the saved analytics/session detail.
5. Try a second short Private or Native session if you have time.

Known limitations:
- Native browser STT is browser-dependent and is validated mainly for Chrome.
- Cloud STT is paid-only during this round and may appear disabled during trial access.
- Some backend/internal labels may still say "basic" while the user-facing baseline plan says Basic.

Please report:
1. Did signup and trial access work?
2. Did the Private setup and Start Recording flow work without getting stuck?
3. Did transcript text appear while speaking?
4. Were filler words detected accurately enough?
5. Did analytics match what you experienced?
6. Did the session save to History and open afterward?
7. Was anything confusing, slow, blocked, or surprising?
```

## Operator Checklist

- Do not generate or send tester codes. Access is automatic for new accounts.
- Confirm trial fields appear on new profiles: `trial_started_at` and `trial_expires_at`.
- Confirm Vercel production does not set `VITE_TEST_MODE` or other E2E/test flags.
- Keep tester instructions Private-first. Cloud can be tested separately through paid/admin/dev accounts, but it is not part of automatic trial testing.
- Ask every tester to check save/history/detail after stopping. A transcript without persisted history is not a successful session.
- Run `.github/workflows/live-release-matrix.yml` with `suite=first-time-tester-private-trial` before sending instructions. This clears browser model storage, creates a fresh trial account, prepares Private STT, records, and stops like a first-time tester.
