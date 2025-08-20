// src/config.js

// Καθαρισμός env τιμών (κόβει κενά, zero-width, newlines)
const clean = (v) =>
  (v || "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "");

// Διευθύνσεις από .env.local
export const KWHTokenAddress      = clean(process.env.REACT_APP_TOKEN_ADDR);
export const EnergyBillingAddress = clean(process.env.REACT_APP_BILLING_ADDR);
export const MarketplaceAddress   = clean(process.env.REACT_APP_MARKET_ADDR);

// Helper: γρήγορος έλεγχος μορφής 0x + 40 hex
export const isAddressLike = (v) => /^0x[0-9a-fA-F]{40}$/.test(v || "");

// Επιστρέφει ποια env είναι έγκυρα
export function envIsValid() {
  return {
    token:  isAddressLike(KWHTokenAddress),
    billing:isAddressLike(EnergyBillingAddress),
    market: isAddressLike(MarketplaceAddress),
  };
}

// Debug helper: τύπωσε τα env στη console μόνο σε development
export function printEnvDebug() {
  if (process.env.NODE_ENV !== "development") return;
  const valid = envIsValid();
  console.log("ENV OK:", {
    KWHTokenAddress,
    EnergyBillingAddress,
    MarketplaceAddress,
    lens: {
      token: KWHTokenAddress.length,
      bill:  EnergyBillingAddress.length,
      mkt:   MarketplaceAddress.length,
    },
    valid,
  });
  if (!valid.market) {
    console.warn("⚠️ REACT_APP_MARKET_ADDR φαίνεται άκυρο (αναμένεται 0x + 40 hex).");
  }
}
