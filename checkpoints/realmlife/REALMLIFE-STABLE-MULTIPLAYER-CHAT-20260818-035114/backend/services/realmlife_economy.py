"""RealmLife server-authoritative Fire Power economy.

Fire Power is an internal OurRealm engagement resource.

RealmLife maintains a game-specific allocation separate from the
user's main Fire Vault.

Rules:
- First RealmLife entry: +500 RealmLife Fire Power, once.
- Vault -> RealmLife: user-authorized, atomic Vault decrement.
- Build/Buy: server-authoritative Fire Power requirement.
- Active play: +1 RealmLife Fire Power per qualified REAL minute.
- Background / hidden / idle heartbeats earn nothing.
- Client never chooses reward values or Build/Buy costs.
"""

import time
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.db import db


STARTER_FIRE = 500
ACTIVE_SECONDS_PER_FIRE = 60

# Browser sends heartbeats roughly every 15 seconds.
# Larger gaps do not accrue, preventing background catch-up.
MAX_QUALIFIED_GAP_SECONDS = 35
MAX_CREDITED_HEARTBEAT_SECONDS = 20


# Server-authoritative Build / Buy catalog.
#
# Aliases are included because the prototype UI has changed names
# during development. The server remains authoritative either way.
BUILD_COSTS = {
    "chair": 80,
    "cozy_chair": 80,

    "plant": 35,
    "house_plant": 35,

    "bookcase": 120,
}

# Server-authoritative household interaction requirements.
ACTION_COSTS = {
    "snack": 5,
    "cook": 10,
}


def _iso():
    return datetime.now(
        timezone.utc
    ).isoformat()


async def ensure_indexes():
    await db.realmlife_accounts.create_index(
        [
            ("game_id", 1),
            ("user_id", 1),
        ],
        unique=True,
    )

    await db.realmlife_fire_ledger.create_index(
        "id",
        unique=True,
    )

    await db.realmlife_fire_ledger.create_index(
        "idempotency_key",
        unique=True,
        sparse=True,
    )

    await db.realmlife_fire_ledger.create_index(
        [
            ("game_id", 1),
            ("user_id", 1),
            ("created_at", -1),
        ]
    )


async def _insert_ledger(
    *,
    game_id,
    user_id,
    username,
    kind,
    amount,
    idempotency_key=None,
    status="completed",
    balance_after=None,
    meta=None,
):
    doc = {
        "id": uuid.uuid4().hex,
        "game_id": game_id,
        "user_id": user_id,
        "username": username,
        "kind": kind,
        "amount": int(amount),
        "status": status,
        "created_at": _iso(),
        "meta": meta or {},
    }

    if idempotency_key:
        doc["idempotency_key"] = (
            str(idempotency_key)[:160]
        )

    if balance_after is not None:
        doc["balance_after"] = int(
            balance_after
        )

    await db.realmlife_fire_ledger.insert_one(
        doc
    )

    return doc


async def ensure_account(
    game_id: str,
    current: dict,
):
    """Create the player's RealmLife account exactly once."""

    await ensure_indexes()

    uid = current["id"]
    username = current.get("username")

    now = _iso()

    result = await db.realmlife_accounts.update_one(
        {
            "game_id": game_id,
            "user_id": uid,
        },
        {
            "$setOnInsert": {
                "game_id": game_id,
                "user_id": uid,
                "username": username,

                "fire_balance": STARTER_FIRE,
                "starter_fire_granted":
                    STARTER_FIRE,

                "lifetime_active_fire": 0,
                "lifetime_vault_transferred": 0,
                "lifetime_fire_burned": 0,

                "active_seconds_carry": 0.0,

                "last_heartbeat_ts": None,
                "last_heartbeat_qualified":
                    False,
                "last_active_at": None,

                "created_at": now,
                "updated_at": now,
            }
        },
        upsert=True,
    )

    if result.upserted_id is not None:
        try:
            await _insert_ledger(
                game_id=game_id,
                user_id=uid,
                username=username,
                kind="starter_grant",
                amount=STARTER_FIRE,
                idempotency_key=(
                    f"realmlife:starter:"
                    f"{game_id}:{uid}"
                ),
                status="completed",
                balance_after=STARTER_FIRE,
                meta={
                    "source":
                        "first_realmlife_entry"
                },
            )
        except DuplicateKeyError:
            # Account uniqueness already prevents a second grant.
            pass

    return await db.realmlife_accounts.find_one(
        {
            "game_id": game_id,
            "user_id": uid,
        },
        {"_id": 0},
    )


