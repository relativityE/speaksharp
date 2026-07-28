// @vitest-environment node
//
// #1061 checkpoint 1 — guided_waitlist SCHEMA/MIGRATION contract proof, BEHAVIORAL.
//
// This loads the ACTUAL shipped migration file and EXECUTES it against a genuine PostgreSQL row (PGlite =
// Postgres compiled to WASM: real planner, CHECK constraints, partial unique indexes, RLS catalog — NOT a
// mock, NOT a regex over SQL text). Every guarantee below is proven by an INSERT/UPDATE that either
// succeeds or is rejected by the database. Test-only: no product code, no migration apply, no deploy.
//
// Proven here (the security contract the double opt-in Edge Function will rely on):
//   - valid pending insert succeeds; product/status are constrained; (product,email) dedup is unique;
//   - self-asserted consent must be true (no default-false ambiguous rows);
//   - double opt-in lifecycle has exactly three shapes; token metadata is all-or-nothing;
//   - confirmed rows require confirmed_at AND clear the token hash (single use); pending rows never carry
//     confirmed_at; expiry must be after send;
//   - the token is stored as a HASH only (no raw-token column) with a 64-hex format constraint and a
//     partial unique index on non-null hashes;
//   - RLS is enabled with zero policies (deny-all).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(HERE, '../../backend/supabase/migrations/20260727180000_guided_waitlist.sql');
const MIGRATION_SQL = readFileSync(MIGRATION, 'utf8');

// A well-formed SHA-256 hex digest (64 lowercase hex chars) — the ONLY accepted token-hash shape.
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

// Base columns for a valid "pending, not yet sent" submission (shape a).
const BASE = {
  product: 'guided_rehearsal',
  email: 'me@example.com',
  consent: true,
  version: 'guided_waitlist_v1',
  source: 'anonymous_landing',
};

let db;

// Insert a row from an explicit column map; returns the inserted row or throws on a constraint violation.
async function insert(cols) {
  const row = {
    product: BASE.product,
    email_normalized: BASE.email,
    self_asserted_consent: BASE.consent,
    self_asserted_consent_at: 'now()RAW',
    consent_version: BASE.version,
    consent_source: BASE.source,
    acquisition_source: BASE.source,
    ...cols,
  };
  // Build a parametrized INSERT, but allow the sentinel now()RAW to pass through as SQL now().
  const keys = Object.keys(row);
  const params = [];
  const placeholders = keys.map((k) => {
    if (row[k] === 'now()RAW') return 'now()';
    params.push(row[k]);
    return `$${params.length}`;
  });
  const res = await db.query(
    `INSERT INTO public.guided_waitlist (${keys.join(', ')}) VALUES (${placeholders.join(', ')})
     RETURNING id, product, email_normalized, status, self_asserted_consent, confirmation_token_hash,
               confirmation_sent_at, confirmation_expires_at, confirmed_at`,
    params,
  );
  return res.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  // The migration is self-contained (public schema + gen_random_uuid + RLS enable); execute it as shipped.
  await db.exec(MIGRATION_SQL);
});

afterAll(async () => { await db?.close?.(); });

