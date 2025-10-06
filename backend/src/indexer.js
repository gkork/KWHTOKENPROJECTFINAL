// backend/src/indexer.js

// ---------------- Εξαρτήσεις & imports ----------------
import { ethers } from "ethers";
import mongoose from "mongoose";
import { provider, getReceiptSafe } from "./utils.js";
import { Tx } from "./models/Tx.js";
import { Cursor } from "./models/Cursor.js";
import {
  CHAIN_ID,
  START_BLOCK,
  CONFIRMATIONS,
  KWH_TOKEN_ADDRESS,
  BILLING_ADDR,
  MARKET_ADDR,
} from "./config.js";

// ABIs (ESM JSON imports)
import KWHTokenABIJson      from "./abis/KWHTokenABI.json"      assert { type: "json" };
import EnergyBillingABIJson from "./abis/EnergyBillingABI.json" assert { type: "json" };
import MarketplaceABIJson   from "./abis/MarketplaceABI.json"   assert { type: "json" };

// ---------------- Διευθύνσεις συμβολαίων (από config/env) ----------------
// Προσοχή: .trim() για καθαρισμό κενών. Αν λείπει κάποια, θα γίνει προειδοποίηση παρακάτω.
const ADDRS = {
  KWHToken: (KWH_TOKEN_ADDRESS || "").trim(),
  Billing : (BILLING_ADDR      || "").trim(),
  Market  : (MARKET_ADDR       || "").trim(),
};

// ---------------- Φόρτωση ABI (κάποια builds έχουν .abi, άλλα είναι σκέτο) ----------------
const KWHTokenABI      = KWHTokenABIJson.abi      ?? KWHTokenABIJson;
const EnergyBillingABI = EnergyBillingABIJson.abi ?? EnergyBillingABIJson;
const MarketplaceABI   = MarketplaceABIJson.abi   ?? MarketplaceABIJson;

/* ---------------- Σύνδεση MongoDB & βασική συλλογή events ---------------- */

await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/kwhtoken");
const EventsCol = mongoose.connection.collection("events");
// Δημιουργία unique index για να μη γράφουμε διπλότυπα logs (txHash+logIndex μοναδικά)
await EventsCol.createIndex({ txHash: 1, logIndex: 1 }, { unique: true }).catch(() => {});

/* ---------------- Βοηθητικά ---------------- */

// Κανονικοποίηση/“στείρωση” τιμών ώστε να αποθηκεύονται/serializable (BigInt → string κ.λπ.)
function clean(v) {
  if (v == null) return v;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(clean);
  if (typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "length") continue; // αγνόησε ιδιότητα length που προσθέτει το Ethers σε args arrays
      o[k] = clean(val);
    }
    return o;
  }
  return v;
}

