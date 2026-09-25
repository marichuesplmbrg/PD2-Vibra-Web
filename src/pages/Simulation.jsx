import React, { useState, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { Play, Pause, RotateCw, Radio, Target, TrendingDown, TrendingUp, CheckCircle2, Volume2, AlertCircle, AlertTriangle } from "lucide-react";
import { vibraHistory } from "./vibraHistory";

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


/* Soft radial falloff used as the spot glow. One canvas, reused by every
   marker and tinted per-spot through the sprite material's colour. White so
   the tint is exact; additive blending makes it read as light, not paint. */
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const S = 128, c = S / 2;
  const cv = document.createElement("canvas"); cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0.00, "rgba(255,255,255,0.50)");
  g.addColorStop(0.18, "rgba(255,255,255,0.28)");
  g.addColorStop(0.45, "rgba(255,255,255,0.11)");
  g.addColorStop(0.72, "rgba(255,255,255,0.035)");
  g.addColorStop(1.00, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  _glowTex = new THREE.CanvasTexture(cv);
  _glowTex.minFilter = THREE.LinearFilter;
  return _glowTex;
}

// Where the prototype STLs are served from — put both files in your app's
// /public/models/ folder. `deviceUrl` / `soundDeviceUrl` props override them.
//   Hardware_1.stl — the default prototype shown in the twin.
//   Hardware_2.stl — shown instead while the Imbalanced sound layer is on.
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
      metricI: colIdx(e.cols, RX_METRIC),
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

