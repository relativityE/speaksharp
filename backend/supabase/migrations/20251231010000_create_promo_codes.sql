create table if not exists public.promo_codes (
    id uuid default gen_random_uuid() primary key,
    code text not null unique,
    duration_minutes integer not null default 60,
    max_uses integer not null default 1,
    used_count integer not null default 0,
    valid_until timestamp with time zone,
    created_at timestamp with time zone default now() not null,
    active boolean default true not null
);

-- Add RLS policies (only admin/service role can read/write)
alter table public.promo_codes enable row level security;

create policy "Service role has full access"
    on public.promo_codes
    for all
    using ( auth.role() = 'service_role' );

-- Index for fast lookup
create index idx_promo_codes_code on public.promo_codes(code);

create table if not exists public.promo_redemptions (
    id uuid default gen_random_uuid() primary key,
    promo_code_id uuid references public.promo_codes(id) not null,
    user_id uuid references auth.users(id) not null,
    redeemed_at timestamp with time zone default now() not null,
    unique(promo_code_id, user_id)
);

alter table public.promo_redemptions enable row level security;

create policy "Service role has full access redemptions"
    on public.promo_redemptions
    for all
    using ( auth.role() = 'service_role' );
