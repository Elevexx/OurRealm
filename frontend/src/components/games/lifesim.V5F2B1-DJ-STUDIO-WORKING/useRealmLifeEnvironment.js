import {
  useCallback,
  useEffect,
  useState,
} from "react";

import apiClient from "@/api/client";


function errorText(err) {
  const d =
    err?.response?.data?.detail;

  if (typeof d === "string")
    return d;

  if (d?.message)
    return d.message;

  return (
    err?.message ||
    "RealmLife environment request failed."
  );
}


export function useRealmLifeEnvironment(
  gameId
) {
  const [status, setStatus] =
    useState(null);

  const [open, setOpen] =
    useState(false);

  const [busy, setBusy] =
    useState(false);

  const [notice, setNotice] =
    useState("");


  const publish =
    useCallback(
      (data) => {
        if (!data) return;

        setStatus(data);

        window.__REALMLIFE_ENVIRONMENT =
          data;

        window.dispatchEvent(
          new CustomEvent(
            "realmlife:environment",
            {
              detail: data,
            }
          )
        );
      },
      []
    );


  const refresh =
    useCallback(
      async () => {
        if (!gameId)
          return;

        try {
          const res =
            await apiClient.get(
              `/games/${gameId}/realmlife/environment`
            );

          publish(
            res.data
          );
        } catch (err) {
          // Maintenance mode intentionally
          // blocks non-Founder gameplay.
          console.debug(
            "[RealmLife Environment]",
            err
          );
        }
      },
      [
        gameId,
        publish,
      ]
    );


  useEffect(() => {
    refresh();

    if (!gameId)
      return undefined;

    const timer =
      window.setInterval(
        refresh,
        4000
      );

    return () =>
      window.clearInterval(
        timer
      );
  }, [
    gameId,
    refresh,
  ]);


  const run =
    useCallback(
      async (
        request,
        message
      ) => {
        setBusy(true);
        setNotice("");

        try {
          const res =
            await request();

          publish(
            res.data
          );

          if (message)
            setNotice(
              message
            );

          return res.data;
        } catch (err) {
          const msg =
            errorText(err);

          setNotice(msg);

          throw new Error(msg);
        } finally {
          setBusy(false);
        }
      },
      [publish]
    );


  const post =
    useCallback(
      (
        path,
        body,
        message
      ) =>
        run(
          () =>
            apiClient.post(
              `/games/${gameId}/realmlife/admin/${path}`,
              body
            ),
          message
        ),
      [
        gameId,
        run,
      ]
    );


  return {
    status,

    isFounder:
      !!status
        ?.is_stealth_founder,

    open,
    setOpen,

    busy,
    notice,

    refresh,

    setWorldMode:
      (mode) =>
        post(
          "world-mode",
          { mode },
          `RealmLife is now ${mode}.`
        ),

    setSignupPaused:
      (paused) =>
        post(
          "signup",
          { paused },
          paused
            ? "New OurRealm signups paused."
            : "New OurRealm signups reopened."
        ),

    setWorldTime:
      (hour, minute) =>
        post(
          "time",
          {
            hour,
            minute,
          },
          "RealmLife time updated."
        ),

    setDayLength:
      (minutes) =>
        post(
          "day-length",
          { minutes },
          "RealmLife day length updated."
        ),

    setAutoWeather:
      (enabled) =>
        post(
          "weather/auto",
          { enabled },
          enabled
            ? "Automatic weather enabled."
            : "Automatic weather disabled."
        ),

    activateWeather:
      (
        weather,
        duration
      ) =>
        post(
          "weather/activate",
          {
            weather,
            duration_realm_hours:
              duration,
          },
          `${weather} activated.`
        ),

    clearWeather:
      () =>
        post(
          "weather/clear",
          {},
          "Manual weather cleared."
        ),

    addSchedule:
      (
        weather,
        duration,
        every
      ) =>
        post(
          "weather/schedule",
          {
            weather,

            duration_realm_hours:
              duration,

            every_realm_hours:
              every,

            enabled: true,
          },
          "Weather schedule added."
        ),

    removeSchedule:
      (id) =>
        run(
          () =>
            apiClient.delete(
              `/games/${gameId}/realmlife/admin/weather/schedule/${id}`
            ),
          "Weather schedule removed."
        ),
  };
}
