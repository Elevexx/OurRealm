"""Nexus world model: greybox schema, default plaza, validated structured ops.
No eval / new Function — every edit is a whitelisted, schema-checked operation
that returns inverse ops for undo. Draft vs published lives in nexus_worlds."""
import copy
import uuid
from datetime import datetime, timezone

WORLD_ID = "nexus-v1"
ENTITY_TYPES = {"box", "ramp", "pillar", "light", "portal", "npc"}
MAX_ENTITIES_PER_ZONE = 400
MAX_ZONE_SIZE = 400


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _eid():
    return "e_" + uuid.uuid4().hex[:10]


def default_world():
    ents = [
        {"id": "e_fountain", "type": "pillar", "pos": [0, 0, 0], "rot": [0, 0, 0],
         "scale": [3, 2.2, 3], "color": "#3f6f8f", "props": {"label": "Plaza Fountain"}},
        {"id": "e_stage", "type": "box", "pos": [-14, 0, -10], "rot": [0, 0.4, 0],
         "scale": [8, 1.2, 6], "color": "#4a4f66", "props": {"label": "Event Stage"}},
        {"id": "e_ramp1", "type": "ramp", "pos": [-8, 0, -10], "rot": [0, 1.97, 0],
         "scale": [4, 1.2, 3], "color": "#5a6079", "props": {}},
        {"id": "e_market", "type": "box", "pos": [13, 0, -8], "rot": [0, -0.5, 0],
         "scale": [6, 2.4, 4], "color": "#5f4a66", "props": {"label": "Market Hall"}},
        {"id": "e_tower", "type": "pillar", "pos": [16, 0, 12], "rot": [0, 0, 0],
         "scale": [2.2, 7, 2.2], "color": "#39506b", "props": {"label": "Watch Tower"}},
        {"id": "e_bench1", "type": "box", "pos": [4, 0, 9], "rot": [0, 0.8, 0],
         "scale": [2.4, 0.6, 0.9], "color": "#6b5a3f", "props": {}},
        {"id": "e_bench2", "type": "box", "pos": [-6, 0, 10], "rot": [0, -0.6, 0],
         "scale": [2.4, 0.6, 0.9], "color": "#6b5a3f", "props": {}},
        {"id": "e_light1", "type": "light", "pos": [-10, 0, 6], "rot": [0, 0, 0],
         "scale": [1, 1, 1], "color": "#ffd9a0", "props": {"intensity": 18}},
        {"id": "e_light2", "type": "light", "pos": [10, 0, 6], "rot": [0, 0, 0],
         "scale": [1, 1, 1], "color": "#a0d9ff", "props": {"intensity": 18}},
        {"id": "e_portal_arcane", "type": "portal", "pos": [0, 0, -22], "rot": [0, 0, 0],
         "scale": [1, 1, 1], "color": "#37c8ff",
         "props": {"label": "World Kitchen Quest", "action": "game",
                   "game_id": "wkq-arcane-hearth-3d-v1"}},
        {"id": "e_portal_north", "type": "portal", "pos": [-22, 0, 0], "rot": [0, 1.57, 0],
         "scale": [1, 1, 1], "color": "#2ee87a",
         "props": {"label": "Emerald Gardens (Expansion)", "action": "expansion"}},
        {"id": "e_portal_east", "type": "portal", "pos": [22, 0, 0], "rot": [0, -1.57, 0],
         "scale": [1, 1, 1], "color": "#c26bff",
         "props": {"label": "Skyway District (Expansion)", "action": "expansion"}},
        {"id": "e_npc_guide", "type": "npc", "pos": [3, 0, -4], "rot": [0, -0.7, 0],
         "scale": [1, 1, 1], "color": "#e8c07a",
         "props": {"label": "Nexus Guide", "dialog": "Welcome to the OurRealm Nexus! Expansion portals open soon."}},
    ]
    return {
        "zones": [{
            "id": "plaza", "name": "Community Plaza", "sky": "#101a30",
            "ground_color": "#2c3450", "size": [80, 80], "spawn": {"x": 0, "z": 16},
            "ambient": 0.55, "sun": 1.1, "entities": ents,
        }],
        "meta": {"name": "OurRealm Nexus", "created_at": _iso()},
    }


def _num_list(v, n, lo=-500, hi=500):
    if not isinstance(v, (list, tuple)) or len(v) != n:
        raise ValueError("bad vector")
    out = []
    for x in v:
        x = float(x)
        if not (lo <= x <= hi):
            raise ValueError("out of bounds")
        out.append(round(x, 3))
    return out


def _clean_entity(e):
    if e.get("type") not in ENTITY_TYPES:
        raise ValueError(f"unknown entity type {e.get('type')}")
    props = e.get("props") or {}
    if not isinstance(props, dict):
        raise ValueError("props must be object")
    safe_props = {}
    for k in ("label", "action", "game_id", "target_zone", "dialog", "intensity"):
        if k in props:
            v = props[k]
            safe_props[k] = float(v) if k == "intensity" else str(v)[:200]
    color = str(e.get("color") or "#888888")[:9]
    if not color.startswith("#"):
        raise ValueError("bad color")
    return {
        "id": str(e.get("id") or _eid())[:24],
        "type": e["type"],
        "pos": _num_list(e.get("pos") or [0, 0, 0], 3),
        "rot": _num_list(e.get("rot") or [0, 0, 0], 3, -7, 7),
        "scale": _num_list(e.get("scale") or [1, 1, 1], 3, 0.05, 60),
        "color": color,
        "props": safe_props,
    }


