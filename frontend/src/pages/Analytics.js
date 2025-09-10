// src/pages/Analytics.js
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { getSummary, getDaily } from "../api/analyticsApi";

/* ====== helpers ====== */
const asNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ====== Μικρό stacked bar chart (PREPAID + PAYG) με ποσότητες ====== */
function MiniBars({ data }) {
  const width = 900;
  const height = 260;
  const pad = 24;
  const gap = 4;

  const fmt = (v) => {
    const n = Number(v) || 0;
    return Math.abs(n) >= 10 ? Math.round(n).toString() : n.toFixed(1);
  };

  const bars = useMemo(() => {
    const arr = Array.isArray(data) ? data : [];
    if (!arr.length) return [];

    const norm = arr.map((d) => {
      const prepaid = asNum(d.prepaid ?? d.kwh_prepaid ?? 0);
      const payg = asNum(d.payg ?? d.kwh_payg ?? 0);
      const day = d.day ?? d.day_key ?? "";
      return { prepaid, payg, day: String(day), total: prepaid + payg };
    });

    const totals = norm.map((x) => x.total);
    const safe = totals.filter(Number.isFinite);
    const max = Math.max(1, ...(safe.length ? safe : [0])); // ποτέ 0 για κλίμακα

    const innerH = height - pad * 2;
    const innerW = width - pad * 2;
    const bw = Math.max(6, Math.floor(innerW / norm.length) - gap);

    return norm.map((d, i) => {
      const hP = (d.prepaid / max) * innerH;
      const hY = (d.payg / max) * innerH;
      const x = pad + i * (bw + gap);
      const yP = height - pad - hP;
      const yY = yP - hY;
      return {
        ...d,
        x,
        bw,
        hP,
        hY,
        yP,
        yY,
        label: d.day ? d.day.slice(5) : "", // MM-DD
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

      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="kWh ανά μέρα, PREPAID και PAYG"
      >
        {/* άξονας */}
        <line x1={pad} y1={axisY} x2={width - pad} y2={axisY} stroke="#ddd" />

        {bars.map((b, idx) => (
          <g key={idx}>
            {/* PREPAID */}
            <rect
              x={b.x}
              y={b.yP}
              width={b.bw}
              height={Math.max(0, b.hP)}
              fill="#4c9"
              stroke="#2b6"
              strokeWidth="0.5"
            >
              <title>{`${b.day}\nPREPAID: ${fmt(b.prepaid)} kWh\nPAYG: ${fmt(
                b.payg
              )} kWh\nΣύνολο: ${fmt(b.total)} kWh`}</title>
            </rect>

            {/* PAYG πάνω από PREPAID */}
            <rect
              x={b.x}
              y={b.yY}
              width={b.bw}
              height={Math.max(0, b.hY)}
              fill="#89a"
              stroke="#667"
              strokeWidth="0.5"
            >
              <title>{`${b.day}\nPREPAID: ${fmt(b.prepaid)} kWh\nPAYG: ${fmt(
                b.payg
              )} kWh\nΣύνολο: ${fmt(b.total)} kWh`}</title>
            </rect>

            {/* Σύνολο πάνω από το stack */}
            {b.total > 0 && (
              <text
                x={b.x + b.bw / 2}
                y={Math.min(b.yY, b.yP) - 4}
                fontSize="10"
                textAnchor="middle"
                fill="#333"
              >
                {fmt(b.total)}
              </text>
            )}

            {/* Προαιρετικά: ποσότητες μέσα στα segments όταν «χωράνε» */}
            {b.hP > 16 && (
              <text x={b.x + 3} y={b.yP + 12} fontSize="9" fill="#033">
                {fmt(b.prepaid)}
              </text>
            )}
            {b.hY > 16 && (
              <text x={b.x + 3} y={b.yY + 12} fontSize="9" fill="#112">
                {fmt(b.payg)}
              </text>
            )}

            {/* ticks ημερομηνίας ανά ~4 bars */}
            {idx % 4 === 0 && (
              <text x={b.x} y={axisY + 12} fontSize="9" fill="#666">
                {b.label}
              </text>
            )}
          </g>
        ))}

        <text x={pad} y={14} fontSize="12" fill="#333">
          PREPAID (μπλε-πράσινο) + PAYG (γκρι-μπλε)
        </text>
      </svg>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
      <div style={{ fontSize: 22 }}>{value}</div>
    </div>
  );
}

export default function Analytics({ accountProp }) {
  const [account, setAccount] = useState(accountProp || "");
  const [summary, setSummary] = useState({
    kwh_total: 0,
    kwh_prepaid: 0,
    kwh_payg: 0,
    pendingBill: "0",
  });
  const [daily, setDaily] = useState([]); // πάντα array
  const [loading, setLoading] = useState(false);

  // πάρε account από MetaMask
  useEffect(() => {
    if (accountProp) return;
    (async () => {
      if (!window.ethereum) return;
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.ready;
      const accs = await window.ethereum.request({ method: "eth_accounts" });
      setAccount(accs?.[0] || "");
      window.ethereum.on?.("accountsChanged", (a) =>
        setAccount(a?.[0] || "")
      );
    })();
  }, [accountProp]);

  // polling: 10s + refresh όταν γίνει ορατό το tab
  useEffect(() => {
    if (!account) return;
    let stop = false;

    const load = async () => {
      try {
        setLoading(true);
        const [sum, d] = await Promise.all([getSummary(account), getDaily(account)]);
        if (!stop) {
          setSummary(sum || {});
          const arr = Array.isArray(d) ? d : d?.daily || [];
          setDaily(arr);
        }
      } finally {
        if (!stop) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, 10000);
    const onVis = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [account]);

  // μετασχηματισμός για chart
  const chartData = useMemo(() => {
    const arr = Array.isArray(daily) ? daily : [];
    return arr.map((d) => ({
      day: d.day ?? d.day_key,
      prepaid: asNum(d.kwh_prepaid),
      payg: asNum(d.kwh_payg),
    }));
  }, [daily]);

  if (!account) {
    return (
      <div style={{ maxWidth: 960, margin: "24px auto", padding: 16 }}>
        <h2>Στατιστικά</h2>
        <p>Σύνδεσε το πορτοφόλι σου για να δεις αυτόματα τα δεδομένα.</p>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "24px auto",
        padding: "0 16px",
        fontFamily: "system-ui, Arial",
      }}
    >
      <h2 style={{ marginTop: 0 }}>Στατιστικά</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Card title="Σύνολο kWh (30d)" value={summary.kwh_total ?? 0} />
        <Card title="PREPAID kWh (30d)" value={summary.kwh_prepaid ?? 0} />
        <Card title="PAYG kWh (30d)" value={summary.kwh_payg ?? 0} />
        <Card
          title="Εκκρεμής οφειλή"
          value={`${ethers.formatEther(summary.pendingBill || "0")} ETH`}
        />
      </div>

      <section
        style={{
          border: "1px solid #eee",
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          kWh ανά μέρα (PREPAID vs PAYG)
        </div>
        <MiniBars data={chartData} />
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Τελευταίες προσομοιώσεις
        </div>
        <div style={{ opacity: 0.7, padding: 8 }}>Δεν υπάρχουν ακόμη δεδομένα.</div>
      </section>
    </div>
  );
}
