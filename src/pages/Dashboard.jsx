import React from "react";
import { Download, Waves, TrendingDown } from "lucide-react";

import { CONFIG, fmt } from "../config.js";
import { useRoomData } from "../data/useRoomData.jsx";
import { exportDashboardPdf } from "../lib/exportDashboardPdf.js";
import SimulationPage from "./Simulation.jsx";


/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */

const bandText = (band) => {
  if (band === "in") return "in target";
  if (band === "below") return "below target";
  if (band === "above") return "above target";
  return `${band} target`;
};

const whenText = (ts) => {
  if (!ts) return null;

  try {
    return new Date(
      String(ts).replace(" ", "T")
    ).toLocaleString();
  } catch {
    return ts;
  }
};


/* -------------------------------------------------------
   Dashboard
------------------------------------------------------- */

export default function Dashboard() {
  const data = useRoomData();
  const c = CONFIG.colors;

  /* Loading */
  if (data.loading) {
    return (
      <div className="page">
        <p className="panel-sub">
          Loading scan…
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

  const {
    room,
    rt60,
    scan,
    qualified,
    band,
    coverage,
    roomTs,
  } = data;

  const when = whenText(roomTs);


  return (
    <div className="page">

      {/* -------------------------------------------------
          Header
      ------------------------------------------------- */}

      <div className="pagehead">
        <div>
          <h1>Room analysis</h1>

          <p className="sub">
            {when
              ? `Last scan ${when}`
              : "Sample scan"}
            {" · "}
            {scan.points.toLocaleString()} points
            {" · "}
            {scan.device}
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
          Top statistics
      ------------------------------------------------- */}

      <div className="dash-top">

        <Stat
          label="ROOM VOLUME"
          value={fmt(room.volume, 1)}
          unit="m³"
          status="from scan"
          statusColor={c.ok}
        />

        <Stat
          label="FLOOR AREA"
          value={fmt(room.area)}
          unit="m²"
          status="fitted"
          statusColor={c.ok}
        />


        {/* Qualification */}

        <div className="card">

          <div className="qual-head">
            <div className="q-title">
              Qualification
            </div>

            <div className="q-sub">
              Against target for this room
            </div>
          </div>


          <div className="qual-body">

            <div>
              <div
                className="qual-verdict"
                style={{
                  color: qualified
                    ? c.ok
                    : c.warn,
                }}
              >
                {qualified
                  ? "Qualified"
                  : "Not qualified"}
              </div>

              <div className="qual-status">
                <span
                  className="dot"
                  style={{
                    background: qualified
                      ? c.ok
                      : c.bad,
                  }}
                />

                {qualified
                  ? "meets target"
                  : "needs treatment"}
              </div>
            </div>


            <div className="qual-note">
              {qualified
                ? "Measured RT60 is within the target band for this room."
                : "Measured RT60 is outside the target band. See the recommendations to bring it into range."}
            </div>

          </div>
        </div>

      </div>


      {/* -------------------------------------------------
          Room twin + RT60
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
              {" · "}
              {fmt(room.height)} m ceiling
            </p>

          </div>


          <div className="twin-canvas">
            <SimulationPage twinOnly />
          </div>


          <div className="legend">

            <span>
              <i
                className="swatch"
                style={{
                  background: c.shell,
                }}
              />
              shell
            </span>

            <span>
              <i
                className="swatch"
                style={{
                  background: c.edge,
                }}
              />
              edges
            </span>

            <span>
              <i
                className="swatch"
                style={{
                  background: c.hot,
                }}
              />
              hot
            </span>

            <span>
              <i
                className="swatch"
                style={{
                  background: c.dead,
                }}
              />
              dead
            </span>

          </div>


          <div className="orbit-hint">
            drag to orbit · scroll to zoom
          </div>

        </div>


        {/* RT60 */}

        <div className="card">

          <h3 className="panel-title">
            Reverberation (RT60)
          </h3>

          <p className="panel-sub">
            Measured against target band
          </p>


          <div className="rt-head">

            <div className="rt-value">
              {fmt(rt60.measured)}
              <small>s</small>
            </div>

            <div className="rt-band">

              <span
                className="dot"
                style={{
                  background: qualified
                    ? c.ok
                    : c.bad,
                }}
              />

              {bandText(band)}

            </div>

          </div>


          <Rt60Bar
            measured={rt60.measured}
          />


          <p className="rt-note">

            Measured RT60 sits{" "}
            {band === "in"
              ? "within"
              : band}{" "}

            {band !== "in"
              ? "the"
              : ""}{" "}

            <b>
              {fmt(CONFIG.target.low)}
              –
              {fmt(CONFIG.target.high)} s
            </b>{" "}

            target band.{" "}

            {band === "below"
              ? "The room is over-damped — easing off absorption will bring it up."
              : "Adding absorption will pull it down into range."}

          </p>


          {/* Room dimensions */}

          <div className="dims">

            <div className="dim">
              <label>Width</label>
              <div>
                {fmt(room.width)} m
              </div>
            </div>

            <div className="dim">
              <label>Length</label>
              <div>
                {fmt(room.length)} m
              </div>
            </div>

            <div className="dim">
              <label>Height</label>
              <div>
                {fmt(room.height)} m
              </div>
            </div>

            <div className="dim">
              <label>Area</label>
              <div>
                {fmt(room.area)} m²
              </div>
            </div>

          </div>

        </div>

      </div>


      {/* -------------------------------------------------
          Recommendations + Coverage
      ------------------------------------------------- */}

      <div className="grid2">


        {/* Recommendations */}

        <div className="card">

          <h3 className="panel-title">
            Recommendations
          </h3>

          <p className="panel-sub">
            Treatment plan to bring RT60 into target
          </p>


          {CONFIG.recommendations.map((recommendation, index) => (

            <div
              className="rec-item"
              key={index}
            >

              <div className="rec-ic">
                <Waves size={16} />
              </div>


              <div className="rec-body">

                <div className="t">
                  {recommendation.title}
                </div>

                <div className="n">
                  {recommendation.note}
                </div>

              </div>


              {typeof recommendation.delta === "number" && (

                <div className="rec-delta">

                  <TrendingDown size={14} />

                  {fmt(recommendation.delta)} s

                </div>

              )}

            </div>

          ))}

        </div>


        {/* Scan coverage */}

        <div className="card">

          <h3 className="panel-title">
            Scan coverage
          </h3>

          <p className="panel-sub">
            Walls seen by the LiDAR sweep
          </p>


          {["N", "E", "S", "W"].map((direction) => (

            <div
              className="cov-row"
              key={direction}
            >

              <div className="cov-lbl">
                {direction}
              </div>


              <div className="cov-track">

                <div
                  className="cov-fill"
                  style={{
                    width: `${
                      coverage?.[direction] ?? 0
                    }%`,
                  }}
                />

              </div>


              <div className="cov-pct">
                {coverage?.[direction] ?? 0}%
              </div>

            </div>

          ))}


          <div className="cov-foot">
            Higher coverage means the fitted rectangle
            matches the real walls more closely.
          </div>

        </div>

      </div>

    </div>
  );
}


/* -------------------------------------------------------
   Stat card
------------------------------------------------------- */

function Stat({
  label,
  value,
  unit,
  valueColor,
  status,
  statusColor,
}) {
  return (
    <div className="card">

      <div className="stat-label">
        {label}
      </div>


      <div
        className="stat-value"
        style={
          valueColor
            ? { color: valueColor }
            : undefined
        }
      >
        {value}

        {unit && (
          <span className="stat-unit">
            {unit}
          </span>
        )}
      </div>


      <div className="stat-status">

        <span
          className="dot"
          style={{
            background: statusColor,
          }}
        />

        {status}

      </div>

    </div>
  );
}


/* -------------------------------------------------------
   RT60 bar
------------------------------------------------------- */

function Rt60Bar({ measured }) {
  const {
    low,
    high,
    scaleMax,
  } = CONFIG.target;


  const pct = (value) =>
    Math.max(
      0,
      Math.min(
        100,
        (value / (scaleMax || 1)) * 100
      )
    );


  return (
    <div className="rtbar-wrap">

      <div className="rtbar-track">

        <div
          className="rtbar-band"
          style={{
            left: `${pct(low)}%`,
            width: `${pct(high) - pct(low)}%`,
          }}
        />


        <div
          className="rtbar-fill"
          style={{
            width: `${pct(measured)}%`,
          }}
        />


        <div
          className="rtbar-marker"
          style={{
            left: `${pct(measured)}%`,
          }}
        />

      </div>


      <div className="rtbar-scale">

        <span>
          0
        </span>

        <span>
          {fmt(
            (scaleMax || 1) / 2,
            1
          )}
        </span>

        <span>
          {fmt(
            scaleMax || 1,
            1
          )} s
        </span>

      </div>

    </div>
  );
}