def _zone(world, zone_id):
    for z in world["zones"]:
        if z["id"] == zone_id:
            return z
    raise ValueError(f"zone {zone_id} not found")


def apply_ops(world, ops):
    """Mutates a copy of world. Returns (new_world, inverse_ops, summary)."""
    if not isinstance(ops, list) or not ops or len(ops) > 40:
        raise ValueError("ops must be a list of 1-40 operations")
    w = copy.deepcopy(world)
    inverse = []
    summary = []
    for op in ops:
        kind = op.get("op")
        if kind == "add_entity":
            z = _zone(w, op.get("zone_id"))
            if len(z["entities"]) >= MAX_ENTITIES_PER_ZONE:
                raise ValueError("zone entity limit reached")
            e = _clean_entity(op.get("entity") or {})
            if any(x["id"] == e["id"] for x in z["entities"]):
                e["id"] = _eid()
            z["entities"].append(e)
            inverse.insert(0, {"op": "remove_entity", "zone_id": z["id"], "entity_id": e["id"]})
            summary.append(f"add {e['type']} {e['id']}")
        elif kind == "update_entity":
            z = _zone(w, op.get("zone_id"))
            ent = next((x for x in z["entities"] if x["id"] == op.get("entity_id")), None)
            if not ent:
                raise ValueError(f"entity {op.get('entity_id')} not found")
            before = copy.deepcopy(ent)
            fields = op.get("fields") or {}
            merged = {**ent, **{k: v for k, v in fields.items()
                                if k in ("pos", "rot", "scale", "color", "props", "type")}}
            if "props" in fields:
                merged["props"] = {**ent.get("props", {}), **(fields["props"] or {})}
            cleaned = _clean_entity(merged)
            cleaned["id"] = ent["id"]
            z["entities"][z["entities"].index(ent)] = cleaned
            inverse.insert(0, {"op": "update_entity", "zone_id": z["id"],
                               "entity_id": ent["id"],
                               "fields": {k: before[k] for k in ("pos", "rot", "scale", "color", "props")}})
            summary.append(f"update {ent['id']}")
        elif kind == "remove_entity":
            z = _zone(w, op.get("zone_id"))
            ent = next((x for x in z["entities"] if x["id"] == op.get("entity_id")), None)
            if not ent:
                raise ValueError(f"entity {op.get('entity_id')} not found")
            z["entities"].remove(ent)
            inverse.insert(0, {"op": "add_entity", "zone_id": z["id"], "entity": ent})
            summary.append(f"remove {ent['id']}")
        elif kind == "update_zone":
            z = _zone(w, op.get("zone_id"))
            fields = op.get("fields") or {}
            before = {k: z.get(k) for k in ("sky", "ground_color", "name", "ambient", "sun", "spawn")}
            for k in ("sky", "ground_color", "name"):
                if k in fields:
                    z[k] = str(fields[k])[:60]
            for k in ("ambient", "sun"):
                if k in fields:
                    try:
                        z[k] = max(0.0, min(3.0, float(fields[k])))
                    except (TypeError, ValueError):
                        raise ValueError(f"bad {k} value")
            if "spawn" in fields and isinstance(fields["spawn"], dict):
                z["spawn"] = {"x": float(fields["spawn"].get("x", 0)), "z": float(fields["spawn"].get("z", 0))}
            inverse.insert(0, {"op": "update_zone", "zone_id": z["id"], "fields": before})
            summary.append(f"zone {z['id']} settings")
        elif kind == "add_zone":
            zd = op.get("zone") or {}
            zid = str(zd.get("id") or ("zone_" + uuid.uuid4().hex[:6]))[:24]
            if any(z["id"] == zid for z in w["zones"]):
                raise ValueError("zone id exists")
            size = _num_list(zd.get("size") or [60, 60], 2, 10, MAX_ZONE_SIZE)
            w["zones"].append({"id": zid, "name": str(zd.get("name") or zid)[:60],
                               "sky": str(zd.get("sky") or "#101a30")[:9],
                               "ground_color": str(zd.get("ground_color") or "#2c3450")[:9],
                               "size": size, "spawn": {"x": 0, "z": 0},
                               "ambient": 0.55, "sun": 1.1,
                               "entities": [_clean_entity(e) for e in (zd.get("entities") or [])[:50]]})
            inverse.insert(0, {"op": "remove_zone", "zone_id": zid})
            summary.append(f"add zone {zid}")
        elif kind == "remove_zone":
            z = _zone(w, op.get("zone_id"))
            if len(w["zones"]) <= 1:
                raise ValueError("cannot remove the last zone")
            w["zones"].remove(z)
            inverse.insert(0, {"op": "add_zone", "zone": z})
            summary.append(f"remove zone {z['id']}")
        else:
            raise ValueError(f"unknown op {kind}")
    return w, inverse, summary
