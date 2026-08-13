/* NexusModelTest — isolated GLB audit viewer (?url=/api/media/models/x.glb&h=30).
   Neutral studio: gray ground, even lights, 1.8u capsule reference, live stats overlay. */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

export default function NexusModelTest() {
  const mountRef = useRef(null);
  const [stats, setStats] = useState({ status: "loading" });

  useEffect(() => {
    const mount = mountRef.current;
    const params = new URLSearchParams(window.location.search);
    const url = params.get("url");
    const targetH = parseFloat(params.get("h") || "8");
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#3a4150");
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(30, 60, 40); scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 1.0); fill.position.set(-40, 20, -30); scene.add(fill);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 48),
      new THREE.MeshStandardMaterial({ color: "#565e6e", roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    scene.add(new THREE.GridHelper(120, 60, 0x8899aa, 0x667080));
    const ref = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.04, 6, 12),
      new THREE.MeshStandardMaterial({ color: "#e04747" }));
    ref.position.set(targetH * 0.7, 0.9, 0); scene.add(ref);
    let disposed = false;
    const draco = new DRACOLoader(); draco.setDecoderPath("/draco/");
    const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
    const t0 = performance.now();
    if (url) {
      loader.load(url, (g) => {
        if (disposed) return;
        let tris = 0; let meshCount = 0; const matSet = new Set(); let texCount = 0;
        g.scene.traverse((o) => {
          if (o.isMesh) {
            meshCount += 1;
            tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((mm) => {
              matSet.add(mm.uuid);
              ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"].forEach((k) => { if (mm[k]) texCount += 1; });
            });
          }
        });
        const box = new THREE.Box3().setFromObject(g.scene);
        const size = box.getSize(new THREE.Vector3());
        const s = targetH / Math.max(0.01, size.y);
        g.scene.scale.setScalar(s);
        const b2 = new THREE.Box3().setFromObject(g.scene);
        const c = b2.getCenter(new THREE.Vector3());
        g.scene.position.set(-c.x, -b2.min.y, -c.z);
        scene.add(g.scene);
        const info = {
          status: "loaded", ms: Math.round(performance.now() - t0), meshes: meshCount,
          tris: Math.round(tris), materials: matSet.size, textures: texCount,
          rawSize: `${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`,
          scaledTo: `${targetH}u tall`, anims: (g.animations || []).length,
        };
        setStats(info); window.__VIEWER = info;
      }, undefined, (err) => {
        const info = { status: "ERROR", error: String(err?.message || err) };
        setStats(info); window.__VIEWER = info;
      });
    } else { setStats({ status: "no url param" }); }
    let yawT = 0;
    let raf = 0;
    const step = () => {
      if (disposed) return;
      raf = requestAnimationFrame(step);
      yawT += 0.003;
      const d = targetH * 1.9;
      camera.position.set(Math.sin(yawT) * d, targetH * 0.62, Math.cos(yawT) * d);
      camera.lookAt(0, targetH * 0.45, 0);
      renderer.render(scene, camera);
    };
    step();
    return () => { disposed = true; cancelAnimationFrame(raf); renderer.dispose(); mount.removeChild(renderer.domElement); };
  }, []);

  return (
    <div className="fixed inset-0 bg-black" data-testid="nexus-model-test">
      <div ref={mountRef} className="absolute inset-0" />
      <pre className="absolute top-2 left-2 text-[11px] text-lime-300 bg-black/70 rounded p-2 z-10" data-testid="model-test-stats">
        {JSON.stringify(stats, null, 1)}
      </pre>
    </div>
  );
}
