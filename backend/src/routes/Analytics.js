// backend/src/routes/analytics.js
import express from "express";
import { Tx } from "../models/Tx.js";

const router = express.Router();

/* ---------- helpers (UTC) ---------- */
const DAY_MS = 86_400_000;

// key μέρας σε UTC
const dayKeyUTC = (d) => Math.floor(new Date(d).getTime() / DAY_MS);

// YYYY-MM-DD σε UTC
const toISO = (d) => new Date(d).toISOString().slice(0, 10);

// kWh “κανονικό” (όπως στο KWHConsumed.kwh)
const toKwh = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

// ποσά token με 18 δεκαδικά → kWh (π.χ. 1e18 → 1)
const token18ToKwh = (x) => {
  try {
    const bi = BigInt(String(x));
    return Number(bi) / 1e18;
  } catch {
    return toKwh(x);
  }
};

// user filter που πιάνει from/to & args.user (όπως τα βλέπουμε στο dump σου)
function makeUserFilter(user) {
  if (!user) return {};
  const u = user.toLowerCase();
  return { $or: [{ from: u }, { to: u }, { "args.user": u }] };
}

// Θα μετράμε μόνο αυτά που πραγματικά βλέπουμε στα δεδομένα σου
const EVENT_FILTER = { event: { $in: ["KWHConsumed", "TokensBurned", "Transfer"] } };

/* ---------- routes ---------- */

// GET /api/analytics/daily?user=0x...&all=1
router.get("/daily", async (req, res) => {
  try {
    // start ημέρας σε UTC
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const fromDate = new Date(today.getTime() - 29 * DAY_MS);

    const user = (req.query.user || "").toLowerCase();
    const all = req.query.all === "1" || req.query.all === "true";
    const userFilter = all ? {} : makeUserFilter(user);

    let txs = await Tx.find(
      { createdAt: { $gte: fromDate }, ...EVENT_FILTER, ...userFilter },
      { event: 1, args: 1, to: 1, createdAt: 1 }
    )
      .sort({ createdAt: 1 })
      .lean();

    // Fallback: αν δεν βρήκαμε τίποτα με user, φέρε όλα για να βλέπεις νούμερα
    if (!all && user && txs.length === 0) {
      txs = await Tx.find(
        { createdAt: { $gte: fromDate }, ...EVENT_FILTER },
        { event: 1, args: 1, to: 1, createdAt: 1 }
      )
        .sort({ createdAt: 1 })
        .lean();
    }

    // Προετοιμασία buckets 30 ημερών (UTC)
    const byDay = new Map();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY_MS);
      const key = dayKeyUTC(d);
      byDay.set(key, {
        day_key: key,
        day: toISO(d),
        consumed: 0, // σύνολο KWHConsumed.kwh
        burned: 0, // σύνολο TokensBurned/Transfer(→0x0) σε kWh
        kwh_total: 0,
        kwh_prepaid: 0,
        kwh_payg: 0,
      });
    }

    // Γέμισε consumed/burned
    const ZERO = "0x0000000000000000000000000000000000000000";
    for (const tx of txs) {
      const dk = dayKeyUTC(tx.createdAt || new Date());
      const b = byDay.get(dk);
      if (!b) continue;

      const ev = tx.event;
      const a = tx.args || {};

      if (ev === "KWHConsumed") {
        // στο dump: args.kwh = "5" κ.λπ. (όχι 18 δεκ.)
        b.consumed += toKwh(a.kwh ?? a.amount ?? a.value ?? 0);
      } else if (ev === "TokensBurned") {
        // amount είναι σε 18 δεκαδικά
        b.burned += token18ToKwh(a.amount ?? a.value ?? a.tokens ?? 0);
      } else if (ev === "Transfer") {
        // μετράμε μόνο καύση (to == zero)
        const to = String(a.to || "").toLowerCase();
        if (to === ZERO) {
          b.burned += token18ToKwh(a.value ?? 0);
        }
      }
    }

    // Τελικός υπολογισμός ανά ημέρα
    for (const b of byDay.values()) {
      b.kwh_prepaid = Math.min(b.consumed, b.burned);
      b.kwh_payg = Math.max(0, b.consumed - b.kwh_prepaid);
      b.kwh_total = b.consumed;
      delete b.consumed;
      delete b.burned;
    }

    const daily = Array.from(byDay.values()).sort((a, b) => a.day_key - b.day_key);
    res.json({ daily, filter: all ? "all" : user ? "user" : "none" });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// GET /api/analytics/summary?user=0x...&all=1
router.get("/summary", async (req, res) => {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const fromDate = new Date(today.getTime() - 29 * DAY_MS);

    const user = (req.query.user || "").toLowerCase();
    const all = req.query.all === "1" || req.query.all === "true";
    const userFilter = all ? {} : makeUserFilter(user);

    let txs = await Tx.find(
      { createdAt: { $gte: fromDate }, ...EVENT_FILTER, ...userFilter },
      { event: 1, args: 1, to: 1, createdAt: 1 }
    ).lean();

    if (!all && user && txs.length === 0) {
      txs = await Tx.find(
        { createdAt: { $gte: fromDate }, ...EVENT_FILTER },
        { event: 1, args: 1, to: 1, createdAt: 1 }
      ).lean();
    }

    // Σύνολα 30 ημερών
    let consumed = 0; // sum KWHConsumed.kwh
    let burned = 0; // sum burns in kWh
    const ZERO = "0x0000000000000000000000000000000000000000";

    for (const tx of txs) {
      const ev = tx.event;
      const a = tx.args || {};

      if (ev === "KWHConsumed") {
        consumed += toKwh(a.kwh ?? a.amount ?? a.value ?? 0);
      } else if (ev === "TokensBurned") {
        burned += token18ToKwh(a.amount ?? a.value ?? a.tokens ?? 0);
      } else if (ev === "Transfer") {
        const to = String(a.to || "").toLowerCase();
        if (to === ZERO) burned += token18ToKwh(a.value ?? 0);
      }
    }

    const kwh_prepaid = Math.min(consumed, burned);
    const kwh_payg = Math.max(0, consumed - kwh_prepaid);

    res.json({
      user: user || null,
      range: { from: toISO(fromDate), to: toISO(today) },
      kwh_total: consumed,
      kwh_prepaid,
      kwh_payg,
      pendingBill: "0", // δεν έχουμε billed_wei στα δεδομένα σου
      filter: all ? "all" : user ? "user" : "none",
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// (προαιρετικό) debug: δες τα τελευταία που μετράμε
router.get("/_recent", async (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
  const docs = await Tx.find(
    { ...EVENT_FILTER },
    { event: 1, args: 1, to: 1, createdAt: 1 }
  )
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  res.json({ docs });
});

// (προαιρετικό) SSE placeholder
router.get("/sessions", (req, res) => {
  const wantsSSE = (req.headers.accept || "").includes("text/event-stream");
  if (!wantsSSE) return res.json({ sessions: [] });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: init\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const iv = setInterval(() => res.write(`: ping\n\n`), 15000);
  req.on("close", () => {
    clearInterval(iv);
    res.end();
  });
});

export default router;
