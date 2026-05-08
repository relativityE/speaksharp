-- Enforce the launch invariant that every promo code is one-time use.
-- A redeemed code must never succeed again, even for the same user during
-- the original promo access window.

update public.promo_codes
set max_uses = 1
where max_uses <> 1;

update public.promo_codes
set used_count = 1
where used_count > 1;

alter table public.promo_codes
  drop constraint if exists promo_codes_max_uses_one_time;

alter table public.promo_codes
  add constraint promo_codes_max_uses_one_time
  check (max_uses = 1);

alter table public.promo_codes
  drop constraint if exists promo_codes_used_count_one_time;

alter table public.promo_codes
  add constraint promo_codes_used_count_one_time
  check (used_count between 0 and 1);

create or replace function redeem_promo(
  p_code text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_promo record;
  v_redemption record;
  v_duration_min int;
  v_expires_at timestamptz;
  v_now timestamptz := now();
begin
  -- Lock the promo row so concurrent redemption attempts serialize.
  select * into v_promo
  from public.promo_codes
  where code = p_code
    and active = true
  for update;

  if v_promo is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or inactive promo code');
  end if;

  if v_promo.valid_until is not null and v_promo.valid_until < v_now then
    return jsonb_build_object('success', false, 'error', 'Promo code expired');
  end if;

  if v_promo.max_uses <> 1 then
    return jsonb_build_object('success', false, 'error', 'Promo code configuration invalid');
  end if;

  if v_promo.used_count >= 1 then
    return jsonb_build_object('success', false, 'error', 'Promo code already used');
  end if;

  select * into v_redemption
  from public.promo_redemptions
  where promo_code_id = v_promo.id
  limit 1;

  if v_redemption is not null then
    return jsonb_build_object('success', false, 'error', 'Promo code already used');
  end if;

  insert into public.promo_redemptions (promo_code_id, user_id, redeemed_at)
  values (v_promo.id, p_user_id, v_now);

  update public.promo_codes
  set used_count = 1
  where id = v_promo.id;

  v_duration_min := coalesce(v_promo.duration_minutes, 60);
  v_expires_at := v_now + (v_duration_min || ' minutes')::interval;

  insert into public.user_profiles (id, subscription_status, promo_expires_at)
  values (p_user_id, 'pro', v_expires_at)
  on conflict (id) do update
  set subscription_status = 'pro',
      promo_expires_at = v_expires_at;

  return jsonb_build_object(
    'success', true,
    'message', 'Promo code applied! You have Pro features for ' || v_duration_min || ' minutes.',
    'proFeatureMinutes', v_duration_min,
    'is_reuse', false
  );

exception
  when others then
    return jsonb_build_object('success', false, 'error', SQLERRM);
end;
$$;