async def account_status(
    game_id: str,
    current: dict,
):
    account = await ensure_account(
        game_id,
        current,
    )

    wallet = await db.fire_wallets.find_one(
        {"user_id": current["id"]},
        {
            "_id": 0,
            "vault_balance": 1,
        },
    ) or {}

    return {
        "game_id": game_id,

        "fire_balance": int(
            account.get("fire_balance") or 0
        ),

        "vault_balance": int(
            wallet.get("vault_balance") or 0
        ),

        "starter_fire": STARTER_FIRE,

        "active_play": {
            "fire_per_minute": 1,
            "seconds_per_fire":
                ACTIVE_SECONDS_PER_FIRE,
            "background_earnings": False,
            "idle_earnings": False,
        },

        "build_costs": BUILD_COSTS,
        "action_costs": ACTION_COSTS,
    }


async def transfer_from_vault(
    game_id: str,
    current: dict,
    amount,
    idempotency_key,
):
    """Move existing Fire Power from Fire Vault into RealmLife."""

    await ensure_account(
        game_id,
        current,
    )

    uid = current["id"]
    username = current.get("username")

    try:
        amount = int(amount)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Invalid Fire Power amount",
        )

    if amount < 1:
        raise HTTPException(
            status_code=400,
            detail=(
                "Transfer at least 1 Fire Power."
            ),
        )

    if amount > 1_000_000:
        raise HTTPException(
            status_code=400,
            detail=(
                "Transfer is above the "
                "RealmLife safety limit."
            ),
        )

    idem = str(
        idempotency_key or ""
    ).strip()[:160]

    if not idem:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing idempotency key."
            ),
        )

    idem = (
        f"realmlife:vault-transfer:"
        f"{game_id}:{uid}:{idem}"
    )

    # Reserve the operation before touching the Vault.
    try:
        reservation = await _insert_ledger(
            game_id=game_id,
            user_id=uid,
            username=username,
            kind="vault_transfer",
            amount=amount,
            idempotency_key=idem,
            status="reserved",
            meta={
                "source": "fire_vault",
                "destination":
                    "realmlife",
            },
        )
    except DuplicateKeyError:
        previous = (
            await db.realmlife_fire_ledger
            .find_one(
                {"idempotency_key": idem},
                {"_id": 0},
            )
        )

        account = (
            await db.realmlife_accounts
            .find_one(
                {
                    "game_id": game_id,
                    "user_id": uid,
                },
                {
                    "_id": 0,
                    "fire_balance": 1,
                },
            )
        ) or {}

        return {
            "ok": (
                previous
                and previous.get("status")
                == "completed"
            ),
            "duplicate": True,
            "status": (
                previous or {}
            ).get("status"),
            "fire_balance": int(
                account.get(
                    "fire_balance"
                ) or 0
            ),
        }

    # Atomic conditional Fire Vault decrement.
    vault_result = (
        await db.fire_wallets.update_one(
            {
                "user_id": uid,
                "vault_balance": {
                    "$gte": amount
                },
            },
            {
                "$inc": {
                    "vault_balance":
                        -amount
                }
            },
        )
    )

    if vault_result.modified_count != 1:
        await db.realmlife_fire_ledger.delete_one(
            {"id": reservation["id"]}
        )

        wallet = (
            await db.fire_wallets.find_one(
                {"user_id": uid},
                {
                    "_id": 0,
                    "vault_balance": 1,
                },
            )
        ) or {}

        raise HTTPException(
            status_code=409,
            detail=(
                f"This transfer requires "
                f"{amount:,} Fire Power in "
                f"your Fire Vault. "
                f"Your Vault currently has "
                f"{int(wallet.get('vault_balance') or 0):,}."
            ),
        )

    try:
        await db.realmlife_accounts.update_one(
            {
                "game_id": game_id,
                "user_id": uid,
            },
            {
                "$inc": {
                    "fire_balance": amount,
                    "lifetime_vault_transferred":
                        amount,
                },
                "$set": {
                    "updated_at": _iso(),
                },
            },
        )

    except Exception:
        # Compensating rollback if RealmLife credit fails.
        await db.fire_wallets.update_one(
            {"user_id": uid},
            {
                "$inc": {
                    "vault_balance": amount
                }
            },
        )

        await db.realmlife_fire_ledger.update_one(
            {"id": reservation["id"]},
            {
                "$set": {
                    "status":
                        "rolled_back",
                    "updated_at":
                        _iso(),
                }
            },
        )

        raise

    account = (
        await db.realmlife_accounts.find_one(
            {
                "game_id": game_id,
                "user_id": uid,
            },
            {
                "_id": 0,
                "fire_balance": 1,
            },
        )
    ) or {}

    balance = int(
        account.get("fire_balance") or 0
    )

    await db.realmlife_fire_ledger.update_one(
        {"id": reservation["id"]},
        {
            "$set": {
                "status": "completed",
                "balance_after": balance,
                "updated_at": _iso(),
            }
        },
    )

    wallet = (
        await db.fire_wallets.find_one(
            {"user_id": uid},
            {
                "_id": 0,
                "vault_balance": 1,
            },
        )
    ) or {}

    return {
        "ok": True,
        "transferred": amount,
        "fire_balance": balance,
        "vault_balance": int(
            wallet.get("vault_balance") or 0
        ),
    }



