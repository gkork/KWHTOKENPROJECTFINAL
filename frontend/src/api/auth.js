// src/api/auth.js
import { API_BASE } from "../config";

const TOKEN_KEY = "authToken";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t || "");
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function http(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function register(email, password) {
  const data = await http("/auth/register", { method: "POST", body: { email, password } });
  setToken(data.token);
  return data.user;
}

export async function login(email, password) {
  const data = await http("/auth/login", { method: "POST", body: { email, password } });
  setToken(data.token);
  return data.user;
}

export async function me() {
  return http("/me", { auth: true });
}

export function logout() {
  clearToken();
}
