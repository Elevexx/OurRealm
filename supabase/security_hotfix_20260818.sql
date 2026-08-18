-- OurRealm P0 Supabase security hardening
-- IMPORTANT:
-- Deploy backend + frontend identity bridge FIRST.
-- Run this SQL SECOND.
--
-- This migration:
--  * converts message context IDs to TEXT so Mongo Realm IDs work
--  * enables RLS
--  * removes anonymous message/reaction access
--  * prevents sender/reaction user spoofing
--  * secures group join/leave through authenticated RPCs

begin;

-- ------------------------------------------------------------------
-- Realm IDs are 12-char Mongo text IDs, while chat/group IDs are UUID.
-- TEXT safely supports both.
-- ------------------------------------------------------------------
alter table public.messages
  alter column context_id type text
  using context_id::text;

-- Existing trigger must compare UUID chat IDs to TEXT message context IDs.
create or replace function public.bump_chat_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.context_type = 'chat' then
    update public.chats
       set last_message = coalesce(new.text, new.media_url, ''),
           updated_at   = new.created_at
     where id::text = new.context_id;
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------------
-- Central permission helper.
-- Chat/group membership comes from Supabase.
-- Realm membership comes from the server-signed JWT realm_ids claim.
-- ------------------------------------------------------------------
create or replace function public.ourrealm_can_access_context(
  p_context_type text,
  p_context_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_context_type
    when 'chat' then exists (
      select 1
      from public.chats c
      where c.id::text = p_context_id
        and (select auth.uid()) = any(c.participants)
    )

    when 'group' then exists (
      select 1
      from public.groups g
      where g.id::text = p_context_id
        and (select auth.uid()) = any(g.members)
    )

    when 'realm' then coalesce(
      ((select auth.jwt()) -> 'realm_ids') ? p_context_id,
      false
    )

    else false
  end;
$$;

revoke all on function public.ourrealm_can_access_context(text, text)
from public;

grant execute on function public.ourrealm_can_access_context(text, text)
to authenticated;


create or replace function public.ourrealm_can_access_message(
  p_message_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and public.ourrealm_can_access_context(
        m.context_type,
        m.context_id
      )
  );
$$;

revoke all on function public.ourrealm_can_access_message(uuid)
from public;

grant execute on function public.ourrealm_can_access_message(uuid)
to authenticated;


-- ------------------------------------------------------------------
-- Secure group join/leave.
-- The browser can only add/remove ITS OWN authenticated identity.
-- ------------------------------------------------------------------
-- Groups are invite-based.
-- Do NOT expose an authenticated self-join function.
drop function if exists public.ourrealm_join_group(uuid);


create or replace function public.ourrealm_leave_group(
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  g public.groups%rowtype;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  update public.groups
     set members = array_remove(members, me)
   where id = p_group_id
     and me = any(members)
   returning * into g;

  if g.id is null then
    raise exception 'Group not found or not a member';
  end if;

  return to_jsonb(g);
end;
$$;

revoke all on function public.ourrealm_leave_group(uuid)
from public;

grant execute on function public.ourrealm_leave_group(uuid)
to authenticated;


-- ------------------------------------------------------------------
-- Turn on RLS.
-- ------------------------------------------------------------------
alter table public.chats enable row level security;
alter table public.groups enable row level security;
alter table public.realms enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;


-- ------------------------------------------------------------------
-- Remove old / permissive policies.
-- ------------------------------------------------------------------
drop policy if exists chats_select on public.chats;
drop policy if exists chats_insert on public.chats;
drop policy if exists chats_update on public.chats;

drop policy if exists groups_select on public.groups;
drop policy if exists groups_insert on public.groups;
drop policy if exists groups_update on public.groups;

drop policy if exists realms_select on public.realms;
drop policy if exists realms_insert on public.realms;
drop policy if exists realms_update on public.realms;

drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;
drop policy if exists messages_delete on public.messages;

drop policy if exists reactions_select_all on public.message_reactions;
drop policy if exists reactions_upsert_own on public.message_reactions;
drop policy if exists reactions_update_own on public.message_reactions;
drop policy if exists reactions_delete_own on public.message_reactions;

drop policy if exists "reactions_select_all" on public.message_reactions;
drop policy if exists "reactions_upsert_own" on public.message_reactions;
drop policy if exists "reactions_update_own" on public.message_reactions;
drop policy if exists "reactions_delete_own" on public.message_reactions;


-- ------------------------------------------------------------------
-- CHATS
-- ------------------------------------------------------------------
create policy chats_select
on public.chats
for select
to authenticated
using (
  (select auth.uid()) = any(participants)
);

create policy chats_insert
on public.chats
for insert
to authenticated
with check (
  (select auth.uid()) = any(participants)
);


-- ------------------------------------------------------------------
-- GROUPS
-- Membership changes happen only through the secure RPCs above.
-- ------------------------------------------------------------------
create policy groups_select
on public.groups
for select
to authenticated
using (
  (select auth.uid()) = any(members)
);

create policy groups_insert
on public.groups
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (select auth.uid()) = any(members)
);


-- ------------------------------------------------------------------
-- Legacy Supabase realms table.
-- Current OurRealm Realm membership is canonical in Mongo.
-- ------------------------------------------------------------------
create policy realms_select
on public.realms
for select
to authenticated
using (
  (select auth.uid()) = any(members)
);

create policy realms_insert
on public.realms
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (select auth.uid()) = any(members)
);


