import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import apiClient from "@/api/client";

const REALMLIFE_INACTIVITY_MS =
  60_000;


function errorText(err) {
  const detail =
    err?.response?.data?.detail;

  if (typeof detail === "string")
    return detail;

  if (detail?.message)
    return detail.message;

  return (
    err?.message ||
    "RealmLife Fire Power request failed."
  );
}

function idem(prefix) {
  return [
    prefix,
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2),
  ].join("-");
}

export function useRealmLifeFire(gameId) {
  const [account, setAccount] =
    useState(null);

  const [panelOpen, setPanelOpen] =
    useState(false);

  const [amount, setAmount] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const [notice, setNotice] =
    useState("");

  const lastActivityRef =
    useRef(Date.now());

  const loadingRef =
    useRef(false);

  const markActive = useCallback(() => {
    lastActivityRef.current =
      Date.now();
  }, []);

  // REALMLIFE GLOBAL ACTIVITY SIGNALS
  //
  // This hook only exists while RealmLife is mounted,
  // so these inputs are RealmLife-session activity.
  useEffect(() => {
    const activeNow = () => {
      lastActivityRef.current =
        Date.now();
    };

    const events = [
      "pointerdown",
      "pointermove",
      "touchstart",
      "touchmove",
      "keydown",
      "wheel",
    ];

    events.forEach(
      (name) =>
        window.addEventListener(
          name,
          activeNow,
          {
            passive: true,
          }
        )
    );

    return () => {
      events.forEach(
        (name) =>
          window.removeEventListener(
            name,
            activeNow
          )
      );
    };
  }, []);


  const load = useCallback(async () => {
    if (
      !gameId ||
      loadingRef.current
    ) {
      return;
    }

    loadingRef.current = true;

    try {
      const res = await apiClient.get(
        `/games/${gameId}/realmlife/account`
      );

      setAccount(res.data);
    } catch (err) {
      console.error(
        "[RealmLife Fire] account load",
        err
      );
    } finally {
      loadingRef.current = false;
    }
  }, [gameId]);

  useEffect(() => {
    load();
  }, [load]);

  const applyResponse =
    useCallback((data) => {
      if (!data) return;

      setAccount((prev) => ({
        ...(prev || {}),
        ...(
          data.fire_balance != null
            ? {
                fire_balance:
                  data.fire_balance,
              }
            : {}
        ),
        ...(
          data.vault_balance != null
            ? {
                vault_balance:
                  data.vault_balance,
              }
            : {}
        ),
      }));
    }, []);

  const addFromVault =
    useCallback(async () => {
      const n = Math.floor(
        Number(amount)
      );

      if (!Number.isFinite(n) || n < 1) {
        setNotice(
          "Enter a Fire Power amount."
        );
        return;
      }

      setBusy(true);
      setNotice("");

      try {
        const res = await apiClient.post(
          `/games/${gameId}/realmlife/vault-transfer`,
          {
            amount: n,
            idempotency_key:
              idem("vault-in"),
          }
        );

        applyResponse(res.data);

        setNotice(
          `🔥${n.toLocaleString()} added to RealmLife.`
        );

        setAmount("");
      } catch (err) {
        setNotice(errorText(err));
      } finally {
        setBusy(false);
      }
    }, [
      amount,
      gameId,
      applyResponse,
    ]);

  const withdrawToVault =
    useCallback(async () => {
      const n = Math.floor(
        Number(amount)
      );

      if (!Number.isFinite(n) || n < 1) {
        setNotice(
          "Enter a Fire Power amount."
        );
        return;
      }

      setBusy(true);
      setNotice("");

      try {
        const res = await apiClient.post(
          `/games/${gameId}/realmlife/vault-withdraw`,
          {
            amount: n,
            idempotency_key:
              idem("vault-out"),
          }
        );

        applyResponse(res.data);

        setNotice(
          `🔥${n.toLocaleString()} returned to your Fire Vault.`
        );

        setAmount("");
      } catch (err) {
        setNotice(errorText(err));
      } finally {
        setBusy(false);
      }
    }, [
      amount,
      gameId,
      applyResponse,
    ]);

  const burnBuild =
    useCallback(
      async (itemId) => {
        try {
          const res =
            await apiClient.post(
              `/games/${gameId}/realmlife/build-burn`,
              {
                item_id: itemId,
                idempotency_key:
                  idem(
                    `build-${itemId}`
                  ),
              }
            );

          applyResponse(res.data);

          return res.data;
        } catch (err) {
          throw new Error(
            errorText(err)
          );
        }
      },
      [gameId, applyResponse]
    );

  const burnAction =
    useCallback(
      async (actionId) => {
        try {
          const res =
            await apiClient.post(
              `/games/${gameId}/realmlife/action-burn`,
              {
                action_id: actionId,
                idempotency_key:
                  idem(
                    `action-${actionId}`
                  ),
              }
            );

          applyResponse(res.data);

          return res.data;
        } catch (err) {
          throw new Error(
            errorText(err)
          );
        }
      },
      [gameId, applyResponse]
    );


  useEffect(() => {
    if (!gameId) return undefined;

    let disposed = false;

    const heartbeat = async () => {
      if (disposed) return;

      const visible =
        document.visibilityState ===
        "visible";

      const focused =
        document.hasFocus();

      try {
        const res = await apiClient.post(
          `/games/${gameId}/realmlife/heartbeat`,
          {
            visible,
            focused,
            active:
              visible
              &&
              focused
              &&
              (
                Date.now()
                - lastActivityRef.current
                < REALMLIFE_INACTIVITY_MS
              ),
          }
        );

        if (!disposed) {
          applyResponse(res.data);
        }
      } catch (err) {
        // Heartbeats should never interrupt gameplay.
        console.debug(
          "[RealmLife Fire] heartbeat",
          err
        );
      }
    };

    heartbeat();

    const timer =
      window.setInterval(
        heartbeat,
        5000
      );

    const stateChanged = () => {
      heartbeat();
    };

    window.addEventListener(
      "focus",
      stateChanged
    );

    window.addEventListener(
      "blur",
      stateChanged
    );

    document.addEventListener(
      "visibilitychange",
      stateChanged
    );

    return () => {
      disposed = true;

      window.clearInterval(timer);

      window.removeEventListener(
        "focus",
        stateChanged
      );

      window.removeEventListener(
        "blur",
        stateChanged
      );

      document.removeEventListener(
        "visibilitychange",
        stateChanged
      );
    };
  }, [
    gameId,
    applyResponse,
  ]);

  return {
    account,

    panelOpen,
    setPanelOpen,

    amount,
    setAmount,

    busy,
    notice,

    markActive,

    addFromVault,
    withdrawToVault,

    burnBuild,
    burnAction,

    refresh: load,
  };
}
