"""
Reusable geographic filtering primitives.

ZIP → (latitude, longitude) resolution via pgeocode (US dataset). Cached
in-process so the dataset downloads exactly once per worker.

Public surface:
    resolve_zip(zip_code)  → (lat, lng) | None
    haversine_miles(a, b)  → float
    radius_filter(items, viewer_lat_lng, miles, *, key='zip_lat_lng')
                           → iterable of items within the radius

The same helpers feed the For-You Feed radius filter, the Sounds radius
filter, and any future search surface. The filter is intentionally
data-shape-agnostic — pass a function/key that returns (lat, lng) per item.
"""
from __future__ import annotations

import math
import re
from functools import lru_cache
from typing import Iterable, List, Optional, Tuple

import pgeocode


# US ZIP "12345" or "12345-6789" — only the 5-digit prefix is used for
# geocoding.
ZIP_RE = re.compile(r"^\d{5}(-\d{4})?$")

# Spec: radius chips. "any" sentinel disables filtering entirely.
ALLOWED_RADII = {10, 20, 50, 100, 250, 500}


def is_valid_zip(zip_code: Optional[str]) -> bool:
    if not zip_code:
        return False
    return bool(ZIP_RE.match(zip_code.strip()))


@lru_cache(maxsize=1)
def _nominatim_us():
    # pgeocode downloads the dataset on first call; subsequent calls are
    # in-memory.
    return pgeocode.Nominatim("us")


@lru_cache(maxsize=4096)
def resolve_zip(zip_code: Optional[str]) -> Optional[Tuple[float, float]]:
    """Returns (lat, lng) or None if the ZIP cannot be resolved.

    Only the 5-digit prefix is considered. Falsy input returns None.
    """
    if not zip_code:
        return None
    raw = zip_code.strip()
    if not is_valid_zip(raw):
        return None
    prefix = raw[:5]
    try:
        row = _nominatim_us().query_postal_code(prefix)
    except Exception:
        return None
    lat = getattr(row, "latitude", None)
    lng = getattr(row, "longitude", None)
    # pgeocode returns NaN for unknown ZIPs.
    if lat is None or lng is None:
        return None
    try:
        if math.isnan(lat) or math.isnan(lng):
            return None
    except TypeError:
        return None
    return float(lat), float(lng)


def haversine_miles(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Great-circle distance in miles between two (lat, lng) points."""
    lat1, lng1 = a
    lat2, lng2 = b
    R = 3958.7613  # Earth radius in miles
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    s = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(s))


def parse_radius(value: Optional[str]) -> Optional[int]:
    """Returns a normalized radius (int miles) or None for 'any'/invalid.

    None means: do not apply a radius filter.
    """
    if value is None:
        return None
    v = str(value).strip().lower()
    if v in ("", "any", "0"):
        return None
    try:
        n = int(v)
    except ValueError:
        return None
    return n if n in ALLOWED_RADII else None


def radius_filter(items: Iterable[dict], viewer_lat_lng: Tuple[float, float], miles: int,
                  *, lat_key: str = "lat", lng_key: str = "lng") -> List[dict]:
    """Return only items whose (lat_key, lng_key) is within `miles` of viewer.

    Items missing either coordinate are EXCLUDED — they cannot be measured.
    """
    out: List[dict] = []
    for it in items:
        lat = it.get(lat_key)
        lng = it.get(lng_key)
        if lat is None or lng is None:
            continue
        try:
            d = haversine_miles(viewer_lat_lng, (float(lat), float(lng)))
        except (TypeError, ValueError):
            continue
        if d <= miles:
            out.append(it)
    return out
