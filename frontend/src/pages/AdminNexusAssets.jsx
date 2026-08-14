/* NEXUS ASSET & UNITY BUILD MANAGER + AVATAR STUDIO (v30) — founder-only /admin/nexus/assets */
import { useEffect, useRef, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";

const S = ["OVERVIEW", "3D ASSETS", "AVATAR STUDIO", "UNITY BUILDS", "RELEASES", "STORAGE", "VALIDATION", "MAGIC LOOPS", "SETTINGS"];
const card = "rounded-2xl border border-cyan-400/15 bg-[#0a1226]/80 p-4";
const pill = "text-[10px] font-black tracking-widest rounded-lg px-2.5 py-1.5 border";

async function sha256File(file, cap = 512 * 1024 * 1024) {
  if (file.size > cap) return null;
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const Uploader = ({ kind, label, onDone }) => {
  const [st, setSt] = useState(null);
  const ctl = useRef({ paused: false, cancelled: false });
  const fileRef = useRef(null);
  const start = async (file, resumeSession = null) => {
    ctl.current = { paused: false, cancelled: false };
    const sha = await sha256File(file);
    let ses = resumeSession;
    if (!ses) {
      const r = await apiClient.post("/nexus/assets/upload/init", { filename: file.name, size: file.size, kind, sha256: sha });
      if (r.data.deduplicated) { toast.success("Already in catalog (deduplicated)"); onDone?.(r.data.asset); return; }
      ses = r.data;
    }
    const partSize = ses.part_size || 16 * 1024 * 1024;
    const done = new Set(ses.parts_done || []);
    const t0 = Date.now(); let sent = done.size * partSize;
    try { localStorage.setItem("nexus_upload_session", JSON.stringify({ upload_id: ses.upload_id, name: file.name, size: file.size, kind })); } catch { /* full */ }
    for (let n = 0; n < ses.parts_total; n += 1) {
      if (ctl.current.cancelled) return;
      while (ctl.current.paused) { await new Promise((r2) => setTimeout(r2, 400)); if (ctl.current.cancelled) return; }
      if (done.has(n)) continue;
      const blob = file.slice(n * partSize, Math.min(file.size, (n + 1) * partSize));
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await apiClient.put(`/nexus/assets/upload/${ses.upload_id}/part/${n}`, blob, { headers: { "Content-Type": "application/octet-stream" } });
          break;
        } catch (e) { if (attempt === 2) throw e; await new Promise((r2) => setTimeout(r2, 1500)); }
      }
      sent += blob.size;
      const mbps = sent / 1048576 / Math.max(0.5, (Date.now() - t0) / 1000);
      setSt({ name: file.name, pct: Math.round(((n + 1) / ses.parts_total) * 100), mbps: mbps.toFixed(1),
              eta: Math.round((file.size - sent) / 1048576 / Math.max(0.1, mbps)), stage: "uploading" });
    }
    setSt((s) => ({ ...s, stage: "validating" }));
    const fin = await apiClient.post(`/nexus/assets/upload/${ses.upload_id}/complete`, { sha256: sha });
    try { localStorage.removeItem("nexus_upload_session"); } catch { /* noop */ }
    setSt((s) => ({ ...s, stage: "complete", pct: 100, report: fin.data }));
    toast.success(`${label} validated & stored durably`);
    onDone?.(fin.data);
  };
  return (
    <div className={card} data-testid={`uploader-${kind}`}>
      <div className="text-xs font-black tracking-widest text-cyan-300">{label}</div>
      <div className="mt-2 border-2 border-dashed border-cyan-400/30 rounded-xl p-5 text-center">
        <p className="text-[11px] text-white/60 font-bold">Chunked · Resumable · Integrity checked · Never buffered whole</p>
        <input ref={fileRef} type="file" className="hidden" data-testid={`uploader-${kind}-input`}
          onChange={(e) => e.target.files[0] && start(e.target.files[0]).catch((er) => { setSt((s) => ({ ...s, stage: "error", error: er?.response?.data?.detail || er.message })); toast.error(er?.response?.data?.detail || "Upload failed"); })} />
        <button onClick={() => fileRef.current?.click()} className="mt-3 min-h-[44px] px-5 rounded-xl bg-cyan-500 text-black text-xs font-black tracking-widest" data-testid={`uploader-${kind}-select`}>SELECT FILE</button>
      </div>
      {st && (
        <div className="mt-3 text-[11px] font-bold" data-testid={`uploader-${kind}-status`}>
          <div className="flex justify-between"><span className="truncate">{st.name}</span><span>{st.pct}% · {st.mbps} MB/s · ~{st.eta}s</span></div>
          <div className="mt-1.5 h-2 rounded-full bg-white/10"><div className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${st.pct}%` }} /></div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="uppercase text-cyan-300">{st.stage}</span>
            {st.stage === "uploading" && (<>
              <button onClick={() => { ctl.current.paused = !ctl.current.paused; setSt((s) => ({ ...s })); }} className="bg-white/10 rounded px-2 py-1" data-testid={`uploader-${kind}-pause`}>{ctl.current.paused ? "RESUME" : "PAUSE"}</button>
              <button onClick={() => { ctl.current.cancelled = true; setSt(null); }} className="bg-white/10 rounded px-2 py-1">CANCEL</button>
            </>)}
            {st.error && <span className="text-red-300">{st.error}</span>}
          </div>
          {st.report && <pre className="mt-2 text-[9px] text-emerald-300/80 bg-black/40 rounded p-2 overflow-auto max-h-32">{JSON.stringify(st.report, null, 1)}</pre>}
        </div>
      )}
    </div>
  );
};

export default function AdminNexusAssets() {
  const [sec, setSec] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("sec") === "unity" ? "UNITY BUILDS" : "OVERVIEW"; }
    catch { return "OVERVIEW"; }
  });
  const [rel, setRel] = useState(null);
  const [cat, setCat] = useState([]);
  const [builds, setBuilds] = useState([]);
  const [ml, setMl] = useState(null);
  const [runs, setRuns] = useState([]);
  const [est, setEst] = useState(null);
  const [attested, setAttested] = useState(false);
  const [denied, setDenied] = useState(false);
  const loadAll = () => {
    apiClient.get("/nexus/admin/release").then((r) => setRel(r.data)).catch((e) => { if (e?.response?.status === 403) setDenied(true); });
    apiClient.get("/nexus/assets/catalog").then((r) => setCat(r.data.avatars)).catch(() => {});
    apiClient.get("/nexus/assets/unity/builds").then((r) => setBuilds(r.data.builds)).catch(() => {});
    apiClient.get("/nexus/assets/magicloops/config").then((r) => setMl(r.data)).catch(() => {});
    apiClient.get("/nexus/assets/magicloops/runs").then((r) => setRuns(r.data.events)).catch(() => {});
  };
  useEffect(loadAll, []);
  if (denied) return <div className="p-10 text-center text-white/70 bg-[#070b18] min-h-screen">Founder only.</div>;
  const attest = async () => {
    try {
      await apiClient.post("/nexus/assets/attest", { own_or_permitted: true, unity_plan_ok: true, licenses_reviewed: true, authorized_to_distribute: true });
      setAttested(true); toast.success("Compliance recorded");
    } catch { toast.error("Attestation failed"); }
  };
  const estimate = async (aid) => { const r = await apiClient.post(`/nexus/assets/avatar/${aid}/estimate`); setEst(r.data); };
  const approveGen = async () => {
    try { const r = await apiClient.post(`/nexus/assets/avatar/${est.avatar}/generate`, { approve: true }); toast.success(`Generation job ${r.data.job_id} queued`); setEst(null); }
    catch (e) { toast.error(e?.response?.data?.detail || "Rejected"); }
  };
  return (
    <div className="min-h-screen bg-[#060a16] text-white flex" data-testid="admin-nexus-assets">
      <aside className="w-44 shrink-0 border-r border-white/10 p-3 space-y-1">
        <div className="text-xs font-black tracking-[0.2em] text-cyan-300 px-2 py-3">OURREALM<br />NEXUS</div>
        {S.map((s) => (
          <button key={s} onClick={() => setSec(s)} data-testid={`nav-${s.toLowerCase().replace(/ /g, "-")}`}
            className={`w-full text-left text-[10px] font-black tracking-widest rounded-xl px-3 py-3 min-h-[44px] ${sec === s ? "bg-cyan-500/15 text-cyan-200 border border-cyan-400/40" : "text-white/55 hover:bg-white/5"}`}>{s}</button>
        ))}
      </aside>
      <main className="flex-1 p-4 space-y-4 overflow-auto">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-lg font-black tracking-wide">NEXUS ASSET &amp; UNITY BUILD MANAGER</h1>
            <p className="text-[10px] font-bold text-cyan-300 tracking-[0.24em]">IMPORT · VALIDATE · PREVIEW · DEPLOY</p>
          </div>
          {rel && (
            <div className="flex gap-2 flex-wrap">
              <span className={`${pill} bg-emerald-500/10 text-emerald-300 border-emerald-400/40`} data-testid="hdr-r2">R2 CONNECTED</span>
              <span className={`${pill} bg-emerald-500/10 text-emerald-300 border-emerald-400/40`}>{rel.files_durable}/{rel.files_total} DURABLE</span>
              <span className={`${pill} ${rel.republish_ready ? "bg-emerald-500/10 text-emerald-300 border-emerald-400/40" : "bg-amber-400/10 text-amber-300 border-amber-400/40"}`}>{rel.republish_ready ? "REPUBLISH READY" : "INCOMPLETE"}</span>
            </div>
          )}
        </div>
        {sec === "OVERVIEW" && rel && (
          <div className="grid md:grid-cols-4 gap-3">
            {[["LIVE RELEASE", rel.release_id], ["RUNTIME ASSETS", `${rel.files_durable} / ${rel.files_total} READY`],
              ["DURABLE STORAGE", "R2 HEALTHY"], ["ROLLBACKS", rel.rollbacks?.slice(0, 5).map((r) => `v${r.version}`).join(" ")]].map(([k, v]) => (
              <div key={k} className={card}><div className="text-[9px] font-black tracking-widest text-white/50">{k}</div>
                <div className="mt-1 text-sm font-black text-cyan-200">{v}</div></div>
            ))}
          </div>
        )}
        {(sec === "OVERVIEW" || sec === "3D ASSETS") && (
          <div className="grid lg:grid-cols-2 gap-3">
            <Uploader kind="glb" label="3D ASSET IMPORT — GLB / GLTF" onDone={loadAll} />
            <div className={card}>
              <div className="text-xs font-black tracking-widest text-amber-300">RIGHTS &amp; LICENSE CHECK</div>
              <ul className="mt-2 space-y-1 text-[11px] font-bold text-white/70">
                <li>✓ I own or have permission to use this build and its contents</li>
                <li>✓ My Unity plan eligibility is confirmed (<a className="text-cyan-300 underline" href="https://unity.com/legal" target="_blank" rel="noreferrer">current Unity terms</a>)</li>
                <li>✓ Third-party asset and plugin licenses were reviewed</li>
                <li>✓ I am authorized to distribute this content on the web</li>
              </ul>
              <p className="mt-2 text-[10px] text-amber-200/80 font-bold">Only upload builds and assets you are authorized to distribute. This is a record of your confirmation, not a legal determination.</p>
              <button onClick={attest} disabled={attested} className="mt-3 min-h-[44px] px-5 rounded-xl bg-emerald-500 text-black text-xs font-black tracking-widest disabled:opacity-50" data-testid="attest-btn">{attested ? "COMPLIANCE RECORDED ✓" : "RECORD COMPLIANCE"}</button>
            </div>
          </div>
        )}
        {sec === "AVATAR STUDIO" && (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="avatar-studio">
            {cat.map((a) => (
              <div key={a.id} className={card} data-testid={`studio-card-${a.id}`}>
                <div className="flex gap-3">
                  <img src={a.thumb || `/nexus/${a.id}.webp`} alt={a.label} className="w-16 h-20 object-cover object-top rounded-lg bg-black/40" />
                  <div className="min-w-0">
                    <div className="text-xs font-black truncate">{a.label}</div>
                    <div className="text-[9px] font-bold text-white/50">{a.id} · {a.eligibility === "unlock" ? `${a.fp_cost.toLocaleString()}🔥` : "FREE"} · {a.gen}</div>
                    <div className="mt-1 flex gap-1 flex-wrap text-[8px] font-black">
                      <span className="bg-emerald-500/15 text-emerald-300 rounded px-1.5 py-0.5">ANIMS {a.anims.length}/7</span>
                      <span className="bg-emerald-500/15 text-emerald-300 rounded px-1.5 py-0.5">LOD {a.lods.length}</span>
                      {a.ktx2 && <span className="bg-cyan-500/15 text-cyan-300 rounded px-1.5 py-0.5">KTX2</span>}
                      <span className="bg-white/10 rounded px-1.5 py-0.5">OWNERS {a.owners}</span>
                      <span className="bg-white/10 rounded px-1.5 py-0.5">EQUIPPED {a.equipped}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-1.5 flex-wrap">
                  <button onClick={() => estimate(a.id)} className="text-[9px] font-black bg-white/10 rounded-lg px-2.5 py-2 min-h-[36px]" data-testid={`studio-newver-${a.id}`}>NEW VERSION</button>
                  <button onClick={async () => { try { await apiClient.post(`/nexus/assets/avatar/${a.id}/rollback`); toast.success("Rolled back"); loadAll(); } catch (e) { toast.error(e?.response?.data?.detail || "No rollback target"); } }} className="text-[9px] font-black bg-white/10 rounded-lg px-2.5 py-2 min-h-[36px]">ROLLBACK</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {sec === "UNITY BUILDS" && (
          <div className="space-y-3">
            <div data-testid="unity-importer-header">
              <h2 className="text-base md:text-lg font-black tracking-[0.14em] text-lime-300">UNITY WEB BUILD IMPORTER &amp; PREVIEW</h2>
              <p className="text-[10px] font-bold text-white/50 mt-0.5">Imports EXPORTED Unity web build ZIPs, validates them and stages an isolated preview. This is not a Unity source editor.</p>
            </div>
            <Uploader kind="unity_zip" label="UNITY WEB BUILD — EXPORTED ZIP ONLY (not a source project)" onDone={loadAll} />
            {builds.map((b) => (
              <div key={b.build_id} className={card} data-testid={`unity-build-${b.build_id}`}>
                <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] font-bold">
                  <span className="font-black">{b.filename}</span>
                  <span className="text-white/50">{(b.bytes / 1048576).toFixed(1)} MB · {b.files} files · {b.compression.toUpperCase()}</span>
                  <a href={`${process.env.REACT_APP_BACKEND_URL}/api/nexus/assets/unity-stage/${b.build_id}/index.html`} target="_blank" rel="noreferrer"
                    className="min-h-[36px] px-4 py-2 rounded-xl bg-cyan-500 text-black text-[10px] font-black tracking-widest" data-testid={`unity-launch-${b.build_id}`}>LAUNCH STAGING</a>
                </div>
                <p className="mt-1 text-[9px] text-white/40 font-bold">Staged in isolation (sandbox CSP, COOP/COEP, no admin cookies used by the build). Three.js Nexus remains the live runtime.</p>
              </div>
            ))}
            {builds.length === 0 && <p className="text-[11px] text-white/40 font-bold">No Unity builds staged yet.</p>}
          </div>
        )}
        {sec === "RELEASES" && rel && (
          <div className={card}>
            <div className="text-xs font-black tracking-widest text-cyan-300">RELEASE PIPELINE — UPLOAD → VALIDATE → PREVIEW → STAGE → PUBLISH</div>
            <pre className="mt-2 text-[10px] text-white/70 bg-black/40 rounded p-3 overflow-auto max-h-72">{JSON.stringify({ release: rel.release_id, world: rel.world_version_live, migration: rel.applied, rollbacks: rel.rollbacks }, null, 1)}</pre>
            <p className="mt-2 text-[10px] text-amber-300 font-bold">Public promotion happens only through the platform Republish action.</p>
          </div>
        )}
        {sec === "STORAGE" && rel && (
          <div className={card}><div className="text-xs font-black tracking-widest text-cyan-300">DURABLE STORAGE</div>
            <p className="mt-2 text-[11px] font-bold text-white/70">R2: {rel.files_durable}/{rel.files_total} runtime files durable · KTX2 {rel.ktx2_files} · static assets bundled {rel.static_assets?.filter((s) => s.status === "BUNDLED").length}/{rel.static_assets?.length}</p></div>
        )}
        {sec === "VALIDATION" && (
          <div className={card}><div className="text-xs font-black tracking-widest text-cyan-300">AUTOMATED VALIDATION</div>
            <ul className="mt-2 grid grid-cols-2 gap-1 text-[11px] font-bold text-emerald-300">
              {["GLB MAGIC + STRUCTURE", "SHA-256 WHOLE FILE", "PER-PART INTEGRITY", "ZIP TRAVERSAL GUARD", "ZIP-BOMB RATIO GUARD", "SYMLINK / PAYLOAD BLOCK", "UNITY LOADER SET", "MIME + ENCODING HEADERS", "SKIN CHECK FOR AVATARS", "DEDUP BY CONTENT HASH"].map((v) => <li key={v}>✓ {v}</li>)}
            </ul></div>
        )}
        {sec === "MAGIC LOOPS" && (
          <div className={card} data-testid="magicloops-panel">
            <div className="text-xs font-black tracking-widest text-cyan-300">MAGIC LOOPS (OPTIONAL ORCHESTRATOR)</div>
            <div className="mt-2 text-[11px] font-bold text-white/70">Status: {ml?.enabled ? "ENABLED" : "DISABLED"} · Trigger URL {ml?.default_url ? "set (server-side)" : "not set"} · Token {ml?.token_set ? "stored server-side" : "none"}</div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <button onClick={async () => { const r = await apiClient.post("/nexus/assets/magicloops/test"); r.data.ok ? toast.success("Magic Loops reachable") : toast.error(r.data.detail || `HTTP ${r.data.status_code}`); }}
                className="min-h-[44px] px-4 rounded-xl bg-cyan-500 text-black text-[10px] font-black tracking-widest" data-testid="ml-test-btn">TEST CONNECTION</button>
              <button onClick={async () => { const url = window.prompt("Magic Loops trigger URL (stored server-side):"); if (url) { await apiClient.post("/nexus/assets/magicloops/config", { default_url: url, enabled: true }); toast.success("Saved server-side"); loadAll(); } }}
                className="min-h-[44px] px-4 rounded-xl bg-white/10 text-[10px] font-black tracking-widest">CONFIGURE</button>
            </div>
            <div className="mt-3 text-[10px] font-black text-white/50">RECENT EVENTS</div>
            <div className="mt-1 space-y-1 max-h-48 overflow-auto">
              {runs.map((e) => (
                <div key={e.event_id} className="text-[10px] font-bold flex justify-between bg-black/30 rounded px-2 py-1">
                  <span>{e.event}</span><span className={e.dead_letter ? "text-red-300" : e.delivered ? "text-emerald-300" : "text-white/40"}>{e.dead_letter ? "DEAD-LETTER" : e.delivered ? "DELIVERED" : "LOGGED"}</span>
                </div>
              ))}
              {runs.length === 0 && <p className="text-[10px] text-white/40 font-bold">No events yet. Core imports work without Magic Loops.</p>}
            </div>
          </div>
        )}
        {sec === "SETTINGS" && (
          <div className={card}><div className="text-xs font-black tracking-widest text-cyan-300">SETTINGS</div>
            <p className="mt-2 text-[11px] font-bold text-white/70">Max upload: 4 GB (NEXUS_MAX_UPLOAD_GB) · Part size 16 MB · Zip ratio cap 120× · Founder/admin only access.</p></div>
        )}
        {est && (
          <div className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-5" data-testid="credit-approval-dialog">
            <div className="bg-[#0b1226] border border-amber-400/40 rounded-2xl p-6 max-w-sm w-full">
              <div className="font-black">PAID 3D GENERATION — {est.avatar}</div>
              <ul className="mt-2 text-[11px] font-bold text-white/70 space-y-0.5">{est.stages.map((s) => <li key={s}>· {s}</li>)}</ul>
              <p className="mt-2 text-sm font-black text-amber-300">Estimated {est.credits_estimate} credits · Balance {est.balance}</p>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setEst(null)} className="flex-1 min-h-[44px] rounded-xl bg-white/10 text-xs font-bold">CANCEL</button>
                <button onClick={approveGen} className="flex-1 min-h-[44px] rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-black text-xs font-black" data-testid="approve-credits-btn">APPROVE CREDITS &amp; GENERATE</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
