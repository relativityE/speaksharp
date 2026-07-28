-- #1061 Guided Rehearsal pre-launch interest ("Notify me") — durable, deduplicated waitlist with
-- DOUBLE OPT-IN (confirmed consent). Schema foundation only (checkpoint 1); applies nothing here.
--
-- INTEGRITY MODEL (enforced at the DB boundary, proven behaviorally in
-- tests/db/guided-waitlist-schema.behavioral.test.js against a real PGlite/Postgres row)
--  * The browser NEVER writes this table directly. All writes go through the `guided-waitlist` Edge
--    Function using the service-role key. RLS is enabled with NO policies → anon/authenticated get zero
--    access; the service role bypasses RLS and is the sole reader/writer.
--  * Dedup by (product, email_normalized): repeated submissions are idempotent (one durable row).
--  * SELF-ASSERTED consent (the ticked checkbox) is DISTINCT from CONFIRMED consent. A row exists only
--    because the box was asserted (`self_asserted_consent` must be true); `confirmed_at` is the SOLE proof
--    of confirmed consent. Self-asserted interest is NOT a subscription.
--  * Double opt-in with a SINGLE-USE, EXPIRING token. We store only a cryptographic HASH of the token
--    (`confirmation_token_hash`, SHA-256 hex), never the raw token. On confirmation the hash is CLEARED
--    (single use); `confirmation_sent_at`/`confirmation_expires_at` are preserved as provenance.
--
-- NOT APPLIED IN THIS PR. Applying this migration to production is a separate, explicitly-authorized
-- Product Owner step (checkpoint 2). The Edge Function confirm flow, rate limiting, and confirmation-email
-- dispatch are checkpoint 3/4; nothing here sends email or writes rows.

