import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  Table2, ChevronDown, Upload, Download, Rocket, Cloud, HardDrive, Check,
  Ruler, Box, AlertCircle, Clock, Home, Save, RotateCcw, Radar, Volume2,
} from "lucide-react";
import { vibraHistory } from "./vibraHistory";

const SHEET_ID = "1OaEfDYphqES4umBGZp33KFWuX1GjawaXj5HtRsFNNdc";
const CLOUD_TABS = ["Room", "Obstacle", "Reverberation", "Classification"];
const gvizUrl = (tab) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
const INITIAL_SHEETS = {};
const TABLE_H = 460; // fixed height of each scan table

/* ---- helpers ---- */
const numish = (v) => v !== "" && v != null && !isNaN(parseFloat(v)) && isFinite(v);
const fmtNum = (v) => (numish(v) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 }) : v);
const parseTs = (s) => { const t = Date.parse(String(s).trim().replace(" ", "T")); return isNaN(t) ? null : t; };

function parseCSV(text) {
  const clean = String(text).replace(/^\uFEFF/, "").replace(/\r/g, "");
  const grid = clean.split("\n").map((line) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  });
  return grid.filter((r) => r.some((c) => c !== ""));
}
const gridToSheet = (grid) => (grid.length ? { columns: grid[0], rows: grid.slice(1) } : { columns: [], rows: [] });
const tsIndex = (cols) => cols.findIndex((c) => /timestamp|time|date/i.test(c));
const linkIndex = (cols) => cols.findIndex((c) => /(?:room|scan|session)[_\s-]?id/i.test(c));
const hasDimCols = (cols) => cols.some((c) => /width/i.test(c)) && cols.some((c) => /length/i.test(c)) && cols.some((c) => /height/i.test(c));
const dimsFromRow = (cols, row) => {
  const find = (re) => cols.findIndex((c) => re.test(c));
  const wI = find(/width/i), lI = find(/length/i), hI = find(/height/i);
  const w = wI >= 0 ? row[wI] : "", l = lI >= 0 ? row[lI] : "", h = hI >= 0 ? row[hI] : "";
  return {
    width: numish(w) ? parseFloat(w) : null,
    length: numish(l) ? parseFloat(l) : null,
    height: numish(h) ? (/cm/i.test(cols[hI]) ? parseFloat(h) / 100 : parseFloat(h)) : null,
  };
};
function groupOf(sheet) {
  const label = (sheet.label || "").toLowerCase();
  if (hasDimCols(sheet.columns)) return "dimensions";
  if (/obstacle/.test(label)) return "obstacles";
  if (/reverb/.test(label)) return "reverberation";
  if (/class/.test(label)) return "classification";
  const cols = sheet.columns;
  if (cols.some((c) => /^x|_x|x_/i.test(c)) && cols.some((c) => /^y|_y|y_/i.test(c))) return "obstacles";
  return "acoustic";
}
const isPhysical = (g) => g === "dimensions" || g === "obstacles";

function linkRows(targetSheet, session, anchorLinkCol, sessions) {
  if (!targetSheet || !session) return { rows: [], method: "none", ts: null };
  const linkT = linkIndex(targetSheet.columns);
  let rows, method;
  if (linkT >= 0 && anchorLinkCol >= 0 && session.linkId) {
    rows = targetSheet.rows.filter((r) => r[linkT] === session.linkId); method = "id";
  } else {
    const tcol = tsIndex(targetSheet.columns);
    if (tcol < 0) { rows = []; method = "none"; }
    else {
      const pos = sessions.findIndex((s) => s.ts === session.ts);
      const start = session.tsNum ?? -Infinity;
      const end = pos >= 0 && pos + 1 < sessions.length ? (sessions[pos + 1].tsNum ?? Infinity) : Infinity;
      rows = targetSheet.rows.filter((r) => { const t = parseTs(r[tcol]); return t != null && t >= start && t < end; });
      method = "time";
    }
  }
  return { rows, method, ts: null };
}

