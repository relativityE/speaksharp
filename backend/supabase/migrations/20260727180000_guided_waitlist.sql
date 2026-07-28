-- #1061 Guided Rehearsal pre-launch interest ("Notify me") — durable, deduplicated waitlist with
-- DOUBLE OPT-IN (confirmed consent).
--
-- INTEGRITY MODEL
--  * The browser NEVER writes this table directly. All writes go through the `guided-waitlist` Edge
--    Function using the service-role key (server-side normalize/validate/dedup). RLS therefore DENIES all
--    access to `anon` and `authenticated`; the service role bypasses RLS.
--  * Deduplicated by (product, normalized email): repeated submissions are idempotent (one durable row).
--  * CONFIRMED-CONSENT LIFECYCLE: a submission is created `status = 'pending'` — self-asserted consent
--    ONLY. It becomes `status = 'confirmed'` solely after the person clicks the emailed confirmation link
--    (double opt-in). Launch communications may target CONFIRMED rows only; a `pending` row is an interest
--    signal, NOT a subscription. `confirmed_at` is set iff (and only iff) `status = 'confirmed'`.
--  * Stores explicit consent provenance + confirmation provenance so a future notification can be sent
--    lawfully and auditably.
--
-- NOT APPLIED IN THIS PR. This migration is committed for review; applying it to production is a separate,
-- explicitly-authorized Product Owner step (checkpoint 2). Unsubscribe/deletion handling and the
-- confirmation-email dispatch are follow-up increments (backend PR = checkpoint 3; activation = later).

create table if not exists public.guided_waitlist (
    id                uuid primary key default gen_random_uuid(),
    -- Product identifier (stable internal token, NOT the user-facing label). Currently 'guided_rehearsal'.
    product           text not null,
    -- Server-normalized email (trimmed + lower-cased). This is the durable contact representation.
    email_normalized  text not null,
    -- Consent provenance — the box the person ticked at submit time (SELF-ASSERTED; not yet confirmed).
    consent           boolean not null default false,
    consent_at        timestamptz not null default now(),
    consent_version   text not null,
    consent_source    text not null,
    -- Acquisition context (e.g. 'anonymous_landing' | 'authenticated_practice'); NEVER free-text PII.
    acquisition_source text not null,
    -- Double opt-in lifecycle. 'pending' = interest only (self-asserted consent); 'confirmed' = the person
    -- clicked the emailed confirmation link. Only 'confirmed' rows are a subscription for launch comms.
    status                text not null default 'pending',
    -- Opaque token embedded in the confirmation link; set at creation, cleared once confirmed.
    confirmation_token    uuid,
    -- When the confirmation email was dispatched (null until the activation-gated send exists).
    confirmation_sent_at  timestamptz,
    -- When the person confirmed (null = never). Set iff status = 'confirmed' (see check below).
    confirmed_at          timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint guided_waitlist_email_shape check (position('@' in email_normalized) > 1),
    constraint guided_waitlist_email_lower check (email_normalized = lower(email_normalized)),
    -- Closed status domain — no arbitrary states.
    constraint guided_waitlist_status_valid check (status in ('pending', 'confirmed')),
    -- A row is confirmed IFF it carries a confirmation timestamp: no "confirmed" row without proof, and no
    -- stray confirmed_at on a pending row. This is the DB-level guarantee that self-asserted consent can
    -- never masquerade as a confirmed subscription.
    constraint guided_waitlist_confirmed_shape check ((status = 'confirmed') = (confirmed_at is not null))
);

-- Dedup key: one durable interest row per (product, normalized email). Enables idempotent upserts.
create unique index if not exists guided_waitlist_product_email_uidx
    on public.guided_waitlist (product, email_normalized);

comment on table public.guided_waitlist is
    '#1061 Guided Rehearsal pre-launch interest (double opt-in). Service-role writes only (guided-waitlist Edge Function). RLS denies anon/authenticated. Dedup by (product, email_normalized). status pending→confirmed; only confirmed rows are a subscription.';

-- Fail-closed RLS: enabled with NO policies → anon/authenticated get zero access. The service role (used
-- only by the Edge Function) bypasses RLS and is the sole writer/reader.
alter table public.guided_waitlist enable row level security;