function parseDeployment(dep) {
  if (!dep) return null;
  // A deployment record can exist while carrying nothing usable — an empty
  // bundle, a cleared table, or a stale entry whose dimension fields are still
  // populated. Reject those here so the page treats them as "not deployed".
  const tabsRaw = dep.tabs || {};
  const hasAnyRow = Object.values(tabsRaw).some((t) => Array.isArray(t?.rows) && t.rows.length > 0);
  if (!hasAnyRow) return null;

  const dims = dep.dims || {};
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
      const out = c.rows.map((r) => {
        if (!hasLabel(r)) return null;
        const deg = parseFloat(r[c.angleI]);
        if (!numish(deg)) return null;
        const rad = (deg * Math.PI) / 180;
        const dx = Math.cos(rad), dz = Math.sin(rad);
        const tx = Math.abs(dx) < 1e-6 ? Infinity : hx / Math.abs(dx);
        const tz = Math.abs(dz) < 1e-6 ? Infinity : hz / Math.abs(dz);
        const tt = Math.min(tx, tz); // first wall the bearing meets
        if (!isFinite(tt)) return null;
        return { x: dx * tt, z: dz * tt, type: readType(r), value: readValue(r), angle: deg };
      }).filter(Boolean);
      if (out.length) {
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

  return { room, rawPoints, spots, spotsFrom, rt60, roomTs: dep.roomTs, at: dep.at };
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
  const d = dep.dims || {};
  const ok = (v) => numish(v) && +v > 0;
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
    const mi = colIdx(cls.cols, RX_METRIC);

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

export default function SimulationPage({ deviceUrl, soundDeviceUrl, twinOnly = false } = {}) {
  const [dep, setDep] = useState(() => vibraHistory.getDeployment());
  const [orbiting, setOrbiting] = useState(true);
  // Default view: only the room shell and its raw points; everything else is opt-in.
  const [layers, setLayers] = useState({ shell: true, edges: false, raw: true, spots: false, omni: false, device: false });
  const [hover, setHover] = useState(null);
  const hrefs = { hw1: deviceUrl || DEVICE_URLS.hw1, hw2: soundDeviceUrl || DEVICE_URLS.hw2 };
  const [devices, setDevices] = useState({ hw1: { geo: null, status: "loading" }, hw2: { geo: null, status: "loading" } });
  // Which prototype the twin shows: Hardware 2 while Imbalanced sound is on
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
    const cOff = Math.max(1.5 * k, Math.max(w, l) * 0.35);
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

      // Marker size follows the room's physical scale instead of a fixed 0.15 m.
      // Base: 7 % of the smallest room dimension (≈0.21 m in a 3 m room).
      // Cap: 45 % of the tightest spacing between spots, so neighbouring
      // readings stay distinct instead of merging into one blob.
      const minDim = Math.max(0.05, Math.min(w, l, h));
      let nearest = Infinity;
      for (let i = 0; i < model.spots.length; i++) {
        for (let j = i + 1; j < model.spots.length; j++) {
          const d = Math.hypot(model.spots[i].x - model.spots[j].x, model.spots[i].z - model.spots[j].z);
          if (d > 1e-4 && d < nearest) nearest = d;
        }
      }
      const coreR = Math.max(0.004, Math.min(minDim * 0.07, Number.isFinite(nearest) ? nearest * 0.45 : Infinity));
      const glowS = coreR * 6.3;   // keeps the old 0.15 : 0.95 core-to-glow ratio
      const hitR = coreR * 2.3;    // keeps the old 0.15 : 0.34 pick-target ratio
      model.spots.forEach((s) => {
        const col = s.type === "hot" ? COL.hot : s.type === "neutral" ? COL.neutral : COL.dead;
        const info = { type: s.type, value: s.value, x: s.x, z: s.z, angle: s.angle };
        // Solid, slightly deepened body so the marker reads as an object with a
        // colour rather than a blown-out light source. The glow is carried by
        // the sprite behind it, not by over-driving the surface.
        const solid = new THREE.Color(col).multiplyScalar(0.82);
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(coreR, 24, 18),
          new THREE.MeshStandardMaterial({
            color: solid, emissive: solid, emissiveIntensity: 0.16,
            roughness: 0.55, metalness: 0.0,
          })
        );
        core.position.set(s.x, y, s.z); core.userData = info;

        // Billboarded glow. Additive so overlapping markers bloom together
        // instead of stacking into flat opaque discs.
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture(), color: col, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9,
        }));
        glow.position.copy(core.position);
        glow.scale.set(glowS, glowS, 1);
        glow.renderOrder = 5;

        // Invisible but pickable, so hover keeps the old generous target size.
        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(hitR, 12, 10),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        );
        hit.position.copy(core.position); hit.userData = info;

        spotGroup.add(glow, core, hit);
        pick.push(core, hit);
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
      const s = spec.size / (spec.pin === "long" ? devLong : devH);
      heights[key] = devH * s; // real standing height, used to frame the camera
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
              <div className="small">{audit.errors[0]?.body || "The deployed scan is incomplete."}</div>
            </div>
          ) : (
            <div className="sim-empty">
              <Radio size={26} color="var(--faint)" />
              <div className="big">Nothing deployed yet.</div>
              <div className="small">Deploy a room scan from the Parameters table.</div>
            </div>
          )
        )}
        {hasModel && <div className="sim-hint2">drag to orbit · scroll to zoom</div>}
        {hover && (
          <div className="sim-tip" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
            <div className={`hd ${hover.type === "hot" ? "hot" : "dead"}`} style={hover.type === "neutral" ? { color: "var(--sim-neutral)" } : undefined}>
              <span className={`sd ${hover.type === "hot" ? "hot" : "dead"}`} style={hover.type === "neutral" ? { background: "var(--sim-neutral)" } : undefined} />
              {SPOT_LABEL[hover.type] || "Spot"}
            </div>
            {hover.value != null && numish(hover.value) && <div className="ln">RT60 {Number(hover.value).toLocaleString(undefined, { maximumFractionDigits: 3 })} s</div>}
            {numish(hover.angle) && <div className="ln faint">bearing {Number(hover.angle).toFixed(0)}°</div>}
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
              <span className="hstack"><span className="sd hot" /> Hotspot</span>
              <span className="hstack"><span className="sd dead" /> Deadspot</span>
              <span className="hstack"><span className="sd" style={{ background: "var(--sim-neutral)" }} /> Neutral</span>
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
            <LayerRow tone="hot" label={`Imbalanced sound${model?.spots?.length ? ` (${counts.hot} hot / ${counts.dead} dead / ${counts.neutral} neutral)` : ""}`} on={layers.spots} onClick={() => toggle("spots")} disabled={!hasModel || !model?.spots?.length} />
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
            <div style={{ margin: 0 }}>
              Red marks hotspots, blue deadspots, cyan neutral zones — hover a point for details.
              Bearing-only scans are projected onto the wall each reading faced, so a marker shows
              the direction measured, not a localised sound source.
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
                {k === "hw2" ? " Hardware 1 is shown with Imbalanced sound instead." : ""}
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

function isoClassOf(aw) {
  const hit = ISO_CLASSES.find((c) => aw >= c.min - 1e-9);
  return hit ? hit.cls : "Not classified";
}
// "αw 0.60 (Class C)" — the form used in every card and table below.
const awText = (aw) => {
  const c = isoClassOf(aw);
  return `αw ${aw.toFixed(2)} (${c === "Not classified" ? "not classified" : `Class ${c}`})`;
};

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

function acousticPlan(room, rt60) {
  if (!room?.w || !room?.l || !numish(rt60) || rt60 <= 0) return null;
  const g = roomGeometry(room);
  const aim = (RT60_TARGET.low + RT60_TARGET.high) / 2;

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
function allocateToSpots(spots, totalArea) {
  const all = (spots || []).map((s, i) => ({ ...s, idx: i + 1 }));
  if (!all.length || !numish(totalArea) || totalArea <= 0) return null;

  const hot = all.filter((s) => s.type === "hot");
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

function buildRecs(model, counts) {
  const recs = [];
  const rt = model.rt60;
  const plan = acousticPlan(model.room, rt);
  const f1 = (n) => Number(n).toFixed(1);
  const f2 = (n) => Number(n).toFixed(2);

  // Without a measured RT60 there is no Sabine input, so there is no required
  // αw and no coverage area. Saying so is the recommendation.
  if (!numish(rt)) {
    recs.push({
      icon: AlertCircle, tone: "var(--bad)", title: "Missing parameter — RT60",
      body: "No usable reverberation time came through with the deployed scan. Sabine solves absorption from RT60 and room volume, so without it no required αw, no coverage area and no target can be computed. Re-run the sound-sensor pass and deploy the scan again.",
    });
  }

  if (numish(rt)) {
    if (rt > RT60_TARGET.high) {
      recs.push({
        icon: TrendingDown, tone: "var(--bad)", title: "Increase absorption — target αw",
        body: plan
          ? (plan.practical
              ? `RT60 is ${f2(rt)} s, above the ${RT60_TARGET.low}–${RT60_TARGET.high} s target. Over ${f1(plan.V)} m³ the room is short ${f1(plan.dA)} m² sabins. Apply a Class ${plan.practical.cls} absorber (αw ≥ ${plan.practical.aw.toFixed(2)}, ISO 11654) over about ${f1(plan.practical.area)} m² of wall or ceiling — ${plan.practical.pct.toFixed(0)}% of the treatable surface — to land at ${f2(plan.aim)} s. Spread across every surface the requirement is only ${awText(plan.awFull)}, below the Class D floor for a rated absorber.`
              : `RT60 is ${f2(rt)} s, above the ${RT60_TARGET.low}–${RT60_TARGET.high} s target. Over ${f1(plan.V)} m³ the room is short ${f1(plan.dA)} m² sabins of absorption. Apply a surface rated ${awText(plan.awFull)} across the ${f1(plan.treatable)} m² of wall and ceiling to land at ${f2(plan.aim)} s.`)
          : `RT60 is ${f2(rt)} s, above the ${RT60_TARGET.low}–${RT60_TARGET.high} s target. Room dimensions are needed to compute a required αw.`,
        plan, kind: "absorb",
      });
    } else if (rt < RT60_TARGET.low) {
      recs.push({
        icon: TrendingUp, tone: "var(--sim-dead)", title: "Reduce absorption — target αw",
        body: plan
          ? `RT60 is ${f2(rt)} s, below the ${RT60_TARGET.low}–${RT60_TARGET.high} s target. The room is over-absorbing by ${f1(Math.abs(plan.dA))} m² sabins. Bring the treated wall and ceiling surface down to about ${awText(plan.awFull)}, or swap absorptive area for reflective/diffusive area of equivalent size.`
          : `RT60 is ${f2(rt)} s, below the ${RT60_TARGET.low}–${RT60_TARGET.high} s target. Room dimensions are needed to compute a required αw.`,
        plan, kind: "reflect",
      });
    } else {
      recs.push({
        icon: CheckCircle2, tone: "var(--ok)", title: "RT60 within target — hold current absorption",
        body: plan
          ? `RT60 is ${f2(rt)} s, inside the ${RT60_TARGET.low}–${RT60_TARGET.high} s band. The room's average absorption coefficient is ᾱ ${plan.aBar.toFixed(2)}. Keep any new surface at or near ${awText(toAwStep(plan.aBar))} so the balance holds.`
          : `RT60 is ${f2(rt)} s, inside the ${RT60_TARGET.low}–${RT60_TARGET.high} s band.`,
        plan, kind: "hold",
      });
    }
  }

  // The quantity above is room-wide; this is where it lands. Basis is whichever
  // ISO class the headline recommendation already settled on.
  const basis = plan && plan.dA > 0 ? (plan.practical || plan.coverage.find((c) => c.ok)) : null;
  const alloc = basis ? allocateToSpots(model.spots, basis.area) : null;

  if (counts.hot > 0) {
    // Hotspot surfaces get one step more than the room needs, never below
    // Class C (αw 0.60, "highly absorbing").
    const localAw = plan ? Math.max(0.6, Math.min(1, toAwStep(plan.awRaw + 0.1))) : 0.80;
    recs.push({
      icon: Volume2, tone: "var(--bad)", title: `${counts.hot} hotspot${counts.hot > 1 ? "s" : ""} — local ${awText(localAw)}`,
      body: alloc && basis
        ? `Energy is building up at ${counts.hot === 1 ? "this location" : "these locations"}. Split the ${f1(basis.area)} m² of Class ${basis.cls} coverage across the bounding surfaces below rather than spreading it evenly${alloc.weighted && numish(alloc.mean) ? ` — each share is weighted by how far that reading sits above the room mean of ${f2(alloc.mean)}` : ""}. Raise the rating to ${awText(localAw)} on the two surfaces nearest the strongest reading.`
        : `Energy is building up at ${counts.hot === 1 ? "this location" : "these locations"}. Specify a higher local rating — ${awText(localAw)} or better — on the two nearest bounding surfaces, rather than spreading the same rating evenly around the room.`,
      alloc, basis, kind: "place",
    });
  }
  if (counts.dead > 0) {
    recs.push({
      icon: Radio, tone: "var(--sim-dead)", title: `${counts.dead} deadspot${counts.dead > 1 ? "s" : ""} — keep local αw below 0.30`,
      body: `Coverage drops out at ${counts.dead === 1 ? "this location" : "these locations"}. Absorption cannot restore energy that never arrived, so keep the surrounding surfaces below Class D (αw < 0.30 — Class E or not classified) to stay reflective, add diffusion, or reposition the source. These points are excluded from the coverage split above.`,
    });
  }

  // Validity notes. Neither blocks the recommendation; both change how much
  // weight it should carry when it is defended.
  if (alloc && !alloc.diffuse) {
    recs.push({
      icon: Target, tone: "var(--warn)", title: "Field is not diffuse — placement over quantity",
      body: `Level varies ${(alloc.cv * 100).toFixed(0)}% across the acoustic zones, past the 15% at which a room can be treated as a single diffuse field. The room-total figure still holds as a quantity, but where the panels go matters more here than how many are bought.`,
    });
  }
  if (plan && plan.model === "Eyring") {
    recs.push({
      icon: Target, tone: "var(--warn)", title: "Eyring model applied",
      body: `Average absorption is ᾱ ${plan.aBar.toFixed(2)}, above the 0.2 ceiling where Sabine stays accurate. Absorption was solved with Eyring (RT60 = 0.161 V / −S ln(1−ᾱ)) instead.`,
    });
  }
  if (plan && plan.dA > 0) {
    recs.push({
      icon: Radio, tone: "var(--faint)", title: "αw excludes low frequency",
      body: "The ISO 11654 reference curve starts at the 250 Hz octave band, and the standard states the rating is not appropriate below it. Any bass buildup or modal problem in this room can survive a product meeting these figures — check the full αp curve at 125 Hz, or add volume-based treatment. An (L) shape indicator on a product only flags extra absorption at 250 Hz, not 125 Hz.",
    });
  }

  if (numish(rt) && !numish(model.room?.h)) {
    recs.push({
      icon: AlertTriangle, tone: "var(--warn)", title: "Missing parameter — room height",
      body: "No height was deployed with the room row, so the volume behind every figure above assumes 2.60 m. A real ceiling height changes V directly, and with it the absorption deficit and every coverage area in the table.",
    });
  }

  if (!recs.length) {
    recs.push({ icon: CheckCircle2, tone: "var(--ok)", title: "No issues detected",
      body: "The current scan doesn't flag any hotspots or reverberation problems." });
  }
  return recs;
}

/* Coverage table — the same absorption deficit met by each ISO 11654 class.
   A higher class means less area to cover; the installer picks the trade-off. */
function AwTable({ plan }) {
  if (!plan || !Math.abs(plan.dA)) return null;
  const cell = { padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" };
  const head = { ...cell, fontWeight: 600, opacity: 0.7, borderBottom: "1px solid rgba(255,255,255,0.10)" };
  return (
    <div style={{ marginTop: 12, overflowX: "auto", minWidth: 0, maxWidth: "100%" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "0.86em", width: "100%", maxWidth: 520 }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>ISO class</th>
            <th style={{ ...head, textAlign: "left" }}>Description</th>
            <th style={head}>Min αw</th>
            <th style={head}>Area required</th>
            <th style={head}>Of wall + ceiling</th>
          </tr>
        </thead>
        <tbody>
          {plan.coverage.map((c) => (
            <tr key={c.cls} style={{ opacity: c.ok ? 1 : 0.4 }}>
              <td style={{ ...cell, textAlign: "left" }}>Class {c.cls}</td>
              <td style={{ ...cell, textAlign: "left" }}>{c.label}</td>
              <td style={cell}>{c.aw.toFixed(2)}</td>
              <td style={cell}>{c.ok ? `${c.area.toFixed(1)} m²` : "not achievable"}</td>
              <td style={cell}>{c.ok ? `${c.pct.toFixed(0)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: "0.82em", opacity: 0.65, lineHeight: 1.5 }}>
        Room volume {plan.V.toFixed(1)} m³ · treatable surface {plan.treatable.toFixed(1)} m² ·
        current ᾱ {plan.aBar.toFixed(2)} · deficit {plan.dA >= 0 ? "+" : ""}{plan.dA.toFixed(1)} m² sabins.
        Derived from {plan.model || "Sabine"} (RT60 = 0.161 V / A); floor excluded from treatable area.
        Areas sized at each class's lowest αw (ISO 11654 Annex B).
      </div>
      {!plan.feasible && (
        <div style={{ marginTop: 8, fontSize: "0.82em", lineHeight: 1.5, padding: "8px 10px", borderRadius: 8, background: "rgba(255,91,82,0.10)", border: "1px solid rgba(255,91,82,0.30)" }}>
          The required coefficient exceeds αw 1.00, the top of Class A — full-surface treatment alone cannot reach the target.
          Add volume-based absorption (bass traps, freestanding baffles) or relax the RT60 target.
        </div>
      )}
    </div>
  );
}

/* Placement table — the coverage area from AwTable, shared out across the
   measured points. This is the half Sabine can't answer. */
function SpotAllocTable({ alloc, basis }) {
  if (!alloc || !basis) return null;
  const cell = { padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" };
  const head = { ...cell, fontWeight: 600, opacity: 0.7, borderBottom: "1px solid rgba(255,255,255,0.10)" };
  const tone = (t) => (t === "hot" ? "var(--bad)" : t === "dead" ? "var(--sim-dead)" : "var(--sim-neutral)");

  // alloc.rows already contains only the rows the Classification tab labelled
  // as hotspots, so nothing needs filtering out here.
  const treated = alloc.rows;
  const skipped = alloc.skipped;
  if (!treated.length) return null;

  return (
    <div style={{ marginTop: 12, overflowX: "auto", minWidth: 0, maxWidth: "100%" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "0.86em", width: "100%", maxWidth: 620 }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>Point</th>
            <th style={{ ...head, textAlign: "left" }}>Bearing</th>
            <th style={head}>Reading</th>
            <th style={head}>Share</th>
            <th style={head}>Area</th>
          </tr>
        </thead>
        <tbody>
          {treated.map((r) => (
            <tr key={r.idx}>
              <td style={{ ...cell, textAlign: "left", color: tone(r.type) }}>
                {SPOT_LABEL[r.type] || "Spot"} {r.idx}
              </td>
              <td style={{ ...cell, textAlign: "left" }}>
                {numish(r.angle) ? `${Math.round(r.angle)}°` : `x ${r.x.toFixed(1)} · z ${r.z.toFixed(1)}`}
              </td>
              <td style={cell}>{numish(r.value) ? r.value.toFixed(2) : "—"}</td>
              <td style={cell}>{(r.share * 100).toFixed(0)}%</td>
              <td style={cell}>{r.area.toFixed(1)} m²</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: "0.82em", opacity: 0.65, lineHeight: 1.5 }}>
        {basis.area.toFixed(1)} m² of Class {basis.cls} (αw ≥ {basis.aw.toFixed(2)}) split across the{" "}
        {alloc.hotCount} point{alloc.hotCount > 1 ? "s" : ""} the Classification tab marked as
        hotspots{alloc.weighted && numish(alloc.mean)
          ? `, weighted by level above the room mean of ${alloc.mean.toFixed(2)} · spread ${(alloc.cv * 100).toFixed(0)}%`
          : ", split evenly — no level column in the classification data"}.
        {skipped > 0 && ` ${skipped} neutral or dead point${skipped > 1 ? "s" : ""} excluded.`}
        {" "}Mount on the surface each bearing points at, measured from room centre.
      </div>
    </div>
  );
}

/* ---- consumer guide ------------------------------------------------------ *
 * The recommendation, told for someone who has never heard of RT60 or αw.
 * Same numbers as the technical cards (acousticPlan / allocateToSpots), just
 * said in plain words: a verdict, an echo gauge, and three steps — what to
 * buy, where to put it, where not to. The panel grade is picked here and
 * every amount below it updates. The original tables stay one click away
 * under "Technical details" for the panel review.
 * ------------------------------------------------------------------------ */

// Plain names for the ISO 11654 classes — what a shopper actually weighs.
const GRADE_NAME = { A: "Best", B: "Very good", C: "Good", D: "Basic" };

// Put an area into something a person can picture. Small rooms get A4 sheets,
// anything bigger gets standard 60 × 60 cm panels.
const A4_M2 = 0.21 * 0.297;
const PANEL_M2 = 0.6 * 0.6;
function relatableArea(m2) {
  if (!numish(m2) || m2 <= 0) return "";
  if (m2 < PANEL_M2 * 2) {
    const n = Math.max(1, Math.ceil(m2 / A4_M2));
    return `about ${n} sheet${n > 1 ? "s" : ""} of A4 paper`;
  }
  const n = Math.max(1, Math.ceil(m2 / PANEL_M2));
  return `about ${n} panel${n > 1 ? "s" : ""} of 60 × 60 cm`;
}
const areaText = (m2) => (m2 < 0.1 ? `${(m2 * 10000).toFixed(0)} cm²` : `${m2.toFixed(2)} m²`);

// Bearing -> the side of the room it points at, using the twin's cardinals.
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const sideOf = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

function EchoGauge({ rt }) {
  const max = Math.max(1, rt * 1.15, RT60_TARGET.high * 1.6);
  const pct = (v) => `${Math.min(100, (v / max) * 100).toFixed(1)}%`;
  return (
    <div className="rg-gauge" role="img"
      aria-label={`Echo time ${rt.toFixed(2)} seconds; goal ${RT60_TARGET.low} to ${RT60_TARGET.high} seconds`}>
      <div className="rg-gauge-track">
        <span className="rg-gauge-goal" style={{ "--from": pct(RT60_TARGET.low), "--to": pct(RT60_TARGET.high) }} />
        <span className="rg-gauge-you" style={{ "--at": pct(rt) }}>
          <span className="rg-gauge-tag">Your room {rt.toFixed(1)} s</span>
        </span>
      </div>
      <div className="rg-gauge-scale">
        <span>Dead</span>
        <span className="rg-gauge-goal-label" style={{ "--from": pct(RT60_TARGET.low), "--to": pct(RT60_TARGET.high) }}>
          Goal {RT60_TARGET.low}–{RT60_TARGET.high} s
        </span>
        <span>Echoey</span>
      </div>
    </div>
  );
}

function GradePicker({ options, value, onChange }) {
  return (
    <div className="rg-grades" role="radiogroup" aria-label="Panel grade">
      {options.map((c) => (
        <button
          key={c.cls}
          type="button"
          role="radio"
          aria-checked={value === c.cls}
          disabled={!c.ok}
          className={`rg-grade${value === c.cls ? " on" : ""}`}
          onClick={() => onChange(c.cls)}
        >
          <span className="rg-grade-name">{GRADE_NAME[c.cls]}</span>
          <span className="rg-grade-cls">Class {c.cls}</span>
          <span className="rg-grade-note">
            {c.ok ? `Soaks up ${Math.round(c.aw * 100)}%+ of sound` : "Not enough on its own"}
          </span>
        </button>
      ))}
    </div>
  );
}

function ShareBar({ pct }) {
  return (
    <span className="rg-bar" aria-hidden="true">
      <span className="rg-bar-fill" style={{ "--w": `${Math.max(2, Math.min(100, pct)).toFixed(0)}%` }} />
    </span>
  );
}

function RecommendationGuide({ model, counts }) {
  const rt = model.rt60;
  const plan = numish(rt) ? acousticPlan(model.room, rt) : null;

  // Default grade = the one the technical plan already settled on.
  const options = plan ? plan.coverage.slice().reverse() : []; // A first
  const fallback = plan && plan.dA > 0 ? (plan.practical || plan.coverage.find((c) => c.ok)) : null;
  const [pick, setPick] = useState(fallback ? fallback.cls : null);
  const chosen = options.find((c) => c.cls === pick && c.ok) || fallback;
  const alloc = chosen ? allocateToSpots(model.spots, chosen.area) : null;

  if (!numish(rt)) {
    return (
      <div className="rg-verdict" data-tone="warn">
        <div className="rg-verdict-title">We couldn't measure the echo yet</div>
        <p className="rg-lead">
          The scan came through without a reverberation reading, so there's nothing to judge the room by.
          Run the sound pass on the device again and re-deploy the scan.
        </p>
      </div>
    );
  }

  const state = rt > RT60_TARGET.high ? "echoey" : rt < RT60_TARGET.low ? "dead" : "ok";
  const times = rt / ((RT60_TARGET.low + RT60_TARGET.high) / 2);
  const verdict = {
    echoey: {
      tone: "bad", title: "Your room is too echoey",
      lead: `Sound keeps bouncing around for ${rt.toFixed(1)} seconds before it fades. For clear voices and music it should fade in about half a second — this room holds on ${times >= 1.5 ? `roughly ${times.toFixed(0)}× too long` : "a little too long"}.`,
    },
    dead: {
      tone: "cool", title: "Your room sounds too dead",
      lead: `Sound dies away after only ${rt.toFixed(1)} seconds. The goal is ${RT60_TARGET.low}–${RT60_TARGET.high} seconds, so right now voices and music can sound flat and muffled.`,
    },
    ok: {
      tone: "ok", title: "Your room sounds balanced",
      lead: `Sound fades in ${rt.toFixed(1)} seconds, inside the ${RT60_TARGET.low}–${RT60_TARGET.high} second goal. No treatment is needed.`,
    },
  }[state];

  const localAw = plan ? Math.max(0.6, Math.min(1, toAwStep(plan.awRaw + 0.1))) : 0.8;
  const localCls = isoClassOf(localAw);

  const tips = [];
  if (alloc && !alloc.diffuse) tips.push({
    icon: Target, title: "Where matters more than how much",
    body: "Sound is uneven across this room, so putting panels in the right spots will do more than buying extra.",
  });
  if (plan && plan.dA > 0) tips.push({
    icon: Volume2, title: "Deep bass is a separate job",
    body: "These panels tame echo in voices and most music. If you still hear a boomy low rumble afterwards, thick bass traps in the corners are what fix that.",
  });
  if (!numish(model.room?.h)) tips.push({
    icon: AlertTriangle, title: "Ceiling height was guessed",
    body: "The scan didn't include the room height, so we assumed 2.6 m. Re-scan for exact amounts.",
  });

  return (
    <div className="rg">
      <div className="rg-verdict" data-tone={verdict.tone}>
        <div className="rg-verdict-title">{verdict.title}</div>
        <p className="rg-lead">{verdict.lead}</p>
        <EchoGauge rt={rt} />
      </div>

      {state === "ok" && (
        <div className="rg-step">
          <span className="rg-step-num">1</span>
          <div className="rg-step-body">
            <div className="rg-step-title">Keep the room as it is</div>
            <p>If you add furniture, curtains or panels later, scan again to check the balance still holds.</p>
          </div>
        </div>
      )}

      {state === "dead" && (
        <div className="rg-step">
          <span className="rg-step-num">1</span>
          <div className="rg-step-body">
            <div className="rg-step-title">Bring back some reflection</div>
            <p>
              {plan
                ? `Take down roughly ${areaText(Math.abs(plan.dA))} of soft panels (${relatableArea(Math.abs(plan.dA))}), or cover the same amount with hard surfaces — wood, a bookshelf, or a diffuser.`
                : "Take down some soft panels, or add hard surfaces like wood or a bookshelf. Scan the room size to get an exact amount."}
            </p>
          </div>
        </div>
      )}

      {state === "echoey" && (
        <>
          <div className="rg-step">
            <span className="rg-step-num">1</span>
            <div className="rg-step-body">
              <div className="rg-step-title">Add sound-absorbing panels</div>
              {!plan ? (
                <p>Scan the room's size so we can work out how many panels you need.</p>
              ) : !chosen ? (
                <p>
                  Even covering every wall and the ceiling won't be enough here. Add thick, free-standing panels or
                  bass traps that stand in the room, not just on the walls.
                </p>
              ) : (
                <>
                  <p>Pick a panel grade. Better panels mean fewer of them. The grade is printed on the product as its ISO class.</p>
                  <GradePicker options={options} value={chosen.cls} onChange={setPick} />
                  <div className="rg-result">
                    <div className="rg-result-big">{areaText(chosen.area)}</div>
                    <div className="rg-result-text">
                      of <b>{GRADE_NAME[chosen.cls].toLowerCase()} (Class {chosen.cls})</b> panels — {relatableArea(chosen.area)}.
                      <span className="rg-result-sub">
                        <ShareBar pct={chosen.pct} /> That covers {chosen.pct < 1 ? "under 1" : chosen.pct.toFixed(0)}% of your walls and ceiling.
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {counts.hot > 0 && (
            <div className="rg-step">
              <span className="rg-step-num">2</span>
              <div className="rg-step-body">
                <div className="rg-step-title">Put them where it's loudest</div>
                <p>
                  The scan found {counts.hot} loud spot{counts.hot > 1 ? "s" : ""} — shown in red in the twin above.
                  Mount the panels on the wall each one faces, starting with the loudest.
                </p>
                {alloc && (
                  <ul className="rg-where">
                    {alloc.rows.map((r, i) => (
                      <li key={r.idx}>
                        <span className="rg-where-name">
                          {numish(r.angle) ? `${sideOf(r.angle)[0].toUpperCase()}${sideOf(r.angle).slice(1)} wall` : `Loud spot ${r.idx}`}
                          {i === 0 && <span className="rg-chip">loudest</span>}
                        </span>
                        <ShareBar pct={r.share * 100} />
                        <span className="rg-where-amt">{(r.share * 100).toFixed(0)}% · {areaText(r.area)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {plan && localCls !== "Not classified" && (
                  <p className="rg-hint">
                    On the two surfaces nearest the loudest spot, use a {GRADE_NAME[localCls]?.toLowerCase() || "higher"} grade (Class {localCls}) or better.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {counts.dead > 0 && state !== "ok" && (
        <div className="rg-step">
          <span className="rg-step-num">{state === "echoey" ? (counts.hot > 0 ? 3 : 2) : 2}</span>
          <div className="rg-step-body">
            <div className="rg-step-title">Leave the quiet spots bare</div>
            <p>
              {counts.dead} spot{counts.dead > 1 ? "s are" : " is"} already too quiet — shown in blue in the twin.
              Panels there would make it worse. If they bother you, move the speaker or add something that scatters
              sound, like a bookshelf, instead.
            </p>
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
  return (
    <section className="rec">
      <div className="rec-head">
        <span className="ic"><Target size={16} color="var(--orange)" /></span>
        <div><div className="t">Recommendations</div><div className="s">What your scan found and how to fix it</div></div>
      </div>
      {!hasModel ? (
        <div className="rec-empty">Deploy a room scan to see how your room sounds and what to change.</div>
      ) : (
        <>
          <RecommendationGuide key={model.rt60} model={model} counts={counts} />
          <details className="rg-tech">
            <summary>Technical details (ISO 11654 · Sabine)</summary>
            <div className="rec-grid">
              {buildRecs(model, counts).map((r, i) => {
                const Icon = r.icon;
                // A card carrying a table needs the whole row — squeezed into a
                // third of the grid the table overflows its cell and paints over
                // the neighbouring card.
                const wide = (r.plan && r.kind !== "hold") || r.kind === "place";
                return (
                  <div
                    key={i}
                    className="rec-cell"
                    style={wide ? { gridColumn: "1 / -1", minWidth: 0 } : { minWidth: 0 }}
                  >
                    <span className="ic"><Icon size={16} color={r.tone} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{r.title}</div>
                      <div className="n">{r.body}</div>
                      {r.plan && r.kind !== "hold" && <AwTable plan={r.plan} />}
                      {r.kind === "place" && <SpotAllocTable alloc={r.alloc} basis={r.basis} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
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
  // One prototype at a time: Hardware 2 while Imbalanced sound is on (if it
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