-- Fix RLS for user_goals to ensure proper access control
-- Previous policy "Users can manage own goals" might have been insufficient or missing variables

drop policy if exists "Users can manage own goals" on "public"."user_goals";
drop policy if exists "Users can view own goals" on "public"."user_goals";
drop policy if exists "Users can insert own goals" on "public"."user_goals";
drop policy if exists "Users can update own goals" on "public"."user_goals";

create policy "Users can view own goals"
  on "public"."user_goals" for select
  using (auth.uid() = user_id);

create policy "Users can insert own goals"
  on "public"."user_goals" for insert
  with check (auth.uid() = user_id);

create policy "Users can update own goals"
  on "public"."user_goals" for update
  using (auth.uid() = user_id);
