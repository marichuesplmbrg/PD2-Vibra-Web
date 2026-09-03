import React, { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { CONFIG } from "./config.js";
import { RoomDataProvider } from "./data/useRoomData.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ParametersTable from "./pages/ParametersTable.jsx";
import HistoryPage from "./pages/HistoryPage.jsx";
import Simulation from "./pages/Simulation.jsx";
import RecommendationsPage from "./pages/RecommendationsPage.jsx";
import Instructions from "./pages/Instructions.jsx";

export default function App() {
  // Push config colors onto :root so config.js stays the single
  // source of truth for both CSS and the Three.js scene.
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(CONFIG.colors).forEach(([k, v]) =>
      root.style.setProperty(`--${k}`, v)
    );
  }, []);

  return (
    <RoomDataProvider>
      <div className="vibra">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/parameters" element={<ParametersTable />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/simulation" element={<Simulation />} />
            <Route path="/recommendations" element={<RecommendationsPage />} />
            <Route path="/instructions" element={<Instructions />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </RoomDataProvider>
  );
}
