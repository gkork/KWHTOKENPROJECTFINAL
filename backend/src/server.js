// backend/src/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { connectMongo } from "./db.js";
import { startIndexer } from "./indexer.js";

// Routers
import authRouter from "./routes/auth.js";
import chainRouter from "./routes/chain.js";
import analyticsRouter from "./routes/Analytics.js"; // <-- νέο: router-based analytics

const app = express();

/* ---------------- CORS & middleware ---------------- */
const corsOrigins =
  (process.env.CORS_ORIGIN?.split(",").map(s => s.trim()).filter(Boolean)) ||
  ["http://localhost:3000"];

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

/* ---------------- Health checks ---------------- */
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ---------------- API routes (υπό /api/*) ---------------- */
app.use("/api/auth", authRouter);
app.use("/api/chain", chainRouter);
app.use("/api/analytics", analyticsRouter); // <-- mount του analytics router

// (προαιρετικά) back-compat χωρίς /api
app.use("/auth", authRouter);
app.use("/chain", chainRouter);

/* ---------------- 404 & error handlers ---------------- */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not Found" }));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const msg = err.message || "Internal Server Error";
  res.status(status).json({ error: msg });
});

/* ---------------- Start ---------------- */
const PORT = Number(process.env.PORT || 4000);

async function start() {
  const ok = await connectMongo();
  if (!ok) {
    console.error("[mongo] failed - API will not start without DB");
    process.exit(1);
  }

  try {
    await startIndexer(); // ξεκίνα indexer μετά τη DB
  } catch (e) {
    console.error("[indexer] failed:", e?.message || e);
  }

  app.listen(PORT, () => console.log(`[api] http://localhost:${PORT}`));
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
