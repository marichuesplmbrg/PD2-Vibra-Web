import React from "react";

export default function StatCard({
  label,
  value,
  unit,
  status,
  statusColor,
  valueColor,
}) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      <div className="stat-status">
        <span className="dot" style={{ background: statusColor }} />
        {status}
      </div>
    </div>
  );
}
