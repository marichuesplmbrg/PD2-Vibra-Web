import React, { useMemo, useState, useEffect } from "react";
import { Download, Ruler, Box, Volume2, Flame, VolumeX, Timer } from "lucide-react";

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
   sheet data. Nothing falls back to a sample or a default:
   a missing value is shown as "—" so it is never mistaken
   for a real reading.
------------------------------------------------------- */

const MISSING = "—";

const has = (v) =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  Number.isFinite(Number(v));

const whenText = (ts) => {
  if (!ts) return null;

  const d = new Date(String(ts).replace(" ", "T"));
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

  /* Acoustic scan: a summary of the deployed Classification tab. The scan
     time comes from the Reverberation tab, same as on the Parameters Table. */
  const acoustic = useMemo(() => {
    const tabs = dep?.tabs ?? null;
    const cls = findTab(tabs, /class/i);
    const rev = findTab(tabs, /reverb/i);
    return {
      summary: summarize(cls),
      when: acousticTs(rev),
    };
  }, [dep]);

  const classRows = acoustic.summary.positions;

  /* Nothing deployed yet — the page stays blank. */
  if (!dep) return <BlankDashboard />;

  /* Loading */
  if (data.loading) {
    return (
      <div className="page">
        <p className="panel-sub">
          Fetching scan from the sheet…
        </p>
      </div>
    );
  }

  /* Error */
  if (data.error) {
    return (
      <div className="page">
        <div className="card">
          <h3 className="panel-title">
            Could not load scan
          </h3>

          <p className="panel-sub">
            {data.error}
          </p>
        </div>
      </div>
    );
  }

  const room = data.room ?? {};
  const scan = data.scan ?? {};
  const when = whenText(data.roomTs);


  const hasRoom = ["width", "length", "height", "area", "volume"]
    .some((k) => has(room[k]));

  /* Deployed, but none of its values came through — still blank. */
  if (!hasRoom && !classRows) return <BlankDashboard />;

  /* Header meta — only what was actually fetched */
  const meta = [
    when ? `Last scan ${when}` : "Scan time not recorded",
    has(scan.points)
      ? `${Number(scan.points).toLocaleString()} points`
      : null,
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

        <button
          className="export"
          onClick={() => exportDashboardPdf(data)}
        >
          <Download size={17} />
          Export report
        </button>
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
              Live scan from the Simulation
              {has(room.height) && ` · ${fmt(Number(room.height))} m ceiling`}
            </p>

          </div>


          <div className="twin-canvas">
            <SimulationPage twinOnly />
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
                {acoustic.summary.positions
                  ? `Summary of ${acoustic.summary.positions} classified position${acoustic.summary.positions === 1 ? "" : "s"}`
                  : "No classification data in the deployed scan"}
              </div>
            </div>

            {acoustic.when && (
              <span className="sp-when">Acoustic scan · {acoustic.when}</span>
            )}
          </div>

          <div className="sp-grid">
            <Cell icon={<Flame size={16} color={c.hot} />} label="Hot spots" value={acoustic.summary.hot} />
            <Cell icon={<VolumeX size={16} color={c.dead} />} label="Dead spots" value={acoustic.summary.dead} />
          </div>

          {/* Lowest and highest side by side, average across the full width below */}
          <div className="sp-grid">
            <Cell icon={<Timer size={16} color="var(--violet)" />} label="Lowest RT60" value={acoustic.summary.min} unit="s" digits={2} />
            <Cell icon={<Timer size={16} color="var(--violet)" />} label="Highest RT60" value={acoustic.summary.max} unit="s" digits={2} />
            <Cell icon={<Timer size={16} color="var(--violet)" />} label="Average RT60" value={acoustic.summary.avg} unit="s" digits={2} wide />
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

          {data.roomTs && (
            <span className="sp-when">Room scan · {data.roomTs}</span>
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
    <div className="sp-dim" style={wide ? { gridColumn: "1 / -1" } : undefined}>
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


/* -------------------------------------------------------
   Blank state — shown until a scan with values is deployed
------------------------------------------------------- */

function BlankDashboard() {
  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Room Analysis</h1>
          <p className="sub">No room scan deployed yet</p>
        </div>
      </div>
    </div>
  );
}