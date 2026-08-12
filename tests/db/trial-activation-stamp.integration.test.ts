// #1282 blocker 3 — EXECUTED proof (PGlite) that the commercial-activation stamp grants exactly one fresh
// 30-day window per existing UNPAID beta account (including legacy accounts with an EXPIRED non-null
// trial_started_at), never touches paid accounts, and CANNOT extend on re-apply (the immutable marker gates
// it). Applies the stamp migration VERBATIM over a minimal profile table.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STAMP = readFileSync(
  resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260812000500_trial_activation_stamp_1282.sql'),
  'utf8',
);

const BOOTSTRAP = `
CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY,
  subscription_status text DEFAULT 'free',
  stripe_subscription_id text,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  updated_at timestamptz DEFAULT now()
);`;

type Row = { id: string; subscription_status: string; live: boolean; marked: boolean };
const rows = async (db: PGlite): Promise<Record<string, Row>> => {
  const r = (await db.query<Row>(
    `SELECT id::text, subscription_status,
            (trial_expires_at IS NOT NULL AND trial_expires_at > now()) AS live,
            (commercial_trial_granted_at IS NOT NULL) AS marked
     FROM public.user_profiles`,
  )).rows;
  return Object.fromEntries(r.map((x) => [x.id, x]));
};

describe('#1282 commercial-activation stamp (executed in PGlite)', () => {
  it('grants one fresh window to unpaid (incl. legacy-expired), skips paid, and cannot extend on re-apply', async () => {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    // u1: never-activated unpaid.
    await db.exec(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ('00000000-0000-0000-0000-0000000000a1'::uuid, 'free')`);
    // u2: LEGACY unpaid with an EXPIRED non-null trial window — must still be granted.
    await db.exec(`INSERT INTO public.user_profiles (id, subscription_status, trial_started_at, trial_expires_at)
                   VALUES ('00000000-0000-0000-0000-0000000000a2'::uuid, 'free', now() - interval '90 days', now() - interval '60 days')`);
    // u3: paid — must be untouched.
    await db.exec(`INSERT INTO public.user_profiles (id, subscription_status, stripe_subscription_id)
                   VALUES ('00000000-0000-0000-0000-0000000000a3'::uuid, 'pro', 'sub_paid')`);

    await db.exec(STAMP);
    const r = await rows(db);
    const A1 = '00000000-0000-0000-0000-0000000000a1', A2 = '00000000-0000-0000-0000-0000000000a2', A3 = '00000000-0000-0000-0000-0000000000a3';
    expect(r[A1].live).toBe(true); expect(r[A1].marked).toBe(true);   // never-activated -> granted
    expect(r[A2].live).toBe(true); expect(r[A2].marked).toBe(true);   // legacy expired -> STILL granted
    expect(r[A3].subscription_status).toBe('pro');                     // paid untouched
    expect(r[A3].marked).toBe(false);

    // Capture windows, re-apply, assert NEITHER unpaid window moved (marker prevents re-grant/extend).
    const before = (await db.query<{ id: string; e: string }>(
      `SELECT id::text, trial_expires_at::text AS e FROM public.user_profiles WHERE id IN ('${A1}'::uuid, '${A2}'::uuid)`)).rows;
    await db.exec(STAMP); // re-apply
    const after = (await db.query<{ id: string; e: string }>(
      `SELECT id::text, trial_expires_at::text AS e FROM public.user_profiles WHERE id IN ('${A1}'::uuid, '${A2}'::uuid)`)).rows;
    for (const b of before) {
      expect(after.find((a) => a.id === b.id)!.e).toBe(b.e); // unchanged — no extension
    }
    await db.close();
  });
});
