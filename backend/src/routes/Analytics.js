// backend/src/routes/analytics.js
import express from "express";
import { Tx } from "../models/Tx.js";

const router = express.Router();

/* ---------- helpers (UTC) ---------- */
const DAY_MS = 86_400_000;
const ZERO = "0x0000000000000000000000000000000000000000";

// κλειδί μέρας (UTC)
const dayKeyUTC = (d) => {
  const dt = new Date(d);
  dt.setUTCHours(0, 0, 0, 0);
  return Math.floor(dt.getTime() / DAY_MS);
};

// YYYY-MM-DD (UTC)
const toISO = (d) => {
  const dt = new Date(d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt.toISOString().slice(0, 10);
};

// ασφαλές timestamp από έγγραφο
const getTS = (tx) => tx?.blockTime ?? tx?.timestamp ?? tx?.createdAt ?? Date.now();

// kWh “κανονικό”
const toKwh = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

// ποσά token με 18 δεκαδικά → kWh
const token18ToKwh = (x) => {
  try { return Number(BigInt(String(x))) / 1e18; }
  catch { return toKwh(x); }
};

// user filter που πιάνει συνηθισμένα πεδία
function makeUserFilter(user) {
  if (!user) return {};
  const u = user.toLowerCase();
  return {
    $or: [
      { from: u }, { to: u },
      { "args.user": u }, { "args.account": u },
      { "args.owner": u }, { "args.sender": u },
      { "args.buyer": u }, { "args.seller": u },
      { "args.to": u }, { "args.from": u },
    ],
  };
}

// Event sets
const BURN_EVENTS      = ["TokensBurned", "Burn", "Burned", "Transfer"]; // Transfer με to=0x0
const CONSUME_REGEX    = /consum/i; // KWHConsumed, ConsumptionRecorded, SimulatedConsumption, …
const BILL_GEN_EVENTS  = ["BillGenerated"];
const BILL_PAID_EVENTS = ["BillPaid"];

/* ---------- routes ---------- */

// GET /api/analytics/daily?user=0x...&all=1
router.get("/daily", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");

    // 30ήμερο: [today-29 .. today] (UTC)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const fromDate = new Date(today.getTime() - 29 * DAY_MS);

    const user = (req.query.user || "").toLowerCase();
    const all  = req.query.all === "1" || req.query.all === "true";
    const userFilter = all ? {} : makeUserFilter(user);

    // φέρε πρόσφατες εγγραφές (blockTime ή createdAt)
    const txs = await Tx.find(
      {
        $and: [
          userFilter,
          { $or: [{ blockTime: { $gte: fromDate } }, { createdAt: { $gte: fromDate } }] },
        ],
      },
      { event: 1, args: 1, to: 1, createdAt: 1, blockTime: 1 }
    )
      .sort({ blockTime: 1, createdAt: 1 })
      .lean();

    // buckets 30 ημερών
    const byDay = new Map();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY_MS);
      const key = dayKeyUTC(d);
      byDay.set(key, {
        day_key: key,
        day: toISO(d),
        kwh_total: 0,
        kwh_prepaid: 0,
        kwh_payg: 0,
      });
    }

    // === ΣΥΓΚΕΝΤΡΩΣΗ (consumed & burned ανά μέρα) ===
    const acc = {}; // { dayKey: { consumed, burned } }

    for (const tx of txs) {
      const dk = dayKeyUTC(getTS(tx));
      if (!byDay.has(dk)) continue;

      const ev = String(tx.event || "");
      const a  = tx.args || {};
      const b  = (acc[dk] ||= { consumed: 0, burned: 0 });

      // Consumed (PAYG ή/και PREPAID): events που περιέχουν "consum"
      if (CONSUME_REGEX.test(ev)) {
        b.consumed +=
          (Number(a.kwh) ||
           Number(a.amount) ||
           Number(a.value) ||
           Number(a.units) || 0);
      }

      // Burned (PREPAID): TokensBurned ή Transfer προς 0x0
      if (BURN_EVENTS.includes(ev)) {
        if (ev === "Transfer") {
          const to = String(a.to || "").toLowerCase();
          if (to === ZERO) b.burned += token18ToKwh(a.value ?? 0);
        } else {
          b.burned += token18ToKwh(a.amount ?? a.value ?? a.tokens ?? 0);
        }
      }
    }

    // === ΤΕΛΙΚΟΣ ΥΠΟΛΟΓΙΣΜΟΣ ανά ημέρα ===
    for (const [key, row] of byDay.entries()) {
      const b = acc[key] || { consumed: 0, burned: 0 };
      const prepaid = Math.min(b.consumed, b.burned);
      const payg    = Math.max(0, b.consumed - prepaid);

      row.kwh_prepaid = prepaid;
      row.kwh_payg    = payg;
      row.kwh_total   = b.consumed;

      byDay.set(key, row);
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
    res.set("Cache-Control", "no-store");

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const fromDate = new Date(today.getTime() - 29 * DAY_MS);

    const user = (req.query.user || "").toLowerCase();
    const all  = req.query.all === "1" || req.query.all === "true";
    const userFilter = all ? {} : makeUserFilter(user);

    const txs = await Tx.find(
      {
        $and: [
          userFilter,
          { $or: [{ blockTime: { $gte: fromDate } }, { createdAt: { $gte: fromDate } }] },
        ],
      },
      { event: 1, args: 1, to: 1, createdAt: 1, blockTime: 1 }
    ).lean();

    let consumed = 0;   // από consumption events
    let burned   = 0;   // burns (TokensBurned ή Transfer→0x0)
    let pendingWei = 0n;

    for (const tx of txs) {
      const ev = String(tx.event || "");
      const a  = tx.args || {};

      // Consumed
      if (CONSUME_REGEX.test(ev)) {
        consumed +=
          (Number(a.kwh) ||
           Number(a.amount) ||
           Number(a.value) ||
           Number(a.units) || 0);
      }

      // Burned
      if (BURN_EVENTS.includes(ev)) {
        if (ev === "Transfer") {
          const to = String(a.to || "").toLowerCase();
          if (to === ZERO) burned += token18ToKwh(a.value ?? 0);
        } else {
          burned += token18ToKwh(a.amount ?? a.value ?? a.tokens ?? 0);
        }
      }

      // Pending (BillGenerated/BillPaid)
      if (BILL_GEN_EVENTS.includes(ev)) {
        try { pendingWei += BigInt(String(a.weiAmount ?? a.amount ?? a.value ?? 0)); } catch {}
      }
      if (BILL_PAID_EVENTS.includes(ev)) {
        try { pendingWei -= BigInt(String(a.weiAmount ?? a.amount ?? a.value ?? 0)); } catch {}
      }
    }

    // ⛑️ clamp: μην εμφανίζεις ποτέ αρνητική εκκρεμότητα
    if (pendingWei < 0n) pendingWei = 0n;

    // Τελικοί αριθμοί
    const kwh_prepaid = Math.min(consumed, burned);
    const kwh_payg    = Math.max(0, consumed - kwh_prepaid);
    const kwh_total   = consumed;

    res.json({
      user: user || null,
      range: { from: toISO(fromDate), to: toISO(today) },
      kwh_total,
      kwh_prepaid,
      kwh_payg,
      pendingBill: pendingWei.toString(),
      filter: all ? "all" : user ? "user" : "none",
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// Γρήγορο debug (+προαιρετικά φίλτρα)
router.get("/_recent", async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
  const { event, day } = req.query;

  const q = {};
  if (event) q.event = String(event);
  if (day) {
    const d = new Date(`${day}T00:00:00Z`);
    const next = new Date(d.getTime() + DAY_MS);
    q.$or = [
      { blockTime: { $gte: d, $lt: next } },
      { createdAt: { $gte: d, $lt: next } },
    ];
  }

  const docs = await Tx.find(
    q,
    { event: 1, args: 1, to: 1, createdAt: 1, blockTime: 1 }
  )
    .sort({ blockTime: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  res.set("Cache-Control", "no-store");
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
  req.on("close", () => { clearInterval(iv); res.end(); });
});

export default router;
