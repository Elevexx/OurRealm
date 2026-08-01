import React, { useEffect, useState } from "react";
import { Mic, Square, RotateCcw, Volume2, VolumeX, Infinity as InfinityIcon, SlidersHorizontal, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { oraiVoice } from "@/lib/oraiVoiceEngine";
import { OraiWaveform } from "@/components/orai/OraiWaveform";
import { OraiVoiceLibrary } from "@/components/orai/OraiVoiceLibrary";

const STATE_LABEL = {
  idle: "Tap the mic to talk",
  listening: "Listening…",
  transcribing: "Understanding…",
  speaking: "ORAi is speaking…",
};

// Shared ORAi voice control strip. `onSubmit(text)` must send the text to
// the surface's chat and resolve with the reply text (or null on failure).
export const OraiVoiceBar = ({ onSubmit, accent = "#C26BFF", testidPrefix = "orai" }) => {
  const [state, setState] = useState(oraiVoice.state);
  const [prefs, setPrefs] = useState(oraiVoice.prefs);
  const [handsFree, setHandsFree] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [thinking, setThinking] = useState(false);

  useEffect(() => {
    const unsub = oraiVoice.subscribe(() => { setState(oraiVoice.state); setPrefs({ ...(oraiVoice.prefs || {}) }); });
    oraiVoice.loadPrefs().then((p) => setPrefs({ ...p }));
    return unsub;
  }, []);

  useEffect(() => () => { oraiVoice.cancelListening(); oraiVoice.stopSpeaking(); }, []);

  const runTurn = async (vad) => {
    let transcript = "";
    try {
      transcript = await oraiVoice.startListening({ vad });
    } catch (e) {
      if (e?.name === "NotAllowedError" || e?.name === "NotFoundError") {
        toast.error("Microphone access is blocked — allow it in your browser settings.");
      } else {
        toast.error(e?.response?.data?.detail || "Could not capture that — try again.");
      }
      return "error";
    }
    if (!transcript) return "silence";
    setThinking(true);
    let reply = null;
    try { reply = await onSubmit(transcript); } finally { setThinking(false); }
    if (reply && (oraiVoice.prefs?.auto_speak ?? true)) {
      try { await oraiVoice.speak(reply); } catch { toast.error("ORAi voice is unavailable right now"); }
    }
    return "spoke";
  };

  // Ref mirror so the async loop sees toggles immediately.
  const handsFreeRef = React.useRef(false);

  const startHandsFree = async () => {
    handsFreeRef.current = true;
    setHandsFree(true);
    // Continuous loop: listen → reply → speak → listen again.
    while (handsFreeRef.current) {
      const res = await runTurn(true);
      if (res !== "spoke") break; // error or silence → end hands-free
    }
    handsFreeRef.current = false;
    setHandsFree(false);
  };

  const stopHandsFree = () => {
    handsFreeRef.current = false;
    setHandsFree(false);
    oraiVoice.cancelListening();
  };

  const micTap = async () => {
    if (state === "listening") { oraiVoice.stopListening(); return; }
    if (state === "speaking") oraiVoice.stopSpeaking();
    if (state !== "idle") return;
    await runTurn(false);
  };

  const busy = thinking || state === "transcribing";
  const autoSpeak = prefs?.auto_speak ?? true;

  return (
    <>
      <div className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 mb-2"
        style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${accent}33` }}
        data-testid={`${testidPrefix}-voice-bar`}>
        <button type="button" onClick={micTap} disabled={busy || handsFree}
          className="shrink-0 rounded-full p-2 transition-transform hover:scale-105"
          style={{
            background: state === "listening" ? "#FF6B6B" : `${accent}22`,
            border: `1px solid ${state === "listening" ? "#FF6B6B" : `${accent}66`}`,
            color: state === "listening" ? "#fff" : accent,
            boxShadow: state === "listening" ? "0 0 14px rgba(255,107,107,0.6)" : "none",
          }}
          title={state === "listening" ? "Stop and send" : "Tap to talk"}
          aria-label="Tap to talk" data-testid={`${testidPrefix}-voice-mic`}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
        </button>

        <button type="button" onClick={() => (handsFree ? stopHandsFree() : startHandsFree())}
          disabled={busy}
          className="shrink-0 rounded-full p-2 transition-transform hover:scale-105"
          style={{
            background: handsFree ? `${accent}` : "transparent",
            border: `1px solid ${accent}55`,
            color: handsFree ? "#0A0F1A" : accent,
          }}
          title={handsFree ? "Stop hands-free conversation" : "Start hands-free conversation"}
          aria-label="Hands-free conversation" data-testid={`${testidPrefix}-voice-handsfree`}>
          <InfinityIcon size={15} />
        </button>

        <div className="flex-1 min-w-0">
          <OraiWaveform height={26} color={state === "listening" ? "#FF6B6B" : accent}
            testid={`${testidPrefix}-voice-waveform`} />
          <div className="text-[9px] leading-none mt-0.5 truncate" style={{ color: "var(--text-muted)" }}
            data-testid={`${testidPrefix}-voice-state`}>
            {thinking ? "ORAi is thinking…" : (handsFree && state === "idle" ? "Hands-free — waiting…" : STATE_LABEL[state])}
          </div>
        </div>

        {state === "speaking" && (
          <button type="button" onClick={() => oraiVoice.stopSpeaking()}
            className="shrink-0 rounded-full p-2" style={{ border: "1px solid #FF6B6B66", color: "#FF6B6B" }}
            title="Stop speaking" aria-label="Stop speaking" data-testid={`${testidPrefix}-voice-stop`}>
            <Square size={13} />
          </button>
        )}
        <button type="button" onClick={() => oraiVoice.repeat().catch(() => toast.error("Nothing to repeat yet"))}
          disabled={!oraiVoice.lastText || state !== "idle"}
          className="shrink-0 rounded-full p-2 disabled:opacity-30"
          style={{ border: "1px solid rgba(255,255,255,0.14)", color: "var(--text-muted)" }}
          title="Repeat last response" aria-label="Repeat last response" data-testid={`${testidPrefix}-voice-repeat`}>
          <RotateCcw size={13} />
        </button>
        <button type="button" onClick={() => oraiVoice.savePrefs({ auto_speak: !autoSpeak })}
          className="shrink-0 rounded-full p-2"
          style={{ border: "1px solid rgba(255,255,255,0.14)", color: autoSpeak ? "#10E670" : "var(--text-muted)" }}
          title={autoSpeak ? "Auto speak: on" : "Auto speak: off"} aria-label="Toggle auto speak"
          data-testid={`${testidPrefix}-voice-autospeak`}>
          {autoSpeak ? <Volume2 size={13} /> : <VolumeX size={13} />}
        </button>
        <button type="button" onClick={() => setLibraryOpen(true)}
          className="shrink-0 rounded-full p-2"
          style={{ border: "1px solid rgba(255,255,255,0.14)", color: "var(--text-muted)" }}
          title="ORAi Voice Library" aria-label="Open voice settings" data-testid={`${testidPrefix}-voice-settings`}>
          <SlidersHorizontal size={13} />
        </button>
      </div>
      <OraiVoiceLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} accent={accent} />
    </>
  );
};
