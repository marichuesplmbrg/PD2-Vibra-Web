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
const DEPLOY_KEY = "vibra.deploy.v1";

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
  clearWorking() {
    workMem = null;
    if (canLS) { try { localStorage.removeItem(WORK_KEY); } catch { /* ignore */ } }
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
  onDeploy(fn) { deployListeners.add(fn); return () => deployListeners.delete(fn); },
};