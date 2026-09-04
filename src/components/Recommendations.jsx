import React from "react";
import { Waves, ArrowDown } from "lucide-react";
import { CONFIG, fmt } from "../config.js";

export default function Recommendations() {
  return (
    <div className="card">
      <h3 className="panel-title">Recommendations</h3>
      <p className="panel-sub">To bring RT60 into target</p>
      <div style={{ marginTop: 8 }}>
        {CONFIG.recommendations.map((r, i) => (
          <div className="rec-item" key={i}>
            <div className="rec-ic">
              <Waves size={17} />
            </div>
            <div className="rec-body">
              <div className="t">{r.title}</div>
              <div className="n">{r.note}</div>
            </div>
            <div className="rec-delta">
              <ArrowDown size={13} />
              {fmt(r.delta)} s
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
