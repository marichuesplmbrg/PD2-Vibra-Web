/* ============================================================
   Vibra shared store
   ------------------------------------------------------------
   A tiny module-level store. Because it lives OUTSIDE the React
   component tree, its values survive route changes (the page
   component unmounting no longer wipes the state). It's also
   mirrored to sessionStorage so a refresh keeps things too.

   Usage in any component:
     import { useVibra, setVibra } from "./vibraStore";
     const state = useVibra();                 // re-renders on change
     setVibra({ deployed: true });             // shallow-merge patch
     setVibra(s => ({ layers: {...s.layers, spots:false} })); // updater
   ============================================================ */

import { useState, useEffect } from "react";

const KEY = "vibra:v1";

const DEFAULTS = {
  scan: null,        // { timestamp, room:{length,width,height}, sensors:[...] }
  deployed: false,   // has the Parameters page been deployed to the twin
  selectedTs: null,  // selected room-scan timestamp on the Parameters page
  sort: "unsorted",  // table sort choice
  layers: { shell: true, edges: true, points: true, spots: true },
  orbitAuto: true,
};

function load() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let state = load();
const listeners = new Set();

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full/unavailable — in-memory store still works */
  }
}

export function getVibra() {
  return state;
}

export function setVibra(patch) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  persist();
  listeners.forEach((l) => l());
}

export function resetVibra() {
  state = { ...DEFAULTS };
  persist();
  listeners.forEach((l) => l());
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* React hook — returns the current state and re-renders on any change.
   Works on React 16.8+ (no useSyncExternalStore dependency). */
export function useVibra() {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  return state;
}