async def withdraw_to_vault(
    game_id: str,
    current: dict,
    amount,
    idempotency_key,
):
    """Return RealmLife Fire Power to the user's OurRealm Fire Vault.

    Rules:
    - Any positive whole-number amount.
    - Cannot exceed RealmLife balance.
    - No cooldown.
    - No fee.
    - Atomic RealmLife conditional decrement.
    - Vault credit is server-side only.
    - Compensating rollback if Vault credit fails.
    - Idempotent against retries / double clicks.
    """

    await ensure_account(
        game_id,
        current,
    )

    uid = current["id"]
    username = current.get("username")

    try:
        amount = int(amount)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Invalid Fire Power amount",
        )

    if amount < 1:
        raise HTTPException(
            status_code=400,
            detail="Withdraw at least 1 Fire Power.",
        )

    if amount > 1_000_000:
        raise HTTPException(
            status_code=400,
            detail=(
                "Withdrawal is above the "
                "RealmLife safety limit."
            ),
        )

    idem = str(
        idempotency_key or ""
    ).strip()[:160]

    if not idem:
        raise HTTPException(
            status_code=400,
            detail="Missing idempotency key.",
        )

    idem = (
        f"realmlife:vault-withdraw:"
        f"{game_id}:{uid}:{idem}"
    )

    # --------------------------------------------------------
    # Reserve transaction first.
    # --------------------------------------------------------

    try:
        reservation = await _insert_ledger(
            game_id=game_id,
            user_id=uid,
            username=username,
            kind="vault_withdrawal",
            amount=-amount,
            idempotency_key=idem,
            status="reserved",
            meta={
                "source": "realmlife",
                "destination": "fire_vault",
            },
        )

    except DuplicateKeyError:
        previous = (
            await db.realmlife_fire_ledger
            .find_one(
                {"idempotency_key": idem},
                {"_id": 0},
            )
        )

        account = (
            await db.realmlife_accounts
            .find_one(
                {
                    "game_id": game_id,
                    "user_id": uid,
                },
                {
                    "_id": 0,
                    "fire_balance": 1,
                },
            )
        ) or {}

        wallet = (
            await db.fire_wallets
            .find_one(
                {"user_id": uid},
                {
                    "_id": 0,
                    "vault_balance": 1,
                },
            )
        ) or {}

        return {
            "ok": (
                previous
                and previous.get("status")
                == "completed"
            ),
            "duplicate": True,
            "status": (
                previous or {}
            ).get("status"),
            "fire_balance": int(
                account.get("fire_balance") or 0
            ),
            "vault_balance": int(
                wallet.get("vault_balance") or 0
            ),
        }

    # --------------------------------------------------------
    # Atomic conditional RealmLife debit.
    # --------------------------------------------------------

    debit = (
        await db.realmlife_accounts.update_one(
            {
                "game_id": game_id,
                "user_id": uid,
                "fire_balance": {
                    "$gte": amount
                },
            },
            {
                "$inc": {
                    "fire_balance": -amount,
                },
                "$set": {
                    "updated_at": _iso(),
                },
            },
        )
    )

    if debit.modified_count != 1:
        await db.realmlife_fire_ledger.delete_one(
            {"id": reservation["id"]}
        )

        account = (
            await db.realmlife_accounts
            .find_one(
                {
                    "game_id": game_id,
                    "user_id": uid,
                },
                {
                    "_id": 0,
                    "fire_balance": 1,
                },
            )
        ) or {}

        balance = int(
            account.get("fire_balance") or 0
        )

        raise HTTPException(
            status_code=409,
            detail=(
                f"You requested {amount:,} Fire Power "
                f"but your RealmLife balance is "
                f"{balance:,}."
            ),
        )

    # --------------------------------------------------------
    # Credit the user's real OurRealm Fire Vault.
    # --------------------------------------------------------

    try:
        await db.fire_wallets.update_one(
            {"user_id": uid},
            {
                "$inc": {
                    "vault_balance": amount,
                }
            },
            upsert=True,
        )

    except Exception:
        # Restore RealmLife balance if Vault credit fails.
        await db.realmlife_accounts.update_one(
            {
                "game_id": game_id,
                "user_id": uid,
            },
            {
                "$inc": {
                    "fire_balance": amount,
                },
                "$set": {
                    "updated_at": _iso(),
                },
            },
        )

        await db.realmlife_fire_ledger.update_one(
            {"id": reservation["id"]},
            {
                "$set": {
                    "status": "rolled_back",
                    "updated_at": _iso(),
                }
            },
        )

        raise

    account = (
        await db.realmlife_accounts.find_one(
            {
                "game_id": game_id,
                "user_id": uid,
            },
            {
                "_id": 0,
                "fire_balance": 1,
            },
        )
    ) or {}

    wallet = (
        await db.fire_wallets.find_one(
            {"user_id": uid},
            {
                "_id": 0,
                "vault_balance": 1,
            },
        )
    ) or {}

    fire_balance = int(
        account.get("fire_balance") or 0
    )

    vault_balance = int(
        wallet.get("vault_balance") or 0
    )

    await db.realmlife_fire_ledger.update_one(
        {"id": reservation["id"]},
        {
            "$set": {
                "status": "completed",
                "balance_after": fire_balance,
                "updated_at": _iso(),
                "meta": {
                    "source": "realmlife",
                    "destination": "fire_vault",
                    "vault_balance_after":
                        vault_balance,
                },
            }
        },
    )

    return {
        "ok": True,
        "withdrawn": amount,
        "fire_balance": fire_balance,
        "vault_balance": vault_balance,
    }


