# Mobile store billing

**Deliverable:** A store-billing and entitlement contract for signed iOS and Android builds.
**Expected outcome:** Every new account has the same complete experience for 30 days; after the trial, payment continues the same product. No feature-tier split and no automatic charge at signup.

## Customer contract
- Preserve one immutable server-owned 30-day full-access trial. Internal Pro identifiers remain compatibility aliases for now, not a separate bundle of features. Before release, clean up app, Settings, price wall, screenshots, receipt help, and store listing copy to say “30 days free, then pay to continue.”
- Use one entitlement decision surface: active app trial, verified active web subscription, verified Apple purchase, or verified Google purchase. A valid existing web entitlement can grant access where storefront rules allow; don't prompt an already active subscriber to pay again. Never let device time, a client claim, or restarting the app grant an extra trial.
- Default to StoreKit/In-App Purchase for iOS and Google Play Billing on Android for purchases initiated inside the store app. Keep Stripe on the web; don't embed or link its checkout in both apps by default. Scrutinize any regional exception independently and record allowed storefronts. Keep an app-granted trial distinct from an auto-renewing platform offer so users are not unintentionally charged.
- Build server verification and verified notification ingestion with provider and app-account binding, environment separation and idempotency. Give purchase/restore and manage subscription actions appropriate to the original provider. An expired/no entitlement account can still reach settings, privacy, support and account deletion.

## Rehearsal and stop rules
- Test sandbox trial entry/before/at/after expiry, new purchase, declined/pending outcomes, same-account restore and wrong-account refusal, repeated/out-of-order provider events, cancellation through paid-through date, refunds/revocations and account deletion while subscribed. Never equate a successful browser return with paid access.
- Test existing web subscribers signing in on both stores; block duplicate purchases. A named reviewer/test account reaches post-trial features without a real charge. Do not publish pricing products, configure live payment, submit builds or modify Stripe from this draft.
- Related source: [commercial contract](ENTITLEMENTS_AND_BILLING.md); [J9.b #1937](https://github.com/relativityE/speaksharp/pull/1937) is independent Stripe sandbox evidence only. [Apple §3.1](https://developer.apple.com/app-store/review/guidelines/#business) · [Google Play Payments](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)
