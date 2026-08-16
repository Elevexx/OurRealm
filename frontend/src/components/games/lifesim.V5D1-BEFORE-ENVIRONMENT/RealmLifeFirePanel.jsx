import React from "react";

export default function RealmLifeFirePanel({
  open,
  onClose,
  account,
  amount,
  setAmount,
  busy,
  notice,
  onAdd,
  onWithdraw,
}) {
  if (!open) return null;

  const realmBalance =
    account?.fire_balance ?? 0;

  const vaultBalance =
    account?.vault_balance ?? 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(2,6,12,.72)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(410px, 100%)",
          padding: 20,
          borderRadius: 22,
          color: "#fff",
          background:
            "linear-gradient(155deg,#18212c,#090e15)",
          border:
            "1px solid rgba(255,255,255,.14)",
          boxShadow:
            "0 28px 80px rgba(0,0,0,.6)",
        }}
      >
        <div
          style={{
            color: "#ff9a5c",
            fontSize: 11,
            fontWeight: 950,
            letterSpacing: 1.4,
          }}
        >
          🔥 REALMLIFE FIRE POWER
        </div>

        <div
          style={{
            marginTop: 5,
            fontSize: 20,
            fontWeight: 950,
          }}
        >
          RealmLife Fire
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginTop: 15,
          }}
        >
          <div
            style={{
              padding: 13,
              borderRadius: 14,
              background:
                "rgba(255,138,76,.12)",
              border:
                "1px solid rgba(255,138,76,.22)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                opacity: 0.65,
              }}
            >
              REALMLIFE
            </div>

            <div
              style={{
                marginTop: 4,
                fontSize: 24,
                fontWeight: 950,
              }}
            >
              🔥{realmBalance.toLocaleString()}
            </div>
          </div>

          <div
            style={{
              padding: 13,
              borderRadius: 14,
              background:
                "rgba(255,255,255,.055)",
              border:
                "1px solid rgba(255,255,255,.1)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                opacity: 0.65,
              }}
            >
              FIRE VAULT
            </div>

            <div
              style={{
                marginTop: 4,
                fontSize: 24,
                fontWeight: 950,
              }}
            >
              🔥{vaultBalance.toLocaleString()}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 11,
            opacity: 0.7,
          }}
        >
          Enter any whole Fire Power amount.
        </div>

        <input
          type="number"
          min="1"
          step="1"
          value={amount}
          placeholder="Fire Power amount"
          onChange={(e) =>
            setAmount(e.target.value)
          }
          style={{
            width: "100%",
            boxSizing: "border-box",
            marginTop: 7,
            padding: "12px 13px",
            borderRadius: 12,
            outline: "none",
            color: "#fff",
            background:
              "rgba(255,255,255,.065)",
            border:
              "1px solid rgba(255,255,255,.14)",
          }}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 9,
            marginTop: 10,
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onAdd}
            style={{
              padding: "11px 8px",
              borderRadius: 12,
              border: 0,
              color: "#fff",
              fontWeight: 900,
              cursor: busy
                ? "wait"
                : "pointer",
              background: "#ff8448",
            }}
          >
            + Add From Vault
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={onWithdraw}
            style={{
              padding: "11px 8px",
              borderRadius: 12,
              color: "#fff",
              fontWeight: 900,
              cursor: busy
                ? "wait"
                : "pointer",
              background:
                "rgba(255,255,255,.075)",
              border:
                "1px solid rgba(255,255,255,.15)",
            }}
          >
            Withdraw To Vault
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 11,
            fontSize: 10,
            lineHeight: 1.5,
            background:
              "rgba(255,255,255,.04)",
            opacity: 0.78,
          }}
        >
          Earn 🔥1 for each qualified active
          real-world minute in RealmLife.
          Background and idle time do not earn
          the active-play bonus.
          <br />
          <br />
          Vault transfers have no fee or
          cooldown.
        </div>

        {!!notice && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 10,
              background:
                "rgba(255,140,70,.13)",
              fontSize: 11,
            }}
          >
            {notice}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 11,
            padding: 9,
            border: 0,
            color:
              "rgba(255,255,255,.58)",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
