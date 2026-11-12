// @vitest-environment node
// Executes the actual stripe_refund_followups migration in PostgreSQL WASM (Sam's 2026-11-12 decision for #1829):
// the operator signal's grants, closed values, one row per operation, and who may close it. The webhook's use of
// the writer is covered by backend/supabase/functions/stripe-webhook/refund.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIGRATION = 'backend/supabase/migrations/20261112130000_stripe_refund_followups.sql';
const RECORD = 'public.record_stripe_refund_followup(text,text,boolean,text)';
const RECONCILE = 'public.reconcile_stripe_refund_followup(text,text,text,text)';
const API_ROLES = ['anon', 'authenticated', 'service_role'];

let db: PGlite;
async function as<T extends Record<string, unknown>>(role: string | null, text: string, args: unknown[] = []) {
  await db.exec('RESET ROLE');
  if (role) await db.exec(`SET ROLE ${role}`);
  try { return (await db.query<T>(text, args)).rows; } finally { await db.exec('RESET ROLE'); }
}
const one = async (role: string | null, text: string, args: unknown[] = []) =>
  Object.values((await as(role, text, args))[0] ?? {})[0];
const record = (key: string, event: string, reason: string, livemode: boolean | null = false) =>
  one('service_role', `SELECT ${RECORD.replace('(text,text,boolean,text)', '($1,$2,$3,$4)')}`, [key, event, livemode, reason]);
const reconcile = (key: string, event: string, reason: string, outcome = 'operator_resolved') =>
  one(null, 'SELECT public.reconcile_stripe_refund_followup($1,$2,$3,$4)', [key, event, reason, outcome]);
const row = async (key = 'charge:ch_1') =>
  (await as(null, 'SELECT * FROM public.stripe_refund_followups WHERE operation_key=$1', [key]))[0] as Record<string, unknown>;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    -- Supabase's default privileges grant the API roles on new objects; mirrored so the migration's REVOKEs are tested.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);
  await db.exec(readFileSync(MIGRATION, 'utf8'));
});