async def burn_for_build(
    game_id: str,
    current: dict,
    item_id,
    idempotency_key,
):
    """Burn RealmLife Fire Power for a server-priced Build/Buy item."""

    await ensure_account(
        game_id,
        current,
    )

    uid = current["id"]
    username = current.get("username")

    item_id = str(
        item_id or ""
    ).strip().lower()[:80]

    cost = BUILD_COSTS.get(item_id)

    if cost is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unknown RealmLife "
                "Build / Upgrade item."
            ),
        )

    idem = str(
        idempotency_key or ""
    ).strip()[:160]

    if not idem:
        raise HTTPException(
            status_code=400,
            detail=(
                "Missing idempotency key."
            ),
        )

    idem = (
        f"realmlife:build:"
        f"{game_id}:{uid}:{idem}"
    )

    try:
        reservation = await _insert_ledger(
            game_id=game_id,
            user_id=uid,
            username=username,
            kind="build_burn",
            amount=-cost,
            idempotency_key=idem,
            status="reserved",
            meta={
                "item_id": item_id,
                "fire_power_required":
                    cost,
            },
        )

    except DuplicateKeyError:
        previous = (
            await db.realmlife_fire_ledger
            .find_one(
                {"idempotency_key": idem},
                {"_id": 0},
            )
        )

        account = (
            await db.realmlife_accounts
            .find_one(
                {
                    "game_id": game_id,
                    "user_id": uid,
                },
                {
                    "_id": 0,
                    "fire_balance": 1,
                },
            )
        ) or {}

        return {
            "ok": (
                previous
                and previous.get("status")
                == "completed"
            ),
            "duplicate": True,
            "status": (
                previous or {}
            ).get("status"),
            "fire_balance": int(
                account.get(
                    "fire_balance"
                ) or 0
            ),
            "cost": cost,
        }

    result = (
        await db.realmlife_accounts.update_one(
            {
                "game_id": game_id,
                "user_id": uid,
                "fire_balance": {
                    "$gte": cost
                },
            },
            {
                "$inc": {
                    "fire_balance": -cost,
                    "lifetime_fire_burned":
                        cost,
                },
                "$set": {
                    "updated_at": _iso(),
                },
            },
        )
    )

    if result.modified_count != 1:
        await db.realmlife_fire_ledger.delete_one(
            {"id": reservation["id"]}
        )

        account = (
            await db.realmlife_accounts
            .find_one(
                {
                    "game_id": game_id,
                    "user_id": uid,
                },
                {
                    "_id": 0,
                    "fire_balance": 1,
                },
            )
        ) or {}

        balance = int(
            account.get("fire_balance") or 0
        )

        raise HTTPException(
            status_code=409,
            detail=(
                f"{cost:,} Fire Power "
                f"Required. RealmLife "
                f"balance: {balance:,}."
            ),
        )

    account = (
        await db.realmlife_accounts.find_one(
            {
                "game_id": game_id,
                "user_id": uid,
            },
            {
                "_id": 0,
                "fire_balance": 1,
            },
        )
    ) or {}

    balance = int(
        account.get("fire_balance") or 0
    )

    await db.realmlife_fire_ledger.update_one(
        {"id": reservation["id"]},
        {
            "$set": {
                "status": "completed",
                "balance_after": balance,
                "updated_at": _iso(),
            }
        },
    )

    return {
        "ok": True,
        "item_id": item_id,
        "fire_power_required": cost,
        "burned": cost,
        "fire_balance": balance,
    }



