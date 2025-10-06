// backend/src/utils.js
import { Interface, JsonRpcProvider, WebSocketProvider } from "ethers";
import { RPC_URL } from "./config.js";

/* ---------------- RPC provider & helpers ---------------- */

// Αν υπάρχει RPC_WS_URL χρησιμοποίησε WebSocket (πιο άμεσο για events).
// Αλλιώς γύρνα σε HTTP με ενεργό polling σε περίπτωση που δεν λειτουργεί το WebSocket (π.χ λόγω firewall) .
function makeProvider() {
  const ws = (process.env.RPC_WS_URL || "").trim();
  const pollMs = Number(process.env.POLL_MS || 5000);

  if (ws) {
    const p = new WebSocketProvider(ws);
    // @ts-ignore
    p.pollingInterval = pollMs;
    console.log(`[utils] Using WebSocketProvider ${ws} (poll=${pollMs}ms fallback)`);
    return p;
  }

  const http = RPC_URL || "http://127.0.0.1:8545";      // Αν δεν έχει δοθεί RPC_URL, πέφτουμε σε τοπικό default
  if (!RPC_URL) {
    console.warn(`[utils] RPC_URL is empty; falling back to ${http}`);
  }
  const p = new JsonRpcProvider(http);
  // @ts-ignore
  p.pollingInterval = pollMs; // ώστε contract.on/filters να δουλεύουν αξιόπιστα
  console.log(`[utils] Using JsonRpcProvider ${http} (poll=${pollMs}ms)`);
  return p;
}

export const provider = makeProvider();

// Μικρό delay helper για retries σε αποτυχημένες κλήσεις
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const blockTimeCache = new Map();   // Cache για χρόνους blocks: αποφεύγουμε να ρωτάμε ξανά τον κόμβο για τα ίδια blocks

/**
 *  Επιστρέφει το timestamp ενός block (σε UNIX seconds).
 * - Δοκιμάζει έως 3 φορές (μικρά retries) γιατί μερικές φορές ο κόμβος αργεί/επιστρέφει null.
 * - Χρησιμοποιεί μικρή cache για να μειώσει περιττές κλήσεις. 
   @returns {number|null} 
 */
export async function getBlockTs(blockNumber) {
  if (blockTimeCache.has(blockNumber)) return blockTimeCache.get(blockNumber);

  let attempt = 0;
  while (attempt < 3) {
    try {
      const blk = await provider.getBlock(blockNumber);
      if (blk && blk.timestamp != null) {
        const ts = Number(blk.timestamp);
        blockTimeCache.set(blockNumber, ts);
        return ts;
      }
    } catch {}
    attempt += 1;
    await sleep(200 * attempt); // προοδευτικές καθυστερήσεις: 200ms, 400ms, 600ms
  }
  return null;
}

/**
 * Ασφαλές receipt getter που δουλεύει είτε δώσεις event είτε hash
 * - Αν το event έχει getTransactionReceipt(), το χρησιμοποιούμε .
 * - Αλλιώς προσπαθούμε από transactionHash/hash. 
  @param {any} evOrHash
  @returns {Promise<import('ethers').TransactionReceipt|null>}
 */
export async function getReceiptSafe(evOrHash) {
  try {
    if (evOrHash?.getTransactionReceipt) {
      return await evOrHash.getTransactionReceipt();
    }
    const hash =
      evOrHash?.transactionHash ??
      evOrHash?.hash ??
      (typeof evOrHash === "string" ? evOrHash : null);

    if (!hash) return null;
    return await provider.getTransactionReceipt(hash);
  } catch (e) {
    console.error("[utils] getReceiptSafe failed:", e?.message || e);
    return null;
  }
}

// Βοηθητικά ids/keys
export const toId    = (txHash, logIndex) => `${txHash}_${logIndex}`;   // μοναδικό ID για log εγγραφή
export const dayKey  = (ts) => Math.floor(ts / 86400);                // «κλειδί ημέρας» (UTC) από seconds
export const toLower = (x) => (typeof x === "string" ? x.toLowerCase() : x);    // ασφαλές Μετατροπη απο κεφαλαία σε πεζά

/* ---------------- ABI helpers ---------------- */

// Επιστρέφει πάντα array (είτε {abi:[]} είτε σκέτο [])
export function normalizeABI(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object" && Array.isArray(x.abi)) return x.abi;
  return [];
}

export function mergeAbis(...abix) {     // Συγχώνευση πολλών ABIs (μόνο functions/events) σε ένα ενιαίο Interface για parsing
  const frags = [];
  for (const raw of abix) {
    const abi = normalizeABI(raw);
    for (const f of abi) {
      if (f?.type === "function" || f?.type === "event") frags.push(f);
    }
  }
  return new Interface(frags);
}

/**

 * «Καθαρίζει» αντικείμενα args/logs πριν τα γράψουμε στη βάση:
 * - Μετατροπή μορφής BigInt σε string (ώστε να είναι σε JSON-κατανοητή μορφή)
 * - Αφαιρεί τους αριθμούς που προσθέτει το ethers (π.χ. "0", "1" σε array-like)
 
 */
export function serializeArgs(obj) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(serializeArgs);
  if (typeof obj === "bigint") return obj.toString();
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/^\d+$/.test(k)) continue; 
      out[k] = serializeArgs(v);
    }
    return out;
  }
  return obj;
}
