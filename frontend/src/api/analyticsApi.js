// src/api/analyticsApi.js
const DEFAULT_BASE = "http://localhost:4000";

function computeBase() {
  const raw = (process.env.REACT_APP_API_BASE || "").trim();
  if (raw && raw !== "/") return raw.replace(/\/$/, "");
  // dev fallback: αν τρέχεις στο :3000, πήγαινε στο :4000
  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    if (port === "3000") return `${protocol}//${hostname}:4000`;
  }
  return DEFAULT_BASE;
}

const API_BASE = computeBase();

function getToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("jwt") ||
    localStorage.getItem("kwhtoken_token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("token") ||
    sessionStorage.getItem("authToken")
  );
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function jsonFetch(path, opts = {}) {
  const url = `${API_BASE}${path.startsWith("/") ? path : "/" + path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(opts.headers || {}),
    },
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? " :: " + text : ""}`);
  }
  return res.json();
}

export async function getSummary(userAddress) {
  return jsonFetch(`/api/analytics/summary?user=${encodeURIComponent(userAddress)}`);
}
export async function getDaily(userAddress) {
  const q = userAddress ? `?user=${encodeURIComponent(userAddress)}` : "";
  const data = await jsonFetch(`/api/analytics/daily${q}`);
  // επιστρέφουμε ΠΑΝΤΑ array, αλλιώς []
  return Array.isArray(data?.daily) ? data.daily : [];
}


// SSE
export function openLiveSession(userAddress, onMessage, onError) {
  const token = getToken();
  const qs = new URLSearchParams({
    user: userAddress || "",
    ...(token ? { token } : {}),
  }).toString();

  const es = new EventSource(`${API_BASE}/api/analytics/sessions?${qs}`, {
    withCredentials: true,
  });

  es.onmessage = (ev) => {
    try { onMessage && onMessage(JSON.parse(ev.data)); }
    catch { onMessage && onMessage(ev.data); }
  };
  es.onerror = (err) => { onError && onError(err); es.close(); };
  return es;
}

// JSON list of recent sessions (όχι SSE)
export async function getSessions(userAddress, limit = 20) {
  const qs = new URLSearchParams({
    user: userAddress || "",
    limit: String(limit),
  }).toString();

  const data = await jsonFetch(`/api/analytics/sessions?${qs}`);
  return Array.isArray(data?.sessions) ? data.sessions : [];
}

// Live updates (SSE) – ίδιο όπως πριν
export function openSSE(userAddress, onMessage, onError) {
  return openLiveSession(userAddress, onMessage, onError);
}