// Cache για blockNumber → Date (για να μην κάνουμε provider.getBlock συνεχώς)
const blockCache = new Map();
async function getBlockTime(blockNumber) {
  if (blockCache.has(blockNumber)) return blockCache.get(blockNumber);
  const b = await provider.getBlock(blockNumber);
  const ms = (b?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000;
  const dt = new Date(ms);
  blockCache.set(blockNumber, dt);
  // Περιορισμός μεγέθους cache (απλό reset όταν ξεπερνάει)
  if (blockCache.size > 5000) blockCache.clear();
  return dt;
}

// Παράγει ημερομηνιακό κλειδί (YYYY-MM-DD) σε UTC για aggregation/στατιστικά
function toDayKey(date) {
  // Αν θέλεις local timezone, κάν’ το στο API aggregation με timezone παράμετρο
  return date.toISOString().slice(0, 10);
}

// Δημιουργία/ενημέρωση εγγραφής συναλλαγής (Tx collection) — upsert by (txHash, logIndex)
async function upsertTx({ contract, event, args, log, receipt }) {
  const bn = log?.blockNumber ?? receipt?.blockNumber ?? null;
  const blockTime = bn != null ? await getBlockTime(bn) : new Date();

  const doc = {
    chainId    : CHAIN_ID,
    blockNumber: bn,
    blockHash  : log?.blockHash ?? receipt?.blockHash ?? null,
    txHash     : log?.transactionHash ?? receipt?.hash ?? "",
    logIndex   : (typeof log?.index === "number")
                   ? log.index
                   : (typeof log?.logIndex === "number" ? log.logIndex : -1),
    contract   : (contract?.target ?? contract?.address ?? "").toLowerCase(),
    event,
    args       : clean(args), // αποθηκεύουμε args καθαρισμένα
    from       : (receipt?.from ?? "").toLowerCase(),
    to         : (receipt?.to ?? "").toLowerCase(),
    // Σημ.: δεν βάζουμε receipt.value (δεν υπάρχει στο receipt· είναι στο transaction)
    status     : "confirmed", // απλό flag — εδώ δεν χειριζόμαστε reorgs/uncle blocks
    blockTime, // Date από timestamp του block
  };

  await Tx.updateOne(
    { txHash: doc.txHash, logIndex: doc.logIndex },
    { $setOnInsert: doc },
    { upsert: true }
  );
}

// Δημιουργία/ενημέρωση εγγραφής event (EventsCol) — upsert by (txHash, logIndex)
async function upsertEvent({ contract, event, args, log, receipt }) {
  const bn = log?.blockNumber ?? receipt?.blockNumber ?? null;
  const blockTime = bn != null ? await getBlockTime(bn) : new Date();

  const txHash = log?.transactionHash ?? receipt?.hash ?? "";
  const logIndex =
    (typeof log?.index === "number" ? log.index :
     (typeof log?.logIndex === "number" ? log.logIndex : -1));

  const doc = {
    chainId    : CHAIN_ID,
    blockNumber: bn,
    txHash,
    logIndex,
    contract   : (contract?.target ?? contract?.address ?? "").toLowerCase(),
    name       : event || "Unknown",
    args       : clean(args),
    ts         : blockTime,            // timestamp event
    dayKey     : toDayKey(blockTime),  // ημερήσιο κλειδί για aggregations
  };

  await EventsCol.updateOne(
    { txHash, logIndex },
    { $setOnInsert: doc },
    { upsert: true }
  );
}

// Επιστρέφει όλα τα ονόματα events από ένα ABI (χρήσιμο για γενικευμένο indexing)
function allEventNames(abi) {
  const iface = new ethers.Interface(abi);
  return iface.fragments.filter(f => f.type === "event").map(f => f.name);
}

// Παράγουμε κλειδί cursor (ανά διεύθυνση συμβολαίου) για να θυμόμαστε από ποιο block συνεχίζουμε
// FIX: έγινε sync και προστέθηκαν backticks
function cursorKey(addr) {
  return `events:${addr.toLowerCase()}`;
}

// Από ποιο block να ξεκινήσουμε: 1) Cursor στη DB, 2) START_BLOCK, 3) last-2000 ως fallback
async function getStartBlock(addr) {
  const key = cursorKey(addr); // FIX: χωρίς await
  const c = await Cursor.findOne({ key });
  if (c && Number.isFinite(c.blockNumber)) return c.blockNumber;

  if (Number.isFinite(START_BLOCK) && START_BLOCK >= 0) return START_BLOCK;

  const latest = await provider.getBlockNumber();
  return Math.max(0, latest - 2000);
}

// Αποθήκευση cursor (blockNumber) για συγκεκριμένο συμβόλαιο
async function setCursor(addr, blockNumber) {
  const key = cursorKey(addr); // FIX: χωρίς await
  await Cursor.updateOne({ key }, { $set: { blockNumber } }, { upsert: true });
}

/* ---------------- Backfill & συγχρονισμός εύρους blocks ---------------- */

// Συγχρονισμός logs για ΟΛΑ τα events ενός ABI, σε δοσμένο εύρος blocks
async function syncRange(contract, abi, fromBlock, toBlock) {
  const names = allEventNames(abi);

  for (const name of names) {
    try {
      const filter = contract.filters[name](); // ethers v6: δυναμικό φίλτρο για event name
      const logs = await contract.queryFilter(filter, fromBlock, toBlock);

      for (const lg of logs) {
        const r = await provider.getTransactionReceipt(lg.transactionHash);

        // Ανακατασκευή event interface για να αντιστοιχίσουμε ονομαστικά args
        const fragment = contract.interface.getEvent(name);
        const named = {};
        fragment.inputs.forEach((inp, i) => {
          // FIX: corrected template string for arg name
          named[inp.name || `arg${i}`] = clean(lg.args?.[i]);
        });

        // Γράψιμο και στις δύο συλλογές (συνοπτικά Tx + αναλυτικά Events)
        await upsertTx({ contract, event: name, args: named, log: lg, receipt: r });
        await upsertEvent({ contract, event: name, args: named, log: lg, receipt: r });
      }
    } catch (e) {
      // FIX: σωστό string στο console.error
      console.error(
        `[indexer] sync "${name}" ${fromBlock}-${toBlock} failed:`,
        e?.message || e
      );
    }
  }
}

// Backfill με batches (default 2000 blocks) μέχρι το latest-CONFIRMATIONS
async function backfill(contract, abi) {
  const batch = 2000;

  let latest = await provider.getBlockNumber();
  latest = Math.max(0, latest - Number(CONFIRMATIONS || 0)); // απλό safety margin για reorgs

  let start = await getStartBlock(contract.target);
  if (start > latest) return;

  while (start <= latest) {
    // FIX: inclusive εύρος
    const end = Math.min(start + batch - 1, latest);
    await syncRange(contract, abi, start, end);
    start = end + 1;
    await setCursor(contract.target, start); // ανανέωση cursor ώστε να ξέρουμε πού φτάσαμε
  }
}

/* ---------------- Ζωντανή ακρόαση (live) ---------------- */

// Σύνδεση listeners για ΟΛΑ τα events του ABI (γενικευμένη υλοποίηση)
function liveListen(contract, abi) {
  const names = allEventNames(abi);

  for (const name of names) {
    contract.on(name, async (...params) => {
      try {
        const ev = params.at(-1); // Ethers v6: το τελευταίο arg είναι το EventLog
        const fragment = contract.interface.getEvent(name);

        // Πάρε τα raw args με βάση τα inputs του event και δώσε τους ονόματα
        const rawArgs = params.slice(0, fragment.inputs.length);
        const named = {};
        fragment.inputs.forEach((inp, i) => {
          // FIX: corrected template string for arg name
          named[inp.name || `arg${i}`] = clean(rawArgs[i]);
        });

        // Απόδειξη (receipt) με safe helper — αν αποτύχει, κάνε log & συνέχισε
        const r = await getReceiptSafe(ev);

        // Upsert Tx + Event
        await upsertTx({ contract, event: name, args: named, log: ev, receipt: r });
        await upsertEvent({ contract, event: name, args: named, log: ev, receipt: r });
      } catch (e) {
        // FIX: σωστό string στο console.error
        console.error(`[indexer] live "${name}" failed:`, e?.message || e);
      }
    });
  }
}

/* ---------------- Είσοδος προγράμματος (entrypoint) ---------------- */

export async function startIndexer() {
  const contracts = [];

  // KWHToken (απαιτεί έγκυρη διεύθυνση)
  if (ethers.isAddress(ADDRS.KWHToken)) {
    contracts.push({
      name: "KWHToken",
      c: new ethers.Contract(ADDRS.KWHToken, KWHTokenABI, provider),
      abi: KWHTokenABI
    });
  } else {
    console.warn("[indexer] KWHToken address missing (KWH_TOKEN_ADDRESS)");
  }

  // EnergyBilling (προαιρετικό)
  if (ethers.isAddress(ADDRS.Billing)) {
    contracts.push({
      name: "Billing",
      c: new ethers.Contract(ADDRS.Billing, EnergyBillingABI, provider),
      abi: EnergyBillingABI
    });
  }

  // Marketplace (προαιρετικό)
  if (ethers.isAddress(ADDRS.Market)) {
    contracts.push({
      name: "Market",
      c: new ethers.Contract(ADDRS.Market, MarketplaceABI, provider),
      abi: MarketplaceABI
    });
  }

  // 1) Αρχικό backfill για όλα τα συμβόλαια (παράλληλα)
  await Promise.all(contracts.map(({ c, abi }) => backfill(c, abi)));
  console.log("[indexer] initial sync complete");

  // 2) Live listeners για events
  for (const { c, abi } of contracts) liveListen(c, abi);

  // 3) Παρακολούθηση νέων blocks (tail sync) με confirmations
  //    Όταν περνάει νέο block, κάνε backfill από τον τελευταίο cursor μέχρι latest-CONFIRMATIONS.
  let syncing = false;
  provider.on("block", async () => {
    if (syncing) return; // απλό lock για να αποφευχθούν επάλληλες κλήσεις
    syncing = true;
    try {
      for (const { c, abi } of contracts) await backfill(c, abi);
    } catch (e) {
      console.error("[indexer] tail sync error:", e?.message || e);
    } finally {
      syncing = false;
    }
  });

  console.log("[indexer] live listeners attached & tailing new blocks");
}

/* ---------------- Εκτέλεση ως standalone script ---------------- */

// Αν το αρχείο τρέχει απευθείας (node backend/src/indexer.js), ξεκίνα τον indexer
if (import.meta.url === `file://${process.argv[1]}`) { // FIX: σωστό template string
  await startIndexer();
  console.log("[indexer] started (standalone)");
  // Κράτα τη διεργασία ζωντανή ώστε να συνεχίσουν τα live listeners
  await new Promise(() => {});
}
