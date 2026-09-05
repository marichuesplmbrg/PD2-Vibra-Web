import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutGrid,
  Table2,
  History,
  Activity,
  ClipboardList,
  Users,
  Settings2,
} from "lucide-react";

const PRIMARY = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/parameters", label: "Parameters table", icon: Table2 },
  { to: "/history", label: "History", icon: History },
  { to: "/simulation", label: "Simulation", icon: Activity },
  { to: "/instructions", label: "Instructions", icon: ClipboardList },
];

const SECONDARY = [
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

function Item({ to, label, icon: Icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
    >
      <Icon size={18} strokeWidth={2} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <NavLink
        to="/"
        end
        className="brand"
        aria-label="VIBRA — go to dashboard"
      >
        <img
          src="/logo/No-bg-Vibra-logo.png"
          alt=""
          className="brand-logo"
        />
        <div className="name">VIBRA</div>
      </NavLink>

      {PRIMARY.map((i) => (
        <Item key={i.to} {...i} />
      ))}

      <div className="divider" />

      {SECONDARY.map((i) => (
        <Item key={i.to} {...i} />
      ))}

      <div className="spacer" />
    </aside>
  );
}