// backend/src/db.js
import mongoose from "mongoose";
import { MONGO_URI, START_BLOCK } from "./config.js";
import { Cursor } from "./models/Cursor.js";

let isConnected = false;

/**
 * Συνδέσου στη Mongo (μία φορά). Ρίχνει readable logs.
 * Κάνει επίσης bootstrap ενός cursor αν δεν υπάρχει.
 */
export async function connectMongo() {
  const uri = MONGO_URI;
  if (!uri) {
    console.error("[mongo] MONGO_URI missing in .env");
    return false;
  }
  if (isConnected) return true;

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5_000,
      // dbName: "kwhtoken", // βάλε το αν δεν ορίζεται στο URI
    });
    isConnected = true;

    // Βάλε αρχικό cursor για όλα τα contracts αν το ζητήσει ο indexer.
    // Εδώ κρατάμε μόνο ένα "global" default ώστε να μην ξεκινά από null.
    // Τα per-contract κλειδιά τα γράφει ο indexer με δικό του key.
    await Cursor.updateOne(
      { key: "bootstrap" },
      { $setOnInsert: { blockNumber: Math.max(0, START_BLOCK - 1) } },
      { upsert: true }
    );

    const safeUri = uri.replace(/\/\/([^@]+)@/, "//***@");
    console.log("[mongo] connected:", safeUri);
    return true;
  } catch (err) {
    console.error("[mongo] connection error:", err?.message || err);
    return false;
  }
}

export async function closeMongo() {
  try {
    await mongoose.connection?.close();
    isConnected = false;
    console.log("[mongo] connection closed");
  } catch {
    // ignore
  }
}
