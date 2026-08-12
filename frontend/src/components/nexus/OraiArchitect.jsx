/* ORAi World Architect panel — chat + browser voice input + honest upload placeholders. */
import { useRef, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";

export const OraiArchitect = ({ zoneId, selectedId, onApplied, onAppliedInverse }) => {
  const [req, setReq] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [vol, setVol] = useState(1);
  const recRef = useRef(null);

  const say = (text) => {
    if (!speak || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 400));
    u.volume = vol;
    window.speechSynthesis.speak(u);
  };
  const stopSpeak = () => window.speechSynthesis?.cancel();

  const voice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast.message("Voice input not supported by this browser"); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = false;
    rec.onresult = (e) => setReq((p) => (p + " " + e.results[0][0].transcript).trim());
    rec.onend = () => setListening(false);
    recRef.current = rec; rec.start(); setListening(true);
  };
  const propose = async () => {
    if (!req.trim()) return;
    setBusy(true);
    try {
      const r = await apiClient.post("/nexus/orai/propose", { request: req, zone_id: zoneId, selected_entity: selectedId });
      setProposal(r.data.proposal);
      say(r.data.proposal.plan);
    } catch (e) { toast.error(e?.response?.data?.detail || "ORAi proposal failed"); }
    setBusy(false);
  };
  const decide = async (approve) => {
    try {
      const r = await apiClient.post("/nexus/orai/decide", { proposal_id: proposal.id, approve });
      toast.success(approve ? "Applied to draft" : "Rejected");
      if (approve && r.data.inverse_ops) onAppliedInverse?.(r.data.inverse_ops);
      setProposal(null); setReq(""); onApplied?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Decision failed"); }
  };

  return (
    <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3 flex flex-col" data-testid="nexus-card-orai">
      <div className="flex items-center gap-2">
        <div className="text-xs font-black text-cyan-300">ORAi WORLD ARCHITECT</div>
        <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-300 rounded px-1.5 py-0.5">LIVE</span>
      </div>
      <div className="flex gap-1.5 mt-2">
        <textarea value={req} onChange={(e) => setReq(e.target.value)} data-testid="nexus-orai-input"
          placeholder='e.g. "Build a floating market beside the Emerald Portal"'
          className="flex-1 bg-black/40 border border-white/10 rounded-lg p-2 text-[11px] text-white h-16 resize-none" />
        <button onClick={voice} data-testid="nexus-orai-voice-btn" title="Voice input (browser speech-to-text)"
          className={`w-10 rounded-lg text-lg ${listening ? "bg-red-500/70 animate-pulse" : "bg-white/10 hover:bg-white/20"}`}>🎙</button>
      </div>
      <button onClick={propose} disabled={busy} data-testid="nexus-orai-propose-btn"
        className="mt-2 text-xs font-bold bg-purple-500/80 hover:bg-purple-500 rounded-lg px-3 py-2 disabled:opacity-50">
        {busy ? "Understanding → Planning…" : "Propose Edit"}
      </button>
      <div className="flex gap-1 mt-2 items-center flex-wrap">
        <label className="flex items-center gap-1 text-[9px] font-bold text-white/60 cursor-pointer">
          <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} data-testid="nexus-orai-speak-toggle" /> 🔊 Spoken replies
        </label>
        <button onClick={stopSpeak} data-testid="nexus-orai-speak-stop" className="text-[9px] font-bold bg-white/10 rounded px-2 py-0.5">■ Stop</button>
        <input type="range" min="0" max="1" step="0.1" value={vol} onChange={(e) => setVol(parseFloat(e.target.value))}
          className="w-16" data-testid="nexus-orai-volume" title="Voice volume" />
        {["IMAGE", "VIDEO", "AUDIO", "3D MODEL", "DOCUMENT"].map((t) => (
          <button key={t} disabled title="Multimodal attachment analysis is a future upgrade"
            className="text-[9px] font-bold bg-white/5 text-white/35 rounded px-2 py-1 cursor-not-allowed" data-testid={`nexus-orai-upload-${t.toLowerCase().replace(" ", "-")}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="text-[9px] text-white/40 mt-1">Voice input + spoken replies use free browser speech APIs. 3D asset requests: use the Asset Studio panel.</div>
      {proposal && (
        <div className="mt-2 bg-black/40 rounded-lg p-2 overflow-y-auto" data-testid="nexus-orai-proposal">
          <div className="text-[11px] font-bold text-purple-300 mb-1">PLAN</div>
          <div className="text-[11px] text-white/80">{proposal.plan}</div>
          <div className="text-[11px] font-bold text-purple-300 mt-2 mb-1">STRUCTURED DIFF ({proposal.ops.length} ops)</div>
          <pre className="text-[10px] text-white/60 whitespace-pre-wrap max-h-40 overflow-y-auto">{JSON.stringify(proposal.ops, null, 1)}</pre>
          <div className="flex gap-2 mt-2">
            <button onClick={() => decide(true)} data-testid="nexus-orai-approve-btn"
              className="text-xs font-bold bg-emerald-500 text-black rounded-lg px-3 py-1.5">✓ Approve & Apply to Draft</button>
            <button onClick={() => decide(false)} data-testid="nexus-orai-reject-btn"
              className="text-xs bg-white/10 rounded-lg px-3 py-1.5">Reject</button>
          </div>
        </div>
      )}
      <div className="pt-2 text-[9px] text-white/40">
        Understand → Plan → Diff → Preview → Your approval → Draft. ORAi never edits the published world.
      </div>
    </div>
  );
};