describe('#1061 guided_waitlist migration — real DB-row constraint behavior (PGlite)', () => {
  it('1. a valid pending insert succeeds and defaults to status=pending with no token metadata', async () => {
    const row = await insert({ email_normalized: 'valid-pending@example.com' });
    expect(row.status).toBe('pending');
    expect(row.self_asserted_consent).toBe(true);
    expect(row.confirmation_token_hash).toBeNull();
    expect(row.confirmation_sent_at).toBeNull();
    expect(row.confirmation_expires_at).toBeNull();
    expect(row.confirmed_at).toBeNull();
  });

  it('2. an invalid product is rejected (product is constrained to guided_rehearsal)', async () => {
    await expect(insert({ product: 'some_other_product', email_normalized: 'p@example.com' }))
      .rejects.toThrow();
  });

  it('3. an invalid status is rejected (closed status domain)', async () => {
    await expect(insert({ status: 'bogus', email_normalized: 's@example.com' }))
      .rejects.toThrow();
  });

  it('4. a duplicate (product, email_normalized) is rejected by the unique dedup index', async () => {
    await insert({ email_normalized: 'dup@example.com' });
    await expect(insert({ email_normalized: 'dup@example.com' })).rejects.toThrow();
  });

  it('4b. self-asserted consent must be true — a false/omitted consent row is rejected', async () => {
    await expect(insert({ self_asserted_consent: false, email_normalized: 'noconsent@example.com' }))
      .rejects.toThrow();
  });

  it('4c. a CONFIRMED row without asserted consent is rejected (no launch-notifiable row lacks consent)', async () => {
    // Even a fully-formed confirmed shape cannot persist if consent was not asserted — launch comms target
    // confirmed rows, so this is the guarantee that a confirmed (notifiable) row always carries consent.
    await expect(insert({
      email_normalized: 'confirmed-noconsent@example.com',
      self_asserted_consent: false,
      status: 'confirmed',
      confirmation_token_hash: null,
      confirmation_sent_at: 'now()RAW',
      confirmation_expires_at: new Date(Date.now() + 3600e3).toISOString(),
      confirmed_at: new Date().toISOString(),
    })).rejects.toThrow();
  });

  it('5. status=confirmed WITHOUT confirmed_at is rejected (confirmation proof required)', async () => {
    await expect(insert({
      email_normalized: 'confirmed-noproof@example.com',
      status: 'confirmed',
      confirmation_token_hash: null,
      confirmation_sent_at: 'now()RAW',
      confirmation_expires_at: new Date(Date.now() + 3600e3).toISOString(),
      confirmed_at: null,
    })).rejects.toThrow();
  });

  it('6. status=pending WITH confirmed_at is rejected (a pending row cannot be confirmed)', async () => {
    await expect(insert({
      email_normalized: 'pending-butconfirmed@example.com',
      status: 'pending',
      confirmed_at: new Date().toISOString(),
    })).rejects.toThrow();
  });

  it('7. partially-populated token metadata is rejected (all-or-nothing while pending)', async () => {
    // token hash present but no sent/expiry → not a valid shape.
    await expect(insert({
      email_normalized: 'partial-token@example.com',
      confirmation_token_hash: HASH_A,
    })).rejects.toThrow();
    // sent present but no token hash/expiry → also invalid.
    await expect(insert({
      email_normalized: 'partial-sent@example.com',
      confirmation_sent_at: 'now()RAW',
    })).rejects.toThrow();
  });

  it('8. an expiry before the send time is rejected', async () => {
    const sent = new Date();
    const expired = new Date(sent.getTime() - 60_000); // before sent
    await expect(insert({
      email_normalized: 'expiry-before-send@example.com',
      confirmation_token_hash: HASH_A,
      confirmation_sent_at: sent.toISOString(),
      confirmation_expires_at: expired.toISOString(),
    })).rejects.toThrow();
  });

  it('9. a confirmed row that RETAINS a token hash is rejected (single use: hash must be cleared)', async () => {
    await expect(insert({
      email_normalized: 'confirmed-withhash@example.com',
      status: 'confirmed',
      confirmation_token_hash: HASH_A,
      confirmation_sent_at: 'now()RAW',
      confirmation_expires_at: new Date(Date.now() + 3600e3).toISOString(),
      confirmed_at: new Date().toISOString(),
    })).rejects.toThrow();
  });

  it('9b. a non-hex / wrong-length token hash is rejected (SHA-256 hex format constraint)', async () => {
    await expect(insert({
      email_normalized: 'badhash@example.com',
      confirmation_token_hash: 'NOT-A-HASH',
      confirmation_sent_at: 'now()RAW',
      confirmation_expires_at: new Date(Date.now() + 3600e3).toISOString(),
    })).rejects.toThrow();
  });

  it('10. a duplicate non-null token hash across rows is rejected (partial unique index)', async () => {
    const sentA = new Date();
    const expA = new Date(sentA.getTime() + 3600e3);
    await insert({
      email_normalized: 'token-owner-1@example.com',
      confirmation_token_hash: HASH_B,
      confirmation_sent_at: sentA.toISOString(),
      confirmation_expires_at: expA.toISOString(),
    });
    await expect(insert({
      email_normalized: 'token-owner-2@example.com',
      confirmation_token_hash: HASH_B, // same hash → collision
      confirmation_sent_at: sentA.toISOString(),
      confirmation_expires_at: expA.toISOString(),
    })).rejects.toThrow();
  });

  it('valid lifecycle transitions succeed: pending → sent → confirmed (hash cleared)', async () => {
    const created = await insert({ email_normalized: 'lifecycle@example.com' });
    // pending → sent (attach full token metadata)
    const sent = new Date();
    const exp = new Date(sent.getTime() + 3600e3);
    const sentRow = (await db.query(
      `UPDATE public.guided_waitlist
         SET confirmation_token_hash=$2, confirmation_sent_at=$3, confirmation_expires_at=$4
       WHERE id=$1 RETURNING status, confirmation_token_hash, confirmed_at`,
      [created.id, 'c'.repeat(64), sent.toISOString(), exp.toISOString()],
    )).rows[0];
    expect(sentRow.status).toBe('pending');
    expect(sentRow.confirmation_token_hash).toBe('c'.repeat(64));
    // sent → confirmed (set confirmed_at + status, CLEAR the hash)
    const confirmedRow = (await db.query(
      `UPDATE public.guided_waitlist
         SET status='confirmed', confirmed_at=now(), confirmation_token_hash=NULL
       WHERE id=$1 RETURNING status, confirmation_token_hash, confirmed_at, confirmation_sent_at`,
      [created.id],
    )).rows[0];
    expect(confirmedRow.status).toBe('confirmed');
    expect(confirmedRow.confirmation_token_hash).toBeNull();  // single-use: cleared
    expect(confirmedRow.confirmed_at).not.toBeNull();          // confirmation proof present
    expect(confirmedRow.confirmation_sent_at).not.toBeNull();  // send provenance preserved
  });

  it('11. raw-token storage is absent: only confirmation_token_hash exists, no confirmation_token column', async () => {
    const cols = (await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='guided_waitlist'`,
    )).rows.map((r) => r.column_name);
    expect(cols).toContain('confirmation_token_hash');
    expect(cols).not.toContain('confirmation_token'); // no raw token column
  });

  it('12. RLS is enabled with ZERO policies (deny-all; service role only)', async () => {
    const rls = (await db.query(
      `SELECT relrowsecurity FROM pg_class WHERE oid='public.guided_waitlist'::regclass`,
    )).rows[0];
    expect(rls.relrowsecurity).toBe(true);
    const policies = (await db.query(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='guided_waitlist'`,
    )).rows[0];
    expect(policies.n).toBe(0);
    // Belt-and-suspenders on the source: the migration grants no policy to anon/authenticated.
    expect(MIGRATION_SQL).not.toMatch(/create policy/i);
    expect(MIGRATION_SQL).not.toMatch(/to (anon|authenticated)/i);
  });

  it('12b. the (product, email_normalized) dedup index exists on the table', async () => {
    const idx = (await db.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='guided_waitlist'`,
    )).rows.map((r) => r.indexname);
    expect(idx).toContain('guided_waitlist_product_email_uidx');
    expect(idx).toContain('guided_waitlist_token_hash_uidx');
  });

  // ─── Batch 2: confirmation chronology, email canonicalization, acquisition provenance, fail-loud ───

  it('13. a confirmation BEFORE the token was sent is rejected (confirmed_at < confirmation_sent_at)', async () => {
    const sent = new Date();
    const expiry = new Date(sent.getTime() + 3600e3);
    const beforeSent = new Date(sent.getTime() - 60_000);
    await expect(insert({
      email_normalized: 'confirm-before-sent@example.com',
      status: 'confirmed',
      confirmation_token_hash: null,       // cleared on confirm
      confirmation_sent_at: sent.toISOString(),
      confirmation_expires_at: expiry.toISOString(),
      confirmed_at: beforeSent.toISOString(),
    })).rejects.toThrow();
  });

  it('14. a confirmation AFTER the token expired is rejected (confirmed_at > confirmation_expires_at)', async () => {
    const sent = new Date(Date.now() - 2 * 3600e3);
    const expiry = new Date(Date.now() - 3600e3); // expired an hour ago (still > sent)
    const afterExpiry = new Date();               // now — past expiry
    await expect(insert({
      email_normalized: 'confirm-after-expiry@example.com',
      status: 'confirmed',
      confirmation_token_hash: null,
      confirmation_sent_at: sent.toISOString(),
      confirmation_expires_at: expiry.toISOString(),
      confirmed_at: afterExpiry.toISOString(),
    })).rejects.toThrow();
  });

  it('15. a within-window confirmation is accepted (confirmed_at between sent and expiry)', async () => {
    const sent = new Date(Date.now() - 60_000);
    const expiry = new Date(Date.now() + 3600e3);
    const row = await insert({
      email_normalized: 'confirm-inwindow@example.com',
      status: 'confirmed',
      confirmation_token_hash: null,
      confirmation_sent_at: sent.toISOString(),
      confirmation_expires_at: expiry.toISOString(),
      confirmed_at: new Date().toISOString(),
    });
    expect(row.status).toBe('confirmed');
    expect(row.confirmed_at).not.toBeNull();
  });

  it('16. leading/trailing-whitespace email variants are rejected (cannot bypass dedup)', async () => {
    // The trimmed form already exists; the padded variant must NOT be storable as a distinct row.
    await insert({ email_normalized: 'canon@example.com' });
    await expect(insert({ email_normalized: ' canon@example.com' })).rejects.toThrow(); // leading space
    await expect(insert({ email_normalized: 'canon@example.com ' })).rejects.toThrow(); // trailing space
    await expect(insert({ email_normalized: '\tcanon@example.com' })).rejects.toThrow(); // leading tab
  });

  it('16b. empty local or domain, or an over-length email, is rejected', async () => {
    await expect(insert({ email_normalized: '@example.com' })).rejects.toThrow(); // empty local
    await expect(insert({ email_normalized: 'nolocaldomain@' })).rejects.toThrow(); // empty domain
    await expect(insert({ email_normalized: `${'a'.repeat(250)}@b.co` })).rejects.toThrow(); // > 254
  });

  it('17. an unknown / free-text acquisition_source is rejected (closed provenance set)', async () => {
    await expect(insert({
      email_normalized: 'freetext-source@example.com',
      acquisition_source: 'John Doe <john@x.com> via a friend', // free-text / PII shape
    })).rejects.toThrow();
    // the two supported tokens are accepted
    for (const src of ['anonymous_landing', 'authenticated_practice']) {
      const row = await insert({ email_normalized: `src-${src}@example.com`, acquisition_source: src });
      expect(row.id).toBeTruthy();
    }
  });

  it('18. the migration fails LOUDLY on a pre-existing table (no IF NOT EXISTS)', async () => {
    // The table already exists (applied in beforeAll); re-running the one-time migration must throw
    // rather than silently adopt a possibly-malformed table.
    await expect(db.exec(MIGRATION_SQL)).rejects.toThrow();
    // Source guard: the new-schema DDL uses no IF NOT EXISTS for the table or its indexes.
    expect(MIGRATION_SQL).not.toMatch(/create table if not exists/i);
    expect(MIGRATION_SQL).not.toMatch(/create unique index if not exists/i);
  });
});
