import React, {
  useState,
} from "react";


const WEATHER_ORDER = [
  "cloudy",
  "wind",
  "rain",
  "thunderstorm",
  "heavy_storm",
  "fog",
  "tornado",
  "hurricane",
  "heat_wave",
  "drought",
];


export default function RealmLifeFounderAdmin(
  props
) {
  const {
    status,
    isFounder,

    open,
    setOpen,

    busy,
    notice,

    setWorldMode,
    setSignupPaused,

    setWorldTime,
    setDayLength,

    setAutoWeather,

    activateWeather,
    clearWeather,

    addSchedule,
    removeSchedule,
  } = props;


  const [duration, setDuration] =
    useState("1");

  const [
    scheduleWeather,
    setScheduleWeather,
  ] =
    useState("rain");

  const [
    scheduleDuration,
    setScheduleDuration,
  ] =
    useState("1");

  const [
    scheduleEvery,
    setScheduleEvery,
  ] =
    useState("24");

  const [hour, setHour] =
    useState("12");

  const [minute, setMinute] =
    useState("00");

  const [dayLength, setDayLengthInput] =
    useState("24");


  if (
    !open
    || !isFounder
  ) {
    return null;
  }


  const schedules =
    status?.admin
      ?.schedules
    || [];

  const signupMode =
    status?.admin
      ?.signup
      ?.mode
    || "open";


  return (
    <div
      className="absolute inset-0 z-[100] flex items-center justify-center p-3"
      style={{
        background:
          "rgba(0,3,10,.72)",

        backdropFilter:
          "blur(8px)",
      }}
    >
      <div
        className="w-full max-w-[650px] max-h-[92%] overflow-y-auto rounded-2xl"
        style={{
          background:
            "linear-gradient(180deg,rgba(5,17,32,.98),rgba(2,7,16,.98))",

          border:
            "1px solid rgba(46,230,255,.36)",

          boxShadow:
            "0 25px 80px rgba(0,0,0,.68)",

          color:
            "white",
        }}
      >
        <div
          className="sticky top-0 z-10 flex items-center p-4"
          style={{
            background:
              "rgba(3,12,25,.96)",

            borderBottom:
              "1px solid rgba(46,230,255,.18)",
          }}
        >
          <div
            className="flex-1"
          >
            <div
              className="text-[10px] font-black tracking-[.22em] text-cyan-300"
            >
              STEALTH FOUNDER ONLY
            </div>

            <div
              className="font-black text-lg"
            >
              ⚙ RealmLife Admin
            </div>
          </div>

          <button
            onClick={() =>
              setOpen(false)
            }
            className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 font-black"
          >
            ✕
          </button>
        </div>


        <div
          className="p-4 space-y-5"
        >
          <section>
            <div className="text-xs font-black text-cyan-300 mb-2">
              REALMLIFE STATUS
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={busy}
                onClick={() =>
                  setWorldMode(
                    "live"
                  )
                }
                className="rounded-xl p-3 font-black text-xs bg-emerald-400/10 border border-emerald-300/25"
              >
                🟢 LIVE
              </button>

              <button
                disabled={busy}
                onClick={() =>
                  setWorldMode(
                    "maintenance"
                  )
                }
                className="rounded-xl p-3 font-black text-xs bg-amber-400/10 border border-amber-300/25"
              >
                🟠 MAINTENANCE
              </button>
            </div>
          </section>


          <section>
            <div className="text-xs font-black text-cyan-300 mb-2">
              OURREALM SIGNUPS
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={busy}
                onClick={() =>
                  setSignupPaused(
                    false
                  )
                }
                className="rounded-xl p-3 font-black text-xs bg-emerald-400/10 border border-emerald-300/25"
              >
                OPEN
              </button>

              <button
                disabled={busy}
                onClick={() =>
                  setSignupPaused(
                    true
                  )
                }
                className="rounded-xl p-3 font-black text-xs bg-red-400/10 border border-red-300/25"
              >
                PAUSE NEW SIGNUPS
              </button>
            </div>

            <div className="text-[10px] opacity-60 mt-1">
              Current: {signupMode}
            </div>
          </section>


          <section>
            <div className="text-xs font-black text-cyan-300 mb-2">
              WORLD CLOCK
            </div>

            <div className="rounded-xl p-3 bg-white/[.04] border border-white/10">
              <div className="font-black">
                Day {status?.world?.day || 1}
                {" · "}
                {status?.world?.formatted || ""}
              </div>

              <div className="text-xs opacity-65">
                {status?.world?.phase}
                {" · "}
                {status?.world?.moon?.phase}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-2">
              <input
                value={hour}
                onChange={(e) =>
                  setHour(
                    e.target.value
                  )
                }
                type="number"
                min="0"
                max="23"
                placeholder="Hour"
                className="rounded-lg bg-black/30 border border-white/10 p-2 text-xs"
              />

              <input
                value={minute}
                onChange={(e) =>
                  setMinute(
                    e.target.value
                  )
                }
                type="number"
                min="0"
                max="59"
                placeholder="Minute"
                className="rounded-lg bg-black/30 border border-white/10 p-2 text-xs"
              />

              <button
                onClick={() =>
                  setWorldTime(
                    hour,
                    minute
                  )
                }
                className="rounded-lg bg-cyan-400/10 border border-cyan-300/25 text-xs font-black"
              >
                SET TIME
              </button>
            </div>

            <div className="flex gap-2 mt-2">
              <input
                value={dayLength}
                onChange={(e) =>
                  setDayLengthInput(
                    e.target.value
                  )
                }
                type="number"
                min="1"
                placeholder="Real minutes"
                className="flex-1 rounded-lg bg-black/30 border border-white/10 p-2 text-xs"
              />

              <button
                onClick={() =>
                  setDayLength(
                    dayLength
                  )
                }
                className="rounded-lg px-3 bg-white/5 border border-white/10 text-xs font-black"
              >
                SET DAY LENGTH
              </button>
            </div>

            <div className="text-[10px] opacity-55 mt-1">
              Default: 24 real minutes = one full 24-hour RealmLife day.
            </div>
          </section>


          <section>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xs font-black text-cyan-300 flex-1">
                WEATHER CONTROL
              </div>

              <button
                onClick={() =>
                  setAutoWeather(
                    !status?.auto_weather
                  )
                }
                className="rounded-lg px-3 py-1.5 text-[10px] font-black bg-white/5 border border-white/10"
              >
                AUTO:{" "}
                {status?.auto_weather
                  ? "ON"
                  : "OFF"}
              </button>
            </div>

            <div className="flex gap-2 mb-2">
              <input
                value={duration}
                onChange={(e) =>
                  setDuration(
                    e.target.value
                  )
                }
                type="number"
                min=".1"
                step=".5"
                className="flex-1 rounded-lg bg-black/30 border border-white/10 p-2 text-xs"
              />

              <div className="rounded-lg px-3 flex items-center bg-white/5 border border-white/10 text-[10px]">
                RealmLife hours
              </div>

              <button
                onClick={
                  clearWeather
                }
                className="rounded-lg px-3 text-xs font-black bg-cyan-400/10 border border-cyan-300/25"
              >
                CLEAR NOW
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {WEATHER_ORDER.map(
                (weather) => (
                  <button
                    key={weather}
                    disabled={busy}
                    onClick={() =>
                      activateWeather(
                        weather,
                        duration
                      )
                    }
                    className="rounded-xl p-2.5 text-[11px] font-black bg-white/[.045] border border-white/10 uppercase"
                  >
                    {status
                      ?.weather_types
                      ?.[weather]
                      ?.label
                      || weather}
                  </button>
                )
              )}
            </div>

            {!!status?.active_weather?.length && (
              <div className="mt-2 text-[10px]">
                ACTIVE:{" "}
                {status.active_weather
                  .map(
                    (x) =>
                      x.weather
                  )
                  .join(", ")}
              </div>
            )}
          </section>


          <section>
            <div className="text-xs font-black text-cyan-300 mb-2">
              AUTOMATIC WEATHER SCHEDULES
            </div>

            <div className="grid grid-cols-3 gap-2">
              <select
                value={scheduleWeather}
                onChange={(e) =>
                  setScheduleWeather(
                    e.target.value
                  )
                }
                className="rounded-lg bg-black/30 border border-white/10 p-2 text-xs"
              >
                {WEATHER_ORDER.map(
                  (w) => (
                    <option
                      key={w}
                      value={w}
                    >
                      {w}
                    </option>
                  )
                )}
              </select>

              <input
                value={scheduleDuration}
                onChange={(e) =>
                  setScheduleDuration(
                    e.target.value
                  )
                }
                type="number"
                min=".1"
                placeholder="Duration"
                className="rounded-lg bg-black/30 border border-white/10 p-2 text-xs"
              />

              <input
                value={scheduleEvery}
                onChange={(e) =>
                  setScheduleEvery(
                    e.target.value
                  )
                }
                type="number"
                min=".1"
                placeholder="Every"
                className="rounded-lg bg-black/30 border border-white/10 p-2 text-xs"
              />
            </div>

            <div className="text-[10px] opacity-55 mt-1">
              Example: Rain · duration 1 RealmLife hour · every 24 RealmLife hours.
            </div>

            <button
              disabled={busy}
              onClick={() =>
                addSchedule(
                  scheduleWeather,
                  scheduleDuration,
                  scheduleEvery
                )
              }
              className="w-full rounded-xl p-2.5 mt-2 text-xs font-black bg-cyan-400/10 border border-cyan-300/25"
            >
              + ADD WEATHER SCHEDULE
            </button>

            <div className="space-y-2 mt-3">
              {schedules.map(
                (schedule) => (
                  <div
                    key={schedule.id}
                    className="flex items-center gap-2 rounded-lg p-2 bg-white/[.04] border border-white/10"
                  >
                    <div className="flex-1 text-xs">
                      <b>{schedule.weather}</b>
                      <div className="text-[10px] opacity-60">
                        {(schedule.duration_realm_minutes / 60).toFixed(1)}h
                        {" · every "}
                        {(schedule.every_realm_minutes / 60).toFixed(1)}h
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        removeSchedule(
                          schedule.id
                        )
                      }
                      className="rounded-lg px-2 py-1 text-[10px] font-black bg-red-400/10 border border-red-300/20"
                    >
                      REMOVE
                    </button>
                  </div>
                )
              )}
            </div>
          </section>


          {!!notice && (
            <div className="rounded-xl p-3 text-xs font-bold bg-white/[.05] border border-white/10">
              {notice}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
