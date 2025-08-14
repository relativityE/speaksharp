-- Add columns to store transcripts for comparison
alter table public.sessions
add column browser_transcript text,
add column cloud_transcript text;