-- ------------------------------------------------------------------
-- MESSAGES
-- ------------------------------------------------------------------
create policy messages_select
on public.messages
for select
to authenticated
using (
  public.ourrealm_can_access_context(
    context_type,
    context_id
  )
);

create policy messages_insert
on public.messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and public.ourrealm_can_access_context(
    context_type,
    context_id
  )
);

-- Updates are permitted only within a conversation the user can access.
-- Column privileges below restrict browser UPDATE to pinned_at only.
create policy messages_update
on public.messages
for update
to authenticated
using (
  public.ourrealm_can_access_context(
    context_type,
    context_id
  )
)
with check (
  public.ourrealm_can_access_context(
    context_type,
    context_id
  )
);

create policy messages_delete
on public.messages
for delete
to authenticated
using (
  sender_id = (select auth.uid())
  and public.ourrealm_can_access_context(
    context_type,
    context_id
  )
);


-- ------------------------------------------------------------------
-- REACTIONS
-- ------------------------------------------------------------------
create policy reactions_select
on public.message_reactions
for select
to authenticated
using (
  public.ourrealm_can_access_message(message_id)
);

create policy reactions_insert
on public.message_reactions
for insert
to authenticated
with check (
  user_id = (select auth.uid())::text
  and public.ourrealm_can_access_message(message_id)
);

create policy reactions_update
on public.message_reactions
for update
to authenticated
using (
  user_id = (select auth.uid())::text
  and public.ourrealm_can_access_message(message_id)
)
with check (
  user_id = (select auth.uid())::text
  and public.ourrealm_can_access_message(message_id)
);

create policy reactions_delete
on public.message_reactions
for delete
to authenticated
using (
  user_id = (select auth.uid())::text
  and public.ourrealm_can_access_message(message_id)
);


-- ------------------------------------------------------------------
-- Explicit API privileges.
-- Anonymous browser traffic gets NO message access.
-- ------------------------------------------------------------------
revoke all on public.chats from anon;
revoke all on public.groups from anon;
revoke all on public.realms from anon;
revoke all on public.messages from anon;
revoke all on public.message_reactions from anon;

grant select, insert on public.chats to authenticated;
grant select, insert on public.groups to authenticated;
grant select, insert on public.realms to authenticated;

grant select, insert, delete on public.messages to authenticated;

-- Browser message UPDATE is only needed for pinned_at.
revoke update on public.messages from authenticated;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'pinned_at'
  ) then
    execute 'grant update(pinned_at) on public.messages to authenticated';
  end if;
end
$$;

grant select, insert, update, delete
on public.message_reactions
to authenticated;

commit;
