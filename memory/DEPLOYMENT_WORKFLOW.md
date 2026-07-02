# OurRealm — Deployment Workflow & Rollback Policy

> **This document is the single source of truth for deploying OurRealm to production.**
> It exists because on 2026-07-02 a "Delete + Redeploy" wiped the production deployment's
> database attachment, silently pointing `ourrealm.social` at a freshly-provisioned
> `test_database`. That must never happen again.

---

## 1 · Golden Rules (non-negotiable)

1. **NEVER use "Delete Deployment" on production unless you are intentionally
   creating a brand-new environment from scratch.** Deleting a deployment
   detaches its MongoDB and R2 attachments. On the next deploy, a fresh
   `test_database` and empty R2 bucket may be silently provisioned.
2. **Always use "Replace Deployment" (or "Update Deployment") for production
   updates.** This preserves the existing MongoDB URL, DB_NAME, JWT_SECRET,
   R2 credentials, Supabase project, and custom-domain attachment.
3. **Never manually change `MONGO_URL` or `DB_NAME` on the production
   deployment** unless intentionally migrating to a new database — and in
   that case, migrate the data first.
4. **Always verify the deployment attachment BEFORE clicking "Deploy" on
   production.** If the dashboard shows a new/empty database will be
   provisioned, ABORT and open a support ticket.
5. **Always take a MongoDB snapshot before any deploy that touches migrations,
   schema, or seed scripts.** Even non-destructive deploys occasionally
   surface data corruption; a snapshot is cheap insurance.

## 2 · Correct Deployment Workflow (safe path)

### 2.1 Pre-flight
1. Confirm all preview smoke tests pass (see `PRODUCTION_DEPLOYMENT_CHECKLIST.md`).
2. Take a read-only snapshot of the preview environment as a sanity backup:
   ```bash
   mongodump --uri="$PREV_MONGO_URL" --db="$PREV_DB_NAME" --out=/app/snapshots/predeploy_$(date +%Y%m%d_%H%M%S)/
   ```
3. Confirm the preview `.env` values are correct — the deploy will *not*
   promote preview env-vars to production (production has its own set),
   but if preview is misconfigured it's a signal to slow down.

### 2.2 Deploy (Replace flow)
1. Open the Emergent dashboard → your app → **Deployments** tab.
2. Click **"Replace Deployment"** (NOT "Delete" or "New").
3. **Verify the "Attached MongoDB" panel shows your existing production database name**
   — the same value it has been showing since your last successful deploy. If it
   shows anything different, or "No database attached", or "A new database will
   be provisioned" — **ABORT** and email `support@emergent.sh` before proceeding.
4. Verify the "Attached R2 Bucket" shows your existing production bucket.
5. Verify the "Attached Supabase Project" shows your existing production
   Supabase URL.
6. Verify the "Custom Domain" panel shows `ourrealm.social` still attached.
7. Confirm and start the deploy.

### 2.3 Post-deploy
1. Wait for the deploy to finish + a 60-second cooldown.
2. Run the fingerprint check (see §3) — confirms production data is intact.
3. Sign in on `ourrealm.social` and manually verify:
   - Your real feed loads
   - Your friends list is intact
   - Your uploads render
   - Admin routes still work
4. If ANY of the above fail — **rollback immediately** (see §4).

## 3 · Fingerprint Check (post-deploy safety probe)

Run this from any shell. It requires no auth (uses the public posts endpoint)
and takes < 10 seconds:

```bash
API_PROD="https://ourrealm.social"
API_PREV="https://realm-deploy.preview.emergentagent.com"
python3 - <<'PY'
import requests
prev = requests.get("https://realm-deploy.preview.emergentagent.com/api/posts?limit=5").json().get("posts",[])
prod = requests.get("https://ourrealm.social/api/posts?limit=5").json().get("posts",[])
same = [p['id'] for p in prev] == [p['id'] for p in prod]
prod_test = sum(1 for p in prod if "TEST_" in (p.get("content") or ""))
print(f"same ids?    {same}       (expect: False)")
print(f"prod TEST_?  {prod_test}/5     (expect: 0)")
print(f"VERDICT: {'❌ WRONG DB ATTACHED — ROLLBACK NOW' if same or prod_test>=2 else '✅ production data intact'}")
PY
```

**Expected result** on a healthy deploy:
```
same ids?    False
prod TEST_?  0/5
VERDICT: ✅ production data intact
```

If you see `same ids? True` or `prod TEST_? >= 2/5`, ABORT and rollback.

## 4 · Rollback Procedure

### 4.1 Fastest safe rollback
1. Emergent dashboard → **Deployments** tab → previous deployment revision → **Restore**.
2. This reattaches the previous MongoDB and custom-domain routing.
3. Wait 60 seconds, re-run the fingerprint check in §3.

### 4.2 If Emergent Support intervention is required
Email `support@emergent.sh` with:

- Subject: `[URGENT — PRODUCTION OUTAGE] ourrealm.social attached to wrong DB after redeploy`
- Job ID
- Timeline (delete → redeploy → domain re-link)
- The fingerprint output from §3
- Explicit request: "Do not seed, migrate, or overwrite any database. Reattach `ourrealm.social` to my previous production deployment + previous production MongoDB. Confirm from your dashboard which deployment ID is currently attached vs which was attached before, and which MongoDB each is bound to."

### 4.3 If the previous production DB was destroyed
Ask Emergent Support:
1. Whether an automatic snapshot was taken before deletion (retention window
   varies by plan).
2. Whether the R2 bucket + Supabase project were also detached (they usually
   survive deployment deletion).
3. For the exact restoration steps that guarantee the domain re-attaches to
   the recovered database, not a fresh one.

## 5 · Environment Variable Handling

- Production env-vars live in the Emergent dashboard, **not** in the codebase.
- Never commit `.env` files that contain production secrets. Preview `.env`
  is deliberately different from production `.env` (different MONGO_URL,
  different DB_NAME, different JWT_SECRET recommended).
- Rotate `JWT_SECRET` on production **only** during scheduled maintenance —
  all active user sessions will be invalidated.
- If you must rotate a secret urgently (leak, compromise), do it via the
  Emergent dashboard and confirm afterwards that the new deployment restarted
  cleanly.

## 6 · Approved vs Forbidden Actions

| Action | On Preview | On Production |
|---|---|---|
| Push code changes | ✅ | ✅ via "Replace Deployment" only |
| Change `MONGO_URL` / `DB_NAME` | ✅ | ❌ Never (except intentional migration) |
| Change `JWT_SECRET` | ✅ | ⚠️ Only during scheduled maintenance |
| Run `mongodump` (read-only backup) | ✅ | ✅ (via Emergent-provided read replica if available) |
| Run `mongorestore` | ✅ | ❌ Never without a support ticket + human review |
| "Delete Deployment" | ⚠️ Only if intentional | ❌ Never on production |
| Seed scripts | ✅ | ❌ Never on production |
| Destructive migrations | ⚠️ With snapshot | ❌ Requires support ticket + approval |
| Manually attach a different DB | ⚠️ Rare | ❌ Never — always via dashboard flow |
| Modify Cloudflare / Entri DNS | ⚠️ Backup first | ⚠️ Backup first + use Entri auto-linking, not manual A records |

## 7 · Incident-Response Contact

- Primary: `support@emergent.sh`
- Priority label to use for production outages: `[URGENT — PRODUCTION OUTAGE]`
- Always include: job ID, timeline, fingerprint output, and explicit "do not seed" instruction.