async def burn_for_action(
    game_id: str,
    current: dict,
    action_id,
    idempotency_key,
):
    """Burn RealmLife Fire for a household interaction."""

    await ensure_account(game_id, current)

    uid = current["id"]
    username = current.get("username")

    action_id = str(
        action_id or ""
    ).strip().lower()[:80]

    cost = ACTION_COSTS.get(action_id)

    if cost is None:
        raise HTTPException(
            status_code=400,
            detail="Unknown RealmLife interaction.",
        )

    idem = str(
        idempotency_key or ""
    ).strip()[:160]

    if not idem:
        raise HTTPException(
            status_code=400,
            detail="Missing idempotency key.",
        )

    idem = (
        f"realmlife:action:"
        f"{game_id}:{uid}:{idem}"
    )

    try:
        reservation = await _insert_ledger(
            game_id=game_id,
            user_id=uid,
            username=username,
            kind="interaction_burn",
            amount=-cost,
            idempotency_key=idem,
            status="reserved",
            meta={
                "action_id": action_id,
                "fire_power_required": cost,
            },
        )

    except DuplicateKeyError:
        previous = await db.realmlife_fire_ledger.find_one(
            {"idempotency_key": idem},
            {"_id": 0},
        )

        account = await db.realmlife_accounts.find_one(
            {
                "game_id": game_id,
                "user_id": uid,
            },
            {
                "_id": 0,
                "fire_balance": 1,
            },
        ) or {}

        return {
            "ok": (
                previous
                and previous.get("status")
                == "completed"
            ),
            "duplicate": True,
            "status": (previous or {}).get("status"),
            "fire_balance": int(
                account.get("fire_balance") or 0
            ),
            "fire_power_required": cost,
        }

    result = await db.realmlife_accounts.update_one(
        {
            "game_id": game_id,
            "user_id": uid,
            "fire_balance": {"$gte": cost},
        },
        {
            "$inc": {
                "fire_balance": -cost,
                "lifetime_fire_burned": cost,
            },
            "$set": {
                "updated_at": _iso(),
            },
        },
    )

    if result.modified_count != 1:
        await db.realmlife_fire_ledger.delete_one(
            {"id": reservation["id"]}
        )

        account = await db.realmlife_accounts.find_one(
            {
                "game_id": game_id,
                "user_id": uid,
            },
            {
                "_id": 0,
                "fire_balance": 1,
            },
        ) or {}

        balance = int(
            account.get("fire_balance") or 0
        )

        raise HTTPException(
            status_code=409,
            detail=(
                f"{cost:,} Fire Power Required. "
                f"RealmLife balance: {balance:,}."
            ),
        )

    account = await db.realmlife_accounts.find_one(
        {
            "game_id": game_id,
            "user_id": uid,
        },
        {
            "_id": 0,
            "fire_balance": 1,
        },
    ) or {}

    balance = int(
        account.get("fire_balance") or 0
    )

    await db.realmlife_fire_ledger.update_one(
        {"id": reservation["id"]},
        {
            "$set": {
                "status": "completed",
                "balance_after": balance,
                "updated_at": _iso(),
            }
        },
    )

    return {
        "ok": True,
        "action_id": action_id,
        "fire_power_required": cost,
        "burned": cost,
        "fire_balance": balance,
    }


