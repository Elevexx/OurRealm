"""Manual upload source — videos uploaded through the existing OurRealm
upload pipeline (/api/videos/upload) and attached to a lesson block."""
from .provider_base import VideoProvider


class ManualUploadProvider(VideoProvider):
    name = "manual_upload"
    display_name = "Manual Upload"
    can_generate = False

    async def health(self):
        return {"ok": True, "detail": "Uses the existing OurRealm upload pipeline"}
