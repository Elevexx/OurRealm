from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import uuid
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Annotated

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field, ConfigDict


# ------------------------------------------------------------
# Config
# ------------------------------------------------------------
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 24  # 1 day for dev convenience
REFRESH_TOKEN_DAYS = 30
LOCKOUT_THRESHOLD = 5
LOCKOUT_MINUTES = 15


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


# ------------------------------------------------------------
# MongoDB
# ------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]


# ------------------------------------------------------------
# App
# ------------------------------------------------------------
app = FastAPI(title="OurRealm API")
api = APIRouter(prefix="/api")
auth_router = APIRouter(prefix="/api/auth", tags=["auth"])
profile_router = APIRouter(prefix="/api/profile", tags=["profile"])
posts_router = APIRouter(prefix="/api/posts", tags=["posts"])


# ------------------------------------------------------------
# Models
# ------------------------------------------------------------
class RegisterPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=80)


class LoginPayload(BaseModel):
    email: EmailStr
    password: str


class ForgotPayload(BaseModel):
    email: EmailStr


class ResetPayload(BaseModel):
    token: str
    new_password: str = Field(min_length=6, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    name: str
    role: str = "user"
    avatar_url: Optional[str] = None
    bio: Optional[str] = ""
    interests: List[str] = []
    mode: str = "cypher"
    widgets: List[dict] = []
    created_at: datetime


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    interests: Optional[List[str]] = None
    mode: Optional[str] = None
    widgets: Optional[List[dict]] = None


class PostCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    media_type: str = Field(default="post")  # post|image|video|live|sound
    media_url: Optional[str] = None
    tags: List[str] = []


class PostOut(BaseModel):
    id: str
    author_id: str
    author_name: str
    author_avatar: Optional[str] = None
    content: str
    media_type: str
    media_url: Optional[str]
    tags: List[str]
    likes: int = 0
    comments: int = 0
    created_at: datetime


# ------------------------------------------------------------
# Password / token helpers
# ------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS),
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    response.set_cookie(
        "access_token", access_token, httponly=True, secure=False, samesite="lax",
        max_age=ACCESS_TOKEN_MINUTES * 60, path="/",
    )
    response.set_cookie(
        "refresh_token", refresh_token, httponly=True, secure=False, samesite="lax",
        max_age=REFRESH_TOKEN_DAYS * 24 * 3600, path="/",
    )


def serialize_user(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "email": doc["email"],
        "name": doc.get("name", ""),
        "role": doc.get("role", "user"),
        "avatar_url": doc.get("avatar_url"),
        "bio": doc.get("bio", ""),
        "interests": doc.get("interests", []),
        "mode": doc.get("mode", "cypher"),
        "widgets": doc.get("widgets", []),
        "created_at": doc.get("created_at") if isinstance(doc.get("created_at"), datetime)
        else datetime.fromisoformat(doc["created_at"]) if doc.get("created_at") else datetime.now(timezone.utc),
    }


# ------------------------------------------------------------
# Auth dependency
# ------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]


# ------------------------------------------------------------
# Brute force protection
# ------------------------------------------------------------
async def check_lockout(identifier: str) -> None:
    record = await db.login_attempts.find_one({"identifier": identifier})
    if not record:
        return
    if record.get("count", 0) >= LOCKOUT_THRESHOLD:
        locked_until = record.get("locked_until")
        if locked_until and datetime.fromisoformat(locked_until) > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")


async def register_failed(identifier: str) -> None:
    record = await db.login_attempts.find_one({"identifier": identifier})
    count = (record.get("count", 0) if record else 0) + 1
    locked_until = (datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)).isoformat() if count >= LOCKOUT_THRESHOLD else None
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$set": {"identifier": identifier, "count": count, "locked_until": locked_until}},
        upsert=True,
    )


async def clear_attempts(identifier: str) -> None:
    await db.login_attempts.delete_one({"identifier": identifier})


