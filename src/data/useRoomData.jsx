import React, { createContext, useContext, useEffect, useState } from "react";
import { CONFIG } from "../config.js";
import { fitRoom } from "../lib/fitRoom.js";
import { fetchCsv } from "../lib/csv.js";
import { isQualified, bandPosition } from "../lib/acoustics.js";

/* Holds the current scan as one derived object the whole app reads.
   Swap dataSource in config.js to move between sample and live sheet. */

const RoomDataContext = createContext(null);

function buildFromSample() {
  const s = CONFIG.sample;
  const room = fitRoom(s.cardinal);
  return {
    loading: false,
    error: null,
    scan: s.scan,
    room,
    rt60: s.rt60,
    markers: s.markers,
    coverage: s.coverage,
  };
}

/* Reduce raw Reverberation-tab rows into markers + average RT60.
   Expects columns like: type (hot/dead/neutral), rt60, x, z, y.
   Adjust the column names to match your actual sheet. */
function reduceReverb(rows) {
  const hot = [];
  const dead = [];
  let sum = 0;
  let count = 0;
  rows.forEach((r) => {
    const rt = Number(r.rt60 ?? r.RT60 ?? 0);
    if (rt > 0) {
      sum += rt;
      count++;
    }
    const type = (r.type ?? r.Type ?? "").toLowerCase();
    const pos = {
      x: Number(r.x ?? 0),
      z: Number(r.z ?? 0),
      y: Number(r.y ?? 1.2),
    };
    if (type === "hot" || type === "hotspot") hot.push(pos);
    if (type === "dead" || type === "deadspot") dead.push(pos);
  });
  const measured = count ? sum / count : 0;
  return { markers: { hot, dead }, measured };
}

async function buildFromSheet() {
  const { csv } = CONFIG.sheet;
  if (!csv.room || !csv.reverberation) {
    throw new Error(
      "Set sheet.csv.room and sheet.csv.reverberation in config.js"
    );
  }
  const [roomRows, reverbRows] = await Promise.all([
    fetchCsv(csv.room),
    fetchCsv(csv.reverberation),
  ]);

  // Take the most recent Room row.
  const last = roomRows[roomRows.length - 1] || {};
  const cardinal = {
    N: Number(last.N ?? last.north ?? 0),
    S: Number(last.S ?? last.south ?? 0),
    E: Number(last.E ?? last.east ?? 0),
    W: Number(last.W ?? last.west ?? 0),
    height: Number(last.height ?? last.Height ?? 0),
  };
  const room = fitRoom(cardinal);
  const { markers, measured } = reduceReverb(reverbRows);

  return {
    loading: false,
    error: null,
    scan: {
      points: roomRows.length,
      device: "LD06 + ultrasonic",
    },
    room,
    rt60: { measured, source: "MEASURED" },
    markers,
    coverage: CONFIG.sample.coverage, // replace once you log coverage
  };
}

export function RoomDataProvider({ children }) {
  const [state, setState] = useState(
    CONFIG.dataSource === "sheet"
      ? { loading: true, error: null }
      : buildFromSample()
  );

  useEffect(() => {
    let cancelled = false;
    if (CONFIG.dataSource === "sheet") {
      buildFromSheet()
        .then((d) => !cancelled && setState(d))
        .catch(
          (e) =>
            !cancelled &&
            setState({ loading: false, error: e.message })
        );
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const derived = state.room
    ? {
        qualified: isQualified(state.rt60.measured, CONFIG.target),
        band: bandPosition(state.rt60.measured, CONFIG.target),
      }
    : {};

  return (
    <RoomDataContext.Provider value={{ ...state, ...derived }}>
      {children}
    </RoomDataContext.Provider>
  );
}

export function useRoomData() {
  const ctx = useContext(RoomDataContext);
  if (!ctx) throw new Error("useRoomData must be used inside RoomDataProvider");
  return ctx;
}
