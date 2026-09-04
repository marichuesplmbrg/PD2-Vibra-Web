import React from "react";
import { NavLink } from "react-router-dom";
import {
  Sparkle,
  LayoutGrid,
  Table2,
  History,
  Activity,
<<<<<<< HEAD
=======
  Target,
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
  ClipboardList,
  Users,
  Settings2,
  LogOut,
  Waves,
} from "lucide-react";

const PRIMARY = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/parameters", label: "Parameters table", icon: Table2 },
  { to: "/history", label: "History", icon: History },
  { to: "/simulation", label: "Simulation", icon: Activity },
<<<<<<< HEAD
=======
  { to: "/recommendations", label: "Recommendations", icon: Target },
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
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
      <div className="brand">
        <div className="logo">
          <Sparkle size={17} fill="#17131f" />
        </div>
        <div className="name">VIBRA</div>
      </div>

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
<<<<<<< HEAD
}
=======
}
>>>>>>> 29fa3588035779743d20d612ea07a76684da8d9d
