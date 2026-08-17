import * as THREE from "three";


const NIGHT_TOP =
  new THREE.Color("#020713");

const NIGHT_BOTTOM =
  new THREE.Color("#0b1731");

const DAY_TOP =
  new THREE.Color("#328fd0");

const DAY_BOTTOM =
  new THREE.Color("#cdeaff");

const SUNSET_TOP =
  new THREE.Color("#6c75c7");

const SUNSET_BOTTOM =
  new THREE.Color("#ff9257");


function clamp01(n) {
  return Math.max(
    0,
    Math.min(
      1,
      n
    )
  );
}


export function createRealmLifeEnvironment(
  scene
) {
  let disposed = false;

  let state =
    window.__REALMLIFE_ENVIRONMENT
    || null;

  let syncedMinute =
    state?.world
      ?.total_realm_minutes
    || 0;

  let syncedAt =
    performance.now();

  // Single authoritative sky rig — sky/sun/moon/stars ride this
  // group so it can follow the camera and never clip the far plane.
  let followCamera = null;

  const celestialTarget =
    new THREE.Vector3();


  const originalBackground =
    scene.background;

  const originalFog =
    scene.fog;


  // ==========================================================
  // SKY DOME
  // ==========================================================

  const skyUniforms = {
    topColor: {
      value:
        NIGHT_TOP.clone(),
    },

    bottomColor: {
      value:
        NIGHT_BOTTOM.clone(),
    },
  };


  const sky =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        320,
        32,
        18
      ),

      new THREE.ShaderMaterial({
        uniforms:
          skyUniforms,

        side:
          THREE.BackSide,

        depthWrite:
          false,

        vertexShader: `
          varying vec3 vPosition;

          void main() {
            vPosition = position;

            gl_Position =
              projectionMatrix *
              modelViewMatrix *
              vec4(position, 1.0);
          }
        `,

        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 bottomColor;

          varying vec3 vPosition;

          void main() {
            float h =
              normalize(vPosition).y
              * 0.5 + 0.5;

            vec3 color =
              mix(
                bottomColor,
                topColor,
                smoothstep(
                  0.02,
                  0.92,
                  h
                )
              );

            gl_FragColor =
              vec4(color, 1.0);
          }
        `,
      })
    );

  sky.name =
    "RealmLifeLayeredSky";

  sky.renderOrder =
    -1000;

  sky.frustumCulled =
    false;

  const celestial =
    new THREE.Group();

  celestial.name =
    "RealmLifeCelestialRig";

  scene.add(
    celestial
  );

  celestial.add(
    sky
  );


  // ==========================================================
  // SUN + MOON
  // ==========================================================

  const sun =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        6,
        24,
        16
      ),

      new THREE.MeshBasicMaterial({
        color:
          0xfff0b8,

        depthTest:
          false,
      })
    );

  sun.renderOrder =
    -995;

  celestial.add(
    sun
  );


  const moonGroup =
    new THREE.Group();

  celestial.add(
    moonGroup
  );


  const moon =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        5.2,
        24,
        16
      ),

      new THREE.MeshBasicMaterial({
        color:
          0xd8e8ff,

        depthTest:
          false,
      })
    );

  moon.renderOrder =
    -994;

  moonGroup.add(
    moon
  );


  const moonShadow =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        5.35,
        24,
        16
      ),

      new THREE.MeshBasicMaterial({
        color:
          0x06101f,

        depthTest:
          false,
      })
    );

  moonShadow.position.z =
    -0.6;

  moonShadow.renderOrder =
    -993;

  moonGroup.add(
    moonShadow
  );


  // ==========================================================
  // STARS
  // ==========================================================

  const starCount =
    700;

  const starPositions =
    new Float32Array(
      starCount * 3
    );

  for (
    let i = 0;
    i < starCount;
    i += 1
  ) {
    const radius =
      235
      + Math.random()
      * 40;

    const theta =
      Math.random()
      * Math.PI
      * 2;

    const y =
      45
      + Math.random()
      * 190;

    const horizontal =
      Math.sqrt(
        Math.max(
          0,
          radius * radius
          - y * y
        )
      );

    starPositions[
      i * 3
    ] =
      Math.cos(theta)
      * horizontal;

    starPositions[
      i * 3 + 1
    ] =
      y;

    starPositions[
      i * 3 + 2
    ] =
      Math.sin(theta)
      * horizontal;
  }


  const starGeometry =
    new THREE.BufferGeometry();

  starGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      starPositions,
      3
    )
  );


  const starMaterial =
    new THREE.PointsMaterial({
      color:
        0xffffff,

      size:
        0.7,

      transparent:
        true,

      opacity:
        1,

      depthWrite:
        false,

      depthTest:
        false,
    });


  const stars =
    new THREE.Points(
      starGeometry,
      starMaterial
    );

  stars.renderOrder =
    -997;

  celestial.add(
    stars
  );


  // ==========================================================
  // MOVING CLOUD LAYERS
  // ==========================================================

  const clouds =
    new THREE.Group();

  clouds.name =
    "RealmLifeCloudLayer";

  scene.add(
    clouds
  );


  const cloudGeometry =
    new THREE.SphereGeometry(
      1,
      10,
      7
    );

  const cloudMaterial =
    new THREE.MeshBasicMaterial({
      color:
        0xffffff,

      transparent:
        true,

      opacity:
        0.16,

      depthWrite:
        false,
    });


  for (
    let c = 0;
    c < 18;
    c += 1
  ) {
    const cluster =
      new THREE.Group();

    cluster.position.set(
      -160
        + Math.random()
        * 320,

      65
        + Math.random()
        * 32,

      -80
        + Math.random()
        * 280
    );

    for (
      let j = 0;
      j < 5;
      j += 1
    ) {
      const puff =
        new THREE.Mesh(
          cloudGeometry,
          cloudMaterial
        );

      puff.position.set(
        (j - 2) * 5.5,
        Math.random()
          * 3,
        Math.random()
          * 5
          - 2.5
      );

      puff.scale.set(
        8
          + Math.random()
          * 7,
        2.4
          + Math.random()
          * 2,
        5
          + Math.random()
          * 7
      );

      cluster.add(
        puff
      );
    }

    clouds.add(
      cluster
    );
  }


  // ==========================================================
  // ENVIRONMENT LIGHTS
  // ==========================================================

  const hemi =
    new THREE.HemisphereLight(
      0xb9dfff,
      0x263422,
      0.48
    );

  hemi.userData
    .realmEnvironmentLight =
      true;

  scene.add(
    hemi
  );


  const sunLight =
    new THREE.DirectionalLight(
      0xfff4d1,
      1.1
    );

  sunLight.castShadow =
    true;

  sunLight.userData
    .realmEnvironmentLight =
      true;

  scene.add(
    sunLight
  );


  const moonLight =
    new THREE.DirectionalLight(
      0x8caee8,
      0.16
    );

  moonLight.userData
    .realmEnvironmentLight =
      true;

  scene.add(
    moonLight
  );


  const lightning =
    new THREE.PointLight(
      0xcfe7ff,
      0,
      500
    );

  lightning.position.set(
    0,
    120,
    45
  );

  lightning.userData
    .realmEnvironmentLight =
      true;

  scene.add(
    lightning
  );


  // ==========================================================
  // WEATHER FOG
  // ==========================================================

  const weatherFog =
    new THREE.FogExp2(
      0xa8c2cf,
      0.0009
    );

  scene.fog =
    weatherFog;


  // ==========================================================
  // RAIN
  // ==========================================================

  const rainCount =
    1700;

  const rainPositions =
    new Float32Array(
      rainCount * 3
    );

  for (
    let i = 0;
    i < rainCount;
    i += 1
  ) {
    rainPositions[
      i * 3
    ] =
      -55
      + Math.random()
      * 110;

    rainPositions[
      i * 3 + 1
    ] =
      2
      + Math.random()
      * 78;

    rainPositions[
      i * 3 + 2
    ] =
      -48
      + Math.random()
      * 200;
  }


  const rainGeometry =
    new THREE.BufferGeometry();

  rainGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      rainPositions,
      3
    )
  );


  const rainMaterial =
    new THREE.PointsMaterial({
      color:
        0xaad7ff,

      size:
        0.22,

      transparent:
        true,

      opacity:
        0.68,

      depthWrite:
        false,
    });


  const rain =
    new THREE.Points(
      rainGeometry,
      rainMaterial
    );

  rain.visible =
    false;

  scene.add(
    rain
  );


  // ==========================================================
  // TORNADO FUNNEL
  // ==========================================================

  const tornadoCount =
    800;

  const tornadoPositions =
    new Float32Array(
      tornadoCount * 3
    );

  const tornadoCenter = {
    x: 24,
    z: 72,
  };


  for (
    let i = 0;
    i < tornadoCount;
    i += 1
  ) {
    const y =
      Math.random()
      * 48;

    const radius =
      1
      + y * 0.13;

    const a =
      Math.random()
      * Math.PI
      * 2;

    tornadoPositions[
      i * 3
    ] =
      tornadoCenter.x
      + Math.cos(a)
      * radius;

    tornadoPositions[
      i * 3 + 1
    ] =
      y;

    tornadoPositions[
      i * 3 + 2
    ] =
      tornadoCenter.z
      + Math.sin(a)
      * radius;
  }


  const tornadoGeometry =
    new THREE.BufferGeometry();

  tornadoGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      tornadoPositions,
      3
    )
  );


  const tornadoMaterial =
    new THREE.PointsMaterial({
      color:
        0x83919a,

      size:
        0.55,

      transparent:
        true,

      opacity:
        0.54,

      depthWrite:
        false,
    });


  const tornado =
    new THREE.Points(
      tornadoGeometry,
      tornadoMaterial
    );

  tornado.visible =
    false;

  scene.add(
    tornado
  );


  // ==========================================================
  // STATE SYNC
  // ==========================================================

  const applyState = (
    next
  ) => {
    state = next || null;

    syncedMinute =
      state?.world
        ?.total_realm_minutes
      || syncedMinute;

    syncedAt =
      performance.now();
  };


  const onEnvironment = (
    event
  ) => {
    applyState(
      event.detail
    );
  };


  window.addEventListener(
    "realmlife:environment",
    onEnvironment
  );


  applyState(
    state
  );


  // ==========================================================
  // ANIMATION
  // ==========================================================

  let previous =
    performance.now();

  let nextLightning =
    previous + 4500;

  let flashUntil =
    0;


  const frame = (
    now
  ) => {
    if (disposed)
      return;

    const dt =
      Math.min(
        0.05,
        Math.max(
          0,
          (
            now
            - previous
          )
          / 1000
        )
      );

    previous =
      now;


    const rate =
      state?.world
        ?.realm_minutes_per_real_second
      || 1;

    const totalMinute =
      syncedMinute
      +
      (
        (
          now
          - syncedAt
        )
        / 1000
      )
      * rate;

    const minuteOfDay =
      (
        (
          totalMinute
          % 1440
        )
        + 1440
      )
      % 1440;

    const dayFraction =
      minuteOfDay
      / 1440;

    const angle =
      (
        dayFraction
        - 0.25
      )
      * Math.PI
      * 2;

    const elevation =
      Math.sin(
        angle
      );


    const dayStrength =
      clamp01(
        (
          elevation
          + 0.08
        )
        / 0.55
      );

    const twilight =
      clamp01(
        1
        - Math.abs(
          elevation
        )
        / 0.35
      );


    const top =
      NIGHT_TOP
        .clone()
        .lerp(
          DAY_TOP,
          dayStrength
        )
        .lerp(
          SUNSET_TOP,
          twilight
          * (
            1
            - dayStrength
          )
        );

    const bottom =
      NIGHT_BOTTOM
        .clone()
        .lerp(
          DAY_BOTTOM,
          dayStrength
        )
        .lerp(
          SUNSET_BOTTOM,
          twilight
        );


    // REALMLIFE INDOOR ENVIRONMENT GATE
    const indoor =
      window.__REALMLIFE_INDOOR
      === true;


    const active =
      new Set(
        (
          state
            ?.active_weather
          || []
        ).map(
          (event) =>
            event.weather
        )
      );


    const has = (
      type
    ) =>
      active.has(
        type
      );


    const rainStrength =
      has("hurricane")
        ? 1.8
        : has("heavy_storm")
          ? 1.55
          : has("thunderstorm")
            ? 1.25
            : has("rain")
              ? 1
              : 0;


    const windStrength =
      has("hurricane")
        ? 2
        : has("tornado")
          ? 1.8
          : has("heavy_storm")
            ? 1.45
            : has("wind")
              ? 1
              : 0.18;


    const cloudStrength =
      has("hurricane")
        ? 0.88
        : has("heavy_storm")
          ? 0.80
          : has("thunderstorm")
            ? 0.72
            : has("rain")
              ? 0.62
              : has("cloudy")
                ? 0.52
                : 0.16;


    if (
      has("heat_wave")
      || has("drought")
    ) {
      bottom.lerp(
        new THREE.Color(
          "#f0b66e"
        ),
        0.28
      );
    }


    skyUniforms
      .topColor
      .value.copy(
        top
      );

    skyUniforms
      .bottomColor
      .value.copy(
        bottom
      );

    scene.background =
      indoor
        ? new THREE.Color(
            0x000000
          )
        : bottom.clone();


    sky.visible =
      !indoor;

    stars.visible =
      !indoor;

    clouds.visible =
      !indoor;


    // Sun / moon orbit.
    sun.position.set(
      Math.cos(angle)
        * 175,

      Math.sin(angle)
        * 175,

      -85
    );

    moonGroup.position.set(
      -sun.position.x,
      -sun.position.y,
      85
    );


    sun.visible =
      !indoor
      &&
      elevation > -0.12;

    moonGroup.visible =
      !indoor
      &&
      elevation < 0.22;


    sunLight.position.copy(
      sun.position
    );

    moonLight.position.copy(
      moonGroup.position
    );


    sunLight.intensity =
      Math.max(
        0.025,
        dayStrength
        * (
          1
          - cloudStrength
          * 0.48
        )
      );

    moonLight.intensity =
      (
        1
        - dayStrength
      )
      * 0.23;

    hemi.intensity =
      0.18
      + dayStrength
      * 0.48;


    // REALMLIFE INDOOR LIGHT OVERRIDE
    if (indoor) {
      sunLight.intensity =
        0;

      moonLight.intensity =
        0;

      hemi.intensity =
        0;
    }


    // Stars.
    starMaterial.opacity =
      clamp01(
        1
        - dayStrength
        * 1.7
      );


    // Moon phase.
    const phase =
      state?.world
        ?.moon
        ?.phase_index
      ?? 4;

    const shadowOffsets = [
      0,
      -2.5,
      -5,
      -7.8,
      -11,
      7.8,
      5,
      2.5,
    ];

    moonShadow.position.x =
      shadowOffsets[
        phase % 8
      ];


    // Cloud layers.
    cloudMaterial.opacity =
      cloudStrength;

    clouds.children.forEach(
      (cluster) => {
        cluster.position.x +=
          dt
          * (
            1.8
            + windStrength
            * 6.5
          );

        if (
          cluster.position.x
          > 185
        ) {
          cluster.position.x =
            -185;
        }
      }
    );


    // Fog / atmospheric visibility.
    let fogDensity =
      0.0008;

    if (has("fog"))
      fogDensity =
        0.012;

    if (has("rain"))
      fogDensity =
        Math.max(
          fogDensity,
          0.0025
        );

    if (has("heavy_storm"))
      fogDensity =
        Math.max(
          fogDensity,
          0.004
        );

    if (has("hurricane"))
      fogDensity =
        Math.max(
          fogDensity,
          0.0065
        );

    if (
      has("heat_wave")
      || has("drought")
    ) {
      fogDensity =
        Math.max(
          fogDensity,
          0.0018
        );

      weatherFog.color.set(
        0xd5b786
      );
    } else {
      weatherFog.color.copy(
        bottom
      );
    }

    weatherFog.density =
      indoor
        ? 0
        : fogDensity;


    // Rain physically falls through the world.
    rain.visible =
      !indoor
      &&
      rainStrength > 0;

    if (rain.visible) {
      rainMaterial.opacity =
        Math.min(
          0.92,
          0.50
          + rainStrength
          * 0.22
        );

      const p =
        rainGeometry
          .attributes
          .position
          .array;

      for (
        let i = 0;
        i < rainCount;
        i += 1
      ) {
        const iy =
          i * 3 + 1;

        const ix =
          i * 3;

        p[iy] -=
          dt
          * (
            28
            + rainStrength
            * 28
          );

        p[ix] +=
          dt
          * windStrength
          * 4.5;

        if (
          p[iy] < 0
        ) {
          p[iy] =
            65
            + Math.random()
            * 20;
        }

        if (
          p[ix] > 58
        ) {
          p[ix] =
            -58;
        }
      }

      rainGeometry
        .attributes
        .position
        .needsUpdate =
          true;
    }


    // Tornado funnel.
    tornado.visible =
      !indoor
      &&
      has("tornado");

    if (tornado.visible) {
      const p =
        tornadoGeometry
          .attributes
          .position
          .array;

      for (
        let i = 0;
        i < tornadoCount;
        i += 1
      ) {
        const ix =
          i * 3;

        const iy =
          ix + 1;

        const iz =
          ix + 2;

        let y =
          p[iy]
          + dt * 3.5;

        if (y > 50)
          y = 0.5;

        const radius =
          0.9
          + y * 0.13;

        let a =
          Math.atan2(
            p[iz]
              - tornadoCenter.z,

            p[ix]
              - tornadoCenter.x
          );

        a +=
          dt
          * (
            2.8
            + y
            * 0.025
          );

        p[ix] =
          tornadoCenter.x
          + Math.cos(a)
          * radius;

        p[iy] =
          y;

        p[iz] =
          tornadoCenter.z
          + Math.sin(a)
          * radius;
      }

      tornadoGeometry
        .attributes
        .position
        .needsUpdate =
          true;
    }


    // Lightning.
    const thunder =
      has("thunderstorm")
      || has("heavy_storm")
      || has("hurricane");

    if (
      thunder
      && now > nextLightning
    ) {
      flashUntil =
        now + 120;

      nextLightning =
        now
        + 2600
        + Math.random()
        * 6000;
    }

    lightning.intensity =
      (
        thunder
        && now < flashUntil
      )
        ? 4.8
        : 0;


    // Sky rig camera follow — dome always fits within the far plane.
    if (followCamera) {
      followCamera.getWorldPosition(
        celestialTarget
      );

      celestial.position.set(
        celestialTarget.x,
        0,
        celestialTarget.z
      );

      sky.scale.setScalar(
        Math.max(
          0.5,
          (followCamera.far * 0.92) / 320
        )
      );
    }


    requestAnimationFrame(
      frame
    );
  };


  requestAnimationFrame(
    frame
  );


  return {
    setState:
      applyState,

    setCamera(camera) {
      followCamera = camera;
    },

    dispose() {
      disposed = true;

      window.removeEventListener(
        "realmlife:environment",
        onEnvironment
      );

      scene.background =
        originalBackground;

      scene.fog =
        originalFog;

      scene.remove(
        celestial,
        clouds,
        hemi,
        sunLight,
        moonLight,
        lightning,
        rain,
        tornado
      );

      sky.geometry.dispose();
      sky.material.dispose();

      sun.geometry.dispose();
      sun.material.dispose();

      moon.geometry.dispose();
      moon.material.dispose();

      moonShadow.geometry.dispose();
      moonShadow.material.dispose();

      starGeometry.dispose();
      starMaterial.dispose();

      cloudGeometry.dispose();
      cloudMaterial.dispose();

      rainGeometry.dispose();
      rainMaterial.dispose();

      tornadoGeometry.dispose();
      tornadoMaterial.dispose();
    },
  };
}
