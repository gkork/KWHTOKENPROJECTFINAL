// src/App.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import "./App.css";

// Διευθύνσεις & debug
import {
  KWHTokenAddress,
  EnergyBillingAddress,
  printEnvDebug,
} from "./config";

// ABI imports
import KWHTokenBuild from "./abi/KWHTokenABI.json";
import EnergyBillingBuild from "./abi/EnergyBillingABI.json";

// P2P Marketplace component
import Marketplace from "./components/Marketplace";

const KWHTokenABI = KWHTokenBuild.abi ?? KWHTokenBuild;
const EnergyBillingABI = EnergyBillingBuild.abi ?? EnergyBillingBuild;

/**
 * ΠΡΟΣΟΧΗ: Διαφορετικές αρίθμησεις enums στα δύο συμβόλαια!
 *
 * EnergyBilling.PaymentModel:  UNSET=0, PREPAID=1, PAYG=2
 * KWHToken.PaymentModel:       PREPAID=0, PAYG=1
 */
const BILL_PM = { UNSET: 0, PREPAID: 1, PAYG: 2 };
const TOKEN_PM = { PREPAID: 0, PAYG: 1 };

// helpers: μετατροπές string <-> enums
const toBillEnum = (s) => (s === "payg" ? BILL_PM.PAYG : BILL_PM.PREPAID);
const toTokenEnum = (s) => (s === "payg" ? TOKEN_PM.PAYG : TOKEN_PM.PREPAID);
const fromBillEnum = (n) =>
  n === BILL_PM.PAYG ? "payg" : n === BILL_PM.PREPAID ? "prepaid" : "unset";

