import React, { createContext, useContext, useEffect, useState } from "react";
import { CONFIG } from "../config.js";
import { fitRoom } from "../lib/fitRoom.js";
import { fetchCsv } from "../lib/csv.js";
import { isQualified, bandPosition } from "../lib/acoustics.js";
import { vibraHistory } from "../pages/vibraHistory.js";

/* Holds the current scan as one derived object the whole app reads.

   Priority:
     1. The scan DEPLOYED from the Parameters table (via vibraHistory) — this is
        the same source the Simulation page reads, so Dashboard, Simulation and
        Recommendations all show the SAME room + hot/dead spots.
     2. Otherwise CONFIG.sample (or the published-CSV sheet), as before.
   It live-updates whenever a new scan is deployed. */

const RoomDataContext = createContext(null);

/* ---------- small helpers (mirror the Simulation's parser) ---------- */
const numish = (v) => v !== "" && v != null && !isNaN(parseFloat(v)) && isFinite(v);
const colIdx = (cols, re) => cols.findIndex((c) => re.test(c));

// Centre a point set on the room and scale it to fit inside the footprint
// (keeps aspect) — identical to the Simulation's "contain" fit for spots.
function fitContain(pts, w, l, inset = 0.8) {
  if (!pts.length) return;
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  pts.forEach((p) => { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); });
  const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
  const ex = Math.max((maxx - minx) / 2, 1e-6), ez = Math.max((maxz - minz) / 2, 1e-6);
  const s = Math.min((w / 2 * inset) / ex, (l / 2 * inset) / ez);
  pts.forEach((p) => { p.x = (p.x - cx) * s; p.z = (p.z - cz) * s; });
}

// hot/dead markers from a deployed acoustic tab (Classification/Reverberation).
function markersFromTabs(tabs, w, l) {
  let spots = [];
  for (const t of Object.values(tabs)) {
    const cols = t.columns || [], rows = t.rows || [];
    const xi = colIdx(cols, /x/i), yi = colIdx(cols, /y/i);
    const classI = colIdx(cols, /class|label|type|status|spot/i);
    const metricI = colIdx(cols, /rt60|reverb|spl|level|db|energy|score/i);
    if (xi >= 0 && yi >= 0 && (classI >= 0 || metricI >= 0)) {
      const mm = /mm/i.test(cols[xi]);
      const vals = metricI >= 0 ? rows.map((r) => parseFloat(r[metricI])).filter(numish) : [];
      const median = vals.length ? [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)] : 0;
      spots = rows.map((r) => {
        let x = parseFloat(r[xi]), z = parseFloat(r[yi]);
        if (!numish(x) || !numish(z)) return null;
        if (mm) { x /= 1000; z /= 1000; }
        let type = "dead";
        if (classI >= 0) type = /hot|high|live|bright/.test(String(r[classI]).toLowerCase()) ? "hot" : "dead";
        else if (metricI >= 0) type = parseFloat(r[metricI]) >= median ? "hot" : "dead";
        return { x, z, type };
      }).filter(Boolean);
      if (spots.length) break;
    }
  }
  fitContain(spots, w, l, 0.8);
  const hot = [], dead = [];
  spots.forEach((s) => (s.type === "hot" ? hot : dead).push({ x: s.x, z: s.z, y: 1.2 }));
  return { hot, dead };
}

