// REALMLIFE SELECTIVE AVATAR RECOLOR (GPU)
// Player 1 / Player 2 use ONE baked 4K texture (skin, clothing
// and hair share a single material), so skin recolor happens at
// sample time in the fragment shader: texels within a color
// distance of the reference skin tone are re-mapped to the
// chosen tone with luminance preserved. Clothing, the glowing
// green design and accessories are untouched. No texture copies,
// no CPU pixel loops — instant on any device.

const SKIN_REF_SRGB = [0.949, 0.6509, 0.5019]; // #f2a67c-ish
const REF_LUM = (0.949 + 0.6509 + 0.5019) / 3;

function hexToRgb01(hex) {
  const h = String(hex || "").replace("#", "");
  return [
    (parseInt(h.slice(0, 2), 16) || 0) / 255,
    (parseInt(h.slice(2, 4), 16) || 0) / 255,
    (parseInt(h.slice(4, 6), 16) || 0) / 255,
  ];
}

const SNIPPET = `
  {
    vec3 rlS = pow(sampledDiffuseColor.rgb, vec3(1.0/2.2));
    float rlDist =
      abs(rlS.r - ${SKIN_REF_SRGB[0].toFixed(4)}) +
      abs(rlS.g - ${SKIN_REF_SRGB[1].toFixed(4)}) +
      abs(rlS.b - ${SKIN_REF_SRGB[2].toFixed(4)});
    if (rlEnabled > 0.5 && rlDist < 0.588) {
      // Detail luminance from the baked texture, normalized so
      // average skin = 1.0. The baked hue is DISCARDED and the
      // detail drives a shadow -> midtone -> highlight ramp of
      // the selected tone, so every tone renders distinctly.
      float rlT = clamp((rlS.r + rlS.g + rlS.b) / 3.0 / ${REF_LUM.toFixed(4)}, 0.0, 1.6);
      vec3 rlShadow = rlSkin * 0.5;
      // Multiplicative highlight preserves the chosen hue so deep
      // tones stay deep instead of washing toward tan.
      vec3 rlHigh = min(rlSkin * 1.45, vec3(1.0));
      vec3 rlOut = rlT < 1.0
        ? mix(rlShadow, rlSkin, smoothstep(0.3, 1.0, rlT))
        : mix(rlSkin, rlHigh, clamp((rlT - 1.0) * 1.4, 0.0, 1.0));
      sampledDiffuseColor.rgb = pow(rlOut, vec3(2.2));
    }
  }
  diffuseColor *= sampledDiffuseColor;
`;

function patchMaterial(mat) {
  if (mat.userData.rlPatched) return;
  mat.userData.rlPatched = true;
  mat.userData.rlUniforms = {
    rlSkin: { value: [0.9, 0.6, 0.45] },
    rlEnabled: { value: 0 },
  };

  const prev = mat.onBeforeCompile;

  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);

    shader.uniforms.rlSkin = mat.userData.rlUniforms.rlSkin;
    shader.uniforms.rlEnabled = mat.userData.rlUniforms.rlEnabled;

    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      "uniform vec3 rlSkin;\nuniform float rlEnabled;\nvoid main() {"
    );

    // Inject after the diffuse map sample.
    if (shader.fragmentShader.includes("#include <map_fragment>")) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  ${SNIPPET}
#endif`
      );
    }
  };

  mat.customProgramCacheKey = () => "rl-skin-recolor";
  mat.needsUpdate = true;
}

// Applies (or re-applies) a skin tone to a loaded Player model.
// Pass null/undefined skinHex to restore the original look.
export function applyAvatarSkinTone(model, skinHex) {
  if (!model) return;

  let touched = 0;

  model.traverse((obj) => {
    if (!(obj.isMesh || obj.isSkinnedMesh)) return;

    const mats = Array.isArray(obj.material)
      ? obj.material
      : [obj.material];

    mats.forEach((mat) => {
      if (!mat || !mat.map) return;

      patchMaterial(mat);

      const u = mat.userData.rlUniforms;
      if (!skinHex) {
        u.rlEnabled.value = 0;
      } else {
        u.rlEnabled.value = 1;
        u.rlSkin.value = hexToRgb01(skinHex);
      }
      touched += 1;
    });
  });

  try {
    window.__RL_RECOLOR_LAST = {
      skin: skinHex,
      touched,
      at: Date.now(),
    };
  } catch (_) {}
}
