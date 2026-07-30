"""API Provider registry (Phase 3 — API Widget Sources).

Pluggable provider definitions for the Custom Widget Builder's
"API Source" tab. Each provider declares:
  • `key`            — stable identifier stored in editor_config.data_source.provider
  • `name`           — display label
  • `icon`           — lucide-react icon name
  • `category`       — broad bucket for filtering
  • `auth_kind`      — none | api_key | bearer | oauth
  • `auth_env_var`   — name of the OS env var holding the credential (or null)
  • `base_url`       — base URL for all endpoints (override-able per-endpoint)
  • `default_refresh_seconds`, `default_cache_seconds`
  • `provider_quota_per_hour`  — provider-wide call budget the proxy enforces
  • `coming_soon`    — True for OAuth providers we ship as draft tiles
  • `description`    — short blurb shown in the picker
  • `endpoints`      — list of endpoint specs (key/name/method/path/params/sample_response_paths/description)
  • `docs_url`       — link to provider docs (shown in builder)

Adding a new provider = appending one entry here. The backend proxy
and frontend builder both dispatch off this registry — no other code
changes required (Future-ready per Phase 3 spec).

API keys live ONLY in backend env vars. Frontend never sees the
credentials; every call is proxied through /api/widgets/api-call.
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
import os


# ─────────────────────────────────────────────────────────────────────
# Helper to compose endpoint specs concisely.
# `sample_paths` is a hint list of useful JSONPath-style dotted paths
# the builder shows next to the response viewer as one-click bindings.
# ─────────────────────────────────────────────────────────────────────

def _ep(key: str, name: str, *, method: str = "GET", path: str = "",
        params: Optional[List[Dict[str, Any]]] = None,
        sample_paths: Optional[List[Dict[str, str]]] = None,
        array_hints: Optional[List[Dict[str, Any]]] = None,
        description: str = "") -> Dict[str, Any]:
    return {
        "key": key,
        "name": name,
        "method": method.upper(),
        "path": path,
        "params": params or [],
        "sample_paths": sample_paths or [],
        "array_hints": array_hints or [],
        "description": description,
    }


def _p(name: str, ptype: str, *, label: Optional[str] = None,
       required: bool = False, default: Any = None,
       location: str = "query",
       enum: Optional[List[str]] = None) -> Dict[str, Any]:
    """Param spec. `location` is one of query | path | body | header."""
    return {
        "name": name,
        "label": label or name,
        "type": ptype,           # text | number | boolean | select
        "required": required,
        "default": default,
        "location": location,
        "enum": enum,
    }


# ─────────────────────────────────────────────────────────────────────
# Providers — 11 in the spec. OAuth-personal providers ship as
# `coming_soon=True` (Spotify user, YouTube user, Reddit personal).
# Public Reddit/YouTube/Spotify track APIs we CAN call without OAuth
# are surfaced as separate endpoints on the same provider tile.
# ─────────────────────────────────────────────────────────────────────

PROVIDERS: List[Dict[str, Any]] = [
    {
        "key": "openweather",
        "name": "OpenWeather",
        "icon": "CloudSun",
        "category": "weather",
        "auth_kind": "api_key",
        "auth_env_var": "OPENWEATHER_API_KEY",
        "auth_param_name": "appid",
        "auth_param_location": "query",
        "base_url": "https://api.openweathermap.org/data/2.5",
        "default_refresh_seconds": 600,
        "default_cache_seconds": 600,
        "provider_quota_per_hour": 1000,
        "coming_soon": False,
        "capabilities": ["Weather Widgets", "Forecast Widgets", "Current Conditions"],
        "description": "Current weather + forecasts. Free tier 60 calls/min.",
        "docs_url": "https://openweathermap.org/api",
        "endpoints": [
            _ep(
                "current", "Current Weather",
                path="/weather",
                params=[
                    _p("q", "text", label="City (e.g. London,uk)", required=True),
                    _p("units", "select", label="Units", default="metric", enum=["metric", "imperial", "standard"]),
                ],
                sample_paths=[
                    {"label": "City Name", "path": "name"},
                    {"label": "Temperature", "path": "main.temp"},
                    {"label": "Feels Like", "path": "main.feels_like"},
                    {"label": "Humidity", "path": "main.humidity"},
                    {"label": "Conditions", "path": "weather[0].main"},
                    {"label": "Description", "path": "weather[0].description"},
                    {"label": "Icon Code", "path": "weather[0].icon"},
                ],
                description="Current conditions at a city.",
            ),
            _ep(
                "forecast", "5-Day Forecast",
                path="/forecast",
                params=[
                    _p("q", "text", label="City", required=True, default="London,uk"),
                    _p("units", "select", label="Units", default="metric", enum=["metric", "imperial", "standard"]),
                    _p("cnt", "number", label="Count (3h windows)", default=8),
                ],
                sample_paths=[
                    {"label": "City Name", "path": "city.name"},
                    {"label": "First Temp", "path": "list[0].main.temp"},
                ],
                array_hints=[
                    {
                        "label": "Forecast List",
                        "array_path": "list",
                        "item_map": {
                            "label": "dt_txt",
                            "value": "main.temp",
                            "body": "weather[0].main",
                        },
                    },
                ],
            ),
        ],
    },

    {
        "key": "newsapi",
        "name": "NewsAPI",
        "icon": "Newspaper",
        "category": "news",
        "auth_kind": "api_key",
        "auth_env_var": "NEWSAPI_KEY",
        "auth_param_name": "apiKey",
        "auth_param_location": "query",
        "base_url": "https://newsapi.org/v2",
        "default_refresh_seconds": 900,
        "default_cache_seconds": 900,
        "provider_quota_per_hour": 100,
        "coming_soon": False,
        "capabilities": ["Headlines", "Trending News", "Breaking News", "News Widgets"],
        "description": "Top headlines + search. Free tier 100/day.",
        "docs_url": "https://newsapi.org/docs",
        "endpoints": [
            _ep(
                "top_headlines", "Top Headlines",
                path="/top-headlines",
                params=[
                    _p("country", "text", label="Country code", default="us"),
                    _p("category", "select", label="Category", default="general",
                       enum=["business", "entertainment", "general", "health", "science", "sports", "technology"]),
                    _p("pageSize", "number", label="Count", default=5),
                ],
                sample_paths=[
                    {"label": "First Headline", "path": "articles[0].title"},
                    {"label": "First Source", "path": "articles[0].source.name"},
                    {"label": "First Image", "path": "articles[0].urlToImage"},
                    {"label": "First URL", "path": "articles[0].url"},
                    {"label": "Total Results", "path": "totalResults"},
                ],
                array_hints=[
                    {
                        "label": "Headlines List",
                        "array_path": "articles",
                        "item_map": {
                            "label": "title",
                            "body": "description",
                            "image": "urlToImage",
                            "url": "url",
                            "value": "source.name",
                        },
                    },
                ],
            ),
        ],
    },

    {
        "key": "coingecko",
        "name": "CoinGecko",
        "icon": "Bitcoin",
        "category": "crypto",
        "auth_kind": "none",
        "auth_env_var": None,
        "base_url": "https://api.coingecko.com/api/v3",
        "default_refresh_seconds": 120,
        "default_cache_seconds": 120,
        "provider_quota_per_hour": 1800,   # 30/min free tier
        "coming_soon": False,
        "description": "Crypto prices + market data. No key required.",
        "docs_url": "https://www.coingecko.com/en/api/documentation",
        "endpoints": [
            _ep(
                "simple_price", "Simple Price",
                path="/simple/price",
                params=[
                    _p("ids", "text", label="Coin IDs (csv, e.g. bitcoin,ethereum)", required=True, default="bitcoin"),
                    _p("vs_currencies", "text", label="Quote currencies (csv)", required=True, default="usd"),
                    _p("include_24hr_change", "boolean", label="Include 24h change", default=True),
                ],
                sample_paths=[
                    {"label": "BTC Price (USD)", "path": "bitcoin.usd"},
                    {"label": "BTC 24h Change", "path": "bitcoin.usd_24h_change"},
                    {"label": "ETH Price (USD)", "path": "ethereum.usd"},
                ],
            ),
            _ep(
                "coin_details", "Coin Details",
                path="/coins/{id}",
                params=[
                    _p("id", "text", label="Coin ID (e.g. bitcoin)", required=True, default="bitcoin", location="path"),
                ],
                sample_paths=[
                    {"label": "Name", "path": "name"},
                    {"label": "Symbol", "path": "symbol"},
                    {"label": "Image", "path": "image.large"},
                    {"label": "Current Price (USD)", "path": "market_data.current_price.usd"},
                    {"label": "Market Cap (USD)", "path": "market_data.market_cap.usd"},
                ],
            ),
            _ep(
                "markets", "Top Markets",
                path="/coins/markets",
                params=[
                    _p("vs_currency", "text", label="Quote currency", required=True, default="usd"),
                    _p("order", "select", label="Order", default="market_cap_desc",
                       enum=["market_cap_desc", "market_cap_asc", "volume_desc", "id_asc"]),
                    _p("per_page", "number", label="Count", default=10),
                    _p("page", "number", label="Page", default=1),
                ],
                sample_paths=[
                    {"label": "Top Coin Name", "path": "[0].name"},
                    {"label": "Top Coin Price", "path": "[0].current_price"},
                ],
                array_hints=[
                    {
                        "label": "Markets List",
                        "array_path": "",  # root is the array
                        "item_map": {
                            "label": "name",
                            "body": "symbol",
                            "value": "current_price",
                            "delta": "price_change_percentage_24h",
                            "image": "image",
                        },
                    },
                ],
            ),
        ],
    },

    {
        "key": "alphavantage",
        "name": "Alpha Vantage",
        "icon": "TrendingUp",
        "category": "stocks",
        "auth_kind": "api_key",
        # Phase 3.4 — accept BOTH the legacy ALPHA_VANTAGE_KEY name
        # and the spec-aligned ALPHAVANTAGE_API_KEY. The has_credential()
        # check below falls back to either.
        "auth_env_var": "ALPHAVANTAGE_API_KEY",
        "auth_env_var_fallback": "ALPHA_VANTAGE_KEY",
        "auth_param_name": "apikey",
        "auth_param_location": "query",
        "base_url": "https://www.alphavantage.co",
        "default_refresh_seconds": 900,
        "default_cache_seconds": 900,
        "provider_quota_per_hour": 25,  # 25/day free tier — be conservative.
        "coming_soon": False,
        "capabilities": ["Stock Widgets", "Crypto Widgets", "Market Data", "Forex Quotes"],
        "description": "Stock & forex quotes. Free tier 25/day.",
        "docs_url": "https://www.alphavantage.co/documentation/",
        "endpoints": [
            _ep(
                "global_quote", "Global Quote",
                path="/query",
                params=[
                    _p("function", "text", label="Function", required=True, default="GLOBAL_QUOTE"),
                    _p("symbol", "text", label="Symbol (e.g. AAPL)", required=True, default="AAPL"),
                ],
                sample_paths=[
                    {"label": "Symbol", "path": "Global Quote.01. symbol"},
                    {"label": "Price", "path": "Global Quote.05. price"},
                    {"label": "Change", "path": "Global Quote.09. change"},
                    {"label": "Change %", "path": "Global Quote.10. change percent"},
                ],
            ),
            _ep(
                "crypto_quote", "Crypto Exchange Rate",
                path="/query",
                params=[
                    _p("function", "text", label="Function", required=True, default="CURRENCY_EXCHANGE_RATE"),
                    _p("from_currency", "text", label="From (e.g. BTC)", required=True, default="BTC"),
                    _p("to_currency", "text", label="To (e.g. USD)", required=True, default="USD"),
                ],
                sample_paths=[
                    {"label": "From", "path": "Realtime Currency Exchange Rate.01. From_Currency Code"},
                    {"label": "To",   "path": "Realtime Currency Exchange Rate.03. To_Currency Code"},
                    {"label": "Rate", "path": "Realtime Currency Exchange Rate.05. Exchange Rate"},
                    {"label": "Time", "path": "Realtime Currency Exchange Rate.06. Last Refreshed"},
                ],
            ),
        ],
    },

    {
        "key": "nasa",
        "name": "NASA APOD",
        "icon": "Rocket",
        "category": "space",
        "auth_kind": "api_key",
        "auth_env_var": "NASA_API_KEY",  # DEMO_KEY also works as fallback
        "auth_param_name": "api_key",
        "auth_param_location": "query",
        "base_url": "https://api.nasa.gov",
        "default_refresh_seconds": 86400,
        "default_cache_seconds": 86400,
        "provider_quota_per_hour": 1000,
        "coming_soon": False,
        "description": "Astronomy picture of the day + Mars rover photos. DEMO_KEY works without signup.",
        "docs_url": "https://api.nasa.gov/",
        "endpoints": [
            _ep(
                "apod", "Astronomy Picture of the Day",
                path="/planetary/apod",
                sample_paths=[
                    {"label": "Title", "path": "title"},
                    {"label": "Image URL", "path": "url"},
                    {"label": "HD URL", "path": "hdurl"},
                    {"label": "Date", "path": "date"},
                    {"label": "Explanation", "path": "explanation"},
                ],
            ),
        ],
    },

    {
        "key": "github",
        "name": "GitHub",
        "icon": "Github",
        "category": "developer",
        "auth_kind": "none",  # Public unauth endpoints only — 60 req/hour per IP.
        "auth_env_var": "GITHUB_TOKEN",  # Optional — if set, bumps quota.
        "auth_param_name": "Authorization",
        "auth_param_location": "header",
        "auth_param_prefix": "Bearer ",
        "base_url": "https://api.github.com",
        "default_refresh_seconds": 600,
        "default_cache_seconds": 600,
        "provider_quota_per_hour": 60,  # unauth tier; bump to 5000 if token set.
        "coming_soon": False,
        "description": "Public repo & user info. No auth required (token optional).",
        "docs_url": "https://docs.github.com/rest",
        "endpoints": [
            _ep(
                "repo", "Repository",
                path="/repos/{owner}/{repo}",
                params=[
                    _p("owner", "text", label="Owner", required=True, default="emergent", location="path"),
                    _p("repo", "text", label="Repository", required=True, default="emergent", location="path"),
                ],
                sample_paths=[
                    {"label": "Full Name", "path": "full_name"},
                    {"label": "Description", "path": "description"},
                    {"label": "Stars", "path": "stargazers_count"},
                    {"label": "Forks", "path": "forks_count"},
                    {"label": "Open Issues", "path": "open_issues_count"},
                    {"label": "URL", "path": "html_url"},
                ],
            ),
            _ep(
                "user", "User",
                path="/users/{username}",
                params=[_p("username", "text", label="Username", required=True, default="torvalds", location="path")],
                sample_paths=[
                    {"label": "Name", "path": "name"},
                    {"label": "Avatar URL", "path": "avatar_url"},
                    {"label": "Followers", "path": "followers"},
                    {"label": "Public Repos", "path": "public_repos"},
                ],
            ),
        ],
    },

    {
        "key": "reddit",
        "name": "Reddit",
        "icon": "MessageSquare",
        "category": "community",
        "auth_kind": "none",  # Public .json endpoints (no key needed).
        "auth_env_var": None,
        "base_url": "https://www.reddit.com",
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "default_refresh_seconds": 600,
        "default_cache_seconds": 600,
        "provider_quota_per_hour": 600,
        "coming_soon": False,
        "description": "Public subreddit feeds. No auth required.",
        "docs_url": "https://www.reddit.com/dev/api",
        "endpoints": [
            _ep(
                "subreddit_top", "Subreddit Top Posts",
                path="/r/{subreddit}/top.json",
                params=[
                    _p("subreddit", "text", label="Subreddit (no /r/)", required=True, default="programming", location="path"),
                    _p("limit", "number", label="Count", default=5),
                    _p("t", "select", label="Time window", default="day", enum=["hour", "day", "week", "month", "year", "all"]),
                ],
                sample_paths=[
                    {"label": "First Title", "path": "data.children[0].data.title"},
                    {"label": "First Author", "path": "data.children[0].data.author"},
                    {"label": "First Score", "path": "data.children[0].data.score"},
                    {"label": "First URL", "path": "data.children[0].data.url"},
                ],
                array_hints=[
                    {
                        "label": "Posts List",
                        "array_path": "data.children",
                        "item_map": {
                            "label": "data.title",
                            "body": "data.subreddit_name_prefixed",
                            "value": "data.score",
                            "url": "data.url",
                            "image": "data.thumbnail",
                        },
                    },
                ],
            ),
        ],
    },

    {
        "key": "openai",
        "name": "OpenAI",
        "icon": "Bot",
        "category": "ai",
        "auth_kind": "bearer",
        "auth_env_var": "OPENAI_API_KEY",
        "base_url": "https://api.openai.com/v1",
        "default_refresh_seconds": 3600,
        "default_cache_seconds": 3600,
        "provider_quota_per_hour": 60,
        "coming_soon": False,
        "capabilities": ["AI Widgets", "Chat Widgets", "Summaries", "Content Generation"],
        "description": "Chat completions. Requires your own OPENAI_API_KEY.",
        "docs_url": "https://platform.openai.com/docs/api-reference",
        "endpoints": [
            _ep(
                "chat", "Chat Completion",
                method="POST",
                path="/chat/completions",
                params=[
                    _p("model", "text", label="Model", required=True, default="gpt-5.4-mini", location="body"),
                    _p("prompt", "text", label="Prompt", required=True, default="Give me one fun fact about space.", location="body"),
                    _p("max_tokens", "number", label="Max Tokens", default=120, location="body"),
                ],
                sample_paths=[
                    {"label": "Reply", "path": "choices[0].message.content"},
                    {"label": "Model", "path": "model"},
                    {"label": "Total Tokens", "path": "usage.total_tokens"},
                ],
                description="Standard chat-completions call. Backend builds messages=[{role:user, content:prompt}].",
            ),
        ],
    },

    # ─── OAuth providers — UI surfaces them as 'Coming Soon' so admins
    # can see the full provider catalog but can't launch them yet.
    # The proxy will refuse non-coming_soon=False calls until we wire
    # the per-user OAuth flow.
    {
        "key": "spotify",
        "name": "Spotify",
        "icon": "Music",
        "category": "music",
        "auth_kind": "oauth",
        "auth_env_var": None,
        "base_url": "https://api.spotify.com/v1",
        "default_refresh_seconds": 300,
        "default_cache_seconds": 300,
        "provider_quota_per_hour": 600,
        "coming_soon": True,
        "description": "Now-playing + top tracks. Requires user OAuth (coming soon).",
        "docs_url": "https://developer.spotify.com/documentation/web-api",
        "endpoints": [
            _ep("now_playing", "Now Playing", path="/me/player/currently-playing"),
            _ep("top_tracks", "User Top Tracks", path="/me/top/tracks"),
        ],
    },

    {
        "key": "youtube",
        "name": "YouTube",
        "icon": "Youtube",
        "category": "video",
        "auth_kind": "oauth",
        "auth_env_var": None,
        "base_url": "https://www.googleapis.com/youtube/v3",
        "default_refresh_seconds": 1800,
        "default_cache_seconds": 1800,
        "provider_quota_per_hour": 100,
        "coming_soon": True,
        "description": "Channel + playlist data. Requires OAuth or API key (coming soon).",
        "docs_url": "https://developers.google.com/youtube/v3",
        "endpoints": [
            _ep("channel", "Channel Info", path="/channels"),
            _ep("playlist_items", "Playlist Items", path="/playlistItems"),
        ],
    },

    {
        "key": "googlemaps",
        "name": "Google Maps",
        "icon": "Map",
        "category": "maps",
        "auth_kind": "api_key",
        "auth_env_var": "GOOGLE_MAPS_KEY",
        "auth_param_name": "key",
        "auth_param_location": "query",
        "base_url": "https://maps.googleapis.com/maps/api",
        "default_refresh_seconds": 86400,
        "default_cache_seconds": 86400,
        "provider_quota_per_hour": 200,
        "coming_soon": True,  # Requires billing setup — keep as draft tile.
        "description": "Geocoding + nearby places. Requires billing-enabled key (coming soon).",
        "docs_url": "https://developers.google.com/maps/documentation",
        "endpoints": [
            _ep("geocode", "Geocode Address", path="/geocode/json",
                params=[_p("address", "text", label="Address", required=True)]),
        ],
    },
]


# ─────────────────────────────────────────────────────────────────────
# Indexing helpers
# ─────────────────────────────────────────────────────────────────────

PROVIDERS_BY_KEY: Dict[str, Dict[str, Any]] = {p["key"]: p for p in PROVIDERS}


def get_provider(key: str) -> Optional[Dict[str, Any]]:
    return PROVIDERS_BY_KEY.get(key)


def get_endpoint(provider_key: str, endpoint_key: str) -> Optional[Dict[str, Any]]:
    prov = get_provider(provider_key)
    if not prov:
        return None
    for ep in prov.get("endpoints", []):
        if ep["key"] == endpoint_key:
            return ep
    return None


def has_credential(provider: Dict[str, Any]) -> bool:
    """True iff the provider either needs no auth, or its env var is set.
    Phase 3.4 — supports `auth_env_var_fallback` so we can rename env
    vars without breaking existing deployments."""
    if provider.get("auth_kind") == "none":
        return True
    var = provider.get("auth_env_var")
    fb = provider.get("auth_env_var_fallback")
    if not var and not fb:
        return False
    if provider["key"] == "nasa":
        return True
    return bool((var and os.environ.get(var)) or (fb and os.environ.get(fb)))


def public_provider_view(provider: Dict[str, Any]) -> Dict[str, Any]:
    """Strip env-var names from the payload sent to the frontend.
    The UI only needs to know IF a key is configured, never its name
    or value."""
    out = {k: v for k, v in provider.items() if k not in ("auth_env_var", "auth_param_prefix")}
    out["has_credential"] = has_credential(provider)
    return out


__all__ = [
    "PROVIDERS",
    "PROVIDERS_BY_KEY",
    "get_provider",
    "get_endpoint",
    "has_credential",
    "public_provider_view",
]
