"""OpenAI Videos API provider (sora-2 / sora-2-pro).

Uses the backend-only OPENAI_API_KEY via raw httpx (same pattern as
chat_conversations.py — the installed openai SDK predates client.videos).
The key is never logged or returned. NOTE: the Sora API is scheduled for
discontinuation — this file is disposable by design; nothing outside the
provider layer references OpenAI.
"""
import logging
import os

import httpx

from .provider_base import VideoProvider

log = logging.getLogger("ourrealm.video.openai")
BASE = "https://api.openai.com/v1"
# USD per generated second, keyed by (model, size)
PRICING = {
    ("sora-2", "1280x720"): 0.10, ("sora-2", "720x1280"): 0.10,
    ("sora-2-pro", "1280x720"): 0.30, ("sora-2-pro", "720x1280"): 0.30,
    ("sora-2-pro", "1792x1024"): 0.50, ("sora-2-pro", "1024x1792"): 0.50,
}


def _headers():
    return {"Authorization": f"Bearer {os.environ.get('OPENAI_API_KEY', '')}"}


class OpenAIVideoProvider(VideoProvider):
    name = "openai"
    display_name = "OpenAI Video"
    can_generate = True
    models = ["sora-2", "sora-2-pro"]
    supported_seconds = [4, 8, 12]
    supported_sizes = ["1280x720", "720x1280", "1792x1024", "1024x1792"]

    def estimate_cost(self, model, seconds, size):
        rate = PRICING.get((model, size))
        if rate is None:
            raise ValueError("Unsupported model/size combination")
        return round(rate * int(seconds), 2)

    def estimate_time_seconds(self, seconds):
        return 60 + int(seconds) * 15

    async def create_job(self, prompt, model, seconds, size):
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(
                f"{BASE}/videos",
                headers=_headers(),
                json={
                    "model": model,
                    "prompt": prompt[:2000],
                    "seconds": str(int(seconds)),
                    "size": size,
                },
            )

        if r.status_code >= 400:
            try:
                detail = (
                    (r.json().get("error") or {}).get("message")
                    or "provider error"
                )[:300]
            except Exception:
                detail = f"HTTP {r.status_code}: {r.text[:300]}"

            raise RuntimeError(
                f"Video provider rejected the job: {detail}"
            )

        return r.json()["id"]

    async def poll(self, provider_job_id):
        try:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.get(
                    f"{BASE}/videos/{provider_job_id}",
                    headers=_headers(),
                )

            # Temporary provider/server/rate-limit problems should not
            # destroy an already-running Sora render.
            if r.status_code == 429 or r.status_code >= 500:
                log.warning(
                    "Sora poll temporary HTTP %s for job %s: %s",
                    r.status_code,
                    provider_job_id,
                    r.text[:300],
                )
                return {
                    "status": "in_progress",
                    "progress": 0,
                    "error": None,
                }

            # Auth/request errors are normally permanent.
            if r.status_code >= 400:
                try:
                    body = r.json()
                    detail = (
                        (body.get("error") or {}).get("message")
                        or f"HTTP {r.status_code}"
                    )
                except Exception:
                    detail = (
                        f"HTTP {r.status_code}: {r.text[:300]}"
                    )

                return {
                    "status": "failed",
                    "progress": 0,
                    "error": f"Sora status check failed: {detail}",
                }

            d = r.json()

            err = None
            if d.get("error"):
                err = (d.get("error") or {}).get("message")

            return {
                "status": d.get("status") or "in_progress",
                "progress": int(d.get("progress") or 0),
                "error": err,
            }

        except (
            httpx.TimeoutException,
            httpx.TransportError,
        ) as exc:
            log.warning(
                "Sora poll temporary network error for job %s: %s",
                provider_job_id,
                exc,
            )

            return {
                "status": "in_progress",
                "progress": 0,
                "error": None,
            }

    async def fetch_file(self, provider_job_id):
        async with httpx.AsyncClient(timeout=300) as c:
            r = await c.get(
                f"{BASE}/videos/{provider_job_id}/content",
                headers=_headers(),
            )

        if r.status_code >= 400:
            try:
                body = r.json()
                detail = (
                    (body.get("error") or {}).get("message")
                    or f"HTTP {r.status_code}"
                )
            except Exception:
                detail = f"HTTP {r.status_code}: {r.text[:300]}"

            raise RuntimeError(
                f"Could not download the finished video: {detail}"
            )

        return r.content

    async def cleanup(self, provider_job_id):
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                await c.delete(
                    f"{BASE}/videos/{provider_job_id}",
                    headers=_headers(),
                )
        except Exception as e:
            log.warning("provider cleanup failed: %s", e)

    async def health(self):
        """
        Free validation probe:
        invalid seconds should fail after model access is checked.
        """
        if not os.environ.get("OPENAI_API_KEY"):
            return {
                "ok": False,
                "detail": "API key not configured",
            }

        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.post(
                    f"{BASE}/videos",
                    headers=_headers(),
                    json={
                        "model": "sora-2",
                        "prompt": "health probe",
                        "seconds": "999",
                    },
                )

            body = (
                r.json().get("error", {})
                if r.status_code >= 400
                else {}
            )

            if (
                r.status_code == 400
                and body.get("param") == "seconds"
            ):
                return {
                    "ok": True,
                    "detail": (
                        "Model access confirmed "
                        "(free validation probe)"
                    ),
                }

            return {
                "ok": False,
                "detail": str(
                    body.get("message")
                    or f"HTTP {r.status_code}"
                )[:200],
            }

        except Exception as e:
            return {
                "ok": False,
                "detail": (
                    f"Connectivity error: "
                    f"{type(e).__name__}"
                ),
            }