-- supabase/migrations/20251206000000_user_goals.sql
--
-- Creates the user_goals table for storing personalized practice targets.
-- Currently, goals are stored client-side in localStorage. This table
-- enables server-side persistence for cross-device sync.

-- Create user_goals table
create table user_goals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  weekly_goal integer not null default 5 check (weekly_goal >= 1 and weekly_goal <= 20),
  clarity_goal integer not null default 90 check (clarity_goal >= 50 and clarity_goal <= 100),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create index for faster lookups by user
create index idx_user_goals_user_id on user_goals(user_id);

-- Enable Row Level Security
alter table user_goals enable row level security;

-- RLS Policy: Users can only manage their own goals
create policy "Users can manage own goals" 
  on user_goals
  for all 
  using (auth.uid() = user_id);

-- Trigger to auto-update updated_at timestamp
create or replace function update_user_goals_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger user_goals_updated_at
  before update on user_goals
  for each row
  execute function update_user_goals_updated_at();

-- Add comments for documentation
comment on table user_goals is 'Stores user practice goals (weekly sessions, clarity target)';
comment on column user_goals.weekly_goal is 'Target number of practice sessions per week (1-20)';
comment on column user_goals.clarity_goal is 'Target clarity score percentage (50-100)';
