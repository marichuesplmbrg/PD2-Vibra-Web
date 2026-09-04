import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  Table2, ChevronDown, Upload, Download, Rocket, Cloud, HardDrive, Check,
<<<<<<< HEAD
  Ruler, Box, AlertCircle, Clock, Home, Save, RotateCcw, Radar, Volume2,
} from "lucide-react";
import { vibraHistory } from "./vibraHistory";

const SHEET_ID = "1OaEfDYphqES4umBGZp33KFWuX1GjawaXj5HtRsFNNdc";
const CLOUD_TABS = ["Room", "Obstacle", "Reverberation", "Classification"];
const gvizUrl = (tab) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
const INITIAL_SHEETS = {};
const TABLE_H = 460; // fixed height of each scan table

/* ---- helpers ---- */
=======
  Ruler, Box, AlertCircle, Clock, Home, Save, RotateCcw, Radar, Volume2, Link2,
} from "lucide-react";
import { vibraHistory } from "./vibraHistory";

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */
const C = {
  bg:"#0a0e1a", panel:"#141a2c", panelAlt:"#111627", card:"#171d30",
  border:"#242c43", borderSoft:"#1d2438",
  text:"#f3f5fb", textDim:"#8b93a8", textFaint:"#5d6479",
  orange:"#f6a24b", purple:"#9b7ff0", green:"#5cd6a0", red:"#f2767b", cyan:"#62d0e0",
};
const GRAD = "linear-gradient(135deg, #f6a24b 0%, #9b7ff0 100%)";

const SHEET_ID = "1OaEfDYphqES4umBGZp33KFWuX1GjawaXj5HtRsFNNdc";
const CLOUD_TABS = ["Room", "Obstacle", "Reverberation", "Classification"];
const gvizUrl = (tab) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;

const INITIAL_SHEETS = {};

// Fixed height of the two-table grid so both tables scroll internally and the
// page itself doesn't. Approx = top bar + heading + toolbar + paddings.
const PAGE_OFFSET = 250;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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
<<<<<<< HEAD
const tsIndex = (cols) => cols.findIndex((c) => /timestamp|time|date/i.test(c));
const linkIndex = (cols) => cols.findIndex((c) => /(?:room|scan|session)[_\s-]?id/i.test(c));
const hasDimCols = (cols) => cols.some((c) => /width/i.test(c)) && cols.some((c) => /length/i.test(c)) && cols.some((c) => /height/i.test(c));
=======

const tsIndex = (cols) => cols.findIndex((c) => /timestamp|time|date/i.test(c));
const linkIndex = (cols) => cols.findIndex((c) => /(?:room|scan|session)[_\s-]?id/i.test(c));
const hasDimCols = (cols) => cols.some((c) => /width/i.test(c)) && cols.some((c) => /length/i.test(c)) && cols.some((c) => /height/i.test(c));
const hasDims = (d) => d && (d.width != null || d.length != null || d.height != null);
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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
<<<<<<< HEAD
=======

// Which sensor produced a sheet. LiDAR: dimensions + obstacles. Sound: the rest.
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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

<<<<<<< HEAD
=======
// Rows of a target sheet linked to a Room scan: by shared ID, else by the time
// window that opens at the scan and closes at the next.
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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
<<<<<<< HEAD
  return { rows, method, ts: null };
}

/* ================================================================== */
=======
  const tcol = tsIndex(targetSheet.columns);
  let ts = null;
  if (tcol >= 0 && rows.length) {
    const uniq = [...new Set(rows.map((r) => r[tcol]).filter(Boolean))];
    ts = uniq.length <= 1 ? uniq[0] : `${uniq[uniq.length - 1]} … ${uniq[0]}`;
  }
  return { rows, method, ts };
}

/* ================================================================== *
 * Component
 * ================================================================== */
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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
<<<<<<< HEAD
=======

>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
  const fileRef = useRef(null);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3400); return () => clearTimeout(t); }, [toast]);

<<<<<<< HEAD
  /* anchor + sessions */
=======
  /* --- anchor + sessions ------------------------------------------- */
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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

<<<<<<< HEAD
  /* grouping + selected tables */
