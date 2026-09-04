import React from "react";
import { useRoomData } from "../data/useRoomData.jsx";

export default function ScanCoverage() {
  const { coverage, scan } = useRoomData();
  return (
    <div className="card">
      <h3 className="panel-title">Scan coverage</h3>
      <p className="panel-sub">Walls seen by the LiDAR</p>
      {Object.entries(coverage).map(([k, v]) => (
        <div className="cov-row" key={k}>
          <div className="cov-lbl">{k}</div>
          <div className="cov-track">
            <div className="cov-fill" style={{ width: `${v}%` }} />
          </div>
          <div className="cov-pct">{v}%</div>
        </div>
      ))}
      <div className="cov-foot">
        {scan.points.toLocaleString()} points across 4 cardinal rays.
      </div>
    </div>
  );
}
