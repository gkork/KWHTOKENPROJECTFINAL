import React from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";

// Auth
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { PrivateRoute, GuestRoute } from "./auth/RouteGuards";

// Σελίδες
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import DApp from "./pages/DApp";
import Analytics from "./pages/Analytics";

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null; // ή spinner
  return <Navigate to={user ? "/app" : "/login"} replace />;
}

// Μικρό navbar που εμφανίζεται ΜΟΝΟ όταν είσαι logged-in
function NavBar() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <nav
      style={{
        padding: 12,
        borderBottom: "1px solid #eee",
        display: "flex",
        gap: 12,
      }}
    >
      <Link to="/app">DApp</Link>
      <Link to="/analytics">Στατιστικά</Link>
      {/* Αν θες ξεχωριστή σελίδα marketplace:
          <Link to="/market">Marketplace</Link>
       */}
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NavBar /> {/* ← ΠΑΝΤΑ διαθέσιμο όταν είσαι logged-in */}
        <Routes>
          {/* Ρίζα: redirect δυναμικά ανάλογα με session */}
          <Route path="/" element={<RootRedirect />} />

          {/* Ιδιωτικές σελίδες */}
          <Route
            path="/app"
            element={
              <PrivateRoute>
                <DApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <PrivateRoute>
                <Analytics />
              </PrivateRoute>
            }
          />

          {/* Public (guest only) */}
          <Route
            path="/login"
            element={
              <GuestRoute>
                <Login />
              </GuestRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <GuestRoute>
                <Signup />
              </GuestRoute>
            }
          />

          {/* 404 */}
          <Route path="*" element={<div>Δεν βρέθηκε η σελίδα.</div>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