/* ================================================================== */
export default function ParametersTable({ onSave } = {}) {
  const initRef = useRef(null);
  if (initRef.current === null) initRef.current = vibraHistory.loadWorking() || {};
  const init = initRef.current;

  const [sheets, setSheets] = useState(init.sheets || INITIAL_SHEETS);
  const [sessionKey, setSessionKey] = useState(init.sessionKey ?? "");
  const [physId, setPhysId] = useState(init.physId || "");
  const [acouId, setAcouId] = useState(init.acouId || "");

  const [roomMenu, setRoomMenu] = useState(false);
  const [importMenu, setImportMenu] = useState(false);
  const [toast, setToast] = useState(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3400); return () => clearTimeout(t); }, [toast]);

  /* anchor + sessions */
  const anchorEntry = useMemo(() => Object.entries(sheets).find(([, s]) => hasDimCols(s.columns)) || null, [sheets]);
  const anchorId = anchorEntry ? anchorEntry[0] : null;
  const anchor = anchorEntry ? anchorEntry[1] : null;
  const anchorTsCol = anchor ? tsIndex(anchor.columns) : -1;
  const anchorLinkCol = anchor ? linkIndex(anchor.columns) : -1;

  const sessions = useMemo(() => {
    if (!anchor || anchorTsCol < 0) return [];
    return anchor.rows
      .map((r) => ({ ts: r[anchorTsCol], tsNum: parseTs(r[anchorTsCol]), linkId: anchorLinkCol >= 0 ? r[anchorLinkCol] : null, row: r }))
      .filter((s) => s.ts !== "" && s.ts != null)
      .sort((a, b) => (a.tsNum ?? 0) - (b.tsNum ?? 0));
  }, [anchor, anchorTsCol, anchorLinkCol]);
  const sessionsNewest = useMemo(() => [...sessions].reverse(), [sessions]);
  const sessionSig = sessions.map((s) => s.ts).join("|");
  useEffect(() => {
    const latest = sessions.length ? sessions[sessions.length - 1].ts : "";
    setSessionKey((prev) => (prev && sessions.some((s) => s.ts === prev) ? prev : latest));
  }, [anchorId, sessionSig]);
  const session = sessionKey ? sessions.find((s) => s.ts === sessionKey) || null : null;

  /* grouping + selected tables */
  const physicalList = useMemo(() => Object.entries(sheets).filter(([, s]) => isPhysical(groupOf(s))), [sheets]);
  const acousticList = useMemo(() => Object.entries(sheets).filter(([, s]) => !isPhysical(groupOf(s))), [sheets]);
  const sheetsSig = Object.keys(sheets).join("|");
  useEffect(() => {
    setPhysId((prev) => (prev && sheets[prev] && isPhysical(groupOf(sheets[prev])) ? prev : (anchorId || physicalList[0]?.[0] || "")));
    setAcouId((prev) => {
      if (prev && sheets[prev] && !isPhysical(groupOf(sheets[prev]))) return prev;
      const rev = acousticList.find(([, s]) => /reverb/i.test(s.label));
      return (rev || acousticList[0])?.[0] || "";
    });
  }, [sheetsSig]);

  const physSheet = sheets[physId];
  const acouSheet = sheets[acouId];

  const tableFor = (sheet) => {
    if (!sheet) return { columns: [], rows: [], mode: "empty" };
    if (sheet === anchor) {
      if (!session) return { columns: ["Field", "Value"], rows: [], mode: "record" };
      return { columns: ["Field", "Value"], rows: sheet.columns.map((c, i) => [c, session.row[i]]), mode: "record" };
    }
    const { rows } = linkRows(sheet, session, anchorLinkCol, sessions);
    return { columns: sheet.columns, rows, mode: "rows" };
  };
  const physTable = useMemo(() => tableFor(physSheet), [physSheet, session, sessions]);
  // Acoustic table: show the Reverberation/Classification rows as-is, minus the
  // timestamp column (acoustics isn't picked by timestamp here).
  const acouTable = useMemo(() => {
    if (!acouSheet) return { columns: [], rows: [], mode: "empty" };
    const drop = acouSheet.columns.map((c, i) => (/timestamp|time|date/i.test(c) ? i : -1)).filter((i) => i >= 0);
    if (!drop.length) return { columns: acouSheet.columns, rows: acouSheet.rows, mode: "rows" };
    const keep = (arr) => arr.filter((_, i) => !drop.includes(i));
    return { columns: keep(acouSheet.columns), rows: acouSheet.rows.map(keep), mode: "rows" };
  }, [acouSheet]);

  const dims = useMemo(() => (session ? dimsFromRow(anchor.columns, session.row) : { width: null, length: null, height: null }), [session, anchor]);

  /* import */
  const onLocalFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { columns, rows } = gridToSheet(parseCSV(String(reader.result)));
      const id = `local-${Date.now()}`;
      setSheets((p) => ({ ...p, [id]: { label: `Local · ${file.name.replace(/\.csv$/i, "")}`, source: "local", columns, rows } }));
      setToast({ kind: "ok", msg: `Imported ${rows.length} rows from ${file.name}` });
    };
    reader.readAsText(file); e.target.value = "";
  };
  const importCloud = async () => {
    setImportMenu(false); setCloudBusy(true);
    try {
      const results = await Promise.all(CLOUD_TABS.map(async (tab) => {
        const res = await fetch(gvizUrl(tab));
        if (!res.ok) throw new Error(`${tab}: HTTP ${res.status}`);
        const { columns, rows } = gridToSheet(parseCSV(await res.text()));
        return { tab, columns, rows };
      }));
      setSheets((prev) => { const next = { ...prev }; results.forEach(({ tab, columns, rows }) => { next[`cloud-${tab}`] = { label: tab, source: "cloud", columns, rows }; }); return next; });
      const total = results.reduce((n, r) => n + r.rows.length, 0);
      setToast({ kind: "ok", msg: `Loaded ${results.length} sheets (${total} rows) from Google Sheets` });
    } catch (err) {
      setToast({ kind: "err", msg: `Couldn't reach Google Sheets — ${err.message}. Check the sheet is shared and reachable.` });
    } finally { setCloudBusy(false); }
  };

  /* bundle / deploy / save / export / reset */
  const buildBundle = (sess) => {
    const tabs = {};
    if (anchor) tabs[anchor.label] = { columns: anchor.columns, rows: [sess.row] };
    Object.values(sheets).forEach((s) => {
      if (s === anchor) return;
      if (isPhysical(groupOf(s))) tabs[s.label] = { columns: s.columns, rows: linkRows(s, sess, anchorLinkCol, sessions).rows };
      else tabs[s.label] = { columns: s.columns, rows: s.rows };
    });
    return tabs;
  };
  const deploy = () => {
    if (!session) { setToast({ kind: "err", msg: "Pick a room scan to deploy." }); return; }
    vibraHistory.deploy({ roomTs: session.ts, dims, tabs: buildBundle(session), at: new Date().toISOString() });
    setToast({ kind: "ok", msg: `Deployed room scan ${session.ts} to Simulation` });
  };
  const saveView = () => {
    if (!session) { setToast({ kind: "err", msg: "Pick a room scan to save." }); return; }
    const entry = { label: session.ts, roomTs: session.ts, dims, tabs: buildBundle(session), savedAt: new Date().toISOString() };
    const saved = vibraHistory.add(entry);
    if (typeof onSave === "function") onSave(saved);
    setToast({ kind: "ok", msg: `Saved room scan ${session.ts} to History` });
  };
  const exportTable = (name, columns, rows) => {
    const esc = (c) => { const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [columns, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(name + (session ? "_" + session.ts : "")).replace(/[^\w.-]+/g, "_")}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setToast({ kind: "ok", msg: `Exported ${name} to .csv` });
  };
  const loadBundle = (entry) => {
    if (!entry || !entry.tabs) return;
    const next = {};
    Object.entries(entry.tabs).forEach(([label, t]) => { next[`saved-${label}`] = { label, source: "cloud", columns: t.columns || [], rows: t.rows || [] }; });
    setSheets(next);
    setToast({ kind: "ok", msg: `Restored room scan ${entry.roomTs || entry.label}` });
  };
  useEffect(() => {
    const pending = vibraHistory.consumeRestore();
    if (pending) { loadBundle(pending); vibraHistory.clearRestore(); }
    return vibraHistory.onRestore((entry) => { loadBundle(entry); vibraHistory.clearRestore(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { vibraHistory.saveWorking({ sheets, sessionKey, physId, acouId }); }, [sheets, sessionKey, physId, acouId]);
  const resetAll = () => {
    vibraHistory.clearWorking();
    setSheets(INITIAL_SHEETS); setSessionKey(""); setPhysId(""); setAcouId(""); setResetArmed(false);
    setToast({ kind: "ok", msg: "Cleared the current scan data" });
  };

  const hasSheets = Object.keys(sheets).length > 0;
  const roomLabel = session ? session.ts : (sessions.length ? "Select a scan" : "No room scans");

  return (
    <div className="vwrap">
      <div className="vhead">
        <h1>Parameters table</h1>
        <p className="sub">One room scan at a time — LiDAR physical scan and sound-sensor acoustic scan, side by side.</p>
      </div>

      {/* toolbar */}
      <div className="pt-toolbar">
        {/* Room scan */}
        <div className="menu-wrap">
          <button className="btn" onClick={() => { setRoomMenu((v) => !v); setImportMenu(false); }} disabled={!sessions.length}>
            <Home size={15} color={session ? "var(--violet)" : "var(--faint)"} />
            <span className={`pick-lbl w200${session ? " on" : ""}`}>{roomLabel}</span>
            <ChevronDown size={15} color="var(--muted)" className={`chev${roomMenu ? " open" : ""}`} />
          </button>
          {roomMenu && (
            <Menu onClose={() => setRoomMenu(false)} width={260} scroll>
              {sessionsNewest.length === 0 ? <div className="menu-note">No room scans loaded.</div>
                : sessionsNewest.map((s, i) => (
                  <MenuItem key={s.ts} active={sessionKey === s.ts} onClick={() => { setSessionKey(s.ts); setRoomMenu(false); }}>
                    <span className="menu-left"><Home size={14} color="var(--faint)" /><span className="ell">{s.ts}</span>{i === 0 && <span className="menu-latest">latest</span>}</span>
                    {sessionKey === s.ts && <Check size={15} color="var(--ok)" />}
                  </MenuItem>
                ))}
            </Menu>
          )}
        </div>

        {/* Import */}
        <div className="menu-wrap">
          <button className="btn" onClick={() => { setImportMenu((v) => !v); setRoomMenu(false); }} disabled={cloudBusy}>
            <Upload size={15} color="var(--muted)" /><span>{cloudBusy ? "Importing…" : "Import"}</span>
            <ChevronDown size={15} color="var(--muted)" className={`chev${importMenu ? " open" : ""}`} />
          </button>
          {importMenu && (
            <Menu onClose={() => setImportMenu(false)} width={250}>
              <MenuItem onClick={() => { setImportMenu(false); fileRef.current?.click(); }}><span className="menu-left"><HardDrive size={15} color="var(--orange)" /> Import local (.csv)</span></MenuItem>
              <MenuItem onClick={importCloud}><span className="menu-left"><Cloud size={15} color="var(--violet)" /> Import cloud (Google Sheets)</span></MenuItem>
            </Menu>
          )}
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onLocalFile} className="file-input" />
        </div>

        <div className="pt-actions">
          <button className="btn btn--primary" onClick={deploy} disabled={!session}><Rocket size={15} color="#17131f" /><span>Deploy to Simulation</span></button>
          <button className="btn btn--save" onClick={saveView} disabled={!session}><Save size={15} color="var(--ok)" /><span>Save</span></button>
          {resetArmed ? (
            <>
              <button className="btn btn--danger" onClick={resetAll}>Confirm reset</button>
              <button className="btn btn--ghost" onClick={() => setResetArmed(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn" onClick={() => setResetArmed(true)} disabled={!hasSheets}><RotateCcw size={15} color="var(--muted)" /><span>Reset</span></button>
          )}
        </div>
      </div>

      {/* physical + acoustic side by side */}
      <div className="pt-row">
        <div className="pt-cell">
          <ScanSection variant="o" icon={<Radar size={16} color="var(--orange)" />}
            title="Physical scan" subtitle="LiDAR · dimensions & obstacles"
            tabs={physicalList} activeId={physId} onTab={setPhysId} sheets={sheets}
            table={physTable} hasSheets={hasSheets} session={session}
            emptyHint="Import to load the room dimensions and obstacle scan."
            onExport={() => physSheet && exportTable(physSheet.label, physTable.columns, physTable.rows)} />
        </div>
        <div className="pt-cell">
          <ScanSection variant="c" icon={<Volume2 size={16} color="var(--cyan)" />} acoustic
            title="Acoustic scan" subtitle="Sound sensor · reverberation & classification"
            tabs={acousticList} activeId={acouId} onTab={setAcouId} sheets={sheets}
            table={acouTable} hasSheets={hasSheets} session={session}
            emptyHint="Run the sound-sensor pass, or import the acoustic sheets."
            onExport={() => acouSheet && exportTable(acouSheet.label, acouTable.columns, acouTable.rows)} />
        </div>
      </div>

      {/* spatial status */}
      <section className="sp">
        <div className="sp-head">
          <span className="ic"><Ruler size={16} color="var(--violet)" /></span>
          <div className="h"><div className="sp-title">Spatial status</div><div className="sp-sub">Room dimensions from the LiDAR scan</div></div>
          {session && <span className="sp-when">Room scan · {session.ts}</span>}
        </div>
        <div className="sp-grid">
          <Dim icon={<MoveH />} label="Width" value={dims.width} />
          <Dim icon={<MoveV />} label="Length" value={dims.length} />
          <Dim icon={<Box size={16} color="var(--orange)" />} label="Height" value={dims.height} />
        </div>
      </section>

      {toast && (
        <div className={`toast${toast.kind === "err" ? " err" : ""}`}>
          <span className="toast-ic">{toast.kind === "err" ? <AlertCircle size={13} color="var(--bad)" /> : <Check size={13} color="var(--ok)" />}</span>
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

/* ---- sensor section ---- */
function ScanSection({ variant, icon, title, subtitle, tabs, activeId, onTab, sheets, table, hasSheets, session, acoustic = false, emptyHint, onExport }) {
  const activeSheet = sheets[activeId];
  return (
    <section className="scan">
      <div className="scan-head">
        <span className={`scan-ic ${variant}`}>{icon}</span>
        <div className="scan-h"><div className="scan-title">{title}</div><div className="scan-sub">{subtitle}</div></div>

        {tabs.length > 1 && (
          <div className="seg">
            {tabs.map(([id, s]) => (
              <button key={id} className={`seg-btn${activeId === id ? " active" : ""}`} onClick={() => onTab(id)}>{s.label}</button>
            ))}
          </div>
        )}
        {activeSheet && table.rows.length > 0 && (
          <button className="btn btn--icon" onClick={onExport} title="Export this table"><Download size={14} color="var(--muted)" /></button>
        )}
      </div>

      <ScanTable columns={table.columns} rows={table.rows} mode={table.mode}
        empty={!hasSheets ? "Nothing imported yet." : !activeSheet ? emptyHint : (acoustic ? "No values." : !session ? "Select a room scan above." : (table.mode === "rows" ? "No data for this room scan." : "No values."))} />
    </section>
  );
}

/* ---- table ---- */
function ScanTable({ columns, rows, mode, empty }) {
  const numericCols = useMemo(() => {
    const sample = rows.slice(0, 60);
    return columns.map((_, i) => { const vals = sample.map((r) => r[i]).filter((v) => v !== "" && v != null); return vals.length > 0 && vals.every(numish); });
  }, [columns, rows]);
  return (
    <div className="scan-body thin-scroll">
      <table className="dtable">
        <thead>
          <tr>{columns.map((c, i) => <th key={i} className={numericCols[i] ? "num" : undefined}>{c || "—"}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {columns.map((_, ci) => {
                const val = row[ci];
                const numeric = mode === "record" ? (ci === 1 && numish(val)) : numericCols[ci];
                const cls = `${numeric ? "num" : ""}${ci === 0 ? " emph" : ""}`.trim();
                return <td key={ci} className={cls || undefined}>{numeric ? fmtNum(val) : (val || "—")}</td>;
              })}
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="empty" colSpan={Math.max(columns.length, 1)}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---- spatial cell ---- */
function Dim({ icon, label, value }) {
  return (
    <div className="sp-dim">
      <div className="lbl">{icon}<span>{label}</span></div>
      <div className="val">{numish(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}<small>m</small></div>
    </div>
  );
}
const MoveH = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8 22 12 18 16"/><path d="M6 8 2 12 6 16"/><path d="M2 12h20"/></svg>);
const MoveV = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 18 4 4 4-4"/><path d="m8 6 4-4 4 4"/><path d="M12 2v20"/></svg>);

/* ---- dropdown ---- */
function Menu({ children, onClose, width = 220, scroll = false, right = false, maxH = 300 }) {
  return (
    <>
      <div className="menu-overlay" onClick={onClose} />
      <div className={`menu${right ? " right" : ""}${scroll ? " thin-scroll" : ""}`} style={{ width, ...(scroll ? { maxHeight: maxH, overflowY: "auto" } : {}) }}>{children}</div>
    </>
  );
}
function MenuItem({ children, onClick, active }) {
  return <button className={`menu-item${active ? " active" : ""}`} onClick={onClick}>{children}</button>;
}
