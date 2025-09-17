// src/pages/DApp.js
/* eslint-env es2020 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import "../App.css";

// Components
import Marketplace from "../components/Marketplace";
import TxFeed from "../components/TxFeed";

// Διευθύνσεις & debug
import {
  KWHTokenAddress,
  EnergyBillingAddress,
  printEnvDebug,
} from "../config";

// ABI imports
import KWHTokenBuild from "../abi/KWHTokenABI.json";
import EnergyBillingBuild from "../abi/EnergyBillingABI.json";

const KWHTokenABI = KWHTokenBuild.abi ?? KWHTokenBuild;
const EnergyBillingABI = EnergyBillingBuild.abi ?? EnergyBillingBuild;

const BILL_PM = { UNSET: 0, PREPAID: 1, PAYG: 2 };
const TOKEN_PM = { PREPAID: 0, PAYG: 1 };

const toBillEnum = (s) => (s === "payg" ? BILL_PM.PAYG : BILL_PM.PREPAID);
const toTokenEnum = (s) => (s === "payg" ? TOKEN_PM.PAYG : TOKEN_PM.PREPAID);
const fromBillEnum = (n) =>
  n === BILL_PM.PAYG ? "payg" : n === BILL_PM.PREPAID ? "prepaid" : "unset";

export default function DApp() {
  // Wallet / network
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");

  // Contracts
  const [tokenC, setTokenC] = useState(null);
  const [billingC, setBillingC] = useState(null);

  // Prices & balances
  const [fixedPriceWei, setFixedPriceWei] = useState(null);
  const [fluctPriceWei, setFluctPriceWei] = useState(null);
  const [fluctSecondsLeft, setFluctSecondsLeft] = useState(0);
  const [kwhDecimals, setKwhDecimals] = useState(18);
  const [kwhBalance, setKwhBalance] = useState("0");
  const [kwhBalanceUnits, setKwhBalanceUnits] = useState(0n); // raw BigInt balance

  // Billing state
  const [billingModel, setBillingModel] = useState("unset");
  const [pendingBillWei, setPendingBillWei] = useState("0");
  const [pendingConsumption, setPendingConsumption] = useState("0");

  // UI
  const [prepaidKwhInput, setPrepaidKwhInput] = useState("");
  const [status, setStatus] = useState("");

  // Guards
  const didInit = useRef(false);
  const isRequesting = useRef(false);

  // Provider
  const provider = useMemo(
    () => (window.ethereum ? new ethers.BrowserProvider(window.ethereum) : null),
    []
  );
  async function getSigner() {
    if (!provider) throw new Error("MetaMask not found");
    return provider.getSigner();
  }

  function fmtETH(v) {
    try {
      return `${ethers.formatEther(v ?? 0)} ETH`;
    } catch {
      try {
        return `${ethers.formatEther(BigInt(v ?? 0))} ETH`;
      } catch {
        return "—";
      }
    }
  }
  function fmtKWHUnits(units, decimals) {
    try {
      const s = ethers.formatUnits(units ?? 0n, decimals ?? 18);
      return s.includes(".") ? s.split(".")[0] : s;
    } catch {
      return "0";
    }
  }

  // Init
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      printEnvDebug();
      if (!window.ethereum || !provider) return;

      try {
        const accs = await window.ethereum.request({ method: "eth_accounts" });
        const acc = accs?.[0] ?? "";
        setAccount(acc);

        const net = await provider.getNetwork();
        setChainId(`0x${net.chainId.toString(16)}`);

        const signer = await getSigner();
        const t = new ethers.Contract(KWHTokenAddress, KWHTokenABI, signer);
        const b = new ethers.Contract(EnergyBillingAddress, EnergyBillingABI, signer);
        setTokenC(t);
        setBillingC(b);

        await refreshAll(acc, t, b);

        const onTransfer = (from, to) => {
          if (!acc) return;
          if (
            from?.toLowerCase() === acc.toLowerCase() ||
            to?.toLowerCase() === acc.toLowerCase()
          ) {
            refreshAll(acc, t, b);
          }
        };
        t.on("Transfer", onTransfer);

        window.ethereum.on?.("accountsChanged", async (accs2) => {
          const a = accs2?.[0] || "";
          setAccount(a);
          await refreshAll(a, t, b);
        });
        window.ethereum.on?.("chainChanged", async () => {
          const net2 = await provider.getNetwork();
          setChainId(`0x${net2.chainId.toString(16)}`);
          await refreshAll(account, t, b);
        });

        return () => {
          try { t.off("Transfer", onTransfer); } catch {}
        };
      } catch (e) {
        console.error(e);
        setStatus("Αποτυχία αρχικοποίησης (δες console).");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  async function connectWallet() {
    if (!window.ethereum) return alert("Χρειάζεται MetaMask");
    if (isRequesting.current) return;
    isRequesting.current = true;
    try {
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      const acc = accs?.[0] ?? "";
      setAccount(acc);

      const signer = await getSigner();
      const t = tokenC ?? new ethers.Contract(KWHTokenAddress, KWHTokenABI, signer);
      const b = billingC ?? new ethers.Contract(EnergyBillingAddress, EnergyBillingABI, signer);
      setTokenC(t);
      setBillingC(b);
      if (acc) await refreshAll(acc, t, b);
    } catch (e) {
      console.error(e);
    } finally {
      isRequesting.current = false;
    }
  }

  // Reads
  async function refreshAll(user, t = tokenC, b = billingC) {
    if (!user || !t || !b) return;
    try {
      setStatus("Φόρτωση…");

      const [fx, flDyn, secsLeft] = await Promise.all([
        t.fixedPricePerKWH(),
        t.currentFluctuatingPricePerKWH(),
        t.secondsUntilNextFluct(),
      ]);
      setFixedPriceWei(fx);
      setFluctPriceWei(flDyn);
      setFluctSecondsLeft(Number(secsLeft));

      let dec = 18;
      try { dec = Number(await t.decimals()); } catch {}
      setKwhDecimals(dec);

      const bal = await t.balanceOf(user);
      setKwhBalanceUnits(bal);
      setKwhBalance(fmtKWHUnits(bal, dec));

      const billModelEnum = await b.getModel(user);
      setBillingModel(fromBillEnum(Number(billModelEnum)));

      const details = await t.getUserDetails(user);
      const pb =
        details?.pendingBill?.toString?.() ||
        details?.[2]?.toString?.() ||
        "0";
      setPendingBillWei(pb);

      const urec = await b.users(user);
      setPendingConsumption(urec?.pendingConsumption?.toString?.() || "0");

      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Σφάλμα ανάγνωσης (δες console).");
    }
  }

  // countdown για τη fluctuating τιμή
  useEffect(() => {
    if (!account || !tokenC || !billingC) return;
    const id = setInterval(() => {
      setFluctSecondsLeft((s) => {
        if (s > 1) return s - 1;
        refreshAll(account);
        return 0;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, tokenC, billingC]);

  // Αλλαγή μοντέλου
  async function changeModel(nextStr) {
    if (!billingC || !account) return;
    try {
      setStatus("Αλλαγή μοντέλου…");

      const currentEnum = Number(await billingC.getModel(account));
      const nextBillEnum = toBillEnum(nextStr);

      if (currentEnum === nextBillEnum) {
        setStatus("Ήδη στο ζητούμενο μοντέλο.");
        return;
      }

      if (currentEnum === BILL_PM.UNSET) {
        const tx = await billingC.setModel(nextBillEnum);
        await tx.wait();
      } else {
        const tx = await billingC.changeModel(nextBillEnum);
        await tx.wait();
      }

      try {
        if (tokenC) {
          const tokenEnum = toTokenEnum(nextStr);
          const tx2 = await tokenC.registerUser(tokenEnum);
          await tx2.wait();
        }
      } catch (_) {}

      await refreshAll(account);
      setStatus("Έγινε.");
    } catch (e) {
      console.error(e);
      const msg = String(e?.message || "").toLowerCase();
      if (msg.includes("outstanding consumption")) {
        setStatus("Δεν μπορείς να αλλάξεις από PAYG όσο υπάρχει ανεξόφλητη κατανάλωση.");
      } else if (msg.includes("already set")) {
        setStatus("Το μοντέλο έχει ήδη οριστεί· χρησιμοποίησε αλλαγή (changeModel).");
      } else {
        setStatus("Αποτυχία αλλαγής μοντέλου (δες console).");
      }
    }
  }

  // Prepaid αγορά
  async function handlePrepaidBuy(e) {
    e.preventDefault();
    if (!tokenC || !fixedPriceWei || !prepaidKwhInput) return;
    try {
      setStatus("Αγορά…");

      const kwhInt = Math.max(0, Math.floor(Number(prepaidKwhInput || "0")));
      if (!kwhInt) {
        setStatus("Δώσε ακέραιο πλήθος kWh > 0.");
        return;
      }

      const kwhUnits = ethers.parseUnits(String(kwhInt), 0);
      const totalWei = kwhUnits * fixedPriceWei;

      const tx = await tokenC.buyTokens({ value: totalWei });
      await provider.waitForTransaction(tx.hash, 1);

      setPrepaidKwhInput("");
      await refreshAll(account);
      // ενημέρωσε Analytics
      window.dispatchEvent(new CustomEvent("kwh:refresh-analytics"));

      setStatus("ΟΚ.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία αγοράς (δες console).");
    }
  }

  // Προσομοίωση (PREPAID & PAYG)
  async function handleSimulateConsumption() {
    if (!tokenC) return;
    try {
      setStatus("Προσομοίωση…");
      const tx = await tokenC.simulateConsumption();
      await provider.waitForTransaction(tx.hash, 1);
      await refreshAll(account);
      // ενημέρωσε Analytics
      window.dispatchEvent(new CustomEvent("kwh:refresh-analytics"));

      setStatus("Έγινε.");
    } catch (e) {
      console.error(e);
      setStatus("Η προσομοίωση απέτυχε (δες console).");
    }
  }

  // Πληρωμή λογαριασμού
  async function handlePayBill() {
    if (!tokenC) return;
    if (!pendingBillWei || pendingBillWei === "0") return;
    try {
      setStatus("Πληρωμή…");
      const tx = await tokenC.payBill({ value: pendingBillWei });
      await provider.waitForTransaction(tx.hash, 1);
      await refreshAll(account);
      // ενημέρωσε Analytics
      window.dispatchEvent(new CustomEvent("kwh:refresh-analytics"));

      setStatus("ΟΚ.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία πληρωμής (δες console).");
    }
  }

  async function addKwhToMetaMask() {
    if (!window.ethereum?.request) return;
    try {
      await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: KWHTokenAddress,
            symbol: "KWH",
            decimals: kwhDecimals || 18,
            image: "",
          },
        },
      });
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία προσθήκης KWH στο MetaMask.");
    }
  }

  return (
    <div className="container grid">
      {/* Κεφαλίδα σελίδας */}
      <div className="grid card section" style={{ gap: 8 }}>
        <h1 style={{ margin: 0 }}>KWHToken DApp</h1>
        <p style={{ opacity: 0.8, margin: 0 }}>
          Διαχείριση κατανάλωσης και πληρωμών σε PREPAID / PAYG, με προσομοίωση και αγορά kWh.
        </p>
      </div>

      {/* Πληροφορίες πορτοφολιού & τιμών */}
      <div className="card section">
        <div className="grid" style={{ gap: 8 }}>
          <div><strong>Λογαριασμός:</strong> {account || "—"}</div>
          <div><strong>Chain:</strong> {chainId || "—"}</div>
          <div><strong>Υπόλοιπο KWH:</strong> {kwhBalance}</div>
          <div><strong>Τιμή (fixed) / kWh:</strong> {fixedPriceWei ? fmtETH(fixedPriceWei) : "—"}</div>
          <div>
            <strong>Τιμή (fluctuating) / kWh:</strong> {fluctPriceWei ? fmtETH(fluctPriceWei) : "—"}
            {fluctSecondsLeft ? (
              <span style={{ marginLeft: 8, opacity: 0.7 }}>({fluctSecondsLeft}s για αλλαγή)</span>
            ) : null}
          </div>
          <div style={{ opacity: 0.8 }}>
            {fixedPriceWei && fluctuatingHint(fixedPriceWei, fluctuatingToBig(fluctPriceWei))}
          </div>
        </div>

        <div className="grid" style={{ gap: 8, marginTop: 12 }}>
          {!account && <button className="btn" onClick={connectWallet}>Σύνδεση με MetaMask</button>}
          <button className="btn ghost" onClick={addKwhToMetaMask}>Πρόσθεσε KWH στο MetaMask</button>
        </div>
      </div>

      {/* Επιλογή μοντέλου */}
      <div className="card section">
        <label htmlFor="billing-select"><strong>Μοντέλο χρέωσης:</strong>{" "}</label>
        <select
          id="billing-select"
          className="input"
          value={billingModel === "unset" ? "prepaid" : billingModel}
          onChange={(e) => changeModel(e.target.value)}
          style={{ width: 220, marginLeft: 8 }}
        >
          <option value="prepaid">Prepaid</option>
          <option value="payg">Pay-As-You-Go</option>
        </select>
        {billingModel === "unset" && (
          <span style={{ marginLeft: 8, opacity: 0.7 }}>(πρώτη ρύθμιση)</span>
        )}
      </div>

      {/* PREPAID */}
      {(billingModel === "prepaid" || billingModel === "unset") && (
        <section className="card section">
          <h3 style={{ marginTop: 0 }}>Prepaid</h3>
          <p style={{ marginTop: -6, opacity: 0.8 }}>
            Αγόρασε kWh προκαταβολικά. Κόστος = kWh × fixed price.
          </p>

          <form onSubmit={handlePrepaidBuy} className="grid" style={{ gap: 10 }}>
            <div className="grid" style={{ gridTemplateColumns: "160px auto", gap: 10, alignItems: "center" }}>
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                placeholder="π.χ. 5"
                value={prepaidKwhInput}
                onChange={(e) => setPrepaidKwhInput(e.target.value)}
              />
              <button type="submit" className="btn" disabled={!fixedPriceWei || !prepaidKwhInput}>
                Αγορά
              </button>
            </div>
            <span style={{ opacity: 0.7, fontSize: 12 }}>
              Τρέχον κόστος/kWh: {fixedPriceWei ? fmtETH(fixedPriceWei) : "—"}
            </span>
          </form>

          <div className="grid" style={{ gap: 12, marginTop: 14 }}>
            <button className="btn ghost" onClick={handleSimulateConsumption}>Simulate Consumption</button>
            <span style={{ opacity: 0.7, fontSize: 12 }}>
              Θα καούν διαθέσιμα KWH. Αν δεν φτάνουν, το υπόλοιπο χρεώνεται στο pending bill με fixed τιμή.
            </span>
          </div>

          <div style={{ marginTop: 10 }}>
            <div><strong>Pending bill (KWHToken):</strong> {fmtETH(pendingBillWei)}</div>
            <button
              className="btn"
              onClick={handlePayBill}
              disabled={!pendingBillWei || pendingBillWei === "0"}
              style={{ marginTop: 8 }}
            >
              Pay Bill
            </button>
          </div>
        </section>
      )}

      {/* PAYG */}
      {billingModel === "payg" && (
        <section className="card section">
          <h3 style={{ marginTop: 0 }}>Pay-As-You-Go (προσομοίωση)</h3>
          <p style={{ marginTop: -6, opacity: 0.8 }}>
            Προσομοίωσε κατανάλωση μέσω του Token και πλήρωσε τον εκκρεμή λογαριασμό.
          </p>

          <div className="grid" style={{ gap: 12, marginBottom: 10 }}>
            <button className="btn ghost" onClick={handleSimulateConsumption}>Simulate Consumption</button>
          </div>

          <div style={{ marginTop: 6 }}>
            <div><strong>Pending consumption (EnergyBilling):</strong> {pendingConsumption} kWh</div>
            <div><strong>Pending bill (KWHToken):</strong> {fmtETH(pendingBillWei)}</div>
          </div>

          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={handlePayBill} disabled={!pendingBillWei || pendingBillWei === "0"}>
              Pay Bill
            </button>
          </div>
        </section>
      )}

      {/* P2P Marketplace */}
      <section className="card section">
        <h3 style={{ marginTop: 0 }}>P2P Marketplace</h3>
        <Marketplace
          account={account}
          provider={provider}
          token={tokenC}
          tokenAddress={KWHTokenAddress}
          tokenAbi={KWHTokenABI}
          tokenDecimals={kwhDecimals}
          balanceUnits={kwhBalanceUnits}
          onRefresh={() => refreshAll(account)}
        />
      </section>

      {/* Tx feed από backend */}
      <section className="card section">
        <h3 style={{ marginTop: 0 }}>Transactions Feed</h3>
        <TxFeed />
      </section>

      {/* Κατάσταση */}
      {!!status && (
        <div className="card section" style={{ color: "#cfcfd6" }}>
          {status}
        </div>
      )}
    </div>
  );
}

/* ===== Helpers μόνο για rendering hints ===== */
function fluctuatingToBig(v){
  try { return BigInt(v); } catch { return 0n; }
}
function fluctuatingHint(fixed, fluctuating){
  try{
    const fx = BigInt(fixed ?? 0);
    const fl = BigInt(fluctuating ?? 0);
    if (fx === 0n || fl === 0n) return null;
    return fl > fx
      ? "💡 Συμφέρει PREPAID αυτή τη στιγμή."
      : "💡 Η PAYG (fluctuating) είναι φθηνότερη τώρα.";
  }catch{
    return null;
  }
}
