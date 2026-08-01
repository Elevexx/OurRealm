"""ORAi Voice Engine — shared voice layer for every ORAi surface.

Native OurRealm voice library (Nova, Atlas, Aurora, Ember, Luna, Orion,
Echo, Titan). Provider details are an internal implementation detail and
are NEVER exposed through the API responses or UI.

/api/orai/voice/library     — voices + caller prefs
/api/orai/voice/prefs       — GET/PUT per-user voice preferences
/api/orai/voice/tts         — text → spoken mp3 (selected ORAi voice)
/api/orai/voice/preview/{v} — cached voice preview sample
/api/orai/voice/transcribe  — mic audio → text
"""
import logging
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel

from core.db import db
from core.deps import CurrentUser

load_dotenv()
log = logging.getLogger("ourrealm.orai.voice")
router = APIRouter(prefix="/api/orai/voice", tags=["orai-voice"])

# ORAi voice catalog. `_engine_voice` is internal only — stripped before
# any response leaves the API.
VOICES = [
    {"id": "nova",   "name": "Nova",   "tagline": "Energetic & upbeat",
     "personality": "A bright, fast-moving voice that makes daily briefings feel exciting.",
     "color": "#2EA0FF", "_engine_voice": "nova"},
    {"id": "atlas",  "name": "Atlas",  "tagline": "Deep & authoritative",
     "personality": "Grounded and commanding — perfect for reports and serious summaries.",
     "color": "#F4A73B", "_engine_voice": "onyx"},
    {"id": "aurora", "name": "Aurora", "tagline": "Bright & cheerful",
     "personality": "A sparkling, optimistic voice that keeps long sessions feeling light.",
     "color": "#C26BFF", "_engine_voice": "shimmer"},
    {"id": "ember",  "name": "Ember",  "tagline": "Warm & friendly",
     "personality": "Feels like a trusted mentor — warm, encouraging, and easy to listen to.",
     "color": "#FF8A5A", "_engine_voice": "coral"},
    {"id": "luna",   "name": "Luna",   "tagline": "Calm & wise",
     "personality": "Measured and soothing — great for focused work and evening reviews.",
     "color": "#4DD6C1", "_engine_voice": "sage"},
    {"id": "orion",  "name": "Orion",  "tagline": "Smooth & composed",
     "personality": "Steady, confident guidance with a relaxed, even delivery.",
     "color": "#10E670", "_engine_voice": "echo"},
    {"id": "echo",   "name": "Echo",   "tagline": "Balanced & clear",
     "personality": "A neutral, crystal-clear voice that sounds great on every device.",
     "color": "#8FA8C7", "_engine_voice": "alloy"},
    {"id": "titan",  "name": "Titan",  "tagline": "Crisp & articulate",
     "personality": "Precise, articulate delivery — ideal for instructions and lessons.",
     "color": "#FF6B6B", "_engine_voice": "ash"},
]
VOICE_MAP = {v["id"]: v for v in VOICES}
DEFAULT_PREFS = {"voice_id": "nova", "speed": 1.0, "pitch": 0, "volume": 0.9,
                 "auto_speak": True, "mode": "push", "favorites": []}
PREVIEW_DIR = Path(__file__).resolve().parent.parent / "cache" / "orai_voice_previews"
PREVIEW_TEXT = ("Hi, I'm {name} — one of the ORAi voices on OurRealm. "
                "I can read replies out loud, guide you through your Centers, "
                "and keep the conversation going hands-free.")


def _public(v: dict) -> dict:
    return {k: val for k, val in v.items() if not k.startswith("_")}


def _keys():
    primary = os.environ.get("OPENAI_API_KEY")
    fallback = os.environ.get("EMERGENT_LLM_KEY")
    return [k for k in (primary, fallback) if k]


async def _tts_bytes(text: str, voice_id: str, speed: float) -> bytes:
    from emergentintegrations.llm.openai import OpenAITextToSpeech
    voice = VOICE_MAP.get(voice_id, VOICE_MAP["nova"])
    speed = max(0.25, min(4.0, float(speed or 1.0)))
    last_err = None
    for key in _keys():
        try:
            tts = OpenAITextToSpeech(api_key=key)
            return await tts.generate_speech(
                text=text[:4000], model="tts-1", voice=voice["_engine_voice"], speed=speed)
        except Exception as e:  # try next key
            last_err = e
            log.warning("ORAi voice TTS failed with one key: %s", e)
    log.error("ORAi voice TTS failed on all keys: %s", last_err)
    raise HTTPException(status_code=502, detail="ORAi voice is unavailable right now")