# ------------------------------------------------------------
# Auth endpoints
# ------------------------------------------------------------
@auth_router.post("/register")
async def register(payload: RegisterPayload, response: Response):
    email = payload.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name.strip(),
        "role": "user",
        "avatar_url": None,
        "bio": "",
        "interests": [],
        "mode": "cypher",
        "widgets": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    access = create_access_token(user_id, email)
    refresh = create_refresh_token(user_id)
    set_auth_cookies(response, access, refresh)
    return {"user": serialize_user(doc), "access_token": access}


@auth_router.post("/login")
async def login(payload: LoginPayload, request: Request, response: Response):
    email = payload.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    await check_lockout(identifier)
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        await register_failed(identifier)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await clear_attempts(identifier)
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"user": serialize_user(user), "access_token": access}


@auth_router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@auth_router.get("/me")
async def me(current: CurrentUser):
    return {"user": serialize_user(current)}


@auth_router.post("/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    access = create_access_token(user["id"], user["email"])
    response.set_cookie(
        "access_token", access, httponly=True, secure=False, samesite="lax",
        max_age=ACCESS_TOKEN_MINUTES * 60, path="/",
    )
    return {"access_token": access}


FOUNDER_EMAIL = "slopestyle2022@gmail.com"
FOUNDER_USERNAME = "stealth"
FOUNDER_AVATAR = "https://customer-assets.emergentagent.com/job_realm-deploy/artifacts/qnqnnlzv_IMG_0993.jpeg"
FOUNDER_WIDGETS = [
    {"id": "fw-live",    "type": "live",     "size": "large",  "title": "Stealth Live"},
    {"id": "fw-merch",   "type": "merch",    "size": "full",   "title": "Stealth Merch"},
    {"id": "fw-tracks",  "type": "music",    "size": "large",  "title": "Stealth Tracks"},
    {"id": "fw-events",  "type": "events",   "size": "medium", "title": "Upcoming Events"},
    {"id": "fw-fans",    "type": "polls",    "size": "medium", "title": "Fan Wall"},
    {"id": "fw-social",  "type": "custom",   "size": "small",  "title": "Connect with Stealth"},
]


# ----- OTP (founder displayed-OTP login) -----
class OtpRequest(BaseModel):
    email: EmailStr


class OtpVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=10)


@auth_router.post("/otp/request")
async def otp_request(payload: OtpRequest):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="No account for this email")
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    await db.otp_codes.update_one(
        {"email": email},
        {"$set": {
            "email": email,
            "code": code,
            "used": False,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        }},
        upsert=True,
    )
    logger.info(f"[OTP] {email} -> {code}")
    # For founder/dev: displayed OTP returned to client (matches existing "OTP system")
    return {"ok": True, "displayed_otp": code, "expires_in": 600}


@auth_router.post("/otp/verify")
async def otp_verify(payload: OtpVerify, response: Response):
    email = payload.email.lower().strip()
    rec = await db.otp_codes.find_one({"email": email})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    exp = rec.get("expires_at")
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Code expired")
    if rec.get("code") != payload.code.strip():
        raise HTTPException(status_code=400, detail="Invalid code")
    await db.otp_codes.update_one({"email": email}, {"$set": {"used": True}})
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"user": serialize_user(user), "access_token": access}


# ----- Public profile lookup by username -----
@profile_router.get("/by-username/{username}")
async def get_public_profile_by_username(username: str):
    user = await db.users.find_one({"username": username.lower()}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Profile not found")
    out = serialize_user(user)
    out["username"] = user.get("username")
    out["is_founder"] = bool(user.get("is_founder"))
    out["is_verified"] = bool(user.get("is_verified"))
    out["social"] = user.get("social", {})
    out["widgets"] = user.get("widgets") or []
    return {"user": out}


@auth_router.post("/forgot-password")
async def forgot_password(payload: ForgotPayload):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    # Always return ok to prevent enumeration
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": user["id"],
            "used": False,
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        })
        logger.info(f"[Password reset] {email} -> token: {token}")
    return {"ok": True, "message": "If the email exists, a reset link has been sent."}