describe('stripe_refund_followups (operator signal for unverified refund follow-ups)', () => {
  it('no API role touches the table; only service_role records; nobody but the owner reconciles', async () => {
    for (const role of API_ROLES) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const granted = await one(null, 'SELECT has_table_privilege($1,$2,$3)', [role, 'public.stripe_refund_followups', privilege]);
        expect({ role, privilege, granted }).toEqual({ role, privilege, granted: false });
      }
      const reconciles = await one(null, 'SELECT has_function_privilege($1,$2,$3)', [role, RECONCILE, 'EXECUTE']);
      const records = await one(null, 'SELECT has_function_privilege($1,$2,$3)', [role, RECORD, 'EXECUTE']);
      expect({ role, reconciles, records }).toEqual({ role, reconciles: false, records: role === 'service_role' });
    }
    expect(await one(null, "SELECT relrowsecurity FROM pg_class WHERE oid='public.stripe_refund_followups'::regclass")).toBe(true);
    const fns = await as(null, `SELECT proname, prosecdef, proconfig FROM pg_proc
      WHERE proname IN ('record_stripe_refund_followup','reconcile_stripe_refund_followup') ORDER BY proname`);
    expect(fns).toEqual([
      { proname: 'reconcile_stripe_refund_followup', prosecdef: true, proconfig: ['search_path=""'] },
      { proname: 'record_stripe_refund_followup', prosecdef: true, proconfig: ['search_path=""'] },
    ]);
    await expect(as('service_role', 'SELECT * FROM public.stripe_refund_followups')).rejects.toThrow(/permission denied/);
    await expect(as('service_role', 'SELECT public.reconcile_stripe_refund_followup($1,$2,$3,$4)',
      ['charge:ch_1', 'evt_a', 'partial_refund', 'operator_resolved'])).rejects.toThrow(/permission denied/);
  });

  it('malformed or free-text input writes nothing and answers false', async () => {
    const bad: [string | null, string | null, string | null][] = [
      [null, 'evt_1', 'partial_refund'], ['charge:cus_1', 'evt_1', 'partial_refund'], ["charge:ch_1'; drop", 'evt_1', 'partial_refund'],
      ['charge:ch_1', 'evt 1', 'partial_refund'], ['charge:ch_1', null, 'partial_refund'], ['charge:ch_1', 'evt_1', 'card 4242 declined'],
      ['charge:ch_1', 'evt_1', null], [`event:evt_${'a'.repeat(201)}`, 'evt_1', 'partial_refund'],
    ];
    for (const [key, event, reason] of bad) {
      const written = await one('service_role', 'SELECT public.record_stripe_refund_followup($1,$2,false,$3)', [key, event, reason]);
      expect({ key, event, reason, written }).toEqual({ key, event, reason, written: false });
    }
    expect(await one(null, 'SELECT count(*)::int FROM public.stripe_refund_followups')).toBe(0);
    await expect(as(null, `INSERT INTO public.stripe_refund_followups (operation_key, reason, first_event_id, last_event_id)
      VALUES ('charge:ch_2', 'card 4242 declined', 'evt_c', 'evt_c')`)).rejects.toThrow(/check constraint/);
    await expect(as(null, `INSERT INTO public.stripe_refund_followups (operation_key, reason, first_event_id, last_event_id, status)
      VALUES ('charge:ch_2', 'partial_refund', 'evt_c', 'evt_c', 'reconciled')`)).rejects.toThrow(/check constraint/);
  });

  it('one row per operation: a redelivery counts, keeps the mode, and stays unresolved', async () => {
    expect(await record('charge:ch_1', 'evt_a', 'renewal_outstanding_after_update')).toBe(true);
    expect(await record('charge:ch_1', 'evt_a', 'renewal_outstanding_after_update', null)).toBe(true);
    expect(await one(null, 'SELECT count(*)::int FROM public.stripe_refund_followups')).toBe(1);
    expect(await row()).toMatchObject({ status: 'unresolved', deliveries: 2, livemode: false, first_event_id: 'evt_a',
      last_event_id: 'evt_a', reason: 'renewal_outstanding_after_update', reconciliation: null, reconciled_at: null });
  });

  it('a plain retry keeps a reconciliation; a new event or a new reason reopens it (security review of 664b84f6)', async () => {
    await record('charge:ch_1', 'evt_a', 'update_failed');
    expect(await reconcile('charge:ch_1', 'evt_a', 'update_failed')).toBe(true);
    expect(await reconcile('charge:ch_1', 'evt_a', 'update_failed')).toBe(false);
    await record('charge:ch_1', 'evt_a', 'update_failed');
    expect(await row()).toMatchObject({ status: 'reconciled', reconciliation: 'operator_resolved', deliveries: 2 });
    // The same event now finds an outstanding renewal: reopened under the new reason, never kept closed.
    await record('charge:ch_1', 'evt_a', 'renewal_outstanding');
    expect(await row()).toMatchObject({ status: 'unresolved', reason: 'renewal_outstanding', reconciliation: null, reconciled_at: null });
    expect(await reconcile('charge:ch_1', 'evt_a', 'renewal_outstanding', 'verified_no_outstanding_invoice')).toBe(true);
    await record('charge:ch_1', 'evt_b', 'renewal_outstanding');
    expect(await row()).toMatchObject({ status: 'unresolved', first_event_id: 'evt_a', last_event_id: 'evt_b', deliveries: 4 });
  });

  it('reconciliation closes only the occurrence the operator looked at (security review of 664b84f6)', async () => {
    await record('charge:ch_1', 'evt_a', 'partial_refund');
    // Reopened by evt_b while the operator was reviewing evt_a's partial refund.
    await record('charge:ch_1', 'evt_b', 'renewal_collected_after_refund');
    expect(await reconcile('charge:ch_1', 'evt_a', 'partial_refund')).toBe(false);
    expect(await reconcile('charge:ch_1', 'evt_b', 'partial_refund')).toBe(false);
    expect((await row()).status).toBe('unresolved');
    expect(await reconcile('charge:ch_1', 'evt_b', 'renewal_collected_after_refund', 'no_charge_guaranteed')).toBe(false);
    expect(await reconcile('charge:ch_missing', 'evt_b', 'renewal_collected_after_refund')).toBe(false);
    expect(await reconcile('charge:ch_1', 'evt_b', 'renewal_collected_after_refund')).toBe(true);
    expect(await row()).toMatchObject({ status: 'reconciled', reconciliation: 'operator_resolved' });
  });

  it('the event key is used when the charge id is unreadable', async () => {
    expect(await record('event:evt_x', 'evt_x', 'refund_unreadable', null)).toBe(true);
    expect(await row('event:evt_x')).toMatchObject({ livemode: null, reason: 'refund_unreadable', status: 'unresolved' });
  });
});
