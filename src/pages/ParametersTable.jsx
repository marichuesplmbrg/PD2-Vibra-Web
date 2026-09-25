import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  Table2, ChevronDown, Upload, Download, Rocket, Cloud, HardDrive, Check,
  Ruler, Box, AlertCircle, Clock, Save, RotateCcw, Radar, Volume2,
  AlertTriangle, X,
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
/* Timestamps arrive in two shapes: ISO-ish ("2026-09-23 16:09:12") and the
   Google Sheets / US format ("9/23/2026 16:09:12", optionally with AM/PM).
   The slash form is parsed by hand — browsers disagree on it, and swapping
   the space for "T" (which ISO needs) makes it unparseable everywhere. */
const parseTs = (s) => {
  const str = String(s ?? "").trim();
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (m) {
    let [, mo, d, y, h = "0", mi = "0", se = "0", ap] = m;
    h = Number(h);
    if (ap) { if (/pm/i.test(ap) && h < 12) h += 12; if (/am/i.test(ap) && h === 12) h = 0; }
    const t = new Date(Number(y), Number(mo) - 1, Number(d), h, Number(mi), Number(se)).getTime();
    return isNaN(t) ? null : t;
  }
  const iso = Date.parse(str.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  if (!isNaN(iso)) return iso;
  const t = Date.parse(str);
  return isNaN(t) ? null : t;
};

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
/* Only columns with a parameter name (header) are kept. Google Sheets' CSV
   export also carries unnamed columns from the sheet's used range — empty or
   stray values — and those can't be matched to any parameter, so they're
   dropped here instead of being rendered as columns of dashes. */
const blank = (v) => v === "" || v == null;
/* Unnamed columns that DO hold values are still dropped (they can't be matched
   to a parameter), but they're recorded on the sheet as `unnamed` so the table
   can raise an error instead of losing the values silently. */
const colLetter = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
function pruneEmptyCols(sheet) {
  if (!sheet || !sheet.columns) return sheet;
  const keep = sheet.columns.map((c) => !blank(String(c ?? "").trim()));
  if (keep.every(Boolean)) return sheet;
  const lost = [];
  sheet.columns.forEach((_, i) => {
    if (keep[i]) return;
    const vals = sheet.rows.map((r) => r[i]).filter((v) => !blank(v));
    if (vals.length) lost.push({ col: colLetter(i), count: vals.length, sample: vals.slice(0, 3) });
  });
  const pick = (arr) => arr.filter((_, i) => keep[i]);
  return {
    ...sheet, columns: pick(sheet.columns), rows: sheet.rows.map(pick),
    ...(lost.length ? { unnamed: [...(sheet.unnamed || []), ...lost] } : {}),
  };
}
const gridToSheet = (grid) => pruneEmptyCols(grid.length ? { columns: grid[0], rows: grid.slice(1) } : { columns: [], rows: [] });
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

/* Acoustic view. Shared by the on-screen table and the PDF so the two can't
   diverge. Only named parameters that hold values are shown, and each one
   lists ONLY its own non-empty values — blank cells are never rendered:
     - columns with no parameter name are dropped, along with their values;
     - named columns with no values at all are dropped;
     - the timestamp column is kept and shown like any other parameter, with
       the values exactly as the Google Sheet holds them;
     - within each parameter, blank cells are removed and the values close up.
   Parameters recorded on the same rows (e.g. Frequency and T20 per band) stay
   lined up; a parameter with a single value (e.g. overall RT60) just shows
   that one value. `rows` is the same data laid out as a grid for the PDF. */
/* When the acoustic scan was taken: the latest parseable date in a
   timestamp / time / date column. A column named "timestamp" is tried first,
   and numeric cells are skipped so a value like an RT60 "time" of 0.45 s can't
   be mistaken for a date. Returns the cell as written in the sheet, or null. */
function acousticTs(sheet) {
  if (!sheet?.columns?.length) return null;
  const cands = sheet.columns
    .map((c, i) => [String(c), i])
    .filter(([c]) => /timestamp|time|date/i.test(c))
    .sort(([a], [b]) => Number(/timestamp/i.test(b)) - Number(/timestamp/i.test(a)));
  for (const [, i] of cands) {
    let best = null;
    sheet.rows.forEach((r) => {
      const v = r[i];
      if (blank(v) || numish(v)) return;
      const t = parseTs(v);
      if (t != null && (!best || t > best.t)) best = { t, raw: String(v).trim() };
    });
    if (best) return best.raw;
  }
  return null;
}

function acousticView(raw) {
  if (!raw) return { columns: [], rows: [], lists: [], mode: "empty" };
  const sheet = pruneEmptyCols(raw);
  const lists = sheet.columns
    .map((name, i) => [name, sheet.rows.map((r) => r[i]).filter((v) => !blank(v))])
    .filter(([, vals]) => vals.length > 0);
  const depth = Math.max(0, ...lists.map(([, v]) => v.length));
  const rows = Array.from({ length: depth }, (_, ri) => lists.map(([, v]) => v[ri] ?? ""));
  return { columns: lists.map(([n]) => n), rows, lists, mode: "lists" };
}

/* ================================================================== *
 * Local import validation
 * ------------------------------------------------------------------
 * Two separate gates, because a file can pass one and fail the other:
 *   1. fileTypeProblem  — the name/size the OS reports, checked before
 *      a single byte is read.
 *   2. contentProblem   — what the bytes actually are. An .xlsx renamed
 *      to .csv, a PDF, an HTML error page or a binary blob all arrive
 *      with a perfectly innocent extension, and parseCSV would happily
 *      turn any of them into a table of garbage.
 * ================================================================== */
const CSV_EXT = /\.(csv|tsv|txt)$/i;
const MAX_IMPORT_MB = 8;

function fileTypeProblem(file) {
  const name = file.name || "(unnamed file)";
  const ext = (name.match(/\.[^.\\/]+$/) || [""])[0];
  if (!CSV_EXT.test(name)) {
    return ext
      ? `Wrong file type — “${name}” is a ${ext.slice(1).toUpperCase()} file. Import local expects a .csv exported from the scan sheet.`
      : `Wrong file type — “${name}” has no file extension. Import local expects a .csv exported from the scan sheet.`;
  }
  if (file.size === 0) return `“${name}” is empty (0 bytes) — nothing to import.`;
  if (file.size > MAX_IMPORT_MB * 1024 * 1024)
    return `“${name}” is ${(file.size / 1048576).toFixed(1)} MB, over the ${MAX_IMPORT_MB} MB import limit. Split the export or import from Google Sheets instead.`;
  return null;
}

function contentProblem(text, name) {
  const head = String(text).slice(0, 2048);
  if (/^PK\x03\x04/.test(head))
    return `Wrong file type — “${name}” is a spreadsheet/zip archive (.xlsx or .zip) renamed to .csv. Open it and use File → Download → Comma-separated values.`;
  if (/^%PDF/.test(head)) return `Wrong file type — “${name}” is a PDF, not CSV text.`;
  if (/^\s*<(\?xml|!doctype|html)/i.test(head))
    return `Wrong file type — “${name}” is an HTML/XML document, not CSV text. If it came from a share link, the server returned a web page instead of the sheet.`;
  if (/^\s*[[{]/.test(head) && !head.includes(","))
    return `Wrong file type — “${name}” looks like JSON, not CSV.`;
  const junk = (head.match(/[\u0000-\u0008\u000E-\u001F\uFFFD]/g) || []).length;
  if (junk > head.length * 0.02)
    return `“${name}” isn't readable as text — it looks like a binary file that was renamed to .csv.`;
  return null;
}

/* Structural checks that only make sense once the grid exists. */
function gridProblem(grid, text, name) {
  if (!grid.length) return { kind: "err", msg: `“${name}” contains no rows — the file is blank or only whitespace.` };
  const [header, ...body] = grid;
  if (!header.some((c) => c !== "")) return { kind: "err", msg: `“${name}” has no header row — the first line must name the columns.` };
  if (!body.length) return { kind: "err", msg: `“${name}” has a header row but no data rows beneath it.` };
  const firstLine = String(text).split("\n")[0] || "";
  if (header.length === 1 && /[;\t|]/.test(firstLine))
    return { kind: "err", msg: `“${name}” isn't comma-separated — it uses ${/\t/.test(firstLine) ? "tabs" : /;/.test(firstLine) ? "semicolons" : "pipes"}. Re-export with commas as the delimiter.` };
  const blankHead = header.filter((c) => c === "").length;
  if (blankHead) return { kind: "warn", msg: `Imported “${name}”, but ${blankHead} column${blankHead > 1 ? "s have" : " has"} no header name — those columns can't be matched to a parameter.` };
  const ragged = body.filter((r) => r.length !== header.length).length;
  if (ragged) return { kind: "warn", msg: `Imported “${name}”, but ${ragged} row${ragged > 1 ? "s don't" : " doesn't"} match the ${header.length}-column header — values may be shifted.` };
  return null;
}

/* ================================================================== *
 * Classification parameter audit
 * ------------------------------------------------------------------
 * The Classification tab is the only place hot / neutral / dead labels
 * live, and each row has to be placeable in the room — by a bearing, or
 * by an X/Y pair. Anything missing here surfaces downstream as an empty
 * spot layer in Simulation, so it is caught and named at the table.
 * ================================================================== */
const RX_CLASS_COL = /class|label|zone|category|status|spot/i;
const RX_ANGLE_COL = /^\s*(angle|bearing|azimuth|heading|deg)/i;
const RX_X_COL = /^\s*(x|x_m|x_mm|x_pos|pos_x|coord_x|x_coord)\s*$/i;
const RX_Y_COL = /^\s*(y|y_m|y_mm|y_pos|pos_y|coord_y|y_coord)\s*$/i;
const RX_METRIC_COL = /rt60|reverb|spl|level|db|energy|score|intensity/i;
const KNOWN_CLASS = /neutral|balanced|normal|nominal|within|ok|hot|high|live|bright|excess|dead|low|dull|null|quiet/i;

const findCol = (cols, re) => cols.findIndex((c) => re.test(String(c)));
const rowRef = (list) => {
  const shown = list.slice(0, 6).map((n) => `row ${n}`).join(", ");
  return list.length > 6 ? `${shown} +${list.length - 6} more` : shown;
};

function auditClassification(sheet) {
  if (!sheet) return null;
  const cols = sheet.columns || [];
  const rows = sheet.rows || [];
  const errors = [], warnings = [];

  if (!cols.length || !rows.length) {
    return { errors: ["Missing parameters — the Classification tab imported with no rows. Re-run the sound-sensor pass, or re-import the sheet."], warnings: [] };
  }

  const ci = findCol(cols, RX_CLASS_COL);
  const ai = findCol(cols, RX_ANGLE_COL);
  const xi = findCol(cols, RX_X_COL);
  const yi = findCol(cols, RX_Y_COL);
  const mi = findCol(cols, RX_METRIC_COL);

  if (ci < 0) errors.push("Missing parameter — no classification column. Nothing in this tab says which readings are hotspots, neutral zones or deadspots.");
  if (ai < 0 && (xi < 0 || yi < 0)) {
    errors.push(
      xi >= 0 || yi >= 0
        ? `Missing parameter — only ${xi >= 0 ? "X" : "Y"} was found. A reading needs an angle/bearing column, or both X and Y, to be placed in the room.`
        : "Missing parameter — no angle/bearing column and no X + Y pair, so no reading can be placed in the room."
    );
  }
  if (mi < 0) warnings.push("No RT60 / level column — readings can be placed and labelled, but the panel split can only be even, not weighted.");

  // Per-row completeness on the columns that do exist.
  const required = [];
  if (ci >= 0) required.push({ i: ci, name: cols[ci], num: false });
  if (ai >= 0) required.push({ i: ai, name: cols[ai], num: true });
  else { if (xi >= 0) required.push({ i: xi, name: cols[xi], num: true }); if (yi >= 0) required.push({ i: yi, name: cols[yi], num: true }); }
  if (mi >= 0) required.push({ i: mi, name: cols[mi], num: true });

  const blanks = new Map(), nonNum = new Map();
  const unknownLabel = [];
  rows.forEach((r, ri) => {
    const line = ri + 2; // +1 for the header row, +1 for 1-based counting
    required.forEach(({ i, name, num }) => {
      const v = r[i];
      if (v === "" || v == null) { if (!blanks.has(name)) blanks.set(name, []); blanks.get(name).push(line); }
      else if (num && !numish(v)) { if (!nonNum.has(name)) nonNum.set(name, []); nonNum.get(name).push(line); }
    });
    if (ci >= 0) {
      const raw = String(r[ci] ?? "").trim();
      if (raw && !KNOWN_CLASS.test(raw.replace(/[\s_-]/g, ""))) unknownLabel.push(line);
    }
  });

  blanks.forEach((list, name) => {
    errors.push(`Missing parameter — “${name}” is blank on ${list.length} of ${rows.length} rows (${rowRef(list)}).`);
  });
  nonNum.forEach((list, name) => {
    errors.push(`Invalid parameter — “${name}” holds a non-numeric value on ${list.length} row${list.length > 1 ? "s" : ""} (${rowRef(list)}).`);
  });
  if (unknownLabel.length) {
    warnings.push(`${unknownLabel.length} row${unknownLabel.length > 1 ? "s carry" : " carries"} a classification label that isn't recognised as hotspot / neutral / deadspot (${rowRef(unknownLabel)}) — ${unknownLabel.length > 1 ? "they" : "it"} will be treated as neutral.`);
  }

  return { errors, warnings };
}

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

  const [sheets, setSheets] = useState(() =>
    init.sheets ? Object.fromEntries(Object.entries(init.sheets).map(([k, v]) => [k, pruneEmptyCols(v)])) : INITIAL_SHEETS
  );
  const [sessionKey, setSessionKey] = useState(init.sessionKey ?? "");
  const [physId, setPhysId] = useState(init.physId || "");
  const [acouId, setAcouId] = useState(init.acouId || "");

  const [importMenu, setImportMenu] = useState(false);
  const [toast, setToast] = useState(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [importIssue, setImportIssue] = useState(null); // { kind: "err"|"warn", msg }
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
  const sessionSig = sessions.map((s) => s.ts).join("|");
  /* The main system overwrites the sheet on every send, so it only ever holds
     the latest room scan — always follow the newest one, no picker needed. */
  useEffect(() => {
    setSessionKey(sessions.length ? sessions[sessions.length - 1].ts : "");
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

  /* The acoustic scan time always comes from the Reverberation tab, whichever
     acoustic tab is on screen — Classification doesn't carry its own. */
  const reverbSheet = useMemo(() => acousticList.find(([, s]) => /reverb/i.test(s.label))?.[1] || null, [acousticList]);
  const acouTs = useMemo(() => acousticTs(reverbSheet), [reverbSheet]);

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
  // Acoustic table: show the Reverberation/Classification rows as-is, including
  // the timestamp column fetched from the Google Sheet.
  const acouTable = useMemo(() => acousticView(acouSheet), [acouSheet]);

  /* The Classification tab is audited whenever it is the selected acoustic
     table, so a missing column or a blank cell is named here rather than
     showing up later as an empty spot layer in the Simulation. */
  const acouAudit = useMemo(
    () => (acouSheet && groupOf(acouSheet) === "classification" ? auditClassification(acouSheet) : null),
    [acouSheet]
  );

  const dims = useMemo(() => (session ? dimsFromRow(anchor.columns, session.row) : { width: null, length: null, height: null }), [session, anchor]);

  /* import ------------------------------------------------------------ *
   * A toast disappears after 3.4 s, which is fine for "imported 40 rows"
   * and useless for "this file was rejected and here is why". Import
   * failures therefore also raise a banner that stays until it is
   * dismissed or the next import succeeds.
   * -------------------------------------------------------------------- */
  const failImport = (msg) => { setToast({ kind: "err", msg }); setImportIssue({ kind: "err", msg }); };

  const onLocalFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset first, so re-picking the same file still fires
    if (!file) return;

    const typeErr = fileTypeProblem(file);
    if (typeErr) { failImport(typeErr); return; }

    const reader = new FileReader();
    reader.onerror = () => failImport(`Couldn't read “${file.name}” — ${reader.error?.message || "the file could not be opened"}.`);
    reader.onabort = () => failImport(`Import of “${file.name}” was cancelled before it finished.`);
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const contentErr = contentProblem(text, file.name);
        if (contentErr) { failImport(contentErr); return; }

        const pruned = gridToSheet(parseCSV(text));
        const grid = pruned.columns.length ? [pruned.columns, ...pruned.rows] : [];
        const problem = gridProblem(grid, text, file.name);
        if (problem?.kind === "err") { failImport(problem.msg); return; }

        const { columns, rows, unnamed } = pruned;
        const id = `local-${Date.now()}`;
        setSheets((p) => ({ ...p, [id]: { label: `Local · ${file.name.replace(/\.(csv|tsv|txt)$/i, "")}`, source: "local", columns, rows, ...(unnamed ? { unnamed } : {}) } }));
        if (problem?.kind === "warn") {
          setToast({ kind: "err", msg: problem.msg });
          setImportIssue({ kind: "warn", msg: problem.msg });
        } else {
          setImportIssue(null);
          setToast({ kind: "ok", msg: `Imported ${rows.length} row${rows.length === 1 ? "" : "s"} from ${file.name}` });
        }
      } catch (err) {
        failImport(`Couldn't parse “${file.name}” — ${err.message}. Check it is a plain comma-separated export.`);
      }
    };

    try { reader.readAsText(file); }
    catch (err) { failImport(`Couldn't open “${file.name}” — ${err.message}.`); }
  };
  const importCloud = async () => {
    setImportMenu(false); setCloudBusy(true); setImportIssue(null);
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
      const msg = `Couldn't reach Google Sheets — ${err.message}. Check the sheet is shared and reachable.`;
      setToast({ kind: "err", msg }); setImportIssue({ kind: "err", msg });
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
    if (!session) { setToast({ kind: "err", msg: "No room scan loaded — import one first." }); return; }
    vibraHistory.deploy({ roomTs: session.ts, dims, tabs: buildBundle(session), at: new Date().toISOString() });
    setToast({ kind: "ok", msg: `Deployed room scan ${session.ts} to Simulation` });
  };
  const saveView = () => {
    if (!session) { setToast({ kind: "err", msg: "No room scan loaded — import one first." }); return; }
    const entry = { label: session.ts, roomTs: session.ts, dims, tabs: buildBundle(session), savedAt: new Date().toISOString() };
    const saved = vibraHistory.add(entry);
    if (typeof onSave === "function") onSave(saved);
    setToast({ kind: "ok", msg: `Saved room scan ${session.ts} to History` });
  };
  /* ---- PDF export ----------------------------------------------------- *
   * One export for the whole page, not per table. Builds a standalone
   * document — room scan identity, spatial status, every physical tab and
   * every acoustic tab — and hands it to the browser's print pipeline, where
   * "Save as PDF" is the destination. No PDF library needed, so nothing new
   * to install and nothing to keep in sync with the app's styling.
   * --------------------------------------------------------------------- */
  const esc = (v) => String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // The same shaping the on-screen tables use, so the PDF can't drift from
  // what the user is looking at.
  const reportSection = (id, sheet) => {
    const physical = isPhysical(groupOf(sheet));
    const t = physical ? tableFor(sheet) : acousticView(sheet);
    return { label: sheet.label, kind: physical ? "Physical" : "Acoustic", ...t, ts: physical ? null : acouTs };
  };

  const buildReport = () => {
    const physical = physicalList.map(([id, s]) => reportSection(id, s));
    const acoustic = acousticList.map(([id, s]) => reportSection(id, s));
    return [...physical, ...acoustic].filter((s) => s.rows.length > 0);
  };

  const sectionHtml = (s) => {
    const head = s.columns.map((c) => `<th>${esc(c || "—")}</th>`).join("");
    const body = s.rows
      .map((r) => `<tr>${s.columns.map((_, i) => {
        const v = r[i];
        const num = s.mode === "record" ? (i === 1 && numish(v)) : numish(v);
        return `<td class="${num ? "num" : ""}">${esc(num ? fmtNum(v) : (v ?? "—"))}</td>`;
      }).join("")}</tr>`)
      .join("");
    return `<section class="sec">
      <h2>${esc(s.label)}<span class="kind">${esc(s.kind)} scan</span></h2>
      <div class="meta">${s.rows.length} row${s.rows.length === 1 ? "" : "s"}${s.ts ? ` · Scanned ${esc(s.ts)}` : ""}</div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </section>`;
  };

  const exportPdf = () => {
    const sections = buildReport();
    if (!sections.length) { setToast({ kind: "err", msg: "Nothing to export — import a scan first." }); return; }

    const dim = (v) => (numish(v) ? `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 })} m` : "—");
    const vol = numish(dims.width) && numish(dims.length) && numish(dims.height)
      ? `${(dims.width * dims.length * dims.height).toFixed(2)} m³` : "—";

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>VIBRA scan report${session ? ` — ${esc(session.ts)}` : ""}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #14161c; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.3px; }
  .sub { color: #5b6172; margin: 0 0 16px; }
  .ident { border: 1px solid #d9dce4; border-radius: 6px; padding: 10px 12px; margin-bottom: 18px; }
  .ident dl { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; margin: 0; }
  .ident dt { color: #5b6172; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .ident dd { margin: 0; font-weight: 600; font-size: 13px; }
  .sec { margin-bottom: 20px; break-inside: auto; }
  h2 { font-size: 13px; margin: 0 0 2px; display: flex; align-items: baseline; gap: 8px; }
  .kind { font-size: 10px; font-weight: 500; color: #5b6172; text-transform: uppercase; letter-spacing: 0.04em; }
  .meta { color: #5b6172; font-size: 10px; margin-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d9dce4; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #f1f2f6; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #d9dce4; color: #5b6172; font-size: 10px; }
</style></head><body>
<h1>VIBRA — room scan report</h1>
<p class="sub">LiDAR physical scan and sound-sensor acoustic scan.</p>
<div class="ident"><dl>
  <div><dt>Room scan</dt><dd>${esc(session ? session.ts : "—")}</dd></div>
  <div><dt>Acoustic scan</dt><dd>${esc(acouTs || "—")}</dd></div>
  <div><dt>Width</dt><dd>${dim(dims.width)}</dd></div>
  <div><dt>Length</dt><dd>${dim(dims.length)}</dd></div>
  <div><dt>Height</dt><dd>${dim(dims.height)}</dd></div>
  <div><dt>Volume</dt><dd>${vol}</dd></div>
  <div><dt>Tables</dt><dd>${sections.length}</dd></div>
  <div><dt>Exported</dt><dd>${esc(new Date().toLocaleString())}</dd></div>
</dl></div>
${sections.map(sectionHtml).join("")}
<footer>Generated by VIBRA. Dimensions from the LiDAR pass; acoustic values from the sound-sensor pass.</footer>
</body></html>`;

    // A hidden same-origin iframe rather than window.open — popup blockers
    // don't touch it, and the print dialog is scoped to the report alone.
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(frame);
    const done = () => setTimeout(() => frame.remove(), 1000);
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setToast({ kind: "ok", msg: "Report ready — choose “Save as PDF” in the print dialog." });
      } catch (err) {
        setToast({ kind: "err", msg: `Couldn't open the print dialog — ${err.message}` });
      } finally { done(); }
    };
    frame.srcdoc = html;
  };
  const loadBundle = (entry) => {
    if (!entry || !entry.tabs) return;
    const next = {};
    Object.entries(entry.tabs).forEach(([label, t]) => { next[`saved-${label}`] = pruneEmptyCols({ label, source: "cloud", columns: t.columns || [], rows: t.rows || [] }); });
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
    setImportIssue(null);
    setToast({ kind: "ok", msg: "Cleared the current scan data" });
  };

  const hasSheets = Object.keys(sheets).length > 0;

  return (
    <div className="vwrap">
      <div className="vhead">
        <h1>Parameters table</h1>
        <p className="sub">One room scan at a time — LiDAR physical scan and sound-sensor acoustic scan, side by side.</p>
      </div>

      {/* toolbar */}
      <div className="pt-toolbar">
        {/* Import */}
        <div className="menu-wrap">
          <button className="btn" onClick={() => setImportMenu((v) => !v)} disabled={cloudBusy}>
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
          <button className="btn btn--primary" onClick={deploy} disabled={!session}><Rocket size={15} color="#17131f" /><span>Deploy</span></button>
          <button className="btn btn--save" onClick={saveView} disabled={!session}><Save size={15} color="var(--ok)" /><span>Save</span></button>
          <button className="btn" onClick={exportPdf} disabled={!hasSheets} title="Export the whole page as PDF">
            <Download size={15} color="var(--muted)" /><span>Export PDF</span>
          </button>
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

      {/* import failure — stays put until dismissed, unlike the toast */}
      {importIssue && (
        <Banner kind={importIssue.kind} onClose={() => setImportIssue(null)}>
          <b>{importIssue.kind === "err" ? "Import failed. " : "Imported with warnings. "}</b>
          {importIssue.msg}
        </Banner>
      )}

      {/* physical + acoustic side by side */}
      <div className="pt-row">
        <div className="pt-cell">
          <ScanSection variant="o" icon={<Radar size={16} color="var(--orange)" />}
            title="Physical scan" subtitle="LiDAR · dimensions & obstacles"
            tabs={physicalList} activeId={physId} onTab={setPhysId} sheets={sheets}
            table={physTable} hasSheets={hasSheets} session={session}
            emptyHint="Import to load the room dimensions and obstacle scan." />
        </div>
        <div className="pt-cell">
          <ScanSection variant="c" icon={<Volume2 size={16} color="var(--cyan)" />} acoustic
            title="Acoustic scan" subtitle="Sound sensor · reverberation & classification"
            tabs={acousticList} activeId={acouId} onTab={setAcouId} sheets={sheets}
            table={acouTable} hasSheets={hasSheets} session={session} audit={acouAudit} when={acouTs} whenMissing={reverbSheet ? "No timestamp in the Reverberation tab" : "No Reverberation tab loaded"}
            emptyHint="Run the sound-sensor pass, or import the acoustic sheets." />
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
function ScanSection({ variant, icon, title, subtitle, tabs, activeId, onTab, sheets, table, hasSheets, session, acoustic = false, emptyHint, audit = null, when = null, whenMissing = "" }) {
  const activeSheet = sheets[activeId];
  const errs = audit?.errors || [];
  const warns = audit?.warnings || [];
  return (
    <section className="scan">
      <div className="scan-head">
        <span className={`scan-ic ${variant}`}>{icon}</span>
        <div className="scan-h">
          <div className="scan-title">{title}</div>
          <div className="scan-sub">{subtitle}</div>
          {/* Acoustic scan timestamp — read from the sheet's time column, which
              is kept out of the value grid itself. */}
          {acoustic && activeSheet && (
            <div className="scan-sub" style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
              <Clock size={12} color="var(--muted)" />
              <span>{when ? `Scanned ${when}` : whenMissing}</span>
            </div>
          )}
        </div>

        {tabs.length > 1 && (
          <div className="seg">
            {tabs.map(([id, s]) => (
              <button key={id} className={`seg-btn${activeId === id ? " active" : ""}`} onClick={() => onTab(id)}>{s.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* Parameter audit for the Classification tab. Errors first: a missing
          column stops the spot layer from building at all, a warning only
          changes how much the numbers can be leaned on. */}
      {/* Values sitting in a column with no parameter name. They're left out of
          the table, so say so — otherwise the data just disappears. */}
      {activeSheet?.unnamed?.length > 0 && (
        <Banner kind="err" inset>
          <b>Missing parameter name.</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {activeSheet.unnamed.map((u, i) => (
              <li key={i} style={{ marginTop: i ? 4 : 0 }}>
                Column {u.col} of the “{activeSheet.label}” sheet holds {u.count} value{u.count > 1 ? "s" : ""} ({u.sample.join(", ")}{u.count > 3 ? ", …" : ""}) but has no header, so {u.count > 1 ? "they are" : "it is"} not shown. Add the parameter name in the header row and re-import.
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {errs.length > 0 && (
        <Banner kind="err" inset>
          <b>Classification parameters incomplete.</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {errs.map((m, i) => <li key={i} style={{ marginTop: i ? 4 : 0 }}>{m}</li>)}
          </ul>
        </Banner>
      )}
      {warns.length > 0 && (
        <Banner kind="warn" inset>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warns.map((m, i) => <li key={i} style={{ marginTop: i ? 4 : 0 }}>{m}</li>)}
          </ul>
        </Banner>
      )}

      {acoustic && table.lists?.length > 0 ? (
        <ParamColumns lists={table.lists} />
      ) : (
      <ScanTable columns={table.columns} rows={table.rows} mode={table.mode} packLeft={acoustic}
        empty={!hasSheets ? "Nothing imported yet." : !activeSheet ? emptyHint : (acoustic ? "No values." : !session ? "No room scan loaded." : (table.mode === "rows" ? "No data for this room scan." : "No values."))} />
      )}
    </section>
  );
}

/* ---- table ----
 * `packLeft` adds a zero-content filler column that soaks up all the leftover
 * width. Without it the table stretches its real columns to fill 100%, which is
 * why dropping the timestamp column left the acoustic values drifting rightward
 * and unevenly spaced. With it, each real column shrinks to its content and the
 * whole set sits flush left. */
function ScanTable({ columns, rows, mode, empty, packLeft = false }) {
  const numericCols = useMemo(() => {
    const sample = rows.slice(0, 60);
    return columns.map((_, i) => { const vals = sample.map((r) => r[i]).filter((v) => v !== "" && v != null); return vals.length > 0 && vals.every(numish); });
  }, [columns, rows]);
  const hug = packLeft && columns.length > 0;
  return (
    <div className="scan-body thin-scroll">
      <table className="dtable">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className={numericCols[i] ? "num" : undefined}
                style={hug ? { width: "1%", whiteSpace: "nowrap", textAlign: "left" } : undefined}
              >
                {c || "—"}
              </th>
            ))}
            {hug && <th aria-hidden="true" style={{ width: "100%" }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {columns.map((_, ci) => {
                const val = row[ci];
                const numeric = mode === "record" ? (ci === 1 && numish(val)) : numericCols[ci];
                const cls = `${numeric ? "num" : ""}${ci === 0 ? " emph" : ""}`.trim();
                return (
                  <td
                    key={ci}
                    className={cls || undefined}
                    style={hug ? { width: "1%", whiteSpace: "nowrap", textAlign: "left" } : undefined}
                  >
                    {numeric ? fmtNum(val) : (val || "—")}
                  </td>
                );
              })}
              {hug && <td aria-hidden="true" />}
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="empty" colSpan={Math.max(columns.length, 1) + (hug ? 1 : 0)}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---- acoustic parameters ----
 * One small table per parameter, side by side, each holding only that
 * parameter's values. They share the .dtable styles, so headers and rows line
 * up across parameters, and a shorter parameter simply ends — there are no
 * blank cells below or between its values. */
function ParamColumns({ lists }) {
  return (
    <div className="scan-body thin-scroll">
      {/* Each parameter takes an equal share of the width (never narrower than
          its content), so the columns fill the panel edge to edge instead of
          bunching left and leaving an empty band on the right. */}
      <div style={{ display: "flex", alignItems: "flex-start", width: "100%", minWidth: "max-content" }}>
        {lists.map(([name, vals]) => {
          const numeric = vals.every(numish);
          return (
            <div key={name} style={{ flex: "1 1 0", minWidth: "max-content" }}>
            <table className="dtable" style={{ width: "100%" }}>
              <thead>
                <tr><th style={{ whiteSpace: "nowrap", textAlign: "left" }}>{name}</th></tr>
              </thead>
              <tbody>
                {vals.map((v, i) => (
                  <tr key={i}><td style={{ whiteSpace: "nowrap", textAlign: "left" }}>{numeric ? fmtNum(v) : v}</td></tr>
                ))}
              </tbody>
            </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- inline notice ----
 * Two tones only: "err" for something that blocks the data being usable,
 * "warn" for something that changes how far it can be trusted. Coloured
 * from the same tokens the rest of the app reads, so a theme change can't
 * leave a red box on a red panel. */
function Banner({ kind = "err", inset = false, onClose, children }) {
  const err = kind === "err";
  return (
    <div
      role={err ? "alert" : "status"}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        margin: inset ? "0 0 10px" : "0 0 14px",
        padding: "10px 12px", borderRadius: 8,
        fontSize: "0.86em", lineHeight: 1.55,
        overflowWrap: "anywhere",
        background: err ? "rgba(255,91,82,0.10)" : "rgba(246,161,92,0.10)",
        border: `1px solid ${err ? "rgba(255,91,82,0.30)" : "rgba(246,161,92,0.30)"}`,
      }}
    >
      <span style={{ flex: "0 0 auto", marginTop: 1 }}>
        {err ? <AlertCircle size={15} color="var(--bad)" /> : <AlertTriangle size={15} color="var(--warn)" />}
      </span>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss"
          style={{ flex: "0 0 auto", background: "none", border: 0, padding: 2, cursor: "pointer", lineHeight: 0 }}
        >
          <X size={14} color="var(--muted)" />
        </button>
      )}
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