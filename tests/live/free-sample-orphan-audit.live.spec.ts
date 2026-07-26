import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * #964 — disposable Free-fixture orphan audit.
 *
 * The #964 entitlement proof (in stt-switching-contract.live.spec.ts) creates a uniquely marked
 * disposable Free account `stt-switching-free-sample-<RUN_ID>@example.com` and attempts cleanup with
 * `Promise.allSettled(...)` — which tries deletion but does NOT prove it succeeded. This audit closes
 * that gap: it queries the auth store through the Supabase service-role API and PROVES zero accounts
 * carrying the disposable-fixture marker remain. Content-free (marker + count only; sanitized emails).
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MARKER = 'stt-switching-free-sample-';

test.describe('#964 disposable Free-fixture orphan audit @live', () => {
  test.beforeAll(() => {
    test.skip(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY, 'Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
  });

  test(`zero ${MARKER}* disposable fixtures remain after cleanup`, async () => {
    const admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const orphans: string[] = [];
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      expect(error, 'service-role listUsers must succeed').toBeFalsy();
      const users = data?.users ?? [];
      for (const u of users) {
        if (typeof u.email === 'string' && u.email.startsWith(MARKER)) orphans.push(u.email);
      }
      if (users.length < 200) break; // last page reached
    }

    // Sanitize: keep the marker prefix, drop the address body/domain (synthetic, but content-free by policy).
    const sanitized = orphans.map(() => `${MARKER}…`);
    console.log(`FREE_SAMPLE_ORPHAN_AUDIT ${JSON.stringify({ marker: MARKER, orphanCount: orphans.length, sanitized })}`);

    expect(orphans, `no ${MARKER}* disposable Free fixtures may remain after the #964 diagnostic run`).toHaveLength(0);
  });
});
