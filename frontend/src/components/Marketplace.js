/* global BigInt */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";

import { MarketplaceAddress } from "../config";
import MarketplaceBuild from "../abi/MarketplaceABI.json";
import KWHTokenBuild from "../abi/KWHTokenABI.json";

const MarketplaceABI = MarketplaceBuild.abi ?? MarketplaceBuild;
const KWHTokenABI    = KWHTokenBuild.abi ?? KWHTokenBuild;

/* ---------- Provider ---------- */
function useProvider() {
  return useMemo(() => {
    if (!window.ethereum) return null;
    return new ethers.BrowserProvider(window.ethereum);
  }, []);
}

/* ---------- ABI helpers ---------- */
const isUintLike = (t) => /^(u?int)(\d+)?$/i.test(t || "");

function findFuncByShape(
  contract,
  { names = [], inCount, inAllUint = false, payableOnly = false, nonViewOnly = true }
) {
  const iface = contract.interface;
  for (const n of names) {
    try {
      const f = iface.getFunction(n);
      if (!f) continue;
      const okCount = inCount == null || (f.inputs?.length === inCount);
      const okUint  = !inAllUint || f.inputs?.every((i) => isUintLike(i.type));
      const okPay   = !payableOnly || f.stateMutability === "payable";
      const okNV    = !nonViewOnly || !["view","pure"].includes(f.stateMutability || "");
      if (okCount && okUint && okPay && okNV) return f;
    } catch {}
  }
  for (const frag of iface.fragments) {
    if (frag.type !== "function") continue;
    const okCount = inCount == null || (frag.inputs?.length === inCount);
    const okUint  = !inAllUint || frag.inputs?.every((i) => isUintLike(i.type));
    const okPay   = !payableOnly || frag.stateMutability === "payable";
    const okNV    = !nonViewOnly || !["view","pure"].includes(frag.stateMutability || "");
    if (okCount && okUint && okPay && okNV) return frag;
  }
  return null;
}

function getEventFilter(contract, names) {
  for (const n of names) {
    const f = contract?.filters?.[n];
    if (typeof f === "function") return f();
  }
  return null;
}

const evArg = (ev, idx) => (ev?.args ? ev.args[idx] : undefined);

