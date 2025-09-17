// src/pages/Analytics.js
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { getSummary, getDaily } from "../api/analyticsApi";

/* ===== helpers ===== */
const DEV = process.env.NODE_ENV !== "production";
const asNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtETH = (v) => { try { return `${ethers.formatEther(v ?? "0")} ETH`; } catch { return `${v ?? 0} ETH`; } };
const pad2 = (n) => String(n).padStart(2, "0");

/** yyyy-mm-dd (LOCAL) */
function localKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
/** yyyy-mm-dd (UTC) */
function utcKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

/**
 * Κανονικοποίηση daily:
 * - ΠΑΝΤΑ συνεχές εύρος τελευταίων `days` ημερών (inclusive “σήμερα”).
 * - Γεμίζει όσα λείπουν με 0 ώστε να φαίνεται πάντα η σημερινή ημέρα.
 */
function normalizeDaily(raw, { days = 30, mode = "local" } = {}) {
  const keyFn = mode === "local" ? localKey : utcKey;

  const map = new Map();
  (Array.isArray(raw) ? raw : []).forEach((row) => {
    let key =
      row.day ??
      row.day_key ??
      (row.date ? String(row.date).slice(0, 10) : null) ??
      (row.ts ? keyFn(new Date(row.ts)) : null);
    if (!key) return;
    if (/\d{4}-\d{2}-\d{2}T/.test(key)) key = keyFn(new Date(key)); // normalize αν έχει ώρα

    const prev = map.get(key) || { prepaid: 0, payg: 0 };
    const prepaid = asNum(row.prepaid ?? row.kwh_prepaid);
    const payg = asNum(row.payg ?? row.kwh_payg);
    map.set(key, { prepaid: prev.prepaid + prepaid, payg: prev.payg + payg });
  });

  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    if (mode === "local") d.setDate(d.getDate() - i);
    else d.setUTCDate(d.getUTCDate() - i);
    const key = keyFn(d);
    const vals = map.get(key) || { prepaid: 0, payg: 0 };
    out.push({ day: key, kwh_prepaid: vals.prepaid, kwh_payg: vals.payg });
  }
  return out;
}

/* ===== mini stacked bar chart (SVG) ===== */
function MiniBars({ data }) {
  const width = 900, height = 260, pad = 24, gap = 4;

  const fmt = (v) => {
    const n = Number(v) || 0;
    return Math.abs(n) >= 10 ? Math.round(n).toString() : n.toFixed(1);
  };

  const bars = useMemo(() => {
    const arr = Array.isArray(data) ? data : [];
    if (!arr.length) return [];

    const totals = arr.map((d) => asNum(d.kwh_prepaid) + asNum(d.kwh_payg));
    const max = Math.max(1, ...(totals.length ? totals : [0]));
    const innerH = height - pad * 2;
    const innerW = width - pad * 2;
    const bw = Math.max(6, Math.floor(innerW / Math.max(1, arr.length)) - gap);

    return arr.map((d, i) => {
      const prepaid = asNum(d.kwh_prepaid);
      const payg = asNum(d.kwh_payg);
      const total = prepaid + payg;
      const hP = (prepaid / max) * innerH;
      const hY = (payg / max) * innerH;
      const x = pad + i * (bw + gap);
      const yP = height - pad - hP;
      const yY = yP - hY;
      return {
        x, bw, hP, hY, yP, yY, total,
        prepaid, payg,
        day: d.day,
        label: String(d.day).slice(5), // MM-DD
        isLast: i === arr.length - 1,
      };
    });
  }, [data]);

  const axisY = height - pad;
  const hasAny = bars.some((b) => (b.total || 0) > 0);

  return (
    <div>
      {!hasAny && (
        <div style={{ opacity: 0.7, padding: "6px 0 8px" }}>
          Δεν υπάρχουν δεδομένα για τις τελευταίες 30 ημέρες.
        </div>
      )}
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="kWh ανά μέρα, PREPAID και PAYG">
        <line x1={pad} y1={axisY} x2={width - pad} y2={axisY} stroke="#2a2a2f" />
        {bars.map((b, idx) => (
          <g key={idx}>
            <rect x={b.x} y={b.yP} width={b.bw} height={Math.max(0, b.hP)} fill="#2dd4bf" stroke="#14b8a6" strokeWidth="0.5">
              <title>{`${b.day}\nPREPAID: ${fmt(b.prepaid)} kWh\nPAYG: ${fmt(b.payg)} kWh\nΣύνολο: ${fmt(b.total)} kWh`}</title>
            </rect>
            <rect x={b.x} y={b.yY} width={b.bw} height={Math.max(0, b.hY)} fill="#94a3b8" stroke="#64748b" strokeWidth="0.5">
              <title>{`${b.day}\nPREPAID: ${fmt(b.prepaid)} kWh\nPAYG: ${fmt(b.payg)} kWh\nΣύνολο: ${fmt(b.total)} kWh`}</title>
            </rect>
            {b.total > 0 && (
              <text x={b.x + b.bw / 2} y={Math.min(b.yY, b.yP) - 4} fontSize="10" textAnchor="middle" fill="#c7c7d1">
                {fmt(b.total)}
              </text>
            )}
            {/* label ανά 4 ΚΑΙ πάντα στο τελευταίο */}
            {(idx % 4 === 0 || b.isLast) && (
              <text x={b.x} y={axisY + 12} fontSize="9" fill="#8b8b93">{b.label}</text>
            )}
          </g>
        ))}
        <text x={pad} y={14} fontSize="12" fill="#8b8b93">PREPAID (μπλε-πράσινο) + PAYG (γκρι-μπλε)</text>
      </svg>
    </div>
  );
}

