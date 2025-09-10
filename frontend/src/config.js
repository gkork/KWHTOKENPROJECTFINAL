// src/config.js

// -------------------------
// Καθαρισμός env & helpers
// -------------------------
const clean = (v) =>
  (v ?? "")
    .toString()
    .trim()
    .replace(/^['"]|['"]$/g, "")           // κόψε τυχόν quotes γύρω-γύρω
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width
    .replace(/\s+/g, "");                  // ενδιάμεσα κενά/newlines

const toInt = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const isAddressLike = (v) => /^0x[0-9a-fA-F]{40}$/.test(v || "");

// -------------------------
// Env (από .env.local)
// -------------------------
export const KWHTokenAddress      = clean(process.env.REACT_APP_TOKEN_ADDR);
export const EnergyBillingAddress = clean(process.env.REACT_APP_BILLING_ADDR);
export const MarketplaceAddress   = clean(process.env.REACT_APP_MARKET_ADDR);

// Optional: chain id (π.χ. 31337 για anvil/hardhat)
export const CHAIN_ID = toInt(process.env.REACT_APP_CHAIN_ID, 31337);

// API base του backend (π.χ. http://localhost:4000)
const RAW_API = (process.env.REACT_APP_API_BASE || "http://localhost:4000").trim();
export const API_BASE = RAW_API.endsWith("/") ? RAW_API.slice(0, -1) : RAW_API;

// Ασφαλές join για endpoint paths
export const api = (path = "") =>
  `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

// -------------------------
// Validation snapshot
// -------------------------
export function envIsValid() {
  return {
    token:   isAddressLike(KWHTokenAddress),
    billing: isAddressLike(EnergyBillingAddress),
    market:  isAddressLike(MarketplaceAddress),
    api:     /^https?:\/\//i.test(API_BASE),
  };
}

// -------------------------
// Storage keys για auth/session
// -------------------------
export const STORAGE_KEYS = Object.freeze({
  authToken: "authToken",
});

// -------------------------
// Debug helper (dev only)
// -------------------------
export function printEnvDebug() {
  if (process.env.NODE_ENV !== "development") return;

  const valid = envIsValid();
  console.log("ENV snapshot:", {
    addresses: {
      KWHTokenAddress,
      EnergyBillingAddress,
      MarketplaceAddress,
    },
    API_BASE,
    CHAIN_ID,
    lens: {
      token: KWHTokenAddress.length,
      bill:  EnergyBillingAddress.length,
      mkt:   MarketplaceAddress.length,
      api:   API_BASE.length,
    },
    valid,
  });

  if (!valid.market) {
    console.warn("⚠️  REACT_APP_MARKET_ADDR φαίνεται άκυρο (αναμένεται 0x + 40 hex).");
  }
  if (!valid.api) {
    console.warn("⚠️  REACT_APP_API_BASE φαίνεται άκυρο (αναμένεται http/https).");
  }
}

// -------------------------
// Συγκεντρωτικό export (προαιρετικό)
// -------------------------
const config = {
  API_BASE,
  api,
  CHAIN_ID,
  addresses: {
    token: KWHTokenAddress,
    billing: EnergyBillingAddress,
    market: MarketplaceAddress,
  },
  STORAGE_KEYS,
};

export default config;
