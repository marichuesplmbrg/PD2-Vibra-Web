<<<<<<< HEAD
<<<<<<< HEAD
# PD2-Vibra-Web
=======
=======
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
# VIBRA — Room analysis web app

Machine Learning-Based Reverberation Classification System for Spatial
Analysis Using Digital Twin. React + Vite + Three.js dashboard.

## Run it

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

Build for production: `npm run build`, then `npm run preview`.

## Project structure

```
src/
  config.js                 single source of truth — edit this first
  main.jsx                  entry point + router
  App.jsx                   layout shell, routes, injects colors from config
  styles.css                all styling (CSS custom properties)
  lib/
    csv.js                  parse Google Sheets published-CSV
    fitRoom.js              room rectangle from cardinal LiDAR rays
    acoustics.js            Sabine RT60, qualification, band position
    exportDashboardPdf.js   PDF report (jsPDF)
  data/
    useRoomData.jsx         context provider: sample or live sheet
  components/
    Sidebar.jsx  TopBar.jsx  StatCard.jsx  RoomTwin.jsx
    Rt60Bar.jsx  Recommendations.jsx  ScanCoverage.jsx
  pages/
    Dashboard.jsx           the main screen
    ParametersTable.jsx  HistoryPage.jsx  Simulation.jsx
    RecommendationsPage.jsx  Instructions.jsx   (scaffolded)
```

## Switch from sample data to your Google Sheet

1. In Google Sheets: File > Share > Publish to web.
2. Pick the Room tab, format CSV, publish, copy the link.
3. Do the same for the Reverberation tab.
4. In `src/config.js` set `dataSource: "sheet"` and paste the two links
   into `sheet.csv.room` and `sheet.csv.reverberation`.
5. Adjust the column names in `data/useRoomData.jsx` (`reduceReverb`
   and the Room-row mapping) to match your actual sheet headers.

## Note on the RT60 label

The RT60 card shows `rt60.source` ("MEASURED"). If RT60 is predicted
with Sabine/Eyring rather than captured from an interrupted-noise decay,
change it to "ESTIMATED" and cite EN 12354-6, not ISO 3382-2. The label
lives in one place: `config.js` (sample) or `useRoomData.jsx` (sheet).
<<<<<<< HEAD
>>>>>>> 29fa358 (Initial commit)
=======
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