async def _prefs_for(user_id: str) -> dict:
    doc = await db.orai_voice_prefs.find_one({"user_id": user_id}, {"_id": 0, "user_id": 0})
    return {**DEFAULT_PREFS, **(doc or {})}


class PrefsBody(BaseModel):
    voice_id: str | None = None
    speed: float | None = None
    pitch: float | None = None
    volume: float | None = None
    auto_speak: bool | None = None
    mode: str | None = None
    favorites: list[str] | None = None


class TtsBody(BaseModel):
    text: str
    voice_id: str | None = None
    speed: float | None = None


@router.get("/library")
async def voice_library(current: CurrentUser):
    prefs = await _prefs_for(current["id"])
    return {"voices": [_public(v) for v in VOICES], "prefs": prefs}


@router.get("/prefs")
async def get_prefs(current: CurrentUser):
    return await _prefs_for(current["id"])


@router.put("/prefs")
async def put_prefs(body: PrefsBody, current: CurrentUser):
    patch = {}
    if body.voice_id is not None:
        if body.voice_id not in VOICE_MAP:
            raise HTTPException(status_code=400, detail="Unknown ORAi voice")
        patch["voice_id"] = body.voice_id
    if body.speed is not None:
        patch["speed"] = max(0.5, min(2.0, float(body.speed)))
    if body.pitch is not None:
        patch["pitch"] = max(-6.0, min(6.0, float(body.pitch)))
    if body.volume is not None:
        patch["volume"] = max(0.0, min(1.0, float(body.volume)))
    if body.auto_speak is not None:
        patch["auto_speak"] = bool(body.auto_speak)
    if body.mode is not None:
        if body.mode not in ("push", "continuous"):
            raise HTTPException(status_code=400, detail="Unknown voice mode")
        patch["mode"] = body.mode
    if body.favorites is not None:
        patch["favorites"] = [f for f in body.favorites if f in VOICE_MAP][:16]
    if patch:
        await db.orai_voice_prefs.update_one(
            {"user_id": current["id"]}, {"$set": patch}, upsert=True)
    return await _prefs_for(current["id"])


@router.post("/tts")
async def tts(body: TtsBody, current: CurrentUser):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to say")
    prefs = await _prefs_for(current["id"])
    voice_id = body.voice_id if body.voice_id in VOICE_MAP else prefs["voice_id"]
    speed = body.speed if body.speed is not None else prefs["speed"]
    audio = await _tts_bytes(text, voice_id, speed)
    return Response(content=audio, media_type="audio/mpeg",
                    headers={"Cache-Control": "no-store"})


@router.get("/preview/{voice_id}")
async def preview(voice_id: str, current: CurrentUser):
    voice = VOICE_MAP.get(voice_id)
    if not voice:
        raise HTTPException(status_code=404, detail="Unknown ORAi voice")
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    path = PREVIEW_DIR / f"{voice_id}.mp3"
    if not path.exists():
        audio = await _tts_bytes(PREVIEW_TEXT.format(name=voice["name"]), voice_id, 1.0)
        path.write_bytes(audio)
    return Response(content=path.read_bytes(), media_type="audio/mpeg",
                    headers={"Cache-Control": "private, max-age=86400"})


@router.post("/transcribe")
async def transcribe(current: CurrentUser, audio: UploadFile = File(...)):
    from emergentintegrations.llm.openai import OpenAISpeechToText
    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty recording")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Recording too long")
    suffix = ".webm"
    name = (audio.filename or "").lower()
    for ext in (".mp4", ".m4a", ".wav", ".mp3", ".mpeg", ".webm"):
        if name.endswith(ext):
            suffix = ext
            break
    last_err = None
    for key in _keys():
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(raw)
                tmp = f.name
            stt = OpenAISpeechToText(api_key=key)
            with open(tmp, "rb") as fh:
                resp = await stt.transcribe(file=fh, model="whisper-1",
                                            response_format="json")
            return {"text": (getattr(resp, "text", "") or "").strip()}
        except Exception as e:
            last_err = e
            log.warning("ORAi voice transcription failed with one key: %s", e)
        finally:
            if tmp:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
    log.error("ORAi voice transcription failed on all keys: %s", last_err)
    raise HTTPException(status_code=502, detail="Could not hear that — please try again")
