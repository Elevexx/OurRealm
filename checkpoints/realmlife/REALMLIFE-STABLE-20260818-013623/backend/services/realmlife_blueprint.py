"""
RealmLife canonical property blueprint.

ONE persisted blueprint per property (stored on the property doc).
Every observer renders the SAME blueprint: furniture instances,
wall colors, floor finishes, per level. Owners/household members
edit; authorized guests receive permitted levels only.
"""

from fastapi import HTTPException

from core.db import db

from services.realmlife_property import (
    GUEST_LEVEL_KEYS,
    _guest_level_access,
    _id,
    _iso,
    _membership,
    _property_by_id,
    _require_household_member,
)


BLUEPRINT_SCHEMA_VERSION = 1

MAX_PER_TYPE = 5

BOUNDS_X = 8.2
BOUNDS_Z = 6.4


FURNITURE_CATALOG = {
    "sofa": {
        "label": "Sofa",
        "size": [3.0, 1.0, 1.2],
        "default_color": "#6f4ba8",
        "palette": [
            "#6f4ba8", "#386179", "#8a4b5c",
            "#3f8a4b", "#4a4f55", "#b04632", "#2f4858",
        ],
    },
    "bed": {
        "label": "Bed",
        "size": [3.0, 0.65, 2.0],
        "default_color": "#397ea5",
        "palette": [
            "#397ea5", "#9a4a5e", "#4f7a4a",
            "#7a5aa0", "#8a6a45", "#3a4b5c",
        ],
    },
    "tv": {
        "label": "Television",
        "size": [2.1, 1.4, 0.4],
        "default_color": "#161a22",
        "palette": [],
    },
    "fridge": {
        "label": "Refrigerator",
        "size": [1.2, 2.2, 1.1],
        "default_color": "#c5d3d6",
        "palette": ["#c5d3d6", "#22262a", "#9aa4a8"],
    },
    "stove": {
        "label": "Stove",
        "size": [1.5, 1.05, 1.05],
        "default_color": "#30353c",
        "palette": ["#e8e8e2", "#30353c", "#9aa4a8"],
    },
    "shower": {
        "label": "Shower",
        "size": [1.55, 2.15, 1.55],
        "default_color": "#7ad4e5",
        "palette": [],
    },
    "toilet": {
        "label": "Toilet",
        "size": [0.9, 0.75, 1.0],
        "default_color": "#f2f2eb",
        "palette": [],
    },
    "bathroom_sink": {
        "label": "Bathroom Sink",
        "size": [0.85, 0.95, 0.65],
        "default_color": "#eef0ec",
        "palette": [],
    },
    "kitchen_sink": {
        "label": "Kitchen Sink",
        "size": [1.2, 0.95, 0.85],
        "default_color": "#c9cdcf",
        "palette": [],
    },
    "dining_table": {
        "label": "Dining Table",
        "size": [1.8, 0.85, 1.05],
        "default_color": "#8a6a45",
        "palette": ["#8a6a45", "#6a4a2c", "#3a2a1a", "#a58a5f"],
    },
    "dining_chair": {
        "label": "Dining Chair",
        "size": [0.55, 0.95, 0.55],
        "default_color": "#6a4a2c",
        "palette": ["#8a6a45", "#6a4a2c", "#3a2a1a", "#5c4a6a", "#386179"],
    },
    "dresser": {
        "label": "Dresser",
        "size": [1.6, 1.1, 0.6],
        "default_color": "#6a4a2c",
        "palette": ["#8a6a45", "#6a4a2c", "#3a2a1a", "#dcd4c4"],
    },
    "lamp": {
        "label": "Floor Lamp",
        "size": [0.45, 1.6, 0.45],
        "default_color": "#e9dfc8",
        "palette": ["#e9dfc8", "#2f3438", "#8a4b5c"],
    },
}


