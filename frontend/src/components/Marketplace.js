/* global BigInt */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";

import { MarketplaceAddress } from "../config";
import MarketplaceBuild from "../abi/MarketplaceABI.json";
import KWHTokenBuild from "../abi/KWHTokenABI.json";

const MarketplaceABI = MarketplaceBuild.abi ?? MarketplaceBuild;

// ✅ Ελάχιστο ERC-20 ABI που εγγυάται ότι υπάρχουν αυτές οι μέθοδοι
const ERC20_MIN_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

// Αν το δικό σου ABI είναι array, το ενώνουμε με το ελάχιστο ERC-20.
// Αλλιώς, χρησιμοποιούμε μόνο το ελάχιστο (σίγουρα δουλεύει).
const KWHTokenABI_RAW = KWHTokenBuild.abi ?? KWHTokenBuild;
const TOKEN_ABI = Array.isArray(KWHTokenABI_RAW)
  ? [...KWHTokenABI_RAW, ...ERC20_MIN_ABI]
  : ERC20_MIN_ABI;

/* ------------------------------- Provider hook ------------------------------ */
function useProvider() {
  return useMemo(
    () => (window.ethereum ? new ethers.BrowserProvider(window.ethereum) : null),
    []
  );
}

/* --------------------------------- Helpers --------------------------------- */
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
      const okCount = inCount == null || f.inputs?.length === inCount;
      const okUint = !inAllUint || f.inputs?.every((i) => isUintLike(i.type));
      const okPay = !payableOnly || f.stateMutability === "payable";
      const okNV = !nonViewOnly || !["view", "pure"].includes(f.stateMutability || "");
      if (okCount && okUint && okPay && okNV) return f;
    } catch {}
  }
  for (const frag of iface.fragments) {
    if (frag.type !== "function") continue;
    const okCount = inCount == null || frag.inputs?.length === inCount;
    const okUint = !inAllUint || frag.inputs?.every((i) => isUintLike(i.type));
    const okPay = !payableOnly || frag.stateMutability === "payable";
    const okNV = !nonViewOnly || !["view", "pure"].includes(frag.stateMutability || "");
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

/* -------------------------------- Component -------------------------------- */
export default function Marketplace({ account: propAccount }) {
  const provider = useProvider();

  const [account, setAccount] = useState("");
  const [connected, setConnected] = useState(false);

  const [market, setMarket] = useState(null);
  const [status, setStatus] = useState("");

  const [orders, setOrders] = useState([]);

  const [amountKwh, setAmountKwh] = useState("");
  const [pricePerKwhEth, setPricePerKwhEth] = useState("");

  // Token-related
  const [tokenAddr, setTokenAddr] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [tokenBal, setTokenBal] = useState(0n);
  const [tokenAllowance, setTokenAllowance] = useState(0n);

  const tokenContract = useMemo(() => {
    if (!provider || !ethers.isAddress(tokenAddr)) return null;
    // ✅ Χρησιμοποιούμε το TOKEN_ABI (KWHTokenABI + ERC20_MIN_ABI)
    return new ethers.Contract(tokenAddr, TOKEN_ABI, provider);
  }, [provider, tokenAddr]);

  const effectiveAccount = (propAccount || account || "").toLowerCase();
  const didInit = useRef(false);

  async function ensureConnected() {
    if (!window.ethereum) throw new Error("Απαιτείται MetaMask");
    const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
    const acc = accs?.[0] ?? "";
    setAccount(acc);
    setConnected(Boolean(acc));
    return acc;
  }

  /* ------------------------------ Initial load ----------------------------- */
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      try {
        if (!provider) return;

        if (!ethers.isAddress(MarketplaceAddress)) {
          setStatus(
            "Άκυρη διεύθυνση Marketplace. Διόρθωσε το REACT_APP_MARKET_ADDR και κάνε restart."
          );
          return;
        }

        const accs = await window.ethereum.request({ method: "eth_accounts" });
        const acc = accs?.[0] ?? "";
        setAccount(acc);
        setConnected(Boolean(acc));

        const m = new ethers.Contract(MarketplaceAddress, MarketplaceABI, provider);
        setMarket(m);

        const tAddr = await m.token();
        setTokenAddr(tAddr);

        const t = new ethers.Contract(tAddr, TOKEN_ABI, provider);
        let dec = 18;
        try {
          dec = Number(await t.decimals());
        } catch {}
        setTokenDecimals(dec);

        if (acc) await refreshTokenInfo(m, t, acc);
        await refreshOrders(m);

        const onAccounts = async (accs2) => {
          const a = accs2?.[0] || "";
          setAccount(a);
          setConnected(Boolean(a));
          await refreshTokenInfo(m, t, a);
          await refreshOrders(m);
        };
        const onChain = async () => {
          await refreshTokenInfo(m, t, account);
          await refreshOrders(m);
        };
        window.ethereum?.on?.("accountsChanged", onAccounts);
        window.ethereum?.on?.("chainChanged", onChain);

        return () => {
          window.ethereum?.removeListener?.("accountsChanged", onAccounts);
          window.ethereum?.removeListener?.("chainChanged", onChain);
        };
      } catch (e) {
        console.error(e);
        setStatus("Αποτυχία αρχικοποίησης (δες console).");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  /* ---------------------------- Token info refresh ------------------------- */
  async function refreshTokenInfo(m = market, t = tokenContract, acc = account) {
    if (!m || !t || !acc) return;
    try {
      const [bal, allw] = await Promise.all([
        t.balanceOf(acc),
        t.allowance(acc, MarketplaceAddress),
      ]);
      setTokenBal(ethers.toBigInt(bal ?? 0));
      setTokenAllowance(ethers.toBigInt(allw ?? 0));
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    (async () => {
      const acc = effectiveAccount;
      if (!acc) return;
      await refreshTokenInfo(market, tokenContract, acc);
    })();
  }, [effectiveAccount, tokenContract, tokenAddr, provider, market]);

  /* ------------------------------ Orders refresh --------------------------- */
  async function refreshOrders(contract = market) {
    if (!provider || !contract) return;
    try {
      setStatus("Φόρτωση αγγελιών…");

      const createdF = getEventFilter(contract, ["Listed", "OrderCreated", "Created"]);
      if (!createdF) {
        setOrders([]);
        setStatus("Δεν βρέθηκε event Listed στο ABI.");
        return;
      }

      const created = await contract.queryFilter(createdF, 0);
      const map = new Map();

      for (const ev of created) {
        const id = evArg(ev, 0)?.toString();
        const seller = evArg(ev, 1);
        const amount = ethers.toBigInt(evArg(ev, 2) ?? 0);
        const price = ethers.toBigInt(evArg(ev, 3) ?? 0);
        const expiry = Number(evArg(ev, 4) ?? 0);
        if (!id) continue;
        map.set(id, {
          id,
          seller,
          kwh: amount,
          remaining: amount,
          priceWeiPerKwh: price,
          expiry,
          canceled: false,
        });
      }

      const cancelledF = getEventFilter(contract, ["Cancelled", "OrderCancelled"]);
      if (cancelledF) {
        const cancelled = await contract.queryFilter(cancelledF, 0);
        for (const ev of cancelled) {
          const id = evArg(ev, 0)?.toString();
          if (id && map.has(id)) map.get(id).canceled = true;
        }
      }

      const purchasedF = getEventFilter(contract, ["Purchased", "OrderPurchased"]);
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

      const list = [...map.values()].filter((o) => !o.canceled && (o.remaining ?? 0n) > 0n);
      list.sort((a, b) => {
        const ax = BigInt(a.id);
        const bx = BigInt(b.id);
        return ax < bx ? -1 : ax > bx ? 1 : 0;
      });

      setOrders(list);
      setStatus(list.length ? "" : "Δεν υπάρχουν αγγελίες.");
    } catch (e) {
      console.error(e);
      setStatus("Σφάλμα στην ανάγνωση αγγελιών (δες console).");
    }
  }

  /* ------------------------------ Create listing --------------------------- */
  async function handleCreate(e) {
    e.preventDefault();
    try {
      if (!market) throw new Error("No marketplace");
      const acc = await ensureConnected();
      const signer = await provider.getSigner();

      const m = market.connect(signer);
      const t = tokenContract?.connect(signer);
      if (!t) throw new Error("Token contract missing");

      const amountUnits = ethers.parseUnits((amountKwh || "0").toString(), tokenDecimals);
      const pWei = ethers.parseEther(pricePerKwhEth || "0");
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600);

      if (amountUnits <= 0n || pWei <= 0n) {
        setStatus("Συμπλήρωσε ποσότητα & τιμή > 0.");
        return;
      }

      const bal = await t.balanceOf(acc);
      if (ethers.toBigInt(bal) < amountUnits) {
        setStatus(
          `Δεν έχεις αρκετά KWH. Υπόλοιπο: ${ethers.formatUnits(bal, tokenDecimals)} kWh`
        );
        return;
      }

      // ✅ auto-approve αν χρειάζεται
      const currAllw = await t.allowance(acc, MarketplaceAddress);
      if (ethers.toBigInt(currAllw) < amountUnits) {
        setStatus("Έγκριση (approve) token…");
        const txA = await t.approve(MarketplaceAddress, amountUnits);
        await txA.wait();
        await refreshTokenInfo(m, tokenContract, acc);
      }

      const frag = findFuncByShape(m, {
        names: ["list", "create", "listOrder", "createListing"],
        inCount: 3,
        inAllUint: true,
        nonViewOnly: true,
      });
      if (!frag) throw new Error("Δεν βρέθηκε list(amount, priceWeiPerKwh, expiry) στο ABI.");

      setStatus(`Δημιουργία… (call: ${frag.name})`);
      const tx = await m[frag.name](amountUnits, pWei, expiry);
      await tx.wait();

      setAmountKwh("");
      setPricePerKwhEth("");
      await refreshOrders(m);
      await refreshTokenInfo(m, tokenContract, acc);
      setStatus("Η αγγελία δημιουργήθηκε.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία δημιουργίας (δες console). Συνήθης λόγος: δεν έχει γίνει approve.");
    }
  }

  /* --------------------------------- Cancel -------------------------------- */
  async function handleCancel(id) {
    try {
      if (!market) return;
      const signer = await provider.getSigner();
      const m = market.connect(signer);

      const frag = findFuncByShape(m, {
        names: ["cancel", "cancelOrder"],
        inCount: 1,
        inAllUint: true,
        nonViewOnly: true,
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

  /* ----------------------------------- Buy --------------------------------- */
  async function handleBuy(o) {
    try {
      if (!market) return;
      const signer = await provider.getSigner();
      const m = market.connect(signer);

      const frag = findFuncByShape(m, {
        names: ["purchase", "buy"],
        inCount: 2,
        inAllUint: true,
        payableOnly: true,
        nonViewOnly: true,
      });
      if (!frag) throw new Error("Δεν βρέθηκε purchase(id, amount) στο ABI.");

      const amount = ethers.toBigInt(o.remaining ?? o.kwh);
      if (amount <= 0n) {
        setStatus("Μηδενική ποσότητα.");
        return;
      }

      let total = 0n;
      const denom = 10n ** BigInt(tokenDecimals);
      try {
        const q = await m.quoteCost(amount, o.priceWeiPerKwh);
        total = ethers.toBigInt(q ?? 0);
      } catch {
        total = (o.priceWeiPerKwh * amount + (denom - 1n)) / denom;
      }
      if (total <= 0n) {
        setStatus("Μηδενικό κόστος υπολογίστηκε, έλεγχος τιμών.");
        return;
      }

      setStatus(`Αγορά… (call: ${frag.name})`);
      try {
        const tx = await m[frag.name](o.id, amount, { value: total });
        await tx.wait();
      } catch {
        const tx = await m[frag.name](o.id, amount, { value: total + 1n });
        await tx.wait();
      }

      await refreshOrders(m);
      setStatus("Ολοκληρώθηκε η αγορά.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία αγοράς (δες console).");
    }
  }

  /* --------------------------------- UI utils ------------------------------- */
  const fmtETH = (wei) => {
    try { return `${ethers.formatEther(wei)} ETH`; } catch { return "—"; }
  };
  const fmtKWH = (u) => {
    try { return `${ethers.formatUnits(u ?? 0n, tokenDecimals)} kWh`; }
    catch { return `${u?.toString?.() ?? "0"} kWh`; }
  };

  /* ---------------------------------- Render -------------------------------- */
  return (
    <section style={{ padding: 16, border: "1px solid #eee", borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>P2P Marketplace</h3>

      {!connected && (
        <button onClick={ensureConnected} style={{ marginBottom: 12 }}>
          Σύνδεση πορτοφολιού
        </button>
      )}

      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>
        <div>
          Token: {tokenAddr ? `${tokenAddr.slice(0, 6)}…${tokenAddr.slice(-4)}` : "—"} (decimals {tokenDecimals})
        </div>
        <div>
          Υπόλοιπο: {fmtKWH(tokenBal)} — Allowance προς Marketplace: {fmtKWH(tokenAllowance)}
        </div>
      </div>

      {/* Create listing: ONE button (auto-approve αν χρειάζεται) */}
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
            const denom = 10n ** BigInt(tokenDecimals);
            const naiveTotal = (o.priceWeiPerKwh * (o.remaining ?? 0n) + (denom - 1n)) / denom;
            const isSeller = effectiveAccount === (o.seller || "").toLowerCase();
            // ✅ πιο σταθερό key για να φύγουν τα duplicate key warnings
            const rowKey = `${o.id}-${o.seller}-${o.remaining?.toString?.() ?? ""}`;
            return (
              <tr key={rowKey} style={{ borderTop: "1px solid #eee" }}>
                <td>{o.id}</td>
                <td title={o.seller}>{o.seller?.slice(0, 6)}…{o.seller?.slice(-4)}</td>
                <td>{fmtKWH(o.remaining)}</td>
                <td>{fmtETH(o.priceWeiPerKwh)}</td>
                <td>{fmtETH(naiveTotal)}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  {isSeller ? (
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
