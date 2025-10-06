# Documentation Outline for Test Audit

This document outlines the structure for the `test-audit-status.md` report, which serves as the Single Source of Truth for test execution details.

## 1. Test Audit Report

A high-level summary of the audit run.

- Generated date and time.
- Status of preliminary checks like Lint & TypeScript.

## 2. E2E Test Shards

Documents how E2E tests are grouped into shards to manage runtimes and respect platform limits.

- Lists the test files included in each dynamically generated shard.

## 3. Shard Results

Provides detailed results for each test within each shard.

- For each test file, it must include:
    - **Status**: PASS or FAIL.
    - **Runtime**: The execution time in `mm:ss` format.

## 4. E2E Test Summary

A consolidated summary table of all E2E tests executed.

- The table should have the following columns:
    - `Test File`
    - `Status`
    - `Runtime`

## 5. Local vs CI/CD Alignment

Confirms the parity between the local development environment and the GitHub Actions CI/CD pipeline.

- Verification of Node.js, pnpm, and Playwright versions.
- Confirmation that the sharding logic is mirrored in the CI workflow.
- A note that all E2E test runtimes are documented for reference.