async def active_heartbeat(
    game_id: str,
    current: dict,
    *,
    visible: bool,
    focused: bool,
    active: bool,
):
    """
    RealmLife active-play earning authority.

    RULE:
      +1 RealmLife Fire Power
      per ACTIVE RealmLife minute.

    The browser only reports whether the game is currently
    visible/focused/active.

    RealmLife elapsed minutes are derived SERVER-SIDE from the
    authoritative RealmLife environment clock.

    No inactive/background catch-up is permitted.
    """

    from datetime import (
        datetime,
        timezone,
    )

    import uuid

    from services import (
        realmlife_environment
        as rlenv
    )


    await ensure_account(game_id, current)


    account_filter = {
        "game_id":
            game_id,

        "user_id":
            current["id"],
    }


    account = await (
        db.realmlife_accounts
        .find_one(
            account_filter
        )
    )

    if not account:
        # Account ensure just ran. Re-read once.
        account = await (
            db.realmlife_accounts
            .find_one(
                account_filter
            )
        )

    if not account:
        raise RuntimeError(
            "RealmLife account unavailable."
        )


    now = datetime.now(
        timezone.utc
    )

    now_iso = (
        now.isoformat()
    )


    qualified = bool(
        visible
        and focused
        and active
    )


    raw_previous = (
        account.get(
            "active_reward_heartbeat_at"
        )
    )

    previous_qualified = bool(
        account.get(
            "active_reward_qualified",
            False,
        )
    )


    previous_time = None

    if raw_previous:
        try:
            previous_time = (
                datetime.fromisoformat(
                    str(
                        raw_previous
                    ).replace(
                        "Z",
                        "+00:00",
                    )
                )
            )

            if (
                previous_time
                .tzinfo
                is None
            ):
                previous_time = (
                    previous_time
                    .replace(
                        tzinfo=
                            timezone.utc
                    )
                )

        except Exception:
            previous_time = None


    elapsed_seconds = 0.0

    if previous_time:
        elapsed_seconds = max(
            0.0,
            (
                now
                - previous_time
            ).total_seconds(),
        )


    # Frontend heartbeat is every 5 seconds.
    #
    # A large gap means the browser slept, disconnected,
    # backgrounded, or stopped heartbeating.
    #
    # NEVER reward that missing period afterward.
    MAX_REWARD_GAP_SECONDS = 12.0


    credited_realm_minutes = 0.0


    if (
        qualified
        and previous_qualified
        and elapsed_seconds > 0
        and elapsed_seconds
            <= MAX_REWARD_GAP_SECONDS
    ):
        realm_rate = float(
            await (
                rlenv
                .realm_minutes_per_real_second(
                    game_id
                )
            )
        )

        realm_rate = max(
            0.0001,
            min(
                100.0,
                realm_rate,
            ),
        )

        credited_realm_minutes = (
            elapsed_seconds
            * realm_rate
        )


    carry = float(
        account.get(
            "active_realm_minute_carry",
            0.0,
        )
        or 0.0
    )


    total_minutes = (
        carry
        + credited_realm_minutes
    )


    earned = int(
        total_minutes
    )


    remaining_carry = (
        total_minutes
        - earned
    )


    update_filter = {
        **account_filter,
    }


    if raw_previous is None:
        update_filter["$or"] = [
            {
                "active_reward_heartbeat_at":
                    {
                        "$exists":
                            False
                    }
            },
            {
                "active_reward_heartbeat_at":
                    None
            },
        ]

    else:
        update_filter[
            "active_reward_heartbeat_at"
        ] = raw_previous


    increments = {
        "active_realm_minutes_total":
            credited_realm_minutes,
    }


    if earned > 0:
        increments[
            "fire_balance"
        ] = earned

        increments[
            "active_reward_fire_total"
        ] = earned


    result = await (
        db.realmlife_accounts
        .update_one(
            update_filter,
            {
                "$set": {
                    "active_reward_heartbeat_at":
                        now_iso,

                    "active_reward_qualified":
                        qualified,

                    "active_realm_minute_carry":
                        remaining_carry,

                    "active_reward_rule":
                        "one_fire_per_active_realm_minute",
                },

                "$inc":
                    increments,
            },
        )
    )


    # Another tab may have beaten this request to the same
    # heartbeat timestamp. In that case this request earns zero.
    committed_earned = (
        earned
        if result.modified_count
        else 0
    )


    if committed_earned > 0:
        try:
            await (
                db.realmlife_fire_ledger
                .insert_one(
                    {
                        "id":
                            "rl-active-"
                            + uuid
                                .uuid4()
                                .hex,

                        "game_id":
                            game_id,

                        "user_id":
                            current["id"],

                        "username":
                            current.get(
                                "username"
                            ),

                        "type":
                            "active_realm_minute_reward",

                        "kind":
                            "active_realm_minute_reward",

                        "amount":
                            committed_earned,

                        "realm_minutes":
                            credited_realm_minutes,

                        "created_at":
                            now_iso,
                    }
                )
            )

        except Exception:
            # Ledger logging must never remove an already
            # committed earned balance.
            pass


    payload = await account_status(game_id, current)


    if isinstance(
        payload,
        dict,
    ):
        payload[
            "active_reward"
        ] = {
            "earning":
                qualified,

            "earned":
                committed_earned,

            "realm_minutes_credited":
                credited_realm_minutes,

            "rule":
                "one_fire_per_active_realm_minute",
        }


    return payload



