// backend/src/server.js
import "dotenv/config";   // Φορτώνει μεταβλητές περιβάλλοντος από .env ώστε να διατεθούν στο process.env

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { connectMongo } from "./db.js";
import { startIndexer } from "./indexer.js";

// Routers
import authRouter from "./routes/auth.js";
import chainRouter from "./routes/chain.js";
import analyticsRouter from "./routes/Analytics.js"; 

const app = express();

// Επιτρεπόμενα origins για κλήσεις από το frontend
const corsOrigins =
  (process.env.CORS_ORIGIN?.split(",").map(s => s.trim()).filter(Boolean)) ||
  ["http://localhost:3000"];

app.use(cors({ origin: corsOrigins, credentials: true }));  // Ενεργοποίηση CORS (με credentials:true για αποστολή cookies)

app.use(express.json()); // Parser για αιτήματα τύπου JSON

app.use(cookieParser()); // Parser για cookies

// Απλά endpoints για έλεγχο αν λειτουργεί ο server
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

//  βασικοί router κάτω από 
app.use("/api/auth", authRouter);
app.use("/api/chain", chainRouter);
app.use("/api/analytics", analyticsRouter); // <-- mount του analytics router

// συμβατότητα χωρίς /api
app.use("/auth", authRouter);
app.use("/chain", chainRouter);

//Για οποιοδήποτε άγνωστο /api/* endpoint επέστρεψε 404 JSON
app.use("/api", (_req, res) => res.status(404).json({ error: "Not Found" }));


// Κεντρικός χειριστής σφαλμάτων Express (επιστρέφει ελεγχόμενο JSON)

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const msg = err.message || "Internal Server Error";
  res.status(status).json({ error: msg });
});

/* ---------------- Start ---------------- */
const PORT = Number(process.env.PORT || 4000);


// Εκκίνηση εφαρμογής: σύνδεση DB, εκκίνηση indexer, άνοιγμα web server

async function start() {
  const ok = await connectMongo();
  if (!ok) {
    console.error("[mongo] failed - API will not start without DB");   // 1) Σύνδεση στη MongoDB — χωρίς βάση δεν ξεκινά το API

    process.exit(1);
  }

  try {
    await startIndexer();   // Εκκίνηση indexer (παρακολουθεί blockchain και γράφει events στη DB)

  } catch (e) {
    console.error("[indexer] failed:", e?.message || e);
  }

  app.listen(PORT, () => console.log(`[api] http://localhost:${PORT}`));              // 3) (εκκίνηση web server)
}

// Καθαρός τερματισμός διαδικασίας σε σήματα συστήματος

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));


// Εκκίνηση και fallback σε ελεγχόμενο τερματισμό αν προκύψει σφάλμα

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
