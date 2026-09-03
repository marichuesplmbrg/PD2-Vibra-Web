import React, { useState, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { Play, Pause, RotateCw, Radio } from "lucide-react";
import { vibraHistory } from "./vibraHistory";

/* Theme */
const C = {
  bg: "#0a0e1a", panel: "#141a2c", panelAlt: "#111627", card: "#171d30",
  border: "#242c43", borderSoft: "#1d2438",
  text: "#f3f5fb", textDim: "#8b93a8", textFaint: "#5d6479",
  orange: "#f6a24b", purple: "#9b7ff0", green: "#5cd6a0",
  hot: "#f2686e", dead: "#5aa9f6",
};
const GRAD = "linear-gradient(135deg, #f6a24b 0%, #9b7ff0 100%)";
const numish = (v) => v !== "" && v != null && !isNaN(parseFloat(v)) && isFinite(v);

// Where the prototype STL is served from. Put prototype.stl in your app's
// /public/models/ folder, or pass a `deviceUrl` prop to override.
const DEVICE_URL = "/models/prototype.stl";

/* ------------------------------------------------------------------ *
 * Minimal STL loader (binary + ASCII) -> BufferGeometry. Avoids the
 * STLLoader addon so it works anywhere plain three is available.
 * ------------------------------------------------------------------ */
function parseSTL(buffer) {
  if (buffer.byteLength < 84) return new THREE.BufferGeometry();
  const dv = new DataView(buffer);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 === buffer.byteLength) return parseBinarySTL(dv, n);
  return parseAsciiSTL(buffer);
}
function parseBinarySTL(dv, n) {
  const pos = new Float32Array(n * 9), nor = new Float32Array(n * 9);
  let off = 84;
  for (let i = 0; i < n; i++) {
    const nx = dv.getFloat32(off, true), ny = dv.getFloat32(off + 4, true), nz = dv.getFloat32(off + 8, true);
    off += 12;
    for (let v = 0; v < 3; v++) {
      const idx = (i * 3 + v) * 3;
      pos[idx] = dv.getFloat32(off, true); pos[idx + 1] = dv.getFloat32(off + 4, true); pos[idx + 2] = dv.getFloat32(off + 8, true);
      nor[idx] = nx; nor[idx + 1] = ny; nor[idx + 2] = nz;
      off += 12;
    }
    off += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return g;
}
function parseAsciiSTL(buffer) {
  const txt = new TextDecoder().decode(new Uint8Array(buffer));
  const verts = [];
  const re = /vertex\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)/g;
  let m; while ((m = re.exec(txt))) verts.push(+m[1], +m[2], +m[3]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return g;
}
// mm -> m, Z-up -> Y-up, centred on the floor at the room centre.
function prepareDevice(geo) {
  geo.rotateX(-Math.PI / 2);
  geo.scale(0.001, 0.001, 0.001);
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  return geo;
}

/* ------------------------------------------------------------------ *
 * Parse the deployed bundle into geometry the scene can draw.
 * - room: {w,l,h} in metres (from the Room/dimensions tab)
 * - rawPoints: [{x,z}] from an obstacle/points tab (x/y in mm -> m)
 * - spots: [{x,z,type:'hot'|'dead',value}] from a classification/reverb tab
 * Positions are centred on the room so everything lines up.
 * ------------------------------------------------------------------ */
function colIdx(cols, re) { return cols.findIndex((c) => re.test(c)); }

function parseDeployment(dep) {
  if (!dep) return null;
  const dims = dep.dims || {};
  const room = {
    w: numish(dims.width) ? +dims.width : null,
    l: numish(dims.length) ? +dims.length : null,
    h: numish(dims.height) ? +dims.height : null,
  };
  const tabs = dep.tabs || {};

  // --- raw points (obstacle / point cloud) ---
  let rawPoints = [];
  for (const [, t] of Object.entries(tabs)) {
    const cols = t.columns || [];
    const xi = colIdx(cols, /^x(_|$| )|x_mm|x_m\b/i);
    const yi = colIdx(cols, /^y(_|$| )|y_mm|y_m\b/i);
    if (xi >= 0 && yi >= 0 && !cols.some((c) => /class|label|type|spot|rt60|reverb/i.test(c))) {
      const mm = /mm/i.test(cols[xi]);
      rawPoints = (t.rows || [])
        .map((r) => ({ x: parseFloat(r[xi]), z: parseFloat(r[yi]) }))
        .filter((p) => numish(p.x) && numish(p.z))
        .map((p) => (mm ? { x: p.x / 1000, z: p.z / 1000 } : p));
      break;
    }
  }
  // obstacles are the room's walls -> fit them inside the width/length box
  if (room.w && room.l) fitInside(rawPoints, room.w, room.l, "fill", 0.98);
  else centre(rawPoints);

  // --- hot / dead spots (classification / reverberation) ---
  let spots = [];
  let sample = false;
  for (const [, t] of Object.entries(tabs)) {
    const cols = t.columns || [];
    const xi = colIdx(cols, /x/i), yi = colIdx(cols, /y/i);
    const classI = colIdx(cols, /class|label|type|status|spot/i);
    const metricI = colIdx(cols, /rt60|reverb|spl|level|db|energy|score/i);
    if (xi >= 0 && yi >= 0 && (classI >= 0 || metricI >= 0)) {
      const mm = /mm/i.test(cols[xi]);
      const rows = t.rows || [];
      const metricVals = metricI >= 0 ? rows.map((r) => parseFloat(r[metricI])).filter(numish) : [];
      const median = metricVals.length ? [...metricVals].sort((a, b) => a - b)[Math.floor(metricVals.length / 2)] : 0;
      spots = rows.map((r) => {
        let x = parseFloat(r[xi]), z = parseFloat(r[yi]);
        if (!numish(x) || !numish(z)) return null;
        if (mm) { x /= 1000; z /= 1000; }
        let type = "dead", value = null;
        if (classI >= 0) {
          const c = String(r[classI]).toLowerCase();
          type = /hot|high|live|bright/.test(c) ? "hot" : "dead";
        } else if (metricI >= 0) {
          value = parseFloat(r[metricI]);
          type = value >= median ? "hot" : "dead";
        }
        return { x, z, type, value };
      }).filter(Boolean);
      if (spots.length) break;
    }
  }
  // keep measurement spots comfortably inside the room footprint
  if (room.w && room.l) fitInside(spots, room.w, room.l, "contain", 0.8);
  else centre(spots);

  // Fallback so the concept is visible when the acoustic tabs don't carry
  // usable positions yet. Clearly flagged as sample data in the UI.
  if (!spots.length && room.w && room.l) {
    sample = true;
    const gx = 3, gz = 3;
    for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) {
      const x = (i / (gx - 1) - 0.5) * room.w * 0.7;
      const z = (j / (gz - 1) - 0.5) * room.l * 0.7;
      const corner = (i === 0 || i === gx - 1) && (j === 0 || j === gz - 1);
      spots.push({ x, z, type: corner ? "hot" : "dead", value: null });
    }
  }

  return { room, rawPoints, spots, sample, roomTs: dep.roomTs, at: dep.at };
}

