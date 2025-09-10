// backend/src/utils.js
import { Interface, JsonRpcProvider, WebSocketProvider } from "ethers";
import { RPC_URL } from "./config.js";

/* ---------------- RPC provider & helpers ---------------- */

// Αν υπάρχει RPC_WS_URL χρησιμοποίησε WebSocket (πιο άμεσο για events).
// Αλλιώς γύρνα σε HTTP με ενεργό polling.
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

  const http = RPC_URL || "http://127.0.0.1:8545";
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

// Μικρό delay helper για retries
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const blockTimeCache = new Map();

/**
 * Πάρε timestamp block με μικρή cache και retries (ethers v6 μπορεί να γυρίσει null σε race conditions)
 * @returns {number|null} unix seconds ή null αν δεν βρέθηκε
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
    await sleep(200 * attempt); // 200ms, 400ms, 600ms
  }
  return null;
}

/**
 * Ασφαλές receipt getter που δουλεύει είτε δώσεις event (ethers v6) είτε hash
 * - Αν το event έχει getTransactionReceipt(), το χρησιμοποιούμε (πιο αξιόπιστο).
 * - Αλλιώς προσπαθούμε από transactionHash/hash.
 * @param {any} evOrHash
 * @returns {Promise<import('ethers').TransactionReceipt|null>}
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
export const toId    = (txHash, logIndex) => `${txHash}_${logIndex}`;
export const dayKey  = (ts) => Math.floor(ts / 86400);
export const toLower = (x) => (typeof x === "string" ? x.toLowerCase() : x);

/* ---------------- ABI helpers ---------------- */

// Επιστρέφει πάντα array (είτε είναι artifact {abi:[]} είτε σκέτο [])
export function normalizeABI(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object" && Array.isArray(x.abi)) return x.abi;
  return [];
}

export function mergeAbis(...abix) {
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
 * Καθαρισμός args/logs για αποθήκευση (BigInt → string, αφαίρεση numeric aliases)
 */
export function serializeArgs(obj) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(serializeArgs);
  if (typeof obj === "bigint") return obj.toString();
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/^\d+$/.test(k)) continue; // skip numeric aliases (ethers array-like)
      out[k] = serializeArgs(v);
    }
    return out;
  }
  return obj;
}