// average RT60 from a reverberation-style tab, if present.
function rt60FromTabs(tabs) {
  for (const t of Object.values(tabs)) {
    const cols = t.columns || [], ri = colIdx(cols, /rt60/i);
    if (ri >= 0 && (t.rows || []).length) {
      const vals = t.rows.map((r) => parseFloat(r[ri])).filter(numish);
      if (vals.length) return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }
  return 0;
}

/* ---------- builders ---------- */
function buildFromSample() {
  const s = CONFIG.sample;
  const room = fitRoom(s.cardinal);
  return { loading: false, error: null, scan: s.scan, room, rt60: s.rt60, markers: s.markers, coverage: s.coverage };
}

// Build the shared object from a scan deployed by the Parameters table.
function buildFromDeployment(dep) {
  const d = dep.dims || {};
  const width = numish(d.width) ? +d.width : 1;
  const length = numish(d.length) ? +d.length : 1;
  const height = numish(d.height) ? +d.height : 1;
  // fitRoom expects cardinal rays; reconstruct a symmetric room from the dims.
  const room = fitRoom({ N: length / 2, S: length / 2, E: width / 2, W: width / 2, height });
  const tabs = dep.tabs || {};
  const measured = rt60FromTabs(tabs);
  const points = Object.values(tabs).reduce((n, t) => n + ((t.rows || []).length), 0) || CONFIG.sample.scan.points;
  return {
    loading: false,
    error: null,
    scan: { points, device: "LD06 + ultrasonic" },
    room,
    rt60: { measured, source: measured ? "MEASURED" : "—" },
    markers: markersFromTabs(tabs, width, length),
    coverage: CONFIG.sample.coverage, // replace once coverage is logged
    roomTs: dep.roomTs || null,
  };
}

/* Reduce raw Reverberation-tab rows into markers + average RT60 (sheet path).
   Expects columns like: type (hot/dead/neutral), rt60, x, z, y. */
function reduceReverb(rows) {
  const hot = [], dead = [];
  let sum = 0, count = 0;
  rows.forEach((r) => {
    const rt = Number(r.rt60 ?? r.RT60 ?? 0);
    if (rt > 0) { sum += rt; count++; }
    const type = (r.type ?? r.Type ?? "").toLowerCase();
    const pos = { x: Number(r.x ?? 0), z: Number(r.z ?? 0), y: Number(r.y ?? 1.2) };
    if (type === "hot" || type === "hotspot") hot.push(pos);
    if (type === "dead" || type === "deadspot") dead.push(pos);
  });
  return { markers: { hot, dead }, measured: count ? sum / count : 0 };
}

async function buildFromSheet() {
  const { csv } = CONFIG.sheet;
  if (!csv.room || !csv.reverberation) throw new Error("Set sheet.csv.room and sheet.csv.reverberation in config.js");
  const [roomRows, reverbRows] = await Promise.all([fetchCsv(csv.room), fetchCsv(csv.reverberation)]);
  const last = roomRows[roomRows.length - 1] || {};
  const cardinal = {
    N: Number(last.N ?? last.north ?? 0), S: Number(last.S ?? last.south ?? 0),
    E: Number(last.E ?? last.east ?? 0), W: Number(last.W ?? last.west ?? 0),
    height: Number(last.height ?? last.Height ?? 0),
  };
  const room = fitRoom(cardinal);
  const { markers, measured } = reduceReverb(reverbRows);
  return {
    loading: false, error: null,
    scan: { points: roomRows.length, device: "LD06 + ultrasonic" },
    room, rt60: { measured, source: "MEASURED" }, markers,
    coverage: CONFIG.sample.coverage,
  };
}

/* ---------- provider ---------- */
function initialState() {
  const dep = vibraHistory.getDeployment();
  if (dep && dep.dims) return buildFromDeployment(dep);
  return CONFIG.dataSource === "sheet" ? { loading: true, error: null } : buildFromSample();
}

export function RoomDataProvider({ children }) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    let cancelled = false;
    const dep = vibraHistory.getDeployment();
    // Only fetch the sheet when nothing has been deployed.
    if (!dep && CONFIG.dataSource === "sheet") {
      buildFromSheet()
        .then((d) => !cancelled && setState(d))
        .catch((e) => !cancelled && setState({ loading: false, error: e.message }));
    }
    // Live-update whenever a scan is deployed from the Parameters table.
    const off = vibraHistory.onDeploy((d) => { if (!cancelled && d && d.dims) setState(buildFromDeployment(d)); });
    return () => { cancelled = true; if (off) off(); };
  }, []);

  const derived = state.room
    ? { qualified: isQualified(state.rt60.measured, CONFIG.target), band: bandPosition(state.rt60.measured, CONFIG.target) }
    : {};

  return <RoomDataContext.Provider value={{ ...state, ...derived }}>{children}</RoomDataContext.Provider>;
}

export function useRoomData() {
  const ctx = useContext(RoomDataContext);
  if (!ctx) throw new Error("useRoomData must be used inside RoomDataProvider");
  return ctx;
}