// src/components/NavBar.js
import React from "react";
import { NavLink, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export default function NavBar() {
  const { user, logout } = useAuth(); // <-- hook στην κορυφή, χωρίς try/catch

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link
          to="/app"
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}
        >
          <div style={{ height: 28, width: 28, borderRadius: 8, background: "var(--primary)" }} />
          <strong>KWHToken DApp</strong>
        </Link>

        <nav className="nav-links">
          <NavLink to="/app" end>App</NavLink>
          <NavLink to="/analytics">Στατιστικά</NavLink>
        </nav>

        <div className="nav-links" style={{ gap: 10 }}>
          {user ? (
            <>
              <span className="badge">{user.email ?? "user"}</span>
              <button className="btn ghost" onClick={logout}>Logout</button>
            </>
          ) : (
            <>
              <Link className="btn ghost" to="/login">Login</Link>
              <Link className="btn" to="/signup">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
