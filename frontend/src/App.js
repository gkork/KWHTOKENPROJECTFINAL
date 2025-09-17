// src/App.js
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Auth
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { PrivateRoute, GuestRoute } from "./auth/RouteGuards";

// Pages
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import DApp from "./pages/DApp";
import Analytics from "./pages/Analytics";

// Components
import NavBar from "./components/NavBar";

/** Redirects "/" based on session state */
function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Φόρτωση…</div>;
  return <Navigate to={user ? "/app" : "/login"} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NavBar />
        <Routes>
          {/* Root */}
          <Route path="/" element={<RootRedirect />} />

          {/* Private pages */}
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
          <Route path="*" element={<div className="container">Δεν βρέθηκε η σελίδα.</div>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
