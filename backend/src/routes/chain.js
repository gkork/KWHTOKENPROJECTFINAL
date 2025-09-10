// backend/src/routes/chain.js
import express from "express";
import { ethers } from "ethers";

// Φόρτωσε τα ABI (προσαρμόσε τα paths αν χρειάζεται)
import MarketplaceBuild from "../abis/MarketplaceABI.json" assert { type: "json" };
import KWHTokenBuild    from "../abis/KWHTokenABI.json"    assert { type: "json" };

const router = express.Router();

// ---- ENV ----
// RPC του node (Anvil/Ganache/Hardhat). Βάλε αυτό που χρησιμοποιείς.
const RPC_URL  = (process.env.RPC_URL || process.env.ANVIL_RPC || "http://127.0.0.1:8545").trim();
// Προαιρετικό CHAIN_ID, βοηθάει όταν είναι διαθέσιμο.
const CHAIN_ID = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined;

// Διευθύνσεις συμβολαίων (ό,τι έχεις στο .env)
const MARKET_ADDR = (process.env.MARKET_ADDR || process.env.MARKETPLACE_ADDR || process.env.MARKET_ADDRESS || "").trim();
const TOKEN_ADDR  = (process.env.TOKEN_ADDR  || process.env.KWHTOKEN_ADDR    || process.env.TOKEN_ADDRESS   || "").trim();

// ethers v6 provider
const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

// Interfaces
const MarketABI = MarketplaceBuild.abi ?? MarketplaceBuild;
const TokenABI  = KWHTokenBuild.abi    ?? KWHTokenBuild;

const ifaceByAddr = new Map();
if (ethers.isAddress(MARKET_ADDR)) ifaceByAddr.set(MARKET_ADDR.toLowerCase(), new ethers.Interface(MarketABI));
if (ethers.isAddress(TOKEN_ADDR))  ifaceByAddr.set(TOKEN_ADDR.toLowerCase(),  new ethers.Interface(TokenABI));

function pickAddresses(addressParam) {
  const addrs = [];
  if (addressParam && ethers.isAddress(addressParam)) {
    addrs.push(addressParam);
  } else {
    if (ethers.isAddress(MARKET_ADDR)) addrs.push(MARKET_ADDR);
    if (ethers.isAddress(TOKEN_ADDR))  addrs.push(TOKEN_ADDR);
  }
  return addrs;
}

/**
 * GET /chain/txs?limit=50&event=Listed&address=0x...
 * - Διαβάζει πρόσφατα logs από τα δηλωμένα συμβόλαια (ή από address=)
 * - Κάνει parse με το ABI για να βρει event name & args
 */
router.get("/txs", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 50));
    const wantedEvent = (req.query.event || "").trim();
    const customAddr  = (req.query.address || "").trim();

    const addresses = pickAddresses(customAddr);
    if (!addresses.length) return res.json({ items: [] });

    const latest = await provider.getBlockNumber();
    const span   = 20_000; // πόσα blocks πίσω θα κοιτάμε (ρύθμισέ το κατά βούληση)
    const fromBlock = Math.max(0, latest - span);

    // Φέρε logs για τα επιλεγμένα contracts
    const logs = await provider.getLogs({ address: addresses, fromBlock, toBlock: latest });

    const items = [];
    // Θέλουμε τα πιο πρόσφατα πρώτα
    for (const lg of logs.reverse()) {
      const addr  = lg.address.toLowerCase();
      const iface = ifaceByAddr.get(addr);
      if (!iface) continue;

      let parsed;
      try {
        parsed = iface.parseLog(lg);
      } catch {
        continue; // log που δεν αντιστοιχεί σε event του ABI
      }

      if (wantedEvent && parsed?.name !== wantedEvent) continue;

      // Πάρε χρόνο block (προαιρετικό)
      let ts = 0;
      try {
        const block = await provider.getBlock(lg.blockHash);
        ts = (block?.timestamp || 0) * 1000;
      } catch {}

      // Μετατροπή args σε απλό object
      let argsObj = {};
      try {
        const entries = Object.entries(parsed.args).filter(([k]) => isNaN(Number(k)));
        argsObj = Object.fromEntries(entries);
      } catch {}

      items.push({
        time: ts,
        blockNumber: lg.blockNumber,
        txHash: lg.transactionHash,
        address: lg.address,
        event: parsed?.name || "Log",
        args: argsObj,
      });

      if (items.length >= limit) break;
    }

    res.json({ items });
  } catch (err) {
    console.error("[/chain/txs] error:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;
