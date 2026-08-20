import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import apiClient from "@/api/client";


const INITIAL_EQ = {
  bass: 0,
  low: 0,
  mid: 0,
  high: 0,
};


function fmtTime(
  seconds
) {

  if (
    !Number.isFinite(
      Number(seconds)
    )
  ) {
    return "0:00";
  }


  const total =
    Math.max(
      0,
      Math.floor(
        Number(seconds)
      )
    );


  const minutes =
    Math.floor(
      total / 60
    );


  const secs =
    total % 60;


  return (
    `${minutes}:`
    + String(secs)
      .padStart(
        2,
        "0"
      )
  );
}


function sliderStyle() {

  return {
    width:
      "100%",
  };
}


function Deck({
  label,
  accent,
  track,
  progress,
  volume,
  eq,
  playing,
  mixerActive,
  onChoose,
  onPlay,
  onPause,
  onSeek,
  onVolume,
  onEq,
}) {

  return (
    <div
      className="rounded-2xl p-3 border"
      style={{
        background:
          "linear-gradient(180deg,rgba(8,23,35,.96),rgba(3,10,18,.98))",

        borderColor:
          accent,

        boxShadow:
          `0 0 30px ${accent}22`,
      }}
    >
      <div
        className="flex items-center gap-2"
      >
        <div
          className="text-lg font-black"
          style={{
            color:
              accent,
          }}
        >
          DECK {label}
        </div>

        <div
          className="flex-1"
        />

        <button
          type="button"
          onClick={
            onChoose
          }
          className="rounded-lg px-3 py-1.5 text-xs font-black border border-white/15 bg-white/5"
        >
          CHOOSE SOUND
        </button>
      </div>


      <div
        className="mt-3 rounded-xl p-3 border border-white/10 bg-black/30"
      >
        <div
          className="font-black truncate"
        >
          {track
            ?.title
            || "No Sound Loaded"}
        </div>

        <div
          className="text-xs opacity-60 truncate"
        >
          {track
            ?.artist
            || "OurRealm Sounds"}
        </div>


        <div
          className="mt-3"
        >
          <input
            type="range"
            min="0"
            max={
              Math.max(
                0.01,
                progress.duration
                || 0.01
              )
            }
            step="0.01"
            value={
              Math.min(
                progress.current
                || 0,

                progress.duration
                || 0
              )
            }
            onChange={(e) =>
              onSeek(
                Number(
                  e.target.value
                )
              )
            }
            style={
              sliderStyle()
            }
          />

          <div
            className="flex text-[10px] opacity-60"
          >
            <span>
              {fmtTime(
                progress.current
              )}
            </span>

            <span
              className="flex-1"
            />

            <span>
              {fmtTime(
                progress.duration
              )}
            </span>
          </div>
        </div>


        <div
          className="grid grid-cols-2 gap-2 mt-3"
        >
          <button
            type="button"
            onClick={
              playing
                ? onPause
                : onPlay
            }
            disabled={
              !track
            }
            className="rounded-xl p-2 text-xs font-black border border-white/15 bg-white/5 disabled:opacity-30"
          >
            {playing
              ? "Ⅱ PAUSE"
              : "▶ PLAY"}
          </button>

          <div
            className="rounded-xl p-2 text-center text-[10px] border border-white/10 bg-white/[.03]"
          >
            {mixerActive
              ? "DUAL PLAY READY"
              : "SINGLE DECK MODE"}
          </div>
        </div>
      </div>


      <div
        className="mt-3"
      >
        <div
          className="text-[10px] font-black opacity-60"
        >
          DECK VOLUME
        </div>

        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={
            volume
          }
          onChange={(e) =>
            onVolume(
              Number(
                e.target.value
              )
            )
          }
          style={
            sliderStyle()
          }
        />
      </div>


      <div
        className="grid grid-cols-2 gap-2 mt-3"
      >
        {[
          [
            "BASS",
            "bass",
          ],
          [
            "LOW",
            "low",
          ],
          [
            "MID",
            "mid",
          ],
          [
            "HIGH",
            "high",
          ],
        ].map(
          ([
            title,
            key,
          ]) => (
            <label
              key={key}
              className="rounded-xl p-2 border border-white/10 bg-white/[.025]"
            >
              <div
                className="text-[10px] font-black"
              >
                {title}
                {" "}
                {Number(
                  eq[key]
                ).toFixed(0)}
                dB
              </div>

              <input
                type="range"
                min="-18"
                max="18"
                step="1"
                value={
                  eq[key]
                }
                onChange={(e) =>
                  onEq(
                    key,
                    Number(
                      e.target.value
                    )
                  )
                }
                style={
                  sliderStyle()
                }
              />
            </label>
          )
        )}
      </div>
    </div>
  );
}


