-- #1061 Guided Rehearsal pre-launch interest ("Notify me") — durable, deduplicated waitlist.
--
-- INTEGRITY MODEL
--  * The browser NEVER writes this table directly. All writes go through the `guided-waitlist` Edge
--    Function using the service-role key (server-side normalize/validate/dedup). RLS therefore DENIES all
--    access to `anon` and `authenticated`; the service role bypasses RLS.
--  * Deduplicated by (product, normalized email): repeated submissions are idempotent (one durable row).
--  * Stores explicit consent provenance so a future notification can be sent lawfully.
--
-- NOT APPLIED IN THIS PR. This migration is committed for review; applying it to production is a separate,
-- explicitly-authorized Product Owner step (see PR body). Unsubscribe/deletion handling before any launch
-- communication is a follow-up increment (tracked in the PR "remaining follow-up items").

create table if not exists public.guided_waitlist (
    id                uuid primary key default gen_random_uuid(),
    -- Product identifier (stable internal token, NOT the user-facing label). Currently 'guided_rehearsal'.
    product           text not null,
    -- Server-normalized email (trimmed + lower-cased). This is the durable contact representation.
    email_normalized  text not null,
    -- Consent provenance — required before any future outbound email.
    consent           boolean not null default false,
    consent_at        timestamptz not null default now(),
    consent_version   text not null,
    consent_source    text not null,
    -- Acquisition context (e.g. 'anonymous_landing' | 'authenticated_practice'); NEVER free-text PII.
    acquisition_source text not null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint guided_waitlist_email_shape check (position('@' in email_normalized) > 1),
    constraint guided_waitlist_email_lower check (email_normalized = lower(email_normalized))
);

-- Dedup key: one durable interest row per (product, normalized email). Enables idempotent upserts.
create unique index if not exists guided_waitlist_product_email_uidx
    on public.guided_waitlist (product, email_normalized);

comment on table public.guided_waitlist is
    '#1061 Guided Rehearsal pre-launch interest. Service-role writes only (guided-waitlist Edge Function). RLS denies anon/authenticated. Dedup by (product, email_normalized).';

-- Fail-closed RLS: enabled with NO policies → anon/authenticated get zero access. The service role (used
-- only by the Edge Function) bypasses RLS and is the sole writer/reader.
alter table public.guided_waitlist enable row level security;
