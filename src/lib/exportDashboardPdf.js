import { jsPDF } from "jspdf";
import { CONFIG, fmt } from "../config.js";

/* Simple text report export. Extend with jsPDF drawing calls or a
   canvas snapshot of the twin if you want the 3D view in the PDF. */

export function exportDashboardPdf(data) {
  const { room, rt60, qualified, band, scan } = data;
  const t = CONFIG.target;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  let y = 56;
  const line = (text, size = 11, gap = 18, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.text(text, 56, y);
    y += gap;
  };

  line("VIBRA — Room analysis report", 18, 30, true);
  line(`${CONFIG.operator.name} · ${CONFIG.operator.org}`, 10, 24);
  line(`Last scan: ${scan.points.toLocaleString()} points · ${scan.device}`, 10, 30);

  line("Reverberation", 13, 22, true);
  line(`RT60 (${rt60.source}): ${fmt(rt60.measured)} s`);
  line(`Target band: ${fmt(t.low)}-${fmt(t.high)} s`);
  line(`Position: ${band === "in" ? "within target" : band + " target"}`);
  line(`Qualification: ${qualified ? "Qualified (ISO 23591)" : "Not qualified — needs treatment"}`, 11, 30);

  line("Room geometry", 13, 22, true);
  line(`Width: ${fmt(room.width)} m`);
  line(`Length: ${fmt(room.length)} m`);
  line(`Height: ${fmt(room.height)} m`);
  line(`Floor area: ${fmt(room.area)} m2`);
  line(`Volume: ${fmt(room.volume, 1)} m3`, 11, 30);

  line("Recommendations", 13, 22, true);
  CONFIG.recommendations.forEach((r) => {
    line(`- ${r.title}  (-${fmt(r.delta)} s)`, 10, 16);
  });

  doc.save("vibra-room-analysis.pdf");
}
