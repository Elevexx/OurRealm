// REALMLIFE IN-WORLD CHAT BUBBLES
// Auto-sized dark-navy bubbles with a cyan RealmLife glow and
// small trail dots leading down toward the speaking avatar.
// Canvas-sprite approach generalized from the proven Nexus
// implementation (Nexus itself is untouched).
import * as THREE from "three";

const FONT = "bold 30px sans-serif";
const NAME_FONT = "bold 20px sans-serif";
const MAX_TEXT_W = 430;
const PAD_X = 24;
const PAD_Y = 16;
const LINE_H = 38;
const MAX_LINES = 4;
const TAIL_H = 64;

export function realmLifeChatSprite(text, username) {
  const meas = document
    .createElement("canvas")
    .getContext("2d");
  meas.font = FONT;

  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const tryLn = cur ? cur + " " + w : w;
    if (meas.measureText(tryLn).width <= MAX_TEXT_W || !cur) cur = tryLn;
    else {
      lines.push(cur);
      cur = w;
      if (lines.length === MAX_LINES) break;
    }
  }
  if (cur && lines.length < MAX_LINES) lines.push(cur);
  else if (lines.length === MAX_LINES) lines[MAX_LINES - 1] += "…";

  const textW = Math.min(
    MAX_TEXT_W,
    Math.max(...lines.map((ln) => meas.measureText(ln).width), 30)
  );

  const nameH = username ? 24 : 0;
  const bw = Math.ceil(textW + PAD_X * 2);
  const bh = Math.ceil(lines.length * LINE_H + PAD_Y * 2 + nameH);
  const w = bw + 24;
  const h = bh + TAIL_H + 16;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");

  const bx = 12;
  const by = 8;

  // glow + bubble
  g.shadowColor = "rgba(46,230,255,0.85)";
  g.shadowBlur = 14;
  g.fillStyle = "rgba(6,16,30,0.92)";
  g.beginPath();
  g.roundRect(bx, by, bw, bh, Math.min(20, bh / 2 - 2));
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = "#2ee6ff";
  g.lineWidth = 3;
  g.stroke();

  // trail dots toward the avatar (bottom-center, descending)
  const cx = w / 2;
  const dots = [
    { x: cx - 6, y: by + bh + 12, r: 7 },
    { x: cx - 16, y: by + bh + 30, r: 5 },
    { x: cx - 26, y: by + bh + 46, r: 3.5 },
  ];
  dots.forEach((d) => {
    g.shadowColor = "rgba(46,230,255,0.8)";
    g.shadowBlur = 8;
    g.fillStyle = "rgba(6,16,30,0.92)";
    g.beginPath();
    g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "#2ee6ff";
    g.lineWidth = 2;
    g.stroke();
  });

  // optional small username
  if (username) {
    g.fillStyle = "#7dfcff";
    g.font = NAME_FONT;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(username).slice(0, 16), w / 2, by + PAD_Y / 2 + 12);
  }

  // message text
  g.fillStyle = "#ffffff";
  g.font = FONT;
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((ln, i) => {
    g.fillText(ln, w / 2, by + nameH + PAD_Y + LINE_H * (i + 0.5));
  });

  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: t,
      depthTest: false,
      transparent: true,
    })
  );
  s.userData.chatTexture = t;

  const PX = 0.0062;
  s.scale.set(w * PX, h * PX, 1);
  s.position.y = 2.3 + (h * PX) / 2;
  s.renderOrder = 999;
  return s;
}

export function createChatBubbleManager() {
  const bubbles = new Map(); // uid -> {id, sprite, holder, timer, fadeTimer}

  const drop = (uid) => {
    const b = bubbles.get(uid);
    if (!b) return;
    window.clearTimeout(b.timer);
    window.clearInterval(b.fadeTimer);
    b.holder.remove(b.sprite);
    b.sprite.userData.chatTexture?.dispose();
    b.sprite.material?.dispose();
    bubbles.delete(uid);
  };

  const show = (holder, uid, text, id, username) => {
    if (bubbles.get(uid)?.id === id) return;
    drop(uid);
    const sprite = realmLifeChatSprite(text, username);

    // REALMLIFE CHAT WORLD-SCALE SAFETY
    //
    // Avatar GLBs can use different normalization scales.
    // A speech bubble must remain the same visible world size
    // regardless of the scale of the avatar holder.
    holder.updateWorldMatrix?.(true, false);

    const holderWorldScale =
      new THREE.Vector3(1, 1, 1);

    holder.getWorldScale?.(
      holderWorldScale
    );

    const safeX =
      Math.max(
        0.0001,
        Math.abs(holderWorldScale.x) || 1
      );

    const safeY =
      Math.max(
        0.0001,
        Math.abs(holderWorldScale.y) || 1
      );

    sprite.scale.x /= safeX;
    sprite.scale.y /= safeY;

    // Keep the bubble physically above the avatar even when
    // the holder itself has been heavily scaled.
    sprite.position.y /= safeY;

    sprite.frustumCulled = false;

    if (sprite.material) {
      sprite.material.depthTest = false;
      sprite.material.depthWrite = false;
      sprite.material.toneMapped = false;
      sprite.material.transparent = true;
    }

    sprite.renderOrder = 9999;

    holder.add(sprite);

    const life = Math.min(
      9000,
      4200 + String(text).length * 28
    );

    const rec = { id, sprite, holder, timer: null, fadeTimer: null };
    rec.timer = window.setTimeout(() => {
      // soft fade + scale-out
      let o = 1;
      rec.fadeTimer = window.setInterval(() => {
        o -= 0.12;
        if (o <= 0) {
          drop(uid);
          return;
        }
        sprite.material.opacity = o;
        sprite.scale.multiplyScalar(0.985);
      }, 40);
    }, life);

    bubbles.set(uid, rec);
  };

  const disposeAll = () => {
    Array.from(bubbles.keys()).forEach(drop);
  };

  return { show, drop, disposeAll };
}
