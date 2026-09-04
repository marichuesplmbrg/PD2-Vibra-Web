import React, { useState, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { Play, Pause, RotateCw, Radio, Target, TrendingDown, TrendingUp, CheckCircle2, Volume2 } from "lucide-react";
import { vibraHistory } from "./vibraHistory";
import { PROTOTYPE_STL_BASE64 } from "./prototypeModel";

/* Colors come from styles.css tokens (config.js overrides at runtime). This
   reads them so the WebGL materials match the CSS. */
const cssVar = (n, fb) => { try { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || fb; } catch { return fb; } };
const numish = (v) => v !== "" && v != null && !isNaN(parseFloat(v)) && isFinite(v);

// Target RT60 band (seconds). Adjust to your standard / room type.
const RT60_TARGET = { low: 0.4, high: 0.6 };

// Billboarded text pill sprite (always faces camera, drawn on top).
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function makeLabel(text, { fg = "#e9eaf0", worldH = 0.34 } = {}) {
  const fontPx = 46, padX = 22, padY = 14;
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `600 ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const tw = Math.ceil(meas.measureText(text).width);
  const w = tw + padX * 2, h = fontPx + padY * 2;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.font = `600 ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.fillStyle = "rgba(23,26,36,0.92)"; roundRect(ctx, 0, 0, w, h, h / 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 2; roundRect(ctx, 1, 1, w - 2, h - 2, (h - 2) / 2); ctx.stroke();
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(text, padX, h / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  const scale = worldH / h;
  sp.scale.set(w * scale, h * scale, 1);
  sp.renderOrder = 20;
  return sp;
}


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
  const pos = new Float32Array(n * 9);
  let off = 84;
  for (let i = 0; i < n; i++) {
    off += 12; // skip stored face normal (binary STLs often write zeros here)
    for (let v = 0; v < 3; v++) {
      const idx = (i * 3 + v) * 3;
      pos[idx] = dv.getFloat32(off, true); pos[idx + 1] = dv.getFloat32(off + 4, true); pos[idx + 2] = dv.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals(); // derive clean normals so the mesh isn't shaded flat-black
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

// Decode a base64 string to an ArrayBuffer (for the embedded fallback model).
function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// Parse a buffer into a prepared device geometry, but reject anything that
// is not really an STL (e.g. an index.html SPA-fallback served with HTTP 200,
// which would otherwise parse to an empty, invisible mesh).
function safeParseDevice(buf) {
  try {
    const head = new Uint8Array(buf.slice(0, 6));
    let txt = "";
    for (let i = 0; i < head.length; i++) txt += String.fromCharCode(head[i]);
    txt = txt.toLowerCase();
    if (txt.startsWith("<!doc") || txt.startsWith("<html") || txt.startsWith("<?xml")) return null;
    const geo = prepareDevice(parseSTL(buf));
    const pos = geo.getAttribute("position");
    return pos && pos.count > 0 ? geo : null;
  } catch {
    return null;
  }
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

  // average RT60 from a reverberation-style tab, if present
  let rt60 = null;
  for (const [, t] of Object.entries(tabs)) {
    const cols = t.columns || [];
    const ri = colIdx(cols, /rt60/i);
    if (ri >= 0 && (t.rows || []).length) {
      const vals = t.rows.map((r) => parseFloat(r[ri])).filter(numish);
      if (vals.length) { rt60 = vals.reduce((a, b) => a + b, 0) / vals.length; break; }
    }
  }

  return { room, rawPoints, spots, rt60, roomTs: dep.roomTs, at: dep.at };
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
export default function SimulationPage({ deviceUrl, twinOnly = false } = {}) {
  const [dep, setDep] = useState(() => vibraHistory.getDeployment());
  const [orbiting, setOrbiting] = useState(true);
  const [layers, setLayers] = useState({ shell: true, edges: true, raw: true, spots: true, omni: true, device: true });
  const [hover, setHover] = useState(null);
  const [deviceGeo, setDeviceGeo] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState("idle"); // idle|loading|ready|error
  const deviceHref = deviceUrl || DEVICE_URL;

  useEffect(() => vibraHistory.onDeploy(setDep), []);

  // Load the prototype model. Try to fetch a served STL first (so you can swap
  // the file without a rebuild); if none is reachable — or the server returns an
  // HTML SPA-fallback with 200 — fall back to the model bundled with the app so
  // the device always renders.
  useEffect(() => {
    let alive = true;
    setDeviceStatus("loading");
    const candidates = [deviceHref, "/models/prototype.stl", "/models/Protoype-stripped.stl", "/prototype.stl"]
      .filter((u, i, a) => u && a.indexOf(u) === i);
    (async () => {
      const tried = [];
      for (const url of candidates) {
        try {
          const r = await fetch(url);
          if (!r.ok) { tried.push(`${url} (HTTP ${r.status})`); continue; }
          const ct = r.headers.get("content-type") || "";
          if (/text\/html/i.test(ct)) { tried.push(`${url} (server returned HTML, not a model)`); continue; }
          const geo = safeParseDevice(await r.arrayBuffer());
          if (!geo) { tried.push(`${url} (not a valid STL)`); continue; }
          if (!alive) return;
          setDeviceGeo(geo); setDeviceStatus("ready"); return;
        } catch (err) { tried.push(`${url} (${err.message})`); }
      }
      // fall back to the embedded model
      try {
        const geo = safeParseDevice(b64ToArrayBuffer(PROTOTYPE_STL_BASE64));
        if (geo) {
          if (!alive) return;
          setDeviceGeo(geo); setDeviceStatus("ready");
          if (tried.length) console.info("[VIBRA] Using embedded prototype model (no served STL found). Tried:\n  " + tried.join("\n  "));
          return;
        }
        tried.push("embedded model (empty)");
      } catch (err) { tried.push(`embedded model (${err.message})`); }
      if (!alive) return;
      setDeviceStatus("error");
      console.warn("[VIBRA] Prototype model not loaded. Tried:\n  " + tried.join("\n  "));
    })();
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
    const COL = { edge: cssVar("--orange", "#f6a15c"), raw: cssVar("--violet", "#a98bf5"), hot: cssVar("--bad", "#ff5b52"), dead: cssVar("--sim-dead", "#5b9dff"), cyan: cssVar("--cyan", "#62d0e0"), device: cssVar("--device", "#c2cae0") };

    // room shell (fit) — wire box + faint floor
    const shell = new THREE.Group();
    const box = new THREE.BoxGeometry(w, h, l);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x8a93c9, transparent: true, opacity: 0.55 }));
    edges.position.y = h / 2;
    shell.add(edges);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ color: 0x141b30, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001; shell.add(floor);

    // full-floor grid — large 1 m cells, effectively limitless: the extent sits
    // far beyond the camera's max zoom, so no edge is ever visible.
    {
      const step = 1;         // larger cells
      const gridSize = 400;   // well past any reachable camera distance -> looks endless
      const divisions = gridSize / step;
      const gc = new THREE.Color(cssVar("--grid", "#3a4570"));
      const grid = new THREE.GridHelper(gridSize, divisions, gc, gc);
      grid.position.y = 0.005;
      grid.material.transparent = true;
      grid.material.opacity = 0.3;
      content.add(grid); // added to the scene (not the shell layer) so it always covers the floor
    }

    const f2 = (n) => Number(n).toFixed(2);
    const addLabel = (sp, x, y, z) => { sp.position.set(x, y, z); shell.add(sp); };

    // ---- dimension rulers (width / length / height) ----
    // Text tier is a bit smaller than the cardinal directions below.
    const dimStyle = { fg: "#dfe3ef", worldH: 0.26 };
    const rulerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar("--ruler", "#aeb6d6")), transparent: true, opacity: 0.9 });
    const seg = (ax, ay, az, bx, by, bz) =>
      shell.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]), rulerMat));
    const rOff = Math.max(0.28, Math.max(w, l) * 0.08); // how far rulers sit outside the room
    const tick = Math.max(0.06, Math.min(w, l) * 0.06); // end-cap length
    const y0 = 0.02;

    // Width — along X, in front of the room (+Z side)
    {
      const z = l / 2 + rOff;
      seg(-w / 2, y0, l / 2, -w / 2, y0, z); // witness lines
      seg(w / 2, y0, l / 2, w / 2, y0, z);
      seg(-w / 2, y0, z, w / 2, y0, z);       // dimension line
      seg(-w / 2, y0, z - tick, -w / 2, y0, z + tick); // end ticks
      seg(w / 2, y0, z - tick, w / 2, y0, z + tick);
      addLabel(makeLabel(`Width ${f2(w)} m`, dimStyle), 0, y0, z + tick + 0.14);
    }
    // Length — along Z, on the right of the room (+X side)
    {
      const x = w / 2 + rOff;
      seg(w / 2, y0, -l / 2, x, y0, -l / 2);
      seg(w / 2, y0, l / 2, x, y0, l / 2);
      seg(x, y0, -l / 2, x, y0, l / 2);
      seg(x - tick, y0, -l / 2, x + tick, y0, -l / 2);
      seg(x - tick, y0, l / 2, x + tick, y0, l / 2);
      addLabel(makeLabel(`Length ${f2(l)} m`, dimStyle), x + tick + 0.14, y0, 0);
    }
    // Height — vertical, at the back-left corner
    {
      const x = -w / 2 - rOff, z = -l / 2 - rOff;
      seg(-w / 2, 0, -l / 2, x, 0, z);        // witness at floor
      seg(-w / 2, h, -l / 2, x, h, z);        // witness at ceiling
      seg(x, 0, z, x, h, z);                   // dimension line
      seg(x - tick, 0, z, x + tick, 0, z);     // end ticks
      seg(x - tick, h, z, x + tick, h, z);
      addLabel(makeLabel(`Height ${f2(h)} m`, dimStyle), x - tick - 0.16, h / 2, z);
    }

    // ---- cardinal directions — bigger, and set farther out from the room ----
    const cardStyle = { fg: "#eef1fa", worldH: 0.38 };
    const cOff = Math.max(1.5, Math.max(w, l) * 0.35);
    const cy = 0.05;
    addLabel(makeLabel("N 0°", cardStyle), 0, cy, -l / 2 - cOff);
    addLabel(makeLabel("E 90°", cardStyle), w / 2 + cOff, cy, 0);
    addLabel(makeLabel("S 180°", cardStyle), 0, cy, l / 2 + cOff);
    addLabel(makeLabel("W 270°", cardStyle), -w / 2 - cOff, cy, 0);

    content.add(shell); groups.shell = shell;

    // detected edges — footprint rectangle on the floor
    const rectPts = [
      new THREE.Vector3(-w / 2, 0.02, -l / 2), new THREE.Vector3(w / 2, 0.02, -l / 2),
      new THREE.Vector3(w / 2, 0.02, l / 2), new THREE.Vector3(-w / 2, 0.02, l / 2),
      new THREE.Vector3(-w / 2, 0.02, -l / 2),
    ];
    const rect = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rectPts), new THREE.LineBasicMaterial({ color: COL.edge, transparent: true, opacity: 0.9 }));
    content.add(rect); groups.edges = rect;

    // raw points
    if (model.rawPoints.length) {
      const g = new THREE.BufferGeometry();
      const arr = new Float32Array(model.rawPoints.length * 3);
      model.rawPoints.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = 0.03; arr[i * 3 + 2] = p.z; });
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: COL.raw, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.85 }));
      content.add(pts); groups.raw = pts;
    }

    // hot / dead spots
    const pick = [];
    if (model.spots.length) {
      const spotGroup = new THREE.Group();
      const y = Math.min(1.2, h * 0.5);
      model.spots.forEach((s) => {
        const col = s.type === "hot" ? COL.hot : COL.dead;
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

    // omnidirectional sensor field — sound is detected equally in every direction.
    // The field is centred in the room and scaled to its physical dimensions: the
    // outer shell reaches close to the nearest surface (wall / floor / ceiling).
    {
      const omni = new THREE.Group();
      const cyan = COL.cyan;
      const y = h / 2;                                   // centre of the room height
      const maxR = Math.min(w / 2, l / 2, h / 2) * 0.95; // limited by the nearest surface
      const nodeR = Math.max(0.05, maxR * 0.12);
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
      const geo = deviceGeo.clone();
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const devH = (bb.max.y - bb.min.y) || 1;         // model height in metres
      const devFoot = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1;
      // scale so the prototype stands exactly 1.60 m tall (uniform, keeps shape)
      const DEVICE_HEIGHT_M = 1.6;
      const s = DEVICE_HEIGHT_M / devH;
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: COL.device, metalness: 0.25, roughness: 0.5,
        emissive: new THREE.Color(COL.device), emissiveIntensity: 0.2,
        side: THREE.DoubleSide, // show even if the STL's triangle winding is inconsistent
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(s);
      // floor marker ring so the device's location always reads
      const rr = devFoot * s * 0.65;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(rr * 0.88, rr, 40),
        new THREE.MeshBasicMaterial({ color: COL.device, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
      g.add(mesh, ring);
      g.position.set(0, 0, 0);
      content.add(g); groups.device = g;
    }

    // frame the camera so the room fills the view (does NOT change room size —
    // only the camera distance). Based on the room's bounding sphere + the FOV.
    const orb = orbit.current;
    orb.target.set(0, h / 2, 0);
    const fov = ((T.camera && T.camera.fov) || 46) * Math.PI / 180;
    const sphere = Math.hypot(w, h, l) / 2;        // room bounding-sphere radius
    orb.radius = (sphere / Math.tan(fov / 2)) * 1.25; // 1.25 = small margin for labels

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

  /* canvas-only mode (embedded in the Dashboard's Room twin) — the SAME live
     scene, without the page header / layers panel / recommendations. */
  if (twinOnly) {
    return (
      <div className="sim-mount" style={{ position: "absolute", inset: 0 }}>
        <div ref={mountRef} className="sim-holder" />
        {!hasModel && (
          <div className="sim-empty">
            <Radio size={26} color="var(--faint)" />
            <div className="big">Nothing deployed yet.</div>
            <div className="small">Deploy a room scan from the Parameters table.</div>
          </div>
        )}
        {hasModel && <div className="sim-hint2">drag to orbit · scroll to zoom</div>}
        {hover && (
          <div className="sim-tip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
            <div className={`hd ${hover.type === "hot" ? "hot" : "dead"}`}>
              <span className={`sd ${hover.type === "hot" ? "hot" : "dead"}`} />
              {hover.type === "hot" ? "Hotspot" : "Deadspot"}
            </div>
            {hover.value != null && numish(hover.value) && <div className="ln">Level {Number(hover.value).toLocaleString(undefined, { maximumFractionDigits: 3 })}</div>}
            <div className="ln faint">x {hover.x.toFixed(2)} m · z {hover.z.toFixed(2)} m</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="vwrap">
      <div className="vhead">
        <h1>Simulation</h1>
        <p className="sub">{hasModel ? `Live scan${model.roomTs ? ` · ${model.roomTs}` : ""}` : "Deploy a room scan to build the twin"}</p>
      </div>

      <div className="sim-boxes">
        {/* 3D box */}
        <section className="sim-livebox">
          <div className="sim-boxhead">
            <div className="h"><div className="t">Live scan</div><div className="s">Combined twin</div></div>
            <div className="sim-legend">
              <span className="hstack"><span className="sd hot" /> Hotspot</span>
              <span className="hstack"><span className="sd dead" /> Deadspot</span>
            </div>
            <button className={`btn${orbiting ? "" : " btn--primary"}`} onClick={() => setOrbiting((v) => !v)}>
              {orbiting ? <><Pause size={15} color="var(--ink)" /> Pause</> : <><Play size={15} color="#17131f" /> Start</>}
            </button>
          </div>
          <div className="sim-mount">
            <div ref={mountRef} className="sim-holder" />
            {!hasModel && (
              <div className="sim-empty">
                <Radio size={26} color="var(--faint)" />
                <div className="big">Nothing deployed yet.</div>
                <div className="small">Open the Parameters table, pick a room scan, and press <b className="ink">Deploy to Simulation</b>.</div>
              </div>
            )}
            {hasModel && <div className="sim-hint2">drag to orbit · scroll to zoom</div>}
          </div>
        </section>

        {/* Layers */}
        <section className="sim-layerbox">
          <div className="layers-head"><div className="t">Layers</div><div className="s">Toggle what's drawn</div></div>
          <div className="layers-body thin-scroll">
            <LayerRow tone="shell" label="Room shell (fit)" on={layers.shell} onClick={() => toggle("shell")} disabled={!hasModel} />
            <LayerRow tone="edge" label="Detected edges" on={layers.edges} onClick={() => toggle("edges")} disabled={!hasModel} />
            <LayerRow tone="raw" label={`Raw points${model?.rawPoints?.length ? ` (${model.rawPoints.length})` : ""}`} on={layers.raw} onClick={() => toggle("raw")} disabled={!hasModel || !model?.rawPoints?.length} />
            <LayerRow tone="hot" label={`Hot / dead spots${model?.spots?.length ? ` (${counts.hot}/${counts.dead})` : ""}`} on={layers.spots} onClick={() => toggle("spots")} disabled={!hasModel || !model?.spots?.length} />
            <LayerRow tone="cyan" label="Omnidirectional sensor" on={layers.omni} onClick={() => toggle("omni")} disabled={!hasModel} />
            <LayerRow tone="device"
              label={deviceStatus === "error" ? "Prototype — file not found" : deviceStatus === "loading" ? "Prototype — loading…" : "Prototype (device)"}
              on={layers.device} onClick={() => toggle("device")} disabled={!hasModel || !deviceGeo} />
          </div>
          <div className="layer-note">
            Red marks hotspots, blue marks deadspots — hover a spot for details.
            {hasModel && (!model?.spots?.length) && <div className="warn">No spots — the deployed acoustic scan needs x/y columns and a class or RT60 metric.</div>}
            {deviceStatus === "error" && <div className="warn">Prototype not found at “{deviceHref}”.</div>}
          </div>
        </section>
      </div>

      {/* Recommendations */}
      <Recommendations model={model} hasModel={hasModel} counts={counts} />

      {hover && (
        <div className="sim-tip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
          <div className={`hd ${hover.type === "hot" ? "hot" : "dead"}`}>
            <span className={`sd ${hover.type === "hot" ? "hot" : "dead"}`} />
            {hover.type === "hot" ? "Hotspot" : "Deadspot"}
          </div>
          {hover.value != null && numish(hover.value) && <div className="ln">Level {Number(hover.value).toLocaleString(undefined, { maximumFractionDigits: 3 })}</div>}
          <div className="ln faint">x {hover.x.toFixed(2)} m · z {hover.z.toFixed(2)} m</div>
        </div>
      )}
    </div>
  );
}

/* ---- recommendations ---- */
function buildRecs(model, counts) {
  const recs = [];
  const rt = model.rt60;
  if (numish(rt)) {
    if (rt > RT60_TARGET.high) {
      recs.push({ icon: TrendingDown, tone: "var(--bad)", title: "Reduce reverberation",
        body: `RT60 is ${rt.toFixed(2)} s, above the ${RT60_TARGET.low}–${RT60_TARGET.high} s target. Add absorption — acoustic panels on reflective walls, heavy curtains, or carpet — to bring it down.` });
    } else if (rt < RT60_TARGET.low) {
      recs.push({ icon: TrendingUp, tone: "var(--sim-dead)", title: "Room is over-damped",
        body: `RT60 is ${rt.toFixed(2)} s, below the ${RT60_TARGET.low}–${RT60_TARGET.high} s target. Remove some absorption or add diffusion to restore liveliness.` });
    } else {
      recs.push({ icon: CheckCircle2, tone: "var(--ok)", title: "RT60 within target",
        body: `RT60 is ${rt.toFixed(2)} s, inside the ${RT60_TARGET.low}–${RT60_TARGET.high} s band. Maintain the current treatment.` });
    }
  }
  if (counts.hot > 0) recs.push({ icon: Volume2, tone: "var(--bad)", title: `Treat ${counts.hot} hotspot${counts.hot > 1 ? "s" : ""}`,
    body: "Reverberant hotspots build up sound energy. Place absorptive material at these locations and on the nearest hard surfaces." });
  if (counts.dead > 0) recs.push({ icon: Radio, tone: "var(--sim-dead)", title: `Address ${counts.dead} deadspot${counts.dead > 1 ? "s" : ""}`,
    body: "Dead spots lose coverage. Add a diffuser or reposition a source/speaker so sound reaches these areas more evenly." });
  if (!recs.length) recs.push({ icon: CheckCircle2, tone: "var(--ok)", title: "No issues detected",
    body: "The current scan doesn't flag any hotspots or reverberation problems." });
  return recs;
}

function Recommendations({ model, hasModel, counts }) {
  return (
    <section className="rec">
      <div className="rec-head">
        <span className="ic"><Target size={16} color="var(--orange)" /></span>
        <div><div className="t">Recommendations</div><div className="s">Treatment plan to bring RT60 into target</div></div>
      </div>
      {!hasModel ? (
        <div className="rec-empty">Deploy a room scan to generate recommendations.</div>
      ) : (
        <div className="rec-grid">
          {buildRecs(model, counts).map((r, i) => {
            const Icon = r.icon;
            return (
              <div key={i} className="rec-cell">
                <span className="ic"><Icon size={16} color={r.tone} /></span>
                <div><div className="t">{r.title}</div><div className="n">{r.body}</div></div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---- small bits ---- */
function LayerRow({ tone, label, on, onClick, disabled }) {
  return (
    <label className={`layer-row${disabled ? " disabled" : ""}`}>
      <input type="checkbox" checked={!!on} onChange={onClick} disabled={disabled} />
      <span className="layer-box"><svg viewBox="0 0 24 24" fill="none" stroke="#17131f" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
      <span className={`layer-dot ${tone}`} />
      <span className="layer-name">{label}</span>
    </label>
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