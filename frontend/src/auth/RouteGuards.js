import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;              // ή ένα spinner
  return user ? children : <Navigate to="/login" replace />;
}

export function GuestRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;              // περιμένουμε να μάθουμε αν υπάρχει session
  return user ? <Navigate to="/app" replace /> : children;
}
