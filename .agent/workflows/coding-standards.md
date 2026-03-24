---
description: Coding Standards & Commenting Rules
---
# SpeakSharp Coding Standards

## 🛡️ Project Manifesto: Core Principles

- **🧠 First Principles Mandatory**: Solve every task from first principles. Operate on what we **know** is true, not what we **think** is true.
- **🔪 Targeted Documentation**: Update only specific sections affected by code changes. No unrelated restructures.
- **Test the Contract, Not the Implementation**: Validate requirements and design intent (`[data-state]`, `[data-action]`), not brittle CSS/text.
- **System Integrity over Developer Velocity**: Prioritize explicit contracts and robust error handling over quick check-ins.
- **Privacy-First**: Core differentiator. All audio stays on-device in "Private" mode.
- **Log, Don't Suppress**: Never swallow exceptions. Every `catch` block MUST log context via unified `logger`.
- **Zero-Debt Mandate**: `eslint-disable` and `any` types are strictly forbidden. Fix root causes.

## 🏛️ Governance Rules

1. **Isolation (UI → Service)**: UI components must NEVER call services directly. All commands flow through `SpeechRuntimeController`.
2. **Lazy Initialization**: Resource-heavy modules (WASM engines) must initialize lazily upon first user interaction.
3. **Deterministic Mocking**: `TestRegistry` must be injected before app code executes (via Playwright `addInitScript`).
4. **Command Serialization**: `SpeechRuntimeController` must serialize lifecycle commands using a mutex.
5. **Universal Namespace**: All test-related metadata resides under `window.__APP_TEST_ENV__`.

## 🛑 Error Handling Patterns

| Pattern | When to Use |
| :--- | :--- |
| **Re-throw** | Critical failures (Auth, API crashes). |
| **Log + Fallback** | Recoverable errors (Network timeout → retry). |
| **Log + Suppression** | Non-critical (Analytics, prefetch). |

**Rule**: Empty catches (`catch {}`) are forbidden. Every catch must include a descriptive log prefix.

## 💎 Code Quality Standards

- **Comment Hygiene**: Do not include "Expert #", "Fix #", "Step #", or cryptic numbering like "(T7)" or "(P3)" in source code comments. Use descriptive, functional comments instead.
- **Print/Log Negatives, Assert Positives**: Only log errors/warnings. Use assertions for success.
- **ASCII Diagrams Only**: No Mermaid. Use ASCII for maximum compatibility.
- **Event-Based Waits**: Prefer `waitForSelector` or custom events over arbitrary `setTimeout`.

## 🏗️ SpeakSharp Hardening Patterns (Registry)

### Hardening Patterns (2026-02-12)
Remediation strategy focusing on "defense in depth" across frontend, edge functions, and database layers.

- **1. Lately Captured State Pattern**: Use `useRef` for callbacks in async services to prevent stale closures.
- **2. Double-Dispose Guard**: Explicit `isDisposed` flags to prevent overlapping lifecycle cycles.
- **3. Atomic Usage Updates**: Use atomic SQL `UPDATE` for metered sessions/billing.
- **4. Triple-Identity Tracing**: Tag logs with `serviceId`, `runId`, and `engineId` for 1:1 correlation.
- **5. Microtask Store Decoupling**: Isolate Zustand updates from React transitions using `queueMicrotask`.
- **6. ProfileGuard & useProfile Hook**: Block rendering until profile is fetched; guarantees non-null access.
- **7. Post-Lock Instance Validation**: Re-verify `this.instance` after acquiring termination locks.
- **8. Dynamic Policy Synchronization**: Explicitly re-synchronize service with latest user data before start.
- **9. Error Isolation Boundaries**: Use `<LocalErrorBoundary>` per-widget to isolate failures.
- **10. Behavioral Test Contracts**: Use `[data-state]` and `[data-action]` attributes for stable E2E tests.
- **11-13. Mock Poisoning & Store Truth**: Use dynamic imports in `beforeEach`; centralized store authority.

### CI & Reliability Patterns (2026-02-15/17)
- **Pattern 14-16: Advanced Mocking**: Use `vi.hoisted()` for polyfills; shared isolated store factories.
- **Pattern 17: Nuclear Clean**: Use `scripts/nuclear-clean.sh` to purge `dist` and `.vite` caches.
- **Pattern 18: Shadowed State Prevention**: State must only be pulled from global store, never derived.
- **Pattern 19: Isomorphic Golden Transcripts**: Standardized WER thresholds in `tests/fixtures/stt-isomorphic/`.
- **Pattern 20: Atomic State Lock (CLEANING_UP)**: Prevents re-init until background cleanup completes.
- **Pattern 21: Cloud Redirect Hardening**: Strictly enforce `SITE_URL` for external checkout redirects.
- **Pattern 22-24: NLP Performance**: O(1) Incremental Observer; LRU NLP Cache (10 items); Debounced interim NLP (150ms).
- **Pattern 25: Atomic Row-locking**: Use `FOR UPDATE` in Supabase RPCs for billing consistency.
- **Pattern 26-27: LifeCycle Orchestration**: Serial `commandChain` for lifecycle; UI-First state reversion.
- **Pattern 28: Engine-Aware Enforcement**: Distinguish Cloud vs Native for billing logic.
- **Pattern 29: CI Diagnostic Logging**: Use `FORCE_COLOR=1 ... | tee log.txt` for color-safe CI output.
- **Pattern 30: Modular Benchmarking**: Tiered hardware spec files (`benchmark-cpu`, etc.).
- **Pattern 31: Root-Env Resolution**: Set `envDir: '../../'` in Vite config for uniform secret loading.
- **Pattern 32-35: Atomic Webhooks & PDF**: Immutable Callback Proxy; Logger Mock Standardization; Atomic Webhook RPC; Concurrent PDF Parsing.

## ⚡ Non-negotiable rules

- **PNPM Mandate**: This is a pure `pnpm` project. `package-lock.json` is banned.
- **Full Health Mandate**: Every session MUST end with a 100% clean pass of `pnpm typecheck` and `pnpm lint`.
- **No code reversals**: Never undo user work without consent.
- **Code MUST be tested locally**: Verify via `pnpm ci:full:local` before check-in.
- **No `eslint-disable`**: Zero Tolerance. Fix root causes.
- **Zero-Any Mandate**: The use of the `any` type is strictly forbidden.
- **ASCII Diagrams Only**: Do not use Mermaid. Use ASCII.

## ⚡ Diagnostic Protocol (Mandatory)

Before escalating, do the following in order:
1. **Read the error literally** — copy/paste exact command + error.
2. **Reproduce minimal case** — run the single failing test and capture `run.log`.
3. **Trace to code** — cite `filename:line-range` and provide a 3-8 line snippet.
4. **Form 2 hypotheses (A and B)** — state what you expect to observe in logs/trace.
5. **Run quick checks** — console logs, DOM dump, or grep network entries.
6. **Propose fixes (≥2)** — include code diffs and risk levels.

## 🔐 Absolute Non-Negotiables

*   ❌ Never run `./scripts/vm-recovery.sh` without asking first.
*   ❌ Never exceed the 7-minute runtime per command.
*   ❌ Never undo or destroy user work without consent.
*   ❌ Never use `git checkout --theirs/--ours`.
*   📄 Documentation first.
*   🧠 Think like a senior engineer — prioritize long-term stability.
