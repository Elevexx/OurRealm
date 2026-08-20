import apiClient from "@/api/client";


const AUDIO_ZONES = [
  {
    id:
      "festival-stage-one",

    kind:
      "stage",

    x:
      -60,

    z:
      200,

    halfW:
      20.6,

    halfD:
      21.6,
  },

  {
    id:
      "festival-stage-two",

    kind:
      "stage",

    x:
      0,

    z:
      200,

    halfW:
      20.6,

    halfD:
      21.6,
  },

  {
    id:
      "festival-stage-three",

    kind:
      "stage",

    x:
      60,

    z:
      200,

    halfW:
      20.6,

    halfD:
      21.6,
  },


  // Exact centers already used by RealmLife's
  // existing procedural venue-audio system.
  {
    id:
      "night-lounge",

    kind:
      "club",

    x:
      0.5,

    z:
      446,

    radius:
      15,
  },

  {
    id:
      "pulse-club",

    kind:
      "club",

    x:
      33,

    z:
      451,

    radius:
      15,
  },
];


const CLUB_IDS = [
  "night-lounge",
  "pulse-club",
];


function zoneAtPosition(
  x,
  z
) {
  const stages =
    AUDIO_ZONES.filter(
      (zone) =>
        zone.kind ===
        "stage"
    );

  for (
    const zone
    of stages
  ) {
    if (
      Math.abs(
        x - zone.x
      ) <= zone.halfW
      &&
      Math.abs(
        z - zone.z
      ) <= zone.halfD
    ) {
      return zone;
    }
  }


  let nearest =
    null;

  let nearestDistance =
    Infinity;


  for (
    const zone
    of AUDIO_ZONES
  ) {
    if (
      zone.kind !==
      "club"
    ) {
      continue;
    }

    const distance =
      Math.hypot(
        x - zone.x,
        z - zone.z
      );

    if (
      distance <=
        zone.radius
      &&
      distance <
        nearestDistance
    ) {
      nearest =
        zone;

      nearestDistance =
        distance;
    }
  }


  return nearest;
}


function waitForMetadata(
  audio
) {
  if (
    audio.readyState >= 1
  ) {
    return Promise.resolve();
  }

  return new Promise(
    (resolve) => {
      let finished =
        false;

      const done =
        () => {
          if (finished)
            return;

          finished =
            true;

          audio.removeEventListener(
            "loadedmetadata",
            done
          );

          audio.removeEventListener(
            "canplay",
            done
          );

          resolve();
        };

      audio.addEventListener(
        "loadedmetadata",
        done,
        {
          once:
            true,
        }
      );

      audio.addEventListener(
        "canplay",
        done,
        {
          once:
            true,
        }
      );

      window.setTimeout(
        done,
        5000
      );
    }
  );
}


