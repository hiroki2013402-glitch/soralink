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

-- Live messages (Realtime Broadcast on private topics "dm:user:<userId>").
-- A user may join and send to a topic only when they share a conversation with that user.
-- The check runs as a security definer function so it can read dm_members past the RLS above.
create or replace function public.dm_shares_conversation(a text, b text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dm_members x
    join public.dm_members y on y.conversation_id = x.conversation_id
    where x.user_id = a and y.user_id = b
  );
$$;

revoke all on function public.dm_shares_conversation(text, text) from public, anon;
grant execute on function public.dm_shares_conversation(text, text) to authenticated;

drop policy if exists "dm_broadcast_select" on realtime.messages;
create policy "dm_broadcast_select" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and starts_with(realtime.topic(), 'dm:user:')
    and (
      substr(realtime.topic(), 9) = (auth.jwt() ->> 'sub')
      or public.dm_shares_conversation(auth.jwt() ->> 'sub', substr(realtime.topic(), 9))
    )
  );

drop policy if exists "dm_broadcast_insert" on realtime.messages;
create policy "dm_broadcast_insert" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and starts_with(realtime.topic(), 'dm:user:')
    and (
      substr(realtime.topic(), 9) = (auth.jwt() ->> 'sub')
      or public.dm_shares_conversation(auth.jwt() ->> 'sub', substr(realtime.topic(), 9))
    )
  );

-- Group chats: roles (owner, sub_admin, member), group name description and icon.
alter table public.dm_members add column if not exists role text not null default 'member';
do $$
begin
  alter table public.dm_members add constraint dm_members_role_check check (role in ('owner', 'sub_admin', 'member'));
exception when duplicate_object then null;
end $$;

alter table public.dm_conversations add column if not exists description text;
alter table public.dm_conversations add column if not exists icon_path text;
do $$
begin
  alter table public.dm_conversations add constraint dm_description_length check (description is null or char_length(description) <= 200);
exception when duplicate_object then null;
end $$;

-- Existing group chats: the creator becomes owner while still a member.
update public.dm_members m set role = 'owner'
from public.dm_conversations c
where c.id = m.conversation_id and c.is_group and c.created_by = m.user_id and m.role = 'member'
  and not exists (select 1 from public.dm_members o where o.conversation_id = m.conversation_id and o.role = 'owner');

-- Groups whose creator has left: the longest-standing member becomes owner.
update public.dm_members m set role = 'owner'
from (
  select distinct on (conversation_id) conversation_id, user_id
  from public.dm_members
  where conversation_id in (select id from public.dm_conversations where is_group)
    and conversation_id not in (select conversation_id from public.dm_members where role = 'owner')
  order by conversation_id, joined_at
) first
where m.conversation_id = first.conversation_id and m.user_id = first.user_id;

-- At most one owner per group.
create unique index if not exists dm_members_one_owner on public.dm_members (conversation_id) where role = 'owner';

-- Replies, edits and reactions. Safe to re-run.
-- reply_to points at the message being replied to (cleared if that message is unsent); edited_at is set when a text message is edited.
alter table public.dm_messages add column if not exists reply_to uuid references public.dm_messages(id) on delete set null;
alter table public.dm_messages add column if not exists edited_at timestamptz;

-- One row per (message, user, emoji). Removed with the message. Only the server (service role) reads and writes it.
create table if not exists public.dm_reactions (
  message_id uuid not null references public.dm_messages(id) on delete cascade,
  user_id text not null,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.dm_reactions enable row level security;
revoke all on public.dm_reactions from anon, authenticated;
