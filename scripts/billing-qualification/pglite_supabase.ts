// #1294 — ephemeral, migrated PGlite backing the REAL stripe-webhook handler for the weekly billing
// qualification. The handler's ENTIRE Supabase surface is a single RPC (apply_stripe_subscription_snapshot),
// so this adapter is intentionally tiny. No production Supabase, no mocks — a real Postgres (PGlite) with the
// production migrations applied verbatim, discarded when the run ends.
import { PGlite } from "npm:@electric-sql/pglite";

const REPO = new URL("../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, REPO));

// The exact ordered SQL that establishes the webhook lifecycle + entitlement authority (same set the
// executed webhook-lifecycle integration proof applies).
const MIGRATION_SQL: readonly string[] = [
  "tests/db/webhook-lifecycle-bootstrap.sql",
  "backend/supabase/migrations/20260812002000_webhook_lifecycle_completeness_1282.sql",
  "backend/supabase/migrations/20260812039500_webhook_duplicate_snapshot_convergence_1282.sql",
  "backend/supabase/migrations/20260812041500_flawless_launch_runtime_convergence_1290.sql",
].map(read);

export interface SnapshotResult {
  success?: boolean;
  skipped?: boolean;
  entitlement?: string;
  error?: string;
  [k: string]: unknown;
}

/** A minimal supabase-shaped client over PGlite. The handler only ever calls `.rpc(...)`. */
export function pgliteSupabase(db: PGlite) {
  return {
    rpc: async (fn: string, a: Record<string, unknown>): Promise<{ data: SnapshotResult | null; error: unknown }> => {
      if (fn !== "apply_stripe_subscription_snapshot") {
        throw new Error(`billing qualification adapter refused an unexpected RPC: ${fn}`);
      }
      try {
        const r = await db.query<{ result: SnapshotResult }>(
          `SELECT public.apply_stripe_subscription_snapshot(
             p_event_id=>$1, p_subscription_id=>$2, p_customer_id=>$3, p_status=>$4, p_has_approved_price=>$5,
             p_cancel_at_period_end=>$6, p_current_period_end=>$7, p_user_id=>$8, p_event_created=>$9) AS result`,
          [a.p_event_id, a.p_subscription_id, a.p_customer_id, a.p_status, a.p_has_approved_price,
            a.p_cancel_at_period_end, a.p_current_period_end, a.p_user_id, a.p_event_created],
        );
        return { data: r.rows[0].result, error: null };
      } catch (err) {
        // A raised DB exception is a retryable failure for the handler (mirrors real Postgres RPC errors).
        return { data: null, error: err };
      }
    },
  };
}

/** Spin up a fresh migrated PGlite, seed a single Free profile, and return it plus its user id + adapter. */
export async function migratedDb(userId: string): Promise<{ db: PGlite; supabase: ReturnType<typeof pgliteSupabase>; userId: string }> {
  const db = new PGlite();
  for (const sql of MIGRATION_SQL) await db.exec(sql);
  await db.exec(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${userId}', 'free')`);
  return { db, supabase: pgliteSupabase(db), userId };
}

/** Server-authoritative effective tier for the seeded user (the entitlement the customer would receive). */
export async function effectiveTier(db: PGlite, userId: string): Promise<string> {
  const r = await db.query<{ t: string }>(
    `SELECT public.effective_subscription_tier(subscription_status, trial_expires_at, stripe_subscription_id, subscription_id) AS t
       FROM public.user_profiles WHERE id = '${userId}'`,
  );
  return r.rows[0].t;
}
