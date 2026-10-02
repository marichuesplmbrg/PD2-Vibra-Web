import React, { useState, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { Play, Pause, RotateCw, Radio, Target, Volume2, AlertCircle, AlertTriangle } from "lucide-react";
import { vibraHistory } from "./vibraHistory";

/* Colors come from styles.css tokens (config.js overrides at runtime). This
   reads them so the WebGL materials match the CSS. */
const cssVar = (n, fb) => { try { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || fb; } catch { return fb; } };
const numish = (v) => v !== "" && v != null && !isNaN(parseFloat(v)) && isFinite(v);

// Target RT60 band (seconds): the recording-studio band VIBRA uses as its
// neutral reference, the same band the classification is judged against.
const RT60_TARGET = { low: 0.2, high: 0.4 };

// Billboarded text pill sprite (always faces camera, drawn on top).
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// `accent` tints the pill's border/background so a label group (cardinals vs
// dimensions) reads as one family at a glance.
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [233, 234, 240];
}
function makeLabel(text, { fg = "#e9eaf0", worldH = 0.34, accent = null } = {}) {
  const fontPx = 46, padX = 22, padY = 14;
  const meas = document.createElement("canvas").getContext("2d");
  meas.font = `600 ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const tw = Math.ceil(meas.measureText(text).width);
  const w = tw + padX * 2, h = fontPx + padY * 2;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.font = `600 ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const [ar, ag, ab] = hexToRgb(accent || fg);
  ctx.fillStyle = accent ? `rgba(${Math.round(ar * 0.22)},${Math.round(ag * 0.22)},${Math.round(ab * 0.22)},0.94)` : "rgba(23,26,36,0.92)";
  roundRect(ctx, 0, 0, w, h, h / 2); ctx.fill();
  ctx.strokeStyle = accent ? `rgba(${ar},${ag},${ab},0.85)` : "rgba(255,255,255,0.10)";
  ctx.lineWidth = accent ? 3 : 2;
  roundRect(ctx, 1.5, 1.5, w - 3, h - 3, (h - 3) / 2); ctx.stroke();
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(text, padX, h / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  const scale = worldH / h;
  sp.scale.set(w * scale, h * scale, 1);
  sp.renderOrder = 20;
  return sp;
}


/* Compass badge for the cardinal directions — deliberately NOT a pill, so it
   never reads as one of the dimension labels. A round disc with a big bold
   letter and the bearing underneath. North is filled solid (the reference
   direction the sweep is measured from); E / S / W are outlined. */
function makeCompassBadge(letter, deg, { worldH = 0.5, accent = "#ffd166", primary = false } = {}) {
  const D = 132, ring = 6;
  const cv = document.createElement("canvas"); cv.width = D; cv.height = D;
  const ctx = cv.getContext("2d");
  const [ar, ag, ab] = hexToRgb(accent);
  const c = D / 2;
  ctx.beginPath(); ctx.arc(c, c, c - ring / 2, 0, Math.PI * 2);
  ctx.fillStyle = primary ? `rgba(${ar},${ag},${ab},0.96)` : "rgba(14,16,22,0.88)";
  ctx.fill();
  ctx.lineWidth = ring;
  ctx.strokeStyle = `rgba(${ar},${ag},${ab},${primary ? 1 : 0.9})`;
  ctx.stroke();
  const ink = primary ? "#17131f" : `rgb(${ar},${ag},${ab})`;
  ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "800 62px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(letter, c, c - 10);
  ctx.font = "700 24px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.globalAlpha = primary ? 0.8 : 0.75;
  ctx.fillText(`${deg}°`, c, c + 34);
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(worldH, worldH, 1);
  sp.renderOrder = 21;
  return sp;
}


/* ------------------------------------------------------------------ *
 * Sound heatmap
 * ------------------------------------------------------------------
 * Replaces the per-reading spheres. Each classified reading carries a
 * RT60 in seconds (see heatRt) and the field between readings is
 * a Gaussian-kernel weighted average of the nearby scores (Nadaraya-
 * Watson kernel smoothing), a standard way to turn scattered point
 * measurements into a continuous map. Sigma follows the reading spacing.
 *
 *   - Cartesian readings (X/Y): distance is metres on the floor.
 *   - Bearing-only readings: a bearing is a DIRECTION, not a position,
 *     so the field is interpolated by angle around the room centre (a
 *     polar projection). Every point on the floor/walls takes the value
 *     of the directions near it, and the colour fades out toward the
 *     centre, where all directions meet and nothing was measured.
 *
 * Confidence: colour only appears where a reading is actually near
 * (Gaussian falloff, sigma tied to the reading spacing). Areas far
 * from every measurement stay clear instead of showing invented values.
 * ------------------------------------------------------------------ */
/* Colour follows the measured RT60 on one continuous scale, not the label.
   Each reading contributes its RT60 in seconds; the field between readings
   is the kernel-weighted average of those seconds, and every pixel is then
   coloured from HEAT_STOPS:
       < 0.2 s          blue    deadspot (deeper blue the lower it goes)
       0.2 – 0.4 s      green   target band (RT60_TARGET)
       0.4 – 0.6 s      orange
       0.6 – 0.8 s      yellow
       >= 0.8 s         red
   Neighbouring stops blend, so the map reads as a gradient rather than
   hard bands. A reading with no RT60 value falls back to a representative
   value for its label so it still shows in the right colour family. */
const RT60_LO = RT60_TARGET.low, RT60_HI = RT60_TARGET.high; // classifier thresholds (s)
const HEAT_FALLBACK_RT = { hot: 0.6, dead: 0.1, neutral: 0.3 };
const HEAT_STOPS = [
  [0.05, "#2446c8"], // deep blue — strong deadspot
  [0.17, "#5b9dff"], // blue — deadspot
  [0.23, "#34d17a"], // green — target band starts
  [0.37, "#34d17a"], // green — target band ends
  [0.45, "#ff9a3c"], // orange
  [0.62, "#ffd84a"], // yellow
  [0.80, "#ff4b4b"], // red — full-strength hotspot
];
// Colour key shown under the Layers checklist. Swatches use the same hex
// values as HEAT_STOPS; change both together.
const HEAT_LEGEND = [
  { color: "#5b9dff", label: "Deadspot", range: "< 0.2 s" },
  { color: "#34d17a", label: "Target (neutral)", range: "0.2 – 0.4 s" },
  { color: "#ff9a3c", label: "Hotspot · mild", range: "0.4 – 0.6 s" },
  { color: "#ffd84a", label: "Hotspot · strong", range: "0.6 – 0.8 s" },
  { color: "#ff4b4b", label: "Hotspot · severe", range: "≥ 0.8 s" },
];
const HEAT_STOPS_RGB = HEAT_STOPS.map(([t, hx]) => [t, hexToRgb(hx.slice(1))]);
function heatRt(s) {
  const rt = s.value != null && Number.isFinite(Number(s.value)) ? Number(s.value) : null;
  return rt != null ? rt : (HEAT_FALLBACK_RT[s.type] ?? HEAT_FALLBACK_RT.neutral);
}
function rtToRgb(rt) {
  const S = HEAT_STOPS_RGB;
  if (!(rt > S[0][0])) return S[0][1];
  for (let i = 1; i < S.length; i++) {
    if (rt <= S[i][0]) {
      const [t0, c0] = S[i - 1], [t1, c1] = S[i];
      const k = (rt - t0) / (t1 - t0);
      return [0, 1, 2].map((c) => c0[c] + (c1[c] - c0[c]) * k);
    }
  }
  return S[S.length - 1][1];
}
const rtToCss = (rt) => `rgb(${rtToRgb(rt).map(Math.round).join(",")})`;
// CSS gradient built from the same stops as the map, for a bar whose left
// edge is `min` seconds and right edge `max` seconds (legend, echo gauge).
const heatGradient = (min, max) => `linear-gradient(90deg, ${HEAT_STOPS.map(([t, hx]) =>
  `${hx} ${(((t - min) / (max - min)) * 100).toFixed(1)}%`).join(", ")})`;
const HEAT_LEGEND_BG = heatGradient(0.05, 0.9);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const smoothstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function makeHeatField(spots, { bearings, w, l }) {
  if (!spots.length) return () => ({ v: 0, conf: 0 });

  if (bearings) {
    const pts = spots.map((s) => ({ a: Math.atan2(s.z, s.x), v: heatRt(s) }));
    let near = Infinity;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = angDiff(pts[i].a, pts[j].a);
        if (d > 1e-4 && d < near) near = d;
      }
    const sig = Math.max((5 * Math.PI) / 180, Number.isFinite(near) ? near * 0.6 : Math.PI / 6);
    // Radial fade is measured against the wall in that direction, so a short
    // wall close to the sensor gets the same full colour as a far one.
    const toWall = (a) => {
      const c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
      return Math.min(c > 1e-6 ? w / 2 / c : Infinity, sn > 1e-6 ? l / 2 / sn : Infinity) || 1;
    };
    return (x, z) => {
      const a = Math.atan2(z, x);
      let num = 0, den = 0, conf = 0;
      for (const p of pts) {
        const d = angDiff(a, p.a);
        const g = Math.exp(-(d * d) / (2 * sig * sig));
        num += (g + 1e-9) * p.v; den += g + 1e-9;
        if (g > conf) conf = g;
      }
      return { v: den ? num / den : 0, conf: conf * smoothstep(0.1, 0.6, Math.hypot(x, z) / toWall(a)) };
    };
  }

  const pts = spots.map((s) => ({ x: s.x, z: s.z, v: heatRt(s) }));
  let near = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
      if (d > 1e-4 && d < near) near = d;
    }
  const minFoot = Math.max(0.05, Math.min(w, l));
  const sig = Math.max(0.18 * minFoot, Number.isFinite(near) ? near * 0.8 : 0.35 * minFoot);
  return (x, z) => {
    let num = 0, den = 0, conf = 0;
    for (const p of pts) {
      const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      const g = Math.exp(-d2 / (2 * sig * sig));
      num += (g + 1e-9) * p.v; den += g + 1e-9;
      if (g > conf) conf = g;
    }
    return { v: den ? num / den : 0, conf };
  };
}

/* Pixel colour comes straight from the RT60 ramp; opacity only tracks
   confidence (how close a real reading is), so every band — including the
   green target band — is equally visible. */
const HEAT_ALPHA = 0.82;
function heatPixel(v, conf, out, o) {
  const [r, g, b] = rtToRgb(v);
  out[o] = r; out[o + 1] = g; out[o + 2] = b;
  out[o + 3] = 255 * conf * HEAT_ALPHA;
}

