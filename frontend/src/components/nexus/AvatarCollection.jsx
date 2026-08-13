/* NEXUS AVATAR COLLECTION — six Fire Power unlockables (server-authoritative).
   Thumbnails load first; the GLB is only fetched when an avatar is previewed. */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import apiClient from "@/api/client";
import { toast } from "sonner";
import { Flame, Lock, Check, X, Eye } from "lucide-react";

const NAMES = { av_streetwear: "STREETWEAR", av_tech_operative: "TECH OPERATIVE", av_realm_guardian: "REALM GUARDIAN",
  av_aether_champion: "AETHER CHAMPION", av_arcane_sovereign: "ARCANE SOVEREIGN", av_void_wizard: "LEGENDARY VOID WIZARD" };

const AvatarPreview = ({ url }) => {
  const ref = useRef(null);
  const [state, setState] = useState("loading");
  useEffect(() => {
    const mount = ref.current;
    if (!mount || !url) return undefined;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 1.1, 3.4);
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 6, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0x66d9ff, 1.4); rim.position.set(-4, 3, -3); scene.add(rim);
    const draco = new DRACOLoader(); draco.setDecoderPath("/draco/");
    const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
    let disposed = false; let raf = 0; let mixer = null;
    const holder = new THREE.Group(); scene.add(holder);
    loader.load(url, (g) => {
      if (disposed) return;
      const box = new THREE.Box3().setFromObject(g.scene);
      const size = box.getSize(new THREE.Vector3());
      const s = 1.8 / Math.max(0.01, size.y);
      g.scene.scale.setScalar(s);
      const b2 = new THREE.Box3().setFromObject(g.scene);
      const c = b2.getCenter(new THREE.Vector3());
      g.scene.position.set(-c.x, -b2.min.y - 0.9 + 1.0, -c.z);
      g.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
      holder.add(g.scene);
      if (g.animations?.length) {
        mixer = new THREE.AnimationMixer(g.scene);
        mixer.clipAction(g.animations[0]).play();
      }
      setState("ready");
    }, undefined, () => setState("error"));
    const clock = new THREE.Clock();
    const step = () => {
      if (disposed) return;
      raf = requestAnimationFrame(step);
      holder.rotation.y += 0.006;
      mixer?.update(clock.getDelta());
      renderer.render(scene, camera);
    };
    step();
    return () => {
      disposed = true; cancelAnimationFrame(raf);
      renderer.dispose(); draco.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [url]);
  return (
    <div ref={ref} className="w-full h-64 rounded-xl bg-black/50 border border-white/10 relative overflow-hidden" data-testid="avatar-preview-canvas">
      {state === "loading" && <div className="absolute inset-0 flex items-center justify-center text-xs text-cyan-300 font-bold tracking-widest">LOADING MODEL…</div>}
      {state === "error" && <div className="absolute inset-0 flex items-center justify-center text-xs text-red-300 font-bold">PREVIEW UNAVAILABLE</div>}
    </div>
  );
};

