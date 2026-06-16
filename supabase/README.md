# Supabase — OurRealm Phase 3

Unified messaging for **Chats**, **Groups**, and **Realms** runs entirely on Supabase
(Postgres + Realtime). No custom backend server for messaging.

## 1. Create / open a Supabase project

Go to <https://supabase.com/dashboard>, select (or create) your project.

## 2. Run the schema

1. Open **SQL Editor → New query**
2. Paste the entire contents of [`schema.sql`](./schema.sql)
3. Click **Run**

This creates 4 tables — `chats`, `groups`, `realms`, `messages` — adds the right
indexes, enables Realtime on `messages`, and ships an RLS block (commented out)
ready to enable once you wire auth.

## 3. Grab the project credentials

Project Settings → **API**:

| Env var                       | Where it comes from                    |
|------------------------------|----------------------------------------|
| `REACT_APP_SUPABASE_URL`     | "Project URL"                          |
| `REACT_APP_SUPABASE_ANON_KEY`| "anon public" key                      |

Add them to **`/app/frontend/.env`** then restart the frontend:

```
REACT_APP_SUPABASE_URL=https://xxxxxxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Until these are set the Messenger renders a friendly **"Supabase not configured"**
state instead of crashing — the rest of the app keeps working.

## 4. About RLS (Row Level Security)

The policies are written for `auth.uid()` and shipped commented out. We do not
turn them on by default because OurRealm users do not yet sign in to Supabase
Auth — they live in MongoDB with their own JWT. While RLS is disabled the anon
key can read/write, so the app does the membership checks client-side.

When you're ready to enforce it, choose one of:

- **A. Sign users into Supabase Auth in parallel** (simplest). After login on
  our backend, also call `supabase.auth.signInWithPassword(...)` from the
  frontend so `auth.uid()` matches the OurRealm user id.
- **B. Mint a custom Supabase JWT on the FastAPI backend** signed with your
  Supabase project's JWT secret, with `sub = <ourrealm_user_id>`. Pass it to
  the client via `supabase.auth.setSession({ access_token, refresh_token })`.

Then uncomment the `ENABLE RLS LATER` block at the bottom of `schema.sql` and
re-run.

## 5. Verifying

Quick smoke test from the SQL editor:

```sql
insert into public.chats (participants) values
  (array['11111111-1111-1111-1111-111111111111'::uuid,
         '22222222-2222-2222-2222-222222222222'::uuid])
returning *;
```

Then open Messenger in the app, switch to **Chats**, and you'll see the row.