-- This is a one-time versioned migration. We deliberately DO NOT use `if not exists`: if a
-- `guided_waitlist` table (or index) already exists, that is an unexpected/conflicting state and the
-- migration MUST fail loudly rather than silently adopt a possibly-malformed pre-existing table.
create table public.guided_waitlist (
    id                        uuid primary key default gen_random_uuid(),
    -- Product identifier (stable internal token, NOT the user-facing label). Only Guided Rehearsal today.
    product                   text not null,
    -- Server-normalized email (trimmed + lower-cased). The durable contact representation.
    email_normalized          text not null,
    -- SELF-ASSERTED consent — the box the person ticked at submit time. Must be true (a row cannot record
    -- a non-consented submission). Distinct from confirmed consent (see confirmed_at).
    self_asserted_consent     boolean not null,
    self_asserted_consent_at  timestamptz not null default now(),
    consent_version           text not null,
    consent_source            text not null,
    -- Acquisition context (e.g. 'anonymous_landing' | 'authenticated_practice'); NEVER free-text PII.
    acquisition_source        text not null,
    -- Double opt-in lifecycle. 'pending' = interest only (self-asserted); 'confirmed' = the person clicked
    -- the emailed single-use link. Only 'confirmed' rows are a subscription for launch communications.
    status                    text not null default 'pending',
    -- HASH ONLY of the single-use confirmation token (SHA-256 hex, 64 lowercase hex chars). NEVER the raw
    -- token. Set when the confirmation email is sent; CLEARED (null) on successful confirmation (single use).
    confirmation_token_hash   text,
    confirmation_sent_at      timestamptz,
    confirmation_expires_at   timestamptz,
    -- The SOLE proof of confirmed consent (null = never confirmed).
    confirmed_at              timestamptz,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),

    -- Product is constrained to the single supported token (extend via a future migration, not free-text).
    constraint guided_waitlist_product_valid check (product = 'guided_rehearsal'),
    -- Acquisition provenance is a closed set of stable tokens — never free-text / PII (extend via a
    -- reviewed migration). Guards the "no free-text PII" claim at the DB boundary.
    constraint guided_waitlist_acquisition_source_valid
        check (acquisition_source in ('anonymous_landing', 'authenticated_practice')),
    -- Server-normalized email. The dedup key relies on canonicalization, so enforce it at the DB boundary:
    --  * lower-cased,
    --  * trimmed (no leading/trailing whitespace — a ' x@y ' variant must not bypass dedup),
    --  * bounded length (RFC 5321 max is 254),
    --  * non-empty local AND domain (the '@' is neither first nor last char).
    -- The Edge Function remains responsible for stronger RFC validation; this is the canonical-form floor.
    constraint guided_waitlist_email_lower   check (email_normalized = lower(email_normalized)),
    -- "At minimum" btrim of spaces; we trim the full ASCII whitespace set (space/tab/newline/CR) so no
    -- whitespace variant can bypass (product, email_normalized) dedup.
    constraint guided_waitlist_email_trimmed check (email_normalized = btrim(email_normalized, E' \t\n\r')),
    constraint guided_waitlist_email_length  check (length(email_normalized) between 3 and 254),
    constraint guided_waitlist_email_shape   check (
        position('@' in email_normalized) > 1
        and position('@' in email_normalized) < length(email_normalized)
    ),
    -- A stored submission PROVES the checkbox was asserted — no default-false rows.
    constraint guided_waitlist_self_asserted_consent check (self_asserted_consent is true),
    -- Closed status domain.
    constraint guided_waitlist_status_valid check (status in ('pending', 'confirmed')),
    -- The token hash, when present, is a 64-char lowercase-hex SHA-256 digest (never a raw/opaque token).
    constraint guided_waitlist_token_hash_format check (
        confirmation_token_hash is null or confirmation_token_hash ~ '^[0-9a-f]{64}$'
    ),
    -- Expiry must be strictly after the send time whenever both are present.
    constraint guided_waitlist_expiry_after_send check (
        confirmation_expires_at is null
        or confirmation_sent_at is null
        or confirmation_expires_at > confirmation_sent_at
    ),
    -- Confirmation chronology: a confirmation cannot happen before the token was sent, nor after it
    -- expired. Guards against a service-role bug confirming an unsent or expired token. (When confirmed_at
    -- is set, the lifecycle shape guarantees sent/expiry are non-null.)
    constraint guided_waitlist_confirmed_chronology check (
        confirmed_at is null
        or (confirmed_at >= confirmation_sent_at and confirmed_at <= confirmation_expires_at)
    ),
    -- Exactly the three valid lifecycle shapes. This is the DB-level single-use guarantee: token metadata
    -- is all-or-nothing while pending, and a confirmed row has cleared its token hash (cannot be replayed),
    -- while confirmed_at is required iff (and only iff) status = 'confirmed'.
    constraint guided_waitlist_lifecycle_shape check (
        (
            -- (a) pending, confirmation not yet sent — no token metadata at all
            status = 'pending'
            and confirmed_at is null
            and confirmation_token_hash is null
            and confirmation_sent_at is null
            and confirmation_expires_at is null
        )
        or (
            -- (b) pending, confirmation sent, awaiting click — full token metadata present
            status = 'pending'
            and confirmed_at is null
            and confirmation_token_hash is not null
            and confirmation_sent_at is not null
            and confirmation_expires_at is not null
        )
        or (
            -- (c) confirmed — proof present, token hash cleared (single use), send/expiry provenance kept
            status = 'confirmed'
            and confirmed_at is not null
            and confirmation_token_hash is null
            and confirmation_sent_at is not null
            and confirmation_expires_at is not null
        )
    )
);

-- Dedup key: one durable interest row per (product, normalized email). Enables idempotent upserts.
-- No `if not exists` (see table note): a pre-existing index means an unexpected state → fail loudly.
create unique index guided_waitlist_product_email_uidx
    on public.guided_waitlist (product, email_normalized);

-- An outstanding (non-null) confirmation token hash is globally unique — no two pending rows share a hash.
create unique index guided_waitlist_token_hash_uidx
    on public.guided_waitlist (confirmation_token_hash)
    where confirmation_token_hash is not null;

comment on table public.guided_waitlist is
    '#1061 Guided Rehearsal pre-launch interest (double opt-in, single-use hashed token). Service-role writes only (guided-waitlist Edge Function). RLS denies anon/authenticated. Dedup by (product, email_normalized). status pending->confirmed; only confirmed rows are a subscription. Stores a SHA-256 token hash only, cleared on confirmation.';

-- Fail-closed RLS: enabled with NO policies → anon/authenticated get zero access. The service role (used
-- only by the Edge Function) bypasses RLS and is the sole writer/reader.
alter table public.guided_waitlist enable row level security;
