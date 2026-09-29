import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  History as HistoryIcon,
  RotateCcw,
  Trash2,
  Home,
  Ruler,
  Clock,
  Layers,
} from "lucide-react";

import { vibraHistory } from "./vibraHistory";


/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */

const numish = (value) =>
  value !== "" &&
  value != null &&
  !isNaN(parseFloat(value)) &&
  isFinite(value);

const fmtDim = (value) =>
  numish(value)
    ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })} m`
    : "—";

const fmtSaved = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

/* Where the Parameters table lives (same path as the sidebar link). */
const PARAMETERS_PATH = "/parameters";


/* -------------------------------------------------------
   History Page
   All styling comes from styles.css (.vwrap / .vhead /
   .hist-* / .btn), so the page follows the theme tokens.
------------------------------------------------------- */

/**
 * @param {(entry) => void} [onRestore]
 * Optional. Called after a restore is requested. When it is not given,
 * the page navigates to the Parameters table itself.
 */
export default function HistoryPage({ onRestore } = {}) {
  const navigate = useNavigate();
  const [items, setItems] = useState(() => vibraHistory.list());
  const [confirmId, setConfirmId] = useState(null);

  /* Follow the saved list live (saves from the Parameters table, deletes). */
  useEffect(() => vibraHistory.subscribe(setItems), []);

  /* Restore a saved scan.
     requestRestore() only hands the scan over; the Parameters table loads it
     when it mounts. Before, nothing moved the user to that page unless an
     onRestore prop was wired up in App.jsx, so the button looked dead. It
     now opens the Parameters table, where the scan appears with a
     "Restored room scan …" toast. */
  const restore = (entry) => {
    vibraHistory.requestRestore(entry);
    if (typeof onRestore === "function") onRestore(entry);
    else navigate(PARAMETERS_PATH);
  };

  const del = (id) => {
    vibraHistory.remove(id);
    setConfirmId(null);
  };

  return (
    <div className="vwrap narrow">
      <div className="vhead">
        <h1>History</h1>
        <p className="sub">Saved room scans — restore one back into the Parameters table, or remove it.</p>
      </div>

      {items.length === 0 ? (
        <div className="hist-empty">
          <HistoryIcon size={26} color="var(--faint)" />
          <div className="big">No saved scans yet.</div>
          <div className="small">
            Open the Parameters table, pick a room scan, and hit <b className="ink">Save</b>.
          </div>
        </div>
      ) : (
        <div className="hist-list">
          {items.map((entry) => {
            const tabNames = Object.keys(entry.tabs || {});
            const rowCount = (label) => entry.tabs?.[label]?.rows?.length ?? 0;

            return (
              <div key={entry.id} className="hist-card">
                <span className="hist-ic">
                  <Home size={19} color="var(--violet)" />
                </span>

                <div className="hist-main">
                  <div className="hist-ts">
                    <Clock size={14} color="var(--muted)" />
                    {entry.roomTs || entry.label}
                  </div>
                  <div className="hist-saved">Saved {fmtSaved(entry.savedAt)}</div>
                </div>

                <div className="hist-dims">
                  <Ruler size={14} color="var(--violet)" />
                  {fmtDim(entry.dims?.width)} × {fmtDim(entry.dims?.length)} × {fmtDim(entry.dims?.height)}
                </div>

                <div className="hist-tabs">
                  <Layers size={14} color="var(--faint)" />
                  {tabNames.map((tab) => (
                    <span key={tab} className="chip">{tab} · {rowCount(tab)}</span>
                  ))}
                </div>

                <div className="hist-actions">
                  <button type="button" className="btn btn--primary" onClick={() => restore(entry)}>
                    <RotateCcw size={15} color="#17131f" />
                    Restore
                  </button>

                  {confirmId === entry.id ? (
                    <>
                      <button type="button" className="btn btn--danger" onClick={() => del(entry.id)}>
                        Confirm delete
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={() => setConfirmId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--danger" onClick={() => setConfirmId(entry.id)}>
                      <Trash2 size={15} color="var(--bad)" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}