
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../config";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken]   = useState(() => localStorage.getItem("token") || "");
  const [user, setUser]     = useState(null);
  const [loading, setLoad]  = useState(true);

  // Restore session στο mount / όταν αλλάζει token
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!token) { setLoad(false); return; }
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("unauth");
        const data = await res.json();
        if (!cancelled) setUser(data.user);
      } catch {
        if (!cancelled) {
          setUser(null);
          setToken("");
          localStorage.removeItem("token");
        }
      } finally {
        if (!cancelled) setLoad(false);
      }
    }

    restore();
    return () => { cancelled = true; };
  }, [token]);

  const login = async (email, password) => {
    const res  = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || "Login failed");
    localStorage.setItem("token", data.token);
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const register = async (email, password) => {
    const res  = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || "Register failed");
    localStorage.setItem("token", data.token);
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken("");
    setUser(null);
  };

  const value = useMemo(() => ({ user, token, loading, login, register, logout }), [user, token, loading]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