export function createFestivalStageAudio({
  gameId,
  getPlayerPosition,
  onDefaultVenueSuppression,
}) {
  if (
    typeof window ===
      "undefined"
    ||
    !gameId
  ) {
    return {
      dispose() {},
    };
  }


  const audio =
    new Audio();

  audio.preload =
    "auto";

  audio.volume =
    1;

  audio.playsInline =
    true;


  let disposed =
    false;

  let timer =
    null;

  let policyTimer =
    null;

  let activeVenueId =
    null;

  let loadedVenueId =
    null;

  let loadedSoundId =
    null;

  let blobUrl =
    null;

  let requestVersion =
    0;

  let autoplayBlocked =
    false;

  let syncBusy =
    false;

  let policyBusy =
    false;


  const suppressDefault =
    (
      venueId,
      suppressed
    ) => {
      try {
        onDefaultVenueSuppression?.(
          venueId,
          Boolean(
            suppressed
          )
        );
      } catch (_) {}
    };


  const clearBlob =
    () => {
      if (blobUrl) {
        try {
          URL.revokeObjectURL(
            blobUrl
          );
        } catch (_) {}

        blobUrl =
          null;
      }
    };


  const stopLoadedAudio =
    ({
      clearSource = false,
    } = {}) => {
      try {
        audio.pause();
      } catch (_) {}

      if (clearSource) {
        loadedVenueId =
          null;

        loadedSoundId =
          null;

        try {
          audio.removeAttribute(
            "src"
          );

          audio.load();
        } catch (_) {}

        clearBlob();
      }
    };


  const attemptPlay =
    async () => {
      if (
        disposed
        ||
        !activeVenueId
        ||
        !audio.src
      ) {
        return;
      }

      try {
        await audio.play();

        autoplayBlocked =
          false;
      } catch (err) {
        autoplayBlocked =
          true;

        console.debug(
          "[RealmLife Music] waiting for browser audio unlock",
          err?.message
          || err
        );
      }
    };


  const seekToServer =
    (
      serverOffset
    ) => {
      const desired =
        Math.max(
          0,
          Number(
            serverOffset
            || 0
          )
        );

      if (
        !Number.isFinite(
          desired
        )
      ) {
        return;
      }

      try {
        const duration =
          Number(
            audio.duration
          );

        const safeOffset =
          Number.isFinite(
            duration
          )
          &&
          duration > 0
            ? Math.min(
                desired,
                Math.max(
                  0,
                  duration -
                    0.05
                )
              )
            : desired;

        audio.currentTime =
          safeOffset;
      } catch (_) {}
    };


  const loadCurrentSound =
    async (
      venueId,
      soundId,
      offset
    ) => {
      const version =
        ++requestVersion;

      try {
        const response =
          await apiClient.get(
            `/games/${gameId}/realmlife/stages/${venueId}/audio/${soundId}`,
            {
              responseType:
                "blob",
            }
          );

        if (
          disposed
          ||
          version !==
            requestVersion
        ) {
          return;
        }

        stopLoadedAudio({
          clearSource:
            true,
        });


        blobUrl =
          URL.createObjectURL(
            response.data
          );

        loadedVenueId =
          venueId;

        loadedSoundId =
          soundId;

        audio.src =
          blobUrl;


        await waitForMetadata(
          audio
        );


        if (
          disposed
          ||
          activeVenueId !==
            venueId
        ) {
          return;
        }


        seekToServer(
          offset
        );

        await attemptPlay();


        console.debug(
          "[RealmLife Music] persistent venue audio loaded",
          {
            venueId,
            soundId,
            offset,
          }
        );
      } catch (err) {
        console.error(
          "[RealmLife Music] venue audio load failed",
          err
        );
      }
    };


  // Keep Club 178 / Night Lounge's ORIGINAL music enabled
  // whenever a custom persistent broadcast is not taking over.
  const refreshClubPolicies =
    async () => {
      if (
        disposed
        ||
        policyBusy
      ) {
        return;
      }

      policyBusy =
        true;

      try {
        const rows =
          await Promise.all(
            CLUB_IDS.map(
              async (
                venueId
              ) => {
                try {
                  const response =
                    await apiClient.get(
                      `/games/${gameId}/realmlife/stages/${venueId}`
                    );

                  return [
                    venueId,
                    response.data
                    || {},
                  ];
                } catch (_) {
                  return [
                    venueId,
                    null,
                  ];
                }
              }
            )
          );


        rows.forEach(
          ([
            venueId,
            state,
          ]) => {
            if (!state) {
              // Failure-safe:
              // never accidentally kill existing default music.
              suppressDefault(
                venueId,
                false
              );

              return;
            }

            const customActive =
              state.status ===
                "playing"
              &&
              Boolean(
                state
                  .current_track
                  ?.id
              );

            const defaultDisabled =
              state
                .default_fallback_enabled
              === false;

            suppressDefault(
              venueId,
              customActive
              ||
              defaultDisabled
            );
          }
        );
      } finally {
        policyBusy =
          false;
      }
    };


  const sync =
    async ({
      force = false,
    } = {}) => {
      if (
        disposed
        ||
        syncBusy
      ) {
        return;
      }

      const pos =
        getPlayerPosition?.();

      const x =
        Number(
          pos?.x
        );

      const z =
        Number(
          pos?.z
        );


      if (
        !Number.isFinite(x)
        ||
        !Number.isFinite(z)
      ) {
        return;
      }


      const zone =
        zoneAtPosition(
          x,
          z
        );


      // Outside custom Sound zones.
      // The persistent SERVER timeline continues.
      if (!zone) {
        activeVenueId =
          null;

        stopLoadedAudio();

        return;
      }


      const venueChanged =
        activeVenueId !==
        zone.id;

      activeVenueId =
        zone.id;


      try {
        syncBusy =
          true;

        const response =
          await apiClient.get(
            `/games/${gameId}/realmlife/stages/${zone.id}`
          );

        const state =
          response.data
          || {};

        const track =
          state.current_track;


        if (
          zone.kind ===
            "club"
        ) {
          const customActive =
            state.status ===
              "playing"
            &&
            Boolean(
              track?.id
            );

          suppressDefault(
            zone.id,
            customActive
            ||
            state
              .default_fallback_enabled
              === false
          );
        }


        // No custom track:
        // Stage = silence.
        // Club = its original procedural default,
        // unless Founder disabled fallback.
        if (
          state.status !==
            "playing"
          ||
          !track?.id
        ) {
          stopLoadedAudio();

          return;
        }


        const serverOffset =
          Number(
            state
              .current_offset_seconds
            || 0
          );


        const needsTrack =
          loadedVenueId !==
            zone.id
          ||
          loadedSoundId !==
            track.id
          ||
          !audio.src;


        if (needsTrack) {
          await loadCurrentSound(
            zone.id,
            track.id,
            serverOffset
          );

          return;
        }


        const localOffset =
          Number(
            audio.currentTime
            || 0
          );

        const drift =
          Math.abs(
            localOffset -
            serverOffset
          );


        if (
          force
          ||
          venueChanged
          ||
          drift > 1.8
        ) {
          seekToServer(
            serverOffset
          );
        }


        if (
          audio.paused
        ) {
          await attemptPlay();
        }
      } catch (err) {
        console.debug(
          "[RealmLife Music] sync failed",
          err?.message
          || err
        );
      } finally {
        syncBusy =
          false;
      }
    };


  audio.addEventListener(
    "ended",
    () => {
      sync({
        force:
          true,
      });
    }
  );


  const unlock =
    () => {
      if (!activeVenueId)
        return;

      if (
        autoplayBlocked
        &&
        audio.src
      ) {
        attemptPlay();
      } else if (
        !audio.src
      ) {
        sync({
          force:
            true,
        });
      }
    };


  window.addEventListener(
    "pointerdown",
    unlock,
    {
      passive:
        true,
    }
  );

  window.addEventListener(
    "keydown",
    unlock
  );

  window.addEventListener(
    "touchstart",
    unlock,
    {
      passive:
        true,
    }
  );


  timer =
    window.setInterval(
      () => {
        sync();
      },
      1800
    );


  policyTimer =
    window.setInterval(
      refreshClubPolicies,
      4000
    );


  refreshClubPolicies();

  sync({
    force:
      true,
  });


  return {
    dispose() {
      disposed =
        true;

      requestVersion +=
        1;

      if (timer) {
        window.clearInterval(
          timer
        );
      }

      if (policyTimer) {
        window.clearInterval(
          policyTimer
        );
      }

      window.removeEventListener(
        "pointerdown",
        unlock
      );

      window.removeEventListener(
        "keydown",
        unlock
      );

      window.removeEventListener(
        "touchstart",
        unlock
      );

      stopLoadedAudio({
        clearSource:
          true,
      });

      // Never leave the normal club music suppressed
      // after RealmLife shuts down.
      CLUB_IDS.forEach(
        (venueId) =>
          suppressDefault(
            venueId,
            false
          )
      );
    },
  };
}