# ============================================================
# REALMLIFE V6C1 FIXED COST FIRE
#
# Server-priced one-time RealmLife unlocks.
#
# Used by:
# - business ownership
# - personal portal unlocks
#
# Never trusts a client-supplied cost.
# ============================================================

async def burn_fixed_cost(
    game_id,
    current,
    *,
    amount,
    kind,
    reference,
    idempotency_key,
):
    await ensure_account(
        game_id,
        current,
    )

    uid = current["id"]
    username = current.get("username")

    amount = int(amount)

    if amount < 1:
        raise HTTPException(
            status_code=400,
            detail="Invalid Fire Power requirement.",
        )

    raw_idem = str(
        idempotency_key or ""
    ).strip()[:120]

    if not raw_idem:
        raise HTTPException(
            status_code=400,
            detail="Missing idempotency key.",
        )

    idem = (
        f"realmlife:fixed:"
        f"{kind}:"
        f"{game_id}:"
        f"{uid}:"
        f"{raw_idem}"
    )[:160]

    try:
        reservation = await _insert_ledger(
            game_id=game_id,
            user_id=uid,
            username=username,
            kind=kind,
            amount=-amount,
            idempotency_key=idem,
            status="reserved",
            meta={
                "reference": str(
                    reference or ""
                )[:160],
                "fire_required": amount,
            },
        )

    except DuplicateKeyError:
        previous = await (
            db.realmlife_fire_ledger
            .find_one(
                {
                    "idempotency_key":
                        idem
                },
                {
                    "_id": 0
                },
            )
        )

        account = await (
            db.realmlife_accounts
            .find_one(
                {
                    "game_id":
                        game_id,

                    "user_id":
                        uid,
                },
                {
                    "_id": 0,

                    "fire_balance":
                        1,
                },
            )
        ) or {}

        if (
            previous
            and previous.get("status")
            == "completed"
        ):
            return {
                "ok": True,
                "duplicate": True,
                "burned": amount,
                "cost": amount,
                "fire_balance":
                    int(
                        account.get(
                            "fire_balance"
                        ) or 0
                    ),
                "ledger_id":
                    previous.get("id"),
            }

        raise HTTPException(
            status_code=409,
            detail=(
                "That RealmLife operation "
                "is already being processed."
            ),
        )

    debit = await (
        db.realmlife_accounts
        .update_one(
            {
                "game_id":
                    game_id,

                "user_id":
                    uid,

                "fire_balance": {
                    "$gte":
                        amount
                },
            },
            {
                "$inc": {
                    "fire_balance":
                        -amount,

                    "lifetime_fire_burned":
                        amount,
                },

                "$set": {
                    "updated_at":
                        _iso(),
                },
            },
        )
    )

    if debit.modified_count != 1:

        await (
            db.realmlife_fire_ledger
            .delete_one(
                {
                    "id":
                        reservation["id"]
                }
            )
        )

        account = await (
            db.realmlife_accounts
            .find_one(
                {
                    "game_id":
                        game_id,

                    "user_id":
                        uid,
                },
                {
                    "_id": 0,

                    "fire_balance":
                        1,
                },
            )
        ) or {}

        balance = int(
            account.get(
                "fire_balance"
            ) or 0
        )

        raise HTTPException(
            status_code=409,
            detail=(
                f"🔥{amount:,} Fire Power Required. "
                f"Your RealmLife balance is "
                f"🔥{balance:,}."
            ),
        )

    account = await (
        db.realmlife_accounts
        .find_one(
            {
                "game_id":
                    game_id,

                "user_id":
                    uid,
            },
            {
                "_id": 0,

                "fire_balance":
                    1,
            },
        )
    ) or {}

    balance = int(
        account.get(
            "fire_balance"
        ) or 0
    )

    try:
        await (
            db.realmlife_fire_ledger
            .update_one(
                {
                    "id":
                        reservation["id"]
                },
                {
                    "$set": {
                        "status":
                            "completed",

                        "balance_after":
                            balance,

                        "updated_at":
                            _iso(),
                    }
                },
            )
        )

    except Exception:

        await (
            db.realmlife_accounts
            .update_one(
                {
                    "game_id":
                        game_id,

                    "user_id":
                        uid,
                },
                {
                    "$inc": {
                        "fire_balance":
                            amount,

                        "lifetime_fire_burned":
                            -amount,
                    },

                    "$set": {
                        "updated_at":
                            _iso(),
                    },
                },
            )
        )

        await (
            db.realmlife_fire_ledger
            .update_one(
                {
                    "id":
                        reservation["id"]
                },
                {
                    "$set": {
                        "status":
                            "rolled_back",

                        "updated_at":
                            _iso(),
                    }
                },
            )
        )

        raise

    return {
        "ok": True,
        "burned": amount,
        "cost": amount,
        "fire_balance": balance,
        "ledger_id":
            reservation["id"],
    }


