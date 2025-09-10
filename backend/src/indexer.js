// backend/src/indexer.js
import { ethers } from "ethers";
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

// ✅ σωστό path: src/abis/*
import KWHTokenABIJson      from "./abis/KWHTokenABI.json"      assert { type: "json" };
import EnergyBillingABIJson from "./abis/EnergyBillingABI.json" assert { type: "json" };
import MarketplaceABIJson   from "./abis/MarketplaceABI.json"   assert { type: "json" };

const ADDRS = {
  KWHToken: (KWH_TOKEN_ADDRESS || "").trim(),
  Billing : (BILLING_ADDR      || "").trim(),
  Market  : (MARKET_ADDR       || "").trim(),
};

const KWHTokenABI      = KWHTokenABIJson.abi      ?? KWHTokenABIJson;
const EnergyBillingABI = EnergyBillingABIJson.abi ?? EnergyBillingABIJson;
const MarketplaceABI   = MarketplaceABIJson.abi   ?? MarketplaceABIJson;

/* ---------------- helpers ---------------- */

function clean(v) {
  if (v == null) return v;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v; // keep hex as-is
  if (Array.isArray(v)) return v.map(clean);
  if (typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "length") continue;
      o[k] = clean(val);
    }
    return o;
  }
  return v;
}

async function upsertTx({ contract, event, args, log, receipt }) {
  const doc = {
    chainId    : CHAIN_ID,
    blockNumber: log?.blockNumber ?? receipt?.blockNumber ?? null,
    blockHash  : log?.blockHash ?? receipt?.blockHash ?? null,
    txHash     : log?.transactionHash ?? receipt?.hash ?? "",
    logIndex   : typeof log?.index === "number" ? log.index : -1,
    contract   : (contract?.target ?? contract?.address ?? "").toLowerCase(),
    event,
    args       : clean(args),
    from       : (receipt?.from ?? "").toLowerCase(),
    to         : (receipt?.to ?? "").toLowerCase(),
    value      : clean(receipt?.value ?? "0"),
    status     : "confirmed",
  };

  await Tx.updateOne(
    { txHash: doc.txHash, logIndex: doc.logIndex },
    { $setOnInsert: doc },
    { upsert: true }
  );
}

function allEventNames(abi) {
  const iface = new ethers.Interface(abi);
  return iface.fragments.filter(f => f.type === "event").map(f => f.name);
}

async function cursorKey(addr) {
  return `events:${addr.toLowerCase()}`;
}

async function getStartBlock(addr) {
  const key = await cursorKey(addr);
  const c = await Cursor.findOne({ key });
  if (c && Number.isFinite(c.blockNumber)) return c.blockNumber;

  // env START_BLOCK, αλλιώς latest - 2000
  if (Number.isFinite(START_BLOCK) && START_BLOCK >= 0) return START_BLOCK;

  const latest = await provider.getBlockNumber();
  return Math.max(0, latest - 2000);
}

async function setCursor(addr, blockNumber) {
  const key = await cursorKey(addr);
  await Cursor.updateOne(
    { key },
    { $set: { blockNumber } },
    { upsert: true }
  );
}

/* ---------------- backfill & sync range ---------------- */

async function syncRange(contract, abi, fromBlock, toBlock) {
  const names = allEventNames(abi);

  for (const name of names) {
    try {
      const filter = contract.filters[name]();
      const logs = await contract.queryFilter(filter, fromBlock, toBlock);
      for (const lg of logs) {
        const r = await provider.getTransactionReceipt(lg.transactionHash);

        const fragment = contract.interface.getEvent(name);
        const named = {};
        fragment.inputs.forEach((inp, i) => {
          named[inp.name || `arg${i}`] = clean(lg.args?.[i]);
        });

        await upsertTx({ contract, event: name, args: named, log: lg, receipt: r });
      }
    } catch (e) {
      console.error(`[indexer] sync "${name}" ${fromBlock}-${toBlock} failed:`, e?.message || e);
    }
  }
}

async function backfill(contract, abi) {
  const batch = 2000;

  let latest = await provider.getBlockNumber();
  // reorg safety: μέχρι latest - CONFIRMATIONS
  latest = Math.max(0, latest - Number(CONFIRMATIONS || 0));

  let start = await getStartBlock(contract.target);
  if (start > latest) return;

  // console.log(`[indexer] backfill ${contract.target} from ${start} → ${latest} (conf=${CONFIRMATIONS})`);
  while (start <= latest) {
    const end = Math.min(start + batch, latest);
    await syncRange(contract, abi, start, end);
    start = end + 1;
    await setCursor(contract.target, start);
  }
}

/* ---------------- live listen (ethers v6 safe) ---------------- */

function liveListen(contract, abi) {
  const names = allEventNames(abi);

  for (const name of names) {
    contract.on(name, async (...params) => {
      try {
        const ev = params.at(-1); // EventLog (ethers v6)
        const fragment = contract.interface.getEvent(name);

        const rawArgs = params.slice(0, fragment.inputs.length);
        const named = {};
        fragment.inputs.forEach((inp, i) => {
          named[inp.name || `arg${i}`] = clean(rawArgs[i]);
        });

        const r = await getReceiptSafe(ev); // ασφαλές σε v6
        await upsertTx({ contract, event: name, args: named, log: ev, receipt: r });
      } catch (e) {
        console.error(`[indexer] live "${name}" failed:`, e?.message || e);
      }
    });
  }
}

/* ---------------- entry ---------------- */

export async function startIndexer() {
  const contracts = [];

  if (ethers.isAddress(ADDRS.KWHToken)) {
    contracts.push({ name: "KWHToken", c: new ethers.Contract(ADDRS.KWHToken, KWHTokenABI, provider), abi: KWHTokenABI });
  } else {
    console.warn("[indexer] KWHToken address missing (KWHTOKEN_ADDR)");
  }

  if (ethers.isAddress(ADDRS.Billing)) {
    contracts.push({ name: "Billing", c: new ethers.Contract(ADDRS.Billing, EnergyBillingABI, provider), abi: EnergyBillingABI });
  }

  if (ethers.isAddress(ADDRS.Market)) {
    contracts.push({ name: "Market", c: new ethers.Contract(ADDRS.Market, MarketplaceABI, provider), abi: MarketplaceABI });
  }

  // αρχικό full sync
  await Promise.all(contracts.map(({ c, abi }) => backfill(c, abi)));
  console.log("[indexer] initial sync complete");

  // live events
  for (const { c, abi } of contracts) {
    liveListen(c, abi);
  }

  // tailing σε κάθε νέο block (δουλεύει με HTTP polling ή WebSocket)
  let syncing = false;
  provider.on("block", async (bn) => {
    if (syncing) return;
    syncing = true;
    try {
      // μικρό sync από cursor → latest για κάθε contract
      for (const { c, abi, name } of contracts) {
        await backfill(c, abi);
      }
    } catch (e) {
      console.error("[indexer] tail sync error:", e?.message || e);
    } finally {
      syncing = false;
    }
  });

  console.log("[indexer] live listeners attached & tailing new blocks");
}
