-- ============================================================================
-- OurRealm — Phase 3 Supabase Schema (Chats, Groups, Realms, Messages)
-- ============================================================================
-- HOW TO USE:
--   1. Open your Supabase project → SQL Editor → New query
--   2. Paste this entire file and click "Run"
--   3. Realtime is enabled via supabase_realtime publication at the bottom
--
-- ARCHITECTURE
--   - chats   : 1-to-1 (or small) conversations. participants is uuid[].
--   - groups  : named multi-user threads (members uuid[]).
--   - realms  : same shape as groups, semantically a "community room".
--   - messages: UNIFIED table for all three. Scoped by (context_type, context_id).
--
--   context_type ∈ { 'chat', 'group', 'realm' }
--   context_id   = id of the row in the matching table
--
-- USER IDS
--   OurRealm users live in MongoDB. Their primary id is UUID v4 stored as text.
--   Those values fit directly into Postgres uuid columns. We DO NOT create a
--   Supabase Auth user per OurRealm user in this phase.
--
-- AUTH / RLS
--   Policies are written using auth.uid() for when you later wire Supabase Auth
--   (or mint custom Supabase JWTs server-side). Out of the box, RLS is left
--   DISABLED so anon-key reads/writes succeed during Phase 3. Enable RLS only
--   after wiring auth — see the "ENABLE RLS LATER" block at the bottom.
-- ============================================================================

-- Required for gen_random_uuid()
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. CHATS  (1-to-1 / small group DMs)
-- ----------------------------------------------------------------------------
create table if not exists public.chats (
  id            uuid primary key default gen_random_uuid(),
  participants  uuid[] not null,
  last_message  text,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists chats_participants_gin on public.chats using gin (participants);
create index if not exists chats_updated_at_idx   on public.chats (updated_at desc);

-- ----------------------------------------------------------------------------
-- 2. GROUPS
-- ----------------------------------------------------------------------------
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid,
  members     uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists groups_members_gin on public.groups using gin (members);

-- ----------------------------------------------------------------------------
-- 3. REALMS
-- ----------------------------------------------------------------------------
create table if not exists public.realms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid,
  members     uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists realms_members_gin on public.realms using gin (members);

-- ----------------------------------------------------------------------------
-- 4. MESSAGES (UNIFIED)
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  context_type  text not null check (context_type in ('chat','group','realm')),
  context_id    uuid not null,
  sender_id     uuid not null,
  text          text,
  media_url     text,
  read_by       uuid[] not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists messages_context_idx on public.messages (context_type, context_id, created_at desc);
create index if not exists messages_sender_idx  on public.messages (sender_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. Auto-bump chats.last_message + chats.updated_at on new chat messages
-- ----------------------------------------------------------------------------
create or replace function public.bump_chat_on_message()
returns trigger
language plpgsql
as $$
begin
  if new.context_type = 'chat' then
    update public.chats
       set last_message = coalesce(new.text, new.media_url, ''),
           updated_at   = new.created_at
     where id = new.context_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bump_chat_on_message on public.messages;
create trigger trg_bump_chat_on_message
after insert on public.messages
for each row execute function public.bump_chat_on_message();

-- ----------------------------------------------------------------------------
-- 6. REALTIME — publish only the messages table (cheap subscription scope)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end$$;

alter publication supabase_realtime add table public.messages;

-- ============================================================================
-- ENABLE RLS LATER  (uncomment the block below AFTER you wire Supabase Auth
-- or mint custom JWTs containing the OurRealm user_id in `sub`/`auth.uid()`).
-- ============================================================================
--
-- alter table public.chats    enable row level security;
-- alter table public.groups   enable row level security;
-- alter table public.realms   enable row level security;
-- alter table public.messages enable row level security;
--
-- -- chats: visible to participants
-- create policy chats_select on public.chats
--   for select using (auth.uid() = any(participants));
-- create policy chats_insert on public.chats
--   for insert with check (auth.uid() = any(participants));
-- create policy chats_update on public.chats
--   for update using (auth.uid() = any(participants));
--
-- -- groups: visible to members
-- create policy groups_select on public.groups
--   for select using (auth.uid() = any(members));
-- create policy groups_insert on public.groups
--   for insert with check (auth.uid() = created_by);
-- create policy groups_update on public.groups
--   for update using (auth.uid() = any(members));
--
-- -- realms: visible to members
-- create policy realms_select on public.realms
--   for select using (auth.uid() = any(members));
-- create policy realms_insert on public.realms
--   for insert with check (auth.uid() = created_by);
-- create policy realms_update on public.realms
--   for update using (auth.uid() = any(members));
--
-- -- messages: read if you belong to the context; write only your own messages
-- create policy messages_select on public.messages
--   for select using (
--     case context_type
--       when 'chat'  then exists (select 1 from public.chats  c where c.id = context_id and auth.uid() = any(c.participants))
--       when 'group' then exists (select 1 from public.groups g where g.id = context_id and auth.uid() = any(g.members))
--       when 'realm' then exists (select 1 from public.realms r where r.id = context_id and auth.uid() = any(r.members))
--     end
--   );
-- create policy messages_insert on public.messages
--   for insert with check (
--     auth.uid() = sender_id
--     and case context_type
--       when 'chat'  then exists (select 1 from public.chats  c where c.id = context_id and auth.uid() = any(c.participants))
--       when 'group' then exists (select 1 from public.groups g where g.id = context_id and auth.uid() = any(g.members))
--       when 'realm' then exists (select 1 from public.realms r where r.id = context_id and auth.uid() = any(r.members))
--     end
--   );
-- create policy messages_update on public.messages
--   for update using (auth.uid() = sender_id);
--
-- ============================================================================
-- DONE
-- ============================================================================
