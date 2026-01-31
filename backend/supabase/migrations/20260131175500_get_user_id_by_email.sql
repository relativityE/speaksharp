-- Migration: Get User ID by Email RPC
-- Date: 2026-01-31
-- Description: Helper RPC to efficiently look up auth.users.id by email.
-- Solves O(N) scalability issue in calling client-side listUsers().

create or replace function get_user_id_by_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = '' -- Best practice for security definer functions
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from auth.users
  where email = p_email;
  
  return v_id;
end;
$$;
