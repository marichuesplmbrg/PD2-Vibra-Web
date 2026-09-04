import React, { useState, useEffect } from "react";
import { History as HistoryIcon, RotateCcw, Trash2, Home, Ruler, Clock, Layers } from "lucide-react";
import { vibraHistory } from "./vibraHistory";

const numish = (v) => v !== "" && v != null && !isNaN(parseFloat(v)) && isFinite(v);
const fmtDim = (v) => (numish(v) ? `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 })} m` : "—");
const fmtSaved = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } };

/**
 * History page.
 * @param {(entry)=>void} [onRestore] called after a restore is requested — use
 *        it to navigate to the Parameters table page in your app's router.
 */
export default function HistoryPage({ onRestore } = {}) {
  const [items, setItems] = useState(() => vibraHistory.list());
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => vibraHistory.subscribe(setItems), []);

  const restore = (entry) => { vibraHistory.requestRestore(entry); if (typeof onRestore === "function") onRestore(entry); };
  const del = (id) => { vibraHistory.remove(id); setConfirmId(null); };

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
          <div className="small">Open the Parameters table, pick a room scan, and hit <b className="ink">Save</b>.</div>
        </div>
      ) : (
        <div className="hist-list">
          {items.map((e) => {
            const tabNames = Object.keys(e.tabs || {});
            const rowCount = (label) => (e.tabs?.[label]?.rows?.length ?? 0);
            return (
              <div key={e.id} className="hist-card">
                <span className="hist-ic"><Home size={19} color="var(--violet)" /></span>

                <div className="hist-main">
                  <div className="hist-ts"><Clock size={14} color="var(--muted)" />{e.roomTs || e.label}</div>
                  <div className="hist-saved">Saved {fmtSaved(e.savedAt)}</div>
                </div>

                <div className="hist-dims">
                  <Ruler size={14} color="var(--violet)" />
                  {fmtDim(e.dims?.width)} × {fmtDim(e.dims?.length)} × {fmtDim(e.dims?.height)}
                </div>

                <div className="hist-tabs">
                  <Layers size={14} color="var(--faint)" />
                  {tabNames.map((t) => <span key={t} className="chip">{t} · {rowCount(t)}</span>)}
                </div>

                <div className="hist-actions">
                  <button className="btn btn--primary" onClick={() => restore(e)}><RotateCcw size={15} color="#17131f" /> Restore</button>
                  {confirmId === e.id ? (
                    <>
                      <button className="btn btn--danger" onClick={() => del(e.id)}>Confirm delete</button>
                      <button className="btn btn--ghost" onClick={() => setConfirmId(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn--danger" onClick={() => setConfirmId(e.id)}><Trash2 size={15} color="var(--bad)" /> Delete</button>
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