export const AvatarCollection = () => {
  const [data, setData] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiClient.get("/nexus/avatars/collection").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!data) return null;
  const burn = async (av) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await apiClient.post(`/nexus/avatars/${av.id}/unlock`);
      toast.success(r.data.already_unlocked ? "Already unlocked" : `${NAMES[av.id]} permanently unlocked`);
      setConfirm(null); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Unlock failed"); } finally { setBusy(false); }
  };
  const equip = async (av) => {
    try { await apiClient.post("/nexus/avatars/select", { id: av.id }); toast.success("Equipped"); setPreview(null); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Cannot equip"); }
  };
  const previewUrl = (av) => av.lod_urls?.lod1 || av.rigged_base_url || av.url;
  return (
    <div className="mt-9" data-testid="nexus-avatar-collection">
      <div className="flex items-center justify-between">
        <h2 className="text-base md:text-lg font-black tracking-[0.18em] text-cyan-300">NEXUS AVATAR COLLECTION</h2>
        <span className="flex items-center gap-1.5 text-sm font-black text-orange-300" data-testid="nexus-fp-balance">
          <Flame className="w-4 h-4" /> {data.fire_balance.toLocaleString()}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
        {data.avatars.map((av) => (
          <div key={av.id} className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-[#101a33] to-[#070b18] overflow-hidden flex flex-col" data-testid={`avatar-card-${av.id}`}>
            <button type="button" onClick={() => av.available && setPreview(av)} aria-label={`Preview ${NAMES[av.id]}`}
              className="relative w-full aspect-[3/4] max-h-44 overflow-hidden bg-black/40 group" data-testid={`avatar-thumb-${av.id}`}>
              <img src={av.thumb || `/nexus/${av.id}.webp`} alt={NAMES[av.id]} loading="lazy"
                className="w-full h-full object-cover object-top group-active:scale-105 transition-transform" />
              {av.id === "av_void_wizard" && (
                <span className="absolute top-1.5 right-1.5 text-[9px] font-black tracking-widest bg-yellow-500/90 text-black rounded-full px-2 py-0.5">LEGENDARY</span>
              )}
              {av.available && (
                <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 text-[9px] font-black tracking-widest bg-black/60 border border-white/20 rounded-full px-2 py-1 text-cyan-200">
                  <Eye className="w-3 h-3" /> PREVIEW
                </span>
              )}
              {!av.unlocked && (
                <span className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-black/60 border border-white/20 flex items-center justify-center">
                  <Lock className="w-3 h-3 text-white/70" />
                </span>
              )}
            </button>
            <div className="p-3 flex flex-col flex-1">
              <div className="font-black text-xs leading-tight">{NAMES[av.id]}</div>
              <div className="flex items-center gap-1 text-[11px] font-bold text-orange-300 mt-0.5">
                <Flame className="w-3 h-3" /> {av.fp_cost.toLocaleString()}
              </div>
              <div className="mt-auto pt-2.5">
                {!av.available ? (
                  <span className="text-[10px] font-bold tracking-widest text-white/50" data-testid={`avatar-state-${av.id}`}>IN PRODUCTION</span>
                ) : av.equipped ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-300" data-testid={`avatar-state-${av.id}`}><Check className="w-3.5 h-3.5" /> EQUIPPED</span>
                ) : av.unlocked ? (
                  <button onClick={() => equip(av)} className="w-full h-10 rounded-xl bg-cyan-500 text-black text-xs font-black tracking-widest active:scale-95" data-testid={`avatar-equip-${av.id}`}>SELECT</button>
                ) : (
                  <button onClick={() => setConfirm(av)} className="w-full h-10 rounded-xl bg-white/10 border border-orange-400/40 text-orange-200 text-xs font-black tracking-widest active:scale-95 flex items-center justify-center gap-1.5" data-testid={`avatar-unlock-${av.id}`}>
                    <Lock className="w-3.5 h-3.5" /> UNLOCK
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-white/45 leading-relaxed">
        Fire Power is an in-platform progression point with no cash value. Avatar unlocks are permanent, cosmetic,
        non-transferable, non-sellable, non-giftable, and account-bound. Switching between unlocked avatars is free.
      </p>
      {preview && (
        <div className="fixed inset-0 z-[120] bg-black/75 flex items-center justify-center p-5" data-testid="avatar-preview-dialog">
          <div className="bg-[#0b1226] border border-cyan-400/25 rounded-2xl p-5 max-w-sm w-full">
            <div className="flex items-center justify-between">
              <div className="font-black text-sm tracking-widest">{NAMES[preview.id]}</div>
              <button onClick={() => setPreview(null)} aria-label="Close preview" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" data-testid="avatar-preview-close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3">
              <AvatarPreview url={previewUrl(preview)} />
            </div>
            <div className="mt-4 flex gap-3">
              {preview.equipped ? (
                <span className="flex-1 h-11 rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-xs font-black flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /> EQUIPPED</span>
              ) : preview.unlocked ? (
                <button onClick={() => equip(preview)} className="flex-1 h-11 rounded-xl bg-cyan-500 text-black text-xs font-black tracking-widest" data-testid="avatar-preview-equip">EQUIP</button>
              ) : (
                <button onClick={() => { setPreview(null); setConfirm(preview); }} className="flex-1 h-11 rounded-xl bg-gradient-to-b from-orange-400 to-red-500 text-black text-xs font-black flex items-center justify-center gap-1.5" data-testid="avatar-preview-unlock">
                  <Flame className="w-4 h-4" /> UNLOCK {preview.fp_cost.toLocaleString()}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-5" data-testid="avatar-burn-dialog">
          <div className="bg-[#0b1226] border border-orange-400/30 rounded-2xl p-6 max-w-sm w-full">
            <div className="font-black text-lg">Permanent Unlock</div>
            <p className="mt-2 text-sm text-white/75">
              Burn {confirm.fp_cost.toLocaleString()} Fire Power to permanently unlock {NAMES[confirm.id]}? This action cannot be reversed.
            </p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setConfirm(null)} className="flex-1 h-11 rounded-xl bg-white/10 text-sm font-bold" data-testid="avatar-burn-cancel">CANCEL</button>
              <button onClick={() => burn(confirm)} disabled={busy}
                className="flex-1 h-11 rounded-xl bg-gradient-to-b from-orange-400 to-red-500 text-black text-sm font-black disabled:opacity-60" data-testid="avatar-burn-confirm">
                {busy ? "…" : "BURN & UNLOCK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
