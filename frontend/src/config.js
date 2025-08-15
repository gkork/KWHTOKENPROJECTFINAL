const clean = (v) =>
  (v || "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "");

export const KWHTokenAddress      = clean(process.env.REACT_APP_TOKEN_ADDR);
export const EnergyBillingAddress = clean(process.env.REACT_APP_BILLING_ADDR);
export const MarketplaceAddress   = clean(process.env.REACT_APP_MARKET_ADDR);

// Helper για debug στο console
export function printEnvDebug() {
  if (process.env.NODE_ENV !== "development") return;
  console.log("ENV OK :", {
    KWHTokenAddress,
    EnergyBillingAddress,
    MarketplaceAddress,
    lens: {
      token: KWHTokenAddress.length,
      bill:  EnergyBillingAddress.length,
      mkt:   MarketplaceAddress.length,
    }
  });
}