function centre(pts) {
  if (!pts.length) return;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  pts.forEach((p) => { p.x -= cx; p.z -= cz; });
}

// Centre a point set on the room and scale it into the width/length footprint.
// mode "fill" stretches to the walls (obstacles); "contain" keeps aspect (spots).
function fitInside(pts, w, l, mode, inset = 0.95) {
  if (!pts.length) return;
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  pts.forEach((p) => { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); });
  const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
  const ex = Math.max((maxx - minx) / 2, 1e-6), ez = Math.max((maxz - minz) / 2, 1e-6);
  const tx = (w / 2) * inset, tz = (l / 2) * inset;
  let sx, sz;
  if (mode === "fill") { sx = tx / ex; sz = tz / ez; }
  else { const s = Math.min(tx / ex, tz / ez); sx = s; sz = s; }
  pts.forEach((p) => { p.x = (p.x - cx) * sx; p.z = (p.z - cz) * sz; });
}

/* ================================================================== */
export default function SimulationPage({ deviceUrl } = {}) {
  const [dep, setDep] = useState(() => vibraHistory.getDeployment());
  const [orbiting, setOrbiting] = useState(true);
  const [layers, setLayers] = useState({ shell: true, edges: true, raw: true, spots: true, omni: true, device: true });
  const [hover, setHover] = useState(null);
  const [deviceGeo, setDeviceGeo] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState("idle"); // idle|loading|ready|error
  const deviceHref = deviceUrl || DEVICE_URL;

  useEffect(() => vibraHistory.onDeploy(setDep), []);

  // load the prototype STL once
  useEffect(() => {
    let alive = true;
    setDeviceStatus("loading");
    fetch(deviceHref)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((buf) => { if (!alive) return; setDeviceGeo(prepareDevice(parseSTL(buf))); setDeviceStatus("ready"); })
      .catch((err) => { if (!alive) return; setDeviceStatus("error"); console.warn(`[VIBRA] Prototype STL not loaded from "${deviceHref}":`, err.message); });
    return () => { alive = false; };
  }, [deviceHref]);

  const model = useMemo(() => parseDeployment(dep), [dep]);

  const mountRef = useRef(null);
  const three = useRef(null);
  const spotsRef = useRef([]); // pickable spot meshes for hover
  const orbit = useRef({ theta: Math.PI * 0.28, phi: Math.PI * 0.34, radius: 12, target: new THREE.Vector3(0, 1, 0) });
  const autoRef = useRef(true);
  useEffect(() => { autoRef.current = orbiting; }, [orbiting]);

  /* init renderer once */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth || 600, h = mount.clientHeight || 400;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.cursor = "grab";

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dl = new THREE.DirectionalLight(0xffffff, 0.55); dl.position.set(6, 12, 8); scene.add(dl);

    const content = new THREE.Group();
    scene.add(content);
    three.current = { scene, camera, renderer, content, groups: {}, mount };

    const orb = orbit.current;
    const setCam = () => {
      const { theta, phi, radius, target } = orb;
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.cos(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.sin(theta)
      );
      camera.lookAt(target);
    };
    setCam();

    let raf;
    const loop = () => { if (autoRef.current) orb.theta += 0.0035; setCam(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();

    const onResize = () => { const W = mount.clientWidth, H = mount.clientHeight; if (!W || !H) return; camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H); };
    const ro = new ResizeObserver(onResize); ro.observe(mount);

    let dragging = false, lx = 0, ly = 0;
    const dom = renderer.domElement;
    const down = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; dom.style.cursor = "grabbing"; };
    const move = (e) => { if (!dragging) return; orb.theta -= (e.clientX - lx) * 0.008; orb.phi = Math.max(0.12, Math.min(Math.PI - 0.12, orb.phi - (e.clientY - ly) * 0.008)); lx = e.clientX; ly = e.clientY; setCam(); };
    const up = () => { dragging = false; dom.style.cursor = "grab"; };
    const wheel = (e) => { e.preventDefault(); orb.radius = Math.max(3, Math.min(45, orb.radius + Math.sign(e.deltaY) * 0.9)); setCam(); };
    dom.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    dom.addEventListener("wheel", wheel, { passive: false });

    // hover raycasting for spot info
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let lastKey = null;
    const hoverMove = (e) => {
      if (dragging) { if (lastKey !== null) { lastKey = null; setHover(null); } return; }
      const rect = dom.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(spotsRef.current, false);
      if (hits.length) {
        const o = hits[0].object;
        if (lastKey !== o.uuid) { lastKey = o.uuid; }
        setHover({ sx: e.clientX, sy: e.clientY, ...o.userData });
        dom.style.cursor = "pointer";
      } else if (lastKey !== null) { lastKey = null; setHover(null); dom.style.cursor = "grab"; }
    };
    const hoverLeave = () => { lastKey = null; setHover(null); };
    dom.addEventListener("pointermove", hoverMove);
    dom.addEventListener("pointerleave", hoverLeave);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      dom.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dom.removeEventListener("wheel", wheel);
      dom.removeEventListener("pointermove", hoverMove);
      dom.removeEventListener("pointerleave", hoverLeave);
      renderer.dispose();
      if (dom.parentNode === mount) mount.removeChild(dom);
      three.current = null;
    };
  }, []);

  /* (re)build scene contents when the model or layers change */
  useEffect(() => {
    const T = three.current;
    if (!T) return;
    const { content, groups } = T;
    // clear
    while (content.children.length) { const c = content.children.pop(); content.remove(c); disposeDeep(c); }
    Object.keys(groups).forEach((k) => delete groups[k]);
    if (!model || !model.room.w || !model.room.l) return;

    const { w, l } = model.room;
    const h = model.room.h || 2.6;

    // room shell (fit) — wire box + faint floor
    const shell = new THREE.Group();
    const box = new THREE.BoxGeometry(w, h, l);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x8a93c9, transparent: true, opacity: 0.55 }));
    edges.position.y = h / 2;
    shell.add(edges);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ color: 0x141b30, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001; shell.add(floor);
    content.add(shell); groups.shell = shell;

    // detected edges — footprint rectangle on the floor
    const rectPts = [
      new THREE.Vector3(-w / 2, 0.02, -l / 2), new THREE.Vector3(w / 2, 0.02, -l / 2),
      new THREE.Vector3(w / 2, 0.02, l / 2), new THREE.Vector3(-w / 2, 0.02, l / 2),
      new THREE.Vector3(-w / 2, 0.02, -l / 2),
    ];
    const rect = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rectPts), new THREE.LineBasicMaterial({ color: 0xf6a24b, transparent: true, opacity: 0.9 }));
    content.add(rect); groups.edges = rect;

    // raw points
    if (model.rawPoints.length) {
      const g = new THREE.BufferGeometry();
      const arr = new Float32Array(model.rawPoints.length * 3);
      model.rawPoints.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = 0.03; arr[i * 3 + 2] = p.z; });
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9b7ff0, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.85 }));
      content.add(pts); groups.raw = pts;
    }

    // hot / dead spots
    const pick = [];
    if (model.spots.length) {
      const spotGroup = new THREE.Group();
      const y = Math.min(1.2, h * 0.5);
      model.spots.forEach((s) => {
        const col = s.type === "hot" ? 0xf2686e : 0x5aa9f6;
        const info = { type: s.type, value: s.value, x: s.x, z: s.z };
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.4 }));
        core.position.set(s.x, y, s.z); core.userData = info;
        const halo = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16 }));
        halo.position.copy(core.position); halo.userData = info;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.02, s.z);
        spotGroup.add(core, halo, ring);
        pick.push(core, halo);
      });
      content.add(spotGroup); groups.spots = spotGroup;
    }
    spotsRef.current = pick;

    // omnidirectional sensor field — sound is detected equally in every direction
    {
      const omni = new THREE.Group();
      const y = Math.min(1.4, h * 0.45);
      const cyan = 0x62d0e0;
      // size the field to the room: the outer shell reaches close to the
      // nearest surface (wall / floor / ceiling) without spilling outside.
      const maxR = Math.max(0.4, Math.min(w / 2, l / 2, y, h - y) * 0.92);
      const nodeR = Math.max(0.1, Math.min(0.24, maxR * 0.12));
      const node = new THREE.Mesh(new THREE.SphereGeometry(nodeR, 20, 16), new THREE.MeshStandardMaterial({ color: cyan, emissive: cyan, emissiveIntensity: 0.7, roughness: 0.3 }));
      node.position.set(0, y, 0); omni.add(node);
      [0.42, 0.7, 1.0].forEach((f, i) => {
        const shell = new THREE.Mesh(new THREE.SphereGeometry(maxR * f, 24, 16), new THREE.MeshBasicMaterial({ color: cyan, wireframe: true, transparent: true, opacity: 0.2 - i * 0.045 }));
        shell.position.set(0, y, 0); omni.add(shell);
      });
      const stand = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, y, 0)]), new THREE.LineBasicMaterial({ color: cyan, transparent: true, opacity: 0.4 }));
      omni.add(stand);
      content.add(omni); groups.omni = omni;
    }

    // prototype device — fixed at the room centre on the floor
    if (deviceGeo) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xc2cae0, metalness: 0.25, roughness: 0.55 });
      const mesh = new THREE.Mesh(deviceGeo.clone(), mat);
      mesh.position.set(0, 0, 0);
      const g = new THREE.Group(); g.add(mesh);
      content.add(g); groups.device = g;
    }

    // frame the camera to the room
    const orb = orbit.current;
    orb.target.set(0, h / 2, 0);
    orb.radius = Math.max(w, l, h) * 1.7 + 3;

    applyLayers(groups, layers);
  }, [model, deviceGeo]);

  /* toggle layer visibility without rebuilding */
  useEffect(() => { if (three.current) applyLayers(three.current.groups, layers); }, [layers]);

  const toggle = (k) => setLayers((s) => ({ ...s, [k]: !s[k] }));
  const hasModel = model && model.room.w && model.room.l;
  const counts = useMemo(() => {
    if (!model) return { hot: 0, dead: 0 };
    return { hot: model.spots.filter((s) => s.type === "hot").length, dead: model.spots.filter((s) => s.type === "dead").length };
  }, [model]);

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", minHeight: "100%" }}>
      <main style={{ padding: "26px 34px 40px", maxWidth: 1240 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 4px", letterSpacing: -0.4 }}>Simulation</h1>
        <p style={{ color: C.textDim, margin: "0 0 20px", fontSize: 15 }}>
          {hasModel ? `Live scan · room shell + acoustic hot / dead spots${model.roomTs ? ` · ${model.roomTs}` : ""}` : "Deploy a room scan from the Parameters table to build the twin"}
        </p>

        <div style={{ display: "flex", gap: 22, alignItems: "stretch", flexWrap: "wrap" }}>
          {/* 3D box */}
          <section style={{ ...panel, flex: "1 1 620px", minWidth: 0, display: "flex", flexDirection: "column", height: "clamp(420px, calc(100dvh - 240px), 760px)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: `1px solid ${C.borderSoft}`, flexWrap: "wrap" }}>
              <div style={{ marginRight: "auto" }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Live scan</div>
                <div style={{ fontSize: 13, color: C.textDim }}>Combined twin</div>
              </div>
              {/* legend */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12.5, color: C.textDim }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Dot c={C.hot} /> Hotspot</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Dot c={C.dead} /> Deadspot</span>
              </div>
              {/* start / pause orbit */}
              <button style={{ ...btn, ...(orbiting ? {} : { background: GRAD, color: "#241706", borderColor: "transparent" }) }} onClick={() => setOrbiting((v) => !v)}>
                {orbiting ? <><Pause size={15} color={C.text} /> Pause</> : <><Play size={15} color="#241706" /> Start</>}
              </button>
            </div>

            <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
              <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
              {!hasModel && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: C.textDim, textAlign: "center", padding: 24 }}>
                  <Radio size={26} color={C.textFaint} />
                  <div style={{ fontSize: 15 }}>Nothing deployed yet.</div>
                  <div style={{ fontSize: 13.5 }}>Open the Parameters table, pick a room scan, and press <b style={{ color: C.text, fontWeight: 600 }}>Deploy to Simulation</b>.</div>
                </div>
              )}
              {hasModel && (
                <div style={{ position: "absolute", right: 14, bottom: 12, fontSize: 12, color: C.textFaint }}>drag to orbit · scroll to zoom</div>
              )}
            </div>
          </section>

          {/* Layers */}
          <section style={{ ...panel, flex: "1 1 300px", minWidth: 260 }}>
            <div style={{ padding: "16px 18px 8px" }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Layers</div>
              <div style={{ fontSize: 13, color: C.textDim }}>Toggle what's drawn</div>
            </div>
            <div style={{ padding: "6px 12px 12px" }}>
              <LayerRow color={0x8a93c9} label="Room shell (fit)" on={layers.shell} onClick={() => toggle("shell")} disabled={!hasModel} />
              <LayerRow color={0xf6a24b} label="Detected edges" on={layers.edges} onClick={() => toggle("edges")} disabled={!hasModel} />
              <LayerRow color={0x9b7ff0} label={`Raw points${model?.rawPoints?.length ? ` (${model.rawPoints.length})` : ""}`} on={layers.raw} onClick={() => toggle("raw")} disabled={!hasModel || !model?.rawPoints?.length} />
              <LayerRow color={0xf2686e} label={`Hot / dead spots${model?.spots?.length ? ` (${counts.hot}/${counts.dead})` : ""}`} on={layers.spots} onClick={() => toggle("spots")} disabled={!hasModel || !model?.spots?.length} />
              <LayerRow color={0x62d0e0} label="Omnidirectional sensor" on={layers.omni} onClick={() => toggle("omni")} disabled={!hasModel} />
              <LayerRow color={0xc2cae0}
                label={deviceStatus === "error" ? "Prototype — file not found" : deviceStatus === "loading" ? "Prototype — loading…" : "Prototype (device)"}
                on={layers.device} onClick={() => toggle("device")} disabled={!hasModel || !deviceGeo} />
            </div>
            <div style={{ padding: "8px 18px 18px", fontSize: 13, color: C.textDim, lineHeight: 1.55, borderTop: `1px solid ${C.borderSoft}` }}>
              The raw points and detected edges sit inside the clean rectangle shell, so you can see how closely the fit matches the real walls. Red marks reverberant hotspots, blue marks dead spots, and the cyan node shows the omnidirectional sensor that reads sound equally in every direction. Hover a spot for its details.
              {model?.sample && (
                <div style={{ marginTop: 10, color: C.orange, fontSize: 12.5 }}>
                  Showing sample spot positions — the deployed acoustic tab didn't include per-point coordinates. Add x/y columns (and a class or RT60 metric) to plot real spots.
                </div>
              )}
              {deviceStatus === "error" && (
                <div style={{ marginTop: 10, color: C.orange, fontSize: 12.5 }}>
                  Couldn't load the prototype from “{deviceHref}”. Put <b style={{ color: C.text }}>prototype.stl</b> where that path resolves (e.g. <b style={{ color: C.text }}>public/models/</b>), or pass a <b style={{ color: C.text }}>deviceUrl</b> prop.
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {hover && (
        <div style={{ position: "fixed", left: hover.sx + 14, top: hover.sy + 14, zIndex: 80, pointerEvents: "none", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", boxShadow: "0 12px 34px rgba(0,0,0,.55)", fontSize: 12.5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, color: hover.type === "hot" ? C.hot : C.dead }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: hover.type === "hot" ? C.hot : C.dead }} />
            {hover.type === "hot" ? "Hotspot" : "Deadspot"}
          </div>
          {hover.value != null && numish(hover.value) && (
            <div style={{ color: C.textDim, marginTop: 4 }}>Level {Number(hover.value).toLocaleString(undefined, { maximumFractionDigits: 3 })}</div>
          )}
          <div style={{ color: C.textFaint, marginTop: 4 }}>x {hover.x.toFixed(2)} m · z {hover.z.toFixed(2)} m</div>
        </div>
      )}
    </div>
  );
}

/* ---- small bits ---- */
function Dot({ c }) { return <span style={{ width: 10, height: 10, borderRadius: 999, background: c, boxShadow: `0 0 8px ${c}` }} />; }
function LayerRow({ color, label, on, onClick, disabled }) {
  const hex = "#" + color.toString(16).padStart(6, "0");
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "9px 8px", border: "none", background: "transparent", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, textAlign: "left" }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, background: on ? GRAD : "transparent", border: on ? "none" : `1.5px solid ${C.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#241706" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
      </span>
      <span style={{ width: 9, height: 9, borderRadius: 999, background: hex, flexShrink: 0 }} />
      <span style={{ fontSize: 14, color: C.text }}>{label}</span>
    </button>
  );
}

function applyLayers(groups, layers) {
  if (!groups) return;
  if (groups.shell) groups.shell.visible = layers.shell;
  if (groups.edges) groups.edges.visible = layers.edges;
  if (groups.raw) groups.raw.visible = layers.raw;
  if (groups.spots) groups.spots.visible = layers.spots;
  if (groups.omni) groups.omni.visible = layers.omni;
  if (groups.device) groups.device.visible = layers.device;
}
function disposeDeep(obj) {
  obj.traverse?.((c) => {
    if (c.geometry) c.geometry.dispose?.();
    if (c.material) { Array.isArray(c.material) ? c.material.forEach((m) => m.dispose?.()) : c.material.dispose?.(); }
  });
  if (obj.geometry) obj.geometry.dispose?.();
  if (obj.material) { Array.isArray(obj.material) ? obj.material.forEach((m) => m.dispose?.()) : obj.material.dispose?.(); }
}

const panel = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" };
const btn = { display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13.5, fontWeight: 600, cursor: "pointer" };