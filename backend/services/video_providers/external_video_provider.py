"""External video URL source — an existing OurRealm media URL or an
https URL pasted by a course manager."""
from .provider_base import VideoProvider


class ExternalVideoProvider(VideoProvider):
    name = "external_url"
    display_name = "External Video URL"
    can_generate = False

    async def health(self):
        return {"ok": True, "detail": "Accepts existing OurRealm or https video URLs"}