WALL_PALETTE = [
    "#f1e5cf",  # warm white
    "#f3ead6",  # cream
    "#e3cfa8",  # sand
    "#cbb79e",  # taupe
    "#c9c9c4",  # soft gray
    "#4a4a48",  # charcoal
    "#aebfa4",  # muted sage
    "#9fb4c4",  # muted blue
    "#c4744c",  # terracotta accent
]

FLOOR_PALETTE = {
    "light_wood": "#d6b98c",
    "medium_wood": "#b08b5c",
    "dark_wood": "#6f4e2f",
    "warm_tile": "#c9a578",
    "cool_tile": "#b8bfc2",
    "stone": "#9c968c",
    "light_neutral": "#ded8cc",
    "dark_neutral": "#58534b",
}

DEFAULT_WALL = "#f1e5cf"
DEFAULT_FLOOR = "warm_tile"


def _default_ground_furniture():
    def item(iid, ftype, x, z, rot=0):
        return {
            "instance_id": iid,
            "type": ftype,
            "level": "ground",
            "x": x,
            "z": z,
            "rot": rot,
            "color": FURNITURE_CATALOG[ftype]["default_color"],
        }

    return [
        item("bed", "bed", -5.3, -4.6),
        item("shower", "shower", 5.8, -4.7),
        item("toilet", "toilet", 7.5, -2.8),
        item("bathroom_sink", "bathroom_sink", 4.4, -2.9),
        item("fridge", "fridge", -5.7, 4.4),
        item("stove", "stove", -3.8, 4.4),
        item("kitchen_sink", "kitchen_sink", -2.1, 4.4),
        item("sofa", "sofa", 4.6, 3.4),
        item("tv", "tv", 6.7, 0.9),
        item("dining_table", "dining_table", -1.2, 4.2),
        item("dining_chair", "dining_chair", -2.55, 4.2),
        item("dining_chair_2", "dining_chair", 0.15, 4.2),
        item("dresser", "dresser", -7.6, -2.6),
        item("lamp", "lamp", -8.0, 1.6),
    ]


def _built_levels(prop):
    above = int(prop.get("levels_above") or 1)
    below = int(prop.get("levels_below") or 0)
    keys = ["ground"]
    if above >= 2:
        keys.append("second")
    if above >= 3:
        keys.append("third")
    for i in range(1, below + 1):
        keys.append(f"b{i}")
    return keys


def default_blueprint(prop):
    levels = _built_levels(prop)
    return {
        "schema": BLUEPRINT_SCHEMA_VERSION,
        "version": 1,
        "wall_colors": {k: DEFAULT_WALL for k in levels},
        "floor_finishes": {k: DEFAULT_FLOOR for k in levels},
        # New non-ground levels start as finished empty flex space.
        "furniture": _default_ground_furniture(),
        "updated_at": _iso(),
    }


async def _ensure_blueprint(game_id, prop):
    bp = prop.get("blueprint")
    changed = False

    if not isinstance(bp, dict) or "furniture" not in bp:
        bp = default_blueprint(prop)
        changed = True

    # Backfill finishes for any newly built levels.
    for k in _built_levels(prop):
        if k not in (bp.get("wall_colors") or {}):
            bp.setdefault("wall_colors", {})[k] = DEFAULT_WALL
            changed = True
        if k not in (bp.get("floor_finishes") or {}):
            bp.setdefault("floor_finishes", {})[k] = DEFAULT_FLOOR
            changed = True

    if changed:
        await db.realmlife_properties.update_one(
            {"game_id": game_id, "id": prop["id"]},
            {"$set": {"blueprint": bp, "updated_at": _iso()}},
        )
        prop["blueprint"] = bp

    return bp


def _catalog_payload():
    return {
        "catalog": FURNITURE_CATALOG,
        "wall_palette": WALL_PALETTE,
        "floor_palette": FLOOR_PALETTE,
        "max_per_type": MAX_PER_TYPE,
        "bounds": {"x": BOUNDS_X, "z": BOUNDS_Z},
    }


