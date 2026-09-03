import React from "react";
import { Download } from "lucide-react";
import { CONFIG, fmt } from "../config.js";
import { useRoomData } from "../data/useRoomData.jsx";
import { exportDashboardPdf } from "../lib/exportDashboardPdf.js";
import StatCard from "../components/StatCard.jsx";
import RoomTwin from "../components/RoomTwin.jsx";
import Rt60Bar from "../components/Rt60Bar.jsx";
import Recommendations from "../components/Recommendations.jsx";
import ScanCoverage from "../components/ScanCoverage.jsx";

export default function Dashboard() {
  const data = useRoomData();
  const c = CONFIG.colors;

  if (data.loading) return <div className="page"><p className="panel-sub">Loading scan…</p></div>;
  if (data.error)
    return (
      <div className="page">
        <div className="card">
          <h3 className="panel-title">Could not load scan</h3>
          <p className="panel-sub">{data.error}</p>
        </div>
      </div>
    );

  const { room, rt60, markers, scan, qualified, band } = data;

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Room analysis</h1>
          <p className="sub">
            Last scan — {scan.points.toLocaleString()} points · {scan.device}
          </p>
        </div>
        <button className="export" onClick={() => exportDashboardPdf(data)}>
          <Download size={17} /> Export report
        </button>
      </div>

      <div className="stats">
        <StatCard
          label={`RT60 (${rt60.source})`}
          value={fmt(rt60.measured)}
          unit="s"
          status={qualified ? "in target" : `${band} target`}
          statusColor={qualified ? c.ok : c.bad}
        />
        <StatCard
          label="ROOM VOLUME"
          value={fmt(room.volume, 1)}
          unit="m³"
          status="from scan"
          statusColor={c.ok}
        />
        <StatCard
          label="FLOOR AREA"
          value={fmt(room.area)}
          unit="m²"
          status="fitted"
          statusColor={c.ok}
        />
        <StatCard
          label="QUALIFICATION"
          value={qualified ? "Qualified" : "Not qualified"}
          valueColor={qualified ? c.ok : c.warn}
          status={qualified ? "meets ISO 23591" : "needs treatment"}
          statusColor={qualified ? c.ok : c.bad}
        />
      </div>

      <div className="grid2">
        <div className="card twin">
          <div className="twin-head">
            <h3 className="panel-title">Room twin</h3>
            <p className="panel-sub">
              Fitted shell + detected edges · {fmt(room.height)} m ceiling
            </p>
          </div>
          <div className="twin-canvas">
            <RoomTwin room={room} markers={markers} colors={c} />
          </div>
          <div className="legend">
            <span><i className="swatch" style={{ background: c.shell }} /> shell</span>
            <span><i className="swatch" style={{ background: c.edge }} /> edges</span>
            <span><i className="swatch" style={{ background: c.hot }} /> hot</span>
            <span><i className="swatch" style={{ background: c.dead }} /> dead</span>
          </div>
          <div className="orbit-hint">drag to orbit</div>
        </div>

        <div className="card">
          <h3 className="panel-title">RT60 vs target</h3>
          <p className="panel-sub">Reverberation time</p>
          <div className="rt-value">
            {fmt(rt60.measured)}<small>s</small>
          </div>
          <Rt60Bar measured={rt60.measured} />
          <p className="rt-note">
            Measured RT60 sits {band === "in" ? "within" : band}{" "}
            {band !== "in" ? "the" : ""}{" "}
            <b>{fmt(CONFIG.target.low)}–{fmt(CONFIG.target.high)} s</b> target band
            for this room volume. Adding absorption will pull it down into range.
          </p>
          <div className="dims">
            <div className="dim"><label>Width</label><div>{fmt(room.width)} m</div></div>
            <div className="dim"><label>Length</label><div>{fmt(room.length)} m</div></div>
            <div className="dim"><label>Height</label><div>{fmt(room.height)} m</div></div>
            <div className="dim"><label>Area</label><div>{fmt(room.area)} m²</div></div>
          </div>
        </div>
      </div>

      <div className="grid2">
        <Recommendations />
        <ScanCoverage />
      </div>
    </div>
  );
}
