// src/pages/Analytics.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ethers } from "ethers";
import { getSummary, getDaily, openLiveSession } from "../api/analyticsApi";

// Αν το API δεν επιστρέψει σωστό pendingBill, το διαβάζουμε απευθείας από το συμβόλαιο.
import { KWHTokenAddress } from "../config";
import KWHTokenBuild from "../abi/KWHTokenABI.json";
const KWHTokenABI = KWHTokenBuild.abi ?? KWHTokenBuild;

// Μετατρέπει οτιδήποτε σε Number με ασφάλεια. Αν αποτύχει, γυρίζει 0.
const asNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Μορφοποιεί ποσό wei σε ETH (string).
const fmtETH = (v) => { try { return `${ethers.formatEther(v ?? "0")} ETH`; } catch { return `${v ?? 0} ETH`; } };

// Απλή συμπλήρωση αριστερά με μηδενικά (π.χ. 5 → "05")
const pad2 = (n) => String(n).padStart(2, "0");
// Παράγει κλειδί ημερομηνίας σε LOCAL ζώνη ώρας (yyyy-mm-dd)
const localKey = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

/* Κανονικοποίηση daily: 30 μέρες (LOCAL), γέμισμα κενών με 0 */
function normalizeDaily(raw, days = 30) {
  const map = new Map();
  (Array.isArray(raw) ? raw : []).forEach((row) => {
    let s = row.day ?? row.day_key ?? (row.date ? String(row.date) : null) ?? null;
    let dt = row.ts ? new Date(row.ts) : (s ? new Date(s) : null);
    if (!dt || Number.isNaN(dt.getTime())) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s || "")) {
      const [Y, M, D] = s.split("-").map(Number);
      dt = new Date(Y, (M || 1) - 1, D || 1, 0, 0, 0, 0); // LOCAL midnight
    }
    const key = localKey(dt);
    const prepaid = asNum(row.kwh_prepaid ?? row.prepaidKwh ?? row.prepaid);
    const payg    = asNum(row.kwh_payg    ?? row.paygKwh    ?? row.payg);
    // Άθροιση ανά ημέρα (αν υπάρχουν πολλαπλά rows για την ίδια ημέρα)
    const prev = map.get(key) || { prepaid: 0, payg: 0 };
    map.set(key, { prepaid: prev.prepaid + prepaid, payg: prev.payg + payg });
  });

  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = localKey(d);
    const vals = map.get(key) || { prepaid: 0, payg: 0 };
    out.push({ day: key, kwh_prepaid: vals.prepaid, kwh_payg: vals.payg });
  }
  return out;
}