/* ===== card ===== */
function StatCard({ title, value }) {
  return (
    <div className="card section">
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{value}</div>
    </div>
  );
}

export default function Analytics({ accountProp }) {
  const [account, setAccount] = useState(accountProp || "");
  const [summary, setSummary] = useState({ kwh_total: 0, kwh_prepaid: 0, kwh_payg: 0, pendingBill: "0" });
  const [dailyNorm, setDailyNorm] = useState([]); // normalized
  const [dailyRaw, setDailyRaw] = useState([]);   // server raw
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("local"); // "local" | "utc"

  const todayLocal = localKey(new Date());
  const todayUTC   = utcKey(new Date());

  // Πάρε wallet από MetaMask αν δεν δόθηκε ως prop
  useEffect(() => {
    if (accountProp) return;
    let stop = false;
    (async () => {
      try {
        if (!window.ethereum) return;
        const accs = await window.ethereum.request({ method: "eth_accounts" });
        if (!stop) setAccount(accs?.[0] || "");
        window.ethereum.on?.("accountsChanged", (a) => !stop && setAccount(a?.[0] || ""));
      } catch {}
    })();
    return () => { stop = true; };
  }, [accountProp]);

  async function refetch(addr = account, useMode = mode) {
    if (!addr) return;
    setLoading(true);
    setError("");
    try {
      const [sum, d] = await Promise.all([getSummary(addr), getDaily(addr)]);
      if (DEV) {
        console.log("[analytics] summary:", sum);
        console.log("[analytics] daily:", d);
      }
      setSummary(sum || {});
      const raw = Array.isArray(d) ? d : d?.daily || [];
      setDailyRaw(raw);
      const norm = normalizeDaily(raw, { days: 30, mode: useMode });
      setDailyNorm(norm);
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Αρχικό fetch + όταν αλλάζει account ή mode
  useEffect(() => { if (account) refetch(account, mode); }, [account, mode]);

  // Άκου custom event από το DApp (buy/simulate/pay)
  useEffect(() => {
    const onRefresh = () => refetch();
    window.addEventListener("kwh:refresh-analytics", onRefresh);
    return () => window.removeEventListener("kwh:refresh-analytics", onRefresh);
  }, [account, mode]);

  // Ελαφρύ polling
  useEffect(() => {
    if (!account) return;
    const id = setInterval(() => refetch(), 20000);
    const onVis = () => !document.hidden && refetch();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [account, mode]);

  // “Σήμερα kWh”
  const todayRow = dailyNorm.length ? dailyNorm[dailyNorm.length - 1] : { kwh_prepaid: 0, kwh_payg: 0 };
  const todayTotal = asNum(todayRow.kwh_prepaid) + asNum(todayRow.kwh_payg);

  // Debug flags
  const serverLastKey =
    (dailyRaw?.length && (dailyRaw[dailyRaw.length - 1].day || dailyRaw[dailyRaw.length - 1].day_key || (dailyRaw[dailyRaw.length - 1].date || "").slice(0,10))) || "-";
  const serverHasTodayLocal = dailyRaw.some((r) => (r.day || r.day_key || String(r.date||"").slice(0,10)) === todayLocal);
  const serverHasTodayUTC   = dailyRaw.some((r) => (r.day || r.day_key || String(r.date||"").slice(0,10)) === todayUTC);
  const normHasToday        = dailyNorm.length && dailyNorm[dailyNorm.length - 1]?.day === (mode === "local" ? todayLocal : todayUTC);

  if (!account) {
    return (
      <div className="container grid">
        <div className="card section">
          <h2 style={{ margin: 0 }}>Στατιστικά</h2>
          <p style={{ opacity: 0.8 }}>Σύνδεσε το πορτοφόλι σου για να δεις αυτόματα τα δεδομένα.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container grid">
      <div className="card section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Στατιστικά</h1>
        <div className="nav-links" style={{ gap: 10 }}>
          <span className="badge">Wallet: {account || "—"}</span>
          <button className="btn ghost" onClick={() => refetch()} disabled={loading}>{loading ? "…" : "Refresh"}</button>
          <button className="btn ghost" onClick={() => setMode((m) => (m === "local" ? "utc" : "local"))}>
            Mode: {mode.toUpperCase()}
          </button>
        </div>
      </div>

      {error && (
        <div className="card section" style={{ color: "#fca5a5" }}>
          Σφάλμα φόρτωσης: {error}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
        <StatCard title="Σύνολο kWh (30d)" value={summary.kwh_total ?? 0} />
        <StatCard title="PREPAID kWh (30d)" value={summary.kwh_prepaid ?? 0} />
        <StatCard title="PAYG kWh (30d)" value={summary.kwh_payg ?? 0} />
        <StatCard title="Εκκρεμής οφειλή" value={fmtETH(summary.pendingBill)} />
        <StatCard title="Σήμερα kWh" value={todayTotal} />
      </div>

      <div className="card section">
        <h3 style={{ marginTop: 0 }}>kWh ανά μέρα (PREPAID vs PAYG)</h3>
        <p style={{ marginTop: -6, opacity: 0.7 }}>PREPAID (μπλε-πράσινο) + PAYG (γκρι-μπλε)</p>
        <MiniBars data={dailyNorm} />
      </div>

      {DEV && (
        <div className="card section" style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Debug (dev only)</div>
          <div style={{ display: "grid", gap: 6 }}>
            <div>Server last key: <code>{String(serverLastKey)}</code></div>
            <div>Server has today (LOCAL): <code>{String(serverHasTodayLocal)}</code></div>
            <div>Server has today (UTC): <code>{String(serverHasTodayUTC)}</code></div>
            <div>Normalized has today ({mode.toUpperCase()}): <code>{String(normHasToday)}</code></div>
            <div>Today keys → LOCAL: <code>{todayLocal}</code> | UTC: <code>{todayUTC}</code></div>
            <div>Server rows: <code>{dailyRaw.length}</code></div>
            <div>Last 5 (normalized):</div>
            <pre style={{ margin: 0, overflow: "auto", maxHeight: 160 }}>
{JSON.stringify(dailyNorm.slice(-5), null, 2)}
            </pre>
          </div>
        </div>
      )}

      <div className="card section">
        <h3 style={{ marginTop: 0 }}>Τελευταίες προσομοιώσεις</h3>
        <div style={{ opacity: 0.7, padding: 8 }}>Δεν υπάρχουν ακόμη δεδομένα.</div>
      </div>
    </div>
  );
}