/* ---------- Component ---------- */
export default function Marketplace() {
  const provider = useProvider();

  const [account, setAccount]         = useState("");
  const [connected, setConnected]     = useState(false);

  const [market, setMarket]           = useState(null);
  const [status, setStatus]           = useState("");

  const [orders, setOrders]           = useState([]);

  const [amountKwh, setAmountKwh]     = useState("");
  const [pricePerKwhEth, setPricePerKwhEth] = useState("");

  // Token-related
  const [tokenAddr, setTokenAddr]     = useState("");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [tokenBal, setTokenBal]       = useState(0n);
  const [tokenAllowance, setTokenAllowance] = useState(0n);

  const tokenContract = useMemo(() => {
    if (!provider || !ethers.isAddress(tokenAddr)) return null;
    return new ethers.Contract(tokenAddr, KWHTokenABI, provider);
  }, [provider, tokenAddr]);

  const didInit = useRef(false);

  async function ensureConnected() {
    if (!window.ethereum) throw new Error("Απαιτείται MetaMask");
    const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
    const acc  = accs?.[0] ?? "";
    setAccount(acc);
    setConnected(Boolean(acc));
    return acc;
  }

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      try {
        if (!provider) return;

        if (!ethers.isAddress(MarketplaceAddress)) {
          setStatus("Άκυρη διεύθυνση Marketplace. Διόρθωσε το REACT_APP_MARKET_ADDR και κάνε restart.");
          return;
        }

        const accs = await window.ethereum.request({ method: "eth_accounts" });
        const acc  = accs?.[0] ?? "";
        setAccount(acc);
        setConnected(Boolean(acc));

        const m = new ethers.Contract(MarketplaceAddress, MarketplaceABI, provider);
        setMarket(m);

        // Διαβάζουμε το token από το συμβόλαιο marketplace
        const tAddr = await m.token();
        setTokenAddr(tAddr);

        const t = new ethers.Contract(tAddr, KWHTokenABI, provider);
        let dec = 18;
        try { dec = Number(await t.decimals()); } catch {}
        setTokenDecimals(dec);

        await refreshTokenInfo(m, t, acc);
        await refreshOrders(m);

        window.ethereum.on?.("accountsChanged", async (accs2) => {
          const a = accs2?.[0] || "";
          setAccount(a);
          setConnected(Boolean(a));
          await refreshTokenInfo(m, t, a);
          await refreshOrders(m);
        });
        window.ethereum.on?.("chainChanged", async () => {
          await refreshTokenInfo(m, t, account);
          await refreshOrders(m);
        });
      } catch (e) {
        console.error(e);
        setStatus("Αποτυχία αρχικοποίησης (δες console).");
      }
    })();
  }, [provider, account]);

  async function refreshTokenInfo(m = market, t = tokenContract, acc = account) {
    if (!m || !t || !acc) return;
    try {
      const [bal, allw] = await Promise.all([
        t.balanceOf(acc),
        t.allowance(acc, MarketplaceAddress),
      ]);
      setTokenBal(bal);
      setTokenAllowance(allw);
    } catch (e) {
      console.error(e);
    }
  }

  /* ----------- Orders (events) ----------- */
  async function refreshOrders(contract = market) {
    if (!provider || !contract) return;
    try {
      setStatus("Φόρτωση αγγελιών…");

      const createdF = getEventFilter(contract, ["Listed"]);
      if (!createdF) {
        setOrders([]);
        setStatus("Δεν βρέθηκε event Listed στο ABI.");
        return;
      }

      const created = await contract.queryFilter(createdF, 0);
      const map = new Map();

      for (const ev of created) {
        const id     = evArg(ev, 0)?.toString();
        const seller = evArg(ev, 1);
        const amount = ethers.toBigInt(evArg(ev, 2) ?? 0);           // σε token units
        const price  = ethers.toBigInt(evArg(ev, 3) ?? 0);           // wei / kWh
        const expiry = Number(evArg(ev, 4) ?? 0);
        if (!id) continue;

        map.set(id, { id, seller, kwh: amount, remaining: amount, priceWeiPerKwh: price, expiry, canceled:false });
      }

      const cancelledF = getEventFilter(contract, ["Cancelled"]);
      if (cancelledF) {
        const cancelled = await contract.queryFilter(cancelledF, 0);
        for (const ev of cancelled) {
          const id = evArg(ev, 0)?.toString();
          if (id && map.has(id)) map.get(id).canceled = true;
        }
      }

      const purchasedF = getEventFilter(contract, ["Purchased"]);
      if (purchasedF) {
        const purchased = await contract.queryFilter(purchasedF, 0);
        for (const ev of purchased) {
          const id = evArg(ev, 0)?.toString();
          const amount = ethers.toBigInt(evArg(ev, 2) ?? 0);
          if (id && map.has(id)) {
            const o = map.get(id);
            o.remaining = (o.remaining ?? 0n) - amount;
          }
        }
      }

      const list = [...map.values()].filter(o => !o.canceled && (o.remaining ?? 0n) > 0n);
      list.sort((a,b) => BigInt(a.id) - BigInt(b.id));
      setOrders(list);
      setStatus(list.length ? "" : "Δεν υπάρχουν αγγελίες.");
    } catch (e) {
      console.error(e);
      setStatus("Σφάλμα στην ανάγνωση αγγελιών (δες console).");
    }
  }

  /* ----------- Create (list) ----------- */
  async function handleCreate(e) {
    e.preventDefault();
    try {
      if (!market) throw new Error("No marketplace");
      await ensureConnected();

      const signer = await provider.getSigner();
      const m = market.connect(signer);

      const frag = findFuncByShape(m, {
        names: ["list", "create", "listOrder", "createListing"],
        inCount: 3, inAllUint: true, nonViewOnly: true,
      });
      if (!frag) throw new Error("Δεν βρέθηκε list(amount, priceWeiPerKwh, expiry) στο ABI.");

      // ΠΟΣΟΤΗΤΑ σε token units με βάση τα decimals
      const amountUnits = ethers.parseUnits((amountKwh || "0").toString(), tokenDecimals);
      const pWei        = ethers.parseEther(pricePerKwhEth || "0");
      const expiry      = BigInt(Math.floor(Date.now()/1000) + 7*24*3600);

      if (amountUnits <= 0n || pWei <= 0n) {
        setStatus("Συμπλήρωσε ποσότητα & τιμή > 0.");
        return;
      }

      // Έλεγχος υπολοίπου
      if (tokenBal < amountUnits) {
        setStatus(`Δεν έχεις αρκετά KWH. Υπόλοιπο: ${ethers.formatUnits(tokenBal, tokenDecimals)} kWh`);
        return;
      }

      // Έλεγχος allowance -> approve αν χρειάζεται
      if (tokenAllowance < amountUnits) {
        setStatus("Έγκριση (approve) token…");
        const tSigner = tokenContract.connect(signer);
        const txA = await tSigner.approve(MarketplaceAddress, amountUnits);
        await txA.wait();
        await refreshTokenInfo(m, tokenContract, account);
      }

      setStatus(`Δημιουργία… (call: ${frag.name})`);
      const tx = await m[frag.name](amountUnits, pWei, expiry);
      await tx.wait();

      setAmountKwh("");
      setPricePerKwhEth("");
      await refreshOrders(m);
      await refreshTokenInfo(m, tokenContract, account);
      setStatus("Η αγγελία δημιουργήθηκε.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία δημιουργίας (δες console).");
    }
  }

  /* ----------- Cancel ----------- */
  async function handleCancel(id) {
    try {
      if (!market) return;
      const signer = await provider.getSigner();
      const m = market.connect(signer);

      const frag = findFuncByShape(m, {
        names: ["cancel", "cancelOrder"],
        inCount: 1, inAllUint: true, nonViewOnly: true,
      });
      if (!frag) throw new Error("Δεν βρέθηκε cancel(id) στο ABI.");

      setStatus(`Ακύρωση… (call: ${frag.name})`);
      const tx = await m[frag.name](id);
      await tx.wait();
      await refreshOrders(m);
      setStatus("Η αγγελία ακυρώθηκε.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία ακύρωσης (δες console).");
    }
  }

  /* ----------- Buy ----------- */
  async function handleBuy(o) {
    try {
      if (!market) return;
      const signer = await provider.getSigner();
      const m = market.connect(signer);

      const frag = findFuncByShape(m, {
        names: ["purchase"],
        inCount: 2, inAllUint: true, payableOnly: true, nonViewOnly: true,
      });
      if (!frag) throw new Error("Δεν βρέθηκε purchase(id, amount).");

      const amount = o.remaining ?? o.kwh;
      const total  = await m.quoteCost(amount, o.priceWeiPerKwh);

      setStatus(`Αγορά… (call: ${frag.name})`);
      const tx = await m[frag.name](o.id, amount, { value: total });
      await tx.wait();

      await refreshOrders(m);
      setStatus("Ολοκληρώθηκε η αγορά.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία αγοράς (δες console).");
    }
  }

  const fmtETH = (wei) => {
    try { return `${ethers.formatEther(wei)} ETH`; } catch { return "—"; }
  };
  const fmtKWH = (u) => {
    try { return `${ethers.formatUnits(u ?? 0n, tokenDecimals)} kWh`; } catch { return `${u?.toString()}`; }
  };

  return (
    <section style={{ padding: 16, border: "1px solid #eee", borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>P2P Marketplace</h3>

      {!connected && (
        <button onClick={ensureConnected} style={{ marginBottom: 12 }}>
          Σύνδεση πορτοφολιού
        </button>
      )}

      {/* Token info */}
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>
        <div>Token: {tokenAddr ? `${tokenAddr.slice(0,6)}…${tokenAddr.slice(-4)}` : "—"} (decimals {tokenDecimals})</div>
        <div>Υπόλοιπο: {fmtKWH(tokenBal)} — Allowance προς Marketplace: {fmtKWH(tokenAllowance)}</div>
      </div>

      <form
        onSubmit={handleCreate}
        style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}
      >
        <label>
          Ποσότητα (kWh):{" "}
          <input
            type="number"
            min="1"
            step="1"
            value={amountKwh}
            onChange={(e) => setAmountKwh(e.target.value)}
            style={{ width: 120 }}
          />
        </label>

        <label>
          Τιμή / kWh (ETH):{" "}
          <input
            type="number"
            min="0"
            step="0.000000000000000001"
            value={pricePerKwhEth}
            onChange={(e) => setPricePerKwhEth(e.target.value)}
            style={{ width: 160 }}
          />
        </label>

        <button type="submit">Δημιούργησε αγγελία</button>
      </form>

      <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
        <thead style={{ textAlign: "left", opacity: 0.7 }}>
          <tr>
            <th>ID</th>
            <th>Πωλητής</th>
            <th>Υπόλοιπο</th>
            <th>Τιμή / kWh</th>
            <th>Σύνολο (αν αγοραστεί όλο)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            // Προαιρετικά θα μπορούσαμε να καλέσουμε quoteCost για ακριβές σύνολο
            const naiveTotal = o.remaining * o.priceWeiPerKwh; // μπορεί να είναι υπερεκτίμηση αν amount έχει decimals
            return (
              <tr key={o.id} style={{ borderTop: "1px solid #eee" }}>
                <td>{o.id}</td>
                <td title={o.seller}>{o.seller?.slice(0, 6)}…{o.seller?.slice(-4)}</td>
                <td>{fmtKWH(o.remaining)}</td>
                <td>{fmtETH(o.priceWeiPerKwh)}</td>
                <td>{fmtETH(naiveTotal)}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  {account?.toLowerCase() === o.seller?.toLowerCase() ? (
                    <button onClick={() => handleCancel(o.id)}>Cancel</button>
                  ) : (
                    <button onClick={() => handleBuy(o)}>Αγορά</button>
                  )}
                </td>
              </tr>
            );
          })}
          {!orders.length && (
            <tr>
              <td colSpan="6" style={{ padding: 8, opacity: 0.7 }}>
                Δεν υπάρχουν αγγελίες.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 10, color: "#444" }}>{status}</div>
    </section>
  );
}
