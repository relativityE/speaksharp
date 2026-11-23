# Signed mobile builds

**Deliverable:** One signed iOS TestFlight build and one Play-signed Android App Bundle on a non-production test track, traceable to source SHA and CI.
**Expected outcome:** Both install and pass the same review rehearsal on physical devices. This PR only records the build work; no binary has been produced.

Audit [#1945](https://github.com/relativityE/speaksharp/pull/1945) is merged, test-only, and not a home for native packaging. The [current source](https://github.com/relativityE/speaksharp/tree/911ec968) contains no verified iOS/Android build project.

1. Confirm Apple and Play account ownership, app identifiers and account type. Use protected signing on CI; no keys, profiles, passwords or reviewer credentials in git or logs. Separate test signing and upload environments from production. No account enrollment or submission in this PR.
2. Prototype the smallest mobile shell that preserves on-device Private transcription and an app-quality recording/permission/recovery experience. Share existing web UI where justified, but decide native capture/runtime bridges from a physical device spike rather than assuming a wrapper is acceptable. No model swap.
3. Add deterministic iOS and Android build jobs. iOS: current Xcode 26/iOS 26 SDK upload requirement, signed archive, app privacy manifest and mic purpose. Android: API 36 target, release AAB, Play App Signing, 16 KB checks for native dependencies and mic runtime permission. Keep SDK target distinct from minimum supported OS; don't promise untested phones.
4. Qualify on physical iPhone and Android: allow/deny/regrant mic, cold Private download, Abort/Retry, Stop during scrolling, save/reopen/repeat, full/partial Focus, background/lock/interruption recovery, and accessibility. Record device/OS, build ID, setup/Stop/save observations, and no unconsented uploads.
5. Put the same exact artifacts on private store test tracks once separately authorized, supply app icon/screens/screenshots, ratings, support and privacy/deletion links and a demo account with paid access. Run the end-to-end review rehearsal, including trial expiry, sandbox purchase and authorized disposable deletion, before any public submission.

[Apple SDK requirements](https://developer.apple.com/news/upcoming-requirements/) · [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/) · [Play target](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) · [Play App Signing](https://developer.android.com/studio/publish/app-signing) · [16 KB](https://developer.android.com/guide/practices/page-sizes)
