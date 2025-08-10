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

// ABI imports (πιάνει είτε artifacts με { abi: [...] } είτε σκέτο array)
import KWHTokenBuild from "./abi/KWHTokenABI.json";
import EnergyBillingBuild from "./abi/EnergyBillingABI.json";

const KWHTokenABI = KWHTokenBuild.abi ?? KWHTokenBuild;
const EnergyBillingABI = EnergyBillingBuild.abi ?? EnergyBillingBuild;

// Enum για το UI
const PM = { PREPAID: 0, PAYG: 1 };

export default function App() {
  // Wallet / network
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");

  // Contracts
  const [tokenC, setTokenC] = useState(null);
  const [billingC, setBillingC] = useState(null);

  // Prices & balances
  const [fixedPriceWei, setFixedPriceWei] = useState(null);   // BigInt
  const [fluctPriceWei, setFluctPriceWei] = useState(null);   // BigInt
  const [kwhDecimals, setKwhDecimals] = useState(18);
  const [kwhBalance, setKwhBalance] = useState("0.0");

  // Billing state
  const [billingModel, setBillingModel] = useState("prepaid"); // 'prepaid' | 'payg'
  const [pendingBillWei, setPendingBillWei] = useState("0");
  const [pendingConsumption, setPendingConsumption] = useState("0");

  // UI
  const [prepaidKwhInput, setPrepaidKwhInput] = useState("");
  const [status, setStatus] = useState("");

  // Guards (για MetaMask request διπλό)
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

  // Init (σιωπηλή ανάγνωση λογαριασμού + listeners)
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      printEnvDebug();
      if (!window.ethereum || !provider) return;

      try {
        // 1) σιωπηλή προσπάθεια: δεν ανοίγει popup
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

        // listeners
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

  // Σύνδεση με κουμπί
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

      // Τιμές σε wei / kWh
      const [fx, fl] = await Promise.all([
        t.fixedPricePerKWH(),
        t.fluctuatingPricePerKWH(),
      ]);
      setFixedPriceWei(fx);
      setFluctPriceWei(fl);

      // Decimals & υπόλοιπο
      const dec = await t.decimals?.().catch(() => 18);
      const decN = Number(dec) || 18;
      setKwhDecimals(decN);

      const bal = await t.balanceOf(user);
      setKwhBalance(ethers.formatUnits(bal, decN));

      // Μοντέλο χρήστη (από EnergyBilling)
      const model = await b.getModel(user);
      setBillingModel(Number(model) === PM.PAYG ? "payg" : "prepaid");

      // Pending bill (KWHToken.getUserDetails)
      const details = await t.getUserDetails(user); // [paymentModel, consumption, pendingBill, generatedKWH]
      setPendingBillWei(details[2]?.toString?.() || "0");

      // Pending consumption (EnergyBilling.users)
      const urec = await b.users(user); // { model, pendingConsumption }
      setPendingConsumption(urec?.pendingConsumption?.toString?.() || "0");

      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Σφάλμα ανάγνωσης (δες console).");
    }
  }

  // Αλλαγή μοντέλου με guard για "already set"
  async function changeModel(nextStr) {
    if (!billingC) return;
    if (
      (nextStr === "payg" && billingModel === "payg") ||
      (nextStr === "prepaid" && billingModel === "prepaid")
    ) {
      return; // ήδη ρυθμισμένο
    }
    try {
      setStatus("Αλλαγή μοντέλου…");
      const nextEnum = nextStr === "payg" ? PM.PAYG : PM.PREPAID;
      const tx = await billingC.setModel(nextEnum);
      await tx.wait();
      setBillingModel(nextStr);

      // optional: register στο token (αγνόησε αν already registered)
      try {
        const tx2 = await tokenC.registerUser(nextEnum);
        await tx2.wait();
      } catch {}

      await refreshAll(account);
      setStatus("Έγινε.");
    } catch (e) {
      console.error(e);
      setStatus("Αποτυχία αλλαγής μοντέλου (δες console).");
    }
  }

  // Prepaid αγορά: value = kWh * fixedPriceWei
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

  // PAYG προσομοίωση (ΚΑΛΟΥΜΕ ΤΟ TOKEN — ΟΧΙ τον simulator)
  async function handleSimulateConsumption() {
    if (!tokenC) return;
    try {
      setStatus("Προσομοίωση…");
      const tx = await tokenC.simulateConsumption(); // <- αυτό είναι το σωστό
      await tx.wait();
      await refreshAll(account);
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

  // Helpers
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
          value={billingModel}
          onChange={(e) => changeModel(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 14 }}
        >
          <option value="prepaid">Prepaid</option>
          <option value="payg">Pay-As-You-Go</option>
        </select>
      </div>

      {/* PREPAID */}
      {billingModel === "prepaid" && (
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

      <div style={{ marginTop: 18, color: "#444" }}>{status}</div>
    </div>
  );
}
