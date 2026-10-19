/*
 * IIT Roorkee Digital Twin
 * CesiumJS 1.146 + Google Photorealistic 3D Tiles
 *
 * Layers built at runtime:
 *   - Google Photorealistic 3D Tiles (Map Tiles API directly, or via Cesium ion)
 *   - Landmarks (js/landmarks.js, OSM centroids) with beacons
 *   - Campus boundary geofence and road network, fetched live from OSM (Overpass API)
 *   - Illustrative mobility agents (random walks on OSM roads, NOT simulation output)
 *   - Time of day, cinematic grade, height and blueprint shader modes, clouds
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------- constants
  const CFG = window.IITR_CONFIG || {};
  const LANDMARKS = window.IITR_LANDMARKS || [];
  const TOUR = window.IITR_TOUR || [];

  // Campus centre and bounding box from OSM Nominatim (osm_id 52435788).
  const CAMPUS = { lon: 77.8957348, lat: 29.8661656, s: 29.8598074, w: 77.8894552, n: 29.8728944, e: 77.9029596 };
  const OSM_CAMPUS_ID = 52435788;
  // Rough ellipsoidal ground height (m) used only until the 3D mesh has been sampled.
  // Replaced by the median clamped road height once tiles load.
  const APPROX_GROUND_H = 220;
  const IST_OFFSET_MIN = 330;

  const CATS = {
    academic: { label: "Academic", color: "#5ec8ff" },
    facility: { label: "Facilities", color: "#ffb347" },
    hostel: { label: "Hostels", color: "#b28dff" },
    sports: { label: "Sports", color: "#5ee69a" },
  };
  const MODES = {
    car: { label: "Car", color: "#ff6b6b", speed: 7.0, size: 7 },
    tw: { label: "Two-wheeler", color: "#ffd166", speed: 8.0, size: 6 },
    bike: { label: "Bicycle", color: "#4dd9ff", speed: 4.0, size: 5 },
    walk: { label: "Pedestrian", color: "#7CFFB2", speed: 1.3, size: 4 },
  };

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
    sget(k) { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const median = (arr) => { const a = arr.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return NaN; const m = a.length >> 1; return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]); };
  const pad2 = (n) => String(n).padStart(2, "0");

  function toast(msg, isErr = false, ms = 4200) {
    const d = document.createElement("div");
    d.textContent = msg;
    if (isErr) d.className = "err";
    $("toast").appendChild(d);
    setTimeout(() => d.remove(), ms);
  }
  function status(msg) {
    if (!msg) { $("status").classList.add("hidden"); return; }
    $("statusMsg").textContent = msg;
    $("status").classList.remove("hidden");
  }
  function loaderMsg(msg, isErr = false) {
    $("loaderMsg").textContent = msg;
    $("loaderMsg").classList.toggle("err", isErr);
  }

  // Low-precision solar elevation (Astronomical Almanac approximation, ~0.01 deg).
  function solarElevationDeg(date, latDeg, lonDeg) {
    const rad = Math.PI / 180;
    const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
    const L = (280.46 + 0.9856474 * n) % 360;
    const g = ((357.528 + 0.9856003 * n) % 360) * rad;
    const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    const eps = (23.439 - 0.0000004 * n) * rad;
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    const gmstH = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
    const ha = (gmstH * 15 + lonDeg) * rad - ra;
    const lat = latDeg * rad;
    return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)) / rad;
  }

  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Approximate metres between two lon/lat points (equirectangular, fine at campus scale).
  function metres(a, b) {
    const k = 111320;
    const dx = (b[0] - a[0]) * k * Math.cos((a[1] * Math.PI) / 180);
    const dy = (b[1] - a[1]) * k;
    return Math.hypot(dx, dy);
  }

  // ---------------------------------------------------------------- key dialog
  function openKeyDialog() {
    $("inGoogle").value = CFG.GOOGLE_MAPS_API_KEY || store.get("iitr.googleKey");
    $("inIon").value = CFG.CESIUM_ION_TOKEN || store.get("iitr.ionToken");
    $("keyModal").classList.remove("hidden");
    $("inGoogle").focus();
  }
  $("btnKeySave").onclick = () => {
    const g = $("inGoogle").value.trim(), i = $("inIon").value.trim();
    if (!g && !i) { toast("Enter a Google key or a Cesium ion token.", true); return; }
    g ? store.set("iitr.googleKey", g) : store.del("iitr.googleKey");
    i ? store.set("iitr.ionToken", i) : store.del("iitr.ionToken");
    store.sset("iitr.osmOnly", "");
    location.reload();
  };
  $("btnKeySkip").onclick = () => { store.sset("iitr.osmOnly", "1"); location.reload(); };
  $("btnKeyForget").onclick = () => { store.del("iitr.googleKey"); store.del("iitr.ionToken"); $("inGoogle").value = ""; $("inIon").value = ""; toast("Saved keys removed from this browser."); };

  // ---------------------------------------------------------------- boot
  if (!window.Cesium) {
    loaderMsg("CesiumJS could not be loaded from the CDN. Check the internet connection.", true);
    return;
  }
  const C = window.Cesium;

  const googleKey = CFG.GOOGLE_MAPS_API_KEY || store.get("iitr.googleKey");
  const ionToken = CFG.CESIUM_ION_TOKEN || store.get("iitr.ionToken");
  const osmOnly = store.sget("iitr.osmOnly") === "1" || new URLSearchParams(location.search).has("osm");

  if (!googleKey && !ionToken && !osmOnly) {
    $("loader").classList.add("fade");
    openKeyDialog();
    $("btnKeys").onclick = openKeyDialog;
    return;
  }

  main().catch((err) => {
    console.error(err);
    loaderMsg("Startup failed: " + (err && err.message ? err.message : err), true);
  });

  async function main() {
    if (ionToken) C.Ion.defaultAccessToken = ionToken;
    if (googleKey) C.GoogleMaps.defaultApiKey = googleKey;
    const wantPhoto = !!(googleKey || ionToken) && !osmOnly;

    // ---------------------------------------------------------------- viewer
    loaderMsg("Creating viewer…");
    const viewer = new C.Viewer("cesiumContainer", {
      baseLayer: false,
      geocoder: ionToken && wantPhoto ? C.IonGeocodeProviderType.GOOGLE : false,
      baseLayerPicker: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      animation: false,
      timeline: false,
      infoBox: false,
      selectionIndicator: false,
      shadows: false,
      msaaSamples: 4,
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
    });
    const scene = viewer.scene;
    const camera = viewer.camera;
    window.iitrViewer = viewer; // handy for console debugging

    scene.globe.enableLighting = true;
    scene.globe.baseColor = C.Color.fromCssColorString("#0b1324");
    scene.skyAtmosphere.show = true;
    scene.skyAtmosphere.perFragmentAtmosphere = true;
    if (scene.atmosphere && C.DynamicAtmosphereLightingType) {
      scene.atmosphere.dynamicLighting = C.DynamicAtmosphereLightingType.SUNLIGHT;
    }
    scene.fog.enabled = true;
    scene.postProcessStages.fxaa.enabled = true;
    scene.screenSpaceCameraController.enableCollisionDetection = true;
    viewer.clock.shouldAnimate = false;

    const state = {
      tileset: null,
      groundH: wantPhoto ? APPROX_GROUND_H : 0,
      center: C.Cartesian3.fromDegrees(CAMPUS.lon, CAMPUS.lat, wantPhoto ? APPROX_GROUND_H : 0),
      orbit: null,
      tourToken: 0,
      minutes: 16 * 60 + 30,
      lapse: false,
      night: 0,
      golden: 0,
      mode: 0,
      ways: [],
      adjacency: new Map(),
      agents: [],
      speedUp: 4,
      measure: { on: false, a: null },
      selected: null,
      keys: new Set(),
      mouse: null,
      layersReady: false,
    };

    // Space view while loading
    camera.setView({ destination: C.Cartesian3.fromDegrees(79.0, 22.0, 14000000) });

    // ---------------------------------------------------------------- data sources
    const dsLandmarks = new C.CustomDataSource("landmarks");
    const dsBeams = new C.CustomDataSource("beams");
    const dsBoundary = new C.CustomDataSource("boundary");
    const dsRoads = new C.CustomDataSource("roads");
    const dsMeasure = new C.CustomDataSource("measure");
    for (const ds of [dsLandmarks, dsBeams, dsBoundary, dsRoads, dsMeasure]) viewer.dataSources.add(ds);

    const agentPoints = scene.primitives.add(new C.PointPrimitiveCollection());
    const clouds = scene.primitives.add(new C.CloudCollection({ noiseDetail: 16.0 }));

    // ---------------------------------------------------------------- 3D tiles
    const twinShader = new C.CustomShader({
      uniforms: {
        u_night: { type: C.UniformType.FLOAT, value: 0.0 },
        u_golden: { type: C.UniformType.FLOAT, value: 0.0 },
        u_mode: { type: C.UniformType.FLOAT, value: 0.0 },
        u_maxH: { type: C.UniformType.FLOAT, value: 40.0 },
        u_center: { type: C.UniformType.VEC3, value: state.center },
        u_up: { type: C.UniformType.VEC3, value: C.Ellipsoid.WGS84.geodeticSurfaceNormal(state.center, new C.Cartesian3()) },
      },
      lightingModel: C.LightingModel.UNLIT,
      fragmentShaderText: /* glsl */ `
        vec3 twinRamp(float t) {
          vec3 c0 = vec3(0.05, 0.10, 0.35);
          vec3 c1 = vec3(0.00, 0.55, 0.85);
          vec3 c2 = vec3(0.15, 0.85, 0.45);
          vec3 c3 = vec3(0.98, 0.85, 0.20);
          vec3 c4 = vec3(0.95, 0.25, 0.15);
          t = clamp(t, 0.0, 1.0) * 4.0;
          if (t < 1.0) return mix(c0, c1, t);
          if (t < 2.0) return mix(c1, c2, t - 1.0);
          if (t < 3.0) return mix(c2, c3, t - 2.0);
          return mix(c3, c4, t - 3.0);
        }
        void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
          vec3 col = material.diffuse;
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          // Height above campus ground along the local vertical (tangent-plane approximation).
          float h = dot(fsInput.attributes.positionWC - u_center, u_up);
          if (u_mode > 0.5 && u_mode < 1.5) {
            col = twinRamp(h / u_maxH) * (0.45 + 0.75 * lum);
            float c = abs(fract(h / 5.0 + 0.5) - 0.5);
            col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.07, c)) * step(1.5, h) * 0.55);
          } else if (u_mode > 1.5) {
            vec3 bp = vec3(0.04, 0.20, 0.42) + vec3(0.25, 0.65, 1.0) * lum * 0.9;
            float c = abs(fract(h / 3.0 + 0.5) - 0.5);
            bp = mix(bp, vec3(0.75, 0.95, 1.0), (1.0 - smoothstep(0.0, 0.06, c)) * step(1.0, h) * 0.7);
            col = bp;
          }
          // Golden hour warmth, then night: desaturate, cool and darken.
          col = mix(col, col * vec3(1.15, 0.92, 0.74), u_golden * 0.55);
          float l2 = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(col, vec3(l2) * vec3(0.32, 0.42, 0.75) * 0.55, u_night * 0.85);
          material.diffuse = col;
        }
      `,
    });

    if (wantPhoto) {
      loaderMsg("Connecting to Google Photorealistic 3D Tiles…");
      try {
        const tileset = await C.createGooglePhotorealistic3DTileset(
          { onlyUsingWithGoogleGeocoder: true },
          { maximumScreenSpaceError: 12, cacheBytes: 1536 * 1024 * 1024, showCreditsOnScreen: true }
        );
        tileset.customShader = twinShader;
        scene.primitives.add(tileset);
        scene.globe.show = false;
        state.tileset = tileset;
        tileset.tileLoadProgressEvent.addEventListener((pending, processing) => {
          $("hudTiles").textContent = pending + processing > 0 ? `${pending + processing} loading` : "ready";
        });
        tileset.tileFailed.addEventListener((e) => console.warn("Tile failed", e && e.message));
      } catch (err) {
        console.error(err);
        toast("Google 3D tiles failed to load: " + (err.message || err) + ". Falling back to OpenStreetMap.", true, 9000);
      }
    }
    if (!state.tileset) {
      viewer.imageryLayers.add(new C.ImageryLayer(new C.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })));
      state.groundH = 0;
      state.center = C.Cartesian3.fromDegrees(CAMPUS.lon, CAMPUS.lat, 0);
      $("modeSeg").classList.add("disabled");
      $("hudTiles").textContent = "OSM 2D";
    }

    // ---------------------------------------------------------------- post-processing
    const vignette = scene.postProcessStages.add(new C.PostProcessStage({
      name: "iitr_grade",
      fragmentShader: /* glsl */ `
        uniform sampler2D colorTexture;
        uniform float u_strength;
        in vec2 v_textureCoordinates;
        void main() {
          vec4 c = texture(colorTexture, v_textureCoordinates);
          vec2 uv = v_textureCoordinates - 0.5;
          float v = 1.0 - u_strength * dot(uv, uv) * 1.6;
          vec3 col = c.rgb * v;
          // gentle S-curve contrast and saturation lift
          col = mix(col, col * col * (3.0 - 2.0 * col), 0.25 * u_strength);
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, 1.0 + 0.18 * u_strength);
          out_FragColor = vec4(col, c.a);
        }
      `,
      uniforms: { u_strength: 1.0 },
    }));
    const bloom = scene.postProcessStages.bloom;
    bloom.uniforms.glowOnly = false;
    bloom.uniforms.contrast = 128;
    bloom.uniforms.brightness = -0.35;
    bloom.uniforms.delta = 1.0;
    bloom.uniforms.sigma = 2.5;
    bloom.uniforms.stepSize = 1.0;

    function setCinematic(on) {
      vignette.enabled = on;
      bloom.enabled = on && state.night > 0.4; // bloom only pays off at night (glowing agents/beacons)
    }

    // ---------------------------------------------------------------- landmarks
    function makePin(color) {
      const c = document.createElement("canvas");
      c.width = 64; c.height = 96;
      const g = c.getContext("2d");
      const cx = 32, cy = 30;
      const grd = g.createRadialGradient(cx, cy, 2, cx, cy, 30);
      grd.addColorStop(0, color + "cc"); grd.addColorStop(1, color + "00");
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(cx, cy, 13, 0, Math.PI * 2); g.fillStyle = "rgba(8,13,24,0.92)"; g.fill();
      g.lineWidth = 3; g.strokeStyle = color; g.stroke();
      g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fillStyle = color; g.fill();
      const lg = g.createLinearGradient(0, cy + 14, 0, 96);
      lg.addColorStop(0, color); lg.addColorStop(1, color + "00");
      g.strokeStyle = lg; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy + 14); g.lineTo(cx, 96); g.stroke();
      return c;
    }
    const pins = {};
    for (const k of Object.keys(CATS)) pins[k] = makePin(CATS[k].color);

    const hRef = state.tileset ? C.HeightReference.RELATIVE_TO_GROUND : C.HeightReference.NONE;
    for (const lm of LANDMARKS) {
      lm.cfg = CATS[lm.cat] || CATS.facility;
      lm.entity = dsLandmarks.entities.add({
        position: C.Cartesian3.fromDegrees(lm.lon, lm.lat, state.tileset ? 0 : 0),
        billboard: {
          image: pins[lm.cat] || pins.facility,
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          heightReference: hRef,
          scale: 0.62,
          scaleByDistance: new C.NearFarScalar(300, 1.0, 6000, 0.45),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: lm.name,
          font: "600 15px Inter, Segoe UI, sans-serif",
          fillColor: C.Color.WHITE,
          outlineColor: C.Color.BLACK,
          outlineWidth: 3,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: new C.Color(0.03, 0.06, 0.12, 0.72),
          backgroundPadding: new C.Cartesian2(9, 6),
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          pixelOffset: new C.Cartesian2(0, -64),
          heightReference: hRef,
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2300),
          scaleByDistance: new C.NearFarScalar(300, 1.0, 2300, 0.72),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      lm.entity.iitrLandmark = lm;
    }

    // Landmark list UI
    const lmList = $("lmList");
    function renderList(filter = "") {
      lmList.innerHTML = "";
      const f = filter.trim().toLowerCase();
      let count = 0;
      for (const cat of Object.keys(CATS)) {
        const items = LANDMARKS.filter((l) => l.cat === cat && (!f || l.name.toLowerCase().includes(f)));
        if (!items.length) continue;
        const gh = document.createElement("li");
        gh.className = "group"; gh.textContent = CATS[cat].label;
        lmList.appendChild(gh);
        for (const lm of items) {
          const li = document.createElement("li");
          li.innerHTML = `<span class="dot" style="color:${CATS[cat].color}"></span><span></span>`;
          li.lastChild.textContent = lm.name;
          li.tabIndex = 0;
          li.onclick = () => selectLandmark(lm, true);
          li.onkeydown = (e) => { if (e.key === "Enter") selectLandmark(lm, true); };
          if (state.selected === lm) li.classList.add("on");
          lm.li = li;
          lmList.appendChild(li);
          count++;
        }
      }
      $("lmCount").textContent = String(count);
    }
    renderList();
    $("lmFilter").addEventListener("input", (e) => renderList(e.target.value));

    // Agent legend
    $("agentLegend").innerHTML = Object.values(MODES).map((m) => `<span style="--c:${m.color}">${m.label}</span>`).join("");

    // ---------------------------------------------------------------- camera control
    function stopAuto() {
      state.orbit = null;
      state.tourToken++;
      $("btnOrbit").classList.remove("on");
      $("btnTour").classList.remove("on");
      camera.lookAtTransform(C.Matrix4.IDENTITY);
    }

    function startOrbit(center, range = 1100, pitchDeg = -32, rate = 0.05) {
      state.orbit = { center, heading: camera.heading, pitch: C.Math.toRadians(pitchDeg), range, rate, last: performance.now() };
      $("btnOrbit").classList.add("on");
    }

    function flyToPoint(target, range, pitchDeg, heading = camera.heading, duration = 3) {
      return new Promise((resolve) => {
        camera.flyToBoundingSphere(new C.BoundingSphere(target, 60), {
          offset: new C.HeadingPitchRange(heading, C.Math.toRadians(pitchDeg), range),
          duration,
          easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
          complete: () => resolve(true),
          cancel: () => resolve(false),
        });
      });
    }

    async function introFlight() {
      stopAuto();
      camera.setView({
        destination: C.Cartesian3.fromDegrees(79.0, 22.0, 14000000),
        orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
      });
      await new Promise((resolve) => camera.flyTo({
        destination: C.Cartesian3.fromDegrees(CAMPUS.lon, CAMPUS.lat - 0.035, state.groundH + 3200),
        orientation: { heading: C.Math.toRadians(5), pitch: C.Math.toRadians(-38), roll: 0 },
        duration: 7.5,
        easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
        complete: () => resolve(true),
        cancel: () => resolve(false),
      }));
      const ok = await flyToPoint(state.center, 1150, -30, C.Math.toRadians(20), 3.5);
      if (ok) startOrbit(state.center, 1150, -30, 0.045);
    }

    async function runTour() {
      stopAuto();
      const token = state.tourToken;
      $("btnTour").classList.add("on");
      const stops = TOUR.map((n) => LANDMARKS.find((l) => l.name === n)).filter(Boolean);
      let heading = camera.heading;
      for (let i = 0; token === state.tourToken; i = (i + 1) % stops.length) {
        const lm = stops[i];
        selectLandmark(lm, false);
        heading += C.Math.toRadians(70);
        const ok = await flyToPoint(lmTarget(lm), 380, -28, heading, 4);
        if (!ok || token !== state.tourToken) break;
        state.orbit = { center: lmTarget(lm), heading: camera.heading, pitch: C.Math.toRadians(-28), range: 380, rate: 0.12, last: performance.now() };
        await sleep(6500);
        if (token !== state.tourToken) break;
        state.orbit = null;
        camera.lookAtTransform(C.Matrix4.IDENTITY);
      }
      $("btnTour").classList.remove("on");
    }

    function topDown() {
      stopAuto();
      camera.flyTo({
        destination: C.Cartesian3.fromDegrees(CAMPUS.lon, CAMPUS.lat, state.groundH + 1900),
        orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
        duration: 2.5,
      });
    }

    function faceNorth() {
      stopAuto();
      camera.flyTo({
        destination: camera.positionWC.clone(),
        orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
        duration: 1.0,
      });
    }

    // ---------------------------------------------------------------- selection
    function lmTarget(lm) {
      return lm.top || C.Cartesian3.fromDegrees(lm.lon, lm.lat, state.groundH);
    }

    function selectLandmark(lm, fly) {
      state.selected = lm;
      for (const l of LANDMARKS) if (l.li) l.li.classList.toggle("on", l === lm);
      if (lm.li) lm.li.scrollIntoView({ block: "nearest" });
      for (const l of LANDMARKS) if (l.beam) l.beam.polyline.material.color = C.Color.fromCssColorString(l.cfg.color).withAlpha(l === lm ? 0.95 : 0.45);

      $("infoCat").textContent = lm.cfg.label;
      $("infoCat").style.color = lm.cfg.color;
      $("infoCat").style.background = lm.cfg.color + "22";
      $("infoName").textContent = lm.name;
      const rows = [
        ["Latitude", lm.lat.toFixed(6) + "°"],
        ["Longitude", lm.lon.toFixed(6) + "°"],
      ];
      if (lm.levels) rows.push(["OSM levels", String(lm.levels)]);
      if (Number.isFinite(lm.roofAboveGround)) rows.push(["Mesh height*", lm.roofAboveGround.toFixed(1) + " m"]);
      rows.push(["Source", "OpenStreetMap"]);
      const dl = $("infoDl");
      dl.innerHTML = "";
      for (const [k, v] of rows) {
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd"); dd.textContent = v;
        dl.append(dt, dd);
      }
      if (Number.isFinite(lm.roofAboveGround)) {
        const dt = document.createElement("dt"); dt.textContent = "";
        const dd = document.createElement("dd");
        dd.textContent = "*Mesh surface at the OSM centroid, above median road level. It may hit a tree or a lower roof section.";
        dd.style.cssText = "font-family:var(--font);color:var(--muted);font-size:10.5px;grid-column:1/-1";
        dl.append(dd);
      }
      $("infoCard").classList.remove("hidden");

      if (fly) {
        stopAuto();
        flyToPoint(lmTarget(lm), 420, -30, camera.heading, 2.8).then((ok) => {
          if (ok && state.selected === lm) startOrbit(lmTarget(lm), 420, -30, 0.1);
        });
      }
    }

    $("infoClose").onclick = () => {
      $("infoCard").classList.add("hidden");
      state.selected = null;
      for (const l of LANDMARKS) {
        if (l.li) l.li.classList.remove("on");
        if (l.beam) l.beam.polyline.material.color = C.Color.fromCssColorString(l.cfg.color).withAlpha(0.45);
      }
    };
    $("infoOrbit").onclick = () => {
      const lm = state.selected; if (!lm) return;
      stopAuto();
      flyToPoint(lmTarget(lm), 420, -30, camera.heading, 2).then((ok) => { if (ok) startOrbit(lmTarget(lm), 420, -30, 0.1); });
    };
    $("infoLow").onclick = () => {
      const lm = state.selected; if (!lm) return;
      stopAuto();
      flyToPoint(lmTarget(lm), 190, -8, camera.heading, 2.5);
    };

    // ---------------------------------------------------------------- time of day
    const todayIST = new Date(Date.now() + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
    $("dateLabel").textContent = todayIST;

    function setTime(minutes) {
      state.minutes = ((minutes % 1440) + 1440) % 1440;
      const hh = Math.floor(state.minutes / 60), mm = Math.floor(state.minutes % 60);
      const iso = `${todayIST}T${pad2(hh)}:${pad2(mm)}:00+05:30`;
      viewer.clock.currentTime = C.JulianDate.fromIso8601(iso);
      const el = solarElevationDeg(new Date(iso), CAMPUS.lat, CAMPUS.lon);
      state.night = smoothstep(3, -9, el);
      state.golden = el > -6 ? clamp(1 - Math.abs(el - 5) / 13, 0, 1) : 0;

      $("timeLabel").textContent = `${pad2(hh)}:${pad2(mm)}`;
      $("sunLabel").textContent = `Sun ${el.toFixed(1)}°`;
      $("timeSlider").value = String(Math.floor(state.minutes));

      twinShader.setUniform("u_night", state.night);
      twinShader.setUniform("u_golden", state.golden);
      setCinematic($("chkCinematic").checked);
      for (let i = 0; i < clouds.length; i++) clouds.get(i).brightness = 1.0 - 0.85 * state.night;
      const boost = 1 + state.night * 0.8;
      for (const a of state.agents) a.p.pixelSize = MODES[a.mode].size * boost;
    }
    $("timeSlider").addEventListener("input", (e) => setTime(+e.target.value));
    $("btnNow").onclick = () => {
      const d = new Date(Date.now() + IST_OFFSET_MIN * 60000);
      setTime(d.getUTCHours() * 60 + d.getUTCMinutes());
    };
    $("btnGolden").onclick = () => {
      // find the evening minute where the sun is ~5 deg up
      let best = 17 * 60, bestErr = 1e9;
      for (let m = 14 * 60; m < 20 * 60; m += 2) {
        const iso = `${todayIST}T${pad2(Math.floor(m / 60))}:${pad2(m % 60)}:00+05:30`;
        const err = Math.abs(solarElevationDeg(new Date(iso), CAMPUS.lat, CAMPUS.lon) - 5);
        if (err < bestErr) { bestErr = err; best = m; }
      }
      setTime(best);
    };
    $("btnLapse").onclick = () => {
      state.lapse = !state.lapse;
      $("btnLapse").classList.toggle("on", state.lapse);
    };

    // ---------------------------------------------------------------- visual controls
    $("modeSeg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (!b || !state.tileset) return;
      state.mode = +b.dataset.mode;
      for (const x of $("modeSeg").children) x.classList.toggle("on", x === b);
      twinShader.setUniform("u_mode", state.mode);
      $("heightLegend").classList.toggle("hidden", state.mode !== 1);
    });
    $("maxHSlider").addEventListener("input", (e) => {
      const v = +e.target.value;
      twinShader.setUniform("u_maxH", v);
      $("maxHOut").textContent = `${v} m`;
      $("rampMid").textContent = `${v / 2} m`;
      $("rampMax").textContent = `${v} m`;
    });
    $("chkCinematic").addEventListener("change", (e) => setCinematic(e.target.checked));
    $("chkClouds").addEventListener("change", (e) => { clouds.show = e.target.checked; });
    const qualityName = (v) => (v <= 4 ? "Ultra" : v <= 12 ? "High" : v <= 20 ? "Medium" : "Low");
    $("qualitySlider").addEventListener("input", (e) => {
      const v = +e.target.value;
      $("qualityOut").textContent = qualityName(v);
      if (state.tileset) state.tileset.maximumScreenSpaceError = v;
    });
    $("qualityOut").textContent = qualityName(12);

    $("chkLandmarks").addEventListener("change", (e) => { dsLandmarks.show = e.target.checked; dsBeams.show = e.target.checked; });
    $("chkBoundary").addEventListener("change", (e) => { dsBoundary.show = e.target.checked; });
    $("chkRoads").addEventListener("change", (e) => { dsRoads.show = e.target.checked; });
    $("chkAgents").addEventListener("change", (e) => { agentPoints.show = e.target.checked; });
    $("agentSlider").addEventListener("input", (e) => { $("agentOut").textContent = e.target.value; });
    $("agentSlider").addEventListener("change", (e) => spawnAgents(+e.target.value));
    $("speedSlider").addEventListener("input", (e) => { state.speedUp = +e.target.value; $("speedOut").textContent = `${state.speedUp}×`; });

    $("btnIntro").onclick = () => introFlight();
    $("btnOrbit").onclick = () => {
      if (state.orbit) { stopAuto(); return; }
      stopAuto();
      flyToPoint(state.center, 1150, -30, camera.heading, 2).then((ok) => { if (ok) startOrbit(state.center, 1150, -30, 0.05); });
    };
    $("btnTour").onclick = () => { if ($("btnTour").classList.contains("on")) stopAuto(); else runTour(); };
    $("btnTop").onclick = topDown;
    $("compass").onclick = faceNorth;
    $("btnKeys").onclick = openKeyDialog;
    $("btnPhoto").onclick = () => togglePhoto(true);
    $("btnShot").onclick = screenshot;
    $("btnMeasure").onclick = () => toggleMeasure();

    for (const b of document.querySelectorAll("#mobileBar button")) {
      b.onclick = () => {
        const id = b.dataset.panel;
        for (const p of ["leftPanel", "rightPanel"]) $(p).classList.toggle("open", p === id && !$(p).classList.contains("open"));
      };
    }

    // ---------------------------------------------------------------- live traffic (Google Map Tiles API, layerTraffic)
    const traffic = { layer: null, timer: null, target: null };
    // Limit tile requests to greater Roorkee (keeps Map Tiles API usage down).
    const TRAFFIC_RECT = C.Rectangle.fromDegrees(77.80, 29.80, 78.00, 29.94);

    async function loadTraffic() {
      if (!C.Google2DImageryProvider) throw new Error("This CesiumJS build has no Google2DImageryProvider");
      const opts = { overlayLayerType: "layerTraffic", language: "en", region: "IN", rectangle: TRAFFIC_RECT };
      const provider = googleKey
        ? await C.Google2DImageryProvider.fromUrl({ ...opts, key: googleKey })
        : await C.Google2DImageryProvider.fromIonAssetId({ ...opts, assetId: 3830184 }); // ion "Google Maps 2D" asset
      const layer = new C.ImageryLayer(provider, { alpha: +$("trafficAlpha").value / 100 });
      // Drape on the photorealistic mesh (experimental Cesium API); else on the globe.
      const target = state.tileset && state.tileset.imageryLayers ? state.tileset.imageryLayers : viewer.imageryLayers;
      target.add(layer);
      if (traffic.layer) traffic.target.remove(traffic.layer, true); // swap after the new one is in, to avoid flicker
      traffic.layer = layer;
      traffic.target = target;
      const d = new Date();
      $("trafficStamp").textContent = `live · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }

    async function setTraffic(on) {
      clearInterval(traffic.timer);
      if (!on) {
        if (traffic.layer) traffic.target.remove(traffic.layer, true);
        traffic.layer = null;
        $("trafficStamp").textContent = "off";
        return;
      }
      $("trafficStamp").textContent = "loading…";
      try {
        await loadTraffic();
        traffic.timer = setInterval(() => loadTraffic().catch((e) => console.warn("traffic refresh", e)), 5 * 60 * 1000);
        if (state.night > 0.5) toast("Night grade dims traffic colours. Press Now or Golden hour for a clearer view.");
      } catch (e) {
        console.error(e);
        $("chkTraffic").checked = false;
        $("trafficStamp").textContent = "error";
        toast("Traffic overlay failed: " + (e.message || e) + ". Check that the Map Tiles API is enabled for your key.", true, 9000);
      }
    }

    if (!googleKey && !ionToken) {
      $("trafficSection").style.opacity = "0.45";
      $("trafficSection").style.pointerEvents = "none";
      $("trafficStamp").textContent = "needs key";
    }
    $("chkTraffic").addEventListener("change", (e) => setTraffic(e.target.checked));
    $("trafficAlpha").addEventListener("input", (e) => {
      $("trafficAlphaOut").textContent = `${e.target.value}%`;
      if (traffic.layer) traffic.layer.alpha = +e.target.value / 100;
    });
    $("btnTrafficRefresh").onclick = () => { if ($("chkTraffic").checked) setTraffic(true); else { $("chkTraffic").checked = true; setTraffic(true); } };
    $("btnCityView").onclick = () => {
      stopAuto();
      camera.flyTo({
        destination: C.Cartesian3.fromDegrees(77.885, 29.80, state.groundH + 5200),
        orientation: { heading: C.Math.toRadians(5), pitch: C.Math.toRadians(-50), roll: 0 },
        duration: 3,
      });
    };

    // ---------------------------------------------------------------- clouds
    function addClouds() {
      const rnd = mulberry32(7);
      for (let i = 0; i < 14; i++) {
        const ang = rnd() * Math.PI * 2, r = 900 + rnd() * 2600;
        const lon = CAMPUS.lon + (r * Math.cos(ang)) / (111320 * Math.cos((CAMPUS.lat * Math.PI) / 180));
        const lat = CAMPUS.lat + (r * Math.sin(ang)) / 111320;
        const sx = 500 + rnd() * 700, sy = 180 + rnd() * 160;
        clouds.add({
          position: C.Cartesian3.fromDegrees(lon, lat, state.groundH + 650 + rnd() * 450),
          scale: new C.Cartesian2(sx, sy),
          maximumSize: new C.Cartesian3(sx * 0.9, sy * 0.9, sy * 0.8),
          slice: 0.3 + rnd() * 0.3,
          brightness: 1.0,
        });
      }
    }
    function mulberry32(a) {
      return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }

    // ---------------------------------------------------------------- OSM (Overpass)
    async function overpass(query, cacheKey, localFile) {
      // 1) local snapshot (data/*.json, written by fetch_osm.ps1), 2) browser cache, 3) live Overpass.
      if (localFile) {
        try {
          const r = await fetch(localFile, { cache: "no-cache" });
          if (r.ok) { const d = await r.json(); if (d && d.elements && d.elements.length) return d; }
        } catch (e) { /* no snapshot */ }
      }
      const cached = store.get(cacheKey);
      if (cached) {
        try {
          const o = JSON.parse(cached);
          if (Date.now() - o.t < 7 * 864e5) return o.d;
        } catch (e) { /* ignore bad cache */ }
      }
      const urls = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
      let lastErr;
      for (const u of urls) {
        try {
          const r = await fetch(u, {
            method: "POST",
            body: "data=" + encodeURIComponent(query),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          store.set(cacheKey, JSON.stringify({ t: Date.now(), d }));
          return d;
        } catch (e) { lastErr = e; }
      }
      throw lastErr;
    }

    function stitchRings(segments) {
      // Join open member ways of a multipolygon into closed rings.
      const segs = segments.map((s) => s.slice());
      const rings = [];
      const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
      while (segs.length) {
        let ring = segs.shift();
        let grew = true;
        while (!same(ring[0], ring[ring.length - 1]) && grew) {
          grew = false;
          const end = ring[ring.length - 1];
          for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (same(s[0], end)) { ring = ring.concat(s.slice(1)); segs.splice(i, 1); grew = true; break; }
            if (same(s[s.length - 1], end)) { ring = ring.concat(s.slice().reverse().slice(1)); segs.splice(i, 1); grew = true; break; }
          }
        }
        if (ring.length > 3) rings.push(ring);
      }
      return rings;
    }

    function parseBoundary(json) {
      const rings = [];
      for (const el of json.elements || []) {
        if (el.type === "way" && el.geometry) rings.push(el.geometry.map((p) => [p.lon, p.lat]));
        if (el.type === "relation" && el.members) {
          const segs = el.members.filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
          rings.push(...stitchRings(segs));
        }
      }
      return rings.filter((r) => r.length > 3);
    }

    function simplify(coords, ids, minStep = 8) {
      // Drop vertices closer than minStep metres to the previous kept one (endpoints kept).
      const outC = [coords[0]], outI = [ids[0]];
      for (let i = 1; i < coords.length - 1; i++) {
        if (metres(outC[outC.length - 1], coords[i]) >= minStep) { outC.push(coords[i]); outI.push(ids[i]); }
      }
      outC.push(coords[coords.length - 1]); outI.push(ids[ids.length - 1]);
      return { coords: outC, ids: outI };
    }

    function parseRoads(json, rings) {
      const ways = [];
      for (const el of json.elements || []) {
        if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
        const coords = el.geometry.map((p) => [p.lon, p.lat]);
        const inside = coords.filter((c) => rings.some((r) => pointInRing(c[0], c[1], r))).length;
        if (inside / coords.length < 0.5) continue;
        const hw = (el.tags && el.tags.highway) || "";
        const kind = /^(footway|path|pedestrian|cycleway|track|steps)$/.test(hw) ? "path" : "road";
        const s = simplify(coords, el.nodes || coords.map((_, i) => `${el.id}_${i}`));
        ways.push({ id: el.id, hw, kind, coords: s.coords, nodeIds: s.ids, name: el.tags && el.tags.name });
      }
      return ways;
    }

    async function clampHeights(lonlats) {
      if (!state.tileset || !scene.clampToHeightSupported || !lonlats.length) return lonlats.map(() => NaN);
      const carts = lonlats.map(([lo, la]) => C.Cartesian3.fromDegrees(lo, la, APPROX_GROUND_H));
      const res = await scene.clampToHeightMostDetailed(carts, dsLandmarks.entities.values, 0.2);
      return res.map((p) => (p ? C.Cartographic.fromCartesian(p).height : NaN));
    }

    async function buildOsmLayers() {
      status("Fetching campus boundary and roads from OpenStreetMap…");
      const qBoundary = `[out:json][timeout:25];(way(${OSM_CAMPUS_ID});relation(${OSM_CAMPUS_ID}););out geom;`;
      const qRoads = `[out:json][timeout:40];way["highway"~"^(primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|footway|path|cycleway|track)$"](${CAMPUS.s},${CAMPUS.w},${CAMPUS.n},${CAMPUS.e});out geom;`;
      const [bRes, rRes] = await Promise.allSettled([overpass(qBoundary, "iitr.osm.boundary.v1", "data/osm_boundary.json"), overpass(qRoads, "iitr.osm.roads.v1", "data/osm_roads.json")]);

      let rings = bRes.status === "fulfilled" ? parseBoundary(bRes.value) : [];
      if (!rings.length) {
        rings = [[[CAMPUS.w, CAMPUS.s], [CAMPUS.e, CAMPUS.s], [CAMPUS.e, CAMPUS.n], [CAMPUS.w, CAMPUS.n], [CAMPUS.w, CAMPUS.s]]];
        toast("Campus boundary unavailable from OSM. Showing the bounding box instead.");
      }
      const ways = rRes.status === "fulfilled" ? parseRoads(rRes.value, rings) : [];
      if (rRes.status !== "fulfilled") toast("Road network could not be fetched from OSM, so agents are disabled.", true);

      // Sample the photogrammetry mesh at every vertex we need.
      status(state.tileset ? "Sampling the 3D mesh for ground and roof heights…" : "Building layers…");
      const pts = [];
      const roadIdx = [], ringIdx = [], lmIdx = [];
      for (const w of ways) { roadIdx.push(pts.length); pts.push(...w.coords); }
      for (const r of rings) { ringIdx.push(pts.length); pts.push(...r); }
      for (const lm of LANDMARKS) { lmIdx.push(pts.length); pts.push([lm.lon, lm.lat]); }
      let hs;
      try {
        hs = await clampHeights(pts);
      } catch (e) {
        console.warn("clampToHeightMostDetailed failed", e);
        hs = pts.map(() => NaN);
      }

      // Campus ground = median clamped height of road vertices. Roorkee campus is flat, so
      // vertices that hit tree canopy are pulled back to within ±2.5 m of that median.
      const roadHs = [];
      ways.forEach((w, k) => { for (let i = 0; i < w.coords.length; i++) roadHs.push(hs[roadIdx[k] + i]); });
      let g = median(roadHs);
      if (!Number.isFinite(g)) g = median(hs);
      if (!Number.isFinite(g)) g = state.tileset ? APPROX_GROUND_H : 0;
      state.groundH = g;
      state.center = C.Cartesian3.fromDegrees(CAMPUS.lon, CAMPUS.lat, g);
      twinShader.setUniform("u_center", state.center);
      twinShader.setUniform("u_up", C.Ellipsoid.WGS84.geodeticSurfaceNormal(state.center, new C.Cartesian3()));
      const groundAt = (h) => (Number.isFinite(h) ? clamp(h, g - 2.5, g + 2.5) : g);

      // Landmark roofs and beacons
      LANDMARKS.forEach((lm, k) => {
        const h = hs[lmIdx[k]];
        const top = Number.isFinite(h) ? h : g;
        lm.roofAboveGround = Number.isFinite(h) ? h - g : NaN;
        lm.top = C.Cartesian3.fromDegrees(lm.lon, lm.lat, top);
        lm.beam = dsBeams.entities.add({
          polyline: {
            positions: [C.Cartesian3.fromDegrees(lm.lon, lm.lat, top + 2), C.Cartesian3.fromDegrees(lm.lon, lm.lat, top + 90)],
            width: 9,
            arcType: C.ArcType.NONE,
            material: new C.PolylineGlowMaterialProperty({ glowPower: 0.3, taperPower: 0.25, color: C.Color.fromCssColorString(lm.cfg.color).withAlpha(0.45) }),
          },
        });
      });

      // Geofence wall around the campus boundary
      const wallImg = (() => {
        const c = document.createElement("canvas"); c.width = 4; c.height = 128;
        const x = c.getContext("2d");
        const gr = x.createLinearGradient(0, 0, 0, 128);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.75, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,1)");
        x.fillStyle = gr; x.fillRect(0, 0, 4, 128);
        return c;
      })();
      const t0 = performance.now();
      rings.forEach((ring, k) => {
        const base = ring.map((c, i) => groundAt(hs[ringIdx[k] + i]));
        const flat = [];
        ring.forEach((c) => flat.push(c[0], c[1]));
        dsBoundary.entities.add({
          wall: {
            positions: C.Cartesian3.fromDegreesArray(flat),
            minimumHeights: base.map((h) => h - 1),
            maximumHeights: base.map((h) => h + 38),
            material: new C.ImageMaterialProperty({
              image: wallImg,
              transparent: true,
              color: new C.CallbackProperty(() => {
                const a = 0.55 + 0.25 * Math.sin((performance.now() - t0) / 700);
                return C.Color.fromCssColorString("#5ec8ff").withAlpha(a);
              }, false),
            }),
          },
        });
        dsBoundary.entities.add({
          polyline: {
            positions: ring.map((c, i) => C.Cartesian3.fromDegrees(c[0], c[1], base[i] + 1)),
            width: 6,
            material: new C.PolylineGlowMaterialProperty({ glowPower: 0.25, color: C.Color.fromCssColorString("#8fe3ff") }),
          },
        });
      });

      // Road network
      const roadGlow = new C.PolylineGlowMaterialProperty({ glowPower: 0.2, taperPower: 1.0, color: C.Color.fromCssColorString("#ffb347").withAlpha(0.85) });
      const pathGlow = new C.PolylineGlowMaterialProperty({ glowPower: 0.2, taperPower: 1.0, color: C.Color.fromCssColorString("#7CFFB2").withAlpha(0.7) });
      const roadHidden = new C.ColorMaterialProperty(C.Color.fromCssColorString("#ffb347").withAlpha(0.22));
      const pathHidden = new C.ColorMaterialProperty(C.Color.fromCssColorString("#7CFFB2").withAlpha(0.18));
      state.ways = ways.map((w, k) => {
        const pos = w.coords.map((c, i) => C.Cartesian3.fromDegrees(c[0], c[1], groundAt(hs[roadIdx[k] + i]) + 0.6));
        const cum = [0];
        for (let i = 1; i < pos.length; i++) cum.push(cum[i - 1] + C.Cartesian3.distance(pos[i - 1], pos[i]));
        dsRoads.entities.add({
          polyline: {
            positions: pos,
            width: w.kind === "road" ? 5 : 3,
            material: w.kind === "road" ? roadGlow : pathGlow,
            depthFailMaterial: w.kind === "road" ? roadHidden : pathHidden,
          },
        });
        return { ...w, pos: pos.map((p) => C.Cartesian3.add(p, C.Cartesian3.multiplyByScalar(C.Ellipsoid.WGS84.geodeticSurfaceNormal(p, new C.Cartesian3()), 0.8, new C.Cartesian3()), new C.Cartesian3())), cum, len: cum[cum.length - 1] };
      }).filter((w) => w.len > 5);

      // Endpoint adjacency (OSM node ids) so agents can continue onto connected ways.
      state.adjacency.clear();
      state.ways.forEach((w, i) => {
        for (const end of [w.nodeIds[0], w.nodeIds[w.nodeIds.length - 1]]) {
          if (!state.adjacency.has(end)) state.adjacency.set(end, []);
          state.adjacency.get(end).push(i);
        }
      });

      spawnAgents(+$("agentSlider").value);
      state.layersReady = true;
      status("");
      if (state.selected) selectLandmark(state.selected, false);
      toast(`Twin ready: ${LANDMARKS.length} landmarks, ${state.ways.length} OSM ways, ground ≈ ${g.toFixed(1)} m ellipsoidal.`);
    }

    // ---------------------------------------------------------------- agents (illustrative)
    function pickMode(kind, r) {
      if (kind === "path") return r < 0.7 ? "walk" : "bike";
      return r < 0.35 ? "car" : r < 0.8 ? "tw" : r < 0.95 ? "bike" : "walk";
    }
    function spawnAgents(n) {
      agentPoints.removeAll();
      state.agents = [];
      if (!state.ways.length) return;
      const total = state.ways.reduce((s, w) => s + w.len, 0);
      const boost = 1 + state.night * 0.8;
      for (let k = 0; k < n; k++) {
        let r = Math.random() * total, wi = 0;
        while (wi < state.ways.length - 1 && r > state.ways[wi].len) { r -= state.ways[wi].len; wi++; }
        const w = state.ways[wi];
        const mode = pickMode(w.kind, Math.random());
        const m = MODES[mode];
        const a = {
          w: wi, s: Math.random() * w.len, dir: Math.random() < 0.5 ? 1 : -1, seg: 0, mode,
          speed: m.speed * (0.75 + Math.random() * 0.5),
          p: agentPoints.add({
            position: w.pos[0],
            color: C.Color.fromCssColorString(m.color),
            pixelSize: m.size * boost,
            outlineColor: C.Color.fromCssColorString(m.color).withAlpha(0.35),
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new C.NearFarScalar(200, 1.4, 4000, 0.5),
          }),
        };
        state.agents.push(a);
      }
    }

    function allowed(mode, way) { return !(way.kind === "path" && (mode === "car" || mode === "tw")); }

    const scratch = new C.Cartesian3();
    function stepAgents(dt) {
      const ways = state.ways;
      for (const a of state.agents) {
        let w = ways[a.w];
        a.s += a.dir * a.speed * dt * state.speedUp;
        if (a.s > w.len || a.s < 0) {
          const atEnd = a.s > w.len;
          const node = atEnd ? w.nodeIds[w.nodeIds.length - 1] : w.nodeIds[0];
          const overflow = atEnd ? a.s - w.len : -a.s;
          const options = (state.adjacency.get(node) || []).filter((i) => i !== a.w && allowed(a.mode, ways[i]));
          if (options.length) {
            const ni = options[(Math.random() * options.length) | 0];
            const nw = ways[ni];
            a.w = ni; w = nw;
            if (nw.nodeIds[0] === node) { a.dir = 1; a.s = Math.min(overflow, nw.len); a.seg = 0; }
            else { a.dir = -1; a.s = Math.max(nw.len - overflow, 0); a.seg = nw.pos.length - 2; }
          } else {
            a.dir = -a.dir;
            a.s = atEnd ? w.len - overflow : overflow;
          }
          a.s = clamp(a.s, 0, w.len);
        }
        // locate segment
        let i = clamp(a.seg, 0, w.cum.length - 2);
        while (i < w.cum.length - 2 && a.s > w.cum[i + 1]) i++;
        while (i > 0 && a.s < w.cum[i]) i--;
        a.seg = i;
        const segLen = w.cum[i + 1] - w.cum[i] || 1;
        const t = (a.s - w.cum[i]) / segLen;
        a.p.position = C.Cartesian3.lerp(w.pos[i], w.pos[i + 1], t, scratch);
      }
    }

    // ---------------------------------------------------------------- measure tool
    function toggleMeasure(force) {
      state.measure.on = force !== undefined ? force : !state.measure.on;
      state.measure.a = null;
      $("btnMeasure").classList.toggle("on", state.measure.on);
      if (state.measure.on) { stopAuto(); toast("Measure: click two points on the model."); }
      else dsMeasure.entities.removeAll();
    }
    function measureClick(pos) {
      if (!pos) { toast("No surface under the cursor.", true); return; }
      const dot = (p, c) => dsMeasure.entities.add({ position: p, point: { pixelSize: 10, color: C.Color.fromCssColorString(c), outlineColor: C.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
      if (!state.measure.a || state.measure.done) {
        dsMeasure.entities.removeAll();
        state.measure.a = pos; state.measure.done = false;
        dot(pos, "#5ec8ff");
        return;
      }
      const a = state.measure.a, b = pos;
      dot(b, "#8b5cff");
      const ca = C.Cartographic.fromCartesian(a), cb = C.Cartographic.fromCartesian(b);
      const horiz = new C.EllipsoidGeodesic(ca, cb).surfaceDistance;
      const vert = cb.height - ca.height;
      const slant = C.Cartesian3.distance(a, b);
      dsMeasure.entities.add({
        polyline: {
          positions: [a, b], width: 4, arcType: C.ArcType.NONE,
          material: new C.PolylineGlowMaterialProperty({ glowPower: 0.3, color: C.Color.fromCssColorString("#ffffff") }),
          depthFailMaterial: new C.PolylineDashMaterialProperty({ color: C.Color.WHITE.withAlpha(0.6) }),
        },
      });
      dsMeasure.entities.add({
        position: C.Cartesian3.midpoint(a, b, new C.Cartesian3()),
        label: {
          text: `Horizontal ${horiz.toFixed(1)} m\nVertical ${vert >= 0 ? "+" : ""}${vert.toFixed(1)} m\n3D ${slant.toFixed(1)} m`,
          font: "500 13px JetBrains Mono, Consolas, monospace",
          showBackground: true, backgroundColor: new C.Color(0.03, 0.06, 0.12, 0.85), backgroundPadding: new C.Cartesian2(10, 7),
          fillColor: C.Color.WHITE, pixelOffset: new C.Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      state.measure.done = true;
    }

    // ---------------------------------------------------------------- screenshot / photo mode
    function togglePhoto(on) {
      document.body.classList.toggle("photo", on);
      if (on) toast("Photo mode. Press H or Esc to show the interface.", false, 2500);
    }
    function screenshot() {
      viewer.render();
      const src = scene.canvas;
      const out = document.createElement("canvas");
      out.width = src.width; out.height = src.height;
      const g = out.getContext("2d");
      g.drawImage(src, 0, 0);
      const fs = Math.max(12, Math.round(src.height / 70));
      g.font = `500 ${fs}px Inter, sans-serif`;
      g.fillStyle = "rgba(0,0,0,0.45)";
      const txt = "IIT Roorkee Digital Twin · 3D: Google Photorealistic 3D Tiles · Landmarks/roads © OpenStreetMap contributors";
      const tw = g.measureText(txt).width;
      g.fillRect(0, out.height - fs * 2, tw + fs * 2, fs * 2);
      g.fillStyle = "#fff";
      g.fillText(txt, fs, out.height - fs * 0.65);
      const a = document.createElement("a");
      const d = new Date();
      a.download = `IITR-twin-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.png`;
      a.href = out.toDataURL("image/png");
      a.click();
    }

    // ---------------------------------------------------------------- input
    const handler = new C.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((click) => {
      if (state.measure.on) {
        measureClick(scene.pickPositionSupported ? scene.pickPosition(click.position) : undefined);
        return;
      }
      const picked = scene.pick(click.position);
      if (picked && picked.id && picked.id.iitrLandmark) selectLandmark(picked.id.iitrLandmark, true);
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((m) => { state.mouse = m.endPosition; }, C.ScreenSpaceEventType.MOUSE_MOVE);

    // Any manual camera input cancels orbit / tour.
    const cancelers = ["LEFT_DOWN", "RIGHT_DOWN", "MIDDLE_DOWN", "WHEEL", "PINCH_START"];
    for (const t of cancelers) handler.setInputAction(() => { if (state.orbit || $("btnTour").classList.contains("on")) stopAuto(); }, C.ScreenSpaceEventType[t]);

    const typing = () => /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "") && document.activeElement.type !== "range" && document.activeElement.type !== "checkbox";
    window.addEventListener("keydown", (e) => {
      if (typing()) return;
      const k = e.key.toLowerCase();
      if (k === "escape") { stopAuto(); togglePhoto(false); if (state.measure.on) toggleMeasure(false); return; }
      if (k === "h") { togglePhoto(!document.body.classList.contains("photo")); return; }
      if (k === "p") { screenshot(); return; }
      if (["w", "a", "s", "d", "q", "e", "arrowleft", "arrowright", "arrowup", "arrowdown", "shift"].includes(k)) {
        if (state.orbit || $("btnTour").classList.contains("on")) stopAuto();
        state.keys.add(k);
        if (k.startsWith("arrow")) e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => state.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => state.keys.clear());

    function flyKeys(dt) {
      if (!state.keys.size) return;
      const K = state.keys;
      const pos = camera.positionWC;
      const up = C.Ellipsoid.WGS84.geodeticSurfaceNormal(pos, new C.Cartesian3());
      const dir = camera.directionWC;
      const fwd = C.Cartesian3.subtract(dir, C.Cartesian3.multiplyByScalar(up, C.Cartesian3.dot(dir, up), new C.Cartesian3()), new C.Cartesian3());
      if (C.Cartesian3.magnitude(fwd) < 1e-6) C.Cartesian3.clone(camera.upWC, fwd);
      C.Cartesian3.normalize(fwd, fwd);
      const right = C.Cartesian3.normalize(C.Cartesian3.cross(fwd, up, new C.Cartesian3()), new C.Cartesian3());
      const alt = Math.max(15, camera.positionCartographic.height - state.groundH);
      const v = alt * 0.8 * dt * (K.has("shift") ? 3 : 1);
      if (K.has("w")) camera.move(fwd, v);
      if (K.has("s")) camera.move(fwd, -v);
      if (K.has("d")) camera.move(right, v);
      if (K.has("a")) camera.move(right, -v);
      if (K.has("e")) camera.move(up, v);
      if (K.has("q")) camera.move(up, -v);
      if (K.has("arrowleft")) camera.look(up, -1.0 * dt);
      if (K.has("arrowright")) camera.look(up, 1.0 * dt);
      if (K.has("arrowup")) camera.lookUp(0.7 * dt);
      if (K.has("arrowdown")) camera.lookDown(0.7 * dt);
    }

    // ---------------------------------------------------------------- frame loop
    let last = performance.now();
    let hudT = 0;
    scene.preUpdate.addEventListener(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (state.orbit) {
        const o = state.orbit;
        o.heading += o.rate * dt;
        camera.lookAt(o.center, new C.HeadingPitchRange(o.heading, o.pitch, o.range));
      }
      flyKeys(dt);
      if (state.lapse) setTime(state.minutes + dt * 40); // 40 simulated minutes per second
      if (state.agents.length && agentPoints.show) stepAgents(dt);
    });

    scene.postRender.addEventListener(() => {
      $("compassRose").style.transform = `rotate(${-C.Math.toDegrees(camera.heading)}deg)`;
      const now = performance.now();
      if (now - hudT < 120) return;
      hudT = now;
      const camAlt = camera.positionCartographic.height - state.groundH;
      $("hudCam").textContent = camAlt > 10000 ? `${(camAlt / 1000).toFixed(0)} km` : `${camAlt.toFixed(0)} m`;
      if (state.mouse && scene.pickPositionSupported) {
        let p;
        try { p = scene.pickPosition(state.mouse); } catch (e) { p = undefined; }
        if (p) {
          const c = C.Cartographic.fromCartesian(p);
          $("hudLat").textContent = C.Math.toDegrees(c.latitude).toFixed(6);
          $("hudLon").textContent = C.Math.toDegrees(c.longitude).toFixed(6);
          $("hudH").textContent = `${(c.height - state.groundH).toFixed(1)} m`;
        }
      }
    });

    // ---------------------------------------------------------------- go
    if (new URLSearchParams(location.search).has("debug")) {
      setInterval(() => {
        const c = camera.positionCartographic;
        console.log("DBG", JSON.stringify({ lon: C.Math.toDegrees(c.longitude).toFixed(4), lat: C.Math.toDegrees(c.latitude).toFixed(4), h: c.height.toFixed(0), pitch: C.Math.toDegrees(camera.pitch).toFixed(1), globe: scene.globe.show, tilesLoaded: scene.globe.tilesLoaded, layers: viewer.imageryLayers.length, ground: state.groundH, ways: state.ways.length, agents: state.agents.length }));
      }, 3000);
    }
    setTime(state.minutes);
    setCinematic(true);
    addClouds();

    loaderMsg("Preparing campus…");
    await sleep(400);
    $("loader").classList.add("fade");
    setTimeout(() => $("loader").remove(), 1400);
    if (!state.tileset && wantPhoto === false) toast("Running with OpenStreetMap imagery only. Add a key under Tools › API keys for photorealistic 3D.", false, 7000);

    const intro = introFlight();
    buildOsmLayers().catch((e) => {
      console.error(e);
      status("");
      toast("Could not build OSM layers: " + (e.message || e), true, 8000);
    });
    await intro;
  }
})();