=======
  /* --- sheet grouping + selected tables ---------------------------- */
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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
<<<<<<< HEAD
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
=======
    const { rows, ts, method } = linkRows(sheet, session, anchorLinkCol, sessions);
    return { columns: sheet.columns, rows, mode: "rows", ts, method };
  };
  const physTable = useMemo(() => tableFor(physSheet), [physSheet, session, sessions]);
  const acouTable = useMemo(() => tableFor(acouSheet), [acouSheet, session, sessions]);

  /* --- spatial ----------------------------------------------------- */
  const dims = useMemo(() => (session ? dimsFromRow(anchor.columns, session.row) : { width: null, length: null, height: null }), [session, anchor]);

  /* --- import ------------------------------------------------------ */
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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
<<<<<<< HEAD
=======

>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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

<<<<<<< HEAD
  /* bundle / deploy / save / export / reset */
=======
  /* --- bundle / deploy / save / export / reset --------------------- */
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
  const buildBundle = (sess) => {
    const tabs = {};
    if (anchor) tabs[anchor.label] = { columns: anchor.columns, rows: [sess.row] };
    Object.values(sheets).forEach((s) => {
      if (s === anchor) return;
<<<<<<< HEAD
      if (isPhysical(groupOf(s))) tabs[s.label] = { columns: s.columns, rows: linkRows(s, sess, anchorLinkCol, sessions).rows };
      else tabs[s.label] = { columns: s.columns, rows: s.rows };
    });
    return tabs;
  };
=======
      tabs[s.label] = { columns: s.columns, rows: linkRows(s, sess, anchorLinkCol, sessions).rows };
    });
    return tabs;
  };

>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
  const deploy = () => {
    if (!session) { setToast({ kind: "err", msg: "Pick a room scan to deploy." }); return; }
    vibraHistory.deploy({ roomTs: session.ts, dims, tabs: buildBundle(session), at: new Date().toISOString() });
    setToast({ kind: "ok", msg: `Deployed room scan ${session.ts} to Simulation` });
  };
<<<<<<< HEAD
=======

>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
  const saveView = () => {
    if (!session) { setToast({ kind: "err", msg: "Pick a room scan to save." }); return; }
    const entry = { label: session.ts, roomTs: session.ts, dims, tabs: buildBundle(session), savedAt: new Date().toISOString() };
    const saved = vibraHistory.add(entry);
    if (typeof onSave === "function") onSave(saved);
    setToast({ kind: "ok", msg: `Saved room scan ${session.ts} to History` });
  };
<<<<<<< HEAD
=======

>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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
<<<<<<< HEAD
=======

>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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
<<<<<<< HEAD
  useEffect(() => { vibraHistory.saveWorking({ sheets, sessionKey, physId, acouId }); }, [sheets, sessionKey, physId, acouId]);
=======

  useEffect(() => { vibraHistory.saveWorking({ sheets, sessionKey, physId, acouId }); }, [sheets, sessionKey, physId, acouId]);

>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
  const resetAll = () => {
    vibraHistory.clearWorking();
    setSheets(INITIAL_SHEETS); setSessionKey(""); setPhysId(""); setAcouId(""); setResetArmed(false);
    setToast({ kind: "ok", msg: "Cleared the current scan data" });
  };

  const hasSheets = Object.keys(sheets).length > 0;
  const roomLabel = session ? session.ts : (sessions.length ? "Select a scan" : "No room scans");

