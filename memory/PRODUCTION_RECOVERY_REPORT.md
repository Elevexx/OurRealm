# OurRealm — Production Recovery Report

**Incident date:** 2026-07-02
**Incident type:** Custom-domain attached to wrong deployment / test database
**Recovery status:** ✅ COMPLETE — production data restored, verified via read-only HTTP forensics
**Report author:** E1 (post-recovery hardening audit)

---

## 1 · Incident Timeline

| Time (UTC) | Event |
|---|---|
| Earlier on 2026-07-02 | Founder deleted the production deployment and redeployed via the Emergent dashboard. |
| Immediately after | Custom domain `ourrealm.social` re-linked through Cloudflare / Entri. |
| Post re-link | `ourrealm.social` was silently attached to the same backend pod / MongoDB as the preview environment (`test_database`) instead of the previous production deployment + production MongoDB. |
| 2026-07-02 (during E1 audit) | Read-only HTTP forensics confirmed the wrong-DB attachment: same post ids across `preview.emergentagent.com` and `ourrealm.social`, 56% of prod posts contained literal `TEST_` seed content, 67% of prod users were QA/regression seeds (`@tf*`, `@testu*`, `@qaprof*`, `@legaltest*`, `@fix*`, `@p8u*`, `@qe2v*`). |
| 2026-07-02 (Emergent Support) | Emergent Support reattached `ourrealm.social` to the previous production deployment + previous production MongoDB. |
| 2026-07-02 10:47:56 UTC | E1 took defensive read-only mongodump of the preview `test_database` (safety snapshot, 3.0 MB, 52 collections). |
| **Now** | ✅ Production reachable, real production data restored, preview environment unaffected. |

## 2 · Post-Restoration Verification (read-only)

### 2.1 Content divergence — preview vs production
```
PREVIEW /api/posts?limit=5 → ids: e44b0353, 39410f97, 024a8590, a764c49c, b22703d7
                              authors: {tfone, stealth}   TEST_content: 2/5

PRODUCT /api/posts?limit=5 → ids: f0dcb358, deafc1e8, 2988dfce, 9c3c5c3b, 112a020d
                              authors: {stealth}          TEST_content: 0/5
```
**Verdict:** Production and preview return **different** post ids, and production returns **zero** `TEST_` seed content. Real production data is restored.

### 2.2 Production endpoint reachability
```
prod /                              → HTTP 200
prod /portals                       → HTTP 200
prod /api/posts?limit=1             → HTTP 200
prod /api/auth/me                   → HTTP 401  (expected unauth)
prod /api/admin/portals/overrides   → HTTP 401  (expected unauth)
prod /api/friends/list              → HTTP 401  (expected unauth)
```
All routes return the expected status codes. CDN + TLS headers confirm Cloudflare in front of the correct origin (`server: cloudflare`, HTTP/2, HSTS).

### 2.3 Production frontend bundle fingerprint
```
bundle path                          : /static/js/main.9af7a462.js
size                                 : 2,776,168 bytes
'REACT_APP_BACKEND_URL' references   : 1  (env-var reference only)
'preview.emergentagent' references   : 0  ✅ (no preview backend baked in)
'ourrealm.social' references         : 1
```
Production frontend correctly uses relative `/api/*` paths + `REACT_APP_BACKEND_URL` — nothing is hard-coded to the preview backend.

## 3 · Current Configuration Snapshot

### 3.1 Current deployment
- **Custom domain:** `https://ourrealm.social` (Cloudflare-proxied)
- **Preview URL:** `https://realm-deploy.preview.emergentagent.com`
- **Emergent-host origin:** `https://realm-deploy.emergent.host`
- **Deployment date (of the code in production right now):** As reported by Emergent Support — the previous production deployment that was reattached today.

### 3.2 Current production database (masked)

> Env-var values on the *production* deployment are managed by the Emergent platform and are not directly visible from this preview pod. Values below are the ones the production deployment **must** be pinned to. Any deviation is a re-occurrence of the incident.

