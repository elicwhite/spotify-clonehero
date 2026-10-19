-- Create table to store Spotify OAuth tokens per user
create table if not exists public.spotify_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at in sync
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_spotify_tokens_updated_at on public.spotify_tokens;
create trigger set_spotify_tokens_updated_at
before update on public.spotify_tokens
for each row execute function public.set_updated_at();

-- Enable Row Level Security
alter table public.spotify_tokens enable row level security;

-- RLS: users can manage their own row
drop policy if exists "Allow read own tokens" on public.spotify_tokens;
create policy "Allow read own tokens" on public.spotify_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "Allow upsert own tokens" on public.spotify_tokens;
create policy "Allow upsert own tokens" on public.spotify_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


