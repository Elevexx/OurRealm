"""Meshy provider contract tests — no paid calls, no real key required."""
import os
import struct
import json as jsonlib

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE = os.environ["TEST_BASE_URL"] if os.environ.get("TEST_BASE_URL") else "http://localhost:8001"


@pytest.fixture(scope="module")
def founder_h():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "stealth", "password": "Password1$"}, timeout=20)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def member_h():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "auditcheckreal", "password": "Password1$"}, timeout=20)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_status_founder_only(founder_h, member_h):
    r = requests.get(f"{BASE}/api/admin/meshy/status", headers=founder_h, timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert d["placeholder"] is True and d["configured"] is False
    assert "MESHY_KEY_PENDING" not in str(d)  # secret value never echoed
    r2 = requests.get(f"{BASE}/api/admin/meshy/status", headers=member_h, timeout=20)
    assert r2.status_code == 403


def test_health_test_honest_placeholder(founder_h):
    r = requests.post(f"{BASE}/api/admin/meshy/health-test", headers=founder_h, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is False and "placeholder" in d["detail"]
    assert "MESHY_KEY_PENDING" not in str(d)  # never echo the value


def test_create_blocked_without_real_key(founder_h):
    r = requests.post(f"{BASE}/api/admin/meshy/tasks", headers=founder_h, timeout=20,
                      json={"workflow": "text_preview", "idem_key": "unit-test-0001",
                            "payload": {"mode": "preview", "prompt": "x", "target_formats": ["glb"]}})
    assert r.status_code == 503


def test_glb_validator():
    import sys
    sys.path.insert(0, "/app/backend")
    from services.meshy_provider import validate_glb, MeshyError
    doc = jsonlib.dumps({"asset": {"version": "2.0"}, "meshes": [{"primitives": []}],
                         "materials": [{}], "nodes": [{}]}).encode()
    pad = (4 - len(doc) % 4) % 4
    doc += b" " * pad
    glb = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(doc)) + struct.pack("<II", len(doc), 0x4E4F534A) + doc
    meta = validate_glb(glb)
    assert meta["meshes"] == 1 and meta["version"] == 2 and meta["checksum"]
    with pytest.raises(MeshyError):
        validate_glb(b"NOPE" + b"\x00" * 40)
    with pytest.raises(MeshyError):  # no meshes
        d2 = jsonlib.dumps({"asset": {"version": "2.0"}}).encode()
        d2 += b" " * ((4 - len(d2) % 4) % 4)
        validate_glb(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(d2)) + struct.pack("<II", len(d2), 0x4E4F534A) + d2)
