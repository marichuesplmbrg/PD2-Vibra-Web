import React, { useEffect, useState } from "react";
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
   Theme
------------------------------------------------------- */

const C = {
  bg: "#0a0e1a",
  panel: "#141a2c",
  panelAlt: "#111627",
  card: "#171d30",

  border: "#242c43",
  borderSoft: "#1d2438",

  text: "#f3f5fb",
  textDim: "#8b93a8",
  textFaint: "#5d6479",

  orange: "#f6a24b",
  purple: "#9b7ff0",
  green: "#5cd6a0",
  red: "#f2767b",
};

const GRAD =
  "linear-gradient(135deg, #f6a24b 0%, #9b7ff0 100%)";


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
    ? `${Number(value).toLocaleString(undefined, {
        maximumFractionDigits: 3,
      })} m`
    : "—";


const fmtSaved = (iso) => {
  try {
    return new Date(iso).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
};


/* -------------------------------------------------------
   Shared styles
------------------------------------------------------- */

const panel = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
};


const ctrlBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontSize: 13.5,
  fontWeight: 500,
  cursor: "pointer",
};


const ghostBtn = {
  ...ctrlBtn,
  background: "transparent",
  color: C.textDim,
};


const primaryBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  background: GRAD,
  border: "none",
  borderRadius: 10,
  color: "#241706",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};


/* -------------------------------------------------------
   History Page
------------------------------------------------------- */

/**
 * History page.
 *
 * @param {(entry) => void} [onRestore]
 * Called after a restore is requested.
 * Use it to navigate to the Parameters table page
 * in your application's router.
 */

export default function HistoryPage({ onRestore } = {}) {
  const [items, setItems] = useState(() =>
    vibraHistory.list()
  );

  const [confirmId, setConfirmId] = useState(null);


  /* Subscribe to history changes */

  useEffect(() => {
    return vibraHistory.subscribe(setItems);
  }, []);


  /* Restore a saved scan */

  const restore = (entry) => {
    vibraHistory.requestRestore(entry);

    if (typeof onRestore === "function") {
      onRestore(entry);
    }
  };


  /* Delete a saved scan */

  const del = (id) => {
    vibraHistory.remove(id);
    setConfirmId(null);
  };


  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        fontFamily:
          "Inter, ui-sans-serif, system-ui, sans-serif",
        minHeight: "100%",
      }}
    >

      <main
        style={{
          padding: "26px 34px 40px",
          maxWidth: 1000,
        }}
      >

        {/* -------------------------------------------------
            Header
        ------------------------------------------------- */}

        <h1
          style={{
            fontSize: 30,
            fontWeight: 800,
            margin: "0 0 4px",
            letterSpacing: -0.4,
          }}
        >
          History
        </h1>


        <p
          style={{
            color: C.textDim,
            margin: "0 0 22px",
            fontSize: 15,
          }}
        >
          Saved room scans — restore one back into the
          Parameters table, or remove it.
        </p>


        {/* -------------------------------------------------
            Empty state
        ------------------------------------------------- */}

        {items.length === 0 ? (

          <div
            style={{
              ...panel,
              padding: "40px 24px",
              textAlign: "center",
              color: C.textDim,
            }}
          >

            <HistoryIcon
              size={26}
              color={C.textFaint}
              style={{
                marginBottom: 10,
              }}
            />

            <div
              style={{
                fontSize: 15,
              }}
            >
              No saved scans yet.
            </div>

            <div
              style={{
                fontSize: 13.5,
                marginTop: 4,
              }}
            >
              Open the Parameters table, pick a room scan,
              and hit{" "}
              <b
                style={{
                  color: C.text,
                  fontWeight: 600,
                }}
              >
                Save
              </b>
              .
            </div>

          </div>

        ) : (

          /* -------------------------------------------------
             Saved scans
          ------------------------------------------------- */

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >

            {items.map((entry) => {

              const tabNames = Object.keys(
                entry.tabs || {}
              );


              const rowCount = (label) =>
                entry.tabs?.[label]?.rows?.length ?? 0;


              return (

                <div
                  key={entry.id}
                  style={{
                    ...panel,
                    padding: "16px 18px",
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    flexWrap: "wrap",
                  }}
                >

                  {/* Room icon */}

                  <span
                    style={{
                      display: "inline-flex",
                      width: 40,
                      height: 40,
                      borderRadius: 11,
                      alignItems: "center",
                      justifyContent: "center",
                      background:
                        "rgba(155,127,240,.14)",
                      flexShrink: 0,
                    }}
                  >
                    <Home
                      size={19}
                      color={C.purple}
                    />
                  </span>


                  {/* Scan information */}

                  <div
                    style={{
                      minWidth: 200,
                      flex: "1 1 240px",
                    }}
                  >

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontWeight: 700,
                        fontSize: 15,
                      }}
                    >

                      <Clock
                        size={14}
                        color={C.textDim}
                      />

                      {entry.roomTs || entry.label}

                    </div>


                    <div
                      style={{
                        fontSize: 12.5,
                        color: C.textFaint,
                        marginTop: 3,
                      }}
                    >
                      Saved {fmtSaved(entry.savedAt)}
                    </div>

                  </div>


                  {/* Room dimensions */}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: C.textDim,
                      minWidth: 150,
                    }}
                  >

                    <Ruler
                      size={14}
                      color={C.purple}
                    />

                    {fmtDim(entry.dims?.width)}
                    {" × "}
                    {fmtDim(entry.dims?.length)}
                    {" × "}
                    {fmtDim(entry.dims?.height)}

                  </div>


                  {/* Data tabs */}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12.5,
                      color: C.textDim,
                      flexWrap: "wrap",
                    }}
                  >

                    <Layers
                      size={14}
                      color={C.textFaint}
                    />

                    {tabNames.map((tab) => (

                      <span
                        key={tab}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: C.panelAlt,
                          border:
                            `1px solid ${C.borderSoft}`,
                        }}
                      >
                        {tab} · {rowCount(tab)}
                      </span>

                    ))}

                  </div>


                  {/* Actions */}

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginLeft: "auto",
                    }}
                  >

                    {/* Restore */}

                    <button
                      style={primaryBtn}
                      onClick={() => restore(entry)}
                    >
                      <RotateCcw
                        size={15}
                        color="#241706"
                      />

                      Restore
                    </button>


                    {/* Delete confirmation */}

                    {confirmId === entry.id ? (

                      <>
                        <button
                          style={{
                            ...ctrlBtn,
                            borderColor:
                              "rgba(242,118,123,.5)",
                            color: C.red,
                          }}
                          onClick={() =>
                            del(entry.id)
                          }
                        >
                          Confirm delete
                        </button>


                        <button
                          style={ghostBtn}
                          onClick={() =>
                            setConfirmId(null)
                          }
                        >
                          Cancel
                        </button>
                      </>

                    ) : (

                      <button
                        style={{
                          ...ctrlBtn,
                          color: C.red,
                          borderColor:
                            "rgba(242,118,123,.3)",
                        }}
                        onClick={() =>
                          setConfirmId(entry.id)
                        }
                      >

                        <Trash2
                          size={15}
                          color={C.red}
                        />

                        Delete

                      </button>

                    )}

                  </div>

                </div>

              );
            })}

          </div>

        )}

      </main>

    </div>
  );
}