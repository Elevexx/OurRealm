import apiClient from "@/api/client";

// ORAi Voice Engine — one shared singleton used by every ORAi surface
// (Founder Command Center, Responsibility/Education/Business Centers).
// speech → text → ORAi → spoken reply, with live waveform levels.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const stripForSpeech = (text) =>
  String(text || "")
    .replace(/```[\s\S]*?```/g, " code block omitted. ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_#>`~|]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/\s{2,}/g, " ")
    .trim();

class OraiVoiceEngine {
  constructor() {
    this.state = "idle"; // idle | listening | transcribing | speaking
    this.prefs = null;
    this.lastText = null;
    this.listeners = new Set();
    this.ctx = null;
    this.analyser = null;
    this.gainNode = null;
    this.source = null;
    this._speakResolve = null;
    this._stream = null;
    this._recorder = null;
    this._chunks = [];
    this._micAnalyser = null;
    this._micSource = null;
    this._vadTimer = null;
    this._listenPromise = null;
    this._prefsPromise = null;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { this.listeners.forEach((fn) => fn(this.state)); }
  _setState(s) { this.state = s; this._emit(); }

  async loadPrefs(force = false) {
    if (this.prefs && !force) return this.prefs;
    if (!this._prefsPromise || force) {
      this._prefsPromise = apiClient.get("/orai/voice/prefs")
        .then((r) => { this.prefs = r.data; return this.prefs; })
        .catch(() => this.prefs || { voice_id: "nova", speed: 1, pitch: 0, volume: 0.9, auto_speak: true, mode: "push", favorites: [] });
    }
    return this._prefsPromise;
  }

  async savePrefs(patch) {
    this.prefs = { ...(this.prefs || {}), ...patch };
    if (this.gainNode && patch.volume !== undefined) this.gainNode.gain.value = patch.volume;
    this._emit();
    try {
      const r = await apiClient.put("/orai/voice/prefs", patch);
      this.prefs = r.data;
      this._emit();
    } catch { /* keep optimistic value */ }
    return this.prefs;
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // Levels for the live waveform (0..1 per bar). Uses whichever analyser
  // matches the current state (mic while listening, output while speaking).
  getLevels(bars = 24) {
    const analyser = this.state === "listening" ? this._micAnalyser : this.analyser;
    if (!analyser) return null;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const out = new Array(bars).fill(0);
    const step = Math.floor(data.length / bars) || 1;
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
      out[i] = sum / step / 255;
    }
    return out;
  }

  _rms() {
    if (!this._micAnalyser) return 0;
    const data = new Uint8Array(this._micAnalyser.fftSize);
    this._micAnalyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) { const d = (data[i] - 128) / 128; sum += d * d; }
    return Math.sqrt(sum / data.length);
  }

  // ── Speaking ─────────────────────────────────────────────────────────
  async speak(text, { voiceId } = {}) {
    const clean = stripForSpeech(text);
    if (!clean) return;
    this.stopSpeaking();
    const p = await this.loadPrefs();
    this.lastText = text;
    const pitch = clamp(Number(p.pitch) || 0, -6, 6);
    const speed = clamp(Number(p.speed) || 1, 0.5, 2);
    // Pitch is applied client-side via detune (which also resamples), so we
    // pre-compensate the synth speed to keep the requested tempo.
    const serverSpeed = clamp(speed / Math.pow(2, pitch / 12), 0.25, 4);
    this._setState("speaking");
    try {
      const res = await apiClient.post("/orai/voice/tts",
        { text: clean.slice(0, 4000), voice_id: voiceId || p.voice_id, speed: serverSpeed },
        { responseType: "arraybuffer", timeout: 90000 });
      if (this.state !== "speaking") return; // user pressed stop meanwhile
      await this._playBuffer(res.data, pitch, p.volume);
    } catch (e) {
      this._setState("idle");
      throw e;
    }
  }

  async _playBuffer(arrayBuffer, pitch = 0, volume = 0.9) {
    const ctx = this._ensureCtx();
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    if (this.state !== "speaking") return;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = clamp(Number(volume) ?? 0.9, 0, 1);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (source.detune) source.detune.value = pitch * 100;
    source.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.source = source;
    await new Promise((resolve) => {
      this._speakResolve = resolve;
      source.onended = () => { if (this._speakResolve) { this._speakResolve(); this._speakResolve = null; } };
      source.start(0);
    });
    if (this.source === source) { this.source = null; this._setState("idle"); }
  }

  stopSpeaking() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch { /* already stopped */ }
      this.source = null;
    }
    if (this._speakResolve) { this._speakResolve(); this._speakResolve = null; }
    if (this.state === "speaking") this._setState("idle");
  }

  async repeat() {
    if (this.lastText) await this.speak(this.lastText);
  }

  // ── Listening ────────────────────────────────────────────────────────
  // Resolves with the transcript ("" if nothing detected). In hands-free
  // (vad) mode the recording auto-stops after ~1.5s of silence.
  async startListening({ vad = false } = {}) {
    if (this.state === "listening") return this._listenPromise;
    this.stopSpeaking();
    const ctx = this._ensureCtx();
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this._micSource = ctx.createMediaStreamSource(this._stream);
    this._micAnalyser = ctx.createAnalyser();
    this._micAnalyser.fftSize = 512;
    this._micSource.connect(this._micAnalyser);

    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
      .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    this._recorder = new MediaRecorder(this._stream, mime ? { mimeType: mime } : undefined);
    this._chunks = [];
    this._recorder.ondataavailable = (e) => { if (e.data?.size) this._chunks.push(e.data); };

    this._setState("listening");
    this._listenPromise = new Promise((resolve, reject) => {
      this._listenResolve = resolve;
      this._recorder.onstop = async () => {
        this._teardownMic();
        const blob = new Blob(this._chunks, { type: mime || "audio/webm" });
        this._chunks = [];
        if (blob.size < 1500) { this._setState("idle"); resolve(""); return; }
        this._setState("transcribing");
        try {
          const fd = new FormData();
          const ext = (mime || "").includes("mp4") ? "mp4" : "webm";
          fd.append("audio", blob, `voice.${ext}`);
          const r = await apiClient.post("/orai/voice/transcribe", fd, { timeout: 60000 });
          this._setState("idle");
          resolve((r.data?.text || "").trim());
        } catch (e) { this._setState("idle"); reject(e); }
      };
      this._recorder.onerror = (e) => { this._teardownMic(); this._setState("idle"); reject(e); };
    });
    this._recorder.start(250);

    if (vad) {
      let spoke = false;
      let silentSince = null;
      const startedAt = Date.now();
      this._vadTimer = setInterval(() => {
        if (this.state !== "listening") { clearInterval(this._vadTimer); return; }
        const rms = this._rms();
        if (rms > 0.025) { spoke = true; silentSince = null; }
        else if (spoke) {
          if (!silentSince) silentSince = Date.now();
          else if (Date.now() - silentSince > 1500) this.stopListening();
        }
        if (Date.now() - startedAt > 60000) this.stopListening();
        if (!spoke && Date.now() - startedAt > 12000) this.cancelListening();
      }, 120);
    }
    return this._listenPromise;
  }

  stopListening() {
    if (this._vadTimer) { clearInterval(this._vadTimer); this._vadTimer = null; }
    if (this._recorder && this._recorder.state !== "inactive") this._recorder.stop();
  }

  cancelListening() {
    if (this._vadTimer) { clearInterval(this._vadTimer); this._vadTimer = null; }
    const resolve = this._listenResolve;
    this._listenResolve = null;
    if (this._recorder && this._recorder.state !== "inactive") {
      this._recorder.onstop = () => {
        this._teardownMic();
        this._setState("idle");
        if (resolve) resolve("");
      };
      this._recorder.stop();
    } else {
      this._teardownMic();
      if (this.state === "listening") this._setState("idle");
      if (resolve) resolve("");
    }
    this._chunks = [];
  }

  _teardownMic() {
    if (this._stream) { this._stream.getTracks().forEach((t) => t.stop()); this._stream = null; }
    if (this._micSource) { try { this._micSource.disconnect(); } catch { /* noop */ } this._micSource = null; }
    this._micAnalyser = null;
  }
}

export const oraiVoice = new OraiVoiceEngine();
