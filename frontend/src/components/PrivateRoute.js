// src/components/PrivateRoute.js
import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function PrivateRoute() {
  const { user, booting } = useAuth();
  if (booting) return <div style={{ padding: 24 }}>Φόρτωση…</div>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
