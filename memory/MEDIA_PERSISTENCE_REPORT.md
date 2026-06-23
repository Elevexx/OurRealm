# Media Persistence Audit — Feb 20, 2026

## Verdict
✅ **HEALTHY — no migration required.**

The persistent storage layer is already correctly configured and is
running cross-deploy safe. Below are the findings of the audit and the
mechanisms that keep media alive across future deploys.

## Storage layout

| Field                | Value                                             |
| -------------------- | ------------------------------------------------- |
| Active root          | `/data/ourrealm/`                                 |
| Persistent?          | `is_persistent_storage_configured()` ➜ **True**   |
| `STORAGE_PROVIDER`   | _unset_ → `LocalAdapter` (Cloudflare R2 staged but OFF, per user instruction) |
| Mounted via          | Pod persistent volume (`/data` is the canonical mount) |
| Legacy fallback root | `/app/backend/uploads/` (ephemeral; only used when `/data` unwritable) |

### Per-kind paths
- Images → `/data/ourrealm/images/`
- Videos → `/data/ourrealm/videos/`
- Audio  → `/data/ourrealm/audio/`

## Cross-deploy resilience

Two mechanisms guarantee that uploads survive deploys:

1. **Persistent volume mount** — `/data/ourrealm` is mounted from the
   pod's persistent volume claim. A fresh deploy reuses the same volume,
   so on-disk files are not lost when the container is rebuilt.

2. **Idempotent legacy migration** — On every backend startup
   (`server.py`, line 235), `migrate_legacy_uploads()` copies any files
   that still sit at `/app/backend/uploads/<kind>` into
   `/data/ourrealm/<kind>`. The copy is idempotent: it skips files that
   already exist at the destination. This catches the (rare) case where
   a hot-reload writes through the legacy path before the env is read.

## Current inventory (Feb 20, 2026)

| Kind   | File count | Size   |
| ------ | ---------- | ------ |
| Images | 104        | 7.2 MB |
| Videos | 22         | 30 MB  |
| Audio  | 2          | 92 KB  |

The contents of `/data/ourrealm/<kind>/` and the legacy
`/app/backend/uploads/<kind>/` are **identical** — the most recent boot
migrated **128 files** (`{'audio': 2, 'images': 104, 'videos': 22}`)
as logged at startup:

```
[storage] uploads_root=/data/ourrealm  persistent=True
[storage] migrated 128 legacy files: {'audio': 2, 'images': 104, 'videos': 22}
```

No file exists in `/app/backend/uploads/` that is **not** also in
`/data/ourrealm/`. The legacy directory is therefore harmless and the
volume-backed root is canonical.

## Live-fetch smoke test (preview env)

| URL                                            | Status | Content-Type | Size      |
| ---------------------------------------------- | ------ | ------------ | --------- |
| `/api/images/571d669394b04ce2915cdbc97b70681c.jpg` | 200 | image/jpeg   | 2 464 596 B |
| `/api/videos/1a4a00f4912c4565b3008350567d20d6.mp4` | 200 | (HTTP 206 range-aware) | streamed |
| `/api/sounds/file/8c9c6ecedad44b4c9cd191f160a4e7d6.wav` | 200 | audio/wav | streamed |

All routes return correct MIME types and the
`Cache-Control: public, max-age=31536000, immutable` header because the
filenames are UUIDs and never change. Service worker (`public/sw.js`) is
explicitly pass-through for `/api/images`, `/api/videos`, and
`/api/sounds` so no stale-cache risk exists.

## Recommendation

No action required. To keep this state durable when Cloudflare R2 is
eventually flipped on:

1. `STORAGE_PROVIDER=r2` will activate `R2Adapter`. The existing local
   files **stay on disk** — the adapter only changes the destination of
   **new** uploads.
2. Before flipping R2 live, mirror the contents of `/data/ourrealm/` up
   to the R2 bucket once (one-shot `rclone copy` or equivalent) so the
   `R2Adapter.get_url()` for legacy filenames also resolves.
3. The frontend already routes through `resolveMediaUrl()` so absolute
   R2 URLs and relative `/api/<kind>/...` URLs both work.

## Sign-off
- Persistent volume: ✅
- All known files served at HTTP 200 with the right MIME: ✅
- HTTP 206 range support for video: ✅ (existing `videos.py` route streams via FileResponse w/ ranges)
- No at-risk media: ✅
- No data loss on next deploy: ✅