async def get_blueprint(game_id, current, body):
    property_id = str((body or {}).get("property_id") or "")[:100]

    membership = await _membership(game_id, current["id"])

    if property_id:
        prop = await _property_by_id(game_id, property_id)
    else:
        prop = None
        if membership and membership.get("household_id"):
            prop = await db.realmlife_properties.find_one(
                {
                    "game_id": game_id,
                    "household_id": membership["household_id"],
                    "state": "owned",
                },
                {"_id": 0},
            )

    if not prop or prop.get("state") != "owned":
        raise HTTPException(404, "Property not found.")

    is_member = bool(
        membership
        and membership.get("household_id") == prop.get("household_id")
    )

    if is_member:
        level_access, mode = _guest_level_access(prop, True)
    else:
        access = await db.realmlife_property_access.find_one(
            {
                "game_id": game_id,
                "property_id": prop["id"],
                "user_id": current["id"],
                "status": "active",
            },
            {"_id": 0},
        )
        if not access:
            # Exterior-only parity for unauthorized observers.
            return {
                "property_id": prop["id"],
                "access": "exterior_only",
                "version": (prop.get("blueprint") or {}).get("version", 1),
                "levels_above": int(prop.get("levels_above") or 1),
                "levels_below": int(prop.get("levels_below") or 0),
                "furniture": [],
                "wall_colors": {},
                "floor_finishes": {},
                "level_access": {k: False for k in GUEST_LEVEL_KEYS},
                "is_member": False,
                **_catalog_payload(),
            }
        level_access, mode = _guest_level_access(prop, False)

    bp = await _ensure_blueprint(game_id, prop)

    allowed_levels = {
        k for k, ok in level_access.items() if ok
    }

    furniture = [
        f for f in bp.get("furniture", [])
        if f.get("level") in allowed_levels
    ]

    return {
        "property_id": prop["id"],
        "access": "member" if is_member else "guest",
        "version": bp.get("version", 1),
        "levels_above": int(prop.get("levels_above") or 1),
        "levels_below": int(prop.get("levels_below") or 0),
        "built_levels": _built_levels(prop),
        "furniture": furniture,
        "wall_colors": {
            k: v for k, v in (bp.get("wall_colors") or {}).items()
            if k in allowed_levels
        },
        "floor_finishes": {
            k: v for k, v in (bp.get("floor_finishes") or {}).items()
            if k in allowed_levels
        },
        "level_access": level_access,
        "is_member": is_member,
        **_catalog_payload(),
    }


