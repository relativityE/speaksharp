-- Migration: Atomic Promo Redemption RPC
-- Date: 2026-01-31
-- Description: Creates a secure, transactional function to handle promo code redemption,
-- preventing race conditions and bypassing of usage limits.

create or replace function redeem_promo(
  p_code text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer -- Runs with privileges of the creator (postgres) to bypass RLS for admin ops
as $$
declare
  v_promo record;
  v_redemption record;
  v_duration_min int;
  v_expires_at timestamptz;
  v_now timestamptz := now();
  v_remaining_minutes int;
begin
  -- 1. Lock and fetch valid promo code
  -- FOR UPDATE ensures that concurrent requests for the same code wait their turn
  select * into v_promo
  from promo_codes
  where code = p_code
    and active = true
  for update; -- Critical: Locks the row to prevent concurrent limit bypass

  if v_promo is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or inactive promo code');
  end if;

  -- 2. Check Expiration
  if v_promo.valid_until is not null and v_promo.valid_until < v_now then
    return jsonb_build_object('success', false, 'error', 'Promo code expired');
  end if;

  -- 3. Check Global Usage Limits
  if v_promo.used_count >= v_promo.max_uses then
    return jsonb_build_object('success', false, 'error', 'Promo code usage limit reached');
  end if;

  -- 4. Check for Existing Redemption
  select * into v_redemption
  from promo_redemptions
  where promo_code_id = v_promo.id
    and user_id = p_user_id;

  if v_redemption is not null then
    -- User already redeemed. Calculate if it's still active.
    v_duration_min := coalesce(v_promo.duration_minutes, 60); -- Default 60 mins from constants
    v_expires_at := v_redemption.redeemed_at + (v_duration_min || ' minutes')::interval;
    
    if v_now > v_expires_at then
       return jsonb_build_object('success', false, 'error', 'Code already used and expired');
    else
       -- Active reuse
       v_remaining_minutes := ceil(extract(epoch from (v_expires_at - v_now)) / 60);
       return jsonb_build_object(
         'success', true, 
         'message', 'Promo active! You have ' || v_remaining_minutes || ' minutes remaining.',
         'proFeatureMinutes', v_remaining_minutes,
         'is_reuse', true
       );
    end if;
  end if;

  -- 5. Process Redemption (Atomic Insert)
  insert into promo_redemptions (promo_code_id, user_id, redeemed_at)
  values (v_promo.id, p_user_id, v_now);

  -- 6. Increment Usage Count
  update promo_codes
  set used_count = used_count + 1
  where id = v_promo.id;

  -- 7. Apply Upgrade to User Profile
  v_duration_min := coalesce(v_promo.duration_minutes, 60);
  v_expires_at := v_now + (v_duration_min || ' minutes')::interval;

  -- Upsert logic
  insert into user_profiles (id, subscription_status, promo_expires_at)
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
