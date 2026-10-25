-- SoraLink DM schema for Supabase. Run once in the SQL Editor (safe to re-run).
-- Direct messages and notes live here; users, posts and notifications stay in Turso.

create table if not exists public.dm_conversations (
  id uuid primary key,
  is_group boolean not null default false,
  title text,
  created_by text not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint dm_title_length check (title is null or char_length(title) <= 60)
);

create table if not exists public.dm_members (
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  user_id text not null,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists dm_members_user_idx on public.dm_members (user_id);

create table if not exists public.dm_messages (
  id uuid primary key,
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  sender_id text not null,
  image_path text not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_conversation_idx on public.dm_messages (conversation_id, created_at desc);

-- Migration for text messages (safe on databases created by the image-only version).
-- Existing rows have no kind and are images: the default 'image' covers them.
alter table public.dm_messages alter column image_path drop not null;
alter table public.dm_messages alter column mime_type drop not null;
alter table public.dm_messages add column if not exists kind text not null default 'image';
alter table public.dm_messages add column if not exists body text;

do $$
begin
  alter table public.dm_messages add constraint dm_messages_kind_check check (
    (kind = 'text' and body is not null and char_length(body) between 1 and 1000 and image_path is null)
    or (kind = 'image' and image_path is not null and body is null)
  );
exception when duplicate_object then null;
end $$;

-- Conversation list preview: the latest message text (or a placeholder for photos) and who sent it.
alter table public.dm_conversations add column if not exists last_preview text;
alter table public.dm_conversations add column if not exists last_sender_id text;

-- Notes: one short status per user, shown for 24 hours. Only the server (service role) reads and writes this table.
create table if not exists public.dm_notes (
  user_id text primary key,
  body text not null check (char_length(body) between 1 and 60),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists dm_notes_expires_idx on public.dm_notes (expires_at);

-- Row Level Security. The server uses the service role (bypasses RLS).
-- Browsers use a short-lived JWT whose `sub` is the SoraLink user id, so they only see their own rows.
alter table public.dm_conversations enable row level security;
alter table public.dm_members enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_notes enable row level security;

revoke all on public.dm_conversations, public.dm_members, public.dm_messages, public.dm_notes from anon;
revoke all on public.dm_notes from authenticated;

drop policy if exists "dm_members_select_own" on public.dm_members;
create policy "dm_members_select_own" on public.dm_members
  for select to authenticated
  using (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists "dm_conversations_select_member" on public.dm_conversations;
create policy "dm_conversations_select_member" on public.dm_conversations
  for select to authenticated
  using (exists (
    select 1 from public.dm_members m
    where m.conversation_id = dm_conversations.id and m.user_id = (auth.jwt() ->> 'sub')
  ));

drop policy if exists "dm_messages_select_member" on public.dm_messages;
create policy "dm_messages_select_member" on public.dm_messages
  for select to authenticated
  using (exists (
    select 1 from public.dm_members m
    where m.conversation_id = dm_messages.conversation_id and m.user_id = (auth.jwt() ->> 'sub')
  ));

-- Realtime: broadcast INSERTs on these tables (RLS above filters what each browser receives).
do $$
begin
  alter publication supabase_realtime add table public.dm_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.dm_members;
exception when duplicate_object then null;
end $$;

-- Private bucket for DM images.
insert into storage.buckets (id, name, public)
values ('dm-images', 'dm-images', false)
on conflict (id) do nothing;

-- Unread counts per conversation for one user (called by the server).
create or replace function public.dm_unread_counts(uid text)
returns table (conv_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.conversation_id, count(msg.id)
  from public.dm_members m
  join public.dm_messages msg
    on msg.conversation_id = m.conversation_id
   and msg.created_at > m.last_read_at
   and msg.sender_id <> uid
  where m.user_id = uid
  group by m.conversation_id;
$$;

revoke all on function public.dm_unread_counts(text) from public, anon, authenticated;
