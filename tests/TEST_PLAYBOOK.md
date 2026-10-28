# Test command and evidence guide

Owner:Engineering/Quality. Current authority:[QUALITY](../product_release/QUALITY.md), boundaries:[AGENTS](../AGENTS.md), freshness:[RELEASE_PROCESS](../product_release/RELEASE_PROCESS.md). This developer command index is not a second release authority.

Read selected package.json/workflow before execution. Registered local commands include pnpm quality, pnpm test:unit, pnpm test:full, pnpm test:infra, pnpm test:e2e and pnpm ci:local. Focused Vitest uses frontend/vitest.config.mjs and the existing host interlock/locked dependencies. Retain source SHA/tree, command/config, named outcomes/artifact. Focused PASS is not full quality/CI.

Mocked test-build browser paths do not establish hosted credentials/RLS/providers/microphone hardware/customer acceptance. Live/paid/fixture-mutating commands require separate authority and exact release/account/run binding. Do not run pnpm rc:gates as an offline-only convenience: its graph includes live gates.

Customer STT is Private on device. Retired Web-Speech/Cloud adapter or benchmark tests, if intentionally reached through internal seams, are diagnostic rather than customer GO proof. Model evaluation/promotion uses the selected current plan; this index runs no model/download/provider task.

Use [E2E guide](./README.md), [stress/endurance guide](./soak/README.md) and QUALITY for their distinct scopes. Obsolete March command lists remain recoverable in Git history, not executable current instructions.