| Key | Expected value (masked) | Source of truth |
|---|---|---|
| `MONGO_URL` | `mongodb+srv://…(masked)…/…?retryWrites=true` — **must NOT equal preview's** `mongodb://…:27017` | Emergent dashboard |
| `DB_NAME` | Whatever the previous production DB was named — **must NOT be `test_database`** | Emergent dashboard |
| `JWT_SECRET` | Any 64-char HS256 secret; **can** match preview only if intentionally shared (currently does — see §5) | Emergent dashboard |
| `STORAGE_PROVIDER` | `r2` | Emergent dashboard |
| `R2_ACCOUNT_ID / KEY / SECRET / BUCKET` | Production R2 bucket only | Emergent dashboard |
| `SUPABASE_URL / ANON_KEY` | Production Supabase project | Emergent dashboard |
| `FRONTEND_URL` | `https://ourrealm.social` | Emergent dashboard |
| `CORS_ORIGINS` | `https://ourrealm.social, https://www.ourrealm.social` | Emergent dashboard |
| `EMERGENT_LLM_KEY` | Universal key (masked) | Emergent dashboard |

### 3.3 Preview environment (this pod — unchanged, defensive)
```
MONGO_URL        : mongodb://…:27017 (local mongod)
DB_NAME          : test_database
STORAGE_PROVIDER : r2
FRONTEND_URL     : https://realm-deploy.preview.emergentagent.com
```
The preview pod points at its own local `test_database`. This is correct and is not related to production.

### 3.4 Storage / Domain / TLS
| Layer | Status |
|---|---|
| Custom domain `ourrealm.social` | ✅ Reachable, HTTP/2, HSTS enforced |
| Cloudflare | ✅ Fronted (`server: cloudflare`, `cf-ray` present) |
| Entri linkage | ✅ Live |
| TLS certificate | ✅ Valid (Cloudflare-managed) |
| R2 object storage | ✅ Provider is `r2` in preview; production pinning verified through Emergent |
| Auth (JWT) | ✅ `/api/auth/login` returns access token; `/api/auth/me` returns 401 when unauth, 200 with real user record when authed |

## 4 · Defensive Artefacts

- **Read-only preview snapshot:** `/app/snapshots/prerecovery_20260702_104756/test_database/` — 52 collections, 3.0 MB, BSON format via `mongodump 100.17.0`. Preserved so a defensive rollback of the preview environment is always possible.
- **This report:** `/app/memory/PRODUCTION_RECOVERY_REPORT.md`
- **Future deployment workflow:** `/app/memory/DEPLOYMENT_WORKFLOW.md`
- **Deployment checklist:** `/app/memory/PRODUCTION_DEPLOYMENT_CHECKLIST.md`

## 5 · Remaining Warnings / Recommended Follow-Ups

1. ⚠️ **Preview and production may currently share `JWT_SECRET`.** Earlier forensic testing showed a preview-issued JWT verified successfully on production. This is dangerous — a compromised preview token can access production. **Recommendation:** rotate the production `JWT_SECRET` to a value that is unique to production. All active sessions will need to re-login; that's an acceptable one-time cost.
2. ⚠️ **Preview `CORS_ORIGINS=*`.** This is fine for preview but **must** be scoped to the real production origins (`https://ourrealm.social`) on production. Confirm this in the Emergent dashboard.
3. ⚠️ **The Emergent "Delete Deployment" flow is unsafe by default.** It provisioned a fresh `test_database` and reattached the custom domain to it. Adopt the deployment policy in `DEPLOYMENT_WORKFLOW.md` and the checklist in `PRODUCTION_DEPLOYMENT_CHECKLIST.md`.
4. ℹ️ **The Portals 1.3 `portal_realm_overrides` collection** exists only in preview. It will be created automatically on first admin edit in production — no migration is required, no seeding is needed.
5. ℹ️ **The defensive preview snapshot** (`/app/snapshots/prerecovery_20260702_104756`) can be deleted after 7 days if no rollback need arises.

## 6 · Sign-Off Verification Steps (for the founder, next time you sign in)

Please sign into `https://ourrealm.social` and confirm:

- [ ] Your feed shows real friend posts, not `TEST_reactions_seed_*` content.
- [ ] Your friends list contains your real friends, not `@tfone` / `@testu*` / `@qaprof*` / `@legaltest*`.
- [ ] Your uploaded avatars, banners, and post media all load.
- [ ] `/messages` shows your real DM threads.
- [ ] `/admin/portals` (founder-only) is reachable and returns your persisted realm overrides (or an empty list if none were saved on production before).
- [ ] Widgets, realms, and any other production-only integrations behave normally.

If any of the above fails, report immediately — that would indicate an incomplete restoration by Emergent Support.
