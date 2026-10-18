import { assert, assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { migratedDb, freshTrialProfile, effectiveTier, expireTrialWindow } from "./pglite_supabase.ts";

const USER = "00000000-0000-0000-0000-00000000b111";
const OTHER = "00000000-0000-0000-0000-00000000b222";
const SESSION = "cs_test_billing_qualification";

Deno.test("qualification adapter executes owned settlement SQL and preserves wrong-owner refusal", async () => {
  const { db, supabase } = await migratedDb(USER);
  try {
    const reserve = await db.query<{ id: string }>("SELECT public.begin_account_checkout($1) AS id", [USER]);
    const operation = reserve.rows[0].id;
    await db.query("SELECT public.record_account_checkout($1,$2,$3)", [USER, operation, SESSION]);
    const snapshot = await supabase.rpc("apply_stripe_subscription_snapshot", {
      p_event_id: "evt_owned", p_subscription_id: "sub_owned", p_customer_id: "cus_owned",
      p_status: "active", p_has_approved_price: true, p_cancel_at_period_end: false,
      p_current_period_end: 4_100_000_000, p_user_id: USER, p_event_created: 1_700_000_000,
    });
    assertEquals(snapshot.error, null);
    assertEquals(snapshot.data?.success, true);
    const args = {
      p_user_id: USER, p_session_id: SESSION, p_customer_id: "cus_owned",
      p_subscription_id: "sub_owned", p_operation_id: operation,
    };
    // Even a different, valid paid profile cannot settle the first user's exact reservation.
    await db.query(`INSERT INTO public.user_profiles(id, stripe_customer_id, stripe_subscription_id)
      VALUES($1,'cus_other','sub_other')`, [OTHER]);
    const wrongOwner = await supabase.rpc("settle_account_checkout", {
      ...args, p_user_id: OTHER, p_customer_id: "cus_other", p_subscription_id: "sub_other",
    });
    assert(wrongOwner.error instanceof Error);
    assertStringIncludes(wrongOwner.error.message, "checkout ownership mismatch");
    assertEquals(wrongOwner.data, null);
    assertEquals((await db.query("SELECT user_id,session_id,phase FROM public.account_checkout_operations")).rows,
      [{ user_id: USER, session_id: SESSION, phase: "open" }]);

    assertEquals(await supabase.rpc("settle_account_checkout", args), { data: null, error: null });
    assertEquals((await db.query("SELECT user_id,session_id,phase FROM public.account_checkout_operations")).rows,
      [{ user_id: USER, session_id: SESSION, phase: "settled" }]);
  } finally {
    await db.close();
  }
});

Deno.test("shared commercial fixture retains actual signup trial stamping and database expiry", async () => {
  const { db } = await migratedDb(USER);
  try {
    const profile = await freshTrialProfile(db, USER);
    assert(profile.trialStartedAt !== null && profile.trialEndsAt !== null);
    assertEquals(profile.stripeCustomerId, null);
    assertEquals(profile.stripeSubscriptionId, null);
    assertEquals(await effectiveTier(db, USER), "pro");
    await expireTrialWindow(db, USER);
    assertEquals(await effectiveTier(db, USER), "free");
  } finally {
    await db.close();
  }
});

Deno.test("qualification adapter preserves real SQL errors and rejects every unexpected RPC", async () => {
  const { db, supabase } = await migratedDb(USER);
  try {
    const refused = await supabase.rpc("settle_account_checkout", {
      p_user_id: USER, p_session_id: SESSION, p_customer_id: "not_attached",
      p_subscription_id: "sub_missing", p_operation_id: null,
    });
    assert(refused.error instanceof Error);
    assertStringIncludes(refused.error.message, "checkout not attached");
    assertEquals(refused.data, null);
    await assertRejects(() => supabase.rpc("unexpected_rpc", {}), Error, "refused an unexpected RPC");
    assertEquals((await db.query("SELECT * FROM public.account_checkout_operations")).rows, []);
  } finally {
    await db.close();
  }
});