export default function App() {
  // Wallet / network
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");

  // Contracts
  const [tokenC, setTokenC] = useState(null);
  const [billingC, setBillingC] = useState(null);

  // Prices & balances
  const [fixedPriceWei, setFixedPriceWei] = useState(null);
  const [fluctPriceWei, setFluctPriceWei] = useState(null);
  const [kwhDecimals, setKwhDecimals] = useState(18);
  const [kwhBalance, setKwhBalance] = useState("0.0");

  // Billing state
  const [billingModel, setBillingModel] = useState("unset"); // 'unset' | 'prepaid' | 'payg'
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

  // Helpers για instances
  async function makeToken() {
    const signer = await getSigner();
    if (!KWHTokenAddress) throw new Error("KWHTokenAddress empty");
    return new ethers.Contract(KWHTokenAddress, KWHTokenABI, signer);
  }
  async function makeBilling() {
    const signer = await getSigner();
    if (!EnergyBillingAddress) throw new Error("EnergyBillingAddress empty");
    return new ethers.Contract(EnergyBillingAddress, EnergyBillingABI, signer);
  }

  // Init (silent)
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

        const t = await makeToken();
        const b = await makeBilling();
        setTokenC(t);
        setBillingC(b);

        if (acc) await refreshAll(acc, t, b);

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
      } catch (e) {
        console.error(e);
        setStatus("Αποτυχία αρχικοποίησης (δες console).");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // Connect
  async function connectWallet() {
    if (!window.ethereum) return alert("Χρειάζεται MetaMask");
    if (isRequesting.current) return;
    isRequesting.current = true;
    try {
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      const acc = accs?.[0] ?? "";
      setAccount(acc);

      const t = tokenC ?? (await makeToken());
      const b = billingC ?? (await makeBilling());
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

      const [fx, fl] = await Promise.all([
        t.fixedPricePerKWH(),
        t.fluctuatingPricePerKWH(),
      ]);
      setFixedPriceWei(fx);
      setFluctPriceWei(fl);

      const dec = await t.decimals?.().catch(() => 18);
      const decN = Number(dec) || 18;
      setKwhDecimals(decN);

      const bal = await t.balanceOf(user);
      setKwhBalance(ethers.formatUnits(bal, decN));

      // --- Πρότυπη ανάγνωση από EnergyBilling ---
      const billModelEnum = await b.getModel(user); // 0/1/2
      setBillingModel(fromBillEnum(Number(billModelEnum)));

      // Token details για bill (στο token κρατάς pendingBill)
      const details = await t.getUserDetails(user); // struct User
      setPendingBillWei(details.pendingBill?.toString?.() || details[2]?.toString?.() || "0");

      // Το pendingConsumption ζει στο EnergyBilling
      const urec = await b.users(user); // { model, pendingConsumption }
      setPendingConsumption(urec?.pendingConsumption?.toString?.() || "0");

      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Σφάλμα ανάγνωσης (δες console).");
    }
  }

  // Αλλαγή μοντέλου (σωστή επιλογή setModel/changeModel)
  async function changeModel(nextStr) {
    if (!billingC || !account) return;
    try {
      setStatus("Αλλαγή μοντέλου…");

      const currentEnum = Number(await billingC.getModel(account)); // 0/1/2
      const nextBillEnum = toBillEnum(nextStr);

      if (currentEnum === nextBillEnum) {
        setStatus("Ήδη στο ζητούμενο μοντέλο.");
        return;
      }

      if (currentEnum === BILL_PM.UNSET) {
        // Πρώτο set
        const tx = await billingC.setModel(nextBillEnum);
        await tx.wait();
      } else {
        // Αλλαγή
        const tx = await billingC.changeModel(nextBillEnum);
        await tx.wait();
      }

      // (προαιρετικά) ενημέρωσε και το Token με το ΔΙΚΟ ΤΟΥ enum
      try {
        if (tokenC) {
          const tokenEnum = toTokenEnum(nextStr); // 0/1
          const tx2 = await tokenC.registerUser(tokenEnum);
          await tx2.wait();
        }
      } catch (_) {
        // αγνόησέ το αν αποτύχει, δεν είναι κρίσιμο
      }

      await refreshAll(account);
      setStatus("Έγινε.");
    } catch (e) {
      console.error(e);
      // Φιλικό μήνυμα για γνωστό λόγο
      if (String(e?.message || "").toLowerCase().includes("outstanding consumption")) {
        setStatus("Δεν μπορείς να αλλάξεις από PAYG όσο υπάρχει ανεξόφλητη κατανάλωση.");
      } else if (String(e?.message || "").toLowerCase().includes("already set")) {
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
      const kwh = ethers.parseUnits(prepaidKwhInput, 0); // ακέραιες kWh
      const totalWei = kwh * fixedPriceWei; // BigInt
      const tx = await tokenC.buyTokens({ value: totalWei });
      await tx.wait();
      setPrepaidKwhInput("");
      await refreshAll(account);
      setStatus("ΟΚ.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία αγοράς (δες console).");
    }
  }

  // PAYG προσομοίωση (μέσω Token)
  async function handleSimulateConsumption() {
    if (!tokenC) return;
    try {
      setStatus("Προσομοίωση…");
      const tx = await tokenC.simulateConsumption();
      await tx.wait();
      await refreshAll(account);
      setStatus("Έγινε.");
    } catch (e) {
      console.error(e);
      setStatus("Η προσομοίωση απέτυχε (δες console).");
    }
  }

  // Πληρωμή λογαριασμού (στο token)
  async function handlePayBill() {
    if (!tokenC) return;
    if (!pendingBillWei || pendingBillWei === "0") return;
    try {
      setStatus("Πληρωμή…");
      const tx = await tokenC.payBill({ value: pendingBillWei });
      await tx.wait();
      await refreshAll(account);
      setStatus("ΟΚ.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία πληρωμής (δες console).");
    }
  }

  // Προσθήκη token στο MetaMask
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

  const fmtETH = (v) => {
    try { return `${ethers.formatEther(v)} ETH`; } catch { return "—"; }
  };

  return (
    <div style={{ maxWidth: 960, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui, Arial" }}>
      <h1 style={{ fontSize: 42, margin: 0 }}>KWHToken DApp</h1>

      <div style={{ marginTop: 12, lineHeight: 1.7 }}>
        <div><strong>Λογαριασμός:</strong> {account || "—"}</div>
        <div><strong>Chain:</strong> {chainId || "—"}</div>
        <div><strong>Υπόλοιπο KWH:</strong> {kwhBalance}</div>
        <div><strong>Τιμή (fixed) / kWh:</strong> {fixedPriceWei ? fmtETH(fixedPriceWei) : "—"}</div>
        <div><strong>Τιμή (fluctuating) / kWh:</strong> {fluctPriceWei ? fmtETH(fluctPriceWei) : "—"}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          {!account && <button onClick={connectWallet}>Σύνδεση με MetaMask</button>}
          <button onClick={addKwhToMetaMask}>Πρόσθεσε KWH στο MetaMask</button>
        </div>
      </div>

      <hr style={{ margin: "24px 0" }} />

      {/* Επιλογή μοντέλου */}
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="billing-select"><strong>Μοντέλο χρέωσης:</strong>{' '}</label>
        <select
          id="billing-select"
          value={billingModel === "unset" ? "prepaid" : billingModel}
          onChange={(e) => changeModel(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 14 }}
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
        <section style={{ padding: 16, border: "1px solid #eee", borderRadius: 8, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Prepaid</h3>
          <p style={{ marginTop: -6, opacity: 0.8 }}>
            Αγόρασε kWh προκαταβολικά. Κόστος = kWh × fixed price.
          </p>
          <form onSubmit={handlePrepaidBuy} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="π.χ. 5"
              value={prepaidKwhInput}
              onChange={(e) => setPrepaidKwhInput(e.target.value)}
              style={{ padding: "6px 10px", width: 140 }}
            />
            <span>kWh</span>
            <button type="submit" disabled={!fixedPriceWei || !prepaidKwhInput}>Αγορά</button>
            <span style={{ marginLeft: 12, opacity: 0.7, fontSize: 12 }}>
              Τρέχον κόστος/kWh: {fixedPriceWei ? fmtETH(fixedPriceWei) : "—"}
            </span>
          </form>
        </section>
      )}

      {/* PAYG */}
      {billingModel === "payg" && (
        <section style={{ padding: 16, border: "1px solid #eee", borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Pay-As-You-Go (προσομοίωση)</h3>
          <p style={{ marginTop: -6, opacity: 0.8 }}>
            Προσομοίωσε κατανάλωση μέσω του Token και πλήρωσε τον εκκρεμή λογαριασμό.
          </p>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <button onClick={handleSimulateConsumption}>Simulate Consumption</button>
          </div>

          <div style={{ marginTop: 6 }}>
            <div><strong>Pending consumption (EnergyBilling):</strong> {pendingConsumption} kWh</div>
            <div><strong>Pending bill (KWHToken):</strong> {fmtETH(pendingBillWei)}</div>
          </div>

          <div style={{ marginTop: 10 }}>
            <button onClick={handlePayBill} disabled={!pendingBillWei || pendingBillWei === "0"}>
              Pay Bill
            </button>
          </div>
        </section>
      )}

      {/* P2P Marketplace */}
      <hr style={{ margin: "24px 0" }} />
      <Marketplace />

      <div style={{ marginTop: 18, color: "#444" }}>{status}</div>
    </div>
  );
}
