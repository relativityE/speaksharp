// @vitest-environment node
// Executes the actual stripe_refund_followups migration in PostgreSQL WASM (Sam's 2026-11-12 decision for #1829):
// the operator signal's grants, closed values, one row per operation, and who may close it. The webhook's use of
// the writer is covered by backend/supabase/functions/stripe-webhook/refund.test.ts.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const MIGRATION = 'backend/supabase/migrations/20261112130000_stripe_refund_followups.sql';
const WEBHOOK_REFUND = 'backend/supabase/functions/stripe-webhook/refund.ts';
const quoted = (text: string, quote: string) => [...text.matchAll(new RegExp(`${quote}([a-z_]+)${quote}`, 'g'))].map(m => m[1]);
const RECORD = 'public.record_stripe_refund_followup(text,text,boolean,text)';
const RECONCILE = 'public.reconcile_stripe_refund_followup(text,text,text,text)';
const API_ROLES = ['anon', 'authenticated', 'service_role'];

let db: PGlite;
const consumed = new Map<string, { file: string; sha256: string; beforeSha256: string; afterSha256: string }>();
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
  const bytes = readFileSync(MIGRATION), beforeSha256 = createHash('sha256').update(bytes).digest('hex');
  await db.exec(bytes.toString('utf8'));
  const afterSha256 = createHash('sha256').update(readFileSync(MIGRATION)).digest('hex');
  if (afterSha256 !== beforeSha256) throw new Error('SQL bytes changed across actual execution');
  consumed.set(MIGRATION, { file: MIGRATION, sha256: beforeSha256, beforeSha256, afterSha256 });
});
// The execution-evidence witness (scripts/lib/nativeTestExecutionEvidence.mjs SQL_CONTRACTS): written only when the
// quality run binds this file, and naming the exact migration bytes that ran.
afterAll(async () => {
  await db?.close();
  const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING ?? 'null');
  if (binding?.sql) writeFileSync(binding.sql.witnessFile, JSON.stringify({ schemaVersion: 1,
    phaseId: binding.phaseId, bindingSha256: createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
    consumer: 'tests/unit/stripeRefundFollowups.test.ts', consumed: [...consumed.values()] }));
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

  it('a retry of the first event, after a second one, is still a plain retry when its reason is current', async () => {
    await record('charge:ch_1', 'evt_a', 'renewal_outstanding');
    await record('charge:ch_1', 'evt_b', 'renewal_outstanding');
    expect(await reconcile('charge:ch_1', 'evt_b', 'renewal_outstanding')).toBe(true);
    // Stripe retries evt_a (still failing the same way): the reconciliation stands.
    await record('charge:ch_1', 'evt_a', 'renewal_outstanding');
    expect(await row()).toMatchObject({ status: 'reconciled', first_event_id: 'evt_a', last_event_id: 'evt_a', deliveries: 3 });
    // A third, unseen event reopens.
    await record('charge:ch_1', 'evt_c', 'renewal_outstanding');
    expect(await row()).toMatchObject({ status: 'unresolved', reconciliation: null });
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

  it("the webhook's reason codes are exactly the migration's closed list, and each one records", async () => {
    const source = readFileSync(WEBHOOK_REFUND, 'utf8').match(/export const FOLLOWUP_REASONS = Object\.freeze\(\[([^\]]*)\]/);
    expect(source).not.toBeNull();
    const reasons = quoted(source![1], '"');
    expect(reasons.length).toBe(12);
    const lists = [...readFileSync(MIGRATION, 'utf8').matchAll(/reason (?:IN|NOT IN) \(([^)]*)\)/g)].map(m => quoted(m[1], "'"));
    expect(lists).toEqual([reasons, reasons]); // the table CHECK and the writer's guard
    for (const [index, reason] of reasons.entries()) {
      expect({ reason, written: await record(`charge:ch_${index}`, 'evt_a', reason) }).toEqual({ reason, written: true });
    }
  });

  it('the event key is used when the charge id is unreadable', async () => {
    expect(await record('event:evt_x', 'evt_x', 'refund_unreadable', null)).toBe(true);
    expect(await row('event:evt_x')).toMatchObject({ livemode: null, reason: 'refund_unreadable', status: 'unresolved' });
  });
});
