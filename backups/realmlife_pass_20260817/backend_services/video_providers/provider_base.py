"""Provider-agnostic video generation interface.

Course Maker / lessons NEVER talk to a concrete provider — only to this
interface via services.video_generation. New providers (Runway, Veo,
Pika, Luma, …) subclass VideoProvider and register in __init__.py.
"""


class VideoProvider:
    name = "base"
    display_name = "Video Provider"
    can_generate = False
    models = []
    supported_seconds = []
    supported_sizes = []

    def estimate_cost(self, model: str, seconds: int, size: str) -> float:
        return 0.0

    def estimate_time_seconds(self, seconds: int) -> int:
        return 0

    async def create_job(self, prompt: str, model: str, seconds: int, size: str) -> str:
        raise NotImplementedError

    async def poll(self, provider_job_id: str) -> dict:
        """Returns {"status": queued|in_progress|completed|failed, "progress": int, "error": str|None}"""
        raise NotImplementedError

    async def fetch_file(self, provider_job_id: str) -> bytes:
        raise NotImplementedError

    async def cleanup(self, provider_job_id: str) -> None:
        return None

    async def health(self) -> dict:
        return {"ok": False, "detail": "Not a generation provider"}
