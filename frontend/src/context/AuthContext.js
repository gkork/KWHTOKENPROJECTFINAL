// src/context/AuthContext.js
import React, { createContext, useContext, useEffect, useState } from "react";
import { login as apiLogin, register as apiRegister, me, logout as apiLogout, getToken } from "../api/auth";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (!getToken()) { setBooting(false); return; }
        const m = await me();
        setUser(m.user);
      } catch {
        // invalid/expired token -> ignore
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  async function doLogin(email, password) {
    const u = await apiLogin(email, password);
    setUser(u);
  }
  async function doRegister(email, password) {
    const u = await apiRegister(email, password);
    setUser(u);
  }
  function doLogout() {
    apiLogout();
    setUser(null);
  }

  return (
    <AuthCtx.Provider value={{ user, booting, doLogin, doRegister, doLogout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
