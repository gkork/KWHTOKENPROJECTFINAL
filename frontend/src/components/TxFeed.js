// frontend/src/components/TxFeed.js
/* eslint-env es2020 */
import React, { useEffect, useRef, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

export default function TxFeed() {
  const [eventName, setEventName] = useState("");
  const [address, setAddress] = useState("");
  const [limit, setLimit] = useState(50);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [list, setList] = useState([]);        // ΠΑΝΤΑ array
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const timerRef = useRef(null);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const p = new URL(`${API_BASE}/chain/txs`);
      p.searchParams.set("limit", String(limit || 50));
      if (eventName.trim()) p.searchParams.set("event", eventName.trim());
      if (address.trim())   p.searchParams.set("address", address.trim());

      const resp = await fetch(p.toString(), { credentials: "include" });
      if (!resp.ok) {
        setErr(`HTTP ${resp.status}`);
        setList([]); // ασφαλές fallback
        setLoading(false);
        return;
      }

      // Μπορεί να γυρίσει κενό σώμα/λάθος JSON → προστάτεψέ το
      let data = {};
      try {
        data = await resp.json();
      } catch {
        data = {};
      }

      // Αποδέξου items ΜΟΝΟ αν είναι array
      const items = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data)
        ? data
        : [];

      setList(items);
    } catch (e) {
      setErr(String(e?.message || e));
      setList([]);
    } finally {
      setLoading(false);
    }
  }

  // Αρχικό load μόνο μία φορά
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto refresh με σταθερό dependency array για να μη βγάζει
  // "The final argument passed to useEffect changed size..."
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(load, 5000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const fmtTs = (ms) => {
    if (!ms || Number.isNaN(ms)) return "—";
    try { return new Date(ms).toLocaleString(); } catch { return "—"; }
  };

  return (
    <section style={{ padding: 16, border: "1px solid #eee", borderRadius: 8, marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>On-chain συναλλαγές / events</h3>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <label>
          Event:&nbsp;
          <input
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="π.χ. Listed, Purchased…"
            style={{ width: 240 }}
          />
        </label>

        <label>
          Contract:&nbsp;
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… (προαιρετικό)"
            style={{ width: 260 }}
          />
        </label>

        <label>
          Limit:&nbsp;
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[25, 50, 100, 200, 500].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <button onClick={load} disabled={loading}>
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
                <td title={it.address}>{it.address ? `${it.address.slice(0, 6)}…${it.address.slice(-4)}` : "—"}</td>
                <td title={it.txHash}>{it.txHash ? `${it.txHash.slice(0, 10)}…${it.txHash.slice(-6)}` : "—"}</td>
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