def _validate_placement(ftype, level, x, z, rot, color, prop):
    if ftype not in FURNITURE_CATALOG:
        raise HTTPException(400, "Unknown furniture type.")

    if level not in _built_levels(prop):
        raise HTTPException(400, "That level is not built on this property.")

    try:
        x = round(float(x), 2)
        z = round(float(z), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid position.")

    if abs(x) > BOUNDS_X or abs(z) > BOUNDS_Z:
        raise HTTPException(
            400,
            "Furniture must stay inside the interior of the house.",
        )

    try:
        rot = int(rot or 0) % 360
    except (TypeError, ValueError):
        rot = 0
    rot = (rot // 15) * 15

    cat = FURNITURE_CATALOG[ftype]
    palette = cat["palette"]
    if not color:
        color = cat["default_color"]
    if palette and color not in palette and color != cat["default_color"]:
        raise HTTPException(400, "Color not available for this item.")
    if not palette:
        color = cat["default_color"]

    return x, z, rot, color


async def _save_blueprint(game_id, prop, bp):
    bp["version"] = int(bp.get("version", 1)) + 1
    bp["updated_at"] = _iso()
    await db.realmlife_properties.update_one(
        {"game_id": game_id, "id": prop["id"]},
        {"$set": {"blueprint": bp, "updated_at": _iso()}},
    )
    return bp


async def furniture_op(game_id, current, body):
    membership, prop = await _require_household_member(
        game_id, current["id"]
    )

    bp = await _ensure_blueprint(game_id, prop)
    furniture = bp.setdefault("furniture", [])

    op = str((body or {}).get("op") or "").lower()

    def find_instance(iid):
        for f in furniture:
            if f.get("instance_id") == iid:
                return f
        raise HTTPException(404, "Furniture instance not found.")

    def type_count(ftype):
        return sum(1 for f in furniture if f.get("type") == ftype)

    if op == "add":
        ftype = str(body.get("type") or "")
        level = str(body.get("level") or "ground")
        x, z, rot, color = _validate_placement(
            ftype, level,
            body.get("x", 0), body.get("z", 0),
            body.get("rot", 0), body.get("color"),
            prop,
        )
        if type_count(ftype) >= MAX_PER_TYPE:
            raise HTTPException(
                400,
                f"Limit reached — up to {MAX_PER_TYPE} "
                f"{FURNITURE_CATALOG[ftype]['label']}s per residence.",
            )
        inst = {
            "instance_id": _id("furn"),
            "type": ftype,
            "level": level,
            "x": x,
            "z": z,
            "rot": rot,
            "color": color,
        }
        furniture.append(inst)

    elif op == "update":
        inst = find_instance(str(body.get("instance_id") or ""))
        x, z, rot, color = _validate_placement(
            inst["type"],
            str(body.get("level") or inst.get("level") or "ground"),
            body.get("x", inst.get("x", 0)),
            body.get("z", inst.get("z", 0)),
            body.get("rot", inst.get("rot", 0)),
            body.get("color", inst.get("color")),
            prop,
        )
        inst.update({
            "x": x, "z": z, "rot": rot, "color": color,
            "level": str(body.get("level") or inst.get("level") or "ground"),
        })

    elif op == "duplicate":
        src = find_instance(str(body.get("instance_id") or ""))
        if type_count(src["type"]) >= MAX_PER_TYPE:
            raise HTTPException(
                400,
                f"Limit reached — up to {MAX_PER_TYPE} "
                f"{FURNITURE_CATALOG[src['type']]['label']}s per residence.",
            )
        nx = min(BOUNDS_X, float(src.get("x", 0)) + 1.4)
        nz = float(src.get("z", 0))
        inst = {
            "instance_id": _id("furn"),
            "type": src["type"],
            "level": src.get("level", "ground"),
            "x": round(nx, 2),
            "z": round(nz, 2),
            "rot": src.get("rot", 0),
            "color": src.get("color"),
        }
        furniture.append(inst)

    elif op == "remove":
        inst = find_instance(str(body.get("instance_id") or ""))
        furniture.remove(inst)

    else:
        raise HTTPException(400, "Unknown furniture operation.")

    bp = await _save_blueprint(game_id, prop, bp)

    return {
        "ok": True,
        "op": op,
        "version": bp["version"],
        "furniture": furniture,
        "instance_id": inst.get("instance_id") if op != "remove" else None,
    }


async def set_finish(game_id, current, body):
    membership, prop = await _require_household_member(
        game_id, current["id"]
    )

    level = str((body or {}).get("level") or "ground")

    if level not in _built_levels(prop):
        raise HTTPException(400, "That level is not built on this property.")

    bp = await _ensure_blueprint(game_id, prop)

    wall_color = (body or {}).get("wall_color")
    floor_finish = (body or {}).get("floor_finish")

    if not wall_color and not floor_finish:
        raise HTTPException(400, "Nothing to update.")

    if wall_color:
        if wall_color not in WALL_PALETTE:
            raise HTTPException(400, "Wall color not in the palette.")
        bp.setdefault("wall_colors", {})[level] = wall_color

    if floor_finish:
        if floor_finish not in FLOOR_PALETTE:
            raise HTTPException(400, "Floor finish not available.")
        bp.setdefault("floor_finishes", {})[level] = floor_finish

    bp = await _save_blueprint(game_id, prop, bp)

    return {
        "ok": True,
        "version": bp["version"],
        "wall_colors": bp.get("wall_colors", {}),
        "floor_finishes": bp.get("floor_finishes", {}),
    }
