# URGENT — PRODUCTION OUTAGE: /api origin routing broken on ourrealm.social

**To:** support@emergent.sh
**Subject:** [URGENT — PRODUCTION OUTAGE] All /api routes return Cloudflare 520 on ourrealm.social while frontend serves normally

## Environment
- Custom domain: https://ourrealm.social (Cloudflare-proxied via Entri)
- Emergent live host: https://realm-deploy.emergent.host (origin: realm-deploy.cluster-7.deploy.emergentcf.cloud)
- Preview (working reference): https://realm-deploy.preview.emergentagent.com
- Deployment ID: <fill from dashboard — Deployments tab>
- App: FastAPI (port 8001) + React + MongoDB

## Symptom (first observed 2026-08-03 ~08:23 UTC)
- GET https://ourrealm.social/ → 200 (frontend fine)
- EVERY /api/* route → Cloudflare **520** in 0.1–0.4s, including unauthenticated:
  - GET /api/ → 520
  - GET /api/health → 520 (instant JSON endpoint, no DB, no auth)
  - GET /api/auth/signup-status → 520
  - POST /api/auth/login → 520
- Same on https://realm-deploy.emergent.host/api/* (also 520)

## Evidence it is NOT the application code
1. Identical code through the preview environment's Cloudflare returns 200 on every route above.
2. Raw-socket capture on localhost:8001: byte-perfect valid HTTP (exact content-length, no duplicate headers, no control chars, valid JSON, 754B headers).
3. Controlled failure fingerprints through the same stack:
   - Backend process STOPPED → Cloudflare returns **502** (not 520)
   - Backend process FROZEN (SIGSTOP) → requests hang ≥45s (not instant 520)
   - Production's instant 520 matches neither → origin-side for /api only.
4. Deployment reported SUCCESS (health check on 127.0.0.1:8001/health passed).
5. Deployment logs show: <paste [startup-step] lines + "OurRealm startup complete">

## Request
Please investigate the production origin routing for /api (ingress/LB between Cloudflare and the backend container on port 8001) for deployment <ID>. Do not seed, migrate, or overwrite the production database. Confirm which deployment the domain is attached to and whether /api traffic is reaching the backend container.

## Timestamps (UTC)
- 08:23–09:45 2026-08-03: continuous 520 on all /api routes (polled every 3s for 60s — 100% failure)
- <fill: redeploy time>
