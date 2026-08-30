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
  // Supabase PLATFORM table (auth.users). No migration of ours creates it, so PGlite must be given it
  // before the real trial migrations — which trigger off it — can apply.
  "tests/db/trial-lifecycle-bootstrap.sql",
  // Creates trial_entitlements, the resolver, and the on_auth_user_created_trial_profile TRIGGER.
  "backend/supabase/migrations/20260521100000_auto_trial_entitlements.sql",
  "backend/supabase/migrations/20260812002000_webhook_lifecycle_completeness_1282.sql",
  "backend/supabase/migrations/20260812039500_webhook_duplicate_snapshot_convergence_1282.sql",
  // #1302: the DB-BACKED TRIAL. Without these the ephemeral DB had no trial at all, so the first three
  // steps of the commercial lifecycle — a 30-day trial granted with ZERO Stripe objects — could not be
  // proven against real SQL. `ensure_trial_profile_for_new_user()` is the production stamping path.
  "backend/supabase/migrations/20260812040000_thirty_day_trial_lifecycle_1282.sql",
  "backend/supabase/migrations/20260812041000_trial_expiry_fail_closed_1282.sql",
  "backend/supabase/migrations/20260812041500_flawless_launch_runtime_convergence_1290.sql",
  "backend/supabase/migrations/20260812041600_trial_commercial_grant_on_conflict_1294.sql",
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

/**
 * #1302 — a FRESH account through the real profile path.
 *
 * Deliberately calls `ensure_trial_profile_for_new_user()` rather than inserting a row with hand-written
 * trial columns: the point is to prove what the PRODUCTION path grants, not what a fixture can assert
 * about itself.
 */
export async function freshTrialProfile(db: PGlite, userId: string): Promise<{
  trialStartedAt: string | null; trialEndsAt: string | null;
  stripeCustomerId: string | null; stripeSubscriptionId: string | null; subscriptionStatus: string;
}> {
  // THE PRODUCTION PATH IS AN AUTH INSERT, NOT A FUNCTION CALL.
  // `ensure_trial_profile_for_new_user()` is a TRIGGER function on auth.users reading NEW.id/NEW.email;
  // invoking it directly would neither compile nor exercise what a real signup does. Inserting the user
  // and letting the trigger stamp the profile is the actual product path.
  await db.query(`DELETE FROM public.user_profiles WHERE id = $1`, [userId]);
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [userId, `qual-${userId}@example.invalid`]);
  const r = await db.query<{
    trial_started_at: string | null; trial_expires_at: string | null;
    stripe_customer_id: string | null; stripe_subscription_id: string | null; subscription_status: string;
  }>(
    `SELECT trial_started_at, trial_expires_at, stripe_customer_id, stripe_subscription_id, subscription_status
       FROM public.user_profiles WHERE id = $1`, [userId],
  );
  const row = r.rows[0];
  if (!row) throw new Error("#1302: the production profile path created no profile row");
  return {
    trialStartedAt: row.trial_started_at, trialEndsAt: row.trial_expires_at,
    stripeCustomerId: row.stripe_customer_id, stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status,
  };
}

/**
 * Expire the trial window IN THE DATABASE.
 *
 * A Stripe Test Clock advances Stripe's clock, not Postgres's `now()`. Trial expiry is evaluated by SQL
 * against the stored window, so the honest way to reach the expired state is to move the window into the
 * past and let the SAME resolver decide. Nothing about the entitlement logic is bypassed.
 */
export async function expireTrialWindow(db: PGlite, userId: string): Promise<void> {
  await db.query(
    `UPDATE public.user_profiles
        SET trial_started_at = now() - interval '31 days', trial_expires_at = now() - interval '1 day'
      WHERE id = $1`, [userId],
  );
}
