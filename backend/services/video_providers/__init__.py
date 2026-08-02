from .provider_base import VideoProvider
from .openai_provider import OpenAIVideoProvider
from .manual_upload_provider import ManualUploadProvider
from .external_video_provider import ExternalVideoProvider

PROVIDERS = {p.name: p for p in (
    OpenAIVideoProvider(), ManualUploadProvider(), ExternalVideoProvider())}


def get_provider(name: str) -> VideoProvider:
    p = PROVIDERS.get(name)
    if not p:
        raise ValueError(f"Unknown video provider: {name}")
    return p


def generation_providers() -> list:
    return [p for p in PROVIDERS.values() if p.can_generate]
