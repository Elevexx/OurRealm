// GENESIS CITY VENUE MUSIC
// Procedural WebAudio ambient beats for Night Lounge + Club 178.
// Fades in by distance — no audio assets, no network.

const FADE_NEAR = 7;
const FADE_FAR = 26;

function makeNoiseBuffer(ctx) {
  const len = ctx.sampleRate * 0.5;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function createVenueAudio(venueDefs) {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let schedTimer = null;
  let disposed = false;

  const venues = venueDefs.map((v) => ({
    ...v,
    bpm: v.style === "club" ? 128 : 96,
    gainNode: null,
    nextBeat: 0,
    step: 0,

    // Persistent Sound/playlist broadcast can temporarily
    // suppress this venue's procedural DEFAULT soundtrack.
    suppressed: false,
  }));

  const kick = (out, t, punch) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(punch, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.22);
  };

  const hat = (out, t, level) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "highpass";
    bp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.06);
  };

  const bass = (out, t, freq, dur, level, type) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = type === "square" ? 1400 : 620;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };

  // Warm lounge groove vs brighter club pattern.
  const LOUNGE_BASS = [55, 0, 65.4, 0, 55, 0, 49, 58.3];
  const CLUB_ARP = [220, 0, 261.6, 0, 329.6, 0, 261.6, 0];

  const scheduleVenue = (v, until) => {
    const beat = 60 / v.bpm / 2; // 8th notes
    if (v.nextBeat < ctx.currentTime) v.nextBeat = ctx.currentTime + 0.05;
    while (v.nextBeat < until) {
      const t = v.nextBeat;
      const s = v.step % 8;
      if (v.style === "club") {
        if (s % 2 === 0) kick(v.gainNode, t, 0.9);
        if (s % 2 === 1) hat(v.gainNode, t, 0.25);
        const n = CLUB_ARP[s];
        if (n) bass(v.gainNode, t, n, beat * 0.9, 0.12, "square");
        if (s === 0) bass(v.gainNode, t, 55, beat * 1.8, 0.3, "triangle");
      } else {
        if (s === 0 || s === 4) kick(v.gainNode, t, 0.7);
        if (s === 2 || s === 6) hat(v.gainNode, t, 0.12);
        const n = LOUNGE_BASS[s];
        if (n) bass(v.gainNode, t, n, beat * 1.6, 0.22, "triangle");
      }
      v.step += 1;
      v.nextBeat += beat;
    }
  };

  const start = () => {
    if (ctx || disposed) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    noiseBuf = makeNoiseBuffer(ctx);
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    venues.forEach((v) => {
      v.gainNode = ctx.createGain();
      v.gainNode.gain.value = 0;
      v.gainNode.connect(master);
    });
    schedTimer = window.setInterval(() => {
      if (!ctx || ctx.state !== "running") return;
      const until = ctx.currentTime + 0.4;
      venues.forEach((v) => {
        if (v.gainNode.gain.value > 0.003) scheduleVenue(v, until);
        else v.nextBeat = 0;
      });
    }, 120);
  };

  return {
    unlock() {
      if (disposed) return;
      if (!ctx) start();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    },

    update(px, pz) {
      if (!ctx || disposed) return;
      venues.forEach((v) => {
        const d = Math.hypot(px - v.x, pz - v.z);
        const spatialTarget =
          d <= FADE_NEAR
            ? 1
            : d >= FADE_FAR
            ? 0
            : 1 - (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR);

        const target =
          v.suppressed
            ? 0
            : spatialTarget;

        v.gainNode.gain.setTargetAtTime(
          target * target,
          ctx.currentTime,
          0.4
        );
      });
    },

    setSuppressed(
      venueId,
      suppressed
    ) {
      const venue =
        venues.find(
          (item) =>
            item.id ===
            venueId
        );

      if (!venue)
        return;

      venue.suppressed =
        Boolean(
          suppressed
        );

      if (
        venue.gainNode
        &&
        ctx
      ) {
        venue.gainNode.gain
          .setTargetAtTime(
            0,
            ctx.currentTime,
            0.18
          );
      }
    },

    dispose() {
      disposed = true;
      if (schedTimer) window.clearInterval(schedTimer);
      if (ctx) {
        try {
          ctx.close();
        } catch (_) {}
      }
      ctx = null;
    },
  };
}
