-- supabase/migrations/20251120004400_custom_vocabulary.sql

-- Create custom_vocabulary table
create table custom_vocabulary (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  word text not null check (length(word) \u003e 0 and length(word) \u003c= 50),
  created_at timestamp with time zone default now(),
  unique(user_id, word)
);

-- Create index for faster lookups by user
create index idx_custom_vocabulary_user_id on custom_vocabulary(user_id);

-- Enable Row Level Security
alter table custom_vocabulary enable row level security;

-- RLS Policy: Users can only manage their own vocabulary
create policy "Users can manage own vocabulary" 
  on custom_vocabulary
  for all 
  using (auth.uid() = user_id);

-- Add comment for documentation
comment on table custom_vocabulary is 'Stores user-defined custom words for improved transcription accuracy';
comment on column custom_vocabulary.word is 'Custom word (max 50 chars, alphanumeric + hyphens/apostrophes)';
