/* ============================================================
   VIBRA — single source of truth.
   Edit this file to change the whole app. Every page derives
   from these values.
   ============================================================ */

export const CONFIG = {
  operator: { name: "VIBRA Operator", org: "Acoustics Lab", initial: "V" },

  /* ---- where room data comes from ----
     "sample" = use the SAMPLE block below (no network)
     "sheet"  = fetch published-CSV tabs from Google Sheets     */
  dataSource: "sample",

  /* Google Sheet published-CSV endpoints.
     File > Share > Publish to web > pick the tab > CSV, then
     paste each link here. Only used when dataSource === "sheet". */
  sheet: {
    id: "1OAfQI6MwheL6wIes1EhGjak3G1jSVLFGppmzqTL9MWQ",
    csv: {
      room: "",          // Room tab CSV url
      obstacle: "",      // Obstacle tab CSV url
      reverberation: "", // Reverberation tab CSV url
    },
  },

  /* ---- sample scan (used when dataSource === "sample") ---- */
  sample: {
    scan: { points: 18432, device: "LD06 + ultrasonic" },

    /* Cardinal LiDAR rays in metres. Room rectangle is derived:
       length = N + S, width = E + W. Height from ultrasonic.   */
    cardinal: { N: 3.1, S: 3.1, E: 2.4, W: 2.4, height: 3.1 },

    rt60: { measured: 0.62, source: "MEASURED" },

    /* Acoustic zone markers in room-local metres, origin = room
       centre. x = width axis, z = length axis, y = height off floor. */
    markers: {
      hot: [
        { x: 1.6, z: 2.2, y: 1.4 },
        { x: -1.7, z: -1.9, y: 1.1 },
      ],
      dead: [
        { x: -1.5, z: 2.0, y: 0.9 },
        { x: 1.4, z: -2.1, y: 1.6 },
      ],
    },

    /* % of each wall returned by the sweep. */
    coverage: { N: 96, E: 88, S: 94, W: 71 },
  },

  /* ---- RT60 target band (ISO 23591 style) ---- */
  target: { low: 0.3, high: 0.4, scaleMax: 1.0 },

  recommendations: [
    {
      title: "Broadband porous absorbers, wall centres",
      note: "4 panels (NRC 0.95) at the mid-point of each long wall. Centre placement, not corners.",
      delta: 0.14,
    },
    {
      title: "Ceiling absorption over the hot zone",
      note: "Suspended raft above the north-east hotspot to break the floor-ceiling reflection.",
      delta: 0.08,
    },
    {
      title: "Bass-range membrane in the soft corner",
      note: "Targets the dead corner without adding diffusion. Diffusers do not change RT60.",
      delta: 0.03,
    },
  ],

  colors: {
    bg: "#0e1016",
    panel: "#171a24",
    panel2: "#1e2230",
    ink: "#e9eaf0",
    muted: "#8b90a4",
    line: "#262a38",
    orange: "#f6a15c",
    violet: "#a98bf5",
    ok: "#4ecb71",
    bad: "#ff5b52",
    hot: "#ff3b30",
    dead: "#0a84ff",
    edge: "#f5c451",
    shell: "#a98bf5",
    warn: "#f4926b",
  },
};

export const fmt = (n, d = 2) => Number(n).toFixed(d);
