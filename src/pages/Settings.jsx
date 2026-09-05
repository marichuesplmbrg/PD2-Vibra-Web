import React, { useState } from "react";
import { Settings2, Database, Info, Check, AlertCircle } from "lucide-react";
import { vibraHistory } from "./vibraHistory";

/* Settings — deliberately minimal for now.
 *
 * The only live control is the session reset, because that one already has a
 * real store behind it. Everything else is a placeholder: add sections here as
 * you decide what belongs on this page. The markup reuses the same class names
 * as the other pages (vwrap / vhead / section head + body), so anything you add
 * inherits the existing styling without new CSS. */

export default function SettingsPage() {
  const [toast, setToast] = useState(null);
  const [armed, setArmed] = useState(false);

  const flash = (kind, msg) => { setToast({ kind, msg }); setTimeout(() => setToast(null), 2600); };

  const resetSession = () => {
    vibraHistory.resetSession();
    setArmed(false);
    flash("ok", "Working session and deployment cleared.");
  };

  return (
    <div className="vwrap">
      <div className="vhead">
        <h1>Settings</h1>
        <p className="sub">Application preferences and stored data</p>
      </div>

      {/* --- live section --- */}
      <section className="rec" style={{ marginBottom: 16 }}>
        <div className="rec-head">
          <span className="ic"><Database size={16} color="var(--violet)" /></span>
          <div>
            <div className="t">Stored data</div>
            <div className="s">Clears the working session and anything deployed to Simulation</div>
          </div>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", fontSize: "0.88em", lineHeight: 1.55, opacity: 0.75 }}>
            Resets the Parameters table to empty and blanks the Simulation page.
            Saved room scans on the History page are not affected.
          </div>
          {armed ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn--danger" onClick={resetSession}>Confirm reset</button>
              <button className="btn btn--ghost" onClick={() => setArmed(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn" onClick={() => setArmed(true)}>Reset session</button>
          )}
        </div>
      </section>

      {/* --- placeholder --- */}
      <section className="rec">
        <div className="rec-head">
          <span className="ic"><Settings2 size={16} color="var(--orange)" /></span>
          <div>
            <div className="t">Preferences</div>
            <div className="s">Not configured yet</div>
          </div>
        </div>
        <div className="rec-empty" style={{ display: "flex", alignItems: "flex-start", gap: 10, lineHeight: 1.55 }}>
          <Info size={15} color="var(--faint)" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Nothing here yet. Likely candidates: the RT60 target band (currently
            fixed at 0.4–0.6 s in <code>Simulation.jsx</code>), the Google Sheet
            ID used for cloud import, and the prototype model path.
          </span>
        </div>
      </section>

      {toast && (
        <div className={`toast${toast.kind === "err" ? " err" : ""}`}>
          <span className="toast-ic">
            {toast.kind === "err" ? <AlertCircle size={13} color="var(--bad)" /> : <Check size={13} color="var(--ok)" />}
          </span>
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}