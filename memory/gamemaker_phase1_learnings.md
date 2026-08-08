# Game Maker Phase 1 — Learnings & Gotchas (Aug 2026)

## Sparse unique index + explicit None (CRITICAL bug pattern)
MongoDB *sparse* unique indexes DO index documents whose field value is
explicitly `null`. Inserting `{"idem_key": None}` twice throws DuplicateKeyError.
Fix: OMIT the field entirely when no idempotency key is provided.
Applied in services/job_engine.py (gm_jobs) and services/resources.py
(resource_ledger). Never re-introduce `"idem_key": None` into insert docs.

## Existing production seed mechanism (REUSE, don't rebuild)
`services/game_promotion.py` + `backend/seed_bundles/*.json` (28 bundles)
idempotently import published games at startup in ANY environment.
Production /games was empty because the current prod deploy predates these.
Redeploy → startup_import fills prod. `routers/gamemaker.py` also has a
founder migration tool: GET /api/admin/gamemaker/migration/report (dry run)
+ POST /migration/apply (insert-only) + /migration/rollback, reading
backend/data/games_migration_bundle.json (regenerate with
scripts/build_migration_bundle.py).

## Legacy identifiers intentionally kept (documented per founder mandate)
- Collections: orai_projects, orai_assets, games, game_urls, fire_* (unchanged)
- Services: game_studio.py (build pipeline), llm_router.py, game_promotion.py
- Public name is "OurRealm Game Maker"; internal orai_*/OPC identifiers remain.
- OPC page (OraiProjects.jsx) now routes at /admin/gamemaker/studio;
  /admin/orai = ORAi dashboard (AdminOrion.jsx); old deep links redirect in App.js.

## Job engine usage
services/job_engine.py — register runner with @job_engine.register("kind"),
submit() returns job doc instantly; poll GET /api/jobs/{id}. Runners must call
job_engine.phase() to heartbeat (also raises JobCancelled on cancel request).
Startup: ensure_indexes() + reap_stale() in server.py _safe_startup.
Job kinds registered: gamemaker_create, gamemaker_publish, orai_edit, gm_test_delay.

## Resources
fire + keys are ADAPTERS (read-only views of fire_wallets / fire_keys) —
never grant them through resource ledger. stars/coins/gems are native.
grant() is the only write path; reversals are compensating entries.