/* Paint a W x H texture; `at(i, j)` returns the field sample for a pixel. */
function heatTexture(W, H, at) {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(W, H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const { v, conf } = at(i, j);
      heatPixel(v, conf, img.data, (j * W + i) * 4);
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace; // pixels are sRGB
  return tex;
}

// Where the prototype STLs are served from — put both files in your app's
// /public/models/ folder. `deviceUrl` / `soundDeviceUrl` props override them.
//   Hardware_1.stl — the default prototype shown in the twin.
//   Hardware_2.stl — shown instead while the Sound heatmap layer is on.
const DEVICE_URLS = { hw1: "/models/Hardware_1.stl", hw2: "/models/Hardware_2.stl" };
const DEVICE_NAMES = { hw1: "Hardware 1", hw2: "Hardware 2" };
// Each model is drawn at a real, fixed size in metres — the same units as the
// room — so the twin shows the prototype at true scale against the walls. The
// STL is scaled uniformly from its own bounding box, so its units don't matter;
// one measured dimension is pinned and the rest follow the model's proportions.
//   pin "long"   — the model's longest side is set to `size`
//   pin "height" — its vertical extent is set to `size`
//   Hardware 1 — 7 in (0.1778 m) across its longest side. Measured against the
//                testbed photo, the box spans ~26% of the 0.64 m room width
//                (≈0.17 m) and stands ~0.11 m tall, so 7 in is its width, not
//                its height — pinning height to 7 in drew it ~2× too big.
//   Hardware 2 — 170 cm tall.
// `up` names which axis of the loaded model is the device's real vertical
// (after the Z-up -> Y-up turn in prepareDevice); set "x" or "z" only if the
// model loads lying down. The console prints each model's extents on load.
const DEVICE_SPEC = {
  hw1: { size: 7 * 0.0254, pin: "long", up: "y" },
  hw2: { size: 1.70, pin: "height", up: "y" },
};

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
 * - spots: [{x,z,type:'hot'|'dead'|'neutral',value}] from a classification tab.
 *   Rows carrying only a bearing (angle) are ray-cast onto the room walls.
 * Positions are centred on the room so everything lines up.
 * ------------------------------------------------------------------ */
function colIdx(cols, re) { return cols.findIndex((c) => re.test(String(c))); }

/* Column matchers. `x`/`y` are anchored — a loose /x/i also matches "max_db",
   "index" or "x_offset", which is how a Reverberation tab can masquerade as a
   coordinate table. */
const RX_X = /^\s*(x|x_m|x_mm|x_pos|pos_x|coord_x|x_coord)\s*$/i;
const RX_Y = /^\s*(y|y_m|y_mm|y_pos|pos_y|coord_y|y_coord)\s*$/i;
const RX_CLASS = /class|label|zone|category|status|spot/i;
const RX_METRIC = /rt60|reverb|spl|level|db|energy|score|intensity/i;
/* The decay-time column is preferred over any other level column: a tab can
   carry both "RT60" and e.g. "Peak_dB", and the first loose match used to win,
   so the heatmap could be reading dB instead of seconds. */
const RX_RT60 = /rt60|t20|t30|edt|decay.?time/i;
const metricCol = (cols) => { const i = colIdx(cols, RX_RT60); return i >= 0 ? i : colIdx(cols, RX_METRIC); };
const RX_ANGLE = /^\s*(angle|bearing|azimuth|heading|deg)/i;

/* Classification is the tab that owns hot/dead/neutral, so it is searched
   first; tabs without a classification column are never used for spots. */
function rankedTabs(tabs) {
  return Object.entries(tabs || {})
    .map(([name, t]) => ({
      name: String(name),
      cols: t?.columns || [],
      rows: Array.isArray(t?.rows) ? t.rows : [],
    }))
    .filter((e) => e.rows.length && e.cols.length)
    .map((e) => ({
      ...e,
      classI: colIdx(e.cols, RX_CLASS),
      metricI: metricCol(e.cols),
      angleI: colIdx(e.cols, RX_ANGLE),
      xi: colIdx(e.cols, RX_X),
      yi: colIdx(e.cols, RX_Y),
      named: /class/i.test(String(e.name)),
    }))
    .sort((a, b) => (b.named - a.named) || ((b.classI >= 0) - (a.classI >= 0)));
}

/* "Hot Spot" / "hot_spot" / "HOTSPOT" -> hot;  "Neutral Zone" -> neutral.
   Normalised first so header casing and separators can't cause a miss. */
function classifyLabel(raw) {
  const c = String(raw ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (/neutral|balanced|normal|nominal|within|ok/.test(c)) return "neutral";
  if (/hot|high|live|bright|excess/.test(c)) return "hot";
  if (/dead|low|dull|null|quiet/.test(c)) return "dead";
  return "neutral";
}
const SPOT_LABEL = { hot: "Hotspot", dead: "Deadspot", neutral: "Neutral zone" };

/* ---- room dimensions: units ---------------------------------------------
 * The LiDAR row mixes units — width_m / length_m are metres but height_cm is
 * centimetres. Reading 61 cm as 61 m made the room 100× too big and inflated
 * every volume-based figure (Sabine absorption, NRC cover). Everything below
 * the parser works in metres, so convert here, once.
 *  1. A unit-suffixed key (height_cm, height_mm, height_m) wins and is
 *     converted by its suffix.
 *  2. A bare key (height) is taken as metres, unless the value is impossible
 *     for a room in metres (> 20). Then it is read as cm (≤ 2000) or mm, and
 *     the audit says so.
 * ------------------------------------------------------------------------ */
const UNIT_TO_M = { m: 1, cm: 0.01, mm: 0.001 };
const MAX_ROOM_M = 20;
function normalizeDims(raw) {
  const src = raw || {};
  const out = {};
  const notes = [];
  for (const key of ["width", "length", "height"]) {
    let val = null;
    for (const u of ["m", "cm", "mm"]) {
      const v = src[`${key}_${u}`];
      if (numish(v) && +v > 0) { val = +v * UNIT_TO_M[u]; break; }
    }
    if (val == null && numish(src[key]) && +src[key] > 0) {
      const v = +src[key];
      if (v > MAX_ROOM_M) {
        const u = v <= MAX_ROOM_M * 100 ? "cm" : "mm";
        val = v * UNIT_TO_M[u];
        notes.push({ key, raw: v, unit: u, m: val });
      } else {
        val = v;
      }
    }
    out[key] = val;
  }
  return { dims: out, notes };
}

function parseDeployment(dep) {
  if (!dep) return null;
  // A deployment record can exist while carrying nothing usable — an empty
  // bundle, a cleared table, or a stale entry whose dimension fields are still
  // populated. Reject those here so the page treats them as "not deployed".
  const tabsRaw = dep.tabs || {};
  const hasAnyRow = Object.values(tabsRaw).some((t) => Array.isArray(t?.rows) && t.rows.length > 0);
  if (!hasAnyRow) return null;

  const { dims } = normalizeDims(dep.dims);
  const pos = (v) => (numish(v) && +v > 0 ? +v : null); // zero / negative are not a room
  const room = {
    w: pos(dims.width),
    l: pos(dims.length),
    h: pos(dims.height),
  };
  if (!room.w || !room.l) return null;
  const tabs = tabsRaw;

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

  // --- hot / dead / neutral spots ---
  // Spots come ONLY from a tab that carries its own classification column, and
  // every field of a spot (label, position, level) is read from that same tab
  // and that same row. Nothing is derived or borrowed: no median split, no
  // falling back to another tab's columns (e.g. the LiDAR obstacle points),
  // and a row with a blank label is skipped rather than defaulted. If the
  // parameters aren't there, the layer stays empty and the audit says why.
  let spots = [];
  let spotsAreBearings = false;
  let spotsFrom = null;

  const cands = rankedTabs(tabs).filter((c) => c.classI >= 0);

  for (const c of cands) {
    const hasLabel = (r) => String(r[c.classI] ?? "").trim() !== "";
    const readType = (r) => classifyLabel(r[c.classI]);
    const readValue = (r) =>
      c.metricI >= 0 && numish(r[c.metricI]) ? parseFloat(r[c.metricI]) : null;

    // Cartesian rows first.
    if (c.xi >= 0 && c.yi >= 0) {
      const mm = /mm/i.test(String(c.cols[c.xi]));
      const out = c.rows.map((r) => {
        if (!hasLabel(r)) return null;
        let x = parseFloat(r[c.xi]), z = parseFloat(r[c.yi]);
        if (!numish(x) || !numish(z)) return null;
        if (mm) { x /= 1000; z /= 1000; }
        return { x, z, type: readType(r), value: readValue(r) };
      }).filter(Boolean);
      if (out.length) {
        spots = out; spotsFrom = c.name;
        break;
      }
    }

    // Bearing-only rows. A bearing is a direction, not a position, so each
    // reading is ray-cast from room centre onto the wall it points at.
    if (c.angleI >= 0 && room.w && room.l) {
      const hx = (room.w / 2) * 0.94, hz = (room.l / 2) * 0.94;
      // The logged angle IS the compass bearing: 0° faces north, 90° east,
      // 180° south, 270° west. No offset is applied — a reading logged at 1°
      // is drawn at 1°, one logged at 90° faces east.
      const out = c.rows.map((r) => {
        if (!hasLabel(r)) return null;
        const raw = parseFloat(r[c.angleI]);
        if (!numish(raw)) return null;
        // Compass bearing: 0° = north, increasing clockwise (90° east,
        // 180° south, 270° west) — the same frame as the N/E/S/W labels on
        // the twin, where north is -z and east is +x. Wrapped into 0–360.
        const deg = (((raw % 360) + 360) % 360);
        const rad = (deg * Math.PI) / 180;
        const dx = Math.sin(rad), dz = -Math.cos(rad);
        const tx = Math.abs(dx) < 1e-6 ? Infinity : hx / Math.abs(dx);
        const tz = Math.abs(dz) < 1e-6 ? Infinity : hz / Math.abs(dz);
        const tt = Math.min(tx, tz); // first wall the bearing meets
        if (!isFinite(tt)) return null;
        return { x: dx * tt, z: dz * tt, type: readType(r), value: readValue(r), angle: deg, rawAngle: raw };
      }).filter(Boolean);
      if (out.length) {
        // Readings always run from 0° (north) clockwise, whatever order
        // the rows arrived in.
        out.sort((a, b) => a.angle - b.angle);
        spots = out; spotsFrom = c.name;
        spotsAreBearings = true;
        break;
      }
    }
  }

  // keep measurement spots comfortably inside the room footprint. Bearing spots
  // are already anchored to the walls — rescaling them would destroy the mapping.
  if (!spotsAreBearings) {
    if (room.w && room.l) fitInside(spots, room.w, room.l, "contain", 0.8);
    else centre(spots);
  }

  // Average RT60 for the recommendations. The Classification tab is read FIRST:
  // its per-position RT60 values are the ones the hot / dead labels were drawn
  // from, so the recommendation verdict and the spot markers can't disagree.
  // Other tabs with an RT60 column (e.g. Reverberation) are only a fallback.
  let rt60 = null;
  const rtTabs = Object.entries(tabs).sort(
    ([a], [b]) => Number(/class/i.test(b)) - Number(/class/i.test(a))
  );
  for (const [, t] of rtTabs) {
    const cols = t.columns || [];
    const ri = colIdx(cols, /rt60/i);
    if (ri >= 0 && (t.rows || []).length) {
      const vals = t.rows.map((r) => parseFloat(r[ri])).filter(numish);
      if (vals.length) { rt60 = vals.reduce((a, b) => a + b, 0) / vals.length; break; }
    }
  }

  // Measured frequency bands (Hz) from the Reverberation tab, if it lists them.
  // Used only to say how thick the absorption must be; never invented.
  let bands = [];
  for (const [label, t] of Object.entries(tabs)) {
    if (!/reverb/i.test(label)) continue;
    const fi = colIdx(t.columns || [], /freq|hz|band/i);
    if (fi < 0) continue;
    bands = [...new Set((t.rows || []).map((r) => parseFloat(r[fi])).filter((v) => Number.isFinite(v) && v > 0))]
      .sort((a, b) => a - b);
    if (bands.length) break;
  }

  return { room, rawPoints, spots, spotsAreBearings, spotsFrom, rt60, bands, roomTs: dep.roomTs, at: dep.at };
}

/* ================================================================== *
 * Parameter audit
 * ------------------------------------------------------------------
 * parseDeployment answers "can this be drawn?" with a yes or a null.
 * That is the wrong answer to show a user: a bundle that is missing the
 * room width and a bundle that was never deployed look identical on
 * screen, and neither says which parameter to go and fix.
 *
 * This walks the same bundle and names what is absent. Errors block a
 * layer or a calculation outright; warnings change how much the numbers
 * can be leaned on. Both are reported against the tab they came from.
 * ================================================================== */
const rowRef = (list) => {
  const shown = list.slice(0, 6).map((n) => `row ${n}`).join(", ");
  return list.length > 6 ? `${shown} +${list.length - 6} more` : shown;
};

function auditDeployment(dep, model) {
  const errors = [], warnings = [];
  const out = (unusable = false) => ({ errors, warnings, unusable });
  if (!dep) return out();

  const tabs = Object.entries(dep.tabs || {}).map(([name, t]) => ({
    name: String(name),
    cols: t?.columns || [],
    rows: Array.isArray(t?.rows) ? t.rows : [],
  }));

  if (!tabs.some((t) => t.rows.length)) {
    errors.push({ title: "Deployed bundle is empty", body: "Every tab in the deployed scan carries zero rows. Re-import the scan in the Parameters table and deploy it again." });
    return out(true);
  }

  /* --- room dimensions (LiDAR pass) --- */
  const { dims: d, notes: unitNotes } = normalizeDims(dep.dims);
  const ok = (v) => numish(v) && +v > 0;
  for (const n of unitNotes) {
    warnings.push({
      title: `Room ${n.key} read as ${n.unit === "cm" ? "centimetres" : "millimetres"}`,
      body: `The room row gave ${n.key} = ${n.raw}, which is too large to be metres for a room, so it was read as ${n.raw} ${n.unit} = ${n.m.toFixed(2)} m. Name the column ${n.key}_${n.unit} (or ${n.key}_m) to make the unit explicit.`,
    });
  }
  const missDims = [];
  if (!ok(d.width)) missDims.push("width");
  if (!ok(d.length)) missDims.push("length");
  if (missDims.length) {
    errors.push({
      title: `Missing parameter — room ${missDims.join(" and ")}`,
      body: `The deployed room row has no usable ${missDims.join(" or ")}. Without a footprint the twin cannot be built and no volume-based figure can be computed. Re-run the LiDAR pass, or pick a room scan whose dimension columns are filled in.`,
    });
  }
  if (!ok(d.height)) {
    warnings.push({
      title: "Missing parameter — room height",
      body: "No height came through with the room row, so the twin, the room volume and every RT60-derived figure assume 2.60 m. Treat the absorption numbers as indicative until a real height is scanned.",
    });
  }

  /* --- classification tab --- */
  const cls =
    tabs.find((t) => /class/i.test(t.name) && t.rows.length) ||
    tabs.find((t) => colIdx(t.cols, RX_CLASS) >= 0 && t.rows.length) ||
    null;

  if (!cls) {
    errors.push({
      title: "Missing parameter — no classification data",
      body: "Nothing in the bundle carries hotspot / neutral / deadspot labels, so the imbalance layer is empty and no placement can be worked out. Publish the Classification tab and deploy again.",
    });
  } else {
    const ci = colIdx(cls.cols, RX_CLASS);
    const ai = colIdx(cls.cols, RX_ANGLE);
    const xi = colIdx(cls.cols, RX_X), yi = colIdx(cls.cols, RX_Y);
    const mi = metricCol(cls.cols);

    if (ci < 0) errors.push({ title: `Missing parameter — classification column in “${cls.name}”`, body: "No column names which readings are hotspots, neutral zones or deadspots. Spots are only drawn from labels read off the sheet, so the imbalance layer stays empty." });
    if (ai < 0 && (xi < 0 || yi < 0)) {
      errors.push({
        title: `Missing parameter — position in “${cls.name}”`,
        body: xi >= 0 || yi >= 0
          ? `Only ${xi >= 0 ? "X" : "Y"} is present. A reading needs an angle/bearing column, or both X and Y, before it can be placed against a wall.`
          : "No angle/bearing column and no X + Y pair, so no reading can be placed in the room and the spot layer stays empty.",
      });
    }
    if (mi < 0) warnings.push({ title: `No level column in “${cls.name}”`, body: "There is no RT60 / SPL column alongside the labels, so the coverage area is split evenly between hotspots rather than weighted by how far each reading sits above the room mean." });

    // Blank cells in the columns that do exist.
    const req = [];
    if (ci >= 0) req.push({ i: ci, name: cls.cols[ci], num: false });
    if (ai >= 0) req.push({ i: ai, name: cls.cols[ai], num: true });
    else { if (xi >= 0) req.push({ i: xi, name: cls.cols[xi], num: true }); if (yi >= 0) req.push({ i: yi, name: cls.cols[yi], num: true }); }
    if (mi >= 0) req.push({ i: mi, name: cls.cols[mi], num: true });

    const blanks = new Map(), bad = new Map();
    cls.rows.forEach((r, ri) => {
      const line = ri + 2; // header row + 1-based
      req.forEach(({ i, name, num }) => {
        const v = r[i];
        if (v === "" || v == null) { if (!blanks.has(name)) blanks.set(name, []); blanks.get(name).push(line); }
        else if (num && !numish(v)) { if (!bad.has(name)) bad.set(name, []); bad.get(name).push(line); }
      });
    });
    blanks.forEach((list, name) => errors.push({
      title: `Missing parameter — “${name}” is blank`,
      body: `${list.length} of ${cls.rows.length} rows in “${cls.name}” have no value for “${name}” (${rowRef(list)}). Those readings are dropped from the twin.`,
    }));
    bad.forEach((list, name) => errors.push({
      title: `Invalid parameter — “${name}” is not numeric`,
      body: `${list.length} row${list.length > 1 ? "s" : ""} in “${cls.name}” hold a non-numeric value for “${name}” (${rowRef(list)}). Those readings are dropped from the twin.`,
    }));

  }

  /* --- reverberation --- */
  const hasRt60Col = tabs.some((t) => colIdx(t.cols, /rt60/i) >= 0 && t.rows.length);
  if (!model || !numish(model.rt60)) {
    errors.push({
      title: "Missing parameter — RT60",
      body: hasRt60Col
        ? "An RT60 column was found but none of its cells hold a usable number, so no absorption target can be solved. Re-run the sound-sensor pass."
        : "No reverberation column came through with the bundle. Sabine needs a measured RT60 before any required αw or coverage area can be worked out — the recommendations below cannot be computed without it.",
    });
  }

  /* --- derived model results --- */
  if (model) {
    if (!model.spots.length && cls) warnings.push({ title: "No spots placed", body: `The classification data was found in “${cls.name}” but no row survived parsing, so the imbalance layer is empty. Check the position and label columns above.` });
    if (!model.rawPoints.length) warnings.push({ title: "No obstacle points", body: "Nothing in the bundle carries an X/Y point cloud, so the room draws as a bare box with no detected edges inside it. The LiDAR obstacle pass may not have been included." });
  }

  return out(missDims.length > 0);
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
// Fetch one STL. No substitute model on failure — a missing file is reported,
// not silently replaced with a different prototype.
async function loadDevice(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return { geo: null, status: "error", why: `HTTP ${r.status}` };
    if (/text\/html/i.test(r.headers.get("content-type") || "")) return { geo: null, status: "error", why: "server returned HTML, not a model" };
    const geo = safeParseDevice(await r.arrayBuffer());
    return geo ? { geo, status: "ready" } : { geo: null, status: "error", why: "not a valid STL" };
  } catch (err) {
    return { geo: null, status: "error", why: err.message };
  }
}

/* `scan` (optional): a saved History entry to draw instead of the current
   deployment. It has the same shape the Parameters table deploys —
   { roomTs, dims, tabs } — so it goes through the same parser and audit.
   Passing it never touches the deployment, so the Simulation page and the
   rest of the app keep showing the deployed scan. */
export default function SimulationPage({ deviceUrl, soundDeviceUrl, twinOnly = false, scan = null } = {}) {
  const [deployed, setDep] = useState(() => vibraHistory.getDeployment());
  const dep = scan ?? deployed;
  const [orbiting, setOrbiting] = useState(true);
  // Default view: the room shell and its detected edges; everything else is opt-in.
  // The Dashboard's Room twin (twinOnly) has no layers panel, so it always shows
  // the detected hotspots and deadspots from the deployed scan.
  const [layers, setLayers] = useState({ shell: true, edges: true, raw: false, spots: twinOnly, omni: false, device: false });
  const [hover, setHover] = useState(null);
  const hrefs = { hw1: deviceUrl || DEVICE_URLS.hw1, hw2: soundDeviceUrl || DEVICE_URLS.hw2 };
  const [devices, setDevices] = useState({ hw1: { geo: null, status: "loading" }, hw2: { geo: null, status: "loading" } });
  // Which prototype the twin shows: Hardware 2 while Sound heatmap is on
  // (and its file loaded), otherwise Hardware 1.
  const activeDevice = layers.spots && devices.hw2.geo ? "hw2" : "hw1";
  const active = devices[activeDevice];

  // A cleared deployment arrives as null. Wrap the setter so React never
  // mistakes a payload for a functional state update.
  useEffect(() => vibraHistory.onDeploy((payload) => setDep(payload ?? null)), []);

  // Load both prototype models once; the scene holds both and the layer
  // state decides which one is visible.
  useEffect(() => {
    let alive = true;
    ["hw1", "hw2"].forEach(async (k) => {
      const res = await loadDevice(hrefs[k]);
      if (!alive) return;
      if (res.status === "error") console.warn(`[VIBRA] ${DEVICE_NAMES[k]} not loaded from ${hrefs[k]} (${res.why}).`);
      setDevices((d) => ({ ...d, [k]: res }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hrefs.hw1, hrefs.hw2]);

  const model = useMemo(() => parseDeployment(dep), [dep]);
  // Nothing is drawn — and the canvas isn't even mounted — until a scan lands.
  const hasModel = !!(model && model.room.w && model.room.l);
  // What the bundle is missing, named per parameter. Computed whether or not
  // the model parsed, because the interesting case is the one where it didn't.
  const audit = useMemo(() => auditDeployment(dep, model), [dep, model]);

  const mountRef = useRef(null);
  const three = useRef(null);
  const spotsRef = useRef([]); // pickable spot meshes for hover
  const scaledRef = useRef({}); // which prototypes were shrunk to fit the room
  const orbit = useRef({ theta: Math.PI * 0.28, phi: Math.PI * 0.34, radius: 12, home: 12, target: new THREE.Vector3(0, 1, 0) });
  const autoRef = useRef(true);
  useEffect(() => { autoRef.current = orbiting; }, [orbiting]);

  /* init renderer once */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth || 600, h = mount.clientHeight || 400;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, w / h, 0.01, 1000); // near plane small enough for sub-metre rooms
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
    // Zoom limits and step are relative to the fitted view (orb.home), not fixed
    // metres: a fixed floor of 3 m sat above the default distance for a small
    // room, so once zoomed out the view could never return to it. Multiplicative
    // steps keep the zoom feeling the same at any room size.
    const ZOOM_IN = 0.3, ZOOM_OUT = 5, ZOOM_STEP = 1.12;
    const wheel = (e) => {
      e.preventDefault();
      const home = orb.home || orb.radius;
      const next = orb.radius * (e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      orb.radius = Math.max(home * ZOOM_IN, Math.min(home * ZOOM_OUT, next));
      setCam();
    };
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
  }, [hasModel]);

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
    const COL = {
      edge: cssVar("--orange", "#f6a15c"), raw: cssVar("--violet", "#a98bf5"),
      hot: cssVar("--bad", "#ff5b52"), dead: cssVar("--sim-dead", "#5b9dff"),
      neutral: cssVar("--sim-neutral", "#e9eaf0"),
      cyan: cssVar("--cyan", "#62d0e0"), device: cssVar("--device", "#c2cae0"),
      // Distinct hues so the two label families never read as the same thing:
      //   dimensions = mint, cardinals = amber. Neither collides with the
      //   orange detected-edge line, the violet points or the cyan sensor.
      dim: cssVar("--sim-dim", "#5ee6b0"),
      card: cssVar("--sim-card", "#ffd166"),
      wall: cssVar("--sim-wall", "#4a5891"),
    };

    // room shell (fit) — wire box + faint floor
    const shell = new THREE.Group();
    const box = new THREE.BoxGeometry(w, h, l);

    // Solid-ish wall + ceiling faces. BackSide means we render the *inside* of
    // the box, so the near wall never hides the contents — the room reads as a
    // glass enclosure rather than a bare wire cage. depthWrite:false keeps the
    // points, spots and device drawing through it.
    const walls = new THREE.Mesh(box.clone(), new THREE.MeshStandardMaterial({
      color: new THREE.Color(COL.wall), transparent: true, opacity: 0.34,
      side: THREE.BackSide, depthWrite: false, roughness: 0.95, metalness: 0.0,
    }));
    walls.position.y = h / 2; shell.add(walls);

    // A second, fainter pass on the front faces adds a glassy sheen so the
    // enclosure still has edges to catch light from outside.
    const glass = new THREE.Mesh(box.clone(), new THREE.MeshStandardMaterial({
      color: new THREE.Color(COL.wall), transparent: true, opacity: 0.10,
      side: THREE.FrontSide, depthWrite: false, roughness: 0.6, metalness: 0.1,
    }));
    glass.position.y = h / 2; shell.add(glass);

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x9fa9dd, transparent: true, opacity: 0.8 }));
    edges.position.y = h / 2;
    shell.add(edges);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ color: 0x1b2440, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001; shell.add(floor);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ color: 0x1b2440, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
    ceiling.rotation.x = -Math.PI / 2; ceiling.position.y = h - 0.001; shell.add(ceiling);

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

    // Annotation scale. Every ruler / cardinal size below was tuned for a room
    // about 4 m across (k = 1). k follows the room's largest dimension, so a
    // 0.6 m enclosure gets proportionally small labels, offsets and ticks and a
    // 10 m hall gets proportionally larger ones — the annotations keep the same
    // size relative to the room no matter what was scanned.
    const k = Math.max(0.05, Math.max(w, l, h) / 4);

    // ---- dimension rulers (width / length / height) ----
    // Text tier is a bit smaller than the cardinal directions below.
    const dimStyle = { fg: "#d8fff0", worldH: 0.26 * k, accent: COL.dim };
    const rulerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(COL.dim), transparent: true, opacity: 0.85 });
    const seg = (ax, ay, az, bx, by, bz) =>
      shell.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]), rulerMat));
    const rOff = Math.max(0.28 * k, Math.max(w, l) * 0.08); // how far rulers sit outside the room
    const tick = Math.max(0.06 * k, Math.min(w, l) * 0.06); // end-cap length
    const y0 = 0.02 * k;

    // Width — along X, in front of the room (+Z side)
    {
      const z = l / 2 + rOff;
      seg(-w / 2, y0, l / 2, -w / 2, y0, z); // witness lines
      seg(w / 2, y0, l / 2, w / 2, y0, z);
      seg(-w / 2, y0, z, w / 2, y0, z);       // dimension line
      seg(-w / 2, y0, z - tick, -w / 2, y0, z + tick); // end ticks
      seg(w / 2, y0, z - tick, w / 2, y0, z + tick);
      addLabel(makeLabel(`Width ${f2(w)} m`, dimStyle), 0, y0, z + tick + 0.14 * k);
    }
    // Length — along Z, on the right of the room (+X side)
    {
      const x = w / 2 + rOff;
      seg(w / 2, y0, -l / 2, x, y0, -l / 2);
      seg(w / 2, y0, l / 2, x, y0, l / 2);
      seg(x, y0, -l / 2, x, y0, l / 2);
      seg(x - tick, y0, -l / 2, x + tick, y0, -l / 2);
      seg(x - tick, y0, l / 2, x + tick, y0, l / 2);
      addLabel(makeLabel(`Length ${f2(l)} m`, dimStyle), x + tick + 0.14 * k, y0, 0);
    }
    // Height — vertical, at the back-left corner
    {
      const x = -w / 2 - rOff, z = -l / 2 - rOff;
      seg(-w / 2, 0, -l / 2, x, 0, z);        // witness at floor
      seg(-w / 2, h, -l / 2, x, h, z);        // witness at ceiling
      seg(x, 0, z, x, h, z);                   // dimension line
      seg(x - tick, 0, z, x + tick, 0, z);     // end ticks
      seg(x - tick, h, z, x + tick, h, z);
      addLabel(makeLabel(`Height ${f2(h)} m`, dimStyle), x - tick - 0.16 * k, h / 2, z);
    }

    // ---- cardinal directions — bigger, and set farther out from the room ----
    const cardStyle = { fg: "#fff4d6", worldH: 0.38 * k, accent: COL.card };
    // Well clear of the dimension rulers: the Width / Length pills sit on the same
    // S / E axes, so a badge too close stacks on top of them on screen.
    const cOff = Math.max(2.6 * k, Math.max(w, l) * 0.8);
    const cy = 0.05 * k;
    // Short amber pointer strokes on the floor tie each pill to its bearing.
    const cardMat = new THREE.LineBasicMaterial({ color: new THREE.Color(COL.card), transparent: true, opacity: 0.6 });
    const cardSeg = (ax, az, bx, bz) =>
      shell.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, y0, az), new THREE.Vector3(bx, y0, bz)]), cardMat));
    const cTick = Math.max(0.18 * k, cOff * 0.22);
    cardSeg(0, -l / 2 - cOff + cTick, 0, -l / 2 - cOff - cTick * 0.2);
    cardSeg(w / 2 + cOff - cTick, 0, w / 2 + cOff + cTick * 0.2, 0);
    cardSeg(0, l / 2 + cOff - cTick, 0, l / 2 + cOff + cTick * 0.2);
    cardSeg(-w / 2 - cOff + cTick, 0, -w / 2 - cOff - cTick * 0.2, 0);
    // Round compass badges (not pills) so directions never look like a measurement.
    const badge = (L, d) => makeCompassBadge(L, d, { worldH: cardStyle.worldH * 1.9, accent: COL.card, primary: L === "N" });
    const by = cardStyle.worldH * 1.9 * 0.5; // disc rests on the floor (radius above y = 0)
    addLabel(badge("N", 0), 0, by, -l / 2 - cOff);
    addLabel(badge("E", 90), w / 2 + cOff, by, 0);
    addLabel(badge("S", 180), 0, by, l / 2 + cOff);
    addLabel(badge("W", 270), -w / 2 - cOff, by, 0);

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

    // sound heatmap (replaces the per-reading spheres) — see makeHeatField
    const pick = [];
    if (model.spots.length) {
      const heat = new THREE.Group();
      const field = makeHeatField(model.spots, { bearings: !!model.spotsAreBearings, w, l });
      // What the heatmap is actually painting, per reading — check here first
      // if every patch looks the same strength (e.g. RT60 column not found).
      console.info("[VIBRA] heatmap readings", model.spots.map((sp) => ({
        label: sp.type, rt60_s: sp.value, bearing: sp.angle, sensor_angle: sp.rawAngle, rt60_used: +heatRt(sp).toFixed(3), colour: rtToCss(heatRt(sp)),
      })));
      if (model.spots.every((sp) => sp.value == null))
        console.warn("[VIBRA] heatmap: no RT60 values found in the classification tab — every reading uses its label's fallback RT60 (hot 0.6 s / neutral 0.3 s / dead 0.1 s).");
      const heatMat = (tex) => new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });

      // Floor: the field over the whole footprint.
      {
        const RES = 220;
        const W = Math.max(8, Math.round(RES * (w / Math.max(w, l))));
        const H = Math.max(8, Math.round(RES * (l / Math.max(w, l))));
        const sample = (i, j) => field(-w / 2 + ((i + 0.5) / W) * w, -l / 2 + ((j + 0.5) / H) * l);
        const tex = heatTexture(W, H, sample);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, l), heatMat(tex));
        plane.rotation.x = -Math.PI / 2; plane.position.y = 0.012; plane.renderOrder = 4;
        heat.add(plane);

        // Ceiling: the same footprint field. The mic is omnidirectional, so a
        // reading covers the ceiling as much as the floor. Drawn a little
        // lighter so a top-down view (looking through the ceiling onto the
        // floor) doesn't stack into a darker colour than either surface has.
        const ceilTex = heatTexture(W, H, (i, j) => { const f = sample(i, j); return { v: f.v, conf: f.conf * 0.6 }; });
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, l), heatMat(ceilTex));
        ceil.rotation.x = -Math.PI / 2; ceil.position.y = h - 0.012; ceil.renderOrder = 4;
        heat.add(ceil);
      }

      // Walls: the same field along each wall, floor to ceiling at even
      // strength. The mic is omnidirectional and each reading is one RT60 for
      // the whole direction, so it carries no height information: fading the
      // colour toward the floor or ceiling would invent a vertical variation
      // that was never measured. yM is only where the reading ticks sit.
      const yM = Math.min(1.2, h * 0.5);
      const inset = Math.min(w, l) * 0.004;
      const walls = [
        { len: w, ry: 0, pos: [0, -l / 2 + inset], at: (u) => [-w / 2 + u * w, -l / 2] },           // north
        { len: w, ry: Math.PI, pos: [0, l / 2 - inset], at: (u) => [w / 2 - u * w, l / 2] },         // south
        { len: l, ry: -Math.PI / 2, pos: [w / 2 - inset, 0], at: (u) => [w / 2, -l / 2 + u * l] },   // east
        { len: l, ry: Math.PI / 2, pos: [-w / 2 + inset, 0], at: (u) => [-w / 2, l / 2 - u * l] },   // west
      ];
      walls.forEach((wl) => {
        const W = Math.max(8, Math.round(200 * (wl.len / Math.max(w, l))));
        const H = Math.max(8, Math.round(W * (h / wl.len)));
        const tex = heatTexture(Math.min(W, 256), Math.min(H, 256), (i, j) => {
          const u = (i + 0.5) / Math.min(W, 256);
          const [x, z] = wl.at(u);
          const f = field(x, z);
          return { v: f.v, conf: f.conf * 0.85 };
        });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(wl.len, h), heatMat(tex));
        plane.rotation.y = wl.ry; plane.position.set(wl.pos[0], h / 2, wl.pos[1]); plane.renderOrder = 4;
        heat.add(plane);
      });

      // Where each reading was taken: a small flat cross (not a marker the
      // eye reads as a sound source), plus an invisible hover target.
      const minDim = Math.max(0.05, Math.min(w, l, h));
      const tickR = minDim * 0.035;
      const hitR = minDim * 0.08;
      const crossMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
      model.spots.forEach((s) => {
        const info = { type: s.type, value: s.value, x: s.x, z: s.z, angle: s.angle };
        const y = model.spotsAreBearings ? yM : 0.02;
        const cross = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(model.spotsAreBearings
            ? [new THREE.Vector3(s.x, y - tickR, s.z), new THREE.Vector3(s.x, y + tickR, s.z)]
            : [new THREE.Vector3(s.x - tickR, y, s.z), new THREE.Vector3(s.x + tickR, y, s.z),
               new THREE.Vector3(s.x, y, s.z - tickR), new THREE.Vector3(s.x, y, s.z + tickR)]),
          crossMat
        );
        cross.renderOrder = 6;
        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(hitR, 12, 10),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        );
        hit.position.set(s.x, y, s.z); hit.userData = info;
        heat.add(cross, hit);
        pick.push(hit);
      });

      content.add(heat); groups.spots = heat;
    }
    spotsRef.current = pick;

    // omnidirectional sensor field — sound is detected equally in every direction.
    // The field is centred in the room and scaled to its physical dimensions: the
    // outer shell reaches close to the nearest surface (wall / floor / ceiling).
    {
      const omni = new THREE.Group();
      const cyan = COL.cyan;
      const y = h / 2;                     // field is centred in the room volume
      // The field is an ELLIPSOID matched to the room's physical box, not a
      // sphere clamped to the smallest dimension. Each shell is a unit sphere
      // scaled by (w/2, h/2, l/2), so the outer shell touches all six surfaces
      // at once — walls, ceiling AND floor. That is the point being shown: the
      // mic is omnidirectional, so vertical pickup is not an afterthought.
      const INSET = 0.97;
      const rx = (w / 2) * INSET, ry = (h / 2) * INSET, rz = (l / 2) * INSET;
      const nodeR = Math.max(0.05, Math.min(rx, ry, rz) * 0.14);

      const node = new THREE.Mesh(new THREE.SphereGeometry(nodeR, 20, 16), new THREE.MeshStandardMaterial({ color: cyan, emissive: cyan, emissiveIntensity: 0.7, roughness: 0.3 }));
      node.position.set(0, y, 0); omni.add(node);

      [0.42, 0.7, 1.0].forEach((f, i) => {
        const s = new THREE.Mesh(
          new THREE.SphereGeometry(1, 26, 18),
          new THREE.MeshBasicMaterial({ color: cyan, wireframe: true, transparent: true, opacity: 0.2 - i * 0.045, depthWrite: false })
        );
        s.scale.set(rx * f, ry * f, rz * f);
        s.position.set(0, y, 0); omni.add(s);
      });

      // Vertical axis through the whole room height, plus rings laid flat on the
      // floor and ceiling, so the up/down coverage reads even from a low camera.
      const axisMat = new THREE.LineBasicMaterial({ color: cyan, transparent: true, opacity: 0.45, depthWrite: false });
      omni.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, h - 0.02, 0)]), axisMat));
      [[0.03, 0.4], [h - 0.03, 0.28]].forEach(([py, op]) => {
        const ringR = Math.min(rx, rz);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(ringR * 0.9, ringR, 48),
          new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.scale.set(rx / ringR, rz / ringR, 1); // match the room footprint
        ring.position.y = py; omni.add(ring);
      });

      content.add(omni); groups.omni = omni;
    }

    // prototype devices — each at its fixed real size (see DEVICE_SPEC),
    // placed at the room centre, standing on the floor. applyLayers shows one.
    const heights = {};
    const buildDevice = (src, key) => {
      const spec = DEVICE_SPEC[key];
      const geo = src.clone();
      if (spec.up === "x") geo.rotateZ(Math.PI / 2);   // model X -> vertical
      // +90° about X undoes prepareDevice's −90° turn (model −Z -> +Y), so a
      // Y-up export stands upright instead of flipping upside down.
      if (spec.up === "z") geo.rotateX(Math.PI / 2);   // model Z -> vertical
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const devH = (bb.max.y - bb.min.y) || 1;
      const devFoot = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1;
      const devLong = Math.max(devH, bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1;
      // True scale first; if that doesn't fit inside the room, shrink it so it
      // stands within 90% of the room height and 80% of the shorter wall. The
      // twin labels it "not to scale" whenever this happens.
      const trueS = spec.size / (spec.pin === "long" ? devLong : devH);
      const fitS = Math.min((h * 0.9) / devH, (Math.min(w, l) * 0.8) / devFoot);
      const s = Math.min(trueS, fitS);
      scaledRef.current[key] = s < trueS;
      heights[key] = devH * s; // drawn standing height, used to frame the camera
      const ext = (v) => (v * 1000).toFixed(0);
      console.info(
        `[VIBRA] ${DEVICE_NAMES[key]} STL extents (mm, as loaded): ` +
        `x ${ext(bb.max.x - bb.min.x)} · y ${ext(devH)} · z ${ext(bb.max.z - bb.min.z)} — ` +
        `${spec.pin === "long" ? "longest side" : "height"} pinned to ${ext(spec.size)} mm, ` +
        `drawn ${ext(devH * s)} mm tall, scale ×${s.toFixed(3)}`
      );
      // centre on x/z and sit the base on the floor, measured on the model itself
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: COL.device, metalness: 0.25, roughness: 0.5,
        emissive: new THREE.Color(COL.device), emissiveIntensity: 0.2,
        side: THREE.DoubleSide, // show even if the STL's triangle winding is inconsistent
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(s);
      // floor marker ring, just outside the device's footprint — at 0.65 × the
      // longest side it drew a disc wider than the device and read as part of it.
      const rr = devFoot * s * 0.5 * 1.15;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(rr * 0.88, rr, 40),
        new THREE.MeshBasicMaterial({ color: COL.device, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = Math.min(0.02, h * 0.01);
      g.add(mesh, ring);
      g.position.set(0, 0, 0); // room centre
      content.add(g);
      return g;
    };
    if (devices.hw1.geo) groups.device1 = buildDevice(devices.hw1.geo, "hw1");
    if (devices.hw2.geo) groups.device2 = buildDevice(devices.hw2.geo, "hw2");

    // frame the camera so the room fills the view (does NOT change room size —
    // only the camera distance). Based on the bounding sphere + the FOV.
    // Only the prototype actually on screen counts: framing for Hardware 2's
    // 1.70 m while Hardware 1 was showing pushed a 0.6 m room to the bottom
    // edge of the canvas and cut it off.
    T.fit = (deviceKey) => {
      const devTop = deviceKey ? heights[deviceKey] || 0 : 0;
      const frameH = Math.max(h, devTop);
      const orb = orbit.current;
      orb.target.set(0, frameH / 2, 0);
      const fov = ((T.camera && T.camera.fov) || 46) * Math.PI / 180;
      const sphere = Math.hypot(w, frameH, l) / 2;   // bounding-sphere radius
      orb.home = (sphere / Math.tan(fov / 2)) * 1.25; // 1.25 = small margin for labels
      orb.radius = orb.home;
    };
    T.fit(layers.device ? activeDevice : null);

    applyLayers(groups, layers);
  }, [model, devices.hw1.geo, devices.hw2.geo]);

  /* re-frame when the prototype on screen changes (toggled, or swapped
     between Hardware 1 and 2) — the rebuild above doesn't run for that */
  useEffect(() => {
    const T = three.current;
    if (T && T.fit) T.fit(layers.device ? activeDevice : null);
  }, [activeDevice, layers.device]);

  /* toggle layer visibility without rebuilding */
  useEffect(() => { if (three.current) applyLayers(three.current.groups, layers); }, [layers]);

  const toggle = (k) => setLayers((s) => ({ ...s, [k]: !s[k] }));
  const counts = useMemo(() => {
    if (!model) return { hot: 0, dead: 0, neutral: 0 };
    return {
      hot: model.spots.filter((s) => s.type === "hot").length,
      dead: model.spots.filter((s) => s.type === "dead").length,
      neutral: model.spots.filter((s) => s.type === "neutral").length,
    };
  }, [model]);

  /* canvas-only mode (embedded in the Dashboard's Room twin) — the SAME live
     scene, without the page header / layers panel / recommendations. */
  if (twinOnly) {
    return (
      <div className="sim-mount" style={{ position: "absolute", inset: 0 }}>
        <div ref={mountRef} className="sim-holder" />
        {!hasModel && (
          audit.unusable ? (
            <div className="sim-empty">
              <AlertCircle size={26} color="var(--bad)" />
              <div className="big">Missing parameter.</div>
              <div className="small">{audit.errors[0]?.body || (scan ? "The saved scan is incomplete." : "The deployed scan is incomplete.")}</div>
            </div>
          ) : scan ? (
            <div className="sim-empty">
              <Radio size={26} color="var(--faint)" />
              <div className="big">No room geometry in this saved scan.</div>
              <div className="small">It was saved without room dimensions, so there is no twin to draw.</div>
            </div>
          ) : (
            <div className="sim-empty">
              <Radio size={26} color="var(--faint)" />
              <div className="big">Nothing deployed yet.</div>
              <div className="small">Deploy a room scan from the Parameters table.</div>
            </div>
          )
        )}
        {hasModel && (
          <div className="sim-hint2">
            {layers.device && scaledRef.current[activeDevice] ? "prototype not to scale · " : ""}drag to orbit · scroll to zoom
          </div>
        )}
        {hover && (
          <div className="sim-tip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
            <div className={`hd ${hover.type === "hot" ? "hot" : "dead"}`} style={{ color: rtToCss(heatRt(hover)) }}>
              <span className={`sd ${hover.type === "hot" ? "hot" : "dead"}`} style={{ background: rtToCss(heatRt(hover)) }} />
              {SPOT_LABEL[hover.type] || "Spot"}
            </div>
            {hover.value != null && numish(hover.value) && <div className="ln">RT60 {Number(hover.value).toLocaleString(undefined, { maximumFractionDigits: 3 })} s</div>}
            <div className="ln">Angle {Math.round(bearingOf(hover))}° · {wallOf(bearingOf(hover))}</div>
            <div className="ln faint">x {hover.x.toFixed(2)} m · z {hover.z.toFixed(2)} m</div>
          </div>
        )}
      </div>
    );
  }

  /* Nothing deployed — the page stays blank. No canvas, no layers panel, no
     recommendations table: an empty scaffold reads as broken, and the disabled
     checkboxes suggested state that does not exist yet. */
  if (!hasModel) {
    // A scan WAS deployed but can't be drawn — that is a data fault, not an
    // empty page, and it gets named rather than hidden behind "nothing yet".
    const blocked = !!dep && (audit.errors.length > 0 || audit.warnings.length > 0);
    return (
      <div className="vwrap">
        <div className="vhead">
          <h1>Simulation</h1>
          <p className="sub">{blocked ? "Deployed scan is incomplete" : "Deploy a room scan to build the twin"}</p>
        </div>
        {blocked && <IssuePanel errors={audit.errors} warnings={audit.warnings} />}
        <section className="sim-livebox" style={{ minHeight: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="sim-empty" style={{ position: "static", textAlign: "center", padding: 24 }}>
            {blocked ? <AlertCircle size={26} color="var(--bad)" /> : <Radio size={26} color="var(--faint)" />}
            <div className="big">{blocked ? "Twin can't be built." : "Nothing deployed yet."}</div>
            <div className="small">
              {blocked
                ? <>Fill in the parameters listed above in the <b className="ink">Parameters table</b>, then deploy the scan again.</>
                : <>Open the Parameters table, pick a room scan, and press <b className="ink">Deploy to Simulation</b>.</>}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="vwrap">
      <div className="vhead">
        <h1>Simulation</h1>
        <p className="sub">{`Live scan${model.roomTs ? ` · ${model.roomTs}` : ""}`}</p>
      </div>

      <IssuePanel errors={audit.errors} warnings={audit.warnings} />

      <div className="sim-boxes">
        {/* 3D box */}
        <section className="sim-livebox">
          <div className="sim-boxhead">
            <div className="h"><div className="t">Live scan</div><div className="s">Combined twin</div></div>
            <div className="sim-legend">
              <span className="heat-legend" aria-label="Heatmap scale: RT60 below 0.2 s blue (deadspot), 0.2 to 0.4 s green (target), 0.4 to 0.6 s orange, 0.6 to 0.8 s yellow, 0.8 s and above red">
                <span>&lt;0.2 s</span><span className="heat-bar" style={{ background: HEAT_LEGEND_BG }} /><span>0.8+ s</span>
              </span>
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
            {hasModel && (
          <div className="sim-hint2">
            {layers.device && scaledRef.current[activeDevice] ? "prototype not to scale · " : ""}drag to orbit · scroll to zoom
          </div>
        )}
          </div>
        </section>

        {/* Layers — only exists once something is actually deployed. The
            `hasModel` guard here is belt-and-braces: the page already
            early-returns above, so this branch should never be false. */}
        {hasModel && (
        <section className="sim-layerbox">
          <div className="layers-head"><div className="t">Layers</div><div className="s">Toggle what's drawn</div></div>
          <div className="layers-body thin-scroll" style={{ flex: "0 0 auto" }}>
            <LayerRow tone="shell" label="Room shell (fit)" on={layers.shell} onClick={() => toggle("shell")} disabled={!hasModel} />
            <LayerRow tone="edge" label="Detected edges" on={layers.edges} onClick={() => toggle("edges")} disabled={!hasModel} />
            <LayerRow tone="raw" label={`Raw points${model?.rawPoints?.length ? ` (${model.rawPoints.length})` : ""}`} on={layers.raw} onClick={() => toggle("raw")} disabled={!hasModel || !model?.rawPoints?.length} />
            <LayerRow tone="heat" label={`Sound heatmap${model?.spots?.length ? ` (${counts.hot} hot / ${counts.dead} dead / ${counts.neutral} neutral)` : ""}`} on={layers.spots} onClick={() => toggle("spots")} disabled={!hasModel || !model?.spots?.length} />
            <LayerRow tone="device"
              label={active.status === "error" ? `Prototype — ${DEVICE_NAMES[activeDevice]} not found` : active.status === "loading" ? "Prototype — loading…" : `Prototype (${DEVICE_NAMES[activeDevice]})`}
              on={layers.device} onClick={() => toggle("device")} disabled={!hasModel || !active.geo} />
          </div>
          <div
            className="layer-note"
            style={{
              margin: "14px 14px 0", paddingTop: 14, paddingLeft: 0, paddingRight: 0,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex", flexDirection: "column", gap: 10,
              lineHeight: 1.55, textAlign: "left", fontSize: "0.86em",
            }}
          >
            {/* Heatmap colour key — same colours as HEAT_STOPS. */}
            <div style={{ margin: 0 }}>
              <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>Heatmap colour · RT60</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {HEAT_LEGEND.map((it) => (
                  <div key={it.range} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span aria-hidden="true" style={{ width: 22, height: 12, borderRadius: 4, flex: "none", background: it.color }} />
                    <span style={{ color: "var(--ink)", flex: "1 1 auto" }}>{it.label}</span>
                    <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{it.range}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* The empty-spot case is reported by the parameter panel above the
                boxes, where it can name the column that is actually missing —
                repeating a vaguer version of it here would just compete. */}
            {["hw1", "hw2"].filter((k) => devices[k].status === "error").map((k) => (
              <div
                key={k}
                className="warn"
                style={{
                  margin: 0, padding: "10px 12px", borderRadius: 8,
                  background: "rgba(255,91,82,0.10)",
                  border: "1px solid rgba(255,91,82,0.30)",
                  lineHeight: 1.55, overflowWrap: "anywhere", hyphens: "auto",
                }}
              >
                {DEVICE_NAMES[k]} not found at “{hrefs[k]}”.
                {k === "hw2" ? " Hardware 1 is shown with Sound heatmap instead." : ""}
              </div>
            ))}
          </div>
          <div style={{ flex: "1 1 auto" }} />
        </section>
        )}
      </div>

      {/* Recommendations */}
      <Recommendations model={model} hasModel={hasModel} counts={counts} />

      {hover && (
        <div className="sim-tip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
          <div className={`hd ${hover.type === "hot" ? "hot" : "dead"}`} style={hover.type === "neutral" ? { color: "var(--sim-neutral)" } : undefined}>
            <span className={`sd ${hover.type === "hot" ? "hot" : "dead"}`} style={hover.type === "neutral" ? { background: "var(--sim-neutral)" } : undefined} />
            {SPOT_LABEL[hover.type] || "Spot"}
          </div>
          {hover.value != null && numish(hover.value) && <div className="ln">Level {Number(hover.value).toLocaleString(undefined, { maximumFractionDigits: 3 })}</div>}
          <div className="ln">Angle {Math.round(bearingOf(hover))}° · {wallOf(bearingOf(hover))}</div>
          <div className="ln faint">x {hover.x.toFixed(2)} m · z {hover.z.toFixed(2)} m</div>
        </div>
      )}
    </div>
  );
}

/* ---- recommendations ---- *
 * The plan is expressed as a REQUIRED weighted sound absorption coefficient
 * (αw, ISO 11654:1997) and the matching sound absorption class from its
 * Annex B — not as a named product. We solve Sabine's equation for the
 * absorption the room is missing, then divide that deficit by the surface
 * available to treat. The result is a rating the installer can shop against,
 * whatever material they end up buying.
 *
 *   RT60 = 0.161 · V / A          (metric Sabine)
 *   A    = 0.161 · V / RT60       -> total absorption, in m² sabins
 *   ΔA   = A_target − A_current   -> what the room is short by
 *   αw   = ᾱ_current + ΔA / S_treated
 * ------------------------------------------------------------------ */
const SABINE_K = 0.161;

/* ISO 11654:1997 Annex B (informative) — sound absorption classes. `min` is
   the lowest αw inside each class, so sizing coverage at `min` guarantees any
   product carrying that class meets the area figure. */
const ISO_CLASSES = [
  { cls: "A", min: 0.90, label: "Extremely absorbing" },
  { cls: "B", min: 0.80, label: "Extremely absorbing" },
  { cls: "C", min: 0.60, label: "Highly absorbing" },
  { cls: "D", min: 0.30, label: "Absorbing" },
  { cls: "E", min: 0.15, label: "Hardly absorbing" },
];
// Classes an absorption plan can be met with, cheapest (lowest) first. Class E
// is "hardly absorbing" and is not offered as treatment.
const TREATMENT_CLASSES = ISO_CLASSES.filter((c) => c.min >= 0.30).slice().reverse();


function roomGeometry(room) {
  const w = room.w, l = room.l, h = room.h || 2.6;
  const walls = 2 * (w + l) * h;
  const ceiling = w * l;
  const floor = w * l;
  return { w, l, h, V: w * l * h, walls, ceiling, floor, total: walls + ceiling + floor };
}

// ISO 11654 §4.1–4.2 quantises αw to steps of 0.05. A *required* value is a
// minimum, so it is rounded UP to the next step — rounding to nearest could
// specify a product that falls just short of the target.
const toAwStep = (v) => Math.ceil(v * 20 - 1e-9) / 20;

/* Sabine assumes a lightly damped, diffuse field. Past ᾱ ≈ 0.2 it overstates
   the absorption present, so switch to Eyring for the same measured RT60. */
const EYRING_LIMIT = 0.2;
function absorptionFor(V, S, rt60) {
  const sab = (SABINE_K * V) / rt60;
  if (sab / S <= EYRING_LIMIT) return { A: sab, model: "Sabine" };
  const aBar = 1 - Math.exp(-(SABINE_K * V) / (rt60 * S));
  return { A: S * aBar, model: "Eyring" };
}

/* ---- sound goal -------------------------------------------------------- *
 * Hotspots and deadspots both have a place in a room; which the client wants
 * depends on what the room is for. The goals use the classifier's own
 * thresholds, nothing new:
 *     below 0.2 s      dead     (deadspot)
 *     0.2 – 0.4 s      neutral  (balanced)
 *     above 0.4 s      live     (hotspot)
 * The CLASSIFICATION and heatmap are untouched — they describe what the room
 * IS. The goal only changes what the recommendation asks for:
 *   - the room-wide RT60 the Sabine / Eyring plan aims at, and
 *   - a verdict for every measured direction: absorb, diffuse, or leave.
 *
 *   Dry       every direction dead        room aims at 0.19 s
 *   Balanced  a mix — Live End–Dead End:  room aims at 0.30 s (band centre)
 *             the north side (the direction the sweep starts from,
 *             the "N" on the twin) stays dead or neutral, the south
 *             side stays neutral or live
 *   Live      every direction live        room aims at 0.41 s
 * Dry and Live aim GOAL_MARGIN past the threshold: the smallest change that
 * actually moves the room into that class (exactly 0.2 s or 0.4 s is still
 * neutral, since the classes are "below 0.2" and "above 0.4").
 * ------------------------------------------------------------------------ */
const ZONE_RANK = { dead: 0, neutral: 1, hot: 2 };
const GOAL_MARGIN = 0.01; // s past the threshold, so the target is inside the class
const rtClass = (rt) => (rt < RT60_LO ? "dead" : rt > RT60_HI ? "hot" : "neutral");
const SOUND_GOALS = [
  { key: "dry", name: "Dry", range: `below ${RT60_LO} s`, use: "Vocal booth · podcast · voice-over",
    room: [0, 0], aim: RT60_LO - GOAL_MARGIN, band: { low: 0, high: RT60_LO },
    blurb: "Quiet everywhere." },
  { key: "balanced", name: "Balanced", range: `${RT60_LO}–${RT60_HI} s`, use: "Home studio · mixing · practice room",
    room: [1, 1], aim: (RT60_LO + RT60_HI) / 2, band: { low: RT60_LO, high: RT60_HI },
    blurb: "Quiet to the north, lively to the south." },
  { key: "live", name: "Live", range: `above ${RT60_HI} s`, use: "Acoustic music · rehearsal · ensemble",
    room: [2, 2], aim: RT60_HI + GOAL_MARGIN, band: { low: RT60_HI, high: Infinity },
    blurb: "Lively everywhere." },
];
const goalOf = (key) => SOUND_GOALS.find((g) => g.key === key) || SOUND_GOALS[1];
// The quiet ("dead") side for the Balanced goal is fixed at north — the
// direction the sweep starts from and the "N" on the twin — so the advice
// always uses the same compass frame as the 3D view.
const QUIET_SIDE_DEG = 0;
// Walls and corners named by compass, matching the N / E / S / W labels on the twin.
const WALL8 = ["North wall", "North-east corner", "East wall", "South-east corner",
  "South wall", "South-west corner", "West wall", "North-west corner"];
const wallOf = (deg) => WALL8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
// Compass bearing of a reading: its own angle, or (X/Y scans) the direction of
// its position from the room centre — north is −z, east is +x.
const bearingOf = (s) => (numish(s.angle)
  ? Number(s.angle)
  : (((Math.atan2(s.x, -s.z) * 180) / Math.PI) + 360) % 360);
const angGap = (a, b) => { const d = (((a - b) % 360) + 360) % 360; return d > 180 ? 360 - d : d; };

/* Which classes a reading at `bearing` may be in, for this goal (as ranks). */
function zoneFor(goal, bearing) {
  if (goal.key === "dry") return { side: "dead", ok: [0, 0] };
  if (goal.key === "live") return { side: "live", ok: [2, 2] };
  return angGap(bearing, QUIET_SIDE_DEG) <= 90
    ? { side: "dead", ok: [0, 1] }   // north half: dead or neutral, not live
    : { side: "live", ok: [1, 2] };  // south half: neutral or live, not dead
}

/* One verdict per measured reading: livelier than its zone allows → absorb,
   deader than its zone allows → diffuse / reflect, otherwise leave it. The
   class comes from the RT60 value (same thresholds as the classifier), or
   from the sheet's label when a reading has no value. */
function zoneVerdicts(spots, goal) {
  return (spots || []).map((s, i) => {
    const bearing = bearingOf(s);
    const zone = zoneFor(goal, bearing);
    const cls = numish(s.value) ? rtClass(Number(s.value)) : (s.type in ZONE_RANK ? s.type : "neutral");
    const r = ZONE_RANK[cls];
    const action = r > zone.ok[1] ? "absorb" : r < zone.ok[0] ? "diffuse" : "leave";
    return { ...s, idx: i + 1, bearing, zone, cls, action };
  });
}
/* Room-wide: is the room's average RT60 too live, too dead, or right? */
const roomState = (rt, goal) => {
  const r = ZONE_RANK[rtClass(rt)];
  return r > goal.room[1] ? "echoey" : r < goal.room[0] ? "dead" : "ok";
};

function acousticPlan(room, rt60, aimRt = (RT60_TARGET.low + RT60_TARGET.high) / 2) {
  if (!room?.w || !room?.l || !numish(rt60) || rt60 <= 0) return null;
  const g = roomGeometry(room);
  const aim = aimRt;

  const cur = absorptionFor(g.V, g.total, rt60);
  const model = cur.model;
  const Acur = cur.A;                        // absorption the room has now
  const Aaim = absorptionFor(g.V, g.total, aim).A; // absorption it needs
  const dA = Aaim - Acur;                    // + = add absorption, − = remove it
  const aBar = Acur / g.total;               // current average coefficient

  // Floor is left out of the treatable area — it carries furniture and traffic,
  // so walls + ceiling is what a real install can actually reach.
  const treatable = g.walls + g.ceiling;
  const awRaw = aBar + dA / treatable;
  const awFull = Math.max(0, Math.min(1, toAwStep(awRaw)));
  const feasible = awRaw <= 1.0;

  // Partial coverage: how much area each ISO class would have to cover, sized
  // at the class's lowest αw.
  const coverage = TREATMENT_CLASSES.map(({ cls, min, label }) => {
    const gain = min - aBar;                 // net absorption gained per m²
    const area = gain > 0 ? dA / gain : Infinity;
    return { cls, aw: min, label, area, pct: (area / treatable) * 100, ok: area > 0 && area <= treatable };
  });

  // A full-surface answer below Class D (αw < 0.30) is real but is not an
  // absorber anyone sells as treatment. In that case the honest recommendation
  // is a rated absorber over a smaller area, so pick the lowest class that fits.
  const practical = awFull < 0.30 ? coverage.find((c) => c.ok) || null : null;

  return { ...g, rt60, aim, model, Acur, Aaim, dA, aBar, treatable, awFull, awRaw, feasible, coverage, practical };
}

/* ---- placement -------------------------------------------------------- *
 * Sabine gives a whole-room quantity and has no coordinates in it. The spot
 * map is what carries location. So: the plan decides HOW MUCH panel to buy,
 * this decides WHERE it goes.
 *
 * Eligibility comes from the Classification tab's label, not from a threshold
 * computed here — hotspots are treated, neutral zones and deadspots are not.
 * The measured value is used only to weight the split between hotspots, and
 * when no value column is present the split is even.
 * ---------------------------------------------------------------------- */
function allocateToSpots(spots, totalArea, eligible = (s) => s.type === "hot") {
  const all = (spots || []).map((s, i) => ({ ...s, idx: s.idx ?? i + 1 }));
  if (!all.length || !numish(totalArea) || totalArea <= 0) return null;

  // Which readings take absorber: those the sound goal marked "absorb"
  // (see zoneVerdicts). Default, with no goal, is the hotspot label.
  const hot = all.filter(eligible);
  if (!hot.length) return null;

  // Field statistics are taken across every reading, so the diffusion check
  // reflects the whole room rather than just the treated points.
  const vals = all.map((s) => s.value).filter(numish);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const sd = vals.length && mean
    ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length)
    : 0;

  // Weight by how far each hotspot sits above the room mean. Any hotspot at or
  // below the mean still gets a floor share — the sheet classified it as hot,
  // so it is not silently dropped.
  const FLOOR = 0.15;
  const weighted = hot.map((s) => ({
    ...s,
    weight: numish(s.value) && numish(mean) ? Math.max(FLOOR, s.value - mean) : 1,
  }));
  const sum = weighted.reduce((a, s) => a + s.weight, 0);

  const rows = weighted
    .map((s) => ({ ...s, share: s.weight / sum, area: (s.weight / sum) * totalArea }))
    .sort((a, b) => b.area - a.area);

  return {
    rows,
    mean,
    hotCount: hot.length,
    skipped: all.length - hot.length,
    deadCount: all.filter((s) => s.type === "dead").length,
    cv: mean > 0 ? sd / mean : 0,      // spread of the field, used as a diffusion check
    diffuse: mean > 0 ? sd / mean <= 0.15 : true,
    weighted: vals.length > 0,
    totalArea,
  };
}

/* ---- consumer guide ------------------------------------------------------ *
 * The recommendation, told for someone who has never heard of RT60 or αw.
 * Same numbers as the technical cards (acousticPlan / allocateToSpots), just
 * said in plain words: a verdict, an echo gauge, and three steps — what to
 * buy, where to put it, where not to. The panel grade is picked here and
 * every amount below it updates. The original tables stay one click away
 * under "Technical details" for the panel review.
 * ------------------------------------------------------------------------ */



// Put an area into a size a person can picture: the side of an equal square.
// Deliberately names no material or product; only size, grade and thickness.
function relatableArea(m2) {
  if (!numish(m2) || m2 <= 0) return "";
  const side = Math.sqrt(m2);
  if (side < 1) {
    const cm = Math.ceil((side * 100) / 5) * 5;
    return `about the size of a ${cm} × ${cm} cm square`;
  }
  return `about the size of a ${side.toFixed(1)} × ${side.toFixed(1)} m square`;
}

/* ---- absorber thickness ------------------------------------------------ *
 * Thicker absorption stops lower sounds. The minimum thickness for a sound of
 * frequency f is a quarter of its wavelength, λ/4 = c / 4f: in front of a
 * solid wall the air moves most a quarter wavelength out, so that is where a
 * porous absorber must reach to work. Shown to users in plain words; the
 * formula and sources sit under "Technical details" (ThicknessBasis).
 *   Cox, T. J. & D'Antonio, P. (2016). Acoustic Absorbers and Diffusers:
 *     Theory, Design and Application (3rd ed.). CRC Press.
 *   Kuttruff, H. (2016). Room Acoustics (6th ed.). CRC Press.
 * ----------------------------------------------------------------------- */
const SPEED_OF_SOUND = 343; // m/s, air at 20 °C
const THICKNESS_BANDS = [
  { f: 250,  what: "Deep bass, like drums" },
  { f: 500,  what: "Low voices and bass notes" },
  { f: 1000, what: "Most of normal speech" },
  { f: 2000, what: "Crisp speech sounds" },
  { f: 4000, what: "Hiss and sharp \"s\" sounds" },
];
const quarterWaveMm = (f) => Math.ceil(((SPEED_OF_SOUND / (4 * f)) * 1000) / 5) * 5;
const cmText = (mm) => `${(mm / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} cm`;

function ThicknessGuide({ bands, room }) {
  const lowest = bands && bands.length ? bands[0] : null;
  // The row that covers the lowest band the scan measured (250–4000 Hz).
  const focus = lowest == null
    ? null
    : THICKNESS_BANDS.reduce((best, r) => (r.f <= Math.max(lowest, 250) ? r.f : best), 250);
  const shortWall = Math.min(room?.w || Infinity, room?.l || Infinity);
  const tooThick = (f) => Number.isFinite(shortWall) && quarterWaveMm(f) / 1000 > shortWall * 0.25;

  const cell = { padding: "6px 10px", textAlign: "left", verticalAlign: "top" };
  const head = { ...cell, fontWeight: 600, opacity: 0.7, borderBottom: "1px solid rgba(255,255,255,0.10)", whiteSpace: "nowrap" };

  return (
    <div style={{ marginTop: 14 }}>
      <p>
        <b>How thick?</b> Thicker absorption stops lower sounds.{" "}
        {focus
          ? <>Your scan picked up sound as low as {lowest} Hz, so use absorption at least <b>{cmText(quarterWaveMm(focus))}</b> thick.</>
          : <>Find the lowest sound you want to reduce:</>}
      </p>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.9em", maxWidth: 480, width: "100%" }}>
          <thead>
            <tr>
              <th style={head}>To reduce echo in</th>
              <th style={head}>Use at least</th>
            </tr>
          </thead>
          <tbody>
            {THICKNESS_BANDS.map(({ f, what }) => (
              <tr key={f} style={f === focus ? { color: "var(--orange)", fontWeight: 700 } : undefined}>
                <td style={cell}>
                  {what}
                  <span style={{ opacity: 0.55, fontWeight: 400 }}> · {f.toLocaleString()} Hz</span>
                </td>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>
                  {cmText(quarterWaveMm(f))}
                  {tooThick(f) && <span style={{ opacity: 0.55, fontWeight: 400 }}> · too thick for this room</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* One-line version for the consumer guide: the thickness for the lowest sound
   the scan measured, or the thickest that still fits the room if that is too
   deep (same rule and numbers as ThicknessGuide). */
function ThicknessLine({ bands, room }) {
  const lowest = bands && bands.length ? bands[0] : null;
  const shortWall = Math.min(room?.w || Infinity, room?.l || Infinity);
  const fits = (f) => !Number.isFinite(shortWall) || quarterWaveMm(f) / 1000 <= shortWall * 0.25;
  const want = lowest == null ? 1000
    : THICKNESS_BANDS.reduce((best, r) => (r.f <= Math.max(lowest, 250) ? r.f : best), 250);
  const pick = THICKNESS_BANDS.find((r) => r.f >= want && fits(r.f)) || THICKNESS_BANDS[THICKNESS_BANDS.length - 1];
  return (
    <><b>{cmText(quarterWaveMm(pick.f))}</b> thick{" "}
      <span style={{ color: "var(--muted)" }}>· stops echo down to {pick.what.toLowerCase()}</span></>
  );
}

const areaText = (m2) => (m2 < 0.1 ? `${(m2 * 10000).toFixed(0)} cm²` : `${m2.toFixed(2)} m²`);


function EchoGauge({ rt, band = RT60_TARGET, label = null }) {
  const max = Math.max(1, rt * 1.15, RT60_HI * 1.6);
  const pct = (v) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
  const goalText = label || `${band.low}–${band.high} s`;
  return (
    <div className="rg-gauge" role="img"
      aria-label={`Echo time ${rt.toFixed(2)} seconds; goal ${goalText}`}>
      <div className="rg-gauge-track" style={{ background: heatGradient(0, max) }}>
        <span className="rg-gauge-goal" style={{ "--from": pct(band.low), "--to": pct(Math.min(band.high, max)) }} />
        <span className="rg-gauge-you" style={{ "--at": pct(rt) }}>
          <span className="rg-gauge-tag">Your room {rt.toFixed(2)} s</span>
        </span>
      </div>
      <div className="rg-gauge-scale">
        <span>Dead</span>
        <span className="rg-gauge-goal-label" style={{ "--from": pct(band.low), "--to": pct(Math.min(band.high, max)) }}>
          Goal {goalText}
        </span>
        <span>Live</span>
      </div>
    </div>
  );
}

/* ---- client-facing rating: NRC ----------------------------------------- *
 * NRC (Noise Reduction Coefficient, ASTM C634; measured per ASTM C423) is the
 * single 0–1 number printed on most acoustic product labels: the average
 * absorption coefficient at 250, 500, 1000 and 2000 Hz, rounded to 0.05.
 * The consumer guide sizes coverage with it the same way the ISO 11654 plan
 * does with αw: area = ΔA / (NRC − ᾱ). NRC stands in for α as a mid-frequency
 * average, so — like αw — it says nothing below 250 Hz; the thickness line
 * (quarter wavelength) covers the low end.
 * Materials are named as a FAMILY (porous absorbers), not as products: per
 * the team's acoustics expert, porous absorbers behave alike and thickness
 * decides what they stop. The label's NRC and the thickness are what the
 * client checks. Curtains and carpet are left out — their absorption swings
 * too much with weight, folds and air gap to promise a figure.
 * ------------------------------------------------------------------------ */
const NRC_STEPS = [0.50, 0.70, 0.90];
const POROUS_FAMILY = ["acoustic foam", "fibreglass or mineral-wool panels", "polyester (PET) felt panels"];
function nrcOptions(plan) {
  if (!plan || !(plan.dA > 0)) return [];
  return NRC_STEPS.map((nrc) => {
    const gain = nrc - plan.aBar;
    const area = gain > 0 ? plan.dA / gain : Infinity;
    return { nrc, area, ok: area > 0 && area <= plan.treatable };
  });
}

function NrcRecommendation({ plan, bands, room }) {
  const opts = nrcOptions(plan);
  const main = opts.find((o) => o.ok);
  if (!main) {
    return (
      <p>
        Even covering every wall and the ceiling won't be enough here. The room needs absorption placed
        inside the space as well, not only on the walls.
      </p>
    );
  }
  const better = opts.filter((o) => o.ok && o.nrc > main.nrc);
  const sq = (a) => relatableArea(a).replace("about the size of a ", "≈ ");
  return (
    <>
      <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 14px", alignItems: "baseline" }}>
        <b>Use any of these</b>
        <span>{POROUS_FAMILY.join(", ").replace(/, ([^,]*)$/, " or $1")}</span>
        <b>Rated</b>
        <span><b>NRC {main.nrc.toFixed(2)}</b> or higher <span style={{ color: "var(--muted)" }}>· printed on the label</span></span>
        <b>At least</b>
        <span><ThicknessLine bands={bands} room={room} /></span>
        <b>Cover</b>
        <span>
          about <b>{areaText(main.area)}</b> <span style={{ color: "var(--muted)" }}>({sq(main.area)})</span>
          {better.length > 0 && (
            <div style={{ color: "var(--muted)", marginTop: 2 }}>
              Higher NRC, less to cover: {better.map((o) => `NRC ${o.nrc.toFixed(2)} → ${areaText(o.area)}`).join(" · ")}
            </div>
          )}
        </span>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.9em", fontWeight: 600 }}>What is NRC, and why this thickness?</summary>
        <p className="rg-hint" style={{ marginTop: 8 }}>
          NRC is a 0–1 rating of how much sound a material soaks up — NRC 0.70 soaks up about 70%. It is measured in a
          lab (ASTM C423) and covers normal speech and music, not deep bass; thickness takes care of the bass.
        </p>
        <ThicknessGuide bands={bands} room={room} />
      </details>
    </>
  );
}

function GoalPicker({ value, onChange }) {
  return (
    <div className="rg-grades" role="radiogroup" aria-label="Sound goal">
      {SOUND_GOALS.map((g) => (
        <button
          key={g.key}
          type="button"
          role="radio"
          aria-checked={value === g.key}
          className={`rg-grade${value === g.key ? " on" : ""}`}
          onClick={() => onChange(g.key)}
        >
          <span className="rg-grade-name">{g.name}</span>
          <span className="rg-grade-cls">
            {g.range}
          </span>
          <span className="rg-grade-note">{g.use}</span>
          <span className="rg-grade-note">{g.blurb}</span>
        </button>
      ))}
    </div>
  );
}

const ACTION_UI = {
  absorb: { label: "Absorb", color: "var(--bad)", hint: "add absorption on this side" },
  diffuse: { label: "Diffuse", color: "var(--sim-dead)", hint: "add diffusion or a reflective surface" },
  leave: { label: "Leave", color: "var(--ok)", hint: "already right for this side" },
};

/* Zone-by-zone verdicts: every measured direction, what it reads, which side
   of the room it belongs to, and what to do there for the chosen goal. */
function ZoneTable({ zones, goal, alloc }) {
  if (!zones.length) return null;
  const areaBy = new Map((alloc?.rows || []).map((r) => [r.idx, r.area]));
  const cell = { padding: "6px 10px", textAlign: "left", whiteSpace: "nowrap", verticalAlign: "middle", color: "var(--ink)" };
  const head = { ...cell, fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid rgba(255,255,255,0.10)" };
  const showSide = goal.key === "balanced";
  return (
    <div style={{ marginTop: 10, overflowX: "auto", maxWidth: "100%" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "0.9em", width: "100%", maxWidth: 720 }}>
        <thead>
          <tr>
            <th style={head}>Where</th>
            {showSide && <th style={head}>Side</th>}
            <th style={head}>Reading</th>
            <th style={head}>Do</th>
            {alloc && <th style={{ ...head, textAlign: "right" }}>Absorber</th>}
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => {
            const a = ACTION_UI[z.action];
            const rt = numish(z.value) ? Number(z.value) : null;
            return (
              <tr key={z.idx} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={cell}>{wallOf(z.bearing)} <span style={{ color: "var(--muted)" }}>· {Math.round(z.bearing)}°</span></td>
                {showSide && <td style={cell}>{z.zone.side === "dead" ? "Quiet side" : "Lively side"}</td>}
                <td style={cell}>
                  <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, marginRight: 7, background: rtToCss(heatRt(z)) }} />
                  {SPOT_LABEL[z.type] || "Spot"}{rt != null ? ` · ${Number(rt.toFixed(3))} s` : ""}
                </td>
                <td style={cell} title={a.hint}>
                  <span style={{
                    padding: "2px 9px", borderRadius: 999, fontWeight: 700, fontSize: "0.92em", color: a.color,
                    background: `color-mix(in srgb, ${a.color} 14%, transparent)`,
                  }}>{a.label}</span>
                </td>
                {alloc && <td style={{ ...cell, textAlign: "right" }}>{areaBy.has(z.idx) ? `${areaBy.get(z.idx).toFixed(1)} m²` : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---- where to make changes (plain words) -------------------------------- *
 * The per-direction verdicts from zoneVerdicts, grouped by wall so a full
 * 360° sweep (~90 readings) reads as a handful of plain instructions:
 * add absorption here, add diffusion here, leave these alone. The full
 * per-reading table stays one click away (ZoneTable).
 * ------------------------------------------------------------------------ */
function WhereToAct({ zones, goal, alloc }) {
  const shareBy = new Map((alloc?.rows || []).map((r) => [r.idx, r.share]));
  // Group readings by the wall / corner they point at, keeping compass order.
  const groups = [];
  zones.forEach((z) => {
    const wall = wallOf(z.bearing);
    let g = groups.find((x) => x.wall === wall);
    if (!g) { g = { wall, sector: WALL8.indexOf(wall), all: 0, absorb: [], diffuse: [], marked: 0 }; groups.push(g); }
    g.all += 1;
    if (z.action === "leave" && z.cls !== "neutral") g.marked += 1;
    if (z.action === "absorb") g.absorb.push(z);
    if (z.action === "diffuse") g.diffuse.push(z);
  });
  groups.sort((a, b) => a.sector - b.sector);

  const intro = {
    dry: "Goal: quiet everywhere.",
    balanced: "Goal: quiet toward the north wall, lively toward the south wall. Set up so you face north (the N on the 3D view).",
    live: "Goal: lively everywhere.",
  }[goal.key];

  const absorbAt = groups.filter((g) => g.absorb.length);
  const diffuseAt = groups.filter((g) => g.diffuse.length);
  const fineAt = groups.filter((g) => !g.absorb.length && !g.diffuse.length);
  const short = (wall) => wall;

  const chip = (color, text, key) => (
    <span key={key} style={{
      display: "inline-block", margin: "3px 6px 3px 0", padding: "3px 10px", borderRadius: 999,
      fontSize: "0.92em", fontWeight: 600, color: "var(--ink)",
      background: `color-mix(in srgb, ${color} 16%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
    }}>{text}</span>
  );
  const row = (color, label, items, note) => (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginTop: 8, flexWrap: "wrap" }}>
      <span style={{ flex: "0 0 92px", fontWeight: 700, color }}>{label}</span>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        {items}
        {note && <div className="rg-hint" style={{ marginTop: 2 }}>{note}</div>}
      </div>
    </div>
  );

  return (
    <>
      <p style={{ margin: "2px 0 4px" }}>{intro}</p>
      {absorbAt.length > 0 && row("var(--bad)", "Absorb",
        absorbAt.map((g) => {
          const share = g.absorb.reduce((s, z) => s + (shareBy.get(z.idx) || 0), 0);
          return chip("var(--bad)", `${short(g.wall)}${share > 0 ? ` · ${Math.round(share * 100)}%` : ""}`, g.wall);
        }),
        alloc ? "% = share of the step 1 area to put on that side." : "Use the absorbers from step 1 (NRC on the label).")}
      {diffuseAt.length > 0 && row("var(--sim-dead)", "Liven up",
        diffuseAt.map((g) => chip("var(--sim-dead)", short(g.wall), g.wall)),
        "Keep these surfaces hard — no foam, fibreglass or felt panels. Add a diffuser if needed.")}
      {fineAt.length > 0 && row("var(--ok)", "Leave",
        fineAt.map((g) => chip("var(--ok)", short(g.wall), g.wall)))}
    </>
  );
}

function RecommendationGuide({ model, counts, goal, onGoal }) {
  const rt = model.rt60;
  const band = goal.band;
  const plan = numish(rt) ? acousticPlan(model.room, rt, goal.aim) : null;
  const zones = zoneVerdicts(model.spots, goal);
  const nAbsorb = zones.filter((z) => z.action === "absorb").length;
  const nDiffuse = zones.filter((z) => z.action === "diffuse").length;

  // Default grade = the one the technical plan already settled on.
  const fallback = plan && plan.dA > 0 ? (plan.practical || plan.coverage.find((c) => c.ok)) : null;
  const chosen = fallback; // the suggested row; wall shares below are % so they hold for any row
  const alloc = chosen ? allocateToSpots(zones, chosen.area, (z) => z.action === "absorb") : null;

  const goalStep = (
    <div className="rg-step">
      <span className="rg-step-num" style={{ background: "var(--violet)" }}>★</span>
      <div className="rg-step-body">
        <div className="rg-step-title">What is this room for?</div>
        <p>Pick the sound you want. The advice below follows it.</p>
        <GoalPicker value={goal.key} onChange={onGoal} />
      </div>
    </div>
  );

  if (!numish(rt)) {
    return (
      <div className="rg">
        {goalStep}
        <div className="rg-verdict" data-tone="warn">
          <div className="rg-verdict-title">We couldn't measure the echo yet</div>
          <p className="rg-lead">
            The scan came through without a reverberation reading, so there's nothing to judge the room by.
            Run the sound pass on the device again and re-deploy the scan.
          </p>
        </div>
      </div>
    );
  }

  const state = roomState(rt, goal);
  const verdict = {
    echoey: {
      tone: "bad", title: `Too much echo for a ${goal.name.toLowerCase()} room`,
      lead: `Sound keeps bouncing around for ${rt.toFixed(2)} seconds before it fades. A ${goal.name.toLowerCase()} room fades ${goal.range === `${RT60_LO}–${RT60_HI} s` ? `in ${goal.range}` : goal.range}, so this room holds on too long. We aim to bring it to ${goal.aim.toFixed(2)} s.`,
    },
    dead: {
      tone: "cool", title: `Too dry for a ${goal.name.toLowerCase()} room`,
      lead: `Sound dies away after only ${rt.toFixed(2)} seconds. A ${goal.name.toLowerCase()} room fades ${goal.range === `${RT60_LO}–${RT60_HI} s` ? `in ${goal.range}` : goal.range}, so right now it sounds flatter than you want. We aim to bring it to ${goal.aim.toFixed(2)} s.`,
    },
    ok: {
      tone: "ok", title: `On target for a ${goal.name.toLowerCase()} room`,
      lead: `Sound fades in ${rt.toFixed(2)} seconds, within the ${goal.name.toLowerCase()} goal (${goal.range}). Overall, the room doesn't need more or less absorption.`,
    },
  }[state];

  const tips = [];
  if (alloc && !alloc.diffuse) tips.push({
    icon: Target, title: "Where matters more than how much",
    body: "Sound is uneven across this room, so placing absorption in the right spots will do more than adding more of it.",
  });
  if (plan && plan.dA > 0) tips.push({
    icon: Volume2, title: "Low frequencies need more thickness",
    body: "Thin absorption only stops high sounds. If deep sounds still echo, go thicker (see step 1).",
  });
  if (!numish(model.room?.h)) tips.push({
    icon: AlertTriangle, title: "Ceiling height was guessed",
    body: "The scan didn't include the room height, so we assumed 2.6 m. Re-scan for exact amounts.",
  });

  let n = 0;
  return (
    <div className="rg">
      {goalStep}

      <div className="rg-verdict" data-tone={verdict.tone}>
        <div className="rg-verdict-title">{verdict.title}</div>
        <p className="rg-lead">{verdict.lead}</p>
        <EchoGauge rt={rt} band={band} label={goal.range} />
      </div>

      {state === "ok" && nAbsorb === 0 && nDiffuse === 0 && (
        <div className="rg-step">
          <span className="rg-step-num">{++n}</span>
          <div className="rg-step-body">
            <div className="rg-step-title">Keep the room as it is</div>
            <p>Every measured direction already fits a {goal.name.toLowerCase()} room. If anything in the room changes, scan again.</p>
          </div>
        </div>
      )}

      {state === "dead" && (
        <div className="rg-step">
          <span className="rg-step-num">{++n}</span>
          <div className="rg-step-body">
            <div className="rg-step-title">Bring back some reflection</div>
            <p>
              {plan
                ? `Remove roughly ${areaText(Math.abs(plan.dA))} of absorption (${relatableArea(Math.abs(plan.dA))}), or cover the same area with a hard, reflective or diffusing surface.`
                : "Remove some absorption, or add a hard, reflective surface. Scan the room size to get an exact amount."}
            </p>
          </div>
        </div>
      )}

      {state === "echoey" && (
        <div className="rg-step">
          <span className="rg-step-num">{++n}</span>
          <div className="rg-step-body">
            <div className="rg-step-title">Add sound absorption</div>
            {!plan ? (
              <p>Scan the room's size so we can work out how much absorption you need.</p>
            ) : !chosen ? (
              <p>
                Even covering every wall and the ceiling won't be enough here. The room needs absorption placed
                inside the space as well, not only on the walls.
              </p>
            ) : (
              <>
                <NrcRecommendation plan={plan} bands={model.bands} room={model.room} />
              </>
            )}
          </div>
        </div>
      )}

      {zones.length > 0 && (
        <div className="rg-step">
          <span className="rg-step-num">{++n}</span>
          <div className="rg-step-body">
            <div className="rg-step-title">Where to make changes</div>
            <WhereToAct zones={zones} goal={goal} alloc={state === "echoey" ? alloc : null} />
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.9em", fontWeight: 600 }}>
                See every reading ({zones.length})
              </summary>
              <ZoneTable zones={zones} goal={goal} alloc={state === "echoey" ? alloc : null} />
            </details>
          </div>
        </div>
      )}

      {tips.length > 0 && (
        <div className="rg-tips">
          {tips.map((t, i) => {
            const Icon = t.icon;
            return (
              <div key={i} className="rg-tip">
                <Icon size={15} color="var(--warn)" />
                <div><b>{t.title}.</b> {t.body}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Recommendations({ model, hasModel, counts }) {
  // The client's sound goal. Default: Balanced.
  const [goalKey, setGoalKey] = useState("balanced");
  const goal = goalOf(goalKey);
  return (
    <section className="rec">
      <div className="rec-head">
        <span className="ic"><Target size={16} color="var(--orange)" /></span>
        <div><div className="t">Recommendations</div><div className="s">What your scan found, and what to change for the sound you want</div></div>
      </div>
      {!hasModel ? (
        <div className="rec-empty">Deploy a room scan to see how your room sounds and what to change.</div>
      ) : (
        <>
          <RecommendationGuide key={`${model.rt60}|${goalKey}`} model={model} counts={counts}
            goal={goal} onGoal={setGoalKey} />
        </>
      )}
    </section>
  );
}

/* ---- parameter audit panel ----
 * One block above the boxes, errors before warnings. Each entry names the
 * parameter and says what stops working without it, so the fix is obvious
 * without opening the sheet to guess. */
function IssuePanel({ errors = [], warnings = [] }) {
  if (!errors.length && !warnings.length) return null;
  const items = [
    ...errors.map((e) => ({ ...e, err: true })),
    ...warnings.map((w) => ({ ...w, err: false })),
  ];
  return (
    <section
      style={{
        display: "flex", flexDirection: "column", gap: 8,
        margin: "0 0 16px", minWidth: 0,
      }}
    >
      {items.map((it, i) => (
        <div
          key={i}
          role={it.err ? "alert" : "status"}
          style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "10px 12px", borderRadius: 8,
            fontSize: "0.86em", lineHeight: 1.55, overflowWrap: "anywhere",
            background: it.err ? "rgba(255,91,82,0.10)" : "rgba(246,161,92,0.10)",
            border: `1px solid ${it.err ? "rgba(255,91,82,0.30)" : "rgba(246,161,92,0.30)"}`,
          }}
        >
          <span style={{ flex: "0 0 auto", marginTop: 1 }}>
            {it.err ? <AlertCircle size={15} color="var(--bad)" /> : <AlertTriangle size={15} color="var(--warn)" />}
          </span>
          <div style={{ minWidth: 0 }}>
            <b>{it.title}.</b> {it.body}
          </div>
        </div>
      ))}
    </section>
  );
}

/* ---- small bits ---- */
function LayerRow({ tone, label, on, onClick, disabled }) {
  return (
    <label
      className={`layer-row${disabled ? " disabled" : ""}`}
      style={{ fontSize: "0.86em", paddingTop: 5, paddingBottom: 5 }}
    >
      <input type="checkbox" checked={!!on} onChange={onClick} disabled={disabled} />
      <span className="layer-box" style={{ transform: "scale(0.88)" }}><svg viewBox="0 0 24 24" fill="none" stroke="#17131f" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
      <span className={`layer-dot ${tone}`} />
      <span className="layer-name" style={{ fontSize: "0.94em", fontWeight: 600 }}>{label}</span>
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
  // One prototype at a time: Hardware 2 while Sound heatmap is on (if it
  // loaded), Hardware 1 otherwise.
  const sound = layers.spots && !!groups.device2;
  if (groups.device1) groups.device1.visible = layers.device && !sound;
  if (groups.device2) groups.device2.visible = layers.device && sound;
}
function disposeDeep(obj) {
  obj.traverse?.((c) => {
    if (c.geometry) c.geometry.dispose?.();
    if (c.material) { Array.isArray(c.material) ? c.material.forEach((m) => m.dispose?.()) : c.material.dispose?.(); }
  });
  if (obj.geometry) obj.geometry.dispose?.();
  if (obj.material) { Array.isArray(obj.material) ? obj.material.forEach((m) => m.dispose?.()) : obj.material.dispose?.(); }
}