/* Μικρό stacked chart (SVG) + HOVER TOOLTIP */
function MiniBars({ data }) {
  const width = 900, height = 260, pad = 24, gap = 4;
  const containerRef = useRef(null);
  const [tip, setTip] = useState({ show: false, x: 0, y: 0, day: "", prepaid: 0, payg: 0 });

  const bars = useMemo(() => {
    const arr = Array.isArray(data) ? data : [];
    if (!arr.length) return [];
    const totals = arr.map((d) => asNum(d.kwh_prepaid) + asNum(d.kwh_payg));
    const max = Math.max(1, ...totals);
    const innerH = height - pad * 2;
    const innerW = width - pad * 2;
    const bw = Math.max(6, Math.floor(innerW / Math.max(1, arr.length)) - gap);

    return arr.map((d, i) => {
      const prepaid = asNum(d.kwh_prepaid), payg = asNum(d.kwh_payg);
      const total = prepaid + payg;
      const hP = (prepaid / max) * innerH;
      const hY = (payg / max) * innerH;
      const x = pad + i * (bw + gap);
      const yP = height - pad - hP;
      const yY = yP - hY;
      return {
        x, bw, yP, yY, hP, hY, total,
        day: d.day, prepaid, payg,
        label: String(d.day).slice(5),
        isLast: i === arr.length - 1,
      };
    });
  }, [data]);

  const axisY = height - pad;

  const showTip = (evt, payload) => {
    const host = containerRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setTip({
      show: true,
      x: evt.clientX - rect.left + 12, // λίγο δεξιά από το ποντίκι
      y: evt.clientY - rect.top - 8,   // λίγο πάνω
      ...payload,
    });
  };

  const hideTip = () => setTip((t) => ({ ...t, show: false }));

  return (
    <div ref={containerRef} style={{ position: "relative" }} onMouseLeave={hideTip}>
      {/* Tooltip */}
      {tip.show && (
        <div
          style={{
            position: "absolute",
            left: tip.x,
            top: tip.y,
            transform: "translate(-50%, -100%)",
            background: "#11131a",
            border: "1px solid #2a2f3a",
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            color: "#e5e7eb",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 2,
          }}
        >
          <div style={{ opacity: 0.8, marginBottom: 4 }}>{tip.day}</div>
          <div>PREPAID: <strong>{tip.prepaid}</strong> kWh</div>
          <div>PAYG:&nbsp;&nbsp;&nbsp; <strong>{tip.payg}</strong> kWh</div>
          <div style={{ marginTop: 4, opacity: 0.85 }}>
            Σύνολο: <strong>{asNum(tip.prepaid) + asNum(tip.payg)}</strong> kWh
          </div>
        </div>
      )}

      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="kWh ανά μέρα, PREPAID και PAYG">
        <line x1={pad} y1={axisY} x2={width - pad} y2={axisY} stroke="#2a2a2f" />
        {bars.map((b, i) => (
          <g key={`${b.day}-${i}`}>
            {/* PREPAID */}
            <rect
              x={b.x}
              y={b.yP}
              width={b.bw}
              height={Math.max(0, b.hP)}
              fill="#2dd4bf"
              onMouseMove={(e) => showTip(e, { day: b.day, prepaid: b.prepaid, payg: b.payg })}
              onMouseEnter={(e) => showTip(e, { day: b.day, prepaid: b.prepaid, payg: b.payg })}
            />
            {/* PAYG */}
            <rect
              x={b.x}
              y={b.yY}
              width={b.bw}
              height={Math.max(0, b.hY)}
              fill="#94a3b8"
              onMouseMove={(e) => showTip(e, { day: b.day, prepaid: b.prepaid, payg: b.payg })}
              onMouseEnter={(e) => showTip(e, { day: b.day, prepaid: b.prepaid, payg: b.payg })}
            />
            {/* labels */}
            {b.total > 0 && (
              <text x={b.x + b.bw / 2} y={Math.min(b.yY, b.yP) - 4} fontSize="10" textAnchor="middle" fill="#c7c7d1">
                {Math.round(b.total)}
              </text>
            )}
            {(i % 4 === 0 || b.isLast) && (
              <text x={b.x} y={axisY + 12} fontSize="9" fill="#8b8b93">{b.label}</text>
            )}
          </g>
        ))}
        <text x={pad} y={14} fontSize="12" fill="#8b8b93">PREPAID (μπλε-πράσινο) + PAYG (γκρι-μπλε)</text>
      </svg>
    </div>
  );
}

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
  const [daily, setDaily] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // μικρό “παράθυρο ενεργού refresh” μετά από συναλλαγή
  const activeRefreshUntil = useRef(0);

  // MetaMask account (αν δεν έρχεται ως prop)
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

  // (προαιρετικό) on-chain fallback μόνο για pendingBill
  async function fetchPendingOnChain(addr) {
    try {
      if (!addr || !window.ethereum || !ethers.isAddress(KWHTokenAddress)) return null;
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const t = new ethers.Contract(KWHTokenAddress, KWHTokenABI, signer);
      const details = await t.getUserDetails(addr);
      return details?.pendingBill?.toString?.() || details?.[2]?.toString?.() || "0";
    } catch { return null; }
  }

  const refetch = useCallback(async (addr = account) => {
    if (!addr) return;
    setLoading(true); setError("");
    try {
      const [sum, d, pendingFallback] = await Promise.all([
        getSummary(addr),
        getDaily(addr),
        fetchPendingOnChain(addr),
      ]);

      setSummary({
        kwh_total  : asNum(sum?.kwh_total   ?? sum?.totalKwh ?? sum?.total),
        kwh_prepaid: asNum(sum?.kwh_prepaid ?? sum?.prepaidKwh ?? sum?.prepaid),
        kwh_payg   : asNum(sum?.kwh_payg    ?? sum?.paygKwh ?? sum?.payg),
        pendingBill: String(
          (sum?.pendingBill ?? sum?.pendingWei ?? sum?.pending ?? "0") ||
          pendingFallback || "0"
        ),
      });

      const raw = Array.isArray(d) ? d : d?.daily || [];
      setDaily(normalizeDaily(raw, 30));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [account]);

  // αρχικό load / αλλαγή account
  useEffect(() => { if (account) refetch(account); }, [account, refetch]);

  // 1) γενικά app events
  useEffect(() => {
    let canceled = false;
    const onRefresh = () => {
      activeRefreshUntil.current = Date.now() + 45_000;
      refetch();
      setTimeout(() => { if (!canceled) refetch(); }, 1200);
    };
    window.addEventListener("kwh:refresh-analytics", onRefresh);
    window.addEventListener("tx:append", onRefresh);
    return () => {
      canceled = true;
      window.removeEventListener("kwh:refresh-analytics", onRefresh);
      window.removeEventListener("tx:append", onRefresh);
    };
  }, [refetch]);

  // 2) refresh by tx hash 
  useEffect(() => {
    const onTxHash = async (ev) => {
      const txHash = ev?.detail?.txHash || ev?.txHash || ev?.detail;
      if (!txHash || typeof txHash !== "string" || !txHash.startsWith("0x") || txHash.length !== 66) return;
      activeRefreshUntil.current = Date.now() + 45_000;
      try {
        if (!window.ethereum) return;
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.waitForTransaction(txHash, 1);
        await refetch();
        setTimeout(() => refetch(), 1200);
      } catch {}
    };
    window.addEventListener("kwh:tx-hash", onTxHash);
    return () => window.removeEventListener("kwh:tx-hash", onTxHash);
  }, [refetch]);

  // 3) block listener όσο είμαστε σε "active window"
  useEffect(() => {
    if (!window.ethereum) return;
    let alive = true;
    (async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        provider.on("block", async () => {
          if (!alive) return;
          if (Date.now() <= activeRefreshUntil.current) {
            await refetch();
          }
        });
      } catch {}
    })();
    return () => { alive = false; };
  }, [refetch]);

 
  useEffect(() => {
    if (!account) return;
    const id = setInterval(() => refetch(), 20_000);
    const onVis = () => !document.hidden && refetch();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [account, refetch]);

  
  useEffect(() => {
    if (!account) return;
    let es;
    try { es = openLiveSession(account, () => refetch(), () => {}); } catch {}
    return () => { try { es && es.close(); } catch {} };
  }, [account, refetch]);

  const today = daily.length ? daily[daily.length - 1] : { kwh_prepaid: 0, kwh_payg: 0 };
  const todayTotal = asNum(today.kwh_prepaid) + asNum(today.kwh_payg);

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
          <button className="btn ghost" onClick={() => { activeRefreshUntil.current = Date.now() + 45_000; refetch(); }} disabled={loading}>
            {loading ? "…" : "Refresh"}
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
        <MiniBars data={daily} />
      </div>
    </div>
  );
}
