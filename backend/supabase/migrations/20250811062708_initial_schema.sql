-- supabase/migrations/20250811062708_initial_schema.sql

-- Create user profiles table
create table user_profiles (
  id uuid references auth.users(id) primary key,
  subscription_status text default 'free',
  subscription_id text,
  stripe_customer_id text,
  usage_minutes integer default 0,
  usage_reset_date timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table user_profiles enable row level security;

-- Policy: Users can only access their own profile
create policy "Users can view own profile" on user_profiles
  for all using (auth.uid() = id);

-- Create sessions table
create table sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) not null,
  title text,
  duration integer,
  total_words integer,
  filler_words jsonb default '{}',
  custom_words jsonb default '{}',
  created_at timestamp with time zone default now()
);

alter table sessions enable row level security;

create policy "Users can manage own sessions" on sessions
  for all using ((select auth.uid()) = user_id);
