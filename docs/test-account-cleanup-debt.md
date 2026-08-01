# Test-account cleanup debt (deferred — NOT a #1045 gate)

Two **disposable** test accounts were created during the #1045 deployed-journey cycle (2026-07-31) via
`scripts/make-test-user.sh` → `setup-test-users.yml action=create` (real service-role in GitHub Secrets).
They are orphaned but harmless (`@test.com`, synthetic `sub_test_*`, billing freeze), so deletion is
**deferred until after 19/19**, per PO direction: do not free-hand-delete, do not run ad-hoc SQL, do not
build a cleanup workflow mid-program.

## Disposable accounts to remove (allowlist for the future cleanup workflow)

| Email | Tier | UUID | Created |
|---|---|---|---|
| `test-free-20260731214210@test.com` | free | _resolve at cleanup time via service-role_ | 2026-07-31 |
| `test-pro-20260731222609@test.com` | pro | _resolve at cleanup time via service-role_ | 2026-07-31 |

> UUIDs are intentionally not recorded here (local env reaches only a mock Supabase; the real service-role
> lives in GitHub Secrets). Resolve them at cleanup time via `admin.auth.admin.listUsers` filtered by the
> exact emails above, and allowlist those two UUIDs explicitly.

## Do NOT touch — MAINTAINED reusable accounts (protect in any cleanup tooling)

- Free/Basic: `FREE_TEST_EMAIL` / `BASIC_TEST_EMAIL` (GitHub secret)
- Pro: `PRO_TEST_EMAIL` (GitHub secret)
- Soak matrix: `soak-test<N>@test.com`

Any cleanup tooling MUST refuse to delete a maintained or soak account even if passed by mistake.

## Planned cleanup workflow (post-19/19)

One bounded, **manual-dispatch** workflow with:
- **dry-run** output first (list what would be deleted, delete nothing),
- exact **UUID allowlist** (only the two UUIDs above),
- **maintained-account protection** (hard refuse the secrets' emails + `soak-test*`),
- explicit **`DELETE` confirmation** input,
- FK-safe cascade enumeration (see the bulk-delete FK lesson — `usage_checkpoints.user_id` etc.).

Then remove only the two recorded disposable accounts.
