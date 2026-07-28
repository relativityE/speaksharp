import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// #1061 Guided waitlist migration contract — proves the DB-level integrity the Edge Function relies on:
// fail-closed RLS (no browser access), (product, email_normalized) dedup uniqueness, consent provenance,
// server-normalized email constraints, AND the double opt-in lifecycle (pending→confirmed; a self-asserted
// row can never be a confirmed subscription). NOT applied in this PR (review-only, checkpoint 1).
const MIGRATION = '20260727180000_guided_waitlist.sql';
const migration = readFileSync(
  resolve(process.cwd(), 'backend', 'supabase', 'migrations', MIGRATION),
  'utf8',
);

describe('#1061 guided_waitlist migration contract', () => {
  it('creates the table with consent provenance + acquisition source + timestamps', () => {
    expect(migration).toMatch(/create table if not exists public\.guided_waitlist/i);
    for (const col of ['product', 'email_normalized', 'consent', 'consent_at', 'consent_version', 'consent_source', 'acquisition_source', 'created_at', 'updated_at']) {
      expect(migration).toContain(col);
    }
  });

  it('deduplicates by (product, email_normalized) with a UNIQUE index (idempotent upserts)', () => {
    expect(migration).toMatch(/create unique index[^\n]*guided_waitlist[^\n]*\n?\s*on public\.guided_waitlist \(product, email_normalized\)/i);
  });

  it('is fail-closed: RLS enabled with NO policies (anon/authenticated get zero access; service role only)', () => {
    expect(migration).toMatch(/alter table public\.guided_waitlist enable row level security/i);
    // No policy is granted to anon/authenticated — the browser never reads/writes this table.
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/to (anon|authenticated)/i);
  });

  it('constrains the email to a normalized (lower-cased, @-shaped) value', () => {
    expect(migration).toMatch(/email_normalized = lower\(email_normalized\)/i);
    expect(migration).toMatch(/position\('@' in email_normalized\) > 1/i);
  });

  it('models a double opt-in lifecycle: pending by default, closed status domain, confirmation provenance', () => {
    // Confirmation provenance columns exist.
    for (const col of ['status', 'confirmation_token', 'confirmation_sent_at', 'confirmed_at']) {
      expect(migration).toContain(col);
    }
    // A new row is 'pending' (self-asserted consent only), never confirmed at creation.
    expect(migration).toMatch(/status\s+text not null default 'pending'/i);
    // Closed status domain — no arbitrary states.
    expect(migration).toMatch(/status in \('pending', ?'confirmed'\)/i);
  });

  it('guarantees self-asserted consent can never masquerade as a confirmed subscription', () => {
    // status = 'confirmed' IFF confirmed_at is present — no confirmed row without proof, and no stray
    // confirmed_at on a pending row.
    expect(migration).toMatch(/\(status = 'confirmed'\) = \(confirmed_at is not null\)/i);
  });
});
