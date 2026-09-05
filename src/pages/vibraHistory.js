// Shared store for saved room scans + the current working session, used by both
// the Parameters table and the History page.
//
// - Saved list: the user's saved room scans (History page).
// - Working session: the sheets/tab/scan currently loaded in the Parameters
//   table. Kept in module memory so it survives page navigation within the app
//   (the component unmounts, but this module stays loaded), and mirrored to
//   localStorage best-effort so it also survives a full reload.
//
// A tiny pub/sub keeps every page in sync.

const KEY = "vibra.history.v1";
const RESTORE_KEY = "vibra.history.restore.v1";
const WORK_KEY = "vibra.work.v1";
// v2: the v1 key was write-only — nothing in the app could ever remove it, so
// any deployment made during development is still sitting in localStorage and
// rebuilds the twin on every load. Bumping the key retires those records, and
// the purge below deletes them outright so they can't be read back.
const DEPLOY_KEY = "vibra.deploy.v2";
const LEGACY_DEPLOY_KEYS = ["vibra.deploy.v1"];

const listeners = new Set();        // notified when the saved list changes
const restoreListeners = new Set(); // notified when a restore is requested
const deployListeners = new Set();  // notified when a scan is deployed to Simulation

let mem = null;         // cached saved list
let restoreMem = null;  // pending restore payload
let workMem = null;     // current working session (survives navigation)
let deployMem = null;   // current deployment for the Simulation page

const canLS = (() => {
  try { const k = "__vibra_t"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; }
  catch { return false; }
})();

// Runs once, at import, before anything can call getDeployment().
if (canLS) {
  for (const k of LEGACY_DEPLOY_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
}

function read() {
  if (mem) return mem;
  if (canLS) { try { mem = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { mem = []; } }
  else mem = [];
  return mem;
}
function write(list) {
  mem = list;
  if (canLS) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore quota */ } }
  listeners.forEach((f) => f([...list]));
}

export const vibraHistory = {
  /* --- saved list --- */
  list() { return [...read()]; },
  add(entry) {
    const e = { id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ...entry };
    write([e, ...read()]);
    return e;
  },
  remove(id) { write(read().filter((e) => e.id !== id)); },
  clear() { write([]); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /* --- restore handoff (History page -> Parameters table) --- */
  requestRestore(entry) {
    restoreMem = entry;
    if (canLS) { try { localStorage.setItem(RESTORE_KEY, JSON.stringify(entry)); } catch { /* ignore */ } }
    restoreListeners.forEach((f) => f(entry));
  },
  onRestore(fn) { restoreListeners.add(fn); return () => restoreListeners.delete(fn); },
  consumeRestore() {
    if (restoreMem) return restoreMem;
    if (canLS) { try { return JSON.parse(localStorage.getItem(RESTORE_KEY) || "null"); } catch { return null; } }
    return null;
  },
  clearRestore() {
    restoreMem = null;
    if (canLS) { try { localStorage.removeItem(RESTORE_KEY); } catch { /* ignore */ } }
  },

  /* --- working session (persists across page navigation) --- */
  saveWorking(state) {
    workMem = state;
    if (canLS) { try { localStorage.setItem(WORK_KEY, JSON.stringify(state)); } catch { /* ignore quota */ } }
  },
  loadWorking() {
    if (workMem) return workMem;
    if (canLS) { try { return JSON.parse(localStorage.getItem(WORK_KEY) || "null"); } catch { return null; } }
    return null;
  },
  // Clearing the working session also drops the deployment: the Simulation page
  // is a view of the table's data, so leaving a deployment behind after a reset
  // would show a twin built from rows that no longer exist anywhere.
  clearWorking() {
    workMem = null;
    if (canLS) { try { localStorage.removeItem(WORK_KEY); } catch { /* ignore */ } }
    this.clearDeployment();
  },

  /* --- deployment (Parameters table -> Simulation page) --- */
  deploy(payload) {
    deployMem = payload;
    if (canLS) { try { localStorage.setItem(DEPLOY_KEY, JSON.stringify(payload)); } catch { /* ignore quota */ } }
    deployListeners.forEach((f) => f(payload));
  },
  getDeployment() {
    if (deployMem) return deployMem;
    if (canLS) { try { return JSON.parse(localStorage.getItem(DEPLOY_KEY) || "null"); } catch { return null; } }
    return null;
  },
  // Drop the current deployment and tell the Simulation page to go blank.
  // Both the in-memory cache and the localStorage mirror must go: clearing only
  // the cache leaves getDeployment() falling straight through to the stored
  // copy on the next read, which is why a reset never took effect before.
  clearDeployment() {
    deployMem = null;
    if (canLS) { try { localStorage.removeItem(DEPLOY_KEY); } catch { /* ignore */ } }
    deployListeners.forEach((f) => f(null));
  },
  hasDeployment() { return !!this.getDeployment(); },
  // One call for a "Reset" control: wipes the working session, the pending
  // restore handoff and the deployment. Leaves the user's saved scans alone —
  // use clear() for those.
  resetSession() {
    this.clearRestore();
    this.clearWorking();
  },
  onDeploy(fn) { deployListeners.add(fn); return () => deployListeners.delete(fn); },
};

/* Dev escape hatch: from the browser console you can run
     vibraHistory.getDeployment()   -> see exactly what the twin is built from
     vibraHistory.clearDeployment() -> blank the Simulation page immediately
   Useful for telling "stale stored data" apart from "the reset button isn't
   wired up", which look identical from the UI. */
if (typeof window !== "undefined") window.vibraHistory = vibraHistory;

/* Keep tabs in sync: if the deployment is cleared or replaced in another tab,
   mirror it here instead of serving a cached copy that no longer exists. */
if (canLS && typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== DEPLOY_KEY) return;
    let next = null;
    try { next = e.newValue ? JSON.parse(e.newValue) : null; } catch { next = null; }
    deployMem = next;
    deployListeners.forEach((f) => f(next));
  });
}