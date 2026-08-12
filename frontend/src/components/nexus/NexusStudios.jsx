/* 3D Asset Studio + Avatar Studio — founder panels backed by real Meshy provider + registry. */
import { useEffect, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";

export const NexusStudios = ({ zone, sel, applyOps }) => {
  const [tab, setTab] = useState("assets");
  const [libe, setLib] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [avatars, setAvatars] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    apiClient.get("/nexus/admin/assets/library").then((r) => setLib(r.data.assets || [])).catch(() => {});
    apiClient.get("/nexus/admin/assets/tasks").then((r) => setTasks(r.data.tasks || [])).catch(() => {});
    apiClient.get("/nexus/admin/avatars").then((r) => setAvatars(r.data.avatars || [])).catch(() => {});
  };
  useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, []);

  const gen = async () => {
    if (prompt.trim().length < 10) { toast.error("Describe the asset (10+ chars)"); return; }
    setBusy(true);
    try {
      await apiClient.post("/nexus/admin/assets/generate", { workflow: "text_preview", prompt, name: prompt.slice(0, 40) });
      toast.success("Meshy text-to-3D preview submitted");
      setPrompt(""); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Generate failed"); }
    setBusy(false);
  };
  const advance = async (action, t) => {
    try {
      const body = { action, task_id: t.meshy_task_id, workflow: t.workflow, name: t.context?.name };
      const r = await apiClient.post("/nexus/admin/assets/advance", body);
      toast.success(action === "store" ? `Stored ${r.data.asset?.url}` : `${action} submitted`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || `${action} failed`); }
  };
  const upload = (file) => {
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        await apiClient.post("/nexus/admin/assets/upload", { data_b64: rd.result.split(",")[1], name: file.name });
        toast.success("GLB validated + stored"); load();
      } catch (e) { toast.error(e?.response?.data?.detail || "Upload failed"); }
    };
    rd.readAsDataURL(file);
  };
  const assign = (url) => {
    if (!sel || !zone) { toast.message("Select an entity in the viewport first"); return; }
    applyOps([{ op: "update_entity", zone_id: zone.id, entity_id: sel, fields: { type: "model", props: { url } } }], "asset_assign");
    toast.success("Assigned model to selected entity (draft)");
  };
  const avatarPatch = async (id, patch) => {
    await apiClient.post("/nexus/admin/avatars", { id, ...patch });
    toast.success("Avatar updated"); load();
  };
  const addAvatarFromUrl = async (url, label) => {
    await apiClient.post("/nexus/admin/avatars", { label: label || "New avatar", url, status: "active", gender: "unspecified" });
    toast.success("Avatar registered"); load();
  };

  return (
    <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3" data-testid="nexus-card-studios">
      <div className="flex gap-2 items-center">
        <button onClick={() => setTab("assets")} data-testid="studio-tab-assets"
          className={`text-xs font-black rounded-lg px-3 py-1.5 ${tab === "assets" ? "bg-cyan-500 text-black" : "bg-white/10 text-cyan-300"}`}>◇ 3D ASSET STUDIO</button>
        <button onClick={() => setTab("avatars")} data-testid="studio-tab-avatars"
          className={`text-xs font-black rounded-lg px-3 py-1.5 ${tab === "avatars" ? "bg-cyan-500 text-black" : "bg-white/10 text-cyan-300"}`}>🧍 AVATAR STUDIO</button>
        <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-300 rounded px-1.5 py-0.5 ml-auto">Meshy LIVE</span>
      </div>
      {tab === "assets" && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1.5">
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} data-testid="studio-prompt"
              placeholder="Describe a 3D asset (text-to-3D)…"
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white" />
            <button onClick={gen} disabled={busy} data-testid="studio-generate-btn"
              className="text-[11px] font-bold bg-cyan-500 text-black rounded-lg px-3 disabled:opacity-50">Generate</button>
            <label className="text-[11px] font-bold bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 cursor-pointer">
              Upload GLB<input type="file" accept=".glb" className="hidden" data-testid="studio-upload-input"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          </div>
          {tasks.slice(0, 4).map((t) => (
            <div key={t.meshy_task_id} className="bg-black/30 rounded-lg p-2 text-[10px] text-white/70 flex items-center gap-2 flex-wrap" data-testid={`studio-task-${t.meshy_task_id.slice(0, 8)}`}>
              <span className="font-bold text-white/90">{t.context?.name || t.workflow}</span>
              <span>{t.workflow} · {t.status} {t.progress ?? 0}% · {t.consumed_credits ?? "?"}cr</span>
              <span className="ml-auto flex gap-1">
                <button onClick={() => advance("poll", t)} className="bg-white/10 rounded px-1.5 py-0.5">↻</button>
                {t.workflow === "text_preview" && t.status === "SUCCEEDED" && (
                  <button onClick={() => advance("refine", t)} className="bg-cyan-500/30 rounded px-1.5 py-0.5">Refine</button>
                )}
                {t.status === "SUCCEEDED" && ["text_refine", "image", "multi_image"].includes(t.workflow) && (
                  <>
                    <button onClick={() => advance("rig", t)} className="bg-purple-500/30 rounded px-1.5 py-0.5">Rig</button>
                    <button onClick={() => advance("store", t)} className="bg-emerald-500/40 rounded px-1.5 py-0.5">Store</button>
                  </>
                )}
              </span>
            </div>
          ))}
          <div className="text-[10px] font-black text-white/60">ASSET LIBRARY ({libe.length})</div>
          <div className="max-h-32 overflow-y-auto space-y-1" data-testid="studio-library">
            {libe.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-[10px] text-white/70">
                <span className="truncate flex-1">{a.name} <span className="text-white/35">{Math.round((a.meta?.bytes || 0) / 1024)}KB · anims {a.meta?.animations?.length || 0}</span></span>
                <button onClick={() => assign(a.url)} className="bg-white/10 rounded px-1.5 py-0.5" data-testid={`studio-assign-${a.id.slice(0, 6)}`}>→ Entity</button>
                <button onClick={() => addAvatarFromUrl(a.url, a.name)} className="bg-white/10 rounded px-1.5 py-0.5">→ Avatar</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "avatars" && (
        <div className="mt-2 space-y-1.5" data-testid="studio-avatars">
          {avatars.map((a) => (
            <div key={a.id} className="bg-black/30 rounded-lg p-2 text-[10px] text-white/75 flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white/90">{a.label}</span>
              <span className="text-white/40">{a.gender} · {a.status}{a.is_default ? " · DEFAULT" : ""}</span>
              <span className="ml-auto flex gap-1">
                {!a.is_default && <button onClick={() => avatarPatch(a.id, { is_default: true })} data-testid={`avatar-default-${a.id}`}
                  className="bg-emerald-500/30 rounded px-1.5 py-0.5">Set Default</button>}
                <button onClick={() => avatarPatch(a.id, { status: a.status === "active" ? "hidden" : "active" })} data-testid={`avatar-toggle-${a.id}`}
                  className="bg-white/10 rounded px-1.5 py-0.5">{a.status === "active" ? "Hide" : "Activate"}</button>
              </span>
            </div>
          ))}
          <div className="text-[9px] text-white/40">Members pick an active avatar on /nexus; the choice is saved to their account and synced to all sessions.</div>
        </div>
      )}
    </div>
  );
};
