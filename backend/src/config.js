// backend/src/config.js
import 'dotenv/config';

// Δίκτυο/chain
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);

// RPC / DB
export const RPC_URL   = process.env.RPC_URL;
export const MONGO_URI = process.env.MONGODB_URI
  || process.env.MONGO_URI
  || "mongodb://127.0.0.1:27017/kwhtoken";

// Συμβόλαια (δεχόμαστε εναλλακτικά ονόματα .env)
export const KWH_TOKEN_ADDRESS =
  process.env.KWH_TOKEN_ADDRESS || process.env.KWHTOKEN_ADDR || "";

export const MARKET_ADDR    = process.env.MARKET_ADDR    || "";
export const BILLING_ADDR   = process.env.BILLING_ADDR   || "";
export const SIMULATOR_ADDR = process.env.SIMULATOR_ADDR || "";

// Ρυθμίσεις indexer
export const START_BLOCK   = Number(process.env.START_BLOCK ?? 0);
export const CONFIRMATIONS = Number(process.env.CONFIRMATIONS ?? 0);

// Server
export const PORT = Number(process.env.PORT ?? 4000);

// JWT (προαιρετικά)
export const JWT_SECRET  = process.env.JWT_SECRET  || "change-me";
export const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";
