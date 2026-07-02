# OurRealm — Production Deployment Checklist

Run this checklist **before every single production deploy**. Do not skip steps.
This checklist exists because on 2026-07-02 a `Delete + Redeploy` reset the
production database attachment and pointed `ourrealm.social` at a fresh
`test_database`. That must never happen again.

## Pre-flight (~5 minutes)

- [ ] All preview smoke tests pass (feed, login, friends, messages, uploads, admin, portals).
- [ ] Latest `testing_agent_v3_fork` report shows 100% pass or explicitly-accepted deltas.
- [ ] `git status` is clean; the code you want to deploy is the code at HEAD.
- [ ] A read-only snapshot of the **preview** MongoDB has been taken:
      `mongodump --uri="$PREV_MONGO_URL" --db="$PREV_DB_NAME" --out=/app/snapshots/predeploy_YYYYMMDD_HHMMSS/`
- [ ] The last production deploy timestamp is known (dashboard → Deployments).

## Emergent dashboard verification (before clicking Deploy)

- [ ] Deploy flow used is **"Replace Deployment"** (or "Update"). Never
      "Delete + Redeploy" for production updates.
- [ ] Attached MongoDB panel shows the **same production DB_NAME** as before
      — verify the DB name character-for-character.
- [ ] Attached R2 bucket panel shows the **same production R2 bucket** as before.
- [ ] Attached Supabase panel shows the **same production Supabase URL** as before.
- [ ] Custom domain panel shows `ourrealm.social` (and `www.ourrealm.social`
      if applicable) still linked.
- [ ] Environment variables preview shows the production values, not preview
      values (spot-check MONGO_URL, DB_NAME, JWT_SECRET, FRONTEND_URL, CORS_ORIGINS).
- [ ] If ANY of the above is wrong or missing → **ABORT and open a support ticket.**

## During deploy

- [ ] Watch the deployment logs for MongoDB / R2 / Supabase connection lines
      — they must reference the production values, not preview.
- [ ] If you see `test_database` referenced in production logs → **ABORT
      and open a support ticket.**

## Post-deploy verification (~2 minutes)

- [ ] Fingerprint check passes (from `DEPLOYMENT_WORKFLOW.md` §3):

  ```bash
  python3 - <<'PY'
  import requests
  prev = requests.get("https://realm-deploy.preview.emergentagent.com/api/posts?limit=5").json().get("posts",[])
  prod = requests.get("https://ourrealm.social/api/posts?limit=5").json().get("posts",[])
  same = [p['id'] for p in prev] == [p['id'] for p in prod]
  test = sum(1 for p in prod if "TEST_" in (p.get("content") or ""))
  print(f"same ids? {same}   prod TEST_? {test}/5")
  print("VERDICT:", "❌ WRONG DB — ROLLBACK NOW" if same or test>=2 else "✅ production intact")
  PY
  ```
  Expected: `same ids? False   prod TEST_? 0/5   VERDICT: ✅ production intact`.

- [ ] `https://ourrealm.social/portals` returns HTTP 200 and shows the
      Opening Soon page.
- [ ] `https://ourrealm.social/api/auth/me` returns HTTP 401 when
      unauthenticated (proves auth pipeline is alive).
- [ ] Sign in with your own account on `ourrealm.social` and confirm:
      - Real feed loads (no `TEST_` seed content).
      - Real friends list (no `@tfone` / `@testu*` / `@qaprof*` / `@legaltest*`).
      - Uploaded avatars, banners, and post media all render.
      - `/messages` shows real DM threads.
      - `/admin/portals` (founder only) is reachable and shows your persisted
        overrides.

## If ANY check fails

1. **Do not attempt further code changes.** The issue is almost certainly
   platform-side, not code-side.
2. Trigger an immediate rollback from the Emergent dashboard →
   Deployments → previous revision → Restore.
3. If rollback doesn't fix it, email `support@emergent.sh` with subject
   `[URGENT — PRODUCTION OUTAGE]` and include the fingerprint output.

## Sign-off

Deployed by: __________________
Deploy timestamp: __________________
Deploy revision / commit SHA: __________________
Fingerprint check result: ⬜ PASS ⬜ FAIL
Sign-in verification result: ⬜ PASS ⬜ FAIL

Only after both ✅ pass does the deploy count as complete.
