"""ORAi image generation / editing.

Primary provider: Gemini Nano Banana (gemini-3.1-flash-image-preview) via
the Emergent universal key. Fallback: OpenAI gpt-image-2 on the founder's
own OpenAI project key. Returns raw image bytes; storage is handled by
services.image_store so every generated image gets the platform's normal
/api/images URL, thumbnails and content-safety pipeline.
"""
from __future__ import annotations

import base64
import logging
import os
import re
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger("ourrealm.orai_images")

GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview"
OPENAI_IMAGE_MODEL = "gpt-image-2"

_SUBJECT = r"(image|picture|photo|logo|banner|poster|icon|avatar|profile pic(?:ture)?|pfp|wallpaper|illustration|artwork|art|mockup|thumbnail|graphic|drawing|sketch)"
IMAGE_GEN_RE = re.compile(
    r"\b(create|generate|make|design|draw|render|produce)\b[^.]{0,60}\b" + _SUBJECT + r"\b",
    re.IGNORECASE)
IMAGE_EDIT_RE = re.compile(
    r"\b(remove (?:the )?background|replace|swap|recolor|change (?:the )?colou?rs?|"
    r"enhance|upscale|sharpen|extend|outpaint|expand|add text|make (?:it|this) "
    r"(?:photo)?realistic|photorealistic|variation|variations|restyle|regenerate|"
    r"another version|edit (?:this|the) " + _SUBJECT + r")\b",
    re.IGNORECASE)


def detect_image_intent(message: str, has_upload: bool = False) -> bool:
    m = message or ""
    if has_upload:
        return bool(IMAGE_EDIT_RE.search(m) or IMAGE_GEN_RE.search(m))
    return bool(IMAGE_GEN_RE.search(m))


def wants_edit(message: str) -> bool:
    return bool(IMAGE_EDIT_RE.search(message or ""))


def load_reference_from_image_url(url: str) -> Optional[str]:
    """Read a previously stored image back as base64 so the founder can
    iteratively refine the last generated image. Handles both local
    /api/images files and cloud-mirrored absolute URLs."""
    try:
        marker = "/api/media/images/" if "/api/media/images/" in (url or "") else "/api/images/"
        if marker in (url or ""):
            name = url.split(marker)[-1].split("?")[0]
            if name and "/" not in name:
                from services.image_store import image_dir
                p = Path(image_dir()) / name
                if p.exists():
                    return base64.b64encode(p.read_bytes()).decode()
        if (url or "").startswith("http"):
            import httpx
            r = httpx.get(url, timeout=20)
            if r.status_code == 200 and r.content:
                return base64.b64encode(r.content).decode()
        return None
    except Exception:  # noqa: BLE001
        return None


async def _gemini_generate(prompt: str, reference_b64: Optional[str]) -> Optional[bytes]:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return None
    import uuid
    chat = LlmChat(api_key=key, session_id=f"orai-img-{uuid.uuid4()}",
                   system_message="You are an expert image generator.")
    chat.with_model("gemini", GEMINI_IMAGE_MODEL).with_params(modalities=["image", "text"])
    msg = UserMessage(text=prompt,
                      file_contents=[ImageContent(reference_b64)] if reference_b64 else None)
    _text, images = await chat.send_message_multimodal_response(msg)
    if images:
        return base64.b64decode(images[0]["data"])
    return None


async def _openai_generate(prompt: str, reference_b64: Optional[str]) -> Optional[bytes]:
    import httpx
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    async with httpx.AsyncClient(timeout=120) as client:
        if reference_b64:
            r = await client.post(
                "https://api.openai.com/v1/images/edits",
                headers={"Authorization": f"Bearer {key}"},
                files={"image": ("reference.png", base64.b64decode(reference_b64), "image/png")},
                data={"model": OPENAI_IMAGE_MODEL, "prompt": prompt[:3800], "size": "1024x1024"},
            )
        else:
            r = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": OPENAI_IMAGE_MODEL, "prompt": prompt[:3800], "size": "1024x1024"},
            )
    if r.status_code != 200:
        logger.warning("ORAi image: openai %s returned %s: %s",
                       OPENAI_IMAGE_MODEL, r.status_code, r.text[:160])
        return None
    data = (r.json().get("data") or [{}])[0]
    b64 = data.get("b64_json")
    return base64.b64decode(b64) if b64 else None


async def generate_orai_image(prompt: str,
                              reference_b64: Optional[str] = None) -> Tuple[bytes, str]:
    """Returns (image_bytes, model_used). Gemini first, gpt-image-2 fallback."""
    try:
        img = await _gemini_generate(prompt, reference_b64)
        if img:
            logger.info("ORAi image: provider=gemini model=%s edit=%s", GEMINI_IMAGE_MODEL, bool(reference_b64))
            return img, GEMINI_IMAGE_MODEL
        logger.warning("ORAi image: gemini returned no image — trying gpt-image-2 FALLBACK.")
    except Exception as e:  # noqa: BLE001
        logger.warning("ORAi image: gemini failed (%s) — trying gpt-image-2 FALLBACK.", str(e)[:120])
    img = await _openai_generate(prompt, reference_b64)
    if img:
        logger.info("ORAi image: provider=openai model=%s edit=%s (FALLBACK)", OPENAI_IMAGE_MODEL, bool(reference_b64))
        return img, OPENAI_IMAGE_MODEL
    raise RuntimeError("Both image providers are unavailable right now.")
