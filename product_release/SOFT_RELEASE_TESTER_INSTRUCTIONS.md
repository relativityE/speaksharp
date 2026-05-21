# Soft Release Tester Instructions

**Last updated:** 2026-05-21
**Release type:** Controlled soft release, not broad public launch
**Tester count:** Start with 5 testers, then expand only after the first round is clean.

## Share With Each Tester

```text
I'm running a small soft release test of SpeakSharp today.

Link: https://speaksharp-public.vercel.app

Setup:
1. Create a new account with your own email and password.

Your new account includes Pro access for 1 hour automatically. The timer starts when the account is created.

What to test:
1. Start with Private STT for your first session. This is the primary validated Pro mode for this round.
2. Record a 1-2 minute speaking session. Please include a few deliberate filler words such as "um", "uh", and "like".
3. Stop and review your analytics.
4. Confirm the session appears in History and opens to the saved analytics/session detail.
5. Optionally try Cloud STT for a second short session.

Known limitations:
- Native browser STT is browser-dependent and is validated mainly for Chrome.
- Cloud STT is optional for this round. Please report missing speech, delayed transcript, or provider issues.
- Some backend/internal labels may still say "basic" while the user-facing baseline plan says Basic.

Please report:
1. Did signup and trial access work?
2. Did transcript text appear while speaking?
3. Were filler words detected accurately enough?
4. Did analytics match what you experienced?
5. Did the session save to History and open afterward?
6. Was anything confusing, slow, blocked, or surprising?
```

## Operator Checklist

- Do not generate or send tester codes. Access is automatic for new accounts.
- Confirm trial fields appear on new profiles: `trial_started_at` and `trial_expires_at`.
- Confirm Vercel production does not set `VITE_TEST_MODE` or other E2E/test flags.
- Keep tester instructions Private-first. Cloud is useful feedback, but it is not the primary path for the first tester session.
- Ask every tester to check save/history/detail after stopping. A transcript without persisted history is not a successful session.
