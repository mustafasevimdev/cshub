-- CsHub base schema for Supabase
-- Run in Supabase Dashboard > SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.users (
    id uuid primary key default gen_random_uuid(),
    nickname text not null unique,
    avatar_url text,
    status text not null default 'offline' check (status in ('online', 'offline', 'busy', 'idle')),
    password_hash text not null,
    created_at timestamptz not null default now(),
    last_seen timestamptz not null default now()
);

create table if not exists public.channels (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    type text not null check (type in ('text', 'voice')),
    created_by uuid references public.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),
    channel_id uuid not null references public.channels(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    content text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.voice_participants (
    id uuid primary key default gen_random_uuid(),
    channel_id uuid not null references public.channels(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    is_muted boolean not null default false,
    is_deafened boolean not null default false,
    is_screen_sharing boolean not null default false,
    joined_at timestamptz not null default now(),
    unique (channel_id, user_id)
);

create table if not exists public.music_queue (
    id uuid primary key default gen_random_uuid(),
    channel_id uuid not null references public.channels(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    youtube_url text not null,
    title text,
    thumbnail text,
    duration text,
    is_playing boolean not null default false,
    is_video boolean not null default false,
    position integer not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_channels_created_at on public.channels (created_at);
create index if not exists idx_messages_channel_created on public.messages (channel_id, created_at);
create index if not exists idx_voice_participants_channel on public.voice_participants (channel_id);
create index if not exists idx_music_queue_channel_position on public.music_queue (channel_id, position);

alter table public.users replica identity full;
alter table public.channels replica identity full;
alter table public.messages replica identity full;
alter table public.voice_participants replica identity full;
alter table public.music_queue replica identity full;

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'channels'
    ) then
        alter publication supabase_realtime add table public.channels;
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'messages'
    ) then
        alter publication supabase_realtime add table public.messages;
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'voice_participants'
    ) then
        alter publication supabase_realtime add table public.voice_participants;
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'music_queue'
    ) then
        alter publication supabase_realtime add table public.music_queue;
    end if;
end
$$;

alter table public.users disable row level security;
alter table public.channels disable row level security;
alter table public.messages disable row level security;
alter table public.voice_participants disable row level security;
alter table public.music_queue disable row level security;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