export default function RealmLifeDJMixer({
  gameId,
  open,
  setOpen,
}) {

  const audioARef =
    useRef(null);

  const audioBRef =
    useRef(null);

  const audioContextRef =
    useRef(null);

  const nodesRef =
    useRef(null);

  const replayTimersRef =
    useRef([]);

  const recordingRef =
    useRef({
      active:
        false,

      startedAt:
        0,

      events:
        [],
    });


  const [
    deckA,
    setDeckA,
  ] =
    useState(null);

  const [
    deckB,
    setDeckB,
  ] =
    useState(null);


  const [
    deckAPosition,
    setDeckAPosition,
  ] =
    useState({
      current: 0,
      duration: 0,
    });

  const [
    deckBPosition,
    setDeckBPosition,
  ] =
    useState({
      current: 0,
      duration: 0,
    });


  const [
    volumeA,
    setVolumeA,
  ] =
    useState(0.9);

  const [
    volumeB,
    setVolumeB,
  ] =
    useState(0.9);


  const [
    eqA,
    setEqA,
  ] =
    useState({
      ...INITIAL_EQ,
    });

  const [
    eqB,
    setEqB,
  ] =
    useState({
      ...INITIAL_EQ,
    });


  const [
    crossfader,
    setCrossfader,
  ] =
    useState(0);

  const [
    masterVolume,
    setMasterVolume,
  ] =
    useState(0.9);


  const [
    mixerActive,
    setMixerActive,
  ] =
    useState(false);


  const [
    playingA,
    setPlayingA,
  ] =
    useState(false);

  const [
    playingB,
    setPlayingB,
  ] =
    useState(false);


  const [
    recording,
    setRecording,
  ] =
    useState(false);


  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    sounds,
    setSounds,
  ] =
    useState([]);

  const [
    pickerDeck,
    setPickerDeck,
  ] =
    useState(null);


  const [
    sessions,
    setSessions,
  ] =
    useState([]);

  const [
    playlists,
    setPlaylists,
  ] =
    useState([]);

  const [
    playlistId,
    setPlaylistId,
  ] =
    useState("");


  const [
    notice,
    setNotice,
  ] =
    useState("");


  const apiRoot =
    `/games/${gameId}/realmlife/dj`;


  const recordEvent =
    useCallback(
      (
        type,
        payload = {}
      ) => {

        const recorder =
          recordingRef.current;


        if (
          !recorder.active
        ) {
          return;
        }


        recorder.events.push({
          t:
            Date.now()
            - recorder.startedAt,

          type,

          ...payload,
        });

      },
      []
    );


  // ==========================================================
  // WEB AUDIO GRAPH
  // ==========================================================

  useEffect(() => {

    // REALMLIFE DJ AUDIO GRAPH SINGLE-CONNECTION GUARD
    //
    // Do not create MediaElementSourceNodes until the user
    // actually opens the DJ Studio. Once created, reuse them.
    if (!open) {
      return;
    }


    if (
      !audioARef.current
      || !audioBRef.current
      || nodesRef.current
    ) {
      return;
    }


    // Capture the exact DOM elements this AudioContext owns.
    // A media element may only ever have one source node.
    const audioAElement =
      audioARef.current;

    const audioBElement =
      audioBRef.current;


    const AudioContext =
      window.AudioContext
      || window.webkitAudioContext;


    if (!AudioContext)
      return;


    const ctx =
      new AudioContext();


    audioContextRef.current =
      ctx;


    const buildDeck = (
      element
    ) => {

      const source =
        ctx.createMediaElementSource(
          element
        );


      const bass =
        ctx.createBiquadFilter();

      bass.type =
        "lowshelf";

      bass.frequency.value =
        90;


      const low =
        ctx.createBiquadFilter();

      low.type =
        "peaking";

      low.frequency.value =
        280;

      low.Q.value =
        0.8;


      const mid =
        ctx.createBiquadFilter();

      mid.type =
        "peaking";

      mid.frequency.value =
        1200;

      mid.Q.value =
        0.9;


      const high =
        ctx.createBiquadFilter();

      high.type =
        "highshelf";

      high.frequency.value =
        6000;


      const volume =
        ctx.createGain();


      const cross =
        ctx.createGain();


      source
        .connect(
          bass
        )
        .connect(
          low
        )
        .connect(
          mid
        )
        .connect(
          high
        )
        .connect(
          volume
        )
        .connect(
          cross
        );


      return {
        source,
        bass,
        low,
        mid,
        high,
        volume,
        cross,
      };
    };


    const a =
      buildDeck(
        audioAElement
      );


    const b =
      buildDeck(
        audioBElement
      );


    const master =
      ctx.createGain();


    a.cross.connect(
      master
    );

    b.cross.connect(
      master
    );


    master.connect(
      ctx.destination
    );


    nodesRef.current = {
      a,
      b,
      master,
    };


    // IMPORTANT:
    // Closing the DJ Studio is UI-only.
    //
    // DO NOT pause decks, clear replay timers or destroy the
    // WebAudio graph when `open` becomes false.
    //
    // Playback continues throughout RealmLife using the exact
    // mixer settings already selected.

  }, [open]);


  // ==========================================================
  // REALMLIFE DJ TRUE UNMOUNT CLEANUP
  //
  // Closing the mixer panel does NOT run this.
  // Leaving/unmounting RealmLife does.
  // ==========================================================

  useEffect(() => {
    return () => {
      replayTimersRef.current
        .forEach(
          (timer) =>
            window.clearTimeout(
              timer
            )
        );

      replayTimersRef.current =
        [];

      try {
        audioARef.current
          ?.pause();
      } catch (_) {}

      try {
        audioBRef.current
          ?.pause();
      } catch (_) {}

      const ctx =
        audioContextRef.current;

      if (
        ctx
        &&
        ctx.state !==
          "closed"
      ) {
        try {
          ctx.close();
        } catch (_) {}
      }

      nodesRef.current =
        null;

      audioContextRef.current =
        null;
    };
  }, []);


  // ==========================================================
  // AUDIO NODE UPDATES
  // ==========================================================

  useEffect(() => {

    const nodes =
      nodesRef.current;


    if (!nodes)
      return;


    nodes.a.volume.gain.value =
      volumeA;

    nodes.b.volume.gain.value =
      volumeB;


    nodes.a.bass.gain.value =
      eqA.bass;

    nodes.a.low.gain.value =
      eqA.low;

    nodes.a.mid.gain.value =
      eqA.mid;

    nodes.a.high.gain.value =
      eqA.high;


    nodes.b.bass.gain.value =
      eqB.bass;

    nodes.b.low.gain.value =
      eqB.low;

    nodes.b.mid.gain.value =
      eqB.mid;

    nodes.b.high.gain.value =
      eqB.high;


    const normalized =
      (
        crossfader + 1
      )
      / 2;


    nodes.a.cross.gain.value =
      Math.cos(
        normalized
        * Math.PI
        / 2
      );


    nodes.b.cross.gain.value =
      Math.sin(
        normalized
        * Math.PI
        / 2
      );


    nodes.master.gain.value =
      masterVolume;

  }, [
    volumeA,
    volumeB,
    eqA,
    eqB,
    crossfader,
    masterVolume,
  ]);


  // ==========================================================
  // POSITION MONITOR
  // ==========================================================

  useEffect(() => {

    const timer =
      window.setInterval(
        () => {

          const a =
            audioARef.current;

          const b =
            audioBRef.current;


          if (a) {

            setDeckAPosition({
              current:
                Number.isFinite(
                  a.currentTime
                )
                  ? a.currentTime
                  : 0,

              duration:
                Number.isFinite(
                  a.duration
                )
                  ? a.duration
                  : 0,
            });
          }


          if (b) {

            setDeckBPosition({
              current:
                Number.isFinite(
                  b.currentTime
                )
                  ? b.currentTime
                  : 0,

              duration:
                Number.isFinite(
                  b.duration
                )
                  ? b.duration
                  : 0,
            });
          }

        },
        150
      );


    return () =>
      window.clearInterval(
        timer
      );

  }, []);


  const loadLibrary =
    useCallback(
      async (
        q = ""
      ) => {

        try {

          const {
            data,
          } =
            await apiClient.get(
              `${apiRoot}/sounds`,
              {
                params: {
                  q,
                },
              }
            );


          setSounds(
            data?.sounds
            || []
          );

        } catch (err) {

          setNotice(
            err?.response
              ?.data?.detail
            ||
            "Could not load OurRealm Sounds."
          );
        }

      },
      [
        apiRoot,
      ]
    );


  const loadSaved =
    useCallback(
      async () => {

        try {

          const [
            sessionsResponse,
            playlistsResponse,
          ] =
            await Promise.all([
              apiClient.get(
                `${apiRoot}/sessions`
              ),

              apiClient.get(
                `${apiRoot}/playlists`
              ),
            ]);


          setSessions(
            sessionsResponse
              .data
              ?.sessions
            || []
          );


          const list =
            playlistsResponse
              .data
              ?.playlists
            || [];


          setPlaylists(
            list
          );


          setPlaylistId(
            (previous) =>
              previous
              || list[0]
                ?.id
              || ""
          );

        } catch (err) {

          console.debug(
            "[RealmLife DJ saved mixes]",
            err
          );
        }

      },
      [
        apiRoot,
      ]
    );


  useEffect(() => {

    if (!open)
      return;


    loadLibrary(
      ""
    );

    loadSaved();

  }, [
    open,
    loadLibrary,
    loadSaved,
  ]);


  const resumeAudioContext =
    async () => {

      const ctx =
        audioContextRef.current;


      if (
        ctx
        && ctx.state
        === "suspended"
      ) {

        await ctx.resume();
      }
    };


  const selectTrack =
    (
      deck,
      track
    ) => {

      const audio =
        deck === "A"
          ? audioARef.current
          : audioBRef.current;


      if (!audio)
        return;


      audio.pause();

      // ==================================================
      // REALMLIFE DJ TRUE SAME ORIGIN SOURCE V5F2B1G
      //
      // Do not give MediaElementSourceNode the CDN-backed
      // /api/media URL directly.
      //
      // The RealmLife backend verifies the Sound, retrieves
      // the actual bytes server-side, then returns them from
      // this same-origin DJ endpoint.
      // ==================================================

      audio.src =
        `/api/games/${encodeURIComponent(
          gameId
        )}/realmlife/dj/audio/${encodeURIComponent(
          track.id
        )}`;

      audio.load();


      if (deck === "A") {

        setDeckA(
          track
        );

        setPlayingA(
          false
        );

      } else {

        setDeckB(
          track
        );

        setPlayingB(
          false
        );
      }


      setPickerDeck(
        null
      );

      setNotice(
        `${track.title} loaded to Deck ${deck}.`
      );
    };


  const playDeck =
    async (
      deck,
      fromReplay = false
    ) => {

      await resumeAudioContext();


      const audio =
        deck === "A"
          ? audioARef.current
          : audioBRef.current;


      if (!audio?.src)
        return;


      if (!mixerActive) {

        const other =
          deck === "A"
            ? audioBRef.current
            : audioARef.current;


        other?.pause();


        if (deck === "A") {

          setPlayingB(
            false
          );

        } else {

          setPlayingA(
            false
          );
        }
      }


      try {

        // ==================================================
        // REALMLIFE DJ AUDIO CONTEXT RESUME V5F2B1B
        //
        // The HTMLMediaElement can advance normally while a
        // Web Audio AudioContext remains suspended.
        //
        // Since our deck MediaElementSource is routed through
        // EQ -> volume -> crossfader -> master -> destination,
        // the context MUST be running or playback is silent.
        //
        // PLAY is a direct user gesture, so this is the correct
        // place to resume Chrome/Safari Web Audio.
        // ==================================================

        const audioContext =
          nodesRef.current
            ?.master
            ?.context
          || null;


        if (
          audioContext
          &&
          audioContext.state ===
            "suspended"
        ) {

          await audioContext.resume();

          console.log(
            "[RealmLife DJ] AudioContext resumed:",
            audioContext.state
          );
        }


        if (
          audioContext
          &&
          audioContext.state ===
            "closed"
        ) {

          throw new Error(
            "RealmLife DJ AudioContext is closed."
          );
        }


        await audio.play();


        if (deck === "A") {

          setPlayingA(
            true
          );

        } else {

          setPlayingB(
            true
          );
        }


        if (!fromReplay) {

          recordEvent(
            "play",
            {
              deck,
            }
          );
        }

      } catch (err) {

        setNotice(
          "Your browser blocked playback. Click PLAY again."
        );
      }
    };


  const pauseDeck =
    (
      deck,
      fromReplay = false
    ) => {

      const audio =
        deck === "A"
          ? audioARef.current
          : audioBRef.current;


      audio?.pause();


      if (deck === "A") {

        setPlayingA(
          false
        );

      } else {

        setPlayingB(
          false
        );
      }


      if (!fromReplay) {

        recordEvent(
          "pause",
          {
            deck,
          }
        );
      }
    };


  const seekDeck =
    (
      deck,
      position,
      fromReplay = false
    ) => {

      const audio =
        deck === "A"
          ? audioARef.current
          : audioBRef.current;


      if (!audio)
        return;


      audio.currentTime =
        Math.max(
          0,
          Math.min(
            Number(position)
            || 0,

            Number.isFinite(
              audio.duration
            )
              ? audio.duration
              : Number(position)
                || 0
          )
        );


      if (!fromReplay) {

        recordEvent(
          "seek",
          {
            deck,
            position:
              audio.currentTime,
          }
        );
      }
    };


  const changeVolume =
    (
      deck,
      value,
      fromReplay = false
    ) => {

      const v =
        Math.max(
          0,
          Math.min(
            1,
            Number(value)
          )
        );


      if (deck === "A") {

        setVolumeA(
          v
        );

      } else {

        setVolumeB(
          v
        );
      }


      if (!fromReplay) {

        recordEvent(
          "volume",
          {
            deck,
            value: v,
          }
        );
      }
    };


  const changeEq =
    (
      deck,
      band,
      value,
      fromReplay = false
    ) => {

      const v =
        Math.max(
          -18,
          Math.min(
            18,
            Number(value)
          )
        );


      if (deck === "A") {

        setEqA(
          (old) => ({
            ...old,
            [band]:
              v,
          })
        );

      } else {

        setEqB(
          (old) => ({
            ...old,
            [band]:
              v,
          })
        );
      }


      if (!fromReplay) {

        recordEvent(
          "eq",
          {
            deck,
            band,
            value: v,
          }
        );
      }
    };


  const changeCrossfader =
    (
      value,
      fromReplay = false
    ) => {

      const v =
        Math.max(
          -1,
          Math.min(
            1,
            Number(value)
          )
        );


      setCrossfader(
        v
      );


      if (!fromReplay) {

        recordEvent(
          "crossfader",
          {
            value: v,
          }
        );
      }
    };


  const toggleMixer =
    (
      enabled,
      fromReplay = false
    ) => {

      const next =
        !!enabled;


      setMixerActive(
        next
      );


      if (
        !next
        &&
        playingA
        &&
        playingB
      ) {

        pauseDeck(
          "B"
        );
      }


      if (!fromReplay) {

        recordEvent(
          "mixer",
          {
            enabled:
              next,
          }
        );
      }
    };


  const beginRecording =
    () => {

      if (
        !deckA
        && !deckB
      ) {

        setNotice(
          "Load at least one Sound first."
        );

        return;
      }


      recordingRef.current = {
        active:
          true,

        startedAt:
          Date.now(),

        events:
          [],
      };


      setRecording(
        true
      );


      setNotice(
        "Recording RealmLife Mix…"
      );
    };


  const stopRecording =
    async () => {

      const recorder =
        recordingRef.current;


      if (
        !recorder.active
      ) {
        return;
      }


      recorder.active =
        false;


      setRecording(
        false
      );


      const duration =
        Date.now()
        - recorder.startedAt;


      const title =
        window.prompt(
          "Name this RealmLife Mix:",
          `RealmLife Mix ${new Date().toLocaleTimeString()}`
        );


      if (!title) {

        setNotice(
          "Mix recording discarded."
        );

        return;
      }


      try {

        await apiClient.post(
          `${apiRoot}/sessions`,
          {
            title,

            playlist_id:
              playlistId
              || null,

            duration_ms:
              duration,

            deck_a:
              deckA,

            deck_b:
              deckB,

            settings: {
              mixer_active:
                mixerActive,

              crossfader,

              master_volume:
                masterVolume,

              volume_a:
                volumeA,

              volume_b:
                volumeB,

              eq_a:
                eqA,

              eq_b:
                eqB,
            },

            events:
              recorder.events,
          }
        );


        await loadSaved();


        setNotice(
          `Saved "${title}" to your RealmLife Mix Playlist.`
        );

      } catch (err) {

        setNotice(
          err?.response
            ?.data?.detail
          ||
          "Could not save the mix."
        );
      }
    };


  const clearReplay =
    () => {

      replayTimersRef.current
        .forEach(
          (timer) =>
            window.clearTimeout(
              timer
            )
        );


      replayTimersRef.current =
        [];
    };


  const applyReplayEvent =
    (
      event
    ) => {

      switch (
        event.type
      ) {

        case "play":

          playDeck(
            event.deck,
            true
          );

          break;


        case "pause":

          pauseDeck(
            event.deck,
            true
          );

          break;


        case "seek":

          seekDeck(
            event.deck,
            event.position,
            true
          );

          break;


        case "volume":

          changeVolume(
            event.deck,
            event.value,
            true
          );

          break;


        case "eq":

          changeEq(
            event.deck,
            event.band,
            event.value,
            true
          );

          break;


        case "crossfader":

          changeCrossfader(
            event.value,
            true
          );

          break;


        case "mixer":

          toggleMixer(
            event.enabled,
            true
          );

          break;


        default:
          break;
      }
    };


  const replaySession =
    async (
      session
    ) => {

      clearReplay();


      pauseDeck(
        "A",
        true
      );

      pauseDeck(
        "B",
        true
      );


      if (
        session.deck_a
      ) {

        selectTrack(
          "A",
          session.deck_a
        );
      }


      if (
        session.deck_b
      ) {

        selectTrack(
          "B",
          session.deck_b
        );
      }


      const settings =
        session.settings
        || {};


      setMixerActive(
        !!settings
          .mixer_active
      );


      setCrossfader(
        Number(
          settings
            .crossfader
          ?? 0
        )
      );


      setMasterVolume(
        Number(
          settings
            .master_volume
          ?? 0.9
        )
      );


      setVolumeA(
        Number(
          settings
            .volume_a
          ?? 0.9
        )
      );


      setVolumeB(
        Number(
          settings
            .volume_b
          ?? 0.9
        )
      );


      setEqA({
        ...INITIAL_EQ,
        ...(
          settings
            .eq_a
          || {}
        ),
      });


      setEqB({
        ...INITIAL_EQ,
        ...(
          settings
            .eq_b
          || {}
        ),
      });


      // Allow media elements to load before timeline starts.
      await new Promise(
        (resolve) =>
          window.setTimeout(
            resolve,
            350
          )
      );


      (
        session.events
        || []
      ).forEach(
        (event) => {

          const timer =
            window.setTimeout(
              () =>
                applyReplayEvent(
                  event
                ),

              Math.max(
                0,
                Number(
                  event.t
                )
                || 0
              )
            );


          replayTimersRef.current
            .push(
              timer
            );
        }
      );


      setNotice(
        `Replaying "${session.title}".`
      );
    };


  const createMixPlaylist =
    async () => {

      const name =
        window.prompt(
          "Name your RealmLife Mix Playlist:"
        );


      if (!name)
        return;


      try {

        const {
          data,
        } =
          await apiClient.post(
            `${apiRoot}/playlists`,
            {
              name,
            }
          );


        await loadSaved();


        setPlaylistId(
          data?.playlist
            ?.id
          || ""
        );


        setNotice(
          "RealmLife Mix Playlist created."
        );

      } catch (err) {

        setNotice(
          err?.response
            ?.data?.detail
          ||
          "Could not create playlist."
        );
      }
    };


  const selectedPlaylist =
    useMemo(
      () =>
        playlists.find(
          (p) =>
            p.id
            === playlistId
        )
        || playlists[0]
        || null,

      [
        playlists,
        playlistId,
      ]
    );


  if (!open) {

    return (
      <>
        <audio
          ref={
            audioARef
          }
          preload="metadata"
          onEnded={() =>
            setPlayingA(
              false
            )
          }
        />

        <audio
          ref={
            audioBRef
          }
          preload="metadata"
          onEnded={() =>
            setPlayingB(
              false
            )
          }
        />
      </>
    );
  }


  return (
    <>
      <audio
        ref={
          audioARef
        }
        preload="metadata"
        onEnded={() =>
          setPlayingA(
            false
          )
        }
      />

      <audio
        ref={
          audioBRef
        }
        preload="metadata"
        onEnded={() =>
          setPlayingB(
            false
          )
        }
      />


      <div
        className="absolute inset-0 z-[350] p-3 overflow-y-auto"
        style={{
          background:
            "radial-gradient(circle at 50% 20%,rgba(8,43,65,.95),rgba(0,3,8,.985) 65%)",

          color:
            "#fff",

          backdropFilter:
            "blur(12px)",
        }}
      >
        <div
          className="max-w-[1180px] mx-auto"
        >
          <div
            className="flex items-center gap-3"
          >
            <div>
              <div
                className="text-[10px] font-black tracking-[.28em] text-cyan-300"
              >
                REALMLIFE MUSIC LAB
              </div>

              <div
                className="text-2xl font-black"
              >
                🎧 Dual-Deck DJ Studio
              </div>
            </div>

            <div
              className="flex-1"
            />

            <button
              type="button"
              onClick={() => {
                // Hide the control surface only.
                // Active decks / saved mix replay continue.
                setOpen(
                  false
                );
              }}
              className="rounded-xl px-4 py-2 border border-white/15 bg-white/5 font-black"
            >
              ✕ CLOSE
            </button>
          </div>


          <div
            className="grid md:grid-cols-2 gap-3 mt-4"
          >
            <Deck
              label="A"
              accent="#3eeaff"
              track={
                deckA
              }
              progress={
                deckAPosition
              }
              volume={
                volumeA
              }
              eq={
                eqA
              }
              playing={
                playingA
              }
              mixerActive={
                mixerActive
              }
              onChoose={() =>
                setPickerDeck(
                  "A"
                )
              }
              onPlay={() =>
                playDeck(
                  "A"
                )
              }
              onPause={() =>
                pauseDeck(
                  "A"
                )
              }
              onSeek={(value) =>
                seekDeck(
                  "A",
                  value
                )
              }
              onVolume={(value) =>
                changeVolume(
                  "A",
                  value
                )
              }
              onEq={(
                band,
                value
              ) =>
                changeEq(
                  "A",
                  band,
                  value
                )
              }
            />


            <Deck
              label="B"
              accent="#ff44da"
              track={
                deckB
              }
              progress={
                deckBPosition
              }
              volume={
                volumeB
              }
              eq={
                eqB
              }
              playing={
                playingB
              }
              mixerActive={
                mixerActive
              }
              onChoose={() =>
                setPickerDeck(
                  "B"
                )
              }
              onPlay={() =>
                playDeck(
                  "B"
                )
              }
              onPause={() =>
                pauseDeck(
                  "B"
                )
              }
              onSeek={(value) =>
                seekDeck(
                  "B",
                  value
                )
              }
              onVolume={(value) =>
                changeVolume(
                  "B",
                  value
                )
              }
              onEq={(
                band,
                value
              ) =>
                changeEq(
                  "B",
                  band,
                  value
                )
              }
            />
          </div>


          <div
            className="mt-3 rounded-2xl p-4 border border-cyan-300/20 bg-black/40"
          >
            <div
              className="flex items-center gap-3"
            >
              <button
                type="button"
                onClick={() =>
                  toggleMixer(
                    !mixerActive
                  )
                }
                className="rounded-xl px-4 py-2 font-black border"
                style={{
                  borderColor:
                    mixerActive
                      ? "#43f6ff"
                      : "rgba(255,255,255,.15)",

                  background:
                    mixerActive
                      ? "rgba(40,230,255,.14)"
                      : "rgba(255,255,255,.04)",
                }}
              >
                {mixerActive
                  ? "🎛 MIXER ACTIVE"
                  : "🎛 ACTIVATE MIXER"}
              </button>


              <div
                className="flex-1"
              />


              {!recording
                ? (
                  <button
                    type="button"
                    onClick={
                      beginRecording
                    }
                    className="rounded-xl px-4 py-2 font-black border border-red-400/50 bg-red-500/10"
                  >
                    ⏺ RECORD MIX
                  </button>
                )
                : (
                  <button
                    type="button"
                    onClick={
                      stopRecording
                    }
                    className="rounded-xl px-4 py-2 font-black border border-red-300 bg-red-500/25 animate-pulse"
                  >
                    ■ STOP & SAVE MIX
                  </button>
                )}
            </div>


            <div
              className="mt-4"
            >
              <div
                className="flex text-xs font-black"
              >
                <span
                  style={{
                    color:
                      "#3eeaff",
                  }}
                >
                  DECK A
                </span>

                <span
                  className="flex-1 text-center opacity-60"
                >
                  CROSSFADER
                </span>

                <span
                  style={{
                    color:
                      "#ff44da",
                  }}
                >
                  DECK B
                </span>
              </div>

              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={
                  crossfader
                }
                onChange={(e) =>
                  changeCrossfader(
                    Number(
                      e.target.value
                    )
                  )
                }
                style={
                  sliderStyle()
                }
              />
            </div>


            <div
              className="mt-3"
            >
              <div
                className="text-[10px] font-black opacity-60"
              >
                MASTER VOLUME
              </div>

              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={
                  masterVolume
                }
                onChange={(e) =>
                  setMasterVolume(
                    Number(
                      e.target.value
                    )
                  )
                }
                style={
                  sliderStyle()
                }
              />
            </div>
          </div>


          <div
            className="grid md:grid-cols-2 gap-3 mt-3"
          >
            <div
              className="rounded-2xl p-4 border border-white/10 bg-black/35"
            >
              <div
                className="flex items-center gap-2"
              >
                <div
                  className="font-black"
                >
                  💾 RealmLife Mix Playlists
                </div>

                <div
                  className="flex-1"
                />

                <button
                  type="button"
                  onClick={
                    createMixPlaylist
                  }
                  className="rounded-lg px-3 py-1.5 text-xs font-black border border-cyan-300/20 bg-cyan-400/5"
                >
                  + NEW PLAYLIST
                </button>
              </div>


              <select
                value={
                  selectedPlaylist
                    ?.id
                  || ""
                }
                onChange={(e) =>
                  setPlaylistId(
                    e.target.value
                  )
                }
                className="w-full mt-3 rounded-lg p-2 bg-black/40 border border-white/10"
              >
                {playlists.map(
                  (playlist) => (
                    <option
                      key={
                        playlist.id
                      }
                      value={
                        playlist.id
                      }
                    >
                      {playlist.name}
                    </option>
                  )
                )}
              </select>


              <div
                className="mt-4 space-y-2 max-h-[270px] overflow-y-auto"
              >
                {sessions.map(
                  (session) => (
                    <div
                      key={
                        session.id
                      }
                      className="rounded-xl p-3 border border-white/10 bg-white/[.035]"
                    >
                      <div
                        className="font-black"
                      >
                        {session.title}
                      </div>

                      <div
                        className="text-[10px] opacity-55"
                      >
                        {fmtTime(
                          (
                            session.duration_ms
                            || 0
                          )
                          / 1000
                        )}
                        {" · "}
                        {
                          session.events
                            ?.length
                          || 0
                        }
                        {" mixer actions"}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          replaySession(
                            session
                          )
                        }
                        className="mt-2 rounded-lg px-3 py-1.5 text-xs font-black border border-white/10 bg-white/5"
                      >
                        ▶ PLAY SAVED MIX
                      </button>
                    </div>
                  )
                )}


                {!sessions.length && (
                  <div
                    className="text-sm opacity-50"
                  >
                    No recorded mixes yet.
                  </div>
                )}
              </div>
            </div>


            <div
              className="rounded-2xl p-4 border border-white/10 bg-black/35"
            >
              <div
                className="font-black"
              >
                🎵 OurRealm Sounds
              </div>

              <div
                className="flex gap-2 mt-3"
              >
                <input
                  value={
                    search
                  }
                  onChange={(e) =>
                    setSearch(
                      e.target.value
                    )
                  }
                  onKeyDown={(e) => {

                    if (
                      e.key
                      === "Enter"
                    ) {

                      loadLibrary(
                        search
                      );
                    }
                  }}
                  placeholder="Search public Sounds…"
                  className="flex-1 rounded-lg p-2 bg-black/40 border border-white/10"
                />

                <button
                  type="button"
                  onClick={() =>
                    loadLibrary(
                      search
                    )
                  }
                  className="rounded-lg px-3 font-black border border-white/10 bg-white/5"
                >
                  SEARCH
                </button>
              </div>


              <div
                className="mt-3 space-y-1 max-h-[310px] overflow-y-auto"
              >
                {sounds.map(
                  (sound) => (
                    <div
                      key={
                        sound.id
                      }
                      className="flex items-center gap-2 rounded-xl p-2 border border-white/10 bg-white/[.03]"
                    >
                      <div
                        className="flex-1 min-w-0"
                      >
                        <div
                          className="font-bold text-sm truncate"
                        >
                          {sound.title}
                        </div>

                        <div
                          className="text-[10px] opacity-55 truncate"
                        >
                          {sound.artist}
                        </div>
                      </div>


                      <button
                        type="button"
                        onClick={() =>
                          selectTrack(
                            "A",
                            sound
                          )
                        }
                        className="rounded-lg px-2 py-1 text-[10px] font-black border border-cyan-300/25 text-cyan-200"
                      >
                        A
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          selectTrack(
                            "B",
                            sound
                          )
                        }
                        className="rounded-lg px-2 py-1 text-[10px] font-black border border-pink-300/25 text-pink-200"
                      >
                        B
                      </button>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>


          {!!notice && (
            <div
              className="mt-3 rounded-xl p-3 border border-white/10 bg-white/[.04] text-sm"
            >
              {notice}
            </div>
          )}


          {pickerDeck && (
            <div
              className="fixed inset-0 z-[420] flex items-center justify-center p-4"
              style={{
                background:
                  "rgba(0,0,0,.78)",

                backdropFilter:
                  "blur(10px)",
              }}
            >
              <div
                className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl p-4 border border-white/15 bg-[#05111c]"
              >
                <div
                  className="flex items-center"
                >
                  <div
                    className="font-black text-lg"
                  >
                    Load Deck {pickerDeck}
                  </div>

                  <div
                    className="flex-1"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setPickerDeck(
                        null
                      )
                    }
                    className="font-black"
                  >
                    ✕
                  </button>
                </div>


                <div
                  className="space-y-1 mt-3"
                >
                  {sounds.map(
                    (sound) => (
                      <button
                        type="button"
                        key={
                          sound.id
                        }
                        onClick={() =>
                          selectTrack(
                            pickerDeck,
                            sound
                          )
                        }
                        className="w-full text-left rounded-xl p-3 border border-white/10 bg-white/[.035]"
                      >
                        <div
                          className="font-black"
                        >
                          {sound.title}
                        </div>

                        <div
                          className="text-xs opacity-55"
                        >
                          {sound.artist}
                        </div>
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
