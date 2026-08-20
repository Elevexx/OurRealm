import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import apiClient from "@/api/client";


const CLUB_IDS =
  new Set([
    "night-lounge",
    "pulse-club",
  ]);


const ACCESS_OPTIONS = [
  {
    value:
      "public_open",

    label:
      "PUBLIC OPEN",
  },

  {
    value:
      "public_fire_power",

    label:
      "PUBLIC · FIRE POWER REQUIRED",
  },

  {
    value:
      "private_invited",

    label:
      "PRIVATE · INVITED ONLY",
  },

  {
    value:
      "private_closed",

    label:
      "PRIVATE CLOSED",
  },

  {
    value:
      "maintenance_founder",

    label:
      "MAINTENANCE · FOUNDER + ALLOWED",
  },
];


const boxStyle = {
  background:
    "rgba(46,230,255,.055)",

  border:
    "1px solid rgba(46,230,255,.16)",
};


const buttonStyle = {
  background:
    "rgba(255,255,255,.06)",

  border:
    "1px solid rgba(255,255,255,.12)",
};


export default function RealmLifeFestivalStagePanel({
  open,
  onClose,
  gameId,
  stageId,
  label,
  isFounder,
}) {
  const [stage, setStage] =
    useState(null);

  const [
    permissions,
    setPermissions,
  ] = useState({
    can_manage_audio:
      false,

    can_manage_delegates:
      false,
  });

  const [library, setLibrary] =
    useState({
      sounds: [],
      playlists: [],
    });

  const [
    sourceType,
    setSourceType,
  ] = useState(
    "playlist"
  );

  const [
    sourceId,
    setSourceId,
  ] = useState("");

  const [
    shuffle,
    setShuffle,
  ] = useState(false);

  const [
    repeatOne,
    setRepeatOne,
  ] = useState(false);

  const [
    repeatAll,
    setRepeatAll,
  ] = useState(true);

  const [
    defaultFallback,
    setDefaultFallback,
  ] = useState(true);

  const [
    accessMode,
    setAccessMode,
  ] = useState(
    "public_open"
  );

  const [
    fireCost,
    setFireCost,
  ] = useState(0);

  const [
    scheduleAt,
    setScheduleAt,
  ] = useState("");

  const [
    djUsername,
    setDjUsername,
  ] = useState("");

  const [
    djExpiresAt,
    setDjExpiresAt,
  ] = useState("");

  const [busy, setBusy] =
    useState(false);

  const [error, setError] =
    useState("");

  const [notice, setNotice] =
    useState("");


  const clubMode =
    CLUB_IDS.has(
      stageId
    );


  const apiRoot =
    gameId && stageId
      ? `/games/${gameId}/realmlife/stages/${stageId}`
      : null;


  const applyState =
    useCallback(
      (next) => {
        setStage(
          next
          || null
        );

        if (!next)
          return;

        setShuffle(
          Boolean(
            next.shuffle
          )
        );

        setRepeatOne(
          Boolean(
            next.repeat_one
          )
        );

        setRepeatAll(
          Boolean(
            next.repeat_all
          )
        );

        setDefaultFallback(
          next
            .default_fallback_enabled
          !== false
        );

        setAccessMode(
          next.access_mode
          || "public_open"
        );

        setFireCost(
          Number(
            next.fire_power_cost
            || 0
          )
        );

        if (
          next.source_type
          &&
          next.source_id
        ) {
          setSourceType(
            next.source_type
          );

          setSourceId(
            next.source_id
          );
        }
      },
      []
    );


  const loadState =
    useCallback(
      async ({
        quiet = false,
      } = {}) => {
        if (!apiRoot)
          return;

        try {
          if (!quiet)
            setError("");

          const [
            stateResponse,
            permissionResponse,
          ] =
            await Promise.all([
              apiClient.get(
                apiRoot
              ),

              apiClient.get(
                `${apiRoot}/permissions`
              ),
            ]);

          applyState(
            stateResponse.data
            || null
          );

          setPermissions(
            permissionResponse
              .data
            || {
              can_manage_audio:
                false,

              can_manage_delegates:
                false,
            }
          );
        } catch (err) {
          if (!quiet) {
            setError(
              err?.response
                ?.data?.detail
              ||
              err?.message
              ||
              "Could not load music control."
            );
          }
        }
      },
      [
        apiRoot,
        applyState,
      ]
    );


  const loadLibrary =
    useCallback(
      async () => {
        if (!gameId)
          return;

        try {
          const response =
            await apiClient.get(
              `/games/${gameId}/realmlife/stages/library`
            );

          setLibrary({
            sounds:
              response.data
                ?.sounds
              || [],

            playlists:
              response.data
                ?.playlists
              || [],
          });
        } catch (_) {}
      },
      [
        gameId,
      ]
    );


  useEffect(
    () => {
      if (
        !open
        ||
        !stageId
      ) {
        return undefined;
      }

      loadState();
      loadLibrary();

      const timer =
        window.setInterval(
          () => {
            loadState({
              quiet:
                true,
            });
          },
          5000
        );

      return () =>
        window.clearInterval(
          timer
        );
    },
    [
      open,
      stageId,
      loadState,
      loadLibrary,
    ]
  );


  const canManageAudio =
    Boolean(
      isFounder
      ||
      permissions
        ?.can_manage_audio
    );


  const sourceOptions =
    useMemo(
      () =>
        sourceType ===
          "playlist"
          ? library.playlists
          : library.sounds,
      [
        library,
        sourceType,
      ]
    );


  const run =
    async (
      work,
      success
    ) => {
      if (busy)
        return;

      setBusy(true);
      setError("");
      setNotice("");

      try {
        const result =
          await work();

        if (
          result?.data
          &&
          result.data
            .stage_id
        ) {
          applyState(
            result.data
          );
        }

        if (success) {
          setNotice(
            success
          );
        }

        return result;
      } catch (err) {
        setError(
          err?.response
            ?.data?.detail
          ||
          err?.message
          ||
          "Music control update failed."
        );

        return null;
      } finally {
        setBusy(false);
      }
    };


  const setStageSource =
    () =>
      run(
        () => {
          if (!sourceId) {
            throw new Error(
              "Choose a Sound or playlist first."
            );
          }

          return apiClient.put(
            `${apiRoot}/source`,
            {
              source_type:
                sourceType,

              source_id:
                sourceId,

              autoplay:
                true,

              shuffle,

              repeat_one:
                repeatOne,

              repeat_all:
                repeatAll,
            }
          );
        },
        clubMode
          ? "Custom club broadcast started."
          : "Stage broadcast started."
      );


  const control =
    (action) =>
      run(
        () =>
          apiClient.post(
            `${apiRoot}/control`,
            {
              action,
            }
          ),
        (
          clubMode
          &&
          (
            action ===
              "stop"
            ||
            action ===
              "pause"
          )
          &&
          defaultFallback
        )
          ? "Custom broadcast stopped · default club music restored."
          : null
      );


  const saveOptions =
    () =>
      run(
        () =>
          apiClient.post(
            `${apiRoot}/control`,
            {
              action:
                "options",

              shuffle,

              repeat_one:
                repeatOne,

              repeat_all:
                repeatAll,

              ...(
                clubMode
                &&
                isFounder
                  ? {
                      default_fallback_enabled:
                        defaultFallback,
                    }
                  : {}
              ),
            }
          ),
        "Playback preferences saved."
      );


  const saveSchedule =
    () =>
      run(
        () => {
          if (!scheduleAt) {
            throw new Error(
              "Choose a date and time."
            );
          }

          const dt =
            new Date(
              scheduleAt
            );

          if (
            Number.isNaN(
              dt.getTime()
            )
          ) {
            throw new Error(
              "Invalid schedule time."
            );
          }

          return apiClient.put(
            `${apiRoot}/schedule`,
            {
              start_at:
                dt.toISOString(),
            }
          );
        },
        "Broadcast scheduled."
      );


  const saveAccess =
    () =>
      run(
        () =>
          apiClient.put(
            `${apiRoot}/access`,
            {
              access_mode:
                accessMode,

              fire_power_cost:
                Math.max(
                  0,
                  Number(
                    fireCost
                    || 0
                  )
                ),
            }
          ),
        "Stage entrance mode saved."
      );


  const addDJ =
    async () => {
      const username =
        djUsername
          .trim();

      if (!username) {
        setError(
          "Enter an OurRealm username."
        );

        return;
      }

      const result =
        await run(
          () =>
            apiClient.put(
              `${apiRoot}/delegates`,
              {
                username,

                expires_at:
                  djExpiresAt
                    ? new Date(
                        djExpiresAt
                      ).toISOString()
                    : null,
              }
            ),
          djExpiresAt
            ? "Temporary DJ access granted."
            : "DJ access granted until you remove them."
        );

      if (result) {
        setDjUsername("");
        setDjExpiresAt("");
        await loadState();
      }
    };


  const removeDJ =
    async (
      userId
    ) => {
      const result =
        await run(
          () =>
            apiClient.delete(
              `${apiRoot}/delegates/${userId}`
            ),
          "DJ access removed."
        );

      if (result) {
        await loadState();
      }
    };


  if (!open)
    return null;


  const currentTrack =
    stage?.current_track;


  const title =
    label
    ||
    stage?.label
    ||
    "MUSIC VENUE";


  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center p-3"
      style={{
        background:
          "rgba(0,0,0,.58)",

        backdropFilter:
          "blur(8px)",
      }}
    >
      <div
        className="w-full max-w-[640px] max-h-[92vh] overflow-y-auto rounded-2xl p-4"
        style={{
          background:
            "linear-gradient(180deg,rgba(4,18,30,.99),rgba(2,7,15,.99))",

          border:
            "1px solid rgba(46,230,255,.42)",

          color:
            "#fff",

          boxShadow:
            "0 24px 80px rgba(0,0,0,.62),0 0 34px rgba(46,230,255,.10)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div
              className="text-[9px] font-black tracking-[0.24em]"
              style={{
                color:
                  "#2ee6ff",
              }}
            >
              REALMLIFE MUSIC CONTROL
            </div>

            <div className="text-xl font-black mt-1">
              {title}
            </div>

            <div className="text-[11px] opacity-60 mt-1">
              {clubMode
                ? "Persistent Club Broadcast + Original Default Music"
                : "Persistent Festival Stage Broadcast"}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl font-black"
            style={buttonStyle}
          >
            ✕
          </button>
        </div>


        {/* NOW PLAYING */}

        <div
          className="mt-4 rounded-xl p-3"
          style={boxStyle}
        >
          <div className="text-[9px] font-black tracking-[0.18em] text-cyan-300">
            NOW PLAYING
          </div>

          <div className="mt-1 text-base font-black">
            {currentTrack?.title
              ||
              (
                clubMode
                &&
                stage
                  ?.using_default_audio
                  ? "DEFAULT CLUB MUSIC"
                  : stage?.status ===
                      "paused"
                    ? "PAUSED"
                    : "NO ACTIVE SOUND"
              )}
          </div>

          {currentTrack && (
            <>
              <div className="text-xs opacity-65 mt-1">
                {currentTrack.artist
                  || "OurRealm"}
              </div>

              <div className="text-[10px] opacity-55 mt-2">
                Real-time position:{" "}
                {Math.floor(
                  Number(
                    stage
                      ?.current_offset_seconds
                    || 0
                  )
                )}s
                {" · "}
                {stage?.source_name
                  || "Venue Source"}
              </div>
            </>
          )}

          {clubMode &&
            stage?.using_default_audio && (
              <div
                className="mt-2 text-[10px] font-black"
                style={{
                  color:
                    "#67f7b1",
                }}
              >
                ORIGINAL REALMLIFE CLUB SOUNDTRACK ACTIVE
              </div>
            )}
        </div>


        {error && (
          <div
            className="mt-3 rounded-xl px-3 py-2 text-xs"
            style={{
              background:
                "rgba(255,70,70,.08)",

              border:
                "1px solid rgba(255,70,70,.25)",

              color:
                "#ffaaaa",
            }}
          >
            {error}
          </div>
        )}


        {notice && (
          <div
            className="mt-3 rounded-xl px-3 py-2 text-xs"
            style={{
              background:
                "rgba(16,230,112,.08)",

              border:
                "1px solid rgba(16,230,112,.22)",

              color:
                "#7dffb7",
            }}
          >
            {notice}
          </div>
        )}


        {!canManageAudio && (
          <div
            className="mt-4 rounded-xl p-3 text-xs"
            style={{
              background:
                "rgba(255,255,255,.04)",

              border:
                "1px solid rgba(255,255,255,.10)",
            }}
          >
            You can hear this venue, but you do not currently have music-control access.
          </div>
        )}


        {canManageAudio && (
          <>
            {!isFounder && (
              <div
                className="mt-4 rounded-xl p-3 text-xs font-bold"
                style={{
                  background:
                    "rgba(197,140,255,.08)",

                  border:
                    "1px solid rgba(197,140,255,.22)",

                  color:
                    "#dec4ff",
                }}
              >
                🎧 DJ / MUSIC ARTIST ACCESS ACTIVE
                {permissions
                  ?.delegated_until
                  ? ` · Until ${new Date(
                      permissions.delegated_until
                    ).toLocaleString()}`
                  : " · Until Founder removes access"}
              </div>
            )}


            {/* SOURCE */}

            <div className="mt-5">
              <div className="text-[10px] font-black tracking-[0.16em] opacity-70">
                SOUND SOURCE
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSourceType(
                      "playlist"
                    );

                    setSourceId("");
                  }}
                  className="rounded-xl px-3 py-2 text-xs font-black"
                  style={{
                    ...buttonStyle,

                    border:
                      sourceType ===
                        "playlist"
                        ? "1px solid rgba(46,230,255,.5)"
                        : buttonStyle.border,
                  }}
                >
                  🎶 MY PLAYLIST
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSourceType(
                      "sound"
                    );

                    setSourceId("");
                  }}
                  className="rounded-xl px-3 py-2 text-xs font-black"
                  style={{
                    ...buttonStyle,

                    border:
                      sourceType ===
                        "sound"
                        ? "1px solid rgba(197,140,255,.5)"
                        : buttonStyle.border,
                  }}
                >
                  🎵 SOUND
                </button>
              </div>


              <select
                value={sourceId}
                onChange={(e) =>
                  setSourceId(
                    e.target.value
                  )
                }
                className="w-full mt-2 rounded-xl px-3 py-3 text-sm"
                style={{
                  background:
                    "#07111d",

                  border:
                    "1px solid rgba(255,255,255,.15)",

                  color:
                    "#fff",
                }}
              >
                <option value="">
                  {sourceType ===
                    "playlist"
                    ? "Choose one of my saved Sounds playlists…"
                    : "Choose a Sound…"}
                </option>

                {sourceOptions.map(
                  (item) => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.name
                        ||
                        item.title
                        ||
                        item.id}
                    </option>
                  )
                )}
              </select>


              <button
                type="button"
                disabled={
                  busy
                  ||
                  !sourceId
                }
                onClick={
                  setStageSource
                }
                className="w-full mt-2 rounded-xl px-3 py-3 text-xs font-black"
                style={{
                  background:
                    "linear-gradient(90deg,#2ea0ff,#10e670)",

                  color:
                    "#03100a",

                  opacity:
                    busy
                      ? 0.55
                      : 1,
                }}
              >
                ▶ SET + START BROADCAST
              </button>
            </div>


            {/* TRANSPORT */}

            <div className="mt-5">
              <div className="text-[10px] font-black tracking-[0.16em] opacity-70">
                PLAYBACK
              </div>

              <div className="grid grid-cols-5 gap-1.5 mt-2">
                {[
                  ["previous", "⏮"],
                  ["play", "▶"],
                  ["pause", "⏸"],
                  ["stop", "⏹"],
                  ["next", "⏭"],
                ].map(
                  ([
                    action,
                    icon,
                  ]) => (
                    <button
                      key={action}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        control(
                          action
                        )
                      }
                      className="rounded-xl py-3 text-lg font-black"
                      style={buttonStyle}
                    >
                      {icon}
                    </button>
                  )
                )}
              </div>
            </div>


            {/* MODES */}

            <div className="mt-5">
              <div className="text-[10px] font-black tracking-[0.16em] opacity-70">
                PLAYBACK PREFERENCES
              </div>

              {[
                [
                  "🔀 Shuffle / Randomize",
                  shuffle,
                  setShuffle,
                ],
                [
                  "🔂 Loop Current Sound",
                  repeatOne,
                  setRepeatOne,
                ],
                [
                  "🔁 Repeat Playlist Continuously",
                  repeatAll,
                  setRepeatAll,
                ],
              ].map(
                ([
                  title,
                  value,
                  setter,
                ]) => (
                  <label
                    key={title}
                    className="flex items-center justify-between mt-3 text-xs"
                  >
                    <span>
                      {title}
                    </span>

                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) =>
                        setter(
                          e.target.checked
                        )
                      }
                    />
                  </label>
                )
              )}


              {clubMode &&
                isFounder && (
                  <label className="flex items-center justify-between mt-3 text-xs">
                    <span>
                      🎚 Return to Original Club Music When Custom Broadcast Stops
                    </span>

                    <input
                      type="checkbox"
                      checked={
                        defaultFallback
                      }
                      onChange={(e) =>
                        setDefaultFallback(
                          e.target
                            .checked
                        )
                      }
                    />
                  </label>
                )}


              <button
                type="button"
                disabled={busy}
                onClick={
                  saveOptions
                }
                className="w-full mt-3 rounded-xl px-3 py-2.5 text-xs font-black"
                style={buttonStyle}
              >
                SAVE PLAYBACK PREFERENCES
              </button>
            </div>


            {/* SCHEDULE */}

            <div className="mt-5">
              <div className="text-[10px] font-black tracking-[0.16em] opacity-70">
                SCHEDULE START
              </div>

              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) =>
                  setScheduleAt(
                    e.target.value
                  )
                }
                className="w-full mt-2 rounded-xl px-3 py-3 text-sm"
                style={{
                  background:
                    "#07111d",

                  border:
                    "1px solid rgba(255,255,255,.15)",

                  color:
                    "#fff",
                }}
              />

              <button
                type="button"
                disabled={
                  busy
                  ||
                  !scheduleAt
                }
                onClick={
                  saveSchedule
                }
                className="w-full mt-2 rounded-xl px-3 py-2.5 text-xs font-black"
                style={buttonStyle}
              >
                🕒 SAVE SCHEDULE
              </button>
            </div>
          </>
        )}


        {/* FOUNDER DJ TEAM */}

        {isFounder && (
          <div
            className="mt-5 rounded-xl p-3"
            style={{
              background:
                "rgba(197,140,255,.06)",

              border:
                "1px solid rgba(197,140,255,.20)",
            }}
          >
            <div
              className="text-[10px] font-black tracking-[0.16em]"
              style={{
                color:
                  "#d9b6ff",
              }}
            >
              🎧 DJ / MUSIC ARTIST ACCESS
            </div>

            <div className="text-[10px] opacity-60 mt-1">
              They can use their own Sounds/playlists and operate this venue. They cannot add other DJs or change Founder access rules.
            </div>


            <input
              value={djUsername}
              onChange={(e) =>
                setDjUsername(
                  e.target.value
                )
              }
              placeholder="@username"
              className="w-full mt-3 rounded-xl px-3 py-2.5 text-sm"
              style={{
                background:
                  "#07111d",

                border:
                  "1px solid rgba(255,255,255,.15)",

                color:
                  "#fff",
              }}
            />


            <div className="text-[9px] opacity-55 mt-3">
              OPTIONAL EXPIRATION
            </div>

            <input
              type="datetime-local"
              value={djExpiresAt}
              onChange={(e) =>
                setDjExpiresAt(
                  e.target.value
                )
              }
              className="w-full mt-1 rounded-xl px-3 py-2.5 text-sm"
              style={{
                background:
                  "#07111d",

                border:
                  "1px solid rgba(255,255,255,.15)",

                color:
                  "#fff",
              }}
            />

            <div className="text-[9px] opacity-50 mt-1">
              Leave blank = access stays active until you remove them.
            </div>


            <button
              type="button"
              disabled={
                busy
                ||
                !djUsername.trim()
              }
              onClick={
                addDJ
              }
              className="w-full mt-3 rounded-xl px-3 py-2.5 text-xs font-black"
              style={{
                background:
                  "rgba(197,140,255,.15)",

                border:
                  "1px solid rgba(197,140,255,.34)",
              }}
            >
              + GRANT MUSIC CONTROL
            </button>


            {(stage?.delegates
              || []).length >
              0 && (
              <div className="mt-4 space-y-2">
                {(stage.delegates
                  || []).map(
                  (delegate) => (
                    <div
                      key={
                        delegate.user_id
                      }
                      className="flex items-center justify-between gap-2 rounded-xl px-3 py-2"
                      style={{
                        background:
                          "rgba(255,255,255,.04)",

                        border:
                          "1px solid rgba(255,255,255,.09)",
                      }}
                    >
                      <div>
                        <div className="text-xs font-black">
                          @
                          {delegate.username}
                        </div>

                        <div className="text-[9px] opacity-55 mt-0.5">
                          {delegate.expires_at
                            ? `Until ${new Date(
                                delegate.expires_at
                              ).toLocaleString()}`
                            : "Until you remove them"}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          removeDJ(
                            delegate.user_id
                          )
                        }
                        className="rounded-lg px-2.5 py-2 text-[9px] font-black"
                        style={{
                          background:
                            "rgba(255,70,70,.09)",

                          border:
                            "1px solid rgba(255,70,70,.24)",

                          color:
                            "#ffb2b2",
                        }}
                      >
                        REMOVE
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}


        {/* STAGE ACCESS — not club entrance policy */}

        {isFounder &&
          !clubMode && (
            <div className="mt-5">
              <div className="text-[10px] font-black tracking-[0.16em] opacity-70">
                STAGE LAWN ENTRANCE
              </div>

              <select
                value={accessMode}
                onChange={(e) =>
                  setAccessMode(
                    e.target.value
                  )
                }
                className="w-full mt-2 rounded-xl px-3 py-3 text-sm"
                style={{
                  background:
                    "#07111d",

                  border:
                    "1px solid rgba(255,255,255,.15)",

                  color:
                    "#fff",
                }}
              >
                {ACCESS_OPTIONS.map(
                  (option) => (
                    <option
                      key={
                        option.value
                      }
                      value={
                        option.value
                      }
                    >
                      {option.label}
                    </option>
                  )
                )}
              </select>

              {accessMode ===
                "public_fire_power" && (
                <input
                  type="number"
                  min="0"
                  value={fireCost}
                  onChange={(e) =>
                    setFireCost(
                      e.target.value
                    )
                  }
                  className="w-full mt-2 rounded-xl px-3 py-3 text-sm"
                  style={{
                    background:
                      "#07111d",

                    border:
                      "1px solid rgba(255,255,255,.15)",

                    color:
                      "#fff",
                  }}
                />
              )}

              <button
                type="button"
                disabled={busy}
                onClick={
                  saveAccess
                }
                className="w-full mt-2 rounded-xl px-3 py-2.5 text-xs font-black"
                style={buttonStyle}
              >
                SAVE ENTRANCE MODE
              </button>
            </div>
          )}


        <button
          type="button"
          onClick={() =>
            loadState()
          }
          className="w-full mt-5 rounded-xl px-3 py-2 text-[10px] font-black tracking-wider"
          style={buttonStyle}
        >
          ↻ REFRESH MUSIC STATUS
        </button>
      </div>
    </div>
  );
}