async def restore_fixed_cost(
    game_id,
    current,
    burn_result,
    reason,
):
    if not burn_result:
        return False

    ledger_id = burn_result.get(
        "ledger_id"
    )

    amount = int(
        burn_result.get("burned")
        or burn_result.get("cost")
        or 0
    )

    if not ledger_id or amount < 1:
        return False

    lock = await (
        db.realmlife_fire_ledger
        .update_one(
            {
                "id":
                    ledger_id,

                "status":
                    "completed",
            },
            {
                "$set": {
                    "status":
                        "rolling_back",

                    "rollback_reason":
                        str(reason or "")[:200],

                    "updated_at":
                        _iso(),
                }
            },
        )
    )

    if lock.modified_count != 1:
        return False

    await (
        db.realmlife_accounts
        .update_one(
            {
                "game_id":
                    game_id,

                "user_id":
                    current["id"],
            },
            {
                "$inc": {
                    "fire_balance":
                        amount,

                    "lifetime_fire_burned":
                        -amount,
                },

                "$set": {
                    "updated_at":
                        _iso(),
                },
            },
        )
    )

    await (
        db.realmlife_fire_ledger
        .update_one(
            {
                "id":
                    ledger_id
            },
            {
                "$set": {
                    "status":
                        "rolled_back",

                    "updated_at":
                        _iso(),
                }
            },
        )
    )

    return True


async def credit_fixed_amount(
    game_id,
    *,
    user_id,
    username,
    amount,
    kind,
    reference,
    idempotency_key,
):
    amount = int(amount)

    if amount < 1:
        return {
            "ok": True,
            "credited": 0,
        }

    idem = str(
        idempotency_key or ""
    )[:160]

    try:
        reservation = await _insert_ledger(
            game_id=game_id,
            user_id=user_id,
            username=username,
            kind=kind,
            amount=amount,
            idempotency_key=idem,
            status="reserved",
            meta={
                "reference":
                    str(
                        reference or ""
                    )[:160],
            },
        )

    except DuplicateKeyError:

        previous = await (
            db.realmlife_fire_ledger
            .find_one(
                {
                    "idempotency_key":
                        idem
                },
                {
                    "_id": 0
                },
            )
        )

        return {
            "ok":
                bool(
                    previous
                    and
                    previous.get(
                        "status"
                    )
                    ==
                    "completed"
                ),

            "duplicate":
                True,

            "credited":
                amount,
        }

    result = await (
        db.realmlife_accounts
        .update_one(
            {
                "game_id":
                    game_id,

                "user_id":
                    user_id,
            },
            {
                "$inc": {
                    "fire_balance":
                        amount,
                },

                "$set": {
                    "updated_at":
                        _iso(),
                },
            },
        )
    )

    if result.modified_count != 1:

        await (
            db.realmlife_fire_ledger
            .delete_one(
                {
                    "id":
                        reservation["id"]
                }
            )
        )

        raise HTTPException(
            status_code=409,
            detail=(
                "RealmLife refund account "
                "could not be resolved."
            ),
        )

    account = await (
        db.realmlife_accounts
        .find_one(
            {
                "game_id":
                    game_id,

                "user_id":
                    user_id,
            },
            {
                "_id": 0,

                "fire_balance":
                    1,
            },
        )
    ) or {}

    await (
        db.realmlife_fire_ledger
        .update_one(
            {
                "id":
                    reservation["id"]
            },
            {
                "$set": {
                    "status":
                        "completed",

                    "balance_after":
                        int(
                            account.get(
                                "fire_balance"
                            ) or 0
                        ),

                    "updated_at":
                        _iso(),
                }
            },
        )
    )

    return {
        "ok": True,
        "credited": amount,
        "fire_balance":
            int(
                account.get(
                    "fire_balance"
                ) or 0
            ),
    }