@auth_router.post("/reset-password")
async def reset_password(payload: ResetPayload):
    rec = await db.password_reset_tokens.find_one({"token": payload.token})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    expires_at = rec.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Token expired")
    await db.users.update_one(
        {"id": rec["user_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    await db.password_reset_tokens.update_one(
        {"token": payload.token}, {"$set": {"used": True}}
    )
    return {"ok": True}


# ------------------------------------------------------------
# Profile endpoints
# ------------------------------------------------------------
@profile_router.get("/me")
async def get_my_profile(current: CurrentUser):
    return {"user": serialize_user(current)}


@profile_router.patch("/me")
async def update_profile(update: ProfileUpdate, current: CurrentUser):
    set_doc = {k: v for k, v in update.model_dump(exclude_none=True).items()}
    if set_doc:
        await db.users.update_one({"id": current["id"]}, {"$set": set_doc})
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    return {"user": serialize_user(user)}


# ------------------------------------------------------------
# Posts endpoints
# ------------------------------------------------------------
@posts_router.post("")
async def create_post(payload: PostCreate, current: CurrentUser):
    doc = {
        "id": str(uuid.uuid4()),
        "author_id": current["id"],
        "author_name": current.get("name", ""),
        "author_avatar": current.get("avatar_url"),
        "content": payload.content,
        "media_type": payload.media_type,
        "media_url": payload.media_url,
        "tags": payload.tags,
        "likes": 0,
        "comments": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.posts.insert_one(doc)
    doc["created_at"] = datetime.fromisoformat(doc["created_at"])
    doc.pop("_id", None)
    return {"post": doc}


@posts_router.get("")
async def list_posts(media_type: Optional[str] = None, limit: int = 50):
    query = {}
    if media_type and media_type != "all":
        query["media_type"] = media_type
    cursor = db.posts.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = []
    async for p in cursor:
        if isinstance(p.get("created_at"), str):
            try:
                p["created_at"] = datetime.fromisoformat(p["created_at"])
            except Exception:
                pass
        items.append(p)
    return {"posts": items}


@posts_router.post("/{post_id}/like")
async def like_post(post_id: str, current: CurrentUser):
    res = await db.posts.update_one({"id": post_id}, {"$inc": {"likes": 1}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"ok": True}


# ------------------------------------------------------------
# Health
# ------------------------------------------------------------
@api.get("/")
async def root():
    return {"app": "OurRealm", "status": "ok"}


# ------------------------------------------------------------
# Wire up
# ------------------------------------------------------------
app.include_router(api)
app.include_router(auth_router)
app.include_router(profile_router)
app.include_router(posts_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o.strip() for o in os.environ.get('CORS_ORIGINS', '*').split(',')],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("ourrealm")


# ------------------------------------------------------------
# Startup: indexes + admin seed
# ------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.posts.create_index("created_at")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@ourrealm.app").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Realm Admin",
            "role": "admin",
            "avatar_url": None,
            "bio": "Curator of OurRealm.",
            "interests": ["technology", "music"],
            "mode": "cypher",
            "widgets": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}},
        )
        logger.info(f"Updated admin password for: {admin_email}")

    # ----- Seed founder account -----
    founder = await db.users.find_one({"email": FOUNDER_EMAIL})
    founder_doc = {
        "email": FOUNDER_EMAIL,
        "username": FOUNDER_USERNAME,
        "name": "Stealth",
        "role": "founder",
        "is_founder": True,
        "is_verified": True,
        "featured_creator": True,
        "avatar_url": FOUNDER_AVATAR,
        "bio": "OurRealm Founder",
        "mode": "stealth",
        "interests": ["dj","music","tech","festivals"],
        "widgets": FOUNDER_WIDGETS,
        "social": {"tiktok": "stealth.hq", "instagram": "djstealthx"},
    }
    if founder is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "password_hash": hash_password(secrets.token_urlsafe(20)),
            "created_at": datetime.now(timezone.utc).isoformat(),
            **founder_doc,
        })
        await db.users.create_index("username", unique=True, sparse=True)
        logger.info(f"Seeded founder: {FOUNDER_EMAIL} @{FOUNDER_USERNAME}")
    else:
        await db.users.update_one(
            {"email": FOUNDER_EMAIL},
            {"$set": founder_doc},
        )
        logger.info(f"Refreshed founder profile: {FOUNDER_EMAIL}")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
