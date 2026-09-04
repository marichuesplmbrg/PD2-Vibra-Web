import React from "react";
import { CONFIG } from "../config.js";

export default function Rt60Bar({ measured }) {
  const t = CONFIG.target;
  const pct = (v) => `${(v / t.scaleMax) * 100}%`;
  const measuredPct = Math.min(100, (measured / t.scaleMax) * 100);

  return (
    <div className="rtbar-wrap">
      <div className="rtbar-track">
        <div className="rtbar-fill" style={{ width: `${measuredPct}%` }} />
        <div
          className="rtbar-band"
          style={{ left: pct(t.low), width: pct(t.high - t.low) }}
        />
        <div className="rtbar-marker" style={{ left: `${measuredPct}%` }} />
      </div>
      <div className="rtbar-scale">
        <span>0</span>
        <span>{(t.scaleMax / 2).toFixed(1)}</span>
        <span>{t.scaleMax.toFixed(1)} s</span>
      </div>
    </div>
  );
}
