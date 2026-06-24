"""Value formatters (Phase 3.2).

Pure functions that convert raw mapped API values into display-ready
strings (with optional `_color` hint for the renderer). Formatters
run AFTER field mapping and BEFORE rendering. The original API
response is never mutated; we emit a parallel formatted dict so the
renderer can prefer formatted values and gracefully fall back to raw.

Adding a new formatter = one entry in FORMATTERS + one case in
apply_formatter(). The frontend mirrors this catalog in
`/app/frontend/src/lib/valueFormatters.js`.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional

__all__ = ["FORMATTERS", "apply_formatter", "apply_formatters_dict"]


# Catalog exposed to the builder (mirrored client-side).
FORMATTERS = [
    {"key": "none",          "label": "None",          "fields": []},
    {"key": "currency",      "label": "Currency",      "fields": ["symbol", "decimals", "prefix", "suffix"]},
    {"key": "percent",       "label": "Percentage",    "fields": ["decimals", "positive_color", "negative_color", "prefix", "suffix"]},
    {"key": "number",        "label": "Number",        "fields": ["decimals", "prefix", "suffix"]},
    {"key": "compact",       "label": "Compact Number",  "fields": ["decimals", "symbol", "prefix", "suffix"]},
    {"key": "date",          "label": "Date",          "fields": ["pattern"]},
    {"key": "relative_time", "label": "Relative Time", "fields": []},
    {"key": "uppercase",     "label": "Uppercase",     "fields": []},
    {"key": "lowercase",     "label": "Lowercase",     "fields": []},
    {"key": "titlecase",     "label": "Title Case",    "fields": []},
]
FORMATTER_KEYS = {f["key"] for f in FORMATTERS}


# ─────────────────────────────────────────────────────────────────────
# Numeric helpers
# ─────────────────────────────────────────────────────────────────────

def _as_number(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _format_decimals(n: float, decimals: int) -> str:
    decimals = max(0, min(int(decimals or 0), 8))
    # Thousands separators + fixed decimals.
    return f"{n:,.{decimals}f}"


# ─────────────────────────────────────────────────────────────────────
# Public formatters
# ─────────────────────────────────────────────────────────────────────

def format_currency(v: Any, symbol: str = "$", decimals: int = 2, prefix: str = "", suffix: str = "") -> Optional[str]:
    n = _as_number(v)
    if n is None:
        return None
    sign = "-" if n < 0 else ""
    return f"{prefix}{sign}{symbol or '$'}{_format_decimals(abs(n), decimals)}{suffix}"


def format_percent(v: Any, decimals: int = 2, prefix: str = "", suffix: str = "%") -> Optional[str]:
    n = _as_number(v)
    if n is None:
        return None
    return f"{prefix}{_format_decimals(n, decimals)}{suffix}"


def format_number(v: Any, decimals: int = 0, prefix: str = "", suffix: str = "") -> Optional[str]:
    n = _as_number(v)
    if n is None:
        return None
    return f"{prefix}{_format_decimals(n, decimals)}{suffix}"


_COMPACT_TIERS = [
    (1_000_000_000_000, "T"),
    (1_000_000_000, "B"),
    (1_000_000, "M"),
    (1_000, "K"),
]


def format_compact(v: Any, decimals: int = 1, symbol: str = "", prefix: str = "", suffix: str = "") -> Optional[str]:
    n = _as_number(v)
    if n is None:
        return None
    abs_n = abs(n)
    sign = "-" if n < 0 else ""
    for tier, label in _COMPACT_TIERS:
        if abs_n >= tier:
            value = abs_n / tier
            return f"{prefix}{sign}{symbol or ''}{_format_decimals(value, decimals)}{label}{suffix}"
    # Smaller than 1K — just thousands-separated with default decimals.
    return f"{prefix}{sign}{symbol or ''}{_format_decimals(abs_n, max(0, decimals))}{suffix}"


def _parse_datetime(v: Any) -> Optional[datetime]:
    """Accept ISO strings, epoch seconds (int/float), or already-datetime."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, (int, float)):
        try:
            return datetime.fromtimestamp(float(v), tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(v, str):
        s = v.strip()
        # Try epoch-as-string first.
        try:
            n = float(s)
            if n > 1e10:  # Likely milliseconds.
                n = n / 1000.0
            return datetime.fromtimestamp(n, tz=timezone.utc)
        except ValueError:
            pass
        # ISO 8601 — replace trailing Z to make fromisoformat happy.
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def format_date(v: Any, pattern: str = "%Y-%m-%d") -> Optional[str]:
    dt = _parse_datetime(v)
    if dt is None:
        return None
    try:
        return dt.strftime(pattern or "%Y-%m-%d")
    except (ValueError, TypeError):
        return dt.isoformat()


def format_relative_time(v: Any, now: Optional[datetime] = None) -> Optional[str]:
    dt = _parse_datetime(v)
    if dt is None:
        return None
    base = now or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = (base - dt).total_seconds()
    future = delta < 0
    delta = abs(delta)
    if delta < 60:
        out = f"{int(delta)}s"
    elif delta < 3600:
        out = f"{int(delta / 60)}m"
    elif delta < 86400:
        out = f"{int(delta / 3600)}h"
    elif delta < 86400 * 30:
        out = f"{int(delta / 86400)}d"
    elif delta < 86400 * 365:
        out = f"{int(delta / (86400 * 30))}mo"
    else:
        out = f"{int(delta / (86400 * 365))}y"
    return f"in {out}" if future else f"{out} ago"


def format_text_case(v: Any, case: str = "upper") -> Optional[str]:
    if v is None:
        return None
    s = str(v)
    if case == "upper":
        return s.upper()
    if case == "lower":
        return s.lower()
    if case == "title":
        return s.title()
    return s


# ─────────────────────────────────────────────────────────────────────
# Dispatch
# ─────────────────────────────────────────────────────────────────────

def apply_formatter(value: Any, cfg: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Returns {raw, formatted, color}. `formatted` is None when the
    formatter doesn't apply (e.g., currency on a non-numeric input);
    the renderer falls back to raw in that case."""
    out: Dict[str, Any] = {"raw": value, "formatted": None, "color": None}
    if not cfg or not isinstance(cfg, dict):
        return out
    kind = cfg.get("type") or "none"
    if kind == "none":
        return out
    decimals = cfg.get("decimals")
    symbol = cfg.get("symbol") or ""
    prefix = cfg.get("prefix") or ""
    suffix = cfg.get("suffix") or ""
    formatted = None
    try:
        if kind == "currency":
            formatted = format_currency(value, symbol=symbol or "$", decimals=decimals if decimals is not None else 2,
                                        prefix=prefix, suffix=suffix)
        elif kind == "percent":
            formatted = format_percent(value, decimals=decimals if decimals is not None else 2,
                                       prefix=prefix, suffix=suffix or "%")
        elif kind == "number":
            formatted = format_number(value, decimals=decimals if decimals is not None else 0,
                                      prefix=prefix, suffix=suffix)
        elif kind == "compact":
            formatted = format_compact(value, decimals=decimals if decimals is not None else 1,
                                       symbol=symbol, prefix=prefix, suffix=suffix)
        elif kind == "date":
            formatted = format_date(value, pattern=cfg.get("pattern") or "%Y-%m-%d")
        elif kind == "relative_time":
            formatted = format_relative_time(value)
        elif kind in ("uppercase", "lowercase", "titlecase"):
            cm = {"uppercase": "upper", "lowercase": "lower", "titlecase": "title"}
            formatted = format_text_case(value, cm[kind])
    except Exception:  # noqa: BLE001
        formatted = None

    # Positive/negative color hint for percent/currency/number formatters.
    n = _as_number(value)
    if n is not None and kind in ("percent", "currency", "number", "compact"):
        if n > 0 and cfg.get("positive_color"):
            out["color"] = cfg["positive_color"]
        elif n < 0 and cfg.get("negative_color"):
            out["color"] = cfg["negative_color"]

    out["formatted"] = formatted
    return out


def apply_formatters_dict(values: Dict[str, Any], formatters: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Apply per-field formatters. Returns {field_key: {raw, formatted, color}}.
    Fields without a formatter are NOT included (renderer falls back
    to the raw value from `mapped`)."""
    out: Dict[str, Any] = {}
    if not formatters or not isinstance(formatters, dict):
        return out
    for field_key, cfg in formatters.items():
        if not cfg or (isinstance(cfg, dict) and (cfg.get("type") or "none") == "none"):
            continue
        if field_key not in (values or {}):
            continue
        out[field_key] = apply_formatter(values[field_key], cfg)
    return out
