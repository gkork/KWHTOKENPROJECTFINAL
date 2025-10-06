// frontend/src/components/TxFeed.js
/* eslint-env es2020 */
import React, { useEffect, useRef, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

export default function TxFeed() {
  const [eventName, setEventName] = useState("");
  const [address, setAddress] = useState("");
  const [limit, setLimit] = useState(50);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [list, setList] = useState([]);        // πάντα array
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const timerRef = useRef(null);

  // ---- helpers ----
  const fmtTs = (ms) => {
    if (!ms || Number.isNaN(ms)) return "—";
    try {
      return new Intl.DateTimeFormat("el-GR", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "Europe/Athens",
      }).format(new Date(ms));
    } catch {
      return "—";
    }
  };
  const short = (s, head = 10, tail = 6) =>
    s && s.length > head + tail ? `${s.slice(0, head)}…${s.slice(-tail)}` : (s || "—");

  // Ενοποίηση πεδίων από διαφορετικά endpoints/schemas
  function normalizeRows(raw = []) {
    return raw.map((r) => {
      const ts = r.ts ?? r.blockTime ?? r.time ?? r.timestamp ?? null;
      let timeMs = null;
      try {
        // Date/ISO/string/number → ms
        timeMs = ts instanceof Date ? ts.getTime() : ts != null ? new Date(ts).getTime() : null;
        if (Number.isNaN(timeMs)) timeMs = null;
      } catch {
        timeMs = null;
      }
      return {
        time: timeMs,                                                  // ms
        blockNumber: r.blockNumber ?? null,
        event: r.name || r.event || r.type || "—",
        address: (r.contract || r.address || "").toLowerCase(),
        txHash: r.txHash || r.hash || "",
        args: r.args || r.payload || {},
      };
    });
  }

  async function fetchEventsEndpoint() {
    // Προσπάθεια στο /api/events
    // (κρατάμε μόνο limit — τα υπόλοιπα φίλτρα τα κάνουμε client-side για συμβατότητα)
    const p = new URL(`${API_BASE}/api/events`);
    p.searchParams.set("limit", String(limit || 50));
    const resp = await fetch(p.toString(), { credentials: "include" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} @ /api/events`);
    let data = {};
    try { data = await resp.json(); } catch { data = {}; }
    const rows = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    return normalizeRows(rows);
  }

  async function fetchTxsEndpoint() {
    // Fallback στο υπάρχον /chain/txs με server-side φίλτρα
    const p = new URL(`${API_BASE}/chain/txs`);
    p.searchParams.set("limit", String(limit || 50));
    if (eventName.trim()) p.searchParams.set("event", eventName.trim());
    if (address.trim())   p.searchParams.set("address", address.trim());
    const resp = await fetch(p.toString(), { credentials: "include" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} @ /chain/txs`);
    let data = {};
    try { data = await resp.json(); } catch { data = {}; }
    const rows = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
    return normalizeRows(rows);
  }

  async function load() {
    setLoading(true);
    setErr("");
    try {
      // 1) /api/events
      let rows = await fetchEventsEndpoint();
      // client-side φίλτρο (σε περίπτωση που /api/events δεν υποστηρίζει params)
      if (eventName.trim()) {
        const q = eventName.trim().toLowerCase();
        rows = rows.filter((r) => r.event.toLowerCase().includes(q));
      }
      if (address.trim()) {
        const a = address.trim().toLowerCase();
        rows = rows.filter((r) => r.address === a);
      }
      setList(rows);
    } catch {
      try {
        // 2) fallback: /chain/txs (όπως είχες)
        const rows = await fetchTxsEndpoint();
        setList(rows);
      } catch (e2) {
        setErr(String(e2?.message || e2));
        setList([]);
      }
    } finally {
      setLoading(false);
    }
  }

  // Αρχικό load
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto refresh on/off
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(load, 5000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, limit, eventName, address]);

  // Refresh όταν γίνονται simulate/buy/pay (εκπέμπεις ήδη αυτό το event στο DApp)
  useEffect(() => {
    const cb = () => load();
    window.addEventListener("kwh:refresh-analytics", cb);
    return () => window.removeEventListener("kwh:refresh-analytics", cb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card section" style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>On-chain συναλλαγές / events</h3>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <label>
          Event:&nbsp;
          <input
            className="input"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="π.χ. Listed, Purchased, Simulated…"
            style={{ width: 240 }}
          />
        </label>

        <label>
          Contract:&nbsp;
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… (προαιρετικό)"
            style={{ width: 260 }}
          />
        </label>

        <label>
          Limit:&nbsp;
          <select className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 100 }}>
            {[25, 50, 100, 200, 500].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Φόρτωση…" : "Ανανέωση"}
        </button>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto refresh
        </label>
      </div>

      {err && <div style={{ color: "crimson", marginBottom: 8 }}>Αποτυχία φόρτωσης συναλλαγών: {err}</div>}

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead style={{ textAlign: "left", opacity: 0.7 }}>
          <tr>
            <th>Ώρα</th>
            <th>Block</th>
            <th>Event</th>
            <th>Contract</th>
            <th>Tx</th>
            <th>Args</th>
          </tr>
        </thead>
        <tbody>
          {list.length > 0 ? (
            list.map((it, i) => (
              <tr key={`${it.txHash || i}-${it.blockNumber || 0}`} style={{ borderTop: "1px solid #eee" }}>
                <td>{fmtTs(it.time)}</td>
                <td>{it.blockNumber ?? "—"}</td>
                <td>{it.event || "—"}</td>
                <td title={it.address}>{it.address ? short(it.address, 6, 4) : "—"}</td>
                <td title={it.txHash}>{short(it.txHash)}</td>
                <td>
                  <code style={{ fontSize: 12 }}>
                    {it.args ? JSON.stringify(it.args) : "{}"}
                  </code>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="6" style={{ padding: 8, opacity: 0.7 }}>
                Δεν υπάρχουν εγγραφές.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
