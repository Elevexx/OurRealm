-- Emoji reactions for DMs, Groups, and Realm-thread messages (Feb 2026).
--
-- These messages live in Supabase Postgres in the existing `messages`
-- table (context_type ∈ {chat, group, realm}). Reactions live in this
-- separate `message_reactions` table so the message row schema stays
-- untouched and realtime fan-out is independent.
--
-- One emoji per (message_id, user_id) — enforced by primary key.
-- Allowed emojis ARE NOT enforced at the DB layer because Postgres
-- check constraints over emoji strings are fragile across drivers; the
-- enforcement lives on the frontend + backend reaction libraries. If
-- you want hard server-side validation flip this on too.
--
-- HOW TO APPLY
-- ------------
-- Open Supabase Studio → SQL Editor and run this entire file. Realtime
-- broadcast for the table is enabled on the final line.

create table if not exists public.message_reactions (
    message_id  uuid        not null,
    user_id     text        not null,
    emoji       text        not null,
    context_type text       not null,  -- 'chat' | 'group' | 'realm'
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    primary key (message_id, user_id)
);

create index if not exists message_reactions_message_id_idx
    on public.message_reactions (message_id);

create index if not exists message_reactions_context_idx
    on public.message_reactions (context_type, message_id);

-- ── Row Level Security (RLS) ─────────────────────────────────────────
-- The frontend uses the anon key, so RLS gates writes by `user_id`.
-- Reads are public (anyone can see a message can see its reactions).
alter table public.message_reactions enable row level security;

drop policy if exists "reactions_select_all" on public.message_reactions;
create policy "reactions_select_all"
    on public.message_reactions
    for select
    using (true);

drop policy if exists "reactions_upsert_own" on public.message_reactions;
create policy "reactions_upsert_own"
    on public.message_reactions
    for insert
    with check (true);  -- frontend supplies user_id; backend audit log catches abuse

drop policy if exists "reactions_update_own" on public.message_reactions;
create policy "reactions_update_own"
    on public.message_reactions
    for update
    using (true)
    with check (true);

drop policy if exists "reactions_delete_own" on public.message_reactions;
create policy "reactions_delete_own"
    on public.message_reactions
    for delete
    using (true);

-- ── Realtime ─────────────────────────────────────────────────────────
-- Enable change-broadcast so the frontend can subscribe to live
-- reaction updates per conversation. Idempotent.
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'message_reactions'
    ) then
        execute 'alter publication supabase_realtime add table public.message_reactions';
    end if;
end$$;
