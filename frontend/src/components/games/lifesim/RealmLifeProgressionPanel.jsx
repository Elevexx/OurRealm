import React, {
  useEffect,
  useState,
} from "react";

import apiClient from "@/api/client";


const clamp100 = (value) =>
  Math.max(
    0,
    Math.min(
      100,
      Number(value) || 0
    )
  );


export default function RealmLifeProgressionPanel({
  residentName,
  hud,
  realmFire,
  realmProperty,
  placedCount = 0,
  isMobileUI,
  onMinimize,
}) {
  const [
    progression,
    setProgression,
  ] = useState(null);

  const [
    ladder,
    setLadder,
  ] = useState([]);

  const [
    leaderboard,
    setLeaderboard,
  ] = useState(null);


  useEffect(() => {
    let dead = false;

    const load = async () => {
      const results =
        await Promise.allSettled([
          apiClient.get(
            "/progression/me"
          ),

          apiClient.get(
            "/progression/ladder"
          ),

          apiClient.get(
            "/leaderboards/me"
          ),
        ]);

      if (dead)
        return;

      if (
        results[0].status
        === "fulfilled"
      ) {
        setProgression(
          results[0]
            .value
            ?.data
            || null
        );
      }

      if (
        results[1].status
        === "fulfilled"
      ) {
        setLadder(
          results[1]
            .value
            ?.data
            ?.levels
            || []
        );
      }

      if (
        results[2].status
        === "fulfilled"
      ) {
        setLeaderboard(
          results[2]
            .value
            ?.data
            || null
        );
      }
    };

    load();

    const timer =
      window.setInterval(
        load,
        60000
      );

    return () => {
      dead = true;

      window.clearInterval(
        timer
      );
    };
  }, []);


  // GENESIS CITY PROGRESSION
  //
  // Public RealmLife traits are derived from persistent
  // progression, customization, reputation, and leaderboard
  // standing — never survival needs.

  const summary =
    progression
      ?.summary
    || {};

  const currentLevel =
    progression
      ?.level
    || {};


  const levelNumber =
    Math.max(
      1,
      Number(
        currentLevel
          ?.level_number
        || 1
      )
    );

  const levelName =
    currentLevel
      ?.name
    || `Level ${levelNumber}`;


  const progressPercent =
    clamp100(
      summary
        ?.progress_percentage
      || 0
    );


  const reputation =
    Math.max(
      0,
      Number(
        progression
          ?.reputation_points
        ??
        leaderboard
          ?.reputation
        ??
        0
      )
    );


  const globalRank =
    Number(
      leaderboard
        ?.global_rank
    ) || null;

  const totalRanked =
    Number(
      leaderboard
        ?.total_ranked
    ) || 0;


  const nextLevel =
    ladder.find(
      (item) =>
        Number(
          item?.level_number
        )
        ===
        levelNumber + 1
    );

  const nextLevelName =
    nextLevel
      ?.name
    || "Highest Level";


  /*
   * Public RealmLife traits.
   *
   * Current life-sim interaction state remains underneath
   * so existing furniture/actions/save continuity is preserved.
   */

  // --------------------------------------------------------
  // GENESIS CITY TRAITS
  // --------------------------------------------------------

  // COMFORT
  // Rewards actually building/customizing your RealmLife home.
  const comfort =
    Math.round(
      clamp100(
        35
        +
        Math.min(
          40,
          placedCount * 3
        )
        +
        Math.min(
          25,
          levelNumber * 2.5
        )
      )
    );


  // AMBITION
  // Driven by persistent progression level + current progress.
  const ambition =
    Math.round(
      clamp100(
        15
        +
        Math.min(
          55,
          levelNumber * 6
        )
        +
        progressPercent * 0.30
      )
    );


  // COMMUNITY
  // Driven by reputation + real leaderboard standing.
  const communityRankScore =
    globalRank &&
    totalRanked > 1
      ? clamp100(
          (
            1 -
            (
              globalRank - 1
            ) /
            (
              totalRanked - 1
            )
          ) * 100
        )
      : 0;


  const community =
    Math.round(
      clamp100(
        10
        +
        Math.min(
          60,
          Math.log10(
            reputation + 1
          ) * 22
        )
        +
        communityRankScore * 0.30
      )
    );


  const levelsAbove =
    Math.max(
      1,
      Number(
        realmProperty
          ?.property
          ?.levels_above
        ??
        realmProperty
          ?.blueprint
          ?.above_ground_levels
        ??
        1
      )
    );


  const levelsBelow =
    Math.max(
      0,
      Number(
        realmProperty
          ?.property
          ?.levels_below
        ??
        realmProperty
          ?.blueprint
          ?.basement_levels
        ??
        0
      )
    );


  const propertyScore =
    Math.round(
      clamp100(
        30
        +
        (
          levelsAbove - 1
        ) * 18
        +
        levelsBelow * 10
        +
        Math.min(
          24,
          placedCount * 2
        )
      )
    );


  const fireBalance =
    Math.max(
      0,
      Number(
        realmFire
          ?.fire_balance
        || 0
      )
    );


  const fireBar =
    clamp100(
      Math.log10(
        fireBalance + 1
      )
      * 25
    );


  const reputationBar =
    clamp100(
      reputation <= 100
        ? reputation
        : (
            Math.log10(
              reputation + 1
            )
            * 32
          )
    );


  const rows = [
    [
      "🏠",
      "Comfort",
      comfort,
      comfort,
      "#f0a33c",
    ],

    [
      "✦",
      "Ambition",
      ambition,
      ambition,
      "#46abe0",
    ],

    [
      "🛡",
      "Reputation",
      reputation.toLocaleString(),
      reputationBar,
      "#55ddd4",
    ],

    [
      "👥",
      "Community",
      community,
      community,
      "#bf6de4",
    ],

    [
      "🏡",
      "Property",
      propertyScore,
      propertyScore,
      "#65ba43",
    ],

    [
      "🔥",
      "Fire Power",
      fireBalance.toLocaleString(),
      fireBar,
      "#e45458",
    ],
  ];


  const cardStyle = {
    borderRadius: 8,

    border:
      "1px solid rgba(255,255,255,.08)",

    background:
      "linear-gradient(135deg,rgba(30,46,59,.92),rgba(13,25,35,.96))",
  };


  return (
    <div
      data-testid="realmlife-needs-panel"
      aria-label="RealmLife progression"
      className="absolute z-30 rounded-2xl p-3 flex flex-col"
      style={{
        left:
          "max(12px, env(safe-area-inset-left))",

        bottom:
          isMobileUI
            ? "max(150px, calc(env(safe-area-inset-bottom) + 150px))"
            : 12,

        width:
          isMobileUI
            ? "min(88vw, 340px)"
            : "410px",

        maxWidth:
          "calc(100vw - 24px)",

        maxHeight:
          isMobileUI
            ? "calc(100% - max(150px, env(safe-area-inset-bottom) + 150px) - max(56px, env(safe-area-inset-top) + 48px))"
            : "calc(100% - 72px)",

        minHeight: 64,

        color: "#fff",

        background:
          "linear-gradient(145deg,rgba(5,19,31,.97),rgba(4,13,23,.96))",

        border:
          "1px solid rgba(72,188,215,.30)",

        backdropFilter:
          "blur(16px)",

        boxShadow:
          "0 18px 55px rgba(0,0,0,.46)",
      }}
    >

      {/* HEADER */}

      <div
        className="flex-none flex items-start gap-3"
      >
        <div
          style={{
            minWidth: 0,
            flex: 1,
          }}
        >
          <div
            className="truncate"
            style={{
              fontSize:
                isMobileUI
                  ? 18
                  : 22,

              fontWeight: 950,
              lineHeight: 1.05,
            }}
          >
            {residentName}
          </div>

          <div
            style={{
              marginTop: 5,

              fontSize: 9,

              fontWeight: 900,

              letterSpacing:
                ".12em",

              color:
                "rgba(217,231,241,.60)",
            }}
          >
            PROGRESSION
          </div>
        </div>


        <div
          style={{
            width: 60,
            height: 60,

            flex:
              "0 0 60px",

            padding: 5,

            borderRadius:
              "50%",

            background:
              `conic-gradient(
                #59e0d8 0deg,
                #59e0d8 ${progressPercent * 3.6}deg,
                rgba(255,255,255,.11) ${progressPercent * 3.6}deg,
                rgba(255,255,255,.11) 360deg
              )`,
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",

              borderRadius:
                "50%",

              display: "flex",
              alignItems: "center",
              justifyContent: "center",

              background:
                "#071622",

              fontSize: 15,
              fontWeight: 950,
            }}
          >
            {
              Math.round(
                progressPercent
              )
            }%
          </div>
        </div>


        {isMobileUI && (
          <button
            type="button"
            onClick={onMinimize}
            data-testid="realmlife-needs-minimize"
            aria-label="Minimize progression"
            style={{
              width: 28,
              height: 28,

              flex:
                "0 0 28px",

              borderRadius: 7,

              background:
                "rgba(255,255,255,.07)",

              border:
                "1px solid rgba(255,255,255,.15)",

              color: "#fff",

              fontWeight: 900,
            }}
          >
            —
          </button>
        )}
      </div>


      <div
        style={{
          overflowY: "auto",
          minHeight: 0,
          marginTop: 12,
          paddingRight: 2,
        }}
      >

        {/* TRAITS */}

        {rows.map(
          ([
            icon,
            label,
            value,
            bar,
            color,
          ]) => (
            <div
              key={label}
              style={{
                display: "grid",

                gridTemplateColumns:
                  isMobileUI
                    ? "92px 1fr 48px"
                    : "108px 1fr 62px",

                gap: 8,

                alignItems:
                  "center",

                marginBottom: 9,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,

                  fontSize: 11,
                  fontWeight: 850,
                }}
              >
                <span
                  style={{
                    width: 16,
                    textAlign: "center",
                  }}
                >
                  {icon}
                </span>

                {label}
              </div>


              <div
                style={{
                  height: 6,

                  borderRadius: 999,

                  overflow: "hidden",

                  background:
                    "rgba(255,255,255,.12)",
                }}
              >
                <div
                  style={{
                    height: "100%",

                    width:
                      `${clamp100(bar)}%`,

                    borderRadius: 999,

                    background: color,

                    boxShadow:
                      `0 0 9px ${color}55`,
                  }}
                />
              </div>


              <div
                style={{
                  textAlign:
                    "right",

                  fontSize: 10,

                  fontWeight: 900,

                  overflow:
                    "hidden",

                  textOverflow:
                    "ellipsis",
                }}
              >
                {value}
              </div>
            </div>
          ))
        }


        <div
          style={{
            marginTop: 5,

            fontSize: 9,

            color:
              "rgba(205,220,230,.58)",
          }}
        >
          ◉ Traits power badges,
          leaderboard rank,
          and reputation.
        </div>


        <div
          style={{
            height: 1,

            margin:
              "12px 0",

            background:
              "rgba(255,255,255,.13)",
          }}
        />


        {/* BADGES */}

        <div
          style={{
            marginBottom: 8,

            fontSize: 10,

            fontWeight: 950,

            letterSpacing:
              ".06em",
          }}
        >
          BADGE PROGRESS
        </div>


        <div
          style={{
            display: "grid",

            gridTemplateColumns:
              "1.35fr .9fr",

            gap: 8,
          }}
        >
          <div
            style={{
              ...cardStyle,

              minHeight: 72,

              padding: 9,

              display: "flex",

              alignItems:
                "center",

              gap: 9,

              background:
                "linear-gradient(135deg,rgba(27,55,72,.82),rgba(11,25,36,.92))",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,

                flex:
                  "0 0 44px",

                display: "flex",

                alignItems:
                  "center",

                justifyContent:
                  "center",

                fontSize: 27,

                borderRadius: 9,

                background:
                  "rgba(245,167,48,.10)",

                border:
                  "1px solid rgba(245,167,48,.20)",
              }}
            >
              🛡️
            </div>


            <div
              style={{
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 11,

                  fontWeight: 900,

                  color:
                    "#59ddd7",
                }}
              >
                {levelName}
              </div>

              <div
                style={{
                  marginTop: 7,

                  fontSize: 7,

                  fontWeight: 900,

                  letterSpacing:
                    ".08em",

                  color:
                    "rgba(210,226,235,.52)",
                }}
              >
                NEXT BADGE
              </div>

              <div
                style={{
                  marginTop: 2,

                  fontSize: 10,

                  fontWeight: 900,

                  color:
                    "#55ddd6",
                }}
              >
                {nextLevelName}
              </div>
            </div>
          </div>


          <div
            style={{
              ...cardStyle,
              padding: 9,
            }}
          >
            <div
              style={{
                fontSize: 7,

                fontWeight: 900,

                letterSpacing:
                  ".08em",

                color:
                  "rgba(210,226,235,.52)",
              }}
            >
              PROGRESS
            </div>

            <div
              style={{
                marginTop: 4,

                fontSize: 17,

                fontWeight: 950,
              }}
            >
              {
                Math.round(
                  progressPercent
                )
              } / 100
            </div>

            <div
              style={{
                height: 6,

                marginTop: 10,

                borderRadius: 999,

                overflow: "hidden",

                background:
                  "rgba(255,255,255,.10)",
              }}
            >
              <div
                style={{
                  height: "100%",

                  width:
                    `${progressPercent}%`,

                  borderRadius: 999,

                  background:
                    "#58ddd6",
                }}
              />
            </div>
          </div>
        </div>


        <div
          style={{
            height: 1,

            margin:
              "12px 0",

            background:
              "rgba(255,255,255,.13)",
          }}
        />


        {/* LEADERBOARD */}

        <div
          style={{
            marginBottom: 8,

            fontSize: 10,

            fontWeight: 950,

            letterSpacing:
              ".06em",
          }}
        >
          LEADERBOARD
        </div>


        <div
          style={{
            display: "grid",

            gridTemplateColumns:
              "repeat(3,minmax(0,1fr))",

            gap: 7,
          }}
        >

          <div
            style={{
              ...cardStyle,
              padding: 8,
            }}
          >
            <div
              style={{
                fontSize: 7,
                opacity: .55,
              }}
            >
              LEVEL
            </div>

            <div
              style={{
                marginTop: 5,
                fontSize: 14,
                fontWeight: 950,
              }}
            >
              ⏫ {levelNumber}
            </div>
          </div>


          <div
            style={{
              ...cardStyle,
              padding: 8,
            }}
          >
            <div
              style={{
                fontSize: 7,
                opacity: .55,
              }}
            >
              REPUTATION SCORE
            </div>

            <div
              style={{
                marginTop: 5,
                fontSize: 14,
                fontWeight: 950,
              }}
            >
              🛡 {
                reputation
                  .toLocaleString()
              }
            </div>
          </div>


          <div
            style={{
              ...cardStyle,
              padding: 8,
            }}
          >
            <div
              style={{
                fontSize: 7,
                opacity: .55,
              }}
            >
              GLOBAL RANK
            </div>

            <div
              style={{
                marginTop: 5,
                fontSize: 14,
                fontWeight: 950,
              }}
            >
              👑 {
                globalRank
                  ? `#${globalRank}`
                  : "—"
              }
            </div>

            {totalRanked > 0 && (
              <div
                style={{
                  marginTop: 2,

                  fontSize: 7,

                  opacity: .45,
                }}
              >
                of {
                  totalRanked
                    .toLocaleString()
                }
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
