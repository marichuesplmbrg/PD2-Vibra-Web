import React, { useMemo, useState, useEffect } from "react";
import {
  Download,
  Ruler,
  Box,
  Volume2,
  Flame,
  VolumeX,
  Timer,
  History,
  ChevronDown,
  Check,
} from "lucide-react";

import { CONFIG, fmt } from "../config.js";
import { useRoomData } from "../data/useRoomData.jsx";
import { exportDashboardPdf } from "../lib/exportDashboardPdf.js";
import SimulationPage from "./Simulation.jsx";
import { vibraHistory } from "./vibraHistory";
import {
  acousticTs,
  RX_CLASS_COL,
  RX_METRIC_COL,
} from "./ParametersTable.jsx";


/* -------------------------------------------------------
   Helpers
   Every value shown on this page comes from the fetched
   sheet data or a saved scan. Nothing falls back to a
   sample or a default: a missing value is shown as "—"
   so it is never mistaken for a real reading.
------------------------------------------------------- */

const MISSING = "—";
const LIVE = "live"; // filter value for the currently deployed scan

const has = (v) =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  Number.isFinite(Number(v));

const whenText = (ts) => {
  if (!ts) return null;

  const d = new Date(typeof ts === "number" ? ts : String(ts).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(ts)
    : d.toLocaleString();
};

/* The Parameters Table tab whose label matches, from the deployed bundle. */
const findTab = (tabs, re) => {
  const entry = Object.entries(tabs || {}).find(([label]) => re.test(label));
  if (!entry || !entry[1] || !Array.isArray(entry[1].columns)) return null;
  return {
    label: entry[0],
    columns: entry[1].columns,
    rows: Array.isArray(entry[1].rows) ? entry[1].rows : [],
  };
};


/* Summary of the Classification tab. Counts come from the class column and
   the RT60 figures from the RT60 column, both read straight from the sheet.
   Labels the Parameters Table doesn't recognise count as neutral, the same
   rule its audit uses. */
const RX_HOT = /hot|high|live|bright|excess/i;
const RX_DEAD = /dead|low|dull|null|quiet/i;

function summarize(sheet) {
  const empty = { positions: 0, hot: null, neutral: null, dead: null, avg: null, min: null, max: null };
  if (!sheet || !sheet.columns.length) return empty;

  const cols = sheet.columns.map(String);
  const ci = cols.findIndex((c) => RX_CLASS_COL.test(c));
  let mi = cols.findIndex((c) => /rt60/i.test(c));
  if (mi < 0) mi = cols.findIndex((c) => RX_METRIC_COL.test(c));

  const rows = sheet.rows.filter((r) =>
    (ci >= 0 && String(r[ci] ?? "").trim() !== "") || (mi >= 0 && has(r[mi]))
  );
  if (!rows.length) return empty;

  let hot = null, neutral = null, dead = null;
  if (ci >= 0) {
    hot = 0; neutral = 0; dead = 0;
    rows.forEach((r) => {
      const label = String(r[ci] ?? "").replace(/[\s_-]/g, "");
      if (!label) return;
      if (RX_HOT.test(label)) hot++;
      else if (RX_DEAD.test(label)) dead++;
      else neutral++;
    });
  }

  const vals = mi >= 0 ? rows.map((r) => r[mi]).filter(has).map(Number) : [];
  return {
    positions: rows.length,
    hot, neutral, dead,
    avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
  };
}

/* Guarded: a missing or malformed deployment must never crash the page. */
const readDeployment = () => {
  try {
    return typeof vibraHistory?.getDeployment === "function"
      ? vibraHistory.getDeployment() ?? null
      : null;
  } catch (err) {
    console.error("Dashboard: could not read deployment", err);
    return null;
  }
};

/* Guarded read of the saved scans (History page list). */
const readSaved = () => {
  try {
    const l = typeof vibraHistory?.list === "function" ? vibraHistory.list() : [];
    return Array.isArray(l) ? l.filter((e) => e && e.id) : [];
  } catch (err) {
    console.error("Dashboard: could not read saved scans", err);
    return [];
  }
};


/* -------------------------------------------------------
   Saved-scan readers
   A saved entry is what ParametersTable.saveView() stores:
     { id, label, roomTs, dims, tabs, savedAt }
   the same shape as a deployment, plus id / label / savedAt.
------------------------------------------------------- */

const entryTabs = (e) => (e && e.tabs && typeof e.tabs === "object" ? e.tabs : null);

function entryRoom(e) {
  const d = e?.dims || {};
  const out = {};
  ["width", "length", "height"].forEach((k) => { if (has(d[k])) out[k] = Number(d[k]); });
  return out;
}

const entryTs = (e) => e?.roomTs || e?.savedAt || null;

const dimsText = (room) =>
  ["width", "length", "height"].every((k) => has(room[k]))
    ? `${fmt(room.width)} × ${fmt(room.length)} × ${fmt(room.height)} m`
    : null;

/* Label shown in the filter for a saved scan. */
function entryLabel(e, index) {
  const saved = e?.savedAt ? `Saved ${whenText(e.savedAt)}` : null;
  return {
    title: e?.label || e?.roomTs || `Room scan ${index + 1}`,
    sub: [dimsText(entryRoom(e)), saved].filter(Boolean).join(" · ") || "No details recorded",
  };
}


/* -------------------------------------------------------
   Dashboard
   Panels: Room twin · Acoustic scan · Spatial status
------------------------------------------------------- */

export default function Dashboard() {
  const data = useRoomData();
  const c = CONFIG.colors;

  /* The scan deployed from the Parameters Table. Followed live, so a new
     deploy or a reset updates this page the same way it updates Simulation. */
  const [dep, setDep] = useState(readDeployment);
  useEffect(() => {
    if (typeof vibraHistory?.onDeploy !== "function") return undefined;
    return vibraHistory.onDeploy((payload) => setDep(payload ?? null));
  }, []);

  /* Saved scans for the room filter, followed live from the History store. */
  const [saved, setSaved] = useState(readSaved);
  useEffect(() => {
    if (typeof vibraHistory?.subscribe !== "function") return undefined;
    const off = vibraHistory.subscribe(() => setSaved(readSaved()));
    return () => { off(); };
  }, []);

  /* Which room the page shows: the deployed scan, or a saved one by id. */
  const [roomPick, setRoomPick] = useState(LIVE);
  const entry = roomPick === LIVE ? null : saved.find((e) => e.id === roomPick) ?? null;

  /* A saved scan deleted from History drops the filter back to the current scan. */
  useEffect(() => {
    if (roomPick !== LIVE && !saved.some((e) => e.id === roomPick)) setRoomPick(LIVE);
  }, [saved, roomPick]);

  /* Acoustic scan: a summary of the Classification tab. The scan time comes
     from the Reverberation tab, same as on the Parameters Table. */
  const acoustic = useMemo(() => {
    const tabs = entry ? entryTabs(entry) : dep?.tabs ?? null;
    const cls = findTab(tabs, /class/i);
    const rev = findTab(tabs, /reverb/i);
    return {
      summary: summarize(cls),
      when: acousticTs(rev),
    };
  }, [dep, entry]);

  const savedRoom = useMemo(() => (entry ? entryRoom(entry) : null), [entry]);

  const filter = (
    <RoomFilter saved={saved} value={roomPick} onChange={setRoomPick} />
  );

  /* -----------------------------------------------------
     Default ("blank") state: the full layout is always drawn —
     twin, Acoustic scan and Spatial status boxes — and every
     value reads "—" until a scan with values is deployed or a
     saved scan is picked. Loading and errors only change the
     header line; the boxes stay in place.
  ----------------------------------------------------- */
  const live = !entry;
  const loading = live && !!dep && data.loading;
  const error = live && !!dep && !data.loading ? data.error : null;

  const rawRoom = entry ? savedRoom : (dep && !loading && !error ? data.room ?? {} : {});
  const hasRoom = ["width", "length", "height", "area", "volume"].some((k) => has(rawRoom?.[k]));
  const hasAcoustic = acoustic.summary.positions > 0 && !loading && !error;
  const blank = (!dep && !entry) || (!hasRoom && !hasAcoustic);

  const room = blank ? {} : rawRoom;
  const summary = blank ? summarize(null) : acoustic.summary;
  const acousticWhen = blank ? null : acoustic.when;
  const scan = blank || entry ? {} : data.scan ?? {};
  const roomTs = blank ? null : entry ? entryTs(entry) : data.roomTs;
  const when = whenText(roomTs);

  /* Header line — the status when blank, otherwise what was fetched. */
  const meta = loading
    ? ["Fetching scan from the sheet…"]
    : error
      ? [`Could not load scan — ${error}`]
      : blank
        ? [entry ? "This saved scan has no room or acoustic values" : "No room scan deployed yet"]
        : [
            when ? `${entry ? "Saved scan" : "Last scan"} ${when}` : "Scan time not recorded",
            has(scan.points) ? `${Number(scan.points).toLocaleString()} points` : null,
            scan.device || null,
          ].filter(Boolean);

  return (
    <div className="page">

      {/* -------------------------------------------------
          Header
      ------------------------------------------------- */}

      <div className="pagehead">
        <div>
          <h1>Room Analysis</h1>

          <p className="sub">
            {meta.join(" · ")}
          </p>
        </div>

        <div className="pagehead-actions">
          {filter}

          <button
            className="export"
            disabled={blank}
            title={blank ? "Deploy or pick a scan to export a report" : undefined}
            onClick={() => exportDashboardPdf(entry ? { ...data, room, roomTs } : data)}
          >
            <Download size={17} />
            Export report
          </button>
        </div>
      </div>


      {/* -------------------------------------------------
          Room twin + Acoustic scan
      ------------------------------------------------- */}

      <div className="grid2">


        {/* Room twin */}

        <div className="card twin">

          <div className="twin-head">

            <h3 className="panel-title">
              Room twin
            </h3>

            <p className="panel-sub">
              {entry
                ? `Saved scan ${entry.label || entry.roomTs || ""}`.trim()
                : dep ? "Live scan from the Simulation" : "No scan deployed"}
              {has(room.height) && ` · ${fmt(Number(room.height))} m ceiling`}
            </p>

          </div>


          <div className="twin-canvas">
            <SimulationPage twinOnly scan={entry} />
          </div>


          <div className="legend">

            <span>
              <i className="swatch" style={{ background: c.shell }} />
              shell
            </span>

            <span>
              <i className="swatch" style={{ background: c.edge }} />
              edges
            </span>

            <span>
              <i className="swatch" style={{ background: c.hot }} />
              hot
            </span>

            <span>
              <i className="swatch" style={{ background: c.dead }} />
              dead
            </span>

          </div>

        </div>


        {/* Acoustic scan — summary of the Classification tab */}

        <section className="sp">

          <div className="sp-head">
            <span className="ic"><Volume2 size={16} color="var(--cyan)" /></span>

            <div className="h">
              <div className="sp-title">Acoustic scan</div>
              <div className="sp-sub">
                {summary.positions
                  ? `Summary of ${summary.positions} classified position${summary.positions === 1 ? "" : "s"}`
                  : blank
                    ? "Summary of the classified positions"
                    : `No classification data in the ${entry ? "saved" : "deployed"} scan`}
              </div>
            </div>

            {acousticWhen && (
              <span className="sp-when">Acoustic scan · {acousticWhen}</span>
            )}
          </div>

          <div className="sp-grid">
            <Cell icon={<Flame size={16} color={c.hot} />} label="Hot spots" value={summary.hot} />
            <Cell icon={<VolumeX size={16} color={c.dead} />} label="Dead spots" value={summary.dead} />
          </div>

          {/* Lowest and highest side by side, average across the full width below */}
          <div className="sp-grid">
            <Cell icon={<Timer size={16} color="var(--violet)" />} label="Lowest RT60" value={summary.min} unit="s" digits={2} />
            <Cell icon={<Timer size={16} color="var(--violet)" />} label="Highest RT60" value={summary.max} unit="s" digits={2} />
            <Cell icon={<Timer size={16} color="var(--violet)" />} label="Average RT60" value={summary.avg} unit="s" digits={2} wide />
          </div>

        </section>

      </div>


      {/* -------------------------------------------------
          Spatial status — same panel as the Parameters Table
      ------------------------------------------------- */}

      <section className="sp">

        <div className="sp-head">
          <span className="ic"><Ruler size={16} color="var(--violet)" /></span>

          <div className="h">
            <div className="sp-title">Spatial status</div>
            <div className="sp-sub">Room dimensions from the LiDAR scan</div>
          </div>

          {when && (
            <span className="sp-when">Room scan · {when}</span>
          )}
        </div>

        <div className="sp-grid">
          <Dim icon={<MoveH />} label="Width" value={room.width} />
          <Dim icon={<MoveV />} label="Length" value={room.length} />
          <Dim icon={<Box size={16} color="var(--orange)" />} label="Height" value={room.height} />
        </div>

      </section>

    </div>
  );
}


/* -------------------------------------------------------
   Room filter — pick the deployed scan or a saved one
------------------------------------------------------- */

function RoomFilter({ saved, value, onChange }) {
  const [open, setOpen] = useState(false);

  /* Close on Escape. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const index = saved.findIndex((e) => e.id === value);
  const current = index >= 0 ? entryLabel(saved[index], index) : null;

  const choose = (id) => { onChange(id); setOpen(false); };

  return (
    <div className="room-filter">
      <span className="room-filter-lbl" id="room-filter-lbl">Scanned room</span>

      <div className="menu-wrap">
        <button
          className="export"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby="room-filter-lbl"
        >
          <History size={16} />
          <span className="pick-lbl on w200">{current ? current.title : "Current scan"}</span>
          <ChevronDown size={15} className={`chev${open ? " open" : ""}`} />
        </button>

        {open && (
          <>
            <div className="menu-overlay" onClick={() => setOpen(false)} />

            <div className="menu right room-menu thin-scroll" role="listbox" aria-labelledby="room-filter-lbl">

              <button
                className={`menu-item${value === LIVE ? " active" : ""}`}
                role="option"
                aria-selected={value === LIVE}
                onClick={() => choose(LIVE)}
              >
                <span className="mi-text">
                  <span className="mi-title">Current scan</span>
                  <span className="mi-sub">Deployed from the Parameters table</span>
                </span>
                {value === LIVE && <span className="mi-end"><Check size={15} /></span>}
              </button>

              <div className="menu-sep" />

              {saved.length ? (
                saved.map((e, i) => {
                  const l = entryLabel(e, i);
                  const on = e.id === value;
                  return (
                    <button
                      key={e.id}
                      className={`menu-item${on ? " active" : ""}`}
                      role="option"
                      aria-selected={on}
                      onClick={() => choose(e.id)}
                    >
                      <span className="mi-text">
                        <span className="mi-title ell">{l.title}</span>
                        <span className="mi-sub ell">{l.sub}</span>
                      </span>
                      <span className="mi-end">
                        {i === 0 && <span className="menu-latest">Latest</span>}
                        {on && <Check size={15} />}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="menu-note">No saved scans yet. Save one from the Parameters table.</div>
              )}

            </div>
          </>
        )}
      </div>
    </div>
  );
}


/* -------------------------------------------------------
   Spatial status cell — matches ParametersTable.jsx
------------------------------------------------------- */

function Dim({ icon, label, value }) {
  return (
    <div className="sp-dim">
      <div className="lbl">{icon}<span>{label}</span></div>
      <div className="val">
        {has(value)
          ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })
          : MISSING}
        <small>m</small>
      </div>
    </div>
  );
}

const MoveH = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8 22 12 18 16"/><path d="M6 8 2 12 6 16"/><path d="M2 12h20"/></svg>);
const MoveV = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 18 4 4 4-4"/><path d="m8 6 4-4 4 4"/><path d="M12 2v20"/></svg>);

/* Summary cell — same markup as Dim, with any unit (or none, for counts). */
function Cell({ icon, label, value, unit = "", digits = 0, wide = false }) {
  return (
    <div className={`sp-dim${wide ? " wide" : ""}`}>
      <div className="lbl">{icon}<span>{label}</span></div>
      <div className="val">
        {has(value)
          ? Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
          : MISSING}
        {unit && <small>{unit}</small>}
      </div>
    </div>
  );
}