<<<<<<< HEAD
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
=======
  /* --- render ------------------------------------------------------ */
  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <style>{SCROLL_CSS}</style>
      <main style={{ padding: "26px 34px 24px", maxWidth: 1240 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 4px", letterSpacing: -0.4 }}>Parameters table</h1>
        <p style={{ color: C.textDim, margin: "0 0 18px", fontSize: 15 }}>One room scan at a time — LiDAR physical scan and sound-sensor acoustic scan, side by side.</p>

        {/* toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {/* Room scan selector */}
          <div style={{ position: "relative" }}>
            <button style={ctrlBtn} onClick={() => { setRoomMenu((v) => !v); setImportMenu(false); }} disabled={!sessions.length}>
              <Home size={15} color={session ? C.purple : C.textFaint} />
              <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: session ? C.text : C.textDim }}>{roomLabel}</span>
              <ChevronDown size={15} color={C.textDim} style={{ transform: roomMenu ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
            </button>
            {roomMenu && (
              <Menu onClose={() => setRoomMenu(false)} width={260} scroll>
                {sessionsNewest.length === 0 ? (
                  <div style={{ padding: "10px 12px", fontSize: 13, color: C.textDim }}>No room scans loaded.</div>
                ) : sessionsNewest.map((s, i) => (
                  <MenuItem key={s.ts} active={sessionKey === s.ts} onClick={() => { setSessionKey(s.ts); setRoomMenu(false); }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <Home size={14} color={C.textFaint} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.ts}</span>
                      {i === 0 && <span style={{ fontSize: 11, color: C.green }}>latest</span>}
                    </span>
                    {sessionKey === s.ts && <Check size={15} color={C.green} />}
                  </MenuItem>
                ))}
              </Menu>
            )}
          </div>

          {/* Import */}
          <div style={{ position: "relative" }}>
            <button style={ctrlBtn} onClick={() => { setImportMenu((v) => !v); setRoomMenu(false); }} disabled={cloudBusy}>
              <Upload size={15} color={C.textDim} /><span>{cloudBusy ? "Importing…" : "Import"}</span>
              <ChevronDown size={15} color={C.textDim} style={{ transform: importMenu ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
            </button>
            {importMenu && (
              <Menu onClose={() => setImportMenu(false)} width={250}>
                <MenuItem onClick={() => { setImportMenu(false); fileRef.current?.click(); }}><span style={{ display: "flex", alignItems: "center", gap: 9 }}><HardDrive size={15} color={C.orange} /> Import local (.csv)</span></MenuItem>
                <MenuItem onClick={importCloud}><span style={{ display: "flex", alignItems: "center", gap: 9 }}><Cloud size={15} color={C.purple} /> Import cloud (Google Sheets)</span></MenuItem>
              </Menu>
            )}
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onLocalFile} style={{ display: "none" }} />
          </div>

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button style={{ ...primaryBtn, ...(session ? {} : disabledBtn) }} onClick={deploy} disabled={!session}><Rocket size={15} color="#241706" /><span>Deploy to Simulation</span></button>
            <button style={{ ...ctrlBtn, borderColor: "rgba(92,214,160,.35)", ...(session ? {} : disabledBtn) }} onClick={saveView} disabled={!session}><Save size={15} color={C.green} /><span>Save</span></button>
            {resetArmed ? (
              <>
                <button style={{ ...ctrlBtn, color: C.red, borderColor: "rgba(242,118,123,.5)" }} onClick={resetAll}>Confirm reset</button>
                <button style={ghostBtn} onClick={() => setResetArmed(false)}>Cancel</button>
              </>
            ) : (
              <button style={{ ...ctrlBtn, ...(hasSheets ? {} : disabledBtn) }} onClick={() => setResetArmed(true)} disabled={!hasSheets}><RotateCcw size={15} color={C.textDim} /><span>Reset</span></button>
            )}
          </div>
        </div>

        {/* grid: two tables (left) + spatial (right) */}
        <div style={{ display: "flex", gap: 22, alignItems: "stretch", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 620px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16, height: `calc(100dvh - ${PAGE_OFFSET}px)` }}>
            {/* Physical (LiDAR) */}
            <ScanSection
              icon={<Radar size={16} color={C.orange} />} tint="rgba(246,162,75,.14)"
              title="Physical scan" subtitle="LiDAR · dimensions & obstacles"
              tabs={physicalList} activeId={physId} onTab={setPhysId} sheets={sheets}
              table={physTable} anchorId={anchorId} hasSheets={hasSheets} session={session}
              emptyHint="Import to load the room dimensions and obstacle scan."
              onExport={() => physSheet && exportTable(physSheet.label, physTable.columns, physTable.rows)}
            />
            {/* Acoustic (Sound sensor) */}
            <ScanSection
              icon={<Volume2 size={16} color={C.cyan} />} tint="rgba(98,208,224,.14)"
              title="Acoustic scan" subtitle="Sound sensor · reverberation & classification"
              tabs={acousticList} activeId={acouId} onTab={setAcouId} sheets={sheets}
              table={acouTable} anchorId={anchorId} hasSheets={hasSheets} session={session}
              linkTs={acouTable.ts} linkMethod={acouTable.method}
              emptyHint="Run the sound-sensor pass, or import the acoustic sheets."
              onExport={() => acouSheet && exportTable(acouSheet.label, acouTable.columns, acouTable.rows)}
            />
          </div>

          {/* Spatial status */}
          <div style={{ flex: "1 1 300px", minWidth: 260, display: "flex" }}>
            <section style={{ ...panel, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "16px 18px", borderBottom: `1px solid ${C.borderSoft}`, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ display: "inline-flex", width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", background: "rgba(155,127,240,.14)" }}><Ruler size={16} color={C.purple} /></span>
                <div><div style={{ fontSize: 16, fontWeight: 700 }}>Spatial status</div><div style={{ fontSize: 13, color: C.textDim }}>Room dimensions from the LiDAR scan</div></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gridAutoRows: "1fr", gap: 1, background: C.borderSoft, flex: 1, minHeight: 0 }}>
                <Dim icon={<MoveH />} label="Width" value={dims.width} />
                <Dim icon={<MoveV />} label="Length" value={dims.length} />
                <Dim icon={<Box size={16} color={C.orange} />} label="Height" value={dims.height} />
              </div>
              {session && <div style={{ padding: "11px 18px", borderTop: `1px solid ${C.borderSoft}`, fontSize: 12.5, color: C.textFaint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Room scan · {session.ts}</div>}
            </section>
          </div>
        </div>
      </main>

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", maxWidth: 560, background: C.card, border: `1px solid ${toast.kind === "err" ? "rgba(242,118,123,.5)" : C.border}`, borderRadius: 12, padding: "11px 16px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 10px 40px rgba(0,0,0,.5)", zIndex: 60 }}>
          <span style={{ width: 20, height: 20, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: toast.kind === "err" ? "rgba(242,118,123,.16)" : "rgba(92,214,160,.16)" }}>{toast.kind === "err" ? <AlertCircle size={13} color={C.red} /> : <Check size={13} color={C.green} />}</span>
          <span style={{ fontSize: 14 }}>{toast.msg}</span>
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
        </div>
      )}
    </div>
  );
}

<<<<<<< HEAD
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
=======
/* ------------------------------------------------------------------ *
 * A sensor section: header (title + sub-tabs + export) and a table.
 * ------------------------------------------------------------------ */
function ScanSection({ icon, tint, title, subtitle, tabs, activeId, onTab, sheets, table, anchorId, hasSheets, session, linkTs, linkMethod, emptyHint, onExport }) {
  const activeSheet = sheets[activeId];
  return (
    <section style={{ ...panel, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${C.borderSoft}`, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", background: tint, flexShrink: 0 }}>{icon}</span>
        <div style={{ marginRight: "auto" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: C.textDim }}>{subtitle}</div>
        </div>
        {tabs.length > 1 && (
          <div style={{ display: "inline-flex", background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 9, padding: 2, gap: 2 }}>
            {tabs.map(([id, s]) => (
              <button key={id} onClick={() => onTab(id)} style={{ padding: "5px 11px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: activeId === id ? C.card : "transparent", color: activeId === id ? C.text : C.textDim }}>
                {s.label}{id === anchorId ? "" : ""}
              </button>
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
            ))}
          </div>
        )}
        {activeSheet && table.rows.length > 0 && (
<<<<<<< HEAD
          <button className="btn btn--icon" onClick={onExport} title="Export this table"><Download size={14} color="var(--muted)" /></button>
        )}
      </div>

      <ScanTable columns={table.columns} rows={table.rows} mode={table.mode}
        empty={!hasSheets ? "Nothing imported yet." : !activeSheet ? emptyHint : (acoustic ? "No values." : !session ? "Select a room scan above." : (table.mode === "rows" ? "No data for this room scan." : "No values."))} />
=======
          <button style={{ ...ctrlBtn, padding: "6px 10px" }} onClick={onExport} title="Export this table"><Download size={14} color={C.textDim} /></button>
        )}
      </div>

      {/* link caption for acoustic tables */}
      {linkTs && session && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: `1px solid ${C.borderSoft}`, background: "rgba(98,208,224,.05)", fontSize: 12.5, color: C.textDim, flexWrap: "wrap" }}>
          <Link2 size={14} color={C.cyan} />
          <span><Clock size={12} style={{ verticalAlign: -1, marginRight: 4 }} color={C.textFaint} />Acoustic {linkTs}</span>
          {linkMethod && linkMethod !== "none" && (
            <span style={{ marginLeft: "auto", fontSize: 11, color: linkMethod === "id" ? C.green : C.orange }}>{linkMethod === "id" ? "matched by ID" : "matched by time"}</span>
          )}
        </div>
      )}

      <ScanTable columns={table.columns} rows={table.rows} mode={table.mode}
        empty={!hasSheets ? "Nothing imported yet." : !activeSheet ? emptyHint : !session ? "Select a room scan above." : (table.mode === "rows" ? "No data linked to this room scan." : "No values.")} />
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
    </section>
  );
}

<<<<<<< HEAD
/* ---- table ---- */
=======
/* ------------------------------------------------------------------ *
 * A themed, scrollable table (record Field/Value or wide rows).
 * ------------------------------------------------------------------ */
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
function ScanTable({ columns, rows, mode, empty }) {
  const numericCols = useMemo(() => {
    const sample = rows.slice(0, 60);
    return columns.map((_, i) => { const vals = sample.map((r) => r[i]).filter((v) => v !== "" && v != null); return vals.length > 0 && vals.every(numish); });
  }, [columns, rows]);
<<<<<<< HEAD
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
=======

  return (
    <div className="rp-scroll" style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
      <table style={{ width: "100%", minWidth: "max-content", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{ textAlign: numericCols[i] ? "right" : "left", padding: "10px 16px", fontSize: 12, fontWeight: 600, letterSpacing: 0.2, color: C.textDim, background: C.panelAlt, whiteSpace: "nowrap", position: "sticky", top: 0 }}>{c || "—"}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderTop: `1px solid ${C.borderSoft}`, contentVisibility: "auto", containIntrinsicSize: "0 40px" }}>
              {columns.map((_, ci) => {
                const val = row[ci];
                const numeric = mode === "record" ? (ci === 1 && numish(val)) : numericCols[ci];
                const emph = ci === 0;
                return (
                  <td key={ci} style={{ padding: "10px 16px", color: emph ? C.text : C.textDim, fontWeight: emph ? 500 : 400, textAlign: numeric ? "right" : "left", fontVariantNumeric: numeric ? "tabular-nums" : "normal", whiteSpace: "nowrap" }}>
                    {numeric ? fmtNum(val) : (val || "—")}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={Math.max(columns.length, 1)} style={{ padding: "30px 16px", textAlign: "center", color: C.textDim }}>{empty}</td></tr>
          )}
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
        </tbody>
      </table>
    </div>
  );
}

/* ---- spatial cell ---- */
function Dim({ icon, label, value }) {
  return (
<<<<<<< HEAD
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
=======
    <div style={{ background: C.panel, padding: "20px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textDim, fontSize: 13, marginBottom: 10 }}>{icon}<span>{label}</span></div>
      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>
        {numish(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}
        <span style={{ fontSize: 15, fontWeight: 600, color: C.textDim, marginLeft: 6 }}>m</span>
      </div>
    </div>
  );
}
const MoveH = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.orange} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8 22 12 18 16"/><path d="M6 8 2 12 6 16"/><path d="M2 12h20"/></svg>);
const MoveV = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.orange} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 18 4 4 4-4"/><path d="m8 6 4-4 4 4"/><path d="M12 2v20"/></svg>);

/* ---- dropdown ---- */
function Menu({ children, onClose, width = 220, scroll = false }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <div className={scroll ? "rp-scroll" : undefined} style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, width, zIndex: 50, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 6, boxShadow: "0 16px 46px rgba(0,0,0,.55)", ...(scroll ? { maxHeight: 320, overflowY: "auto" } : {}) }}>{children}</div>
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
    </>
  );
}
function MenuItem({ children, onClick, active }) {
<<<<<<< HEAD
  return <button className={`menu-item${active ? " active" : ""}`} onClick={onClick}>{children}</button>;
}
=======
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left", fontSize: 14, color: active ? C.text : "#d7dbe6", background: h ? "rgba(255,255,255,.05)" : "transparent" }}>{children}</button>
  );
}

/* ---- styles ---- */
const ctrlBtn = { display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13.5, fontWeight: 500, cursor: "pointer" };
const ghostBtn = { ...ctrlBtn, background: "transparent", color: C.textDim, padding: "6px 12px", fontSize: 13 };
const disabledBtn = { opacity: 0.45, cursor: "not-allowed" };
const primaryBtn = { display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: GRAD, border: "none", borderRadius: 10, color: "#241706", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
const panel = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" };

const SCROLL_CSS = `
.rp-scroll { scrollbar-width: thin; scrollbar-color: #39425f transparent; }
.rp-scroll::-webkit-scrollbar { width: 12px; height: 12px; }
.rp-scroll::-webkit-scrollbar-track { background: transparent; }
.rp-scroll::-webkit-scrollbar-thumb { background: #333c58; border-radius: 8px; border: 3px solid transparent; background-clip: content-box; }
.rp-scroll::-webkit-scrollbar-thumb:hover { background: #47527a; background-clip: content-box; border: 3px solid transparent; }
.rp-scroll::-webkit-scrollbar-corner { background: transparent; }
`;
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
