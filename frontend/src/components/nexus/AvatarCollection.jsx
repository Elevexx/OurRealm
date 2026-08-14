/* NEXUS AVATAR COLLECTION — six Fire Power unlockables (server-authoritative).
   Thumbnails load first; the GLB is only fetched when an avatar is previewed. */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import apiClient from "@/api/client";
import { toast } from "sonner";
import { Flame, Lock, Check, X, Eye, ShieldCheck } from "lucide-react";

const NAMES = { av_streetwear: "STREETWEAR", av_tech_operative: "TECH OPERATIVE", av_realm_guardian: "REALM GUARDIAN",
  av_aether_champion: "AETHER CHAMPION", av_arcane_sovereign: "ARCANE SOVEREIGN", av_void_wizard: "LEGENDARY VOID WIZARD",
  founder_stealth_private: "FOUNDER STEALTH" };

export const AvatarPreview = ({ url, glow = null, label = "" }) => {
  const ref = useRef(null);
  const holderRef = useRef(null);
  const [state, setState] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const mount = ref.current;
    if (!mount || !url) return undefined;
    setState("loading");
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
    const ktx2 = new KTX2Loader(); ktx2.setTranscoderPath("/basis/"); ktx2.detectSupport(renderer);
    const loader = new GLTFLoader(); loader.setDRACOLoader(draco); loader.setKTX2Loader(ktx2);
    let disposed = false; let raf = 0; let mixer = null;
    const holder = new THREE.Group(); scene.add(holder);
    holderRef.current = holder;
    const tint = (hex) => {
      if (!hex) return;
      holder.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => {
          if (mm && mm.emissive && (mm.emissiveMap || (mm.emissiveIntensity || 0) > 0.01)) {
            mm.emissive.set(hex); mm.emissiveIntensity = Math.max(mm.emissiveIntensity || 0, 1.5);
          }
        });
      });
    };
    holder.userData.tint = tint;
    loader.load(url, (g) => {
      if (disposed) return;
      g.scene.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      });
      const box = new THREE.Box3().setFromObject(g.scene);
      const size = box.getSize(new THREE.Vector3());
      const s = 1.8 / Math.max(0.01, size.y);
      g.scene.scale.setScalar(s);
      const b2 = new THREE.Box3().setFromObject(g.scene);
      const c = b2.getCenter(new THREE.Vector3());
      g.scene.position.set(-c.x, -b2.min.y - 0.9 + 1.0, -c.z);
      g.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
      holder.add(g.scene);
      tint(glow);
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
      holder.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => {
          if (!mm) return;
          Object.values(mm).forEach((v) => { if (v && v.isTexture) v.dispose(); });
          mm.dispose();
        });
      });
      mixer?.stopAllAction();
      renderer.dispose(); renderer.forceContextLoss?.(); draco.dispose(); ktx2.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, attempt]);
  useEffect(() => { holderRef.current?.userData?.tint?.(glow); }, [glow]);
  return (
    <div ref={ref} className="w-full h-64 rounded-xl bg-black/50 border border-white/10 relative overflow-hidden" data-testid="avatar-preview-canvas">
      {label && (
        <span className="absolute top-1.5 left-1.5 z-10 text-[9px] font-black tracking-widest bg-black/60 border border-cyan-400/30 text-cyan-200 rounded-full px-2 py-1" data-testid="avatar-preview-state">
          {state === "loading" ? `LOADING: ${label}` : state === "error" ? "LOAD FAILED" : `PREVIEWING · ${label}`}
        </span>
      )}
      {state === "loading" && <div className="absolute inset-0 flex items-center justify-center text-xs text-cyan-300 font-bold tracking-widest">LOADING MODEL…</div>}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="text-xs text-red-300 font-black">LOAD FAILED — this avatar did not load</span>
          <button onClick={() => setAttempt((a) => a + 1)} className="min-h-[40px] px-4 rounded-xl bg-white/10 border border-white/25 text-[11px] font-black tracking-widest" data-testid="avatar-preview-retry">RETRY</button>
        </div>
      )}
    </div>
  );
};

export const AvatarCollection = ({ onEquipped }) => {
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
    try { await apiClient.post("/nexus/avatars/select", { id: av.id }); toast.success("Equipped"); setPreview(null); load(); onEquipped?.(av.id); }
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
      {data.founder_vault && (
        <div className="mt-3 rounded-xl border border-yellow-400/40 bg-yellow-400/10 px-4 py-3 flex items-center gap-3" data-testid="founder-vault-banner">
          <ShieldCheck className="w-5 h-5 text-yellow-300 shrink-0" />
          <div>
            <div className="text-xs font-black tracking-[0.22em] text-yellow-200">FOUNDER AVATAR VAULT</div>
            <div className="text-[10px] text-yellow-100/70 font-bold mt-0.5">ALL AVATARS UNLOCKED — future avatars appear here automatically</div>
          </div>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
        {data.avatars.map((av) => (
          <div key={av.id} className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-[#101a33] to-[#070b18] overflow-hidden flex flex-col" data-testid={`avatar-card-${av.id}`}>
            <button type="button" onClick={() => av.available && setPreview(av)} aria-label={`Preview ${NAMES[av.id]}`}
              className="relative w-full aspect-[3/4] max-h-44 overflow-hidden isolate bg-black/40 group" data-testid={`avatar-thumb-${av.id}`}>
              <img src={av.thumbs?.w512 || av.thumb || `/nexus/${av.id}.webp`}
                srcSet={av.thumbs ? `${av.thumbs.w512} 512w, ${av.thumbs.w1024} 1024w, ${av.thumbs.w2048} 2048w` : undefined}
                sizes="(max-width: 1024px) 45vw, 300px" alt={NAMES[av.id]} loading="lazy"
                className="absolute inset-0 w-full h-full object-cover object-top group-active:scale-105 transition-transform" />
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
                {av.founder_only
                  ? <span className="flex items-center gap-1 text-lime-300"><ShieldCheck className="w-3 h-3" /> FOUNDER ONLY</span>
                  : <><Flame className="w-3 h-3" /> {av.fp_cost.toLocaleString()}</>}
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
              <AvatarPreview url={previewUrl(preview)} label={NAMES[preview.id]} />
            </div>
            <div className="mt-2 flex gap-1.5 flex-wrap text-[9px] font-black">
              <span className="bg-white/10 rounded px-1.5 py-0.5">{preview.id}</span>
              <span className="bg-white/10 rounded px-1.5 py-0.5">{preview.gen || "v1"}</span>
              <span className={preview.founder_only ? "bg-lime-500/15 text-lime-300 rounded px-1.5 py-0.5" : "bg-orange-500/15 text-orange-300 rounded px-1.5 py-0.5"}>
                {preview.founder_only ? "FOUNDER ONLY" : `${preview.fp_cost.toLocaleString()}🔥`}
              </span>
              {preview.equipped && <span className="bg-emerald-500/15 text-emerald-300 rounded px-1.5 py-0.5">EQUIPPED</span>}
              {preview.unlocked && !preview.equipped && <span className="bg-cyan-500/15 text-cyan-300 rounded px-1.5 py-0.5">OWNED</span>}
              <span className="bg-white/10 rounded px-1.5 py-0.5">ANIMS {Object.keys(preview.animation_urls || {}).length}</span>
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
